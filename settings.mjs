// Copyright © 2026 Paul Gregory. Tous droits réservés.
// Les réglages de l'app : le provider du modèle, et ce qui se déclenche tout seul
// quand on CRÉE un projet de zéro.
//
// Trois règles, et la troisième est celle qui a dicté la forme de ce fichier :
//
// 1. **Les réglages vivent hors du dépôt**, à côté du registre
//    (`~/Library/Application Support/Pyra/settings.json`). Même raison qu'en
//    `server.mjs` : une app empaquetée est un bundle SIGNÉ, y écrire invalide la
//    signature et, sur Apple Silicon, l'app ne redémarre plus.
// 2. **Un fichier absent ou cassé n'est pas une panne.** On repart des défauts et
//    l'app démarre. Un réglage n'a jamais le droit d'empêcher de travailler.
// 3. **Le provider est une TABLE, pas un `if`.** Claude est seul aujourd'hui ; le
//    jour où un second arrive, il s'ajoute en ligne de `PROVIDERS` et rien d'autre
//    ne bouge. C'est la raison d'être de ce module : sans lui, « claude » serait
//    écrit en dur dans `generate.mjs`, `terminals.mjs` et l'interface, et le
//    deuxième provider demanderait de rouvrir les trois.

import fs from "node:fs";
import path from "node:path";

/* ------------------------------------------------------------- les providers */

// Ce qu'un provider doit dire de lui-même pour que l'app sache lui parler : quel
// binaire lancer, et comment lui demander sa version. `models` est indicatif —
// l'utilisateur peut toujours écrire le nom d'un modèle que cette liste ignore,
// c'est le CLI qui tranche, pas nous.
export const PROVIDERS = [
  {
    id: "claude",
    name: "Claude",
    vendor: "Anthropic",
    cli: "claude",
    versionArgs: ["--version"],
    docs: "https://claude.com/claude-code",
    models: ["", "claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5-20251001"],
  },
];

export const provider = (id) => PROVIDERS.find((p) => p.id === id) || PROVIDERS[0];

/* ---------------------------------------------------------------- les défauts */

// `create` ne concerne QUE le chemin « nouveau projet ». Ajouter un dossier déjà
// présent sur la machine reste ce qu'il a toujours été : on l'inscrit au registre,
// et rien ne se déclenche. La distinction est le cœur du réglage — un automatisme
// utile sur un dépôt qu'on fabrique serait une intrusion sur un dépôt qui existe
// déjà, avec son histoire, son `CLAUDE.md` et ses commits en cours.
export const DEFAULTS = {
  provider: "claude",
  model: "", // vide = le défaut du CLI
  create: {
    git: true,        // `git init` + premier commit
    remote: true,     // dépôt distant via `gh repo create`
    graph: true,      // graphe Graphify — gratuit (`--code-only`, `--no-label`)
    milestones: true, // un MILESTONES.md de départ, écrit en local
    generate: false,  // la génération PAR LE MODÈLE — elle, coûte des tokens
    sync: true,       // pousser ce que Pyra écrit dans ce dépôt
  },
  github: {
    visibility: "private", // « private » ou « public »
    defaultBranch: "main",
  },
};

// Le seul réglage décoché par défaut est celui qui dépense. Le principe est le même
// que pour `--no-label` dans `graph.mjs` : ce que l'app déclenche d'elle-même doit
// être gratuit, et ce qui coûte doit être demandé. Un dépôt qu'on vient de créer est
// vide, de surcroît — le modèle n'y lirait rien.

/* ----------------------------------------------------------------- le fichier */

// Le chemin est donné par `server.mjs`, qui sait déjà où vit le registre : deux
// calculs séparés finiraient par diverger, et les réglages atterriraient à côté des
// projets. `init()` est appelé une fois au démarrage.
let FILE = null;
let cache = null;

export function init(file) {
  FILE = file;
  cache = null;
  return read();
}

