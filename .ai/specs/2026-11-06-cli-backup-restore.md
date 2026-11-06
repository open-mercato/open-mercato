# Manual PostgreSQL Backup and Restore CLI

## TLDR

**Proposal, not implementation.** Give instance operators one OSS CLI lifecycle to create a complete PostgreSQL logical backup, check it offline, restore it into an empty isolated database, and exercise recovery. Use native PostgreSQL tools, bounded resources, immutable completion, separately escrowed secrets, and explicit target confirmation. Enterprise scheduled backups reuse the same primitives; no second backup module, scheduler, storage service, rotation verifier, or admin UI is proposed.

Status: design ready for review; security direction gates below prevent treating this as implementation approval. This PR changes specifications only.

## Resolved assumptions (autonomous defaults)

| Question | Chosen default | Rationale / override condition |
|---|---|---|
| Q1: One capability or independent backup/rotation projects? | One manual backup/recovery lifecycle, including preflight, artifact verification, and roundtrip exercise. Rotation integrity verification is a separate planned consumer. | All commands operate on the same recovery artifact and safety contract. No general encryption audit or rotation engine. |
| Q2: Archive encryption container? | Propose the external `age` CLI with native recipient identities, not a custom archive cipher. No silent plaintext mode. | Standard streaming container; no reviewed general-purpose archive primitive was established by the bounded repository inspection. **⚠ NEEDS HUMAN CONFIRMATION:** security maintainer must approve the tool, supported release range, deployment packaging, recipient custody, and enterprise format convergence before implementation. Nothing here approves a dependency or a new cipher protocol. |
| Q3: Key custody and completion? | Backup completion proves artifact creation; recoverability additionally requires independent data-key escrow evidence and an isolated exercise. | Root secret is not a tenant DEK. **⚠ NEEDS HUMAN CONFIRMATION:** security owner must approve the deployment-specific data-key/version inventory, escrow access and recovery drill; the CLI must not export keys automatically. |
| Q4: Scope / privileges? | Whole database, all tenants, host operator only; no tenant API, app-role authorization, or tenant selectors. | A whole-database dump is inherently cross-tenant. Least-exposure design keeps credentials and files outside application users' reach. |
| Q5: Default format / concurrency? | Custom archive; dump jobs 1, restore jobs 1. Directory archive opt-in; jobs 1–8 with connection-budget checks. | Predictable small default; parallelism requires deliberate disk and server capacity. Bound 8 is product policy, not a PostgreSQL maximum. |
| Q6: Target / overwrite / resume? | Explicit separately provisioned scratch database; refuse non-empty, source-equivalent, or live-configured targets. No force, clean, create, drop, or resume flags. | Lowest blast radius; retry uses a fresh database and fresh run ID. |

## Overview

Audience: trusted deployment operators with OS access and database credentials, not tenant administrators. A backup here is a **logical, single-database archive**, not a physical cluster backup or PITR. It includes all tenant rows in that database and PostgreSQL large objects; it does not promise a complete application disaster-recovery bundle.

Existing design: [enterprise automated backups](enterprise/2026-07-08-automated-database-backups.md) owns the `backups` module, scheduling, S3, retention, status UI, run records, notifications, and erasure-manifest integration. Its custom `pg_dump` design is described there as “physical”; this proposal uses PostgreSQL terminology and records the convergence needed without rewriting the enterprise design in this PR.

