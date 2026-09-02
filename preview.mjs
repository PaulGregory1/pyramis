// Copyright © 2026 Paul Gregory. Tous droits réservés.
// L'aperçu chiffré d'un projet : son OBJECTIF, et les deux ou trois nombres qui disent
// où il en est par rapport à lui. L'Elo d'un moteur d'échecs qui monte, le total de
// téléchargements d'une app, le rendement d'une stratégie — la seule chose qu'on veuille
// vraiment voir en ouvrant un projet, et que ni un README ni un `git log` ne disent.
//
// Trois décisions tiennent ce fichier, et rien ici n'a de sens sans elles :
//
// 1. **La donnée vit chez le projet**, dans son `.pyra/preview.json`, à côté de sa
//    bannière. Pyra n'a toujours pas de base : le jour où elle disparaît, l'historique
//    reste dans le dépôt, lisible, versionné, et un `jq` suffit à le relire. C'est la
//    même règle que le `MILESTONES.md` — si l'app devient le seul endroit où vit une
//    information, elle a échoué.
//
// 2. **Le modèle ÉCRIT les commandes, l'app les EXÉCUTE, et jamais l'inverse.** Le tour
//    de modèle est en LECTURE SEULE (`Read`/`Glob`/`Grep`, comme la génération d'étapes) :
//    il lit le dépôt et propose une ligne de shell par métrique, sans jamais rien lancer.
//    C'est ensuite Pyra qui la lance, sur un CLIC, jamais d'elle-même, jamais dans la
//    boucle des quatre secondes. La commande est écrite en toutes lettres dans le fichier
//    et affichée dans l'interface : elle se lit avant de tourner, et se corrige à la main.
//
// 3. **Une mise à jour ne coûte RIEN.** Le modèle ne passe qu'une fois, pour dire d'où
//    vient le nombre. Ensuite, « ↻ Update » n'est qu'un `sh -c` de plus — c'est ce qui
//    autorise à appuyer dessus dix fois par jour. La règle du CLAUDE.md tient : le seul
//    geste payant est étiqueté comme tel, et c'est celui qui construit l'aperçu.

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { childEnv } from "./terminals.mjs";

const __dir = path.dirname(fileURLToPath(import.meta.url));

// Le même dossier que la bannière : `.pyra/` est ce que le dépôt garde pour Pyra.
export const DIR = ".pyra";
export const FILE = path.join(DIR, "preview.json");

export const filePath = (dir) => path.join(dir, FILE);

// Le prompt vit dans un fichier, comme celui des étapes : c'est la pièce qu'on retouche
// le plus souvent, et une retouche ne doit pas demander de redémarrer le serveur.
export const PROMPT_FILE = path.join(__dir, "prompts", "preview.md");

const MAX_METRICS = 4;
const MAX_POINTS = 500;      // au-delà, la courbe ne dit rien de plus et le fichier gonfle
const CMD_TIMEOUT = 30_000;  // une mesure est une lecture, pas un calcul
const MODEL_TIMEOUT = 5 * 60 * 1000;

/* ------------------------------------------------------------------ le fichier */

// Lecture ASYNCHRONE, et ce n'est pas un détail de style : ce chemin est dans
// `~/Documents` pour presque tous les projets, et un `readFileSync` y fige la boucle
// Node entière le jour où macOS veut poser sa question TCC. Voir le CLAUDE.md.
export async function read(dir) {
  let raw;
  try {
    raw = await fsp.readFile(filePath(dir), "utf8");
  } catch {
    return null;
  }
  try {
    return normalize(JSON.parse(raw));
  } catch (e) {
    // Un fichier illisible est un fait à MONTRER, pas à avaler : il a été écrit à la
    // main la plupart du temps, et l'interface doit pouvoir dire où est la virgule.
    return { goal: "", metrics: [], error: "unreadable .pyra/preview.json: " + String(e.message || e).slice(0, 120) };
  }
}

