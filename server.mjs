// Copyright © 2026 Paul Gregory. Tous droits réservés.
// Serveur local (127.0.0.1) : sert l'UI, tient le registre des projets, lit et écrit
// les MILESTONES.md dans les dépôts, expose les sessions Claude vivantes de la machine,
// et relaie les pseudo-terminaux en WebSocket.
//
// Aucune base de données. La vérité vit dans les dépôts (MILESTONES.md) et dans
// Claude Code lui-même (`claude agents --json`). L'app n'est qu'une vue.

import http from "node:http";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import * as M from "./milestones.mjs";
import { createTerminals, claudeBin } from "./terminals.mjs";
import { propose } from "./generate.mjs";
import * as G from "./graph.mjs";
import * as R from "./repo.mjs";
import * as F from "./forge.mjs";
import * as S from "./settings.mjs";

const __dir = path.dirname(fileURLToPath(import.meta.url));
const HOME = os.homedir();
const PORT = Number(process.env.PORT || 4331);
const PUBLIC = path.join(__dir, "public");
const REGISTRY = registryPath();

// Le registre vit HORS du code. Deux raisons, dont une seule est négociable :
// une app empaquetée est un bundle SIGNÉ, et y écrire invalide la signature —
// sur Apple Silicon, l'app ne redémarre plus. L'autre est qu'un registre à côté
// du dépôt suivrait un `git clean` ou une réinstallation.
// Un seul chemin pour les deux façons de lancer (`npm start` et Pyra.app) :
// deux registres donneraient deux listes de projets sans que rien ne le dise.
function registryPath() {
  if (process.env.PYRA_REGISTRY) return process.env.PYRA_REGISTRY;
  const dir = process.platform === "darwin"
    ? path.join(HOME, "Library", "Application Support", "Pyra")
    : path.join(process.env.XDG_CONFIG_HOME || path.join(HOME, ".config"), "pyra");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "projects.json");
  // Reprise d'un ancien emplacement, une fois. On COPIE : l'original reste où il
  // est, comme tout fichier de l'utilisateur, mais il n'est plus lu. Le dossier
  // « Pyramis » passe en premier — c'est le nom d'avant, et le plus récent des
  // deux ; sans cette reprise, le changement de nom viderait la liste de projets.
  const legacy = [
    process.platform === "darwin"
      ? path.join(HOME, "Library", "Application Support", "Pyramis", "projects.json")
      : path.join(process.env.XDG_CONFIG_HOME || path.join(HOME, ".config"), "pyramis", "projects.json"),
    path.join(__dir, "projects.json"),
  ].find((p) => fs.existsSync(p));
  if (!fs.existsSync(file) && legacy) {
    fs.copyFileSync(legacy, file);
    console.log(`registry: repris depuis ${legacy} — c'est désormais ${file} qui fait foi`);
  }
  return file;
}
// Les réglages logent à côté du registre, et pour la même raison : un bundle signé ne
// peut pas écrire chez lui. Un seul dossier pour les deux, sinon `PYRA_REGISTRY`
// déplacerait la liste des projets en laissant les réglages derrière.
S.init(path.join(path.dirname(REGISTRY), "settings.json"));

const XTERM = path.join(__dir, "node_modules", "@xterm");

// Exporté pour la coquille Electron : c'est le seul objet du serveur qui survive à
// la fermeture de la fenêtre, et donc le seul dont le ⌘Q doive s'occuper. Le
// serveur, lui, s'arrête avec le process.
export const terminals = createTerminals();

/* ---------------------------------------------------------------- registre */

// Les six projets que Paul suit réellement. Le registre est un simple JSON éditable
// à la main : si l'app se plante, on répare avec un éditeur de texte.
const SEED = [
  { emoji: "🔐", name: "Enhanced circuit", dir: "Documents/ecdsafail-challenge" },
  { emoji: "🇸🇬", name: "Singapour", dir: "Documents/carnet-singapour" },
  { emoji: "🏴‍☠️", name: "Skull King", dir: "Documents/Site-de-cartes" },
  { emoji: "🎓", name: "PDM", dir: "Documents/PDM" },
  { emoji: "♟️", name: "Chess hackathon", dir: "Documents/aichessathon" },
  { emoji: "📈", name: "SoAI hackathon", dir: "Documents/soc-ai-trading" },
];

function loadRegistry() {
  if (fs.existsSync(REGISTRY)) {
    try { return JSON.parse(fs.readFileSync(REGISTRY, "utf8")); } catch { /* on reseed */ }
  }
  const projects = SEED
    .filter((s) => fs.existsSync(path.join(HOME, s.dir)))
    .map((s, i) => ({ id: crypto.randomBytes(4).toString("hex"), name: s.name, emoji: s.emoji, path: path.join(HOME, s.dir), order: i }));
  saveRegistry(projects);
  return projects;
}

