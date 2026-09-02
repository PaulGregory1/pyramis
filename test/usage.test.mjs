// La consommation du forfait est un CONFORT : rien dans l'app n'en dépend, et une
// lecture qui échoue doit rendre « indisponible » plutôt que casser. Ce qui peut mal
// tourner n'est donc pas une panne visible, c'est un chiffre FAUX affiché avec
// aplomb — une barre à 4 % pendant qu'on est à 90, et l'utilisateur lance le
// terminal de trop. Les tests portent sur la traduction de la réponse du compte,
// et sur ce qu'on fait quand elle ne ressemble pas à ce qu'on attendait.
import test from "node:test";
import assert from "node:assert/strict";
import { parse } from "../usage.mjs";

// La forme réelle, relevée sur un compte Max : le compte nomme lui-même ses
// fenêtres dans `limits`, et les vieilles clés cohabitent avec.
const live = {
  subscription_type: "max",
  rate_limits_available: true,
  rate_limits: {
    five_hour: { utilization: 8, resets_at: "2026-09-02T08:40:00.100100+00:00" },
    seven_day: { utilization: 4, resets_at: "2026-09-03T15:00:00.100124+00:00" },
    seven_day_opus: null,
    limits: [
      { kind: "session", percent: 8, resets_at: "2026-09-02T08:40:00.100100+00:00", scope: null },
      { kind: "weekly_all", percent: 4, resets_at: "2026-09-03T15:00:00.100124+00:00", scope: null },
      { kind: "weekly_scoped", percent: 0, resets_at: null, scope: { model: { display_name: "Fable" } } },
    ],
  },
};

test("les deux fenêtres qui comptent sortent, dans l'ordre", () => {
  const u = parse(live);
  assert.equal(u.available, true);
  assert.equal(u.plan, "max");
  assert.deepEqual(u.windows.map((w) => [w.kind, w.percent]), [["session", 8], ["weekly", 4]]);
  assert.equal(u.windows[0].resetsAt, Date.parse("2026-09-02T08:40:00.100100+00:00"));
});

test("une limite propre à un modèle n'apparaît qu'une fois entamée", () => {
  // À zéro, elle n'apprend rien et pousse les deux autres vers le bas.
  assert.equal(parse(live).windows.length, 2);
  const hot = structuredClone(live);
  hot.rate_limits.limits[2].percent = 61;
  const w = parse(hot).windows;
  assert.equal(w.length, 3);
  assert.equal(w[2].scope, "Fable");
  assert.equal(w[2].percent, 61);
});

test("sans `limits`, on retombe sur les clés historiques", () => {
  // Le jour où le champ disparaît, l'écran ne doit pas se vider en silence.
  const old = structuredClone(live);
  delete old.rate_limits.limits;
  old.rate_limits.seven_day_opus = { utilization: 71, resets_at: null };
  const w = parse(old).windows;
  assert.deepEqual(w.map((x) => [x.scope, x.percent]), [["", 8], ["", 4], ["Opus", 71]]);
  assert.equal(w[2].resetsAt, null); // une date absente n'est pas NaN
});

test("un compte facturé à l'usage n'a pas de réserve à montrer", () => {
  // Une barre à zéro se lirait « tu n'as rien consommé » : c'est faux, la question
  // n'a simplement pas de sens pour une clé d'API.
  const u = parse({ subscription_type: "", rate_limits_available: false, rate_limits: null });
  assert.deepEqual(u, { available: false, reason: "metered", plan: "", windows: [] });
});

test("tout ce qui ne ressemble à rien rend `null` ou `available: false`", () => {
  for (const bad of [null, undefined, "", 42, []]) assert.equal(parse(bad), null, String(bad));
  // Un objet vide est une réponse, pas une absence de réponse : on le traduit.
  assert.equal(parse({}).available, false);
  // Une fenêtre sans pourcentage utilisable est ignorée, pas affichée à NaN.
  const junk = { rate_limits_available: true, rate_limits: { limits: [{ kind: "session", percent: "beaucoup" }, { kind: "inconnue", percent: 5 }] } };
  assert.deepEqual(parse(junk), { available: false, reason: "empty", plan: "", windows: [] });
});

test("les pourcentages sont bornés et entiers", () => {
  const wild = { rate_limits_available: true, rate_limits: { limits: [
    { kind: "session", percent: 130.4 }, { kind: "weekly_all", percent: -3 },
  ] } };
  assert.deepEqual(parse(wild).windows.map((w) => w.percent), [100, 0]);
});
