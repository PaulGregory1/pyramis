// Les cas testés ici sont ceux qui feraient perdre une MESURE — la seule chose que
// l'app garde chez l'utilisateur et qu'aucun `git log` ne saurait reconstituer. Une
// greffe qui écrase un historique, un relevé qui disparaît parce qu'une autre commande
// a échoué, un `1,234` lu comme un `1` : chacun de ces trois-là efface des soirs de
// travail sans rien dire. Le tour de modèle, lui, n'est pas testé : il appelle une
// binaire extérieure, et ce module ne teste que ce dont il répond.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readNumber, graft, collect, read, write, FILE } from "../preview.mjs";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "pyr-pv-"));

const metric = (over = {}) => ({
  key: "elo", label: "Elo", unit: "", target: null, better: "up",
  source: "", command: "echo 1", decimals: null, error: "", points: [], ...over,
});

/* ------------------------------------------------------------- lire un nombre */

test("le nombre est pris sur la DERNIÈRE ligne, jamais dans le bruit d'avant", () => {
  assert.equal(readNumber("building…\nrunning 40 games\n+59\n").v, 59);
  // Un log qui parle avant de conclure est le cas ORDINAIRE d'un script de mesure.
  // Prendre le premier nombre rendrait « 40 games » comme Elo, sans jamais échouer.
  assert.notEqual(readNumber("running 40 games\n+59\n").v, 40);
});

test("les décorations d'un affichage humain ne cassent pas la lecture", () => {
  assert.equal(readNumber("Elo: +59 ±24\n").v, 59);
  assert.equal(readNumber("12.4%\n").v, 12.4);
  assert.equal(readNumber("1,234,567\n").v, 1234567); // les milliers d'un `printf`
  assert.equal(readNumber("-3.5\n").v, -3.5);
  assert.equal(readNumber("1.2e3\n").v, 1200);
});

test("une commande muette ou bavarde sans chiffre est une erreur, pas un zéro", () => {
  // Un zéro silencieux serait le pire des cas : la courbe plongerait à plat et
  // raconterait un effondrement là où il n'y a qu'un script cassé.
  assert.equal(readNumber("").ok, false);
  assert.equal(readNumber("   \n\n").ok, false);
  assert.equal(readNumber("no results found\n").ok, false);
});

/* ------------------------------------------------------------------ la greffe */

test("une métrique qui a mesuré n'est jamais réécrite", () => {
  const spec = { goal: "Gagner", metrics: [metric({ points: [{ at: 1, v: 1800 }], command: "vieille" })] };
  const g = graft(spec, { goal: "Autre", metrics: [{ key: "elo", label: "Autre Elo", command: "neuve" }] });
  assert.equal(g.spec.metrics[0].command, "vieille");
  assert.equal(g.spec.metrics[0].points.length, 1);
  assert.equal(g.added + g.fixed, 0);
  // L'objectif non plus : la phrase a pu être corrigée à la main.
  assert.equal(g.spec.goal, "Gagner");
});

test("une métrique qui n'a rien mesuré se laisse remplacer — c'est la réparation", () => {
  const spec = { goal: "", metrics: [metric({ command: "commande cassée", error: "boom" })] };
  const g = graft(spec, { goal: "Gagner", metrics: [{ key: "elo", label: "Elo", command: "commande qui marche" }] });
  assert.equal(g.spec.metrics[0].command, "commande qui marche");
  assert.equal(g.spec.metrics[0].error, "");
  assert.equal(g.fixed, 1);
  assert.equal(g.spec.goal, "Gagner"); // vide, donc il se remplit
});

test("une clé inconnue s'ajoute, et le tableau reste borné", () => {
  const spec = { goal: "", metrics: [metric({ points: [{ at: 1, v: 1 }] })] };
  const g = graft(spec, { metrics: [{ key: "dl", label: "Downloads", command: "echo 2" }] });
  assert.deepEqual(g.spec.metrics.map((m) => m.key), ["elo", "dl"]);
  assert.equal(g.added, 1);

  const full = { goal: "", metrics: ["a", "b", "c", "d"].map((k) => metric({ key: k, points: [{ at: 1, v: 1 }] })) };
  const over = graft(full, { metrics: [{ key: "e", label: "E", command: "echo 1" }] });
  assert.equal(over.spec.metrics.length, 4);
  assert.equal(over.added, 0);
});

