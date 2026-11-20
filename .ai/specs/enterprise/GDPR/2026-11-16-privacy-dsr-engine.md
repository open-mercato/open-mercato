# Privacy module: subject export, erasure, retention and tenant purge

> **Tracker:** open-mercato/open-mercato#8593
> **Program:** [program](../../GDPR/2026-11-15-gdpr-ready-deployments-program.md)
> **Edition:** Enterprise
> **GDPR basis:** Art. 5(1)(e), 5(2), 12(3), 15, 17, 20, 28(3)(g)

Supersedes: .ai/specs/enterprise/2026-07-08-gdpr-data-erasure.md

## TLDR

**Key points:**
- New Enterprise module `privacy` (`packages/enterprise/src/modules/privacy/`) runs data-subject requests over the OSS data-class contract: it exports what every module holds about a subject and erases it, then applies the shared side effects (history strip, files, search indexes, CRUD cache) once, centrally.
- It also runs tenant-chosen retention (`pruneExpired` per class, including the action-log age bound from #2980) and purges a deleted tenant's data (Art. 28(3)(g)).

**Scope:**
- `mercato privacy export|erase|retention|purge-tenant` CLI and matching API routes.
- One admin page (`privacy.manage`): start export/erase, download results, edit retention settings, read the request log.
- DSR log as action-log entries (no values); persistent `privacy.subject.erased` event.

**Concerns:**
- The run is only as complete as the registered classes. Every report lists, under `notCovered`, the baseline tables and every enabled module with entities but no `privacy.ts`.
- A restore from backup brings erased data back; the controller re-runs erasures from the kept reports.

## Overview

The OSS packages ship the contract (`packages/shared/src/modules/privacy.ts`), one handler in every core module that holds personal data, and a coverage check ([contract](../../GDPR/2026-11-16-privacy-data-class-contract.md), [coverage](../../GDPR/2026-11-16-privacy-coverage.md)). This module is the only caller. It runs the handlers of every module the client enables: core, Enterprise ([enterprise coverage](2026-11-16-privacy-coverage-enterprise.md)), official and the client's own app modules. It owns no personal data of its own beyond the request log, adds no table, and never reads another module's tables, with one documented exception: tenant purge.

Audience: tenant administrators answering requests within the Art. 12(3) month, and operators who host tenants as processors.

> **Market reference:** ERPNext/Frappe "Personal Data Download Request" and "Personal Data Deletion Request" — per-doctype rules decide delete vs anonymize, the download is JSON. Adopted: per-class mode chosen by the owning module, JSON download, anonymize when deletion is blocked. Rejected: e-mail confirmation by the subject and self-service (identity verification stays with the controller, procedure in [deployment docs](../../GDPR/2026-11-16-gdpr-deployment-docs.md)).

**Compliance target.** An Enterprise deployment must provide every legally required function, with whichever core modules the client enables (owner decision, 2026-11-20). This module runs the flows; each core module contributes its handler. An OSS-only deployment is not a compliance target, so no OSS invoker is planned. The closure gate is the program's phase 3 exit: an empty coverage baseline and `TC-PRIVACY-013` passing with all core and Enterprise modules enabled.

## Problem Statement

- No code answers Art. 15/20: every module can now describe its own records, but nothing collects them, copies the subject's files, or produces something a controller can hand over.
- Ordinary deletes do not erase. A CRM person with a linked deal cannot be deleted (`customers/commands/people.ts:284-293`), a portal user is only soft-deleted with email and name kept (`customer_accounts/services/customerUserService.ts:156-169`), and the action log keeps full snapshots of deleted records.
- The search side effects of a write are not durable: `query_index.delete_one` is `persistent: false` (`query_index/subscribers/delete_one.ts:12`) and, unless the read projection is always-consistent, emits `search.delete_record` fire-and-forget (`:184-200`); the fulltext and vector delete subscribers are `persistent: false` too (`search/src/indexer/subscribers/delete.ts:9-12`, `search/src/modules/search/subscribers/vector_delete.ts:7`). A dropped event leaves the erased person searchable.
- Business records and the action log have no tenant-set retention (#2980); deleting a tenant only soft-deletes it (`directory/commands/tenants.ts:203-209`).

## Proposed Solution

### Requests

A request is the contract's `PrivacyRequest`: `scope` (`tenantId`, optional `organizationId`), an optional `subject` (`auth:user`, `customers:person`, `customer_accounts:user`, `staff:team_member`) and a `lookup` of known e-mails/phones. Either a subject or a non-empty lookup is required. A lookup alone covers people who have no record of their own (guest payer, form invitee, correspondent).

Classes taking part: every enabled class whose `subjectKinds` contains the subject's kind, plus, when the lookup is non-empty, every class (each returns only what it holds for those addresses). The **owner class** is the class of the module named before the colon in the subject kind; the others are **dependants**. A lookup-only request has no owner.

### Export run

1. Validate input (zod). If the lookup is non-empty, call `findSubjects(scope, lookup)` on every class that implements it; matches go to `related` in the result. They are not exported automatically — the admin runs a request per matched subject.
2. Call `exportSubject(request)` on every taking-part class, in class-id order. A thrown error marks that class `failed`; the run continues and the result is `incomplete`.
3. Write `subject.json`: request, scope, `generatedAt`, per class `{ classId, sections }`, `files` (`attachmentId`, `fileName`, `path`), `related`, `notCovered` (baseline tables), `coverLetter`.
4. Copy every listed file into `<dir>/files/<attachmentId>-<fileName>` through the attachments seam (below). A file that cannot be read is listed with `error` and the run is `incomplete`.
5. Log one DSR entry (`privacy.subject.export`).

`coverLetter` is the Art. 15(1)–(2) supplementary information as a field list. Filled by the run: (b) categories (class ids and section keys) and (d) retention, where the tenant has set a period for a class. Left for the controller, with the text kept in the deployment docs' DSR procedure: (a) purposes, (c) recipients, (d) retention criteria otherwise, (e) rights to rectification, erasure, restriction and objection, (f) complaint to a supervisory authority, (g) source, (h) automated decision-making, and Art. 15(2) transfer safeguards.

### Erasure run

Dry run by default; `--apply` (API `apply: true`) writes.

1. **Pre-flight (dry and apply).** Validate input. Refuse, before any write, when: a subject kind has no owner class; any taking-part class's handler does not resolve or has no `eraseSubject` (`class_not_erasable`). Handlers see only the request's tenant, so another tenant's id finds nothing (no cross-tenant oracle); a subject whose owner row is already gone still runs the dependants, which clears rows an ordinary delete left behind. Run `findSubjects` as in export. Call `eraseSubject(request, { dryRun: true, prefer })` on every class; its `touched` is the set it would change and its `filesToDelete` the files it would remove (the class's own statement; files of records kept under `legal_retention` are never listed). A thrown error (for example the auth class refusing the last holder of a protected role) refuses the run. A dry run stops here and returns the plan.
2. **Start entry (apply).** Log `privacy.subject.erase` with `status: started` and the planned refs and file ids (ids only), so a crash later still leaves the list of records whose side effects must be applied.
3. **Lock the account.** `auth:user`: command `auth.users.update` with `isConfirmed: false`, which deletes the user's sessions (`auth/commands/users.ts:847-862`) and blocks login and session refresh (`auth/api/login.ts:152`, `auth/lib/sessionIntegrity.ts:98`). `customer_accounts:user`: `customerUserService.softDelete` (sets `is_active=false`, `deleted_at`) and `customerSessionService.revokeAllUserSessions` (`customerSessionService.ts:195`). Other kinds, and accounts already gone, are skipped. The lock is not undone if the run stops; the next run finishes the job.
4. **Dependants**, in class-id order: `eraseSubject(request, { dryRun: false, prefer })`. The first failure stops the classes (`incomplete`, exit 2); later classes and the owner are not called, and step 6 still runs for what was planned.
5. **Owner last**: `prefer: 'anonymize'` when any dependant returned a non-empty `retained`, else the requested preference.
6. **Central side effects**, over the planned refs plus every class's returned `touched` and `filesToDelete`. All of them are idempotent. Each runs to the end even if one item fails; a failed item is reported `pending` and makes the run `incomplete` (exit 2):
   - **History:** `actionLogService.stripForResources(scope, refs)` ([audit spec](../../GDPR/2026-11-16-audit-snapshot-redaction.md)).
   - **Files:** delete each id in `filesToDelete` through `attachmentService.deleteByIds(scope, ids)`; a file still assigned to another record is kept and reported `retained` / `other_party`.
   - **Search indexes**, per ref, by direct call (not by event):
     - `markDeleted(em, { entityType, recordId, organizationId, tenantId })` (`@open-mercato/core/modules/query_index/lib/indexer`, `indexer.ts:505`) removes the `entity_indexes` row and every `search_tokens` row of the record.
     - `searchService.delete(entityType, recordId, tenantId)` (DI `searchService`, `search/src/service.ts:334`) deletes from every available strategy — Meilisearch fulltext, pgvector, tokens — and throws if any strategy failed.
     - Then rebuild, so an anonymized record is indexed with its new values: `upsertIndexRow` (`indexer.ts:317`, removes the row when the record no longer exists) and `searchIndexer.indexRecordById` (`search/src/indexer/search-indexer.ts:512`, skips a missing record).
     - Index rows are keyed by organization and a ref carries none, so the query-index calls run for the request's organization and the tenant level, or, for a tenant-wide request, for each organization of the tenant and the tenant level. A call for the wrong organization is a no-op.
     - Search package not installed: reported `not_configured`, not `pending`. Repair after a failure: re-run the erasure, or `mercato search reindex --tenant <id> --purgeFirst` plus `POST /api/search/reindex` for fulltext.
   - **CRUD cache:** `invalidateCrudCache(container, entityType, { id, tenantId, organizationId }, tenantId, 'privacy.erase')` (`shared/lib/crud/cache.ts:175`). The cache is opt-in (`ENABLE_CRUD_API_CACHE`); handlers writing through owner commands already invalidate their own resources, and anything cached under another resource name expires by TTL.
7. **End entry.** Log `privacy.subject.erase` with the final status, per-class counts and `pending` items (ids only). When a subject was named and the run changed anything, emit `privacy.subject.erased` with `{ persistent: true }`.

**Recovery.** Re-run with the same input: handlers recompute from current data, so finished classes report zero changes and unfinished ones continue. Records already deleted no longer appear in a new plan, so `erase --retry <runId>` (API `POST /api/privacy/erase/retry`, a "Retry" action on incomplete rows of the request log) re-applies step 6 to the refs and files recorded on that run's start entry. No other journal. A second concurrent run for the same subject converges on the same end state.

**Report** (`--out report.json`, API response): run id, mode, request (subject and lookup values — needed to re-run after a restore, see Known limits), per class `{ classId, outcome: ok|failed|not_run, deleted, anonymized, retained[], error? }`, `related`, side-effect counts `{ done, pending }` per kind, `notCovered`, `status: planned|complete|incomplete|refused`. CLI exit codes: `0` complete or planned, `1` refused or invalid (nothing changed), `2` incomplete.

### Admin page

`/backend/privacy` (requires `privacy.manage`), built from `CrudForm`, `DataTable`, `LoadingMessage`/`ErrorMessage` and locale keys:
- **Request form:** subject kind and id, e-mails, phones, organization (tenant-wide only for callers with access to all organizations). Buttons: Export, Preview erasure.
- **Result:** class outcomes in a `DataTable`; "Download subject.json" or "Download report.json" (client-side blob of the response); for export, each file linked to the existing `/api/attachments/file/<id>` route (normal attachment access applies; files the admin cannot open there are copied by the CLI). After a preview, "Apply erasure" opens a confirmation dialog (`Cmd/Ctrl+Enter`, `Escape`) and runs through `useGuardedMutation().runMutation`.
- **Retention settings:** a `CrudForm` with one optional "days" field per class that declares `retentionSetting`, plus the action-log age; empty means keep.
- **Request log:** `DataTable` of DSR entries (date, actor, action, subject kind/id, status), `pageSize` ≤ 100.

Large subjects that exceed request time limits are run with the CLI; the page says so on timeout.

### Retention runner

A daily system-scoped schedule (registered in `setup.ts` `seedDefaults`, pattern `ai_assistant/setup.ts:71-104`) enqueues one job on queue `privacy-retention` (worker `privacy:retention`, concurrency 1). For each active tenant, for each class with `retentionSetting`:
- read the days through `moduleConfigService.getValue(moduleId, name, { scope: { tenantId } })`; unset or `0` skips the class;
- call `pruneExpired({ tenantId }, now − days, { dryRun: false, limit: 500 })` until `done` or a 5-minute budget per class; the rest continues next day;
- log one `privacy.retention.run` entry per tenant when anything changed (per-class counts).

`legal_retention` rows end here: a class keeping invoices or orders under tax law uses the same setting to compute `retainedUntil` and anonymizes the retained block in `pruneExpired` once it passes. `pruneExpired` returns counts only, so the class deletes or anonymizes through its owner commands (normal CRUD index and cache side effects run), and the old action-log snapshots of pruned records end with the action-log age bound below.

**Action-log age bound (#2980).** The OSS `audit_logs` module declares class `audit_logs.action_log` with `retentionSetting` `audit_logs.action_log_retention_days`. Its `pruneExpired` deletes the tenant's action-log entries older than the cutoff in batches, except DSR entries (`command_id` starting `privacy.`), which hold no values. Unset keeps everything; the settings form enforces at least 90 days (the change-log UI reads up to 90 days); the docs recommend 365. The method lives in `audit_logs` because only the owner writes its table; this runner is its only caller, so OSS ships no schedule or setting for it.

### Tenant purge

`mercato privacy purge-tenant --tenant <id> [--apply] [--out report.json]` (CLI only). Refuses unless the tenant is soft-deleted (`tenants.deleted_at` set). Dry run prints per-table counts. Apply:
1. **Files:** for each `attachments` row of the tenant, delete its stored object through the attachments storage driver; then `pruneExpired(scope, purgeTime)` on classes whose rows point at objects outside PostgreSQL (today `agent_orchestrator.runs`, see [enterprise coverage](2026-11-16-privacy-coverage-enterprise.md)).
2. **Search:** `searchService.purge(entityId, tenantId)` for every registered entity id (fulltext, vector, tokens), then the fulltext strategy's `clearIndex(tenantId)` (`search/src/strategies/fulltext.strategy.ts:128`).
3. **Rows:** the table list comes from the same `migrations/.snapshot-open-mercato.json` inventory the OSS coverage test reads. Tables with `tenant_id`: delete `where tenant_id = X`. Tables without it are deleted through their parent: `organization_id` in the tenant's organizations, a snapshot foreign key, or an explicit parent-column map (`message_*` → `message_id`, `forms_form_submission_*` → `submission_id`, …). `tenants` goes last. Children before parents (snapshot foreign keys), batches of 1000, idempotent re-run. Tables with no tenant data (`feature_toggles`, `example_items`) are listed as `global`. Any other table in `information_schema` with a `tenant_id` column (for example the pgvector `vector_search` table, created by its driver) is purged by `tenant_id` too and reported as `outside_inventory`.
4. Log one instance-level action-log entry (`privacy.tenant.purge`, `tenantId` null, table counts).

This is the one deliberate exception to owner-only table access: the tenant ceases to exist, so no owner rule can be broken by removing every row it held. A unit test fails when a snapshot table resolves to no rule.

### Known limits

- **Restore.** Restoring a backup brings erased data back. The erasure register is the set of `--out` reports (and page downloads), kept by the controller outside the database; after any restore, re-run every erasure newer than the backup before go-live. Procedure in the [deployment docs](../../GDPR/2026-11-16-gdpr-deployment-docs.md).
- **No legal-hold engine.** When data must be kept (dispute, litigation), the operator does not run the erasure and documents the reason (docs procedure). Class-level `legal_retention`/`open_case` handle the recurring cases.
- **No technical restriction (Art. 18).** Procedure in the docs.
- **Coverage.** Tables on the coverage baseline, and enabled modules that have entities but no `privacy.ts` (an official or app module not yet registered), are not erased. Every report lists both under `notCovered`, by table and module id. The module list comes from the generated module registry: a module with `data/entities.ts` and no `Module.privacy`. Free-text mentions of the subject inside other people's records, queue copies (bounded by the [retention pruners](../../GDPR/2026-11-16-operational-retention-pruners.md)) and copies at external providers (Art. 19, docs) are outside the run.
- DSR log entries are kept until tenant purge; they hold ids and counts only.

### Design decisions

| Decision | Rationale |
|---|---|
| No new table; DSR log in the action log | The action log already records actor, time and tenant; entries carry counts only. |
| Side effects applied once, centrally, from `touched` | Handlers stay small; a missed module side effect cannot leave a searchable copy. |
| Direct index calls, not events | The CRUD index events are `persistent: false`; direct calls report failure. |
| Files chosen by each handler's `filesToDelete`, not from every touched record | A touched record can be someone else's (an interaction the subject took part in) or legally retained (an invoice); only the owner knows which files go. |
| Synchronous API; CLI for large subjects | Requests are rare; no job table or progress machinery is needed. |

## Architecture

```
mercato privacy … / /api/privacy/* / backend page
        │
        ▼
privacyService (privacy/lib/privacyService.ts, DI `privacyService`)
  ├─ registry: Module.privacy declarations → classes → handlers (DI keys)
  ├─ export / erase runs ──► handlers (owner commands, findWithDecryption)
  ├─ central effects ──► actionLogService.stripForResources · attachments seam
  │                      · markDeleted/upsertIndexRow · searchService/searchIndexer · invalidateCrudCache
  ├─ DSR log ──► actionLogService.log
  ├─ event ──► privacy.subject.erased (persistent)
  ├─ retention worker ──► pruneExpired per class (moduleConfigService settings)
  └─ purge-tenant ──► snapshot inventory · storage driver · searchService.purge
```

### Needs from OSS

| Need | Specified in |
|---|---|
| `privacy.ts` types, `Module.privacy` registry, root handlers for `auth:user`, `customers:person`, `customer_accounts:user` (incl. last-admin refusal), table inventory and baseline; a dry run's `touched` and `filesToDelete` list what a real run would change; refs carry `organizationId` | [contract](../../GDPR/2026-11-16-privacy-data-class-contract.md) |
| Handlers for every other module, incl. `staff:team_member`; attachments seam `attachmentService.readByIds(scope, ids)` / `deleteByIds(scope, ids)` (today `readScoped`/`releaseScoped` need the owner record, organization and auth context, which the run does not hold); workflows `workflowPrivacyService.deleteTerminalInstance(scope, instanceId)` | [coverage](../../GDPR/2026-11-16-privacy-coverage.md) |
| `actionLogService.stripForResources`, `stripped_at`; `audit_logs.action_log` class shell | [audit spec](../../GDPR/2026-11-16-audit-snapshot-redaction.md) |
| Procedures: identity check, deadlines, cover-letter text, restore, legal hold, restriction | [deployment docs](../../GDPR/2026-11-16-gdpr-deployment-docs.md) |

### Module files

`packages/enterprise/src/modules/privacy/`: `index.ts`, `acl.ts` (`privacy.manage`), `setup.ts` (`defaultRoleFeatures` admin → `privacy.manage`; schedule), `di.ts`, `events.ts`, `cli.ts`, `data/validators.ts`, `lib/privacyService.ts`, `lib/indexes.ts`, `lib/tenantPurge.ts`, `workers/retention.ts`, `api/*`, `backend/privacy/page.tsx`, `i18n/{en,de,es,pl}.json`. Registered in `apps/mercato/src/modules.ts` and the create-app template behind `OM_ENABLE_ENTERPRISE_MODULES`.

### Events

| Event | Payload | Delivery |
|---|---|---|
| `privacy.subject.erased` | `{ runId, tenantId, organizationId: string \| null, subjectKind, subjectId }` | `persistent: true`; subscribers dedupe by `runId`; never carries lookup values |

## Data Models

No new entity and no migration.
- **Retention settings:** `module_configs` rows through `moduleConfigService.setValue(moduleId, name, days, { tenantId })`; key per class from its `retentionSetting`.
- **DSR log entry** (`actionLogService.log`, `actionLogService.ts:268`): `commandId` `privacy.subject.export` | `privacy.subject.erase` | `privacy.retention.run` | `privacy.tenant.purge`; `resourceKind` `privacy.request`; `resourceId` run id; `actorUserId` (null from CLI, `context.via = 'cli'`); `context` `{ subjectKind, subjectId, lookupKinds, status, classes: [{ id, outcome, deleted, anonymized, retained: [{ table, count, reason }] }], planned?: { refs, fileIds }, pending? }`. An erase apply writes a `started` entry (with `planned`) and an end entry (with `pending`). No addresses, names or record values; `context` is encrypted by the audit-log encryption map. Entries are append-only, as the action log is.

## API Contracts

All routes under `/api/privacy`, `requireAuth` + `requireFeatures: ['privacy.manage']`, zod-validated, each exporting `openApi`. Tenant comes from the auth context; `organizationId` must be within the caller's organization access. Write routes run `runMutationGuards`.

```ts
const privacyRequestInput = z.object({
  organizationId: z.string().uuid().optional(),
  subject: z.object({ kind: z.string().min(1), id: z.string().min(1) }).optional(),
  emails: z.array(z.string().email()).max(10).optional(),
  phones: z.array(z.string().min(3)).max(10).optional(),
}).refine((v) => !!v.subject || !!v.emails?.length || !!v.phones?.length)
```

| Route | Body | Response |
|---|---|---|
| `POST /api/privacy/export` | `privacyRequestInput` | `subject.json` content; `files[].downloadUrl` |
| `POST /api/privacy/erase` | `privacyRequestInput & { prefer?: 'delete' \| 'anonymize'; apply: boolean }` | report; 422 refused with per-class reasons |
| `POST /api/privacy/erase/retry` | `{ runId: uuid }` | report of the re-applied side effects |
| `GET /api/privacy/settings` | — | `{ classes: [{ classId, settingKey, days: number \| null }], updatedAt }` |
| `PUT /api/privacy/settings` | `{ days: Record<settingKey, number \| null> }` | same as GET |
| `GET /api/privacy/requests` | `page`, `pageSize ≤ 100` | DSR log rows |

### CLI

```
mercato privacy export --tenant <id> [--organization <id>] (--subject kind:id | --email x | --phone y)… --out <dir>
mercato privacy erase  --tenant <id> [--organization <id>] (--subject kind:id | --email x | --phone y)… [--prefer anonymize] [--apply] [--out report.json]
mercato privacy erase  --tenant <id> --retry <runId> [--out report.json]
mercato privacy retention [--tenant <id>] [--apply] [--register-schedule]
mercato privacy purge-tenant --tenant <id> [--apply] [--out report.json]
```

`--email`/`--phone` repeat and may be combined with `--subject`. `retention` without `--apply` prints what each class would prune (`pruneExpired` with `dryRun: true`); `--register-schedule` registers the daily schedule on existing installations.

## Migration & Compatibility

Additive: new module, routes, feature, event id, queue. No existing contract changes. `UPGRADE_NOTES.md`: "Enterprise `privacy` module: enable, grant `privacy.manage`, run `mercato privacy retention --register-schedule` once; retention is off until a tenant sets a period."

## Risks & Impact Review

#### The wrong subject is erased
- **Scenario**: Operator types the wrong id or address; apply deletes another person's data.
- **Severity**: High
- **Affected area**: Every module with a class.
- **Mitigation**: Dry run by default; the page shows the preview's counts and requires a confirmation dialog; the lookup's `related` matches are listed, never erased implicitly.
- **Residual risk**: Erasure is irreversible except by restore; accepted for an explicit, previewed operator action.

#### A run stops halfway
- **Scenario**: A dependant throws or the process dies after some classes wrote.
- **Severity**: Medium
- **Affected area**: The subject's records.
- **Mitigation**: Planned refs logged before the first write; account locked; owner runs last; exit 2 and `pending` items; idempotent re-run with the same input, `--retry <runId>` for side effects of records already gone.
- **Residual risk**: Data stays partly erased until someone re-runs; the report and log show `incomplete`.

#### Search copies survive
- **Scenario**: Meilisearch or pgvector is down during the run.
- **Severity**: Medium
- **Affected area**: Global search, vector search.
- **Mitigation**: Direct calls that throw on strategy failure; failures reported `pending`, exit 2; documented repair commands.
- **Residual risk**: Index stays stale until re-run; Meilisearch applies deletes as asynchronous tasks.

#### Retention deletes records the tenant still needed
- **Scenario**: Admin sets too short a period.
- **Severity**: Medium
- **Affected area**: Classes with `retentionSetting`, action log.
- **Mitigation**: Unset = keep; action-log floor 90 days; CLI dry run; each run logged with counts.
- **Residual risk**: A tenant's configuration choice; recoverable only from backup.

#### Tenant purge hits the wrong tenant
- **Scenario**: Operator passes a live tenant id.
- **Severity**: Critical
- **Affected area**: Whole tenant.
- **Mitigation**: Refuses unless the tenant is already soft-deleted; dry run default; super-admin CLI only.
- **Residual risk**: A soft-deleted tenant purged too early is gone; backups expire on their own schedule.

#### Restore resurrects erased data
- **Scenario**: Backup restored after erasures.
- **Severity**: High
- **Affected area**: All erased subjects since the backup.
- **Mitigation**: Kept reports are the register; idempotent re-run; docs procedure.
- **Residual risk**: Depends on the operator following the procedure.

## Implementation Plan

### Phase 1: Module and export
1. Scaffold the module (files above), feature, i18n, registration in both `modules.ts`; `yarn generate`. Test: module loads, feature syncs.
2. `privacyService.exportRequest`: class selection, `findSubjects`, `exportSubject`, `subject.json`, cover letter, `notCovered`, DSR entry. Unit tests with fake handlers (failed class → `incomplete`).
3. File copy through the attachments seam; CLI `export`. Unit test: listed files land in `files/`.
4. `POST /api/privacy/export` with zod + `openApi`. Integration TC-PRIVACY-001/002.

### Phase 2: Erasure
1. Pre-flight and dry run (refusals, plan). Unit tests: missing owner, missing handler, thrown dry run → nothing written.
2. Account lock, dependants, owner with anonymize escalation. Unit test: order and `prefer` escalation.
3. Central effects: `stripForResources`, file release, index removal/rebuild, cache invalidation; `pending` + exit 2. Unit tests per effect with a failing double.
4. Start/end entries, event, report, CLI `erase` and `--retry`, `POST /api/privacy/erase` and `/erase/retry`. Integration TC-PRIVACY-003…008.

### Phase 3: Admin page
1. Request form, result table, downloads, confirm-and-apply. Integration TC-PRIVACY-012.
2. `GET /api/privacy/requests` and log table.

### Phase 4: Retention
1. Settings routes and form. Integration TC-PRIVACY-009.
2. Worker, schedule, CLI `retention`. Unit test: unset skips, budget stops, `done` loop.
3. `audit_logs.action_log` `pruneExpired` (in `audit_logs`, OSS) with the `privacy.*` exemption. Integration TC-PRIVACY-010.

### Phase 5: Tenant purge
1. Table-rule resolver over the snapshot inventory; unit test that every table resolves.
2. Files, search, rows, log; CLI `purge-tenant`. DB test TC-PRIVACY-011.


### Phase 6: Tandem closure
1. `notCovered` from the generated module registry: enabled modules with `data/entities.ts` and no `Module.privacy`, plus baseline tables. Unit test with a fixture registry. `TC-PRIVACY-014`.
2. `TC-PRIVACY-013` on an all-modules Enterprise build, run after the OSS coverage phases and the enterprise coverage spec land. This is the GDPR closure gate for Enterprise releases.

## Integration Coverage

All tests create their own tenant data through API fixtures and clean up in `finally`; files under `packages/enterprise/src/modules/privacy/__integration__/`.

| Test | Asserts |
|---|---|
| TC-PRIVACY-001 | Export of a person with address, comment and attachment returns their sections and the file; DSR entry exists and holds no e-mail or name |
| TC-PRIVACY-002 | Export by e-mail only returns lookup records and lists the matching person in `related` without exporting them |
| TC-PRIVACY-003 | Erase dry run changes nothing and returns per-class counts |
| TC-PRIVACY-004 | Erase apply on a person with a linked deal: person anonymized, file gone, search API no longer finds the name, audit history stripped, `privacy.subject.erased` emitted once |
| TC-PRIVACY-005 | Erase apply on a staff user: login refused, sessions gone, enterprise credentials gone |
| TC-PRIVACY-006 | Last protected-role holder and a class without `eraseSubject` are refused with nothing changed |
| TC-PRIVACY-007 | Re-run after apply reports zero changes and `complete`; with the search strategy failing, apply ends `incomplete` and `erase/retry` later removes the index entries |
| TC-PRIVACY-008 | 403 without `privacy.manage`; another tenant's subject id finds and changes nothing |
| TC-PRIVACY-009 | Retention settings round-trip; a record older than the period is pruned, unset keeps it |
| TC-PRIVACY-010 | Action-log age bound deletes old entries and keeps `privacy.*` entries; floor 90 enforced |
| TC-PRIVACY-011 | Purge refuses a live tenant; on a soft-deleted tenant no row with its id remains in any inventoried table and its files are gone |
| TC-PRIVACY-012 | Page: export download, erase preview, confirm dialog, apply, log row appears |
| TC-PRIVACY-013 | **Tandem closure.** On an Enterprise build with every core and Enterprise module enabled, a fixture person, portal user and staff user are seeded through the real APIs into every module holding personal data: CRM, sales and checkout, cart, forms, messages, channels, phone calls, workflows, AI assistant, staff, notifications, warranty, SSO, security, agent orchestrator. Export returns a section from each module. Erase apply ends `complete` with `notCovered` empty. Afterwards no seeded name, email or phone is returned by any list, detail or search API, and every legally retained order keeps only its allowlisted fields |
| TC-PRIVACY-014 | A fixture app module with an entity and no `privacy.ts` is enabled; export and erase reports list it under `notCovered` by module id, and the run status says the coverage is incomplete |

## Final Compliance Report — 2026-11-20

### AGENTS.md Files Reviewed
- `AGENTS.md`, `packages/core/AGENTS.md`, `packages/ui/AGENTS.md`, `packages/events/AGENTS.md`, `packages/search/AGENTS.md`, `packages/queue/AGENTS.md`, `.ai/specs/AGENTS.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|---|---|---|---|
| root AGENTS.md | No cross-tenant data; filter by tenant/organization | Compliant | Tenant from auth; every handler query carries `tenant_id` |
| root AGENTS.md | No direct ORM relationships / owner-only tables | Compliant | One documented exception: tenant purge |
| root AGENTS.md | zod validation, `openApi` on routes | Compliant | `data/validators.ts` |
| root AGENTS.md | Never bypass mutation guards | Compliant | `runMutationGuards`; UI `useGuardedMutation` |
| root AGENTS.md | No hard-coded strings; dialogs Cmd/Ctrl+Enter, Escape | Compliant | Locale keys; confirm dialog |
| root AGENTS.md | Optimistic locking on new editable entities | N/A | No new entity; settings are `module_configs` rows |
| packages/events | Persistent subscribers idempotent | Compliant | `runId` dedupe |
| packages/queue | Worker contract, concurrency | Compliant | `privacy-retention`, concurrency 1 |

### Verdict
Compliant — ready for implementation once the OSS contract and root handlers land.

## Changelog
### 2026-11-20
- Rewritten to minimal GDPR scope.
