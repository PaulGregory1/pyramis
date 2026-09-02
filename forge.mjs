// Copyright © 2026 Paul Gregory. Tous droits réservés.
// Ce que l'app ÉCRIT dans git. `repo.mjs` lit un dépôt et ne le touche jamais ; ce
// module-ci est son miroir, et il est seul à pouvoir modifier l'histoire d'un dépôt.
// La séparation n'est pas cosmétique : elle rend la règle vérifiable d'un coup d'œil
// — si un jour l'app abîme un dépôt, c'est forcément ici.
//
// Trois garde-fous, et le premier est le seul qui compte vraiment :
//
// 1. **On ne commite JAMAIS `-A`.** La synchro nomme ses fichiers un par un
//    (`git commit -- MILESTONES.md`), ce qui commite la version disque de ces
//    chemins-là et RIEN d'autre, index en cours compris. Un `git add -A` embarquerait
//    le travail non fini de l'utilisateur dans un commit qu'il n'a pas demandé —
//    c'est la version git de « supprimer un fichier de l'utilisateur ».
// 2. **Jamais de `--force`, jamais de `reset`, jamais de `checkout`.** Rien ici ne
//    peut faire perdre un commit. Le pire qui puisse arriver est un commit en trop.
// 3. **Un échec de synchro n'est pas une panne de l'app.** Pas de réseau, un dépôt
//    divergé, une clé SSH absente : on le note et on continue. L'app suit des
//    projets, elle n'est pas un client git.

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";

const TIMEOUT = 120_000;

const run = (cmd, args, opts = {}) =>
  new Promise((ok, ko) =>
    execFile(cmd, args, { timeout: TIMEOUT, maxBuffer: 8 << 20, ...opts }, (err, stdout, stderr) =>
      err ? ko(Object.assign(err, { stdout, stderr })) : ok(String(stdout))
    )
  );

// Un git qui échoue rend son message, pas une exception : l'appelant décide si c'est
// grave. Même contrat que le `git()` de `repo.mjs`, en gardant le stderr — ici on a
// besoin de DIRE pourquoi ça n'a pas marché.
async function git(dir, args) {
  try {
    return { ok: true, out: await run("git", args, { cwd: dir }) };
  } catch (e) {
    return { ok: false, out: String(e.stdout || ""), error: tail(e.stderr || e.message) };
  }
}

const tail = (s) =>
  String(s).trim().split("\n").filter(Boolean).slice(-2).join(" ").slice(0, 300) || "git failed";

/* -------------------------------------------------------------------- `gh` */

// Même problème que `graphify` dans `graph.mjs`, même remède : lancée depuis le
// Finder, l'app hérite d'un PATH réduit à /usr/bin:/bin, où `gh` n'est pas. Sans
// cette recherche, créer un dépôt distant échouerait sur un ENOENT que rien dans
// l'interface n'expliquerait. `git`, lui, est dans /usr/bin — il n'a pas ce souci.
const GH_CANDIDATES = [
  "/opt/homebrew/bin/gh",
  "/usr/local/bin/gh",
  path.join(os.homedir(), ".local", "bin", "gh"),
];

let ghCached;
export function ghBin() {
  if (ghCached !== undefined) return ghCached;
  for (const dir of (process.env.PATH || "").split(":")) {
    if (!dir) continue;
    const f = path.join(dir, "gh");
    try { fs.accessSync(f, fs.constants.X_OK); ghCached = f; return ghCached; } catch { /* suivant */ }
  }
  for (const f of GH_CANDIDATES) {
    try { fs.accessSync(f, fs.constants.X_OK); ghCached = f; return ghCached; } catch { /* suivant */ }
  }
  ghCached = null;
  return ghCached;
}

// L'état de la connexion, tel que le panneau des réglages le montre. On interroge
// `gh` plutôt que de garder un jeton : le CLI tient déjà l'authentification dans le
// trousseau du Mac, et un secret que l'app ne stocke pas est un secret qu'elle ne
// peut pas laisser fuir. C'est aussi pourquoi ce module ne lit JAMAIS le jeton —
// il se contente de savoir s'il y en a un.
export async function github() {
  const bin = ghBin();
  if (!bin) {
    return { installed: false, authenticated: false, login: "", error: "gh not found — install it with: brew install gh" };
  }
  try {
    const out = await run(bin, ["api", "user", "--jq", ".login"], { timeout: 15_000 });
    const login = String(out).trim();
    return { installed: true, authenticated: !!login, login, error: login ? "" : "gh is installed but not signed in — run: gh auth login" };
  } catch (e) {
    return {
      installed: true,
      authenticated: false,
      login: "",
      error: tail(e.stderr || e.message).includes("auth login")
        ? "not signed in — run: gh auth login"
        : tail(e.stderr || e.message),
    };
  }
}

/* ------------------------------------------------------------ le nom du dépôt */

