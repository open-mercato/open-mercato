# Automated Database Backups & Restore (Enterprise)

> Split from `2026-07-02-automated-backups-and-gdpr-erasure-propagation.md` (rev 5) on 2026-07-08. Companion spec: [`2026-07-08-gdpr-data-erasure.md`](2026-07-08-gdpr-data-erasure.md) — GDPR erasure orchestration, the primary consumer of this spec's erasure-manifest mechanism.

## TLDR
**Key Points:**
- Enterprise module `backups`: scheduled encrypted physical database backups to object storage, tooled CLI restore with safety rails, bounded retention, on-demand restore verification, superadmin status page.
- Ships a generic **post-restore compliance mechanism**: an append-only manifest in the backup bucket (`erasureManifestService`) that the restore CLI diffs against database state and turns into an operator re-run list. The producer (the GDPR erasure spec) is soft-optional — without it the manifest is empty and restore prints nothing.
- Closes the confirmed operational finding: no automated backup mechanism exists in the codebase today — only manual `pg_dump` instructions in operator docs.

**Scope:**
- Physical whole-database backups (`pg_dump` custom format), AES-256-GCM-encrypted, streamed to a dedicated env-configured S3 target.
- CLI-first restore and verification; restore is never exposed over HTTP.
- Scheduling through the existing `@open-mercato/scheduler` package (system-scope schedules targeting queue jobs), plus CLI trigger and admin status page.
- Retention expiry (default 35 days — this bound doubles as the erasure-durability guarantee in the companion spec) and an on-demand `backups verify` CLI (scheduled verification is a one-click follow-up via the scheduler admin UI, not built in v1).

**Out of scope (future work):**
- Logical per-tenant export/restore (tenant portability, selective restore into a live database).
- Point-in-time recovery (WAL archiving) — see "Relation to infrastructure-level DR" below.

**Concerns:**
- `storage-s3` upload is `Buffer`-only; archives need additive **optional** streaming methods on the driver.
- The archive encryption key is a restore precondition — escrow procedure documented; after rotation the old key must be kept until its archives age out (restore accepts an explicit `--encryption-key` for pre-rotation archives).
- Notifications are tenant-scoped by contract, so scheduled (tenant-less) run failures have no notification addressee in v1 — detection relies on the status page freshness state plus a documented external uptime check; manual runs notify the triggering admin through the standard path.

## Overview

Open Mercato instances (self-hosted and DevCloud-managed) currently have no first-class data-recovery capability. This spec gives every enterprise instance an automated, verifiable backup pipeline. The audience is instance operators (superadmins).

> **Market Reference**: adopted the app-orchestrated model proven in mature self-hosted platforms — application-managed scheduled backups, object-storage upload, one-command restore, an admin status surface — and the strict separation of archive and secrets: the encryption key never travels with the archive, and losing the key means losing the backups, which is documented loudly.

### Relation to infrastructure-level DR (open discussion, PR #3742)

WAL archiving + PITR + physical replicas (pgBackRest/WAL-G-class tooling) are strictly better disaster recovery — lower RPO, continuous archiving, HA — and an infrastructure-as-code repo providing them is a worthwhile separate track (raised by core team on the PR). The two layers are complementary, not competing:

- **In-app (this spec)** = the portable baseline that works wherever the app runs with zero infra assumptions, plus the compliance surface infra cannot provide: the erasure manifest and post-restore re-run list, retention tied to app policy, an admin status page an auditor can be pointed at. The original finding was not "no good backup tech exists" but "nobody wires it up" — docs already instruct operators to configure backups, and fresh installs still have none; an IaC repo remains opt-in, environment-specific work.
- **Infra-level (proposed IaC track)** = the recommended upgrade for serious deployments and DevCloud. Note that PITR makes the erasure-durability story *harder*, not easier — WAL archives retain every erased byte at point-in-time granularity — so the post-restore re-application control from the companion spec is needed even more there.

The documented boundary between the layers lands in the Phase 5 docs page.

