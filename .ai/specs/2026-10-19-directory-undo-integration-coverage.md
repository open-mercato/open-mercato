# Directory undo/redo integration coverage

## TLDR

Automate the directory portion of TC-UNDO-001 for issue #2580. Exercise organization create, update, delete, undo, and redo through public APIs, including tenant-level action logs with a null organization scope, and prove tenant mutations expose no undo operation.

## Overview

Source: [issue #2580](https://github.com/open-mercato/open-mercato/issues/2580), the directory section of `.ai/qa/scenarios/TC-UNDO-001-undo-redo-all-commands.md`, and the existing customers undo pilot. The shared harness already implements the required helpers and `OM_INTEGRATION_UNDO_TESTS_DISABLED`; reuse both.

## Problem Statement

Directory lacks the requested TC-UNDO-001 spec. Its existing atomic-write tests exercise create undo without asserting that the action log has a null organization scope. They do not cover the complete update/delete/redo state or no-token tenant mutations.

## Resolved assumptions (autonomous defaults)

| Decision | Answer | Rationale |
| --- | --- | --- |
| Change runtime behavior while adding coverage? | Preserve runtime behavior; track and quarantine verified defects with issue links. | The ticket explicitly permits quarantining known defects. |
| Split the coverage into independent capabilities? | One directory undo coverage spec. | All cases verify the same module's undo contract. |

## Proposed Solution

Add `packages/core/src/modules/directory/__integration__/TC-UNDO-001-organizations.spec.ts`. Verify scalar snapshots, hierarchy relationships, custom fields, token consumption, and redo identity through real APIs. Use a separate quarantined assertion for tombstone retention when the current create-undo hard deletion is confirmed and tracked.

## Architecture

Reuse `apiRequest`, authentication/fixture helpers, and `undoHarness`. Playwright's isolated `request` fixture owns HTTP state per test, following its [fixture guidance](https://playwright.dev/docs/test-fixtures). Use `withClient` only for read-only, tenant-and-record-scoped lifecycle and persisted hierarchy observations; the manage API computes hierarchy for display. Every fixture is created through the API and cleaned up in `finally`, children before parents.

Generate unique custom-field keys and use the existing supported `customFields` API input. The data engine validates unknown keys using its existing fallback and infers storage from their values. No custom-field definition fixture is needed: organization ids are server-generated, and definitions scoped to a different organization would not apply to these record-scoped values. Include changing and clearing a value, then restoring/reapplying both states.

Send organization mutations with `om_selected_org=__all__`, then find the returned operation log in public action history and assert `organizationId === null`. Undo from a concrete, test-created selected organization to cover #2398/#2417's caller-scope mismatch.

## Data Model

Reuse Organization, Tenant, and custom-field values without schema changes. Organization snapshots include `id`, `name`, `slug`, `logoUrl`, `logoPreserveAspectRatio`, `isActive`, `parentId`, `rootId`, `treePath`, `depth`, `ancestorIds`, `childIds`, `descendantIds`, custom fields, and lifecycle timestamps. Identity remains stable; update/delete preserve creation time and undo advances `updatedAt`. Create redo currently recreates the row with a new creation timestamp: lifecycle retention needs a linked quarantined assertion alongside tombstone retention. Custom-field values are scoped to the fixture's tenant and organization record, with unique keys per test.

## API Contracts

| Path | Coverage |
| --- | --- |
| `POST /api/directory/organizations` | Create returns 201 and an undoable operation; undo hides the record; redo restores its original id and after-state. |
| `PUT /api/directory/organizations` | Update returns 200; undo restores every supplied scalar, hierarchy, and custom-field value; redo restores after-state. |
| `DELETE /api/directory/organizations?id=...` | Delete returns 200; undo clears `deleted_at`, restores snapshots and child links; redo deletes again. |
| `GET /api/directory/organizations?view=manage&tenantId=...&ids=...` | Query exact fixture state after each mutation. |
| `GET /api/audit_logs/audit-logs/actions` | Assert the matching action's null organization scope. |
| `POST /api/audit_logs/audit-logs/actions/undo` | Exercise public undo; second use of each consumed token returns 400 and `Undo token not available`. |
| `POST /api/audit_logs/audit-logs/actions/redo` | Reproduce command after-state, including stable identity. |
| `POST/PUT/DELETE /api/directory/tenants` | Assert successful non-undoable mutations return `extractOperation(response) === null`. |

## UI/UX

API-only coverage; no UI paths change. Absence of operation metadata is the existing undo-affordance contract for non-undoable commands.

## Edge Cases & Failure Scenarios

Assert response status before reading state so an authorization or validation failure cannot masquerade as successful undo. Check stable ids and exact sets of hierarchy links. Use per-test unique fixture names and keys; never consume another test's undo token. Run `skipIfUndoTestsDisabled()` in `test.beforeAll` before authentication or fixtures.

## Migration & Backward Compatibility

No API, schema, command, dependency, or generated contract changes. Existing harness exports and disable-flag semantics remain intact.

## Risks & Impact Review

| Risk | Severity | Mitigation | Residual risk |
| --- | --- | --- | --- |
| Create undo hard-deletes and redo changes creation time. | Medium | Track the observed lifecycle defect and quarantine its assertions with a bug link; keep public round-trip coverage active. | I3/lifecycle retention remain pending a separate runtime decision/fix. |
| Tests alter shared organization hierarchy or tenant state. | Medium | Create all organizations/tenants through API; use fixture-only links and reverse-order cleanup. | Failed cleanup may leave uniquely named fixtures in the disposable database. |
| Direct lifecycle inspection targets the wrong database. | High | Run solely through the repository-managed ephemeral CLI, which supplies `DATABASE_URL`; parameterize tenant/id reads. | No DB observation outside that runner. |
| App bootstrap or full validation cannot run locally. | Medium | Record exact blockers and commands on the implementation PR; leave it draft until completed. | A pending validation gate must be resumed. |

Rollback is deletion of the added spec/tests; no persisted production state changes.

## Phasing

Phase 1 adds one self-contained coverage suite. Phase 2 verifies execution, disable behavior, and repository validation.

## Implementation Plan

### Phase 1: API integration coverage

1. Verify directory mutation and action-history contracts with the running application.
2. Implement self-contained invariant and non-undoable-command tests.

### Phase 2: Verification

3. Run the directory suite with the disable flag unset and set, then the configured validation gate and independent review.

## Final Compliance Report — 2026-10-19

Reviewed root `AGENTS.md`, `packages/core/AGENTS.md`, and `.ai/qa/AGENTS.md`. Module-local placement, shared helpers, API-created fixtures, cleanup, tenant scoping, and existing test-runner configuration apply. UI, migrations, event registration, and new production entities are inapplicable. Independent scope-cohesion review passed; its creation-time consistency finding was incorporated. Execution evidence belongs to the implementation PR.

## Changelog

- 2026-10-19: Specified directory-only undo/redo integration coverage for #2580.
- Review — 2026-10-19: Scope cohesion passed independently. Security, performance, cache, commands, and risks reviewed for this test-only scope; approved for implementation with explicit lifecycle quarantines.
- 2026-10-19 implementation review: Compare persisted hierarchy in addition to computed API snapshots; exercise custom-field values directly without unrelated definition-scope fixtures.
