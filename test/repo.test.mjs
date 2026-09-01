// L'affectation des voies est la seule chose de ce module qui puisse être FAUSSE en
// silence : un dessin de graphe git faux reste un dessin. Les cas retenus sont ceux
// qui trompent les rendus naïfs — une branche qui repart d'un commit ancien, une
// fusion, et une histoire coupée par la fenêtre de chargement.
import test from "node:test";
import assert from "node:assert/strict";
import { lanes, readme, languages } from "../repo.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// `parents` dans l'ordre de git : le premier est celui dont on descend.
const c = (hash, ...parents) => ({ hash, parents });

test("une histoire linéaire tient sur une seule voie", () => {
  const { rows, width } = lanes([c("d", "c"), c("c", "b"), c("b", "a"), c("a")]);
  assert.equal(width, 1);
  assert.deepEqual(rows.map((r) => r.lane), [0, 0, 0, 0]);
  assert.deepEqual(rows[0].ins, []);        // la tête n'a pas d'enfant au-dessus
  assert.deepEqual(rows[0].outs, [0]);      // et continue tout droit
  assert.deepEqual(rows[3].outs, []);       // la racine n'a pas de parent
});

test("une fusion ouvre une seconde voie, et la branche s'y range", () => {
  //  m — la fusion
  //  | \
  //  f  b — la branche
  //  | /
  //  a
  const { rows, width } = lanes([c("m", "f", "b"), c("f", "a"), c("b", "a"), c("a")]);
  assert.equal(width, 2);
  assert.equal(rows[0].lane, 0);
  assert.deepEqual(rows[0].outs, [0, 1]);   // premier parent sur sa voie, second à côté
  assert.equal(rows[1].lane, 0);
  assert.equal(rows[2].lane, 1);
  // Le losange se ferme AU RANG DE LA BRANCHE : `b` voit que `a` est déjà attendu
  // voie 0, il y renvoie sa ligne et libère la voie 1. Sans ce rapprochement, deux
  // voies descendraient en parallèle jusqu'à `a` pour finir au même endroit.
  assert.deepEqual(rows[2].outs, [0]);
  assert.equal(rows[3].lane, 0);
  assert.deepEqual(rows[3].ins, [0]);
});

test("une voie qui ne concerne pas le rang le traverse", () => {
  const { rows } = lanes([c("m", "f", "b"), c("f", "a"), c("b", "a"), c("a")]);
  // Au rang de `f`, la voie 1 attend `b` : elle passe derrière sans s'arrêter.
  assert.deepEqual(rows[1].through, [1]);
  assert.deepEqual(rows[0].through, []);
});

test("un parent hors fenêtre n'ouvre pas de voie qui descend dans le vide", () => {
  // `a` est plus vieux que la fenêtre chargée : la ligne s'arrête au commit.
  const { rows, width } = lanes([c("b", "a")]);
  assert.equal(width, 1);
  assert.deepEqual(rows[0].outs, []);
});

test("une voie libérée est reprise plutôt qu'une nouvelle ouverte", () => {
  //  y  x — deux têtes indépendantes
  //  |  |
  //  a  b … x se termine avant que z n'arrive
  const { width } = lanes([c("y", "a"), c("x", "b"), c("b"), c("a"), c("z")]);
  // `z` arrive quand les voies 0 et 1 sont libres : il n'en ouvre pas une troisième.
  assert.equal(width, 2);
});

test("le README est rendu sans badges, titres ni blocs de code", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pyr-repo-"));
  fs.writeFileSync(path.join(dir, "README.md"),
    "# Titre\n\n[![badge](a.svg)](b)\n\n<!-- caché -->\n\nUne phrase qui explique le dépôt, assez longue pour compter.\n\n```js\ncode()\n```\n");
  const r = await readme(dir);
  assert.equal(r.title, "Titre");
  assert.match(r.text, /Une phrase qui explique/);
  assert.doesNotMatch(r.text, /badge|caché|code\(\)/);
});

test("les langages se comptent par extension, hors dossiers de construction", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pyr-lang-"));
  fs.writeFileSync(path.join(dir, "a.mjs"), "");
  fs.writeFileSync(path.join(dir, "b.js"), "");
  fs.writeFileSync(path.join(dir, "c.md"), "");
  fs.mkdirSync(path.join(dir, "node_modules"));
  fs.writeFileSync(path.join(dir, "node_modules", "d.js"), "");
  const l = await languages(dir);
  assert.equal(l.files, 3);
  assert.deepEqual(l.top[0], { name: "JavaScript", n: 2 });
});
