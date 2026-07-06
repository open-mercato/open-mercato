# Automated Database Backups & GDPR Erasure Propagation (Enterprise)

## TLDR
**Key Points:**
- Two new enterprise modules: `backups` (scheduled encrypted physical database backups to object storage, tooled restore, retention, continuous restore verification) and `data_erasure` (tenant-scoped GDPR erasure orchestration with an append-only erasure ledger).
- The GDPR guarantee is two-layered: bounded backup retention (erased data ages out of all archives within a documented window) plus a guided erasure re-run after every restore — the restore CLI diffs an out-of-database erasure manifest against the restored ledger and lists the erasures the operator must re-execute.
- Closes the confirmed operational finding: no automated backup mechanism exists in the codebase today — only manual `pg_dump` instructions in operator docs. De facto implements upstream issue #117 ("unified, GDPR compliant data removal tool").

**Scope:**
- Physical whole-database backups (`pg_dump` custom format), AES-256-GCM-encrypted, streamed to a dedicated env-configured S3 target.
- CLI-first restore and verification tooling; restore is never exposed over HTTP.
- Scheduling through the existing `@open-mercato/scheduler` package (system-scope schedules targeting queue jobs), plus CLI trigger and a superadmin status page.
- Erasure **orchestration** for subject kinds `customers:person` and `auth:user`: the hard-delete primitives already exist (`customers.people.delete`, `auth.users.delete` — both hard-delete with cascades); what is missing and what this spec adds is the ledger, undo-snapshot hygiene, cross-module propagation, search-index cleanup, and the post-restore re-run guidance.
- Retention expiry and an on-demand restore-verification CLI (`backups verify` into a scratch database); scheduled verification is a one-click follow-up via the scheduler admin UI, not built in v1.

**Out of scope (future specs):**
- Logical per-tenant export/restore (tenant portability, selective restore into a live database).
- Crypto-shredding (per-data-subject encryption keys) — noted as a hardening direction, not built here.
- Point-in-time recovery (WAL archiving) — operators may layer pgBackRest/WAL-G underneath (see the AWS Terraform playbook's Aurora PITR for the infra-level counterpart); this spec is the app-level mechanism.
- PII anonymization (as opposed to deletion) — tracked upstream as the open half of issue #208. Market-converged follow-up: leading CRM/ERP products anonymize in place when retention blocks deletion; the deals guard below points operators at this future path.
- Inbound-message matching in `communication_channels` (messages *from* the subject not linked by an author reference) — v1 purges subject-**authored** messages and attachments (see Phase 5); matching by sender address is deferred (a gap even leading implementations share).

**Concerns:**
- `storage-s3` upload is `Buffer`-only; archives need additive **optional** streaming methods on the driver — framed as completing the SPEC-045i storage-hub interface, which already declares a streaming download.
- Notifications are tenant-scoped by contract (`Notification.tenant_id` non-nullable, `NotificationServiceContext.tenantId` required), so scheduled (tenant-less) run failures have no notification addressee in v1 — detection relies on the status page freshness state plus a documented external uptime check; manual runs notify the triggering admin through the standard path.
- S3 has no append primitive; the erasure manifest is object-per-entry, not JSONL append.
- The archive encryption key is a restore precondition — escrow procedure documented; after rotation the old key must be kept until its archives age out (restore accepts an explicit `--encryption-key` for pre-rotation archives).
- Cross-module PII purge propagates via **generic OSS-level erasure events** (`privacy.subject.erased`/`privacy.subject.purged`, declared in core — shape and owning module settled at Phase 0 Gate B); OSS core never names an enterprise event id. Propagation is eventually consistent; the erasure ledger records only the synchronous sweep's own actions.

## Overview

Open Mercato instances (self-hosted and DevCloud-managed) currently have no first-class data-recovery capability. This spec gives every enterprise instance an automated, verifiable backup pipeline and makes GDPR Art. 17 erasure durable across restores. The audience is instance operators (superadmins) for backups, and tenant admins/DPOs for erasure requests.

Upstream anchoring: this spec de facto implements open issue **#117** ("unified, GDPR compliant data removal tool") — the implementation PR should reference and close it. Related: **#208** (PI data encryption delivered in PR #223; anonymization half still open), **#994** (per-tenant DEK portability between environments — the restore runbook must cite it), and the scheduler line (issue #407 → PR #444, hardening #2279/#2516/#2625, fix #3716) which this spec consumes instead of duplicating.

> **Market Reference (backups)**: adopted the app-orchestrated model proven in mature self-hosted platforms — application-managed scheduled backups, object-storage upload, one-command restore, an admin status surface — and the strict separation of archive and secrets: the encryption key never travels with the archive, and losing the key means losing the backups, which is documented loudly. pgBackRest/WAL-G — rejected as the in-app mechanism: they are infrastructure-level tools with no application awareness, so they cannot drive erasure replay, retention tied to app policy, or an admin UX; operators can still run them alongside for PITR. No surveyed product implements any post-restore erasure re-application; the ledger + bounded-retention + guided-re-run model follows EDPB guidance that backup erasure may complete within a documented rotation window provided restores re-apply erasures.
>
> **Market Reference (erasure)**: surveyed GDPR-erasure implementations across leading CRM/ERP products. Established patterns adopted here: blocking deletion of a contact referenced by business documents, with anonymize-or-reassign guidance when retention prevents deletion; erasure audit logs that store **masked** subject identifiers (`j*** d**`, `j***@e******.com`) — adopted for the ledger's display label; and purging subject-authored message content and attachments. Auto-disassociating business records instead of blocking (one surveyed product's approach) was rejected as a silent mutation. Backup-retention comparison for the docs page: published windows across surveyed products range from ~30 days to 12 months, and none offers any post-restore re-application — this spec's 35-day retention bound matches the tightest cited window, and the guided re-run is a control no surveyed product offers.

## Problem Statement

A security/operations review (2026-07), independently re-verified by an 8-agent gap analysis against a fresh `develop` clone (2026-07-02):

1. **No automated backup mechanism is live in the codebase.** Zero `pg_dump` invocations in code (docs-only manual instructions in `apps/docs/docs/installation/vps.mdx`, `setup.mdx`), no backup module, no `OM_BACKUP_*` variables. The AWS Terraform playbook (`.ai/specs/2026-06-04-aws-terraform-deployment-playbook.md`) is an explicitly non-final plan with zero `.tf` files in the repo; SPEC-024 lists backups as an unimplemented NFR.
2. **No restore path is confirmed or tooled.** "Test restore procedures regularly" is a docs checklist item with no supporting code.
3. **GDPR erasure orchestration is missing** — but the deletion primitives are not. `customers.people.delete` hard-deletes a person with cascades (addresses, comments, activities, interactions, tags, custom-field values), and `auth.users.delete` hard-deletes the user row (`deleteOrmEntity({ soft: false })`) plus `UserAcl`/`UserRole`/`Session`/`PasswordReset`. What no code provides today: an erasure ledger, coordinated module-owned PII purge (the deferred TODO at `communication_channels/subscribers/user-deleted-cascade.ts:26-29`), undo-snapshot hygiene (delegated deletes write fresh PII snapshots to `action_logs`), per-subject search-index cleanup, and any propagation to backups. Upstream tracks the unified-tool ask as issue #117.

## Proposed Solution

Two enterprise modules plus one small additive platform extension, consuming the existing scheduler.

### Design Decisions

