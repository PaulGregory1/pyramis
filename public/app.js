// Copyright © 2026 Paul Gregory. Tous droits réservés.
// UI de Pyra. Trois responsabilités : afficher l'avancement des projets, éditer
// les étapes (qui partent dans le MILESTONES.md du dépôt), et tenir N terminaux vivants.

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const el = (tag, cls, txt) => { const n = document.createElement(tag); if (cls) n.className = cls; if (txt != null) n.textContent = txt; return n; };

const STATUS = {
  todo: { label: "To do", next: "doing" },
  doing: { label: "Doing", next: "blocked" },
  blocked: { label: "Blocked", next: "done" },
  done: { label: "Done", next: "todo" },
};
const ORDER = ["todo", "doing", "blocked", "done"];

const state = { data: null, selected: "", view: "board", filter: "all", dialog: "" };
const panes = new Map(); // id -> { term, fit, ws, root, seed, lastData, booted }

/* ------------------------------------------------------------------ état */

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.error || res.statusText);
  return out;
}

async function refresh() {
  try {
    state.data = await api("GET", "/api/state");
    $("#err").textContent = state.data.agentsError || "";
    render();
  } catch (e) {
    $("#err").textContent = String(e.message || e);
  }
}

const project = (id) => state.data?.projects.find((p) => p.id === id) || null;
const current = () => project(state.selected);

// Deux niveaux, et la règle qui les sépare tient en une ligne : la vue d'ensemble ne
// montre QUE les milestones, le détail n'apparaît qu'une fois le projet ouvert. Sans ça,
// huit projets × leurs petites étapes redonnent la page illisible qu'on fuyait.
const mains = (p) => p.steps.filter((m) => !m.parentId);
const kids = (p, id) => p.steps.filter((m) => m.parentId === id);

/* --------------------------------------------------------------- sidebar */

function renderSide() {
  const box = $("#projects");
  box.textContent = "";
  for (const p of state.data.projects) {
    const b = el("button", "proj" + (state.selected === p.id ? " on" : ""));
    b.dataset.id = p.id;
    b.append(el("span", "pe", p.emoji));
    b.append(el("span", "pn", p.name));
    const meta = el("span", "pmeta");
    if (p.mainStats.total) meta.append(el("span", null, `${p.mainStats.done}/${p.mainStats.total}`));
    if (!p.exists) meta.append(el("span", null, "⚠"));
    b.append(meta);
    b.onclick = () => { state.selected = p.id; writeHash(); render(); };
    box.append(b);

    if (p.mainStats.total) {
      const g = el("div", "gauge");
      const i = el("i");
      i.style.width = `${Math.round((p.mainStats.done / p.mainStats.total) * 100)}%`;
      g.append(i);
      box.append(g);
    }

    // Les sessions du projet, chacune sur son bouton. Deux origines : les panneaux
    // ouverts ici, et les sessions lancées ailleurs sur la machine que
    // `claude agents --json` rapporte. Les deux mènent au même geste — y aller —
    // mais pas par le même chemin, d'où la distinction visuelle.
    const rows = [
      ...p.terminals.filter((t) => t.alive).map((t) => ({ kind: "mine", id: t.id, label: t.label || p.name, sub: t.kind })),
      ...p.sessions.map((s) => ({ kind: "ext", id: s.sessionId, label: s.name || s.sessionId.slice(0, 8), sub: s.kind, cwd: s.cwd, background: s.kind === "background" })),
    ];
    if (!rows.length) continue;

    const list = el("div", "sessions");
    for (const r of rows) {
      const s = el("button", "sess" + (r.kind === "ext" ? " ext" : ""));
      s.append(el("span", "sdot"));
      s.append(el("span", "sname", r.label));
      if (r.kind === "ext") {
        s.append(el("span", "stag", "elsewhere"));
        s.title = r.background
          ? "Background session: pick it up in a pane here."
          : "Session open in another terminal. Opening it here branches off — the original one carries on untouched.";
        s.onclick = () => joinSession(p, r);
      } else {
        s.title = "Go to this terminal";
        s.onclick = () => focusPane(r.id);
      }
      list.append(s);
    }
    box.append(list);
  }
  $(".proj.all").classList.toggle("on", !state.selected);
  const n = state.data.liveCount;
  $("#live").innerHTML = `<b>${n}</b> Claude session${n > 1 ? "s" : ""}`;
}

// Un panneau déjà ouvert : on bascule sur la vue, on le met en évidence, on lui donne
// le clavier. Rien n'est relancé — c'est la même session, pas une nouvelle.
function focusPane(id) {
  showView("terms");
  const pane = panes.get(id);
  if (!pane) return;
  pane.root.scrollIntoView({ block: "nearest", behavior: "smooth" });
  pane.root.classList.add("flash");
  setTimeout(() => pane.root.classList.remove("flash"), 900);
  pane.term.focus();
}

async function joinSession(p, r) {
  if (!r.background && !confirm(
    `“${r.label}” is running in another terminal.\n\n` +
    `Opening it here picks up the thread in a branch: the original session carries on, untouched.`
  )) return;
  try {
    const { id } = await api("POST", "/api/attach", {
      projectId: p.id, sessionId: r.id, label: r.label, cwd: r.cwd, background: Boolean(r.background),
    });
    showView("terms");
    await refresh();
    focusPane(id);
  } catch (e) { alert("Could not join this session: " + e.message); }
}

/* ------------------------------------------------------- vue d'ensemble */

function renderOverview(view) {
  const head = el("div", "phead");
  head.append(el("h1", null, "All projects"));
  head.append(el("span", "grow"));
  view.append(head);

  const sub = el("div", "path");
  sub.style.color = "var(--faint)";
  sub.style.fontSize = "12px";
  const doing = state.data.projects.reduce((n, p) => n + p.mainStats.doing, 0);
  const blocked = state.data.projects.reduce((n, p) => n + p.mainStats.blocked, 0);
  sub.textContent = `${state.data.projects.length} projects · ${doing} milestone${doing > 1 ? "s" : ""} in progress · ${blocked} blocked`;
  view.append(sub);

  const cards = el("div", "cards");
  for (const p of state.data.projects) {
    const c = el("div", "card");
    const h = el("h2");
    h.append(el("span", null, p.emoji), el("span", null, p.name));
    if (p.sessions.length) h.append(el("span", "dot"));
    c.append(h);

    const bits = [];
    if (!p.exists) bits.push("folder not found");
    else if (!p.hasFile) bits.push("no milestone written down");
    else bits.push(`${p.mainStats.done}/${p.mainStats.total} milestones`);
    const small = p.stats.total - p.mainStats.total;
    if (small) bits.push(`${small} step${small > 1 ? "s" : ""}`);
    if (p.sessions.length) bits.push(`${p.sessions.length} session${p.sessions.length > 1 ? "s" : ""}`);
    const opened = p.terminals.filter((t) => t.alive).length;
    if (opened) bits.push(opened > 1 ? `${opened} terminals here` : "1 terminal here");
    c.append(el("div", "sub", bits.join(" · ")));

    // La carte ne montre QUE les milestones, et parmi eux ceux qui bougent ou coincent.
    // Les petites étapes attendent qu'on ouvre le projet : les faire remonter ici
    // reproduirait la page illisible qu'on essaie de régler.
    const hot = mains(p).filter((m) => m.status === "doing" || m.status === "blocked");
    if (hot.length) {
      const ul = el("ul");
      for (const m of hot.slice(0, 5)) {
        const li = el("li");
        li.append(el("span", null, m.status === "blocked" ? "⛔" : "▸"));
        li.append(el("b", null, m.title));
        if (m.due) li.append(dueTag(m.due));
        const sub = kids(p, m.id);
        if (sub.length) li.append(el("span", "prog", `${sub.filter((k) => k.status === "done").length}/${sub.length}`));
        ul.append(li);
      }
      c.append(ul);
    } else {
      c.append(el("div", "empty", p.mainStats.total ? "nothing in progress" : "no map yet — ✦ draws a first one"));
    }

    const note = genNote(p);
    if (note) c.append(note);

    const row = el("div", "ms-row");
    row.style.cssText = "display:flex;gap:6px;margin-top:12px;flex-wrap:wrap";
    const open = el("button", "btn ghost", "Open");
    open.onclick = () => { state.selected = p.id; writeHash(); render(); };
    const term = el("button", "btn ghost", "＋ Terminal");
    term.onclick = () => openTerminal(p.id, "claude");
    row.append(open, term);
    if (p.exists) row.append(genButton(p, "btn ghost"));
    c.append(row);
    cards.append(c);
  }
  view.append(cards);
}

