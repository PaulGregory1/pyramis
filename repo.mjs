// Copyright © 2026 Paul Gregory. Tous droits réservés.
// Ce que le dépôt d'un projet dit de lui-même : son README, ses langages, sa branche
// courante, et son histoire sous la forme que dessine un « git graph ».
//
// Deux règles, les mêmes que partout ailleurs dans l'app :
//
// 1. **Rien n'est stocké.** Chaque appel relit le dépôt. Ces routes ne sont demandées
//    qu'à l'ouverture d'un projet, pas dans la boucle de rafraîchissement des quatre
//    secondes — c'est ce qui autorise un `git log` et un `git status` ici.
// 2. **Tout est asynchrone.** Une lecture SYNCHRONE dans ~/Documents peut figer la
//    boucle Node entière le temps d'une demande TCC (voir CLAUDE.md). Aucun
//    `readFileSync` dans ce module.

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";

const TIMEOUT = 10_000;
const SEP = "\x1f"; // entre les champs d'un commit
const REC = "\x1e"; // entre deux commits

// Un git qui échoue n'est pas une panne : un dossier sans dépôt, une branche sans
// commit, un binaire absent. On rend null, l'appelant décide quoi dire.
const git = (dir, args) =>
  new Promise((ok) =>
    execFile("git", args, { cwd: dir, timeout: TIMEOUT, maxBuffer: 32 << 20 }, (err, stdout) =>
      ok(err ? null : String(stdout))
    )
  );

// Le dossier DOIT porter son propre `.git` — un fichier suffit (worktree, submodule).
// On ne remonte pas aux parents : un sous-dossier suivi comme projet afficherait
// alors l'histoire du dépôt qui le contient, ce qui n'est pas la sienne.
export const isRepo = (dir) => fs.existsSync(path.join(dir, ".git"));

/* --------------------------------------------------------------- l'histoire */

// `--all` pour voir les branches et pas seulement celle qui est sortie : c'est
// exactement ce qu'un « git graph » montre. `--date-order` garde les branches
// parallèles côte à côte plutôt que de les entrelacer par topologie pure.
export async function log(dir, { limit = 200 } = {}) {
  if (!isRepo(dir)) return { repo: false, branch: "", commits: [], width: 0, total: 0 };

  const fmt = ["%H", "%h", "%P", "%an", "%at", "%D", "%s"].join(SEP) + REC;
  const [raw, branch, count] = await Promise.all([
    git(dir, ["log", "--all", "--date-order", `--max-count=${limit}`, `--pretty=format:${fmt}`]),
    git(dir, ["rev-parse", "--abbrev-ref", "HEAD"]),
    git(dir, ["rev-list", "--all", "--count"]),
  ]);
  if (raw === null) return { repo: true, branch: "", commits: [], width: 0, total: 0 };

  const commits = raw
    .split(REC)
    .map((r) => r.trim())
    .filter(Boolean)
    .map((rec) => {
      const [hash, short, parents, author, at, refs, ...rest] = rec.split(SEP);
      return {
        hash, short, author,
        parents: parents ? parents.split(" ").filter(Boolean) : [],
        at: Number(at) * 1000,
        // « HEAD -> main, origin/main, tag: v1 » — on garde les noms, pas la syntaxe.
        // `origin/HEAD` n'est pas une branche, c'est un alias vers celle par défaut :
        // affiché, il double chaque étiquette du dépôt distant sans rien apprendre.
        refs: refs ? refs.split(", ").filter(Boolean).map((r) => r.replace(/^HEAD -> /, "")).filter((r) => r !== "origin/HEAD") : [],
        head: /(^|, )HEAD($| ->|,)/.test(refs || ""),
        subject: rest.join(SEP),
      };
    });

  const { rows, width } = lanes(commits);
  commits.forEach((c, i) => Object.assign(c, rows[i]));
  return {
    repo: true,
    branch: (branch || "").trim(),
    commits,
    width,
    total: Number((count || "0").trim()) || commits.length,
    truncated: commits.length >= limit,
  };
}

const freeLane = (active) => {
  const i = active.indexOf(null);
  return i < 0 ? active.length : i;
};

