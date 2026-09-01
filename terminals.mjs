// Copyright © 2026 Paul Gregory. Tous droits réservés.
// Les terminaux. Un vrai pseudo-terminal par fenêtre, donc un vrai `claude`
// interactif : couleurs, /resume, dialogues de permission, tout marche parce que
// rien n'est réimplémenté. C'est la différence avec ApplyStudio, qui tient UNE
// query() du SDK en streaming — parfait pour une conversation, inadapté à N.
//
// Les sessions vivent dans ce process, pas dans l'onglet du navigateur : recharger
// la page réattache les panneaux au lieu de tuer le travail en cours.

import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pty = require("node-pty");

// Assez pour retrouver le fil après un rechargement, pas assez pour faire enfler
// la mémoire quand un build bavard tourne pendant une heure.
const SCROLLBACK = 256 * 1024;

// Si Pyra est lui-même démarré depuis une session Claude, l'environnement porte
// des marqueurs d'imbrication (CLAUDE_CODE_CHILD_SESSION & co). Un `claude` qui en
// hérite se croit sous-session : transcript désactivé, donc plus de /resume, et
// l'effort du parent imposé en douce. Les terminaux d'ici sont des sessions de
// premier rang — on nettoie. On ne touche pas à la configuration de l'utilisateur
// (ANTHROPIC_API_KEY, CLAUDE_CONFIG_DIR, CLAUDE_CODE_USE_BEDROCK…).
const NESTING_VARS = [
  "CLAUDECODE", "CLAUDE_CODE_CHILD_SESSION", "CLAUDE_CODE_SESSION_ID",
  "CLAUDE_CODE_BRIDGE_SESSION_ID", "CLAUDE_CODE_ENTRYPOINT", "CLAUDE_CODE_EXECPATH",
  "CLAUDE_CODE_MESSAGING_SOCKET", "CLAUDE_CODE_MESSAGING_TOKEN", "CLAUDE_CODE_SSE_PORT",
  "CLAUDE_PID", "CLAUDE_EFFORT",
];

function cleanEnv() {
  const env = { ...process.env };
  for (const k of NESTING_VARS) delete env[k];
  return env;
}

// L'environnement de tout `claude` lancé par Pyra — les panneaux d'ici comme la
// génération d'étapes en arrière-plan. Les deux ont les mêmes besoins : ne pas
// hériter des marqueurs d'imbrication, et retrouver le binaire dans le PATH.
export const childEnv = () => ({ ...cleanEnv(), PATH: richPath(), PYRA: "1" });

// Lancée depuis le Finder, une app n'hérite pas du PATH du shell : `claude` et
// `node` deviennent introuvables et le pty meurt à la seconde. On complète.
//
// L'ORDRE compte. `~/.local/bin` est l'installateur natif de Claude Code, celui qui
// se met à jour tout seul ; `/opt/homebrew/bin` peut abriter un vieux paquet npm figé
// depuis des mois. Le mettre en premier, c'est parler à un binaire d'il y a six
// versions et voir `unknown option '--json'` remonter dans l'interface.
function richPath() {
  const extra = [path.join(os.homedir(), ".local/bin"), "/opt/homebrew/bin", "/usr/local/bin"];
  const have = (process.env.PATH || "").split(":");
  return [...have, ...extra.filter((p) => !have.includes(p) && fs.existsSync(p))].join(":");
}

// Le chemin complet du `claude` à appeler, plutôt que le nom nu. Un `execFile("claude")`
// suit le PATH du serveur, qui n'est pas celui qu'on vient de composer : lancé par le
// Finder il tombe sur le premier binaire de `/opt/homebrew/bin`, quel que soit son âge.
// On résout donc nous-mêmes, dans l'ordre de richPath, et on retombe sur le nom nu si
// aucun candidat n'existe — c'est au moins un message d'erreur lisible.
export function claudeBin() {
  for (const dir of richPath().split(":")) {
    const cand = path.join(dir, "claude");
    try { if (fs.existsSync(cand)) return cand; } catch {}
  }
  return "claude";
}