function dueTag(due) {
  const days = Math.round((new Date(due + "T12:00:00") - Date.now()) / 86400000);
  const t = el("span", "due" + (days < 0 ? " late" : days <= 7 ? " soon" : ""), due);
  t.title = days < 0 ? `${-days} day${days < -1 ? "s" : ""} late` : `in ${days} day${days > 1 ? "s" : ""}`;
  return t;
}

/* --------------------------------------------------- génération des étapes */

// Un bouton, et le modèle va lire le dépôt. Ce qu'il propose est GREFFÉ : les milestones
// et les étapes qui manquent sont ajoutés, rien n'est remplacé, aucun statut n'est
// touché. C'est ce qui permet d'appuyer sans se demander ce qu'on va perdre — et ce
// qui rend le bouton utile deux fois : la première carte, puis les suivantes.
const GEN_TITLE =
  "Claude reads the repository (README, CLAUDE.md, latest commits) and proposes milestones.\n" +
  "They are ADDED to MILESTONES.md: nothing is replaced, no status is touched.\n" +
  "Expect one to three minutes.";

function genButton(p, cls) {
  const busy = Boolean(p.gen?.running);
  const b = el("button", cls + (busy ? " busy" : ""), busy ? "◌ Reading the repo…" : p.hasFile ? "✦ Complete" : "✦ Generate milestones");
  b.title = GEN_TITLE;
  b.disabled = busy || !p.exists;
  b.onclick = () => generate(p);
  return b;
}

// Ce que la dernière génération a donné. Affiché tant que le projet est à l'écran :
// l'appel est long, et une erreur avalée en silence ferait croire à un bouton mort.
function genNote(p) {
  const g = p.gen;
  if (!g || g.running) return null;
  // Une erreur reste affichée : c'est la seule trace d'un clic qui n'a rien donné.
  // Un succès, lui, s'efface — le résultat est sous les yeux, dans les cartes.
  if (g.error) return el("div", "gen err", "✕ " + g.error);
  if (!g.endedAt || Date.now() - g.endedAt > 10 * 60 * 1000) return null;
  return el("div", "gen", g.added ? `✓ ${g.added} line${g.added > 1 ? "s" : ""} added` : "✓ nothing to add, the map is up to date");
}

async function generate(p) {
  if (p.gen?.running) return;
  try {
    await api("POST", `/api/projects/${p.id}/generate`);
    // On peint tout de suite l'état « en cours » : le rafraîchissement suivant, quatre
    // secondes plus tard, prendrait le relais trop tard pour que le clic ait l'air pris.
    p.gen = { running: true, startedAt: Date.now(), endedAt: 0, added: 0, error: null };
    render();
  } catch (e) { alert("Generation failed: " + e.message); }
}

/* --------------------------------------------------- graphe de connaissance */

// Le pendant gratuit du bouton ✦ : là où la génération d'étapes appelle le modèle,
// celle-ci lit le code par AST, en local. Un projet ajouté au registre l'a déjà reçue
// sans rien demander ; ce bouton sert aux projets d'avant et aux graphes périmés.
const GRAPH_TITLE =
  "Builds a Graphify knowledge graph of the code (graphify-out/).\n" +
  "Local AST extraction: no API key, no tokens, a few seconds.\n" +
  "Claude then queries it instead of re-reading the whole repository.";

function graphButton(p, cls) {
  const g = p.graph;
  const busy = Boolean(g?.job?.running);
  const label = busy ? "◌ Reading the code…" : g?.built ? "◈ Rebuild graph" : "◈ Build graph";
  const b = el("button", cls + (busy ? " busy" : "") + (g?.stale && !busy ? " warn" : ""), label);
  b.title = GRAPH_TITLE;
  b.disabled = busy || !p.exists || !state.data?.graphify;
  if (!state.data?.graphify) b.title = "graphify is not installed — run: uv tool install graphifyy";
  b.onclick = () => buildGraph(p);
  return b;
}

// Une ligne, discrète, sous l'en-tête. Elle dit trois choses et pas une de plus :
// la taille du graphe, de quel commit il a été tiré, et s'il a pris du retard.
function graphNote(p) {
  const g = p.graph;
  if (!g) return null;
  if (g.job?.error) return el("div", "gen err", "✕ " + g.job.error);
  if (g.job?.running) return el("div", "gnote", "◌ Building the knowledge graph…");
  if (!g.built) return null;
  const line = el("div", "gnote" + (g.stale ? " stale" : ""));
  line.append(el("span", null, `◈ ${g.nodes.toLocaleString("en")} nodes · ${g.edges.toLocaleString("en")} edges`));
  // Les blancs de bord d'un item flex sont mangés : les séparateurs portent donc
  // leur propre espacement par le `gap`, jamais par une espace dans le texte.
  if (g.commit) line.append(el("span", "faint", `· built from ${g.commit.slice(0, 8)}`));
  if (g.stale) line.append(el("span", "faint", "· the repo has moved since"));
  return line;
}

async function buildGraph(p) {
  if (p.graph?.job?.running) return;
  try {
    await api("POST", `/api/projects/${p.id}/graph`);
    // Même raison que pour la génération : peindre « en cours » tout de suite, sinon
    // le clic paraît perdu jusqu'au rafraîchissement suivant.
    p.graph = { ...(p.graph || { built: false }), job: { running: true, startedAt: Date.now(), endedAt: 0, error: null } };
    render();
  } catch (e) { alert("Graph build failed: " + e.message); }
}

/* ---------------------------------------------------------- vue projet */

// La page d'un projet tient en deux étages, et cette séparation EST la vue : en haut
// ce que le dépôt est — son README, sa branche, son graphe, son histoire —, en bas ce
// qu'il reste à en faire. Le premier étage se lit une fois et donne le contexte ; le
// second se travaille, et c'est là que vivent les milestones.
function renderProject(view, p) {
  const head = el("div", "phead");
  head.append(el("span", "pe", p.emoji));
  head.append(el("h1", null, p.name));
  head.append(el("span", "grow"));

  const bClaude = el("button", "btn primary", "＋ Claude here");
  bClaude.onclick = () => openTerminal(p.id, "claude");
  const bShell = el("button", "btn", "＋ Shell");
  bShell.onclick = () => openTerminal(p.id, "shell");
  const bDrop = el("button", "btn ghost", "Remove");
  bDrop.title = "Stops tracking the project. Its MILESTONES.md stays in the repository.";
  bDrop.onclick = async () => {
    if (!confirm(`Stop tracking “${p.name}”?\nNo file will be deleted.`)) return;
    await api("DELETE", `/api/projects/${p.id}`);
    state.selected = "";
    writeHash();
    refresh();
  };
  head.append(bClaude, bShell, bDrop);
  view.append(head);

  if (!p.exists) {
    view.append(el("div", "empty", "This project's folder is no longer at that address."));
    return;
  }

  view.append(previewPanel(p));
  view.append(milestoneList(p));
}

/* -------------------------------------------------------------- l'aperçu */

// L'aperçu coûte un `git log`, un `git status` et une lecture du README : trop cher
// pour la boucle des quatre secondes, assez peu pour être relu à chaque ouverture d'un
// projet. D'où ce cache d'une minute — et un rendu qui se contente de ce qu'il a
// plutôt que d'attendre : la page s'affiche, l'aperçu s'y pose une fraction de
// seconde plus tard.
const previews = new Map(); // projectId -> { at, data }
const PREVIEW_TTL = 60_000;

function preview(p) {
  const cur = previews.get(p.id);
  if (cur && Date.now() - cur.at < PREVIEW_TTL) return cur.data;
  // La tentative est notée AVANT de partir. Sans ça, un dossier qui répond en erreur
  // relancerait un appel à chaque rendu, soit quinze par minute pour rien.
  previews.set(p.id, { at: Date.now(), data: cur?.data || null });
  api("GET", `/api/projects/${p.id}/preview`)
    .then((data) => { previews.set(p.id, { at: Date.now(), data }); render(); })
    .catch(() => { /* l'aperçu est un supplément : son absence ne casse pas la page */ });
  return cur?.data || null;
}

