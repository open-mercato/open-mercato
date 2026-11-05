# Issue 8825 execution plan

Summary: Retry/Cancel browser scenarios from #7907 have no committed module-native regression.
Root cause: workflows/backend/instances/page.tsx relies on useConfirmDialog, but coverage for interpolation and row-target selection is unit-only. #7907 remains open; reuse its original authored commit as a prerequisite rather than recreate it.
Files to change: workflows/__integration__/TC-WF-073.spec.ts and this issue run folder. The prerequisite commit touches only workflows/page.tsx and its unit test.
Approach: API-create own failed and signal-paused definitions/instances; assert EN/PL titles, dismissal equality, keyboard mutation targets and narrow viewport bounds. Delete created execution data and definitions in finally.
Risks: Fixture cleanup and asynchronous execution stabilization; no contract changes.

- [x] Recheck concurrency and restore Docker/dependencies (Node 24).
- [x] Claim issue and identify prerequisite #7907.
- [ ] Browser verification BLOCKED: candidate authored and all four cases discovered, archived as run artifact until app builds.
- [ ] Full validation/review/QA/publication BLOCKED by out-of-scope warranty_claims duplicate imports; release issue claim with evidence.