// GitHub n'accepte pas n'importe quoi, et un nom refusé ferait échouer la création
// APRÈS que le dossier et les commits existent. On corrige donc en amont plutôt que
// d'expliquer après coup. « Skull King » devient « skull-king ».
export const slug = (name) =>
  String(name || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 90)
    .toLowerCase() || "project";

// Le nom d'un DOSSIER, lui, garde ses majuscules et ses espaces : c'est celui que
// l'utilisateur voit dans le Finder. Seuls les caractères que le système refuse
// sautent. On ne veut pas non plus d'un nom qui remonte l'arborescence.
export const folderName = (name) =>
  String(name || "").replace(/[/\\:\0]/g, "-").replace(/^\.+/, "").trim().slice(0, 80);

/* ---------------------------------------------------------------- la création */

const README = (name) => `# ${name}\n`;

// Un `.gitignore` minimal, et volontairement pauvre : deviner la pile d'un projet qui
// n'a pas encore une ligne de code, c'est se tromper. Ces deux entrées-là valent pour
// tout dépôt sur un Mac.
const GITIGNORE = ".DS_Store\nnode_modules/\n";

// Le squelette. Aucun modèle appelé, aucun réseau : ce qui suit s'écrit sur le disque
// et rien d'autre. `MILESTONES.md` n'est posé que si le réglage le demande, et il est
// écrit EN LOCAL — la génération par le modèle est un geste séparé, qui coûte.
export async function scaffold(dir, { name, milestones = true }) {
  await fsp.mkdir(dir, { recursive: true });
  const files = [];
  const put = async (rel, text) => {
    const f = path.join(dir, rel);
    if (fs.existsSync(f)) return; // on n'écrase rien, jamais
    await fsp.writeFile(f, text, "utf8");
    files.push(rel);
  };
  await put("README.md", README(name));
  await put(".gitignore", GITIGNORE);
  if (milestones) await put("MILESTONES.md", starter(name));
  return files;
}

// Le MILESTONES.md de départ suit la grammaire de `milestones.mjs` : un milestone à
// la marge, ses étapes indentées dessous. Il est en anglais comme le reste de ce que
// l'app écrit, et il est VOLONTAIREMENT presque vide — trois lignes qu'on remplace
// valent mieux qu'une feuille de route inventée pour un projet dont on ne sait rien.
export const starter = (name) =>
  `# ${name}\n\n` +
  `- [ ] Get started\n` +
  `  - [ ] Decide what this project is for\n` +
  `  - [ ] Write the first thing that runs\n`;

/* ------------------------------------------------------------------- git init */

export async function init(dir, { branch = "main" } = {}) {
  if (fs.existsSync(path.join(dir, ".git"))) return { ok: true, already: true };
  // `-b` plutôt qu'un `git branch -M` après coup : sur un dépôt sans commit, le
  // renommage échoue sur certaines versions de git.
  const r = await git(dir, ["init", "-b", branch]);
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}

// Le premier commit prend TOUT ce que le squelette vient d'écrire — c'est le seul
// endroit où un `add -A` est légitime, puisque le dossier vient de naître et ne
// contient que nos quatre fichiers. Passé ce point, plus jamais.
export async function firstCommit(dir, { message = "Initial commit" } = {}) {
  const has = await git(dir, ["rev-parse", "--verify", "HEAD"]);
  if (has.ok) return { ok: true, already: true };
  const add = await git(dir, ["add", "-A"]);
  if (!add.ok) return { ok: false, error: add.error };
  const c = await git(dir, ["commit", "-m", message]);
  if (c.ok) return { ok: true };
  // La panne la plus fréquente, et la seule qu'on sache expliquer : git n'a pas
  // d'identité. Le message brut de git est correct mais long de douze lignes.
  const why = /user\.email|user\.name|Author identity unknown/i.test(c.error)
    ? "git has no identity here — run: git config --global user.email you@example.com"
    : c.error;
  return { ok: false, error: why };
}

/* -------------------------------------------------------------- dépôt distant */

// Un dépôt distant en une commande. `--source=.` prend le dossier tel qu'il est,
// `--push` envoie le premier commit et pose l'amont. La visibilité vient des
// réglages et vaut « private » par défaut : un dépôt créé par une app doit naître
// fermé, l'ouvrir est un geste que l'utilisateur pose sciemment.
export async function createRemote(dir, { name, visibility = "private", remote = "origin" }) {
  const bin = ghBin();
  if (!bin) return { ok: false, error: "gh not found — install it with: brew install gh" };

  const already = await git(dir, ["remote", "get-url", remote]);
  if (already.ok) return { ok: true, already: true, url: already.out.trim() };

  const repo = slug(name);
  try {
    await run(bin, [
      "repo", "create", repo,
      visibility === "public" ? "--public" : "--private",
      "--source", dir,
      "--remote", remote,
      "--push",
    ], { cwd: dir, timeout: TIMEOUT });
  } catch (e) {
    const msg = tail(e.stderr || e.message);
    // Deux échecs valent la peine d'être traduits : ils ont une action derrière eux.
    if (/already exists/i.test(msg)) return { ok: false, error: `a GitHub repository named “${repo}” already exists` };
    if (/auth|credentials|HTTP 401/i.test(msg)) return { ok: false, error: "not signed in — run: gh auth login" };
    return { ok: false, error: msg };
  }
  const url = await git(dir, ["remote", "get-url", remote]);
  return { ok: true, url: url.ok ? url.out.trim() : "" };
}

