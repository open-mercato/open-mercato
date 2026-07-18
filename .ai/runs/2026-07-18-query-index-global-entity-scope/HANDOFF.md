# Handoff — query-index-global-entity-scope

## Current state

- Branch: `fix/query-index-global-entity-scope` from `origin/develop`.
- Resume at: Step 0.1 — land the copied source spec, readiness report, and loop plan.
- Unrelated working-tree file preserved: `.ai/reports/ds-health-2026-07-02.txt`.

## Decisions already made

- The supplied core-spec invocation is treated as explicit authorization for the specified core fix.
- The global projection delete assertion will follow existing `markDeleted()` semantics: the projection is physically removed, not soft-deleted.
- No UI is touched, so the design-system pass is not applicable.