function previewPanel(p) {
  const box = el("section", "pv");
  const pv = preview(p);

  const left = el("div", "pv-main");
  left.append(el("div", "pv-label", "Preview"));

  const blurb = el("div", "pv-blurb");
  if (pv?.blurb?.text) blurb.textContent = pv.blurb.text;
  else blurb.append(el("i", null, pv ? "No README in this repository." : "Reading the repository…"));
  left.append(blurb);

  const meta = el("div", "pv-meta");
  meta.append(el("code", null, p.path.replace(/^\/Users\/[^/]+/, "~")));
  if (pv?.langs?.top.length) meta.append(el("span", null, pv.langs.top.map((l) => `${l.name} ${l.n}`).join(" · ")));
  if (pv?.langs) meta.append(el("span", null, `${pv.langs.files} files`));
  left.append(meta);

  // La dernière ligne d'histoire : la branche, le dernier commit, et ce qui n'est pas
  // encore enregistré. Trois faits qui disent en un coup d'œil si le dépôt est au
  // repos ou au milieu de quelque chose.
  if (pv?.git) {
    const g = el("div", "pv-git");
    g.append(el("span", "branch", "⑂ " + (pv.git.branch || "detached")));
    if (pv.git.last) {
      g.append(el("code", null, pv.git.last.short));
      g.append(el("span", "msg", pv.git.last.subject));
      g.append(el("span", "faint", ago(pv.git.last.at)));
    } else g.append(el("span", "faint", "no commit yet"));
    if (pv.git.dirty) g.append(el("span", "dirty", `${pv.git.dirty} uncommitted`));
    left.append(g);
  } else if (pv) {
    left.append(el("div", "pv-git", "Not a git repository."));
  }

  box.append(left);

  const tiles = el("div", "pv-tiles");
  const ms = p.mainStats;
  tiles.append(tile("Milestones", `${ms.done}/${ms.total}`, ms.doing ? `${ms.doing} in progress` : ms.blocked ? `${ms.blocked} blocked` : "", ms.total ? ms.done / ms.total : 0));
  const steps = p.steps.filter((s) => s.parentId);
  const stepsDone = steps.filter((s) => s.status === "done").length;
  tiles.append(tile("Steps", steps.length ? `${stepsDone}/${steps.length}` : "—", steps.length ? "" : "none written down", steps.length ? stepsDone / steps.length : 0));
  const here = p.terminals.filter((t) => t.alive).length;
  tiles.append(tile("Sessions", String(p.sessions.length + here), here ? `${here} here` : p.sessions.length ? "elsewhere" : "none live"));
  tiles.append(tile("Graph", p.graph?.built ? p.graph.nodes.toLocaleString("en") : "—", p.graph?.built ? (p.graph.stale ? "stale" : `${p.graph.edges.toLocaleString("en")} edges`) : "not built"));
  box.append(tiles);

  // Les deux portes de l'étage du haut. Elles ouvrent des vues en lecture seule : le
  // graphe du code et l'arbre des commits ne se modifient pas depuis ici.
  const acts = el("div", "pv-acts");

  const bGraph = el("button", "btn", "◈ Knowledge graph");
  bGraph.disabled = !p.graph?.built;
  bGraph.title = p.graph?.built
    ? "See the code as a graph: what calls what, and which symbols are the hubs."
    : "No graph in this repository yet — build it first.";
  bGraph.onclick = () => openViewer("graph", p);

  const bGit = el("button", "btn", "⑂ Git tree");
  bGit.disabled = !pv?.git;
  bGit.title = "The commit tree, branches side by side.";
  bGit.onclick = () => openViewer("git", p);

  acts.append(bGraph, bGit, el("span", "grow"), graphButton(p, "btn ghost"), genButton(p, "btn ghost"));
  box.append(acts);

  const gnote = graphNote(p);
  if (gnote) box.append(gnote);
  const note = genNote(p);
  if (note) box.append(note);

  if (p.sessions.length) {
    box.append(el("div", "pv-sessions", "Live sessions: " + p.sessions.map((s) => `${s.name || s.sessionId.slice(0, 8)} (${s.kind})`).join(" · ")));
  } else if (!p.hasFile) {
    box.append(el("div", "pv-sessions", "MILESTONES.md will be created with the first milestone."));
  }

  return box;
}

function tile(label, value, sub, ratio) {
  const t = el("div", "tile");
  t.append(el("div", "tl", label));
  t.append(el("div", "tv", value));
  if (ratio != null) {
    const g = el("div", "gauge");
    const i = el("i");
    i.style.width = `${Math.round(ratio * 100)}%`;
    g.append(i);
    t.append(g);
  }
  if (sub) t.append(el("div", "ts", sub));
  return t;
}

// Une date relative sans dépendance : au-delà d'un mois, la date exacte n'apprend
// plus rien qu'un « il y a deux mois » ne dise mieux.
function ago(ms) {
  const s = Math.max(1, Math.round((Date.now() - ms) / 1000));
  if (s < 90) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 36) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d < 31) return `${d} day${d > 1 ? "s" : ""} ago`;
  const mo = Math.round(d / 30);
  return mo < 18 ? `${mo} month${mo > 1 ? "s" : ""} ago` : `${Math.round(mo / 12)} years ago`;
}

/* ---------------------------------------------------------- les milestones */

// Le repli est un état d'interface, et il survit pourtant au rechargement : refermer
// huit milestones à chaque retour sur un projet serait le détail qui fait abandonner
// l'app. Il ne va pas dans le `MILESTONES.md` pour autant — le fichier appartient au
// dépôt, et l'état d'un pli n'y a rien à faire.
const OPEN_KEY = "pyra.open";
const opened = new Map(readOpen());
function readOpen() {
  try { return JSON.parse(localStorage.getItem(OPEN_KEY) || "[]"); } catch { return []; }
}
const openKey = (p, m) => `${p.id}:${m.id}`;

// Sans choix explicite de l'utilisateur, ce qui bouge ou coince s'ouvre : c'est ce
// qu'il vient voir. Le reste attend qu'on le demande.
const isOpen = (p, m) => {
  const k = openKey(p, m);
  return opened.has(k) ? opened.get(k) : m.status === "doing" || m.status === "blocked";
};
function setOpen(p, list, v) {
  for (const m of list) opened.set(openKey(p, m), v);
  // Le registre des plis ne grandit pas indéfiniment : un projet retiré ou un
  // milestone supprimé y laisserait sa clé pour toujours.
  const kept = [...opened].slice(-400);
  opened.clear();
  for (const [k, val] of kept) opened.set(k, val);
  localStorage.setItem(OPEN_KEY, JSON.stringify(kept));
  render();
}

function milestoneList(p) {
  const box = el("section", "mlist");
  const all = mains(p);

  const head = el("div", "mhead");
  head.append(el("h2", null, "Milestones"));
  const counts = ORDER.reduce((o, k) => ({ ...o, [k]: all.filter((m) => m.status === k).length }), {});
  head.append(el("span", "faint", all.length ? `${counts.done}/${all.length} done` : "none yet"));
  head.append(el("span", "grow"));

  // Le filtre remplace les quatre colonnes d'avant : même information, mais la liste
  // garde l'ORDRE DU FICHIER, qui est celui que l'utilisateur a écrit. Un tableau
  // rangé par statut le perdait, et avec lui le fil de la feuille de route.
  const filters = el("div", "mfilters");
  for (const key of ["all", ...ORDER]) {
    const n = key === "all" ? all.length : counts[key];
    const b = el("button", "fchip " + key + (state.filter === key ? " on" : ""), `${key === "all" ? "All" : STATUS[key].label} ${n}`);
    b.onclick = () => { state.filter = key; render(); };
    filters.append(b);
  }
  head.append(filters);

  const list = state.filter === "all" ? all : all.filter((m) => m.status === state.filter);
  const anyOpen = list.some((m) => isOpen(p, m));
  const fold = el("button", "btn ghost", anyOpen ? "Collapse all" : "Expand all");
  fold.onclick = () => setOpen(p, list, !anyOpen);
  head.append(fold);

  const add = el("button", "btn", "＋ New milestone");
  add.onclick = () => addStep(p);
  head.append(add);
  box.append(head);

  if (!all.length) {
    box.append(el("div", "empty", p.hasFile
      ? "This project has no milestone yet. ✦ reads the repository and proposes a first map."
      : "No MILESTONES.md yet. ✦ writes a first one from the repository, or ＋ starts it by hand."));
    return box;
  }
  if (!list.length) box.append(el("div", "empty", "No milestone with this status."));
  for (const m of list) box.append(msRow(p, m));
  return box;
}