## Problem Statement

A security/operations review (2026-07), independently re-verified by an 8-agent gap analysis against a fresh `develop` clone:

1. **No automated backup mechanism is live in the codebase.** Zero `pg_dump` invocations in code (docs-only manual instructions in `apps/docs/docs/installation/vps.mdx`, `setup.mdx`), no backup module, no `OM_BACKUP_*` variables. The AWS Terraform playbook (`.ai/specs/2026-06-04-aws-terraform-deployment-playbook.md`) is an explicitly non-final plan with zero `.tf` files in the repo; SPEC-024 lists backups as an unimplemented NFR.
2. **No restore path is confirmed or tooled.** "Test restore procedures regularly" is a docs checklist item with no supporting code.

## Proposed Solution

### Design Decisions

| Decision | Rationale |
|----------|-----------|
| Physical whole-DB backups first; per-tenant logical export deferred | `pg_dump -Fc` is proven, complete (custom fields, encrypted columns, FK graph come along for free), and closes the finding fastest. Logical per-tenant traversal is a separate, much larger problem. |
| Scheduling via the existing `@open-mercato/scheduler` package | The platform already ships a scheduler (cron/interval schedules, `system` scope without tenant, sync to BullMQ repeatable, local execution in dev, admin UI, idempotent `register()` upsert). Building a queue-level `repeat` primitive would duplicate it. |
| Backup target and encryption key are env-only, never DB-configurable | A tenant admin must never be able to redirect instance-wide backups or read the archive key. The module builds its own storage client via the exported `createStorageService()` from `OM_BACKUP_S3_*` env — it MUST NOT resolve the DI `storageService`, which is the per-tenant Integration Marketplace credentials wrapper and would throw for instance-level jobs. |
| Restore is CLI-only | Restoring a whole database over an HTTP endpoint is an unacceptable attack surface. The CLI runs with operator credentials on the host. |
| Generic erasure-manifest mechanism lives here; the producer is soft-optional | A restore from a pre-erasure archive would otherwise resurrect erased data with no record of what to re-erase. `backups` owns the manifest contract (`erasureManifestService`: append/list) and the restore-time diff; the companion GDPR spec owns writing entries. Without a producer the manifest is empty and restore prints nothing. |
| Failure detection via status page + external monitoring (no cross-tenant notification fan-out in v1) | `Notification.tenant_id` is non-nullable; a superadmin fan-out would be a novel cross-tenant pattern requiring its own security review. Manual runs already notify the triggering admin through the standard tenant-scoped path; failure events remain emitted for workflow/monitoring integrations. |

### Alternatives Considered

| Alternative | Why Rejected |
|-------------|-------------|
| External cron + docs only (no in-app scheduler) | Reproduces the current failure mode: a checklist item nobody wires up. |
| Infrastructure-only DR (WAL/PITR IaC, no in-app path) | Complementary, not a substitute — see "Relation to infrastructure-level DR" above. Opt-in infra work is the exact failure mode behind the finding, and infra is blind to the app's compliance semantics. |
| Additive queue `repeat` extension | Duplicates `@open-mercato/scheduler` (withdrawn in an earlier revision after gap analysis). |
| Backup via logical data-engine export | Slower to deliver, easy to miss tables, and restore consistency across modules is unsolved. |
| Storing backups through tenant-configurable storage integration | Tenant-controlled credentials for instance-wide data is a cross-tenant exposure. |

## User Stories

- An **instance operator** wants **nightly encrypted backups shipped off-host automatically** so that a database loss is recoverable without relying on remembered manual steps.
- An **instance operator** wants **a one-command, safety-railed restore** so that recovery under pressure is a procedure, not an improvisation.
- An **instance operator** wants **an on-demand verification command** (`backups verify` into a scratch database) so that backups are not discovered to be corrupt at the worst moment; scheduling it is one click in the scheduler admin UI.
- A **superadmin** wants **a status page showing backup freshness, inventory, and archive details** so that a silently failing pipeline is visible.

