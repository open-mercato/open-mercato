# Resources undo/redo integration coverage

## TLDR

Automate issue #2577 and the resources portion of TC-UNDO-001 using the existing shared undo harness and real authenticated CRUD, undo, and redo APIs.

## Problem Statement

Resource create-redo identity has a focused regression test, but resource updates, deletes, custom fields, child collections, and tag membership lack systematic undo/redo integration coverage. Regressions can silently discard resource details after an Undo action.

## Proposed Solution

Add module-local API specs with independent fixtures, full scalar snapshots, exact token-consumption checks, and cleanup. Reuse `skipIfUndoTestsDisabled()` before authentication. Exercise resources, resource types, activities, comments, and tag assignment/unassignment; document non-undoable operations and quarantine only verified, linked defects.

## Overview and Architecture

Tests live in `packages/core/src/modules/resources/__integration__/TC-UNDO-001-*.spec.ts`. Shared fixture assertions live under `packages/core/src/helpers/integration/` and compose `apiRequest`, `readJsonSafe`, and `undoHarness`. API mutations exercise the real command bus. Read-only database assertions through `withClient` distinguish soft deletion from hard removal, scoped by fixture ID, tenant, and organization. No application behavior changes are planned.

The existing customers undo suite is the reference implementation. The generic single-field round-trip helper is insufficient for this ticket's complete snapshots, consumed-token status, create redo, and delete redo assertions.

## Data Models

Use existing `Resource`, `ResourceType`, `ResourceActivity`, `ResourceComment`, `ResourceTag`, and `ResourceTagAssignment` tables. Create fixtures and custom-field definitions over authenticated APIs; remove them in `finally`. Use unique names/keys and only fixture IDs for lookups. Never depend on example dictionary values or seeded resources. No schema changes or migrations.

## API Contracts and Coverage

| API | Coverage |
| --- | --- |
| `/api/resources/resources` POST/PUT/DELETE | Full scalar snapshots, I1/I2/I3/I5/I6, same-ID redo, I4 custom-field restore, related tags/comments/activities after parent delete undo |
| `/api/resources/resource-types` POST/PUT/DELETE | Full scalar snapshots, I1/I2/I3/I5/I6, same-ID redo, I4 custom-field restore on create/update/delete |
| `/api/resources/activities` POST/PUT/DELETE | Relation and scalar snapshots including dates, I1/I2/I3/I5/I6 |
| `/api/resources/comments` POST/PUT/DELETE | Relation and scalar snapshots, I1/I2/I3/I5/I6 |
| `/api/resources/resources/tags/assign` and `/unassign` POST | Membership restoration and redo, I5, preserve unrelated membership |
| `/api/resources/tags` POST/PUT/DELETE | Non-undoable tag CRUD returns `extractOperation(response) === null` |
| `/api/audit_logs/audit-logs/actions/undo` POST | Successful undo; repeat token returns 400 and `Undo token not available` |
| `/api/audit_logs/audit-logs/actions/redo` POST | Exact post-state and original record ID restored |

CRUD payloads use camelCase; resource/type/comment list responses use snake_case; activity list responses use camelCase. Filter resource lists using `ids`, and child lists by `entityId`. Assert `updated_at` advances after update undo and `deleted_at` changes in the database. Keep list page sizes at most 100.

## UI/UX

This is API integration coverage. No UI files or flows change. The absence of an undo token checks the backend contract for absence of an Undo affordance.

## Migration & Backward Compatibility

No production contracts, dependencies, schema, routes, or command handlers change. Reuse the existing `OM_INTEGRATION_UNDO_TESTS_DISABLED` flag and unit-tested boolean parser. Every new suite calls its skip helper in `beforeAll` before login; prove enabled execution and disabled skips.

## Edge Cases and Risks & Impact Review

| Scenario | Severity | Mitigation and residual risk |
| --- | --- | --- |
| Broken undo path makes the coverage red | Medium | Confirm the failing API response and file a linked defect before using narrowly scoped `test.fixme`; never blanket-skip the suite |
| Fixture cleanup is bypassed on failure | Medium | Register fixture IDs immediately and clean up child-first in `finally`; soft-deleted fixture rows remain by design |
| Reads hit the developer database | High | Run through the repository-managed ephemeral CLI and its injected environment; scoped read-only DB assertions |
| Related collection loss is missed | Medium | Assert fixture tag memberships and child IDs after parent delete undo and redo |
| Gate hides authentication failures as skips | Low | Skip before login only when the explicit flag is truthy |

## Implementation Plan

### Phase 1: Lifecycle coverage

1. Add focused shared resource undo fixture assertions and resource-type/comment/activity lifecycle specs.
2. Add resource lifecycle, custom-field, related-collection, tag membership, and non-undoable tag CRUD coverage.

### Phase 2: Verification and publication

3. Run focused tests in managed ephemeral mode, prove the disable flag, and record any narrowly quarantined known defects.
4. Run the configured validation gate, obtain independent review, and publish the implementation PR referencing this spec PR and closing #2577.

## Final Compliance Report — 2026-10-19

Reviewed root `AGENTS.md`, `packages/core/AGENTS.md`, `.ai/qa/AGENTS.md`, and `.ai/specs/AGENTS.md`. Placement, fixture isolation, real command API calls, bounded lists, and compatibility requirements are addressed above. UI/design-system, new ACL grants, new encryption maps, discovery, and migrations do not apply. Implementation may require defect quarantines supported by observed failures and linked issues.

## Changelog

- 2026-10-19: Specify resources TC-UNDO-001 integration coverage for #2577.

- 2026-10-19: Correct the coverage matrix to include resource-type custom-field create/update/delete undo and redo (I4), required by #2577.