// Un milestone plié tient sur une ligne : sa pastille, son titre, l'avancement de ses
// étapes. Déplié, il montre ce qu'il contient vraiment — la note, les étapes une à
// une, l'échéance, et les deux gestes qu'on lui fait. C'est le « détail intermédiaire »
// que la vue d'ensemble s'interdit de montrer, ici à un clic.
function msRow(p, m) {
  const open = isOpen(p, m);
  const sub = kids(p, m.id);
  const done = sub.filter((k) => k.status === "done").length;

  const row = el("article", "mrow " + m.status + (open ? " open" : ""));

  const head = el("header");
  head.title = open ? "Collapse" : "Expand — steps, note, due date";
  head.onclick = (e) => { if (!e.target.closest("button, input, .mt")) setOpen(p, [m], !open); };

  const caret = el("button", "caret", "›");
  caret.title = open ? "Collapse" : "Expand";
  caret.onclick = () => setOpen(p, [m], !open);
  head.append(caret);

  const mark = el("button", "mark");
  mark.title = `${STATUS[m.status].label} → ${STATUS[STATUS[m.status].next].label}`;
  mark.onclick = () => save(p, m, { status: STATUS[m.status].next });
  head.append(mark);

  const t = el("span", "mt", m.title || "(untitled)");
  t.title = "Click to rename";
  t.onclick = () => edit(t, m.title, (v) => save(p, m, { title: v }));
  head.append(t);

  if (!open && m.detail) head.append(el("span", "mnote", m.detail.replace(/\s+/g, " ")));
  head.append(el("span", "grow"));

  if (sub.length) {
    const g = el("span", "mgauge");
    const i = el("i");
    i.style.width = `${Math.round((done / sub.length) * 100)}%`;
    g.append(i);
    head.append(g);
    head.append(el("span", "prog", `${done}/${sub.length}`));
  }
  if (m.due) head.append(dueTag(m.due));
  head.append(el("span", "stat", STATUS[m.status].label));
  row.append(head);

  if (!open) return row;

  const body = el("div", "mbody");

  const detail = el("div", "d", m.detail || "");
  detail.title = "Click to write a note";
  detail.onclick = () => edit(detail, m.detail, (v) => save(p, m, { detail: v }), true);
  body.append(detail);

  const subs = el("div", "subs");
  for (const k of sub) subs.append(subRow(p, k));
  const addSub = el("button", "addsub", "＋ step");
  addSub.title = "Break this milestone into concrete moves";
  addSub.onclick = () => addStep(p, m.id);
  subs.append(addSub);
  body.append(subs);

  const foot = el("div", "mfoot");
  foot.append(statusPicker(p, m));

  // Un champ date vide sur un milestone déjà fait n'affiche qu'un « jj/mm/aaaa »
  // inutile. On ne le montre que s'il porte une information, ou s'il peut encore
  // en recevoir une.
  if (m.status !== "done" || m.due) {
    const due = el("input", "chip");
    due.type = "date";
    due.value = m.due || "";
    due.title = "Due date";
    due.onchange = () => save(p, m, { due: due.value || null });
    foot.append(due);
  }

  if (m.done) foot.append(el("span", "faint", "done " + m.done));
  foot.append(el("span", "grow"));

  // Le geste central de l'app : passer d'un milestone écrit à un Claude qui travaille
  // dessus, dans le bon dossier, sans retaper le contexte. Rien à attaquer sur un
  // milestone fini — le bouton n'apparaît pas.
  if (m.status !== "done") {
    const go = el("button", "chip go", "▶ Start");
    go.title = "Opens a Claude terminal in this project, with the milestone and its steps already pasted (not sent).";
    go.onclick = () => openTerminal(p.id, "claude", promptFor(p, m), m.title);
    foot.append(go);
  }

  const del = el("button", "chip", "✕ Delete");
  del.title = "Delete this milestone";
  del.onclick = () => {
    const warn = sub.length ? `\nIts ${sub.length} steps go with it.` : "";
    if (confirm(`Delete “${m.title}”?${warn}`)) save(p, m, null);
  };
  foot.append(del);
  body.append(foot);

  row.append(body);
  return row;
}

// Les quatre statuts en clair une fois le milestone ouvert. La pastille de l'en-tête
// fait tourner le statut d'un clic, ce qui va vite mais oblige à passer par les
// autres ; ici on désigne celui qu'on veut.
function statusPicker(p, m) {
  const box = el("span", "picker");
  for (const key of ORDER) {
    const b = el("button", "pk " + key + (m.status === key ? " on" : ""), STATUS[key].label);
    b.onclick = () => { if (m.status !== key) save(p, m, { status: key }); };
    box.append(b);
  }
  return box;
}

// Une étape tient sur une ligne : sa pastille de statut, son titre, et les deux
// gestes qu'on lui fait vraiment — l'attaquer, la supprimer. Tout le reste (note,
// échéance) appartient au milestone : le répéter à chaque ligne noierait la carte.
function subRow(p, k) {
  const row = el("div", "sub " + k.status);
  const mark = el("button", "mark");
  mark.title = `${STATUS[k.status].label} → ${STATUS[STATUS[k.status].next].label}`;
  mark.onclick = () => save(p, k, { status: STATUS[k.status].next });
  row.append(mark);

  const t = el("span", "st", k.title || "(untitled)");
  t.onclick = () => edit(t, k.title, (v) => save(p, k, { title: v }));
  row.append(t);

  if (k.status !== "done") {
    const go = el("button", "act", "▶");
    go.title = "Open a Claude on this step";
    go.onclick = () => openTerminal(p.id, "claude", promptFor(p, k), k.title);
    row.append(go);
  }
  const del = el("button", "act", "✕");
  del.title = "Delete this step";
  del.onclick = () => { if (confirm(`Delete “${k.title}”?`)) save(p, k, null); };
  row.append(del);
  return row;
}

// Le texte déposé dans l'invite. Pour un milestone, ses étapes non faites partent avec :
// c'est exactement le contexte qu'on retaperait à la main sinon.
const promptFor = (p, m) => {
  const detail = (m.detail || "").replace(/\s+/g, " ").trim();
  const sub = kids(p, m.id).filter((k) => k.status !== "done").map((k) => `— ${k.title}`);
  const what = m.parentId ? "Step" : "Milestone";
  return `${what} of project ${p.name}: ${m.title}.` +
    (detail ? ` Context: ${detail}` : "") +
    (sub.length ? ` What is left underneath:\n${sub.join("\n")}\n` : "") +
    ` Tell me first how you plan to go about it.`;
};

// Édition sur place : on remplace le bloc par un textarea, on enregistre au blur.
function edit(node, value, onSave, multiline = false) {
  const ta = el("textarea");
  ta.value = value || "";
  ta.rows = multiline ? 3 : 1;
  node.replaceWith(ta);
  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);
  let done = false;
  const finish = (commit) => {
    if (done) return;
    done = true;
    if (commit && ta.value !== (value || "")) onSave(ta.value.trim());
    else render();
  };
  ta.onblur = () => finish(true);
  ta.onkeydown = (e) => {
    if (e.key === "Escape") { e.preventDefault(); finish(false); }
    if (e.key === "Enter" && (!multiline || e.metaKey)) { e.preventDefault(); ta.blur(); }
  };
}

// Un enregistrement = la liste complète du projet renvoyée au serveur, qui la
// refusionne sur le fichier relu du disque. Pas de patch partiel : le fichier peut
// avoir été modifié à la main entre-temps, et c'est lui qui fait foi.
// Supprimer un milestone emporte ses étapes : orphelines, elles remonteraient au premier
// niveau et se retrouveraient milestones à leur tour.
async function save(p, m, patch) {
  const drop = patch === null ? new Set([m.id, ...kids(p, m.id).map((k) => k.id)]) : null;
  const items = p.steps
    .map((x) => (drop ? (drop.has(x.id) ? null : x) : x.id === m.id ? { ...x, ...patch } : x))
    .filter(Boolean);
  try {
    const out = await api("PUT", `/api/projects/${p.id}/steps`, { items });
    p.steps = out.items;
    refresh();
  } catch (e) {
    alert("Could not save: " + e.message);
  }
}

