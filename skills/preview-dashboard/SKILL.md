---
name: preview-dashboard
description: Compose a project's Pyra dashboard so it reads like a product status page — which two to four numbers earn a card, how the goal sentence, the labels, the units and the sources are written, and how a shell command is written so it survives being run without ever being tested. Use it whenever you propose or repair the metrics of a `.pyra/preview.json`, which is what "Build preview" does.
---

# Composing the panel

What you write here is not a JSON file; it is a row of cards someone will look at
every morning, above their project's name, for months. It has to survive that. The
difference between a panel that gets read and one that gets ignored is almost never
the choice of numbers — it is whether the row LOOKS like it was composed, or like
four fields were filled in one after another.

The panel is small on purpose: a goal sentence, then two to four cards side by side.
Each card is a label in small capitals, one big number, one drawing, and two lines of
fine print. Nothing else fits. Everything below follows from that.

## The rule that makes it look professional

**Each card answers a DIFFERENT question, and the row answers the whole one.**

Before you write anything, say the questions out loud:

> Is it shipping? · Is anyone using it? · Is it getting better? · How far to done?

Four cards that all answer "is anyone using it" — downloads, stars, forks, watchers —
is a row that says one thing four times, and it is the single most common way this
panel goes wrong. Two cards that answer two questions beat four that answer one.

The reverse failure is a panel with no headline. Put the number that ANSWERS THE GOAL
first: it is the one read at a glance, and the others are context around it.

## What earns a card

A number that MOVES as the project progresses, and whose movement is the point.
An Elo, a total of downloads, a return, tests passing, days to a deadline, open bugs.

Not: lines of code, files, commits, contributors, milestones done. Pyra already prints
those a few centimetres lower, and none of them says whether the project is winning.
Not: a number that will read the same in three months — a constant is not a metric,
it is a fact, and facts belong in the README.

If the repository offers two honest numbers, propose two. **A row of two composed
cards is a better panel than four with two inventions in it**, and an invented metric
is not neutral: it takes a slot, draws a curve, and quietly teaches the reader that
this panel does not mean anything.

## Writing the fields so the card holds together

The card is 240 px wide. Every field below has a length at which it stops looking
designed and starts looking overflowed. These are not style preferences — they are
the widths that fit.

| Field | Length | What good looks like | What breaks the card |
|---|---|---|---|
| `label` | **1–3 words, ≤ 22 chars** | `Downloads`, `Engine Elo`, `Installers shipped` | `Total downloads across all GitHub releases` — it ellipsises mid-word |
| `goal` | **one sentence, ≤ 140 chars** | `Ship 1.7.0 as a real desktop app on macOS, Windows and Linux.` | a paragraph with a semicolon and a parenthesis |
| `source` | **one noun phrase, ≤ 80 chars** | `GitHub releases API, all assets summed` | a sentence that repeats the command in prose |
| `unit` | **≤ 4 chars, or empty** | `%`, `Elo`, `$`, `★` | `downloads` — the label already said it |
| `decimals` | what the number deserves | `0` for a count, `2` for a return | `4` on a download counter |

Three more that decide how the row reads:

- **`label` is a NOUN, never a sentence and never a status.** `Platforms shipped`, not
  `Are all platforms up to date`. The number answers; the label only names.
- **`unit` and `label` never say the same thing.** `Downloads` + unit `downloads`
  prints "45 downloads downloads" to anyone reading the card as a whole.
- **`target` only when the repository NAMES a finish line.** Inventing one draws the
  line in the wrong place and, worse, freezes a wrong gauge on screen for months. No
  stated target is a completely normal answer: omit the field.

Write `label`, `goal` and `source` in the language of the repository's own documents —
a French repo gets French labels. The field NAMES stay English; they are code.

## The command, which you will never get to test

You are writing a line of `sh` that Pyra runs, unmodified, in the project folder, every
time someone presses Update. You cannot run it first. That single constraint is what
the rest of this section is about.

**It must print the number on its LAST line, and nothing after it.** Pyra reads the
last non-empty line and takes the first number in it. `Elo: +59` is fine. A progress
message printed after the result is not.

**It must be a read.** No writes, no commits, no installs, no training runs, no test
suite that takes ten minutes. Under thirty seconds, every time, on a laptop.

**Prefer a file the project already writes** — `results.json`, a CSV of runs, a log
directory — over a number buried in prose. Prose gets rewritten; files get appended.

**Quoting is where these die.** The line is stored as JSON, on one line, and handed to
`sh -c`. The error you will never see, because you cannot run it, is
`syntax error: unexpected end of file` — an unbalanced quote.

- Wrap the whole thing in single quotes, use double quotes inside, and never nest the
  same kind. If the payload needs a literal single quote, restructure until it doesn't.
- Prefer `python3 -c` over `jq` for JSON — `jq` may not be installed; `python3` is.
  Pass the script in double quotes inside the surrounding single quotes, and keep it
  free of apostrophes.
- Read it back once, counting quotes and parentheses, before you answer. That reread is
  the only test this command will ever get.

**Never swallow a failure.** No `|| echo 0`, no `2>/dev/null` around the whole line.
A command that fails must fail: Pyra keeps the error beside the card, the history stays
intact, and the file is corrected by hand. A `0` invented by a fallback plots a collapse
that never happened, and nobody can tell it from the real thing afterwards.

**The network is allowed when the number lives there and nowhere else** — a downloads
API, a package registry. Say so in `source`, give `curl` a `-m` timeout, and never send
anything from the repository outwards.

**Two metrics never share a command.** If two numbers come from the same call, either
they are the same metric, or the second one should extract a different field — and it
still gets its own line, because a broken one must not take the other down with it.

If the project has a virtualenv, call `.venv/bin/python` explicitly. Use what a Mac has:
`sh`, `grep`, `sed`, `awk`, `tail`, `sort`, `python3`, `curl`, `git`.

## Before you answer

Read your own proposal as the row it will become, and check five things:

1. **Four different questions?** Say each card's question out loud. Two the same — cut one.
2. **Is the headline first?** The number that answers the goal leads the row.
3. **Do the labels fit?** Read them as small capitals, 22 characters, cut off if longer.
4. **Are the quotes balanced?** Count them. This is the failure that shows on screen as
   a red line under a dash where a number should be.
5. **Would this row be worth looking at every day for three months?** If two cards
   would go stale, propose the ones that won't and stop there.
