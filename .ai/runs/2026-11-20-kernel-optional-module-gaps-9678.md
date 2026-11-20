# Execution plan — kernel optional-module gaps (pave way for #9678)

Source doc: .ai/specs/ (see #9678 modularization plan PR) — kernel must boot and work with every business module off.

## Goal

Fix, in one PR for easier testing, every "kernel breaks when an optional module is disabled" bug from the #9678 Phase 0 prerequisite list that is fixable as a focused change, and file an umbrella issue tracking the status of all listed items.

## Scope

| Issue | Area | Approach |
|-------|------|----------|
| #9194 | data_sync | merge open PR #10114 (author wojski999) |
| #9197 | entities | merge open PR #9326 |
| #8803 | translations/dictionaries/entities | merge open PR #9569 |
| #6950 | auth sync-role-acls | new fix |
| #8381 | scheduler | new fix — skip/deactivate jobs of disabled modules |
| #9568 | configs typecheck | new fix |
| #9191 | configs upgrade-action banner | new fix |
| #6278 | UPGRADE_NOTES / docs | docs fix |
| #9217 | workflows | new fix |
| #9201 | messages | new fix |
| #9205 | record_locks (enterprise) | new fix |
| #9188 | agent_orchestrator (enterprise) | new fix |

## Non-goals

- #6733 (273-site cross-module ORM audit), #2113 (sales ORM decoupling), #8784 (full dependency-integrity feature), #2071 (extract UpgradeActionBanner package) — multi-PR efforts; tracked in the umbrella issue only.
- #9311 — already fixed by merged PR #9531.

## Implementation Plan

Phase 1 merges the existing community PRs. Phases 2–5 run as parallel child tasks with disjoint module scopes and are merged back one at a time.

## Risks

- Merged PR branches are behind main; conflicts resolved on merge.
- Enterprise modules (record_locks, agent_orchestrator) need enterprise build to validate.
- Single large PR — reviewers should review per-issue commits.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Integrate existing fix PRs

- [x] 1.1 Merge PR #10114 (#9194 data_sync) — dd86908348
- [x] 1.2 Merge PR #9326 (#9197 entities) — 7ab688c658
- [x] 1.3 Merge PR #9569 (#8803 translations) — 4873f11eb3

### Phase 2: Kernel infra (auth, scheduler)

- [x] 2.1 Fix #6950 auth sync-role-acls without customer_accounts — already fixed on main by 45a3cee87f (no change)
- [x] 2.2 Fix #8381 scheduler dispatching jobs of disabled modules — 6fa2e7af06

### Phase 3: configs + docs

- [x] 3.1 Fix #9568 configs typecheck without customers — 3423d39c13
- [x] 3.2 Fix #9191 upgrade-action banner stuck without customers/attachments — 46dea9042f
- [x] 3.3 Fix #6278 upgrade notes for communication_channels — 7206effd72, cfeae99b56

### Phase 4: workflows + messages

- [x] 4.1 Fix #9217 workflows without progress/api_keys/business_rules — a2cc55b7ab (finding 8 deferred: needs maintainer decision)
- [x] 4.2 Fix #9201 messages without attachments/notifications — 3cfc179067

### Phase 5: enterprise modules

- [x] 5.1 Fix #9205 record_locks without audit_logs/configs — cb1a5c2c6d
- [x] 5.2 Fix #9188 agent_orchestrator without workflows/customers — afa92cd66a

### Phase 6: Gate and umbrella

- [ ] 6.1 Full validation gate
- [ ] 6.2 File umbrella issue for #9678 implementation
