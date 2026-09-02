// Copyright © 2026 Paul Gregory. Tous droits réservés.
// La génération des étapes : un `claude -p` lancé DANS le dossier du projet, qui lit
// le dépôt et renvoie une proposition de milestones. Rien d'autre ne sort d'ici — c'est
// `milestones.mjs` qui greffe la proposition sur le fichier, et lui seul qui écrit.
//
// Le provider est le même que partout ailleurs dans Pyra : le `claude` du PATH.
// Pas de clé d'API à gérer, pas de second abonnement, et le modèle voit le projet
// avec les mêmes yeux que les terminaux de l'app.
//
// Trois précautions, chacune pour une raison précise :
//   — `--json-schema` : la sortie est une structure, pas un markdown à redécouper.
//     Sans lui, il faudrait reparser de la prose, et une réponse bavarde
//     ferait n'importe quoi dans le fichier de l'utilisateur.
//   — outils en LECTURE SEULE : le modèle décrit le dépôt, il ne le modifie pas.
//     L'écriture passe par l'app, atomique, et sans jamais rien retirer.
//   — `--no-session-persistence` : ces appels sont jetables. Sauvegardés, ils
//     encombreraient le `/resume` de l'utilisateur et la liste des sessions.

import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { childEnv } from "./terminals.mjs";

const __dir = path.dirname(fileURLToPath(import.meta.url));

// Le prompt vit dans un fichier, pas dans le code : c'est la pièce qu'on retouche le
// plus souvent, et une retouche ne doit pas demander de redémarrer le serveur.
export const PROMPT_FILE = path.join(__dir, "prompts", "milestones.md");

// Deux niveaux, exactement ceux de MILESTONES.md. Le schéma n'autorise pas de troisième
// niveau : ce que l'interface ne sait pas montrer, on ne le demande pas.
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["milestones"],
  properties: {
    milestones: {
      type: "array",
      maxItems: 8,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "steps"],
        properties: {
          title: { type: "string" },
          detail: { type: "string" },
          status: { type: "string", enum: ["todo", "doing", "blocked", "done"] },
          steps: {
            type: "array",
            maxItems: 8,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["title"],
              properties: {
                title: { type: "string" },
                detail: { type: "string" },
                status: { type: "string", enum: ["todo", "doing", "blocked", "done"] },
              },
            },
          },
        },
      },
    },
  },
};

const READ_ONLY = ["Read", "Glob", "Grep"];
const TIMEOUT = 5 * 60 * 1000;

const run = (cmd, args, opts) =>
  new Promise((resolve, reject) => {
    execFile(cmd, args, opts, (err, stdout, stderr) =>
      err ? reject(Object.assign(err, { stdout, stderr })) : resolve(stdout)
    );
  });

// Le journal git est injecté dans le prompt plutôt que laissé à la charge du modèle.
// Lui donner Bash pour ça, c'est ouvrir l'exécution de commandes dans le dépôt de
// l'utilisateur pour une ligne de contexte qu'on sait produire soi-même.
async function gitLog(cwd) {
  try {
    const out = await run("git", ["log", "--oneline", "-30"], { cwd, timeout: 8000, maxBuffer: 1 << 20, env: childEnv() });
    return out.trim() ? out.trim().split("\n").map((l) => "    " + l).join("\n") : "    (no commit yet)";
  } catch {
    return "    (not a git repository)";
  }
}

// L'état des lieux envoyé au modèle. Il sert à deux choses : ne pas reproposer ce qui
// existe, et comprendre le grain déjà choisi par l'utilisateur — un projet dont les
// milestones sont fins n'en veut pas de gros en travers.
function inventory(items) {
  if (!items.length) return "    (nothing: the file is empty, this is a first map)";
  const lines = [];
  for (const it of items) {
    if (it.depth) lines.push(`      - [${it.status}] ${it.title}`);
    else lines.push(`    - [${it.status}] ${it.title}`);
  }
  return lines.join("\n");
}

export async function buildPrompt(project, items) {
  const template = await fs.promises.readFile(PROMPT_FILE, "utf8");
  const fill = { name: project.name, path: project.path, git: await gitLog(project.path), existing: inventory(items) };
  return template.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in fill ? fill[k] : m));
}

// Le modèle peut encadrer son JSON de ```json malgré le schéma. On pardonne cette
// faute-là, aucune autre : le reste vaut mieux échouer bruyamment que greffer des
// bêtises dans le dépôt.
function parseResult(text) {
  const t = String(text || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  const data = JSON.parse(t);
  const list = Array.isArray(data) ? data : data.milestones;
  if (!Array.isArray(list)) throw new Error("response without a milestone list");
  return list;
}

// `bin` vient des réglages (le provider) et `model` aussi. Le défaut reste « claude »
// tel quel, pour qu'un appel sans contexte — un test, un script — marche encore ; mais
// le serveur, lui, passe TOUJOURS le chemin résolu. Deux installations de claude
// cohabitent souvent sur un Mac et le PATH d'une app lancée depuis le Finder ne dit pas
// laquelle : c'est le même piège que celui documenté pour `claude agents --json`.
export async function propose({ project, items, bin = "claude", model = process.env.PYRA_MODEL || "" }) {
  const prompt = await buildPrompt(project, items);
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
    stdout = await run(bin, args, { cwd: project.path, timeout: TIMEOUT, maxBuffer: 16 << 20, env: childEnv() });
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
