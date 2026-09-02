// Copyright © 2026 Paul Gregory. Tous droits réservés.
// Le graphe de connaissance d'un dépôt, construit par Graphify (une CLI extérieure).
//
// Deux règles tiennent ce module, et elles sont le prolongement du pari de l'app :
//
// 1. **Jamais un appel au modèle.** `extract --code-only` lit le code par AST, en
//    local, sans clé d'API : une construction ne coûte pas un token et ne peut donc
//    pas entamer la fenêtre de quota que l'utilisateur garde pour son vrai travail.
//    Graphify sait aussi extraire le SENS des docs, des papiers et des images — en
//    envoyant leur contenu à un LLM. Cette porte-là reste fermée ici, délibérément :
//    ajouter un projet ne doit jamais déclencher une dépense qu'on n'a pas demandée.
//    Le corollaire est à connaître : un dépôt qui n'est que du markdown produit un
//    graphe presque vide, et c'est le comportement voulu.
//
// 2. **Rien n'est stocké par l'app.** Le graphe vit dans `graphify-out/` à la racine
//    du dépôt, exactement comme le `MILESTONES.md`. L'état qu'affiche l'interface est
//    relu du `GRAPH_REPORT.md` à chaque fois. Si Pyra disparaît, le graphe reste,
//    et le `graphify` de l'utilisateur continue de l'interroger sans nous.

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";

export const OUT_DIR = "graphify-out";
export const REPORT = "GRAPH_REPORT.md";
export const GRAPH = "graph.json";

const TIMEOUT = 15 * 60 * 1000;

const run = (cmd, args, opts) =>
  new Promise((ok, ko) =>
    execFile(cmd, args, opts, (err, stdout, stderr) => (err ? ko(Object.assign(err, { stdout, stderr })) : ok(stdout)))
  );

/* --------------------------------------------------------------- la binaire */

// Le serveur peut être lancé depuis le Finder ou un `.app`, où le PATH se réduit à
// /usr/bin:/bin. `uv tool install` pose ses binaires dans ~/.local/bin, qui n'y est
// alors pas — d'où la recherche explicite. Sans ça, la construction échouerait avec
// un ENOENT que rien dans l'interface n'expliquerait.
const CANDIDATES = [
  path.join(os.homedir(), ".local", "bin", "graphify"),
  "/opt/homebrew/bin/graphify",
  "/usr/local/bin/graphify",
];

let cached;
export function bin() {
  if (cached !== undefined) return cached;
  for (const dir of (process.env.PATH || "").split(":")) {
    if (!dir) continue;
    const f = path.join(dir, "graphify");
    try { fs.accessSync(f, fs.constants.X_OK); cached = f; return cached; } catch { /* suivant */ }
  }
  for (const f of CANDIDATES) {
    try { fs.accessSync(f, fs.constants.X_OK); cached = f; return cached; } catch { /* suivant */ }
  }
  cached = null;
  return cached;
}

export const available = () => bin() !== null;

/* ------------------------------------------------------------------- l'état */

const NUMBERS = /^-\s*([\d,]+)\s*nodes?\s*·\s*([\d,]+)\s*edges?\s*·\s*([\d,]+)\s*communit/im;
const COMMIT = /^-\s*Built from commit:\s*`?([0-9a-f]{7,40})`?/im;
const int = (s) => Number(String(s).replace(/[^\d]/g, "")) || 0;

// L'état se relit du rapport, jamais d'un cache à nous. Le rapport fait quelques
// kilo-octets là où `graph.json` peut peser plusieurs mégaoctets : on ne charge pas
// le graphe pour afficher un compteur.
export function state(dir) {
  const out = path.join(dir, OUT_DIR);
  const report = path.join(out, REPORT);
  const graph = path.join(out, GRAPH);
  if (!fs.existsSync(graph)) return { built: false };

  let text = "";
  try { text = fs.readFileSync(report, "utf8"); } catch { /* rapport absent : on rend ce qu'on peut */ }
  const n = NUMBERS.exec(text);
  const c = COMMIT.exec(text);
  let at = 0;
  try { at = fs.statSync(graph).mtimeMs; } catch { /* ignoré */ }

  const commit = c ? c[1] : "";
  const now = head(dir);
  return {
    built: true,
    nodes: n ? int(n[1]) : 0,
    edges: n ? int(n[2]) : 0,
    communities: n ? int(n[3]) : 0,
    commit,
    at,
    // Même protocole que le hash de première ligne d'un KNOWLEDGE-GRAPH.md : le graphe
    // dit de quel commit il a été tiré, et c'est le dépôt qui dit s'il a bougé depuis.
    // Le rapport abrège le hash à huit caractères, d'où la comparaison par préfixe.
    // Un dépôt sans git ne peut pas être dit périmé : on ne le prétend pas.
    stale: Boolean(commit && now && !now.startsWith(commit)),
  };
}

