# Evals — Agent Guidelines

`evals/` is the Harbor-based evaluation framework that measures how well pinned agentic coding agents (Claude Code, Codex) complete real Open Mercato build tasks in a freshly scaffolded standalone app. It runs per OM release to track whether the OM developer harness is improving or deteriorating.

> Design spec: [`.ai/specs/2026-06-07-harbor-eval-framework.md`](../.ai/specs/2026-06-07-harbor-eval-framework.md)
> Pre-implementation analysis: [`.ai/specs/analysis/ANALYSIS-2026-06-07-harbor-eval-framework.md`](../.ai/specs/analysis/ANALYSIS-2026-06-07-harbor-eval-framework.md)

## Mental model

- **Independent variable = the OM release.** `npx create-mercato-app@X.Y.Z` pins every `@open-mercato/*` dep to `X.Y.Z`. The CLI version *is* the release under test.
- **Agents are pinned/controlled.** Claude Code → `claude-opus-4-8`; Codex → `gpt-5.5`. CLI versions + model IDs are recorded in every result record.
- A task is SWE-bench-shaped: **FAIL_TO_PASS** (hidden integration tests), **PASS_TO_PASS** (build/generate/scaffold tests), and a **convention rubric** (AST/fs checks + LLM judge). `passed = all F2P ∧ all P2P ∧ rubric_score ≥ 0.85`.

## Layout

```
evals/
├── AGENTS.md                 # this file
├── dataset.toml              # Harbor DATASET manifest — the registry of all tasks
├── lib/                      # shared, task-agnostic verifier harness (TS/ESM)
├── tasks/<task-id>/          # one Harbor task per directory
│   ├── instruction.md        # prompt shown to the agent (NEVER leak tests)
│   ├── task.toml             # Harbor config: [task] name (org/name) + agent/env pins
│   ├── environment/          # docker-compose.yaml (main + postgres + redis + meilisearch) + Dockerfile
│   ├── tests/                # test.sh + verify.mjs + rubric + hidden/ specs (never shown to agent)
│   ├── solution/solve.sh     # oracle reference implementation
│   └── README.md
└── results/                  # local mirror of records pushed to S3
```

## Dataset manifest (`evals/dataset.toml`)

All tasks are kept as a Harbor **dataset** — `evals/dataset.toml` (`open-mercato/harness-evals`) lists every task by `name` (org/name) and a content `digest`. This is the canonical registry: CI runs the dataset, and `harbor publish` ships it. Each task still needs a `[task]` section with `name = "open-mercato/<task-id>"` in its own `task.toml`.

```bash
# Add a new task directory to the dataset and pin its content digest
harbor add evals/tasks/<task-id> --to evals/dataset.toml
# Re-pin after editing a LOCAL task: re-run `harbor add` (updates the entry in
# place). `harbor sync` only refreshes registry tasks and skips local paths.
harbor add evals/tasks/<task-id> --to evals/dataset.toml
harbor sync evals/dataset.toml          # only updates registry tasks (-u for latest)

# Run the whole dataset (matrix across agents)
harbor run -p evals/dataset.toml -e daytona -a claude-code -m anthropic/claude-opus-4-8 --agent-kwarg version=<pin>
# …or a single task during development
harbor run -p evals/tasks/<task-id> -e docker -a oracle
```

After changing any file inside a local task, re-run `harbor add evals/tasks/<task-id> --to evals/dataset.toml` so the pinned digest matches (it updates the existing entry in place). `harbor sync` does **not** recompute local-path tasks — it only refreshes registry-sourced tasks (it reports local tasks as `skipped`). CI should verify the manifest is in sync.

## Always

- Confine an agent's allowed edits to the scaffolded app (`/app/eval-app/**`). Out-of-bounds edits (incl. `node_modules/@open-mercato/**`) auto-fail criterion `C-REUSE-1`.
- Keep hidden tests in `tests/` only — they are the verifier context and are never copied into the agent's prompt or workspace before grading.
- Pin agent CLI versions and model IDs in `task.toml`; record them in every result record.
- Emit a rich multi-dimensional `reward.json` (boolean `passed` + continuous component/per-criterion scores) so trends are legible.
- Base each task's `environment/docker-compose.yaml` on the scaffold's own services (postgres `pgvector`, redis, meilisearch); the agent container MUST be named `main`.
- Scaffold non-interactively: `--preset empty --no-init-git`, and `export YARN_ENABLE_IMMUTABLE_INSTALLS=0` before the first `yarn install`. Choose the agentic-harness mode deliberately — `--skip-agentic-setup` (no `.claude/`/`.ai/skills`, agent works from in-repo conventions only) vs `--agents claude-code,codex` (harness present). When a task exists in both modes, keep them identical except that flag so the pair isolates the harness's effect (see the `app-OME-FEAT-001` / `app-OME-FEAT-001-agentic` pair).
- Provision the tenant non-interactively with `mercato auth setup --orgName Acme --orgSlug acme --email superadmin@acme.com --password secret --skip-password-policy --json` so setup derives `admin@acme.com` (role `admin`, password `secret`) for the integration helper. Three traps: seeding `admin@acme.com` as the primary makes it a superadmin whose writes 400 with "Organization context is required"; `secret` fails the default password policy without `--skip-password-policy`; and the CLI wrapper exits 0 even on failure — check the output, not just the exit code.

## Ask First

- Before changing the rubric weights, the `passed` verdict rule, or the pinned agent/model set (these change the meaning of the trend line).
- Before adding result-store backends beyond S3, or changing the S3 key layout.

## Never

- Never leak FAIL_TO_PASS/PASS_TO_PASS specifics into `instruction.md`.
- Never modify `@open-mercato/*` packages or the monorepo to make a task pass — tasks consume the *published* packages as a black box.
- Never hard-pin to `@latest` in CI for the agents — that defeats the controlled-variable design.

## Running

```bash
# Oracle (proves the task is solvable + verifier is correct); use docker locally
harbor run -p evals/tasks/app-OME-FEAT-001 -e docker -a oracle

# Real agents on Daytona (CI)
harbor run -p evals/tasks/app-OME-FEAT-001 -e daytona -a claude-code -m anthropic/claude-opus-4-8 --agent-kwarg version=<pin> --agent-env ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY
harbor run -p evals/tasks/app-OME-FEAT-001 -e daytona -a codex       -m openai/gpt-5.5            --agent-kwarg version=<pin> --agent-env OPENAI_API_KEY=$OPENAI_API_KEY
```

## Adding a task

1. Copy an existing `tasks/<id>/` as a template (or `harbor task init "open-mercato/<id>" --no-pytest --no-package`).
2. Ensure `task.toml` has a `[task]` section with `name = "open-mercato/<id>"`.
3. Write `instruction.md` (done-state only, no test leakage).
4. Write `solution/solve.sh` (oracle) using the canonical OM conventions (reference: `packages/core/src/modules/customers`).
5. Write `tests/hidden/*.spec.ts` (Playwright over HTTP via `@open-mercato/core/helpers/integration/api`).
6. Encode the rubric in `tests/rubric.ts` (ts-morph AST/fs checks; LLM judge only for subjective criteria).
7. Register it in the dataset: `harbor add evals/tasks/<id> --to evals/dataset.toml` (re-run the same command to re-pin after later edits — `harbor sync` skips local-path tasks).
8. Prove `harbor run -a oracle` is green and each negative control fails its intended criterion before wiring real agents.
