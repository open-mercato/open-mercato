# Automated Database Backups & Restore (Enterprise)

> **Manifest design superseded in full (2026-11-16)** by [`2026-11-16-erasure-restore-replay.md`](GDPR/2026-11-16-erasure-restore-replay.md) (C9). This replaces every erasure-manifest provision: the TLDR/scope and ownership claim, Design Decisions, Architecture DI/diff, coupling row, event pending count, Erasure manifest data model, restore CLI post-step and distinct privacy exit code, Security, Failure Scenarios, Phase 5 manifest step, integration expectations, Risks and prior compliance claims. No `erasureManifestService`, bucket manifest or automatic restore-time diff is implemented from this file. Scheduling, backup storage, archive retention and UI remain here; artifact/restore mechanics follow the 11-06 engine below. C9’s own outstanding approvals and OSS awaited-capture/verification-time handoff remain gated by the program; its design now requires durable external evidence before protected completion.

> Split from `2026-07-02-automated-backups-and-gdpr-erasure-propagation.md` (rev 5) on 2026-07-08. Companion spec: [`2026-07-08-gdpr-data-erasure.md`](2026-07-08-gdpr-data-erasure.md) — July rationale only, now fully superseded by the OSS erase operation, enterprise governance and C9 replay carriers.

> Backup engine and operator CLI: [Resumable Encrypted PostgreSQL Backup and Restore CLI](2026-11-06-cli-backup-restore.md) (enterprise `backups` module). It owns the logical whole-database, chunked, resumable, age-encrypted artifact, per-entity progress and `create/verify/restore/exercise` commands. This spec retains scheduling, object storage, archive retention and UI, consuming its `createBackup`, `verifyBackup`, `restoreBackup` and `exerciseBackup` facade. The old single-stream AES-GCM/`OM_BACKUP_ENCRYPTION_KEY` and live-target designs are withdrawn throughout this file. C9 independently owns erasure manifests and replay; the engine now preserves that same independent runbook boundary and archive-only exit status.

## TLDR
**Key Points:**
- Enterprise module `backups`: scheduled encrypted logical whole-database backups to object storage, resumable CLI restore, bounded archive retention, offline verification and isolated recovery exercises, superadmin status page.
- Restore reports archive restoration only. Its runbook points to C9’s independent `mercato data_erasure restore-status --refresh --require-clear` and reviewed `restore-reapply` procedure before reopening service. A successful backup restore does not certify that erasures have been reapplied.
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
operator → reviewed C9 restore-reapply → C9 restore-status --refresh --require-clear
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

Instance-scoped operational record. **Deviation callout:** no `tenant_id` / `organization_id` — a logical whole-database archive is inherently cross-tenant. Precedent for instance-scoped entities exists (`FeatureToggle`, `Tenant`); no generator or CI mechanism mandates tenancy columns. Compensating controls: the entity is reachable only through `backups.*`-gated API/UI that also requires super-administrator status in every handler (features granted to superadmin only by default, precedent: `feature_toggles.global.manage`; super-administrator check precedent: `directory/api/tenants`), never through tenant-facing surfaces, and is never wired into the query index (indexing is opt-in via `indexer: { entityType }`, which this entity simply does not declare).

