# Automated Database Backups & GDPR Erasure Propagation (Enterprise)

## TLDR
**Key Points:**
- Two new enterprise modules: `backups` (scheduled encrypted physical database backups to object storage, tooled restore, retention, continuous restore verification) and `data_erasure` (tenant-scoped GDPR hard-delete sweep with an append-only erasure ledger).
- The GDPR guarantee is two-layered: bounded backup retention (erased data ages out of all archives within a documented window) plus erasure-ledger replay after every restore (a restore from a pre-erasure archive immediately re-applies executed erasures).
- Closes the confirmed operational finding: no automated backup mechanism exists in the codebase today — only manual `pg_dump` instructions in operator docs.

**Scope:**
- Physical whole-database backups (`pg_dump` custom format), AES-256-GCM-encrypted, streamed to a dedicated env-configured S3 target.
- CLI-first restore and verification tooling; restore is never exposed over HTTP.
- In-app scheduling via an additive `repeat` extension of the queue contract (BullMQ repeatable jobs), plus CLI trigger and a superadmin status page.
- Minimal erasure sweep for subject kinds `customers:person` and `auth:user`, with an event-based extension contract for other modules.
- Retention expiry and weekly automated restore verification into a scratch database.

**Out of scope (future specs):**
- Logical per-tenant export/restore (tenant portability, selective restore into a live database).
- Crypto-shredding (per-data-subject encryption keys) — noted as a hardening direction, not built here.
- Point-in-time recovery (WAL archiving) — operators may layer pgBackRest/WAL-G underneath; this spec is the app-level mechanism.

**Concerns:**
- The queue abstraction has no recurring-job capability today (`EnqueueOptions` carries only `delayMs`); this spec introduces the platform primitive additively.
- `storage-s3` upload is `Buffer`-only; archives need an additive streaming upload on the driver.
- Physical backups are instance-scoped, not tenant-scoped — the `backup_run` entity is an explicit, justified deviation from the `organization_id` scoping rule (see Data Models).

## Overview

Open Mercato instances (self-hosted and DevCloud-managed) currently have no first-class data-recovery capability. This spec gives every enterprise instance an automated, verifiable backup pipeline and makes GDPR Art. 17 erasure durable across restores. The audience is instance operators (superadmins) for backups, and tenant admins/DPOs for erasure requests.

> **Market Reference**: Discourse (admin-managed scheduled backups, S3 upload, one-command restore) — adopted the app-orchestrated model with an admin status surface and CLI restore. GitLab backup utility — adopted the strict separation of archive and secrets: the encryption key never travels with the archive, and losing the key means losing the backups, which is documented loudly. pgBackRest/WAL-G — rejected as the in-app mechanism: they are infrastructure-level tools with no application awareness, so they cannot drive erasure replay, retention tied to app policy, or an admin UX; operators can still run them alongside for PITR. No surveyed OSS product implements erasure-replay-on-restore natively; the ledger + replay + bounded-retention model follows EDPB guidance that backup erasure may complete within a documented rotation window provided restores re-apply erasures.

## Problem Statement

A security/operations review (2026-07) confirmed:

1. **No automated backup mechanism is live in the codebase.** All references are manual operator docs (`apps/docs/docs/installation/vps.mdx`, `setup.mdx`), a non-final IaC playbook (`.ai/specs/2026-06-04-aws-terraform-deployment-playbook.md`, zero `.tf` files in repo), a commercial support-tier description (`DevCloud.md`), or an unimplemented NFR (SPEC-024).
2. **No restore path is confirmed or tooled.** "Test restore procedures regularly" is a docs checklist item with no supporting code.
3. **GDPR erasure cannot propagate to backups** because there are no backups and no erasure mechanism: customer deletion is soft-delete by default, and `communication_channels/subscribers/user-deleted-cascade.ts:26-29` explicitly defers hard-delete to "a future tenant-level GDPR sweep".

## Proposed Solution

Two enterprise modules plus two small additive platform extensions.

### Design Decisions