function saveRegistry(projects) {
  const tmp = REGISTRY + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(projects, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, REGISTRY);
}

let projects = loadRegistry();
const byId = (id) => projects.find((p) => p.id === id);

/* ------------------------------------------------- sessions Claude vivantes */

// `claude agents --json` liste TOUTES les sessions de la machine, background et
// interactives, y compris celles ouvertes dans un vrai terminal hors de l'app.
// C'est pour ça qu'on l'interroge plutôt que de tenir notre propre compte : sinon
// l'app ne verrait que son propre nombril.
let agentsCache = { at: 0, list: [], error: null };
const AGENTS_TTL = 3000;

// Trois pannes différentes, trois phrases différentes. « unknown option » ne veut pas
// dire que l'option n'existe pas : elle veut dire qu'on parle à un binaire trop vieux,
// et c'est ça qu'il faut lire dans l'interface — sinon on cherche le bug dans Pyra.
function agentsError(err, stderr) {
  if (err.code === "ENOENT") return "claude introuvable dans le PATH";
  if (/unknown option/.test(String(stderr || "") + String(err.message || "")))
    return `claude trop ancien (${claudeBin()}) — mettre à jour`;
  return String(err.message || err);
}

function readAgents() {
  if (Date.now() - agentsCache.at < AGENTS_TTL) return Promise.resolve(agentsCache);
  return new Promise((resolve) => {
    execFile(claudeBin(), ["agents", "--json"], { timeout: 8000, maxBuffer: 4 << 20 }, (err, stdout, stderr) => {
      if (err) agentsCache = { at: Date.now(), list: agentsCache.list, error: agentsError(err, stderr) };
      else {
        try { agentsCache = { at: Date.now(), list: JSON.parse(stdout), error: null }; }
        catch (e) { agentsCache = { at: Date.now(), list: [], error: "unreadable JSON output" }; }
      }
      resolve(agentsCache);
    });
  });
}

// Une session appartient au projet dont le chemin la contient. Le plus long chemin
// gagne : une session dans PDM/qcbm-ring doit aller à qcbm-ring, pas à PDM.
function ownerOf(cwd) {
  let best = null;
  for (const p of projects) {
    if (cwd === p.path || cwd.startsWith(p.path + path.sep)) {
      if (!best || p.path.length > best.path.length) best = p;
    }
  }
  return best;
}

/* --------------------------------------------------- génération des étapes */

// Une génération par projet, jamais deux. L'appel dure une à trois minutes : on ne
// fait pas attendre la requête HTTP, on note l'état ici et l'interface le lit au
// rafraîchissement suivant. C'est le seul état propre à l'app avec les terminaux —
// il meurt avec le process, et rien ne s'en trouve perdu : le résultat, lui, est
// déjà dans le MILESTONES.md du dépôt.
const gens = new Map(); // projectId -> { running, startedAt, endedAt, added, error }

function startGeneration(proj) {
  const running = gens.get(proj.id);
  if (running?.running) return running;

  const job = { running: true, startedAt: Date.now(), endedAt: 0, added: 0, error: null };
  gens.set(proj.id, job);

  (async () => {
    const before = M.read(proj.path, proj.name);
    // Le provider et le modèle viennent des réglages, pas d'une constante : c'est le
    // seul endroit du serveur qui décide à quel binaire on parle pour générer.
    const set = S.read();
    const proposal = await propose({
      project: proj,
      items: M.items(before.blocks),
      bin: claudeBin(),
      model: set.model || process.env.PYRA_MODEL || "",
    });
    // On RELIT le fichier après l'appel. Deux minutes ont passé : l'utilisateur a pu
    // cocher une étape, un Claude du projet a pu écrire dedans. Greffer sur la version
    // d'avant leur passerait dessus.
    const after = M.read(proj.path, proj.name);
    const { blocks, added } = M.graft(after.blocks, proposal);
    M.write(after.file, blocks);
    if (after.legacy && fs.existsSync(after.legacy)) fs.rmSync(after.legacy);
    job.added = added;
    if (added) autoSync(proj, "Milestones — generated");
  })()
    .catch((e) => { job.error = String(e.message || e).slice(0, 300); })
    .finally(() => { job.running = false; job.endedAt = Date.now(); });

  return job;
}

/* ---------------------------------------------------- graphe de connaissance */

// Même forme que `gens`, et pour la même raison : la construction dure de deux
// secondes à quelques minutes selon la taille du dépôt, on ne fait pas attendre la
// requête HTTP. La différence tient en une ligne — celle-ci ne coûte pas un token.
const graphs = new Map(); // projectId -> { running, startedAt, endedAt, error }

