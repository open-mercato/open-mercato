# Automated Database Backups & Restore (Enterprise)

> **Manifest design superseded in full (2026-11-16)** by [`2026-11-16-erasure-restore-replay.md`](2026-11-16-erasure-restore-replay.md) (C9). This replaces every erasure-manifest provision: the TLDR/scope and ownership claim, Design Decisions, Architecture DI/diff, coupling row, event pending count, Erasure manifest data model, restore CLI post-step and distinct privacy exit code, Security, Failure Scenarios, Phase 5 manifest step, integration expectations, Risks and prior compliance claims. No `erasureManifestService`, bucket manifest or automatic restore-time diff is implemented from this file. Scheduling, backup storage, archive retention and UI remain here; artifact/restore mechanics follow the 11-06 engine below. C9’s own outstanding approvals and OSS awaited-capture/verification-time handoff remain gated by the program; its design now requires durable external evidence before protected completion.

> Split from `2026-07-02-automated-backups-and-gdpr-erasure-propagation.md` (rev 5) on 2026-07-08. Companion spec: [`2026-07-08-gdpr-data-erasure.md`](2026-07-08-gdpr-data-erasure.md) — July rationale only, now fully superseded by the OSS erase operation, enterprise governance and C9 replay carriers.

> Backup engine and operator CLI: [Resumable Encrypted PostgreSQL Backup and Restore CLI](2026-11-06-cli-backup-restore.md) (enterprise `backups` module). It owns the logical whole-database, chunked, resumable, age-encrypted artifact, per-entity progress and `create/verify/restore/exercise` commands. This spec retains scheduling, object storage, archive retention and UI, consuming its `createBackup`, `verifyBackup`, `restoreBackup` and `exerciseBackup` facade. The old single-stream AES-GCM/`OM_BACKUP_ENCRYPTION_KEY` and live-target designs are withdrawn throughout this file. C9 independently owns erasure manifests and replay; the engine now preserves that same independent runbook boundary and archive-only exit status.

## TLDR
**Key Points:**
- Enterprise module `backups`: scheduled encrypted logical whole-database backups to object storage, resumable CLI restore, bounded archive retention, offline verification and isolated recovery exercises, superadmin status page.
- Restore reports archive restoration only. Its runbook points to C9’s independent `mercato data_erasure restore-status --refresh` and reviewed `restore-reapply` procedure before reopening service. A successful backup restore does not certify that erasures have been reapplied.
- Closes the confirmed operational finding: no automated backup mechanism exists in the codebase today — only manual `pg_dump` instructions in operator docs.

**Scope:**
- Logical whole-database artifacts: schema chunks rendered by `pg_dump`, data read with PostgreSQL COPY, gzip/age encryption per chunk and encrypted index, stored in a dedicated env-configured S3 target. The engine owns the exact format and consistency modes.
- CLI-first restore and verification; restore is never exposed over HTTP.
- Scheduling through the existing `@open-mercato/scheduler` package (system-scope schedules targeting queue jobs), plus CLI trigger and admin status page.
- Retention expiry (default 35 days — an operational archive limit, not a post-restore erasure guarantee). `verify` is offline integrity verification; `exercise` restores to an isolated scratch target and runs recovery checks. Scheduled verification/exercise needs a registered safe command/worker bridge and is deferred in v1.

**Out of scope (future work):**
- Logical per-tenant export/restore (tenant portability, selective restore into a live database).
- Point-in-time recovery (WAL archiving) — see "Relation to infrastructure-level DR" below.

**Concerns:**
- `storage-s3` upload is `Buffer`-only; archives need additive **optional** streaming methods on the driver.
- Archive private identities are a restore precondition: escrow separately, retain identities for every restorable recipient set and use the engine's `--identity-file`. Scheduled creation uses public recipients from `OM_BACKUP_RECIPIENTS_FILE`; no raw archive key travels in argv. Application DEKs/historical versions and external assets remain separate recovery requirements.
- Notifications are tenant-scoped by contract, so scheduled (tenant-less) run failures have no notification addressee in v1 — detection relies on the status page freshness state plus a documented external uptime check; manual runs notify the triggering admin through the standard path.