| Decision | Rationale |
|----------|-----------|
| Physical whole-DB backups first; per-tenant logical export deferred | `pg_dump -Fc` is proven, complete (custom fields, encrypted columns, FK graph come along for free), and closes the finding fastest. Logical per-tenant traversal is a separate, much larger problem. |
| Erasure ledger + replay-on-restore + bounded retention (not crypto-shredding) | Keeps archives immutable and the encryption layer untouched. Accepted compliance posture in the EU. Crypto-shredding would require reworking field encryption to key-per-subject; recorded as a future hardening phase. |
| Ledger is dual-written: DB row + append-only object-storage stream | A restore from a pre-erasure archive would otherwise erase the ledger itself. The object-storage stream (outside the database) is the source of truth for replay; the DB row serves the admin UI and API. |
| `data_erasure` is a separate module from `backups` | Erasure is a privacy capability independent of backups (it must run even if backups are disabled). `backups` consumes it soft-optionally at restore time; either module functions without the other. |
| Backup target and encryption key are env-only, never DB-configurable | A tenant admin must never be able to redirect instance-wide backups or read the archive key. Instance secrets stay with the operator. |
| Restore is CLI-only | Restoring a whole database over an HTTP endpoint is an unacceptable attack surface. The CLI runs with operator credentials on the host. |
| Erasure is deliberately not undoable | GDPR requires irreversibility. The ledger (with HMAC integrity hashes) is the audit record. This is an explicit, justified exception to the undoability default — see Commands. |

### Alternatives Considered

| Alternative | Why Rejected |
|-------------|-------------|
| External cron + docs only (no in-app scheduler) | Reproduces the current failure mode: a checklist item nobody wires up. The finding exists because "operator will do it" did not happen. |
| Backup via logical data-engine export | Slower to deliver, easy to miss tables (custom field values, link tables), and restore consistency across modules is unsolved. |
| Rewriting archives on erasure | Breaks archive immutability and checksums; operationally fragile; no compliance benefit over replay + retention. |
| Storing backups through tenant-configurable storage integration | Tenant-controlled credentials for instance-wide data is a cross-tenant exposure. |

## User Stories / Use Cases

- An **instance operator** wants **nightly encrypted backups shipped off-host automatically** so that a database loss is recoverable without relying on remembered manual steps.
- An **instance operator** wants **a one-command, safety-railed restore** so that recovery under pressure is a procedure, not an improvisation.
- An **instance operator** wants **continuous proof that restore works** (weekly scratch-DB verification) so that backups are not discovered to be corrupt at the worst moment.
- A **superadmin** wants **a status page showing backup freshness, inventory, and verification results** so that a silently failing pipeline is visible.
- A **tenant admin / DPO** wants **to execute an erasure request for a person or user** so that GDPR Art. 17 obligations are met with an auditable record.
- A **DPO** wants **erasure to survive a database restore** so that restoring last week's backup does not resurrect erased personal data.

## Architecture

```
                ┌─────────────────────────────────────────────────┐
                │ backups module (enterprise)                     │
  cron (BullMQ  │  workers: backup-run / retention / verification │
  repeatable) ─▶│  lib: backupService (pg_dump→AES-GCM→S3 stream) │
  CLI trigger ─▶│  entity: backup_run          events: backups.*  │
  admin POST ──▶│  CLI: run/list/restore/verify/replay-erasures   │
                └───────────────┬─────────────────────────────────┘
                                │ restore completed:
                                │  1) soft-optional resolve (try/catch)
                                │     erasureReplayService — inline replay
                                │  2) emit backups.restore.completed
                                ▼
                ┌─────────────────────────────────────────────────┐
                │ data_erasure module (enterprise)                │
                │  entity: erasure_request (ledger, tenant-scoped)│
                │  dual-write: DB row + S3 append-only stream     │
                │  command: data_erasure.request.execute          │
                │  event: data_erasure.request.executed ──────────┼──▶ subscribers in
                └─────────────────────────────────────────────────┘    audit_logs,
                                                                        communication_channels,
                                                                        (3rd-party modules)
```

### Platform extensions (additive, OSS-side)

1. **Queue recurring jobs** (`packages/queue`): `EnqueueOptions` gains `repeat?: { cron: string; jobKey?: string }`; `BullQueueInterface.add` passes BullMQ `repeat` through; `WorkerMeta` gains `schedule?: { cron: string }` and `registerModuleWorkers` upserts the repeatable job at worker boot when the strategy supports it. The `local` strategy logs a one-line warning and skips scheduling (dev uses the CLI trigger). Both fields are optional — existing workers and enqueue calls are untouched.
2. **Streaming storage upload** (`packages/storage-s3`): `StorageService` gains `uploadStream(input: { namespace, fileName, stream: Readable, contentType?, scope })` backed by `@aws-sdk/lib-storage` multipart `Upload`, and `downloadStream(input: { key, scope }): Promise<Readable>`. Buffer methods remain unchanged.