// L'affectation des voies, et c'est tout le dessin. On descend la liste en tenant un
// tableau des commits ATTENDUS voie par voie : un commit prend la voie qui l'attend,
// puis y installe son premier parent. Ses autres parents ouvrent (ou rejoignent) une
// voie à côté, et c'est ce qui donne la fourche d'une fusion.
//
// Une voie ne se déplace JAMAIS d'un rang à l'autre : c'est ce qui permet de dessiner
// une ligne qui passe comme un simple trait vertical, et une ligne qui bifurque comme
// une courbe entre deux abscisses connues.
//
// Un parent hors de la fenêtre chargée (l'histoire est coupée à `limit`) n'ouvre pas
// de voie : la ligne s'arrête au commit. Le prétendre encore vivant dessinerait un
// trait qui descend jusqu'au bas de l'écran sans jamais rencontrer son commit.
export function lanes(commits) {
  const known = new Set(commits.map((c) => c.hash));
  const active = []; // voie -> hash du commit attendu, ou null
  const rows = [];
  let width = 0;

  for (const c of commits) {
    const before = active.slice();

    let my = active.indexOf(c.hash);
    if (my < 0) { my = freeLane(active); active[my] = c.hash; }

    // Toutes les voies qui attendaient ce commit se rabattent sur la sienne : c'est
    // le cas d'un commit qui a plusieurs enfants (le point de départ d'une branche).
    const ins = [];
    for (let l = 0; l < before.length; l++) {
      if (before[l] !== c.hash) continue;
      ins.push(l);
      if (l !== my) active[l] = null;
    }

    const through = [];
    for (let l = 0; l < before.length; l++) {
      if (before[l] && before[l] !== c.hash) through.push(l);
    }

    active[my] = null;
    const outs = [];
    for (const p of c.parents) {
      if (!known.has(p)) continue;
      let l = active.indexOf(p);
      // Le premier parent hérite de la voie du commit : sans ça, une histoire
      // linéaire zigzaguerait d'une voie à l'autre à chaque rang.
      if (l < 0) { l = active[my] === null ? my : freeLane(active); active[l] = p; }
      outs.push(l);
    }

    while (active.length && active[active.length - 1] === null) active.pop();
    width = Math.max(width, before.length, active.length, my + 1);
    rows.push({ lane: my, ins, outs, through });
  }

  return { rows, width };
}

/* ---------------------------------------------------------------- l'aperçu */

// Ce qu'on montre en haut de la page d'un projet. Aucune de ces trois lectures n'est
// indispensable : chacune peut échouer sans que l'aperçu disparaisse.
export async function overview(dir) {
  const [blurb, head, langs] = await Promise.all([readme(dir), gitHead(dir), languages(dir)]);
  return { blurb, git: head, langs };
}

async function gitHead(dir) {
  if (!isRepo(dir)) return null;
  const fmt = ["%h", "%an", "%at", "%s"].join(SEP);
  const [raw, branch, status, count] = await Promise.all([
    git(dir, ["log", "-1", `--pretty=format:${fmt}`]),
    git(dir, ["rev-parse", "--abbrev-ref", "HEAD"]),
    git(dir, ["status", "--porcelain"]),
    git(dir, ["rev-list", "--all", "--count"]),
  ]);
  const [short, author, at, ...rest] = String(raw || "").split(SEP);
  return {
    branch: (branch || "").trim(),
    commits: Number((count || "0").trim()) || 0,
    // Un dépôt sans commit rend une chaîne vide : pas de dernier commit à montrer.
    last: raw ? { short, author, at: Number(at) * 1000, subject: rest.join(SEP) } : null,
    dirty: status === null ? 0 : status.split("\n").filter((l) => l.trim()).length,
  };
}

// Le README, débarrassé de tout ce qui n'est pas de la PROSE. Un README d'aujourd'hui
// s'ouvre sur un bloc HTML centré, un logo, deux rangées de badges et un tableau des
// versions : tout cela se lit très bien sur GitHub et n'a aucun sens dans les trois
// lignes d'un aperçu. Laissé passer, ça donnait exactement ce qu'on voyait à l'écran —
// un `<img src="public/logo.svg" width="88">` posé au milieu de la page comme une phrase.
//
// Le nettoyage se fait en DEUX temps, et les deux comptent :
//
//   1. `declutter()` retire le balisage — commentaires, blocs de code, balises HTML,
//      images, liens, titres, entités.
//   2. `isProse()` JETTE ensuite les paragraphes qui n'ont jamais été des phrases —
//      une ligne de tableau, une liste à puces, une suite de commandes. Sans ce
//      second temps, une balise disparaissait mais la rangée de badges qu'elle
//      contenait restait, et l'aperçu montrait toujours du code.
const NAMES = ["README.md", "readme.md", "README.MD", "Readme.md", "README.txt", "README"];

// Les seules entités qu'un README écrit vraiment à la main. Tout le reste devient une
// espace : mieux vaut un blanc qu'un `&#x1F600;` au milieu d'une phrase.
const ENTITIES = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'", mdash: "—", ndash: "–", hellip: "…" };