| Decision | Rationale |
|----------|-----------|
| Physical whole-DB backups first; per-tenant logical export deferred | `pg_dump -Fc` is proven, complete (custom fields, encrypted columns, FK graph come along for free), and closes the finding fastest. Logical per-tenant traversal is a separate, much larger problem. |
| Erasure ledger + bounded retention + **guided re-run** on restore (not automated replay, not crypto-shredding) | Keeps archives immutable and the encryption layer untouched. Bounded retention alone already matches market and EDPB-accepted practice; the guided re-run (restore CLI diffs the manifest and lists what to re-execute) restores the erasure state with operator confirmation. Fully automated replay was in rev 2–3 and was descoped: it pulled in HMAC verification, a blind index, a pepper precondition, and a cross-module replay service for marginal value over the guided flow. Crypto-shredding remains a future hardening direction. |
| Ledger in DB + plain erasure **manifest** in the backup bucket | A restore from a pre-erasure archive would otherwise erase the ledger itself, leaving nothing to diff against. Each executed entry becomes one immutable JSON object under a tenant prefix (S3 has no append primitive; atomic writes, no read-modify-write races). No HMAC and no blind index: manifest entries only feed an operator-reviewed re-run list, never automated deletion, so tamper impact is bounded by the operator's confirmation. The DB row serves the admin UI and API. |
| Scheduling via the existing `@open-mercato/scheduler` package | The platform already ships a scheduler (issue #407 → PR #444, actively maintained): cron/interval schedules, `system` scope without tenant, sync to BullMQ repeatable, local execution in dev (`LocalSchedulerService`), admin UI, idempotent `register()` upsert — consumed today by `data_sync`, `communication_channels`, `integrations`. Building a queue-level `repeat` primitive would duplicate it. |
| `data_erasure` is a separate module from `backups` | Erasure is a privacy capability independent of backups (it must run even if backups are disabled). `backups` consumes it soft-optionally at restore time; either module functions without the other. |
| Backup target and encryption key are env-only, never DB-configurable | A tenant admin must never be able to redirect instance-wide backups or read the archive key. Instance secrets stay with the operator. The module builds its own storage client via the exported `createStorageService()` from `OM_BACKUP_S3_*` env — it MUST NOT resolve the DI `storageService`, which is the per-tenant Integration Marketplace credentials wrapper and would throw for instance-level jobs. |
| Restore is CLI-only | Restoring a whole database over an HTTP endpoint is an unacceptable attack surface. The CLI runs with operator credentials on the host. |
| Erasure is deliberately not undoable — and must not create PII while deleting it | GDPR requires irreversibility. The ledger is the audit record. Delegated deletes run with command-bus `metadata { skipLog: true }` so no fresh undo snapshot containing the subject's PII is written to `action_logs` (`command-bus.ts:511`); the sweep additionally purges pre-existing snapshots referencing the subject. Explicit, justified exception to the undoability default. |
| Persons with linked deals: fail-with-guidance | `customers.people.delete` refuses to delete a person with linked deals (`people.ts:1232-1236`). The erasure command surfaces this as a clear, actionable error listing the blocking deals — deals are business records with their own retention obligations, so the sweep must not silently unlink or mutate them. Blocking deletion of a contact referenced by business documents is the established market pattern; the converged handling for retained records is anonymize-in-place, which is the planned #208-adjacent follow-up the guidance message points to. Auto-disassociating the records instead was considered and rejected: it silently mutates business records. |
| Failure detection via status page + external monitoring (no cross-tenant notification fan-out in v1) | `Notification.tenant_id` is non-nullable and recipient resolvers filter by tenant, so a scheduled (tenant-less) failure has no default addressee; a superadmin fan-out would be a novel cross-tenant pattern requiring its own security review. Market ships status surfaces plus external monitoring. Manual runs already notify the triggering admin through the standard tenant-scoped path; failure events remain emitted for workflow/monitoring integrations. |

### Alternatives Considered

| Alternative | Why Rejected |
|-------------|-------------|
| Additive queue `repeat` extension (`EnqueueOptions.repeat`, `WorkerMeta.schedule`) | Duplicates `@open-mercato/scheduler`, which already provides cron/interval schedules, BullMQ repeatable sync, dev-local execution, and an admin UI. (This was the original proposal in rev 1 of this spec; withdrawn after gap analysis.) |
| External cron + docs only (no in-app scheduler) | Reproduces the current failure mode: a checklist item nobody wires up. The finding exists because "operator will do it" did not happen. |
| Backup via logical data-engine export | Slower to deliver, easy to miss tables (custom field values, link tables), and restore consistency across modules is unsolved. |
| Rewriting archives on erasure | Breaks archive immutability and checksums; operationally fragile; no compliance benefit over replay + retention. |
| Storing backups through tenant-configurable storage integration | Tenant-controlled credentials for instance-wide data is a cross-tenant exposure. |
| Single JSONL ledger file with ETag-guarded read-modify-write | Race window under concurrent erasures; unbounded file growth; S3 conditional writes make it workable but strictly worse than immutable object-per-entry. |

## User Stories / Use Cases

- An **instance operator** wants **nightly encrypted backups shipped off-host automatically** so that a database loss is recoverable without relying on remembered manual steps.
- An **instance operator** wants **a one-command, safety-railed restore** so that recovery under pressure is a procedure, not an improvisation.
- An **instance operator** wants **an on-demand verification command** (`backups verify` into a scratch database) so that backups are not discovered to be corrupt at the worst moment; scheduling it is one click in the scheduler admin UI.
- A **superadmin** wants **a status page showing backup freshness, inventory, and verification results** so that a silently failing pipeline is visible.
- A **tenant admin / DPO** wants **to execute an erasure request for a person or user** so that GDPR Art. 17 obligations are met with an auditable record.
- A **DPO** wants **erasure to survive a database restore** so that restoring last week's backup does not resurrect erased personal data.

## Architecture

```
 @open-mercato/scheduler          ┌─────────────────────────────────────────────────┐
 (system-scope schedules,  ─────▶ │ backups module (enterprise)                     │
  targetType 'queue')             │  workers: backup-run / retention                │
  CLI trigger ──────────────────▶ │  lib: backupService (pg_dump→AES-GCM→S3 stream) │
  admin POST ───────────────────▶ │  entity: backup_run          events: backups.*  │
                                  │  CLI: run / list / restore / verify             │
                                  └───────────────┬─────────────────────────────────┘
                                                  │ restore completed:
                                                  │  1) diff erasure manifest vs
                                                  │     restored ledger → print
                                                  │     re-run list for the operator
                                                  │  2) emit backups.restore.completed
                                                  ▼
                                  ┌─────────────────────────────────────────────────┐
                                  │ data_erasure module (enterprise)                │
                                  │  entity: erasure_request (ledger, tenant-scoped)│
                                  │  DB row + S3 manifest (object-per-entry,        │
                                  │  via soft-optional erasureManifestService)      │
                                  │  command: data_erasure.request.execute          │
                                  │  event: data_erasure.request.executed ──────────┼──▶ subscribers in
                                  └─────────────────────────────────────────────────┘    audit_logs,
                                                                                          communication_channels
                                                                                          (core-side commits),
                                                                                          3rd-party modules
```

### Platform extension (additive, OSS-side)

**Streaming storage upload** (`packages/storage-s3`): `StorageService` gains **optional** members `uploadStream(input: { namespace, fileName, stream: Readable, contentType?, scope })` backed by `@aws-sdk/lib-storage` multipart `Upload`, and `downloadStream(input: { key, scope }): Promise<Readable>`. Optional-member form is required by `BACKWARD_COMPATIBILITY.md` for a published-package interface. The shipped `StorageService` (`packages/storage-s3/src/modules/storage_s3/lib/storage-service.ts:65-76`) is Buffer-only in both directions — a streaming `download(): Promise<ReadableStream>` exists only in the SPEC-045i *design document* (line 95), whose implementation diverged to Buffer — so the stream members are built from scratch, aligned with SPEC-045i's original intent rather than completing a shipped member. Buffer methods remain unchanged. `@aws-sdk/lib-storage` becomes a dependency of `storage-s3` only.

The scheduler is **consumed, not modified** — no queue-contract changes anywhere in this spec.

### Module boundaries and coupling

| Touchpoint | Mechanism | Glue owner | Absent-peer behavior |
|------------|-----------|------------|----------------------|
| backups → scheduler (scheduled triggers) | Soft-optional DI resolve of `schedulerService` in `try/catch` from `setup.ts` `seedDefaults`; idempotent stable-id `register()` upsert of system-scope schedules with `targetType: 'queue'` — converges to one row regardless of how many times seeding runs (pattern: `communication_channels/setup.ts:87-131`, system-scope precedent: `ai_assistant/setup.ts`) | `backups` | No scheduled backups; CLI and manual trigger still work; status page shows "no schedule registered" warning |
| data_erasure → backups (erasure manifest write) | Soft-optional DI resolve of `erasureManifestService` (registered by `backups`) in `try/catch` at execution time; the restore-side diff lives entirely inside `backups` | `data_erasure` (optional consumer) | Erasure completes with a log line that the manifest was skipped (without `backups` there are no restores to guard); a restore with `data_erasure` inactive prints the re-run list with a warning |
| data_erasure → customers (person hard-delete) | Command bus: existing `customers.people.delete` (already hard-delete with cascades), invoked with `metadata { skipLog: true }` | `data_erasure` | Erasure request for `customers:person` fails with a clear error if customers module is disabled |
| data_erasure → auth (user hard-delete) | Command bus: single `auth.users.delete` call with `metadata { skipLog: true }` — it already hard-deletes the user row and cascades UserAcl/UserRole/Session/PasswordReset, and emits `auth.user.deleted` | `data_erasure` | Same pattern |
| data_erasure → other modules (module-owned PII purge) | **Generic OSS-level erasure event** (proposed id `privacy.subject.erased`; payload subjectKind/subjectId/tenantId/organizationId — no PII), declared in core and emitted by `data_erasure` (and by future OSS anonymizers — precedent direction: `forms.submission.anonymized`, crm-call-transcriptions right-to-forget); core modules subscribe to the OSS event and report completion via `privacy.subject.purged` | Each subscribing module | Modules without a subscriber keep their own data lifecycle; documented extension contract |
| data_erasure → query index (per-subject cleanup) | Per-id index **delete events** emitted for each erased entity (pattern: `customers/commands/shared.ts:304`) — NOT `purgeIndexScope`, which clears an entire entity-type × tenant/org scope and would wipe the whole organization's index | `data_erasure` | N/A (query_index is core) |

**Layering ruling (rev 5):** OSS core source must NOT name an enterprise-only event id — a core subscriber bound to `data_erasure.request.executed` would be dead code in every OSS build and would couple OSS evolution to an enterprise contract surface. (The isomorphism rule is not the issue: a subscriber never imports, resolves, or hard-requires the emitter.) The chosen resolution is a **generic OSS-level erasure event** (`privacy.subject.erased`, above) declared in core; `data_erasure` emits it, and the core purge subscribers (`audit_logs` — which has no `subscribers/` directory today — and `communication_channels`) bind to that OSS id. The event's exact id and owning core module are settled with maintainers as **Phase 0 Gate B**; the documented fallback is shipping both subscribers inside `data_erasure` with purge via each core module's own commands/APIs. `data_erasure.request.executed` remains an enterprise-internal observability event; cross-module propagation never uses it.

**Completion semantics (rev 5):** the erasure command's `executed` status covers only the **synchronous sweep** (customers/auth deletes via command bus + per-id index delete events). Cross-module purge via subscribers is **eventually consistent**: persistent subscribers are queue-retried, each emits `privacy.subject.purged` (payload: module id + counts, no PII) on completion, and the documented propagation window is bounded by the queue's retry semantics. Purging pre-existing `action_logs` undo snapshots is owned by the `audit_logs` subscriber, not the sweep — single ownership.

No direct cross-module imports; no cross-module ORM relations.

### Commands & Events

- **Command**: `data_erasure.request.execute` — validates subject (existence + tenant/organization scope), writes the ledger entry (`pending`), runs the **synchronous sweep** (delegated deletes + per-id index delete events), marks `executed`, appends the manifest entry (soft-optional `erasureManifestService`), emits `privacy.subject.erased` (generic OSS event) plus the enterprise-internal `data_erasure.request.executed`. **Not undoable — by design.** All delegated delete commands receive `metadata { skipLog: true }` so no fresh PII undo snapshots are written; purging pre-existing `action_logs` snapshots belongs to the `audit_logs` subscriber (see Completion semantics above). For `customers:person` with linked deals the command fails with guidance (list of blocking deal ids) without writing a ledger entry.
- **Events** (`createModuleEvents`; naming follows the `data_sync.run.*` precedent — singular entity, past-tense action):
  - `backups.run.completed`, `backups.run.failed` (payload: runId, sizeBytes, durationMs / errorSummary)
  - `backups.archive.expired` (retention deletion)
  - `backups.restore.completed` (payload: runId or storageKey, restoredAt, pendingErasureCount)
  - `data_erasure.request.executed` (payload: requestId, tenantId, organizationId, subjectKind, subjectId — no PII; enterprise-internal observability only)
  - `privacy.subject.erased` / `privacy.subject.purged` (generic OSS events declared in core — proposed ids, settled at Phase 0 Gate B; the propagation contract for module-owned PII purge)
- Failure events are emitted for workflow/monitoring integrations; v1 ships no cross-tenant notification fan-out (see Design Decisions).

## Data Models

### backup_run (module `backups`)

Instance-scoped operational record. **Deviation callout:** no `tenant_id` / `organization_id` — a physical whole-database archive is inherently cross-tenant. Precedent for instance-scoped entities exists (`FeatureToggle`, `Tenant`); no generator or CI mechanism mandates tenancy columns. Compensating controls: the entity is reachable only through `backups.*`-gated API/UI (granted to superadmin only by default, precedent: `feature_toggles.global.manage`), never through tenant-facing surfaces, and is never wired into the query index (indexing is opt-in via `indexer: { entityType }`, which this entity simply does not declare).

- `id`: uuid PK
- `status`: enum `pending | running | completed | failed | expired | deleted`
- `trigger`: enum `schedule | manual | cli`
- `triggered_by_user_id`: uuid, nullable (manual/API triggers)
- `started_at`, `finished_at`: timestamptz, nullable
- `size_bytes`: bigint, nullable
- `checksum_sha256`: text, nullable (checksum of the encrypted archive)
- `storage_key`: text, nullable
- `pg_dump_version`: text, nullable
- `encryption_key_fingerprint`: text, nullable (SHA-256 of the key, first 16 hex chars — key identification without key exposure; identification only, not a collision-resistant security property)
- `retention_expires_at`: timestamptz, nullable
- `error_message`: text, nullable (sanitized — no connection-string echo)
- `created_at`, `updated_at` (system-managed entity; not user-editable, so the optimistic-locking UI contract does not apply — no edit form exists; background-job rows are explicitly exempt per `packages/core/AGENTS.md`)

Indexes: `(status, created_at)` for the status page; `(retention_expires_at)` partial where status = 'completed' for the retention sweep. Expected cardinality: one row per run — ~365–1100 rows/year; point lookups and short range scans only.

### erasure_request (module `data_erasure`) — the ledger

Tenant-scoped, append-only. Rows are never updated after reaching a terminal status and never deleted (no `deleted_at`). **The ledger stores no plaintext PII**: subjects are referenced by id and a masked display label only, so the ledger itself is not an erasure target and needs no encryption map (justified N/A).

- `id`: uuid PK
- `tenant_id`: uuid, `organization_id`: uuid
- `subject_kind`: enum `customers:person | auth:user` (extensible)
- `subject_id`: uuid
- `subject_label_masked`: text, nullable — human-readable display label masked **at creation** (established privacy-log masking pattern: name reduced to initials + asterisks, email masked like `j***@e******.com`) so the admin UI can show a recognizable row without the ledger ever storing plaintext PII
- `status`: enum `pending | executed | failed` (only allowed transitions: pending→executed, pending→failed; a retry after `failed` inserts a **new** request row for the same subject — the idempotent sweep skips already-deleted rows — never flips a terminal row back to `pending`)
- `requested_by_user_id`: uuid
- `requested_at`, `executed_at`: timestamptz
- `scope_summary`: jsonb — the **synchronous sweep's own** action counts (e.g. `{ "customers": { "people": 1, "activities": 12 } }`); counts only, no PII. Records only what the command itself executed (the log never claims more than was actually done); asynchronous subscriber-side purge is observable via `privacy.subject.purged` events, not this column (persisting per-module receipts is an optional follow-up)
- `created_at`, `updated_at`

Indexes: `(tenant_id, organization_id, created_at)`; `(subject_kind, subject_id)`.

**Erasure manifest:** on the pending→executed transition the entry is also written as one immutable object `data-erasure-manifest/tenant_<id>/<timestamp>_<requestId>.json` (`{ requestId, subjectKind, subjectId, subjectLabelMasked, executedAt }`) in the backup storage target, via the soft-optional `erasureManifestService` registered by `backups`. The manifest is consumed only by the restore-time diff, which produces an operator-reviewed re-run list — it never drives automated deletion, so it carries no integrity machinery (a tampered entry is caught by the operator's confirmation). A failed sweep leaves no manifest entry. Post-restore matching is by `subject_id` (UUIDs are stable across a same-instance restore).

### Validation

All API inputs validated with zod in `data/validators.ts` of each module; TS types via `z.infer`. Erasure execution additionally re-verifies subject existence and tenant/organization scope inside the command (defense in depth against a forged subject id from another tenant).

## API Contracts

All routes export `metadata` with per-method `requireAuth: true` + `requireFeatures`, plus `openApi` definitions. No restore endpoint exists.

### backups (custom routes — justified: instance-scoped entity with no tenant filter and no user-editable form; note `makeCrudRoute` can run instance-wide via `tenantField: null` — precedent `feature_toggles/global` — so this is a pragmatic choice, not a hard constraint)

- `GET /api/backups/runs` — feature `backups.view`. Query: `page`, `pageSize` (≤ 100), `status?`. Keyset pagination on `(created_at, id)`. Response: rows + `nextCursor`.
- `POST /api/backups/runs` — feature `backups.manage`. Triggers a manual backup: creates `backup_run(pending, trigger=manual)`, creates a ProgressJob under the caller's tenant (precedent: `catalog/api/bulk-delete/route.ts:54-56`), enqueues the backup job, returns `{ runId, progressJobId }`. As a custom write route it runs the **current** mutation-guard contract via `runMutationGuards()` (`packages/shared/src/lib/crud/mutation-guard-registry.ts:89`; live consumers: sales quote send/convert, integrations, staff) — the older `validateCrudMutationGuard`/`runCrudMutationGuardAfterSuccess` pair is `@deprecated` (`mutation-guard.ts:61,74`, both markers pointing at `runMutationGuards()`), consistent with `packages/core/AGENTS.md` § API Routes on `develop`.
- `GET /api/backups/status` — feature `backups.view`. Returns `{ lastCompletedAt, lastStatus, freshnessState: 'ok'|'stale'|'never', archiveCount, totalSizeBytes }`. Freshness threshold: `OM_BACKUP_FRESHNESS_HOURS` (default 26). Uncached in v1 (single indexed point query; caching is a non-goal at this row count). This endpoint is the documented target for external uptime monitoring.

Errors: 401/403 per guards; 409 when a `backup_run` row is already in status `running` — single-flight is enforced by DB status (the queue contract has no job-id/dedupe primitive).

### data_erasure

- `GET /api/data_erasure/requests` — feature `data_erasure.view`. Tenant/organization-scoped list (every query filters by `organization_id`), keyset pagination, `pageSize ≤ 100`.
- `POST /api/data_erasure/requests` — feature `data_erasure.manage`. Body: `{ subjectKind, subjectId, confirmation: string }` (zod-validated; `confirmation` must equal the literal subject id — server-side re-check of the typed confirmation). Executes `data_erasure.request.execute` via the command bus; returns the ledger entry, or a 422 with the blocking-deals guidance for persons with linked deals. 404-equivalent minimal error when the subject does not exist in the caller's scope (no cross-tenant existence oracle). Runs `runMutationGuards()`.

## CLI Contracts (module `backups`, shape: `ModuleCli[]` in `cli.ts`)

No enterprise module ships a `cli.ts` today — `backups` is the first; Phase 1 verifies registry discovery (`modules.cli.generated.ts`) early.

- `mercato backups run [--label <text>]` — synchronous backup with progress output; exits non-zero on failure.
- `mercato backups list [--status <s>]` — archive inventory table.
- `mercato backups restore <runId|storageKey> [--target-database-url <url>] [--force] [--encryption-key <base64>]` — downloads, verifies `checksum_sha256`, decrypts (`--encryption-key` overrides the env key for pre-rotation archives; the run row's key fingerprint identifies which key an archive needs), `pg_restore`s. Safety rails: refuses a non-empty target without `--force`; when the target is the live `DATABASE_URL` it requires typing the database name to confirm; prints a maintenance-mode reminder. Afterwards: diffs the erasure manifest against the restored ledger **across all `tenant_<id>` prefixes in the bucket** (a physical restore resurrects every tenant at once) and **prints the erasures to re-execute** (masked labels + request ids), warns if `data_erasure` is inactive, then emits `backups.restore.completed` with `pendingErasureCount`. The restore runbook documents the cross-environment key-material caveat (issue #994): restoring into a different environment requires the same tenant DEKs and archive key.
- `mercato backups verify [runId]` — restores the given (default: latest completed) archive into `OM_BACKUP_VERIFY_DATABASE_URL`, runs sanity checks (pg_restore exit code, row-count spot checks on `users`/`tenants`, migrations table matches source), prints the result and exits non-zero on failure, drops the scratch schema. On-demand in v1; operators can schedule it through the scheduler admin UI.

`pg_dump`/`pg_restore` are invoked with the connection string passed via environment (never argv — keeps credentials out of process lists), version-checked at startup, and `pg_dump_version` is recorded per run. No user-controlled input is interpolated into argv. CI runner images and production containers must provide the client binaries — verified in Phase 6 (this is currently unconfirmed).

## Workers & Scheduling

Two queue workers (standard `workers/*.ts` contract, both idempotent, total added concurrency 2 — within the worker `DB_POOL_MAX` invariant):

| Worker | Queue | Trigger | Concurrency |
|--------|-------|---------|-------------|
| `backup-run` | `backups:run` | scheduler / API / CLI | 1 (single-flight via DB status; CPU/IO heavy) |
| `retention` | `backups:retention` | scheduler | 1 |

**Scheduling** is owned by `@open-mercato/scheduler`: from `setup.ts` `seedDefaults`, `backups` soft-optionally resolves `schedulerService` and upserts (idempotently, by stable schedule id) two system-scope schedules (`scopeType: 'system'` — no tenant, `targetType: 'queue'`) with cron defaults from env: `OM_BACKUP_CRON` (default `0 2 * * *`), retention `0 4 * * *`. Registration pattern: `communication_channels/setup.ts:87-131`. Benefits over a bespoke mechanism: dev gets working schedules through `LocalSchedulerService` (no warn-and-skip path), and the schedules are visible and manageable in the existing scheduler admin UI — where an operator can also add a schedule for `backups verify` if desired. Jobs enqueued by the scheduler inherit the queue defaults (attempts 3, exponential backoff) — acceptable because both workers are idempotent and `backup-run` is single-flight.

Idempotency: `backup-run` no-ops if a run is already `running` (DB-status check); `retention` deletes archives where `retention_expires_at < now` then marks rows `expired`, and sweeps orphaned multipart objects by prefix (re-running is harmless). Retention window: `OM_BACKUP_RETENTION_DAYS`, default 35 — **this number is the documented GDPR upper bound for erased data persisting in archives.**

Backup pipeline: `pg_dump -Fc` stdout → `crypto.createCipheriv('aes-256-gcm')` stream (module-local streaming helper; key = `OM_BACKUP_ENCRYPTION_KEY`, 32-byte base64; format `v1:iv:…ciphertext…:tag` framing) → SHA-256 tee → `uploadStream` into namespace `backups` with `scope: null` (instance-level; the driver's org/tenant key segments fall back to their shared form). Peak memory is bounded by stream chunk size regardless of database size.

Storage target configuration (env-only): `OM_BACKUP_S3_BUCKET/_REGION/_ENDPOINT/_ACCESS_KEY_ID/_SECRET_ACCESS_KEY` (or ambient IAM), consumed by a module-owned `createStorageService()` instance. Deliberately separate from tenant file storage: different credentials, different lifecycle, and immune to tenant-level reconfiguration.

## GDPR erasure durability: one guarantee, one control (normative)

The word **guarantee** attaches only to properties that hold unconditionally — a DPO may quote this section to a regulator. Operator-dependent procedures are **controls** with documented residual risk.

1. **Live erasure (synchronous scope)**: `data_erasure.request.execute` hard-deletes the subject in the sweep's own scope (customers/auth via command bus, `skipLog`, per-id search-index delete events), writes the ledger entry, and appends the manifest entry. Cross-module purge (`audit_logs` PII snapshots, `communication_channels` connection rows + subject-authored messages) propagates **eventually** via queue-retried persistent subscribers, each confirming with `privacy.subject.purged`; the propagation window is bounded by the queue's retry semantics and documented.
2. **The guarantee — archive aging**: archives are immutable; every archive containing pre-erasure data is deleted by the retention worker no later than `OM_BACKUP_RETENTION_DAYS` after creation. Unconditional, mechanical, independent of operator behavior. This is the only property the DPO-facing statement promises.
3. **The control — guided re-application on restore**: any restore performed via the tooling ends with a manifest-vs-ledger diff across all tenant prefixes; the CLI lists the erasures executed after the archive was taken (masked labels + request ids) and the runbook makes re-executing them a mandatory step before the instance returns to service. Re-execution is idempotent (already-absent subjects are skipped) and matches by `subject_id`. Operator-dependent — a raw `pg_restore` bypasses it (residual risk, documented below).
4. **Precondition (escrowed, documented)**: the archive encryption key — including post-rotation retention of old keys until their archives age out (`--encryption-key` on restore).
5. **Documentation duty**: the ops docs page (Phase 6) states the retention window, the re-run procedure, and the precondition so operators can answer DPO/authority questions with an accurate technical description — including the market comparison (published backup-retention windows across surveyed products range from ~30 days to 12 months; none offers any post-restore re-application): the 35-day retention bound matches the tightest cited window, and the guided re-run is a post-restore control no surveyed product offers.

Residual gap (documented, accepted): a restore performed by hand with raw `pg_restore`, bypassing the CLI, skips the diff. Mitigation: docs mark the CLI as the only supported restore path; the manifest objects are plain JSON, so the diff can also be reconstructed manually from the bucket.

## Security Considerations

- Archive encryption: AES-256-GCM with an instance key from env; key fingerprint recorded per run; the key never appears in logs, API responses, `backup_run` rows, or the archive itself. Key rotation procedure documented: set the new key, keep the old key escrowed until its archives age out, and pass it explicitly (`--encryption-key`) when restoring a pre-rotation archive — the run row's fingerprint identifies which key an archive needs. No in-app multi-key slot in v1.
- Losing the key = losing the backups. The status page shows the active key fingerprint; docs state the key must be escrowed separately from the database host.
- Restore endpoint does not exist over HTTP; erasure POST requires feature grant + typed confirmation re-checked server-side.
- Manifest entries are plain JSON that only ever produce an operator-reviewed re-run list — a tampered entry cannot trigger automated deletion; the operator's per-subject confirmation is the integrity boundary.
- Erasure minimality: the ledger stores ids and masked labels, never plaintext names/emails — an erasure audit trail that is not itself a PII store.
- No PII resurrection: delegated deletes carry `skipLog: true`; pre-existing undo snapshots for the subject are purged; the E2E test asserts `action_logs` contains no fresh subject snapshot after erasure.
- Tenant isolation: `data_erasure` queries always filter by `tenant_id` + `organization_id`; subject resolution refuses ids outside the caller's scope with a minimal error. `backup_run` is superadmin-only by ACL (see deviation callout).
- Secrets hygiene: connection strings via env to child processes; `error_message` on `backup_run` is sanitized (no connection-string echo from pg_dump stderr).

## Failure Scenarios

| Scenario | Behavior |
|----------|----------|
| `pg_dump` exits non-zero / binary missing | Run marked `failed` with sanitized stderr excerpt; `backups.run.failed` event emitted; freshness state degrades to `stale` on the status page (external uptime check catches it) |
| S3 upload interrupted | Multipart upload aborted; run `failed`; partial objects cleaned by the retention worker (orphan sweep by prefix) |
| Backup overlaps previous run | Single-flight: second job sees a `running` row and no-ops with a log line |
| Scheduler module absent/disabled | No scheduled backups; boot logs a warning; status page shows "no schedule registered"; CLI and manual trigger unaffected; docs recommend an external uptime check on `/api/backups/status` |
| Archive corrupt (checksum mismatch on restore/verify) | Restore refuses before touching the target; `backups verify` prints the failure and exits non-zero |
| Erasure requested for a person with linked deals | Command fails with guidance (blocking deal ids); no ledger entry written; operator resolves deals and retries |
| Erasure sweep fails mid-way | Ledger entry stays `pending`→`failed` with the sweep's progress in `scope_summary`; retry inserts a new request row (idempotent: already-deleted rows are skipped); no manifest entry until `executed` |
| Purge subscriber fails after `executed` | Persistent subscriber retried by the queue; a missing `privacy.subject.purged` for a module is the operational signal; unresolved failures surface in queue ops within the documented propagation window |
| Manifest unreachable during restore | CLI warns loudly and completes the restore; runbook: re-run the diff once storage is back (manifest objects are plain JSON, listable by prefix) |
| Re-run list contains a subject whose module is disabled | Printed list marks the entry; operator resolves module activation and re-executes |
| Worker process down for days | Freshness alert on status page + external uptime check; CLI `backups run` always available |

## Phasing & Implementation Plan

Each phase ends with a working application (`yarn generate && yarn typecheck && yarn test && yarn build:app` green). Estimated ~31 atomic commits total: ~24 enterprise, ~7 core-side (storage streaming ×3, purge subscribers ×2, MinIO test harness ×1, docs ×1) — all core commits are ADDITIVE-ONLY contract changes on published packages. (Rev 4 descoped ~8 enterprise commits: automated replay machinery, verification worker + status tracking, superadmin notification resolver, key-rotation slot.)

### Phase 0 — Go/no-go gates (no Phase 1 code before these)
- **Gate A (hard, technical):** verify `pg_dump`/`pg_restore` presence and version compatibility on CI runner images and production containers. Minutes to check; invalidates the entire physical-backup approach if it fails — do not write `backupService` before this passes.
- **Gate B (decision-latency de-risk):** settle with maintainers the shape and owning core module of the generic OSS erasure events (`privacy.subject.erased` / `privacy.subject.purged`) — or fall back to subscribers inside `data_erasure`. The answer must be in hand before Phase 5 step 13, even though the code lands then.

### Phase 1 — Backup core path
1. Scaffold `packages/enterprise/src/modules/backups/` (index/acl/setup/di/events, i18n en+de+es+pl); register in **both** registration points — `enterprisePackage.modules` in `packages/enterprise/src/index.ts` (note: currently drifted, missing `system_status_overlays`; fix the drift in the same commit) and `apps/mercato/src/modules.ts` behind `OM_ENABLE_ENTERPRISE_MODULES` (+ `OM_ENABLE_ENTERPRISE_MODULES_BACKUPS`). Include a stub `cli.ts` and verify CLI registry discovery immediately (first enterprise module with a CLI). → verify: module loads, features sync, CLI command listed.
2. `backup_run` entity + module migration + snapshot. → verify: `yarn db:generate` output reviewed.
3. Additive **optional** `uploadStream`/`downloadStream` on `packages/storage-s3` (+ `@aws-sdk/lib-storage` dep; unit tests with mocked SDK). → verify: existing storage tests untouched and green.
4. `backupService` (pg_dump → cipher stream → checksum → upload via module-owned `createStorageService()` from `OM_BACKUP_S3_*`) + CLI `backups run` / `backups list`. → verify: manual backup against dev DB lands in MinIO/S3, row recorded, unit tests for stream framing.

### Phase 2 — Restore & verification
5. CLI `backups restore` with safety rails (checksum, decrypt, non-empty guard, typed confirmation, `--force`); runbook notes for #994 key-material portability. → verify: scripted round-trip on scratch DB.
6. CLI `backups verify` + scratch-DB sanity checks (on-demand; exits non-zero on failure). → verify: corrupt-archive fixture fails cleanly.

### Phase 3 — Scheduling & retention
7. Schedule registration via `schedulerService.register()` upserts at module boot (system scope, `targetType: 'queue'`, env-driven cron; soft-optional resolve). → verify: schedules appear in the scheduler admin UI; module boots cleanly with scheduler disabled.
8. `backup-run` and `retention` workers + `backups.*` events. → verify: retention deletes expired fixture archive; single-flight test.

### Phase 4 — Admin surface
9. API routes (`GET/POST /api/backups/runs`, `GET /api/backups/status`) with openApi + `runRouteMutationGuards()` + ProgressJob wiring. → verify: route unit tests incl. 403 for non-superadmin and 409 single-flight.
10. Settings page `backend/settings/backups/page.tsx` (+ `page.meta.ts`, `requireFeatures: ['backups.view']`, settings context): freshness `<Alert>`/`<StatusBadge>`, `<DataTable>` inventory (stable `entityId`), "Run backup now" via `useGuardedMutation` + `apiCall`, progress via ProgressTopBar, `<EmptyState>` for no runs; lucide icons; all strings via i18n keys. → verify: DS-guardian pass.

### Phase 5 — data_erasure module
11. Scaffold module; `erasure_request` entity + migration; ledger service (DB write + soft-optional manifest append via `erasureManifestService`, registered in `backups` DI). → verify: write unit tests incl. manifest-skipped path.
12. `data_erasure.request.execute` command: person path (command bus → `customers.people.delete` with `skipLog: true`; deals guard → fail-with-guidance), user path (single `auth.users.delete` with `skipLog: true`), per-id search-index delete events, emission of `privacy.subject.erased` + `data_erasure.request.executed`. → verify: sweep integration test asserts zero subject rows in the sweep's scope AND no fresh PII snapshot in `action_logs`.
13. Generic OSS erasure events + purge subscribers — **core-side commits, per the Phase 0 Gate B decision**: declare `privacy.subject.erased`/`privacy.subject.purged` in the agreed core module; subscribers in `audit_logs` (purge pre-existing PII undo snapshots for the erased subject; module has no `subscribers/` dir today) and `communication_channels` with **v1 scope**: (a) hard-delete of disconnected channel-connection rows — resolves the deferred TODO at `user-deleted-cascade.ts:26-29`; (b) hard-delete of messages **authored by** the subject plus their attachments — the market-anchored scope (leading products purge subject-authored message content and attachments). Each subscriber emits `privacy.subject.purged` on completion. Matching inbound messages by sender address is the documented follow-up (a gap even leading implementations share); messages attached to legally retained business threads follow the future anonymize path. Extension contract documented for third-party modules. Fallback if Gate B lands on (b): both subscribers live inside `data_erasure`, purging via the owning modules' own commands/APIs. → verify: subscriber unit tests incl. authored-message purge, snapshot purge, and `privacy.subject.purged` emission.
14. API routes + settings page (ledger `<DataTable>`, create-request flow with typed confirmation via `useConfirmDialog`, `Cmd/Ctrl+Enter`/`Escape`). → verify: DS pass, 403 tests, 422 deals-guidance test.

### Phase 6 — Guided re-run on restore, test infra & docs
15. Manifest-vs-ledger diff in the restore CLI (printed re-run list with masked labels) + `backups.restore.completed` event with `pendingErasureCount`. → verify: module-decoupling test still green; restore with `data_erasure` inactive prints warning and succeeds.
16. Test infrastructure (core commit): MinIO container in the `packages/cli` integration harness (today it provisions Postgres only — `integration.ts:2972-2973`) + CI-image check for `pg_dump`/`pg_restore` binaries. → verify: harness boots MinIO locally and in CI.
17. End-to-end GDPR integration test: create subject → backup → erase → restore archive → assert the CLI lists the erasure → re-execute → subject absent, no PII snapshots in `action_logs`. Docs: `apps/docs/docs/deployment/backups.mdx` (setup, key escrow + rotation procedure, retention/GDPR statement, restore runbook with the mandatory re-run step and #994 caveat, scheduler admin UI pointer incl. optional verify schedule) + user-guide erasure page. → verify: full suite + docs build.

### Integration test coverage (spec requirement)

- API: `GET/POST /api/backups/runs` (auth, 403, trigger + progress, 409 single-flight), `GET /api/backups/status` (freshness states), `GET/POST /api/data_erasure/requests` (tenant scoping, typed-confirmation rejection, cross-tenant subject refusal, 422 deals guidance).
- UI: backups settings page (inventory render, manual trigger flow, freshness alert), data_erasure settings page (ledger list, create flow with confirmation dialog).
- E2E (CI, dockerized Postgres + MinIO): backup→restore round-trip; erase→backup(pre-erasure archive)→restore→CLI-lists-the-erasure→re-execute-via-API→subject-absent + no-fresh-PII-snapshot + subject-authored messages and attachments gone (the money test for this spec).
- All tests self-contained: fixtures created in setup via API, cleaned in teardown; no reliance on seed data.

## Migration & Backward Compatibility

- New modules and new env vars only; no existing behavior changes when the modules are disabled (default: enterprise flag off).
- The storage-s3 extension is ADDITIVE-ONLY per `BACKWARD_COMPATIBILITY.md`: new interface members are **optional** (published-package rule), existing signatures and semantics untouched. The scheduler and queue packages are consumed as-is — zero contract changes.
- Core-side commits (7): storage streaming (3), purge subscribers (2 — pending maintainer sign-off on the coupling direction), MinIO harness (1), docs (1).
- New DB tables via per-module migrations + snapshots; no changes to existing tables.
- `customers.people.delete`, `auth.users.delete`, and `schedulerService.register()` are consumed as-is; no contract changes.
- Upstream issue hygiene: implementation PR references and closes #117; references #208 and #994.

## Risks & Impact Review

| Risk | Severity | Mitigation | Residual |
|------|----------|------------|----------|
| Backup silently stops (worker dead, schedule never fires) | High | Freshness state on status page + documented external uptime check on `/api/backups/status`; schedules visible in scheduler admin UI; on-demand `backups verify` | Operator without external monitoring notices only on the status page |
| Encryption key lost | High | Loud docs + key fingerprint on status page + escrow guidance incl. post-rotation retention of old keys (`--encryption-key` restore flag) | Key loss irrecoverable by design (that is the security property) |
| Restore executed against live DB by mistake | High | Typed-confirmation rail, non-empty-target guard, `--force` explicitness | Operator with raw `pg_restore` bypasses tooling — documented unsupported |
| Operator skips the post-restore re-run step | Medium | Restore CLI prints the list, exits with a distinct code when `pendingErasureCount > 0`, and the runbook marks the step mandatory | Human-process risk; accepted trade of descoping automated replay |
| Erasure re-creates PII via undo snapshots | High | `skipLog: true` on all delegated deletes + purge of pre-existing snapshots + E2E assertion on `action_logs` | Third-party commands invoked in future extensions must follow the same rule (documented in extension contract) |
| Erasure sweep misses a PII location (new module added later) | Medium | Subscriber extension contract + per-module `scope_summary` visibility; spec for any new PII-bearing module must declare an erasure subscriber | Third-party modules that ignore the contract |
| Maintainer decision on the generic OSS erasure event (shape/owner) delays Phase 5 | Medium | Raised as Phase 0 Gate B, answer in hand before step 13; fallback documented: subscribers live in `data_erasure` and purge via the owning modules' own commands/APIs | Slightly weaker module ownership of purge logic on the fallback path |
| Purge subscriber failure leaves PII beyond the sweep after `executed` | Medium | Queue-retried persistent subscribers; `privacy.subject.purged` per-module confirmation; documented propagation window; ledger never claims more than the sweep did | Eventual consistency is inherent to the event-decoupled design; accepted and documented |
| Manifest tampered with in storage | Low | Entries only produce an operator-reviewed re-run list (never automated deletion); per-subject typed confirmation is the integrity boundary | — |
| pg_dump version drift vs server / missing binaries | Medium | Phase 0 Gate A verifies binaries + versions on CI and production images before any code; version recorded per run; on-demand `backups verify` (operator-schedulable via scheduler UI) catches later drift | — |
| Large DB makes nightly dump heavy | Medium | Streamed pipeline (bounded memory), concurrency 1, off-peak default schedule | Very large instances should layer infra-level PITR (documented) |
| Cross-tenant exposure via instance-level backup surface | High | `backups.*` features granted to superadmin only; no tenant-facing routes; entity never wired into the query index | — |

Blast radius: both modules disabled-by-default behind env flags; the storage extension is dormant unless `uploadStream` is called. Operational detection: events, notifications, status endpoint, scheduler admin UI, CLI exit codes.

## Final Compliance Report — 2026-07-04 (rev 4)

### AGENTS.md Files Reviewed
- `AGENTS.md` (root), `packages/core/AGENTS.md` (routes, ACL, events, setup), `packages/queue/AGENTS.md`, `packages/events/AGENTS.md`, `packages/ui/AGENTS.md` + `packages/ui/src/backend/AGENTS.md`, `packages/shared/AGENTS.md`, `packages/cli/AGENTS.md`, `packages/core/src/modules/progress/AGENTS.md`, `.ai/specs/AGENTS.md`, `BACKWARD_COMPATIBILITY.md` (contract categories), `.ai/ds-rules.md`. Rev 2 additionally cross-checked against the independent gap analysis of PR #3742 (fresh-clone verification, 8 agents).

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| root AGENTS.md | No direct ORM relationships between modules | Compliant | FK ids + command bus + events only |
| root AGENTS.md | Filter by organization_id on scoped entities | Compliant with justified deviation | `erasure_request` fully scoped; `backup_run` is instance-scoped — deviation documented; precedent `FeatureToggle`/`Tenant` |
| root AGENTS.md | Never expose cross-tenant data | Compliant | Backup surfaces superadmin-only; erasure scope re-checked server-side |
| root AGENTS.md | Optimistic locking on new user-editable entities | N/A — justified | Neither entity has an edit form; background-job rows and append-only ledgers are exempt per `packages/core/AGENTS.md` |
| packages/core/AGENTS.md → API Routes | CRUD via `makeCrudRoute`; custom write routes wire the mutation guard contract | Justified deviation / Compliant | Custom routes (instance scope / command-backed create; `tenantField: null` + `feature_toggles/global` noted as the makeCrudRoute alternative); guards via current `runMutationGuards()` (`mutation-guard-registry.ts:89`) |
| packages/core/AGENTS.md → Access Control | Feature-gated declarative guards, immutable feature ids | Compliant | `backups.view/manage`, `data_erasure.view/manage`; `defaultRoleFeatures` superadmin-only for backups (precedent `feature_toggles.global.manage`) |
| packages/core/AGENTS.md → Encryption | PII columns declare encryption maps | N/A — justified | Ledger deliberately stores no plaintext PII (ids + masked display label); archive encryption is stream-level AES-GCM, not field-level |
| packages/queue/AGENTS.md | No custom queues/polling; idempotent workers; metadata export; concurrency budget | Compliant | Queue consumed as-is (no contract changes); scheduling via `@open-mercato/scheduler`; all workers idempotent, Σconcurrency +2 |
| packages/events/AGENTS.md | Cross-module side effects via `createModuleEvents` + subscribers | Compliant | Event ids follow the `data_sync.run.*` precedent; cross-module propagation via generic OSS erasure events (Phase 0 Gate B), never core-subscribing-to-enterprise |
| packages/ui/AGENTS.md + backend | `DataTable`/`useGuardedMutation`/`apiCall`; no raw fetch; DS tokens; dialogs Cmd+Enter/Escape | Compliant | Declared per page in Phase 4/5; DS-guardian gate in plan |
| packages/shared/AGENTS.md | i18n via `useT`/`resolveTranslations`; no hardcoded strings; boolean parsing helpers | Compliant | i18n files in all four locales per module |
| BACKWARD_COMPATIBILITY.md | Contract changes additive; new interface members optional on published packages | Compliant | `uploadStream`/`downloadStream` optional; scheduler/queue untouched |
| .ai/specs/AGENTS.md | Enterprise spec placement + `{date}-{title}.md`; no new `SPEC-ENT-*` prefix | Compliant | This file |
| root AGENTS.md (integration tests) | Spec lists integration coverage for all affected API and key UI paths; tests self-contained | Compliant | See Integration test coverage; MinIO harness commit budgeted |

### Internal Consistency Check

| Check | Status | Notes |
|-------|--------|-------|
| Data models match API contracts | Pass | |
| API contracts match UI section | Pass | |
| Risks cover all write operations | Pass | backup create/delete, restore, erasure, post-restore re-run, snapshot purge |
| Commands defined for all mutations | Pass | Erasure via command bus with `skipLog`; backup runs are system jobs recorded as entity rows (not user mutations) |
| Cache strategy covers read APIs | Pass | Explicit no-cache decision with rationale (tiny row counts, indexed point queries) |
| Undo contract addressed | Pass | Erasure explicitly non-undoable with audit ledger + no-fresh-snapshot rule; retention deletion non-undoable by design |

### Non-Compliant Items
None open. Justified deviations documented inline (instance-scoped `backup_run`; custom routes instead of `makeCrudRoute`). One external dependency: maintainer sign-off for core-side purge subscribers (Phase 5 step 13; fallback defined).

### Verdict
**Approved — ready for pre-implementation analysis** (`om-pre-implement-spec`), with Phase 0 gates preceding any code: Gate A (`pg_dump`/`pg_restore` binaries + versions on CI and production images) and Gate B (maintainer decision on the generic OSS erasure events' shape/owner, fallback documented). Pre-implement should additionally confirm: scheduler `register()` upsert semantics for system-scope + queue-target schedules; the E2E test harness (MinIO) design; the DI `storageService` behavior for instance-level (tenant-less) resolution; and the remaining unverified code citations (the `FeatureToggle`/`Tenant` and `feature_toggles.global.manage` precedents, the catalog bulk-delete ProgressJob precedent, `customers/commands/shared.ts:304`, the `packages/cli` Postgres-only harness claim, and the upstream issue numbers).

## Changelog

- 2026-07-02: Skeleton created; Open Questions Q1–Q4 answered by maintainer (phased physical-first backups; ledger + replay-on-restore + bounded retention; minimal sweep + ledger in scope; scheduling decision later superseded — see rev 2).
- 2026-07-02: Full specification written: two-module design (`backups`, `data_erasure`), platform extensions, GDPR guarantee model, six-phase implementation plan, compliance report appended. Shipped as PR #3742.
- 2026-07-04 (rev 5): Applied the findings of an executor+advisor review (Sonnet 5 executor, Opus 4.8 advisor, orchestrator code verification). Corrections: (H4) mutation-guard contract — `runRouteMutationGuards()` does not exist; corrected to `runMutationGuards()` (`mutation-guard-registry.ts:89`); the deprecated pair claim direction was right, and `develop`'s `packages/core/AGENTS.md` already teaches the registry contract (the "stale guide" impression came from reading an older branch); (H0) erasure completion semantics resolved market-style (surveyed products log only executed actions and propagate cross-system purge asynchronously with documented windows): `executed` covers the synchronous sweep only, `scope_summary` records sweep-own counts, cross-module purge is eventually consistent via queue-retried subscribers confirming with `privacy.subject.purged`; snapshot-purge ownership moved to the `audit_logs` subscriber (single ownership); (H5) core-subscribing-to-enterprise ruled out on packaging/layering grounds — propagation via generic OSS erasure events (`privacy.subject.erased`/`privacy.subject.purged`) declared in core, maintainer gate (Phase 0 Gate B) on shape/owner, fallback = subscribers inside `data_erasure`; GDPR section retitled "one guarantee, one control" (guarantee = 35-day retention only; re-run = operator-dependent control; market claim softened); added Phase 0 with Gate A (pg_dump binaries) and Gate B; swept rev-4 edit survivors (diagram worker, HMAC line, Σconcurrency +3→+2, nightly/weekly, weekly-verify mitigation); storage framing corrected (shipped `StorageService` is Buffer-only; stream members are new, per SPEC-045i intent); retry semantics (new row per retry) and multi-tenant restore-diff scope made explicit; "module boot" → `seedDefaults` stable-id upsert; fingerprint clarified as identification-only.
- 2026-07-04 (rev 4): Descoped four above-market clusters after a complexity review (each was beyond every surveyed vendor AND a major complexity driver): (1) automated replay-on-restore → **guided re-run**: plain erasure manifest in the bucket (no HMAC, no blind index, no `hashForLookup` pepper dependency, no `replay-erasures` CLI, no cross-module replay service — `subject_email_hash` and `integrity_hash` columns removed); restore CLI diffs manifest vs restored ledger, prints the re-run list, exits with a distinct code; (2) weekly scratch-DB verification → on-demand `backups verify` CLI only (verification worker, schedule, `verification_status`/`last_verified_at`, and `backups.verification.*` events removed; one-click schedule via scheduler admin UI documented); (3) superadmin cross-tenant notification resolver removed (detection = status page freshness + external uptime check; manual runs keep standard tenant-scoped notification); (4) key-rotation slot `OM_BACKUP_ENCRYPTION_KEY_PREVIOUS` removed (explicit `--encryption-key` restore flag + documented escrow/rotation procedure). Kept above-market but cheap: 35-day retention, CLI-only restore, masked ledger label, `skipLog` hygiene. Commit estimate ~39 → ~31.
- 2026-07-03 (rev 3): Market research on GDPR-erasure practice in leading CRM/ERP products applied to the three open product decisions: (1) persons-with-deals stays fail-with-guidance — the established pattern — with anonymize-in-place named as the market-converged follow-up (#208); (2) ledger stays object-per-entry (no surveyed product has a restore-surviving ledger; PII-free audit logs confirmed as market standard) and gains a `subject_label_masked` display column adopting the established masking pattern; (3) `communication_channels` v1 purge scope expanded from connection-rows-only to also hard-delete subject-authored messages + attachments (established practice), with inbound sender-address matching as the follow-up. Backup-retention market comparison (published windows ~30 days to 12 months) added to the docs duty.
- 2026-07-03 (rev 2): Revised per independent gap analysis of PR #3742 (fresh-clone verification, 8 agents). Major: queue `repeat` extension withdrawn — scheduling now consumes the existing `@open-mercato/scheduler`; erasure command hardened (`skipLog: true` on delegated deletes so erasure cannot write fresh PII undo snapshots; pepper preflight; per-id index delete events instead of scope-wide `purgeIndexScope`; fail-with-guidance for persons with linked deals); superadmin notification targeting rule added (tenant-scoped notification contract); storage path corrected (module-owned `createStorageService()` from `OM_BACKUP_S3_*`, scope `null`, optional interface members completing SPEC-045i); user path simplified (single `auth.users.delete` — already a hard delete) and problem statement corrected accordingly; mutation guards updated to `runRouteMutationGuards()` (previous helpers deprecated); single-flight moved to DB status; ledger stream changed from JSONL-append to object-per-entry (S3 has no append primitive); MinIO test-harness and CI-binaries commits budgeted; core-side purge subscribers flagged for maintainer sign-off with fallback; `communication_channels` v1 purge scope set to connection rows only (content purge = open product decision); upstream references added (#117 close-with-PR, #208, #994, SPEC-045i, scheduler lineage, Terraform playbook differentiation); removed erroneous `DevCloud.md` citation.

### Review — 2026-07-04 (rev 5)
- **Reviewer**: Executor+advisor pattern (Sonnet 5 executor, Opus 4.8 advisor) + orchestrator code verification
- **Security**: Passed (PII-free ledger and events; completion semantics no longer overclaim; guarantee/control split regulator-safe)
- **Performance**: Passed (unchanged)
- **Cache**: Passed (unchanged)
- **Commands**: Passed (single ownership of snapshot purge; retry-as-new-row explicit)
- **Risks**: Passed (Phase 0 gates front-load the two highest-invalidation-power facts; eventual-consistency risk documented)
- **Verdict**: Approved for pre-implement (Phase 0 gates first)

### Review — 2026-07-04 (rev 4)
- **Reviewer**: Agent (complexity review directed by maintainer: "flag where we exceed market standard and it strongly complicates")
- **Security**: Passed (env-only target/key, no HTTP restore, sanitized errors, typed confirmations, no-PII-resurrection rule; manifest integrity boundary = operator confirmation, justified)
- **Performance**: Passed (streamed pipeline, keyset pagination, indexed queries, concurrency 1 for heavy jobs)
- **Cache**: Passed (explicit no-cache decision with rationale)
- **Commands**: Passed (single mutation command; non-undoability justified; `skipLog` + snapshot purge close the PII loop)
- **Risks**: Passed (silent-failure, key-loss, wrong-target-restore, skipped-re-run, PII-resurrection, maintainer-signoff scenarios with mitigations)
- **Verdict**: Approved
