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

`yarn agents:check-budget` enforces both: a hard limit on the root file, and a ratchet on the
root-to-module chains recorded in `scripts/agents-md-budget.baseline.json` so an oversized chain
cannot get worse unnoticed. It runs in the CI quality job. When a chain legitimately grows, shrink
the file or re-record the baseline deliberately with `yarn agents:check-budget --update-baseline`
and explain it in the PR.

**Rule of thumb when editing any `AGENTS.md`:** hard rules, boundaries and routing stay in the
file; long-form procedure, tables of options and worked examples move into a referenced document
(`.ai/docs/*`, `apps/docs/**`, a spec) that the agent reads on demand.

## Where to run validation commands

Decide once per gate sequence, then record the chosen runner in your output (e.g.
`Runner: docker (docker-compose.fullapp.dev.yml)` or `Runner: local`):

- If `DOCKER_COMPOSE_FILE` is set, use Docker mode with that file.
- Otherwise probe, in order, `docker-compose.*dev*.local.yml` (sorted),
  `docker-compose.fullapp.dev.yml`, `docker-compose.fullapp.yml` with
  `docker compose -f <file> ps --status running -q app`; the first file with a running `app`
  container wins → Docker mode.
- None running → local mode (`yarn …` on the host).

In Docker mode replace each `yarn X` with `node scripts/docker-exec.mjs X`.

## Boundary labels

Use `Always`, `Ask First`, `Never`, and `Validation Commands` headings when adding or
reorganizing agent rules:

- `Always` — required defaults and commands agents should apply without asking.
- `Ask First` — decisions that need maintainer input before changing behavior, scope,
  dependencies, branch/deploy flow, or contract surfaces.
- `Never` — prohibited actions and unsafe shortcuts.
- `Validation Commands` — short, real commands agents can run to prove the relevant path.
