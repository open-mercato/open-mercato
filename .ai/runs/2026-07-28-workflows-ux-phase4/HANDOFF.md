# HANDOFF — workflows-ux-phase4

## Current state

Plan drafted; execution starting at step 0.1. Branch `feat/workflows-ux-phase4` off `feat/agent-orchestrator-mvp` @ `1f4ec94a6` (all of Phases 0–3b plus the task tenant-scoping security fix #4573).

## How to resume

1. `PLAN.md` — first row not `done` is the resume point.
2. `BRIEFING-phase4.md` — §A lists the nine pre-existing defects with anchors; §0 is the permission change (NOT in this run's scope); §§1–8 are per-topic implementation briefs.
3. Six items need a maintainer decision before they can start — see PLAN.md Non-goals. Do not start any of them on your own judgment.

## Environment notes

- Fresh worktree needs `yarn install` → `yarn build:packages` → `yarn generate` before `yarn typecheck` (generate needs the CLI built; typecheck needs `#generated/*`).
- Jest flag is `--testPathPatterns` (plural). Use `--maxWorkers=4` — the default causes jsdom contention timeouts.
- `.ai/tmp/**` is excluded from Playwright discovery.
- Never run `yarn db:migrate`; ship the migration file + snapshot instead.
