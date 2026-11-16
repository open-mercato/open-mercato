# Erasure restore replay

> **Program:** package C9 of [`../2026-11-15-gdpr-ready-deployments-program.md`](../2026-11-15-gdpr-ready-deployments-program.md) (tracker open-mercato/open-mercato#8593).
> **Builds on:** [`2026-11-16-privacy-dsr-engine.md`](2026-11-16-privacy-dsr-engine.md) and the OSS erase run in [`../2026-11-16-privacy-subject-erasure.md`](../2026-11-16-privacy-subject-erasure.md).
> **Reference only:** the erasure manifest and `restore-reapply` command on `upstream/feat/security-readiness` (PR #5557).
> **Verified at** `main` @ `08dada9624`, against that branch, and against open PR #9333, by reading; nothing was run.
> **Written autonomously.** No question was put to a person; the choices are listed under Resolved assumptions.

Extends: .ai/specs/enterprise/2026-11-16-privacy-dsr-engine.md
Extends: .ai/specs/enterprise/2026-07-08-gdpr-data-erasure.md
Extends: .ai/specs/enterprise/2026-11-06-cli-backup-restore.md
Supersedes: .ai/specs/enterprise/2026-07-08-automated-database-backups.md — sections: Erasure manifest (mechanism owned here; entries produced by the companion spec), Phase 5 — Erasure-manifest mechanism, test infra & docs

## 📝 TLDR

When a database is restored to a point before an erasure, the erased person comes back. Nothing in the product notices: the record of the erasure was in the database that was just rolled back. **Proposed (future):** every completed erasure is recorded twice — as a row in the database and as a small file in a directory outside it. After a restore, the files outnumber the rows. The product sees the difference, says so loudly, and an operator runs one command that erases those subjects again.

**Status.** Depends on the governance engine spec and, through it, on the OSS erase run; neither is approved. The program's decision DEC-4 — that replay must work for a restore done outside the product — is taken here as a requirement, not yet confirmed by a maintainer.

**Not in this spec:** taking or restoring backups; automatic replay with no operator; removing erased data from backup archives, which age out; an object-store backend for the files.

## 📝 Overview

The 07-08 erasure spec set the position this spec keeps: one mechanical guarantee, that backups expire, and one operator control, a guided re-run after a restore. It also noted that a raw restore bypasses the control. This spec makes the control detect a restore it was not told about.

> **Market reference.** Guidance from EU regulators, and the practice of products such as GitLab, is the same: keep a log of erasure requests outside the backed-up data and re-apply it after any restore. Adopted. Rejected: per-subject encryption keys destroyed on erasure ("crypto-shredding"), which the 07-08 spec already ruled out for this platform's per-tenant keys.

## 📝 Resolved assumptions (autonomous defaults)

| # | Question | Chosen | Rationale |
|---|---|---|---|
| 1 | Which backup tooling it assumes | None. It works whether a restore is done by the product's backup module, by a managed database's point-in-time recovery, or by hand | #4030 says backups belong to infrastructure; PR #9333 adds a product backup module. Either way a restore can happen outside the product. |
| 2 | Where the files live | A directory named by an environment variable, on storage that every replica shares and that is not part of the database or its backups | ⚠ NEEDS HUMAN CONFIRMATION. It needs no new dependency. A deployment whose replicas have only local or ephemeral disks cannot use it, and the spec says so instead of pretending. An object-store backend needs a dependency decision and its own spec. |
| 3 | How "what is missing" is computed | The set of files minus the set of rows | A single "newest applied" marker is overtaken by the first erasure after a restore, and everything before it is then forgotten. |
| 4 | Telling deployments apart | A deployment id from the environment, in the path of every file and on every row | A staging copy that shares the directory would otherwise make production replay staging's erasures. |
| 5 | Replay | Operator-run, preview by default, never automatic | The 07-08 spec rejected automatic replay; a later legal hold must be able to stop it. |
| 6 | When a restore is detected | Reported at error level, shown on the privacy settings page, and sent as a notification to users who may erase. The application keeps running | Refusing to serve would turn a restore, already an incident, into an outage; and only the worker role has a start-up hook today. An operator who wants a hard stop puts the status command, which exits non-zero, in the start command or readiness probe. |
| 7 | How long files are kept | 90 days by default; the operator must set it above the longest backup they can restore | ⚠ NEEDS HUMAN CONFIRMATION. A file is only needed while a backup older than it can still be restored. Longer keeps the ids of erased records for longer. |

## 📝 Problem Statement

- **An erasure does not survive a restore.** The subject's rows, the engine's ledger row and the OSS audit entries are all in the restored database.
- **The reference implementation tied the manifest to a backup module.** It wrote one file per erasure under the backup directory, and only the product's own restore command listed entries newer than the backup (`branch:packages/enterprise/src/modules/backups/lib/erasureManifest.ts:35-76`, `backupService.ts:259-260`). A restore done any other way was invisible.
- **The backup module now being merged has no erasure step.** `.ai/specs/enterprise/2026-11-06-cli-backup-restore.md` leaves the manifest to the 07-08 spec, and its restore ends with a report and no hook; PR #9333's diff has no erasure code.
- **Storage options are limited.** The attachments storage drivers can store, read and delete but not list, and their configuration is itself read from the database (`packages/core/src/modules/attachments/lib/drivers/types.ts:22-33`, `driverFactory.ts:64-66`). No secondary database is configured anywhere.
- **Only the worker role has a start-up hook.** Module runtimes are wired for `worker` alone (`packages/shared/src/modules/runtime.ts:22-23, 67`; `packages/cli/src/mercato.ts:1892-1895`), and errors thrown while a request container is built are swallowed (`packages/shared/src/lib/di/container.ts:278-284`). The web tier cannot be made to refuse at start without new wiring.
- **Events are redelivered.** A subscriber may run more than once for one erasure, and two may run at once.
- **Useful parts of the reference:** the entry shape, atomic owner-only writes, preview by default, a typed confirmation, a check that the command is pointed at the intended database, and re-running each entry through the normal erase path so that holds are checked again.

## 📝 Proposed Solution

1. **Two records per erasure.** A subscriber to the erasure completion event first inserts a row, then writes a file. Both are named by the event's `runId`, so doing either twice changes nothing. The row holds everything the file holds.
2. **What is pending.** For one deployment and tenant: the files that have no row. After a restore, the rows written since the restored point are gone and their files remain.
3. **Detection.** A daily job, and the worker role at start, compare counts per tenant and month and list the difference only where the counts disagree. The result is stored in the database so that the web tier can show it without touching the directory.
4. **Report.** An error-level report, a banner on the privacy settings page, a notification. `restore-status` exits non-zero while anything is pending.
5. **Replay.** A command lists the pending entries and, with `--apply` and a typed confirmation, runs each through the OSS erase run with the original preference and exclusions and origin `engine:replay`. On success it inserts the row for that entry.
6. **Completing the pair.** The same daily job writes the file for any row that lacks one — a crash between the two writes — and, where the action log offers it, inserts rows for completed erasures that produced no event.

### Design decisions

| Decision | Rationale |
|---|---|
| The row is written before the file | A crash between the two then leaves a row with no file, which the daily job repairs. The other order would leave a file with no row, which is exactly what a restore looks like. |
| The rows live in the database on purpose | They are the thing that *should* roll back with a restore; that is how the restore is seen. |
| No ordering between entries is needed | Set difference does not care which worker committed first. |
| Replay goes through the normal erase run | Holds placed since are honoured, module rules apply, and the run is idempotent. |
| Replay writes no new file | The subscriber ignores events whose origin is replay; repeated restore drills must not grow the list. |
| A subject that is now held, or that the run refuses, gets no row | It stays pending and is listed again. |
| Files are grouped by deployment, tenant and month | Detection reads a handful of directories per tenant instead of one directory with every erasure ever made. |
| The backup module, if present, is told through a soft seam | Its restore report can show the pending count; it is not required. |

### Alternatives considered

| Alternative | Why rejected |
|---|---|
| A "newest applied" marker per tenant | See assumption 3. |
| Keep the manifest in the database | It rolls back with the data. |
| Automatic replay at start | Ruled out in the 07-08 spec; it would erase without anyone looking, including subjects under a new hold. |
| Refuse to serve when a restore is detected | See assumption 6. |
| A synchronous hook in the OSS run | A contract change; the row-then-file order and the daily job give the same result within a day. |
| Reuse the attachments drivers | No list operation, and their configuration is in the database being restored. |

## 📝 Delta

### Capability: erasure-restore-replay

#### ADDED Requirement: Erasure manifest
The system SHALL record each completed erasure both in the database and outside it, without any identifier of the person beyond the internal subject reference.

##### Scenario: After an erasure
- WHEN an erasure completes
- THEN a row and a file exist for it, named by the same id

##### Scenario: Delivered twice
- WHEN the completion event is delivered twice, or to two workers at once
- THEN there is still one row and one file

##### Scenario: Crash between the two writes
- WHEN the row was written and the file was not
- THEN nothing is reported as pending, and the daily job writes the file

#### ADDED Requirement: Restore detection
The system SHALL detect that erasures recorded outside the database are missing from it, and SHALL report it.

##### Scenario: Restored database
- WHEN files exist for a tenant with no matching rows
- THEN an error is reported, the privacy settings page shows the number of erasures to replay, and the status command exits non-zero

##### Scenario: An erasure after the restore
- WHEN a new erasure completes while older ones are pending
- THEN the older ones are still pending

##### Scenario: Another deployment's files
- WHEN the directory also holds files written under a different deployment id
- THEN they are ignored

#### ADDED Requirement: Replay
The system SHALL let an operator re-run the pending erasures, in preview by default.

##### Scenario: Preview
- WHEN the command runs without the apply flag
- THEN it lists the subjects it would erase again and changes nothing

##### Scenario: Apply
- WHEN it runs with the apply flag and the confirmation
- THEN each subject is erased again through the normal run with its original preference and exclusions, and nothing is pending afterwards

##### Scenario: Held since
- WHEN a subject to replay is now under a legal hold
- THEN it is skipped, reported, and still pending afterwards

## 📝 Architecture

All inside the enterprise `data_erasure` module.

- **`lib/manifestStore.ts`**: the interface — `write(entry)`, `list(deployment, tenant, month)`, `count(deployment, tenant, month)`, `prune(olderThan)` — and the directory implementation. A file is written under a temporary name with owner-only permissions and renamed to `<deployment>/<tenant>/<yyyy-mm>/<runId>.json`.
- **`subscribers/erasure-manifest.ts`**: on `privacy.subject.erased` with an origin other than replay, inserts the row if absent, then writes the file.
- **`workers/`**: the daily job — detection, completing the pair, pruning — on the module's queue. The worker runtime hook runs detection once at start.
- **`lib/restoreDetection.ts`**: the comparison and the stored result.
- **`cli.ts`**: `restore-status` and `restore-reapply`.
- **Soft seam**: a DI key `erasureReplayStatus` that the backup module may resolve to add the pending count to its restore report.

| Touchpoint | Mechanism | Absent |
|---|---|---|
| Module → OSS erase run | `privacySubjectService` by DI key | The module requires `privacy` |
| Module → manifest directory | `OM_ERASURE_MANIFEST_DIRECTORY` and `OM_ERASURE_MANIFEST_DEPLOYMENT_ID` | Either unset: rows are still written, no file is, and the page and the doctor say restores are not protected |
| Backup module → status | `erasureReplayStatus`, resolved softly by it | No count in its report |
| Web tier → detection result | Its own table | Shows the last result and when it was computed |

## 📝 Data Models

| Table | Columns |
|---|---|
| `privacy_erasure_applied` | `run_id` (unique with `deployment_id`), `deployment_id`, `tenant_id`, `subject_kind`, `subject_id`, `data_class_ids`, `prefer`, `excluded_related`, `origin`, `executed_at`, `file_written_at?`. Indexed on deployment, tenant and `executed_at` |
| `privacy_erasure_replay_state` | `deployment_id`, `tenant_id` (unique together), `pending_count`, `checked_at` |

**Manifest file (version 1)**

```json
{ "version": 1, "runId": "…", "deploymentId": "prod-eu", "tenantId": "…",
  "subject": { "kind": "customers:person", "id": "…" },
  "dataClassIds": ["customers.people"], "prefer": "delete",
  "excludedRelated": [], "executedAt": "2026-11-16T10:00:00.000Z" }
```

The file and the row hold the internal id of an erased record. That is a pseudonymous reference, kept only because replay needs it. Rows are pruned on the same window as files.

## 📝 API Contracts

- **Settings.** `OM_ERASURE_MANIFEST_DIRECTORY`; `OM_ERASURE_MANIFEST_DEPLOYMENT_ID`, a short name unique to this deployment; `OM_ERASURE_MANIFEST_RETENTION_DAYS` (default 90). Added to both `.env.example` files.
- **CLI.** `mercato data_erasure restore-status [--refresh]` — pending count per tenant; exit 2 when any are pending. `mercato data_erasure restore-reapply [--tenant <id>] [--max <n>] [--exclude-related <kind:id> …] [--apply --confirm REAPPLY_ERASURES]` — preview by default; exit 2 when anything was skipped or failed.
- **Route.** `GET /api/data_erasure/restore-status`, feature `data_erasure.view`, for the settings page banner. It reads the stored result.
- **Notification** to users holding the erase feature when the pending count for their tenant becomes non-zero.
- **Doctor check** `erasure.manifest_unconfigured`, through the doctor's extension point. It looks at configuration only — both variables set, the directory writable — because the doctor reads no database.

## 📝 Edge Cases & Failure Scenarios

| Case | Behaviour |
|---|---|
| Directory or deployment id not configured | Erasures proceed and rows are written; a standing warning says restores are unprotected |
| File write fails | The row exists; the daily job retries the file |
| Event not delivered at all | Neither record exists. The daily job reads completed erasure entries from the action log since its last run and inserts the missing rows, if the action-log service offers that listing; the step confirms it. If it does not, this case is a stated gap |
| Replicas with separate local directories | Each sees only its own files; detection is unreliable. Unsupported, and the documentation says the directory must be shared |
| A staging copy of production with its own deployment id | Sees no files under its id; nothing is pending |
| A staging copy configured with production's deployment id and directory | Indistinguishable from production. The documentation names this as the mistake to avoid; the replay command's database check is the last guard |
| A restore from another environment's dump | Its rows carry another deployment id and are ignored; every file is then pending. Reported; the operator decides |
| The directory is lost | Detection finds nothing; stated as the reason it must be on durable storage |
| Replay target is the wrong database | The command compares the active database with the one the operator names, as the reference does, and refuses on a mismatch |
| A subject no longer exists after the restore | The run reports nothing found; the row is inserted |
| The subject has gained a related subject since | The run refuses it; the operator names or excludes it with a flag |
| Several replicas run detection at once | Each stores the same result; none replays |
| Files older than the retention window | Pruned with their rows; a restore from a backup older than that is not protected |

## 📝 Migration & Backward Compatibility

Additive: two tables, three settings, two commands, one route, one notification type, one DI key. Nothing changes for an installation that does not set the two variables, except a warning.

**Prior spec.** `2026-07-08-automated-database-backups.md` placed the manifest inside the backup module and listed entries only from the product's own restore. Its manifest section and its Phase 5 are replaced by this spec; the rest of it stands.

## 📋 Phasing

| Phase | Outcome |
|---|---|
| 1 | Rows, files, the subscriber, completing the pair |
| 2 | Detection, stored result, report, banner, notification |
| 3 | Replay command |

## 📋 Implementation Plan

### Phase 1
1. Store interface and directory implementation. Unit tests: atomic write, permissions, layout, a second write of the same id, count, list, prune.
2. The applied table and migration; the subscriber. Unit tests: row then file; redelivery; two concurrent deliveries; a failed file write leaves the row; a replay-origin event writes nothing.
3. The daily job's repair step, its registration and the module's registration command. Unit tests: a row without a file gets one. Confirm whether the action-log service can list completed erasure entries since a time; implement or record the gap here.

### Phase 2
1. Detection with the count-first comparison, and the stored result. Unit tests: nothing pending; files without rows; a new erasure after a restore leaves the old ones pending; another deployment's files ignored; variables unset.
2. Worker start-up hook; status route; banner; notification; the doctor check.

### Phase 3
1. `restore-status` and `restore-reapply`. Unit tests: preview, apply, wrong confirmation, wrong database, held subject, a failing subject, a new related subject, `--max`.
2. Integration test; docs: the operator procedure after any restore, the shared-directory requirement, the deployment id, the readiness-probe recipe.
3. Add the `Superseded by` line to the 07-08 backup spec. Archive this Delta into `.ai/specs/capabilities/erasure-restore-replay.md` if that directory has been adopted by then.

### File manifest

| File | Action |
|---|---|
| `packages/enterprise/src/modules/data_erasure/{lib/manifestStore.ts,lib/restoreDetection.ts,subscribers/erasure-manifest.ts,workers/*,cli.ts,api/restore-status/route.ts,data/entities.ts,migrations/*,runtime.ts}` | Create / modify |
| The settings page's banner component and locale keys | Modify |
| Both `.env.example` files, deployment docs | Modify |
| `packages/enterprise/src/modules/data_erasure/__integration__/TC-PRIVACY-REPLAY-001.spec.ts` | Create |
| `.ai/specs/enterprise/2026-07-08-automated-database-backups.md` | Modify — one annotation line |

## 🧪 Integration Coverage

| Test | Covers |
|---|---|
| TC-PRIVACY-REPLAY-001 | In the enterprise test environment with a temporary directory and deployment id: erase two people; a row and a file exist for each. Delete the first one's row with a direct query to simulate a restore, then erase a third person. `restore-status --refresh` exits 2 and `GET /api/data_erasure/restore-status` reports one pending. Preview lists it and changes nothing; a wrong confirmation changes nothing; apply with the confirmation clears the status |

A real restore is not exercised: the suite cannot roll its database back. Deleting a row stands in for it and is stated as such.

## 📝 Risks & Impact Review

#### A restore goes unnoticed
- **Scenario**: The directory was not configured, was not shared between replicas, or was on a disk that did not survive.
- **Severity**: High
- **Affected area**: every erased subject since the restored point
- **Mitigation**: A standing warning when unset; the documentation and the doctor's configuration check.
- **Residual risk**: Deployments with only ephemeral disks have no protection until an object-store backend is specified.

#### Erased data is served between restore and replay
- **Scenario**: The application runs for hours after a restore before anyone replays.
- **Severity**: High
- **Affected area**: restored tenants
- **Mitigation**: Error-level report from the worker at start and daily; a notification; the status command's exit code for a readiness probe; the procedure in the docs puts replay before reopening.
- **Residual risk**: By default the application runs, and detection can lag a restore by up to a day where no worker restarts. That is assumption 6.

#### The manifest itself is sensitive
- **Scenario**: Someone reads the directory.
- **Severity**: Medium
- **Affected area**: internal ids of erased records
- **Mitigation**: Owner-only files; no identifiers; a retention window.
- **Residual risk**: Ids are meaningful only alongside a copy of the data.

#### Replay erases something it should not
- **Scenario**: The command is aimed at the wrong database, or the directory holds another deployment's files under this deployment's id.
- **Severity**: High
- **Affected area**: the target database
- **Mitigation**: The deployment id in every path and row; ids are UUIDs and are never reused; the database check; preview by default; holds re-checked.
- **Residual risk**: An operator who confirms a preview without reading it, or two deployments configured identically.

#### A healthy system reports a restore
- **Scenario**: A file exists and its row does not, with no restore.
- **Severity**: Medium
- **Affected area**: operators' trust in the report
- **Mitigation**: The row is always written first; a row is never deleted except by pruning, which removes the file in the same step.
- **Residual risk**: A pruning run interrupted between the two deletes; it removes the file first for that reason.

## Final Compliance Report — 2026-11-16

- **Reviewed:** root `AGENTS.md`, `.ai/specs/AGENTS.md`, `packages/enterprise/AGENTS.md` (through the research). Not reviewed: the attachments and scheduler guides beyond what is cited.

| Rule | Status | Notes |
|---|---|---|
| Enterprise scope in the enterprise specs directory | Compliant | — |
| No cross-module table access | Compliant | Erasures go through the OSS run; the backup module is reached by a soft seam |
| Ask before adding production dependencies | Compliant | None added; the object-store backend is left out for that reason |
| Tenant scoping | Compliant | Rows and files are per tenant |
| Integration coverage | Partly | One test, with a simulated restore; stated |

**Verdict:** design ready; not approved until the governance engine spec and DEC-4 are.

## Changelog

### 2026-11-16
- Written autonomously with resolved assumptions.
- Revised after independent review. The single marker is replaced by a row per erasure, with pending computed as files minus rows: a marker would have been overtaken by the first erasure after a restore. Every file and row carries a deployment id. The row is written before the file and both are named by the event's run id, so redelivery and a crash between the writes are harmless. The web-tier start-up refusal is dropped, because only the worker role has a start-up hook; a readiness-probe recipe replaces it. Replay uses the original preference and exclusions, which the erasure event now carries, and marks its own runs so they are not recorded again. Supersedes the manifest section of the 07-08 backup spec.