- `id`: uuid PK
- `status`: enum `pending | running | completed | failed | expired | deleted`
- `trigger`: enum `schedule | manual | cli`
- `triggered_by_user_id`: uuid, nullable (manual/API triggers)
- `started_at`, `finished_at`: timestamptz, nullable
- `size_bytes`: bigint, nullable
- `recovery_publication_state`: `not_configured` | `pending` | `published` and nullable `recovery_published_at`; initialized atomically with the winning sealed archive row. Only a verified external publication sets `published`.
- `checksum_sha256`: text, nullable (the engine's trusted `manifestSha256` for the complete artifact; per-chunk digests remain in its index)
- `storage_key`: text, nullable
- `pg_dump_version`: text, nullable
- `recipient_set_fingerprint`: text, nullable (the engine manifest's `encryption.recipientSetFingerprint`; identifies the archive recipients without storing a private identity)
- `retention_expires_at`: timestamptz, nullable
- `error_message`: text, nullable (sanitized — no connection-string echo)
- `heartbeat_at`: timestamptz, initialized on creating the pending row and renewed by its active holder. `lease_expires_at`: timestamptz, initialized at insert from database time. `owner_generation`: random UUID for the processing claim; workers update the row only for their current generation and before the deadline.
- `created_at`, `updated_at` (system-managed entity; not user-editable, so the optimistic-locking UI contract does not apply — background-job rows are explicitly exempt per `packages/core/AGENTS.md`)

Indexes: `(status, created_at)` for the status page; `(retention_expires_at)` partial where status = 'completed' for the retention sweep; unique `backup_run_single_flight_uq` on `((true))` partial where status in ('pending', 'running') for single-flight. Expected cardinality ~365–1100 rows/year; point lookups and short range scans only.

### Erasure manifest — successor only

No erasure-manifest object, schema or DI key remains in `backups`; the engine's artifact `manifest.json` is unrelated. C9’s Data Models and API Contracts own the external manifest. Its directory must be outside the database and its backups. Do not create the withdrawn `data-erasure-manifest/` bucket prefix from this historical spec.

## API Contracts

All routes export `metadata` with per-method `requireAuth: true` + `requireFeatures`, plus `openApi` definitions. No restore endpoint exists. Custom routes are justified: instance-scoped entity with no tenant filter and no user-editable form (`makeCrudRoute` supports `tenantField: null`; the current `feature_toggles/global` route instead uses `list.omitAutomaticTenantOrgScope`). **Authorization rule:** every backups route both declares its `requireFeatures` and, inside the handler before any read or write, calls `requireSuperAdmin` from `packages/core/src/modules/auth/lib/tenantAccess.ts` (precedent: `directory/api/tenants/route.ts`, which checks `resolveIsSuperAdmin` for the same instance-wide reason). A tenant administrator who holds `backups.*` through a grant is still refused with 403; the ACL grant ceiling (`auth/lib/grantChecks.ts`) is a second layer, not the control. The manual-trigger service entry point used by the API receives the already authorized actor and re-asserts super-administrator status; the CLI runs with operator host credentials and has no HTTP actor.

- `GET /api/backups/runs` — feature `backups.view` plus super-administrator. Query: `page`, `pageSize` (≤ 100), `status?`. Keyset pagination on `(created_at, id)`.
- `POST /api/backups/runs` — feature `backups.manage` plus super-administrator. Triggers a manual backup through `backupService.startRun({ trigger: 'manual' })`, which creates `backup_run(pending, trigger=manual)` under the single-flight guard below, creates a ProgressJob under the caller's tenant (precedent: `catalog/api/bulk-delete/route.ts:54-56`), enqueues the backup job, returns `{ runId, progressJobId }`. Uses `runRouteMutationGuards()` from `@open-mercato/shared/lib/crud/route-mutation-guard` and its after-success path so registered and legacy guards both run.
- `GET /api/backups/status` — feature `backups.view` plus super-administrator. Returns `{ lastCompletedAt, lastStatus, freshnessState: 'ok'|'stale'|'never', recoveryPublicationState: 'not_configured'|'pending'|'published', archiveCount, totalSizeBytes }`. Freshness uses only published archives when independent inventory is configured. An archive sealed but still pending is shown separately and cannot advance `lastCompletedAt`, freshness or a recovery-ready indicator. Without inventory, report an explicitly local archive status and `not_configured`. Freshness threshold: `OM_BACKUP_FRESHNESS_HOURS` (default 26). Uncached in v1 (single indexed point query). This endpoint is the documented target for external uptime monitoring.

Errors: 401/403 per guards (403 for an authenticated non-super-administrator, whatever features it holds); 409 when a backup is already pending or running.

**Single-flight.** One installation-wide guard covers the scheduled, HTTP and `mercato backups run` entry points. The partial unique index on active status remains the concurrency backstop. In one transaction `startRun` locks the active row and reclaims expired pending as well as expired running rows, initializing `heartbeat_at`, `lease_expires_at=now()+10 minutes` and `owner_generation` before enqueue. For historical null pending heartbeats, expire from `created_at + 10 minutes`. Known enqueue failure conditionally marks the same generation failed; an ambiguous dispatch leaves it recoverable at its deadline. The worker claims only the matching pending generation; old deliveries exit without publishing. Heartbeats renew every 60 seconds using database time and a conditional update matching the generation and live deadline. Failure to renew stops that holder.

Workers write only to per-run, per-generation object prefixes while sealing. A conditional terminal SQL update with the same generation and live deadline records the trusted manifest digest, sealed prefix and immutable recovery record inputs. If independent inventory is configured, that same transaction writes `recovery_publication_state='pending'`. It is durable outbox work even though the archive state is locally complete. A displaced worker cannot publish an archive, emit completion, delete a newer holder's work or mutate its record. A known or ambiguous commit is reread by scope and winning generation before any publication.

The startup and scheduled retention/maintenance worker and explicit same-run retry scan outstanding terminal winners in bounded keyset batches and retry publication without recreating the archive or allocating a new run. Verify sealed-prefix manifest bytes against the recorded trusted digest, then create the immutable authenticated external record by run id with conditional create. For an ambiguous timeout read it independently and verify exact canonical data, generation and digest; an identical record is success, a mismatched record or unavailable read is a reported retryable failure and never overwritten. Once externally readable, verified and included in the independently authenticated inventory head, conditionally set `published` and its timestamp. A standalone signed object without committed inventory membership remains pending. A crash after either commit or external put is idempotent. Keep the sealed archive and record inputs while pending; retention must not remove pending work or race active publishing. Only published archives advance independent-recovery freshness and emit the configured completion outcome. Report publication failures promptly and keep retrying without hiding older published archives. The external inventory selects the newest non-retired member by committed archive completion time and stable run-id tie-breaker only after verifying a complete pinned inventory view. There is no mutable latest-archive pointer; the separate monotonic authenticated inventory head below is mandatory to prove membership and omissions. Configurations without the independent inventory disclose that no independent recovery readiness is established.

### Independent recovery inventory contract

Enterprise `backups` owns DI `backupRecoveryInventory`, its offline reader and the canonical record codec; storage adapters implement conditional immutable put/read, bounded immutable log reads and linearizable compare-and-swap of the inventory head, not authenticity policy. The independent recovery authority owns head publication and fresh head attestations. Configure an independent `OM_BACKUP_RECOVERY_INVENTORY_URI`, a deployment identity, a signing-key reference and a pinned verification-keyring file outside the source database/archive failure domain. No implicit database or same-volume fallback is permitted. An adapter is ready only after conditional-create, strong read-after-write, linearizable head publication, complete pinned-view pagination, a live independent head-attestation endpoint and independently retained keyring checks pass. A plain object-store listing with individually valid signatures is insufficient. Record configuration identity, never credentials.

Version 1 records contain only `{ schemaVersion: 1, deploymentId, sourceIdentityDigest, runId, generation, completedAt, archiveLocator, manifestSha256, consistency, keyId }`. `archiveLocator` is an opaque provider object key, never a signed URL or credential. Validate a closed schema; sign domain-separated canonical JSON bytes (the C9 canonical/signing utility with purpose `backup-recovery-record:v1`, never an erasure-record purpose) and wrap them with the signature. A record is immutable at `deploymentId/runId`; conflicting bytes refuse, identical bytes are idempotent. The verifier pins deployment, source identity, permitted algorithm and key id from operator-controlled trust, checks signature and manifest digest, and never trusts an embedded public key. Signing rotation publishes the new verification key before use; old verification keys remain until every referencing record/archive is retired. Private keys remain in the approved secret provider, outside records and flags.

**Authenticated inventory membership.** Both archive publications and retirements append to one deployment/source-scoped immutable ordered log. Each entry binds `{ sequence, kind: 'archive'|'retirement', recordSha256, previousEntrySha256 }`; the signed head binds `{ schemaVersion: 1, deploymentId, sourceIdentityDigest, revision, baseCheckpointSha256, entryCount, lastEntrySha256 }` using purpose `backup-recovery-head:v1`. A newly commissioned deployment has an explicitly signed zero-entry genesis head; a missing head is unavailable, never an empty inventory. Initialize it once under conditional creation, and never reset its revision after records exist. Store immutable log entries by their content digest, with sequence inside the authenticated entry rather than using one immutable storage key per sequence. Competing entries can coexist as unreferenced candidates; only the CAS winner becomes a member. Publish object bytes first, then atomically compare-and-swap the preceding head to the next signed revision. A crash after a candidate write cannot reserve or wedge a sequence; retry can reuse identical bytes or publish a different digest-addressed candidate against the current head. Duplicate retries locate the same exact record digest and membership; competing publishers retry from the winning head, never fork or overwrite a committed entry. Unreferenced objects are not inventory members and cannot advance freshness. Publication is complete only after independent readback verifies bytes and membership under the committed head. A retirement's membership must commit before archive deletion.

The deployment's independently configured recovery authority exposes `readHead({ deploymentId, sourceIdentityDigest, challenge })`. It performs a linearizable read and signs the head digest, fresh unpredictable caller challenge and a short validity bound under the separate purpose `backup-recovery-head-attestation:v1`. Verification keys and accepted purposes are pinned in the operator keyring; embedded keys are never trusted. A stored signed head alone cannot prove freshness: source-offline recovery requires this independent authority, or an operator-pinned head explicitly reported as historical/unknown-current-completeness and ineligible for automatic newest-archive selection. A replayed older head, wrong challenge, expired attestation or unavailable authority fails closed. The authority is outside the source database and archive failure domain; losing that authority is a disclosed recovery dependency, not permission to trust a partial listing.

The owner interface is `putIfAbsent(record): Promise<{ state: 'created'|'identical'; membership: VerifiedMembership }>`, `get({ deploymentId, runId, view }): Promise<VerifiedRecoveryRecord | null>`, `openView({ deploymentId, sourceIdentityDigest, challenge }): Promise<VerifiedInventoryView>` and `list({ view, after?, limit }): Promise<{ entries: VerifiedInventoryEntry[]; next?: string }>` with 1–100 entries, cursors bound to the head digest and explicit unavailable/invalid errors. The adapter returns bytes; only the owner verifier returns verified types. The authority atomically selects the current authenticated head and grants a scoped view lease, serialized with compaction/head publication. A view pins that head revision, count, chain endpoint, lease id and expiry. Every page and `--after` cursor binds those values; lease renewal is serialized with compaction before any page read. An expired, missing or unrenewable lease refuses and requires a fresh view rather than continuing against potentially retired pages. Readers verify every sequential entry and referenced record back to the authenticated base. Missing/duplicated/out-of-order entries, a premature terminal page, a changed page view or a hidden retirement/newest record makes completeness false and exits non-zero. A single page is `pageVerified: true`, not `complete: true`; completion requires all pinned members. Before automatic newest selection, refresh the challenged head and require it to match the fully traversed view, otherwise restart at the new head. Report the selected view/revision as the exact as-of boundary; future publications cannot be predicted.

`mercato-backup recovery-list --inventory-config <file> --deployment <id> [--after <cursor>] [--limit <1..100>]` is bootstrap-free and uses that codec, authority and keyring without source SQL access. Its JSON exposes verified archive facts, view revision and `completeness: 'page_only'|'complete'|'unknown'`. It never claims a newest archive from a partial or historical-only view. Inventory compaction cannot truncate the chain silently: an authority-signed immutable base checkpoint must authenticate a complete paged snapshot of every still-live archive and every retirement required by the recovery-evidence window, with page digests/counts and the replaced head digest. Publish that checkpoint under a new CAS head only after complete readback and before removing covered obsolete log objects. Active view leases and outstanding publication/restore references pin their head/base until released or verifiably expired under the same authority clock; lease acquisition, renewal and expiry checks serialize with the final compaction deletion admission so pages cannot be removed underneath a valid reader. Missing lease proof prevents cleanup. The same complete-view verifier handles initial and compacted inventories.

Archive retention publishes an authenticated immutable retirement record referencing the exact original digest before deleting its archive; retirement is durable, retryable and independently listable. Never delete pending publication or active retirement work. Retain the recovery and retirement records at least through the archive policy and the independently configured recovery-evidence window; key removal/record cleanup requires a complete inventory proof with no outstanding publication or restore reference. Offline selection uses only the complete current authenticated view and excludes archives with authenticated retirement membership in that view, then selects by committed completion time/run id. Test database-offline lookup, forged or conflicting records, key rollover, ambiguous object put/head CAS, unavailable authority/listing, interrupted retirement and published freshness. Hide the newest archive, hide a retirement, truncate an apparently valid final page, replay an older correctly signed head, interleave a new publication between pages, race view acquisition/renewal against compaction, use a cursor after lease expiry, and crash each side of digest-addressed candidate publication/head CAS/compaction: no case may return a false complete view or automatically select an invalid newest archive. These are Phase 3 release gates.

## CLI Contracts (`ModuleCli[]` in `cli.ts`)

Enterprise `agent_orchestrator/cli.ts` already registers module commands. Phase 1 still verifies `backups` CLI registry discovery (`modules.cli.generated.ts`) early.

- `mercato backups run [--label <text>]` — synchronous backup with progress output, run in-process through `backupService.startRun({ trigger: 'cli' })` and the same single-flight guard (it does not enqueue); exits non-zero on failure or when another backup is active.
- `mercato backups list [--status <s>]` — archive inventory table.
- `mercato backups restore` — command arguments, empty-target restriction, artifact validation and resumable restoration are owned by `2026-11-06-cli-backup-restore.md`; the withdrawn `--force`/live-target design is not a second contract. After archive restoration succeeds, print that privacy replay has not been checked and direct the operator to `mercato data_erasure restore-status --refresh --require-clear` and C9’s reviewed `restore-reapply` procedure for every restored tenant before reopening service. A verified snapshot outside C9’s independently retained coverage, an unknown snapshot or unavailable evidence requires external reconciliation before traffic. The backup wrapper does not certify clearance. Also print the restored archive completion time as provenance only. Print the authenticated archive's earliest independently attested conservative source-snapshot lower bound if C9 verification requirements are met, or explicitly report it unavailable. Archive `startedAt` is provenance only without verified uncertainty and chronology across epochs, with the static reminder that a snapshot older than C9's erasure replay window (`OM_ERASURE_MANIFEST_RETENTION_DAYS`, default 90 days) cannot be fully replayed; the variable is named in the text, never read or parsed. Emit `backups.restore.completed` with archive facts only. Return the backup engine’s exit status; no privacy pending count or distinct privacy exit code is computed here. C9 owns its status/replay exit codes and also works after a raw infrastructure restore. Without C9, require the controller’s external erasure register and replay procedure in the runbook; do not imply zero pending erasures. The runbook includes the #994 key-material caveat: another environment needs the relevant archive and tenant key material.

For protected privacy cutover, C9 accepts archive provenance only for `single-snapshot` or independently verified `quiesced` consistency. A mixed-epoch archive may restore successfully for disaster recovery and still be ineligible. Output distinguishes this from C9 clearance, even when all archived epochs have verified times. Backup does not query privacy rows.
- `mercato backups verify` — use the engine's exact `--artifact`, `--trusted-manifest-sha256` and `--identity-file` contract for offline manifest/index/chunk verification; no scratch database. Download/stage the selected object-storage artifact first. Recovery checks use `mercato-backup exercise` with the engine's target confirmation, isolation, checks file and report contract. No `[runId]` overload or `OM_BACKUP_VERIFY_DATABASE_URL` is added. The bootstrap-free bin owns machine JSON/exit codes; `mercato backups` wrappers provide human output and map thrown failures through the existing dispatcher.

`pg_dump`/`pg_restore` connections follow the engine's native connection contract: libpq named services with private `PGSERVICEFILE`/`PGPASSFILE` and an allowlisted child environment, never URLs or passwords in argv and no connection-string/`DATABASE_URL` fallback. Binaries are version-checked at startup and `pg_dump_version` recorded per run. No user-controlled input is interpolated into argv.

## Workers & Scheduling

Two queue workers (standard `workers/*.ts` contract, both idempotent, total added concurrency 2 — within the worker `DB_POOL_MAX` invariant):

| Worker | Queue | Trigger | Concurrency |
|--------|-------|---------|-------------|
| `backup-run` | `backups:run` | scheduler / API | 1 (single-flight via the partial unique index; CPU/IO heavy) |
| `retention` | `backups:retention` | scheduler | 1 |

Schedules: `OM_BACKUP_CRON` (default `0 2 * * *`), retention `0 4 * * *` — registered from `seedDefaults` (see coupling table). Jobs enqueued by the scheduler inherit queue defaults (attempts 3, exponential backoff) — acceptable because both workers are idempotent and `backup-run` is single-flight. `retention` deletes archives where `retention_expires_at < now`, marks rows `expired`, and sweeps orphaned multipart objects by prefix. Retention window: `OM_BACKUP_RETENTION_DAYS`, default 35 — this bounds product-managed archive age while the retention worker runs. It neither covers infrastructure copies nor proves post-restore erasure; C9 and the controller’s runbook govern that. An archive older than C9's settled-manifest window (`OM_ERASURE_MANIFEST_RETENTION_DAYS`, default 90) can predate manifest files C9 has already pruned, so erasures recorded only in those files cannot be replayed after restoring it. Keep `OM_BACKUP_RETENTION_DAYS` below that window. C9 owns the configuration-tier doctor check `data_erasure.backup_retention_exceeds_replay_window`, which reads both variables and warns when `backups` is enabled and the backup window is at or above the manifest window; `backups` imports and parses nothing of C9's. The runbook states the rule, and restore output prints the restored archive's age with a static reminder that archives older than the erasure replay window cannot be fully replayed.

Backup pipeline: the engine's `createBackup` facade emits the chunked encrypted artifact and progress through its injectable adapters. Use `OM_BACKUP_RECIPIENTS_FILE` for public recipients; scheduled runs never select plaintext. Preserve its resumable journal, chunk/index/manifest digests, atomic seal and bounded streams; publish the complete artifact through the instance-owned chunk-store/storage adapter only after the engine seals it. Storage config remains env-only: `OM_BACKUP_S3_BUCKET/_REGION/_ENDPOINT/_ACCESS_KEY_ID/_SECRET_ACCESS_KEY` (or ambient IAM), consumed by a module-owned `createStorageService()` instance. No second encryption format or cipher stream is defined here. Artifact staging and adapter lifecycle must follow the engine's workspace/output bounds and cancellation contract.

## Security Considerations

- Archive encryption follows the engine's **Encryption** section: per-chunk/index age-v1 X25519 recipients, private identities only through `--identity-file`, separately escrowed. Record the recipient-set fingerprint, never a private identity. Retain old identities while any restorable archive needs them. Trusted manifest SHA-256 arrives independently; successful age decryption alone proves no sender provenance.
- Losing the identities loses archive readability. Status shows recipient-set identity only. Application DEKs/key versions and external secrets/assets require their own escrow and isolated exercise; an archive verification does not certify them.
- Restore endpoint does not exist over HTTP.
- No erasure manifest is written, trusted or listed by `backups`; artifact integrity still requires the engine's independently trusted manifest digest. External manifest security, holds and replay confirmation belong to C9/C3. Restore prints that privacy is unchecked; an archive success must not be shown as privacy clearance.
- `backup_run` is superadmin-only: feature gate plus `requireSuperAdmin` in every route (see API Contracts). Native children use libpq named services, private `PGSERVICEFILE`/`PGPASSFILE` and an allowlisted environment under the engine's contract; no connection-string/`DATABASE_URL` fallback. `error_message` is sanitized.

## Failure Scenarios

| Scenario | Behavior |
|----------|----------|
| `pg_dump` exits non-zero / binary missing | Run `failed` with sanitized stderr excerpt; `backups.run.failed` emitted; freshness degrades to `stale` (external uptime check catches it) |
| S3 upload interrupted | Multipart upload aborted; run `failed`; partial objects cleaned by the retention worker (orphan sweep by prefix) |
| Backup overlaps previous run | Single-flight: the second start hits `backup_run_single_flight_uq`; a scheduled job no-ops with a log line, the API answers 409 and the CLI exits non-zero |
| A backup process dies before receiving its job or while running | Its pending or running lease expires; the next start conditionally marks the old generation failed. A paused former holder cannot renew or publish after takeover. |
| `OM_BACKUP_RETENTION_DAYS` at or above C9's manifest window | C9's doctor check warns; restore output reminds that older archives cannot be fully replayed |
| Scheduler module absent/disabled | No scheduled backups; boot logs a warning; status page shows "no schedule registered"; CLI and manual trigger unaffected |
| Archive corrupt (checksum mismatch) | Restore refuses before touching the target; `backups verify` prints the failure and exits non-zero |
| C9 absent or its status command cannot read external evidence after restore | Archive restore status remains separate; the printed step says privacy is unchecked. Keep traffic closed until the operator completes reviewed replay and C9’s `restore-status --refresh --require-clear` or the controller’s external procedure; never infer an empty pending set |
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
8. Deliver the independent authenticated log/head authority, pinned-view codec and offline reader before enabling recovery publication. Test omission, stale-head and pagination cases from the independent inventory contract, including compaction and post-scan head revalidation. Test recovery-inventory publication with a crash immediately after the winning SQL update, independent database-offline lookup before/after reconciliation, ambiguous external put, duplicate publishers, mismatched existing records, and expiry trying to delete pending staging. Only verified publication may advance external recovery freshness. Add `backup-run` and `retention` workers + `backups.*` events, `startRun` with the single-flight index and heartbeat. → verify: retention deletes expired fixture archive; `single-flight.test.ts` starts API, CLI and worker triggers concurrently against a real database and proves exactly one active row, 409 / non-zero exit / no-op for the others, and stale-owner recovery after a missed heartbeat. Inject lost enqueue after insert, a legacy null heartbeat and a paused old holder resuming after takeover; prove no superseded artifact, trusted metadata or completion event is published.

### Phase 4 — Admin surface
9. API routes with openApi + `runRouteMutationGuards()` + ProgressJob wiring + `requireSuperAdmin` in every handler. → verify: route unit tests incl. 403 for a non-super-administrator who holds `backups.view`/`backups.manage`, 200 for a super-administrator, and 409 single-flight.
10. Settings page `backend/settings/backups/page.tsx` (+ `page.meta.ts`, `requireFeatures: ['backups.view']`). Page metadata has no super-administrator gate, so the page gates its own content on the same rule as the routes: it loads `GET /api/backups/status` first, and on 403 renders only a localized `<ErrorMessage>` access-denied state, with no inventory, trigger or freshness widgets and no further calls. Setup grants `backups.view` only to super-administrators by default, so the menu entry reaches a non-super-administrator only through an explicit grant. Content: freshness `<Alert>`/`<StatusBadge>`, `<DataTable>` inventory (stable `entityId`), "Run backup now" via `useGuardedMutation` + `apiCall`, ProgressTopBar, `<EmptyState>`; lucide icons; i18n keys. → verify: DS-guardian pass.

### Phase 5 — Restore boundary, test infra & docs
11. Print the independent privacy status/replay step after restore and document its C9/externally maintained alternatives. Add no manifest service, bucket reader or diff. Unit tests `restore-privacy-boundary.test.ts`: restored archive success prints privacy-unchecked guidance; it prints the verified conservative snapshot bound only when trusted snapshot provenance establishes it, alongside completion time and the static replay-window reminder. Test unknown bound when provenance is absent and a privacy-ineligible warning for a restored `multi-snapshot` archive, without reading `OM_ERASURE_MANIFEST_RETENTION_DAYS`; no engine registered still prints it; backup exit status is independent; event has no computed pending count. → verify: no dependency on `data_erasure` or a manifest store.
12. Test infrastructure (core commit): MinIO container in the `packages/cli` integration harness (today it provisions Postgres only — `packages/cli/src/lib/testing/integration.ts:3557-3578`). → verify: harness boots MinIO locally and in CI.
13. E2E backup→restore round-trip test. Docs: `apps/docs/docs/deployment/backups.mdx` (setup, key escrow + rotation, restore runbook with the separate C9 status/replay step and #994 caveat, archive retention below C9's replay window, scheduler pointer for the backup and retention schedules — scheduled verify/exercise stays deferred until a safe command/worker bridge exists, **and the in-app vs infra-level DR boundary**, plus independent trusted manifest digest, archive-identity/application-key custody and external-asset recovery from the open discussion). → verify: full suite + docs build.

### Integration test coverage
- API: `GET/POST /api/backups/runs` (auth, 403 for a non-super-administrator holding the features, trigger + progress, 409 single-flight including a concurrent CLI start), `GET /api/backups/status` (freshness states).
- UI: backups settings page (inventory render, manual trigger flow, freshness alert), and a non-super-administrator granted `backups.view` sees only the access-denied state with no inventory or trigger.
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
| Cross-tenant exposure via instance-level backup surface | High | instance-wide archive API/UI | Every route requires its `backups.*` feature and `requireSuperAdmin`; no tenant-facing routes; entity never wired into the query index | — |
| A valid signed subset hides a newer archive or retirement | High | independent recovery selection | Authenticated log membership, challenged current head, complete pinned-view verification and head recheck; never infer completeness from listed signatures | Independent authority outage blocks automatic selection; a pinned historical view has unknown current completeness |
| Two backups run at once | Medium | database load and archive inventory | One partial unique index on active rows, used by every trigger through `startRun`, with heartbeat-based stale-owner recovery | A holder that stalls without dying keeps the slot until it fails |
| A restored archive predates C9's replay window | High | post-restore erasure replay | Keep archive retention below the manifest window; C9's doctor check warns on the misconfiguration; runbook and restore output state it | Infrastructure copies outside this module remain the controller's responsibility |
| Operator trusts an old backup-bucket manifest or empty pending count | High | external replay evidence | No manifest reader or pending count remains here; all privacy status comes from C9’s independent mechanism | C9’s external evidence can be missing or expire; these are C9/controller risks, not backup success criteria |

## Final Compliance Report — 2026-07-08 (split)

The inherited report is historical where it refers to manifest ownership or the older engine. Current retained backup scope: instance-scoped `backup_run` deviation documented with compensating controls; custom routes justified with `runRouteMutationGuards()`; queue/scheduler consumed as-is (Σconcurrency +2); storage extension additive-only; i18n in four locales; integration coverage listed. Verdict: **approved for pre-implementation analysis** after Phase 0 Gate A, the 11-06 engine's Q2/Q3 security approvals and storage-adapter validation. Source checks confirm system/queue scheduler registration, Buffer-only storage and the Postgres-only CLI harness. No erasure-manifest contract remains. Restore’s separate privacy step and its unit/E2E coverage are specified above; C9’s approvals, durability and event-loss windows are not cleared here.

## Changelog

### 2026-11-20 — Independent inventory completeness

- Require authenticated monotonic archive/retirement membership, fresh independent head attestation, complete pinned-view pagination and safe checkpoint compaction before claiming independent recovery completeness or newest-archive selection. Extend publication/retirement and Phase 3 failure tests; this revision changes specifications only.

### 2026-11-19 — Confirmed spec review corrections

- Resolve the confirmed recovery, fencing and lifecycle contract findings; add the corresponding failure and acceptance cases. This is a design revision only.


### 2026-11-18

- Fenced backup claim recovery against lost enqueue and stale owners, and separated archive completion time from the protected-recovery snapshot bound.

- 2026-07-08: Split from `2026-07-02-automated-backups-and-gdpr-erasure-propagation.md` (rev 5) — this file carries the backups module, the storage-streaming platform extension, and the erasure-manifest mechanism (contract + restore-time diff); the erasure producer, ledger, and GDPR framing live in [`2026-07-08-gdpr-data-erasure.md`](2026-07-08-gdpr-data-erasure.md). Added "Relation to infrastructure-level DR" recording the open core-team discussion (PR #3742): in-app = portable baseline + compliance surface; WAL/PITR IaC repo = complementary recommended upgrade track.
- Inherited history (combined spec): 2026-07-02 initial + full spec (PR #3742); 2026-07-03 rev 2 (gap-analysis corrections: scheduler adoption instead of queue extension, storage path via `createStorageService()`, DB-status single-flight) and rev 3 (market research applied); 2026-07-04 rev 4 (descoped above-market clusters: automated replay → guided re-run, verification worker → on-demand CLI, notification resolver removed, key-rotation slot removed) and rev 5 (executor+advisor review: `runMutationGuards()` citation fix, Phase 0 gates, edit-survivor sweep, `seedDefaults` mechanism); 2026-07-06 market references generalized to pattern descriptions.

### 2026-11-16
- Council round two fixes (GPT-6.1 Sol workers): r0-11 replaces every backup-manifest ownership, DI, schema, restore diff, event count, exit-code, failure, phase and risk instruction with the C9 boundary; preserves backup restore status separately and verifies current CLI, storage, scheduler and guard helpers.

- Council round two fixes, pass two (GPT-6.1 Sol workers): aligned retained backup scope with the 11-06 logical chunked age engine, recipient/identity custody, manifest digest, facade, offline verify versus recovery exercise and CLI flags; retained independent C9 replay readiness and reported stale manifest ownership in the engine spec.

- Council round two fixes, pass three (GPT-6.1 Sol workers): synchronized the C9 boundary with its awaited-capture design, assumption 9 and OSS verification-time dependency; required fresh status before reopening without mixing archive success and privacy readiness.

- Council round two fixes, pass four alignment (GPT-6.1 Sol workers): removed the resolved engine-manifest conflict and copied its libpq named-service/private-file/allowlisted-environment connection boundary; preserved archive-only status and the independent C9 runbook.

### 2026-11-17
- Backups routes use one stated authorization rule: feature gate plus `requireSuperAdmin` in every handler, matching the 403 test.
- Single-flight is an installation-wide partial unique index on active `backup_run` rows used by every trigger through `startRun`, with a heartbeat and stale-owner recovery; the CLI runs in-process; concurrent-start tests added.
- Archive retention is stated against C9's settled-manifest window, with a C9-owned doctor check and runbook/restore reminders; the Phase 5 docs step no longer documents a deferred verify schedule.
- `mercato backups restore` prints the restored archive's age and the static replay-window reminder, asserted in `restore-privacy-boundary.test.ts`. The settings page shows only an access-denied state to a non-super-administrator holding `backups.view`, covered by the UI integration case.

- 2026-11-18 review fixes: reconcile durable pending external recovery inventory publication and expose only verified conservative restore bounds to the protected cutover procedure.
- 2026-11-18 review remediation: align the restore acceptance cases with attested snapshot bounds and flag multi-snapshot archives as ineligible for protected privacy cutover.
