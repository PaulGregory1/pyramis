You are drawing the map of a personal project: a few main MILESTONES, and under
each of them the small steps that lead there.

The project is called “{{name}}”. You are already working inside its folder:
{{path}}

## Read first, write after

Look at the README, `CLAUDE.md`, `KNOWLEDGE-GRAPH.md`, the manifest files
(`package.json`, `pyproject.toml`, `Cargo.toml`…) and the top-level tree. Do not
walk the whole codebase: what we are after is where the project is heading, not an
inventory of what it contains.

The latest commits, which say where it comes from:

{{git}}

## What a milestone is

A milestone is a RESULT you can announce: “the site is live”, “the solver beats the
baseline”, “the application is sent”. Not a task, not a vague workstream. There has
to be a clear moment when it becomes true.

A step, on the other hand, is a concrete move: something a single working session
can finish, and about which you can say at the end whether it is done.

## What we expect from you

- Between 3 and 6 milestones, in the order they will fall, not grouped by theme.
- Between 2 and 5 steps under each one. No orphan step.
- Write the titles IN THE LANGUAGE OF THE PROJECT'S OWN DOCUMENTS — if its README
  and commits are in French, write French. The file you are feeding already holds
  lines written by hand, and a map that switches language mid-way is unreadable.
- One title per line, under 90 characters, no trailing period, no project-management
  jargon.
- Leave `detail` empty unless it truly carries something: how we will know it is
  done, or the trap not to walk into. One sentence.
- `status` is `done` ONLY if the repository proves it already is (the code is there,
  the commit landed). When in doubt, `todo`.

## What is already written down

{{existing}}

Do not repeat it: what is there is there, and your text will replace nothing.
Propose only what is missing — the rest of the road, or the steps of a milestone
that has none yet. If nothing is missing, return an empty list.

Answer with the requested JSON only.