/* ------------------------------------------------------------------ la synchro */

// Les seuls chemins que Pyra s'autorise à commiter. Ce sont les fichiers qu'elle
// écrit elle-même — le reste du dépôt appartient à l'utilisateur et ne doit jamais
// entrer dans un commit qu'il n'a pas déclenché. `graphify-out/` n'est pas de la
// liste : il est exclu via `.git/info/exclude` (voir `graph.mjs`), donc il ne peut
// pas être commité même par accident.
// `.pyra/preview.json` en fait partie : c'est Pyra qui l'écrit, et son contenu est un
// HISTORIQUE — des relevés datés qu'un `git checkout` d'il y a un mois doit encore
// porter. La bannière du même dossier, elle, n'y est pas : elle appartient au dépôt,
// pas à l'app, et c'est à l'utilisateur de décider si elle entre dans un commit.
export const OWNED = ["MILESTONES.md", "CLAUDE.md", ".pyra/preview.json"];

// `git commit -- <chemins>` commite la version DISQUE de ces chemins-là, quoi qu'il
// y ait dans l'index. C'est ce qui rend la synchro sûre au milieu d'un travail en
// cours : une modification à moitié indexée ailleurs n'est ni prise, ni perdue.
export async function sync(dir, { message = "Milestones", push = true, paths = OWNED } = {}) {
  if (!fs.existsSync(path.join(dir, ".git"))) return { ok: false, skipped: "not a git repository" };

  const here = paths.filter((f) => fs.existsSync(path.join(dir, f)));
  if (!here.length) return { ok: true, skipped: "nothing Pyra owns in this repository" };

  // Rien n'a bougé : c'est le cas ordinaire, pas une erreur. Sans ce test, chaque
  // enregistrement produirait un « nothing to commit » remonté comme une panne.
  const diff = await git(dir, ["status", "--porcelain", "--", ...here]);
  if (!diff.ok) return { ok: false, error: diff.error };
  if (!diff.out.trim()) return { ok: true, skipped: "nothing changed" };

  const add = await git(dir, ["add", "--", ...here]);
  if (!add.ok) return { ok: false, error: add.error };
  const c = await git(dir, ["commit", "-m", message, "--", ...here]);
  if (!c.ok) return { ok: false, error: c.error };

  const committed = (await git(dir, ["rev-parse", "--short", "HEAD"])).out.trim();
  if (!push) return { ok: true, committed };

  // Pousser peut échouer pour dix raisons dont aucune n'est de notre ressort : pas de
  // réseau, pas d'amont, une branche divergée. Le commit, lui, est fait — il n'est
  // pas perdu, il attend. On rend l'échec sans le transformer en panne.
  const p = await pushCurrent(dir);
  return p.ok ? { ok: true, committed, pushed: true } : { ok: true, committed, pushed: false, pushError: p.error };
}

// Pose l'amont si la branche n'en a pas, sinon pousse simplement. Jamais `--force`.
export async function pushCurrent(dir, { remote = "origin" } = {}) {
  const has = await git(dir, ["remote", "get-url", remote]);
  if (!has.ok) return { ok: false, error: "no remote to push to" };

  const branch = (await git(dir, ["branch", "--show-current"])).out.trim();
  if (!branch) return { ok: false, error: "detached HEAD — nothing to push" };

  const up = await git(dir, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
  const args = up.ok ? ["push", remote, branch] : ["push", "--set-upstream", remote, branch];
  const r = await git(dir, args);
  return r.ok ? { ok: true, branch } : { ok: false, error: r.error };
}

/* --------------------------------------------------------------- l'état d'un */

// Ce que l'interface montre du côté git d'un projet : y a-t-il un dépôt, un distant,
// et la branche courante est-elle en avance sur lui. Lu à la demande, jamais dans la
// boucle des quatre secondes — trois sous-processus par projet et par tour.
export async function remoteState(dir) {
  if (!fs.existsSync(path.join(dir, ".git"))) return { repo: false };
  const url = await git(dir, ["remote", "get-url", "origin"]);
  const branch = (await git(dir, ["branch", "--show-current"])).out.trim();
  const counts = await git(dir, ["rev-list", "--left-right", "--count", "@{u}...HEAD"]);
  const [behind, ahead] = counts.ok ? counts.out.trim().split(/\s+/).map(Number) : [0, 0];
  return {
    repo: true,
    branch,
    remote: url.ok ? url.out.trim() : "",
    upstream: counts.ok,
    ahead: ahead || 0,
    behind: behind || 0,
  };
}
