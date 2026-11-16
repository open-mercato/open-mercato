# Erasure restore replay

> **Program:** package C9 of [`../2026-11-15-gdpr-ready-deployments-program.md`](../2026-11-15-gdpr-ready-deployments-program.md) (tracker open-mercato/open-mercato#8593).
> **Builds on:** [`2026-11-16-privacy-dsr-engine.md`](2026-11-16-privacy-dsr-engine.md) and the OSS erase run in [`../2026-11-16-privacy-subject-erasure.md`](../2026-11-16-privacy-subject-erasure.md).
> **Reference only:** the erasure manifest and `restore-reapply` command on `upstream/feat/security-readiness` (PR #5557).
> **Code baseline:** supplied repository snapshot at the spec commit; current-code claims were rechecked there. Branch and PR references are design history, not evidence of shipped replay behavior.
> **Written autonomously.** No question was put to a person; the choices are listed under Resolved assumptions.

Extends: .ai/specs/enterprise/2026-11-16-privacy-dsr-engine.md
Supersedes: .ai/specs/enterprise/2026-07-08-gdpr-data-erasure.md — all replay/manifest provisions; retained rationale stays historical
Extends: .ai/specs/enterprise/2026-11-06-cli-backup-restore.md
Supersedes: .ai/specs/enterprise/2026-07-08-automated-database-backups.md — every erasure-manifest provision: TLDR/scope/ownership, Design Decisions, Architecture DI/diff and coupling, event pending count, data model, restore CLI post-step/privacy exit code, Security, Failure Scenarios, Phase 5 manifest step, integration expectations, Risks and prior compliance claims; backup scheduling/storage/archive retention/UI stay with that carrier

## 📝 TLDR

When a database is restored to a point before an erasure, the erased person comes back. Nothing in the product notices: the record of the erasure was in the database that was just rolled back. **Proposed (future):** a protected erasure synchronously makes a small file durable outside the database after verification and before its event/completed audit/success; an applied row follows completed-audit proof. Event delivery and later repair do not establish that guarantee. After a restore, some file run ids have no row. The product computes that exact set difference, says so loudly, and an operator runs one command that erases those subjects again.

**Status.** Depends on the governance engine spec and, through it, on the OSS erase run; neither is approved. The program's decision DEC-4 — that replay must work for a restore done outside the product — is taken here as a requirement, not yet confirmed by a maintainer.

**Not in this spec:** taking or restoring backups; automatic replay with no operator; removing erased data from backup archives, which age out; an object-store backend for the files.

## 📝 Overview

The 07-08 erasure spec set the position this spec keeps: one mechanical guarantee, that backups expire, and one operator control, a guided re-run after a restore. It also noted that a raw restore bypasses the control. This spec makes the control detect a restore it was not told about.

The erasure evidence must outlive a database rollback. Replay uses the normal guarded erasure service; this spec owns external capture and the operator workflow. **The `eraseSubjects` entry point (R3-14)**, in C4's API Contracts, owns the unchanged input/result and event. C4's **The run**, step 10, and **Optional completion capture — C9** now specify the awaited capture call with this spec's exact input; its **Audit entries** defines per-attempt `PrivacyErasureAuditContext.verifiedAt`, mandatory for new complete subject entries and identical to the capture timestamp. The OSS implementation and C9's capture/crash/restore-before-repair tests remain required before protected completion can be claimed. A spec revision, finite evidence expiry and asynchronous reconciliation do not themselves close the program's durability gate.

## 📝 Resolved assumptions (autonomous defaults)

| # | Question | Chosen | Rationale |
|---|---|---|---|
| 1 | Which backup tooling it assumes | None. It works whether a restore is done by the product's backup module, managed point-in-time recovery or by hand | Detection must not depend on a product restore hook. |
| 2 | Where the files live | A directory named by an environment variable, on storage that every replica shares and that is not part of the database or its backups | ⚠ NEEDS HUMAN CONFIRMATION. It needs no new dependency. A deployment whose replicas have only local or ephemeral disks cannot use it, and the spec says so instead of pretending. An object-store backend needs a dependency decision and its own spec. |
| 3 | How "what is missing" is computed | The set of files minus the set of rows | A single "newest applied" marker is overtaken by the first erasure after a restore, and everything before it is then forgotten. |
| 4 | Telling deployments apart | A deployment id from the environment, in the path of every file and on every row | A staging copy that shares the directory would otherwise make production replay staging's erasures. |
| 5 | Replay | Operator-run, preview by default, never automatic | The 07-08 spec rejected automatic replay; a later legal hold must be able to stop it. |
| 6 | When a restore is detected | Reported at error level, shown on the privacy settings page, and sent as a notification to unrestricted users who may erase. The application keeps running | Refusing to serve would turn a restore, already an incident, into an outage; and only the worker role has a start-up hook today. An operator who wants a hard stop puts `restore-status --refresh`, which exits non-zero unless fresh comparison succeeds and is clear, in the start command or readiness probe. |
| 7 | How long files are kept | 90 days by default for settled entries; pending files never age out. The operator must set the window above the longest backup they can restore | ⚠ NEEDS HUMAN CONFIRMATION. A settled file only needs to outlive restorable backups. Pending entries remain evidence of unresolved work and may retain pseudonymous ids beyond the ordinary window. |
| 8 | Replaying a subject known only by an address or number (`privacy:identifier`) | Not replayed automatically, and never marked applied by automatic replay; only a verified acknowledgement can satisfy one. The entry is listed as needing the identifier and stays pending until the operator re-runs the erasure by identifier and acknowledges the entry. The acknowledgement is accepted only when a completed erasure of the same derived id has a strictly later final-verification timestamp than the captured original verification; the original completion audit cannot satisfy it | Such a subject has no record. Its id is a keyed digest of the tenant and the identifier, stable while the lookup secret is unchanged and impossible to reverse (contract spec, "A subject that is only an identifier"). Its records are found only through hashes of the identifier typed, which the contract keeps out of subject ids and events. The entry therefore holds nothing a later run could find them by, and a replay would find nothing and report success while the restored guest baskets, pay-link payments, claims and messages stay live. The operator has the identifier in their record of the request; because the id is derived, the product can check that the re-run was for the same identifier. |
| 9 | Protected completion boundary | ⚠ NEEDS HUMAN CONFIRMATION. Default: the OSS run awaits enterprise-owned `privacyErasureCompletionCapture.capture` after final verification, before event/completed audit/success; configured file failure leaves the run incomplete | A database rollback can destroy every repair source before an asynchronous subscriber runs. Fallback: keep C9 unprotected and block its closing gate until an equivalent durable pre-completion capture is approved; never label eventual repair as protection. |

## 📝 Problem Statement

- **An erasure does not survive a restore.** The subject's rows, the engine's ledger row and the OSS audit entries are all in the restored database.
- **Backup tooling cannot be the only trigger.** The companion backup design is not required for a raw database restore. Detection must compare durable files with database rows without relying on a product restore hook.

- **Storage options are limited.** The attachments storage drivers can store, read and delete but not list, and their configuration is itself read from the database (`packages/core/src/modules/attachments/lib/drivers/types.ts:22-33`, `packages/core/src/modules/attachments/lib/drivers/driverFactory.ts:64-66`). This interface cannot supply manifest enumeration independently of the restored database.
- **Only the worker role has a start-up hook.** Module runtimes are wired for `worker` alone (`packages/shared/src/modules/runtime.ts:22-23, 67`; `packages/cli/src/mercato.ts:1892-1895`), and the optional bootstrap fallback catches its import/bootstrap errors (`packages/shared/src/lib/di/container.ts:278-284`). The web tier cannot be made to refuse at start without new wiring.
- **Events are redelivered.** A subscriber may run more than once for one erasure, and two may run at once.
- **Useful parts of the reference:** the entry shape, atomic owner-only writes, preview by default, a typed confirmation, a check that the command is pointed at the intended database, and re-running each entry through the normal erase path so that holds are checked again.

## 📝 Proposed Solution

1. **External capture before protected completion.** Register `privacyErasureCompletionCapture` in `data_erasure/di.ts`. The OSS run must await its `capture` after final standing verification (including both history passes and pending-file drain), before emitting `privacy.subject.erased`, writing its completed audit or returning success. The capture input is `{ scope: PrivacyScope, subject: PrivacySubjectReference, runId: string, origin: PrivacyErasureOrigin, prefer: PrivacyErasurePreference, excludedRelated: PrivacySubjectReference[], results: Array<{ dataClassId: string; sections: PrivacyErasureSectionResult[] }>, verifiedAt: string }`; `capture(input): Promise<void>` validates zod and contains no reference, aliases or values. These R3-14 types come from **The `eraseSubjects` entry point**; this is a separate optional internal DI seam, not an added input/result member or event field.
   - For configured protection, atomically create the immutable manifest, flush the file and containing directories to durable shared storage, and only then resolve. Use create-if-absent publication with identity comparison, never an overwriting rename. `dataClassIds` is distinct `results[].dataClassId`; `executedAt` is this final verification timestamp, never event delivery or a later repair time. The applied row is inserted only once the completed audit proves success. A capture failure throws `evidence_capture_failed`; the run remains incomplete with its started journal, owes retry, and emits no completion event. Missing registered provider resolution also refuses. No protected success is returned before durability; unsupported directory durability is an unprotected deployment, not success.
   - A file with no row after a capture/event/audit crash is conservatively pending, even without a restore. Its verified intent is usable for replay after a restore that removes every database repair source. An incomplete verified run may therefore require a safe redundant re-erasure. Audit reconciliation can settle it while the completion still exists. A retry compares identity and preserves an existing file's original `executedAt`; a later same-run completion must not clear a pending identifier file without acknowledgement.
   - Origin `engine:replay` generates no new manifest: the existing pending file is already durable. Replay completion still commits its applied row/ledger proof. For zero-change or no-event completions, capture is still awaited before protected success. A multi-subject caller invokes capture for each subject's run id, never only the coordinator id.
   - With either required environment variable absent, ordinary OSS erasure remains available but explicitly unprotected: local rows use `local-unprotected`, no file/protected claim is made, and status/page/doctor warn. Configuration alone does not prove the hook is installed; the engine refuses protected activation until the seam test and registration pass. The subscriber is a repair/ledger consumer, never the sole capture path.
2. **Repair precedes comparison.** Startup, the daily job, `restore-status --refresh`, and every `restore-reapply` preview/apply/acknowledgement call run the same sequence: reconcile completed audit entries; repair surviving verified captures or write missing files for surviving completed audits/rows; compute the exact file-minus-row set; prune only settled pairs; publish the stored status. A failed repair reports `repair_incomplete`; it never clears a previous pending alert. The read-only status route shows the stored count, last check and repair error without scanning files.
3. **Mandatory audit reconciliation.** Resolve `actionLogService.list` by DI and list tenant-scoped `privacy.subject_erasure` entries with `sortField: 'createdAt'`, `sortDir: 'asc'`, `pageSize: 100`, independent `resourceKind`, `after` and `before` filters. These filters and stable createdAt/id ordering exist (`packages/core/src/modules/audit_logs/services/actionLogService.ts:491-541, 566-604`). The service decrypts its own context; no audit table access is added here. Validate the delivered `PrivacyErasureAuditContext`, require `status: 'complete'` and matching subject/intent, and exclude origin `engine:replay`. Started/incomplete context and an event alone are not completion proof. Rebuild absent applied rows and files even if no event was delivered or the run changed nothing, subject to the existing-file/reused-run rule below. Reconstruct execution time from the required saved verification timestamp; completion `createdAt` is only a conservative historical fallback for explicitly labelled legacy/unprotected repair. After rollback, never manufacture a row for an unproven file from another erasure's completion.
   - Persist a per-tenant cursor with the last fully scanned time window, its fixed upper timestamp, page and last completed audit id. Start the initial scan at the earliest retained completion; use a one-millisecond overlap at exclusive time bounds, stable pages of 100 and run-id upserts. Advance the time watermark only after every page and corresponding file write succeeds. Retry an interrupted window idempotently. The daily sweep also rescans all retained completed privacy entries, so late commits behind the incremental watermark are not lost.
   - Scope, `origin`, `prefer`, `excludedRelated`, subject, `runId`, reference, completion status and per-attempt `verifiedAt` are specified in C4's typed encrypted context under **Audit entries**. Consume the timestamp from that validated context; C4's **The run**, step 10, and **Optional completion capture — C9** specify its identical value at synchronous capture. The reference is used only for ledger correlation and never copied to a file or event. Their implementation remains an OSS dependency; a missing service or unusable context makes repair incomplete, not a supported silent gap.
   - C4's **Erasure-evidence expiry**, assumption 20, separately declares `privacy.erasure_evidence` and `retention.privacy.erasureEvidenceAgeDays` (default 365 days, floor 30). R4-4 replaces the proof-contract handoff with C4's optional DI seam `privacyErasureEvidenceHold`, whose only method is `isPending({ scope, runId }): Promise<boolean>`. Expiry skips a run when any registered provider returns true or throws, counts it as `held_by_owner`, and retries on the next pass. With no providers, nothing is held through this seam; C4's terminal/hold/recovery rules still apply. Replay's provider returns true while an unsettled manifest entry or applied-row pair exists for that scoped run and answers from its own rows only, separately from the engine's unresolved-operation/reconciliation provider. The per-run representation gap for file-only pending entries is recorded under **Data Models**; this revision adds no schema to fill it. Scan only surviving audit evidence, report absent/expired proof honestly and never assume an indefinite audit repair source. A pending external file remains pending regardless of age; acknowledgement without a surviving later complete proof refuses. C4's finite age is independent of C9's settled-pair window and cannot replace pre-completion external durability.
   - **An existing file and a reused run id.** A valid existing file is immutable. If the same run id has a later completion whose typed `context.verifiedAt` is strictly after the file's `executedAt`, compare subject, scope, preference and exclusions with that file; a mismatch is an evidence error. For a matching pending identifier file, do not recreate its original applied row from that later completion: preserve pending state until explicit acknowledgement, which may use the later completion as proof. Maintenance must not overwrite its timestamp or clear it before `--acknowledge`. An already satisfied row retains the file's original execution metadata. This also makes resumed-run acknowledgement compatible with strict same-run file validation.
4. **Exact pending set.** For each configured deployment, tenant and month, validate and enumerate all file run ids and subtract the scoped applied-row run ids. Counts are only a display statistic, never a shortcut that skips this difference. A file without a row remains pending even if another row lacks a file and the counts happen to match.
5. **Preview-bound replay.** Require `--expect-database <name>` and compare it with the configured active database name before any destructive call. Preview lists pending entries and emits a fifteen-minute confirmation token over actual database name, deployment id, tenant filter, every pending run id and normalized manifest digest, selected run ids under `--max`, original organization scopes, preferences, effective exclusions and acknowledgement ids. Canonical JSON sorts keys and sets. Use the OSS purpose-key derivation with label `privacy-restore-replay-confirmation`; without lookup secret, use a disclosed plain digest for record subjects, as the OSS confirmation design does. Apply repeats these flags, rebuilds the pending set and refuses an expired/mismatched token before erasure. A new pending entry, edited file, changed exclusion or changed database requires a new preview.
6. **Apply.** For each selected validated record subject whose stored `organizationId` is null call the R3-14 `privacySubjectService.eraseSubjects` entry point with `{ scope: { tenantId }, subjects: [entry.subject], excludedRelated, prefer: entry.prefer, actor, reference: 'privacy-operation:<replayOperationId>', origin: 'engine:replay', mode: 'apply' }`. The reference uses the engine's audit-only correlation format. Null stored organization means tenant-wide. The current OSS erasure spec's **The run**, step 1, refuses `organizationId` with `TENANT_WIDE_SCOPE_REQUIRED` in both modes. Preserve a historical non-null scope in evidence but report that entry `scope_unsupported`, leave it pending and make no erase call; never drop the organization to widen it. Future support requires an erasure-owner scope design, not a replay workaround. Extra exclusions may only narrow the original operation and are covered by the token. Inspect the matching R3-14 `subjects[]` entry, not only aggregate `complete`: status `complete` with zero `filesPending` is satisfied. R3-14's `not_found` for a record subject is also satisfied: record the owner-scoped absence outcome and scope in the applied row, even if the restore removed the original audit entry. A refused/incomplete subject gets no applied row and remains pending. This rule never treats an identifier as absent.
Reject `scope_unsupported` entries before apply or acknowledgement verification; their evidence stays pending.
7. **Identifier entries stay manual (DEC-A, "Subjects known only by an identifier (`privacy:identifier`)").** `--apply` neither calls the run nor inserts an applied row for `privacy:identifier`. Preview prints its run id, time, class ids and the identifier erase command to run with the original preference/scope/exclusions. It stays pending until `--acknowledge <runId>` is verified.
   - Resolve completed entries for that derived id through `actionLogService.list`. Require the same tenant and explicit tenant-wide scope (historical organization-scoped entries are blocked), preference and exclusions, a complete result, and validated `context.verifiedAt > entry.executedAt`. The original completed entry carries exactly the capture's verification timestamp, so its later audit-write `createdAt` never qualifies as rerun proof. Missing verification time refuses; never fall back to audit-write time for acknowledgement. Compare the erasure's context `runId`, not its audit entry id. A later completion may reuse the original `runId` if an interrupted run was resumed; its fresh final-verification timestamp distinguishes it from the original completion. Every resumed completion performs final verification again and stores that attempt's `verifiedAt`; the initial attempt's timestamp remains immutable in the manifest. An unchanged original verification at `executedAt` proves nothing, even if its audit entry was written later. A zero-change completion is valid. This implements DEC-A's completed-rerun requirement without accepting a weaker preference.
   - A matching completion inserts the applied row as acknowledged and records the verifying audit id, `runId`, time and operator in the ledger/audit. Without it, refuse and leave pending. A changed lookup secret may make verification impossible; that entry remains visible indefinitely until resolved, never silently pruned.
8. **Ledger and pair completion.** Before apply/acknowledgement, create a `privacy_operations` row with type `replay` or `replay_acknowledgement`, source run id, exact scope and intent. On satisfaction, update that operation and insert the original applied row in one own-module transaction; use source run id and operation type for idempotent recovery. Record not-found proof or the verifying completion when relevant. Failed/refused attempts also remain in the ledger but get no applied row. Reconciliation uses the audit-only operation reference to complete an interrupted operation; it never depends on the engine subscriber ignoring engine origins. No new file is written for a replay run.

### Design decisions

| Decision | Rationale |
|---|---|
| The file is durable before protected completion; the row follows completed-audit proof | A restore before asynchronous repair must still leave external evidence. A verified file without a row may be a crash, so pending can conservatively over-report until reconciliation or replay. |
| The rows live in the database on purpose | They are the thing that *should* roll back with a restore; that is how the restore is seen. |
| No ordering between entries is needed | Set difference does not care which worker committed first. |
| Replay goes through the normal erase run | Holds placed since are honoured, module rules apply, and the run is idempotent. |
| Replay writes no new file | The subscriber ignores events whose origin is replay; repeated restore drills must not grow the list. |
| Refusal remains pending; record-subject absence is satisfied | R3-14 distinguishes `not_found` from refusal. An identifier has no absence shortcut. |
| Files are grouped by deployment, tenant and month | The exact difference is streamed by directory in bounded batches; equal counts never prove equality. |
| Backup restore and privacy readiness have separate results | The amended backup carrier prints the C9 runbook only; it imports no replay DI service and computes no pending count. |

### Alternatives considered

| Alternative | Why rejected |
|---|---|
| A "newest applied" marker per tenant | See assumption 3. |
| Keep the manifest in the database | It rolls back with the data. |
| Automatic replay at start | Ruled out in the 07-08 spec; it would erase without anyone looking, including subjects under a new hold. |
| Refuse to serve when a restore is detected | See assumption 6. |
| Event delivery and database repair as the only capture | A restore before repair removes the row, journal and audit together. This cannot establish durable evidence before protected completion; the awaited capture seam is required. |
| Keep the identifier's lookup hashes, encrypted, in the file so that replay can find an identifier-only subject's records | It would place a pseudonym of the person's address outside the database for the whole retention window, under a key that sits beside the directory. It would also need the in-process erase run to accept caller-supplied aliases, which the contract does not offer. The derived id cannot be reversed into aliases, but it is itself a keyed identifier pseudonym and permits guess-testing with secret material; the sensitivity remains explicit. |
| Accept `--acknowledge` on the operator's word | The status would clear while the restored records stay live if the re-run was mistyped, never made, or failed. |
| Reuse the attachments drivers | No list operation, and their configuration is in the database being restored. |

## 📝 Delta

### Capability: erasure-restore-replay

#### ADDED Requirement: Erasure manifest
The system SHALL make external evidence durable before a configured protected erasure can emit completion, append its completed audit or report success; the database row follows proof of completion. The file contains no identifier beyond internal pseudonymous subject references.

##### Scenario: After an erasure
- WHEN a protected erasure completes
- THEN its external file is already durable, and the matching applied row follows completed-audit proof; comparison conservatively reports pending until that settlement

##### Scenario: Delivered twice
- WHEN the completion event is delivered twice, or to two workers at once
- THEN there is still one row and one file

##### Scenario: Crash between the two writes
- WHEN external capture succeeded but the process crashes before event/completed audit/applied-row settlement
- THEN the file remains pending until completed-audit reconciliation or guarded replay; a database rollback before repair cannot remove it

##### Scenario: Restore before any asynchronous repair
- WHEN a protected completion is followed by a crash and a restore to before erasure before any subscriber or repair job runs
- THEN external evidence still exists and exact comparison reports the run pending

##### Scenario: Undelivered completion event
- WHEN a completion event is never delivered, including a no-event zero-change completion
- THEN synchronous capture still leaves durable external evidence before protected success

##### Scenario: External capture fails
- WHEN a configured directory write or durability flush fails
- THEN no protected completion/event is reported, the started run remains incomplete and retryable, and status exposes the failure

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

##### Scenario: Equal counts hide different run ids
- WHEN one file lacks its row and a different row lacks its file in the same month
- THEN repair runs first and exact set difference still reports the pending file

##### Scenario: A pending file reaches the age window
- WHEN the settled-evidence retention date passes and no applied row exists
- THEN the file and alert remain until the entry is satisfied

##### Scenario: Erasure-evidence expiry meets unsettled replay work
- WHEN C4 checks a run with an unsettled manifest entry or applied-row pair
- THEN replay's R4-4 `privacyErasureEvidenceHold.isPending` returns true from its own scoped rows, expiry counts the run as `held_by_owner` and retries on the next pass; a throwing provider also counts as pending, and no providers adds no hold

#### ADDED Requirement: Replay
The system SHALL let an operator re-run the pending erasures, in preview by default.

##### Scenario: Preview
- WHEN the command runs without the apply flag
- THEN it repairs evidence metadata, lists the subjects it would erase and emits a token, without changing subject data

##### Scenario: Apply
- WHEN it runs with the apply flag and the confirmation
- THEN the preview-bound set is replayed through R3-14 with its original scope, preference and exclusions; complete and record-subject `not_found` results are satisfied, while refused/incomplete and identifier entries stay pending

##### Scenario: Record subject absent after restore
- WHEN a record subject was created and erased after the restored point and R3-14 returns `not_found` in its original scope
- THEN the entry is satisfied with absence proof and a replay operation, without requiring the lost original audit

##### Scenario: Preview no longer matches
- WHEN database, pending set, manifest, exclusions or acknowledgement inputs change
- THEN apply refuses before subject changes and requires a fresh token

##### Scenario: Held since
- WHEN a subject to replay is now under a legal hold
- THEN it is skipped, reported, and still pending afterwards

##### Scenario: A subject known only by an identifier
- WHEN a pending entry is for a `privacy:identifier` subject
- THEN preview lists it as needing the identifier, apply does not run it and inserts no row, and it stays pending until the operator acknowledges it after re-running the erasure by identifier

##### Scenario: An acknowledgement with no re-run
- WHEN the operator passes `--acknowledge` for that entry and no completed erasure of the same derived id is recorded after the entry's time with the same scope, preference and exclusions
- THEN the command refuses it, inserts no row, and the entry stays pending

##### Scenario: An acknowledgement after the re-run
- WHEN a completed erasure by the same identifier has run since the restore
- THEN `--acknowledge` inserts the row and the entry is no longer pending

## 📝 Architecture

All inside the enterprise `data_erasure` module.

- **`lib/manifestStore.ts`**: `write(entry)` and `list(deployment, tenant, month)` plus guarded `prune({ scope, olderThan, appliedRunIds })`. Write owner-only temporary files, fsync them, publish exclusively and fsync the directory chain to `<deployment>/<tenant>/<yyyy-mm>/<runId>.json`. Zod validation is mandatory on write/read; the path's deployment, tenant, run id and UTC month must equal the payload. Reject unknown versions, unsafe path tokens, malformed ids/dates, conflicting same-run payloads and symlinks. Invalid files produce a visible status error and are neither replayed nor pruned; they cannot masquerade as a zero pending count.
- **`lib/completedErasureReconciliation.ts`**: mandatory audit-service scan and row/file repair with persisted per-tenant windows and page cursor. Reuses the engine's operation reconciliation for audit references. The action-log listing is a required dependency for protected replay; missing service/context keeps the warning/error active.
- **Erasure-evidence owner signal**: contribute replay's R4-4 provider to C4's `privacyErasureEvidenceHold` seam in `data_erasure/di.ts`, alongside the engine provider. `isPending({ scope, runId }): Promise<boolean>` returns true while an unsettled manifest entry or applied-row pair exists for that run, false only after a successful own-row check establishes no unsettled work, and throws on read failure. This check reads only replay's own scoped rows; audit-service reconciliation and file repair remain separate operations. R4-4 supplies the seam and true/throw/absence behavior, replacing the proof-contract handoff. The file-only pending representation below remains an implementation blocker for this provider.
- **`lib/completionCapture.ts`** and DI **`privacyErasureCompletionCapture`**: the synchronous verified file-first completion boundary above. The provider has no cross-module table reads. C4's **The run**, step 10, specifies the awaited call, `evidence_capture_failed` checkpoint and retry; no implementation can claim protection until that dependency ships.
- **`subscribers/erasure-manifest.ts`**: idempotent event ingestion; obtain typed attribution through `actionLogService.list` using the subject event's `runId`, wait for completed proof, and settle the existing file/applied row. The R3-14 event has no reference or timestamp; the persisted capture/audit supplies verification time. Missing evidence makes repair incomplete; delivery never substitutes for capture.
- **`workers/`** and **`runtime.ts`**: the ordered repair/detection/prune sequence on the module queue, plus worker-start invocation. No new polling mechanism.
- **`lib/restoreDetection.ts`**: exact scoped run-id set difference and stored status.
- **`cli.ts`**: `restore-status`, token-producing preview, confirmed apply and verified acknowledgement with expected database.
- **Backup boundary**: the current backup carrier prints the independent status/replay runbook and keeps archive exit status separate. No `erasureReplayStatus` integration is required or promised.

**Pruning.** Only a validated old file whose scoped applied row exists is eligible. A file without a row is pending, regardless of age; preserve it until replayed/acknowledged. Under the module's prune lease, remove the file first and its matching row only after successful file deletion. Keep the reconciliation watermark so the same old completed audit is not regenerated as a new file during an ordinary sweep; full audit backscans skip settled completions older than the configured evidence window. This exclusion never applies to an existing pending file. A crash leaves an old row with no file, which repair can reconstruct or prune on retry. Never age-delete an invalid file or pending entry, including an identifier entry made unacknowledgeable by a secret change. Report the oldest pending age and the capacity cost. Completed privacy-operation ledger rows have the engine's separate 365-day window.

| Touchpoint | Mechanism | Absent |
|---|---|---|
| Module → OSS erase run | `privacySubjectService` by DI key | The module requires `privacy`; R3-14 tenant-only erase calls and the per-subject outcome gate apply |
| Repair/acknowledgement → completed erasure entries | Required `actionLogService.list` by DI; typed/decrypted completed context from the OSS erasure spec | Refuse protected replay/reconciliation with `repair_incomplete`; pending status is preserved |
| Module → manifest directory | `OM_ERASURE_MANIFEST_DIRECTORY` and `OM_ERASURE_MANIFEST_DEPLOYMENT_ID` | Either unset: local rows use reserved deployment id `local-unprotected`, no files are written, and the page/doctor warn that restores are unprotected. Never infer a deployment id from restored rows |
| OSS completion → external evidence | New optional `privacyErasureCompletionCapture.capture`, awaited after final verification and before completion | No provider/configuration means unprotected; a registered provider failure refuses completion, never silently degrades |
| OSS erasure-evidence expiry → replay | C4's optional `privacyErasureEvidenceHold.isPending({ scope, runId }): Promise<boolean>`; own-row unsettled manifest/applied-pair check under R4-4 | No providers: nothing held by this seam. Any provider true/throw: `held_by_owner`, retry next pass; file-only pending representation is OPEN_DESIGN below |
| Backup restore → privacy readiness | Printed runbook step only; operator invokes C9 commands | Archive success never certifies replay, and no empty-count result is inferred |
| Web tier → detection result | Its own table | Shows the last result and when it was computed |

## 📝 Data Models

| Table | Columns |
|---|---|
| `privacy_erasure_applied` | UUID `id`, `run_id`, `deployment_id`, `tenant_id`, nullable `organization_id` (null explicitly means tenant-wide), `subject_kind`, `subject_id`, `data_class_ids`, `prefer`, `excluded_related`, `origin`, `executed_at`, `file_written_at?`, `satisfied_by` (`erasure` \| `subject_absent` \| `acknowledgement`), `satisfied_at`, `verification_json?`, `created_at`, `updated_at`. Unique on deployment, tenant and run id; indexed on deployment/tenant/executed time. Absence proof stores owner-scoped R3-14 `not_found`, scope and checked time, no identifying field values |
| `privacy_erasure_replay_state` | UUID `id`, `deployment_id`, `tenant_id` (unique together), `pending_count`, `oldest_pending_at?`, `invalid_file_count`, `checked_at`, `repair_error_code?`, `audit_scan_after?`, `audit_scan_until?`, `audit_scan_page?`, `audit_last_entry_id?`, `created_at`, `updated_at` |

**OPEN_DESIGN — R4-4 file-only pending state.** This spec owns the missing per-run own-row representation needed to answer `privacyErasureEvidenceHold.isPending` when durable capture leaves a pending manifest with no applied row. `privacy_erasure_replay_state` has aggregate counts only, and replay operations are created when apply/acknowledgement starts; neither identifies every such pending run. The same own-row absence can therefore mean file-only pending work or no remaining replay work after settled-pair pruning. A manifest scan would violate R4-4's own-rows-only rule, and no additional table, column or member is authorized by that decision. The provider cannot claim complete coverage until the replay owner resolves this representation; it must not report an unknown state as settled. This is a data-model gap, not a reinstated proof-contract handoff.

**Manifest file (version 1, strict zod schema)**

```json
{ "version": 1, "runId": "…", "deploymentId": "prod-eu", "tenantId": "…", "organizationId": null,
  "subject": { "kind": "customers:person", "id": "…" },
  "dataClassIds": ["customers.people"], "prefer": "delete",
  "excludedRelated": [], "executedAt": "2026-11-16T10:00:00.000Z" }
```

Require valid tenant/organization/run UUIDs, a subject kind declared by the contract with a UUID record id or contract-derived `idv1_` identifier id, known preference, typed exclusion references, UTC date-time and a safe deployment token. `organizationId` is required and nullable: a missing field cannot silently widen scope. Bound arrays and file size; the command reports validation failure without printing payloads. Match every identity field and the date's month to the path before computing pending eligibility. Keep removed-kind entries visible as `kind_unavailable`, never invalidating/pruning them merely because the current module registry lacks the owner. Non-null historical scopes are retained but cannot execute with today's tenant-only run.

The file's internal subject reference is pseudonymous personal data. In particular, an identifier entry stores a keyed pseudonym of an address/number, useful for verified manual acknowledgement; it does not provide the aliases needed for automatic replay. The ordinary settled row/file window is 90 days. Pending files and their metadata never age out automatically.

Replay operation rows store `source_run_id` and, for acknowledgement, `verification_run_id`/verification audit id; a resumed operation is idempotent by deployment, tenant, source run id and type. The applied-row/ledger completion transaction owns only this module's tables. In `privacy.ts.tables`, use the table-coverage spec's exact objects: applied rows have `{ personalData: { kind: 'retention_bounded', boundedBy: 'data_erasure.replay_evidence' } }`; replay state has `{ personalData: { kind: 'tenant_configuration', note: 'deployment/tenant status and audit cursor; no subject values' } }`. Declare record set `data_erasure.replay_evidence`, `targets: ['records']`, `minimumDays: 1`, `excludableSubjectKinds: []`, `handlerService: 'replayEvidenceRetentionHandler'`. The handler requires the configured deployment and a window at least `OM_ERASURE_MANIFEST_RETENTION_DAYS`, then performs only the settled scoped file-first pair pruning above; pending or invalid evidence is never eligible. Maintenance uses `privacyRetentionService.run`, preserving DEC-C, "Retention sets and holds", and its conservative hold skip and guard errors. This named set supplies `boundedBy`; the positive default remains 90 days, not an indefinite exemption. Applied rows are replay evidence, deliberately exempt from subject erasure until their bounded settled window expires; they are not claimed as anonymous.

Deployment names allow 1–64 ASCII letters/digits, hyphen or underscore; `local-unprotected` is reserved and cannot be configured. Both variables must be set before generating files. When configuration is later enabled, audit reconciliation creates evidence under the explicitly configured deployment; it never relabels an imported deployment's rows.

## 📝 API Contracts

- **Settings.** `OM_ERASURE_MANIFEST_DIRECTORY`; `OM_ERASURE_MANIFEST_DEPLOYMENT_ID` (validated as above); `OM_ERASURE_MANIFEST_RETENTION_DAYS` (positive integer, default 90). Add to both app/template `.env.example` files. The window controls settled evidence only.
- **CLI.** `mercato data_erasure restore-status [--refresh]` reports pending counts and repair/validation state; exit 2 while pending, 1 on invalid configuration/evidence or incomplete repair, 0 only for a successful clear check. Readiness/startup recipes MUST invoke `restore-status --refresh`; a cached clear row alone cannot authorize reopening, and refresh failure is non-zero. `mercato data_erasure restore-reapply --expect-database <name> [--tenant <id>] [--max <n>] [--exclude-related <kind:id> …] [--acknowledge <runId> …] [--apply --confirm <token>]`. Preview is the default and prints its token. `--max` defaults to 100 and allows 1–1000; processing batches/page sizes stay at most 100. Repeat the exact flags with `--apply`; acknowledgements are also previewed and confirmed. Exit 2 on pending/refused/incomplete entries; a confirmation/database/schema error exits 1 before subject changes. `--acknowledge` accepts identifier entries only, verified by the matching completed audit as specified above.
- **Route.** `GET /api/data_erasure/restore-status`, feature `data_erasure.view`, exports `GET = withTenantWideScope(handler)` under R3-9, "Organization-scope guard on every DSR route", in the engine spec's API Contracts. It reads only the caller tenant's stored counts/time/error state; restricted or unresolved organization scope returns 403.
- **Notification.** Send only to tenant staff who currently have the erase feature through wildcard-aware RBAC and satisfy the same unrestricted organization-scope predicate. Re-evaluate the audience when sending, rather than trusting a feature grant alone. Payload carries count and a page link, no manifest references or subject ids; page/status access rechecks scope.
- **Doctor.** `data_erasure.manifest_unconfigured` is declared in `privacy.ts.doctorChecks` under DEC-I, "The doctor's extension point", and R3-2, "The registry carries the whole `privacy.ts` default export". The default check is configuration-only: required variables and safe deployment name. Report directory existence, shared durability and cross-replica visibility as operator attestations, not verified configuration facts; the status/capture commands perform I/O checks. Database inspection, if added by the doctor owner, belongs to R3-4, "An opt-in database tier for the doctor"; this spec adds none.

## 📝 Edge Cases & Failure Scenarios

| Case | Behaviour |
|---|---|
| Directory or deployment id not configured | Erasures proceed and rows are written; a standing warning says restores are unprotected |
| Configured capture file write/flush fails | The erasure stays incomplete, emits no completion and is not protected; retry its started journal. Surviving historical rows may be repaired but do not retroactively prove the original completion was protected |
| Event not delivered, or a zero-change run emitted none | Protected completion already awaited durable capture; mandatory audit reconciliation settles rows. Restore-before-repair still finds the file; a scan error preserves incomplete status |
| Replicas with separate local directories | Each sees only its own files; detection is unreliable. Unsupported, and the documentation says the directory must be shared |
| A staging copy of production with its own deployment id | Sees no files under its id; nothing is pending |
| A staging copy configured with production's deployment id and directory | Indistinguishable from production. The documentation names this as the mistake to avoid; the replay command's database check is the last guard |
| A restore from another environment's dump | Its rows carry another deployment id and are ignored; every file is then pending. Reported; the operator decides |
| The directory is lost | Detection finds nothing; stated as the reason it must be on durable storage |
| Replay target is the wrong database | Require `--expect-database`, compare with the active configured database and refuse a mismatch before erasure; the token also binds that database and deployment |
| A record subject was created and erased after the restored point | R3-14 returns owner-scoped `not_found` without requiring the lost historical audit; record scoped absence proof, insert the original applied row and complete its replay operation. Never apply this shortcut to an identifier |
| The pending entry is for a `privacy:identifier` subject | Not run; no row inserted; listed as needing the identifier; pending until `--acknowledge <runId>` after the operator's own re-run by identifier |
| `--acknowledge` names an entry for a subject with a record | Refused; that entry is replayed by `--apply` |
| `--acknowledge` with no re-run, a re-run by another identifier, or a re-run that did not complete | Refused; no row; the entry stays pending. The message names the missing run |
| The operator's re-run found nothing left to change | Accepted: the erase run writes its completed entry even with zero rows affected |
| The re-run is refused by a hold placed since | No completed entry; `--acknowledge` refuses, as `--apply` does for a held subject |
| The lookup secret changed between erasure and re-run | Different derived ids fail acknowledgement; retain the pending file and alert regardless of age. Resolve before changing the secret or restore the old derivation material under the key-rotation procedure; there is no automatic expiry escape |
| The subject has gained a related subject since | Refuse until a new preview binds an explicit exclusion; replay never widens the original subject list by naming an additional subject |
| Several replicas run detection at once | Each stores the same result; none replays |
| Old file with a matching applied row | Eligible for file-first pruning; a subsequent restore older than the evidence window is unprotected |
| Old file without a matching row | Still pending and never age-pruned; a near-window restore cannot clear itself |
| Equal file and row counts with different run ids | Exact set difference still reports the missing run id; repair is attempted first |
| Missing/changed token or changed manifest/pending set | Refuse before any subject mutation and require another preview |
| Invalid file or path/payload mismatch | Do not replay or prune it; store a validation error and keep status non-zero |
| Historical organization-scoped erasure | Preserve the original scope, report `scope_unsupported` and leave pending without an erase/acknowledge call. Current C4 requires tenant-wide erasure; never widen an entry |
| Restricted user holds the view/erase features | Status route returns 403 and no restore notice is sent |

## 📝 Migration & Backward Compatibility

Additive to the supplied code: two tables, three environment settings, two commands, one route, one notification type, the new optional `privacyErasureCompletionCapture` DI key and a provider for C4's optional R4-4 `privacyErasureEvidenceHold` seam. Version 1 is an unreleased proposal; its schema now requires explicit nullable organization scope and path validation before any implementation ships. R4-4 adds no schema to resolve file-only pending membership. Existing published backup, event and DI contracts keep their names and signatures; any later retirement follows the minor-version bridge and upgrade-note protocol in `BACKWARD_COMPATIBILITY.md`. Unconfigured installations get local evidence rows and an unprotected warning, never a made-up shared deployment identity.

**Prior spec.** `2026-07-08-automated-database-backups.md` placed the manifest inside the backup module and listed entries only from the product's own restore. Every old manifest provision is superseded: TLDR/scope/ownership, Design Decisions, Architecture/DI/diff/coupling, pending event count, manifest data model, restore CLI privacy result/exit code, security/failure behavior, Phase 5 manifest work, integration expectations, risks and compliance claims. The merged backup carrier already marks that full boundary and prints the independent C9 runbook; backup scheduling, storage, archive retention and UI remain there. The July erasure carrier is historical rationale, not a second replay producer. Published backup restore APIs/events stay unchanged.

## 📋 Phasing

| Phase | Outcome |
|---|---|
| 1 | Awaited durable capture seam, rows/files, subscriber and repair; requires implementation of C4 **The run**, step 10, **Optional completion capture — C9** and **Audit entries** per-attempt `verifiedAt`, with the capture/crash/restore-before-repair gates passing |
| 2 | Detection, stored result, report, banner, notification |
| 3 | Replay command |

## 📋 Implementation Plan

### Phase 1
1. `manifestStore.test.ts`: strict zod schema, UUID/identifier kinds, unsafe deployment/path segments, missing scope, date/month and payload/path mismatch, size limits, unknown version, symlink rejection, permissions, atomic write, identical retry and conflicting same-run payload rejection.
2. Tables, snapshot, migration, capture provider/registration and subscriber. `completionCapture.test.ts` proves verification → fsync/exclusive publication/directory durability → event → completed audit → success, no event dependency, zero-change capture, missing/failed provider refusal, write/flush failure leaving started work incomplete, per-subject multi-run capture and unchanged R3-14 shape. `manifestSubscriber.test.ts` tests two deliveries/concurrent upserts, event before completed audit, exact `results[].dataClassId`, verification time, replay suppression, immutable reused-run evidence and unconfigured `local-unprotected`. Require the OSS owner's seam tests before claiming protection.
3. Mandatory completed-audit reconciliation and ordered maintenance job. `completedErasureReconciliation.test.ts`: no event, zero-change completion, validated `PrivacyErasureAuditContext.status: complete` versus started/incomplete/invalid proof, C4 evidence-age expiry leaving unresolved work pending, stable pages of 100, interrupted window, strict-boundary/tied timestamps, late-commit backscan, incomplete scan preserving cursor/status, legacy/unprotected row without file repaired before comparison and origin replay never generating files. Register replay's R4-4 `privacyErasureEvidenceHold` provider and cover true for unsettled manifest/applied pairs, false for settled or pruned pairs with no unresolved work, tenant/run isolation, own-row-only reads and read failures throwing. C4 seam tests cover either provider returning true/throwing as `held_by_owner`, retry after settlement, and no providers adding no hold. The file-first crash case must pass with an own-row answer after the **Data Models** OPEN_DESIGN is resolved; a file scan or aggregate count cannot stand in for it. Missing audit service refuses protected maintenance.
4. `manifestPruning.test.ts`: only matching scoped rows allow pruning, file-first retry, failed unlink preserving row, old pending/invalid files untouched, and an identifier still pending after key change.

### Phase 2
1. `restoreDetection.test.ts`: exact difference, equal counts with offsetting run ids, new erasure after restore, other deployment ignored, maintenance error not clearing an alert, unset variables and stored oldest-pending/invalid counts.
2. Worker startup, status route wrapper, banner, notification and configuration doctor check. `restoreStatusAccess.test.ts` tests unrestricted/restricted/unknown ACLs and cross-tenant status. `restoreNotificationAudience.test.ts` combines current wildcard-aware feature authorization and unrestricted organization scope. The engine's route-enumeration test includes this new GET.

### Phase 3
1. `restoreReapply.test.ts`: preview token, actual/expected database mismatch, deployment mismatch, changed/expired token, pending-set or manifest mutation, flags/max/exclusion binding, held/refused/incomplete subjects, non-null historical scope refusal without widening, removed-owner preservation, and R3-14 record-subject `not_found` satisfied with proof even when no old audit survives. Identifier entries are never run automatically.
2. `restoreAcknowledge.test.ts`: an original completion written after capture still refuses, missing verification timestamp refuses, no completion, other identifier, incomplete result, earlier/original completion, wrong organization/preference/exclusions all refuse. A later matching completion, including zero rows and a reused runId with a later final-verification timestamp that maintenance has left pending, succeeds and records the verifying audit/run ids. Tests compare context runId, never audit id against runId.
3. `replayLedgerRecovery.test.ts`: applied-row and replay/acknowledgement operation completion commit together; crash recovery updates the same operation through the engine's exact audit-only `privacy-operation:<operationId>` reference, and no replay generates a new manifest. Add TC-PRIVACY-REPLAY-001 through 005 with self-owned fixtures/cleanup.
4. Docs: restore procedure before reopening with `restore-status --refresh`, shared durable storage, real deployment identity, preview-bound expected database, verification-time acknowledgement, pending preservation and readiness recipe. Add the prior-spec annotation only in the implementation change and archive the Delta if the capabilities directory is adopted.

### File manifest

| File | Action |
|---|---|
| `packages/enterprise/src/modules/data_erasure/{lib/completionCapture.ts,di.ts,lib/manifestStore.ts,lib/completedErasureReconciliation.ts,lib/restoreDetection.ts,data/validators.ts,privacy.ts,subscribers/erasure-manifest.ts,workers/*,cli.ts,api/restore-status/route.ts,data/entities.ts,migrations/*,runtime.ts}` | Create / modify |
| The settings page's banner component and locale keys | Modify |
| Both `.env.example` files, deployment docs | Modify |
| `packages/enterprise/src/modules/data_erasure/__integration__/TC-PRIVACY-REPLAY-*.spec.ts` | Create |
| `.ai/specs/enterprise/2026-07-08-automated-database-backups.md` | Modify — one annotation line |

## 🧪 Integration Coverage

| Test | Covers |
|---|---|
| TC-PRIVACY-REPLAY-001 | Create an own tenant, two organizations, unrestricted and restricted users/ACLs, unique people, temporary shared directory and deployment id. Complete token-confirmed erasures and remove selected applied rows and their post-restore-point started/completed erasure audits/ledger records with scoped test helpers to simulate rollback; otherwise mandatory audit repair would correctly reconstruct the row. Include an equal-count case with one row lacking a file. `restore-status --refresh` repairs evidence and still reports the exact pending ids. GET status returns only own-tenant counts, restricted user receives 403 and no notice, unrestricted eraser receives a notice. Preview and wrong/changed token leave subjects unchanged; correct expected database/token replay clears only satisfied entries |
| TC-PRIVACY-REPLAY-002 | Create a validated historical organization-scoped manifest in an own tenant with fixtures in two organizations. Replay/acknowledge reports `scope_unsupported`, makes no erase call, preserves the pending file and leaves both organizations unchanged. New captures have explicit null organization because C4 refuses scoped erasure. Separately create/erase a short-lived record subject, remove both its applied row and prior erasure audits through tenant-scoped restore-simulation helpers, and confirm R3-14 `not_found` satisfies the file with scoped absence proof and one replay operation |
| TC-PRIVACY-REPLAY-003 | Derive an identifier from a dry run of a unique test address, create a validated organization-explicit manifest with no applied row, and age it beyond the settled window. Apply skips it and pruning preserves it. An acknowledgement preview/apply with no rerun refuses; a completed rerun with the wrong preference also refuses. A fresh token-confirmed rerun with original scope/preference/exclusions, including zero affected rows, permits a separately previewed acknowledgement and records the verification plus its ledger operation |
| TC-PRIVACY-REPLAY-004 | Create own legacy/unprotected completed erasure audit fixtures with a lost event and a historical row whose file repair failed; maintenance repairs both before detection without retroactively calling the original completion protected. Invalid schema/path mismatch yields a non-zero status and no erasure. A crash fixture between successful replay and ledger/applied-row commit recovers one operation; a file without a row or surviving completed audit near the retention boundary remains pending across repeated prune runs. For a separate unsettled-pair fixture with surviving aged C4 audit evidence, R4-4 expiry checks preserve the whole group as `held_by_owner` until settlement, then retry eligibility on the next pass; file-only pending coverage waits for the own-row representation decision |
| TC-PRIVACY-REPLAY-005 | Own subject/audit/file fixtures and a controllable completion seam: suppress every subscriber delivery, capture/complete an erasure, kill the worker between capture and row settlement, then simulate restoring all database evidence to before erasure before any repair. The durable file remains and replay is possible. Repeat a zero-change/no-event completion and an injected file/fsync failure: the latter returns incomplete/unprotected, emits no completion and cannot satisfy the protected-success gate. Cleanup all restored and surviving fixtures/files |

Every case creates its own tenants, organizations, staff/ACLs, subjects, audit/operation/applied rows and files, with `dependsOnModules` declaring all providers. Cleanup in `finally` releases holds and deletes surviving records, queue jobs and temporary storage, including negative-case files. It never relies on seeded data or an existing request. CLI erasure applies always obtain a matching dry-run token first. A real database restore is not exercised: scoped deletion/restoration fixtures simulate rollback and are stated as such. Unit suites cover concurrent workers, resumed run ids and injected scan/file failures. Only local specification/table validation is run for this revision.

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
- **Mitigation**: Error-level report from the worker at start and daily; a notification; the refreshed status command's exit code for a readiness probe; the procedure in the docs puts replay before reopening.
- **Residual risk**: By default the application runs, and detection can lag a restore by up to a day where no worker restarts. That is assumption 6.

#### The manifest itself is sensitive
- **Scenario**: Someone reads the directory.
- **Severity**: Medium
- **Affected area**: internal ids of erased records
- **Mitigation**: Owner-only directory/files; no raw identifiers or lookup hashes; settled evidence expires at the configured window. Pending entries keep the pseudonym because replay/verified acknowledgement needs it.
- **Residual risk**: Record ids can be linked to retained data. An `idv1_` identifier id is a keyed pseudonym of tenant/type/address or number; someone with directory access and lookup-secret material can test guesses and infer an erasure request without a database copy. Pending files may remain indefinitely; protection of the directory and keys is required.

#### Replay erases something it should not
- **Scenario**: The command is aimed at the wrong database, or the directory holds another deployment's files under this deployment's id.
- **Severity**: High
- **Affected area**: the target database
- **Mitigation**: Strict zod and path/payload validation, original organization scope, explicit `--expect-database`, a short-lived token over pending entries and manifest contents, preview by default and holds rechecked. `not_found` is accepted only for a record subject through the owner-scoped R3-14 result.
- **Residual risk**: An operator who confirms a preview without reading it, or two deployments configured identically.

#### An identifier-only erasure is reported as replayed when it was not
- **Scenario**: After a restore, the pending entries include an erasure of a guest payer known only by email. A replay that runs it finds nothing, because nothing in the entry can find the person's records, and marks the entry applied while the restored records stay live.
- **Severity**: Critical
- **Affected area**: people known only by an address or number: guest baskets, pay-link payers, email claimants, correspondents
- **Mitigation**: Assumption 8. Such entries are never run or marked applied by `--apply`. They are listed apart with the command to re-run, and stay pending, with a non-zero status, until the operator acknowledges each after re-running it by identifier. The acknowledgement is refused unless a completed erasure of the same derived id is recorded after the restore, so a mistyped, missing or failed re-run cannot clear the status. Unit tests and TC-PRIVACY-REPLAY-003 cover it.
- **Residual risk**: Their replay depends on the operator re-running each with the identifier from their own request records. The product cannot do it alone, and the docs say so. After a lookup-secret change verification can fail indefinitely; pending entries are preserved and cannot age-clear the alert.

#### A verified capture reports pending after a crash
- **Scenario**: A file exists and its row does not, with no restore.
- **Severity**: Medium
- **Affected area**: operators' trust in the report
- **Mitigation**: Label this as pending replay evidence, not proof that a restore occurred. Mandatory completed-audit repair can settle a surviving completion, and exact set difference plus settled-pair pruning remain authoritative.
- **Residual risk**: File-first capture deliberately permits conservative pending alerts after a crash before completion; redundant guarded erasure is safer than lost restore evidence.

#### Erasure evidence expires while a replay pair is unsettled
- **Scenario**: C4's audit group reaches its expiry age while replay still needs it to settle a manifest entry or applied-row pair.
- **Severity**: High
- **Affected area**: erasure-evidence expiry, replay repair and identifier acknowledgement
- **Mitigation**: R4-4's `privacyErasureEvidenceHold` provider signals pending from own scoped rows; true or a thrown read makes C4 count `held_by_owner` and retry next pass. Tests cover settlement, provider failures and tenant/run isolation. The file-only pending row-representation gap in **Data Models** blocks claiming complete provider coverage until resolved.
- **Residual risk**: Pending work or provider failures may retain evidence indefinitely. The existing rows cannot identify every file-only pending run; this revision does not invent the missing design or claim that the provider is ready.

## Final Compliance Report — 2026-11-16

- **Reviewed:** root/spec rules, backward-compatibility contract, enterprise/shared guides, core API/ACL/encryption guidance and queue/event/integration contracts. Cited current-code helpers were rechecked in the read-only snapshot. This remains a specification, not executed replay validation.

| Rule | Status | Notes |
|---|---|---|
| Enterprise scope in the enterprise specs directory | Compliant | — |
| No cross-module table access | Compliant | Erasures and audit reads use owner services; backup tooling prints the independent C9 runbook and resolves no replay service |
| Ask before adding production dependencies | Compliant | None added; the object-store backend is left out for that reason |
| Tenant and organization scoping | Designed | Original scope persists in row/file; only explicit null scope constructs the tenant-only run, while historical organization-scoped entries stay pending. R3-9 wraps status GET and filters notification audience |
| Recovery and retention | Specified, implementation required | C4 specifies awaited capture/verifiedAt; runtime durability tests still required. Mandatory audit repair, R4-4 owner pending signals, pending evidence preservation and R3-14 record absence remain gates |
| R4-4 erasure-evidence owner signal | OPEN_DESIGN | Exact C4 `privacyErasureEvidenceHold.isPending` seam and `held_by_owner`/retry/throw/absence rules are specified; existing own rows lack per-run file-only pending membership, so provider coverage remains blocked without adding unapproved schema |
| Input validation and confirmation | Designed | Strict zod/path match plus expected database and a pending-set token |
| Integration coverage | Specified | Five self-contained cases, simulated restores explicitly stated; named unit suites for injected failures |

**Verdict:** not approved. Requires the governance engine's approval, implementation of C4's specified R3-14 absence result, awaited capture and per-attempt `verifiedAt`, the capture/crash/restore-before-repair gates, and confirmation of program DEC-4 and assumption 9. R4-4 replaces the expiry proof handoff with `privacyErasureEvidenceHold`; replay's provider implementation remains blocked on the file-only pending own-row representation identified above.

## Changelog

### 2026-11-16
- Written autonomously with resolved assumptions.
- Revised after independent review. The single marker is replaced by a row per erasure, with pending computed as files minus rows: a marker would have been overtaken by the first erasure after a restore. Every file and row carries a deployment id. The initial revision used row-before-file and an event subscriber; that left a restore-before-repair window and is superseded by the pass-two pre-completion capture. Both artifacts retain the subject run id for redelivery. The web-tier start-up refusal is dropped, because only the worker role has a start-up hook; a readiness-probe recipe replaces it. Replay uses the original preference and exclusions, which the erasure event now carries, and marks its own runs so they are not recorded again. Supersedes the manifest section of the 07-08 backup spec.
- Council review (Opus, GPT-5.6 Sol, DeepSeek V4 Flash, Kimi K3.1 Pro), critical fix: replay re-ran each entry by kind and id and inserted the row when the run found nothing. The initial design assumed a per-run identifier id, corrected by the deterministic contract id below; such subjects are found only by hashes of the identifier, which no entry holds, so its erasure would have been marked replayed while the restored records stayed live. Added assumption 8: such entries are never run or marked applied by `--apply`. They are listed as needing the identifier and stay pending until the operator re-runs the erasure by identifier and passes `--acknowledge <runId>`. Storing the identifier's hashes in the file is recorded as a rejected alternative. Updated the Delta, CLI, edge cases, unit tests, TC-PRIVACY-REPLAY-001 and risks.
- Council review (Opus, GPT-5.6 Sol, DeepSeek V4 Flash, Kimi K3.1 Pro), high fixes: g4-04 — with the identifier subject's id now derived deterministically (round-one shared decision DEC-A, "Subjects known only by an identifier (`privacy:identifier`)", in the program spec's "Council-review cross-spec decisions"; distinct from the program's numbered decisions), `--acknowledge <runId>` is verified: it is accepted only when the action log holds a completed erasure entry for the same derived id, verified after the entry's original verification time; the resumed-run case is refined below, and refused otherwise, so an unmade or mistyped re-run cannot clear the status. Assumption 8's rationale no longer says the id is generated per run. Updated the proposed solution, a rejected alternative, two Delta scenarios, the CLI, a touchpoint, edge cases including a changed lookup secret, unit tests, TC-PRIVACY-REPLAY-001 and the risk.
- Council round two fixes (GPT-6.1 Sol workers): r7-03 — R3-14 scoped record absence is satisfied; r7-10 — exact set difference after repair; r7-11 — mandatory paged audit reconciliation; r7-12 — tenant-wide route and notice access; r7-21 — preserved organization scope; r7-22 — pending files never age-pruned; r7-23 — expected database, preview token and local deployment identity; r7-37 — acknowledgement matches preference; r7-38 — strict schema/path checks; r7-39 — keyed-pseudonym risk; nits R2 — compare erasure run ids with resumed completions and identify the round-one DEC-A source; nit R1 — class ids and execution time use the real event/audit fields.
- Council round two fixes, pass two (GPT-6.1 Sol workers): supersede all historical backup-manifest provisions; default awaited file-first durable capture before protected completion, with an explicit OSS owner handoff and failure boundary; add crash/restore-before-repair and undelivered-event cases; align tenant-only C4 scope, per-subject R3-14 results, policy-free backup runbook boundary and configuration-only doctor check.
- Council round two fixes, pass three (GPT-6.1 Sol workers): consume C4's delivered typed complete audit context and its separate finite erasure-evidence window, identify only the still-missing capture/verification-time owner handoffs, and keep the durability gate open. Verify full backup supersession, tenant-only replay and legacy-scope refusal already present; correct stale soft-backup-seam and run-scope compliance wording.
- Council round two fixes, pass four alignment (GPT-6.1 Sol workers): cite C4's now-specified run step 10, exact completion-capture seam and typed per-attempt verifiedAt; retain immutable executedAt and strict later-verification acknowledgement and implementation/durability gates; align C4's then-current expiry requirement, replaced by R4-4 below, across the independent settled-pair expiry window.
- Council round two fixes, pass five gap closing (GPT-6.1 Sol workers): replace the proof-contract handoff with R4-4's exact `privacyErasureEvidenceHold` provider obligation, `held_by_owner` and next-pass retry, including throw/absence rules, scoped own-row tests, risk and compliance coverage; record the remaining file-only pending row-representation gap as OPEN_DESIGN without adding schema.
