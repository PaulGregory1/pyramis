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

const state = { data: null, selected: "", view: "board", filter: "all", dialog: "", panel: "", setPane: "model", zoom: "" };
const panes = new Map(); // id -> { term, fit, ws, root, seed, lastData, booted, kind, edge, busyAt }

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

// La table des modes ne change pas d'un tour à l'autre, et elle doit être là AVANT le
// premier rendu : l'en-tête d'un panneau est peint une seule fois, à sa naissance, et
// garderait sinon l'identifiant brut du CLI pour toute sa vie. Demandée une fois, et
// une seule même en cas d'échec — la boucle des quatre secondes n'a pas à réessayer.
let modesAsked = false;
async function loadModes() {
  modesAsked = true;
  try {
    const r = await api("GET", "/api/settings");
    providers = r.providers;
    permModes = r.permissionModes || [];
  } catch {}
}

async function refresh() {
  try {
    if (!modesAsked) await loadModes();
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

/* ---------------------------------------------------------- icône de projet */

// L'icône d'un projet est l'une de DEUX choses, et le registre n'en garde qu'une
// chaîne : un emoji (« 🌱 »), ou le jeton d'une des huit pyramides de la planche de
// marque (« pyr:violet »). Cette fabrique est le SEUL endroit qui sache lire le jeton.
// Cinq endroits posent cette icône — la barre latérale, la carte de la vue d'ensemble,
// l'en-tête d'un projet, la liste du dialogue « New terminal » et la tête d'un panneau —
// et sans elle chacun aurait sa version de la question ; le premier oublié afficherait
// « pyr:violet » en toutes lettres.
// La liste et son ordre viennent de la planche : la même est dans scripts/brand.mjs.
const PYR = ["violet", "blue", "teal", "orange", "pink", "amber", "slate", "red"];
const isPyr = (v) => typeof v === "string" && PYR.includes(v.slice(4)) && v.startsWith("pyr:");
const pyrSrc = (v) => `/brand/pyr-${v.slice(4)}.png`;

// `cls` est celle que l'endroit donnait déjà à son emoji : l'icône ne choisit pas sa
// taille, elle prend celle du texte autour (voir `img.glyph` dans la feuille de style).
function projIcon(p, cls) {
  if (!isPyr(p.emoji)) return el("span", cls, p.emoji);
  const i = el("img", cls ? cls + " glyph" : "glyph");
  i.src = pyrSrc(p.emoji);
  i.alt = "";
  return i;
}

/* ------------------------------------------------------- choisir son icône */

// La planche des huit, et c'est le MÊME geste aux deux endroits qui l'offrent : le
// formulaire de création et la page d'un projet. La fabrique ne sait pas ce qu'elle
// change — elle montre le choix courant et appelle `pick`. Écrire dans le formulaire ou
// envoyer un PATCH appartient à l'appelant : sans cette coupure, le dialogue aurait fini
// par savoir créer des projets, et le formulaire par savoir en modifier.
function iconSwatches(host, chosen, pick) {
  host.textContent = "";
  for (const name of PYR) {
    const token = `pyr:${name}`;
    const b = el("button", "swatch" + (chosen === token ? " on" : ""));
    b.type = "button";
    b.title = name;
    const i = el("img", "glyph");
    i.src = pyrSrc(token);
    i.alt = name;
    b.append(i);
    b.onclick = () => pick(token);
    host.append(b);
  }
}

// L'icône de l'en-tête EST le bouton qui la change. Un dossier ajouté depuis la machine
// reçoit « 📁 » d'office, et n'avait jusqu'ici aucune sortie : la route PATCH savait
// changer une icône depuis toujours, sans un seul clic pour l'appeler.
function iconButton(p) {
  const b = el("button", "pebtn");
  b.title = "Change the project icon";
  b.append(projIcon(p, "pe"));
  b.onclick = () => { state.panel = "icon"; writeHash(); render(); };
  return b;
}

// Le dialogue porte sur le projet OUVERT : il n'y a pas d'autre endroit d'où on
// l'atteigne, et son adresse — `#p=<projet>&s=icon` — dit déjà lequel.
function openIconPicker() {
  if (!current()) { state.panel = ""; writeHash(); return; }
  $("#icon").showModal();
  renderIconPicker();
}

function renderIconPicker() {
  const p = current();
  if (!p) return;
  $("#icon-title").textContent = p.name;
  const set = async (value) => {
    // Peint d'avance : le registre a déjà tranché quand la réponse arrive, et attendre
    // la boucle des quatre secondes rendrait lent un choix qui ne coûte rien.
    p.emoji = value;
    renderIconPicker();
    render();
    try { await api("PATCH", `/api/projects/${p.id}`, { emoji: value }); }
    catch (e) { $("#err").textContent = String(e.message || e); refresh(); }
  };
  iconSwatches($("#icon-swatches"), p.emoji, set);
  // Le champ et la planche disent la même valeur ; celui des deux qu'on a touché en
  // dernier gagne, et c'est le liseré qui dit lequel tient l'icône en ce moment.
  const em = $("#icon-emoji");
  em.value = isPyr(p.emoji) ? "" : p.emoji;
  em.classList.toggle("on", !isPyr(p.emoji));
  em.onchange = () => { const v = em.value.trim(); if (v) set(v); };
}

/* --------------------------------------------------------------- sidebar */

function renderSide() {
  const box = $("#projects");
  box.textContent = "";
  for (const p of state.data.projects) {
    const b = el("button", "proj" + (state.selected === p.id ? " on" : ""));
    b.dataset.id = p.id;
    b.append(projIcon(p, "pe"));
    b.append(el("span", "pn", p.name));
    const meta = el("span", "pmeta");
    if (p.mainStats.total) meta.append(el("span", null, `${p.mainStats.done}/${p.mainStats.total}`));
    if (!p.exists) meta.append(el("span", null, "⚠"));
    b.append(meta);
    b.onclick = () => showProject(p.id);
    box.append(b);

    if (p.mainStats.total) {
      const g = el("div", "gauge");
      const i = el("i");
      i.style.width = `${Math.round((p.mainStats.done / p.mainStats.total) * 100)}%`;
      g.append(i);
      box.append(g);
    }

    // Les sessions du projet, chacune sur son bouton. Deux origines : les panneaux
    // ouverts ici, et les sessions d'arrière-plan que `claude agents --json` rapporte —
    // celles qu'on peut vraiment reprendre. Les terminaux ouverts ailleurs sur la
    // machine ne sont PAS listés (le filtre est dans `buildState()`) : ils ont déjà
    // leur fenêtre, et leurs lignes repoussaient les panneaux d'ici hors de vue.
    const rows = [
      ...p.terminals.filter((t) => t.alive).map((t) => ({ kind: "mine", id: t.id, label: t.label || p.name, sub: t.kind })),
      ...p.sessions.map((s) => ({ kind: "ext", id: s.sessionId, label: s.name || s.sessionId.slice(0, 8), sub: s.kind, cwd: s.cwd, background: s.kind === "background" })),
    ];
    if (!rows.length) continue;

    const list = el("div", "sessions");
    for (const r of rows) {
      const s = el("button", "sess" + (r.kind === "ext" ? " ext" : ""));
      // La pastille d'un panneau d'ici est repeinte HORS du rendu (`paintDots`) : son
      // état change en une seconde, la barre latérale n'est refaite qu'aux quatre
      // secondes du rafraîchissement. Elle porte donc l'id de son panneau.
      const dot = el("span", "sdot");
      if (r.kind === "mine") dot.dataset.pane = r.id;
      s.append(dot);
      s.append(el("span", "sname", r.label));
      if (r.kind === "ext") {
        s.append(el("span", "stag", "background"));
        s.title = "Background session: pick it up in a pane here.";
        s.onclick = () => joinSession(p, r);
      } else {
        s.title = "Go to this terminal";
        s.onclick = () => focusPane(r.id);
      }
      list.append(s);
    }
    box.append(list);
  }
  paintDots();
  $(".proj.all").classList.toggle("on", !state.selected);
  const n = state.data.liveCount;
  $("#live").innerHTML = `<b>${n}</b> Claude session${n > 1 ? "s" : ""}`;
}

// Aller à un projet, c'est aussi CHANGER DE VUE. Sans cette bascule, un clic sur un
// projet depuis la grille des terminaux ne faisait rien de visible : il sélectionnait un
// projet dans une vue cachée, et l'écran restait sur les mêmes panneaux. Le seul signe
// était la barre latérale qui changeait de surbrillance — de quoi croire l'app cassée.
// C'est le pendant exact de `focusPane` ci-dessous, et les deux sens doivent être
// câblés : la page mène au panneau, le panneau ramène à la page.
function showProject(id) {
  state.selected = id;
  showView("board"); // écrit l'adresse
  render();
}

// Un panneau déjà ouvert : on bascule sur la vue, on le met en évidence, on lui donne
// le clavier. Rien n'est relancé — c'est la même session, pas une nouvelle.
function focusPane(id) {
  showView("terms");
  const pane = panes.get(id);
  if (!pane) return;
  // Aller à un panneau alors qu'un AUTRE est agrandi ne peut pas vouloir dire « reste
  // sur celui-là » : on referme l'agrandissement plutôt que de faire défiler vers un
  // panneau que le flou cache.
  if (state.zoom && state.zoom !== id) setZoom("");
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
    h.append(projIcon(p), el("span", null, p.name));
    if (p.sessions.length) h.append(el("span", "dot"));
    c.append(h);

    const bits = [];
    if (!p.exists) bits.push("folder not found");
    else if (!p.hasFile) bits.push("no milestone written down");
    else bits.push(`${p.mainStats.done}/${p.mainStats.total} milestones`);
    const small = p.stats.total - p.mainStats.total;
    if (small) bits.push(`${small} step${small > 1 ? "s" : ""}`);
    if (p.sessions.length) bits.push(`${p.sessions.length} in background`);
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
    open.onclick = () => showProject(p.id);
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

// Le losange ◈ était un caractère ; c'est maintenant le logo. Une seule fabrique le
// pose, pour que les boutons du graphe et l'en-tête de la visionneuse portent la même
// image — et pour qu'il n'y ait qu'un chemin à changer si elle bouge. La ligne de
// mesure de `graphNote`, elle, garde son caractère : elle n'a droit à aucune couleur.
function graphIcon() {
  const i = el("img", "gicon");
  i.src = "/brand/graph-128.png";
  i.alt = "";
  return i;
}

function graphButton(p, cls) {
  const g = p.graph;
  const busy = Boolean(g?.job?.running);
  const b = el("button", cls + " gbtn" + (busy ? " busy" : "") + (g?.stale && !busy ? " warn" : ""));
  // Pendant la construction, le logo cède la place au ◌ : c'est lui qui dit « ça tourne ».
  if (busy) b.append("◌ Reading the code…");
  else b.append(graphIcon(), g?.built ? "Rebuild graph" : "Build graph");
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
  head.append(iconButton(p));
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

/* ------------------------------------------------- l'installation, la synchro */

// Ce que la création d'un projet a fait, geste par geste. La liste ne disparaît pas
// quand elle est finie : c'est le compte rendu d'un dépôt qu'on vient de fabriquer,
// et savoir que le dépôt distant a échoué reste utile une heure plus tard. Elle
// s'efface au premier rechargement du serveur, ce qui est la bonne durée de vie —
// elle n'appartient à personne.
function forgeNote(p) {
  const f = p.forge;
  if (!f || (!f.steps.length && !f.error)) return null;
  const box = el("div", "gnote col");
  box.append(el("div", "pv-label", f.running ? "Setting the project up…" : "Project set up"));
  const list = el("div", "fsteps");
  for (const s of f.steps) {
    const row = el("div", "fstep " + (s.ok ? "ok" : "bad"));
    row.append(el("span", "fi", s.ok ? "✓" : "✕"));
    row.append(el("span", "fn", s.name));
    if (s.error || s.note) row.append(el("span", "fm", s.error || s.note));
    list.append(row);
  }
  if (f.running) list.append(el("div", "fstep", "…"));
  if (f.error) list.append(el("div", "fstep bad", f.error));
  box.append(list);
  return box;
}

// Un projet né dans Pyra porte `auto.sync` : l'app commite ce qu'elle écrit chez lui.
// Un projet ajouté depuis la machine ne l'a pas, et le bouton reste la seule façon
// d'obtenir le geste — une fois, sciemment. C'est la même forme que « Build graph ».
function syncButton(p, cls) {
  const b = el("button", cls, "⇧ Push milestones");
  b.disabled = !p.exists;
  b.title = p.auto?.sync
    ? "Pyra commits and pushes MILESTONES.md by itself in this project. This does it now."
    : "Commits and pushes only what Pyra writes here — MILESTONES.md, and the block it grafts into CLAUDE.md. Your own changes are left alone.";
  b.onclick = async () => {
    b.disabled = true;
    try {
      await api("POST", `/api/projects/${p.id}/sync`, {});
    } catch (e) {
      alert(String(e.message || e));
    }
    b.disabled = false;
    refresh();
  };
  return b;
}

function syncNote(p) {
  const s = p.sync;
  if (!s) return null;
  const box = el("div", "gnote");
  if (!s.ok) box.append(el("span", "dirty", "Sync failed: " + (s.error || "unknown")));
  else if (s.skipped) box.append(el("span", "faint", "Nothing to push — " + s.skipped + "."));
  else {
    box.append(el("span", null, "Committed"), el("code", null, s.committed || ""));
    // Un push qui échoue n'est pas un commit perdu : il est fait, il attend. Le dire
    // ainsi évite qu'on refasse le geste en croyant avoir tout raté.
    if (s.pushed) box.append(el("span", "faint", "and pushed."));
    else box.append(el("span", "dirty", `— not pushed: ${s.pushError || "no remote"}. The commit is in the repository.`));
  }
  return box;
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
  // Un travail sur le tableau de bord vient de se terminer : le `.pyra/preview.json`
  // a changé sous nos pieds, et attendre la fin de la minute afficherait la courbe
  // d'avant le clic. L'horodatage de fin sert de sceau — il ne bouge qu'à ce
  // moment-là, donc il ne rappelle rien tant qu'on ne touche à rien.
  const stamp = p.preview?.endedAt || 0;
  const cur = previews.get(p.id);
  if (cur && cur.stamp === stamp && Date.now() - cur.at < PREVIEW_TTL) return cur.data;
  // La tentative est notée AVANT de partir. Sans ça, un dossier qui répond en erreur
  // relancerait un appel à chaque rendu, soit quinze par minute pour rien.
  previews.set(p.id, { at: Date.now(), data: cur?.data || null, stamp });
  api("GET", `/api/projects/${p.id}/preview`)
    .then((data) => { previews.set(p.id, { at: Date.now(), data, stamp }); render(); })
    .catch(() => { /* l'aperçu est un supplément : son absence ne casse pas la page */ });
  return cur?.data || null;
}

// La bannière du dépôt, quand il en a une : `.pyra/banner.png` chez lui. La balise
// est posée sans rien avoir demandé — la route répond 404 quand le fichier n'existe
// pas, et la bande se retire d'elle-même. Le détour vaut son prix : demander à
// `/api/state` si un fichier est là mettrait un accès disque par projet dans la
// boucle des quatre secondes, pour une image que presque personne n'a.
function bannerBand(p) {
  const band = el("div", "pv-banner");
  const img = new Image();
  img.alt = "";
  img.onerror = () => band.remove();
  img.src = `/api/projects/${p.id}/banner`;
  band.append(img);
  return band;
}

/* ------------------------------------------------- l'aperçu chiffré : l'objectif */

// Ce que Pyra montrait jusqu'ici d'un projet, c'est ce qu'il EST : son README, sa
// branche, ses langages. Rien là-dedans ne dit s'il est en train de gagner. Cette
// bande-ci dit l'autre moitié — l'objectif du dépôt, et les deux ou trois nombres
// qui montent (ou ne montent pas) vers lui : l'Elo d'un moteur, le total de
// téléchargements, le rendement d'une stratégie.
//
// Elle ne coûte rien à la boucle des quatre secondes : les nombres viennent avec
// `/api/projects/:id/preview`, la route à la demande, et l'état du travail avec
// `/api/state` — un objet en mémoire, comme la génération et le graphe.
//
// Le geste qui la construit est le SEUL geste payant ici, et il est écrit en toutes
// lettres sur le bouton. Ce qui suit — « ↻ Update » — ne relance que les commandes
// que le modèle a écrites, en local : c'est ce qui permet d'appuyer tous les soirs.

const BUILD_TITLE =
  "Claude reads the repository, works out what this project is trying to reach,\n" +
  "and writes ONE shell command per number that measures it.\n" +
  "It does not run them — Pyra does, here, and only when you ask.\n" +
  "The commands land in .pyra/preview.json, yours to correct. One to three minutes.";

const UPDATE_TITLE =
  "Runs each metric's command again and adds one point to its curve.\n" +
  "No model, no tokens: this is the cheap half, and it is the one you repeat.";

const TUNE_TITLE =
  "Same build, with your instructions in front of it: which numbers matter here,\n" +
  "where they live, what to leave alone. They are kept in .pyra/preview.json,\n" +
  "so the next build starts from them.";

function buildButton(p, spec, cls) {
  const busy = p.preview?.running;
  const has = Boolean(spec?.metrics?.length);
  const b = el("button", cls + (busy ? " busy" : ""));
  b.textContent = busy && p.preview.kind === "build" ? "◌ Reading the repo…" : has ? "✦ Add a metric" : "✦ Build the scoreboard";
  b.title = BUILD_TITLE;
  b.disabled = busy || !p.exists;
  b.onclick = () => runPreview(p, "build");
  return b;
}

// Le second chemin du même geste. Le bouton d'à côté laisse Claude décider seul de ce
// qui mérite un nombre ; celui-ci ouvre une fenêtre où l'on écrit ce qu'on veut voir
// AVANT qu'il lise le dépôt. C'est le seul endroit de l'app où l'utilisateur parle au
// modèle sans passer par un terminal — d'où sa place à côté du bouton, et pas dans les
// réglages : la consigne appartient à CE projet, elle vit dans son fichier.
function tuneButton(p, cls) {
  const b = el("button", cls, "✎ Customize");
  b.title = TUNE_TITLE;
  b.disabled = Boolean(p.preview?.running) || !p.exists;
  b.onclick = () => { state.panel = "tune"; writeHash(); render(); };
  return b;
}

function updateButton(p, cls) {
  const busy = p.preview?.running;
  const b = el("button", cls + (busy ? " busy" : ""));
  b.textContent = busy && p.preview.kind === "update" ? "◌ Measuring…" : "↻ Update";
  b.title = UPDATE_TITLE;
  b.disabled = busy || !p.exists;
  b.onclick = () => runPreview(p, "update");
  return b;
}

// `notes` n'est envoyé que par la fenêtre « Customize ». Le bouton simple n'envoie
// rien du tout, et c'est voulu : le serveur reprend alors les consignes déjà posées
// dans le dépôt, au lieu de les effacer sans le dire.
async function runPreview(p, kind, notes) {
  if (p.preview?.running) return;
  try {
    await api("POST", `/api/projects/${p.id}/preview${kind === "update" ? "/update" : ""}`,
      typeof notes === "string" ? { notes } : undefined);
    // On peint tout de suite l'état « en cours » : le rafraîchissement suivant, quatre
    // secondes plus tard, prendrait le relais trop tard pour que le clic ait l'air pris.
    p.preview = { kind, running: true, startedAt: Date.now(), endedAt: 0, added: 0, read: 0, error: null };
    render();
  } catch (e) { alert((kind === "build" ? "Build" : "Update") + " failed: " + e.message); }
}

/* ------------------------------------------------ l'aperçu chiffré : la consigne */

// La fenêtre « Customize ». Elle ne fait rien d'autre que porter une phrase jusqu'au
// prompt : ce que l'utilisateur veut voir mesuré, dans ses mots, devant le modèle avant
// qu'il ouvre le dépôt. La phrase est ensuite gardée dans le `.pyra/preview.json` du
// projet — donc relue à la construction suivante, corrigeable dans un éditeur, et
// versionnée avec le reste. Pas un réglage de l'app : une consigne DE CE PROJET.
function openTune() {
  const p = current();
  if (!p) { state.panel = ""; writeHash(); return; }
  $("#tune").showModal();
  renderTune();
}

function renderTune() {
  const p = current();
  if (!p) return;
  const spec = preview(p)?.goal;
  $("#tune-title").textContent = p.name;
  $("#tune-error").textContent = "";
  // Le champ n'est rempli qu'à l'OUVERTURE : le rendu repasse ici toutes les quatre
  // secondes, et recopier la valeur du fichier à chaque tour effacerait la phrase en
  // cours de frappe. `dataset.for` retient pour quel projet il a été rempli.
  const box = $("#tune-text");
  if (box.dataset.for !== p.id) {
    box.value = spec?.notes || "";
    box.dataset.for = p.id;
    box.focus();
  }
  $("#tune-note").textContent = spec?.metrics?.length
    ? "Building again never rewrites a metric that has already measured — it adds what is missing, and repairs the ones that never produced a reading."
    : "Nothing is measured here yet, so this build starts from a blank panel.";
  $("#tune-go").disabled = Boolean(p.preview?.running) || !p.exists;
}

// Envoyer FERME la fenêtre : le travail dure une à trois minutes et son avancement se
// lit dans la bande, derrière. Une fenêtre restée ouverte sur un bouton grisé ne dirait
// rien de plus, et cacherait justement l'endroit où la réponse arrive.
function submitTune() {
  const p = current();
  if (!p) return;
  const notes = $("#tune-text").value.trim().slice(0, 900);
  $("#tune-text").dataset.for = "";
  $("#tune").close();
  runPreview(p, "build", notes);
}

// Trois états, et un seul est une page vide. Tant que la route n'a pas répondu, la
// bande ne s'affiche pas du tout : faire clignoter « aucun aperçu » puis des courbes
// donnerait l'impression d'avoir tout perdu à chaque ouverture du projet.
function goalBand(p, pv) {
  const spec = pv?.goal;
  const job = p.preview;
  if (!pv && !job?.running) return null;

  if (!spec?.metrics?.length) return emptyGoal(p, spec, job);

  const band = el("div", "goal");

  const head = el("div", "goal-h");
  const t = el("div", "goal-t");
  t.append(el("div", "pv-label", "Where this stands"));
  if (spec.goal) t.append(el("div", "goal-s", spec.goal));
  const acts = el("div", "goal-a");
  acts.append(updateButton(p, "btn"), tuneButton(p, "btn ghost"), buildButton(p, spec, "btn ghost"));
  head.append(t, acts);
  band.append(head);

  const grid = el("div", "mxs" + (spec.metrics.length === 1 ? " one" : ""));
  for (const m of spec.metrics) grid.append(metricCard(m));
  band.append(grid);

  const note = goalNote(p, spec);
  if (note) band.append(note);
  return band;
}

// La bande vide : un seul bouton, au milieu, et la phrase qui dit ce qu'il va faire —
// y compris qu'il coûte quelque chose. C'est la même honnêteté que la case décochée
// des réglages : on ne dépense pas à la place de quelqu'un sans le lui dire.
function emptyGoal(p, spec, job) {
  const band = el("div", "goal empty-goal");
  if (job?.running) {
    band.append(el("div", "eg-t", job.kind === "build" ? "Reading the repository…" : "Measuring…"));
    band.append(el("div", "eg-s", "Claude is looking for what this project is trying to reach, and for a number that already measures it. One to three minutes."));
    band.append(el("div", "eg-w"));
    return band;
  }
  band.append(el("div", "eg-t", "No numbers on this project yet"));
  band.append(el("div", "eg-s", "Pyra shows what the repository IS. This shows whether it is winning — the Elo of an engine, total downloads, the return of a strategy. Claude reads the repository, finds what it is aiming at, and writes one command per number. Updating afterwards costs nothing."));
  const row = el("div", "eg-b");
  row.append(buildButton(p, spec, "btn primary big"), tuneButton(p, "btn ghost big"));
  band.append(row);
  if (spec?.error) band.append(el("div", "gen err", "✕ " + spec.error));
  else if (job?.error) band.append(el("div", "gen err", "✕ " + job.error));
  // Un dépôt sans nombre à montrer est une réponse, pas une panne — un carnet de
  // voyage ne « gagne » rien. Sans cette ligne, le bouton aurait juste l'air mort.
  else if (job && !job.running && job.kind === "build" && !job.added && job.endedAt)
    band.append(el("div", "gen", "Claude found nothing to count in this repository. Not every project has a score."));
  return band;
}

// Ce que le dernier clic a donné. Une erreur reste affichée ; un succès s'efface au
// bout de dix minutes, parce que le résultat est déjà sous les yeux, dans les courbes.
function goalNote(p, spec) {
  const j = p.preview;
  const last = lastReading(spec);
  const line = el("div", "gfoot");
  if (j?.error && !j.running) line.append(el("span", "bad", "✕ " + j.error));
  else if (j && !j.running && j.endedAt && Date.now() - j.endedAt < 10 * 60 * 1000 && j.kind === "build" && j.added)
    line.append(el("span", "ok", `✓ ${j.added} metric${j.added > 1 ? "s" : ""} added`));
  if (last) line.append(el("span", null, `Last reading ${ago(last)}`));
  line.append(el("code", null, ".pyra/preview.json"));
  return line;
}

const lastReading = (spec) =>
  spec.metrics.reduce((t, m) => Math.max(t, m.points.length ? m.points[m.points.length - 1].at : 0), 0) || 0;

/* ------------------------------------------------------------ une métrique */

function metricCard(m) {
  const c = el("div", "mx" + (m.error ? " bad" : ""));
  const pts = m.points;
  const last = pts[pts.length - 1] || null;
  const prev = pts[pts.length - 2] || null;
  const kind = chartKind(m);

  const h = el("div", "mx-h");
  h.append(el("span", "mx-l", m.label));
  // La variation depuis le relevé précédent, et elle seule : « +18 depuis hier » est
  // la question qu'on se pose en ouvrant un projet, pas « +59 depuis le début ».
  if (last && prev) {
    const d = last.v - prev.v;
    const good = m.better === "down" ? d < 0 : d > 0;
    if (d !== 0) h.append(el("span", "mx-d " + (good ? "up" : "down"), (d > 0 ? "▲ +" : "▼ −") + num(Math.abs(d), m)));
    else h.append(el("span", "mx-d flat", "flat"));
  }
  c.append(h);

  const v = el("div", "mx-v");
  v.append(el("span", null, last ? num(last.v, m) : "—"));
  if (m.unit) v.append(el("i", null, m.unit));
  // La cible en pastille — sauf sur la jauge, qui l'écrit déjà sous sa barre. Deux
  // fois le même nombre dans une carte de 230 px, c'est une fois de trop.
  if (m.target != null && kind !== "gauge")
    v.append(el("span", "mx-tg", "target " + num(m.target, m) + (m.unit ? " " + m.unit : "")));
  c.append(v);

  const band = el("div", "mx-b");
  band.append(DRAW[kind](pts, m));
  c.append(band);

  // Le pied, collé en bas de la carte : d'où sort le nombre, puis la commande qui le
  // sort. Elle est affichée parce que c'est Pyra qui la lance — une ligne de shell
  // écrite par un modèle et exécutée sans jamais être montrée serait exactement ce
  // que cette app refuse de faire.
  const foot = el("div", "mx-f");
  if (m.source) foot.append(el("div", "mx-s", m.source));
  if (m.command) {
    const cmd = el("code", "mx-c", m.command);
    cmd.title = m.command;
    foot.append(cmd);
  }
  if (m.error) foot.append(el("div", "mx-e", "✕ " + m.error));
  else if (pts.length) foot.append(el("div", "mx-n", `${pts.length} reading${pts.length > 1 ? "s" : ""} · since ${ago(pts[0].at)}`));
  // Le pied porte un filet : vide, il ne laisserait qu'un trait au bas de la carte,
  // sans rien dessous. Une métrique écrite à la main sans source ni commande existe.
  if (foot.childElementCount) c.append(foot);
  return c;
}

// Un nombre lisible sans réglage : le modèle propose `decimals`, et à défaut on prend
// ce que l'ordre de grandeur commande — deux décimales sur un rendement, aucune sur
// un compteur de téléchargements.
function num(v, m) {
  const a = Math.abs(v);
  const d = m?.decimals != null ? m.decimals : a >= 100 ? 0 : a >= 10 ? 1 : a >= 1 ? 2 : 3;
  return v.toLocaleString("en", { minimumFractionDigits: 0, maximumFractionDigits: d });
}

/* --------------------------------------------------------------- les dessins */

/* Trois dessins, pas un de plus, et c'est le FICHIER qui dit lequel — donc le modèle,
   guidé par `skills/preview-chart/SKILL.md`. L'app ne choisit rien ici : elle dessine
   ce qu'on lui a demandé. C'est toute la raison d'être du champ `chart` : sans lui,
   quatre métriques qui ne posent pas la même question portaient la même courbe, et la
   rangée de cartes ne se lisait plus.

     line   une courbe dans le temps  — une grandeur continue dont la FORME est la nouvelle
     bars   un histogramme            — un compte qu'on compare d'un relevé à l'autre
     gauge  une barre vers la cible   — une distance à combler, quand le dépôt en annonce une

   Les trois occupent la MÊME bande de hauteur fixe (`.mx-b`), pour que quatre cartes
   côte à côte alignent leur grand nombre, leur dessin et leur pied. Une carte plus
   haute que sa voisine transforme la rangée en escalier. */
const DRAW = { line: lineChart, bars: barsChart, gauge: gaugeChart };

// La même règle que `chartOf()` dans `preview.mjs`, et il faut que les deux disent la
// même chose : sans indication, une métrique qui a une cible prend la jauge (c'est ce
// que l'interface montrait avant que le champ existe) et les autres la courbe ; une
// jauge sans cible est une barre qui ne se remplira jamais, donc une courbe aussi.
function chartKind(m) {
  const k = DRAW[m.chart] ? m.chart : m.target != null ? "gauge" : "line";
  return k === "gauge" && m.target == null ? "line" : k;
}

const unit01 = (r) => (r < 0 ? 0 : r > 1 ? 1 : r);

// Ce qu'on montre quand il n'y a pas encore de quoi dessiner. Une phrase centrée dans
// la bande plutôt qu'un trait plat : un trait plat dit « stable », ce qui est faux, et
// une bande vide dit « cassé », ce qui l'est aussi.
const waiting = (txt) => el("div", "mx-wait", txt);

const SVGNS = "http://www.w3.org/2000/svg";
const svgEl = (tag, attrs) => {
  const n = document.createElementNS(SVGNS, tag);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  return n;
};
let sparkSeq = 0;

// LA COURBE. Sans axes : l'axe des ordonnées d'une mesure qu'on suit soi-même
// n'apprend rien qu'un chiffre en gros ne dise mieux, et l'axe du temps tient dans le
// « depuis dix jours » de la ligne du dessous. Ce qu'on veut voir, c'est la FORME —
// est-ce que ça monte, est-ce que ça a plafonné.
//
// La HAUTEUR est fixe et la largeur suit la carte, donc le repère est étiré
// (`preserveAspectRatio="none"`) et tout ce qui a une forme propre s'y déformerait.
// D'où le trait en `vector-effect`, et surtout la pastille du dernier relevé posée
// EN HTML par-dessus, en pourcentages : un cercle dans le SVG deviendrait une ellipse
// quatre fois plus large que haute selon la largeur de la carte.
function lineChart(points, m) {
  if (points.length < 2) return waiting("One reading — the curve appears on the next update");

  const W = 300, H = 74, PX = 2, PY = 9;
  const box = el("div", "mx-line");
  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: "none", class: "mx-g", role: "img" });
  svg.setAttribute("aria-label", `${m.label} over time`);

  // Le cadre tient à ce qui a été MESURÉ, et à rien d'autre. Y faire entrer la cible
  // écrasait la courbe contre le bas : un Elo qui va de 1712 à 1834 devient une ligne
  // plate dès qu'on ouvre l'axe jusqu'à 2000. La cible est en pastille près du grand
  // nombre, ou bien la métrique demande une jauge — c'est à ça qu'elle sert.
  const vs = points.map((p) => p.v);
  let lo = Math.min(...vs), hi = Math.max(...vs);
  const pad = (hi - lo) * 0.16 || Math.abs(hi) * 0.12 || 1;
  lo -= pad; hi += pad;

  // L'axe est le TEMPS, pas le rang du relevé : trois mesures en un soir puis une
  // semaine de silence doivent se voir comme telles. Des relevés tous horodatés
  // pareil (un fichier écrit à la main) retombent sur un espacement régulier.
  const t0 = points[0].at, t1 = points[points.length - 1].at;
  const fx = (p, i) => (t1 === t0 ? i / (points.length - 1) : (p.at - t0) / (t1 - t0));
  const x = (p, i) => PX + (W - 2 * PX) * fx(p, i);
  const fy = (v) => 1 - (v - lo) / (hi - lo);
  const y = (v) => PY + (H - 2 * PY) * fy(v);

  const id = "sg" + ++sparkSeq;
  const defs = svgEl("defs", {});
  const gl = svgEl("linearGradient", { id, x1: "0", y1: "0", x2: "1", y2: "0" });
  gl.append(svgEl("stop", { offset: "0", "stop-color": "#6c34d6" }), svgEl("stop", { offset: ".52", "stop-color": "#4a45e8" }), svgEl("stop", { offset: "1", "stop-color": "#3c5bf5" }));
  const gf = svgEl("linearGradient", { id: id + "f", x1: "0", y1: "0", x2: "0", y2: "1" });
  gf.append(svgEl("stop", { offset: "0", "stop-color": "#4a45e8", "stop-opacity": ".15" }), svgEl("stop", { offset: "1", "stop-color": "#4a45e8", "stop-opacity": "0" }));
  defs.append(gl, gf);
  svg.append(defs);

  const d = points.map((p, i) => `${i ? "L" : "M"}${x(p, i).toFixed(2)} ${y(p.v).toFixed(2)}`).join(" ");
  svg.append(svgEl("path", { d: `${d} L${(W - PX).toFixed(2)} ${H} L${PX} ${H} Z`, fill: `url(#${id}f)`, stroke: "none" }));
  svg.append(svgEl("path", {
    d, fill: "none", stroke: `url(#${id})`, "stroke-width": "1.8",
    "stroke-linejoin": "round", "stroke-linecap": "round", "vector-effect": "non-scaling-stroke",
  }));
  box.append(svg);

  const end = points[points.length - 1];
  const dot = el("i", "mx-dot");
  dot.style.left = `${(PX + (W - 2 * PX) * 1) / W * 100}%`;
  dot.style.top = `${(PY + (H - 2 * PY) * fy(end.v)) / H * 100}%`;
  box.append(dot);
  return box;
}

// L'HISTOGRAMME. Une barre par relevé, la dernière en pleine couleur. En HTML et non
// en SVG, exprès : les barres n'ont alors AUCUNE forme propre à défendre contre
// l'étirement de la carte, et deux relevés comme trente se rangent tout seuls.
//
// La base est ZÉRO, parce que c'est ce qu'un histogramme promet : la hauteur est la
// valeur. Un relevé négatif descend sous la ligne du zéro au lieu d'être écrêté — la
// skill réserve ce dessin aux comptes, mais un fichier se corrige à la main et une
// barre qui ment est pire qu'une barre qui surprend.
function barsChart(points, m) {
  if (!points.length) return waiting("Nothing measured yet");

  const vs = points.map((p) => p.v);
  const hi = Math.max(0, ...vs), lo = Math.min(0, ...vs);
  const span = hi - lo || 1;
  const zero = (hi / span) * 100; // la ligne du zéro, en % depuis le haut

  const box = el("div", "mx-bars" + (points.length > 16 ? " thin" : ""));
  if (lo < 0) {
    const z = el("i", "mx-zero");
    z.style.top = `${zero}%`;
    box.append(z);
  }
  points.forEach((p, i) => {
    const col = el("div", "bc" + (i === points.length - 1 ? " on" : ""));
    const b = el("i");
    const h = (Math.abs(p.v) / span) * 100;
    if (p.v >= 0) { b.style.bottom = `${100 - zero}%`; b.style.height = `${Math.max(h, 1.5)}%`; }
    else { b.style.top = `${zero}%`; b.style.height = `${Math.max(h, 1.5)}%`; }
    col.title = `${num(p.v, m)}${m.unit ? " " + m.unit : ""} · ${ago(p.at)}`;
    col.append(b);
    box.append(col);
  });
  return box;
}

// LA BARRE QUI ÉVOLUE. Elle part du PREMIER relevé, pas de zéro : ce qu'on veut voir
// est le chemin parcouru DEPUIS QU'ON MESURE, et un Elo qui va de 1800 à 2000 n'a
// jamais commencé à zéro. Les deux bornes sont écrites sous la barre — une jauge dont
// on ne sait pas d'où elle part ne se lit pas, elle se devine.
//
// Au premier relevé elle est à 0 %, et c'est la vérité : on vient de commencer. Le
// trait de départ reste visible pour que ce zéro-là ait l'air d'un début et non d'une
// panne.
function gaugeChart(points, m) {
  const last = points[points.length - 1];
  if (!last) return waiting("Nothing measured yet");

  const base = points[0].v;
  const span = m.target - base;
  const reached = m.better === "down" ? last.v <= m.target : last.v >= m.target;
  const r = span === 0 ? (reached ? 1 : 0) : unit01((last.v - base) / span);
  const pct = Math.round(r * 100);

  const box = el("div", "mx-gauge" + (reached ? " done" : ""));
  const cap = el("div", "gg-c");
  cap.append(el("b", null, `${pct} %`), el("span", null, reached ? "· target reached" : "of the way there"));
  box.append(cap);

  const track = el("div", "gg-t");
  const fill = el("i");
  fill.style.width = `${pct}%`;
  track.append(fill);
  box.append(track);

  const ends = el("div", "gg-e");
  ends.append(el("span", null, `start ${num(base, m)}`), el("span", "grow"), el("span", "aim", `target ${num(m.target, m)}${m.unit ? " " + m.unit : ""}`));
  box.append(ends);
  return box;
}

function previewPanel(p) {
  const box = el("section", "pv");
  const pv = preview(p);
  box.append(bannerBand(p));
  const band = goalBand(p, pv);
  if (band) box.append(band);

  const left = el("div", "pv-main");

  const blurb = el("div", "pv-blurb");
  if (pv?.blurb?.text) blurb.textContent = pv.blurb.text;
  // Un README réduit à son titre EXISTE : c'est le cas de tout projet qu'on vient de
  // créer. Le dire « absent » enverrait chercher un fichier qui est là, et laisserait
  // croire que la création l'a oublié.
  else if (pv?.blurb) blurb.append(el("i", null, `${pv.blurb.file} has nothing but its title yet.`));
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
    // Le distant, en une expression. « ahead 2 » est la seule chose qu'on veuille
    // savoir d'un coup d'œil : y a-t-il du travail enregistré ici que personne
    // d'autre n'a. Pas de distant du tout est un fait, pas un défaut — beaucoup de
    // dépôts n'en ont pas et ne s'en portent pas plus mal.
    if (pv.remote?.repo) {
      if (!pv.remote.remote) g.append(el("span", "faint", "local only"));
      else if (!pv.remote.upstream) g.append(el("span", "faint", "no upstream"));
      else if (pv.remote.ahead || pv.remote.behind) {
        const bits = [];
        if (pv.remote.ahead) bits.push(`ahead ${pv.remote.ahead}`);
        if (pv.remote.behind) bits.push(`behind ${pv.remote.behind}`);
        g.append(el("span", "dirty", bits.join(", ")));
      } else g.append(el("span", "faint", "in sync"));
    }
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
  tiles.append(tile("Sessions", String(p.sessions.length + here), here ? `${here} here` : p.sessions.length ? "in background" : "none live"));
  tiles.append(tile("Graph", p.graph?.built ? p.graph.nodes.toLocaleString("en") : "—", p.graph?.built ? (p.graph.stale ? "stale" : `${p.graph.edges.toLocaleString("en")} edges`) : "not built"));
  box.append(tiles);

  // Les deux portes de l'étage du haut. Elles ouvrent des vues en lecture seule : le
  // graphe du code et l'arbre des commits ne se modifient pas depuis ici.
  const acts = el("div", "pv-acts");

  const bGraph = el("button", "btn gbtn");
  bGraph.append(graphIcon(), "Knowledge graph");
  bGraph.disabled = !p.graph?.built;
  bGraph.title = p.graph?.built
    ? "See the code as a graph: what calls what, and which symbols are the hubs."
    : "No graph in this repository yet — build it first.";
  bGraph.onclick = () => openViewer("graph", p);

  const bGit = el("button", "btn", "⑂ Git tree");
  bGit.disabled = !pv?.git;
  bGit.title = "The commit tree, branches side by side.";
  bGit.onclick = () => openViewer("git", p);

  acts.append(bGraph, bGit, el("span", "grow"), syncButton(p, "btn ghost"), graphButton(p, "btn ghost"), genButton(p, "btn ghost"));
  box.append(acts);

  const fnote = forgeNote(p);
  if (fnote) box.append(fnote);
  const snote = syncNote(p);
  if (snote) box.append(snote);
  const gnote = graphNote(p);
  if (gnote) box.append(gnote);
  const note = genNote(p);
  if (note) box.append(note);

  if (p.sessions.length) {
    box.append(el("div", "pv-sessions", "Background sessions: " + p.sessions.map((s) => `${s.name || s.sessionId.slice(0, 8)} (${s.kind})`).join(" · ")));
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

// Le « ＋ » ne peut pas deviner le projet : la grille tient les panneaux de tous.
// D'où un dialogue qui ne pose que cette question-là. Un seul projet suivi n'en vaut
// pas la peine — on l'ouvre directement.
function askTerminal() {
  const list = state.data?.projects || [];
  if (list.length === 1) return openTerminal(list[0].id, "claude");
  state.panel = "term";
  writeHash();
  render();
}

function renderNewTerm() {
  const host = $("#newterm-list");
  host.textContent = "";
  const list = state.data?.projects || [];
  if (!list.length) { host.append(el("li", "empty", "No project tracked yet.")); return; }
  for (const p of list) {
    const li = el("li");
    const go = el("button", "tmain");
    go.append(projIcon(p, "pe"), el("span", "tn", p.name));
    const live = p.terminals.filter((t) => t.alive).length;
    if (live) go.append(el("span", "tp", live > 1 ? `${live} panes` : "1 pane"));
    go.onclick = () => { $("#newterm").close(); openTerminal(p.id, "claude"); };
    // Le shell est le second geste, pas le premier : on vient ici pour ouvrir un
    // Claude neuf fois sur dix.
    const sh = el("button", "tsh", "shell");
    sh.title = "A plain login shell in this folder";
    sh.onclick = () => { $("#newterm").close(); openTerminal(p.id, "shell"); };
    li.append(go, sh);
    host.append(li);
  }
}

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

  let moved = false;
  for (const [id, pane] of panes) {
    if (wanted.has(id)) continue;
    pane.ws?.close(); pane.term.dispose(); pane.root.remove(); panes.delete(id);
    moved = true;
  }

  $("#term-count").textContent = String(live.filter((t) => t.alive).length);
  for (const t of live) {
    if (panes.has(t.id)) { panes.get(t.id).root.classList.toggle("dead", !t.alive); continue; }
    grid.append(makePane(t));
    moved = true;
  }
  // Le mot d'accueil de la grille vide vit maintenant DANS la case du « ＋ » : c'est
  // le même endroit, et il n'y a plus deux façons de dire « aucun terminal ».
  if (moved) layout();
}

// Le peintre du terminal. Par défaut, xterm dessine chaque cellule en DOM : un coup de
// molette repasse par la mise en page du navigateur, ligne par ligne, et pour CHAQUE
// panneau qui reçoit du texte en même temps. C'est ce qui hache le défilement là où
// Terminal.app glisse — lui peint sur le GPU. L'addon WebGL fait la même chose ici :
// même terminal, même thème, même feuille de style ; seul le peintre change.
//
// Deux façons de le perdre, et les deux sont prévues. Le navigateur ne tient qu'une
// poignée de contextes WebGL à la fois — la grille se scindant toute seule, on peut
// ouvrir assez de panneaux pour qu'il retire le plus ancien — et une machine (ou un
// Chrome headless de capture) peut n'en donner aucun. Dans les deux cas on relâche
// l'addon : xterm revient au rendu DOM de lui-même. Un panneau qui défile moins bien
// vaut mieux qu'un panneau noir.
function gpu(term) {
  if (!window.WebglAddon) return;
  try {
    const addon = new WebglAddon.WebglAddon();
    addon.onContextLoss(() => addon.dispose());
    term.loadAddon(addon);
  } catch { /* pas de WebGL ici : le rendu DOM reste, et il suffit */ }
}

// La molette d'un trackpad, rendue à sa vraie course. C'est l'autre moitié du
// défilement — le peintre ci-dessus décide de la FLUIDITÉ, celle-ci de la DISTANCE.
//
// Dès qu'une application plein écran lit la molette (`claude` le fait), xterm cesse de
// faire défiler son propre tampon : il traduit chaque cran en séquence d'échappement
// pour l'application. Ce chemin-là porte une heuristique « trackpad » — sous 50 px de
// delta, xterm multiplie la course par 0,3 — et elle est trop sévère. Mesuré dans
// Electron, un geste de 155 px (neuf lignes de 17 px, ce que Terminal.app fait
// défiler) : 2 lignes chez nous, 9 dans Terminal.app. Le geste est bien là, il arrive
// amputé des trois quarts — c'est exactement le « plus lent qu'un vrai terminal ».
//
// On le compense là où il est appliqué, et NULLE PART ailleurs. `scrollSensitivity`
// multiplie le delta AVANT l'amortissement : à 3,3 les deux se répondent et la course
// redevient celle du doigt (mesuré : 8 lignes sur 9). Les deux gardes comptent autant
// que le chiffre :
//   — au-delà de 50 px, c'est une VRAIE souris, xterm n'amortit pas, et multiplier là
//     rendrait chaque cran trois fois trop long ;
//   — sans suivi de souris, c'est le tampon de xterm qui défile, par le défileur lissé
//     qui n'amortit rien non plus — même faute, et sur le panneau shell cette fois.
// Le réglage est donc posé cran par cran, juste avant qu'xterm lise l'événement : en
// capture, pour passer avant lui, et `passive` parce qu'on ne fait que régler un
// nombre. Rien n'est écrit dans le pty d'ici — `typeInto()` reste le seul à le faire.
const WHEEL_DAMPED = 50;   // le seuil « trackpad » d'xterm, en pixels
const WHEEL_UNDAMP = 3.3;  // l'inverse du 0,3 qu'il applique en dessous

function wheel(term, host) {
  host.addEventListener("wheel", (e) => {
    const read = term.modes.mouseTrackingMode !== "none";
    term.options.scrollSensitivity = read && Math.abs(e.deltaY) < WHEEL_DAMPED ? WHEEL_UNDAMP : 1;
  }, { capture: true, passive: true });
}

function makePane(t) {
  const root = el("div", "pane" + (t.alive ? "" : " dead"));
  const head = el("header");
  // L'identité du panneau EST le chemin vers son projet. La grille montre huit dépôts à
  // la fois et rien d'autre : sans ce clic, relire le README de celui qu'on regarde
  // demandait de changer d'onglet puis de retrouver son nom dans la barre latérale —
  // trois gestes pour revenir au projet qu'on avait sous les yeux. Le libellé d'une
  // session reprise remplace le nom du projet ; c'est l'infobulle qui le dit alors, sans
  // quoi on cliquerait sans savoir où l'on va.
  const goProj = el("button", "goproj");
  goProj.append(projIcon(t.project));
  goProj.append(el("span", "name", t.label || t.project.name));
  goProj.title = `Open ${t.project.name} — its preview, milestones and viewers`;
  goProj.onclick = () => showProject(t.project.id);
  head.append(goProj);
  head.append(el("span", "kind", t.kind));
  // Le mode de permission du panneau, tel qu'il a été LANCÉ. Il est écrit ici et pas
  // seulement dans les réglages parce que c'est là qu'on en a besoin : savoir qu'un
  // Claude n'attendra rien avant d'agir se lit au-dessus de lui, pas trois clics plus
  // loin. Un panneau ouvert avant un changement de réglage garde le sien, et le dit.
  if (t.mode) {
    const m = permMode(t.mode);
    head.append(el("span", "pmode" + (m?.tone === "hot" ? " hot" : ""), m?.short || t.mode));
  }
  head.append(el("span", "grow"));

  // Le collage automatique peut rater (un dialogue de Claude l'avale). Ce bouton
  // reste le filet : l'étape est toujours à un clic, jamais perdue.
  const paste = el("button", null, "⌥ step");
  paste.title = "Paste the step into the prompt (without sending it)";
  paste.style.display = "none";
  paste.onclick = () => pasteSeed(t.id);
  head.append(paste);

  // Agrandir. Le panneau tout entier porte déjà ce geste — ce bouton est là pour qu'on
  // sache qu'il existe. Il n'a qu'un sens : on sort de l'agrandi par la croix ou par
  // l'arrière-plan, jamais en revenant ici, donc il s'efface pendant ce temps-là.
  const grow = el("button", "zbtn", "⤢");
  grow.title = "Enlarge this pane";
  grow.onclick = () => setZoom(t.id);
  const close = el("button", null, "✕");
  close.title = "Close and stop the session";
  close.onclick = async () => {
    if (t.alive && !confirm("Stop this session?")) return;
    await api("DELETE", `/api/terminals/${t.id}`);
    refresh();
  };
  head.append(grow, close);
  root.append(head);

  const body = el("div", "pbody");
  const host = el("div", "term");
  body.append(host);
  root.append(body);

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
  gpu(term);
  wheel(term, host);

  const pane = {
    term, fit, root, ws: null, seed: null, text: null, tail: "", lastData: 0, booted: false,
    sized: false, sizeTimer: null, pasteBtn: paste, kind: t.kind, edge: "", busyAt: 0,
  };
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
      const clean = m.d.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "").replace(/\x1b\][^\x07]*(\x07|\x1b\\)/g, "");
      pane.tail = (pane.tail + clean).slice(-3000);
      // Le même texte, mais lu À CHAUD : `tail` garde 3000 caractères d'histoire, où un
      // « esc to interrupt » d'il y a dix minutes traînerait encore et laisserait la
      // pastille au rouge pour toujours. On ne regarde donc que ce qui vient d'arriver,
      // recollé au bord du morceau précédent — la phrase tombe souvent à cheval sur deux
      // envois, le pty ne découpe pas aux mots.
      // Le bord est REMIS À ZÉRO dès qu'il a servi : gardé, il porterait la phrase
      // qu'on vient de reconnaître dans le morceau suivant, et le rouge ne s'éteindrait
      // plus jamais — la panne exacte que ce découpage était censé éviter.
      const fresh = pane.edge + clean;
      if (WORKING.test(fresh)) { pane.busyAt = Date.now(); pane.edge = ""; }
      else pane.edge = fresh.slice(-60);
    }
    else if (m.t === "exit") { term.write(`\r\n\x1b[90m— session ended (code ${m.code}) —\x1b[0m\r\n`); refresh(); }
  };
  term.onData((d) => ws.readyState === 1 && ws.send(JSON.stringify({ t: "in", d })));
  new ResizeObserver(() => resize(t.id)).observe(host);
  dropTarget(root, t.id);
  zoomTarget(root, t.id);

  return root;
}

