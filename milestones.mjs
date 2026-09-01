// Copyright © 2026 Paul Gregory. Tous droits réservés.
// Lecture/écriture de MILESTONES.md. Le fichier vit DANS le dépôt du projet, pas dans
// une base de l'app : c'est ce qui rend Pyramis jetable. Si l'app disparaît, les
// étapes restent lisibles — et Claude, lancé dans le projet, les lit déjà.
//
// Grammaire d'une ligne d'étape :
//   - [ ] titre          à faire
//   - [~] titre          en cours
//   - [!] titre          bloqué
//   - [x] titre          fait
// Les lignes indentées qui suivent forment le détail. Le reste du fichier (titres,
// prose, séparateurs) est conservé tel quel : on ne réécrit QUE les lignes de milestone.
//
// DEUX NIVEAUX, pas plus. Une puce à la marge est un MILESTONE — c'est ce que la vue
// d'ensemble montre. Une puce indentée sous elle est une ÉTAPE (`step` dans
// l'interface), visible seulement quand on ouvre le projet. C'est toute la
// hiérarchie, et le fichier la porte tel quel : deux espaces d'indentation,
// lisibles dans n'importe quel éditeur.
//
//   - [~] Milestone principal
//         Une phrase de contexte.
//     - [x] Petite étape
//     - [ ] Petite étape

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export const FILENAME = "MILESTONES.md";
// Le fichier s'est appelé ETAPES.md entre-temps. On le relit encore, et le premier
// enregistrement le renomme : personne ne perd d'étapes au passage. Attention si le
// nom change encore un jour — l'ancien nom est SUPPRIMÉ après réécriture, donc les
// deux constantes ne doivent jamais désigner le même fichier, ni s'échanger sans
// vérifier qu'aucun dépôt ne porte les deux à la fois.
export const LEGACY_FILENAME = "ETAPES.md";

const STATUS_BY_MARK = { " ": "todo", "~": "doing", "!": "blocked", "x": "done", "X": "done" };
const MARK_BY_STATUS = { todo: " ", doing: "~", blocked: "!", done: "x" };
export const STATUSES = Object.keys(MARK_BY_STATUS);

// L'indentation d'une étape à l'écriture. À la lecture on accepte n'importe quelle
// largeur : un fichier écrit à la main avec quatre espaces reste compris, il est
// simplement normalisé au premier enregistrement.
const STEP_INDENT = "  ";

const ITEM_RE = /^(\s*)-\s\[([ ~!xX])\]\s?(.*)$/;
// L'id est planqué dans un commentaire HTML : invisible une fois le markdown rendu,
// mais il survit à une réécriture à la main du titre — sans ça, renommer un milestone
// dans l'éditeur le ferait passer pour un milestone neuf et perdrait son historique.
const ID_RE = /\s*<!--\s*id:([a-z0-9]{6,})\s*-->\s*$/i;
const DUE_RE = /(?:^|\s)@due:(\d{4}-\d{2}-\d{2})(?=\s|$)/;
const DONE_RE = /(?:^|\s)@done:(\d{4}-\d{2}-\d{2})(?=\s|$)/;

const newId = () => crypto.randomBytes(4).toString("hex");

// Découpe le fichier en blocs : du texte qu'on ne touche pas, et des milestones.
// Sérialiser = recoller les blocs dans l'ordre, en réécrivant les seuls milestones.
export function parse(text) {
  const lines = text.split("\n");
  const blocks = [];
  let buffer = [];
  const flush = () => {
    if (buffer.length) blocks.push({ kind: "text", lines: buffer }), (buffer = []);
  };

  for (let i = 0; i < lines.length; i++) {
    const m = ITEM_RE.exec(lines[i]);
    if (!m) { buffer.push(lines[i]); continue; }
    flush();

    const [, indent, mark, rest] = m;
    let title = rest;
    let id = null;
    const idm = ID_RE.exec(title);
    if (idm) { id = idm[1]; title = title.slice(0, idm.index); }

    let due = null, done = null;
    const dm = DUE_RE.exec(title);
    if (dm) { due = dm[1]; title = title.replace(DUE_RE, ""); }
    const dnm = DONE_RE.exec(title);
    if (dnm) { done = dnm[1]; title = title.replace(DONE_RE, ""); }

    // Les lignes suivantes plus indentées que la puce sont le détail de l'étape.
    const detail = [];
    const floor = indent.length + 2;
    while (i + 1 < lines.length) {
      const next = lines[i + 1];
      if (next.trim() === "" && !(lines[i + 2] || "").startsWith(" ".repeat(floor))) break;
      if (next.trim() !== "" && !next.startsWith(" ".repeat(floor))) break;
      if (ITEM_RE.test(next)) break;
      detail.push(next);
      i++;
    }
    while (detail.length && detail[detail.length - 1].trim() === "") detail.pop();
    // On retire l'indentation COMMUNE, pas une largeur fixe : sinon un détail écrit
    // aligné sous le titre (6 espaces) ressortirait décalé un peu plus à chaque
    // enregistrement, et le fichier dériverait vers la droite tout seul.
    const common = detail.reduce(
      (min, l) => (l.trim() ? Math.min(min, l.length - l.trimStart().length) : min),
      Infinity
    );
    const strip = Number.isFinite(common) ? common : floor;

    blocks.push({
      kind: "item",
      // Toute indentation vaut « étape » : trois niveaux dans un fichier écrit à la
      // main s'aplatissent en deux. Mieux vaut ça qu'une profondeur que l'interface
      // ne saurait pas montrer.
      depth: indent.length ? 1 : 0,
      parentId: null,
      id: id || newId(),
      hadId: Boolean(id),
      status: STATUS_BY_MARK[mark],
      title: title.trim(),
      detail: detail.map((l) => l.slice(strip)).join("\n").trim(),
      due,
      done,
    });
  }
  flush();
  return link(blocks);
}