export function createTerminals() {
  const terms = new Map();

  // Un terminal est d'abord une COQUILLE sans processus. Le programme ne démarre
  // qu'une fois la taille réelle du panneau connue : lancé avant, `claude` peint son
  // invite à une largeur fausse, puis le redimensionnement laisse des mots coupés en
  // travers de l'écran. Filet de sécurité à 3 s si aucune taille n'arrive.
  function create({ projectId, cwd, kind, label, command }) {
    const t = {
      id: crypto.randomBytes(5).toString("hex"),
      projectId, cwd, kind, label, command,
      startedAt: Date.now(),
      alive: true,
      started: false,
      exitCode: null,
      buffer: "",
      pty: null,
      clients: new Set(),
    };
    terms.set(t.id, t);
    t.fallback = setTimeout(() => start(t, 100, 30), 3000);
    return t;
  }

  function start(t, cols, rows) {
    if (t.started || !t.alive) return;
    t.started = true;
    clearTimeout(t.fallback);

    const shell = process.env.SHELL || "/bin/zsh";
    // `claude` est lancé DANS un shell de connexion : on récupère l'environnement de
    // l'utilisateur (nvm, alias, variables) exactement comme s'il avait tapé la
    // commande — et `exec` évite de laisser un shell parent inutile derrière.
    const args = t.command ? ["-lc", `exec ${t.command}`] : t.kind === "claude" ? ["-lc", "exec claude"] : ["-l"];
    const p = pty.spawn(shell, args, {
      name: "xterm-256color",
      cols: Math.max(20, cols | 0), rows: Math.max(5, rows | 0), cwd: t.cwd,
      env: { ...childEnv(), TERM: "xterm-256color" },
    });
    t.pty = p;

    p.onData((d) => {
      t.buffer += d;
      if (t.buffer.length > SCROLLBACK) t.buffer = t.buffer.slice(-SCROLLBACK);
      send(t, { t: "out", d });
    });
    p.onExit(({ exitCode }) => {
      t.alive = false;
      t.exitCode = exitCode;
      send(t, { t: "exit", code: exitCode });
    });
  }

  function send(t, msg) {
    const raw = JSON.stringify(msg);
    for (const ws of t.clients) if (ws.readyState === 1) ws.send(raw);
  }

  function attach(ws, t) {
    t.clients.add(ws);
    ws.send(JSON.stringify({
      t: "ready", id: t.id, kind: t.kind, cwd: t.cwd, label: t.label,
      projectId: t.projectId, alive: t.alive, replay: t.buffer,
    }));
    ws.on("close", () => t.clients.delete(ws));
  }

  return {
    get: (id) => terms.get(id),
    spawn: create,
    attach,
    write(id, d) { const t = terms.get(id); if (t?.alive && t.pty) t.pty.write(d); },
    // Première taille reçue = feu vert au lancement ; les suivantes redimensionnent.
    resize(id, cols, rows) {
      const t = terms.get(id);
      if (!t || !t.alive || !(cols > 0) || !(rows > 0)) return;
      if (!t.started) return start(t, cols, rows);
      try { t.pty.resize(cols, rows); } catch {}
    },
    kill(id) {
      const t = terms.get(id);
      if (!t) return false;
      clearTimeout(t.fallback);
      if (t.alive && t.pty) { try { t.pty.kill(); } catch {} }
      terms.delete(id);
      return true;
    },
    list() {
      return [...terms.values()].map((t) => ({
        id: t.id, projectId: t.projectId, cwd: t.cwd, kind: t.kind, pid: t.pty?.pid ?? null,
        label: t.label, startedAt: t.startedAt, alive: t.alive, exitCode: t.exitCode,
        viewers: t.clients.size,
      }));
    },
    closeAll() { for (const t of terms.values()) { clearTimeout(t.fallback); if (t.alive && t.pty) { try { t.pty.kill(); } catch {} } } },
  };
}