/* -------------------------------------------------- déposer un fichier */

// Lâcher une image dans un panneau. Trois choses à savoir, et la première est celle
// qui rendait le geste impossible : sans `preventDefault`, le navigateur QUITTE la
// page pour afficher le fichier lâché — l'app disparaît d'un coup (les terminaux, eux,
// survivent côté serveur, mais personne ne le sait sur le moment).
//
// Deuxième : le navigateur ne donne PAS le chemin du fichier d'origine, et Electron ne
// le donne plus depuis la 32. On envoie donc les OCTETS au serveur, qui en pose une
// copie dans un dossier temporaire et rend un chemin — un seul code pour les deux
// façons de lancer Pyra, ce qui est exactement la règle « Electron n'est qu'une
// fenêtre ».
//
// Troisième : ce chemin est DÉPOSÉ dans l'invite, jamais envoyé. Même règle que pour
// une étape — c'est l'utilisateur qui appuie sur Entrée.
function dropTarget(root, id) {
  const over = (e) => {
    if (!e.dataTransfer) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    root.classList.add("drop");
  };
  root.addEventListener("dragenter", over);
  root.addEventListener("dragover", over);
  // `dragleave` part aussi quand le curseur passe d'un enfant à l'autre : sans ce
  // test, le cadre clignoterait tout au long du survol.
  root.addEventListener("dragleave", (e) => {
    if (!root.contains(e.relatedTarget)) root.classList.remove("drop");
  });
  root.addEventListener("drop", (e) => {
    e.preventDefault();
    root.classList.remove("drop");
    const files = [...(e.dataTransfer?.files || [])];
    if (files.length) return dropFiles(id, files);
    // Une image glissée depuis une page web n'est pas un fichier : c'est du texte
    // (son adresse). On le dépose tel quel — Claude sait quoi en faire.
    const text = e.dataTransfer?.getData("text/plain");
    if (text) typeInto(id, text.trim() + " ");
  });
}

