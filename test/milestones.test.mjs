// Les cas ici sont ceux qui ont réellement cassé pendant la construction, pas des
// cas imaginés : en-tête envoyé en bas du fichier, id venu du client illisible à la
// relecture, indentation du détail qui dérivait à droite à chaque enregistrement.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse, serialize, apply, graft, items, read, FILENAME, LEGACY_FILENAME } from "../milestones.mjs";

const round = (src) => serialize(parse(src));

test("un aller-retour ne déplace rien", () => {
  const src = "# Étapes\n\nUne note libre.\n\n- [ ] Premier @due:2026-09-09\n      détail sur\n      deux lignes\n- [x] Fait <!--id:abc123-->\n\nFin.\n";
  const once = round(src);
  assert.equal(once, round(once), "le deuxième passage doit être identique au premier");
  assert.match(once, /^# Étapes/, "l'en-tête reste en tête");
  assert.match(once, /\n {6}détail sur\n {6}deux lignes\n/, "l'indentation du détail ne dérive pas");
  assert.match(once, /Fin\.\n$/, "la prose de fin est conservée");
});

test("le premier étape d'un fichier neuf passe après le titre", () => {
  const blocks = apply(parse("# Étapes — X\n\n"), [{ id: "peu-importe", status: "todo", title: "Premier", detail: "", due: null }]);
  const out = serialize(blocks);
  assert.match(out, /^# Étapes — X\n[\s\S]*- \[ \] Premier/, "le titre doit précéder le étape");
});

test("un id fourni par le client est ignoré au profit d'un id relisible", () => {
  const blocks = apply(parse("# J\n"), [{ id: "n1", status: "todo", title: "T", detail: "", due: null }]);
  const relu = items(parse(serialize(blocks)));
  assert.equal(relu.length, 1);
  assert.equal(relu[0].title, "T", "le commentaire d'id ne doit pas rester collé au titre");
  assert.notEqual(relu[0].id, "n1");
  assert.equal(relu[0].id, items(blocks)[0].id, "l'id survit à l'aller-retour");
});

test("passer un étape à « fait » date la complétion, revenir en arrière l'efface", () => {
  let blocks = apply(parse("# J\n"), [{ id: "x", status: "todo", title: "T", detail: "", due: null }]);
  const id = items(blocks)[0].id;
  blocks = apply(blocks, [{ id, status: "done", title: "T", detail: "", due: null }]);
  assert.match(items(blocks)[0].done, /^\d{4}-\d{2}-\d{2}$/);
  blocks = apply(blocks, [{ id, status: "doing", title: "T", detail: "", due: null }]);
  assert.equal(items(blocks)[0].done, null);
});

test("un étape absent de la liste reçue est supprimé, la prose autour ne l'est pas", () => {
  const src = "# J\n\n- [ ] A <!--id:aaaaaa-->\n- [ ] B <!--id:bbbbbb-->\n\nNote de fin.\n";
  const out = serialize(apply(parse(src), [{ id: "bbbbbb", status: "todo", title: "B", detail: "", due: null }]));
  assert.doesNotMatch(out, /\] A/);
  assert.match(out, /\] B/);
  assert.match(out, /Note de fin\./);
});

/* ------------------------------------------------------- milestones et étapes */

test("une puce indentée devient une étape du milestone qui la précède", () => {
  const blocks = parse("# J\n\n- [~] Milestone\n      note\n  - [x] Étape\n  - [ ] Autre\n\n- [ ] Second milestone\n");
  const list = items(blocks);
  assert.deepEqual(list.map((i) => i.depth), [0, 1, 1, 0]);
  assert.equal(list[1].parentId, list[0].id);
  assert.equal(list[2].parentId, list[0].id);
  assert.equal(list[3].parentId, null, "un milestone n'a pas de parent");
  assert.equal(list[0].detail, "note", "la note du milestone n'est pas avalée par ses étapes");
});

test("une indentation de quatre espaces est comprise, puis normalisée à deux", () => {
  const out = serialize(parse("# J\n\n- [ ] Milestone\n    - [ ] Étape\n"));
  assert.match(out, /\n {2}- \[ \] Étape/);
  assert.equal(out, serialize(parse(out)), "et elle ne bouge plus ensuite");
});