Both extensions follow `BACKWARD_COMPATIBILITY.md` ADDITIVE-ONLY rules; no existing signature changes.

### Module boundaries and coupling

| Touchpoint | Mechanism | Glue owner | Absent-peer behavior |
|------------|-----------|------------|----------------------|
| backups → data_erasure (replay at restore) | Soft-optional DI resolve in `try/catch` (`erasureReplayService`) + `backups.restore.completed` event | `backups` (optional consumer) | Restore completes; CLI prints a prominent warning that erasure replay was skipped; event still emitted |
| data_erasure → customers (person hard-delete) | Command bus: executes existing `customers.people.delete` (already a hard-delete with cascades) | `data_erasure` | Erasure request for `customers:person` fails with a clear error if customers module is disabled |
| data_erasure → auth (user hard-delete) | Command bus: `auth.users.delete`, then hard-delete of the soft-deleted row via `DataEngine.deleteOrmEntity({ soft: false })`; emits existing `auth.user.deleted` | `data_erasure` | Same pattern |
| data_erasure → other modules (module-owned PII purge) | Event `data_erasure.request.executed` with persistent subscribers | Each subscribing module | Modules without a subscriber simply keep their own data lifecycle; documented extension contract |
| data_erasure → search indexes | Query-index purge helpers (`query_index/lib/purge.ts` pattern) invoked for the erased entity ids | `data_erasure` | N/A (query_index is core) |

No direct cross-module imports; no cross-module ORM relations.

### Commands & Events

- **Command**: `data_erasure.request.execute` — validates subject, dual-writes the ledger entry (`pending`), runs the sweep, marks `executed`, emits the event. **Not undoable — by design.** `buildLog` records only subject kind/id and per-module deletion counts; the undo snapshot mechanism is explicitly disabled for this command, and the sweep additionally purges pre-existing `action_logs` undo snapshots that reference the erased subject (undo snapshots contain PII copies).
- **Events** (`createModuleEvents`, all singular-entity, past-tense):
  - `backups.run.completed`, `backups.run.failed` (payload: runId, sizeBytes, durationMs / errorSummary)
  - `backups.archive.expired` (retention deletion)
  - `backups.restore.completed` (payload: runId or storageKey, restoredAt, replayPerformed: boolean)
  - `backups.verification.completed`, `backups.verification.failed`
  - `data_erasure.request.executed` (payload: requestId, tenantId, organizationId, subjectKind, subjectId — no PII)
  - `data_erasure.replay.completed` (payload: replayedCount, skippedCount, source: 'restore' | 'manual')
- Failure events feed the standard notifications mechanism (superadmin notification on `backups.run.failed` / `backups.verification.failed`).

## Data Models

### backup_run (module `backups`)

Instance-scoped operational record. **Deviation callout:** no `tenant_id` / `organization_id` — a physical whole-database archive is inherently cross-tenant. Compensating controls: the entity is reachable only through `backups.*`-gated API/UI (granted to superadmin only by default), never through tenant-facing surfaces, and is excluded from the query index.

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
- `error_message`: text, nullable
- `created_at`, `updated_at` (system-managed entity; not user-editable, so the optimistic-locking UI contract does not apply — no edit form exists)

Indexes: `(status, created_at)` for the status page; `(retention_expires_at)` partial where status = 'completed' for the retention sweep. Expected cardinality: one row per run — ~365–1100 rows/year; point lookups and short range scans only.

### erasure_request (module `data_erasure`) — the ledger

Tenant-scoped, append-only. Rows are never updated after reaching a terminal status and never deleted (no `deleted_at`). **The ledger stores no plaintext PII**: subjects are referenced by id and blind-index hash only, so the ledger itself is not an erasure target and needs no encryption map (justified N/A).

- `id`: uuid PK
- `tenant_id`: uuid, `organization_id`: uuid
- `subject_kind`: enum `customers:person | auth:user` (extensible)
- `subject_id`: uuid
- `subject_email_hash`: text, nullable — blind index via existing `hashForLookup` helper; enables post-restore matching if ids ever diverge
- `status`: enum `pending | executed | failed` (only allowed transitions: pending→executed, pending→failed)
- `requested_by_user_id`: uuid
- `requested_at`, `executed_at`: timestamptz
- `scope_summary`: jsonb — per-module deletion counts (e.g. `{ "customers": { "people": 1, "activities": 12 }, "audit_logs": { "snapshots_purged": 4 } }`); counts only, no PII
- `integrity_hash`: text — HMAC-SHA256 over the canonical entry fields, same pattern as `auth/lib/consentIntegrity.ts` (`computeConsentIntegrityHash` / timing-safe verify)
- `created_at`, `updated_at`

