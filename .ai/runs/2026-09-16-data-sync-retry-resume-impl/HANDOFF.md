# Handoff — 2026-09-16-data-sync-retry-resume-impl

**Last updated:** 2026-09-16T12:57:32Z
**Branch:** jtomaszewski/data-sync-retry-vs-resume (pushed to `fsh`)
**PR:** not yet opened — target is `fullstackhouse/open-mercato`, base `develop`
**Current phase/step:** Phase 1 Step 1.1
**Last commit:** 74e10a4a2e — docs(prototypes): redraw for the withdrawn D3 and the restated D4

## What just happened
- Planned the implementation run: fifteen Steps across three Phases, taken verbatim from the spec's
  § Implementation Plan.
- Closed `open-mercato/open-mercato#6154`; this work targets the fork until the user says otherwise.

## Next concrete action
- Step 1.1: add `packages/core/src/modules/data_sync/lib/resume-point.ts` with the `ResumePoint`
  discriminated union and `resolveResumePoint`, plus unit tests. No UI in this step.

## Blockers / open questions
- **One unknown, being researched:** whether this codebase has any client-side mechanism for checking a
  granted ACL feature. Step 1.6 depends on it. If none exists, that Step is re-scoped and reported
  rather than a new mechanism being invented silently.

## Environment caveats
- Dev runtime runnable: to be established before the UI pass.
- Browser / UI checks: due at the end of the run against the real app, not the prototype.
- Database/migration state: untouched, and must stay so — no schema change is in scope.

## Worktree
- Path: /Users/jacek/conductor/workspaces/open-mercato/richmond-v5
- Created this run: no — reused, nothing to clean up.
