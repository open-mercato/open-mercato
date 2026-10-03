# Customer task count badge

Source doc: .ai/specs/2026-10-03-customer-task-count-badge.md
Spec PR: #6885
Issue: #6068

## Goal and Scope

Make the existing profile task total count the same merged tasks as the compatibility list. Add one customers helper and use it in person/company overview APIs. Keep UI, data model, permissions and response shapes unchanged.

## Implementation Plan

### Phase 1: Accurate task totals

1.1 Add the scoped merged-task count helper with storage-mode, bridge and pagination regression coverage.
1.2 Wire both profile overview APIs and cover the missing badge count through route and tab tests.
1.3 Validate, review and publish the completed implementation.

## Risks

Compatibility mode uses database aggregates and a scoped subquery to suppress bridged legacy links without materializing task histories. Every read must retain entity, tenant and organization scope. Record any validation blocker here.

## Validation and Review

- Both overview regressions failed before the fix (expected 2, received 0).
- Final focused validation: 13 suites / 60 tests passed, including actual ORM SQL compilation, all eight profile-route suites, badge boundaries and task refresh callbacks.
- Core package typecheck and both translation checks passed locally. The initial local fallback package-build / generation / package-build gate also passed.
- Independent re-review found no actionable code findings after the database-aggregation fix. It also reviewed the typed-test cleanup, this plan correction and the pre-existing route-fixture updates required by the QueryBuilder subquery.
- Remaining broad validation, app build and template parity use GitHub checks under the repository's checks-first review policy. Required CI is pending; human GitHub review and manual QA still gate merge.
- Full browser QA was not run because no local test-environment descriptor is configured. The PR carries executable QA instructions.

## Progress

PR: #6887

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Accurate task totals

- [x] 1.1 Add the scoped merged-task count helper with storage-mode, bridge and pagination regression coverage. — 4e189e0bc1
- [x] 1.2 Wire both profile overview APIs and cover the missing badge count through route and tab tests. — 6228645a36
- [x] 1.3 Validate, review and publish the completed implementation. — 71b8130877