Indexes: `(tenant_id, organization_id, created_at)`; `(subject_kind, subject_id)`.

**Object-storage ledger stream:** every executed entry is also appended to `data-erasure-ledger/tenant_<id>/ledger.jsonl` in the backup storage target (one JSON line per entry, including `integrity_hash`). Replay reads this stream — never the restored database — as the authoritative list.

### Validation

All API inputs validated with zod in `data/validators.ts` of each module; TS types via `z.infer`. Erasure execution additionally re-verifies subject existence and tenant/organization scope inside the command (defense in depth against a forged subject id from another tenant).

## API Contracts

All routes export `metadata` with per-method `requireAuth: true` + `requireFeatures`, plus `openApi` definitions. No restore endpoint exists.

### backups (custom routes — justified: instance-scoped, no tenant filter, no user-editable entity; `makeCrudRoute` assumes tenant scoping)

- `GET /api/backups/runs` — feature `backups.view`. Query: `page`, `pageSize` (≤ 100), `status?`. Keyset pagination on `(created_at, id)`. Response: rows + `nextCursor`.
- `POST /api/backups/runs` — feature `backups.manage`. Triggers a manual backup: creates `backup_run(pending, trigger=manual)`, creates a ProgressJob under the caller's tenant, enqueues the backup job, returns `{ runId, progressJobId }`. As a custom write route it calls `validateCrudMutationGuard` before and `runCrudMutationGuardAfterSuccess` after the mutation.
- `GET /api/backups/status` — feature `backups.view`. Returns `{ lastCompletedAt, lastStatus, freshnessState: 'ok'|'stale'|'never', archiveCount, totalSizeBytes, lastVerification }`. Freshness threshold: `OM_BACKUP_FRESHNESS_HOURS` (default 26). Uncached in v1 (single indexed point query; caching is a non-goal at this row count).

Errors: 401/403 per guards; 409 when a backup is already running (single-flight lock via queue job id).

### data_erasure

- `GET /api/data_erasure/requests` — feature `data_erasure.view`. Tenant/organization-scoped list (every query filters by `organization_id`), keyset pagination, `pageSize ≤ 100`.
- `POST /api/data_erasure/requests` — feature `data_erasure.manage`. Body: `{ subjectKind, subjectId, confirmation: string }` (zod-validated; `confirmation` must equal the literal subject id — server-side re-check of the typed confirmation). Executes `data_erasure.request.execute` via the command bus; returns the ledger entry. 404-equivalent minimal error when the subject does not exist in the caller's scope (no cross-tenant existence oracle).

## CLI Contracts (module `backups`, shape: `ModuleCli[]` in `cli.ts`)

- `mercato backups run [--label <text>]` — synchronous backup with progress output; exits non-zero on failure.
- `mercato backups list [--status <s>]` — archive inventory table.
- `mercato backups restore <runId|storageKey> [--target-database-url <url>] [--force] [--skip-erasure-replay]` — downloads, verifies `checksum_sha256`, decrypts, `pg_restore`s. Safety rails: refuses a non-empty target without `--force`; when the target is the live `DATABASE_URL` it requires typing the database name to confirm; prints a maintenance-mode reminder. Afterwards: soft-optional erasure replay (see Architecture), then emits `backups.restore.completed`. `--skip-erasure-replay` exists for scratch/forensic restores and prints a compliance warning.
- `mercato backups verify [runId]` — restores the given (default: latest completed) archive into `OM_BACKUP_VERIFY_DATABASE_URL`, runs sanity checks (pg_restore exit code, row-count spot checks on `users`/`tenants`, migrations table matches source), records the result on `backup_run`, drops the scratch schema.
- `mercato backups replay-erasures [--tenant <id>]` — standalone ledger replay (idempotent; skips subjects already absent).

`pg_dump`/`pg_restore` are invoked with the connection string passed via environment (never argv — keeps credentials out of process lists), version-checked at startup, and `pg_dump_version` is recorded per run. No user-controlled input is interpolated into argv.

