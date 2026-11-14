# Privacy Retention and DSR Engine

## TLDR

SEC-010 adds a common way to describe data classes and the privacy operations each module supports. MIT Core owns the contracts and module-owned handlers. Enterprise owns tenant policies, legal holds, retention execution, data-subject requests, operation reports, and restore follow-up.

The first supported data classes are access logs, application users, and customer people. All three support bounded retention. Users and people also support discovery, export, erasure, anonymization, and email-to-subject resolution. New modules can register another class without changing the Enterprise engine. Active policies can be run periodically through the existing Scheduler module using an explicitly allowlisted, scope-bound command.

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
- tenant-scoped resolution of an email address to opaque subject references without storing the email in the operation ledger;
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

- `audit_logs.access_logs`: retention with delete action, default 90 days, plus subject discovery and export for an `auth:user` actor; audit records are not erased or anonymized through DSR because their evidentiary integrity is retained under the configured log-retention policy;
- `auth.users`: discover, export, erase, and anonymize `auth:user`; retention targets users whose creation, last update, and last login are all older than the configured cutoff;
- `customers.people`: discover, export, erase, and anonymize `customers:person`; retention targets only inactive people whose last update is older than the configured cutoff.

Both subject data classes support `delete` and `anonymize` retention actions with a 365-day default. No policy is created automatically. The operator must create and enable a policy explicitly. The authenticated actor running retention is always excluded from `auth.users`, in addition to subjects excluded by legal holds.

Email resolution is module-owned. Auth resolves deterministic email lookup hashes. Customers resolves the encrypted `primary_email` field through tenant- and organization-scoped search tokens. The resolver returns only subject kind/id pairs. The submitted email is never written to `privacy_operations`.

The audit module declares generic `privacy.subject.erased`, `privacy.subject.anonymized`, and `privacy.subject.purged` events. These event ids are additive public contracts.

### Enterprise orchestration

The `data_erasure` module stores:

- retention policies with data class, retention days, action, batch size, and active state;
- legal holds scoped to a data class, a subject, or both;
- operation rows for retention and subject requests, containing counts and status but no exported PII.

The service resolves a handler by its registered DI key. It never queries another module's tables itself. A class-level legal hold blocks retention. A subject hold blocks erasure or anonymization for that subject. Dry-run uses the same handler and scope but performs no mutation.

Subject export data is returned to the authorized caller and is not stored in the operation report. Reports store only class ids, counts, timing, and errors.

### Recurring retention

The Enterprise module registers `data_erasure.retention.run` as a scheduler-safe command. An administrator creates an organization-scoped schedule in the existing Scheduler UI and supplies `policyId`, `dryRun`, and `maxBatches` as its target payload. Scheduler binds the tenant, organization, and authenticated schedule creator to the command context, then checks that the creator still has `data_erasure.manage` before each run.

The command rejects payload scope that differs from the schedule context. `dryRun` defaults to `true`, so a newly configured schedule previews retention until the operator explicitly changes the payload to `dryRun: false`. The normal policy checks, legal holds, bounded batches, module-owned handlers, and PII-minimized operation report remain in force.

### Administration UI

The Enterprise settings page `/backend/security/privacy` requires `data_erasure.manage` and exposes the existing scoped APIs without adding a second execution path. Administrators can create and edit retention policies, preview or apply a policy, create and release legal holds, resolve an email, phone number, or customer name to opaque subject references, run supported subject actions, and review the latest operation reports. Policy edits and hold releases send optimistic-lock versions, and every non-form mutation uses the shared mutation guard path.

## Data Models

- `privacy_retention_policies`: one policy per tenant, organization, and data class; stores retention days, action, batch size, active state, creator, and version timestamps.
- `privacy_legal_holds`: class-level or subject-level holds with reason, optional expiry, release actor, and version timestamps.
- `privacy_operations`: PII-minimized operation report with type, status, class or opaque subject ids, dry-run flag, counts, error codes, actor, and timestamps. Export payloads are never stored.
- filesystem erasure manifest: one mode-0600 JSON entry per completed or partially completed erasure, outside the restored database.

