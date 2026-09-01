// Copyright © 2026 Paul Gregory. Tous droits réservés.
// UI de Pyramis. Trois responsabilités : afficher l'avancement des projets, éditer
// les étapes (qui partent dans le ETAPES.md du dépôt), et tenir N terminaux vivants.

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const el = (tag, cls, txt) => { const n = document.createElement(tag); if (cls) n.className = cls; if (txt != null) n.textContent = txt; return n; };

const STATUS = {
  todo: { label: "À faire", next: "doing" },
  doing: { label: "En cours", next: "blocked" },
  blocked: { label: "Bloqué", next: "done" },
  done: { label: "Fait", next: "todo" },
};
const ORDER = ["todo", "doing", "blocked", "done"];

const state = { data: null, selected: "", view: "board" };
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
    if (p.stats.total) meta.append(el("span", null, `${p.stats.done}/${p.stats.total}`));
    if (!p.exists) meta.append(el("span", null, "⚠"));
    b.append(meta);
    b.onclick = () => { state.selected = p.id; writeHash(); render(); };
    box.append(b);

    if (p.stats.total) {
      const g = el("div", "gauge");
      const i = el("i");
      i.style.width = `${Math.round((p.stats.done / p.stats.total) * 100)}%`;
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
        s.append(el("span", "stag", "ailleurs"));
        s.title = r.background
          ? "Session d'arrière-plan : la reprendre dans un panneau ici."
          : "Session ouverte dans un autre terminal. L'ouvrir ici crée une branche — celle d'origine continue intacte.";
        s.onclick = () => joinSession(p, r);
      } else {
        s.title = "Aller à ce terminal";
        s.onclick = () => focusPane(r.id);
      }
      list.append(s);
    }
    box.append(list);
  }
  $(".proj.all").classList.toggle("on", !state.selected);
  const n = state.data.liveCount;
  $("#live").innerHTML = `<b>${n}</b> session${n > 1 ? "s" : ""} Claude`;
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
    `« ${r.label} » tourne dans un autre terminal.\n\n` +
    `L'ouvrir ici en reprend le fil dans une branche : la session d'origine continue de son côté, intacte.`
  )) return;
  try {
    const { id } = await api("POST", "/api/attach", {
      projectId: p.id, sessionId: r.id, label: r.label, cwd: r.cwd, background: Boolean(r.background),
    });
    showView("terms");
    await refresh();
    focusPane(id);
  } catch (e) { alert("Impossible de rejoindre cette session : " + e.message); }
}

/* ------------------------------------------------------- vue d'ensemble */

function renderOverview(view) {
  const head = el("div", "phead");
  head.append(el("h1", null, "Tous les projets"));
  head.append(el("span", "grow"));
  view.append(head);

  const sub = el("div", "path");
  sub.style.color = "var(--faint)";
  sub.style.fontSize = "12px";
  const doing = state.data.projects.reduce((n, p) => n + p.stats.doing, 0);
  const blocked = state.data.projects.reduce((n, p) => n + p.stats.blocked, 0);
  sub.textContent = `${state.data.projects.length} projets · ${doing} étape${doing > 1 ? "s" : ""} en cours · ${blocked} bloquée${blocked > 1 ? "s" : ""}`;
  view.append(sub);

  const cards = el("div", "cards");
  for (const p of state.data.projects) {
    const c = el("div", "card");
    const h = el("h2");
    h.append(el("span", null, p.emoji), el("span", null, p.name));
    if (p.sessions.length) h.append(el("span", "dot"));
    c.append(h);

    const bits = [];
    if (!p.exists) bits.push("dossier introuvable");
    else if (!p.hasFile) bits.push("aucune étape notée");
    else bits.push(`${p.stats.done}/${p.stats.total} étapes`);
    if (p.sessions.length) bits.push(`${p.sessions.length} session${p.sessions.length > 1 ? "s" : ""}`);
    const opened = p.terminals.filter((t) => t.alive).length;
    if (opened) bits.push(opened > 1 ? `${opened} terminaux ici` : "1 terminal ici");
    c.append(el("div", "sub", bits.join(" · ")));

    // La carte ne montre QUE ce qui bouge ou coince. Une liste exhaustive
    // reproduirait le problème qu'on essaie de régler.
    const hot = p.steps.filter((m) => m.status === "doing" || m.status === "blocked");
    if (hot.length) {
      const ul = el("ul");
      for (const m of hot.slice(0, 5)) {
        const li = el("li");
        li.append(el("span", null, m.status === "blocked" ? "⛔" : "▸"));
        li.append(el("b", null, m.title));
        if (m.due) li.append(dueTag(m.due));
        ul.append(li);
      }
      c.append(ul);
    } else {
      c.append(el("div", "empty", p.stats.total ? "rien en cours" : "pas encore d'étapes"));
    }

    const row = el("div", "ms-row");
    row.style.cssText = "display:flex;gap:6px;margin-top:12px";
    const open = el("button", "btn ghost", "Ouvrir");
    open.onclick = () => { state.selected = p.id; writeHash(); render(); };
    const term = el("button", "btn ghost", "＋ Terminal");
    term.onclick = () => openTerminal(p.id, "claude");
    row.append(open, term);
    c.append(row);
    cards.append(c);
  }
  view.append(cards);
}

