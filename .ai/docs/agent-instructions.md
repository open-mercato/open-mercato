# Writing agent instructions (AGENTS.md files)

## The instruction budget

Coding agents load `AGENTS.md` from the repository root down to the working directory and stop
once the **combined** size reaches their project-instruction budget. Codex's default
`project_doc_max_bytes` is **32,768 bytes** (a byte budget, not a character or token budget) —
everything past that offset is silently dropped from the first-turn prompt, and the agent gets
no warning that it happened (upstream: https://github.com/openai/codex/issues/13386).

Two consequences:

1. The root `AGENTS.md` must stay under 32 KiB on its own, or its tail never reaches any agent.
2. The root file also spends the budget that nested files need. The more the root takes, the
   less of `packages/<pkg>/AGENTS.md` survives when an agent is started inside that package.

`yarn agents:check-budget` enforces both, and runs in the CI quality job:

- **Root hard limit** — `AGENTS.md` must stay under `rootMaxBytes` in
  `scripts/agents-md-budget.baseline.json` (31,232 bytes: the 32 KiB budget minus a 1.5 KiB reserve
  so nested files still get some of it).
- **Chain ratchet** — the representative root-to-module chains listed in that baseline are
  measured root-first. A chain still inside the budget may grow freely; once a chain exceeds the
  budget, its **nested** (non-root) files may only shrink. The root is excluded from the ratchet
  because its own hard limit already governs it, so an ordinary root edit never trips the four
  chains. Several package files are far over today (`packages/ai-assistant/AGENTS.md` alone is
  ~103 KiB), so the ratchet freezes that debt instead of hiding it, and the report prints exactly
  how many bytes each chain loses.

When a chain legitimately changes, shrink the file or re-record the baseline deliberately with
`yarn agents:check-budget --update-baseline` and explain it in the PR.

**Rule of thumb when editing any `AGENTS.md`:** hard rules, boundaries and routing stay in the
file; long-form procedure, tables of options and worked examples move into a referenced document
(`.ai/docs/*`, `apps/docs/**`, a spec) that the agent reads on demand.

## Where to run validation commands

Decide once per gate sequence, then record the chosen runner in your output (e.g.
`Runner: docker (starters/docker/compose.fullapp.dev.yml)` or `Runner: local`):

- If `DOCKER_COMPOSE_FILE` is set, use Docker mode with that file.
- Otherwise probe, in order, `starters/docker/compose.*dev*.local.yml` (sorted), legacy root
  `docker-compose.*dev*.local.yml` (sorted), `starters/docker/compose.fullapp.dev.yml`,
  `starters/docker/compose.fullapp.yml` with
  `docker compose --project-directory . -f <file> ps --status running -q app`; the first file
  with a running `app` container wins → Docker mode.
- None running → local mode (`yarn …` on the host).

In Docker mode replace each `yarn X` with `node scripts/docker-exec.mjs X`. Always pass
`--project-directory .` (repo root) with any `-f starters/docker/...` compose command — it
anchors `.env` interpolation and relative paths at the repo root.

## Boundary labels

Use `Always`, `Ask First`, `Never`, and `Validation Commands` headings when adding or
reorganizing agent rules:

- `Always` — required defaults and commands agents should apply without asking.
- `Ask First` — decisions that need maintainer input before changing behavior, scope,
  dependencies, branch/deploy flow, or contract surfaces.
- `Never` — prohibited actions and unsafe shortcuts.
- `Validation Commands` — short, real commands agents can run to prove the relevant path.

## Lesson knowledge structure

`.ai/lessons.md` is a retrieval index, not a session-start document. Route the task first, scan its
catalog rows by exact module plus every matched standalone-harness area and important topic, then
open only the linked `.ai/lessons/*.md` records that apply. Never bulk-read the lesson directory.

After a correction produces reusable knowledge, update one existing focused record or add one
kebab-case record with JSON-valued `title`, `modules`, `areas`, and `topics` front matter. Areas use
the exact standalone router vocabulary; module tags use snake_case; topic tags use kebab-case. Add
the matching index row, keep cited titles stable, and run `yarn lessons:check`. Hard safety and
workflow boundaries still belong in the closest `AGENTS.md`; a lesson carries the evidence,
recurring failure mode, durable rule, and affected surfaces.