## Architecture

```
 @open-mercato/scheduler          ┌─────────────────────────────────────────────────┐
 (system-scope schedules,  ─────▶ │ backups module (enterprise)                     │
  targetType 'queue')             │  workers: backup-run / retention                │
  CLI trigger ──────────────────▶ │  lib: backupService (pg_dump→AES-GCM→S3 stream) │
  admin POST ───────────────────▶ │  entity: backup_run          events: backups.*  │
                                  │  DI: erasureManifestService (append/list)       │
                                  │  CLI: run / list / restore / verify             │
                                  └───────────────┬─────────────────────────────────┘
                                                  │ restore completed:
                                                  │  1) diff erasure manifest vs DB
                                                  │     state → print re-run list
                                                  │  2) emit backups.restore.completed
                                                  ▼
                                   (soft-optional producer: data_erasure module —
                                    see the companion GDPR erasure spec)
```

### Platform extension (additive, OSS-side)

**Streaming storage upload** (`packages/storage-s3`): `StorageService` gains **optional** members `uploadStream(input: { namespace, fileName, stream: Readable, contentType?, scope })` backed by `@aws-sdk/lib-storage` multipart `Upload`, and `downloadStream(input: { key, scope }): Promise<Readable>`. Optional-member form is required by `BACKWARD_COMPATIBILITY.md` for a published-package interface. The shipped `StorageService` (`packages/storage-s3/src/modules/storage_s3/lib/storage-service.ts:65-76`) is Buffer-only in both directions — a streaming `download(): Promise<ReadableStream>` exists only in the SPEC-045i *design document* (line 95), whose implementation diverged to Buffer — so the stream members are built from scratch, aligned with SPEC-045i's original intent. Buffer methods remain unchanged. `@aws-sdk/lib-storage` becomes a dependency of `storage-s3` only.

The scheduler and queue packages are **consumed, not modified**.

### Module boundaries and coupling

| Touchpoint | Mechanism | Glue owner | Absent-peer behavior |
|------------|-----------|------------|----------------------|
| backups → scheduler (scheduled triggers) | Soft-optional DI resolve of `schedulerService` in `try/catch` from `setup.ts` `seedDefaults`; idempotent stable-id `register()` upsert of system-scope schedules with `targetType: 'queue'` — converges to one row regardless of how many times seeding runs (pattern: `communication_channels/setup.ts:87-131`, system-scope precedent: `ai_assistant/setup.ts`) | `backups` | No scheduled backups; CLI and manual trigger still work; status page shows "no schedule registered" warning |
| data_erasure → backups (erasure manifest write) | Soft-optional DI resolve of `erasureManifestService` (registered by `backups`) in `try/catch` at execution time; the restore-side diff lives entirely inside `backups` + `backups.restore.completed` event | `data_erasure` (optional consumer; see companion spec) | Erasure completes with a log line that the manifest was skipped; a restore with `data_erasure` inactive prints the re-run list with a warning |

No direct cross-module imports; no cross-module ORM relations.

### Events

`createModuleEvents` (ids follow the `data_sync.run.*` precedent): `backups.run.completed`, `backups.run.failed` (runId, sizeBytes, durationMs / errorSummary), `backups.archive.expired`, `backups.restore.completed` (runId or storageKey, restoredAt, pendingErasureCount). Failure events are emitted for workflow/monitoring integrations; v1 ships no cross-tenant notification fan-out.

## Data Model

### backup_run

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
- `created_at`, `updated_at` (system-managed entity; not user-editable, so the optimistic-locking UI contract does not apply — background-job rows are explicitly exempt per `packages/core/AGENTS.md`)

Indexes: `(status, created_at)` for the status page; `(retention_expires_at)` partial where status = 'completed' for the retention sweep. Expected cardinality ~365–1100 rows/year; point lookups and short range scans only.

### Erasure manifest (mechanism owned here; entries produced by the companion spec)

