# Automated Database Backups & GDPR Erasure Propagation (Enterprise)

## TLDR
**Key Points:**
- Two new enterprise modules: `backups` (scheduled encrypted physical database backups to object storage, tooled restore, retention, continuous restore verification) and `data_erasure` (tenant-scoped GDPR erasure orchestration with an append-only erasure ledger).
- The GDPR guarantee is two-layered: bounded backup retention (erased data ages out of all archives within a documented window) plus erasure-ledger replay after every restore (a restore from a pre-erasure archive immediately re-applies executed erasures).
- Closes the confirmed operational finding: no automated backup mechanism exists in the codebase today — only manual `pg_dump` instructions in operator docs. De facto implements upstream issue #117 ("unified, GDPR compliant data removal tool").

**Scope:**
- Physical whole-database backups (`pg_dump` custom format), AES-256-GCM-encrypted, streamed to a dedicated env-configured S3 target.
- CLI-first restore and verification tooling; restore is never exposed over HTTP.
- Scheduling through the existing `@open-mercato/scheduler` package (system-scope schedules targeting queue jobs), plus CLI trigger and a superadmin status page.
- Erasure **orchestration** for subject kinds `customers:person` and `auth:user`: the hard-delete primitives already exist (`customers.people.delete`, `auth.users.delete` — both hard-delete with cascades); what is missing and what this spec adds is the ledger, undo-snapshot hygiene, cross-module propagation, search-index cleanup, and replay.
- Retention expiry and weekly automated restore verification into a scratch database.