async function addStep(p, parentId = null) {
  const title = prompt(parentId ? "New step:" : "New milestone:");
  if (!title || !title.trim()) return;
  const items = [...p.steps, {
    id: "new-" + Math.random().toString(36).slice(2, 8),
    depth: parentId ? 1 : 0, parentId,
    status: "todo", title: title.trim(), detail: "", due: null,
  }];
  try {
    const out = await api("PUT", `/api/projects/${p.id}/steps`, { items });
    p.steps = out.items;
    refresh();
  } catch (e) { alert("Could not save: " + e.message); }
}

/* --------------------------------------------------- les deux visionneuses */

// Deux vues en LECTURE SEULE, chacune dans son dialogue plein écran : le graphe du
// code, et l'arbre des commits. Ni l'une ni l'autre n'écrit quoi que ce soit — elles
// donnent à voir ce que le dépôt contient déjà, et rien d'autre.
//
// Elles ont une adresse (`#p=<projet>&d=graph`), pour la même raison que les onglets :
// une capture headless doit pouvoir les ouvrir sans qu'on ait à cliquer.

const svgNS = "http://www.w3.org/2000/svg";
const ns = (tag, attrs = {}) => {
  const n = document.createElementNS(svgNS, tag);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  return n;
};

// La palette des voies et des communautés. Elle part des deux bouts du dégradé de la
// marque et s'écarte juste assez pour que deux voies voisines ne se confondent pas.
const HUES = ["#6c34d6", "#3c5bf5", "#0e87a3", "#158a68", "#9a6a12", "#d1345b", "#8b4ae6", "#1020a0", "#0b6f86", "#7b849c"];
const hue = (i) => HUES[((i % HUES.length) + HUES.length) % HUES.length];

let shownViewer = ""; // ce qui est RÉELLEMENT à l'écran : le rendu passe toutes les 4 s

function openViewer(kind, p) {
  state.dialog = kind;
  writeHash();
  showViewer(kind, p);
}

function showViewer(kind, p) {
  if (shownViewer === kind + p.id) return;
  shownViewer = kind + p.id;
  const dlg = $("#" + kind);
  if (!dlg.open) dlg.showModal();
  (kind === "graph" ? drawGraph : drawGit)(p);
}

// Fermer par Échap ou par le bouton passe par le même chemin : l'adresse suit l'état
// visible, sinon un rechargement rouvrirait un dialogue que l'utilisateur a fermé.
for (const kind of ["graph", "git"]) {
  const dlg = $("#" + kind);
  dlg.addEventListener("close", () => {
    if (kind === "graph") stopGraph();
    shownViewer = "";
    if (state.dialog === kind) { state.dialog = ""; writeHash(); }
  });
  $(`#${kind}-close`).onclick = () => dlg.close();
}

/* ------------------------------------------------------------ l'arbre git */

const LANE_W = 15, ROW_H = 28, MAX_LANES = 12;
const lx = (l) => Math.min(l, MAX_LANES - 1) * LANE_W + 9;

async function drawGit(p) {
  const body = $("#git-body");
  body.textContent = "";
  $("#git-title").textContent = `Git tree — ${p.name}`;
  $("#git-meta").textContent = "reading the repository…";

  let data;
  try { data = await api("GET", `/api/projects/${p.id}/git`); }
  catch (e) { $("#git-meta").textContent = ""; body.append(el("div", "empty", "Could not read the history: " + e.message)); return; }
  if (shownViewer !== "git" + p.id) return; // le dialogue a été fermé pendant la lecture

  if (!data.repo) {
    $("#git-meta").textContent = "";
    body.append(el("div", "empty", "This project is not a git repository — nothing to draw."));
    return;
  }
  $("#git-meta").textContent =
    `${data.commits.length.toLocaleString("en")} of ${data.total.toLocaleString("en")} commits` +
    (data.branch ? ` · on ${data.branch}` : "") + ` · ${data.width} lane${data.width > 1 ? "s" : ""}`;

  const rows = el("div", "gitrows");
  for (const c of data.commits) rows.append(gitRow(c, data.width));
  body.append(rows);
  if (data.truncated) body.append(el("div", "empty", `Older commits are not drawn — the tree stops at ${data.commits.length}.`));
}

function gitRow(c, width) {
  const row = el("div", "gitrow");

  const lanes = Math.min(width, MAX_LANES);
  const svg = ns("svg", { class: "lanes", width: lanes * LANE_W + 6, height: ROW_H });
  const mid = ROW_H / 2;
  const x = lx(c.lane);

  // Ce qui traverse le rang sans s'y arrêter : un trait vertical, rien de plus.
  for (const l of c.through) svg.append(ns("path", { d: `M${lx(l)},0 V${ROW_H}`, stroke: hue(l), fill: "none", "stroke-width": 1.6 }));
  // Ce qui arrive d'en haut se rabat sur le commit ; ce qui en repart s'écarte vers
  // la voie de chaque parent. Les deux courbes gardent la couleur de LEUR voie, pas
  // celle du commit : c'est ce qui rend une branche suivable à l'œil.
  for (const l of c.ins) svg.append(ns("path", { d: `M${lx(l)},0 C${lx(l)},${mid * 0.6} ${x},${mid * 0.4} ${x},${mid}`, stroke: hue(l), fill: "none", "stroke-width": 1.6 }));
  for (const l of c.outs) svg.append(ns("path", { d: `M${x},${mid} C${x},${mid * 1.6} ${lx(l)},${mid * 1.4} ${lx(l)},${ROW_H}`, stroke: hue(l), fill: "none", "stroke-width": 1.6 }));

  // Une fusion porte un anneau, un commit ordinaire un disque plein : c'est la seule
  // chose que le dessin dit et que le texte ne dit pas.
  const merge = c.parents.length > 1;
  svg.append(ns("circle", {
    cx: x, cy: mid, r: merge ? 5 : 4,
    fill: merge ? "#fff" : hue(c.lane), stroke: hue(c.lane), "stroke-width": merge ? 2.5 : 1.5,
  }));
  row.append(svg);

  const hash = el("code", "gh", c.short);
  hash.title = c.hash + "\nClick to copy";
  hash.onclick = () => navigator.clipboard?.writeText(c.hash);
  row.append(hash);

  for (const r of c.refs) {
    const isHead = c.head && !r.startsWith("origin/") && !r.startsWith("tag:");
    row.append(el("span", "ref" + (isHead ? " head" : "") + (r.startsWith("tag:") ? " tag" : ""), r.replace(/^tag: /, "⌾ ")));
  }

  row.append(el("span", "gs", c.subject));
  row.append(el("span", "grow"));
  row.append(el("span", "ga", c.author));
  const when = el("span", "gd", ago(c.at));
  when.title = new Date(c.at).toLocaleString();
  row.append(when);
  return row;
}

/* --------------------------------------------------- le graphe de connaissance */

// Une force dirigée écrite à la main : l'app n'a pas d'étape de build, donc pas de
// bibliothèque de dessin. Trois forces suffisent — les noeuds se repoussent, les
// arêtes tirent, le centre rappelle — et la température (`alpha`) décroît jusqu'à
// l'arrêt. Sans cet arrêt, une animation permanente tournerait derrière le dialogue.
let graphStop = null;
function stopGraph() { if (graphStop) { graphStop(); graphStop = null; } }

async function drawGraph(p) {
  const body = $("#graph-body");
  stopGraph();
  body.textContent = "";
  $("#graph-title").textContent = `Knowledge graph — ${p.name}`;
  $("#graph-meta").textContent = "reading graphify-out…";
  $("#graph-q").value = "";

  let data;
  try { data = await api("GET", `/api/projects/${p.id}/graph-data`); }
  catch (e) { $("#graph-meta").textContent = ""; body.append(el("div", "empty", e.message)); return; }
  if (shownViewer !== "graph" + p.id) return;

  $("#graph-meta").textContent =
    `${data.total.toLocaleString("en")} nodes · ${data.totalLinks.toLocaleString("en")} edges` +
    (data.truncated ? ` · drawing the ${data.nodes.length} most connected` : "") +
    (data.state?.commit ? ` · built from ${data.state.commit.slice(0, 8)}` : "");

  if (!data.nodes.length) {
    body.append(el("div", "empty", "The graph is empty. Graphify reads CODE by AST — a repository made of markdown alone gives almost nothing."));
    return;
  }
  simulate(body, data);
}

