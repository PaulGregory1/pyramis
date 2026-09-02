// La vue lisible d'un panneau lit le TAMPON de xterm, pas le flux : c'est du texte
// une fois posé, donc c'est testable sans navigateur. On rejoue ici une sortie de
// `claude` telle qu'elle apparaît dans un panneau — bannière, cadre de saisie et
// pied de page compris — et l'on vérifie que le découpage en tours de parole tient.
//
// Les deux fonctions sont extraites de `public/app.js` à la lecture : le fichier est
// un script de navigateur (il touche `document` dès le chargement), on ne peut donc
// pas l'importer. Découper la source est plus laid qu'un module, mais un module de
// plus pour une UI sans étape de build coûterait une balise et un ordre de chargement.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(root, "public", "app.js"), "utf8");
const from = src.indexOf("const D_BULLET");
const to = src.indexOf("const D_EMPTY");
assert.ok(from > 0 && to > from, "les repères du bloc de lecture ont bougé dans app.js");
const { unwrap, readBlocks } = new Function(src.slice(from, to) + "\nreturn { unwrap, readBlocks };")();

// Un tampon de xterm réduit à ce que la lecture lui demande. Les lignes sont déjà
// rognées à droite, comme le fait `translateToString(true)`.
function fakeTerm(text, cols = 100) {
  const lines = text.split("\n").map((l) => l.replace(/\s+$/, ""));
  return {
    cols,
    buffer: {
      active: {
        length: lines.length,
        getLine: (i) => (i < lines.length ? { translateToString: () => lines[i], isWrapped: false } : undefined),
      },
    },
  };
}

const SESSION = [
  "✻ Welcome to Claude Code",
  "",
  "> refais la grille",
  "",
  "⏺ Je vais regarder la grille avant d'y toucher. Elle est posée par gridShape,",
  "  qui cherche la découpe la plus proche d'un terminal.",
  "",
  "⏺ Read(public/app.js)",
  "  ⎿  Read 120 lines",
  "",
  "⏺ Bash(node --check public/app.js)",
  "  ⎿  (no output)",
  "",
  "⏺ Update Todos",
  "  ⎿  ☒ Lire la grille",
  "     ☐ La changer",
  "",
  "⏺ C'est fait.",
  "",
  "╭──────────────────────────────────────╮",
  "│ >                                    │",
  "╰──────────────────────────────────────╯",
  "  ⏵⏵ bypass permissions on",
].join("\n");

test("un tour de parole par bloc, dans l'ordre", () => {
  const blocks = readBlocks(fakeTerm(SESSION));
  assert.deepEqual(blocks.map((b) => b.kind), ["you", "say", "tool", "tool", "tool", "say"]);
  assert.equal(blocks[0].head, "refais la grille");
  assert.equal(blocks[5].head, "C'est fait.");
});

test("le cadre de saisie et le pied de page ne sont pas de la parole", () => {
  const blocks = readBlocks(fakeTerm(SESSION));
  const flat = JSON.stringify(blocks);
  assert.ok(!flat.includes("bypass permissions"), "le pied de page est entré dans un bloc");
  assert.ok(!flat.includes("╭"), "le cadre de l'invite est entré dans un bloc");
  assert.ok(!flat.includes("Welcome to Claude"), "la bannière est entrée dans un bloc");
});

test("un outil garde son nom, son argument et son retour", () => {
  const [, , read, bash] = readBlocks(fakeTerm(SESSION));
  assert.equal(read.name, "Read");
  assert.equal(read.args, "public/app.js");
  assert.ok(read.body.join("\n").includes("Read 120 lines"));
  assert.equal(bash.name, "Bash");
  assert.equal(bash.args, "node --check public/app.js");
});

// « Update Todos » n'a pas de parenthèses : sans le « ⎿ » qui suit, il passerait pour
// une phrase et son contenu s'étalerait dans la vue au lieu de s'y replier.
test("un outil sans parenthèses est reconnu à son retour", () => {
  const todos = readBlocks(fakeTerm(SESSION))[4];
  assert.equal(todos.kind, "tool");
  assert.equal(todos.head, "Update Todos");
  assert.ok(todos.body.join("\n").includes("☐ La changer"));
});

// Un panneau étroit coupe les phrases ; la vue lisible est large. Recoller n'a de sens
// que pour une ligne qui touchait le bord — jamais pour une puce ou un bloc de code.
test("les phrases coupées se recollent, les listes non", () => {
  const width = 40;
  const cut = ["Je regarde la grille avant d'y toucher,", "elle est posée par gridShape."];
  assert.equal(unwrap(cut, width), "Je regarde la grille avant d'y toucher, elle est posée par gridShape.");

  const list = ["Trois choses à faire :", "- lire la grille", "- la changer"];
  assert.equal(unwrap(list, width), list.join("\n"));

  const short = ["Fait.", "Autre chose ?"];
  assert.equal(unwrap(short, width), short.join("\n"));
});

test("un panneau qui n'a encore rien dit ne rend aucun bloc", () => {
  assert.deepEqual(readBlocks(fakeTerm("\n\n> \n")), []);
});