async function dropFiles(id, files) {
  const pane = panes.get(id);
  if (!pane) return;
  pane.root.classList.add("busy");
  const paths = [];
  for (const f of files) {
    try {
      const r = await fetch(`/api/terminals/${id}/drop?name=${encodeURIComponent(f.name || "drop")}`, { method: "POST", body: f });
      const out = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(out.error || r.statusText);
      paths.push(out.path);
    } catch (e) {
      alert(`Could not attach ${f.name || "that file"}: ${e.message}`);
    }
  }
  pane.root.classList.remove("busy");
  if (paths.length) typeInto(id, paths.join(" ") + " ");
}

// Sans ces deux lignes, un fichier lâché À CÔTÉ d'un panneau — dans la barre, dans la
// vue des milestones, n'importe où — fait quitter la page pour l'afficher.
addEventListener("dragover", (e) => e.preventDefault());
addEventListener("drop", (e) => e.preventDefault());

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
// Le mode `bypassPermissions` ajoute une question à ce répertoire : au tout premier
// lancement, Claude fait accepter sa mise en garde (« WARNING: Claude Code running in
// Bypass Permissions mode » / « Yes, I accept »). C'est un dialogue comme les autres,
// et coller dedans y vaudrait réponse.
const BLOCKING = /trust this folder|Yes, I trust|No, exit|Yes, I accept|Bypass Permissions mode|Do you want to proceed|Enter to confirm/i;

