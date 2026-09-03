---
name: preview-chart
description: Choose how a Pyra metric draws itself — a line, a histogram, or a bar toward a target — and fill the `chart` field accordingly. Use it whenever you propose or repair a metric for a project's `.pyra/preview.json`, which is what "Build preview" does.
---

# Picking the shape of a metric

Pyra prints every metric as a card: a label, the last reading in large type, and
one drawing under it. That drawing is not decoration — it is the whole reason a
number is on screen rather than in a log. `chart` says which of the three shapes
Pyra draws, and there are only three. There is no fourth, and no option to leave
it blank and hope.

Give the field a value for EVERY metric you propose. Three metrics that all
default to the same shape is the failure this exists to prevent: a card wall where
nothing is distinguishable, and where a rank climbing toward 1 and a download
counter climbing toward infinity are drawn identically.

## The three

| `chart` | What Pyra draws | What it is for |
|---|---|---|
| `line` | A filled sparkline over TIME | A quantity whose SHAPE is the news — is it climbing, has it plateaued, did it collapse |
| `bars` | A histogram, one bar per reading | A count you compare reading to reading; small integers; a number that jumps rather than drifts |
| `gauge` | A bar filling from the first reading toward `target` | A distance to close, when the repository names the finish line |

## How to choose — in this order

1. **Does the repository state a target, and is closing the distance the point?**
   Then `gauge`, and you MUST also fill `target`. A gauge without a target is a
   bar that never fills; Pyra falls back to `line` and your intent is lost.
   Good: "rank 24 → top 3", "0 hardcoded paths left", "ship by 1.0".
   Not this: a download counter with no ceiling — more is always better, there is
   no distance to close.

2. **Is the number a small count that MOVES IN STEPS?**
   Then `bars`. Tests passing, submissions accepted, open bugs, benchmarks won.
   Each reading is a discrete event you want to compare with the one before, and a
   smooth curve through integers pretends at a continuity that isn't there.
   Rule of thumb: if the number is under a few hundred and always a whole number,
   bars read better than a line.

3. **Otherwise `line`.**
   The default, and the honest one for anything continuous and unbounded: an Elo,
   a return, a latency, a total that only grows. It is what a curve is for.

## What each one needs from you

- `gauge` needs `target`. It also reads better when `better` is right: on a rank
  or a latency, `better: "down"` is what makes "closing in" mean going down.
- `bars` needs `decimals: 0` almost always. A histogram of `12.47` is a line
  chart wearing a costume.
- `line` needs nothing extra, but set `decimals` so the big number above it
  doesn't print six digits after the point.

## Two rules that outrank taste

- **One shape per question, not one shape per project.** If you propose three
  metrics, look at them together before you answer. Three `line`s is right only
  when all three are genuinely continuous curves. Three of anything is a smell
  worth one more second of thought.
- **Never pick a shape the data cannot fill.** A `gauge` on a metric whose target
  you invented draws a finish line in the wrong place, which is worse than no
  drawing at all. If you were about to invent a target so you could use a gauge,
  use `line` and omit `target`.

## What the reader sees, so you know what you are committing to

- A `line` with a single reading has no shape yet — Pyra says so in the card
  rather than faking a flat curve. That is fine on a first build.
- A `bars` card shows one bar per reading, most recent on the right, the last one
  in full colour. Under ten readings it reads like a tally; that is the point.
- A `gauge` prints `start … → target …` under the bar and the share of the way
  covered. On the first reading it is legitimately at 0 %.
