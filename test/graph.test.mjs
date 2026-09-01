// Les cas ici sont ceux qui peuvent réellement abîmer un dépôt de l'utilisateur :
// un pointeur réécrit deux fois dans son CLAUDE.md, une exclusion git dupliquée à
// chaque construction, un graphe déclaré à jour alors que le dépôt a avancé. La
// construction elle-même n'est pas testée ici — elle appelle une binaire extérieure,
// et ce module ne teste que ce dont il est responsable.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { state, exclude, pointer, OUT_DIR } from "../graph.mjs";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "pyr-graph-"));

const git = (dir, ...args) =>
  execFileSync("git", args, { cwd: dir, stdio: "pipe", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } })
    .toString().trim();

// Un dépôt jouet avec un graphe déjà écrit : on ne fabrique que ce que `state()` lit.
function repo({ commitInReport = null } = {}) {
  const dir = tmp();
  git(dir, "init", "-q");
  fs.writeFileSync(path.join(dir, "a.txt"), "un\n");
  git(dir, "add", "-A");
  git(dir, "-c", "commit.gpgsign=false", "commit", "-qm", "init");
  const head = git(dir, "rev-parse", "HEAD");

  const out = path.join(dir, OUT_DIR);
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, "graph.json"), "{}");
  fs.writeFileSync(
    path.join(out, "GRAPH_REPORT.md"),
    `# Graph Report - x\n\n## Summary\n- 1,408 nodes · 5,563 edges · 46 communities (10 shown)\n\n## Graph Freshness\n- Built from commit: \`${(commitInReport || head).slice(0, 8)}\`\n`
  );
  return { dir, head };
}

test("l'état se lit du rapport, pas du graphe", () => {
  const { dir, head } = repo();
  const s = state(dir);
  assert.equal(s.built, true);
  assert.equal(s.nodes, 1408, "les milliers séparés par une virgule sont lus");
  assert.equal(s.edges, 5563);
  assert.equal(s.communities, 46);
  assert.equal(head.startsWith(s.commit), true, "le commit du rapport préfixe HEAD");
  assert.equal(s.stale, false);
});

test("un dépôt sans graphe le dit, sans lever", () => {
  const dir = tmp();
  assert.deepEqual(state(dir), { built: false });
});

test("le graphe est périmé dès que le dépôt avance", () => {
  const { dir } = repo({ commitInReport: "0123456789abcdef0123456789abcdef01234567" });
  assert.equal(state(dir).stale, true);
});

// Un dossier sans git n'est pas en retard : il n'a pas d'horloge. Le prétendre
// mettrait une pastille orange permanente sur un projet qui va très bien.
test("un dossier hors git n'est jamais déclaré périmé", () => {
  const dir = tmp();
  const out = path.join(dir, OUT_DIR);
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, "graph.json"), "{}");
  fs.writeFileSync(path.join(out, "GRAPH_REPORT.md"), "- 5 nodes · 7 edges · 2 communities\n- Built from commit: `deadbeef`\n");
  assert.equal(state(dir).stale, false);
});

test("l'exclusion git ne s'écrit qu'une fois", () => {
  const { dir } = repo();
  assert.equal(exclude(dir), true);
  assert.equal(exclude(dir), false, "la deuxième construction ne duplique pas la ligne");
  const text = fs.readFileSync(path.join(dir, ".git", "info", "exclude"), "utf8");
  assert.equal(text.split("\n").filter((l) => l.trim() === `${OUT_DIR}/`).length, 1);
  assert.equal(text.endsWith("\n"), true);
});

test("l'exclusion va dans .git/info/exclude, jamais dans le .gitignore", () => {
  const { dir } = repo();
  fs.writeFileSync(path.join(dir, ".gitignore"), "node_modules\n");
  exclude(dir);
  assert.equal(fs.readFileSync(path.join(dir, ".gitignore"), "utf8"), "node_modules\n",
    "le .gitignore appartient à l'utilisateur et part avec le dépôt publié");
});

test("le pointeur s'ajoute au CLAUDE.md sans rien retirer", () => {
  const { dir } = repo();
  const file = path.join(dir, "CLAUDE.md");
  fs.writeFileSync(file, "# Projet\n\nUne consigne à moi.\n");
  assert.equal(pointer(dir), true);
  const text = fs.readFileSync(file, "utf8");
  assert.match(text, /^# Projet\n\nUne consigne à moi\.\n/, "ce qui était là reste en tête, intact");
  assert.match(text, /graphify query/, "le mode d'emploi est ajouté à la suite");
});

test("le pointeur est idempotent", () => {
  const { dir } = repo();
  fs.writeFileSync(path.join(dir, "CLAUDE.md"), "# Projet\n");
  pointer(dir);
  const once = fs.readFileSync(path.join(dir, "CLAUDE.md"), "utf8");
  assert.equal(pointer(dir), false, "une deuxième construction ne réécrit rien");
  assert.equal(fs.readFileSync(path.join(dir, "CLAUDE.md"), "utf8"), once);
});

// L'app s'appelait Pyramis. Un dépôt suivi depuis cette époque porte le bloc sous
// l'ancien marqueur : le reconnaître est la seule chose qui empêche d'en greffer un
// second au nom d'après, dans un fichier qui appartient à l'utilisateur.
test("le pointeur reconnaît le marqueur de l'ancien nom", () => {
  const { dir } = repo();
  const file = path.join(dir, "CLAUDE.md");
  const before = "# Projet\n\n<!-- pyramis:graphify -->\n## Knowledge graph\n<!-- /pyramis:graphify -->\n";
  fs.writeFileSync(file, before);
  assert.equal(pointer(dir), false, "le bloc est déjà là, sous son ancien nom");
  assert.equal(fs.readFileSync(file, "utf8"), before);
});

test("le pointeur crée le CLAUDE.md s'il n'existe pas", () => {
  const { dir } = repo();
  assert.equal(pointer(dir), true);
  assert.match(fs.readFileSync(path.join(dir, "CLAUDE.md"), "utf8"), /^<!-- pyra:graphify -->/);
});

// Le bloc est délimité précisément pour que l'utilisateur puisse le retirer d'un
// coup d'éditeur. Si les marqueurs disparaissaient, il n'aurait plus de prise.
test("le bloc porte ses deux marqueurs", () => {
  const { dir } = repo();
  pointer(dir);
  const text = fs.readFileSync(path.join(dir, "CLAUDE.md"), "utf8");
  assert.match(text, /<!-- pyra:graphify -->/);
  assert.match(text, /<!-- \/pyra:graphify -->/);
});