## Overview

Open Mercato instances (self-hosted and DevCloud-managed) currently have no first-class data-recovery capability. This spec gives every enterprise instance an automated, verifiable backup pipeline. The audience is instance operators (superadmins).

> **Market Reference**: adopted the app-orchestrated model proven in mature self-hosted platforms — application-managed scheduled backups, object-storage upload, one-command restore, an admin status surface — and the strict separation of archive and secrets: private archive identities never travel with the artifact, and losing them means losing archive readability, which is documented loudly.

### Relation to infrastructure-level DR (open discussion, PR #3742)

WAL archiving + PITR + physical replicas (pgBackRest/WAL-G-class tooling) are strictly better disaster recovery — lower RPO, continuous archiving, HA — and an infrastructure-as-code repo providing them is a worthwhile separate track (raised by core team on the PR). The two layers are complementary, not competing:

- **In-app (this spec)** = the portable baseline that works wherever the app runs with zero infra assumptions, plus archive retention tied to app policy and an admin status page an auditor can be pointed at. The external erasure manifest and replay procedure belong to C9 and work independently of this module. The original finding was not "no good backup tech exists" but "nobody wires it up" — docs already instruct operators to configure backups, and fresh installs still have none; an IaC repo remains opt-in, environment-specific work.
- **Infra-level (proposed IaC track)** = the recommended upgrade for serious deployments and DevCloud. Note that PITR makes the erasure-durability story *harder*, not easier — WAL archives retain every erased byte at point-in-time granularity — so the independent post-restore re-application control from C9 is needed even more there.

The documented boundary between the layers lands in the Phase 5 docs page.

## Problem Statement

A security/operations review (2026-07), independently re-verified by an 8-agent gap analysis against a fresh `develop` clone:

1. **No automated backup mechanism is live in the codebase.** Zero `pg_dump` invocations in code (docs-only manual instructions in `apps/docs/docs/installation/vps.mdx`, `setup.mdx`), no backup module, no `OM_BACKUP_*` variables. The AWS Terraform playbook (`.ai/specs/2026-06-04-aws-terraform-deployment-playbook.md`) is an explicitly non-final plan with zero `.tf` files in the repo; SPEC-024 lists backups as an unimplemented NFR.
2. **No restore path is confirmed or tooled.** "Test restore procedures regularly" is a docs checklist item with no supporting code.

## Proposed Solution

### Design Decisions

