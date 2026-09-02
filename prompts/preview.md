You are giving a project its scoreboard: the one thing it is trying to achieve, and
the two or three NUMBERS that say how close it is.

The project is called “{{name}}”. You are already working inside its folder:
{{path}}

Top level:

{{tree}}

## Read first, propose after

Read the README, `CLAUDE.md`, `STATUS.md`, `MILESTONES.md`, `PLAN.md`, the manifest
(`package.json`, `pyproject.toml`, `Cargo.toml`…) and whatever they point at. You are
looking for two things and nothing else:

1. **What winning looks like for this project.** A competition to place in, a rating
   to reach, a number of users, a deadline to ship by, a benchmark to beat.
2. **Where a number that measures it already lives on disk or on the network.** A
   results file, a benchmark log, a CSV of runs, a public API for downloads or stars.

## What a metric is here

A metric is a number that MOVES as the project progresses, and whose movement is the
point of the project. “Engine Elo against the previous build”, “total downloads”,
“terminal return of the strategy”, “tests passing out of the suite”, “accepted
submissions”.

It is NOT: lines of code, number of files, number of commits, number of milestones
done. Pyra already shows those, and none of them says whether the project is winning.
If the repository genuinely offers no such number, return fewer metrics — one honest
one beats three invented ones — or an empty list.

## The command

Each metric carries `command`: ONE line of `sh`, run from the project folder, whose
LAST line of output is the number. Pyra runs it — you do not. So it has to be right
by reading alone.

- It must be a READ. No writing, no `git commit`, no install, no training run, no
  test suite that takes ten minutes. It runs every time the user presses Update.
- Under thirty seconds. Parse a file that is already there rather than recompute it.
- Prefer a file the project already writes (`results.json`, a `stats.csv`, a log
  directory) over a number buried in prose — prose gets rewritten, files get appended.
- A public HTTP endpoint is fine when the number lives there and nowhere else
  (`curl -s https://api.npmjs.org/downloads/point/last-month/<pkg> | ...`). Say so in
  `source`. Never send anything from the repository to the network.
- Use tools a Mac has: `sh`, `grep`, `sed`, `awk`, `tail`, `sort`, `python3`, `curl`,
  `git`. `jq` may not be installed — prefer `python3 -c` for JSON.
- If the project has a virtualenv (`.venv/`), call `.venv/bin/python` explicitly.
- Quote it so it survives `sh -c`. It is stored as JSON, so keep it on one line.

`source` is one short sentence saying where the number comes from, for someone
reading the panel later: “last SPRT line of docs/EXPERIMENTS.md”, “npm registry API”.

## The rest of the fields

- `key`: a short slug, stable forever — it is what keeps the history attached
  (`elo`, `downloads`, `return`). Never reuse a key for a different meaning.
- `label`: what the panel prints above the number, under 30 characters, in the
  language of the project's own documents.
- `unit`: `%`, `Elo`, `$`, `★`, or empty. Not a sentence.
- `target`: the number that means "done", when the project states one. Omit it
  rather than invent it — an invented target draws a finish line in the wrong place.
- `better`: `up` if a bigger number is better, `down` if smaller is (latency, cost).
- `decimals`: how many decimals to print. `0` for counts, `2` for a return.

`goal` is ONE sentence: what this project is trying to achieve, and by when if the
repository says. It is printed above the numbers.

## What is already measured

{{existing}}

Do not repeat what is there and working: its history is already being kept, and your
version would replace nothing. Propose what is MISSING — and a metric marked BROKEN
above has never produced a reading, so a better command for its exact `key` will
replace it.

Answer with the requested JSON only.