## Workers & Scheduling (module `backups`, `workers/*.ts`)

| Worker | Queue | Schedule (env-overridable) | Concurrency |
|--------|-------|---------------------------|-------------|
| `backup-run` | `backups:run` | `OM_BACKUP_CRON`, default `0 2 * * *` | 1 (single-flight; CPU/IO heavy) |
| `retention` | `backups:retention` | `0 4 * * *` | 1 |
| `verification` | `backups:verification` | `OM_BACKUP_VERIFY_CRON`, default `0 5 * * 0` | 1 |

All idempotent: `backup-run` no-ops if a run is already `running` (queue job key = single-flight); `retention` deletes archives where `retention_expires_at < now` then marks rows `expired` (re-running is harmless); `verification` records results keyed by runId. Retention window: `OM_BACKUP_RETENTION_DAYS`, default 35 — **this number is the documented GDPR upper bound for erased data persisting in archives.** Connection budget: total added concurrency is 3, within the worker `DB_POOL_MAX` invariant.

Backup pipeline: `pg_dump -Fc` stdout → `crypto.createCipheriv('aes-256-gcm')` stream (module-local streaming helper; key = `OM_BACKUP_ENCRYPTION_KEY`, 32-byte base64; format `v1:iv:…ciphertext…:tag` framing) → SHA-256 tee → `storageService.uploadStream` into namespace `backups` with `scope: { tenantId: 'shared', organizationId: 'shared' }`. Peak memory is bounded by stream chunk size regardless of database size.

Storage target configuration (env-only): `OM_BACKUP_S3_BUCKET/_REGION/_ENDPOINT/_ACCESS_KEY_ID/_SECRET_ACCESS_KEY` (or ambient IAM). Deliberately separate from tenant file storage: different credentials, different lifecycle, and immune to tenant-level reconfiguration.

## The GDPR Guarantee (normative)

1. **Live erasure**: `data_erasure.request.execute` hard-deletes the subject across modules (sweep + subscriber contract + search-index purge + undo-snapshot purge) and appends the ledger entry to DB and object storage.
2. **Archive aging**: archives are immutable; every archive containing pre-erasure data is deleted by the retention worker no later than `OM_BACKUP_RETENTION_DAYS` after creation. Erasure requests therefore fully propagate to all backups within the retention window.
3. **Restore re-application**: any restore performed via the tooling replays the object-storage ledger before the instance returns to service; erased subjects present in the archive are re-erased. Replay is idempotent and matches by `subject_id` (with `subject_email_hash` as a secondary check).
4. **Documentation duty**: the ops docs page (Phase 6) states the retention window and the replay behavior so operators can answer DPO/authority questions with an accurate technical description.

Residual gap (documented, accepted): a restore performed by hand with raw `pg_restore`, bypassing the CLI, skips replay. Mitigation: docs mark the CLI as the only supported restore path, and `replay-erasures` exists as a standalone recovery step.

## Security Considerations

- Archive encryption: AES-256-GCM with an instance key from env; key fingerprint recorded per run; the key never appears in logs, API responses, `backup_run` rows, or the archive itself. Key rotation procedure documented: set new key, old archives remain decryptable via `OM_BACKUP_ENCRYPTION_KEY_PREVIOUS` (checked by fingerprint) until they age out.
- Losing the key = losing the backups. The status page shows the active key fingerprint; docs state the key must be escrowed separately from the database host (GitLab-style warning).
- Restore endpoint does not exist over HTTP; erasure POST requires feature grant + typed confirmation re-checked server-side.
- Ledger integrity: per-entry HMAC (existing `consentIntegrity` pattern); `verify` subcommand of `replay-erasures` validates the stream before applying.
- Erasure minimality: the ledger stores ids and blind-index hashes, never names/emails — an erasure audit trail that is not itself a PII store.
- Tenant isolation: `data_erasure` queries always filter by `tenant_id` + `organization_id`; subject resolution refuses ids outside the caller's scope with a minimal error. `backup_run` is superadmin-only by ACL (see deviation callout).
- Secrets hygiene: connection strings via env to child processes; `error_message` on `backup_run` is sanitized (no connection-string echo from pg_dump stderr).

## Failure Scenarios