function simulate(host, data) {
  const W = host.clientWidth || 900, H = host.clientHeight || 600;
  const svg = ns("svg", { class: "gcanvas" });
  const world = ns("g");
  svg.append(world);
  host.append(svg);

  const nodes = data.nodes.map((n, i) => {
    // Départ en spirale plutôt qu'au hasard : deux dessins successifs du même dépôt
    // se ressemblent, et on ne relit pas une carte qui a bougé pour rien.
    const a = i * 2.399, r = 12 * Math.sqrt(i + 1);
    return { ...n, x: W / 2 + Math.cos(a) * r, y: H / 2 + Math.sin(a) * r, vx: 0, vy: 0 };
  });
  const index = new Map(nodes.map((n) => [n.id, n]));
  const links = data.links.map((l) => ({ a: index.get(l.s), b: index.get(l.t), rel: l.rel })).filter((l) => l.a && l.b);

  const near = new Map(nodes.map((n) => [n.id, new Set()]));
  for (const l of links) { near.get(l.a.id).add(l.b.id); near.get(l.b.id).add(l.a.id); }

  const edgeEls = links.map((l) => {
    const e = ns("line", { class: "gedge" });
    world.append(e);
    return e;
  });
  const r = (n) => 3.2 + Math.sqrt(n.deg) * 1.5;
  const nodeEls = nodes.map((n) => {
    const c = ns("circle", { class: "gnode", r: r(n), fill: hue(n.group) });
    c.addEventListener("pointerenter", () => highlight(n));
    c.addEventListener("pointerleave", () => highlight(null));
    c.addEventListener("pointerdown", (e) => startDrag(e, n));
    c.addEventListener("click", () => pick(n));
    world.append(c);
    return c;
  });

  // On n'étiquette que les moyeux : quatre cents étiquettes ne se lisent pas, et
  // celles qui comptent — les god nodes du rapport — sont justement les plus reliées.
  // Au-delà d'une vingtaine, les étiquettes se recouvrent et aucune ne se lit plus.
  // Les autres noms sortent au survol et à la recherche, qui sont faits pour ça.
  const labelled = new Set([...nodes].sort((a, b) => b.deg - a.deg).slice(0, nodes.length > 250 ? 22 : 40).map((n) => n.id));
  const labelEls = nodes.map((n) => {
    const t = ns("text", { class: "glabel" });
    t.textContent = n.label;
    if (!labelled.has(n.id)) t.style.display = "none";
    world.append(t);
    return t;
  });

  const info = el("div", "ginfo");
  info.append(el("i", null, "Hover a node to see what it touches. Click one to keep it."));
  host.append(info);

  /* ------------------------------------------------------------ la simulation */

  let alpha = 1, raf = 0, dragging = null;
  const CENTER = { x: W / 2, y: H / 2 };
  const REPULSION = 1100, SPRING = 0.05, LENGTH = 40, DAMP = 0.78;
  // Le rappel au centre se desserre quand le graphe grossit : à densité égale, la
  // même force écrase quatre cents noeuds en boule là où elle tient deux cents
  // écartés. Les communautés ne se lisent qu'à ce prix.
  const GRAVITY = Math.max(0.006, Math.min(0.02, 4 / nodes.length));
  const CUTOFF = 320 * 320; // au-delà, deux noeuds ne se voient plus : c'est ce qui garde le n² tenable
  // Deux garde-fous, et ils ne sont pas décoratifs : deux noeuds qui se superposent
  // donnent une répulsion en 1/d² qui explose, et le noeud part à des milliers de
  // pixels d'où il ne revient pas — le dessin se retrouve alors cadré sur du vide.
  const MAX_FORCE = 22, MAX_STEP = 34;
  const clamp = (v, m) => (v > m ? m : v < -m ? -m : v);

  function step() {
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
        let dx = b.x - a.x, dy = b.y - a.y;
        let d2 = dx * dx + dy * dy;
        if (d2 > CUTOFF) continue;
        if (d2 < 1) { d2 = 1; dx = (i % 3) - 1 || 1; dy = (j % 3) - 1 || 1; }
        const d = Math.sqrt(d2), f = Math.min(REPULSION / d2, MAX_FORCE);
        const fx = (dx / d) * f, fy = (dy / d) * f;
        a.vx -= fx; a.vy -= fy; b.vx += fx; b.vy += fy;
      }
    }
    for (const l of links) {
      const dx = l.b.x - l.a.x, dy = l.b.y - l.a.y;
      const d = Math.hypot(dx, dy) || 0.01;
      const f = (d - LENGTH) * SPRING;
      const fx = (dx / d) * f, fy = (dy / d) * f;
      l.a.vx += fx; l.a.vy += fy; l.b.vx -= fx; l.b.vy -= fy;
    }
    for (const n of nodes) {
      if (n === dragging) { n.vx = n.vy = 0; continue; }
      n.vx += (CENTER.x - n.x) * GRAVITY;
      n.vy += (CENTER.y - n.y) * GRAVITY;
      n.x += clamp(n.vx * alpha, MAX_STEP); n.y += clamp(n.vy * alpha, MAX_STEP);
      n.vx *= DAMP; n.vy *= DAMP;
    }
  }

  function paint() {
    for (let i = 0; i < links.length; i++) {
      const e = edgeEls[i], l = links[i];
      e.setAttribute("x1", l.a.x); e.setAttribute("y1", l.a.y);
      e.setAttribute("x2", l.b.x); e.setAttribute("y2", l.b.y);
    }
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      nodeEls[i].setAttribute("cx", n.x); nodeEls[i].setAttribute("cy", n.y);
      labelEls[i].setAttribute("x", n.x + r(n) + 3); labelEls[i].setAttribute("y", n.y + 3.5);
    }
  }

  // Le dessin se pose AVANT d'être montré, en une salve de tours sans affichage.
  // Trois raisons, dans cet ordre : on ne fait pas regarder à l'utilisateur une
  // pelote qui se démêle pendant cinq secondes ; le cadrage a alors des positions
  // définitives à cadrer ; et le résultat ne dépend plus du rythme des images, donc
  // une capture headless montre exactement ce qu'un navigateur montre.
  const TURNS = nodes.length > 300 ? 200 : 320;
  for (let i = 0; i < TURNS; i++) { step(); alpha *= 0.986; }
  alpha = 0;

  // L'animation ne repart qu'au geste : traîner un noeud rouvre la boucle, et elle
  // se referme dès que le dessin s'est reposé.
  function frame() {
    step();
    paint();
    alpha *= 0.94;
    if (alpha > 0.02 || dragging) raf = requestAnimationFrame(frame);
    else { raf = 0; alpha = 0; }
  }
  const heat = (a = 0.3) => { alpha = Math.max(alpha, a); if (!raf) raf = requestAnimationFrame(frame); };
  graphStop = () => { cancelAnimationFrame(raf); raf = 0; alpha = 0; };

  /* ------------------------------------------------------- cadrage et navigation */

  let k = 1, tx = 0, ty = 0;
  const apply = () => world.setAttribute("transform", `translate(${tx},${ty}) scale(${k})`);

  function fit() {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const n of nodes) { x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y); x1 = Math.max(x1, n.x); y1 = Math.max(y1, n.y); }
    const w = svg.clientWidth || W, h = svg.clientHeight || H;
    k = Math.min(3, Math.max(0.05, Math.min((w - 90) / (x1 - x0 || 1), (h - 90) / (y1 - y0 || 1))));
    tx = w / 2 - ((x0 + x1) / 2) * k;
    ty = h / 2 - ((y0 + y1) / 2) * k;
    apply();
  }

  // Premier (et souvent dernier) affichage : les positions sont déjà définitives.
  paint();
  fit();

  svg.addEventListener("wheel", (e) => {
    e.preventDefault();
    const rect = svg.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const f = Math.exp(-e.deltaY * 0.0016);
    const next = Math.min(6, Math.max(0.12, k * f));
    // Le zoom garde sous le curseur le point qui s'y trouvait : sans ça, il faut
    // repanner après chaque cran de molette.
    tx = mx - ((mx - tx) / k) * next;
    ty = my - ((my - ty) / k) * next;
    k = next;
    apply();
  }, { passive: false });

  let pan = null;
  svg.addEventListener("pointerdown", (e) => {
    if (dragging) return;
    pan = { x: e.clientX - tx, y: e.clientY - ty };
    svg.setPointerCapture(e.pointerId);
  });
  svg.addEventListener("pointermove", (e) => {
    if (dragging) {
      const rect = svg.getBoundingClientRect();
      dragging.x = (e.clientX - rect.left - tx) / k;
      dragging.y = (e.clientY - rect.top - ty) / k;
      // Sans ce coup de chaud, le voisinage reste figé pendant qu'on traîne un noeud :
      // la température retombe en une seconde, et le graphe cesse de suivre la main.
      heat(0.12);
      paint();
      return;
    }
    if (!pan) return;
    tx = e.clientX - pan.x; ty = e.clientY - pan.y;
    apply();
  });
  const release = () => { pan = null; if (dragging) { dragging = null; heat(0.25); } };
  svg.addEventListener("pointerup", release);
  svg.addEventListener("pointercancel", release);

  function startDrag(e, n) { e.stopPropagation(); dragging = n; heat(0.2); }

  /* --------------------------------------------------------- lire un noeud */

  let held = null;
  const pick = (n) => { held = held === n ? null : n; highlight(held || n); };

  function highlight(n) {
    const focus = n || held;
    const kin = focus ? near.get(focus.id) : null;
    for (let i = 0; i < nodes.length; i++) {
      const on = !focus || nodes[i] === focus || kin.has(nodes[i].id);
      nodeEls[i].classList.toggle("dim", !on);
      nodeEls[i].classList.toggle("on", Boolean(focus) && nodes[i] === focus);
      labelEls[i].style.display = (focus ? on : labelled.has(nodes[i].id)) ? "" : "none";
    }
    for (let i = 0; i < links.length; i++) {
      const on = !focus || links[i].a === focus || links[i].b === focus;
      edgeEls[i].classList.toggle("dim", !on);
      edgeEls[i].classList.toggle("on", Boolean(focus) && on);
    }
    info.textContent = "";
    if (!focus) { info.append(el("i", null, "Hover a node to see what it touches. Click one to keep it.")); return; }
    info.append(el("b", null, focus.label));
    if (focus.file) info.append(el("code", null, focus.file + (focus.loc ? ":" + focus.loc.replace(/^L/, "") : "")));
    info.append(el("span", "faint", `${focus.deg} edge${focus.deg > 1 ? "s" : ""}`));
    const list = el("div", "gkin");
    for (const l of links) {
      if (l.a !== focus && l.b !== focus) continue;
      const other = l.a === focus ? l.b : l.a;
      const way = l.a === focus ? "→" : "←";
      list.append(el("div", null, `${way} ${l.rel || "linked"} ${other.label}`));
      if (list.childElementCount >= 14) break;
    }
    info.append(list);
  }

  // La recherche ne filtre pas, elle DÉSIGNE : retirer les noeuds sans correspondance
  // ferait perdre le voisinage, qui est tout ce qu'on vient chercher dans un graphe.
  const q = $("#graph-q");
  q.oninput = () => {
    const s = q.value.trim().toLowerCase();
    for (let i = 0; i < nodes.length; i++) {
      const hit = Boolean(s) && (nodes[i].label.toLowerCase().includes(s) || (nodes[i].file || "").toLowerCase().includes(s));
      nodeEls[i].classList.toggle("hit", hit);
      if (s) labelEls[i].style.display = hit ? "" : "none";
      else labelEls[i].style.display = labelled.has(nodes[i].id) ? "" : "none";
    }
  };

  $("#graph-fit").onclick = () => { fit(); heat(0.2); };
}