Immutable objects `data-erasure-manifest/tenant_<id>/<timestamp>_<requestId>.json` (`{ requestId, subjectKind, subjectId, subjectLabelMasked, executedAt }`) in the backup storage target, written via the DI-registered `erasureManifestService` (`append(entry)`, `list(tenantPrefix?)`). Object-per-entry because S3 has no append primitive: atomic writes, no read-modify-write races. Entries only ever feed an operator-reviewed re-run list — never automated deletion — so the manifest carries no integrity machinery; the operator's per-subject confirmation is the integrity boundary.

## API Contracts

All routes export `metadata` with per-method `requireAuth: true` + `requireFeatures`, plus `openApi` definitions. No restore endpoint exists. Custom routes are justified: instance-scoped entity with no tenant filter and no user-editable form (`makeCrudRoute` can run instance-wide via `tenantField: null` — precedent `feature_toggles/global` — so this is a pragmatic choice, not a hard constraint).

- `GET /api/backups/runs` — feature `backups.view`. Query: `page`, `pageSize` (≤ 100), `status?`. Keyset pagination on `(created_at, id)`.
- `POST /api/backups/runs` — feature `backups.manage`. Triggers a manual backup: creates `backup_run(pending, trigger=manual)`, creates a ProgressJob under the caller's tenant (precedent: `catalog/api/bulk-delete/route.ts:54-56`), enqueues the backup job, returns `{ runId, progressJobId }`. Runs the current mutation-guard contract via `runMutationGuards()` (`packages/shared/src/lib/crud/mutation-guard-registry.ts:89`; the older `validateCrudMutationGuard`/`runCrudMutationGuardAfterSuccess` pair is `@deprecated`).
- `GET /api/backups/status` — feature `backups.view`. Returns `{ lastCompletedAt, lastStatus, freshnessState: 'ok'|'stale'|'never', archiveCount, totalSizeBytes }`. Freshness threshold: `OM_BACKUP_FRESHNESS_HOURS` (default 26). Uncached in v1 (single indexed point query). This endpoint is the documented target for external uptime monitoring.

Errors: 401/403 per guards; 409 when a `backup_run` row is already `running` — single-flight is enforced by DB status (the queue contract has no job-id/dedupe primitive).

## CLI Contracts (`ModuleCli[]` in `cli.ts`)

No enterprise module ships a `cli.ts` today — `backups` is the first; Phase 1 verifies registry discovery (`modules.cli.generated.ts`) early.

