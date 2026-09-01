// Copyright © 2026 Paul Gregory. Tous droits réservés.
// Lecture/écriture de ETAPES.md. Le fichier vit DANS le dépôt du projet, pas dans
// une base de l'app : c'est ce qui rend Pyramis jetable. Si l'app disparaît, les
// étapes restent lisibles — et Claude, lancé dans le projet, les lit déjà.
//
// Grammaire d'une ligne d'étape :
//   - [ ] titre          à faire
//   - [~] titre          en cours
//   - [!] titre          bloqué
//   - [x] titre          fait
// Les lignes indentées qui suivent forment le détail. Le reste du fichier (titres,
// prose, séparateurs) est conservé tel quel : on ne réécrit QUE les lignes de jalon.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export const FILENAME = "ETAPES.md";
// Les tout premiers fichiers s'appelaient MILESTONES.md. On les relit encore, et le
// premier enregistrement les renomme : personne ne perd d'étapes au passage.
export const LEGACY_FILENAME = "MILESTONES.md";

const STATUS_BY_MARK = { " ": "todo", "~": "doing", "!": "blocked", "x": "done", "X": "done" };
const MARK_BY_STATUS = { todo: " ", doing: "~", blocked: "!", done: "x" };
export const STATUSES = Object.keys(MARK_BY_STATUS);

const ITEM_RE = /^(\s*)-\s\[([ ~!xX])\]\s?(.*)$/;
// L'id est planqué dans un commentaire HTML : invisible une fois le markdown rendu,
// mais il survit à une réécriture à la main du titre — sans ça, renommer un jalon
// dans l'éditeur le ferait passer pour un jalon neuf et perdrait son historique.
const ID_RE = /\s*<!--\s*id:([a-z0-9]{6,})\s*-->\s*$/i;
const DUE_RE = /(?:^|\s)@due:(\d{4}-\d{2}-\d{2})(?=\s|$)/;
const DONE_RE = /(?:^|\s)@done:(\d{4}-\d{2}-\d{2})(?=\s|$)/;

const newId = () => crypto.randomBytes(4).toString("hex");

// Découpe le fichier en blocs : du texte qu'on ne touche pas, et des jalons.
// Sérialiser = recoller les blocs dans l'ordre, en réécrivant les seuls jalons.
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
      indent,
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
  return blocks;
}

export function serialize(blocks) {
  const out = [];
  for (const b of blocks) {
    if (b.kind === "text") { out.push(...b.lines); continue; }
    const indent = b.indent ?? "";
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

const HEADER = (name) => `# Étapes — ${name}\n\n`;

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
// pas d'un ETAPES.md tronqué si le process meurt au mauvais moment.
export function write(file, blocks) {
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, serialize(blocks), "utf8");
  fs.renameSync(tmp, file);
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
  const fresh = incoming
    .filter((it) => !seen.has(it.id))
    .map((it) => mergeItem({ kind: "item", indent: "", id: newId() }, it));
  if (!fresh.length) return merged;

  // Après la dernière étape existante, pour ne pas passer sous les notes de fin de
  // fichier. S'il n'y en a aucun, c'est la fin du fichier qui est le bon endroit —
  // surtout pas le début, où se trouve le titre.
  let last = -1;
  for (let i = 0; i < merged.length; i++) if (merged[i].kind === "item") last = i;
  if (last === -1) merged.push(...fresh);
  else merged.splice(last + 1, 0, ...fresh);
  return merged;
}

function mergeItem(base, it) {
  const status = STATUSES.includes(it.status) ? it.status : base.status || "todo";
  return {
    ...base,
    kind: "item",
    id: base.id,
    status,
    title: (it.title ?? base.title ?? "").trim(),
    detail: (it.detail ?? base.detail ?? "").trim(),
    due: it.due || null,
    // La date de complétion est posée par l'app au moment du passage à « fait » :
    // c'est la seule façon d'avoir un historique sans demander une saisie de plus.
    done: status === "done" ? (it.done || base.done || today()) : null,
  };
}

export const today = () => new Date().toISOString().slice(0, 10);

export function stats(list) {
  const s = { total: list.length, todo: 0, doing: 0, blocked: 0, done: 0 };
  for (const it of list) s[it.status] = (s[it.status] || 0) + 1;
  return s;
}
