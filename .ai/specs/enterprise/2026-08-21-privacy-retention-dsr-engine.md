# Privacy Retention and DSR Engine

## TLDR

SEC-010 adds a common way to describe data classes and the privacy operations each module supports. MIT Core owns the contracts and module-owned handlers. Enterprise owns tenant policies, legal holds, retention execution, data-subject requests, operation reports, and restore follow-up.

The first supported data classes are access logs, application users, and customer people. Access logs support batched retention. Users and people support discovery, export, erasure, and anonymization. New modules can register another class without changing the Enterprise engine.

## Implementation Status

Implemented on `feat/security-readiness` as OM-SEC-010. Package builds, registry tests, manifest tests, governance tests, and the full Enterprise Jest suite pass. The Playwright test is discovered, but the managed ephemeral run stops before Playwright because the existing full application build imports `queue/events` into the Client Component graph through the app `example` module.

## Overview

Current cleanup functions are separate. Access logs have their own retention command, while other modules expose delete commands but no common policy or data-subject workflow. Backup restore also has no durable list of erasures that happened after the selected backup.

This change connects those existing capabilities through one neutral contract. It does not move data ownership. The auth, customers, and audit modules remain responsible for reading or changing their own records.

## Problem

The platform needs:

- a registry of data classes and supported privacy actions;
- per-tenant and per-organization retention policies;
- dry-run, bounded batches, continuation information, and a PII-free report;
- legal holds for a whole data class or one subject;
- subject discovery, export, erasure, and anonymization;
- a durable erasure manifest and a post-restore list of actions that must be reapplied;
- strict tenant and organization scoping for every operation.

Separate cleanup commands cannot provide a consistent report or enforce legal holds. A generic SQL deletion engine is rejected because it would bypass module rules and side effects.

## Proposed Solution

### MIT Core contracts

`@open-mercato/shared/lib/privacy` provides:

- `PrivacyDataClassDefinition` for class metadata and supported actions;
- `PrivacyDataClassHandler` for retention and subject operations;
- a process-level registry that stores only metadata and a DI service key;
- typed scope, subject, report, retention, and export contracts.

Owning modules register handlers:

- `audit_logs.access_logs`: retention with delete action, default 90 days;
- `auth.users`: discover, export, erase, and anonymize `auth:user`;
- `customers.people`: discover, export, erase, and anonymize `customers:person`.

The audit module declares generic `privacy.subject.erased`, `privacy.subject.anonymized`, and `privacy.subject.purged` events. These event ids are additive public contracts.

### Enterprise orchestration

The `data_erasure` module stores:

- retention policies with data class, retention days, action, batch size, and active state;
- legal holds scoped to a data class, a subject, or both;
- operation rows for retention and subject requests, containing counts and status but no exported PII.

The service resolves a handler by its registered DI key. It never queries another module's tables itself. A class-level legal hold blocks retention. A subject hold blocks erasure or anonymization for that subject. Dry-run uses the same handler and scope but performs no mutation.

Subject export data is returned to the authorized caller and is not stored in the operation report. Reports store only class ids, counts, timing, and errors.

## Data Models

- `privacy_retention_policies`: one policy per tenant, organization, and data class; stores retention days, action, batch size, active state, creator, and version timestamps.
- `privacy_legal_holds`: class-level or subject-level holds with reason, optional expiry, release actor, and version timestamps.
- `privacy_operations`: PII-minimized operation report with type, status, class or opaque subject ids, dry-run flag, counts, error codes, actor, and timestamps. Export payloads are never stored.
- filesystem erasure manifest: one mode-0600 JSON entry per completed or partially completed erasure, outside the restored database.

### Restore handling

The `backups` module owns an append-only filesystem manifest. A successful erasure appends one entry. Verification and restore return entries executed after the selected backup completed. The CLI prints the list and uses a distinct exit code so an operator cannot miss the required reapplication step.

The restore list is advisory. It never deletes data automatically.

## API Surface

- `GET /api/data_erasure/data-classes`
- `GET/POST /api/data_erasure/policies`
- `PUT /api/data_erasure/policies/:id`
- `GET/POST /api/data_erasure/legal-holds`
- `POST /api/data_erasure/legal-holds/:id/release`
- `GET /api/data_erasure/operations`
- `POST /api/data_erasure/retention/run`
- `POST /api/data_erasure/subjects`

Every route requires authentication and stable `data_erasure.view` or `data_erasure.manage` features. Mutation routes resolve the active organization, validate input with zod, run within that scope, and use optimistic locking when an existing policy or hold is changed.

## Implementation Plan

1. Add the shared privacy contracts and registry with unit tests.
2. Add module-owned handlers for access logs, auth users, and customer people.
3. Add the `data_erasure` entities, migration, ACL, setup, services, APIs, CLI, and tests.
4. Add the backups erasure manifest and restore report.
5. Generate module artifacts and validate the affected packages and integration test discovery.

## Integration Coverage

- registry rejects malformed definitions and keeps one definition per id;
- access-log retention supports dry-run and bounded delete batches;
- policy and legal-hold APIs refuse cross-tenant records;
- stale policy and hold mutations return the standard optimistic-lock conflict;
- subject discovery and export do not persist exported data;
- subject erasure is blocked by an active legal hold;
- subject erasure appends a manifest entry;
- backup verify and restore report erasures executed after the backup timestamp;
- anonymization removes direct identifiers while preserving the required business record;
- all fixtures are created and removed by the tests.

## Migration and Backward Compatibility

The change is additive. Existing cleanup commands, SSO, backup archives, and API routes keep their behavior. The Enterprise module is disabled unless both `OM_ENABLE_ENTERPRISE_MODULES` and `OM_ENABLE_ENTERPRISE_MODULES_DATA_ERASURE` are enabled.

The shared registry and generic event ids are new additive contract surfaces. Handler service keys are module-owned. Existing modules that do not register a privacy data class are ignored by the engine.

The migration creates new Enterprise tables only. It does not change existing business records.

## Risks and Controls

| Risk | Control |
|---|---|
| Cross-tenant access | Every handler and Enterprise query receives and verifies tenant and organization ids. |
| Generic engine bypasses domain rules | The engine calls module-owned handlers instead of issuing generic SQL. |
| Legal hold is skipped | Holds are resolved before every retention or subject mutation and included in the report. |
| Exported PII lands in the ledger | Export payloads are returned only in the response. The operation row stores counts only. |
| A restore resurrects erased data | Erasure entries live outside the database and restore reports all entries newer than the archive. |
| Partial multi-module erasure | Reports record each class result. Re-execution is idempotent and uses a new operation row. |

## Relationship to the Existing Erasure Spec

This specification implements and broadens `.ai/specs/enterprise/2026-07-08-gdpr-data-erasure.md`. The earlier document remains authoritative for erasure irreversibility, PII-free audit records, command logging suppression, and the difference between a mechanical backup-retention guarantee and an operator-run restore control.

## Changelog

- 2026-08-21: Initial SEC-010 implementation specification.
- 2026-08-21: Implemented registry and Core handlers, Enterprise policies/legal holds/DSR orchestration, restore manifest reporting, module flags, migration, unit coverage, and Playwright API coverage. Full ephemeral execution remains blocked before Playwright by the pre-existing application Client Component build graph.
