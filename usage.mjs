// Copyright © 2026 Paul Gregory. Tous droits réservés.
// Ce que le forfait a déjà consommé : la fenêtre de session (5 h) et la semaine.
//
// Deux fenêtres parce qu'il y a deux questions, et qu'elles n'ont pas la même
// réponse : « est-ce que je viens d'épuiser ma session ? » (ça revient dans
// l'heure, on peut aller boire un café) et « il me reste combien cette semaine ? »
// (ça ne revient pas avant des jours, il faut lever le pied). N'en montrer qu'une
// laisse l'utilisateur sans la réponse qu'il cherchait une fois sur deux. Pyra tient
// N sessions Claude en parallèle : c'est précisément l'app où la question se pose.
//
// LA LECTURE NE COÛTE PAS UN TOKEN, et c'est ce qui l'autorise à tourner toute
// seule. On ouvre un `claude` en mode flux, on lui pose une REQUÊTE DE CONTRÔLE
// (`get_usage`) et on referme : aucun tour de modèle n'est consommé, rien n'est
// envoyé au modèle. Même règle que pour le graphe dans `graph.mjs` — ce que l'app
// déclenche d'elle-même doit être gratuit.
//
// Gratuit en tokens ne veut pas dire gratuit tout court : c'est un sous-processus
// d'environ deux secondes. D'où le cache de cette page, et l'interdiction de mettre
// cette lecture dans `/api/state`, qui tourne toutes les quatre secondes.
//
// L'app ne stocke aucun secret, ici comme ailleurs : le jeton OAuth appartient au
// CLI, qui interroge le compte avec. Pyra ne voit jamais que des pourcentages.
//
// Enfin, c'est un CONFORT et rien d'autre. Le protocole vient du SDK et n'est pas
// gravé : binaire absent, sous-commande disparue, champ renommé — tout ce qui peut
// manquer rend `null`, l'écran dit « indisponible », et pas un geste de l'app n'en
// dépend.

import os from "node:os";
import { spawn } from "node:child_process";
import { childEnv, claudeBin } from "./terminals.mjs";

/* ------------------------------------------------------------- la lecture */

// Mode flux dans les deux sens : c'est le seul par lequel le CLI accepte une requête
// de contrôle. `--no-session-persistence` parce que cet appel est jetable — sauvegardé,
// il encombrerait le `/resume` de l'utilisateur avec une session vide toutes les
// deux minutes.
const ARGS = [
  "-p", "--input-format", "stream-json", "--output-format", "stream-json",
  "--verbose", "--no-session-persistence",
];
const ID = "pyra-usage";
const TIMEOUT = 20_000;
const TTL = 120_000;

const parseLine = (s) => { try { return JSON.parse(s); } catch { return null; } };

// Une promesse qui ne rejette JAMAIS : `null` est la réponse « je n'ai pas su ».
function ask() {
  return new Promise((resolve) => {
    let child;
    try {
      // `os.tmpdir()` et non le dossier d'un projet : on ne demande rien au modèle,
      // donc il n'a aucune raison de charger un CLAUDE.md, des réglages de dépôt ou
      // un MCP. Un dossier neutre, c'est un démarrage sans effet de bord.
      child = spawn(claudeBin(), ARGS, { cwd: os.tmpdir(), env: childEnv(), stdio: ["pipe", "pipe", "ignore"] });
    } catch { return resolve(null); }

    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { child.kill(); } catch {}
      resolve(v);
    };
    const timer = setTimeout(() => finish(null), TIMEOUT);

    child.on("error", () => finish(null));
    // Sorti sans avoir répondu : binaire trop vieux, compte non connecté, requête
    // inconnue. Rien à dire de plus qu'« indisponible ».
    child.on("exit", () => finish(null));
    // Un tube fermé pendant l'écriture émet sur le flux, pas sur le process : sans ce
    // garde-fou, l'erreur remonte non gérée et emporte le serveur.
    child.stdin.on("error", () => finish(null));

    let buf = "";
    child.stdout.on("data", (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        const msg = parseLine(line);
        if (msg?.type === "control_response" && msg.response?.request_id === ID)
          return finish(msg.response.subtype === "success" ? parse(msg.response.response) : null);
      }
      if (buf.length > 1e6) buf = ""; // une ligne interminable ne doit pas enfler
    });

    child.stdin.write(JSON.stringify({ type: "control_request", request_id: ID, request: { subtype: "get_usage" } }) + "\n");
  });
}

