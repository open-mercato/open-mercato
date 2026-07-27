# HANDOFF — workflows-ux-phase2b-3

> Rewritten at every checkpoint and at run end.

## Current state

Run setup in progress. Worktree created off `feat/agent-orchestrator-mvp` @ `e3a2d92de` (which contains merged Phases 0/1/2a — PRs #4532/#4551/#4559). Branch `feat/workflows-ux-phase2b-3`. Research briefings being produced; `PLAN.md` Tasks table is the authoritative status source once written.

## How to resume

1. Read `PLAN.md` — the first `todo` row in the Tasks table is the resume point.
2. Read the latest `checkpoint-*-checks.md` for verification state.
3. Briefings: `BRIEFING-phase2b.md`, `BRIEFING-phase3.md` (research condensations; code anchors may drift — verify before relying on line numbers).

## Environment notes

- `yarn generate` in this repo without enterprise env flags prunes `apps/mercato/src/modules/file-agents.generated.ts` + docker/opencode mirrors — restore them before committing, never commit the pruned state.
- `yarn typecheck` requires `yarn generate` first (`#generated/*` imports).
- Never run heavy builds in parallel with the ephemeral integration suite.
- Bare `.sort()` is forbidden (`explicit-sort-comparators.test.ts`, #3620) — always pass a comparator.