### Restore handling

The `backups` module owns an append-only filesystem manifest. A successful erasure appends one entry. Verification and restore return entries executed after the selected backup completed. The CLI prints the list and uses a distinct exit code so an operator cannot miss the required reapplication step.

The restore list is advisory until an operator runs `data_erasure restore-reapply`. The command defaults to dry-run, rechecks legal holds, preserves the original tenant, organization, subject, and known data-class scope, and requires `--apply --confirm REAPPLY_RESTORED_ERASURES` before deleting. It also refuses to start unless the active `DATABASE_URL` identifies the same host, port, and database as `OM_BACKUP_RESTORE_DATABASE_URL`.

Older manifest entries without `dataClassIds` are reapplied to every currently registered data class that supports erasure for the recorded subject kind. New entries record the successfully executed data classes. Reapplication does not append another manifest entry, so repeated restore exercises do not multiply the durable action list.

## API Surface

- `GET /api/data_erasure/data-classes`
- `GET/POST /api/data_erasure/policies`
- `PUT /api/data_erasure/policies/:id`
- `GET/POST /api/data_erasure/legal-holds`
- `POST /api/data_erasure/legal-holds/:id/release`
- `GET /api/data_erasure/operations`
- `POST /api/data_erasure/retention/run`
- `POST /api/data_erasure/subjects`
- `POST /api/data_erasure/subjects/resolve`

Scheduler target command:

- `data_erasure.retention.run`

Every route requires authentication and stable `data_erasure.view` or `data_erasure.manage` features. Mutation routes resolve the active organization, validate input with zod, run within that scope, and use optimistic locking when an existing policy or hold is changed.

## Implementation Plan

1. Add the shared privacy contracts and registry with unit tests.
2. Add module-owned handlers for access logs, auth users, and customer people, including bounded user/person retention and email resolution.
3. Add the `data_erasure` entities, migration, ACL, setup, services, APIs, CLI, and tests.
4. Add the backups erasure manifest and restore report.
5. Generate module artifacts and validate the affected packages and integration test discovery.
6. Register a scheduler-safe recurring retention command with strict tenant and organization scope checks.
7. Add a bounded, dry-run-first restore reapplication command with target-database verification and explicit apply confirmation.
8. Add a guarded Enterprise administration page for policies, legal holds, subject requests, and operation history.
9. Extend privacy subject identifiers additively with phone-number lookup for customer people through the encrypted-field search-token index.
10. Include access logs in user discovery and export while keeping their removal controlled by the audit retention policy.
11. Add name-based candidate resolution for customer people through scoped encrypted search tokens. Names can return multiple candidates and require operator verification before a DSR action.

## Integration Coverage

- registry rejects malformed definitions and keeps one definition per id;
- access-log retention supports dry-run and bounded delete batches;
- user retention excludes the current actor, recent users, and legal-held subjects;
- person retention includes only inactive, stale people and respects legal holds;
- email resolution returns tenant-scoped auth/customer subject references and does not persist the submitted email;
- policy and legal-hold APIs refuse cross-tenant records;
- stale policy and hold mutations return the standard optimistic-lock conflict;
- subject discovery and export do not persist exported data;
- subject erasure is blocked by an active legal hold;
- subject erasure appends a manifest entry;
- backup verify and restore report erasures executed after the backup timestamp;
- anonymization removes direct identifiers while preserving the required business record;
- the API lifecycle creates real user and customer fixtures, resolves/discovers/exports them, applies anonymization or erasure, and verifies the post-operation state;
- all fixtures are created and removed by the tests.
- a scheduled retention run requires `data_erasure.manage`, inherits the schedule tenant and organization, defaults to dry-run, and rejects a mismatched payload scope.
- restore reapplication refuses a database other than the configured restore target, preserves entry scope, rechecks legal holds, stays bounded, and does not duplicate manifest entries.
- the privacy administration route requires `data_erasure.manage`, renders all four workflow areas, and sends every mutation through the guarded API path. This path is covered by a Playwright integration scenario that runs in CI with the Enterprise test environment.
- phone resolution searches only scoped customer-person phone tokens, returns opaque subject references, and does not persist the submitted phone number.
- a resolved `auth:user` reference is propagated to compatible registered data classes, access-log discovery and export remain tenant- and organization-scoped, and no subject mutation is exposed for audit evidence.
- name resolution is scoped to customer people and may return multiple opaque candidate references; the operator selects the verified record before any action.