- `mercato backups run [--label <text>]` — synchronous backup with progress output; exits non-zero on failure.
- `mercato backups list [--status <s>]` — archive inventory table.
- `mercato backups restore <runId|storageKey> [--target-database-url <url>] [--force] [--encryption-key <base64>]` — downloads, verifies `checksum_sha256`, decrypts (`--encryption-key` overrides the env key for pre-rotation archives; the run row's key fingerprint identifies which key an archive needs), `pg_restore`s. Safety rails: refuses a non-empty target without `--force`; when the target is the live `DATABASE_URL` it requires typing the database name to confirm; prints a maintenance-mode reminder. Afterwards: diffs the erasure manifest against the restored database state **across all `tenant_<id>` prefixes** (a physical restore resurrects every tenant at once) and prints the re-run list (masked labels + request ids), warns if the producer module is inactive, then emits `backups.restore.completed` with `pendingErasureCount` and exits with a distinct code when it is > 0. The restore runbook documents the cross-environment key-material caveat (issue #994): restoring into a different environment requires the same tenant DEKs and archive key.
- `mercato backups verify [runId]` — restores the given (default: latest completed) archive into `OM_BACKUP_VERIFY_DATABASE_URL`, runs sanity checks (pg_restore exit code, row-count spot checks on `users`/`tenants`, migrations table matches source), prints the result and exits non-zero on failure, drops the scratch schema. On-demand in v1; operators can schedule it through the scheduler admin UI.

`pg_dump`/`pg_restore` are invoked with the connection string passed via environment (never argv), version-checked at startup, `pg_dump_version` recorded per run. No user-controlled input is interpolated into argv.

## Workers & Scheduling

Two queue workers (standard `workers/*.ts` contract, both idempotent, total added concurrency 2 — within the worker `DB_POOL_MAX` invariant):

| Worker | Queue | Trigger | Concurrency |
|--------|-------|---------|-------------|
| `backup-run` | `backups:run` | scheduler / API / CLI | 1 (single-flight via DB status; CPU/IO heavy) |
| `retention` | `backups:retention` | scheduler | 1 |

Schedules: `OM_BACKUP_CRON` (default `0 2 * * *`), retention `0 4 * * *` — registered from `seedDefaults` (see coupling table). Jobs enqueued by the scheduler inherit queue defaults (attempts 3, exponential backoff) — acceptable because both workers are idempotent and `backup-run` is single-flight. `retention` deletes archives where `retention_expires_at < now`, marks rows `expired`, and sweeps orphaned multipart objects by prefix. Retention window: `OM_BACKUP_RETENTION_DAYS`, default 35 — **this bound is the erasure-durability guarantee consumed by the companion GDPR spec.**

Backup pipeline: `pg_dump -Fc` stdout → `crypto.createCipheriv('aes-256-gcm')` stream (module-local streaming helper; key = `OM_BACKUP_ENCRYPTION_KEY`, 32-byte base64; `v1:iv:…ciphertext…:tag` framing) → SHA-256 tee → `uploadStream` into namespace `backups` with `scope: null`. Peak memory bounded by stream chunk size. Storage config (env-only): `OM_BACKUP_S3_BUCKET/_REGION/_ENDPOINT/_ACCESS_KEY_ID/_SECRET_ACCESS_KEY` (or ambient IAM), consumed by a module-owned `createStorageService()` instance.

## Security Considerations

- Archive encryption: AES-256-GCM with an instance key from env; fingerprint recorded per run; the key never appears in logs, API responses, `backup_run` rows, or the archive. Rotation: set the new key, keep the old key escrowed until its archives age out, pass it explicitly (`--encryption-key`) when restoring a pre-rotation archive. No in-app multi-key slot in v1.
- Losing the key = losing the backups. Status page shows the active key fingerprint; docs state the key must be escrowed separately from the database host.
- Restore endpoint does not exist over HTTP.
- Manifest entries are plain JSON that only produce an operator-reviewed re-run list — a tampered entry cannot trigger automated deletion.
- `backup_run` is superadmin-only by ACL (see deviation callout). Secrets hygiene: connection strings via env to child processes; `error_message` sanitized.

## Failure Scenarios

| Scenario | Behavior |
|----------|----------|
| `pg_dump` exits non-zero / binary missing | Run `failed` with sanitized stderr excerpt; `backups.run.failed` emitted; freshness degrades to `stale` (external uptime check catches it) |
| S3 upload interrupted | Multipart upload aborted; run `failed`; partial objects cleaned by the retention worker (orphan sweep by prefix) |
| Backup overlaps previous run | Single-flight: second job sees a `running` row and no-ops with a log line |
| Scheduler module absent/disabled | No scheduled backups; boot logs a warning; status page shows "no schedule registered"; CLI and manual trigger unaffected |
| Archive corrupt (checksum mismatch) | Restore refuses before touching the target; `backups verify` prints the failure and exits non-zero |
| Manifest unreachable during restore | CLI warns loudly and completes the restore; runbook: re-run the diff once storage is back (manifest objects are plain JSON, listable by prefix) |
| Worker process down for days | Freshness alert on status page + external uptime check; CLI `backups run` always available |

## Phasing & Implementation Plan

Each phase ends with a working application (`yarn generate && yarn typecheck && yarn test && yarn build:app` green). Estimated ~19 atomic commits: ~15 enterprise + 4 core-side (storage streaming ×3, MinIO test harness ×1) — all core commits ADDITIVE-ONLY.

### Phase 0 — Go/no-go gate
- **Gate A (hard, technical):** verify `pg_dump`/`pg_restore` presence and version compatibility on CI runner images and production containers. Minutes to check; invalidates the entire approach if it fails — do not write `backupService` before this passes.

### Phase 1 — Backup core path
1. Scaffold `packages/enterprise/src/modules/backups/` (index/acl/setup/di/events, i18n en+de+es+pl); register in **both** registration points — `enterprisePackage.modules` in `packages/enterprise/src/index.ts` (note: currently drifted, missing `system_status_overlays`; fix the drift in the same commit) and `apps/mercato/src/modules.ts` behind `OM_ENABLE_ENTERPRISE_MODULES` (+ `OM_ENABLE_ENTERPRISE_MODULES_BACKUPS`). Include a stub `cli.ts` and verify CLI registry discovery immediately. → verify: module loads, features sync, CLI command listed.
2. `backup_run` entity + module migration + snapshot. → verify: `yarn db:generate` output reviewed.
3. Additive **optional** `uploadStream`/`downloadStream` on `packages/storage-s3` (+ `@aws-sdk/lib-storage` dep; unit tests with mocked SDK). → verify: existing storage tests untouched and green.
4. `backupService` (pg_dump → cipher stream → checksum → upload via module-owned `createStorageService()`) + CLI `backups run` / `backups list`. → verify: manual backup against dev DB lands in MinIO/S3, row recorded, stream-framing unit tests.

### Phase 2 — Restore & verification
5. CLI `backups restore` with safety rails; runbook notes for #994 key-material portability. → verify: scripted round-trip on scratch DB.
6. CLI `backups verify` + scratch-DB sanity checks (on-demand; exits non-zero on failure). → verify: corrupt-archive fixture fails cleanly.

### Phase 3 — Scheduling & retention
7. Schedule registration via `schedulerService.register()` upserts from `seedDefaults` (system scope, `targetType: 'queue'`, env-driven cron; soft-optional resolve). → verify: schedules appear in the scheduler admin UI; module boots cleanly with scheduler disabled.
8. `backup-run` and `retention` workers + `backups.*` events. → verify: retention deletes expired fixture archive; single-flight test.

### Phase 4 — Admin surface
9. API routes with openApi + `runMutationGuards()` + ProgressJob wiring. → verify: route unit tests incl. 403 for non-superadmin and 409 single-flight.
10. Settings page `backend/settings/backups/page.tsx` (+ `page.meta.ts`, `requireFeatures: ['backups.view']`): freshness `<Alert>`/`<StatusBadge>`, `<DataTable>` inventory (stable `entityId`), "Run backup now" via `useGuardedMutation` + `apiCall`, ProgressTopBar, `<EmptyState>`; lucide icons; i18n keys. → verify: DS-guardian pass.

### Phase 5 — Erasure-manifest mechanism, test infra & docs
11. `erasureManifestService` (append/list) registered in `backups` DI + manifest-vs-DB diff in the restore CLI (printed re-run list, distinct exit code, `pendingErasureCount` on the event). → verify: module-decoupling test green; restore with no producer prints nothing and succeeds.
12. Test infrastructure (core commit): MinIO container in the `packages/cli` integration harness (today it provisions Postgres only — `integration.ts:2972-2973`). → verify: harness boots MinIO locally and in CI.
13. E2E backup→restore round-trip test. Docs: `apps/docs/docs/deployment/backups.mdx` (setup, key escrow + rotation, restore runbook with the re-run step and #994 caveat, scheduler pointer incl. optional verify schedule, **and the in-app vs infra-level DR boundary** from the open discussion). → verify: full suite + docs build.

### Integration test coverage
- API: `GET/POST /api/backups/runs` (auth, 403, trigger + progress, 409 single-flight), `GET /api/backups/status` (freshness states).
- UI: backups settings page (inventory render, manual trigger flow, freshness alert).
- E2E (CI, dockerized Postgres + MinIO): backup→restore round-trip. (The erase→backup→restore→re-run E2E lives in the companion spec.)
- All tests self-contained: fixtures created in setup via API, cleaned in teardown.

## Migration & Backward Compatibility

- New module and env vars only; no behavior changes when disabled (default: enterprise flag off). The storage-s3 extension is ADDITIVE-ONLY (optional interface members). Scheduler and queue consumed as-is. New DB tables via per-module migrations + snapshots.

## Risks & Impact Review

| Risk | Severity | Mitigation | Residual |
|------|----------|------------|----------|
| Backup silently stops (worker dead, schedule never fires) | High | Freshness state on status page + documented external uptime check on `/api/backups/status`; schedules visible in scheduler admin UI; on-demand `backups verify` | Operator without external monitoring notices only on the status page |
| Encryption key lost | High | Loud docs + fingerprint on status page + escrow guidance incl. post-rotation retention (`--encryption-key` flag) | Key loss irrecoverable by design |
| Restore executed against live DB by mistake | High | Typed-confirmation rail, non-empty-target guard, `--force` explicitness | Operator with raw `pg_restore` bypasses tooling — documented unsupported |
| Operator skips the post-restore re-run step | Medium | Restore CLI prints the list, exits with a distinct code when `pendingErasureCount > 0`, runbook marks the step mandatory | Human-process risk; accepted (see companion spec's guarantee/control split) |
| pg_dump version drift vs server / missing binaries | Medium | Phase 0 Gate A before any code; version recorded per run; on-demand verify catches later drift | — |
| Large DB makes nightly dump heavy | Medium | Streamed pipeline (bounded memory), concurrency 1, off-peak default schedule | Very large instances should use the infra-level DR track (documented boundary) |
| Cross-tenant exposure via instance-level backup surface | High | `backups.*` features superadmin-only; no tenant-facing routes; entity never wired into the query index | — |
| Manifest tampered with in storage | Low | Entries only produce an operator-reviewed re-run list; per-subject typed confirmation is the integrity boundary | — |

## Final Compliance Report — 2026-07-08 (split)

Inherited from the combined spec's rev-5 report (all rows unchanged for the backups scope): instance-scoped `backup_run` deviation documented with compensating controls; custom routes justified with `runMutationGuards()`; queue/scheduler consumed as-is (Σconcurrency +2); storage extension additive-only; i18n in four locales; integration coverage listed. Verdict: **approved for pre-implementation analysis** after Phase 0 Gate A, with pre-implement confirming: scheduler `register()` semantics for system+queue schedules, MinIO harness design, DI `storageService` behavior for tenant-less resolution, and the remaining unverified citations (`FeatureToggle`/`Tenant` and `feature_toggles.global.manage` precedents, catalog bulk-delete ProgressJob precedent, `packages/cli` Postgres-only harness claim).

## Changelog

- 2026-07-08: Split from `2026-07-02-automated-backups-and-gdpr-erasure-propagation.md` (rev 5) — this file carries the backups module, the storage-streaming platform extension, and the erasure-manifest mechanism (contract + restore-time diff); the erasure producer, ledger, and GDPR framing live in [`2026-07-08-gdpr-data-erasure.md`](2026-07-08-gdpr-data-erasure.md). Added "Relation to infrastructure-level DR" recording the open core-team discussion (PR #3742): in-app = portable baseline + compliance surface; WAL/PITR IaC repo = complementary recommended upgrade track.
- Inherited history (combined spec): 2026-07-02 initial + full spec (PR #3742); 2026-07-03 rev 2 (gap-analysis corrections: scheduler adoption instead of queue extension, storage path via `createStorageService()`, DB-status single-flight) and rev 3 (market research applied); 2026-07-04 rev 4 (descoped above-market clusters: automated replay → guided re-run, verification worker → on-demand CLI, notification resolver removed, key-rotation slot removed) and rev 5 (executor+advisor review: `runMutationGuards()` citation fix, Phase 0 gates, edit-survivor sweep, `seedDefaults` mechanism); 2026-07-06 market references generalized to pattern descriptions.