// Fusion en profondeur sur DEUX niveaux, pas plus : la forme des réglages est plate
// à dessein. Un fichier écrit par une version plus ancienne se voit compléter par
// les défauts d'aujourd'hui plutôt que refusé — c'est ce qui rend une mise à jour
// silencieuse au lieu de perdre les choix de l'utilisateur.
function merge(base, over) {
  const out = { ...base };
  for (const [k, v] of Object.entries(over || {})) {
    if (v && typeof v === "object" && !Array.isArray(v) && base[k] && typeof base[k] === "object") {
      out[k] = { ...base[k], ...v };
    } else if (v !== undefined && v !== null) {
      out[k] = v;
    }
  }
  return out;
}

export function read() {
  if (cache) return cache;
  let raw = {};
  if (FILE && fs.existsSync(FILE)) {
    // Un JSON cassé ne doit pas empêcher l'app de démarrer : on repart des défauts.
    // Le fichier n'est PAS effacé — c'est un fichier de l'utilisateur, il a peut-être
    // voulu l'éditer à la main et s'est trompé d'une virgule.
    try { raw = JSON.parse(fs.readFileSync(FILE, "utf8")); } catch { raw = {}; }
  }
  cache = normalize(merge(DEFAULTS, raw));
  return cache;
}

// Tout ce qui arrive du client passe par ici. Une valeur inconnue retombe sur le
// défaut plutôt que d'être écrite telle quelle : le fichier est relu au démarrage
// suivant, et un `visibility: "sekret"` gardé en base ferait échouer `gh` une fois
// par projet créé, longtemps après la faute.
export function normalize(s) {
  const known = PROVIDERS.some((p) => p.id === s.provider);
  const bool = (v, d) => (typeof v === "boolean" ? v : d);
  return {
    provider: known ? s.provider : DEFAULTS.provider,
    model: typeof s.model === "string" ? s.model.slice(0, 80) : "",
    create: {
      git: bool(s.create?.git, DEFAULTS.create.git),
      remote: bool(s.create?.remote, DEFAULTS.create.remote),
      graph: bool(s.create?.graph, DEFAULTS.create.graph),
      milestones: bool(s.create?.milestones, DEFAULTS.create.milestones),
      generate: bool(s.create?.generate, DEFAULTS.create.generate),
      sync: bool(s.create?.sync, DEFAULTS.create.sync),
    },
    github: {
      visibility: s.github?.visibility === "public" ? "public" : "private",
      defaultBranch: /^[\w.\-\/]{1,60}$/.test(s.github?.defaultBranch || "")
        ? s.github.defaultBranch
        : DEFAULTS.github.defaultBranch,
    },
  };
}

// Écriture atomique, comme le registre : un `settings.json` tronqué par une coupure
// au milieu d'un `writeFile` repartirait aux défauts sans rien dire.
export function write(patch) {
  const next = normalize(merge(read(), patch));
  if (FILE) {
    const tmp = FILE + ".tmp";
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + "\n", "utf8");
    fs.renameSync(tmp, FILE);
  }
  cache = next;
  return cache;
}

/* ------------------------------------------------------- ce que l'UI affiche */

// Le panneau des réglages montre le provider ET son état réel : un binaire absent ou
// trop vieux se voit là plutôt qu'au premier échec. La version est lue une fois puis
// gardée — `/api/settings` n'est pas dans la boucle des quatre secondes, mais rien
// n'empêche l'utilisateur de rouvrir le panneau dix fois de suite.
let versionCache = new Map();

export async function status(id, resolveBin, run) {
  const p = provider(id);
  if (versionCache.has(p.id)) return versionCache.get(p.id);
  const bin = resolveBin(p);
  let out = { id: p.id, name: p.name, vendor: p.vendor, bin, version: "", error: "" };
  if (!bin) {
    out.error = `${p.cli} not found`;
  } else {
    try {
      const text = await run(bin, p.versionArgs);
      out.version = String(text).trim().split("\n")[0].slice(0, 60);
    } catch (e) {
      out.error = String(e.message || e).slice(0, 120);
    }
  }
  versionCache.set(p.id, out);
  return out;
}

export const forgetStatus = () => versionCache.clear();