**Out of scope (future specs):**
- Logical per-tenant export/restore (tenant portability, selective restore into a live database).
- Crypto-shredding (per-data-subject encryption keys) — noted as a hardening direction, not built here.
- Point-in-time recovery (WAL archiving) — operators may layer pgBackRest/WAL-G underneath (see the AWS Terraform playbook's Aurora PITR for the infra-level counterpart); this spec is the app-level mechanism.
- PII anonymization (as opposed to deletion) — tracked upstream as the open half of issue #208; the deals guard below intersects with it.
- Message-content purge in `communication_channels` — explicitly deferred product decision (see Phase 5).

**Concerns:**
- `storage-s3` upload is `Buffer`-only; archives need additive **optional** streaming methods on the driver — framed as completing the SPEC-045i storage-hub interface, which already declares a streaming download.
- Notifications are tenant-scoped by contract (`Notification.tenant_id` non-nullable, `NotificationServiceContext.tenantId` required); an instance-scoped module needs an explicit superadmin targeting rule (defined below).
- S3 has no append primitive; the ledger stream is object-per-entry, not JSONL append.
- The `hashForLookup` pepper and the archive encryption key are both replay/restore preconditions and must be escrowed and documented together.
- The two PII-purge subscribers land in core modules (`audit_logs`, `communication_channels`) listening to an enterprise event — this coupling direction needs maintainer sign-off.

## Overview

Open Mercato instances (self-hosted and DevCloud-managed) currently have no first-class data-recovery capability. This spec gives every enterprise instance an automated, verifiable backup pipeline and makes GDPR Art. 17 erasure durable across restores. The audience is instance operators (superadmins) for backups, and tenant admins/DPOs for erasure requests.

Upstream anchoring: this spec de facto implements open issue **#117** ("unified, GDPR compliant data removal tool") — the implementation PR should reference and close it. Related: **#208** (PI data encryption delivered in PR #223; anonymization half still open), **#994** (per-tenant DEK portability between environments — the restore runbook must cite it), and the scheduler line (issue #407 → PR #444, hardening #2279/#2516/#2625, fix #3716) which this spec consumes instead of duplicating.

> **Market Reference**: Discourse (admin-managed scheduled backups, S3 upload, one-command restore) — adopted the app-orchestrated model with an admin status surface and CLI restore. GitLab backup utility — adopted the strict separation of archive and secrets: the encryption key never travels with the archive, and losing the key means losing the backups, which is documented loudly. pgBackRest/WAL-G — rejected as the in-app mechanism: they are infrastructure-level tools with no application awareness, so they cannot drive erasure replay, retention tied to app policy, or an admin UX; operators can still run them alongside for PITR. No surveyed OSS product implements erasure-replay-on-restore natively; the ledger + replay + bounded-retention model follows EDPB guidance that backup erasure may complete within a documented rotation window provided restores re-apply erasures.

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
| Erasure ledger + replay-on-restore + bounded retention (not crypto-shredding) | Keeps archives immutable and the encryption layer untouched. Accepted compliance posture in the EU. Crypto-shredding would require reworking field encryption to key-per-subject; recorded as a future hardening phase. |
| Ledger is dual-written: DB row + object-per-entry stream in object storage | A restore from a pre-erasure archive would otherwise erase the ledger itself. S3 has no append primitive, so each executed entry becomes one immutable object under a tenant prefix — atomic writes, no read-modify-write races, replay lists the prefix; naturally compatible with S3 Object Lock (WORM) if ever needed. The DB row serves the admin UI and API. |
| Scheduling via the existing `@open-mercato/scheduler` package | The platform already ships a scheduler (issue #407 → PR #444, actively maintained): cron/interval schedules, `system` scope without tenant, sync to BullMQ repeatable, local execution in dev (`LocalSchedulerService`), admin UI, idempotent `register()` upsert — consumed today by `data_sync`, `communication_channels`, `integrations`. Building a queue-level `repeat` primitive would duplicate it. |
| `data_erasure` is a separate module from `backups` | Erasure is a privacy capability independent of backups (it must run even if backups are disabled). `backups` consumes it soft-optionally at restore time; either module functions without the other. |
| Backup target and encryption key are env-only, never DB-configurable | A tenant admin must never be able to redirect instance-wide backups or read the archive key. Instance secrets stay with the operator. The module builds its own storage client via the exported `createStorageService()` from `OM_BACKUP_S3_*` env — it MUST NOT resolve the DI `storageService`, which is the per-tenant Integration Marketplace credentials wrapper and would throw for instance-level jobs. |
| Restore is CLI-only | Restoring a whole database over an HTTP endpoint is an unacceptable attack surface. The CLI runs with operator credentials on the host. |
| Erasure is deliberately not undoable — and must not create PII while deleting it | GDPR requires irreversibility. The ledger (with HMAC integrity hashes) is the audit record. Delegated deletes run with command-bus `metadata { skipLog: true }` so no fresh undo snapshot containing the subject's PII is written to `action_logs` (`command-bus.ts:511`); the sweep additionally purges pre-existing snapshots referencing the subject. Explicit, justified exception to the undoability default. |
| Persons with linked deals: fail-with-guidance | `customers.people.delete` refuses to delete a person with linked deals (`people.ts:1232-1236`). The erasure command surfaces this as a clear, actionable error listing the blocking deals — deals are business records with their own retention obligations, so the sweep must not silently unlink or mutate them. Anonymize-instead-of-delete is the #208-adjacent future path. |
| Superadmin notification targeting rule | `Notification.tenant_id` is non-nullable and recipient resolvers filter by tenant, so an instance-scoped failure has no default addressee. Rule: on `backups.run.failed` / `backups.verification.failed`, a module-local resolver enumerates super-admin users and creates one notification per user **in that user's own tenant context**. |

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
- An **instance operator** wants **continuous proof that restore works** (weekly scratch-DB verification) so that backups are not discovered to be corrupt at the worst moment.
- A **superadmin** wants **a status page showing backup freshness, inventory, and verification results** so that a silently failing pipeline is visible.
- A **tenant admin / DPO** wants **to execute an erasure request for a person or user** so that GDPR Art. 17 obligations are met with an auditable record.
- A **DPO** wants **erasure to survive a database restore** so that restoring last week's backup does not resurrect erased personal data.

## Architecture

```
 @open-mercato/scheduler          ┌─────────────────────────────────────────────────┐
 (system-scope schedules,  ─────▶ │ backups module (enterprise)                     │
  targetType 'queue')             │  workers: backup-run / retention / verification │
  CLI trigger ──────────────────▶ │  lib: backupService (pg_dump→AES-GCM→S3 stream) │
  admin POST ───────────────────▶ │  entity: backup_run          events: backups.*  │
                                  │  CLI: run/list/restore/verify/replay-erasures   │
                                  └───────────────┬─────────────────────────────────┘
                                                  │ restore completed:
                                                  │  1) soft-optional resolve (try/catch)
                                                  │     erasureReplayService — inline replay
                                                  │  2) emit backups.restore.completed
                                                  ▼
                                  ┌─────────────────────────────────────────────────┐
                                  │ data_erasure module (enterprise)                │
                                  │  entity: erasure_request (ledger, tenant-scoped)│
                                  │  dual-write: DB row + S3 object-per-entry       │
                                  │  command: data_erasure.request.execute          │
                                  │  event: data_erasure.request.executed ──────────┼──▶ subscribers in
                                  └─────────────────────────────────────────────────┘    audit_logs,
                                                                                          communication_channels
                                                                                          (core-side commits),
                                                                                          3rd-party modules
```

### Platform extension (additive, OSS-side)

**Streaming storage upload** (`packages/storage-s3`): `StorageService` gains **optional** members `uploadStream(input: { namespace, fileName, stream: Readable, contentType?, scope })` backed by `@aws-sdk/lib-storage` multipart `Upload`, and `downloadStream(input: { key, scope }): Promise<Readable>`. Optional-member form is required by `BACKWARD_COMPATIBILITY.md` for a published-package interface. This completes the SPEC-045i storage-hub contract, whose interface already declares a streaming `download(): Promise<ReadableStream>` that the current driver buffers (`s3-driver.ts:52-57,119`). Buffer methods remain unchanged. `@aws-sdk/lib-storage` becomes a dependency of `storage-s3` only.

The scheduler is **consumed, not modified** — no queue-contract changes anywhere in this spec.

### Module boundaries and coupling

| Touchpoint | Mechanism | Glue owner | Absent-peer behavior |
|------------|-----------|------------|----------------------|
| backups → scheduler (nightly/weekly triggers) | Soft-optional DI resolve of `schedulerService` in `try/catch` at module boot; idempotent `register()` upsert of system-scope schedules with `targetType: 'queue'` (registration pattern: `communication_channels/setup.ts:87-131`) | `backups` | No scheduled backups; CLI and manual trigger still work; status page shows "no schedule registered" warning |
| backups → data_erasure (replay at restore) | Soft-optional DI resolve in `try/catch` (`erasureReplayService`) + `backups.restore.completed` event | `backups` (optional consumer) | Restore completes; CLI prints a prominent warning that erasure replay was skipped; event still emitted |
| data_erasure → customers (person hard-delete) | Command bus: existing `customers.people.delete` (already hard-delete with cascades), invoked with `metadata { skipLog: true }` | `data_erasure` | Erasure request for `customers:person` fails with a clear error if customers module is disabled |
| data_erasure → auth (user hard-delete) | Command bus: single `auth.users.delete` call with `metadata { skipLog: true }` — it already hard-deletes the user row and cascades UserAcl/UserRole/Session/PasswordReset, and emits `auth.user.deleted` | `data_erasure` | Same pattern |
| data_erasure → other modules (module-owned PII purge) | Event `data_erasure.request.executed` with persistent subscribers (same propagation pattern as `forms.submission.anonymized` and the crm-call-transcriptions right-to-forget) | Each subscribing module | Modules without a subscriber keep their own data lifecycle; documented extension contract |
| data_erasure → query index (per-subject cleanup) | Per-id index **delete events** emitted for each erased entity (pattern: `customers/commands/shared.ts:304`) — NOT `purgeIndexScope`, which clears an entire entity-type × tenant/org scope and would wipe the whole organization's index | `data_erasure` | N/A (query_index is core) |
| backups → notifications (failure alerts) | Module-local superadmin resolver + one notification per super-admin in their own tenant context (see Design Decisions) | `backups` | — |

The two purge subscribers (`audit_logs`, `communication_channels`) are **core-module commits listening to an enterprise event**. `audit_logs` has no `subscribers/` directory today. This coupling direction (core reacting to enterprise) requires explicit maintainer sign-off before implementation; the fallback is shipping both subscribers inside `data_erasure` with cross-module purge via each module's own commands/APIs where available.

No direct cross-module imports; no cross-module ORM relations.

### Commands & Events

- **Command**: `data_erasure.request.execute` — validates subject (existence + tenant/organization scope), verifies the `hashForLookup` pepper is configured (preflight; refuses to execute otherwise — see Security), dual-writes the ledger entry (`pending`), runs the sweep, marks `executed`, emits the event. **Not undoable — by design.** All delegated delete commands receive `metadata { skipLog: true }`; the sweep also purges pre-existing `action_logs` undo snapshots referencing the subject. For `customers:person` with linked deals the command fails with guidance (list of blocking deal ids) without writing a ledger entry.
- **Events** (`createModuleEvents`; naming follows the `data_sync.run.*` precedent — singular entity, past-tense action):
  - `backups.run.completed`, `backups.run.failed` (payload: runId, sizeBytes, durationMs / errorSummary)
  - `backups.archive.expired` (retention deletion)
  - `backups.restore.completed` (payload: runId or storageKey, restoredAt, replayPerformed: boolean)
  - `backups.verification.completed`, `backups.verification.failed`
  - `data_erasure.request.executed` (payload: requestId, tenantId, organizationId, subjectKind, subjectId — no PII)
  - `data_erasure.replay.completed` (payload: replayedCount, skippedCount, source: 'restore' | 'manual')
- Failure events feed notifications via the superadmin targeting rule.

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
- `encryption_key_fingerprint`: text, nullable (SHA-256 of the key, first 16 hex chars — key identification without key exposure)
- `retention_expires_at`: timestamptz, nullable
- `last_verified_at`: timestamptz, nullable; `verification_status`: enum `unverified | passed | failed`
- `error_message`: text, nullable (sanitized — no connection-string echo)
- `created_at`, `updated_at` (system-managed entity; not user-editable, so the optimistic-locking UI contract does not apply — no edit form exists; background-job rows are explicitly exempt per `packages/core/AGENTS.md`)

Indexes: `(status, created_at)` for the status page; `(retention_expires_at)` partial where status = 'completed' for the retention sweep. Expected cardinality: one row per run — ~365–1100 rows/year; point lookups and short range scans only.

### erasure_request (module `data_erasure`) — the ledger

Tenant-scoped, append-only. Rows are never updated after reaching a terminal status and never deleted (no `deleted_at`). **The ledger stores no plaintext PII**: subjects are referenced by id and blind-index hash only, so the ledger itself is not an erasure target and needs no encryption map (justified N/A). The blind index depends on the `hashForLookup` pepper being configured — see Security.

- `id`: uuid PK
- `tenant_id`: uuid, `organization_id`: uuid
- `subject_kind`: enum `customers:person | auth:user` (extensible)
- `subject_id`: uuid
- `subject_email_hash`: text, nullable — blind index via existing `hashForLookup`; enables post-restore matching if ids ever diverge
- `status`: enum `pending | executed | failed` (only allowed transitions: pending→executed, pending→failed)
- `requested_by_user_id`: uuid
- `requested_at`, `executed_at`: timestamptz
- `scope_summary`: jsonb — per-module deletion counts (e.g. `{ "customers": { "people": 1, "activities": 12 }, "audit_logs": { "snapshots_purged": 4 } }`); counts only, no PII
- `integrity_hash`: text — HMAC-SHA256 over the canonical entry fields; reuse the **pattern** from `auth/lib/consentIntegrity.ts` (`computeConsentIntegrityHash` / timing-safe verify), not the function itself — it is typed for consents; the module ships its own equivalent
- `created_at`, `updated_at`

Indexes: `(tenant_id, organization_id, created_at)`; `(subject_kind, subject_id)`.

**Object-storage ledger stream:** every executed entry is also written as one immutable object `data-erasure-ledger/tenant_<id>/<timestamp>_<requestId>.json` (entry fields + `integrity_hash`) in the backup storage target. Replay lists the tenant prefix and reads each object — never the restored database — as the authoritative list. Writes happen only on the pending→executed transition, so a failed sweep leaves no stream entry.

### Validation

All API inputs validated with zod in `data/validators.ts` of each module; TS types via `z.infer`. Erasure execution additionally re-verifies subject existence and tenant/organization scope inside the command (defense in depth against a forged subject id from another tenant).

## API Contracts

All routes export `metadata` with per-method `requireAuth: true` + `requireFeatures`, plus `openApi` definitions. No restore endpoint exists.

### backups (custom routes — justified: instance-scoped entity with no tenant filter and no user-editable form; note `makeCrudRoute` can run instance-wide via `tenantField: null` — precedent `feature_toggles/global` — so this is a pragmatic choice, not a hard constraint)

- `GET /api/backups/runs` — feature `backups.view`. Query: `page`, `pageSize` (≤ 100), `status?`. Keyset pagination on `(created_at, id)`. Response: rows + `nextCursor`.
- `POST /api/backups/runs` — feature `backups.manage`. Triggers a manual backup: creates `backup_run(pending, trigger=manual)`, creates a ProgressJob under the caller's tenant (precedent: `catalog/api/bulk-delete/route.ts:54-56`), enqueues the backup job, returns `{ runId, progressJobId }`. As a custom write route it runs the **current** mutation-guard contract via `runRouteMutationGuards()` (`route-mutation-guard.ts:116`) — the older `validateCrudMutationGuard`/`runCrudMutationGuardAfterSuccess` pair is `@deprecated` and bypasses registry guards.
- `GET /api/backups/status` — feature `backups.view`. Returns `{ lastCompletedAt, lastStatus, freshnessState: 'ok'|'stale'|'never', archiveCount, totalSizeBytes, lastVerification }`. Freshness threshold: `OM_BACKUP_FRESHNESS_HOURS` (default 26). Uncached in v1 (single indexed point query; caching is a non-goal at this row count).

Errors: 401/403 per guards; 409 when a `backup_run` row is already in status `running` — single-flight is enforced by DB status (the queue contract has no job-id/dedupe primitive).

### data_erasure

- `GET /api/data_erasure/requests` — feature `data_erasure.view`. Tenant/organization-scoped list (every query filters by `organization_id`), keyset pagination, `pageSize ≤ 100`.
- `POST /api/data_erasure/requests` — feature `data_erasure.manage`. Body: `{ subjectKind, subjectId, confirmation: string }` (zod-validated; `confirmation` must equal the literal subject id — server-side re-check of the typed confirmation). Executes `data_erasure.request.execute` via the command bus; returns the ledger entry, or a 422 with the blocking-deals guidance for persons with linked deals. 404-equivalent minimal error when the subject does not exist in the caller's scope (no cross-tenant existence oracle). Runs `runRouteMutationGuards()`.

## CLI Contracts (module `backups`, shape: `ModuleCli[]` in `cli.ts`)

No enterprise module ships a `cli.ts` today — `backups` is the first; Phase 1 verifies registry discovery (`modules.cli.generated.ts`) early.

- `mercato backups run [--label <text>]` — synchronous backup with progress output; exits non-zero on failure.
- `mercato backups list [--status <s>]` — archive inventory table.
- `mercato backups restore <runId|storageKey> [--target-database-url <url>] [--force] [--skip-erasure-replay]` — downloads, verifies `checksum_sha256`, decrypts, `pg_restore`s. Safety rails: refuses a non-empty target without `--force`; when the target is the live `DATABASE_URL` it requires typing the database name to confirm; prints a maintenance-mode reminder. Afterwards: soft-optional erasure replay (see Architecture), then emits `backups.restore.completed`. `--skip-erasure-replay` exists for scratch/forensic restores and prints a compliance warning. The restore runbook documents the cross-environment key-material caveat (issue #994): restoring into a different environment requires the same tenant DEKs, `hashForLookup` pepper, and archive key.
- `mercato backups verify [runId]` — restores the given (default: latest completed) archive into `OM_BACKUP_VERIFY_DATABASE_URL`, runs sanity checks (pg_restore exit code, row-count spot checks on `users`/`tenants`, migrations table matches source), records the result on `backup_run`, drops the scratch schema.
- `mercato backups replay-erasures [--tenant <id>] [--verify-only]` — standalone ledger replay (idempotent; skips subjects already absent); `--verify-only` validates the stream's integrity hashes without applying.

`pg_dump`/`pg_restore` are invoked with the connection string passed via environment (never argv — keeps credentials out of process lists), version-checked at startup, and `pg_dump_version` is recorded per run. No user-controlled input is interpolated into argv. CI runner images and production containers must provide the client binaries — verified in Phase 6 (this is currently unconfirmed).

## Workers & Scheduling

Three queue workers (standard `workers/*.ts` contract, all idempotent, total added concurrency 3 — within the worker `DB_POOL_MAX` invariant):

| Worker | Queue | Trigger | Concurrency |
|--------|-------|---------|-------------|
| `backup-run` | `backups:run` | scheduler / API / CLI | 1 (single-flight via DB status; CPU/IO heavy) |
| `retention` | `backups:retention` | scheduler | 1 |
| `verification` | `backups:verification` | scheduler | 1 |

**Scheduling** is owned by `@open-mercato/scheduler`: at module boot, `backups` soft-optionally resolves `schedulerService` and upserts three system-scope schedules (`scopeType: 'system'` — no tenant, `targetType: 'queue'`) with cron defaults from env: `OM_BACKUP_CRON` (default `0 2 * * *`), retention `0 4 * * *`, `OM_BACKUP_VERIFY_CRON` (default `0 5 * * 0`). Registration pattern: `communication_channels/setup.ts:87-131`. Benefits over a bespoke mechanism: dev gets working schedules through `LocalSchedulerService` (no warn-and-skip path), and the schedules are visible and manageable in the existing scheduler admin UI. Jobs enqueued by the scheduler inherit the queue defaults (attempts 3, exponential backoff) — acceptable because every worker is idempotent and `backup-run` is single-flight.

Idempotency: `backup-run` no-ops if a run is already `running` (DB-status check); `retention` deletes archives where `retention_expires_at < now` then marks rows `expired`, and sweeps orphaned multipart objects by prefix (re-running is harmless); `verification` records results keyed by runId. Retention window: `OM_BACKUP_RETENTION_DAYS`, default 35 — **this number is the documented GDPR upper bound for erased data persisting in archives.**

Backup pipeline: `pg_dump -Fc` stdout → `crypto.createCipheriv('aes-256-gcm')` stream (module-local streaming helper; key = `OM_BACKUP_ENCRYPTION_KEY`, 32-byte base64; format `v1:iv:…ciphertext…:tag` framing) → SHA-256 tee → `uploadStream` into namespace `backups` with `scope: null` (instance-level; the driver's org/tenant key segments fall back to their shared form). Peak memory is bounded by stream chunk size regardless of database size.

Storage target configuration (env-only): `OM_BACKUP_S3_BUCKET/_REGION/_ENDPOINT/_ACCESS_KEY_ID/_SECRET_ACCESS_KEY` (or ambient IAM), consumed by a module-owned `createStorageService()` instance. Deliberately separate from tenant file storage: different credentials, different lifecycle, and immune to tenant-level reconfiguration.

## The GDPR Guarantee (normative)

1. **Live erasure**: `data_erasure.request.execute` hard-deletes the subject across modules (sweep with `skipLog` + subscriber contract + per-id search-index delete events + undo-snapshot purge) and writes the ledger entry to DB and object storage.
2. **Archive aging**: archives are immutable; every archive containing pre-erasure data is deleted by the retention worker no later than `OM_BACKUP_RETENTION_DAYS` after creation. Erasure requests therefore fully propagate to all backups within the retention window.
3. **Restore re-application**: any restore performed via the tooling replays the object-storage ledger before the instance returns to service; erased subjects present in the archive are re-erased. Replay is idempotent and matches by `subject_id` (with `subject_email_hash` as a secondary check).
4. **Preconditions (documented together, escrowed together)**: the archive encryption key AND the `hashForLookup` pepper. Without the pepper the blind index degrades to unkeyed SHA-256 (dictionary-attackable, weakening the "ledger holds no PII" property), and a restored instance with a different pepper cannot match hashes. The erasure command preflight-refuses to run without a configured pepper.
5. **Documentation duty**: the ops docs page (Phase 6) states the retention window, the replay behavior, and the preconditions so operators can answer DPO/authority questions with an accurate technical description.

Residual gap (documented, accepted): a restore performed by hand with raw `pg_restore`, bypassing the CLI, skips replay. Mitigation: docs mark the CLI as the only supported restore path, and `replay-erasures` exists as a standalone recovery step.

## Security Considerations

- Archive encryption: AES-256-GCM with an instance key from env; key fingerprint recorded per run; the key never appears in logs, API responses, `backup_run` rows, or the archive itself. Key rotation procedure documented: set new key, old archives remain decryptable via `OM_BACKUP_ENCRYPTION_KEY_PREVIOUS` (checked by fingerprint) until they age out.
- Losing the key = losing the backups. The status page shows the active key fingerprint; docs state the key must be escrowed separately from the database host (GitLab-style warning) — together with the `hashForLookup` pepper (see GDPR preconditions).
- Restore endpoint does not exist over HTTP; erasure POST requires feature grant + typed confirmation re-checked server-side.
- Ledger integrity: per-entry HMAC (module-local implementation of the `consentIntegrity` pattern); `replay-erasures --verify-only` validates the stream before applying.
- Erasure minimality: the ledger stores ids and blind-index hashes, never names/emails — an erasure audit trail that is not itself a PII store (conditional on the pepper, see above).
- No PII resurrection: delegated deletes carry `skipLog: true`; pre-existing undo snapshots for the subject are purged; the E2E test asserts `action_logs` contains no fresh subject snapshot after erasure.
- Tenant isolation: `data_erasure` queries always filter by `tenant_id` + `organization_id`; subject resolution refuses ids outside the caller's scope with a minimal error. `backup_run` is superadmin-only by ACL (see deviation callout).
- Secrets hygiene: connection strings via env to child processes; `error_message` on `backup_run` is sanitized (no connection-string echo from pg_dump stderr).

## Failure Scenarios

| Scenario | Behavior |
|----------|----------|
| `pg_dump` exits non-zero / binary missing | Run marked `failed` with sanitized stderr excerpt; `backups.run.failed` event → superadmin notifications (per targeting rule); freshness state degrades to `stale` on the status page |
| S3 upload interrupted | Multipart upload aborted; run `failed`; partial objects cleaned by the retention worker (orphan sweep by prefix) |
| Backup overlaps previous run | Single-flight: second job sees a `running` row and no-ops with a log line |
| Scheduler module absent/disabled | No scheduled backups; boot logs a warning; status page shows "no schedule registered"; CLI and manual trigger unaffected; docs recommend an external uptime check on `/api/backups/status` |
| Archive corrupt (checksum mismatch on restore/verify) | Restore refuses before touching the target; verification marks `verification_status=failed` → notification |
| Erasure requested for a person with linked deals | Command fails with guidance (blocking deal ids); no ledger entry written; operator resolves deals and retries |
| Erasure sweep fails mid-way | Ledger entry stays `pending`→`failed` with per-module progress in `scope_summary`; command is re-runnable (idempotent: already-deleted rows are skipped); no object-storage entry until `executed` |
| Replay finds a subject the sweep cannot delete (e.g. module disabled) | Replay records `skippedCount`, emits `data_erasure.replay.completed` with details, CLI exits non-zero so the operator sees it |
| Pepper missing / mismatched after restore | Erasure command preflight-refuses (missing); replay falls back to `subject_id` matching and reports hash-verification failures (mismatch) |
| Worker process down for days | Freshness alert on status page + notification; CLI `backups run` always available |

## Phasing & Implementation Plan

Each phase ends with a working application (`yarn generate && yarn typecheck && yarn test && yarn build:app` green). Estimated ~39 atomic commits total: ~32 enterprise, ~7 core-side (storage streaming ×3, purge subscribers ×2, MinIO test harness ×1, docs ×1) — all core commits are ADDITIVE-ONLY contract changes on published packages.

### Phase 1 — Backup core path
1. Scaffold `packages/enterprise/src/modules/backups/` (index/acl/setup/di/events, i18n en+de+es+pl); register in **both** registration points — `enterprisePackage.modules` in `packages/enterprise/src/index.ts` (note: currently drifted, missing `system_status_overlays`; fix the drift in the same commit) and `apps/mercato/src/modules.ts` behind `OM_ENABLE_ENTERPRISE_MODULES` (+ `OM_ENABLE_ENTERPRISE_MODULES_BACKUPS`). Include a stub `cli.ts` and verify CLI registry discovery immediately (first enterprise module with a CLI). → verify: module loads, features sync, CLI command listed.
2. `backup_run` entity + module migration + snapshot. → verify: `yarn db:generate` output reviewed.
3. Additive **optional** `uploadStream`/`downloadStream` on `packages/storage-s3` (+ `@aws-sdk/lib-storage` dep; unit tests with mocked SDK). → verify: existing storage tests untouched and green.
4. `backupService` (pg_dump → cipher stream → checksum → upload via module-owned `createStorageService()` from `OM_BACKUP_S3_*`) + CLI `backups run` / `backups list`. → verify: manual backup against dev DB lands in MinIO/S3, row recorded, unit tests for stream framing.

### Phase 2 — Restore & verification
5. CLI `backups restore` with safety rails (checksum, decrypt, non-empty guard, typed confirmation, `--force`); runbook notes for #994 key-material portability. → verify: scripted round-trip on scratch DB.
6. CLI `backups verify` + scratch-DB sanity checks + `verification_status` recording. → verify: corrupt-archive fixture fails cleanly.

### Phase 3 — Scheduling & retention
7. Schedule registration via `schedulerService.register()` upserts at module boot (system scope, `targetType: 'queue'`, env-driven cron; soft-optional resolve). → verify: schedules appear in the scheduler admin UI; module boots cleanly with scheduler disabled.
8. `backup-run`, `retention`, `verification` workers + `backups.*` events + superadmin notification resolver (module-local; one notification per super-admin in their own tenant). → verify: retention deletes expired fixture archive; single-flight test; notification lands for a super-admin user.

### Phase 4 — Admin surface
9. API routes (`GET/POST /api/backups/runs`, `GET /api/backups/status`) with openApi + `runRouteMutationGuards()` + ProgressJob wiring. → verify: route unit tests incl. 403 for non-superadmin and 409 single-flight.
10. Settings page `backend/settings/backups/page.tsx` (+ `page.meta.ts`, `requireFeatures: ['backups.view']`, settings context): freshness `<Alert>`/`<StatusBadge>`, `<DataTable>` inventory (stable `entityId`), "Run backup now" via `useGuardedMutation` + `apiCall`, progress via ProgressTopBar, `<EmptyState>` for no runs; lucide icons; all strings via i18n keys. → verify: DS-guardian pass.

### Phase 5 — data_erasure module
11. Scaffold module; `erasure_request` entity + migration; ledger service (DB write + object-per-entry storage write + module-local HMAC helper). → verify: write/verify unit tests.
12. `data_erasure.request.execute` command: pepper preflight; person path (command bus → `customers.people.delete` with `skipLog: true`; deals guard → fail-with-guidance), user path (single `auth.users.delete` with `skipLog: true`), per-id search-index delete events, `action_logs` undo-snapshot purge for the subject, event emission. → verify: sweep integration test asserts zero subject rows across affected tables AND no fresh PII snapshot in `action_logs`.
13. Purge subscribers — **core-side commits, maintainer sign-off required before this step**: `audit_logs` (PII snapshots for erased resource; module has no `subscribers/` dir today) and `communication_channels` (hard-delete of disconnected channel-connection rows — resolves the deferred TODO at `user-deleted-cascade.ts:26-29`; **v1 scope is connection rows only** — the fate of conversation content in `external_messages`/`messages` is an explicitly open product decision deferred to a follow-up, since business correspondence has its own retention obligations). Extension contract documented for third-party modules. → verify: subscriber unit tests.
14. API routes + settings page (ledger `<DataTable>`, create-request flow with typed confirmation via `useConfirmDialog`, `Cmd/Ctrl+Enter`/`Escape`). → verify: DS pass, 403 tests, 422 deals-guidance test.

### Phase 6 — Replay-on-restore, test infra & docs
15. Soft-optional `erasureReplayService` resolve in restore CLI + `backups.restore.completed` event + standalone `replay-erasures` command (`--verify-only` included). → verify: module-decoupling test still green; restore-without-data_erasure prints warning and succeeds.
16. Test infrastructure (core commit): MinIO container in the `packages/cli` integration harness (today it provisions Postgres only — `integration.ts:2972-2973`) + CI-image check for `pg_dump`/`pg_restore` binaries. → verify: harness boots MinIO locally and in CI.
17. End-to-end GDPR integration test: create subject → backup → erase → restore archive → assert subject absent after replay and no PII snapshots in `action_logs`. Docs: `apps/docs/docs/deployment/backups.mdx` (setup, key + pepper escrow, retention/GDPR statement, restore runbook incl. #994 caveat, scheduler admin UI pointer) + user-guide erasure page. → verify: full suite + docs build.

### Integration test coverage (spec requirement)

- API: `GET/POST /api/backups/runs` (auth, 403, trigger + progress, 409 single-flight), `GET /api/backups/status` (freshness states), `GET/POST /api/data_erasure/requests` (tenant scoping, typed-confirmation rejection, cross-tenant subject refusal, 422 deals guidance).
- UI: backups settings page (inventory render, manual trigger flow, freshness alert), data_erasure settings page (ledger list, create flow with confirmation dialog).
- E2E (CI, dockerized Postgres + MinIO): backup→restore round-trip; erase→backup(pre-erasure archive)→restore→replay→subject-absent + no-fresh-PII-snapshot (the money test for this spec).
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
| Backup silently stops (worker dead, schedule never fires) | High | Freshness state + superadmin notification on failure; status page; weekly verification exercises the whole chain; schedules visible in scheduler admin UI | Operator ignoring notifications; docs recommend external uptime check on `/api/backups/status` |
| Encryption key or pepper lost | High | Loud docs + key fingerprint on status page + joint escrow guidance; `_PREVIOUS` rotation slot; pepper preflight in erasure command | Key loss irrecoverable by design (that is the security property) |
| Restore executed against live DB by mistake | High | Typed-confirmation rail, non-empty-target guard, `--force` explicitness | Operator with raw `pg_restore` bypasses tooling — documented unsupported |
| Erasure re-creates PII via undo snapshots | High | `skipLog: true` on all delegated deletes + purge of pre-existing snapshots + E2E assertion on `action_logs` | Third-party commands invoked in future extensions must follow the same rule (documented in extension contract) |
| Erasure sweep misses a PII location (new module added later) | Medium | Subscriber extension contract + per-module `scope_summary` visibility; spec for any new PII-bearing module must declare an erasure subscriber | Third-party modules that ignore the contract |
| Maintainers reject core-side purge subscribers | Medium | Ask-first before Phase 5 step 13; fallback documented: subscribers live in `data_erasure` and purge via the owning modules' own commands/APIs | Slightly weaker module ownership of purge logic |
| Ledger stream tampered with in storage | Medium | Per-entry HMAC verified before replay (`--verify-only`); replay refuses invalid entries and reports | Attacker with both storage access and the HMAC secret |
| pg_dump version drift vs server / missing binaries | Medium | Version recorded per run; weekly verify catches incompatibility; Phase 6 verifies binaries on CI and production images | — |
| Large DB makes nightly dump heavy | Medium | Streamed pipeline (bounded memory), concurrency 1, off-peak default schedule | Very large instances should layer infra-level PITR (documented) |
| Cross-tenant exposure via instance-level backup surface | High | `backups.*` features granted to superadmin only; no tenant-facing routes; entity never wired into the query index | — |

Blast radius: both modules disabled-by-default behind env flags; the storage extension is dormant unless `uploadStream` is called. Operational detection: events, notifications, status endpoint, scheduler admin UI, CLI exit codes.

## Final Compliance Report — 2026-07-03 (rev 2)

### AGENTS.md Files Reviewed
- `AGENTS.md` (root), `packages/core/AGENTS.md` (routes, ACL, events, setup), `packages/queue/AGENTS.md`, `packages/events/AGENTS.md`, `packages/ui/AGENTS.md` + `packages/ui/src/backend/AGENTS.md`, `packages/shared/AGENTS.md`, `packages/cli/AGENTS.md`, `packages/core/src/modules/progress/AGENTS.md`, `.ai/specs/AGENTS.md`, `BACKWARD_COMPATIBILITY.md` (contract categories), `.ai/ds-rules.md`. Rev 2 additionally cross-checked against the independent gap analysis of PR #3742 (fresh-clone verification, 8 agents).

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| root AGENTS.md | No direct ORM relationships between modules | Compliant | FK ids + command bus + events only |
| root AGENTS.md | Filter by organization_id on scoped entities | Compliant with justified deviation | `erasure_request` fully scoped; `backup_run` is instance-scoped — deviation documented; precedent `FeatureToggle`/`Tenant` |
| root AGENTS.md | Never expose cross-tenant data | Compliant | Backup surfaces superadmin-only; erasure scope re-checked server-side |
| root AGENTS.md | Optimistic locking on new user-editable entities | N/A — justified | Neither entity has an edit form; background-job rows and append-only ledgers are exempt per `packages/core/AGENTS.md` |
| packages/core/AGENTS.md → API Routes | CRUD via `makeCrudRoute`; custom write routes wire the mutation guard contract | Justified deviation / Compliant | Custom routes (instance scope / command-backed create; `tenantField: null` + `feature_toggles/global` noted as the makeCrudRoute alternative); guards via current `runRouteMutationGuards()` |
| packages/core/AGENTS.md → Access Control | Feature-gated declarative guards, immutable feature ids | Compliant | `backups.view/manage`, `data_erasure.view/manage`; `defaultRoleFeatures` superadmin-only for backups (precedent `feature_toggles.global.manage`) |
| packages/core/AGENTS.md → Encryption | PII columns declare encryption maps | N/A — justified | Ledger deliberately stores no plaintext PII (ids + blind-index hash via `hashForLookup`, pepper-gated); archive encryption is stream-level AES-GCM, not field-level |
| packages/queue/AGENTS.md | No custom queues/polling; idempotent workers; metadata export; concurrency budget | Compliant | Queue consumed as-is (no contract changes); scheduling via `@open-mercato/scheduler`; all workers idempotent, Σconcurrency +3 |
| packages/events/AGENTS.md | Cross-module side effects via `createModuleEvents` + subscribers | Compliant | Event ids follow the `data_sync.run.*` precedent; core-side subscribers flagged for maintainer sign-off |
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
| Risks cover all write operations | Pass | backup create/delete, restore, erasure, replay, snapshot purge |
| Commands defined for all mutations | Pass | Erasure via command bus with `skipLog`; backup runs are system jobs recorded as entity rows (not user mutations) |
| Cache strategy covers read APIs | Pass | Explicit no-cache decision with rationale (tiny row counts, indexed point queries) |
| Undo contract addressed | Pass | Erasure explicitly non-undoable with audit ledger + no-fresh-snapshot rule; retention deletion non-undoable by design |

### Non-Compliant Items
None open. Justified deviations documented inline (instance-scoped `backup_run`; custom routes instead of `makeCrudRoute`). One external dependency: maintainer sign-off for core-side purge subscribers (Phase 5 step 13; fallback defined).

### Verdict
**Approved — ready for pre-implementation analysis** (`om-pre-implement-spec`). Pre-implement should confirm: `pg_dump`/`pg_restore` binaries on CI runner images and production containers; scheduler `register()` upsert semantics for system-scope + queue-target schedules; the E2E replay test harness (MinIO) design; and maintainer position on the core-side subscribers.

## Changelog

- 2026-07-02: Skeleton created; Open Questions Q1–Q4 answered by maintainer (phased physical-first backups; ledger + replay-on-restore + bounded retention; minimal sweep + ledger in scope; scheduling decision later superseded — see rev 2).
- 2026-07-02: Full specification written: two-module design (`backups`, `data_erasure`), platform extensions, GDPR guarantee model, six-phase implementation plan, compliance report appended. Shipped as PR #3742.
- 2026-07-03 (rev 2): Revised per independent gap analysis of PR #3742 (fresh-clone verification, 8 agents). Major: queue `repeat` extension withdrawn — scheduling now consumes the existing `@open-mercato/scheduler`; erasure command hardened (`skipLog: true` on delegated deletes so erasure cannot write fresh PII undo snapshots; pepper preflight; per-id index delete events instead of scope-wide `purgeIndexScope`; fail-with-guidance for persons with linked deals); superadmin notification targeting rule added (tenant-scoped notification contract); storage path corrected (module-owned `createStorageService()` from `OM_BACKUP_S3_*`, scope `null`, optional interface members completing SPEC-045i); user path simplified (single `auth.users.delete` — already a hard delete) and problem statement corrected accordingly; mutation guards updated to `runRouteMutationGuards()` (previous helpers deprecated); single-flight moved to DB status; ledger stream changed from JSONL-append to object-per-entry (S3 has no append primitive); MinIO test-harness and CI-binaries commits budgeted; core-side purge subscribers flagged for maintainer sign-off with fallback; `communication_channels` v1 purge scope set to connection rows only (content purge = open product decision); upstream references added (#117 close-with-PR, #208, #994, SPEC-045i, scheduler lineage, Terraform playbook differentiation); removed erroneous `DevCloud.md` citation.

### Review — 2026-07-03 (rev 2)
- **Reviewer**: Agent (incorporating independent 8-agent gap analysis)
- **Security**: Passed (env-only target/key, no HTTP restore, HMAC ledger, sanitized errors, typed confirmations, no-PII-resurrection rule, pepper preflight)
- **Performance**: Passed (streamed pipeline, keyset pagination, indexed queries, concurrency 1 for heavy jobs)
- **Cache**: Passed (explicit no-cache decision with rationale)
- **Commands**: Passed (single mutation command; non-undoability justified; `skipLog` + snapshot purge close the PII loop)
- **Risks**: Passed (silent-failure, key/pepper-loss, wrong-target-restore, PII-resurrection, maintainer-signoff scenarios with mitigations)
- **Verdict**: Approved
