# Handoff — 2026-07-27-workflows-ux-phase1

**Last updated:** 2026-07-27T10:40:00Z
**Branch:** feat/workflows-ux-phase1 (stacked on feat/workflows-ux-phase0, PR #4532)
**PR:** not yet opened
**Current phase/step:** Phase 2 Step 2.1
**Last commit:** a669adaad — refactor(workflows): registry-driven async dispatch with enqueue-time capability checks

## What just happened
- Checkpoint 1 passed (737 workflows tests; executor suite unedited). Registry core complete: sync+async dispatch registry-driven, CALL_API async refused at enqueue.

## Next concrete action
- Step 2.1: registry-driven activityTypeSchema + per-type config validation (warning severity).

## Blockers / open questions
- none

## Environment caveats
- Base is the UNMERGED feat/workflows-ux-phase0 (stacked PR — retarget to develop after #4532 merges).
- Scoped jest MUST run from packages/core; integration via yarn test:integration:ephemeral --filter (never with parallel heavy builds).
- Never run yarn db:migrate; draft-table migration ships as files + snapshot only.

## Worktree
- Path: .ai/tmp/om-auto-create-pr-loop/workflows-ux-phase1-20260727-072357
- Created this run: yes