// Un milestone adopte les étapes indentées qui le suivent. Deux cas rattrapés ici, tous
// deux possibles dans un fichier écrit à la main : une puce indentée sans milestone
// au-dessus (elle remonte au premier niveau plutôt que de disparaître), et de la
// prose entre un milestone et ses étapes (un titre de section, par exemple — il coupe
// la filiation, sinon des étapes d'une autre section seraient rattachées à tort).
export function link(blocks) {
  let parent = null;
  for (const b of blocks) {
    if (b.kind === "text") {
      if (b.lines.some((l) => l.trim())) parent = null;
      continue;
    }
    if (b.depth && parent) { b.parentId = parent.id; continue; }
    b.depth = 0;
    b.parentId = null;
    parent = b;
  }
  return blocks;
}

export function serialize(blocks) {
  const out = [];
  for (const b of blocks) {
    if (b.kind === "text") { out.push(...b.lines); continue; }
    const indent = b.depth ? STEP_INDENT : "";
    let line = `${indent}- [${MARK_BY_STATUS[b.status] || " "}] ${b.title.trim()}`;
    if (b.due) line += ` @due:${b.due}`;
    if (b.status === "done" && b.done) line += ` @done:${b.done}`;
    line += ` <!--id:${b.id}-->`;
    out.push(line);
    if (b.detail && b.detail.trim()) {
      const pad = indent + "      ";
      out.push(...b.detail.replace(/\s+$/, "").split("\n").map((l) => (l.trim() ? pad + l : "")));
    }
  }
  let text = out.join("\n");
  if (!text.endsWith("\n")) text += "\n";
  return text;
}

const HEADER = (name) => `# Milestones — ${name}\n\n`;

export function read(projectPath, name = path.basename(projectPath)) {
  const file = path.join(projectPath, FILENAME);
  if (fs.existsSync(file)) return { file, exists: true, blocks: parse(fs.readFileSync(file, "utf8")) };
  const legacy = path.join(projectPath, LEGACY_FILENAME);
  if (fs.existsSync(legacy)) return { file, exists: true, legacy, blocks: parse(fs.readFileSync(legacy, "utf8")) };
  return { file, exists: false, blocks: parse(HEADER(name)) };
}

export function items(blocks) {
  return blocks.filter((b) => b.kind === "item");
}

// Écriture atomique : le fichier vit dans un dépôt git de l'utilisateur, on ne veut
// pas d'un MILESTONES.md tronqué si le process meurt au mauvais moment.
export function write(file, blocks) {
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, serialize(blocks), "utf8");
  fs.renameSync(tmp, file);
}

// Où poser un bloc neuf : à la fin des étapes de son milestone, ou après le dernier
// milestone du fichier s'il n'a pas de parent. Surtout pas au début, où se trouve le
// titre, ni tout à la fin, où vivent les notes de bas de fichier.
function insertionPoint(blocks, parentId) {
  if (parentId) {
    const at = blocks.findIndex((b) => b.kind === "item" && b.id === parentId);
    if (at !== -1) {
      let i = at + 1;
      while (i < blocks.length && blocks[i].kind === "item" && blocks[i].depth) i++;
      return i;
    }
  }
  let last = -1;
  for (let i = 0; i < blocks.length; i++) if (blocks[i].kind === "item") last = i;
  return last === -1 ? blocks.length : last + 1;
}