// Ce qu'on accepte d'un fichier écrit à la main. Tout ce qui n'a pas la bonne forme est
// écarté sans bruit plutôt que de faire tomber la route : un aperçu est un supplément.
function normalize(data) {
  const list = Array.isArray(data?.metrics) ? data.metrics : [];
  const metrics = [];
  for (const m of list) {
    if (!m || typeof m.key !== "string" || !m.key.trim()) continue;
    const points = (Array.isArray(m.points) ? m.points : [])
      .filter((p) => p && Number.isFinite(Number(p.v)) && Number.isFinite(Number(p.at)))
      .map((p) => ({ at: Number(p.at), v: Number(p.v) }))
      .sort((a, b) => a.at - b.at)
      .slice(-MAX_POINTS);
    metrics.push({
      key: m.key.trim().slice(0, 40),
      label: String(m.label || m.key).slice(0, 60),
      unit: String(m.unit || "").slice(0, 12),
      // `Number(null)` vaut 0, et un fichier qu'on vient d'écrire porte `"target": null` :
      // sans ce `typeof`, une métrique sans cible en récupérait une à 0 au premier
      // aller-retour sur le disque, jauge pleine et « Target 0 » sous la courbe.
      target: typeof m.target === "number" && Number.isFinite(m.target) ? m.target : null,
      better: m.better === "down" ? "down" : "up",
      source: String(m.source || "").slice(0, 160),
      command: String(m.command || "").slice(0, 400),
      decimals: Number.isInteger(m.decimals) ? Math.min(4, Math.max(0, m.decimals)) : null,
      error: m.error ? String(m.error).slice(0, 200) : "",
      points,
    });
    if (metrics.length >= MAX_METRICS) break;
  }
  return { goal: String(data?.goal || "").slice(0, 220), metrics };
}

// Écriture atomique : un `.tmp` puis un `rename`. Le fichier vit dans le dépôt de
// l'utilisateur et peut être ouvert dans son éditeur — il ne doit jamais s'y montrer
// à moitié écrit, même si l'app meurt au milieu.
export async function write(dir, spec) {
  await fsp.mkdir(path.join(dir, DIR), { recursive: true });
  const file = filePath(dir);
  const tmp = file + ".tmp";
  await fsp.writeFile(tmp, JSON.stringify(spec, null, 2) + "\n", "utf8");
  await fsp.rename(tmp, file);
  return file;
}

/* ------------------------------------------------------------------ la greffe */

// La même règle que la génération des étapes : ON N'ENLÈVE JAMAIS RIEN. Une métrique
// qui a déjà des relevés garde son titre, sa commande et son historique — c'est de la
// mesure, et une mesure qu'on réécrit ne vaut plus rien. Le modèle ne peut qu'AJOUTER
// des métriques, et remplacer celles qui n'ont encore rien mesuré (là, il n'y a rien
// à perdre, et c'est ce qui permet de rattraper une commande qui ne marchait pas).
export function graft(spec, proposal) {
  const metrics = [...(spec?.metrics || [])];
  let added = 0, fixed = 0;

  for (const p of proposal.metrics || []) {
    if (!p?.key) continue;
    const key = String(p.key).trim().slice(0, 40);
    if (!key) continue;
    const at = metrics.findIndex((m) => m.key === key);
    const fresh = {
      key,
      label: String(p.label || key).slice(0, 60),
      unit: String(p.unit || "").slice(0, 12),
      target: typeof p.target === "number" && Number.isFinite(p.target) ? p.target : null,
      better: p.better === "down" ? "down" : "up",
      source: String(p.source || "").slice(0, 160),
      command: String(p.command || "").slice(0, 400),
      decimals: Number.isInteger(p.decimals) ? Math.min(4, Math.max(0, p.decimals)) : null,
      error: "",
      points: [],
    };
    if (at < 0) {
      if (metrics.length >= MAX_METRICS) continue;
      metrics.push(fresh);
      added++;
    } else if (!metrics[at].points.length) {
      // Rien de mesuré sous cette clé : la remplacer ne fait perdre aucun relevé, et
      // c'est le seul chemin pour réparer une commande que le dépôt a fait mentir.
      metrics[at] = fresh;
      fixed++;
    }
  }

  // L'objectif se remplit s'il est vide, et ne se réécrit pas : c'est une phrase que
  // l'utilisateur a pu corriger à la main, et elle lui appartient.
  const goal = (spec?.goal || "").trim() || String(proposal.goal || "").slice(0, 220);
  return { spec: { goal, metrics }, added, fixed };
}

