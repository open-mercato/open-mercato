# Handoff — 2026-04-18-ai-framework-unification

**Last updated:** 2026-04-18T08:45:00Z
**Branch:** `feat/ai-framework-unification`
**PR:** https://github.com/open-mercato/open-mercato/pull/1593 (held by `auto-create-pr` dogfood `in-progress` lock — release queued after Step 1.4 push)
**Current phase/step:** Phase 1 complete (Steps 1.1 / 1.2 / 1.3 / 1.4 landed). Phase 2 awaiting user scope.
**Last commit:** `6a1afab69` — `docs(skills): flatten run-folder verification layout to step-<X.Y>-checks.md + optional artifacts`

## What just happened
- Step 1.1 (`bacbc59ec`): skill harness rework — per-spec run folders, 1:1 step↔commit, sibling-skill migration, README refresh.
- Step 1.2 (`4a782bbd1`): NOTIFY.md / HANDOFF.md timestamps repaired from placeholders to real UTC times.
- Step 1.3 (`98ec6abb2`): `auto-create-pr` now claims the three-signal `in-progress` lock (assignee + label + claim comment), temporarily releases it before `auto-review-pr`, reclaims after, releases in the trap/finally. Dogfooded on PR #1593.
- Step 1.4 (`6a1afab69`): verification layout flattened. `proofs/<step-id>/` replaced by `step-<X.Y>-checks.md` (required per Step) + optional `step-<X.Y>-artifacts/` (only when real artifacts exist). Full gate uses `final-gate-checks.md` + optional `final-gate-artifacts/`. Review-fix follow-ups use `step-<X.Y-review-fix>-checks.md`. `.ai/runs/README.md`, `auto-create-pr`, `auto-continue-pr`, and `auto-sec-report` updated; `auto-qa-scenarios` inherits unchanged. Migrated three existing `proofs/<id>/notes.md` files to `step-<X.Y>-checks.md` in this run folder.

## Next concrete action
- Commit this Progress flip + HANDOFF/NOTIFY refresh (this commit).
- Push to `origin/feat/ai-framework-unification`.
- Release the `in-progress` lock on PR #1593.
- Wait for user direction on Phase 2 (`ai-framework` unification scope).

## Blockers / open questions
- Phase 2+ scope undefined. User has not yet provided direction; the Phase 2 placeholder in `PLAN.md` must be expanded before any code-changing work begins.

## Environment caveats
- Dev runtime runnable: unknown (not started — Phase 1 is docs-only, no Playwright checks needed).
- Playwright / browser checks: N/A for Phase 1. Required when Phase 2 Steps touch UI surfaces.
- Database/migration state: clean, untouched.

## Worktree
- Path: `/Users/piotrkarwatka/Projects/mercato-development` (user's primary worktree)
- Created this run: no — documented deviation in `NOTIFY.md`.
