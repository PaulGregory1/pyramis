// Les réglages décident de deux choses : à qui l'app parle, et ce qu'elle déclenche
// toute seule. Ce qui peut mal tourner ici n'est pas une erreur visible — c'est un
// fichier édité à la main qui empêche l'app de démarrer, ou une valeur venue du
// client qui reste en base et fait échouer `gh` une fois par projet créé, longtemps
// après la faute. Les tests portent donc sur la tolérance et sur le nettoyage.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { init, read, write, normalize, provider, PROVIDERS, DEFAULTS } from "../settings.mjs";

const file = async () => path.join(await fsp.mkdtemp(path.join(os.tmpdir(), "pyra-set-")), "settings.json");

test("sans fichier, on repart des défauts", async () => {
  const s = init(await file());
  assert.deepEqual(s, DEFAULTS);
});

test("un JSON cassé ne doit pas empêcher l'app de démarrer", async () => {
  const f = await file();
  await fsp.writeFile(f, "{ ceci n'est pas du json", "utf8");
  const s = init(f);
  assert.deepEqual(s, DEFAULTS);
  // Et le fichier n'est PAS effacé : l'utilisateur a peut-être voulu l'éditer et
  // s'est trompé d'une virgule. On ne supprime pas un fichier pour le punir.
  assert.ok(fs.existsSync(f));
});

test("un fichier écrit par une version plus ancienne se complète, il n'est pas refusé", async () => {
  const f = await file();
  await fsp.writeFile(f, JSON.stringify({ provider: "claude", create: { git: false } }), "utf8");
  const s = init(f);
  assert.equal(s.create.git, false);          // le choix de l'utilisateur survit
  assert.equal(s.create.graph, DEFAULTS.create.graph); // le reste vient des défauts
  assert.equal(s.github.visibility, "private");
});

test("une valeur inconnue retombe sur le défaut plutôt que d'être gardée", () => {
  const s = normalize({
    provider: "gpt-le-magnifique",
    model: 42,
    create: { git: "oui", graph: false },
    github: { visibility: "sekret", defaultBranch: "une branche; rm -rf /" },
  });
  assert.equal(s.provider, "claude");
  assert.equal(s.model, "");
  assert.equal(s.create.git, DEFAULTS.create.git); // « oui » n'est pas un booléen
  assert.equal(s.create.graph, false);             // celui-là est valide, il passe
  assert.equal(s.github.visibility, "private");
  assert.equal(s.github.defaultBranch, "main");    // les espaces et le `;` sont refusés
});

test("le seul automatisme décoché par défaut est celui qui dépense", () => {
  // La règle du projet : ce que l'app déclenche d'elle-même est gratuit. Si ce test
  // tombe un jour, c'est qu'on a coché une dépense à la place de quelqu'un.
  const off = Object.entries(DEFAULTS.create).filter(([, v]) => !v).map(([k]) => k);
  assert.deepEqual(off, ["generate"]);
});

test("un dépôt créé par l'app naît fermé", () => {
  assert.equal(DEFAULTS.github.visibility, "private");
});

test("le provider est une table, et un id inconnu retombe sur le premier", () => {
  assert.ok(PROVIDERS.length >= 1);
  assert.equal(provider("claude").id, "claude");
  assert.equal(provider("inexistant").id, PROVIDERS[0].id);
  // Chaque provider doit dire quel binaire lancer : sans ça, l'app ne saurait pas
  // à qui parler, et le deuxième provider demanderait de rouvrir trois fichiers.
  for (const p of PROVIDERS) {
    assert.ok(p.id && p.name && p.cli && Array.isArray(p.versionArgs));
  }
});

test("l'écriture est atomique et relisible", async () => {
  const f = await file();
  init(f);
  write({ create: { generate: true }, github: { visibility: "public" } });
  // On relit depuis le disque, pas depuis le cache : c'est ce que fera le prochain
  // démarrage.
  const again = init(f);
  assert.equal(again.create.generate, true);
  assert.equal(again.github.visibility, "public");
  assert.equal(again.create.git, DEFAULTS.create.git);
  // Le fichier temporaire ne doit pas rester derrière.
  assert.ok(!fs.existsSync(f + ".tmp"));
});

test("un patch ne touche qu'à ce qu'il nomme", async () => {
  init(await file());
  write({ create: { graph: false } });
  const s = read();
  assert.equal(s.create.graph, false);
  assert.equal(s.create.milestones, true);
  assert.equal(s.provider, "claude");
});