/* --------------------------------------------------------------- le cache */

let cache = { at: 0, data: null, seen: false };
let inflight = null;

export function forget() { cache = { at: 0, data: null, seen: false }; inflight = null; }

// `fresh` court-circuite le cache : c'est le bouton ↻ de l'interface, le seul geste
// qui a le droit de relancer un sous-processus avant l'heure. Un échec est mis en
// cache comme un succès — sinon un binaire absent ferait naître un processus par
// affichage, et ce serait la panne la plus coûteuse de l'app.
export function read({ fresh = false } = {}) {
  if (!fresh && cache.seen && Date.now() - cache.at < TTL) return Promise.resolve(cache.data);
  if (!inflight) {
    inflight = ask().then((data) => {
      cache = { at: Date.now(), data, seen: true };
      inflight = null;
      return data;
    });
  }
  return inflight;
}

/* ------------------------------------------------------------- la lecture */

const pct = (n) => Math.max(0, Math.min(100, Math.round(n)));
const stamp = (s) => { const t = Date.parse(s ?? ""); return Number.isNaN(t) ? null : t; };

// Le compte nomme lui-même ses fenêtres dans `rate_limits.limits` : espèce,
// pourcentage, date de remise à zéro, et le modèle concerné quand la limite ne vaut
// que pour lui. C'est la source à préférer — une formule nouvelle y apparaît sans
// qu'on rouvre ce fichier.
const KINDS = {
  session: { kind: "session", name: "Current session" },
  weekly_all: { kind: "weekly", name: "This week" },
  weekly_scoped: { kind: "weekly", name: "This week" },
};

// Le repli, pour le jour où `limits` ne serait plus là : les clés historiques, dans
// l'ordre d'affichage. Les deux dernières n'existent que sur certaines formules —
// absentes, elles ne prennent aucune place ; présentes, ce sont elles qui bloquent.
const KEYS = [
  { id: "five_hour", kind: "session", name: "Current session", scope: "" },
  { id: "seven_day", kind: "weekly", name: "This week", scope: "" },
  { id: "seven_day_opus", kind: "weekly", name: "This week", scope: "Opus" },
  { id: "seven_day_sonnet", kind: "weekly", name: "This week", scope: "Sonnet" },
];

function fromLimits(limits) {
  const out = [];
  for (const l of limits) {
    const k = KINDS[l?.kind];
    if (!k || typeof l.percent !== "number") continue;
    // Une limite propre à un modèle qu'on n'a pas entamé n'apprend rien et pousse
    // les deux autres vers le bas. Elle revient d'elle-même au premier pourcent.
    if (l.kind === "weekly_scoped" && !pct(l.percent)) continue;
    out.push({ ...k, scope: l.scope?.model?.display_name || "", percent: pct(l.percent), resetsAt: stamp(l.resets_at) });
  }
  return out;
}

function fromKeys(rl) {
  const out = [];
  for (const k of KEYS) {
    const raw = rl[k.id];
    if (!raw || typeof raw.utilization !== "number") continue;
    out.push({ kind: k.kind, name: k.name, scope: k.scope, percent: pct(raw.utilization), resetsAt: stamp(raw.resets_at) });
  }
  return out;
}

export function parse(data) {
  // Un tableau passe `typeof === "object"` : sans ce garde-fou, une réponse de forme
  // inattendue ressortirait en « pas de forfait » au lieu de « je n'ai pas su lire ».
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const plan = typeof data.subscription_type === "string" ? data.subscription_type : "";
  const rl = data.rate_limits;
  // Clé d'API, Bedrock, Vertex : il y a bien une facture, mais aucune réserve de
  // forfait à remplir. Le dire vaut mieux qu'une barre à zéro, qui se lirait « tu
  // n'as rien consommé » alors que la question n'a pas de sens pour ce compte-là.
  if (!data.rate_limits_available || !rl || typeof rl !== "object" || Array.isArray(rl))
    return { available: false, reason: "metered", plan, windows: [] };
  const windows = Array.isArray(rl.limits) && rl.limits.length ? fromLimits(rl.limits) : fromKeys(rl);
  return { available: windows.length > 0, reason: windows.length ? "" : "empty", plan, windows };
}
