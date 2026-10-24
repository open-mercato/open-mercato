# Resource child create undo retention

## TLDR

Fix #7667 by retaining resource comments and activities when their creation is undone. Undo marks the original row deleted; redo restores that same row and ID. This is a correction to the I3 invariant required by #2577.

## Overview

Scope is the resources module's comment/activity create commands and the missing activity soft-delete column. PR #7659 contains isolated I3 regression cases; its separate #7666 timestamp-restoration quarantines remain outside this change.

## Problem Statement

Both create undo handlers call `em.remove`. Current develop already declares comment `deletedAt` in metadata and its migration snapshot, but activities lack it. List invisibility alone cannot distinguish a retained row from physical deletion.

## Proposed Solution

Set `deletedAt` in each create undo handler after validating tenant and organization scope, flush, then emit the established deleted undo side effects. Add nullable activity `deleted_at`. Reuse the CRUD factory's default `deletedAt` filtering and the existing comment create-redo helper; clear the activity marker in its bespoke redo handler. Preserve the retained createdAt timestamp, scalar values, references, and custom fields. The ORM advances updatedAt normally for optimistic locking; historical recreation timestamp restoration remains outside this fix.

## Architecture

All business changes remain in resources. Commands continue to own persistence, events, indexing, and custom-field restoration. Existing API URLs, response bodies, event IDs, permissions, and shared helpers stay compatible. No provider, UI, or cross-module architecture change is needed.

## Data Models

`ResourcesResourceActivity.deletedAt?: Date | null` maps to nullable `timestamptz(6)` `deleted_at`. Existing activity rows remain visible because the additive column is null. Comments already have the same mapping. No relation, uniqueness, or index changes are needed.

## Migration & Backward Compatibility

Generate the activity-only ALTER TABLE migration and updated resources snapshot using the existing tooling; discard unrelated schema drift. Do not apply migrations to a developer database. Deploy the migration before application code. Historical action logs remain valid: no new required snapshot field is introduced, and redo retains the fallback that recreates physically missing rows with their original IDs. Historical creation timestamp loss remains tracked separately in #7666. Rolling application code back leaves the nullable column in place; do not drop retained data.

## API Contracts

`POST /api/resources/comments` and `/api/resources/activities` still return the created ID and author with the `x-om-operation` token. Undo through `/api/audit_logs/undo` hides the child from its list while retaining the scoped database row. Redo through `/api/audit_logs/redo` revives the same ID. Existing update/delete behavior and request/response schemas are preserved.

## Risks & Impact Review

| Failure | Severity | Mitigation | Residual risk |
| --- | --- | --- | --- |
| Retained activity remains visible | High | Verify real list queries after undo; factory defaults to `deletedAt` | Requires migrated database |
| Redo leaves deletion marker set | High | Unit and API lifecycle coverage for both child types | Historical missing rows use fallback |
| Cross-tenant or organization mutation | High | Check row and snapshot scope before mutation/restoration | Existing command bus guards also apply |
| Stale query index/cache after undo | Medium | Emit standard deleted CRUD undo side effects | Asynchronous indexes follow existing delivery semantics |

## Implementation Plan

1. Add activity metadata and generate the scoped migration/snapshot.
2. Correct create undo and redo without changing ordinary delete semantics or historical snapshot formats.
3. Add command regressions and scoped SQL/API retention coverage; enable the isolated #7667 cases when #7659 is available without importing its unrelated test suite.
4. Run targeted tests, generators, configured validation, and independent review; publish one fix PR if validation permits.

## Integration Coverage

Create isolated parent and sibling child fixtures for each child type. Create the target through its API, undo its operation token, assert list invisibility and a database row selected by child ID plus authenticated tenant/organization with non-null `deleted_at`, then redo and assert same ID, cleared marker, preserved stored creation timestamp, content, author/parent references, and unaffected sibling/parent. Repeat undo/redo and compare scoped database rows excluding only deleted_at and updated_at. Unit tests cover activity custom-field reset maps. Confirm ordinary child delete still physically removes the row and delete undo restores its scalar/reference snapshot, excluding historical creation time (#7666). Clean up all fixtures. Unit tests additionally reject foreign scopes and exercise historical hard-deleted snapshot restoration. No UI file changes are planned; timeline visibility follows the API list behavior.

## Final Compliance Report

Design checks: resources-only scope, additive schema, stable API/events, no migration applied to a developer database, no snapshot format requirement added. Implementation: both create undo handlers retain scoped rows and emit lifecycle/index side effects; activity redo clears deletion and revives dates from every supported snapshot location. Optional scope predicates are omitted for authorized All organizations/system replay. Local validation: all 12 resources unit suites (77 tests, including 34 new regressions), core typecheck, generation, migration generation/no-op, and lesson validation passed. Both focused API/SQL cases passed against the managed migrated disposable database, after successful package/generation/application builds. Translation synchronization and template parity also passed. The broad translation-usage scan was timeboxed after more than ten minutes; full monorepo typecheck/test and the separate build:app invocation were not completed in that sequence. The skill scoped-validation fallback applies; current-head CI remains required.

## Changelog

- 2026-10-20: Documented the scoped retention fix and migration/compatibility plan before implementation.
- 2026-10-20: Implemented retention and the generated migration/snapshot; independently reviewed scope queries and historical date fallbacks, with 77 unit tests passing.
- 2026-10-20: Verified both SQL/API lifecycles in the migrated disposable runtime (2 passed); recorded the scoped full-gate limitation.
