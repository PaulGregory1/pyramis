// Les cas ici sont ceux qui ont réellement cassé pendant la construction, pas des
// cas imaginés : en-tête envoyé en bas du fichier, id venu du client illisible à la
// relecture, indentation du détail qui dérivait à droite à chaque enregistrement.
import test from "node:test";
import assert from "node:assert/strict";
import { parse, serialize, apply, items } from "../etapes.mjs";

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