// Applique la liste envoyée par l'UI sur les blocs relus du disque. On repart
// toujours du disque : si le fichier a été édité à la main (ou par Claude) entre
// deux enregistrements, la prose et l'ordre des textes intercalaires survivent.
export function apply(blocks, incoming) {
  const byId = new Map(incoming.map((it) => [it.id, it]));
  const seen = new Set();
  const merged = [];

  for (const b of blocks) {
    if (b.kind !== "item") { merged.push(b); continue; }
    const it = byId.get(b.id);
    if (!it) continue; // supprimé côté UI
    seen.add(b.id);
    merged.push(mergeItem(b, it));
  }

  // L'id est TOUJOURS forgé ici, jamais repris du client : il finit dans un commentaire
  // HTML que la relecture doit savoir reparser (`<!--id:...-->`). Un id fantaisiste
  // rendrait la ligne illisible au tour suivant — le commentaire resterait collé au
  // titre et l'étape se dédoublerait.
  for (const it of incoming) {
    if (seen.has(it.id)) continue;
    const fresh = mergeItem({ kind: "item", id: newId() }, it);
    merged.splice(insertionPoint(merged, fresh.parentId), 0, fresh);
  }
  return link(merged);
}

function mergeItem(base, it) {
  const status = STATUSES.includes(it.status) ? it.status : base.status || "todo";
  const depth = it.depth === undefined ? base.depth || 0 : it.depth ? 1 : 0;
  return {
    ...base,
    kind: "item",
    id: base.id,
    depth,
    // Le lien est recalculé par `link()` d'après l'ordre final des blocs ; celui-ci
    // ne sert qu'à savoir OÙ poser une étape neuve.
    parentId: depth ? it.parentId || base.parentId || null : null,
    status,
    title: (it.title ?? base.title ?? "").trim(),
    detail: (it.detail ?? base.detail ?? "").trim(),
    due: it.due || null,
    // La date de complétion est posée par l'app au moment du passage à « fait » :
    // c'est la seule façon d'avoir un historique sans demander une saisie de plus.
    done: status === "done" ? (it.done || base.done || today()) : null,
  };
}

/* ------------------------------------------------------- greffe d'une proposition */

// Comparaison de titres tolérante : la casse, les accents et la ponctuation ne
// doivent pas faire passer « Écrire le README » pour un milestone neuf au tour suivant.
const norm = (s) =>
  String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const clean = (s, n) => String(s || "").replace(/\s+/g, " ").trim().slice(0, n);

// Greffe une proposition (celle du modèle) sur les blocs existants. La règle tient
// en une phrase : on N'ENLÈVE JAMAIS RIEN et on ne touche à aucun statut existant.
// Le tableau appartient à l'utilisateur — le modèle ne fait qu'y ajouter ce qui
// manque. Une régénération sur un projet déjà décrit ne coûte donc rien ; c'est ce
// qui permet d'appuyer sur le bouton sans se demander ce qu'on va perdre.
export function graft(blocks, proposal) {
  const out = [...blocks];
  let added = 0;

  for (const jal of (proposal || []).slice(0, 14)) {
    const title = clean(jal?.title, 200);
    if (!title) continue;

    let parent = out.find((b) => b.kind === "item" && !b.depth && norm(b.title) === norm(title));
    if (!parent) {
      parent = mergeItem({ kind: "item", id: newId() }, {
        depth: 0, status: jal.status, title, detail: clean(jal.detail, 600),
      });
      out.splice(insertionPoint(out, null), 0, parent);
      added++;
    } else if (!parent.detail && jal.detail) {
      // Un milestone écrit à la va-vite peut n'avoir aucune note : la proposition la
      // comble. Mais elle ne remplace jamais une note déjà écrite à la main.
      parent.detail = clean(jal.detail, 600);
    }

    for (const st of (jal.steps || []).slice(0, 14)) {
      const stTitle = clean(st?.title, 200);
      if (!stTitle) continue;
      const twin = out.some((b) => b.kind === "item" && b.depth && b.parentId === parent.id && norm(b.title) === norm(stTitle));
      if (twin) continue;
      const child = mergeItem({ kind: "item", id: newId() }, {
        depth: 1, parentId: parent.id, status: st.status, title: stTitle, detail: clean(st.detail, 600),
      });
      out.splice(insertionPoint(out, parent.id), 0, child);
      added++;
    }
  }

  return { blocks: link(out), added };
}

export const today = () => new Date().toISOString().slice(0, 10);

export function stats(list) {
  const s = { total: list.length, todo: 0, doing: 0, blocked: 0, done: 0 };
  for (const it of list) s[it.status] = (s[it.status] || 0) + 1;
  return s;
}
