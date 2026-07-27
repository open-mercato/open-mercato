# Handoff — 2026-07-27-workflows-ux-phase1

**Last updated:** 2026-07-27T08:30:00Z
**Branch:** feat/workflows-ux-phase1 (stacked on feat/workflows-ux-phase0, PR #4532)
**PR:** not yet opened
**Current phase/step:** Phase 1 Step 1.1
**Last commit:** — (run folder about to land)

## What just happened
- Run initialized: Phase 1 triage complete (10 flagged surprises incl. greenfield draft layer, INVOKE_AGENT absent, WAIT-config regression on default path), PLAN.md drafted (20 Steps across 9 Phases).

## Next concrete action
- Step 1.1: Activity Registry module with types, lookups, and import-boundary test.

## Blockers / open questions
- none

## Environment caveats
- Base is the UNMERGED feat/workflows-ux-phase0 (stacked PR — retarget to develop after #4532 merges).
- Scoped jest MUST run from packages/core; integration via yarn test:integration:ephemeral --filter (never with parallel heavy builds).
- Never run yarn db:migrate; draft-table migration ships as files + snapshot only.

## Worktree
- Path: .ai/tmp/om-auto-create-pr-loop/workflows-ux-phase1-20260727-072357
- Created this run: yes