/* ---------------------------------------------------------------- les relevés */

test("une commande qui échoue ne coûte son point qu'à SA métrique", async () => {
  const dir = tmp();
  const spec = {
    goal: "",
    metrics: [
      metric({ key: "ok", command: "echo 42", points: [{ at: 1, v: 40 }] }),
      metric({ key: "ko", command: "exit 3", points: [{ at: 1, v: 7 }] }),
    ],
  };
  const r = await collect(dir, spec);
  assert.equal(r.read, 1);
  assert.deepEqual(r.spec.metrics[0].points.map((p) => p.v), [40, 42]);
  // L'historique de la métrique cassée est INTACT, et l'erreur est gardée à côté.
  assert.deepEqual(r.spec.metrics[1].points.map((p) => p.v), [7]);
  assert.match(r.spec.metrics[1].error, /./);
  // Une réparation efface l'erreur, elle ne la laisse pas traîner sous une courbe saine.
  const back = await collect(dir, { ...r.spec, metrics: [r.spec.metrics[0], { ...r.spec.metrics[1], command: "echo 9" }] });
  assert.equal(back.spec.metrics[1].error, "");
});

test("la commande tourne DANS le dossier du projet", async () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, "score.txt"), "1834\n");
  const r = await collect(dir, { goal: "", metrics: [metric({ command: "cat score.txt" })] });
  assert.equal(r.spec.metrics[0].points[0].v, 1834);
});

test("une métrique sans commande le dit, et ne perd rien", async () => {
  const dir = tmp();
  const r = await collect(dir, { goal: "", metrics: [metric({ command: "", points: [{ at: 1, v: 5 }] })] });
  assert.equal(r.read, 0);
  assert.equal(r.spec.metrics[0].points.length, 1);
  assert.match(r.spec.metrics[0].error, /no command/);
});

/* ------------------------------------------------------------- l'aller-retour */

test("écrire puis relire rend le même tableau, dans le dossier du dépôt", async () => {
  const dir = tmp();
  assert.equal(await read(dir), null); // pas de fichier : pas d'aperçu, pas d'erreur
  await write(dir, { goal: "Gagner", metrics: [metric({ points: [{ at: 2, v: 2 }, { at: 1, v: 1 }] })] });
  assert.ok(fs.existsSync(path.join(dir, FILE)));
  const back = await read(dir);
  assert.equal(back.goal, "Gagner");
  // Les points ressortent DANS L'ORDRE DU TEMPS quoi qu'il y ait dans le fichier :
  // il est éditable à la main, et une courbe qui revient en arrière est illisible.
  assert.deepEqual(back.metrics[0].points.map((p) => p.at), [1, 2]);
});

test("un fichier abîmé à la main se dit, il ne fait pas tomber la page", async () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, ".pyra"), { recursive: true });
  fs.writeFileSync(path.join(dir, FILE), "{ pas du json,,");
  const back = await read(dir);
  assert.deepEqual(back.metrics, []);
  assert.match(back.error, /unreadable/);
});

test("une métrique sans cible n'en gagne pas une au premier aller-retour", async () => {
  // `Number(null)` vaut 0. Écrire puis relire suffisait donc à donner une cible de 0 à
  // toute métrique qui n'en avait pas — jauge pleine, « 100 % of the way to 0 » sous
  // une courbe qui monte. Une erreur qu'aucun clic ne provoque : le disque suffit.
  const dir = tmp();
  await write(dir, { goal: "", metrics: [metric({ target: null, points: [{ at: 1, v: 5 }] })] });
  assert.equal((await read(dir)).metrics[0].target, null);
});

test("les relevés hors forme sont écartés, pas gardés en NaN", async () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, ".pyra"), { recursive: true });
  fs.writeFileSync(path.join(dir, FILE), JSON.stringify({
    goal: "x",
    metrics: [{ key: "elo", points: [{ at: 1, v: 10 }, { at: 2, v: "n/a" }, { v: 3 }, null] }],
  }));
  const back = await read(dir);
  assert.deepEqual(back.metrics[0].points, [{ at: 1, v: 10 }]);
});