// Ce que le panneau est en train de FAIRE, lu dans sa sortie : Claude ne l'annonce
// nulle part ailleurs, et le serveur ne le sait pas non plus — il ne tient qu'un pty.
// Sa ligne d'attente, elle, porte « esc to interrupt » tant qu'il travaille, et
// disparaît dès qu'il rend la main. C'est le seul signal disponible sans lui parler.
const WORKING = /esc to interrupt/i;
// Cette ligne se repeint à chaque seconde (elle compte le temps écoulé). Deux secondes
// sans la voir, c'est qu'elle a quitté l'écran, pas qu'elle a sauté un tour.
const WORK_TTL = 2000;

// Trois états, et pas un de plus : il travaille, il attend, ou il n'a rien dit encore.
// Un panneau de shell n'entre pas dans ce vocabulaire — il n'y a pas de « fini » dans
// un shell — et sa pastille reste celle d'avant.
function paneState(pane) {
  if (!pane || pane.kind !== "claude") return "";
  if (!pane.booted) return "cold";
  return Date.now() - pane.busyAt < WORK_TTL ? "work" : "rest";
}

// Repeindre les pastilles de la barre latérale sans refaire la barre. Le rendu, lui,
// suit le rafraîchissement des quatre secondes : à ce rythme, un Claude qui répond en
// deux secondes n'aurait jamais l'air de travailler. Deux classes retouchées, aucun
// nœud remonté — c'est aussi ce qui garde le clavier d'un bouton survolé.
const DOT_SAYS = { work: "Claude is working", rest: "Claude is waiting for you", cold: "Starting up" };