/* -------------------------------------------------------------- les collecteurs */

const sh = (cmd, cwd) =>
  new Promise((resolve) => {
    execFile("/bin/sh", ["-c", cmd], { cwd, timeout: CMD_TIMEOUT, maxBuffer: 1 << 20, env: childEnv() }, (err, stdout, stderr) => {
      if (err) {
        const why = err.killed ? `no answer in ${CMD_TIMEOUT / 1000} s` : String(stderr || err.message).trim().split("\n").pop() || "failed";
        return resolve({ ok: false, error: why.slice(0, 200) });
      }
      resolve({ ok: true, out: String(stdout) });
    });
  });

// Ce qu'on accepte comme relevé. La DERNIÈRE ligne non vide, et le premier nombre qui
// s'y trouve : `1834`, `Elo: +59`, `12.4%` disent tous la même chose, et exiger un
// nombre nu ferait échouer une commande qui marche pour un `printf` de trop. On refuse
// en revanche de fouiller tout le flux — le premier nombre d'un log serait un hasard.
export function readNumber(out) {
  const lines = String(out || "").trim().split("\n").map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return { ok: false, error: "the command printed nothing" };
  const last = lines[lines.length - 1].replace(/,(?=\d{3}\b)/g, ""); // 1,234 → 1234
  const m = /[-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?/.exec(last);
  if (!m) return { ok: false, error: `no number in “${last.slice(0, 60)}”` };
  const v = Number(m[0]);
  if (!Number.isFinite(v)) return { ok: false, error: "unreadable number" };
  return { ok: true, v };
}

// Un relevé pour chaque métrique, en série. Le parallèle ne gagnerait qu'une seconde et
// ferait tourner quatre commandes du dépôt en même temps sur la machine de quelqu'un
// qui compile peut-être à côté.
//
// Une commande qui échoue ne fait échouer QUE sa métrique : son erreur est gardée dans
// le fichier, à côté d'un historique intact. Trois courbes qui montent ne doivent pas
// disparaître parce qu'un `curl` a perdu le réseau.
export async function collect(dir, spec) {
  const at = Date.now();
  const metrics = [];
  const results = [];

  for (const m of spec.metrics) {
    if (!m.command) {
      results.push({ key: m.key, ok: false, error: "no command — write one in .pyra/preview.json" });
      metrics.push({ ...m, error: "no command in .pyra/preview.json" });
      continue;
    }
    const r = await sh(m.command, dir);
    if (!r.ok) {
      results.push({ key: m.key, ok: false, error: r.error });
      metrics.push({ ...m, error: r.error });
      continue;
    }
    const n = readNumber(r.out);
    if (!n.ok) {
      results.push({ key: m.key, ok: false, error: n.error });
      metrics.push({ ...m, error: n.error });
      continue;
    }
    results.push({ key: m.key, ok: true, v: n.v });
    metrics.push({ ...m, error: "", points: [...m.points, { at, v: n.v }].slice(-MAX_POINTS) });
  }

  return { spec: { ...spec, metrics }, results, read: results.filter((r) => r.ok).length };
}

/* ------------------------------------------------------------------- le modèle */

// Un schéma, pour la même raison que celui des étapes : la sortie est une structure,
// pas un markdown à redécouper. `command` est le seul champ vraiment sensible — il
// finira dans un `sh -c`, sur un clic de l'utilisateur, et il est affiché avant.
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["goal", "metrics"],
  properties: {
    goal: { type: "string" },
    metrics: {
      type: "array",
      maxItems: MAX_METRICS,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["key", "label", "command", "source"],
        properties: {
          key: { type: "string" },
          label: { type: "string" },
          unit: { type: "string" },
          target: { type: "number" },
          better: { type: "string", enum: ["up", "down"] },
          decimals: { type: "integer" },
          source: { type: "string" },
          command: { type: "string" },
        },
      },
    },
  },
};

