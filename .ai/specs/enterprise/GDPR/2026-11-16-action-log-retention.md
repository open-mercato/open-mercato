# Change-history retention

> **Program:** part of package D3 of [`../../GDPR/2026-11-15-gdpr-ready-deployments-program.md`](../../GDPR/2026-11-15-gdpr-ready-deployments-program.md) (tracker open-mercato/open-mercato#8593), split from the record-retention spec. Tracks #2980, where a maintainer placed this capability in Enterprise.
> **Builds on:** [`../../GDPR/2026-11-16-privacy-record-retention.md`](../../GDPR/2026-11-16-privacy-record-retention.md) for retention sets and [`2026-11-16-privacy-dsr-engine.md`](2026-11-16-privacy-dsr-engine.md) for policies and schedules.
> **Verified at** `main` @ `08dada9624` by reading code and the issue; nothing was run.
> **Written autonomously.** No question was put to a person; the choices are listed under Resolved assumptions.

Extends: .ai/specs/GDPR/2026-11-16-privacy-record-retention.md
Extends: .ai/specs/enterprise/GDPR/2026-11-16-privacy-dsr-engine.md

## 📝 TLDR

Commands can record full copies of a record before and after a change, and that history has no retention limit. Undo, version history and the change log read it. Those snapshots can preserve personal data after the live record is deleted. **Proposed (future):** a tenant can set two ages. Past the first, an entry keeps who did what and when, and loses its copies of the data — and with them, undo. Past the second, the entry is deleted. Entries that are themselves evidence of privacy operations and of exports are exempt from these generic sets; their owners provide separate finite expiry below. While a tenant has a person under a legal hold, neither stage runs for it unless its policy says otherwise. The stripping itself is one routine in the audit module, specified by the OSS erasure spec, which needs the same thing for one person's entries; this spec uses it. Null-tenant history has a separate installation command and daily preview job, with two validated ages and explicit apply.

**Not in this spec:** removing the duplicated undo payload that sales commands store, the other half of #2980, which is an OSS clean-up; the access log; removing one person's entries, which the erasure spec does.

## 📝 Overview

> **Market reference.** Salesforce keeps field history for 18 to 24 months and archives or deletes beyond; Jira and GitLab keep an activity line indefinitely while pruning the heavy payload behind it. Adopted: two stages — keep the line, drop the payload; then drop the line — and a longer life for compliance evidence. Rejected: a single age at which everything goes, which makes an administrator choose between long accountability and short data.

## 📝 Resolved assumptions (autonomous defaults)

| # | Question | Chosen | Rationale |
|---|---|---|---|
| 1 | Edition | Policies, schedules and the retention sets in Enterprise. One routine in OSS `audit_logs` that strips or deletes a selection of entries, specified and first called by the OSS erasure spec | Decided under program DEC-2 and DEC-B: Enterprise sets on the OSS routine. It follows the maintainer's statement on #2980 that this capability will not be accepted in the open-source edition: policies, schedules, settings and age selection stay in Enterprise, and OSS carries no schedule, command or setting for them. The routine has a real OSS caller, by subject, and it must live in the module that owns the table, because Enterprise cannot strip without writing to a core table. |
| 2 | Default | Tenant entries require active apply policies; null-tenant entries require both installation ages and explicit system apply. Unconfigured and scheduled-preview runs change nothing | Deleting undo history on upgrade is not something to do unasked. |
| 3 | Shape | Two retention sets, "change values" and "change history", each with one age | The retention-set contract has one window per set and two fixed targets. Two sets need no change to it or to the engine's policy. |
| 4 | Floors | Values no sooner than 90 days; history no sooner than values | The change log's own ranges go up to 90 days. |
| 5 | Undo | Ends when an entry's values are stripped. No entry is spared for being the latest undoable one | Sparing it would keep exactly the snapshots of records nobody touched again — hard-deleted people above all — which is what retention is for. |
| 6 | Evidence | Entries for privacy operations, exports and the governance module's own actions are in neither generic set; C1's settings-command groups are also preserved, selected by the clear-text related pair C1 writes on them. The dedicated owner sets below supply finite expiry | Their reasons are in the part generic stripping would clear. The exclusion preserves evidence until its own finite period, hold or unresolved-work rule permits deletion. |
| 7 | Entries with no tenant | A separate system-scoped service/command and module-registered daily job read two installation ages, both unset by default | `PrivacyScope.tenantId` is required. Null-tenant work never enters `pruneRecords` or a tenant policy pass. |
| 8 | A tenant with an active subject hold | Neither set runs for it; the pass is recorded as skipped with reason `hold_not_honourable`. The only opt-out is the engine policy's `allowUnmatchedHolds`, default `false` | Any subject's data can be copied into another record's snapshot, and no column shows it. The routine can leave out only entries whose resource, parent resource or related resource is the held subject's record. Stripping the rest by default would remove a held person's data unless an administrator thought to ask. |
| 9 | Finite age for exempt evidence without an owner bound | 365 days after terminal completion, floor 30, with preservation while held or needed by unresolved work; actual owner implements dedicated expiry | Decided: the program's evidence lifetime, 365 days by default with a floor of 30, extended by holds and by unresolved work, as C1's EVIDENCE-AGE. It is an accountability choice, not a statutory period, and gives every exempt kind a finite bound from the start; no unlimited generic exemption. Existing replay's 90-day settled-file window is unchanged. |

## 📝 Problem Statement

- **What an entry holds.** Encrypted: the command id, a label, the command's payload, the record before and after, the change set and the context. In clear: the resource kind and id, parent and related resources, the acting user, the action type, the state, the undo token and the names of changed fields (`audit_logs/encryption.ts:5-14`; `data/entities.ts:27-96`).
- **Nothing ever deletes one.** `actionLogService` has no delete or prune method, and no production code deletes from the table.
- **The context is both evidence and a risk.** Interceptors merge their own data into it — the contract's example is a client address — the export-audit spec stores an export's facts there, and undo and redo read the actor from it.
- **The names of changed fields may be missing.** They are a projection computed after the fact; rows that never got one have none, and the routine that backfills them recomputes from the stored records — and, when forced, overwrites with an empty list if those are gone (`services/actionLogService.ts:839-950`).
- **Undo finds its entry by the token** (`api/audit-logs/actions/undo/route.ts:83`; `actionLogService.ts:753`); redo finds it by id. An entry is claimed for undo by a conditional update on its state (`:712`).
- **The resource kind may be empty**, and `NOT IN` silently skips such rows.
- **The list response does not carry the names of changed fields** (`api/audit-logs/actions/route.ts:96-98, 264-266`); the change log and the version-history detail build their rows from the stored change set and the record before (`customers/components/detail/ChangelogTab.tsx:123`; `packages/ui/src/backend/version-history/VersionHistoryDetail.tsx:24`).
- **Tenant and organization may be empty**, and the encryption subscriber skips such rows.
- **Indexes.** One leads with tenant and `created_at`; another with tenant, resource kind, resource id and `created_at`, so entries can be selected or excluded by kind in SQL. The command id cannot be used for that: it is encrypted (`audit_logs/encryption.ts:7`). `source_key` is a derived projection (`ui`, `api`, `system`, `agent`) that the projection backfill recomputes, so it cannot carry a discriminator either. Nothing indexes the undo token.
- **Three record columns, each indexed.** An entry names a resource, a parent resource and a related resource, each as a kind and an id in clear, each with its own index led by tenant (`data/entities.ts:10-11, 16, 92-96`). Commands fill the related pair: a comment names its deal (`customers/commands/comments.ts:139-140`), a submission names an actor (`forms/commands/submission.ts:180-181, 203-204`). The list already matches one record on all three pairs when asked to include related entries (`services/actionLogService.ts:517-533`).
- **What reads old entries**

| Reader | Needs |
|---|---|
| Undo and redo | The token, the state, and the stored record or replay input (`api/audit-logs/actions/undo/route.ts:83, 125-141`; `services/actionLogService.ts:700-794`) |
| Version history panel; CRM change log; audit page and its export | The change set and the names of changed fields |
| Sales document history | The before and after records, to derive status changes (`sales/api/document-history/route.ts:94-122`) |
| Deal stage history | Its own table. The audit log is read only for a deal with no stored transitions (`customers/api/deals/[id]/route.ts:165-196, 773-775`) |
| Record-lock conflict notice | The latest entry's id and its change set (`record_locks/lib/recordLockService.ts:1189-1199`) |
| Warranty replacement-order check | Recent entries for one order, with their stored records |
| Agent audit view | Columns stored in clear |

- **Evidence kinds** written by the sibling specs: `privacy.subject_export`, `privacy.subject_erasure`, `privacy.subject_erasure_progress`, `privacy.retention_run`, `privacy.tenant_export`, `audit_logs.export`.
- **The erasure spec defines the strip.** It owns `actionLogService.applyRetention`, the `stripped_at` mark with its partial index and migration, the list fields `strippedAt` and `changedFields`, and redo's 410 for a stripped entry. No code does any of it yet.
- **Holds cannot be fully matched.** A held person's data can sit inside the snapshot of an entry about another record, a deal or an order, where no clear column names them.

## 📝 Proposed Solution

### What this spec uses from the OSS erasure spec

`actionLogService.applyRetention`, the `stripped_at` mark, the list fields `strippedAt` and `changedFields`, and stripped-entry replay refusal are specified normatively in [`../../GDPR/2026-11-16-privacy-subject-erasure.md`](../../GDPR/2026-11-16-privacy-subject-erasure.md): its Data Models, API Contracts, Phase 2, file manifest and unit tests. This spec does not define them again. A strip computes the names of changed fields first, clears the stored values and the undo token, reduces the context to the actor keys `actorSubject` and `systemActor` and sets `stripped_at`; a system-performed entry keeps its `systemActor`. Under C4's **API Contracts**, "Rollout gate", a non-dry-run `applyRetention` call in either `strip` or `delete` mode refuses with `REPLAY_ROLLOUT_UNCONFIRMED` until the installation runs `mercato audit_logs confirm-replay-rollout`; only dry runs are ungated, and a dry run returns DEC-B's unchanged result, which has no warning member. The audit owner exposes the same installation marker read as `actionLogService.isReplayRolloutConfirmed(): Promise<boolean>`; every caller that previews either destructive mode calls it and reports `REPLAY_ROLLOUT_UNCONFIRMED` as a warning when it returns false. DEC-B's inputs and result are unchanged. Strip and delete share the owner's replay lease, locked refresh and conditional state mutations: a live executor is skipped and retried; absence of a lease never proves executor death. C4's durable replay attempt/generation must be settled or safely cancelled under its write fence before reclamation; live or unknown attempts stay skipped. An entry matches a record when the record equals its (`resource_kind`, `resource_id`), (`parent_resource_kind`, `parent_resource_id`) or (`related_resource_kind`, `related_resource_id`).

Under **DEC-B — The audit-history strip routine**, that specification is the owner. Under **R3-1 — The audit-history rule for every erasure**, undo and redo recheck `stripped_at` under the source-row lock at execution, in that spec's **Audit history — `audit_logs`** section; a payload loaded before stripping never authorizes replay afterwards. This consumer must not ship before those checks and the OSS integration gate below pass.

Two callers:

- the erasure spec's history strip, by subject, through `subjectHistoryService`;
- the enterprise retention sets below, by age.

### Enterprise

The governance module declares two retention sets whose handler calls that routine:

| Set | What a pass does | Floor |
|---|---|---|
| `data_erasure.change_values` | Strips entries older than the window | 90 days |
| `data_erasure.change_history` | Deletes entries older than the window | 90 days, and not below the active values policy window; requires that values policy |

Both leave out entries whose resource kind begins with `privacy.`, `data_erasure.` or `audit_logs.export`, and include entries with no kind. They also preserve C1's **Settings-command evidence expiry** groups — every `configs.module_config` entry written by `privacy.settings.set`, including held, failed/conflicting or unresolved groups — for their dedicated expiry. C1 writes the constant clear-text related pair `{ relatedResourceKind: 'privacy.settings_command', relatedResourceId: 'privacy.settings.set' }` on every entry of those groups. Both sets pass exactly that pair in `applyRetention`'s existing `excludeRecords`; its three-column matching leaves out every entry naming it, served by the existing `action_logs_related_resource_idx`. No encrypted column is read and DEC-B's selector signature is unchanged. A `privacy.` resource-kind prefix cannot identify these groups, because their resource kind is `configs.module_config`, and the encrypted `command_id` cannot be selected in SQL. Unrelated configuration history and explicit subject-history stripping keep their own rules.

### Evidence outside the generic sets

The prefixes above remain unchanged for tenant and system history. C1's **Export-evidence expiry** and **Settings-command evidence expiry**, in [the contract spec](../../GDPR/2026-11-16-privacy-data-class-contract.md), own `privacy.export_evidence` and `privacy.settings_evidence`; the export-audit spec's **Export-evidence expiry** owns `audit_logs.export_evidence`. C4's **Erasure-evidence expiry** and the record-retention owner's **Retention-run evidence** have separate finite bounds too. Exclusion from generic sets never supplies their lifetime. Dedicated evidence-expiry declarations select the record-retention driver's **Aggregate evidence for expiry runs** with `runEvidence: 'aggregate'` before expiry ships. The table cites current owner designs, whose ages follow assumption 9; their owner implementations, guards, reconciliation proof and configured runners remain delivery prerequisites. Missing proof preserves evidence, and a declared age alone does not establish enforcement.

| Evidence | Actual owner | Finite age / preservation rule | Surviving fields after expiry |
|---|---|---|---|
| `privacy.subject_export`, `privacy.subject_export_request` | Contract spec, **Export-evidence expiry** | `retention.privacy.exportEvidenceAgeDays`, default 365 days, floor 30; `privacy.export_evidence`; any active subject hold skips request-wide evidence | Whole entries deleted, including actor/id/reference/context; aggregate counts, dates and set id only |
| `configs.module_config` / command `privacy.settings.set`, grouped by operation UUID and marked by the related pair `privacy.settings_command` / `privacy.settings.set` | Contract spec, **Settings-command evidence expiry** | `retention.privacy.settingsEvidenceAgeDays`, default 365 days, floor 30; `privacy.settings_evidence` via `actionLogService.expirePrivacySettingsEvidence`; age starts at successful terminal `completed`. Holds/exclusions, failed/conflicting operations, missing/invalid completion and unresolved audit/config outcomes preserve the group | Delete every started/terminal entry of an eligible group whole, including actor/reference/context; dates, set id and aggregate counts only |
| `privacy.retention_run` | [Record-retention spec](../../GDPR/2026-11-16-privacy-record-retention.md), **Retention-run evidence**, including inactive-subject runs | `retention.privacy.retentionEvidenceAgeDays`, default 365 days, floor 30; `privacy.retention_evidence`; unresolved work and active holds defer | Whole entries deleted; aggregate counts, dates and set id only, without actor, reference or run/subject ids |
| `privacy.subject_erasure`, `privacy.subject_erasure_progress`, `privacy.erasure_call` journals | Erasure spec, **Erasure-evidence expiry**, assumption 20 | `retention.privacy.erasureEvidenceAgeDays`, default 365 days, floor 30; `privacy.erasure_evidence` via `actionLogService.expireErasureEvidence`, anchored to the group's latest completed `verifiedAt`. Holds/exclusions, open/incomplete runs, invalid context/timestamps, unreconciled coordinators, pending file/cache/required-side-effect work and unresolved downstream replay/ledger reconciliation preserve the group; missing owner proof refuses the pass | Delete terminal evidence groups whole, including retained-row proof, actor, ids and reference; aggregate counts/dates and set id only |
| `privacy.tenant_export` | [Tenant-exit spec](../../GDPR/2026-11-16-tenant-exit-export.md), **CLI, audit and output — Tenant-export evidence expiry**, assumption 11 | `retention.privacy.tenantExportEvidenceAgeDays`, default 365 days, floor 30; `privacy.tenant_export_evidence` via the audit owner’s `actionLogService.expireTenantExportEvidence`. Under R4-3 every `privacy.tenant_export` entry carries its tenant; tenant-scoped `privacy.tenant_export_evidence` runs expire it, including for soft-deleted tenants; there is no null-tenant tenant-export evidence and no installation age. Holds/exclusions and unresolved publication/reconciliation defer; only validated `published`, dry-run `not_required` or explicitly `reconciled` groups may expire | Whole settled groups deleted, including actor, tenant resource id, reference and context; aggregate counts/dates only, without copied run or tenant-resource ids |
| `audit_logs.export` | [Export-audit spec](../../GDPR/2026-11-16-export-audit-event.md), **Export-evidence expiry** | `retention.audit_logs.exportEvidenceAgeDays`, default 365 days, floor 30; `audit_logs.export_evidence`; any subject hold or explicit exclusion skips, failed guard refuses | Whole entries deleted, including actor, resource/parent ids and context; only set id, counts and run dates in the shared aggregate summary |
| `data_erasure.policy`, `data_erasure.legal_hold`, `data_erasure.operation`, `data_erasure.retention_failure` action entries; own metadata rows | DSR engine, **Metadata retention and coverage**, assumption 17 | Action entries: `retention.data_erasure.auditEvidenceAgeDays`, default 365 days after terminal state, floor 30; `data_erasure.audit_evidence`. Holds/exclusions, active configuration, unresolved operations/references, pending replay/files and invalid/missing terminal proof defer; whole started/terminal groups expire only after owner dependency checks. Metadata clocks stay 365 days for terminal operations/holds and deleted policies, 15 minutes for unused previews, 30 days or earlier completion/policy deletion for failures | Expired rows/action entries deleted whole, including actor/reference/context/ids; aggregate counts/dates/set id only. Active configuration/holds and unresolved-work evidence retain necessary fields until terminal |
| Replay manifests and `privacy_erasure_applied` | [Restore-replay spec](2026-11-16-erasure-restore-replay.md), **Architecture**, pruning rule | Existing default 90 days for settled pairs, longer than restorable backups; pending or invalid files never age out | Settled file removed first, applied row only after success; aggregate status/cursor remains, no expired manifest payload |

C1's **Tenant privacy settings — R3-3: Tenant privacy settings live in `module_configs`** records settings edits under the ordinary configuration resource kind `configs.module_config`, command id `privacy.settings.set` and the clear-text related pair `privacy.settings_command` / `privacy.settings.set`, with no input/stored values, free-text reference or undo snapshot. Its **Settings-command evidence expiry** owns those exact operation groups, selects them by that related pair, and owns their generic-age safeguard; they acquire neither a `privacy.` nor a `data_erasure.` prefix exemption, and unrelated config history remains generic history. Dedicated expiry uses owner services and DEC-C guards, and whole-entry deletion through DEC-B where applicable. It never age-strips the evidence into actor-only fragments or weakens R3-1's replay checks. `allowUnmatchedHolds` is the generic history policy's acknowledged opt-out, not permission to discard held evidence. Under **R4-3 — Tenant-export evidence always carries its tenant**, C8's **CLI, audit and output — Evidence about a soft-deleted tenant** states the invariant: every `privacy.tenant_export` entry carries its tenant; tenant-scoped `privacy.tenant_export_evidence` runs expire it, including for soft-deleted tenants; there is no null-tenant tenant-export evidence and no installation age. A scheduled tenant run of `privacy.tenant_export_evidence`, kept for a soft-deleted tenant until its evidence is gone, enforces the age once the owner implementation ships. Other excluded null-tenant evidence requires its actual owner’s finite expiry or an explicit gap.

### Enterprise policy prerequisites

Set ids use the declaring module's `data_erasure.` prefix under the record-retention naming rule. The former `audit_logs.*` ids were unreleased draft names; no shipped id is renamed.

Every handler batch reads `privacyRetentionPolicyService.getActiveWindow`, defined in the enterprise coverage spec's **Policy access** section. It requires an active policy for the exact tenant and set, the policy's window equal to the requested window, the 90-day floor, and apply mode for a write. The history handler also requires an active values policy, with `historyDays >= valuesDays`; an apply history policy requires an apply values policy. Missing service/policy is `policy_required`, a failed read is `policy_unavailable`, and inconsistent ages are `invalid_retention_windows`. These checks apply to the OSS command and raw handler calls as well as the scheduled engine. A policy version change invalidates continuation and requires a fresh preview. The values handler passes `applyRetention`'s `REPLAY_ROLLOUT_UNCONFIRMED` refusal through unchanged as the batch's refusal reason; it never retries in `delete` mode or treats the refusal as an empty batch. In a dry run the values handler calls `actionLogService.isReplayRolloutConfirmed()` and, when it returns false, sets its `pruneRecords` result's `warnings` to `['REPLAY_ROLLOUT_UNCONFIRMED']`; `privacyRetentionService.run` returns them on the preview, the OSS command's preview prints them, and the engine stores them with the preview pass that must precede activation. The policy form shows the latest preview pass's warnings, so an age-based strip policy surfaces the gate before its first apply pass; `UPGRADE_NOTES.md` states it with the rollout rule.

The policy API validates both windows atomically when saving, activating or disabling either policy; it cannot disable the values policy while history is active. The backend form shows the consequences before apply is enabled. The engine schedules the values pass before the history pass for a tenant; that order is a scheduling rule, not a handler dependency. Each handler call is one `pruneRecords` batch driven by `privacyRetentionService.run`, and no handler invokes the other set. The history handler needs no prior strip: every entry it deletes is older than the history window, which is at least the values window, and deleting an unstripped entry removes its values with it. No command bypasses the active policies or their acknowledged consequences.

Entries with no tenant use the separate installation pass below, never a null `PrivacyScope`. A failed prerequisite writes only aggregate refusal evidence; no audit snapshot is cleared first.

### Throughput

Every command writes an `action_logs` row through `ActionLogService.log` (`audit_logs/services/actionLogService.ts`), so an ordinary tenant can write far more entries a day than any fixed daily record count. A finite age is reachable only if a pass runs until it has caught up. Both sets therefore rely on the DSR engine's record-mode throughput rule (DSR engine, **Record mode**): a pass still reserves one batch of at most 100 examined entries per handler call, but it is not capped by a daily record count; it continues in time-budgeted continuation jobs — a 30-second run budget per job, then one coalesced continuation enqueued immediately — until `privacyRetentionService.run` returns `done`. Load is bounded by queue concurrency 1, the batch size and the run budget. When the next pass date begins while the previous pass's selection is still not exhausted, the previous pass is closed `incomplete` with reason `backlog_growing`, the new pass starts from its new cutoff (which includes the older rows), and the bound projection below reports `mode: 'pending'` with `unboundedReason: 'backlog_growing'` until a pass reaches `done`.

### Retention bounds for C5/G6

Ordinary change history in `action_logs` is bounded only by these two sets. The governance module's existing read-only `dataErasureRetentionBounds` handler (DSR engine, **Retention bounds**) also resolves the bound ids `data_erasure.change_values` and `data_erasure.change_history`, one per set, for C5's cross-module bound on the ordinary-history subset of `action_logs` owned by the table-coverage spec. That subset is every entry whose resource kind does not start with an evidence prefix above and that does not carry the settings-evidence related pair. `data_erasure.change_history` is the deleting bound for whole rows; `data_erasure.change_values` bounds the snapshot, payload, change and context columns that stripping clears. Both use `created_at` as the age anchor and the same predicate constants as the handlers. `resolve` reads the active policy windows through `privacyRetentionPolicyService.getActiveWindow`: no active apply policy projects `mode: 'off'`, `enabled: false`; a preview policy projects `report`; a tenant with an active subject hold and no `allowUnmatchedHolds` projects `pending` with `unboundedReason: 'hold_not_honourable'`; an unfinished continuation or a `backlog_growing` pass projects `pending` with that reason; an apply values policy whose last pass was refused with `REPLAY_ROLLOUT_UNCONFIRMED` projects `data_erasure.change_values` as `pending` with `unboundedReason: 'replay_rollout_unconfirmed'`. `evaluateFixtureRow` checks the row's tenant against the scope (`not_found` otherwise; a null-tenant row is `unknown`, reason `installation_row`), applies the evidence-prefix and settings-pair exclusions (`not_eligible`), and evaluates `created_at` against the active window. For that evaluation the audit owner exposes the additive internal, read-only `actionLogService.probeOrdinaryHistoryBoundRow({ scope, rowId, mode: 'strip' | 'delete', now, olderThanDays, cutoff }, { em }): Promise<{ status: 'within_window' | 'expired' | 'not_found' | 'installation_row' | 'not_eligible' | 'unknown'; anchorAt: string | null; expiresAt: string | null; reason: string }>`. Accept only the supplied verifier's active read-only snapshot manager and an exact tenant, action-log UUID and applicable organization scope. The audit owner selects only the exact row and bounded predicate data, including the nullable tenant, resource kind, related pair, age anchor and strip eligibility. It returns no raw metadata, values or audit payload. A foreign tenant or organization is `not_found`, null-tenant is a non-identifying `installation_row` mapped to unknown, excluded or already-stripped values are `not_eligible` for the respective mode; delete applies whole-row eligibility. For an otherwise eligible row, compute `anchorAt` and `expiresAt` from `created_at` and the exact supplied policy window. Return `expired` only for the same strict cutoff comparison the real selection uses, otherwise `within_window`. The manager, policy window, now and cutoff must agree. No policy or pending enforcement produces the C5 projection at the caller and cannot project a row as enforceable. An unreadable row or invalid manager is unknown, not eligible. Enterprise derives the fixed cutoff and mode from the verified active policy, calls the audit-owned method on the same snapshot and maps the result to C5 without querying audit tables. Missing seam or failure is unknown. The audit owner reuses DEC-B's selection constants/predicates. The declaration form of the cross-module reference is C5's; this spec supplies the handler, ids, predicates and projection states. In an OSS-only build no set exists, so this subset has no bound; C5 records that remainder.

The policy form for either set shows, before it can be saved, what stripping ends.

### Legal holds

- **Both sets declare `excludableSubjectKinds: []`.** Any subject can appear inside another record's snapshot, so neither set can leave all of a held subject's data out.
- **A tenant with an active subject hold is skipped.** Under the rule of the record-retention spec, which the DSR engine applies to its passes and the record-retention command applies through `privacyRetentionGuard`, a held subject whose kind a set does not declare makes the set skip. Here that is every subject hold. The skip is recorded as a skipped pass with reason `hold_not_honourable`, and nothing is stripped or deleted for that tenant.
- **The only opt-out** is the engine policy's `allowUnmatchedHolds`, default `false` (DSR engine spec). With it, the pass runs and the handler passes the held subjects as `excludeSubjects`. The routine leaves out every entry whose resource, parent resource or related resource is a held subject's record. Entries that mention a held subject only inside a snapshot are stripped or deleted with the rest. The policy form says so before the flag can be saved.
- **Direct resource mappings under the opt-out.** The enterprise handler uses the data-class registry, not another module's table. For each held subject it pairs the subject id with every `auditResourceKinds` value declared by classes for that kind, alongside the root pair that `applyRetention` already understands, and passes these as `excludeRecords`. EUDR must declare `eudr.plot` for `eudr:plot_producer` and `eudr.evidence_submission` for `eudr:evidence_producer`. Those explicit owner declarations are required before an EUDR opt-out pass can run; missing mapping refuses with `hold_mapping_missing` instead of assuming colon-to-dot is correct. Identifiers have no root record under **DEC-A — Subjects known only by an identifier (`privacy:identifier`)**; the opt-out still cannot protect identifier-only snapshot mentions, as its consequence text states.
- **A hold on the set itself** stops it, as it stops any set.
- The engine and command use `privacyRetentionService.run`, which rereads guards before each batch and stops on changed holds. Its shared draining rule is **R3-8 — Retention drains its own pending file deletions**; these sets produce no file deletions.

### What stripping ends

An erasure strips entries too, so the readers' handling of a stripped entry ships with the routine in the erasure spec. The table is what a policy's form and `UPGRADE_NOTES.md` tell an administrator.

| Feature | After an entry is stripped |
|---|---|
| Undo of that action | Not offered. A removed token keeps the ordinary unavailable response; an already resolved entry rechecks under the R3-1 lease/row lock and returns 410 after authorization |
| Redo of that action | Refused, with a message that its history is no longer kept |
| Restoring a hard-deleted record | Not possible |
| Version history and the change log | Show that a change was made, by whom, to which fields, and when — not the values. Both screens are changed to build a stripped line from the field names |
| Sales document history | A stripped status change appears as a plain action line, and a filter for status changes no longer finds it |
| Deal stage history without stored transitions | Its action-log fallback cannot reconstruct stripped stage values; those historical transitions disappear. Deals with stored transition rows are unchanged |
| Warranty replacement-order check | It reads entries of any age for one order and refuses when it cannot tell. The step bounds it or states the effect |
| Audit page | The line remains, marked as stripped |
| Record-lock conflict notice | Reads the latest entry; unaffected at a 90-day floor |

### Design decisions

| Decision | Rationale |
|---|---|
| Two stages, as two sets | See the market reference and assumption 3. |
| One routine, owned by the OSS erasure spec | Two strips of the same columns in one module would drift, and "already stripped" could not be told. Its first caller is the erasure, so it is specified there and this spec consumes it. |
| Selection by resource kind, in SQL | It is stored in clear and indexed; the command id is not. |
| Holds are matched on all three record columns | The related pair is stored and indexed like the other two, and commands fill it. |
| Holds fail closed | See assumption 8. A skipped pass only delays retention; a stripped snapshot cannot be restored. |

### Alternatives considered

| Alternative | Why rejected |
|---|---|
| An environment variable and a worker in OSS | What #2980 first proposed; refused for OSS. |
| Keep the latest undoable entry per record | See assumption 5. |
| Delete only | Forces a choice between accountability and data. |
| Strip by setting columns to null from Enterprise | A cross-module write. |
| A two-window policy on one set with new target names | Changes the retention-set contract and the engine's policy for one consumer. |
| Strip by default, and skip only when an administrator asks for strict handling | The earlier text of this spec. A held person's snapshots were stripped in the common case, and the engine defined no such setting. |
| Define the routine here as well | Two normative texts for one shared routine; the erasure spec is its owner. |
| No default evidence age; require an explicit controller age before enabling an evidence-producing capability | Blocks each capability on a setting most controllers have no basis to choose. A 365-day default with a 30-day floor bounds evidence from the start (assumption 9). |

### Installation pass for entries with no tenant

The enterprise module exposes the new operator-only command `mercato data_erasure system-history-retention [--max <n>] [--after <cursor>] [--apply]` and DI service `systemHistoryRetentionService.run({ dryRun, max, after })`. It accepts no tenant, organization or arbitrary scope. Preview is default. The service always calls `actionLogService.applyRetention` with `tenantId: null`, the evidence prefixes above, no organization selector, and per-stage eligibility cutoffs computed from one fixed run-start time minus each configured age. It cannot be used to widen a tenant pass.

Two environment settings supply integer ages: `OM_ACTION_LOG_SYSTEM_VALUES_RETENTION_DAYS` and `OM_ACTION_LOG_SYSTEM_HISTORY_RETENTION_DAYS`. Both must be set or both unset; values must be at least 90 and history at least values. Unset keeps all null-tenant entries. A partial, malformed or inverted pair refuses before any mutation. The pair is validated once on entry and again at each batch boundary; a change stops the run. It is an explicit installation choice, independent of tenant policies. No `module_configs` tenant setting is used for a null-tenant operation; tenant settings elsewhere follow **R3-3 — Tenant privacy settings live in `module_configs`**, in the contract spec's **Tenant privacy settings** and **Phase 7 — Settings and bounded export evidence**.

`mercato data_erasure register-schedules` registers a separate system-scoped daily job `data_erasure.system_history_retention`, using the existing `schedulerService.register` capability on its own dedicated queue `data-erasure-system-history-retention` at concurrency 1. `data_erasure/privacy.ts` declares it under the operational-pruners spec's **Enabled-handler schedule expectations** as `retentionSchedules: [{ key: 'data_erasure:system-history-retention:system', queue: 'data-erasure-system-history-retention', scopeType: 'system' }]`; registration uses that exact key's SHA-256-derived UUID with null tenant/organization and imports the same constant, so registration and diagnostics share one definition. The job invokes this service, not the tenant-policy loop; its payload defaults to preview. The new registration option `--apply-system-history` opts that job into apply after showing the same consequence text. Missing or disabled registration leaves the manual command usable and is reported by scheduler's `pruners.unscheduled` database-tier doctor check, which counts this expectation like every other declared schedule; unset installation ages do not remove the expectation. Both command and job process values then history, cap each database batch at 100 and the combined work at 1000 examined entries per invocation (or a smaller `--max`), and report more work with a continuation. In apply mode the job enqueues one coalesced continuation on its queue immediately while more work remains, carrying the cursor, until it has caught up, so the daily cap per invocation is not a daily ceiling; preview and the manual command stop after one invocation and print the continuation. If the next daily job starts while a continuation from the previous day is still pending, it reports `backlog_growing`. The cursor binds system scope, stage, both ages, run cutoff and `(created_at, id)`; invalid/foreign cursors refuse.

The system values stage is a `strip` call, so it refuses with `REPLAY_ROLLOUT_UNCONFIRMED` until the rollout is confirmed and records that refusal in its aggregate evidence; its preview reads `actionLogService.isReplayRolloutConfirmed()` and prints `REPLAY_ROLLOUT_UNCONFIRMED` as a warning when it returns false; the history stage is a `delete` call and also refuses until confirmation. Each database batch takes a transaction advisory lock through the shared `withAdvisoryXactLock` helper, under a fixed system-history key, so duplicate workers cannot mutate the same selection concurrently. Both modes use the R3-1 replay lease and refreshed row: live executors are skipped and retried, while an unleased claim remains protected until C4's durable attempt is settled or fenced cancellation prevents every later write. The system pass writes only aggregate evidence via `actionLogService.log`, resource kind `privacy.retention_run`, with null tenant and organization, no before/after values, and counts, windows, stage, completion and failure reason. It does not insert into tenant-required `privacy_operations`. System reports are operator-visible command/job results, not tenant operations API rows. These rows are excluded from both stages by the evidence prefix.

This service also owns its null-tenant `privacy.retention_run` summary expiry: a separate evidence stage deletes its terminal aggregate summaries after 365 days under assumption 9, through the exact-kind DEC-B delete call with `tenantId: null`. Its own summary resource id is `system-history:<run UUID>`; select only validated system summaries through `actionLogService.list` and exact resource pairs. Unresolved summaries and any row that cannot be identified as this service's aggregate, system-actor-only evidence are preserved and reported. The evidence stage shares explicit apply, lease, fixed cutoff, cursor and the invocation's total limit; preview and unset installation ages still delete nothing. Counts/dates may survive in a fresh aggregate summary, without old run ids, actor ids, references or payload. Other null-tenant evidence remains its actual owner's expiry handoff; this stage cannot erase it merely by prefix. Under R4-3 every `privacy.tenant_export` entry carries its tenant; tenant-scoped `privacy.tenant_export_evidence` runs expire it, including for soft-deleted tenants; there is no null-tenant tenant-export evidence and no installation age. This service's two history ages never apply to tenant-export evidence.

Tenant holds cannot identify a null-tenant snapshot. The system apply consequence therefore states that tenant holds do not protect these entries. The safe default is unset/preview; installations needing a hold over null-tenant history must leave both settings unset or disable that job. No claim is made that this pass honours tenant subject holds.

## 📝 Delta

### Capability: change-history-retention

#### ADDED Requirement: Two-stage retention of change history
The system SHALL, under a tenant's policies, remove the stored data from change-history entries older than one age and delete entries older than another, and SHALL do neither without a policy.

##### Scenario: No policy
- WHEN a tenant has set no policy, including a command or direct handler call with a valid age
- THEN no tenant entry is changed; the handler refuses `policy_required`

##### Scenario: Stripped
- WHEN an entry is older than the values window
- THEN it is stripped as the erasure spec defines: its stored records, change values, undo token and all of its context but the actor keys `actorSubject` and `systemActor` are gone, the names of its changed fields remain, and it is marked

##### Scenario: Replay rollout not confirmed
- WHEN either values or history apply runs for a tenant or the installation before it has run `mercato audit_logs confirm-replay-rollout`
- THEN both strip and delete apply refuse with `REPLAY_ROLLOUT_UNCONFIRMED`, tenant and installation passes record the refusal, no protected row changes, and both previews report the warning from `actionLogService.isReplayRolloutConfirmed()` without changing the DEC-B result. The policy form shows that warning.

##### Scenario: Deleted
- WHEN an entry is older than the history window
- THEN it is gone

##### Scenario: Evidence
- WHEN an entry records an erasure, an export, a retention pass, a hold release or a policy change
- THEN neither set touches it

##### Scenario: A tenant with a subject hold
- WHEN a tenant has an active hold on a person and its policy keeps the default
- THEN neither set changes any entry of that tenant, and the pass is recorded as skipped with reason `hold_not_honourable`

##### Scenario: Holds allowed through
- WHEN the policy sets `allowUnmatchedHolds` and a subject is held
- THEN root and declared audit-resource pairs are excluded on all three record columns; an EUDR plot/evidence entry stays, missing required EUDR mappings refuse, and snapshot-only mentions may expire as acknowledged

##### Scenario: Below the floor
- WHEN a values window under ninety days is entered
- THEN it is refused

##### Scenario: History below values
- WHEN history is shorter than values, or history has no active values policy
- THEN the form, API and handler refuse; supplying the age in the OSS command does not override this

##### Scenario: System history
- WHEN the system job or command runs with two valid configured ages
- THEN only null-tenant entries are processed, evidence survives and tenant entries are unchanged

##### Scenario: Missing or invalid system pair
- WHEN the ages are absent, partial or inverted
- THEN nothing is changed; absent is keep, invalid is a reported refusal

Redo and undo replay races are the erasure spec's requirement under R3-1. The release gate below verifies them without a second normative implementation here.

## 📝 Architecture

- **Provided by the OSS erasure spec**: `applyRetention` on the audit module's service, `stripped_at` and its partial index, the backfill skipping stripped entries, redo and the list response understanding a stripped entry, the readers that render a stripped line, and `subjectHistoryService` as a by-subject wrapper over the routine.
- **Enterprise `data_erasure`**: two prefixed retention sets, policy-validated handlers, paired policy API/form validation, consequence text; the two history bound ids in its `dataErasureRetentionBounds` handler; a separate system service, command, dedicated queue, declared schedule and two installation ages. The policy reader is the enterprise coverage spec's service, resolved through DI.
- **Holds**: command and engine use the record-retention service's per-batch guard checks and record skips; declared audit resource pairs add direct exclusions under the acknowledged opt-out.
- **The record-retention service** calls the owning handler and drains after commits under R3-8. The DSR engine must call that service rather than loop `pruneRecords` itself.

| Touchpoint | Mechanism | Absent |
|---|---|---|
| Enterprise → change history | `actionLogService.applyAgeRetention` (tenant) and `applyRetention` (installation) and `isReplayRolloutConfirmed` by DI key | Audit module disabled, or the routine not yet shipped: the sets are not offered |
| Policy → tenant schedule | Engine daily pass through `privacyRetentionService.run`, continued until `done` under the engine's record-mode throughput rule | No engine/policy: tenant handlers refuse |
| Handler → active window | `privacyRetentionPolicyService.getActiveWindow` by DI, owned by enterprise coverage | Missing/null refuses; errors fail closed |
| System schedule/command → null-tenant history | Separate `systemHistoryRetentionService` → audit owner, exact `tenantId: null`; schedule declared in `retentionSchedules` | Unset settings keep; no scheduler means manual only, reported by `pruners.unscheduled` |
| C5/G6 → history bounds | `dataErasureRetentionBounds` by DI key, bound ids `data_erasure.change_values` / `data_erasure.change_history` | Missing handler or failed projection: verification fails closed |
| Holds → pass | The engine's hold rule, with the set's `excludableSubjectKinds` and the policy's `allowUnmatchedHolds` | — |
| Readers of stripped entries | `strippedAt` and `changedFields` on the entry, from the erasure spec | — |

## 📝 Data Models

No table or column in this spec. `action_logs.stripped_at` and its partial index on tenant and `created_at` for entries not yet stripped are the erasure spec's; the values pass relies on that index, because the engine's daily pass starts from the beginning each day. The policy flag `allowUnmatchedHolds` is a column of the engine's policies table. The system schedule uses the existing scheduler's system-scope rows; it creates no nullable-tenant policy or operations row. Aggregate system audit evidence uses the already nullable action-log scope.

## 📝 API Contracts

The routine and its rollout marker read, as the erasure spec defines them:

```ts
applyRetention(input: {
  tenantId: string | null
  organizationId?: string
  olderThan?: Date
  mode: 'strip' | 'delete'
  limit: number
  after?: string
  includeResourceKinds?: string[]
  excludeResourceKindPrefixes?: string[]
  includeRecords?: Array<{ resourceKind: string; resourceId: string }>
  excludeRecords?: Array<{ resourceKind: string; resourceId: string }>
  includeSubjects?: PrivacySubjectReference[]
  excludeSubjects?: PrivacySubjectReference[]
  dryRun: boolean
}): Promise<{ matched: number; changed: number; skipped: number; next?: string; done: boolean }>

isReplayRolloutConfirmed(): Promise<boolean>
```

- **Tenant handler input.** Required `scope.tenantId` is passed unchanged; it is never null. Call DEC-B `actionLogService.applyAgeRetention`. For apply pass the exact `writeContext` already fenced by D3; no private commit, separate manager or independently acquired fence is valid. `olderThan` is `new Date(input.cutoff)` from the service's fixed eligibility cutoff from the bound continuation; the window is not subtracted twice. `mode` is `strip` for `data_erasure.change_values` and `delete` for `data_erasure.change_history`; `limit`, `after` and `dryRun` follow `pruneRecords`. Evidence prefixes are `['privacy.', 'data_erasure.', 'audit_logs.export']`. `excludeRecords` always contains the settings-evidence pair `{ resourceKind: 'privacy.settings_command', resourceId: 'privacy.settings.set' }`, in addition to any hold-derived pairs. Pass `scope.organizationId` when supplied; tenant-wide engine passes omit it. Under an acknowledged opt-out pass `excludeSubjects` and explicit registry-derived `excludeRecords`; otherwise active holds skip before the call. Report `changed` as `deleted`, and `filesPending: 0`. `applyRetention`'s result carries no warnings. In either history mode’s dry run, call `actionLogService.isReplayRolloutConfirmed()` and, when it returns false, return `warnings: ['REPLAY_ROLLOUT_UNCONFIRMED']` on the `pruneRecords` result; apply batches return no warning and refuse when confirmation is absent. If `skipped > 0`, return `done: false`, `incompleteReason: history_replay_pending` and a retry position at the original batch start, never a cursor past a live replay. The shared service preserves committed counts, performs R3-8 and stops incomplete; a later pass re-examines the skipped entries. The system service follows the same no-advance rule before moving to another stage.
- **Throughput.** Record-mode passes for both sets follow the engine's no-daily-ceiling continuation rule; `backlog_growing` is the pass and projection reason when a pass date ends before `done`.
- **Retention bounds.** Bound ids `data_erasure.change_values` and `data_erasure.change_history`, resolved by `dataErasureRetentionBounds` with C5's exact `PrivacyRetentionBoundHandler` contract; additive.
- **Policy enforcement.** Every batch reads the exact active set policy, including its target, and both windows for a history pass through the coverage spec's Policy access service. A caller age is no substitute for a policy. API validators reject invalid window pairs and all policy updates retain the engine's optimistic-lock header and `updatedAt` conflict handling.
- **Declaration.** Each set declares `excludableSubjectKinds: []`, `targets: ['records']`, the correct module prefix and the floors above. **R3-2 — The registry carries the whole `privacy.ts` default export** owns discovery in the contract spec's **Architecture → Components** and **Phase 1 — Contract and discovery**.
- **From the erasure spec, DEC-B and R3-1:** `strippedAt`, `changedFields`, resolved-entry undo/redo 410, execution-time locked checks, shared replay leases and dead-claim removal. No local redesign of those contracts.
- **System entry.** The separate operator command/service above is the only entry with `tenantId: null`. Its schedule key is `data_erasure:system-history-retention:system` on queue `data-erasure-system-history-retention`, declared in `retentionSchedules`. Settings are `OM_ACTION_LOG_SYSTEM_VALUES_RETENTION_DAYS` and `OM_ACTION_LOG_SYSTEM_HISTORY_RETENTION_DAYS`, documented in the application and create-app template environment examples. No combined `values,history` setting is introduced.
- All new names and settings are additive; the old set ids and combined setting were unreleased draft names.

## 📝 Edge Cases & Failure Scenarios

| Case | Behaviour |
|---|---|
| An entry already stripped by an erasure | Marked by the same routine, so the values pass skips it; deleted at the history age |
| An entry in the state "undoing" | R3-1: a live replay lease skips it for retry; a missing lease does not establish death; durable attempt settlement or fenced cancellation is required before strip/delete, never age alone |
| A tenant with an active subject hold | Both sets are skipped for it and the pass is recorded with reason `hold_not_honourable`, by the engine and by the record-retention command alike |
| The same, with `allowUnmatchedHolds` on the policy | Entries whose resource, parent resource or related resource is a held subject's record are left out; entries that mention the subject only inside a snapshot are processed |
| A note on a held person, logged under the note with the person as parent and a deal as related resource (`customers/commands/comments.ts:132-140`) | Left out under `allowUnmatchedHolds`: the parent pair matches. An entry that names a held record only in its related pair is left out the same way |
| A hold is released | The next day's pass runs for the tenant again |
| A hold on one of the two sets | That set is skipped, as any held set is |
| An entry with no resource kind | Treated as ordinary history, not as evidence |
| An undo claimed while a pass runs | A live executor holds the shared replay lease and is skipped; otherwise the locked strip wins and a preloaded replay refuses before a handler or trace writes |
| Redo loaded before a strip commits | R3-1's execution-time locked check refuses it before the command writes a new log |
| Strip or delete before `mercato audit_logs confirm-replay-rollout` | Tenant and installation apply refuse with `REPLAY_ROLLOUT_UNCONFIRMED`, change nothing, and record the refusal. Both previews warn from `actionLogService.isReplayRolloutConfirmed()` |
| Entries with no tenant and no installation ages | Kept; tenant passes cannot reach them |
| A partial or inverted installation pair | Refuse both system stages before mutation |
| A system run while tenant holds exist | Holds do not map null-tenant history; explicit system apply warns, and unset/preview preserves it |
| A command with no active set policy, or a history window below values | Handler refuses before calling the audit service |
| A large first pass | Batches of at most 100 in time-budgeted continuation jobs until caught up; no daily record ceiling. A pass still behind at the next pass date is recorded `backlog_growing` and the bound projects pending |
| More entries written per day than one continuation job can process | Continuations keep running back to back; `backlog_growing` is reported while the selection is not exhausted at a pass boundary |
| The system-history job is not registered or is disabled | The manual command still works; `pruners.unscheduled` reports the missing or disabled `data_erasure:system-history-retention:system` schedule |
| Sales history for an old order | Empty for stripped entries; the page says older history is no longer kept |

## 📝 Migration & Backward Compatibility

- Two correctly prefixed retention sets, a policy-reader consumer, two bound ids on the existing bound handler, separate system command/service/job with its dedicated queue and declared schedule, and two settings: additive. The column, index, service method, response fields and the redo change are the erasure spec's, with its migration and compatibility notes.
- Resolved stripped undo/redo entries return 410 after authorization where replay used to succeed; a token already removed keeps ordinary unavailable behavior and undo is no longer offered. Tenant age-based changes require active apply policies. Null-tenant changes require both installation ages plus explicit system apply. Strip passes, tenant and system, refuse with `REPLAY_ROLLOUT_UNCONFIRMED` until the installation runs C4's `mercato audit_logs confirm-replay-rollout`; `UPGRADE_NOTES.md` tells administrators to finish the rolling deployment of every web and worker process and confirm before enabling an apply values policy or system apply. The OSS erasure path independently strips entries under its own confirmed request and compatibility rules. R3-1 also closes an in-flight replay race; its owner carries that change.
- The old `audit_logs.change_values`, `audit_logs.change_history` and combined system setting were never shipped; implementations must use the corrected names. No frozen shipped surface is removed. If a downstream prototype shipped them, retain aliases and deprecate for at least one minor with upgrade notes before removal.
- `UPGRADE_NOTES.md` names the table of what stripping ends.

## 📋 Phasing

| Phase | Outcome | Depends on |
|---|---|---|
| Prerequisite | OSS erasure Phase 2: routine, stripped fields, replay checks and reader integration gate | DEC-B and R3-1; no enterprise-only replacement test |
| 1 | Enterprise: prefixed sets, policy/API floors and consequence text, hold rule and direct mappings; separate system pass and schedule | OSS prerequisite; engine Phase 3; coverage Policy access service |

The OSS routine, column/index and readers remain the erasure spec's Phase 2. Before enterprise policies can be enabled, the owner’s **TC-AUD-STRIPPED-OSS-001**, listed in its Phase 2, file manifest and Integration Coverage, must pass. Its `auditRetention.test.ts` and `auditReplayRetentionRace.test.ts` pin the shared lease, locked refresh and conditional strip/delete rule; there is no bare `undoing`-state exemption.

## 📋 Implementation Plan

1. Verify the OSS owner’s Phase 2 `applyRetention.test.ts`, `auditRetention.test.ts`, `auditReplayRetentionRace.test.ts`, `command-bus.history-stripped.test.ts`, audit route tests and `subjectHistoryService.test.ts`: live lease skips in both modes, durable-attempt settlement/cancellation before claim removal, the `REPLAY_ROLLOUT_UNCONFIRMED` gate for both strip and delete, with only dry run ungated and `isReplayRolloutConfirmed()` false before and true after the confirmation, context reduced to `actorSubject`/`systemActor` with a system-actor entry keeping `systemActor`, locked refresh and conditional state mutations, both preloaded replay races, refreshed payloads and no snapshot traces. Require the owner-listed TC-AUD-STRIPPED-OSS-001 API/UI gate below before enabling enterprise policies. No duplicate OSS routine is defined here.
2. Add `data_erasure.change_values`/`change_history`, handler and policy reader consumer. Deliver the audit-owner probe before the bound adapter. Unit and C5/G6 cases exercise both modes with an eligible row, already-stripped values, owned and foreign rows, null-tenant, excluded evidence/related pairs, absent owner and same-snapshot manager propagation. Unit tests `actionHistoryRetention.test.ts`: module prefix, evidence/no kind, exact scope/cutoff, no-policy command/direct call, preview policy apply refusal, policy version change, history without values, inverted ages, declared direct record pairs and zero pending files. With encryption enabled, a C1 settings group older than both windows survives both sets through the related-pair exclusion while ordinary configuration history of the same age is stripped and deleted. After confirmation, a direct bound history call deletes unstripped old entries without running the values handler. Before the replay rollout is confirmed, both apply modes refuse with `REPLAY_ROLLOUT_UNCONFIRMED`, a preview returns `warnings: ['REPLAY_ROLLOUT_UNCONFIRMED']` through `run` with its full counts, filled from a stubbed `isReplayRolloutConfirmed()` returning false while the dry-run `applyRetention` result stays unchanged and neither apply mode writes; the bound projects `replay_rollout_unconfirmed`. A fixture writing more entries per simulated day than any fixed daily limit is cleared by continuation jobs, and a pass still behind at the next pass date reports `backlog_growing`. `historyRetentionBounds.test.ts` covers both bound ids' projections (no policy, preview, apply, hold skip, pending continuation, `backlog_growing`) and fixture evaluation of ordinary, evidence, settings-pair, other-tenant and null-tenant rows. A fixed-cutoff dry run advances keysets across batches. Live replay skips leave the batch incomplete and its retry position cannot advance past them; a later dead-claim pass completes. Use two independent managers to prove a post-call coordinator exception rolls back an age-based strip/delete, hold publication before the batch excludes/refuses, and publication behind the batch waits for commit. Test mismatched and absent active contexts fail without writes.
3. Policy form and API pair validation, including disable/activate, optimistic conflicts, consequence text and opt-out text. Unit tests `historyPolicyValidation.test.ts`; readers test `dealStageHistoryRetention.test.ts` pins existing fallback behavior before the strip and verifies that stripped fallback stages disappear while stored transitions survive.
4. System service/command/job and the two validated installation ages. Unit tests `systemHistoryRetention.test.ts`: both unset, partial, invalid and inverted; exact null tenant, evidence excluded from generic stages, fixed cursor and limits, duplicate worker lock, strip before delete, a preview before the rollout is confirmed printing `REPLAY_ROLLOUT_UNCONFIRMED`, failed batch retry and no tenant ledger write. The dedicated evidence stage deletes only validated terminal aggregate system summaries older than 365 days, preserving unresolved, unidentified and tenant rows; it shares the combined bound and emits no copied actor/reference/run id. `systemHistorySchedule.test.ts` asserts separate system registration on the dedicated queue, `retentionSchedules` key/UUID parity with registration, disabled-row preservation, default preview, explicit apply, coalesced continuation in apply mode until caught up, no continuation in preview, `backlog_growing` when a previous chain is still pending, no scheduler and exact service invocation.
5. Hold tests with the shared retention service: default skip; new hold between batches; release permits next run; opt-out matches resource/parent/related and explicit EUDR plot/evidence resource kinds; missing EUDR mapping refuses. Neither a derived identifier nor an unmapped kind is silently treated as matched.
6. TC-AUD-RETENTION-001, TC-AUD-SYSTEM-RETENTION-001 and policy UI coverage; docs and upgrade notes. Verify that C8's `tenantExportAudit.test.ts` asserts the R4-3 invariant that no `privacy.tenant_export` lifecycle entry is written without its tenant, and that TC-TENANT-EXPORT-002 expires a soft-deleted tenant's settled evidence through the tenant-scoped `privacy.tenant_export_evidence` run while recent and unresolved groups are preserved. The generic system stages must preserve every `privacy.`-prefixed entry for its owner. Generate discovered module files; keep system schedule changes in the enterprise module.
7. Archive this Delta into `.ai/specs/capabilities/change-history-retention.md` if that directory has been adopted by then.

| File | Action |
|---|---|
| `packages/enterprise/src/modules/data_erasure/{privacy.ts,lib/retention/*,backend/*,api/policies/*,cli.ts,di.ts,workers/*}` | Create / modify |
| `packages/enterprise/src/modules/data_erasure/__integration__/TC-AUD-RETENTION-001.spec.ts` | Create |
| `packages/enterprise/src/modules/data_erasure/__integration__/TC-AUD-SYSTEM-RETENTION-001.spec.ts` | Create |
| `packages/enterprise/src/modules/data_erasure/__tests__/{actionHistoryRetention,historyPolicyValidation,historyRetentionBounds,systemHistoryRetention,systemHistorySchedule}.test.ts` | Create |
| `packages/core/src/modules/customers/__tests__/dealStageHistoryRetention.test.ts` | Create reader characterization/regression |
| `packages/core/src/modules/audit_logs/__integration__/TC-AUD-STRIPPED-OSS-001.spec.ts` | OSS erasure-owner prerequisite |
| `apps/mercato/.env.example`, `packages/create-app/template/.env.example`, `UPGRADE_NOTES.md` | Document both system ages and consequences; use template sync |

The audit module's files, the readers and their tests are in the erasure spec's file manifest. The record-retention spec's one-sentence amendment is already made.

## 🧪 Integration Coverage

| Test | Covers |
|---|---|
| TC-AUD-STRIPPED-OSS-001 | OSS-only prerequisite owned by erasure Phase 2. Create own actor, customer, edit actions and a separate redo target; undo the target through `POST /api/audit_logs/audit-logs/actions/undo` so it is the actor's latest undone entry before stripping. Assert that a strip before `mercato audit_logs confirm-replay-rollout` refuses with `REPLAY_ROLLOUT_UNCONFIRMED`, then confirm the rollout. Strip through the confirmed erasure/in-process test seam, preserving actor fixtures. `GET /api/audit_logs/audit-logs/actions` returns `strippedAt`, exact `changedFields` and no values/token; a scoped audit-service read proves that only the actor keys survive in the context — `actorSubject`, and for a system-actor fixture entry only `systemActor`; `POST /api/audit_logs/audit-logs/actions/redo` for that eligible target returns 410. Open version history and CRM change log and assert localized stripped lines without old values. With barriers, preloaded undo/redo cannot replay after strip; both modes leave live leased claimed rows alone; an unleased claim becomes strip/delete eligible only after durable fenced cancellation or settlement and reconciliation prove no late database write or external effect can commit; finalizers never revive stripped content. Own fixtures and cleanup in `finally`; no enterprise module required. |
| TC-AUD-RETENTION-001 | Enterprise: create own actor, edited records and action entries, then backdate fixtures. No-policy command leaves them untouched; policy API refuses history below values and apply under preview policy. A values preview pass before the rollout is confirmed stores `REPLAY_ROLLOUT_UNCONFIRMED` in its warnings and the policy form shows it. Create the two valid apply policies; both apply modes before the fixture installation's `mercato audit_logs confirm-replay-rollout` are recorded refused with `REPLAY_ROLLOUT_UNCONFIRMED` and leave all rows unchanged; then confirm the rollout and run the registered pass. Older history disappears from the list API; middle entry has stripped fields/no values; recent history is unchanged. An own privacy-settings change older than both windows, written through `mercato privacy settings set`, survives both stages. Redo 410 is tested with a separate actor's latest undone entry, undone before backdating and with no later undone action for that actor. Evidence survives. Own CRM-person and EUDR plot/evidence holds default-skip the tenant; opt-out preserves all three direct pairs including declared EUDR kinds, while another old entry is stripped. UI tests show the consequence text, invalid-window error, optimistic conflict and stripped line; legacy deal fallback loses stripped transitions and a deal with stored transitions keeps them. Query operations for skip/incomplete counts. Cleanup all policies, holds, records and entries in `finally`. |
| TC-AUD-SYSTEM-RETENTION-001 | Enterprise: own null-tenant and two-tenant action entries, ordinary and evidence, backdated in private fixtures. Unset/partial/inverted system ages change nothing. Invoke separate system command and enqueue/drain its registered job with valid ages, first preview then explicit apply; null-tenant ordinary entries strip/delete at the right ages, evidence and both tenants' entries survive. The generic tenant history command never reaches a null-tenant entry. A null-tenant `privacy.`-prefixed evidence fixture survives these generic stages. Under R4-3 tenant-export evidence always carries its tenant; C8's TC-TENANT-EXPORT-002 separately verifies that the tenant-scoped dedicated set expires a soft-deleted tenant's groups, preserving recent/unresolved groups. A separately owned terminal aggregate system summary past 365 days expires through its dedicated stage, while unidentified evidence and unresolved summaries stay. Assert aggregate system evidence, no tenant operations row, bounded continuation and idempotent retry. Restore process settings and remove all fixtures in `finally`. |

Policy pages reuse the DSR engine's guarded CRUD APIs and UI; this spec adds localized consequence/validation text and no new page root or client provider. API and UI fixtures are self-contained; use the engine's queue helper with owned policies rather than demo setup.

## 📝 Risks & Impact Review

#### History is removed and then needed
- **Scenario**: A tenant sets a short strip age and later must restore a deleted record or show what a field used to be.
- **Severity**: High
- **Affected area**: undo, restore, audits
- **Mitigation**: No default; a 90-day floor; active-policy and window-pair validation inside the handler and API; acknowledged consequence text; the line survives until the history window. System apply separately validates both ages and requires explicit opt-in.
- **Residual risk**: Irreversible by design.

#### Evidence is lost
- **Scenario**: Erasure and export entries are deleted with the rest.
- **Severity**: High
- **Affected area**: accountability
- **Mitigation**: Both sets preserve the evidence prefixes and C1's exact settings-command operation groups, selected by their clear-text related pair rather than the encrypted command id; dedicated owners enforce their own whole-entry expiry and recovery gates. Under R4-3 every `privacy.tenant_export` entry carries its tenant; tenant-scoped `privacy.tenant_export_evidence` runs expire it, including for soft-deleted tenants; there is no null-tenant tenant-export evidence and no installation age. Generic system history never selects `privacy.`-prefixed entries.
- **Residual risk**: An evidence entry written under an unlisted kind, or a dedicated owner expiry not implemented/configured. The generic exclusion alone gives no finite bound; missing handoffs block program closure.

#### History outgrows its retention
- **Scenario**: A busy tenant writes more entries a day than a capped pass can strip or delete, so the configured age is never reached.
- **Severity**: High
- **Affected area**: storage limitation for change history
- **Mitigation**: Record-mode passes continue in time-budgeted continuation jobs until `done`, with no daily record ceiling; the system job re-enqueues itself in apply mode; `backlog_growing` is reported on the pass and in the C5 projection.
- **Residual risk**: A write rate above back-to-back deletion capacity; it is reported, not hidden.

#### The OSS routine is read as the Enterprise capability
- **Scenario**: Review of the erasure owner's Phase 2 PR reads the routine's `olderThan` selector in core as the age-based retention #2980 placed in Enterprise.
- **Severity**: High
- **Affected area**: this spec's split
- **Mitigation**: Assumption 1, settled by DEC-2 and DEC-B. The routine is specified in the OSS erasure spec and its first caller is the erasure strip; policies, schedules, settings and the sets stay in Enterprise, and no schedule, command or setting for age selection exists in OSS. The upstream PR goes through ordinary maintainer review.
- **Residual risk**: Rework of that PR if review moves part of the routine. The routine stays in the audit module in every case, because module isolation forbids an Enterprise write to the core table.

#### A stripped line shows as an empty change
- **Scenario**: A reader builds its row from the cleared columns.
- **Severity**: Medium
- **Affected area**: version history, the change log, sales history and legacy deal stage fallback
- **Mitigation**: The erasure owner supplies field names, mark and reader changes. The OSS integration prerequisite checks both screens; deal reader tests and enterprise coverage check legacy fallback loss, and the policy consequence table states it.
- **Residual risk**: Third-party screens reading old columns can show empty history. Legacy deals without stored transitions lose reconstructed stages after stripping; that irreversible effect is acknowledged before apply.

#### A hold is not honoured
- **Scenario**: A held person's data sits inside another record's stored snapshot, or in an entry that names them only as its related resource, and is stripped or deleted by age.
- **Severity**: High
- **Affected area**: legal holds; change history of every held subject
- **Mitigation**: Assumption 8. Both sets declare that they can leave no subject fully out, so a tenant with an active subject hold is skipped and the skip is recorded with `hold_not_honourable`, by the engine and by the record-retention command. Under the opt-out, holds match all three pairs plus explicit registry-declared audit resource kinds; EUDR cannot run with missing mappings. Unit tests and TC-AUD-RETENTION-001 cover the skip and the opt-out.
- **Residual risk**: A policy with `allowUnmatchedHolds` strips a held subject's data that sits only inside another record's snapshot; the administrator chose that on a form that says so. A tenant with a long hold keeps all of its change history until the hold ends.

#### Null-tenant history cannot honour tenant holds
- **Scenario**: A null-tenant snapshot contains a held tenant subject but has no tenant attribution.
- **Severity**: High
- **Affected area**: system change history and legal holds
- **Mitigation**: Separate exact-null scope, both ages unset by default, scheduled preview by default, explicit operator apply with the limitation stated, aggregate evidence and hard limits.
- **Residual risk**: An installation that enables system apply can remove such data; keeping settings unset or disabling the job is required while preserving unattributable history.

## Final Compliance Report — 2026-11-16

Pass-two review: cross-spec references and shared decisions checked against the merged workspace; runner: local, Python document checks only. Pass-three checks aligned the current C4 gate and dedicated export-evidence owners; no independent review was available. No implementation tests were run. Independent review could not launch because the collaboration service returned `no rollout found`; this revision was reviewed directly.

- **Reviewed:** root `AGENTS.md`, `.ai/specs/AGENTS.md`, `BACKWARD_COMPATIBILITY.md`.

| Rule | Status | Notes |
|---|---|---|
| Enterprise scope in the enterprise specs directory | Compliant | The OSS seam is DEC-B's routine; the split is settled by DEC-2 (assumption 1) |
| No cross-module table access | Compliant | Through the owning module's service |
| Additive schema and API | Compliant | Two module-prefixed sets, two settings, separate system service/command/job; OSS columns/fields owned by erasure |
| One normative text per contract | Compliant | `applyRetention` and its fields are cited from the erasure spec, not redefined |
| Behaviour change documented | Compliant | Redo returns 410 for stripped entries, as the erasure spec defines |
| Legal holds honoured | Compliant | Fails closed with `hold_not_honourable`; three-column matching under the opt-out |
| Bounded, resumable batch jobs | Compliant design | Batches of 100, time-budgeted continuations until caught up, `backlog_growing` reporting; system schedule declared for diagnostics |
| Changes integrated through real call sites | Compliant | The routine's OSS caller is the erasure strip |
| Integration coverage | Specified | OSS reader/replay prerequisite plus self-contained enterprise policy and system tests |
| R4-3 tenant-export evidence always carries its tenant | Owner contract cited | Tenant-scoped `privacy.tenant_export_evidence` runs, including for soft-deleted tenants; no null-tenant tenant-export evidence and no installation age; C8 owner tests; no generic-history deletion |

**Verdict:** revised design with every assumption decided. Implementation waits for the erasure owner's Phase 2 integration/replay gate, the coverage policy reader and the engine's Phase 3; each PR goes through ordinary maintainer review. No implementation is claimed.

## Replay correction acceptance

`auditReplayRetentionRace.test.ts` must pause a legacy non-atomic executor after its committed claim and prove both strip and delete refuse before fleet confirmation. After rollout, losing only the dedicated lease connection never permits reclamation while a durable attempt is running/unknown. Every replay-owned database mutation, including trace/finalization, uses C4's `withReplayWriteFence` on its active owner manager; unsupported handlers refuse before claim. Fenced cancellation advances the attempt generation only after earlier writes settle and refuses uncertain external effects; a resumed old generation cannot write. Tenant and system retention consume the same owner result. No values-preparation dependency is reintroduced: after confirmed rollout, history may directly delete an eligible unstripped row when its own replay/hold checks pass.

## Changelog

### 2026-11-20 — Confirmed specification review corrections

- Use the audit owner’s bound age selector for tenant policy batches and apply the replay rollout gate to both strip and delete. (R06, R30)

### 2026-11-19 — Confirmed spec review corrections

- Gate both destructive history modes on fleet rollout and durable replay-attempt settlement; align the independent history handler with C3. Design revision only.


### 2026-11-17
- C1 settings evidence is preserved through a clear-text related pair passed in `applyRetention`'s `excludeRecords`, instead of the encrypted command id; tests cover an encryption-enabled settings group.
- Throughput: both sets rely on the engine's no-daily-ceiling record-mode continuation; the system job re-enqueues itself in apply mode; `backlog_growing` is reported on passes and in the bound projection.
- The history handler no longer runs a nested values pass; values-before-history is a scheduling rule only.
- The system-history job is declared in `retentionSchedules` on a dedicated queue, so `pruners.unscheduled` reports it; the two history bound ids are resolved by `dataErasureRetentionBounds` for C5/G6.
- Strip passes, tenant and system, consume C4's `REPLAY_ROLLOUT_UNCONFIRMED` gate and surface it before the first apply pass: `applyRetention`'s result is unchanged and has no `warnings` member, so the strip-mode dry run reads `actionLogService.isReplayRolloutConfirmed()` and the values handler fills its `pruneRecords` `warnings`, which `run` returns, the engine stores with its preview pass and the policy form shows; both destructive modes now require confirmed rollout (superseding the earlier delete exemption). The erasure-evidence row lists `privacy.subject_erasure_progress`. Stripped context keeps the actor keys `actorSubject` and `systemActor`.
- R4-3 now reads that tenant-export evidence always carries its tenant and expires through tenant-scoped runs, including for soft-deleted tenants; the installation evidence age is gone. The system-history pass's own null-tenant summary expiry is unchanged.

### 2026-11-16
- Written autonomously with resolved assumptions, after the record-retention spec's review removed change history from that spec. It carries that review's corrections: no entry is spared for being the latest undoable one; privacy and export entries are exempt; the deal stage history has its own table and is not a consequence; the capability is placed in Enterprise as the maintainers said.
- Revised after independent review. Undo cannot return a new status for a stripped entry, because it finds entries by the token that stripping clears; this token-path observation is superseded by R3-1 for already resolved undo entries, which now refuse under the execution lock too. The capability is two retention sets with one age each, so the retention-set contract and the engine's policy are unchanged. There is one stripping routine in the audit module, shared with the erasure spec's history strip, which gives it an OSS caller and makes "already stripped" detectable. Field names are computed before values are cleared, the backfill skips stripped entries, and the context is reduced to the actor. A partial index is added. Entries with no kind are no longer skipped by accident. The governance module's own entries join the evidence exemption. The readers' real behaviour with stripped entries is stated.
- Council review (Opus, GPT-5.6 Sol, DeepSeek V4 Flash, Kimi K3.1 Pro), high fixes: g5-09 — `applyRetention` lacked the inputs its erasure caller passes; the routine, `stripped_at`, its index and migration, the list fields and redo's 410 are now owned normatively by the OSS erasure spec, and this spec cites the full signature (organization scope, kinds and records to include or leave out, the three-column matching rule) and only states what its handler passes; the OSS phase and its files moved there. g5-10 — holds were matched on resource and parent resource only and snapshot-only mentions were stripped by default; holds now match on all three record column pairs, both sets declare `excludableSubjectKinds: []`, a tenant with an active subject hold is skipped with `hold_not_honourable`, and the only opt-out is the engine policy's `allowUnmatchedHolds`. Updated assumptions, Delta, edge cases, plan, TC-AUD-RETENTION-001, risks and compliance.

- Council round two fixes (GPT-6.1 Sol workers): r6-16 — policy-required handlers and paired windows in command/API/form; r6-17 — separate bounded system service, command and daily schedule; r6-26 — explicit owner audit resource mappings under opt-out; r6-27 — data_erasure set prefix; r6-36 — R3-1 locked replay prerequisite; r6-44 — legacy deal-stage fallback consequence/test; r6-45 — latest-undone redo fixture; g5-29 — OSS API/UI integration release gate in erasure Phase 2; g5-38 — existing conditional delete rule cited; F-73 — assumption 5; R1 system-window nit — two independent settings.
- Council round two fixes, pass two (GPT-6.1 Sol workers): W02 — consume R3-1 replay leases, locked execution checks and safe dead-claim stripping/deletion, retaining the exact DEC-B signature and enterprise policies; W03 — generic evidence prefixes remain excluded while dedicated owners receive finite expiry/surviving-field rules, defaulted under assumption 9; owner test names, section names, typed policy entry and live-replay retry positions aligned; null-tenant aggregate summaries gain separate finite expiry.
- Council round two fixes, pass three (GPT-6.1 Sol workers): consume C4’s now-named lease/locked-refresh/conditional-mutation tests and OSS gate; preserve live leased claims and preserve unleased claims until durable-attempt settlement or fenced cancellation (the later C4 correction supersedes lease-absence reclamation). Cite both dedicated finite export-evidence sets and their shared aggregate logger, current erasure-evidence expiry, and ordinary configs-owned settings history without changing the generic exclusions.
- Council round two fixes, pass four alignment (GPT-6.1 Sol workers): cite the current settings-command, erasure, tenant-export and governance evidence owners, exact groups, clocks and preservation rules; retain the OSS replay gate and explicit null-tenant expiry gap without defining another contract.
- Council round two fixes, pass five gap closing (GPT-6.1 Sol workers): R4-3 — replace the stale null-tenant tenant-export expiry gap with C8’s installation setting `OM_PRIVACY_INSTALLATION_EVIDENCE_AGE_DAYS`, default 365/floor 30, through the same dedicated set; cite both environment examples and align owner-test gates, scope separation, risks and compliance.

- 2026-11-18 review fix: specify the snapshot-bound audit-owner eligibility probe for both ordinary-history bounds.
