# Feature-toggle undo integration coverage

## TLDR

Automate the feature-toggle portion of TC-UNDO-001 for issue #2581 using the real API and shared undo harness. Global definitions require superadmin; tenant override changes are undoable, as resolved in #2506 / #2552.

## Overview

This is one test-coverage capability for the existing feature-toggle command surface. Reuse the existing disable flag and module-local integration-test discovery.

## Problem Statement

The global commands lack TC-UNDO-001 coverage. Existing TC-FT-011 tests cover only part of the override lifecycle and omit several redo and version assertions.

## Proposed Solution

Add module-local `TC-UNDO-001-global.spec.ts` and `TC-UNDO-001-overrides.spec.ts`. Use `expectOperation`, `undoOk`, `redoOk`, and the existing disable gate in `test.beforeAll`. Assert consumed tokens return HTTP 400 with `Undo token not available` before redo. Use unique API-created fixtures and cleanup in `finally`, following [Playwright's isolation guidance](https://playwright.dev/docs/best-practices#make-tests-as-isolated-as-possible).

## Architecture

Tests call the global and override APIs, then the audit-log undo/redo endpoints, then read back the resulting state. Shared harness behavior stays unchanged. Confirmed defects receive separate linked `test.fixme` cases; healthy paths stay executable.

## Data Models

Global scalar snapshots cover `identifier`, `name`, `description`, `category`, `type`, and `defaultValue`, plus stable `id` and advancing `updatedAt`. Override snapshots cover `id`, `value`, `tenantId`, `toggleType`, and `updatedAt`. Feature toggles have no custom fields. Related overrides must survive global delete/undo. The public global API hides deleted rows and does not expose `deletedAt`; distinguish that visibility assertion from proof of physical soft deletion.

## API Contracts

| Path | Coverage |
| --- | --- |
| `POST/PUT/DELETE /api/feature_toggles/global` | Superadmin global command execute, undo, redo |
| `GET /api/feature_toggles/global/:id` | Exact scalar snapshots and version |
| `PUT /api/feature_toggles/overrides` | Tenant-admin override create/change/clear |
| `GET /api/feature_toggles/global/:id/override` | Tenant-scoped override snapshots |
| `GET /api/feature_toggles/check/:type` | Resolved value and default/override source |
| `POST /api/audit_logs/audit-logs/actions/undo` | Restoration and token consumption |
| `POST /api/audit_logs/audit-logs/actions/redo` | Reapply post-command state |

All module mutation commands are undoable after #2552; there is no applicable section-4 negative command. Assert rejected admin global writes expose no operation token instead.

## UI/UX

API integration coverage only; no UI change or new UI path.

## Migration & Backward Compatibility

No production code, API, schema, ACL or dependency changes. Reuse `OM_INTEGRATION_UNDO_TESTS_DISABLED` (default off); prove normal execution and truthy skip behavior.

## Risks & Impact Review

### Shared fixture interference

- **Scenario:** Global test definitions affect another test's data.
- **Severity:** Low
- **Affected area:** Feature-toggle integration runs.
- **Mitigation:** Unique identifiers, per-test creation and `finally` cleanup.
- **Residual risk:** A crashed worker may leave its uniquely named fixture.

### Existing undo defects

- **Scenario:** Creation undo removes a row physically, or override redo changes identity.
- **Severity:** Medium
- **Affected area:** Global/override command snapshots.
- **Mitigation:** Record concrete evidence and quarantine with a linked defect instead of weakening expected invariants.
- **Residual risk:** Quarantined invariants remain unverified until the linked fix ships.

## Phasing

Ship one test suite, then record enabled/disabled validation and independent review.

## Implementation Plan

### Phase 1: API coverage

1. Cover global create, update, delete and undo/redo snapshots with isolated fixtures.
2. Cover tenant override creation, changes and clearing through undo/redo.

### Phase 2: Verification

1. Prove token consumption and enabled/disabled runs; record any confirmed defects and validation limits.

## Final Compliance Report — 2026-10-19

### AGENTS.md Files Reviewed

- `AGENTS.md`, `packages/core/AGENTS.md`, `.ai/qa/AGENTS.md`, `.ai/specs/AGENTS.md`.

### Compliance Matrix

| Rule | Status | Evidence |
| --- | --- | --- |
| Module-local tests and shared helpers | Compliant | Existing runner and undo harness reused |
| Tenant isolation | Compliant | Authenticated API scoping, unique fixtures |
| Self-contained setup and cleanup | Compliant | API fixture per test, `finally` cleanup |
| Contract preservation | Compliant | Test-only implementation |

### Internal Consistency Check

Data/API fields match existing routes. All affected mutation/read paths are listed. No new model, UI, cache or event behavior is introduced.

### Verdict

Ready for implementation; report quarantined invariants and environmental validation limits explicitly.

## Changelog

### 2026-10-19

- Specify issue #2581 test coverage against the resolved #2506 contracts.