function dueTag(due) {
  const days = Math.round((new Date(due + "T12:00:00") - Date.now()) / 86400000);
  const t = el("span", "due" + (days < 0 ? " late" : days <= 7 ? " soon" : ""), due);
  t.title = days < 0 ? `en retard de ${-days} j` : `dans ${days} j`;
  return t;
}

/* ---------------------------------------------------------- vue projet */

function renderProject(view, p) {
  const head = el("div", "phead");
  head.append(el("span", "pe", p.emoji));
  head.append(el("h1", null, p.name));
  head.append(el("span", "path", p.path.replace(/^\/Users\/[^/]+/, "~")));
  head.append(el("span", "grow"));

  const bClaude = el("button", "btn primary", "＋ Claude ici");
  bClaude.onclick = () => openTerminal(p.id, "claude");
  const bShell = el("button", "btn", "＋ Shell");
  bShell.onclick = () => openTerminal(p.id, "shell");
  const bDrop = el("button", "btn ghost", "Retirer");
  bDrop.title = "Retire le projet du suivi. Le ETAPES.md reste dans le dépôt.";
  bDrop.onclick = async () => {
    if (!confirm(`Retirer « ${p.name} » du suivi ?\nAucun fichier ne sera supprimé.`)) return;
    await api("DELETE", `/api/projects/${p.id}`);
    state.selected = "";
    writeHash();
    refresh();
  };
  head.append(bClaude, bShell, bDrop);
  view.append(head);

  if (!p.exists) {
    view.append(el("div", "empty", "Le dossier de ce projet n'existe plus à cette adresse."));
    return;
  }

  const sessions = el("div", "path");
  sessions.style.cssText = "color:var(--faint);font-size:12px";
  sessions.textContent = p.sessions.length
    ? "Sessions vivantes : " + p.sessions.map((s) => `${s.name || s.sessionId.slice(0, 8)} (${s.kind})`).join(" · ")
    : (p.hasFile ? "" : "ETAPES.md sera créé à la première étape.");
  view.append(sessions);

  const cols = el("div", "cols4");
  for (const key of ORDER) {
    const col = el("div", "col " + key);
    const h = el("h3");
    h.append(el("span", null, STATUS[key].label));
    const list = p.steps.filter((m) => m.status === key);
    h.append(el("em", null, String(list.length)));
    col.append(h);
    for (const m of list) col.append(stepCard(p, m));
    if (key === "todo") {
      const add = el("button", "newms", "＋ Nouvelle étape");
      add.onclick = () => addStep(p);
      col.append(add);
    }
    cols.append(col);
  }
  view.append(cols);
}

function stepCard(p, m) {
  const card = el("div", "ms");

  const title = el("div", "t", m.title || "(sans titre)");
  title.onclick = () => edit(title, m.title, (v) => save(p, m, { title: v }));
  card.append(title);

  const detail = el("div", "d", m.detail || "");
  detail.onclick = () => edit(detail, m.detail, (v) => save(p, m, { detail: v }), true);
  card.append(detail);

  const row = el("div", "row");
  const st = el("button", "chip", STATUS[m.status].label);
  st.title = "Faire avancer le statut";
  st.onclick = () => save(p, m, { status: STATUS[m.status].next });
  row.append(st);

  // Un champ date vide sur une étape déjà faite n'affiche qu'un « jj/mm/aaaa » inutile.
  // On ne le montre que s'il porte une information ou s'il peut encore en recevoir une.
  if (m.status !== "done" || m.due) {
    const due = el("input", "chip");
    due.type = "date";
    due.value = m.due || "";
    due.title = "Échéance";
    due.style.cssText = "padding:1px 5px";
    due.onchange = () => save(p, m, { due: due.value || null });
    row.append(due);
  }

  row.append(el("span", "grow"));

  // Le geste central : passer d'une étape écrite à un Claude qui travaille dessus,
  // dans le bon dossier, sans retaper le contexte.
  // Rien à attaquer sur une étape déjà faite : le bouton n'apparaît pas.
  if (m.status !== "done") {
    const go = el("button", "chip go", "▶ Attaquer");
    go.title = "Ouvre un terminal Claude dans ce projet, avec l'étape déjà collée (sans l'envoyer).";
    go.onclick = () => openTerminal(p.id, "claude", promptFor(p, m), m.title);
    row.append(go);
  }

  const del = el("button", "chip", "✕");
  del.title = "Supprimer cette étape";
  del.onclick = () => { if (confirm(`Supprimer « ${m.title} » ?`)) save(p, m, null); };
  row.append(del);

  card.append(row);
  return card;
}