/* ------------------------------------------------------------ terminaux */

async function openTerminal(projectId, kind, seed, label) {
  try {
    const { id } = await api("POST", "/api/terminals", { projectId, kind, label });
    showView("terms");
    await refresh();
    const pane = panes.get(id);
    if (pane && seed) { pane.seed = seed; pane.text = seed; }
    pane?.term.focus();
  } catch (e) { alert("Could not open a terminal: " + e.message); }
}

function renderTerms() {
  const grid = $("#grid");
  const live = state.data.projects.flatMap((p) => p.terminals.map((t) => ({ ...t, project: p })));
  const wanted = new Set(live.map((t) => t.id));

  for (const [id, pane] of panes) {
    if (!wanted.has(id)) { pane.ws?.close(); pane.term.dispose(); pane.root.remove(); panes.delete(id); layout(); }
  }

  $("#term-count").textContent = String(live.filter((t) => t.alive).length);
  $$(".blank", grid).forEach((n) => n.remove());
  if (!live.length) {
    grid.append(el("div", "blank", "No terminal yet. Open one from a project, or from the ▶ button of a milestone."));
    return;
  }

  const before = panes.size;
  for (const t of live) {
    if (panes.has(t.id)) { panes.get(t.id).root.classList.toggle("dead", !t.alive); continue; }
    grid.append(makePane(t));
  }
  if (panes.size !== before) layout();
}

function makePane(t) {
  const root = el("div", "pane" + (t.alive ? "" : " dead"));
  const head = el("header");
  head.append(el("span", null, t.project.emoji));
  head.append(el("span", "name", t.label || t.project.name));
  head.append(el("span", "kind", t.kind));
  head.append(el("span", "grow"));

  // Le collage automatique peut rater (un dialogue de Claude l'avale). Ce bouton
  // reste le filet : l'étape est toujours à un clic, jamais perdue.
  const paste = el("button", null, "⌥ step");
  paste.title = "Paste the step into the prompt (without sending it)";
  paste.style.display = "none";
  paste.onclick = () => pasteSeed(t.id);
  head.append(paste);

  const solo = el("button", null, "⤢");
  solo.title = "Single column";
  solo.onclick = () => { $("#cols").value = "1"; setCols(); };
  const close = el("button", null, "✕");
  close.title = "Close and stop the session";
  close.onclick = async () => {
    if (t.alive && !confirm("Stop this session?")) return;
    await api("DELETE", `/api/terminals/${t.id}`);
    refresh();
  };
  head.append(solo, close);
  root.append(head);

  const host = el("div", "term");
  root.append(host);

  const term = new Terminal({
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: 12.5, lineHeight: 1.15, cursorBlink: true, scrollback: 8000, allowProposedApi: true,
    theme: {
      // Encre et fond du mot-symbole ; le curseur porte l'accent du logo.
      background: "#ffffff", foreground: "#000823", cursor: "#4a45e8", selectionBackground: "#ddd9fd",
      black: "#000823", red: "#c22f52", green: "#0f7a5b", yellow: "#8a5a06", blue: "#3c5bf5",
      magenta: "#6c34d6", cyan: "#0b6f86", white: "#626c86",
      brightBlack: "#9aa2b8", brightRed: "#d1345b", brightGreen: "#158a68", brightYellow: "#a9700a",
      brightBlue: "#4a45e8", brightMagenta: "#8b4ae6", brightCyan: "#0e87a3", brightWhite: "#000823",
    },
  });
  const fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  term.open(host);

  const pane = { term, fit, root, ws: null, seed: null, text: null, tail: "", lastData: 0, booted: false, sized: false, sizeTimer: null, pasteBtn: paste };
  panes.set(t.id, pane);

  const ws = new WebSocket(`ws://${location.host}/pty?id=${t.id}`);
  pane.ws = ws;
  // Le pty n'existe pas encore côté serveur : c'est cette première mesure qui le
  // lance, à la bonne largeur. On la répète tant qu'elle n'a rien pu mesurer.
  ws.onopen = () => requestAnimationFrame(() => resize(t.id));
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.t === "ready") { if (m.replay) term.write(m.replay); resize(t.id); }
    else if (m.t === "out") {
      term.write(m.d);
      pane.lastData = Date.now();
      pane.booted = true;
      // Une queue de sortie débarrassée des codes ANSI : c'est le seul moyen de
      // savoir si un dialogue est à l'écran plutôt que l'invite de saisie.
      pane.tail = (pane.tail + m.d.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "").replace(/\x1b\][^\x07]*(\x07|\x1b\\)/g, "")).slice(-3000);
    }
    else if (m.t === "exit") { term.write(`\r\n\x1b[90m— session ended (code ${m.code}) —\x1b[0m\r\n`); refresh(); }
  };
  term.onData((d) => ws.readyState === 1 && ws.send(JSON.stringify({ t: "in", d })));
  new ResizeObserver(() => resize(t.id)).observe(host);

  return root;
}