function paintDots() {
  for (const dot of document.querySelectorAll(".sdot[data-pane]")) {
    const st = paneState(panes.get(dot.dataset.pane));
    for (const k of ["work", "rest", "cold"]) dot.classList.toggle(k, st === k);
    dot.parentElement.title = (DOT_SAYS[st] ? DOT_SAYS[st] + " — g" : "G") + "o to this terminal";
  }
}

function pasteSeed(id) {
  const pane = panes.get(id);
  if (!pane?.text) return;
  pane.seed = null;
  typeInto(id, pane.text);
}

// Déposer du texte dans l'invite, en collage encadré et SANS Entrée. L'étape et le
// fichier lâché passent tous deux par ici : un seul endroit où l'on pourrait, un
// jour, ajouter un `\r` par mégarde — et c'est la règle la plus chère du projet.
function typeInto(id, text) {
  const pane = panes.get(id);
  if (!pane || pane.ws?.readyState !== 1) return;
  pane.ws.send(JSON.stringify({ t: "in", d: `\x1b[200~${text}\x1b[201~` }));
  pane.term.focus();
}

setInterval(() => {
  const now = Date.now();
  paintDots();
  for (const [id, pane] of panes) {
    if (pane.pasteBtn) pane.pasteBtn.style.display = pane.text ? "" : "none";
    const asking = pane.booted && BLOCKING.test(pane.tail.slice(-1200));

    if (!pane.seed || !pane.booted || now - pane.lastData < 900) continue;
    if (asking) continue; // un dialogue attend une réponse
    pasteSeed(id);
  }
}, 300);