// LECTURE SEULE, et c'est la décision n° 2 en haut de ce fichier. Le modèle qui écrit
// la commande n'a pas le droit de la lancer : il la déduit de ce qu'il lit, l'app la
// lance ensuite. Sans cette séparation, « Build preview » serait un shell ouvert dans
// le dépôt de l'utilisateur, déclenché par un bouton qui promet un graphique.
const READ_ONLY = ["Read", "Glob", "Grep"];

const run = (cmd, args, opts) =>
  new Promise((resolve, reject) => {
    execFile(cmd, args, opts, (err, stdout, stderr) =>
      err ? reject(Object.assign(err, { stdout, stderr })) : resolve(stdout)
    );
  });

// L'état des lieux envoyé au modèle : ce qui est déjà mesuré, pour qu'il ne le
// repropose pas, et ce qui est mesuré mais cassé, pour qu'il le répare.
function inventory(spec) {
  if (!spec?.metrics?.length) return "    (nothing yet: this is the first one)";
  return spec.metrics
    .map((m) => {
      const last = m.points[m.points.length - 1];
      const state = m.error ? `BROKEN — ${m.error}` : last ? `last reading ${last.v}` : "never read";
      return `    - ${m.key} · ${m.label} · ${state}\n      command: ${m.command || "(none)"}`;
    })
    .join("\n");
}

async function tree(cwd) {
  try {
    const out = await run("/bin/sh", ["-c", "ls -A"], { cwd, timeout: 5000, maxBuffer: 1 << 18, env: childEnv() });
    return out.trim().split("\n").map((l) => "    " + l).join("\n");
  } catch {
    return "    (unreadable)";
  }
}

export async function buildPrompt(project, spec) {
  const template = await fsp.readFile(PROMPT_FILE, "utf8");
  const fill = { name: project.name, path: project.path, tree: await tree(project.path), existing: inventory(spec) };
  return template.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in fill ? fill[k] : m));
}

// Le modèle peut encadrer son JSON de ```json malgré le schéma. On pardonne cette
// faute-là, aucune autre.
function parseResult(text) {
  const t = String(text || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  const data = JSON.parse(t);
  if (!Array.isArray(data?.metrics)) throw new Error("response without a metric list");
  return { goal: String(data.goal || ""), metrics: data.metrics };
}

export async function design({ project, spec, bin = "claude", model = process.env.PYRA_MODEL || "" }) {
  const prompt = await buildPrompt(project, spec);
  const args = [
    "-p", prompt,
    "--output-format", "json",
    "--json-schema", JSON.stringify(SCHEMA),
    "--allowedTools", ...READ_ONLY,
    "--no-session-persistence",
  ];
  if (model) args.push("--model", model);

  let stdout;
  try {
    stdout = await run(bin, args, { cwd: project.path, timeout: MODEL_TIMEOUT, maxBuffer: 16 << 20, env: childEnv() });
  } catch (e) {
    if (e.code === "ENOENT") throw new Error("claude not found in PATH");
    if (e.killed) throw new Error("the model ran past five minutes");
    throw new Error(String(e.stderr || e.message).trim().split("\n").slice(-3).join(" ").slice(0, 300));
  }

  let env;
  try { env = JSON.parse(stdout); } catch { throw new Error("unreadable output from claude"); }
  if (env.is_error) throw new Error(String(env.result || "the model returned an error").slice(0, 300));
  return parseResult(env.result);
}

// Le fichier existe-t-il ? Utilisé par la route de mise à jour pour refuser tôt, avec
// une phrase, plutôt que d'aller chercher des métriques dans le vide.
export const exists = (dir) => fs.existsSync(filePath(dir));