test("une étape orpheline remonte au premier niveau plutôt que de disparaître", () => {
  const list = items(parse("# J\n\n  - [ ] Seule au monde\n"));
  assert.equal(list.length, 1);
  assert.equal(list[0].depth, 0);
});

test("une étape neuve se pose sous son milestone, pas à la fin du fichier", () => {
  const src = "# J\n\n- [ ] A <!--id:aaaaaa-->\n  - [ ] A1 <!--id:a1a1a1-->\n- [ ] B <!--id:bbbbbb-->\n\nNote de fin.\n";
  const keep = items(parse(src)).map(({ id, depth, parentId, status, title }) => ({ id, depth, parentId, status, title, detail: "", due: null }));
  const out = serialize(apply(parse(src), [...keep, { id: "neuve", depth: 1, parentId: "aaaaaa", status: "todo", title: "A2", detail: "", due: null }]));
  assert.match(out, /A1[^]*A2[^]*\] B/, "A2 s'intercale entre A1 et le milestone B");
  assert.match(out, /\n {2}- \[ \] A2/, "et elle est écrite comme une étape");
  assert.match(out, /Note de fin\./);
});

test("la greffe ajoute ce qui manque sans toucher à ce qui existe", () => {
  const src = "# J\n\n- [x] Écrire le README <!--id:aaaaaa-->\n      ma note\n  - [~] Le plan <!--id:a1a1a1-->\n";
  const { blocks, added } = graft(parse(src), [
    { title: "ecrire le readme", detail: "autre note", status: "todo", steps: [{ title: "LE PLAN" }, { title: "Relire" }] },
    { title: "Publier", steps: [{ title: "Choisir l'hébergeur", status: "doing" }] },
  ]);
  const list = items(blocks);
  assert.equal(added, 3, "l'étape « Relire », le milestone « Publier » et son étape");
  assert.equal(list[0].status, "done", "le statut d'un milestone existant n'est jamais touché");
  assert.equal(list[0].detail, "ma note", "ni sa note");
  assert.equal(list.filter((i) => i.title === "Relire")[0].parentId, "aaaaaa");
  assert.equal(list.length, 5, "rien n'a été retiré, le titre à la casse près n'a pas été dupliqué");
  assert.equal(list.at(-1).title, "Choisir l'hébergeur");
  assert.equal(list.at(-1).depth, 1);
});

test("une greffe sur un fichier vide écrit une carte complète", () => {
  const { blocks, added } = graft(parse("# Étapes — X\n\n"), [
    { title: "Un milestone", steps: [{ title: "Une étape" }] },
  ]);
  assert.equal(added, 2);
  assert.match(serialize(blocks), /^# Étapes — X\n[\s\S]*- \[ \] Un milestone[\s\S]*\n {2}- \[ \] Une étape/);
});

test("une greffe qui ne propose rien de neuf ne change pas le fichier", () => {
  const src = serialize(parse("# J\n\n- [ ] A\n  - [ ] A1\n"));
  const { blocks, added } = graft(parse(src), [{ title: "A", steps: [{ title: "A1" }] }]);
  assert.equal(added, 0);
  assert.equal(serialize(blocks), src);
});

test("l'ancien nom est relu, mais l'écriture repart vers le nouveau", () => {
  // Le serveur supprime le fichier à l'ancien nom après avoir écrit le nouveau. Ce
  // qui rend ce geste sûr, c'est que `read()` a rendu `file` sous le NOUVEAU nom
  // tout en ayant analysé l'ANCIEN. Si les deux constantes se croisaient un jour,
  // la suppression emporterait le fichier qu'on vient d'écrire.
  assert.notEqual(FILENAME, LEGACY_FILENAME);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pyramis-"));
  try {
    fs.writeFileSync(path.join(dir, LEGACY_FILENAME), "# Ancien\n\n- [x] Déjà fait\n");
    const r = read(dir, "X");
    assert.equal(r.exists, true);
    assert.equal(r.file, path.join(dir, FILENAME), "on écrira sous le nouveau nom");
    assert.equal(r.legacy, path.join(dir, LEGACY_FILENAME), "et l'ancien est signalé pour être retiré");
    assert.equal(items(r.blocks)[0].title, "Déjà fait", "rien n'est perdu au passage");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