Existing docs: [PR #7652](https://github.com/open-mercato/open-mercato/pull/7652) corrects Compose service invocations and volume names in `installation/vps.mdx` and `setup.mdx`; it is not this feature. Its body points to #7655 for empty-database guidance. Those docs and tests remain untouched. Future CLI docs must preserve service-based `docker compose … exec -T postgres` examples and explicitly distinguish SQL-only recovery from attachment/key recovery.

## Problem Statement

At the inspected `origin/main` baseline, installation docs show manual `pg_dump`, while the enterprise proposal describes a future managed pipeline. An operator still has to coordinate client versions, disk use, failed subprocesses, artifact integrity, archive trust, destination identity, and non-database secrets. A file existing on disk is insufficient evidence that it is complete or recoverable. A restore against the wrong database has an instance-wide blast radius.

The goal is a reproducible, inspectable manual recovery procedure, including its failures. No claim is made that a logical dump provides continuous recovery or that an unexercised artifact meets an RTO.

## Proposed Solution

Introduce `mercato db backup` subcommands in `packages/cli`, before application bootstrap. Back them with narrow reusable functions that accept validated inputs, streams, process execution and resource controls; they do not resolve the application's full container, start workers, auto-migrate, initialize tenants, publish events, or call restored integrations.

Use cases: an operator creates a pre-maintenance recovery point, checks a transferred artifact without SQL execution, performs a scratch recovery drill, and uses the drill report to decide whether a later, separately managed cutover is safe.

### Research and alternatives

PostgreSQL documents consistent single-database dumps, custom/directory formats, parallel directory dumping and archive version limitations. Adopt these native semantics rather than implementing row traversal. `pg_dump` cannot include cluster-global roles/tablespaces. Project policy initially supports matching source/tool/target major versions; upgrades require a separately tested compatibility matrix, never inferred portability. [PostgreSQL pg_dump](https://www.postgresql.org/docs/18/app-pgdump.html).

Restore parallelism requires a regular custom file or directory and cannot combine with a single transaction. Restoration can execute source-controlled code. Adopt fail-on-error and trusted provenance; reject arbitrary native flags. [PostgreSQL pg_restore](https://www.postgresql.org/docs/18/app-pgrestore.html).

[pgBackRest's operator guide](https://pgbackrest.org/user-guide.html) supplies a useful comparison: repository checks, restore rehearsal, WAL/PITR and incremental recovery belong to a mature infrastructure tool. Adopt the rehearsal discipline, not its independent repository/scheduling/retention subsystem. Infrastructure DR remains recommended for large deployments needing continuous recovery.

[age's format specification](https://age-encryption.org/v1) describes a streaming encrypted file format. Prefer invoking its maintained CLI over implementing cryptographic framing. Recipient encryption protects confidentiality and payload integrity, but is not proof of who created an archive; provenance needs an independent trust record. This is a proposed choice pending Q2, not a claim that age is already an approved system dependency.

Rejected: a new OSS `backups` business module; ORM/data-engine exports; a custom AES-GCM envelope; `Buffer`-based whole archives; automated overwrite of live databases; tenant-selective restore; importing production application bootstrap to validate recovery. Each either duplicates ownership, misses data, weakens safety, or exceeds the capability.

## Architecture

### Existing and proposed locations

| Path | Responsibility in a later implementation |
|---|---|
| `packages/cli/src/mercato.ts` | Existing dispatcher: add `db backup` dispatch before generated module/DI bootstrap and before any environment-scaffolding side effect in `ensureEnvLoaded`; explicit operator services suffice. Keep all existing commands intact. |
| `packages/cli/src/lib/db/backup/commands.ts` | New thin CLI handlers, prompts, JSON projection, exit mapping. |
| `packages/cli/src/lib/db/backup/schemas.ts` | Zod inputs, manifest v1, recovery report v1; derived TS types, strict bounds. |
| `packages/cli/src/lib/db/backup/{preflight,create,verify,restore,exercise}.ts` | Proposed lifecycle functions, orchestration and read-only checks. |
| `packages/cli/src/lib/db/backup/{processes,resources,artifacts}.ts` | Spawn without shell, bounded pipe handling, quotas, immutable publication. |
| `packages/cli/src/lib/db/backup/index.ts` | Proposed deliberate package subpath facade for enterprise reuse; exporting/build inclusion and compatibility tests ship together. No accidental deep-internal imports. |
| `packages/cli/src/__tests__/db-backup-*.test.ts` | Contract, failure injection, hostile paths/diagnostics, bounded stream unit tests. |
| `packages/cli/src/lib/db/backup/__integration__/lifecycle.spec.ts` | Proposed self-contained CLI/PostgreSQL integration scenarios; package placement exception requires QA approval because this is package infrastructure, not a module. |

No entities, migrations, new module files, generated registries, DI keys, queues, HTTP routes or events. No data-model graph: only filesystem artifacts, not ORM entities. Configuration and manifests must not become application records. Direct PostgreSQL catalog queries are appropriate here; encrypted application reads in an isolated drill use existing encryption helpers, never ad-hoc decryption.

Proposed facade: `preflightBackup`, `createBackup`, `verifyBackup`, `restoreBackup`, `exerciseBackup`, with Zod-derived options/results, `AbortSignal`, and injectable process/filesystem/connection adapters. Final exported names need contract review before shipping. Enterprise is the glue owner: it supplies its own stream/object transfer and policy, and consumes this OSS facade. OSS never imports enterprise. Manual commands work with enterprise absent. Enterprise workers invoke the same bounded primitive with cancellation, not an additional queue or a shell call to a nested CLI.

The adapter must keep archive completion separate from upload completion. Enterprise may mark a scheduled run complete only after its own immutable object publication succeeds. Remote object atomicity, storage streaming API changes, scheduler concurrency, inventory, retention and erasure diff remain defined by the enterprise spec. This proposal does not weaken their policy.

### Native execution and consistency contract

* Resolve explicit binaries from an operator-controlled installation directory, record real paths and versions, reject missing/mismatched clients before spawning. Initial support: Linux, PostgreSQL 16/17/18, matching stable client/source/target major, latest security patch tested per supported major. Do not support prereleases or silently download tools. Missing extension binaries/versions, encoding/collation/locale incompatibility and unknown application schema versions fail target preflight.
* Custom path: `pg_dump --format=custom` stdout flows through the approved encryptor to a private partial file. Directory path: `pg_dump --format=directory --jobs=N` writes into a quota-controlled private workspace, then a standard tar stream feeds the same encryptor. Custom dump rejects jobs above 1. No native table/schema/tenant filters or arbitrary argv passthrough.
* `pg_dump` supplies its own consistent snapshot. For snapshot-aligned evidence, maintain a read-only repeatable-read exporter transaction, use `pg_export_snapshot()` then pass its ID through `--snapshot`; run evidence queries on that same snapshot. Do not claim two independent dumps/count queries share a snapshot. Default no additional full-table counts. Snapshot acquisition failure aborts; exporter remains alive until dump/evidence finish, always released on failure. Native parallel dump coordinates synchronized snapshots internally. Exported snapshot lifetime is limited to its exporting transaction. [PostgreSQL snapshot synchronization](https://www.postgresql.org/docs/18/functions-admin.html#FUNCTIONS-SNAPSHOT-SYNCHRONIZATION).
* Jobs are integer 1–8; directory dump reserves N+1 dump connections plus exporter/control (up to N+3); restore reserves N+2 including control/checks. Compare requested budget with a conservative available-connection estimate; reserve at least 5 connections beyond observed use. Reject insufficient capacity; concurrent operators can still consume it, so connection failures abort cleanly rather than escalating jobs.
* Lock acquisition timeout defaults 30 seconds; connect timeout 10 seconds; total deadline defaults 6 hours and is explicitly overridable up to 24 hours. Native warnings produce sanitized, capped diagnostics and `warnings` status; strict creation treats native warning output as failure until an allowlisted non-data-loss category is reviewed. No success if any pipeline child fails, even if the final file closed successfully.
* Restore uses a verified local seekable archive and `--exit-on-error --no-owner --no-acl --no-tablespaces`; no `--clean`, `--create`, `--disable-triggers` or arbitrary list filters. Single job uses `--single-transaction`; multiple jobs require explicit selection and produce a possibly partial scratch database on failure. Pre-provision required extension/owner capabilities; do not elevate automatically. Original owners/ACLs/tablespace placement are intentionally not replayed; DBA policy mapping is a separate cutover precondition.

### Resource bounds and cancellation

Diagnostics use the existing shared `createLogger` and error-reporting facade; a catch that records an error also calls `reportError` with sanitized codes/context, never raw child output or credentials. All pipes use backpressure; no archive-sized JS buffers, base64 copies, captured SQL or `exec` maxBuffer. Each JS stream high-water mark is at most 1 MiB; diagnostic tail at most 64 KiB per subprocess, each line at most 4 KiB. Output SQL and table inventories stream to disk, never model/log memory. Native tool memory is measured separately and bounded by the deployment cgroup, not falsely promised by JS stream settings.

Require `--max-staging-bytes` for every command that writes staging and an absolute operator-owned `--workspace`. Default reserve free space 1 GiB, manifest max 1 MiB, report max 1 MiB, artifact entry count cap 1,000,000, per-path max 4096 bytes; reject before exceeding bounds. Custom stream byte counters enforce output caps. Directory dump/extraction requires an OS-enforced project/filesystem quota on a private workspace; an interval free-space check alone cannot enforce a hard bound and is not accepted as one. Preflight verifies the quota adapter, otherwise refuses directory mode. Check free-space reserve throughout; ENOSPC/EDQUOT fails without publishing.

Peak local disk plans include every coexisting artifact: directory raw dump + encrypted tar + metadata; restore encrypted input + fully authenticated plaintext + any extraction + report. Count files already in the workspace, not just new bytes; reject paths on a different filesystem that evade quota. Target PostgreSQL storage/WAL/temp/index growth is separate: preflight reports source size as an estimate, requires operator-declared target capacity and an isolated quota-controlled target volume for exercises; no promise that `pg_database_size` bounds future WAL or index space. Record capacity evidence; target ENOSPC is a failed scratch restore.

Cancel/timeout sends termination to the recorded child process group, drains and waits, escalates after 10 seconds, closes connections and snapshot, and removes owned plaintext staging. Never kill by process-name pattern. SIGKILL/power loss may leave private `.partial` directories: they are never valid backups, never auto-resumed, and reported by the next preflight. Operator removes an identified owned partial directory after checking no process holds its lock. A completed artifact can be verified/transferred again; interrupted dump, encrypt, decrypt and restore cannot resume. Durable retry always starts a new run and empty target.

## Data Models

### Immutable local artifact v1

One final directory `<output>/<backupId>/`, containing `manifest.json` and `payload.age` only. `backupId` is a generated UUID. Custom payload plaintext is a custom archive. Directory plaintext is a standard tar containing exactly one `archive/` directory-format dump. This is packaging, not a new cipher format. Restore never trusts filenames inside tar: reject absolute/parent paths, links, devices, duplicate entries, sparse expansion and entry/byte-limit violations before writing; validate `toc.dat` and archive layout. Parser implementation/library needs review; never shell-extract an untrusted tar unchecked.

Manifest is bounded, UTF-8 JSON, `schemaVersion: 1`, `state: 'complete'`, `backupId`, UTC `startedAt/completedAt`, `scope: 'whole-database'`, `kind: 'postgresql-logical'`, `archiveFormat: 'custom'|'directory'`, `packaging: 'raw'|'tar'`, `encryption: {container: 'age-v1', recipientSetId}`, tool versions, source PostgreSQL major/version, non-secret instance/database identity digest, encoding/collation, application release and migration-set digest, `jobs`, `payload: {path: 'payload.age', sizeBytes, sha256}`, `snapshotEvidence: {mode: 'native'|'exported', evidenceDigest?}`, and `exclusions: ['external-files','object-stores','vault','cluster-globals','wal']`. Version/extension inventory is inline, capped at 1,000 entries within the total 1 MiB manifest budget; too many extensions fails preflight rather than truncating. Exact fields/limits are validated by `schemas.ts`. No secrets, URLs, table rows, tenant labels, raw snapshot ID or key bytes. Key custody record reference is an opaque operator ID, never a path to secrets.

Creation: exclusive UUID partial directory with mode 0700, files 0600, no symlink traversal, exclusive lock; finish dump, encryption and ciphertext hash; check all exit codes; fsync payload then write/fsync manifest last; fsync directory; atomic no-replace rename on the same filesystem; fsync parent. No cross-device fallback or overwrites. Only a final directory with a validated manifest is complete. Immutability means CLI never edits completed artifacts; it cannot prevent an OS owner changing files, so verification always rehashes.

The manifest digest is emitted in the result but not stored self-referentially. Operators capture it through an independent authenticated channel or approved custody record. `verify`, `restore`, and `exercise` require `--trusted-manifest-sha256` from that record; recomputing it from the downloaded manifest itself does not establish trust. Hash exact manifest bytes, then enforce its ciphertext digest/size and no extra files. SHA-256 detects changes relative to trusted bytes; it does not authenticate an archive on its own. A future approved signature adapter can replace manual trust distribution through a separate additive contract, not a home-grown signing scheme here.

### Recovery report v1

External to the immutable artifact: run UUID, backupId, trusted manifest digest, target identity digest, tool versions, start/end timestamps, status, sanitized error code, per-stage duration, bytes, resource peaks, schema/migration check, fixture/data-check summary, `keyRecovery: 'not-tested'|'passed'|'failed'`, `externalAssets: 'not-tested'|'operator-attested'`, and `promotionReady: false`. Unknown checks never become `passed`. Report path exclusive, owner-only, atomically finalized; JSON schema version independent of manifest. Plaintext checks must not put decrypted values into the report. No record-count-growing arrays.

## API Contracts

These are proposed **CLI contracts**, not HTTP APIs. Register additively under `mercato db backup`; no enterprise `mercato backups …` command is removed. All flags pass strict Zod validation before I/O. Reject unknown flags and duplicate conflicting flags. No generic `--yes` bypass.

| Command | Inputs and behavior |
|---|---|
| `mercato db backup preflight --operation create\|restore\|exercise` | Read-only source/target/tool/resource checks; `--artifact` for restore/exercise, `--source-service` for create, `--target-service` for restore/exercise. Print planned resource budget, exclusions, target identity challenge where relevant. No files beyond an explicitly requested report, no SQL mutation. |
| `mercato db backup create --source-service <name> --output <absolute-dir> --workspace <absolute-dir> --max-staging-bytes <integer> --recipient-file <path>` | `--format custom\|directory` default custom; `--jobs` default 1; `--deadline-seconds`; approved encryption mandatory. Returns only immutable artifact identity/path/hash after completion. |
| `mercato db backup verify --artifact <dir> --trusted-manifest-sha256 <hex64> --identity-file <path> --workspace <dir> --max-staging-bytes <integer>` | Offline: strict manifest/trust/size/hash checks, fully decrypt to private bounded staging, require encryptor exit success, inspect native archive TOC. No database connections or SQL execution. Remove plaintext on exit. This is artifact validity, not data recovery or archive safety. |
| `mercato db backup restore --artifact <dir> --trusted-manifest-sha256 <hex64> --identity-file <path> --target-service <name> --confirm-target <challenge> --workspace <dir> --max-staging-bytes <integer> --target-capacity-bytes <integer>` | Verify first, then recheck target identity/emptiness, restore, validate schema and write report; `--jobs` default 1. Requires isolated-target deployment evidence described below. No source or target implicit from DATABASE_URL. |
| `mercato db backup exercise <same restore inputs> --checks-file <path> --report <exclusive-path>` | Same restore protocol plus a bounded approved declarative checks file (no arbitrary shell/plugin execution), migration fingerprint, counts/digests and optional separately orchestrated encrypted-canary drill. Always leaves target quarantined; success does not promote. |

Shared `--json`, `--report`, deadline/resource flags use one schema; checks file schema lives in `schemas.ts` (version 1, max 1 MiB, max 100 checks, allowlisted schema/table names and check types, parameterized values). SQL identifiers are quoted with an established PostgreSQL identifier helper; no interpolation or user-supplied SQL. Default checks are migration fingerprint and expected schema presence, not expensive full row scans. Exercise fixtures may request exact counts/content digests with timeouts. Production evidence counts must be snapshot-aligned or explicitly labelled non-comparable.

Connection input uses libpq named services and a private `PGSERVICEFILE`/`PGPASSFILE`, not URLs/password flags or values in argv. The CLI obtains an explicit resolved connection configuration for its control client using the same service, TLS/CA rules and timeouts as native tools; reject unsupported service options rather than resolving a different destination. Use an existing reviewed libpq-compatible parser or approve one before implementation; do not create a second ad-hoc parser. Resolve only allowlisted environment into children. Do not inherit fallback DATABASE_URL, untrusted PGOPTIONS, plugin paths or telemetry endpoints. Decryption identities are private file paths; public recipient files never contain private identities. Reject insecure permissions; don't print file contents. Host-level privileges remain a trust boundary: env/files are not protected from host root.

Output: human progress and capped sanitized warnings on stderr; stdout under `--json` is exactly one versioned JSON result: `{schemaVersion:1, command, runId, status:'completed'|'refused'|'failed'|'interrupted', backupId?, artifactPath?, manifestSha256?, reportPath?, verificationLevel?, error?:{code,messageKey}, warnings:[{code,messageKey}]}`. Warnings max 100 with overflow count. All times UTC, bytes decimal strings for safe large integers. `completed` means that command's stage only, never automatic recoverability. Progress never contaminates JSON. Render localized text from CLI locale catalogs planned under this feature's approved i18n mechanism; stable codes/message keys are script contracts, human prose is not.

Exit codes: 0 completed; 2 invalid input/unsupported version or option; 3 safety refusal (identity, emptiness, trust-source or capacity evidence absent); 4 integrity/authentication/invalid archive; 5 native tool/connection/I/O/quota/deadline failure; 6 recovery checks/key recovery failed; 130 SIGINT, 143 SIGTERM. SIGKILL has no promised report. Precedence: interruption first, safety checks before mutation, integrity failure before restore; after SQL begins any restore failure is 5 with `targetState:'partial-quarantined'` in report. Native exit codes are mapped, not forwarded. Machine-contract snapshots must pin these distinctions.

### Target confirmation and isolation

A target is provisioned independently from `template0`, with intended extension prerequisites documented, no application objects/data, and no unapproved connections. Preflight checks all non-system schemas, user relations/functions/types, large objects, publications/subscriptions and database settings; allow only an explicit reviewed baseline (e.g. empty public schema and pre-provisioned extension-owned objects). Table count alone is insufficient. Source cluster/database identity, target system/database identity, canonical endpoint and live configured endpoint are compared; reject same-source, same-live, aliases resolving to either, or unverifiable identity. An operator-provided instance attestation is required where managed PostgreSQL denies a stable cluster identity query; never substitute a hostname-only comparison silently.

Preflight emits a short-lived challenge binding the canonical non-secret endpoint, server identity, database OID/name, manifest digest, baseline fingerprint and expiry (10 minutes). Interactive restore requires typing that exact challenge after seeing the all-tenant scope; unattended restore requires `--confirm-target` with the same explicit value. Recompute checks immediately before native restore; expiry or drift refuses. This is accident prevention, not cryptographic authorization. A dedicated database accessible only to the operator role, plus a held advisory lock, prevents supported CLI races; advisory locks do not stop arbitrary clients, so exclusive deployment access is mandatory and unprovable isolation refuses. No default deletion even after success.

Restore runs in a sandbox with egress blocked except to the dedicated target server; server-side egress and extension capabilities must also be restricted. Do not connect scratch to production Redis/queues, object stores, SMTP, webhooks or Vault with write credentials. Stop application processes, schedulers and workers using the target, use a separate disposable Redis namespace/instance if a later isolated canary app needs one, and deny outgoing callbacks at the network layer. Do not import app bootstrap just to achieve this. Restored database functions/triggers/extensions can execute code during native restore; DB superuser should not be the default restore role. A sandbox and trusted source are both required. `pg_restore --file` can aid inspection but is not a SQL safety verifier.

No CLI completion event or application callback is emitted during restore. Enterprise's optional post-restore erasure review happens outside this primitive before any promotion; a database roundtrip with that review absent must never be presented as compliance clearance.

## Encryption, escrow and offline rotation recovery

There are three separate custody domains: archive decryption identity; application data-encryption keys and historical key versions; external secret services and credentials. None substitutes for another. `packages/shared/src/lib/encryption/kms.ts` currently includes deterministic derivation from a root secret and a Vault-backed key service. A root secret feeds a derivation function; it is **not the raw tenant DEK**. For a derivation deployment, retain exact secret, tenant identifiers, derivation algorithm/version/config and any historical key lineage. For Vault or stored/random/versioned DEKs, recover the actual provider key records, versions, mounts/policies and access procedure separately. A SQL dump must not be described as backing up Vault or guaranteed to contain usable keys.

Escrow is an external access-controlled recovery record with dual-control/recovery-owner policy, offline copy and tested retrieval; never embed key bytes in a manifest, report, command flags or archive alongside its decryption identity. The proposed CLI consumes approved recipient/identity files but never invents an export-DEKs feature. Existing field encryption helpers are not a streaming archive container. Q2/Q3 must be approved before shipping this support.

Offline maintenance/rotation runbook, to be delivered with implementation (no key rotation code here):

1. Inventory all tenant/system key versions and provider modes, artifact recipients, application release/migrations, external files and Vault recovery dependencies. Approve escrow access and a rollback window with the security owner.
2. Stop all writers, queue workers, schedulers and callbacks; record that maintenance state. Capture separately coordinated attachment/object-store snapshots and Vault/provider recovery material. A database snapshot does not synchronize an object store.
3. Create and verify an immutable pre-rotation backup; record trusted manifest digest and escrow references out of band. Exercise recovery on an isolated empty target using the pre-rotation application/key configuration, including known encrypted canaries from every key scope represented. If any key version is unavailable, stop rotation. A SQL restore succeeding alone is insufficient.
4. Run the separately specified offline rotation procedure; this spec does not define its re-encryption algorithm or integrity verifier. Hand the rotation project the artifact ID, trusted manifest digest, immutable pre-rotation evidence and recovery report. The planned verifier owns exhaustive rotation validation, coverage/resume semantics and its own spec.
5. Before accepting new writes, exercise post-rotation recovery and approved checks; retain historical keys and pre-rotation artifacts for their full recovery/compliance lifetime. On failure, leave production stopped; restore the pre-rotation backup into a fresh isolated DB with matching old keys and separately recovered assets, then perform an explicitly approved cutover. No automatic overwrite or rollback of external calls.
6. If writes resumed after the backup, rollback loses later DB changes and may mismatch external assets; require an incident decision, not an implied safe undo. Existing queue jobs may contain old work in DB or Redis: reconcile them offline before workers restart. Reapply enterprise erasure obligations, then separately approve secrets, endpoints, queues and cutover.

Exclusions printed on every creation/restore summary: attachments on disk, S3/external object contents, Vault state, Redis/other external queues, cluster-global roles/tablespaces, WAL/PITR, environment secrets, provider accounts. DB rows referencing attachments and DB-backed queued jobs may be included; their external bytes/side effects are not. No tenant-selective restore, PITR, cluster backup, automatic cross-major upgrade, production promotion or recovery of unavailable keys.

## Edge Cases & Failure Scenarios

| Trigger | Required result and recovery |
|---|---|
| Dump child fails after encryptor exits, lock conflict, lost exporter or connection | No final artifact, nonzero mapped exit, all children/snapshot closed; retry new run. No reused partial archive. |
| Encryptor failure, wrong identity, truncated tail or tampered bytes | No completion; verify authenticates entire encrypted payload before any SQL. Wrong key/corruption exit 4, preserve encrypted evidence, remove owned plaintext. |
| Manifest replaced together with payload | Trusted manifest digest mismatch refuses. A digest copied from that same untrusted directory is not provenance; operator custody remains a security boundary. |
| Trusted malicious source SQL | Integrity can pass while code is dangerous; require source trust, sandbox and restricted roles. No claim that TOC inspection removes malicious SQL. |
| Symlink, traversal tar, decompression bomb, entry flood, quota exhaustion | Refuse/abort within resource caps; no writes outside owned workspace and no published artifact/SQL execution. |
| Power loss at any fsync/rename point | Partial stays invalid, or final is fully verifiable; no state where a missing payload is reported complete. Fault-injection test every publication boundary. |
| Restore failure after parallel commits | Target remains partial and quarantined; report says discard/reprovision outside CLI, never retry over it. Serial transaction rollback still leaves target quarantined pending inspection. |
| Target changes between preflight and run | Recomputed identity/baseline/expiry refuses before SQL; deployment isolation is still required against unauthorized clients. |
| Unsupported extension, client major, permissions, locale or missing roles | Preflight refusal with sanitized code; no automatic package installation, owner grant or downgrade. |
| Missing historical data key, stale escrow, wrong provider | Artifact verification may pass but encrypted-canary exercise fails; no recoverability claim, no fallback key generation or provider writes. |
| Cleanup fails, report file exists, SIGKILL orphan | Never overwrite; surface cleanup-required path without secrets; private residue retained for operator disposal; failure stays failure. No secure-erasure guarantee on SSD/snapshots. |

## Risks & Impact Review

| Risk | Severity / affected area | Mitigation | Residual risk |
|---|---|---|---|
| Cross-tenant disclosure in artifact, logs or scratch | Critical / all tenants | Operator-only files, encrypted container, strict redaction and quotas, no tenant routes, isolated target | Host root and recovery custodians can access all tenants; encrypting columns does not sanitize the archive. |
| Wrong destination or source archive executes code | Critical / DB and host | No destructive options; identity challenge, trust record, restricted DB role and two-sided sandbox | Privileged operator or source DBA remains trusted; no automatic SQL safety proof. |
| Secret/KMS mismatch makes backup unusable | High / recovery | Separate custody inventory, historical key retention and encrypted-canary exercise | Missing keys irrecoverable; Q3 approval and deployment drill required. |
| Long snapshot or dump overloads live server | High / availability, vacuum | Small default jobs, deadline, connection budget, lock timeout, resource measurements and maintenance guidance | Logical full scans and old snapshots still consume IO/storage; use infra DR for large workloads. |
| Directory plaintext / disk exhaustion | High / host | Mandatory enforced workspace quota, owner-only files, bounded tar extraction, cleanup | Root/storage snapshots may retain plaintext; secure disposal is an operator responsibility. |
| False full-recovery/compliance claim | High / operations and erasure | Verification levels, exclusions, promotionReady always false; enterprise compliance and external assets separate | Human may skip runbook; reports must retain “not tested” results. |
| New CLI/manifest/facade contracts fossilize too early | Medium / integrators | Versioned schemas, explicit approval gates, contract tests, additive evolution | Once shipped, deprecation protocol applies; this design alone is not contract approval. |

## Integration Coverage and Performance Acceptance

No runtime tests are added by this spec-only PR. Every later behavior ships with its corresponding tests; this table is the implementation acceptance matrix, not execution evidence. No HTTP or UI paths are added, so API/UI integration paths are N/A. Enterprise API/UI scenarios stay in its spec.

Harness: disposable PostgreSQL per scenario using template0 targets and unique run/DB/service names. Never use developer DATABASE_URL. Create fixtures via the harness connection (no new API), including two tenants/organizations, encrypted canaries with deterministic test-only provider configuration, custom fields, JSON/unicode/nulls, soft-deleted rows, FKs, indexes, sequences, a large object, migrations and attachment references. Use generated test recipient identities, an offline fake custody record, a local mock object store and callback/queue sinks with counters. No seeded data or live Vault/secrets. Fixture SQL is harness-owned, not arbitrary operator checks. Every scenario has `finally` cleanup: child processes by recorded PID, connections, snapshots, scratch/source databases, temp directories, test identities and fake external services. Database teardown is limited to names/instance IDs created by that scenario; record cleanup failures as test failures. Track and assert no active exporter sessions/children remain after tests.

| ID / command path | Fixture or injected condition | Assertions |
|---|---|---|
| B01 preflight/create | Each supported major; full two-tenant fixture | Native versions and source privilege checked, custom default jobs 1, artifact schema and no excludes/tenant filtering; source data unchanged. |
| B02 create/restore/exercise | Custom archive full roundtrip | Counts, deterministic content digests, schemas, constraints, sequence next values, large object bytes, custom fields/migrations match; encrypted canaries decrypt with correct keys and tenant scopes; no PII in reports. |
| B03 create/restore | Directory jobs 1/2/8 on enforced quota | Snapshot coherence under concurrent paired-row writes, connection bounds, valid archive layout; parallel restore content equality. |
| B04 preflight/parse | Unsupported/newer/different major, missing binary, malformed service, absent extension/role/collation, invalid flags/jobs | Fail before output/SQL, stable codes; custom dump jobs >1 rejected. Matching-version matrix mandatory before extending support. |
| B05 create | Concurrent writer and evidence exporter; exporter killed, DDL lock contention, native warning | Evidence shares snapshot or explicitly not comparable; lost exporter/timeout/warning fails without completion. Ordinary writes remain possible. |
| B06 all pipelines | Slow sink, closed pipe, pg_dump/age/tar failure at beginning/middle/end, process spawn failure | Backpressure, bounded stderr/RSS, no swallowed child failure, all descendants reaped, no completed artifact. |
| B07 verify/restore | Truncate, mutate, swap payload/manifest, wrong key, missing/extra files, untrusted manifest hash | Exact exits 3/4, zero target SQL, plaintext removed, trust cannot be established from artifact alone. |
| B08 verify | Valid archive without DB access; syntactically invalid native TOC | Offline operation proven by denied network; TOC validity is distinct from recovery, no SQL execution. |
| B09 preflight/restore | Live/source alias, non-empty schema/function/large-object-only DB, expired challenge, OID change, concurrent connection | Identity/emptiness/isolation refusal before SQL; no clean/create/drop path even with unknown force flag. |
| B10 restore | SQL error serial vs parallel, target volume full, DB disconnect | Serial rollback, parallel partial quarantine, exit 5, no promotion/automatic drop/retry. |
| B11 all writes | ENOSPC/EDQUOT, quota unsupported, cross-filesystem output, symlinks/traversal, oversized metadata, malicious tar links/duplicates/bombs | Hard staging caps, no out-of-root write, no completion; directory mode requires enforceable quota. |
| B12 create | Crash/fault before/after each fsync/rename, competing output run | Only complete immutable finals or invalid partials, exclusive locks/no overwrite, explicit owned orphan cleanup. |
| B13 long commands | SIGINT/SIGTERM/deadline; SIGKILL then next preflight | Contract exit/report when possible, snapshots/children released, orphan private and non-resumable, no SQL replay resume. |
| B14 secret handling | Password/token/URI/query/SQL row text in native error, path names and hostile terminal escape sequences | No sensitive bytes in argv, stdout/stderr/report/telemetry; cap and strip control sequences; allowlist diagnostics, do not rely only on URL regex. |
| B15 exercise | Wrong/missing historical DEK, root secret incorrectly used as raw DEK, unavailable fake Vault, old/new key canaries | Restore may finish while recovery fails exit 6; no automatic creation/mutation of provider keys, unknown key scope not passed. |
| B16 exercise isolation | Restored DB jobs/integration configs, callback and queue sinks | Zero callbacks, queue dispatch, SMTP, object writes or provider mutations; source Redis untouched; network policy negative tests. |
| B17 external recovery | DB references missing attachment; separate provider/object fixture | Exclusions and incomplete recovery state remain visible; optional operator attestation cannot forge measured canary success. |
| B18 contracts | All commands human/JSON and failing variants | Stable schemas/codes, one stdout JSON object, localized human output, reports exclusive/immutable artifact unchanged, large byte values preserved. |
| B19 resource/performance | Representative small and large datasets, slow disk and sparse/incompressible payload variants | Budgets below pass; include native/cgroup peaks and target WAL/storage in evidence. |
| B20 facade/enterprise absent | Installed standalone CLI package with generated modules unavailable | All manual commands function without app workers/enterprise; exported facade build resolves; no dependency on parent encryption branch. Future enterprise adapter parity test belongs to enterprise delivery. |

Performance gate: pinned Linux runner, 4 vCPU/8 GiB RAM, separately measured DB and client volumes, dataset/tool/config recorded. Compare the same fixture and format to direct native-tool plus approved encryption pipeline. At 1 GiB and 20 GiB logical dataset sizes (compressible and incompressible mixes), Node coordinator peak RSS ≤256 MiB, growth ≤32 MiB between sizes; aggregate client process tree ≤1 GiB at jobs 1 and ≤2 GiB at jobs 8, enforced by cgroup. Do not count DB server memory as client memory; measure both. End-to-end elapsed ≤1.25× matched native+encryption baseline plus 30 seconds; no arbitrary absolute throughput promise across hardware. Hold slow sink for 60 seconds: memory plateaus, source consumption throttles and no unbounded queued bytes. Test hard staging limit at multiple offsets with ≤one configured stream chunk overshoot for counter-based custom writes; enforced quota is absolute for directory writes. Disk reservation includes peak plaintext/ciphertext coexistence and fails before target mutation if insufficient. Cancellation releases child processes/connections within 15 seconds after grace escalation on the pinned runner. Keep raw benchmark metrics as CI artifacts. The 20 GiB job is a release gate; the small case and failure suite run per relevant change. These are proposed acceptance targets, not measured results.

## Migration & Backward Compatibility

This PR adds no runtime contract or data migration. Later implementation adds CLI commands/subpath exports/manifest formats under the protected CLI, type/signature and import-path categories of `BACKWARD_COMPATIBILITY.md`. Existing commands/flags, module discovery and generated paths stay unchanged. Confirm namespace availability before shipping; no replacement of current `db` behavior. Manifest/report schema versions are explicit; readers reject unsupported major versions without guessing, preserve unknown optional additions only where specified, and retain a tested v1 reader when v2 is introduced. No reinterpretation of old ciphertext or silent in-place format migration; conversion writes a new artifact and keeps original/trust evidence.

Enterprise convergence is a follow-up owned there: scheduled jobs call the shared facade, preserve existing planned UX/storage/retention/compliance contracts, and reconcile its proposed AES-GCM framing, raw-key flag, force/live-restore behavior and “physical” terminology with approved manual lifecycle safety. These are **unresolved proposal differences**, not permission to break a published enterprise command. First determine actual implementation/publication status; if contracts shipped, use aliases/adapters and the documented deprecation protocol (bridge ≥1 minor, upgrade notes and migration spec), never silently remove them. No enterprise runtime changes in this spec PR.

Rollback of a future CLI release disables new dispatch/exports without deleting artifacts; retain a standalone compatible reader/toolchain for recovery. Backup creation has no DB mutation to undo. Restore reversal means discarding a separately provisioned scratch target after approval and starting again; CLI never deletes a target. Real cutover and external-side-effect rollback are outside this lifecycle.

## Final Compliance Report — 2026-11-06

Reviewed root instructions, `.ai/specs/AGENTS.md`, `packages/cli/AGENTS.md`, relevant `packages/shared/AGENTS.md` encryption/logging/pool guidance, `.ai/qa/AGENTS.md`, `BACKWARD_COMPATIBILITY.md`, shared/local spec-writing skills, and enterprise backup design.

| Rule / checklist area | Status / evidence |
|---|---|
| Single capability / phased delivery | One manual recovery lifecycle; fresh-context scope reviewer b681cf04 approved with no findings on 2026-11-06. Rotation verifier and enterprise automation excluded. |
| Package placement / canonical mechanisms | OSS CLI infrastructure, not business module; no application bootstrap, parallel queue/storage/crypto stack, generated files or direct module relationships. |
| Tenancy / permissions | Explicit host-operator all-tenant boundary; no tenant API. Scratch access segregated. Tenant/organization-scoped canary reads use existing encryption helpers. |
| Input / secrets / data protection | Strict bounded Zod schemas, shell-free argv, private credentials and artifacts, standard container proposal gated by security approval; no new PII columns/maps. |
| Atomicity / commands / undo / events | Staged immutable publication; named CLI mutations; no callback/event side effects; scratch discard is external, no destructive automatic undo. |
| Scale / query / cache | Native full scan intentionally foreground operator process with deadlines; bounded streams/disk/metadata, explicit connection budgets. Catalog checks bounded; evidence scans opt-in. No app list APIs, indexes, cache or cache invalidation. |
| Contracts / compatibility | Additive proposal, v1 schemas, enterprise differences and deprecation path explicit; no runtime contract changed in this PR. |
| Integration / performance | Self-contained matrix B01–B20 with teardown and proposed measurable gates; no implementation or test claims. Package-level integration location requires QA approval. |
| UI / API / i18n | No UI, HTTP routes, CRUD forms, DS tokens, pagination, optimistic-lock forms or mockups apply. CLI human output localization and stable codes are specified. |
| Internal consistency | Whole-database logical scope matches artifact/commands; only verified plaintext enters restore; parallel partial target quarantined; no secret escrow or external assets falsely included. |

Verdict: **design review only; not approved for implementation** until Q2/Q3 security direction and integration harness placement are confirmed and pre-implementation checks pass. No known repository rule violation is waived. Runtime build/test/generate gates are not evidence for a document-only change; validate scope, links, whitespace, primary sources and independent review instead.

## Changelog

- 2026-11-06: Skeleton created before technical research; expanded autonomous manual CLI design on origin/main, reconciled enterprise ownership and docs PR #7652, recorded security gates, recovery contracts, scenario matrix and performance targets. No runtime implementation.

### Review — 2026-11-06

- Author review: security gates explicit; performance targets proposed; cache N/A; commands and failures specified. No runtime behavior has been tested.
- Fresh-context scope-cohesion reviewer: cezar task `b681cf04-d0a9-4021-9db0-bbfb4032f799`, verdict **approve**, no actionable findings. Reviewed the full spec in the author working tree because the cockpit review fork retained its original task branch without the spec. Evidence: one artifact/trust/recovery contract across commands, dependency-ordered phases, standalone OSS facade, enterprise and rotation ownership excluded. Review limited to document scope cohesion, not security approval or runtime validation.

## Phasing

Only this document and a minimal enterprise crosslink ship now. The following is a later implementation plan, not authorization to modify runtime files. All phases are increments of this one lifecycle; enterprise adaptation and rotation verification have their own specs/orders.

## Implementation Plan

### Phase 0 — Resolve safety and deployment gates

1. Obtain Q2/Q3 security decisions, supported binary/container distribution and independent trust-record procedure. Verify native tool and service-resolution behavior on supported images. Confirm all promised resource bounds with a spike and package-level integration test placement with QA. No production dependency added before approval. Acceptance: decisions and reproducible proof attached to this spec; blockers stay visible.
2. Audit actual enterprise/public CLI contracts and namespace collisions; agree additive facade and compatibility fixtures. Acceptance: safe dependency direction, no unapproved published-surface changes, enterprise follow-up recorded.

### Phase 1 — Artifact production and offline verification

3. Add bounded schemas, process/resource adapters and preflight, with B04/B06/B11/B13/B14/B18 tests. Existing app/CLI commands continue to work; unsupported modes refuse before mutation.
4. Add custom encrypted create and offline verify, immutable publication and trusted-manifest contract with B01/B07/B08/B12; ship no restore dispatch until artifact verification is complete. Application runtime unchanged; native tools remain optional unless this command is used.
5. Add quota-backed directory mode, snapshot evidence and connection budgets with B03/B05/B19. Acceptance includes measured bounded resources, not just successful output.

### Phase 2 — Isolated restore and recovery exercise

6. Add target identity challenge, empty-baseline check, sandbox preflight and serial restore; B02/B09/B10/B16 pass. Add explicit parallel restore only with partial-quarantine behavior proven. No command supports live overwrite.
7. Add declarative exercise checks and separate key-canary orchestration/reporting; B15/B17/B18/B20 pass. Deliver the offline recovery/rotation runbook and external-assets checklist; preserve ownership boundary with the planned rotation verifier.
8. Release only after full scenario matrix and performance evidence, standalone installed-package smoke, applicable CLI build/tests and repository configured gate. Run module generation only if discovery inputs are actually added. Future runtime/docs/template changes follow their own routed instructions. Each increment keeps existing application behavior working; no claim of full recoverability before the exercise and custody gates pass.