| Scenario | Behavior |
|----------|----------|
| `pg_dump` exits non-zero / binary missing | Run marked `failed` with sanitized stderr excerpt; `backups.run.failed` event → superadmin notification; freshness state degrades to `stale` and the status page shows it |
| S3 upload interrupted | Multipart upload aborted; run `failed`; partial objects cleaned by the retention worker (orphan sweep by prefix) |
| Backup overlaps previous run | Single-flight: second job no-ops and logs |
| Archive corrupt (checksum mismatch on restore/verify) | Restore refuses before touching the target; verification marks `verification_status=failed` → notification |
| Erasure sweep fails mid-way | Ledger entry stays `pending`→`failed` with per-module progress in `scope_summary`; command is re-runnable (idempotent: already-deleted rows are skipped); no partial ledger append to object storage until `executed` |
| Replay finds a subject the sweep cannot delete (e.g. module disabled) | Replay records `skippedCount`, emits `data_erasure.replay.completed` with details, CLI exits non-zero so the operator sees it |
| Worker process down for days | Freshness alert on status page + notification; CLI `backups run` always available |

## Phasing & Implementation Plan

Each phase ends with a working application (`yarn generate && yarn typecheck && yarn test && yarn build:app` green).

### Phase 1 — Backup core path
1. Scaffold `packages/enterprise/src/modules/backups/` (index/acl/setup/di/events, i18n en+de+es+pl); register in `enterprisePackage.modules` and `apps/mercato/src/modules.ts` behind `OM_ENABLE_ENTERPRISE_MODULES` (+ `OM_ENABLE_ENTERPRISE_MODULES_BACKUPS`). → verify: module loads, features sync.
2. `backup_run` entity + module migration + snapshot. → verify: `yarn db:generate` output reviewed.
3. Additive `uploadStream`/`downloadStream` on `packages/storage-s3` (unit tests with mocked SDK). → verify: existing storage tests untouched and green.
4. `backupService` (pg_dump → cipher stream → checksum → upload) + CLI `backups run` / `backups list`. → verify: manual backup against dev DB lands in MinIO/S3, row recorded, unit tests for stream framing.

### Phase 2 — Restore & verification
5. CLI `backups restore` with safety rails (checksum, decrypt, non-empty guard, typed confirmation, `--force`). → verify: scripted round-trip on scratch DB.
6. CLI `backups verify` + scratch-DB sanity checks + `verification_status` recording. → verify: corrupt-archive fixture fails cleanly.

### Phase 3 — Scheduling & retention
7. Additive queue `repeat` support (`EnqueueOptions.repeat`, `WorkerMeta.schedule`, registration in `registerModuleWorkers`; local-strategy warning path). Unit tests both strategies. → verify: BullMQ registers the repeatable job; existing queue tests green.
8. `backup-run`, `retention`, `verification` workers + `backups.run.*`/`backups.archive.expired`/`backups.verification.*` events + failure notifications. → verify: retention deletes expired fixture archive; single-flight test.

### Phase 4 — Admin surface
9. API routes (`GET/POST /api/backups/runs`, `GET /api/backups/status`) with openApi + mutation-guard calls + ProgressJob wiring. → verify: route unit tests incl. 403 for non-superadmin.
10. Settings page `backend/settings/backups/page.tsx` (+ `page.meta.ts`, `requireFeatures: ['backups.view']`, settings context): freshness `<Alert>`/`<StatusBadge>`, `<DataTable>` inventory (stable `entityId`), "Run backup now" via `useGuardedMutation` + `apiCall`, progress via ProgressTopBar, `<EmptyState>` for no runs; lucide icons; all strings via i18n keys. → verify: DS-guardian pass.

### Phase 5 — data_erasure module
11. Scaffold module; `erasure_request` entity + migration; ledger service (DB write + object-storage JSONL append + HMAC). → verify: append/verify unit tests.
12. `data_erasure.request.execute` command: person path (command bus → `customers.people.delete`), user path (soft delete → hard delete via `deleteOrmEntity(soft:false)`), search-index purge, `action_logs` undo-snapshot purge for the subject, event emission. → verify: sweep integration test asserts zero subject rows across affected tables.
13. Purge subscribers: `audit_logs` (PII snapshots for erased resource), `communication_channels` (hard-delete of disconnected channel rows — resolves the deferred TODO at `user-deleted-cascade.ts:29`). Extension contract documented for third-party modules. → verify: subscriber unit tests.
14. API routes + settings page (ledger `<DataTable>`, create-request flow with typed confirmation via `useConfirmDialog`, `Cmd/Ctrl+Enter`/`Escape`). → verify: DS pass, 403 tests.