// La PREMIÈRE mesure est celle qui lance le programme côté serveur, à sa largeur de
// naissance. Elle est temporisée : entre l'ouverture de la WebSocket et la pose de la
// grille, le panneau passe par une taille intermédiaire plus large. Envoyée telle
// quelle, elle faisait naître `claude` trop large, et le rétrécissement qui suivait
// laissait des mots coupés en travers du panneau. Les mesures suivantes, elles, sont
// de vrais redimensionnements : elles partent tout de suite.
function resize(id) {
  const pane = panes.get(id);
  if (!pane || !pane.root.isConnected || pane.root.offsetHeight === 0) return;
  try { pane.fit.fit(); } catch { return; }
  if (pane.ws?.readyState !== 1) return;
  const send = () => {
    pane.sized = true;
    pane.ws.send(JSON.stringify({ t: "size", cols: pane.term.cols, rows: pane.term.rows }));
  };
  if (pane.sized) return send();
  clearTimeout(pane.sizeTimer);
  pane.sizeTimer = setTimeout(send, 150);
}

// `claude` met une seconde ou deux à peindre son invite. Coller l'étape trop tôt
// le perdrait. On attend que le flux se taise : c'est le signe que l'invite est prête.
// Et on ne valide JAMAIS à la place de l'utilisateur — le texte est déposé, pas envoyé.
// Au premier lancement dans un dossier, Claude demande s'il faut lui faire confiance.
// Coller pendant ce dialogue enverrait l'étape dans un menu au lieu de l'invite — et
// une frappe y vaut réponse. Tant qu'une question est à l'écran, on ne touche à rien.
// Volontairement étroit : `❯` avait sa place ici jusqu'à ce qu'un test montre que
// c'est aussi le chevron de l'invite ordinaire — le collage n'arrivait alors jamais.
// On ne reconnaît que les formulations propres aux questions bloquantes.
const BLOCKING = /trust this folder|Yes, I trust|No, exit|Do you want to proceed|Enter to confirm/i;

function pasteSeed(id) {
  const pane = panes.get(id);
  if (!pane?.text) return;
  pane.seed = null;
  pane.ws?.send(JSON.stringify({ t: "in", d: `\x1b[200~${pane.text}\x1b[201~` }));
  pane.term.focus();
}

setInterval(() => {
  const now = Date.now();
  for (const [id, pane] of panes) {
    if (pane.pasteBtn) pane.pasteBtn.style.display = pane.text ? "" : "none";
    if (!pane.seed || !pane.booted || now - pane.lastData < 900) continue;
    if (BLOCKING.test(pane.tail.slice(-1200))) continue; // un dialogue attend une réponse
    pasteSeed(id);
  }
}, 300);

// Un seul rang de terminaux occupe toute la hauteur ; à partir de deux rangs, chacun
// prend la moitié et le reste défile. Sans ça, un terminal seul flottait au milieu
// d'un grand vide et trois terminaux débordaient sans raison.
function layout() {
  const grid = $("#grid");
  const n = $("#cols").value;
  grid.className = "grid cols-" + n;
  const rows = Math.ceil(panes.size / Number(n));
  grid.style.gridAutoRows = rows <= 1 ? "100%" : "calc(50% - 5px)";
  setTimeout(() => panes.forEach((_, id) => resize(id)), 60);
}

function setCols() {
  localStorage.setItem("pyra.cols", $("#cols").value);
  layout();
}

/* ------------------------------------------------------------------ vues */

function showView(v) {
  state.view = v;
  $$(".tab").forEach((b) => b.classList.toggle("on", b.dataset.view === v));
  $("#view-board").classList.toggle("hidden", v !== "board");
  $("#view-terms").classList.toggle("hidden", v !== "terms");
  writeHash();
  if (v === "terms") setTimeout(() => panes.forEach((_, id) => resize(id)), 60);
}

// Le rafraîchissement tourne toutes les 4 s. Sans cette garde, il effacerait le
// textarea ouvert au milieu d'une phrase — la façon la plus sûre de rendre l'app
// insupportable. On laisse le tableau tranquille tant qu'une saisie est en cours.
const editing = () => {
  const a = document.activeElement;
  return a && $("#view-board").contains(a) && /^(TEXTAREA|INPUT)$/.test(a.tagName);
};

function render() {
  if (!state.data) return;
  if (state.selected && !project(state.selected)) state.selected = "";
  renderSide();
  if (!editing()) {
    const view = $("#view-board");
    view.textContent = "";
    if (state.selected) renderProject(view, current());
    else renderOverview(view);
  }
  renderTerms();

  // Les visionneuses suivent l'adresse, pas le clic : c'est ce qui permet d'ouvrir
  // `#p=<projet>&d=graph` directement, à la main comme en capture headless.
  const p = current();
  if (state.dialog && p?.exists) showViewer(state.dialog, p);
  else for (const kind of ["graph", "git"]) if ($("#" + kind).open) $("#" + kind).close();
}

/* -------------------------------------------------- ajouter un projet */

async function browse(dir) {
  const q = dir ? `?dir=${encodeURIComponent(dir)}` : "";
  const data = await api("GET", "/api/browse" + q);
  $("#crumb").textContent = data.dir.replace(/^\/Users\/[^/]+/, "~");
  const ul = $("#dirs");
  ul.textContent = "";

  if (data.parent) {
    const li = el("li");
    const b = el("button", "up", "‹ parent folder");
    b.onclick = (e) => { e.preventDefault(); browse(data.parent); };
    li.append(b); ul.append(li);
  }
  for (const d of data.dirs) {
    const li = el("li");
    const b = el("button");
    b.append(el("span", null, "📁"), el("span", null, d.name));
    if (d.known) b.append(el("span", "known", "already tracked"));
    b.onclick = async (e) => {
      e.preventDefault();
      if (d.known) return browse(d.path);
      if (confirm(`Track “${d.name}”?\nOK to add it, Cancel to go inside.`)) {
        await api("POST", "/api/projects", { path: d.path, name: d.name });
        $("#browser").close();
        refresh();
      } else browse(d.path);
    };
    li.append(b); ul.append(li);
  }
}

/* ------------------------------------------------------------------ boot */

// Chaque vue a une adresse : recharger la page revient au même endroit, et un
// projet peut se mettre en signet. Le hash est la source de vérité, pas l'inverse.
function readHash() {
  const h = new URLSearchParams(location.hash.slice(1));
  state.selected = h.get("p") || "";
  const d = h.get("d");
  state.dialog = state.selected && (d === "graph" || d === "git") ? d : "";
  showView(h.get("v") === "terms" ? "terms" : "board");
}
function writeHash() {
  const h = new URLSearchParams();
  if (state.selected) h.set("p", state.selected);
  if (state.view === "terms") h.set("v", "terms");
  if (state.dialog && state.selected) h.set("d", state.dialog);
  const next = h.toString() ? "#" + h : "#";
  if (location.hash !== next) history.replaceState(null, "", next);
}

$$(".tab").forEach((b) => (b.onclick = () => { showView(b.dataset.view); writeHash(); }));
$(".proj.all").onclick = () => { state.selected = ""; writeHash(); render(); };
addEventListener("hashchange", () => { readHash(); render(); });
$("#cols").value = localStorage.getItem("pyra.cols") || "2";
$("#cols").onchange = setCols;
setCols();
$("#add-project").onclick = () => { $("#browser").showModal(); browse(); };

// Ouverte par l'app Mac (`?app=1`), la page porte sa propre barre de titre.
if (new URLSearchParams(location.search).has("app")) document.body.classList.add("in-app");

readHash();
refresh();
setInterval(refresh, 4000);