// `git rev-parse HEAD` sans sous-processus : `state()` est appelée pour chaque projet
// à chaque `/api/state`, donc toutes les quelques secondes. Six `git` par tour pour
// afficher une pastille, ce serait payer cher un détail.
function head(dir) {
  try {
    return String(readHead(dir)).trim();
  } catch {
    return "";
  }
}

function readHead(dir) {
  const gitDir = path.join(dir, ".git");
  let base = gitDir;
  if (fs.statSync(gitDir).isFile()) {
    const m = /^gitdir:\s*(.+)$/m.exec(fs.readFileSync(gitDir, "utf8"));
    if (!m) return "";
    base = path.resolve(dir, m[1].trim());
  }
  const headFile = fs.readFileSync(path.join(base, "HEAD"), "utf8").trim();
  const ref = /^ref:\s*(.+)$/.exec(headFile);
  if (!ref) return headFile;
  const refFile = path.join(base, ref[1].trim());
  if (fs.existsSync(refFile)) return fs.readFileSync(refFile, "utf8").trim();
  const packed = fs.readFileSync(path.join(base, "packed-refs"), "utf8");
  const line = new RegExp(`^([0-9a-f]{40}) ${ref[1].trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m").exec(packed);
  return line ? line[1] : "";
}

/* ------------------------------------------------------------- la lecture */

// Le graphe lui-même, mis en forme pour la visionneuse. `state()` lit le rapport
// parce qu'elle tourne toutes les quatre secondes ; celle-ci lit le `graph.json`,
// qui peut peser plusieurs mégaoctets — elle n'est donc appelée qu'au clic, jamais
// dans la boucle de rafraîchissement.
//
// Au-delà de `limit` noeuds, on garde les plus connectés et on le DIT. Une force
// dirigée sur cinq mille noeuds ne donne pas un dessin, elle donne un nuage : mieux
// vaut trois cents noeuds qu'on peut lire et une phrase qui annonce la coupe.
export async function read(dir, { limit = 450 } = {}) {
  const raw = JSON.parse(await fsp.readFile(path.join(dir, OUT_DIR, GRAPH), "utf8"));

  const links = (raw.links || [])
    .map((l) => ({ s: l.source, t: l.target, rel: l.relation || "", origin: l.confidence || "" }))
    .filter((l) => l.s && l.t && l.s !== l.t);

  const deg = new Map();
  for (const l of links) {
    deg.set(l.s, (deg.get(l.s) || 0) + 1);
    deg.set(l.t, (deg.get(l.t) || 0) + 1);
  }

  const all = (raw.nodes || []).map((n) => ({
    id: n.id,
    label: n.label || n.id,
    file: n.source_file || "",
    loc: n.source_location || "",
    group: Number.isInteger(n.community) ? n.community : 0,
    deg: deg.get(n.id) || 0,
  }));

  const nodes = all.length > limit ? [...all].sort((a, b) => b.deg - a.deg).slice(0, limit) : all;
  const keep = new Set(nodes.map((n) => n.id));

  return {
    nodes,
    links: links.filter((l) => keep.has(l.s) && keep.has(l.t)),
    total: all.length,
    totalLinks: links.length,
    truncated: nodes.length < all.length,
    commit: raw.built_at_commit || "",
  };
}

/* --------------------------------------------------------------- l'exclusion */

// Le graphe est un artefact de construction, pas une pièce du dépôt. On l'exclut
// dans `.git/info/exclude` et NON dans `.gitignore` : le `.gitignore` appartient à
// l'utilisateur et part avec le dépôt s'il le publie. Une app de suivi n'a rien à
// écrire dans un fichier versionné.
export function exclude(dir) {
  const file = path.join(dir, ".git", "info", "exclude");
  try {
    if (!fs.existsSync(path.join(dir, ".git"))) return false;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
    if (text.split("\n").some((l) => l.trim() === `${OUT_DIR}/` || l.trim() === OUT_DIR)) return false;
    fs.appendFileSync(file, `${text && !text.endsWith("\n") ? "\n" : ""}${OUT_DIR}/\n`, "utf8");
    return true;
  } catch {
    return false;
  }
}

/* --------------------------------------------------------------- le pointeur */

// Un graphe que personne n'interroge ne vaut rien. Le `CLAUDE.md` du dépôt est le seul
// endroit qu'un Claude lit sans qu'on le lui demande : c'est donc là que va le mode
// d'emploi. Trois précautions, et la troisième est celle qui compte :
//   — le bloc est DÉLIMITÉ par deux marqueurs, donc reconnaissable et supprimable ;
//   — il est idempotent : présent, on le laisse tel quel, on ne le réécrit pas ;
//   — on n'enlève JAMAIS rien. Le CLAUDE.md appartient à l'utilisateur, et c'est la
//     même règle que pour son MILESTONES.md. On ajoute en fin de fichier, un point.
const MARK_OPEN = "<!-- pyra:graphify -->";
const MARK_CLOSE = "<!-- /pyra:graphify -->";
// Le marqueur portait l'ancien nom de l'app. On le reconnaît encore, sinon un
// dépôt qui a déjà le bloc s'en verrait greffer un second au nom d'après.
const MARK_WAS = "<!-- pyramis:graphify -->";

const BLOCK = `${MARK_OPEN}
## Knowledge graph

This repository has a Graphify knowledge graph in \`graphify-out/\`. Query it instead of
re-reading the whole codebase:

    graphify query "<question>" --budget 2000     # BFS traversal, cites the nodes
    graphify explain "<symbol>"                   # a node and its neighbours
    graphify affected "<symbol>"                  # what breaks if this changes
    graphify god-nodes                            # the architectural hubs

\`graphify-out/GRAPH_REPORT.md\` names the commit the graph was built from. If \`git rev-parse HEAD\`
has moved past it, run \`graphify update .\` first — it re-extracts the code locally, with no API call.
${MARK_CLOSE}`;

export function pointer(dir) {
  const file = path.join(dir, "CLAUDE.md");
  try {
    const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
    if (text.includes(MARK_OPEN) || text.includes(MARK_WAS)) return false;
    fs.writeFileSync(file, text ? `${text.replace(/\n*$/, "")}\n\n${BLOCK}\n` : `${BLOCK}\n`, "utf8");
    return true;
  } catch {
    return false;
  }
}

/* --------------------------------------------------------- la construction */

// Deux passes, et une seule raison de les séparer : `extract` écrit le graphe,
// `cluster-only` écrit le rapport lisible. `--no-label` sur la seconde est ce qui
// garde la construction gratuite — sans lui, Graphify appellerait un LLM pour
// nommer ses communautés. Elles restent donc « Community N », et c'est le prix
// assumé de la règle n° 1. `--no-viz` épargne un graph.html de plusieurs mégaoctets
// que personne n'ouvre depuis Pyra.
export async function build(dir, { signal } = {}) {
  const exe = bin();
  if (!exe) throw new Error("graphify not found — install it with: uv tool install graphifyy");
  if (!fs.existsSync(dir)) throw new Error("project folder not found");

  const opts = { cwd: dir, timeout: TIMEOUT, maxBuffer: 32 << 20, signal };
  // L'exclusion est posée AVANT la construction, pas après. `extract` crée le
  // `graphify-out/` puis peut échouer — un dépôt neuf sans code, par exemple, où il
  // ne trouve aucun nœud. Le dossier reste alors sur le disque ; posée seulement en
  // cas de succès, l'exclusion n'aurait pas eu lieu et l'utilisateur retrouverait un
  // artefact de construction dans son prochain `git add`.
  exclude(dir);
  try {
    await run(exe, ["extract", dir, "--code-only"], opts);
    await run(exe, ["cluster-only", dir, "--no-label", "--no-viz"], opts);
  } catch (e) {
    if (e.code === "ENOENT") throw new Error("graphify not found in PATH");
    if (e.killed) throw new Error("graphify ran past fifteen minutes");
    throw new Error(lastLines(e.stderr || e.stdout || e.message));
  }
  pointer(dir);
  return state(dir);
}

const lastLines = (s) =>
  String(s).trim().split("\n").filter(Boolean).slice(-3).join(" ").slice(0, 300) || "graphify failed";