function startGraph(proj) {
  const running = graphs.get(proj.id);
  if (running?.running) return running;

  const job = { running: true, startedAt: Date.now(), endedAt: 0, error: null };
  graphs.set(proj.id, job);

  G.build(proj.path)
    // La construction greffe un bloc dans le `CLAUDE.md` du dépôt : c'est un fichier
    // que Pyra écrit, donc il entre dans la synchro — pour les projets qui l'ont
    // demandée, et eux seuls. Le `graphify-out/`, lui, ne sera jamais commité : il
    // est exclu via `.git/info/exclude`.
    .then(() => autoSync(proj, "Knowledge graph"))
    .catch((e) => { job.error = String(e.message || e).slice(0, 300); })
    .finally(() => { job.running = false; job.endedAt = Date.now(); });

  return job;
}

/* ---------------------------------------------------- créer un projet de zéro */

// Deux chemins d'entrée, et ils ne font PAS la même chose. Ajouter un dossier déjà
// présent sur la machine l'inscrit au registre, point : il a son histoire, son
// `CLAUDE.md`, ses commits en cours, et rien de ce que l'app sait faire ne doit lui
// tomber dessus sans qu'on le demande. Créer un projet de zéro, au contraire, part
// d'un dossier vide que l'app vient de faire naître : là, tout ce qui est réglé se
// déclenche, puisqu'il n'y a rien à abîmer.
//
// Le travail est mené en TÂCHE DE FOND et son avancement se lit dans `/api/state`,
// comme la génération et le graphe. `gh repo create` parle au réseau : tenir la
// requête HTTP ouverte pendant ce temps ferait une interface figée sur un clic.
const forges = new Map(); // projectId -> { running, steps: [...], error }

function startForge(proj, opts) {
  const job = { running: true, startedAt: Date.now(), endedAt: 0, steps: [], error: null };
  forges.set(proj.id, job);

  // Chaque geste est noté avec son résultat : l'interface montre la liste, et un
  // échec au milieu n'efface pas ce qui a réussi avant lui. Un dépôt distant qui
  // rate laisse un dossier, un dépôt git local et des commits — tout ce qui précède
  // reste acquis, et le bouton de synchro finira le travail plus tard.
  const step = async (name, fn) => {
    const s = { name, ok: false, error: "", note: "" };
    job.steps.push(s);
    try {
      const r = await fn();
      s.ok = r?.ok !== false;
      if (r?.error) s.error = r.error;
      if (r?.note) s.note = r.note;
    } catch (e) {
      s.error = String(e.message || e).slice(0, 300);
    }
    return s.ok;
  };

  (async () => {
    const dir = proj.path;
    if (opts.git) {
      const ok = await step("git init", () => F.init(dir, { branch: opts.branch }));
      if (ok) await step("first commit", () => F.firstCommit(dir));
      if (ok && opts.remote) {
        await step("GitHub repository", async () => {
          const r = await F.createRemote(dir, { name: proj.name, visibility: opts.visibility });
          return { ...r, note: r.url || "" };
        });
      }
    }
    // Le graphe passe APRÈS le premier commit : `exclude()` écrit dans
    // `.git/info/exclude`, qui n'existe pas tant que `git init` n'a pas eu lieu.
    // Construit avant, le `graphify-out/` se retrouverait dans le premier commit.
    if (opts.graph) {
      await step("knowledge graph", async () => {
        if (!G.available()) return { ok: false, error: "graphify not installed — run: uv tool install graphifyy" };
        try {
          await G.build(dir);
          return { ok: true };
        } catch (e) {
          // Un projet qui vient de naître n'a que son README : `extract --code-only`
          // n'y trouve AUCUN nœud et Graphify le dit comme une erreur. Ici c'en est
          // une seulement en apparence — il n'y a pas encore de code, voilà tout.
          // Le peindre en rouge apprendrait à l'utilisateur que la création rate
          // toujours à moitié, et il cesserait de lire la liste.
          if (/graph is empty|no nodes/i.test(String(e.message || e))) {
            return { ok: true, note: "no code yet — build it from the project page once there is some" };
          }
          throw e;
        }
      });
    }
    // Le bloc greffé dans le `CLAUDE.md` et le `MILESTONES.md` de départ sont nés
    // après le premier commit : on les y ajoute, sinon le dépôt distant montrerait
    // un dossier à moitié rempli.
    if (opts.git && opts.sync) {
      await step("push", () => F.sync(dir, { message: "Project scaffolding", push: opts.remote }));
    }
  })()
    .catch((e) => { job.error = String(e.message || e).slice(0, 300); })
    .finally(() => { job.running = false; job.endedAt = Date.now(); });

  return job;
}