| Decision | Rationale |
|----------|-----------|
| Logical whole-database backups first; per-tenant export deferred | The 11-06 engine captures schema, every table, large objects and encrypted columns as stored; per-tenant traversal is a separate capability. Files/object stores, Vault, Redis and cluster-global roles are outside the archive and require their own recovery procedure. |
| Scheduling via the existing `@open-mercato/scheduler` package | The platform already ships a scheduler (cron/interval schedules, `system` scope without tenant, sync to BullMQ repeatable, local execution in dev, admin UI, idempotent `register()` upsert). Building a queue-level `repeat` primitive would duplicate it. |
| Backup target and public-recipient configuration are operator-only, never tenant-configurable | A tenant admin must never be able to redirect instance-wide backups or read a private archive identity. The module builds its own storage client via the exported `createStorageService()` from `OM_BACKUP_S3_*` env — it MUST NOT resolve the DI `storageService`, which is the per-tenant Integration Marketplace credentials wrapper and would throw for instance-level jobs. |
| Restore is CLI-only | Restoring a whole database over an HTTP endpoint is an unacceptable attack surface. The CLI runs with operator credentials on the host. |
| Manifest and replay are independent of backups | C9 owns external files, detection and replay for product and infrastructure restores. `backups` has no manifest service or privacy-completion decision; it prints the separate runbook step. An absent C9 engine is explicitly unprotected unless the operator maintains an external procedure. |
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
- An **instance operator** wants **offline verification and a recovery exercise** (`backups verify` / `backups exercise` with the engine's flags) so corruption and missing key/assets are discovered before an incident; scheduled execution is deferred until a safe target is designed.
- A **superadmin** wants **a status page showing backup freshness, inventory, and archive details** so that a silently failing pipeline is visible.

## Architecture

```text
scheduler / CLI / admin POST → backups module
  workers: backup-run, retention
  engine: archive create / verify / restore (11-06 carrier)
  storage: instance-owned object storage
  UI: backup inventory and freshness
restore success → backups.restore.completed (archive facts only)
                → print the independent privacy runbook step
operator → C9 restore-status --refresh → reviewed restore-reapply
```

No C9 service is imported or resolved by `backups`. No manifest data is read from the backup bucket. Backup restoration and privacy readiness have separate outcomes.

### Platform extension (additive, OSS-side)

**Streaming storage upload** (`packages/storage-s3`): `StorageService` gains **optional** members `uploadStream(input: { namespace, fileName, stream: Readable, contentType?, scope })` backed by `@aws-sdk/lib-storage` multipart `Upload`, and `downloadStream(input: { key, scope }): Promise<Readable>`. Optional-member form is required by `BACKWARD_COMPATIBILITY.md` for a published-package interface. The shipped `StorageService` (`packages/storage-s3/src/modules/storage_s3/lib/storage-service.ts:74-85`) is Buffer-only in both directions — a streaming `download(): Promise<ReadableStream>` exists only in the SPEC-045i *design document* (line 95), whose implementation diverged to Buffer — so the stream members are built from scratch, aligned with SPEC-045i's original intent. Buffer methods remain unchanged. `@aws-sdk/lib-storage` becomes a dependency of `storage-s3` only.

The scheduler and queue packages are **consumed, not modified**.

### Module boundaries and coupling

| Touchpoint | Mechanism | Glue owner | Absent-peer behavior |
|------------|-----------|------------|----------------------|
| backups → scheduler (scheduled triggers) | Soft-optional DI resolve of `schedulerService` in `try/catch` from `setup.ts` `seedDefaults`; idempotent stable-id `register()` upsert of system-scope schedules with `targetType: 'queue'` — converges to one row regardless of how many times seeding runs (pattern: `communication_channels/setup.ts:87-131`, system-scope precedent: `ai_assistant/setup.ts`) | `backups` | No scheduled backups; CLI and manual trigger still work; status page shows "no schedule registered" warning |
| backups restore → privacy runbook | Printed next step and documentation link only; operator invokes C9’s own status/replay commands | `backups` documents the boundary; C9 owns privacy detection and replay | Backup restore succeeds on its own criteria and prints that erasure replay was not checked. Without C9, the operator uses a controller-maintained erasure register/procedure; no empty-manifest success is inferred |

No direct cross-module imports; no cross-module ORM relations.

### Events

`createModuleEvents` (ids follow the `data_sync.run.*` precedent): `backups.run.completed`, `backups.run.failed` (runId, sizeBytes, durationMs / errorSummary), `backups.archive.expired`, `backups.restore.completed` (runId or storageKey, restoredAt). Failure events are emitted for workflow/monitoring integrations; v1 ships no cross-tenant notification fan-out.

## Data Model

### backup_run

Instance-scoped operational record. **Deviation callout:** no `tenant_id` / `organization_id` — a logical whole-database archive is inherently cross-tenant. Precedent for instance-scoped entities exists (`FeatureToggle`, `Tenant`); no generator or CI mechanism mandates tenancy columns. Compensating controls: the entity is reachable only through `backups.*`-gated API/UI (granted to superadmin only by default, precedent: `feature_toggles.global.manage`), never through tenant-facing surfaces, and is never wired into the query index (indexing is opt-in via `indexer: { entityType }`, which this entity simply does not declare).

- `id`: uuid PK
- `status`: enum `pending | running | completed | failed | expired | deleted`
- `trigger`: enum `schedule | manual | cli`
- `triggered_by_user_id`: uuid, nullable (manual/API triggers)
- `started_at`, `finished_at`: timestamptz, nullable
- `size_bytes`: bigint, nullable
- `checksum_sha256`: text, nullable (the engine's trusted `manifestSha256` for the complete artifact; per-chunk digests remain in its index)
- `storage_key`: text, nullable
- `pg_dump_version`: text, nullable
- `recipient_set_fingerprint`: text, nullable (the engine manifest's `encryption.recipientSetFingerprint`; identifies the archive recipients without storing a private identity)
- `retention_expires_at`: timestamptz, nullable
- `error_message`: text, nullable (sanitized — no connection-string echo)
- `created_at`, `updated_at` (system-managed entity; not user-editable, so the optimistic-locking UI contract does not apply — background-job rows are explicitly exempt per `packages/core/AGENTS.md`)

Indexes: `(status, created_at)` for the status page; `(retention_expires_at)` partial where status = 'completed' for the retention sweep. Expected cardinality ~365–1100 rows/year; point lookups and short range scans only.

### Erasure manifest — successor only

No erasure-manifest object, schema or DI key remains in `backups`; the engine's artifact `manifest.json` is unrelated. C9’s Data Models and API Contracts own the external manifest. Its directory must be outside the database and its backups. Do not create the withdrawn `data-erasure-manifest/` bucket prefix from this historical spec.

## API Contracts

All routes export `metadata` with per-method `requireAuth: true` + `requireFeatures`, plus `openApi` definitions. No restore endpoint exists. Custom routes are justified: instance-scoped entity with no tenant filter and no user-editable form (`makeCrudRoute` supports `tenantField: null`; the current `feature_toggles/global` route instead uses `list.omitAutomaticTenantOrgScope`. These routes must explicitly enforce instance-wide feature grants).

- `GET /api/backups/runs` — feature `backups.view`. Query: `page`, `pageSize` (≤ 100), `status?`. Keyset pagination on `(created_at, id)`.
- `POST /api/backups/runs` — feature `backups.manage`. Triggers a manual backup: creates `backup_run(pending, trigger=manual)`, creates a ProgressJob under the caller's tenant (precedent: `catalog/api/bulk-delete/route.ts:54-56`), enqueues the backup job, returns `{ runId, progressJobId }`. Uses `runRouteMutationGuards()` from `@open-mercato/shared/lib/crud/route-mutation-guard` and its after-success path so registered and legacy guards both run.
- `GET /api/backups/status` — feature `backups.view`. Returns `{ lastCompletedAt, lastStatus, freshnessState: 'ok'|'stale'|'never', archiveCount, totalSizeBytes }`. Freshness threshold: `OM_BACKUP_FRESHNESS_HOURS` (default 26). Uncached in v1 (single indexed point query). This endpoint is the documented target for external uptime monitoring.

Errors: 401/403 per guards; 409 when a `backup_run` row is already `running` — single-flight is enforced by DB status. The queue supports coalescing, but queue coalescing alone does not serialize every API/CLI trigger against a running backup.

## CLI Contracts (`ModuleCli[]` in `cli.ts`)

Enterprise `agent_orchestrator/cli.ts` already registers module commands. Phase 1 still verifies `backups` CLI registry discovery (`modules.cli.generated.ts`) early.

- `mercato backups run [--label <text>]` — synchronous backup with progress output; exits non-zero on failure.
- `mercato backups list [--status <s>]` — archive inventory table.
- `mercato backups restore` — command arguments, empty-target restriction, artifact validation and resumable restoration are owned by `2026-11-06-cli-backup-restore.md`; the withdrawn `--force`/live-target design is not a second contract. After archive restoration succeeds, print that privacy replay has not been checked and direct the operator to `mercato data_erasure restore-status --refresh` and C9’s reviewed `restore-reapply` procedure for every restored tenant before reopening service. Emit `backups.restore.completed` with archive facts only. Return the backup engine’s exit status; no privacy pending count or distinct privacy exit code is computed here. C9 owns its status/replay exit codes and also works after a raw infrastructure restore. Without C9, require the controller’s external erasure register and replay procedure in the runbook; do not imply zero pending erasures. The runbook includes the #994 key-material caveat: another environment needs the relevant archive and tenant key material.
- `mercato backups verify` — use the engine's exact `--artifact`, `--trusted-manifest-sha256` and `--identity-file` contract for offline manifest/index/chunk verification; no scratch database. Download/stage the selected object-storage artifact first. Recovery checks use `mercato-backup exercise` with the engine's target confirmation, isolation, checks file and report contract. No `[runId]` overload or `OM_BACKUP_VERIFY_DATABASE_URL` is added. The bootstrap-free bin owns machine JSON/exit codes; `mercato backups` wrappers provide human output and map thrown failures through the existing dispatcher.

`pg_dump`/`pg_restore` connections follow the engine's native connection contract: libpq named services with private `PGSERVICEFILE`/`PGPASSFILE` and an allowlisted child environment, never URLs or passwords in argv and no connection-string/`DATABASE_URL` fallback. Binaries are version-checked at startup and `pg_dump_version` recorded per run. No user-controlled input is interpolated into argv.

## Workers & Scheduling

Two queue workers (standard `workers/*.ts` contract, both idempotent, total added concurrency 2 — within the worker `DB_POOL_MAX` invariant):

| Worker | Queue | Trigger | Concurrency |
|--------|-------|---------|-------------|
| `backup-run` | `backups:run` | scheduler / API / CLI | 1 (single-flight via DB status; CPU/IO heavy) |
| `retention` | `backups:retention` | scheduler | 1 |

Schedules: `OM_BACKUP_CRON` (default `0 2 * * *`), retention `0 4 * * *` — registered from `seedDefaults` (see coupling table). Jobs enqueued by the scheduler inherit queue defaults (attempts 3, exponential backoff) — acceptable because both workers are idempotent and `backup-run` is single-flight. `retention` deletes archives where `retention_expires_at < now`, marks rows `expired`, and sweeps orphaned multipart objects by prefix. Retention window: `OM_BACKUP_RETENTION_DAYS`, default 35 — this bounds product-managed archive age while the retention worker runs. It neither covers infrastructure copies nor proves post-restore erasure; C9 and the controller’s runbook govern that.

Backup pipeline: the engine's `createBackup` facade emits the chunked encrypted artifact and progress through its injectable adapters. Use `OM_BACKUP_RECIPIENTS_FILE` for public recipients; scheduled runs never select plaintext. Preserve its resumable journal, chunk/index/manifest digests, atomic seal and bounded streams; publish the complete artifact through the instance-owned chunk-store/storage adapter only after the engine seals it. Storage config remains env-only: `OM_BACKUP_S3_BUCKET/_REGION/_ENDPOINT/_ACCESS_KEY_ID/_SECRET_ACCESS_KEY` (or ambient IAM), consumed by a module-owned `createStorageService()` instance. No second encryption format or cipher stream is defined here. Artifact staging and adapter lifecycle must follow the engine's workspace/output bounds and cancellation contract.

## Security Considerations

- Archive encryption follows the engine's **Encryption** section: per-chunk/index age-v1 X25519 recipients, private identities only through `--identity-file`, separately escrowed. Record the recipient-set fingerprint, never a private identity. Retain old identities while any restorable archive needs them. Trusted manifest SHA-256 arrives independently; successful age decryption alone proves no sender provenance.
- Losing the identities loses archive readability. Status shows recipient-set identity only. Application DEKs/key versions and external secrets/assets require their own escrow and isolated exercise; an archive verification does not certify them.
- Restore endpoint does not exist over HTTP.
- No erasure manifest is written, trusted or listed by `backups`; artifact integrity still requires the engine's independently trusted manifest digest. External manifest security, holds and replay confirmation belong to C9/C3. Restore prints that privacy is unchecked; an archive success must not be shown as privacy clearance.
- `backup_run` is superadmin-only by ACL (see deviation callout). Native children use libpq named services, private `PGSERVICEFILE`/`PGPASSFILE` and an allowlisted environment under the engine's contract; no connection-string/`DATABASE_URL` fallback. `error_message` is sanitized.

## Failure Scenarios

| Scenario | Behavior |
|----------|----------|
| `pg_dump` exits non-zero / binary missing | Run `failed` with sanitized stderr excerpt; `backups.run.failed` emitted; freshness degrades to `stale` (external uptime check catches it) |
| S3 upload interrupted | Multipart upload aborted; run `failed`; partial objects cleaned by the retention worker (orphan sweep by prefix) |
| Backup overlaps previous run | Single-flight: second job sees a `running` row and no-ops with a log line |
| Scheduler module absent/disabled | No scheduled backups; boot logs a warning; status page shows "no schedule registered"; CLI and manual trigger unaffected |
| Archive corrupt (checksum mismatch) | Restore refuses before touching the target; `backups verify` prints the failure and exits non-zero |
| C9 absent or its status command cannot read external evidence after restore | Archive restore status remains separate; the printed step says privacy is unchecked. Keep traffic closed until the operator completes C9’s `restore-status --refresh` and reviewed replay or the controller’s external procedure; never infer an empty pending set |
| Worker process down for days | Freshness alert on status page + external uptime check; CLI `backups run` always available |

## Phasing & Implementation Plan

Each phase ends with a working application (`yarn generate && yarn typecheck && yarn test && yarn build:app` green). Estimated ~19 atomic commits: ~15 enterprise + 4 core-side (storage streaming ×3, MinIO test harness ×1) — all core commits ADDITIVE-ONLY.

### Phase 0 — Go/no-go gate
- **Gate A (hard, technical):** verify `pg_dump`/`pg_restore` presence and version compatibility on CI runner images and production containers. Minutes to check; invalidates the entire approach if it fails — do not write `backupService` before this passes.

### Phase 1 — Backup core path
1. Scaffold `packages/enterprise/src/modules/backups/` (index/acl/setup/di/events, i18n en+de+es+pl); register in **both** registration points — `enterprisePackage.modules` in `packages/enterprise/src/index.ts` (note: currently drifted, missing `system_status_overlays`; fix the drift in the same commit) and `apps/mercato/src/modules.ts` behind `OM_ENABLE_ENTERPRISE_MODULES` (+ `OM_ENABLE_ENTERPRISE_MODULES_BACKUPS`). Include a stub `cli.ts` and verify CLI registry discovery immediately. → verify: module loads, features sync, CLI command listed.
2. `backup_run` entity + module migration + snapshot. → verify: `yarn db:generate` output reviewed.
3. Additive **optional** `uploadStream`/`downloadStream` on `packages/storage-s3` (+ `@aws-sdk/lib-storage` dep; unit tests with mocked SDK). → verify: existing storage tests untouched and green.
4. `backupService` (engine `createBackup` facade → sealed chunked artifact → instance-owned storage adapter) + CLI `backups run` / `backups list`. → verify: manual backup against dev DB lands in MinIO/S3, row recorded, engine facade/adapter and interrupted-resume unit tests.

### Phase 2 — Restore & verification
5. CLI `backups restore` with safety rails; runbook notes for #994 key-material portability. → verify: scripted round-trip on scratch DB.
6. CLI `backups verify` delegates offline integrity verification; `exercise` performs scratch-target recovery checks with the engine's exact flags. → verify: corrupt chunk refuses and an own isolated exercise reports key/assets readiness separately.

### Phase 3 — Scheduling & retention
7. Schedule registration via `schedulerService.register()` upserts from `seedDefaults` (system scope, `targetType: 'queue'`, env-driven cron; soft-optional resolve). → verify: schedules appear in the scheduler admin UI; module boots cleanly with scheduler disabled.
8. `backup-run` and `retention` workers + `backups.*` events. → verify: retention deletes expired fixture archive; single-flight test.

### Phase 4 — Admin surface
9. API routes with openApi + `runRouteMutationGuards()` + ProgressJob wiring. → verify: route unit tests incl. 403 for non-superadmin and 409 single-flight.
10. Settings page `backend/settings/backups/page.tsx` (+ `page.meta.ts`, `requireFeatures: ['backups.view']`): freshness `<Alert>`/`<StatusBadge>`, `<DataTable>` inventory (stable `entityId`), "Run backup now" via `useGuardedMutation` + `apiCall`, ProgressTopBar, `<EmptyState>`; lucide icons; i18n keys. → verify: DS-guardian pass.

### Phase 5 — Restore boundary, test infra & docs
11. Print the independent privacy status/replay step after restore and document its C9/externally maintained alternatives. Add no manifest service, bucket reader or diff. Unit tests `restore-privacy-boundary.test.ts`: restored archive success prints privacy-unchecked guidance; no engine registered still prints it; backup exit status is independent; event has no computed pending count. → verify: no dependency on `data_erasure` or a manifest store.
12. Test infrastructure (core commit): MinIO container in the `packages/cli` integration harness (today it provisions Postgres only — `packages/cli/src/lib/testing/integration.ts:3557-3578`). → verify: harness boots MinIO locally and in CI.
13. E2E backup→restore round-trip test. Docs: `apps/docs/docs/deployment/backups.mdx` (setup, key escrow + rotation, restore runbook with the separate C9 status/replay step and #994 caveat, scheduler pointer incl. optional verify schedule, **and the in-app vs infra-level DR boundary**, plus independent trusted manifest digest, archive-identity/application-key custody and external-asset recovery from the open discussion). → verify: full suite + docs build.

### Integration test coverage
- API: `GET/POST /api/backups/runs` (auth, 403, trigger + progress, 409 single-flight), `GET /api/backups/status` (freshness states).
- UI: backups settings page (inventory render, manual trigger flow, freshness alert).
- E2E (CI, dockerized Postgres + MinIO): backup→restore round-trip. The test asserts the privacy-unchecked guidance, including when C9 is absent. The erase→backup→restore→replay E2E lives in C9, including crash/restore-before-repair and lost-event cases required by the program.
- All tests self-contained: fixtures created in setup via API where available, with an owned scratch database and unique object-storage prefix for CLI tests, cleaned in `finally`. Each API and backups settings-page test creates its own run fixtures and users; no demo data is required.

## Migration & Backward Compatibility

- The withdrawn manifest design was never implemented: removing its proposed DI key, bucket layout, event field and privacy exit code requires no runtime deprecation bridge. C9 owns the replacement design and its gates. New module and env vars only; no behavior changes when disabled (default: enterprise flag off). The storage-s3 extension is ADDITIVE-ONLY (optional interface members). Scheduler and queue consumed as-is. New DB tables via per-module migrations + snapshots.

## Risks & Impact Review

| Scenario | Severity | Affected area | Mitigation | Residual risk |
|---|---|---|---|---|
| Backup silently stops (worker dead, schedule never fires) | High | backup scheduling and freshness | Freshness state on status page + documented external uptime check on `/api/backups/status`; schedules visible in scheduler admin UI; on-demand `backups verify` | Operator without external monitoring notices only on the status page |
| Archive identity lost | High | archive decryptability | Engine identity-file escrow and retained old recipient-set identities, plus application-key and external-asset drills | Key loss irrecoverable by design |
| Restore executed against live DB by mistake | High | restore target database | The 11-06 engine’s empty-target restriction and confirmation rails; the withdrawn `--force`/live-target design is not implemented | Operator with raw `pg_restore` bypasses tooling — documented unsupported |
| Operator reopens a restored database before privacy replay | High | post-restore privacy readiness | Restore prints privacy-unchecked guidance and the separate C9 status/replay step; the runbook requires readiness verification before traffic returns | Human procedure is still bypassable; absent C9 needs an external register, and C9 assumption 9 and the OSS awaited `privacyErasureCompletionCapture.capture` / `verifiedAt` handoff remain explicit program gates |
| pg_dump version drift vs server / missing binaries | Medium | backup/restore tooling | Phase 0 Gate A before any code; version recorded per run; on-demand verify catches later drift | — |
| Large DB makes nightly dump heavy | Medium | database performance | Engine chunked bounded streams and resumability, worker concurrency 1, off-peak default schedule | Very large instances should use the infra-level DR track (documented boundary) |
| Cross-tenant exposure via instance-level backup surface | High | instance-wide archive API/UI | `backups.*` features superadmin-only; no tenant-facing routes; entity never wired into the query index | — |
| Operator trusts an old backup-bucket manifest or empty pending count | High | external replay evidence | No manifest reader or pending count remains here; all privacy status comes from C9’s independent mechanism | C9’s external evidence can be missing or expire; these are C9/controller risks, not backup success criteria |

## Final Compliance Report — 2026-07-08 (split)

The inherited report is historical where it refers to manifest ownership or the older engine. Current retained backup scope: instance-scoped `backup_run` deviation documented with compensating controls; custom routes justified with `runRouteMutationGuards()`; queue/scheduler consumed as-is (Σconcurrency +2); storage extension additive-only; i18n in four locales; integration coverage listed. Verdict: **approved for pre-implementation analysis** after Phase 0 Gate A, the 11-06 engine's Q2/Q3 security approvals and storage-adapter validation. Source checks confirm system/queue scheduler registration, Buffer-only storage and the Postgres-only CLI harness. No erasure-manifest contract remains. Restore’s separate privacy step and its unit/E2E coverage are specified above; C9’s approvals, durability and event-loss windows are not cleared here.

## Changelog

- 2026-07-08: Split from `2026-07-02-automated-backups-and-gdpr-erasure-propagation.md` (rev 5) — this file carries the backups module, the storage-streaming platform extension, and the erasure-manifest mechanism (contract + restore-time diff); the erasure producer, ledger, and GDPR framing live in [`2026-07-08-gdpr-data-erasure.md`](2026-07-08-gdpr-data-erasure.md). Added "Relation to infrastructure-level DR" recording the open core-team discussion (PR #3742): in-app = portable baseline + compliance surface; WAL/PITR IaC repo = complementary recommended upgrade track.
- Inherited history (combined spec): 2026-07-02 initial + full spec (PR #3742); 2026-07-03 rev 2 (gap-analysis corrections: scheduler adoption instead of queue extension, storage path via `createStorageService()`, DB-status single-flight) and rev 3 (market research applied); 2026-07-04 rev 4 (descoped above-market clusters: automated replay → guided re-run, verification worker → on-demand CLI, notification resolver removed, key-rotation slot removed) and rev 5 (executor+advisor review: `runMutationGuards()` citation fix, Phase 0 gates, edit-survivor sweep, `seedDefaults` mechanism); 2026-07-06 market references generalized to pattern descriptions.

### 2026-11-16
- Council round two fixes (GPT-6.1 Sol workers): r0-11 replaces every backup-manifest ownership, DI, schema, restore diff, event count, exit-code, failure, phase and risk instruction with the C9 boundary; preserves backup restore status separately and verifies current CLI, storage, scheduler and guard helpers.

- Council round two fixes, pass two (GPT-6.1 Sol workers): aligned retained backup scope with the 11-06 logical chunked age engine, recipient/identity custody, manifest digest, facade, offline verify versus recovery exercise and CLI flags; retained independent C9 replay readiness and reported stale manifest ownership in the engine spec.

- Council round two fixes, pass three (GPT-6.1 Sol workers): synchronized the C9 boundary with its awaited-capture design, assumption 9 and OSS verification-time dependency; required fresh status before reopening without mixing archive success and privacy readiness.

- Council round two fixes, pass four alignment (GPT-6.1 Sol workers): removed the resolved engine-manifest conflict and copied its libpq named-service/private-file/allowlisted-environment connection boundary; preserved archive-only status and the independent C9 runbook.
