# Stabilize sync_excel Import Integration Test

## Overview

Goal: stabilize `TC-SX-001` so `POST /api/sync_excel/import` reliably returns `201` when starting a customer person import from an uploaded CSV.

Scope:
- Investigate the `500` returned by `packages/core/src/modules/sync_excel/__integration__/TC-SX-001.spec.ts` at import start.
- Apply the smallest production or test-harness fix that removes the flaky failure.
- Add or update unit coverage for the root cause.
- Re-run the focused sync_excel integration test and relevant package checks.

Affected modules/packages:
- `packages/core/src/modules/sync_excel`
- `packages/core/src/modules/data_sync` only if the root cause is provider/run bootstrap behavior.
- Integration test harness only if the root cause is nondeterministic fixture/runtime setup.

Source spec:
- `.ai/specs/2026-03-29-sync-excel-customers-import-foundation.md`
- `.ai/specs/implemented/SPEC-045b-data-sync-hub.md`

Non-goals:
- Do not redesign sync_excel mapping or customer import behavior.
- Do not change public API contracts for `/api/sync_excel/*`.
- Do not relax the integration test assertions unless the assertion is proven to be incorrect.
- Do not add broad retries or longer timeouts as the primary fix.

## Implementation Plan

### Phase 1: Diagnose Import Start Failure

1. Reproduce or capture the import route failure locally with focused unit/integration commands.
2. Inspect the failing `500` path in `sync_excel` import start, `data_sync` run creation, and provider registration/bootstrap.
3. Identify whether the failure is production logic, test fixture setup, or integration runtime ordering.

### Phase 2: Apply Minimal Stabilization

1. Implement the smallest fix in the root-cause layer.
2. Add or update unit coverage that fails before the fix and passes after it.
3. Re-run targeted unit tests and the focused `TC-SX-001` integration test.

### Phase 3: Validate and Ship

1. Run affected package checks and required full gates where feasible.
2. Perform code-review and backward-compatibility self-review.
3. Open a PR against `develop`, label it, and run the required auto-review pass.

## Risks

- The integration failure may depend on ephemeral CI runtime ordering and be hard to reproduce locally.
- The import route touches data sync, integrations, attachments, custom fields, customers, and queue-driven workers, so root-cause fixes must preserve tenant/organization scoping.
- Full integration and full CI gates are expensive; if they cannot complete in one turn, the PR must remain resumable through this plan.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Diagnose Import Start Failure

- [x] 1.1 Reproduce or capture the import route failure locally — 5ab04ab30
- [x] 1.2 Inspect the sync_excel import/data_sync bootstrap path — 5ab04ab30
- [x] 1.3 Identify the root cause layer — 5ab04ab30

### Phase 2: Apply Minimal Stabilization

- [x] 2.1 Implement the minimal root-cause fix — 5ab04ab30
- [x] 2.2 Add or update regression coverage — 5ab04ab30
- [x] 2.3 Re-run targeted unit and integration tests — 5ab04ab30

### Phase 3: Validate and Ship

- [ ] 3.1 Run affected package and required validation gates
- [ ] 3.2 Complete code-review and backward-compatibility self-review
- [ ] 3.3 Open PR, label it, and complete auto-review pass
