// Ce module est le seul de l'app qui puisse ABÎMER un dépôt. Les tests portent donc
// tous sur la même question : est-ce qu'un geste de Pyra peut emporter quelque chose
// que l'utilisateur n'a pas donné ? Le cas central est le dernier — un travail en
// cours, à moitié indexé, pendant que la synchro passe.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { slug, folderName, scaffold, init, firstCommit, sync, remoteState, OWNED } from "../forge.mjs";

const tmp = () => fsp.mkdtemp(path.join(os.tmpdir(), "pyra-forge-"));
const git = (dir, ...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8" });

// Un dépôt de test doit avoir une identité à lui : la globale de la machine peut être
// absente sur une intégration continue, et le premier commit échouerait pour une
// raison qui n'a rien à voir avec ce qu'on mesure.
async function repo() {
  const dir = await tmp();
  await init(dir);
  git(dir, "config", "user.email", "test@example.com");
  git(dir, "config", "user.name", "Test");
  return dir;
}

/* ------------------------------------------------------------------ les noms */

test("le nom d'un dépôt GitHub perd ses accents, ses espaces et ses bords", () => {
  assert.equal(slug("Skull King"), "skull-king");
  assert.equal(slug("Café — été 2026 !"), "cafe-ete-2026");
  assert.equal(slug("--bord--"), "bord");
  // Un nom vide reste un nom : `gh repo create ""` échouerait plus loin, sans dire
  // pourquoi. Mieux vaut un défaut ici.
  assert.equal(slug("   "), "project");
});

test("un nom de dossier garde ses majuscules mais ne remonte pas l'arborescence", () => {
  assert.equal(folderName("Skull King"), "Skull King");
  // Le séparateur saute et les points de tête avec : sans ça, un nom de projet
  // déciderait d'où le dossier atterrit.
  assert.ok(!folderName("../../etc").includes("/"));
  assert.ok(!folderName("../../etc").startsWith("."));
});

/* --------------------------------------------------------------- le squelette */

test("le squelette pose trois fichiers et n'écrase jamais rien", async () => {
  const dir = path.join(await tmp(), "Projet");
  const first = await scaffold(dir, { name: "Projet", milestones: true });
  assert.deepEqual(first.sort(), [".gitignore", "MILESTONES.md", "README.md"]);

  // On réécrit un fichier À LA MAIN, puis on repasse : le contenu doit survivre.
  // C'est la règle « ne jamais écraser un fichier de l'utilisateur », vérifiée là où
  // elle est le plus facile à perdre — un second appel par mégarde.
  await fsp.writeFile(path.join(dir, "README.md"), "à moi\n", "utf8");
  const again = await scaffold(dir, { name: "Projet", milestones: true });
  assert.deepEqual(again, []);
  assert.equal(await fsp.readFile(path.join(dir, "README.md"), "utf8"), "à moi\n");
});

test("le MILESTONES.md de départ se relit avec la grammaire de l'app", async () => {
  const M = await import("../milestones.mjs");
  const dir = path.join(await tmp(), "Projet");
  await scaffold(dir, { name: "Projet", milestones: true });
  const r = M.read(dir, "Projet");
  const items = M.items(r.blocks);
  // Un milestone à la marge, deux étapes dessous : la hiérarchie que l'app sait lire.
  const mains = items.filter((i) => !i.parentId);
  assert.equal(mains.length, 1);
  assert.equal(items.filter((i) => i.parentId === mains[0].id).length, 2);
});

/* -------------------------------------------------------------- premier commit */

test("le premier commit prend le squelette, et un second appel ne fait rien", async () => {
  const dir = await repo();
  await scaffold(dir, { name: "Projet", milestones: true });
  assert.deepEqual(await firstCommit(dir), { ok: true });
  assert.equal(git(dir, "log", "--oneline").trim().split("\n").length, 1);

  const again = await firstCommit(dir);
  assert.equal(again.already, true);
  assert.equal(git(dir, "log", "--oneline").trim().split("\n").length, 1);
});

/* ------------------------------------------------------------------ la synchro */

test("la synchro ne commite rien quand rien n'a bougé", async () => {
  const dir = await repo();
  await scaffold(dir, { name: "Projet", milestones: true });
  await firstCommit(dir);
  const r = await sync(dir, { push: false });
  assert.equal(r.ok, true);
  assert.equal(r.skipped, "nothing changed");
  assert.equal(git(dir, "log", "--oneline").trim().split("\n").length, 1);
});

test("un dossier sans dépôt n'est pas une panne", async () => {
  const dir = await tmp();
  await scaffold(dir, { name: "Projet", milestones: true });
  const r = await sync(dir, { push: false });
  assert.equal(r.ok, false);
  assert.equal(r.skipped, "not a git repository");
});

// LE test de ce fichier. Un `git add -A` passerait ici sans broncher et emporterait
// les trois fichiers de l'utilisateur dans un commit qu'il n'a pas demandé. C'est
// exactement ce que la forme `git commit -- <chemins>` empêche, et c'est la seule
// raison pour laquelle l'app a le droit d'écrire dans l'histoire d'un dépôt.
test("la synchro laisse le travail en cours de l'utilisateur exactement où il est", async () => {
  const dir = await repo();
  await scaffold(dir, { name: "Projet", milestones: true });
  await firstCommit(dir);

  // Trois formes de travail en cours, et la troisième est la plus fragile.
  await fsp.writeFile(path.join(dir, "draft.py"), "pas fini\n", "utf8");          // non suivi
  await fsp.appendFile(path.join(dir, "README.md"), "note perso\n", "utf8");      // modifié
  await fsp.writeFile(path.join(dir, "staged.txt"), "à moitié\n", "utf8");
  git(dir, "add", "staged.txt");                                                   // INDEXÉ

  // Pyra écrit dans son fichier à elle, puis synchronise.
  await fsp.appendFile(path.join(dir, "MILESTONES.md"), "\n- [ ] Encore un\n", "utf8");
  const r = await sync(dir, { push: false });
  assert.equal(r.ok, true);
  assert.ok(r.committed);

  // Le commit ne contient QUE le fichier de Pyra.
  const touched = git(dir, "show", "--name-only", "--format=", "HEAD").trim().split("\n").filter(Boolean);
  assert.deepEqual(touched, ["MILESTONES.md"]);

  // Et les trois travaux sont intacts, chacun dans son état : non suivi, modifié,
  // indexé. C'est la troisième ligne qui compte — l'index n'a pas été vidé.
  // Surtout PAS de `.trim()` sur la sortie entière : les deux premières colonnes de
  // `--porcelain` portent l'information, et l'espace de tête de « ␣M » est ce qui
  // distingue « modifié dans l'arbre » de « indexé ». Le manger ici rendrait le test
  // aveugle à la seule chose qu'il mesure.
  const status = git(dir, "status", "--porcelain").split("\n").filter(Boolean).sort();
  assert.deepEqual(status, [" M README.md", "?? draft.py", "A  staged.txt"].sort());
  assert.equal(git(dir, "diff", "--cached", "--name-only").trim(), "staged.txt");
});

test("la synchro ne touche qu'aux fichiers que Pyra écrit", async () => {
  // La liste est courte et doit le rester : chaque nom ajouté ici est un fichier de
  // plus que l'app s'autorise à commiter chez quelqu'un d'autre. `.pyra/preview.json`
  // y est entré parce qu'il porte un HISTORIQUE de mesures — des relevés datés que
  // rien d'autre ne saurait reconstituer, et qu'un dépôt cloné ailleurs doit avoir.
  // La bannière du même dossier n'y est PAS : elle appartient à l'utilisateur.
  assert.deepEqual(OWNED, ["MILESTONES.md", "CLAUDE.md", ".pyra/preview.json"]);
});

test("un chemin imbriqué se commite comme les autres, et seul", async () => {
  const dir = await repo();
  await scaffold(dir, { name: "Projet", milestones: true });
  await firstCommit(dir);

  await fsp.mkdir(path.join(dir, ".pyra"), { recursive: true });
  await fsp.writeFile(path.join(dir, ".pyra/preview.json"), '{ "goal": "x", "metrics": [] }\n', "utf8");
  // Une image posée à côté dans le MÊME dossier : elle appartient au dépôt, pas à
  // l'app, et elle doit rester non suivie après la synchro.
  await fsp.writeFile(path.join(dir, ".pyra/banner.png"), "pas vraiment un png", "utf8");

  const r = await sync(dir, { push: false });
  assert.equal(r.ok, true);
  const touched = git(dir, "show", "--name-only", "--format=", "HEAD").trim().split("\n").filter(Boolean);
  assert.deepEqual(touched, [".pyra/preview.json"]);
  assert.equal(git(dir, "status", "--porcelain").trim(), "?? .pyra/banner.png");
});

test("un commit fait sans distant n'est pas perdu, il attend", async () => {
  const dir = await repo();
  await scaffold(dir, { name: "Projet", milestones: true });
  await firstCommit(dir);
  await fsp.appendFile(path.join(dir, "MILESTONES.md"), "\n- [ ] Encore un\n", "utf8");

  // `push: true` sur un dépôt sans `origin` : le commit doit être fait quand même, et
  // l'échec du push rendu tel quel. Le contraire — échouer en bloc — laisserait
  // croire que l'enregistrement a raté.
  const r = await sync(dir, { push: true });
  assert.equal(r.ok, true);
  assert.ok(r.committed);
  assert.equal(r.pushed, false);
  assert.match(r.pushError, /no remote/);
  assert.equal(git(dir, "log", "--oneline").trim().split("\n").length, 2);
});

/* -------------------------------------------------------------------- l'état */

test("l'état du distant distingue « pas de dépôt » de « pas de distant »", async () => {
  const plain = await tmp();
  assert.deepEqual(await remoteState(plain), { repo: false });

  const dir = await repo();
  await scaffold(dir, { name: "Projet", milestones: true });
  await firstCommit(dir);
  const st = await remoteState(dir);
  assert.equal(st.repo, true);
  assert.equal(st.remote, "");     // aucun distant : un fait, pas un défaut
  assert.equal(st.upstream, false);
  assert.ok(st.branch);
});