### Phase 6 — Replay-on-restore & docs
15. Soft-optional `erasureReplayService` resolve in restore CLI + `backups.restore.completed` event + standalone `replay-erasures` command. → verify: module-decoupling test still green; restore-without-data_erasure prints warning and succeeds.
16. End-to-end GDPR integration test: create subject → backup → erase → restore archive → assert subject absent after replay. Docs: `apps/docs/docs/deployment/backups.mdx` (setup, key escrow, retention/GDPR statement, restore runbook) + user-guide erasure page. → verify: full suite + docs build.

### Integration test coverage (spec requirement)

- API: `GET/POST /api/backups/runs` (auth, 403, trigger + progress), `GET /api/backups/status` (freshness states), `GET/POST /api/data_erasure/requests` (tenant scoping, typed-confirmation rejection, cross-tenant subject refusal).
- UI: backups settings page (inventory render, manual trigger flow, freshness alert), data_erasure settings page (ledger list, create flow with confirmation dialog).
- E2E (CI, dockerized Postgres + MinIO): backup→restore round-trip; erase→backup(pre-erasure archive)→restore→replay→subject-absent (the money test for this spec).
- All tests self-contained: fixtures created in setup via API, cleaned in teardown; no reliance on seed data.

## Migration & Backward Compatibility

- New modules and new env vars only; no existing behavior changes when the modules are disabled (default: enterprise flag off).
- Queue and storage-s3 extensions are ADDITIVE-ONLY per `BACKWARD_COMPATIBILITY.md` (new optional fields/methods; no signature or semantic changes to existing surfaces). No deprecations introduced.
- New DB tables via per-module migrations + snapshots; no changes to existing tables.
- `customers.people.delete` and `auth.users.delete` are consumed as-is through the command bus; no contract changes.

## Risks & Impact Review

| Risk | Severity | Mitigation | Residual |
|------|----------|------------|----------|
| Backup silently stops (worker dead, cron never fires) | High | Freshness state + superadmin notification on failure; status page; weekly verification exercises the whole chain | Operator ignoring notifications; docs recommend external uptime check on `/api/backups/status` |
| Encryption key lost | High | Loud docs + key fingerprint on status page + escrow guidance; `_PREVIOUS` rotation slot | Irrecoverable by design (that is the security property) |
| Restore executed against live DB by mistake | High | Typed-confirmation rail, non-empty-target guard, `--force` explicitness | Operator with raw `pg_restore` bypasses tooling — documented unsupported |
| Erasure sweep misses a PII location (new module added later) | Medium | Subscriber extension contract + per-module `scope_summary` visibility; spec for any new PII-bearing module must declare an erasure subscriber (added to spec checklist expectations for enterprise) | Third-party modules that ignore the contract |
| Ledger stream tampered with in storage | Medium | Per-entry HMAC verified before replay; replay refuses invalid entries and reports | Attacker with both storage access and the HMAC secret |
| pg_dump version drift vs server | Medium | Version recorded per run; verify job catches incompatibility weekly | — |
| Large DB makes nightly dump heavy | Medium | Streamed pipeline (bounded memory), concurrency 1, off-peak default schedule | Very large instances should layer infra-level PITR (documented) |
| Cross-tenant exposure via instance-level backup surface | High | `backups.*` features granted to superadmin only; no tenant-facing routes; `backup_run` excluded from query index | — |

Blast radius: both modules disabled-by-default behind env flags; platform extensions are dormant unless `repeat`/`uploadStream` are used. Operational detection: events, notifications, status endpoint, CLI exit codes.

## Final Compliance Report — 2026-07-02