/* ------------------------------------------------------------- synchro git */

// Appelée après chaque écriture de Pyra dans un dépôt. Elle ne fait rien du tout si
// le projet ne l'a pas demandée — c'est un drapeau posé à la CRÉATION, pas un réglage
// global : un projet ajouté depuis la machine ne doit jamais voir l'app commiter chez
// lui. Et elle ne bloque pas l'appelant : l'enregistrement d'une étape ne peut pas
// dépendre de l'état du réseau.
function autoSync(proj, message) {
  if (!proj.auto?.sync) return;
  F.sync(proj.path, { message })
    .then((r) => { syncs.set(proj.id, { at: Date.now(), ...r }); })
    .catch((e) => { syncs.set(proj.id, { at: Date.now(), ok: false, error: String(e.message || e).slice(0, 200) }); });
}

const syncs = new Map(); // projectId -> dernier résultat de synchro

/* ------------------------------------------------------------------- état */

// Ce que le client voit d'une étape. `depth` et `parentId` portent la hiérarchie :
// milestone (depth 0) dans la vue d'ensemble, étapes (depth 1) au clic sur le projet.
const pick = ({ id, depth, parentId, status, title, detail, due, done }) =>
  ({ id, depth, parentId, status, title, detail, due, done });

async function buildState() {
  const agents = await readAgents();
  const terms = terminals.list();
  const out = [];

  // Un terminal ouvert ici lance `exec claude` : le pty EST le processus claude, donc
  // il ressort aussi de `claude agents --json`. Sans ce rapprochement par pid, chaque
  // panneau maison compterait double dans la barre latérale.
  const ownPids = new Map(terms.filter((t) => t.alive).map((t) => [t.pid, t]));

  for (const p of [...projects].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))) {
    const exists = fs.existsSync(p.path);
    let list = [], file = path.join(p.path, M.FILENAME), hasFile = false;
    if (exists) {
      const r = M.read(p.path, p.name);
      file = r.file; hasFile = r.exists;
      list = M.items(r.blocks).map(pick);
    }
    // La vue d'ensemble ne compte QUE les milestones. Un projet qui découpe finement ses
    // étapes paraîtrait sinon à la traîne d'un projet qui n'en note aucune.
    const mains = list.filter((m) => !m.parentId);
    const mine = terms.filter((t) => t.projectId === p.id);
    out.push({
      ...p, exists, file, hasFile,
      steps: list,
      stats: M.stats(list),
      mainStats: M.stats(mains),
      gen: gens.get(p.id) || null,
      // Relu du GRAPH_REPORT.md du dépôt à chaque tour : l'app n'a pas de copie de
      // cet état, et un graphe construit à la main hors de Pyra se voit donc aussi.
      graph: exists ? { ...G.state(p.path), job: graphs.get(p.id) || null } : null,
      // Deux états tenus EN MÉMOIRE, donc gratuits : l'installation d'un projet qu'on
      // vient de créer, et le résultat de la dernière synchro. Aucun sous-processus
      // ici — la règle des quatre secondes vaut aussi pour git.
      forge: forges.get(p.id) || null,
      sync: syncs.get(p.id) || null,
      // `here` = ce que la barre latérale affiche sous le projet : les panneaux de
      // Pyra d'abord, puis les sessions ouvertes ailleurs sur la machine.
      sessions: agents.list
        .filter((a) => ownerOf(a.cwd || "") === p && !ownPids.has(a.pid))
        .map((a) => ({ ...a, external: true })),
      terminals: mine,
    });
  }

  return {
    projects: out,
    orphanSessions: agents.list.filter((a) => !ownerOf(a.cwd || "")),
    agentsError: agents.error,
    // L'interface doit pouvoir dire « installe-le » plutôt que d'échouer en silence
    // sur chaque projet ajouté.
    graphify: G.available(),
    // Un objet gardé en mémoire : le relire ici ne coûte rien, et l'interface a
    // besoin des réglages à chaque rendu (le bouton « New project » n'existe que
    // s'il y a de quoi le nourrir).
    settings: S.read(),
    liveCount: agents.list.length,
    now: Date.now(),
  };
}

/* ------------------------------------------------------------------ http */

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".map": "application/json", ".svg": "image/svg+xml", ".png": "image/png" };

const json = (res, code, body) => {
  const b = Buffer.from(JSON.stringify(body));
  res.writeHead(code, { "content-type": "application/json; charset=utf-8", "content-length": b.length });
  res.end(b);
};