/* -------------------------------------------------- agrandir un panneau */

// Un panneau agrandi est POSÉ sur la grille, il ne la remplace pas : centré, et tout
// le reste derrière un flou. C'est le MÊME nœud, au même endroit du DOM — `position:
// fixed` le sort du flux, et un fantôme (`.paneslot`) garde sa case dessous. Ni
// déplacement, ni remontage : xterm garde son tampon, son défilement et sa sélection.
//
// Le fantôme n'est pas un détail de mise en page. Sans lui la grille se retasserait
// derrière le flou, puis se retasserait encore à la fermeture — donc deux
// redimensionnements de TOUS les pty, et des mots coupés en travers de panneaux que
// personne n'avait touchés, pour un mouvement que personne n'avait demandé.
//
// On y ENTRE par un clic ; on n'en sort pas de la même façon. La croix ou
// l'arrière-plan, et rien d'autre : un panneau agrandi est fait pour qu'on travaille
// dedans, et un clic de plus dans le vide de sa barre de titre ne doit pas le refermer
// sous les doigts. Échap non plus — dans un terminal, c'est une touche comme une autre,
// et la reprendre ici la volerait à `claude`.
const zoomSlot = el("div", "paneslot");

function setZoom(id) {
  state.zoom = id && panes.has(id) ? id : "";
  layout();
  if (state.zoom) panes.get(state.zoom).term.focus();
}

// L'arrière-plan flouté, et la croix qu'il porte. Elle est là plutôt que dans la barre
// de titre parce que celle du panneau ARRÊTE la session : deux croix à trois
// centimètres l'une de l'autre qui ne font pas la même chose est une faute qu'aucune
// infobulle ne rattrape.
const zoomBack = (() => {
  const b = el("div", "zback");
  b.hidden = true;
  const x = el("button", "zclose", "✕");
  x.type = "button";
  x.title = "Back to the grid";
  b.append(x);
  b.addEventListener("click", () => setZoom(""));
  return b;
})();

// Cliquer un panneau l'agrandit. « Cliquer » veut dire : pas un bouton, pas le
// terminal — il a ses propres clics, on y place un curseur et on y sélectionne — et
// pas la fin d'une sélection : relâcher une phrase surlignée n'est pas un clic. Un
// panneau DÉJÀ agrandi ne réagit plus, sans quoi on le refermerait en visant sa barre.
function zoomTarget(root, id) {
  root.addEventListener("click", (e) => {
    if (state.zoom === id) return;
    if (e.target.closest("button, .term")) return;
    const sel = getSelection();
    if (sel && !sel.isCollapsed) return;
    setZoom(id);
  });
}

/* ---------------------------------------------------- la grille se scinde seule */

// Le nombre de colonnes n'est plus un réglage. « Tous visibles » est une contrainte
// géométrique, pas une préférence : plus on ouvre de panneaux, plus ils rapetissent,
// jusqu'à la taille en dessous de laquelle un terminal ne se lit plus. On cherche donc,
// parmi les découpes possibles, celle dont les cellules ressemblent le plus à un
// terminal — plus larges que hautes — en pénalisant celles qui passent sous le lisible
// et, un peu, celles qui laissent des trous.
//
// La borne basse est une VRAIE borne : `grid-template-rows` la pose en `minmax`, donc
// au-delà d'une quinzaine de panneaux la grille finit par défiler. Mieux vaut ça que
// vingt bandes de trois lignes où plus personne ne lit rien.
const CELL_AR = 1.6;    // largeur / hauteur visée pour une cellule
const CELL_MIN_W = 300;
const CELL_MIN_H = 180;

function gridShape(n, W, H) {
  if (n <= 1) return { cols: 1, rows: 1 };
  // Deux panneaux vont côte à côte, quelle que soit la fenêtre. C'est la seule découpe
  // écrite en dur, et elle ne contredit pas la règle : un terminal est une colonne de
  // lignes, et l'empiler perd des LIGNES — ce qu'on vient lire — là où le rétrécir ne
  // fait que replier le texte. À deux, la moitié de la hauteur coûte donc plus que la
  // moitié de la largeur, et le score, qui ne voit que la forme de la cellule, ne sait
  // pas le dire.
  if (n === 2) return { cols: 2, rows: 1 };
  let best = null;
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const w = W / cols, h = H / rows;
    const tight = Math.max(0, (CELL_MIN_W - w) / CELL_MIN_W) + Math.max(0, (CELL_MIN_H - h) / CELL_MIN_H);
    const score = Math.abs(Math.log(w / h / CELL_AR)) + tight * 6 + (cols * rows - n) * 0.08;
    if (!best || score < best.score) best = { cols, rows, score };
  }
  return best;
}

// La case libre, en pointillés. Elle n'apparaît QUE s'il reste un emplacement dans la
// grille : dans une grille pleine, elle pousserait tout le monde d'un rang pour un
// bouton, et les panneaux rapetisseraient à cause de lui. Le « ＋ » de la barre du haut
// est là pour ce cas-là, et il ne coûte pas une case.
const addTile = (() => {
  const b = el("button", "addpane");
  b.type = "button";
  b.title = "Open another terminal";
  b.append(el("span", "plus", "＋"), el("span", "lab", "New terminal"));
  b.append(el("span", "hint", "Or open one from a project, or from the ▶ button of a milestone. Drop an image on a pane to attach it."));
  b.onclick = () => askTerminal();
  return b;
})();

function layout() {
  const grid = $("#grid");
  // Repliée, la vue n'a pas de dimensions : mesurer ici donnerait une grille d'une
  // colonne qu'on verrait se réorganiser à l'ouverture. `showView` rappelle layout().
  if (!grid.clientWidth || !grid.clientHeight) return;

  if (state.zoom && !panes.has(state.zoom)) state.zoom = "";
  const { cols, rows } = gridShape(panes.size, Math.max(1, grid.clientWidth - 24), Math.max(1, grid.clientHeight - 24));

  grid.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
  grid.style.gridTemplateRows = `repeat(${rows}, minmax(${CELL_MIN_H}px, 1fr))`;

  for (const [id, pane] of panes) pane.root.classList.toggle("zoomed", id === state.zoom);

  // Le fantôme prend la case du panneau agrandi, qui est sorti du flux. La grille garde
  // donc exactement la découpe qu'elle avait, et personne ne bouge derrière le flou.
  if (state.zoom) {
    grid.insertBefore(zoomSlot, panes.get(state.zoom).root);
    if (!zoomBack.isConnected) grid.after(zoomBack);
  } else zoomSlot.remove();
  zoomBack.hidden = !state.zoom;

  const holes = cols * rows - panes.size;
  addTile.classList.toggle("alone", panes.size === 0);
  addTile.hidden = panes.size > 0 && holes < 1;
  grid.append(addTile); // toujours en dernier, donc toujours dans la case qui reste

  setTimeout(() => panes.forEach((_, id) => resize(id)), 60);
}

// Redimensionner la fenêtre change la découpe, pas seulement la taille des cellules :
// deux panneaux côte à côte dans une fenêtre large se rangent l'un sous l'autre dans
// une fenêtre étroite. Temporisé, parce qu'un glissement de bord émet cent événements.
let layoutTimer = null;
addEventListener("resize", () => {
  clearTimeout(layoutTimer);
  layoutTimer = setTimeout(layout, 120);
});

/* ------------------------------------------------------------------ vues */

function showView(v) {
  state.view = v;
  $$(".tab").forEach((b) => b.classList.toggle("on", b.dataset.view === v));
  $("#view-board").classList.toggle("hidden", v !== "board");
  $("#view-terms").classList.toggle("hidden", v !== "terms");
  writeHash();
  if (v === "terms") setTimeout(layout, 0);
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

  // Le panneau suit l'adresse dans les DEUX sens : ouvert par l'adresse au chargement,
  // et l'adresse effacée quand on le ferme. Sans le second, un rechargement rouvrirait
  // un panneau qu'on venait de fermer.
  showPanel(state.panel);
  // `showPanel` ne fait rien quand le panneau est déjà ouvert : c'est ici que la
  // section suit l'adresse, pour qu'un `#s=settings&sp=perm` collé dans la barre
  // ouvre bien la bonne — c'est ce dont la capture headless a besoin.
  if (state.panel === "settings") showSetPane(state.setPane);
  // La fenêtre de consigne peut s'ouvrir AVANT que `/preview` ait répondu : elle se
  // repeint donc à chaque tour, jusqu'à ce que le fichier arrive. `renderTune` ne
  // touche au champ que la première fois — une phrase en cours de frappe est à l'abri.
  if (state.panel === "tune" && $("#tune").open) renderTune();
}

// Les panneaux qui ont une adresse, et ce qui les ouvre. La liste est ICI et nulle part
// ailleurs : c'est elle que `readHash` valide et que `showPanel` parcourt, donc un
// panneau de plus est une ligne de plus, pas trois endroits à retrouver.
const PANELS = {
  settings: ["#settings", openSettings],
  new: ["#creator", openCreator],
  term: ["#newterm", openNewTerm],
  icon: ["#icon", openIconPicker],
  tune: ["#tune", openTune],
};

let shownPanel = "";
function showPanel(which) {
  if (which === shownPanel) return;
  shownPanel = which;
  for (const [key, [id, open]] of Object.entries(PANELS)) {
    const dlg = $(id);
    if (which === key) { if (!dlg.open) open(); }
    else if (dlg.open) dlg.close();
  }
}

// Fermer un panneau — au bouton, à Échap, ou au clic hors du cadre — efface son
// adresse. `close` couvre les trois, `showModal` n'en couvre aucune tout seul.
const forgetPanel = () => { if (state.panel) { state.panel = ""; shownPanel = ""; writeHash(); } };

/* -------------------------------------------------- ajouter un projet */

// Le même navigateur de dossiers sert aux DEUX chemins, et c'est voulu : ils partent
// du même geste — désigner un endroit sur le disque — et ne divergent qu'après.
// `mode` dit lequel : « track » suit le dossier qu'on ouvre, « pick » ne fait que
// rapporter le dossier PARENT dans lequel le nouveau projet naîtra.
let browseMode = "track";
let browseAt = "";