## Migration and Backward Compatibility

The change is additive. Existing cleanup commands, SSO, backup archives, and API routes keep their behavior. The Enterprise module is disabled unless both `OM_ENABLE_ENTERPRISE_MODULES` and `OM_ENABLE_ENTERPRISE_MODULES_DATA_ERASURE` are enabled.

The shared registry, generic event ids, scheduler-safe registration exports, and `data_erasure.retention.run` command are new additive contract surfaces. Handler service keys are module-owned. Existing modules that do not register a privacy data class are ignored by the engine.

The migration creates new Enterprise tables only. It does not change existing business records.

## Risks and Controls

| Risk | Control |
|---|---|
| Cross-tenant access | Every handler and Enterprise query receives and verifies tenant and organization ids. |
| Generic engine bypasses domain rules | The engine calls module-owned handlers instead of issuing generic SQL. |
| A broad retention policy deletes an active account | Auth requires a human principal with stale create/update/login timestamps, customers requires `is_active=false`, and the current actor is excluded. Policies are opt-in. |
| Identity lookup leaks or stores an email | Resolution is tenant/organization scoped, uses hashes/search tokens, returns opaque ids, and stores counts only. |
| Legal hold is skipped | Holds are resolved before every retention or subject mutation and included in the report. |
| Exported PII lands in the ledger | Export payloads are returned only in the response. The operation row stores counts only. |
| A restore resurrects erased data | Erasure entries live outside the database and restore reports all entries newer than the archive. |
| Partial multi-module erasure | Reports record each class result. Re-execution is idempotent and uses a new operation row. |
| A recurring schedule runs with stale or forged scope | Scheduler re-authorizes its creator on every run and the command verifies tenant and organization against the schedule-bound context. |
| A schedule begins deleting data immediately after creation | Scheduled retention defaults to dry-run; apply mode must be explicitly selected in the schedule payload. |
| Erasure replay targets the live database instead of the restored database | The CLI compares the active and configured restore database identities before opening a request container. |
| Restore replay bypasses a later legal hold | Every entry returns through the normal subject-erasure path and evaluates current legal holds. |

## Relationship to the Existing Erasure Spec

This specification implements and broadens `.ai/specs/enterprise/2026-07-08-gdpr-data-erasure.md`. The earlier document remains authoritative for erasure irreversibility, PII-free audit records, command logging suppression, and the difference between a mechanical backup-retention guarantee and an operator-run restore control.

## Changelog

- 2026-08-21: Initial SEC-010 implementation specification.
- 2026-08-21: Implemented registry and Core handlers, Enterprise policies/legal holds/DSR orchestration, restore manifest reporting, module flags, migration, unit coverage, and Playwright API coverage. Full ephemeral execution remains blocked before Playwright by the pre-existing application Client Component build graph.
- 2026-08-24: Extended SEC-010 with opt-in time-based retention for inactive users and people, current-actor exclusion, email-to-subject resolution, and real-record API lifecycle coverage.
- 2026-08-24: Added scope-bound recurring retention through the existing Scheduler, with per-run RBAC and dry-run by default.
- 2026-08-24: Added controlled post-restore erasure reapplication with database-target verification, bounded batches, current legal-hold checks, and explicit apply confirmation.
- 2026-08-24: Added the Enterprise privacy administration page for retention policies, legal holds, data-subject actions, and operation history.
- 2026-08-24: Added phone-number subject resolution for customer people through tenant- and organization-scoped encrypted search tokens.
- 2026-08-24: Added actor-scoped access-log discovery and export to user DSR, without adding per-subject audit-log deletion.
- 2026-08-24: Added name-based candidate resolution for customer people, with tenant and organization scoping and explicit operator selection.