async function readBody(req) {
  const chunks = [];
  for await (const c of req) {
    chunks.push(c);
    if (chunks.reduce((n, x) => n + x.length, 0) > 8 << 20) throw new Error("body too large");
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function serveFile(res, file) {
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404).end("not found"); return; }
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream", "cache-control": "no-cache" });
    res.end(buf);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  const p = url.pathname;
  try {
    if (req.method === "GET" && (p === "/" || p === "/index.html")) return serveFile(res, path.join(PUBLIC, "index.html"));
    if (req.method === "GET" && /^\/(app\.js|style\.css)$/.test(p)) return serveFile(res, path.join(PUBLIC, p.slice(1)));
    if (req.method === "GET" && /^\/brand\/[a-z0-9-]+\.(png|svg)$/.test(p)) return serveFile(res, path.join(PUBLIC, p.slice(1)));
    if (req.method === "GET" && p === "/vendor/xterm.js") return serveFile(res, path.join(XTERM, "xterm/lib/xterm.js"));
    if (req.method === "GET" && p === "/vendor/xterm.css") return serveFile(res, path.join(XTERM, "xterm/css/xterm.css"));
    if (req.method === "GET" && p === "/vendor/addon-fit.js") return serveFile(res, path.join(XTERM, "addon-fit/lib/addon-fit.js"));

    if (req.method === "GET" && p === "/api/state") return json(res, 200, await buildState());

    if (req.method === "GET" && p === "/api/browse") {
      const dir = path.resolve(url.searchParams.get("dir") || path.join(HOME, "Documents"));
      if (!dir.startsWith(HOME)) return json(res, 400, { error: "outside the home folder" });
      const entries = await fsp.readdir(dir, { withFileTypes: true });
      const known = new Set(projects.map((x) => x.path));
      return json(res, 200, {
        dir,
        parent: dir === HOME ? null : path.dirname(dir),
        dirs: entries
          .filter((e) => e.isDirectory() && !e.name.startsWith("."))
          .map((e) => ({ name: e.name, path: path.join(dir, e.name), known: known.has(path.join(dir, e.name)) }))
          .sort((a, b) => a.name.localeCompare(b.name, "fr")),
      });
    }

    if (req.method === "POST" && p === "/api/projects") {
      const b = await readBody(req);
      const target = path.resolve(b.path || "");
      if (!target.startsWith(HOME) || !fs.existsSync(target)) return json(res, 400, { error: "invalid folder" });
      if (projects.some((x) => x.path === target)) return json(res, 409, { error: "project already tracked" });
      const proj = { id: crypto.randomBytes(4).toString("hex"), name: (b.name || path.basename(target)).slice(0, 60), emoji: (b.emoji || "📁").slice(0, 8), path: target, order: projects.length };
      projects.push(proj); saveRegistry(projects);
      // Et c'est TOUT. Un dossier déjà présent sur la machine est inscrit au registre,
      // rien de plus. L'app a construit un graphe d'office ici pendant un temps ; c'est
      // fini, parce que ce dépôt-là existait avant elle : il a son histoire, son
      // `CLAUDE.md` et peut-être un travail en cours, et un geste non demandé sur un
      // dépôt qu'on n'a pas fabriqué est une intrusion, fût-il gratuit. Le bouton
      // `◈ Build graph` de la page du projet reste la voie — c'est un clic.
      // Les automatismes vivent sur l'AUTRE chemin : `POST /api/projects/new`.
      // `b.graph === true` laisse malgré tout la porte ouverte à un appel qui le
      // demande explicitement — le chemin « créer », et rien d'autre aujourd'hui.
      if (b.graph === true && G.available()) startGraph(proj);
      return json(res, 200, proj);
    }

    // L'autre chemin : un projet qui n'existe pas encore. On fabrique le dossier, on
    // l'inscrit, et le reste (git, dépôt distant, graphe, synchro) part en tâche de
    // fond selon les réglages. La réponse ne l'attend pas.
    if (req.method === "POST" && p === "/api/projects/new") {
      const b = await readBody(req);
      const set = S.read();

      const name = String(b.name || "").trim().slice(0, 60);
      if (!name) return json(res, 400, { error: "a project needs a name" });

      // Le dossier parent est choisi par l'utilisateur dans le même navigateur de
      // dossiers que « Track a project », et il est validé de la même façon : sous
      // HOME, et existant. Le nom, lui, est nettoyé — un « ../ » dans un nom de
      // projet ne doit pas décider d'où le dossier atterrit.
      const parent = path.resolve(b.parent || path.join(HOME, "Documents"));
      if (!parent.startsWith(HOME) || !fs.existsSync(parent)) return json(res, 400, { error: "invalid parent folder" });
      const folder = F.folderName(b.folder || name);
      if (!folder) return json(res, 400, { error: "invalid folder name" });
      const target = path.join(parent, folder);
      if (path.dirname(target) !== parent) return json(res, 400, { error: "invalid folder name" });

      // On ne crée jamais par-dessus quelque chose. Un dossier qui existe déjà se
      // suit avec « Track a project » — ici, l'app est censée partir de rien, et
      // écraser serait exactement ce que les règles du projet interdisent.
      if (fs.existsSync(target)) return json(res, 409, { error: "that folder already exists — use “Track a project” instead" });
      if (projects.some((x) => x.path === target)) return json(res, 409, { error: "project already tracked" });

      // Les réglages donnent les défauts ; le formulaire peut les contredire pour ce
      // projet-ci seulement, sans rien réécrire dans `settings.json`.
      const want = (k) => (typeof b[k] === "boolean" ? b[k] : set.create[k]);
      const opts = {
        git: want("git"),
        remote: want("git") && want("remote"),
        graph: want("graph"),
        milestones: want("milestones"),
        generate: want("generate"),
        sync: want("git") && want("sync"),
        visibility: set.github.visibility,
        branch: set.github.defaultBranch,
      };

      await F.scaffold(target, { name, milestones: opts.milestones });

      const proj = {
        id: crypto.randomBytes(4).toString("hex"),
        name, emoji: (b.emoji || "🌱").slice(0, 8), path: target, order: projects.length,
        // La marque qui distingue les deux chemins pour toujours. C'est elle, et non un
        // réglage global, qui autorise l'app à commiter dans ce dépôt : le projet est né
        // ici, la synchro fait partie de ce qu'on a demandé en le créant. Un projet
        // ajouté depuis la machine n'a pas ce drapeau et n'en recevra jamais un sans
        // que l'utilisateur le pose lui-même.
        created: true,
        auto: { sync: opts.sync },
      };
      projects.push(proj); saveRegistry(projects);

      startForge(proj, opts);
      // La génération par le modèle est le seul geste payant de la liste, et elle est
      // décochée par défaut. Elle part après le reste : sur un dépôt qui vient de
      // naître, elle n'a de toute façon presque rien à lire.
      if (opts.generate) startGeneration(proj);

      return json(res, 202, proj);
    }

    /* ------------------------------------------------------------- réglages */

    if (p === "/api/settings") {
      if (req.method === "GET") return json(res, 200, { settings: S.read(), providers: S.PROVIDERS });
      if (req.method === "PUT") {
        const b = await readBody(req);
        // Changer de provider invalide la version affichée : c'est un autre binaire.
        if (b.provider && b.provider !== S.read().provider) S.forgetStatus();
        return json(res, 200, { settings: S.write(b), providers: S.PROVIDERS });
      }
    }

    // L'état des connexions, demandé à l'ouverture du panneau. Deux sous-processus,
    // donc JAMAIS dans `/api/state` : cette route-ci est appelée sur un clic, pas
    // quatre fois par minute pour six projets.
    if (req.method === "GET" && p === "/api/connections") {
      const set = S.read();
      const status = await S.status(set.provider, (pv) => (pv.cli === "claude" ? claudeBin() : null), (bin, args) =>
        new Promise((ok, ko) => execFile(bin, args, { timeout: 10_000 }, (e, out) => (e ? ko(e) : ok(out))))
      );
      return json(res, 200, { provider: status, github: await F.github() });
    }

    const projMatch = /^\/api\/projects\/([a-f0-9]+)$/.exec(p);
    if (projMatch) {
      const proj = byId(projMatch[1]);
      if (!proj) return json(res, 404, { error: "unknown project" });
      if (req.method === "PATCH") {
        const b = await readBody(req);
        if (typeof b.name === "string") proj.name = b.name.slice(0, 60);
        if (typeof b.emoji === "string") proj.emoji = b.emoji.slice(0, 8);
        if (Number.isInteger(b.order)) proj.order = b.order;
        // La synchro se coupe et se rallume par projet. Elle ne s'allume que sur un
        // geste explicite : c'est le seul réglage de l'app qui donne à une machine le
        // droit d'écrire dans l'histoire d'un dépôt.
        if (typeof b.sync === "boolean") proj.auto = { ...(proj.auto || {}), sync: b.sync };
        saveRegistry(projects);
        return json(res, 200, proj);
      }
      if (req.method === "DELETE") {
        // On retire le projet du registre. Le MILESTONES.md, lui, reste dans le dépôt :
        // l'app ne supprime jamais un fichier de l'utilisateur.
        projects = projects.filter((x) => x.id !== proj.id); saveRegistry(projects);
        return json(res, 200, { ok: true });
      }
    }

    const msMatch = /^\/api\/projects\/([a-f0-9]+)\/steps$/.exec(p);
    if (msMatch && req.method === "PUT") {
      const proj = byId(msMatch[1]);
      if (!proj) return json(res, 404, { error: "unknown project" });
      const b = await readBody(req);
      if (!Array.isArray(b.items)) return json(res, 400, { error: "missing items" });
      // On relit le disque à chaque enregistrement : le fichier a pu bouger entre-temps
      // (édité à la main, ou par un Claude qui tourne dans ce projet-là).
      const r = M.read(proj.path, proj.name);
      const merged = M.apply(r.blocks, b.items);
      M.write(r.file, merged);
      // Le contenu vient d'être réécrit sous le nouveau nom : l'ancien fichier ferait
      // désormais doublon, avec le risque qu'on l'édite en croyant agir sur l'app.
      if (r.legacy && fs.existsSync(r.legacy)) fs.rmSync(r.legacy);
      // Le fichier vient de changer sur le disque : si ce projet est né dans Pyra et
      // que la synchro est demandée, on le commite. En arrière-plan — cocher une
      // étape ne peut pas attendre le réseau, et un push qui échoue ne doit pas
      // faire croire que l'enregistrement a raté.
      autoSync(proj, "Milestones");
      return json(res, 200, { ok: true, items: M.items(merged).map(pick) });
    }

    // Les trois lectures de la page d'un projet : son aperçu, son graphe, son histoire.
    // Elles ne sont demandées qu'à l'ouverture du projet ou au clic sur un bouton —
    // jamais dans la boucle des quatre secondes, qui doit rester à coût nul. C'est ce
    // qui autorise un `git log` et un `graph.json` de plusieurs mégaoctets ici.
    const pageMatch = /^\/api\/projects\/([a-f0-9]+)\/(preview|git|graph-data)$/.exec(p);
    if (pageMatch && req.method === "GET") {
      const proj = byId(pageMatch[1]);
      if (!proj) return json(res, 404, { error: "unknown project" });
      if (!fs.existsSync(proj.path)) return json(res, 400, { error: "project folder not found" });
      const what = pageMatch[2];

      // L'aperçu porte aussi l'état du distant (branche, avance, retard). Deux
      // sous-processus de plus sur une route déjà à la demande, contre une ligne de
      // plus dans l'étage du haut — et c'est là qu'on veut la lire.
      if (what === "preview") return json(res, 200, { ...(await R.overview(proj.path)), remote: await F.remoteState(proj.path) });

      if (what === "git") {
        const limit = Math.min(600, Math.max(20, Number(url.searchParams.get("limit")) || 250));
        return json(res, 200, await R.log(proj.path, { limit }));
      }

      // Le graphe n'existe pas tant que personne ne l'a construit : on le dit plutôt
      // que de rendre un 500 sur un ENOENT que rien n'expliquerait dans l'interface.
      const g = G.state(proj.path);
      if (!g.built) return json(res, 404, { error: "no knowledge graph yet — build it first" });
      const limit = Math.min(1200, Math.max(50, Number(url.searchParams.get("limit")) || 450));
      return json(res, 200, { ...(await G.read(proj.path, { limit })), state: g });
    }

    // (Re)construire le graphe d'un projet. Manuel ici : les projets déjà suivis
    // n'en ont pas reçu d'office, et un graphe périmé se rafraîchit d'un clic.
    // Réponse immédiate, l'état se lit ensuite dans /api/state, comme la génération.
    const grMatch = /^\/api\/projects\/([a-f0-9]+)\/graph$/.exec(p);
    if (grMatch && req.method === "POST") {
      const proj = byId(grMatch[1]);
      if (!proj) return json(res, 404, { error: "unknown project" });
      if (!fs.existsSync(proj.path)) return json(res, 400, { error: "project folder not found" });
      if (!G.available()) return json(res, 400, { error: "graphify not installed — run: uv tool install graphifyy" });
      const job = graphs.get(proj.id);
      if (job?.running) return json(res, 409, { error: "graph build already running" });
      startGraph(proj);
      return json(res, 202, { ok: true });
    }

    // Pousser à la main ce que Pyra a écrit dans un dépôt. Le pendant manuel de la
    // synchro automatique, et la porte de sortie pour les projets ajoutés depuis la
    // machine : eux n'ont pas le drapeau `auto.sync`, mais rien n'interdit à
    // l'utilisateur de demander le geste une fois, en connaissance de cause.
    const syncMatch = /^\/api\/projects\/([a-f0-9]+)\/sync$/.exec(p);
    if (syncMatch && req.method === "POST") {
      const proj = byId(syncMatch[1]);
      if (!proj) return json(res, 404, { error: "unknown project" });
      if (!fs.existsSync(proj.path)) return json(res, 400, { error: "project folder not found" });
      const b = await readBody(req);
      // Celui-ci ATTEND son résultat : c'est un clic, l'utilisateur regarde. La
      // synchro automatique, elle, ne bloque jamais son appelant.
      const r = await F.sync(proj.path, { message: String(b.message || "Milestones").slice(0, 120), push: b.push !== false });
      syncs.set(proj.id, { at: Date.now(), ...r });
      return json(res, r.ok ? 200 : 400, r);
    }

    // Générer les étapes : le modèle lit le dépôt et propose des milestones, qui sont
    // GREFFÉS sur le fichier — rien n'est remplacé, aucun statut n'est touché.
    // La réponse part tout de suite : l'appel dure des minutes, l'état se lit ensuite
    // dans /api/state.
    const genMatch = /^\/api\/projects\/([a-f0-9]+)\/generate$/.exec(p);
    if (genMatch && req.method === "POST") {
      const proj = byId(genMatch[1]);
      if (!proj) return json(res, 404, { error: "unknown project" });
      if (!fs.existsSync(proj.path)) return json(res, 400, { error: "project folder not found" });
      const job = gens.get(proj.id);
      if (job?.running) return json(res, 409, { error: "generation already running" });
      startGeneration(proj);
      return json(res, 202, { started: true });
    }

    if (req.method === "POST" && p === "/api/terminals") {
      const b = await readBody(req);
      const proj = byId(b.projectId || "");
      if (!proj) return json(res, 404, { error: "unknown project" });
      if (!fs.existsSync(proj.path)) return json(res, 400, { error: "project folder not found" });
      const t = terminals.spawn({
        projectId: proj.id, cwd: proj.path,
        kind: b.kind === "shell" ? "shell" : "claude",
        label: (b.label || proj.name).slice(0, 80),
      });
      return json(res, 200, { id: t.id });
    }

    // Rejoindre une session ouverte ailleurs. `claude attach` ne sait reprendre que les
    // sessions d'arrière-plan ; pour une session interactive qui vit dans un autre
    // terminal, on ouvre une BRANCHE (`--fork-session`) : le fil est repris ici sans
    // qu'on touche à la session d'origine, qui continue là où elle est.
    if (req.method === "POST" && p === "/api/attach") {
      const b = await readBody(req);
      const proj = byId(b.projectId || "");
      const sid = String(b.sessionId || "");
      if (!proj) return json(res, 404, { error: "unknown project" });
      if (!/^[A-Za-z0-9-]{8,64}$/.test(sid)) return json(res, 400, { error: "invalid session id" });
      // La session reprend dans SON dossier, pas dans celui du projet : une session de
      // PDM/qcbm-ring rouverte à la racine de PDM travaillerait à côté de ses fichiers.
      // On n'accepte que des chemins situés sous le projet — le client ne choisit pas
      // un dossier arbitraire.
      const asked = b.cwd ? path.resolve(b.cwd) : proj.path;
      const cwd = (asked === proj.path || asked.startsWith(proj.path + path.sep)) && fs.existsSync(asked) ? asked : proj.path;
      const command = b.background ? `claude attach ${sid}` : `claude --resume ${sid} --fork-session`;
      const t = terminals.spawn({
        projectId: proj.id, cwd, kind: "claude",
        label: (b.label || "session").slice(0, 80), command,
      });
      return json(res, 200, { id: t.id });
    }

    const termMatch = /^\/api\/terminals\/([a-f0-9]+)$/.exec(p);
    if (termMatch && req.method === "DELETE") return json(res, 200, { ok: terminals.kill(termMatch[1]) });

    res.writeHead(404).end("not found");
  } catch (e) {
    json(res, 500, { error: String(e.message || e) });
  }
});

/* --------------------------------------------------------------- websocket */

const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url, "http://127.0.0.1");
  if (url.pathname !== "/pty") return socket.destroy();
  const t = terminals.get(url.searchParams.get("id") || "");
  if (!t) return socket.destroy();
  wss.handleUpgrade(req, socket, head, (ws) => {
    terminals.attach(ws, t);
    ws.on("message", (raw) => {
      let m; try { m = JSON.parse(raw.toString()); } catch { return; }
      if (m.t === "in") terminals.write(t.id, m.d);
      else if (m.t === "size") terminals.resize(t.id, m.cols, m.rows);
    });
  });
});

/* ------------------------------------------------------------------- boot */

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Pyra — http://127.0.0.1:${PORT}`);
  console.log(`${projects.length} projects tracked · registry: ${REGISTRY}`);
});

// Sans ça, quitter le serveur laisserait des `claude` orphelins rattachés à des
// pty sans lecteur — ils continueraient de consommer le quota en silence.
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => { terminals.closeAll(); process.exit(0); });
}