const promptFor = (p, m) => {
  const detail = (m.detail || "").replace(/\s+/g, " ").trim();
  return `Étape du projet ${p.name} : ${m.title}.` + (detail ? ` Contexte : ${detail}` : "") + ` Propose-moi d'abord comment tu comptes t'y prendre.`;
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
async function save(p, m, patch) {
  const items = p.steps
    .map((x) => (x.id === m.id ? (patch === null ? null : { ...x, ...patch }) : x))
    .filter(Boolean);
  try {
    const out = await api("PUT", `/api/projects/${p.id}/steps`, { items });
    p.steps = out.items;
    refresh();
  } catch (e) {
    alert("Enregistrement impossible : " + e.message);
  }
}

async function addStep(p) {
  const title = prompt("Nouvelle étape :");
  if (!title || !title.trim()) return;
  const items = [...p.steps, { id: "new-" + Math.random().toString(36).slice(2, 8), status: "todo", title: title.trim(), detail: "", due: null }];
  try {
    const out = await api("PUT", `/api/projects/${p.id}/steps`, { items });
    p.steps = out.items;
    refresh();
  } catch (e) { alert("Enregistrement impossible : " + e.message); }
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
  } catch (e) { alert("Terminal impossible : " + e.message); }
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
    grid.append(el("div", "blank", "Aucun terminal. Ouvre-en un depuis un projet, ou depuis le bouton ▶ d'une étape."));
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
  const paste = el("button", null, "⌥ étape");
  paste.title = "Coller l'étape dans l'invite (sans l'envoyer)";
  paste.style.display = "none";
  paste.onclick = () => pasteSeed(t.id);
  head.append(paste);

  const solo = el("button", null, "⤢");
  solo.title = "Une seule colonne";
  solo.onclick = () => { $("#cols").value = "1"; setCols(); };
  const close = el("button", null, "✕");
  close.title = "Fermer et arrêter la session";
  close.onclick = async () => {
    if (t.alive && !confirm("Arrêter cette session ?")) return;
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
    else if (m.t === "exit") { term.write(`\r\n\x1b[90m— session terminée (code ${m.code}) —\x1b[0m\r\n`); refresh(); }
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
  localStorage.setItem("pyramis.cols", $("#cols").value);
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
    const b = el("button", "up", "‹ dossier parent");
    b.onclick = (e) => { e.preventDefault(); browse(data.parent); };
    li.append(b); ul.append(li);
  }
  for (const d of data.dirs) {
    const li = el("li");
    const b = el("button");
    b.append(el("span", null, "📁"), el("span", null, d.name));
    if (d.known) b.append(el("span", "known", "déjà suivi"));
    b.onclick = async (e) => {
      e.preventDefault();
      if (d.known) return browse(d.path);
      if (confirm(`Suivre « ${d.name} » ?\nOK pour l'ajouter, Annuler pour entrer dedans.`)) {
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
  showView(h.get("v") === "terms" ? "terms" : "board");
}
function writeHash() {
  const h = new URLSearchParams();
  if (state.selected) h.set("p", state.selected);
  if (state.view === "terms") h.set("v", "terms");
  const next = h.toString() ? "#" + h : "#";
  if (location.hash !== next) history.replaceState(null, "", next);
}

$$(".tab").forEach((b) => (b.onclick = () => { showView(b.dataset.view); writeHash(); }));
$(".proj.all").onclick = () => { state.selected = ""; writeHash(); render(); };
addEventListener("hashchange", () => { readHash(); render(); });
$("#cols").value = localStorage.getItem("pyramis.cols") || "2";
$("#cols").onchange = setCols;
setCols();
$("#add-project").onclick = () => { $("#browser").showModal(); browse(); };

readHash();
refresh();
setInterval(refresh, 4000);
