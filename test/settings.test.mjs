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
import { init, read, write, normalize, provider, cliCommand, permissionMode, PROVIDERS, PERMISSION_MODES, DEFAULTS } from "../settings.mjs";

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

/* --------------------------------------------- le mode de permission */

test("les panneaux s'ouvrent en bypass, et c'est un choix", () => {
  // Pyra existe pour tenir N sessions en parallèle. N murs de questions à valider une
  // par une est exactement ce qu'on fuyait — le défaut le dit. Si ce test tombe, c'est
  // une décision de produit qui a changé, pas un détail.
  assert.equal(DEFAULTS.permissionMode, "bypassPermissions");
});

test("le bypass passe par son propre drapeau, jamais par --permission-mode", () => {
  // Le CLI REFUSE `--permission-mode bypassPermissions` au lancement (« Cannot set
  // permission mode to bypassPermissions because the session was not launched with
  // --dangerously-skip-permissions »). Les deux formes ne sont pas interchangeables,
  // et le jour où quelqu'un « simplifiera » la table, aucun panneau ne démarrerait.
  assert.deepEqual(permissionMode("bypassPermissions").args, ["--dangerously-skip-permissions"]);
  assert.ok(!cliCommand([], { provider: "claude", permissionMode: "bypassPermissions" }).includes("--permission-mode"));
});

test("le mode manuel ne passe RIEN — ne rien dire est déjà le défaut du CLI", () => {
  // En ligne de commande le CLI l'appelle « manual » et non « default » : lui passer
  // le nom interne serait refusé. On ne passe donc aucun drapeau.
  assert.deepEqual(permissionMode("default").args, []);
  assert.equal(cliCommand([], { provider: "claude", permissionMode: "default" }), "claude");
});

test("un mode inconnu retombe sur le défaut plutôt que d'être écrit tel quel", () => {
  // Même raison que pour `visibility` : la valeur est relue au démarrage suivant, et
  // un mode inventé ferait échouer CHAQUE ouverture de panneau, longtemps après.
  assert.equal(normalize({ permissionMode: "yolo" }).permissionMode, DEFAULTS.permissionMode);
  assert.equal(permissionMode("yolo").id, PERMISSION_MODES[0].id);
});

test("la commande met les drapeaux du mode AVANT ce qu'on lui ajoute", () => {
  // `claude --dangerously-skip-permissions --resume <id> --fork-session` : la reprise
  // d'une session est un `claude` de plus, et elle obéit au même réglage. Un seul
  // endroit compose cette ligne, sinon un panneau sur deux demanderait la permission.
  const cmd = cliCommand(["--resume", "abc", "--fork-session"], { provider: "claude", permissionMode: "acceptEdits" });
  assert.equal(cmd, "claude --permission-mode acceptEdits --resume abc --fork-session");
});

test("chaque mode dit son nom court, son nom long et ce qu'il passe au CLI", () => {
  // `short` va dans l'en-tête d'un panneau, `label` dans les réglages : sans les deux,
  // « BYPASS PERMISSIONS » en capitales prendrait la place du nom du projet.
  for (const m of PERMISSION_MODES) {
    assert.ok(m.id && m.short && m.label && m.desc, m.id);
    assert.ok(Array.isArray(m.args), m.id);
  }
  // Un seul mode dépense : celui dont un classifieur répond aux questions.
  assert.deepEqual(PERMISSION_MODES.filter((m) => m.cost).map((m) => m.id), ["auto"]);
});