### AGENTS.md Files Reviewed
- `AGENTS.md` (root), `packages/core/AGENTS.md` (routes, ACL, events, setup), `packages/queue/AGENTS.md`, `packages/events/AGENTS.md`, `packages/ui/AGENTS.md` + `packages/ui/src/backend/AGENTS.md`, `packages/shared/AGENTS.md`, `packages/cli/AGENTS.md`, `packages/core/src/modules/progress/AGENTS.md`, `.ai/specs/AGENTS.md`, `BACKWARD_COMPATIBILITY.md` (contract categories), `.ai/ds-rules.md`.

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| root AGENTS.md | No direct ORM relationships between modules | Compliant | FK ids + command bus + events only |
| root AGENTS.md | Filter by organization_id on scoped entities | Compliant with justified deviation | `erasure_request` fully scoped; `backup_run` is instance-scoped — deviation documented with compensating superadmin-only ACL |
| root AGENTS.md | Never expose cross-tenant data | Compliant | Backup surfaces superadmin-only; erasure scope re-checked server-side |
| root AGENTS.md | Optimistic locking on new user-editable entities | N/A — justified | Neither entity has an edit form; ledger is append-only; both expose `updated_at` so the entity guard passes |
| packages/core/AGENTS.md → API Routes | CRUD via `makeCrudRoute` | Justified deviation | Custom routes (instance scope / command-backed create); mutation-guard calls declared; `metadata` + `openApi` per route |
| packages/core/AGENTS.md → Access Control | Feature-gated declarative guards, immutable feature ids | Compliant | `backups.view/manage`, `data_erasure.view/manage`; `defaultRoleFeatures` superadmin-only for backups |
| packages/core/AGENTS.md → Encryption | PII columns declare encryption maps | N/A — justified | Ledger deliberately stores no plaintext PII (ids + blind-index hash via existing `hashForLookup`); archive encryption is stream-level AES-GCM, not field-level |
| packages/queue/AGENTS.md | No custom queues/polling; idempotent workers; metadata export; concurrency budget | Compliant | Scheduling added inside the queue contract (additive); all workers idempotent, Σconcurrency +3 |
| packages/events/AGENTS.md | Cross-module side effects via `createModuleEvents` + subscribers | Compliant | Event ids `module.entity.action`, singular entity, past tense |
| packages/ui/AGENTS.md + backend | `DataTable`/`useGuardedMutation`/`apiCall`; no raw fetch; DS tokens; dialogs Cmd+Enter/Escape | Compliant | Declared per page in Phase 4/5; DS-guardian gate in plan |
| packages/shared/AGENTS.md | i18n via `useT`/`resolveTranslations`; no hardcoded strings; boolean parsing helpers | Compliant | i18n files in all four locales per module |
| BACKWARD_COMPATIBILITY.md | Contract changes additive or deprecation protocol | Compliant | Queue + storage extensions additive-only |
| .ai/specs/AGENTS.md | Enterprise spec placement + `{date}-{title}.md`; no `SPEC-ENT-*` prefix | Compliant | This file |
| root AGENTS.md (integration tests) | Spec lists integration coverage for all affected API and key UI paths; tests self-contained | Compliant | See Integration test coverage |

### Internal Consistency Check

| Check | Status | Notes |
|-------|--------|-------|
| Data models match API contracts | Pass | |
| API contracts match UI section | Pass | |
| Risks cover all write operations | Pass | backup create/delete, restore, erasure, replay |
| Commands defined for all mutations | Pass | Erasure via command bus; backup runs are system jobs recorded as entity rows (not user mutations) |
| Cache strategy covers read APIs | Pass | Explicit no-cache decision with rationale (tiny row counts, indexed point queries) |
| Undo contract addressed | Pass | Erasure explicitly non-undoable with audit ledger; retention deletion non-undoable by design |

### Non-Compliant Items
None open. Two justified deviations documented inline (instance-scoped `backup_run`; custom routes instead of `makeCrudRoute`).

### Verdict
**Approved — ready for pre-implementation analysis** (`om-pre-implement-spec`), which should stress the queue-contract extension and the E2E replay test harness first.

## Changelog

- 2026-07-02: Skeleton created; Open Questions Q1–Q4 answered by maintainer (phased physical-first backups; ledger + replay-on-restore + bounded retention; minimal sweep + ledger in scope; BullMQ repeatable + CLI + admin page).
- 2026-07-02: Full specification written: two-module design (`backups`, `data_erasure`), additive queue/storage platform extensions, GDPR guarantee model, six-phase implementation plan, compliance report appended.

### Review — 2026-07-02
- **Reviewer**: Agent
- **Security**: Passed (env-only target/key, no HTTP restore, HMAC ledger, sanitized errors, typed confirmations)
- **Performance**: Passed (streamed pipeline, keyset pagination, indexed queries, concurrency 1 for heavy jobs)
- **Cache**: Passed (explicit no-cache decision with rationale)
- **Commands**: Passed (single mutation command; non-undoability justified; undo-snapshot purge covered)
- **Risks**: Passed (silent-failure, key-loss, wrong-target-restore, sweep-coverage scenarios with mitigations)
- **Verdict**: Approved
