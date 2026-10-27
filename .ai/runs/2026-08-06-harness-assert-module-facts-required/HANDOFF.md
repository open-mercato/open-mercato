# Handoff — 2026-08-06-harness-assert-module-facts-required

**Last updated:** 2026-08-06T06:39:27Z
**Branch:** cez/9e32deb5
**PR:** not yet opened
**Current phase/step:** Phase 1 Step 1.1
**Last commit:** — (run folder is the first commit)

## What just happened
- Reproduced the #4603 baseline and extended it: measuring the shipped set rather than the issue's
  list finds **twelve** fact-sheets with no `context.required` reference, not eleven (`design_system`).
- Decided ten cases and two reasoned exemptions (`api_docs`, `design_system`); measured each new
  case's own context footprint on a real emitted controller and derived its budgets from it.

## Next concrete action
- Step 2.1: land the ten cases plus the six catalog pins as one commit.

## Blockers / open questions
- none

## Environment caveats
- Dev runtime runnable: not needed (no app surface in this change)
- Browser / UI checks: skipped — the change touches only catalog JSON, tests, and harness docs
- Database/migration state: clean — no schema change

## Worktree
- Path: /Users/wojciechszyjka/CascadeProjects/open-mercato/.ai/cezar/worktrees/9e32deb5-dbfe-427b-85d6-e8494ea4dd8c
- Created this run: no (reused the cezar-linked worktree)