async function browse(dir) {
  const q = dir ? `?dir=${encodeURIComponent(dir)}` : "";
  const data = await api("GET", "/api/browse" + q);
  browseAt = data.dir;
  $("#crumb").textContent = short(data.dir);
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
      // En mode « pick », un clic ne fait qu'entrer : on choisit le dossier où l'on
      // est, par le bouton du bas. Confondre les deux gestes ferait créer un projet
      // dans le premier dossier survolé.
      if (browseMode === "pick") return browse(d.path);
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

const short = (s) => String(s || "").replace(/^\/Users\/[^/]+/, "~");

function openBrowser(mode) {
  browseMode = mode;
  $("#browser-title").textContent = mode === "pick" ? "Where should it live?" : "Track a project";
  $("#pick-here").classList.toggle("hidden", mode !== "pick");
  $("#browser").showModal();
  browse(mode === "pick" ? newProject.parent : "");
}

/* ------------------------------------------------ la consommation du forfait */

// Deux montages, UN rendu. La barre latérale porte la version courte — c'est
// l'information qu'on veut sans rien ouvrir, au même titre que l'avancement d'un
// projet — et le panneau des réglages la version longue, avec les dates de remise à
// zéro, dans le même onglet que le fournisseur qui dépense ce forfait. Deux rendus
// séparés finiraient par ne plus dire la même chose du même chiffre.
//
// La lecture ne coûte pas un token (cf. `usage.mjs`), mais elle coûte un
// sous-processus : elle est donc HORS de la boucle des quatre secondes, sur son
// propre rythme, et à l'arrêt tant que la fenêtre n'est pas regardée.

const USAGE_EVERY = 120_000;
let usage = { state: "loading", data: null };

async function loadUsage(fresh = false) {
  if (fresh) usage = { state: "loading", data: null };
  paintUsage();
  try {
    const r = await api("GET", "/api/usage" + (fresh ? "?fresh=1" : ""));
    usage = { state: "done", data: r.usage };
  } catch {
    usage = { state: "done", data: null };
  }
  paintUsage();
}

// Trois paliers, et c'est le seul endroit de la barre latérale où la couleur ne
// vient pas du dégradé : un forfait qui se remplit n'est pas un avancement, et le
// peindre en violet le lirait comme une réussite. Sous 70 %, il n'a rien à dire et
// reste en encre ; au-delà, il signale un état, ce qui lui donne droit à sa couleur.
const useLevel = (p) => (p >= 90 ? "hot" : p >= 70 ? "warm" : "cool");
const useName = (w) => (w.scope ? `${w.name} · ${w.scope}` : w.name);

// La fenêtre courte se donne en DÉLAI (« resets in 2 h 40 ») : c'est une attente, et
// personne ne convertit de tête une heure absolue en « puis-je repartir avant midi ».
// La semaine se donne en JOUR — à trois jours, on ne compte plus en heures.
function useReset(ms, kind) {
  if (!ms) return "";
  const left = ms - Date.now();
  if (left <= 0) return "resets now";
  if (kind === "session" || left < 24 * 3600e3) {
    const h = Math.floor(left / 3600e3);
    const m = Math.floor((left % 3600e3) / 60e3);
    return "resets in " + (h ? `${h} h ${m} min` : m ? `${m} min` : "under a minute");
  }
  return "resets " + new Date(ms).toLocaleString("en-GB",
    { weekday: "long", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function renderUsage(host, compact) {
  host.textContent = "";

  const head = el("div", "use-head");
  head.append(el("span", null, "Plan usage"));
  if (usage.data?.plan) head.append(el("span", "use-plan", usage.data.plan));
  const ref = el("button", "use-ref", "↻");
  ref.type = "button";
  ref.title = "Read it again";
  ref.disabled = usage.state === "loading";
  ref.onclick = () => loadUsage(true);
  head.append(ref);
  host.append(head);

  if (usage.state === "loading") return void host.append(el("p", "use-note", "reading…"));

  const u = usage.data;
  // Indisponible n'est pas une panne : le CLI n'a pas répondu, et rien dans l'app
  // n'en dépend. On le dit une fois, sans rouge et sans commande à taper — il n'y
  // en a pas qui répare ça.
  if (!u) return void host.append(el("p", "use-note",
    compact ? "unavailable" : "Unavailable — the claude CLI did not answer. Nothing else in Pyra depends on this."));
  if (!u.available) return void host.append(el("p", "use-note", u.reason === "metered"
    ? "Pay as you go: this account has no plan allowance to show."
    : "This plan reports no window to show."));

  for (const w of u.windows) {
    const item = el("div", "use-item");
    const line = el("div", "use-line");
    line.append(el("span", "use-nm", useName(w)), el("span", "use-pc", w.percent + " %"));
    const track = el("div", "use-track");
    const i = el("i", useLevel(w.percent));
    // Un fond de piste vide et une barre à 0 % se ressemblent trop : le filet
    // minimal dit « cette fenêtre existe et elle est intacte ».
    i.style.width = Math.max(w.percent, 1.5) + "%";
    track.append(i);
    item.append(line, track);
    const r = useReset(w.resetsAt, w.kind);
    if (r) {
      if (compact) item.title = r;               // le rail est étroit : au survol
      else item.append(el("div", "use-reset", r)); // le panneau a la place de l'écrire
    }
    host.append(item);
  }
}

function paintUsage() {
  renderUsage($("#usage"), true);
  renderUsage($("#set-usage"), false);
}

/* ------------------------------------------------------------ les réglages */

// Les réglages voyagent dans `/api/state` : ils vivent en mémoire côté serveur, donc
// les relire ne coûte rien. Les CONNEXIONS, elles, coûtent deux sous-processus (`gh`
// et `claude --version`) — on ne les demande qu'à l'ouverture du panneau, jamais dans
// la boucle des quatre secondes.
const settings = () => state.data?.settings || null;
let providers = [];
let conns = null;

// La table des modes de permission vient du serveur (`settings.mjs`) : c'est LUI qui
// sait quels drapeaux existent, et une seconde liste écrite ici finirait par proposer
// un mode que le CLI a retiré. En attendant sa réponse, l'en-tête d'un panneau se
// contente de l'identifiant brut — c'est déjà l'information.
let permModes = [];
const permMode = (id) => permModes.find((m) => m.id === id) || null;

// Les automatismes, écrits UNE fois et rendus deux : dans le panneau (les défauts) et
// dans le formulaire de création (ce projet-ci). Deux listes finiraient par diverger,
// et l'utilisateur croirait à deux réglages différents pour la même chose.
//
// `cost` porte la seule distinction qui compte vraiment ici. Tout ce que l'app
// déclenche d'elle-même est gratuit ; une seule ligne dépense, elle est marquée, et
// elle est décochée par défaut.
const CREATE_OPTS = [
  {
    key: "git", label: "Initialise a git repository", cost: "free",
    desc: "git init, then a first commit holding the README and the milestones.",
  },
  {
    key: "remote", label: "Create the GitHub repository", cost: "free", needs: "git",
    desc: "gh repo create, pushed straight away, using the account signed in above.",
  },
  {
    key: "graph", label: "Build the knowledge graph", cost: "free",
    desc: "Local AST extraction — no model call, no token. A project born a minute ago has no code yet, so this stays empty until there is some.",
  },
  {
    key: "milestones", label: "Write a starter MILESTONES.md", cost: "free",
    desc: "Three lines meant to be replaced. Written on disk, not by the model.",
  },
  {
    key: "generate", label: "Ask the model for milestones", cost: "cost",
    desc: "Claude reads the repository and its proposals are grafted in. This is the one that spends tokens — and a repository that was just born has almost nothing to read.",
  },
  {
    key: "sync", label: "Keep git in sync", cost: "free", needs: "git",
    desc: "Commits and pushes only what Pyra writes: MILESTONES.md and the block it grafts into CLAUDE.md. Never your own work in progress.",
  },
];

// Le « ? » d'une ligne : l'explication ne prend plus de place, elle attend le
// curseur. La bulle est un ENFANT du point d'interrogation — c'est le survol du
// point, pas celui de la ligne, qui la montre, sinon six bulles s'ouvriraient en
// balayant la liste. Et le clic est ANNULÉ : le tout vit dans un `<label>`, où
// n'importe quel clic cocherait la case qu'on voulait seulement comprendre.
function hint(text) {
  const q = el("span", "oq");
  q.tabIndex = 0;
  q.setAttribute("aria-label", text);
  q.append("?", el("span", "ob", text));
  q.onclick = (e) => { e.preventDefault(); e.stopPropagation(); };
  return q;
}

// Une case par automatisme. `needs` grise celles qui n'ont plus de sens — décocher
// « git » rend « GitHub » et « sync » sans objet, et les laisser cliquables ferait
// croire qu'on peut pousser dans un dépôt qui n'existe pas.
function optList(host, values, onChange) {
  host.textContent = "";
  for (const o of CREATE_OPTS) {
    const dead = o.needs && !values[o.needs];
    const row = el("label", "opt" + (dead ? " off" : ""));
    const box = el("input");
    box.type = "checkbox";
    box.checked = !!values[o.key] && !dead;
    box.disabled = dead;
    box.onchange = () => { values[o.key] = box.checked; onChange(o.key, box.checked); optList(host, values, onChange); };
    const txt = el("div");
    const line = el("div", "ol");
    line.append(el("span", null, o.label));
    line.append(el("span", "tag " + o.cost, o.cost === "cost" ? "spends tokens" : "free"));
    line.append(hint(o.desc));
    txt.append(line);
    row.append(box, txt);
    host.append(row);
  }
}

// Les sections du panneau. La liste est ici et non dans le HTML pour la même raison
// que `CREATE_OPTS` : c'est elle qui valide ce qui arrive par l'adresse. Plus de
// section « usage » : la consommation est dans « model », sous le fournisseur qui la
// dépense — et un `sp=usage` d'hier retombe sur `model`, donc sur ce qu'il cherchait.
const SET_PANES = ["model", "perm", "conn", "create"];

function showSetPane(name) {
  const want = SET_PANES.includes(name) ? name : "model";
  for (const b of $$("#set-nav button")) {
    const on = b.dataset.pane === want;
    b.classList.toggle("on", on);
    b.setAttribute("aria-selected", on ? "true" : "false");
  }
  for (const sec of $$("#settings .spane")) sec.hidden = sec.dataset.pane !== want;
}

async function openSettings() {
  $("#settings").showModal();
  showSetPane(state.setPane);
  renderSettings();
  // La consommation vit sur son propre rythme, mais ouvrir le panneau est le geste
  // qui dit qu'on veut la voir : on la relit si elle a vieilli. Le cache du serveur
  // absorbe le reste — deux ouvertures d'affilée ne lancent qu'un sous-processus.
  loadUsage();
  // Les connexions arrivent après coup : le panneau s'ouvre tout de suite et se
  // complète, plutôt que de faire attendre un clic sur deux sous-processus.
  conns = await api("GET", "/api/connections").catch(() => null);
  const s = await api("GET", "/api/settings").catch(() => null);
  if (s) { providers = s.providers; permModes = s.permissionModes || permModes; }
  renderSettings();
}

// Ouvrir un panneau demande le projet, et rien d'autre. Le dialogue est refait à
// chaque ouverture : le nombre de panneaux vivants par projet a bougé entre-temps.
function openNewTerm() {
  $("#newterm").showModal();
  renderNewTerm();
}

function renderSettings() {
  const set = settings();
  if (!set) return;

  const list = providers.length ? providers : [{ id: set.provider, name: "Claude", vendor: "Anthropic", models: [""] }];

  const host = $("#providers");
  host.textContent = "";
  for (const pv of list) {
    const row = el("button", "pv-row" + (pv.id === set.provider ? " on" : ""));
    row.type = "button";
    row.append(el("span", "tick"));
    const txt = el("div");
    txt.append(el("div", "nm", pv.name), el("div", "vd", pv.vendor));
    row.append(txt);

    // L'état réel du binaire, pas une promesse : une version trop vieille ou un
    // exécutable absent se lisent ICI, plutôt qu'au premier échec de génération.
    const st = el("div", "st");
    if (conns?.provider && conns.provider.id === pv.id) {
      if (conns.provider.error) { st.classList.add("bad"); st.textContent = conns.provider.error; }
      else {
        st.append(el("div", null, conns.provider.version));
        st.append(el("div", null, short(conns.provider.bin)));
      }
    } else st.textContent = pv.id === set.provider ? "checking…" : "";
    row.append(st);

    row.onclick = () => saveSettings({ provider: pv.id });
    host.append(row);
  }

  const models = list.find((x) => x.id === set.provider)?.models || [""];
  const sel = $("#set-model");
  sel.textContent = "";
  for (const m of models) {
    const o = el("option", null, m || "Default");
    o.value = m;
    if (m === set.model) o.selected = true;
    sel.append(o);
  }
  sel.onchange = () => saveSettings({ model: sel.value });

  const gh = $("#conn-github");
  gh.textContent = "";
  gh.className = "conn" + (conns?.github?.authenticated ? "" : " off");
  gh.append(el("span", "cdot"));
  gh.append(el("span", "cn", "GitHub"));
  if (!conns) gh.append(el("span", "cs", "checking…"));
  else if (conns.github.authenticated) gh.append(el("span", "cs", "signed in as " + conns.github.login));
  else {
    // Le message porte la commande à taper. Un simple « non connecté » laisserait
    // l'utilisateur chercher où, et l'app ne stocke aucun jeton : c'est `gh` qui
    // tient l'authentification, dans le trousseau du Mac.
    const cs = el("span", "cs");
    const m = /run: (.+)$/.exec(conns.github.error || "");
    if (m) { cs.append("not connected — run "); cs.append(el("code", null, m[1])); }
    else cs.textContent = conns.github.error || "not connected";
    gh.append(cs);
  }

  const vis = $("#set-visibility");
  vis.value = set.github.visibility;
  vis.onchange = () => saveSettings({ github: { visibility: vis.value } });

  const br = $("#set-branch");
  if (document.activeElement !== br) br.value = set.github.defaultBranch;
  br.onchange = () => saveSettings({ github: { defaultBranch: br.value.trim() || "main" } });

  optList($("#create-opts"), { ...set.create }, (key, val) => saveSettings({ create: { [key]: val } }));
  renderModes(set);
}

// Un mode par ligne, exclusifs, avec ce que chacun fait vraiment. Deux étiquettes et
// deux seulement : celle qui dit « ne demande rien » et celle qui dit « dépense ».
// C'est la même grammaire que les automatismes de la création — un réglage qui coûte
// ou qui engage doit se voir sans avoir à lire la description.
function renderModes(set) {
  const host = $("#perm-modes");
  host.textContent = "";
  if (!permModes.length) { host.append(el("div", "fhint", "…")); return; }
  for (const m of permModes) {
    const row = el("label", "opt");
    const box = el("input");
    box.type = "radio";
    box.name = "perm";
    box.checked = m.id === set.permissionMode;
    box.onchange = () => saveSettings({ permissionMode: m.id });
    const txt = el("div");
    const line = el("div", "ol");
    line.append(el("span", null, m.label));
    if (m.tone === "hot") line.append(el("span", "tag hot", "no questions asked"));
    if (m.cost) line.append(el("span", "tag cost", "spends tokens"));
    txt.append(line, el("div", "od", m.desc));
    row.append(box, txt);
    host.append(row);
  }
}

async function saveSettings(patch) {
  const r = await api("PUT", "/api/settings", patch);
  if (state.data) state.data.settings = r.settings;
  providers = r.providers;
  if (r.permissionModes) permModes = r.permissionModes;
  // Changer de provider change le binaire : l'état affiché n'est plus le bon.
  if (patch.provider) { conns = null; renderSettings(); conns = await api("GET", "/api/connections").catch(() => null); }
  renderSettings();
}

/* ------------------------------------------------- créer un projet de zéro */

// Ce que le formulaire tient entre deux ouvertures : le dossier parent choisi survit,
// puisqu'on crée en général plusieurs projets au même endroit.
const newProject = { parent: "", opts: null, icon: "🌱" };

function openCreator() {
  const set = settings();
  if (!set) return;
  newProject.opts = { ...set.create };
  if (!newProject.parent) newProject.parent = "";
  $("#new-name").value = "";
  $("#new-error").textContent = "";
  $("#creator").showModal();
  renderCreator();
  $("#new-name").focus();
}

function renderCreator() {
  const name = $("#new-name").value.trim();
  const parent = newProject.parent || "~/Documents";
  $("#new-parent").textContent = short(parent);
  // Le chemin exact est montré AVANT la création. Un nom devient un nom de dossier —
  // « Skull King » donne « Skull King », mais le dépôt GitHub, lui, s'appellera
  // « skull-king ». Le voir d'avance évite la surprise après coup.
  $("#new-path").textContent = name
    ? `${short(parent)}/${name.replace(/[/\\:\0]/g, "-")}` + (newProject.opts.remote ? `  ·  github.com/…/${slugify(name)}` : "")
    : "Pick a name and the folder will follow it.";

  // Le formulaire ne fait que TENIR le choix : rien n'est envoyé avant « Create ». Et
  // `paint` ne repeint QUE la planche et le liseré — repasser par `renderCreator` à
  // chaque frappe réécrirait le champ sous les doigts de celui qui tape son emoji.
  const em = $("#new-emoji");
  const paint = () => {
    em.classList.toggle("on", !isPyr(newProject.icon));
    iconSwatches($("#new-swatches"), newProject.icon, (v) => { newProject.icon = v; em.value = ""; paint(); });
  };
  if (em.value.trim() !== newProject.icon) em.value = isPyr(newProject.icon) ? "" : newProject.icon;
  em.oninput = () => { newProject.icon = em.value.trim() || "🌱"; paint(); };
  paint();

  optList($("#new-opts"), newProject.opts, () => renderCreator());
}

// Le même nettoyage que `slug()` côté serveur, pour ANNONCER le nom du dépôt. Le
// serveur reste seul juge : ceci n'est qu'un aperçu, jamais ce qui est envoyé.
const slugify = (s) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[-.]+|[-.]+$/g, "").slice(0, 90).toLowerCase();

async function createProject() {
  const name = $("#new-name").value.trim();
  const err = $("#new-error");
  err.textContent = "";
  if (!name) { err.textContent = "It needs a name."; return; }

  const go = $("#new-go");
  go.disabled = true;
  try {
    const proj = await api("POST", "/api/projects/new", {
      name,
      emoji: newProject.icon,
      parent: newProject.parent || undefined,
      ...newProject.opts,
    });
    $("#creator").close();
    // On ouvre le projet tout de suite : l'installation se déroule sous ses yeux,
    // dans l'étage du haut. Attendre la fin sur un dialogue figé donnerait
    // l'impression que le clic n'a rien fait.
    state.selected = proj.id;
    writeHash();
    await refresh();
  } catch (e) {
    err.textContent = String(e.message || e);
  } finally {
    go.disabled = false;
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
  // Les deux panneaux ont une adresse eux aussi (`#s=settings`, `#s=new`). Même
  // raison que pour les visionneuses : la vérification visuelle se fait en headless,
  // où personne ne clique — un panneau sans adresse est un panneau qu'on ne peut pas
  // regarder autrement qu'à la main.
  const sp = h.get("s");
  state.panel = PANELS[sp] ? sp : "";
  state.setPane = SET_PANES.includes(h.get("sp")) ? h.get("sp") : "model";
  showView(h.get("v") === "terms" ? "terms" : "board");
}
function writeHash() {
  const h = new URLSearchParams();
  if (state.selected) h.set("p", state.selected);
  if (state.view === "terms") h.set("v", "terms");
  if (state.dialog && state.selected) h.set("d", state.dialog);
  if (state.panel) h.set("s", state.panel);
  if (state.panel === "settings" && state.setPane !== "model") h.set("sp", state.setPane);
  const next = h.toString() ? "#" + h : "#";
  if (location.hash !== next) history.replaceState(null, "", next);
}

$$(".tab").forEach((b) => (b.onclick = () => { showView(b.dataset.view); writeHash(); }));
$(".proj.all").onclick = () => showProject("");
addEventListener("hashchange", () => { readHash(); render(); });
$("#new-term").onclick = () => askTerminal();
$("#add-project").onclick = () => openBrowser("track");
$("#new-project").onclick = () => { state.panel = "new"; writeHash(); render(); };
$("#open-settings").onclick = () => { state.panel = "settings"; writeHash(); render(); };
$("#settings-close").onclick = () => $("#settings").close();
$("#set-nav").onclick = (e) => {
  const b = e.target.closest("button[data-pane]");
  if (!b) return;
  state.setPane = b.dataset.pane;
  writeHash();
  showSetPane(state.setPane);
};
$("#creator-close").onclick = () => $("#creator").close();
$("#newterm-close").onclick = () => $("#newterm").close();
$("#icon-close").onclick = () => $("#icon").close();
$("#tune-close").onclick = () => $("#tune").close();
$("#tune-go").onclick = () => submitTune();
// ⌘⏎ envoie, comme partout ailleurs. Entrée seul revient à la ligne : la consigne fait
// souvent trois phrases, et un formulaire qui part sous les doigts au premier retour
// chariot est un formulaire qu'on n'ose plus remplir.
$("#tune-text").onkeydown = (e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submitTune(); } };
// Le champ est rempli à l'ouverture et oublié à la fermeture : rouvrir la fenêtre
// relit le fichier, plutôt que de ressortir un brouillon abandonné.
$("#tune").addEventListener("close", () => { $("#tune-text").dataset.for = ""; });
for (const [id] of Object.values(PANELS)) $(id).addEventListener("close", forgetPanel);
$("#new-go").onclick = () => createProject();
$("#new-name").oninput = () => renderCreator();
$("#new-name").onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); createProject(); } };
$("#new-parent").onclick = () => openBrowser("pick");
// « Create it here » désigne le dossier COURANT du navigateur, pas celui qu'on
// survole : c'est le dossier parent, celui dans lequel le projet va naître.
$("#pick-here").onclick = () => {
  newProject.parent = browseAt;
  $("#browser").close();
  if ($("#creator").open) renderCreator();
};

// Ouverte par l'app Mac (`?app=1`), la page porte sa propre barre de titre.
if (new URLSearchParams(location.search).has("app")) document.body.classList.add("in-app");

readHash();
refresh();
setInterval(refresh, 4000);

// La consommation a son propre rythme, deux minutes, et s'arrête quand l'onglet
// passe à l'arrière-plan : chaque tour est un `claude` de deux secondes, et personne
// ne lit une barre qu'il ne regarde pas. Elle repart au retour, sans attendre le
// prochain tour — c'est justement le moment où le chiffre a bougé.
loadUsage();
setInterval(() => { if (!document.hidden) loadUsage(); }, USAGE_EVERY);
addEventListener("visibilitychange", () => { if (!document.hidden) loadUsage(); });