function declutter(text) {
  return text
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/~~~[\s\S]*?~~~/g, "")
    // Ces blocs-là partent avec leur CONTENU : ce qu'ils portent — une rangée de
    // badges, un tableau de versions, un SVG — ne se lit pas davantage que la balise.
    .replace(/<(script|style|svg|picture|table|video|iframe|pre|code)\b[\s\S]*?<\/\1>/gi, " ")
    // Les balises qui restent, ouvrantes, fermantes ou autofermantes. La borne de 400
    // caractères est là pour qu'un `<` isolé dans une phrase n'avale pas la suite.
    .replace(/<\/?[a-z][^>]{0,400}>/gi, "")
    .replace(/&([a-z]+|#\d+);/gi, (m, e) => ENTITIES[e.toLowerCase()] ?? " ")
    .replace(/^\s*\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)\s*$/gm, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\[[^\]]*\]/g, "$1")     // lien par référence
    .replace(/^\s*\[[^\]]+\]:\s*\S+.*$/gm, "")    // et sa définition, en bas de page
    .replace(/^#{1,6}\s+.*$/gm, "")
    .replace(/^\s*[-*=_]{3,}\s*$/gm, "")
    .replace(/[`*_]/g, "");
}

// Un paragraphe est de la prose s'il ressemble à une phrase écrite pour être lue. Les
// refus sont chacun une chose qu'on a vue s'afficher : un bloc de code indenté de quatre
// espaces, une ligne de tableau, une balise oubliée, une liste à puces aplatie en
// « - a - b - c », une invite de shell. Le dernier test — la part de lettres — attrape
// le reste : une ligne de commandes ou une suite de chemins n'atteint jamais les
// deux tiers. Il prend le paragraphe BRUT, indentation comprise : c'est elle qui
// distingue un bloc de code d'une phrase, et la collecte des blancs l'efface.
const isProse = (raw) => {
  if (/^(?:\t| {4})/.test(raw)) return false;
  const p = raw.replace(/\s+/g, " ").trim();
  return p.length > 24 &&
    /[a-zà-ÿ]{3}/i.test(p) &&
    !/^[|<[]/.test(p) &&
    !/^(?:[-*+•]|\d+[.)])\s/.test(p) &&
    !/^[$>]/.test(p) &&
    (p.match(/[a-zà-ÿ' ]/gi) || []).length / p.length > 0.62;
};

export async function readme(dir) {
  for (const name of NAMES) {
    let text;
    try { text = await fsp.readFile(path.join(dir, name), "utf8"); } catch { continue; }
    text = text.slice(0, 8000);
    // Le titre : le `#` du markdown, ou le `<h1>` de ceux qui ouvrent en HTML. Il passe
    // par le même nettoyage que le reste — un titre porte souvent le logo du projet.
    const h1 = (/^#\s+(.+)$/m.exec(text) || [])[1] || (/<h1[^>]*>([\s\S]{0,200}?)<\/h1>/i.exec(text) || [])[1] || "";
    const title = declutter(h1).replace(/\s+/g, " ").trim();
    const paras = declutter(text).split(/\n[ \t]*\n/).filter(isProse).map((p) => p.replace(/\s+/g, " ").trim());
    const full = paras.slice(0, 2).join("\n\n");
    // La coupe se voit : sans les points de suspension, un aperçu tronqué se lit comme
    // une phrase que l'auteur aurait laissée en plan.
    const shown = full.length > 460 ? full.slice(0, 460).replace(/\s+\S*$/, "") + " …" : full;
    return { file: name, title, text: shown };
  }
  return null;
}

const LANGS = {
  ".js": "JavaScript", ".mjs": "JavaScript", ".cjs": "JavaScript", ".jsx": "JavaScript",
  ".ts": "TypeScript", ".tsx": "TypeScript", ".py": "Python", ".ipynb": "Notebooks",
  ".md": "Markdown", ".css": "CSS", ".html": "HTML", ".json": "JSON", ".yml": "YAML",
  ".yaml": "YAML", ".toml": "TOML", ".sh": "Shell", ".rs": "Rust", ".go": "Go",
  ".java": "Java", ".c": "C", ".h": "C", ".cpp": "C++", ".hpp": "C++", ".swift": "Swift",
  ".kt": "Kotlin", ".rb": "Ruby", ".php": "PHP", ".sql": "SQL", ".tex": "TeX", ".qasm": "OpenQASM",
};
const SKIP = new Set(["node_modules", ".git", "dist", "build", "venv", ".venv", "__pycache__", "graphify-out", ".next", "target"]);
const WALK_MAX = 6000;

// `git ls-files` d'abord : c'est la liste que le dépôt reconnaît, sans node_modules
// ni artefacts. Hors dépôt, on marche à la main, borné — un dossier de données peut
// contenir des dizaines de milliers de fichiers, et personne n'attend un aperçu.
export async function languages(dir) {
  let files = null;
  if (isRepo(dir)) {
    const out = await git(dir, ["ls-files"]);
    if (out !== null) files = out.split("\n").filter(Boolean);
  }
  if (!files) files = await walk(dir);

  const count = new Map();
  for (const f of files) {
    const lang = LANGS[path.extname(f).toLowerCase()];
    if (lang) count.set(lang, (count.get(lang) || 0) + 1);
  }
  return {
    files: files.length,
    top: [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([name, n]) => ({ name, n })),
  };
}

async function walk(dir) {
  const found = [];
  const queue = [dir];
  while (queue.length && found.length < WALK_MAX) {
    let entries;
    try { entries = await fsp.readdir(queue.shift(), { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (e.name.startsWith(".") || SKIP.has(e.name)) continue;
      const full = path.join(e.parentPath || e.path, e.name);
      if (e.isDirectory()) queue.push(full);
      else if (e.isFile()) found.push(full);
    }
  }
  return found;
}
