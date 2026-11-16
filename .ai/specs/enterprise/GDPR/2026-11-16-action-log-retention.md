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
| 6 | Evidence | Entries for privacy operations, exports and the governance module's own actions are in neither generic set; C1's settings-command groups are also preserved under its exact command/resource safeguard. The dedicated owner sets below supply finite expiry | Their reasons are in the part generic stripping would clear. The exclusion preserves evidence until its own finite period, hold or unresolved-work rule permits deletion. |
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
- **Indexes.** One leads with tenant and `created_at`; another with tenant, resource kind, resource id and `created_at`, so entries can be selected or excluded by kind in SQL. The command id cannot be used for that: it is encrypted. Nothing indexes the undo token.
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

- **Evidence kinds** written by the sibling specs: `privacy.subject_export`, `privacy.subject_erasure`, `privacy.retention_run`, `privacy.tenant_export`, `audit_logs.export`.
- **The erasure spec defines the strip.** It owns `actionLogService.applyRetention`, the `stripped_at` mark with its partial index and migration, the list fields `strippedAt` and `changedFields`, and redo's 410 for a stripped entry. No code does any of it yet.
- **Holds cannot be fully matched.** A held person's data can sit inside the snapshot of an entry about another record, a deal or an order, where no clear column names them.

## 📝 Proposed Solution

### What this spec uses from the OSS erasure spec

`actionLogService.applyRetention`, the `stripped_at` mark, the list fields `strippedAt` and `changedFields`, and stripped-entry replay refusal are specified normatively in [`../../GDPR/2026-11-16-privacy-subject-erasure.md`](../../GDPR/2026-11-16-privacy-subject-erasure.md): its Data Models, API Contracts, Phase 2, file manifest and unit tests. This spec does not define them again. A strip computes the names of changed fields first, clears the stored values and the undo token, reduces the context to the actor and sets `stripped_at`. Strip and delete share the owner's replay lease, locked refresh and conditional state mutations: a live executor is skipped and retried; an orphaned `undoing` claim without a lease is stripped or deleted safely, never spared forever. An entry matches a record when the record equals its (`resource_kind`, `resource_id`), (`parent_resource_kind`, `parent_resource_id`) or (`related_resource_kind`, `related_resource_id`).

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

Both leave out entries whose resource kind begins with `privacy.`, `data_erasure.` or `audit_logs.export`, and include entries with no kind. They also consume C1's **Settings-command evidence expiry** safeguard: preserve the exact `configs.module_config` / `privacy.settings.set` operation-UUID groups for their dedicated expiry, including held, failed/conflicting or unresolved groups. The audit owner implements that safeguard without changing DEC-B's selector signature; a `privacy.` resource-kind prefix cannot identify these groups. Unrelated configuration history and explicit subject-history stripping keep their own rules.

### Evidence outside the generic sets

The prefixes above remain unchanged for tenant and system history. C1's **Export-evidence expiry** and **Settings-command evidence expiry**, in [the contract spec](../../GDPR/2026-11-16-privacy-data-class-contract.md), own `privacy.export_evidence` and `privacy.settings_evidence`; the export-audit spec's **Export-evidence expiry** owns `audit_logs.export_evidence`. C4's **Erasure-evidence expiry** and the record-retention owner's **Retention-run evidence** have separate finite bounds too. Exclusion from generic sets never supplies their lifetime. Dedicated evidence-expiry declarations select the record-retention driver's **Aggregate evidence for expiry runs** with `runEvidence: 'aggregate'` before expiry ships. The table cites current owner designs, whose ages follow assumption 9; their owner implementations, guards, reconciliation proof and configured runners remain delivery prerequisites. Missing proof preserves evidence, and a declared age alone does not establish enforcement.

| Evidence | Actual owner | Finite age / preservation rule | Surviving fields after expiry |
|---|---|---|---|
| `privacy.subject_export`, `privacy.subject_export_request` | Contract spec, **Export-evidence expiry** | `retention.privacy.exportEvidenceAgeDays`, default 365 days, floor 30; `privacy.export_evidence`; any active subject hold skips request-wide evidence | Whole entries deleted, including actor/id/reference/context; aggregate counts, dates and set id only |
| `configs.module_config` / command `privacy.settings.set`, grouped by operation UUID | Contract spec, **Settings-command evidence expiry** | `retention.privacy.settingsEvidenceAgeDays`, default 365 days, floor 30; `privacy.settings_evidence` via `actionLogService.expirePrivacySettingsEvidence`; age starts at successful terminal `completed`. Holds/exclusions, failed/conflicting operations, missing/invalid completion and unresolved audit/config outcomes preserve the group | Delete every started/terminal entry of an eligible group whole, including actor/reference/context; dates, set id and aggregate counts only |
| `privacy.retention_run` | [Record-retention spec](../../GDPR/2026-11-16-privacy-record-retention.md), **Retention-run evidence**, including inactive-subject runs | `retention.privacy.retentionEvidenceAgeDays`, default 365 days, floor 30; `privacy.retention_evidence`; unresolved work and active holds defer | Whole entries deleted; aggregate counts, dates and set id only, without actor, reference or run/subject ids |
| `privacy.subject_erasure`, `privacy.erasure_call` journals | Erasure spec, **Erasure-evidence expiry**, assumption 20 | `retention.privacy.erasureEvidenceAgeDays`, default 365 days, floor 30; `privacy.erasure_evidence` via `actionLogService.expireErasureEvidence`, anchored to the group's latest completed `verifiedAt`. Holds/exclusions, open/incomplete runs, invalid context/timestamps, unreconciled coordinators, pending file/cache/required-side-effect work and unresolved downstream replay/ledger reconciliation preserve the group; missing owner proof refuses the pass | Delete terminal evidence groups whole, including retained-row proof, actor, ids and reference; aggregate counts/dates and set id only |
| `privacy.tenant_export` | [Tenant-exit spec](../../GDPR/2026-11-16-tenant-exit-export.md), **CLI, audit and output — Tenant-export evidence expiry**, assumption 11 | `retention.privacy.tenantExportEvidenceAgeDays` for tenant rows; R4-3 uses installation setting `OM_PRIVACY_INSTALLATION_EVIDENCE_AGE_DAYS` for `tenant_id` null. Both default to 365 days with a floor of 30. The same `privacy.tenant_export_evidence` set uses the audit owner’s `actionLogService.expireTenantExportEvidence` for tenant rows and `actionLogService.expireInstallationTenantExportEvidence` for null-tenant rows, through record retention's `runInstallation` / `--installation`. Holds/exclusions and unresolved publication/reconciliation defer; only validated `published`, dry-run `not_required` or explicitly `reconciled` groups may expire | Whole settled groups deleted, including actor, tenant resource id, reference and context; aggregate counts/dates only, without copied run or tenant-resource ids |
| `audit_logs.export` | [Export-audit spec](../../GDPR/2026-11-16-export-audit-event.md), **Export-evidence expiry** | `retention.audit_logs.exportEvidenceAgeDays`, default 365 days, floor 30; `audit_logs.export_evidence`; any subject hold or explicit exclusion skips, failed guard refuses | Whole entries deleted, including actor, resource/parent ids and context; only set id, counts and run dates in the shared aggregate summary |
| `data_erasure.policy`, `data_erasure.legal_hold`, `data_erasure.operation`, `data_erasure.retention_failure` action entries; own metadata rows | DSR engine, **Metadata retention and coverage**, assumption 17 | Action entries: `retention.data_erasure.auditEvidenceAgeDays`, default 365 days after terminal state, floor 30; `data_erasure.audit_evidence`. Holds/exclusions, active configuration, unresolved operations/references, pending replay/files and invalid/missing terminal proof defer; whole started/terminal groups expire only after owner dependency checks. Metadata clocks stay 365 days for terminal operations/holds and deleted policies, 15 minutes for unused previews, 30 days or earlier completion/policy deletion for failures | Expired rows/action entries deleted whole, including actor/reference/context/ids; aggregate counts/dates/set id only. Active configuration/holds and unresolved-work evidence retain necessary fields until terminal |
| Replay manifests and `privacy_erasure_applied` | [Restore-replay spec](2026-11-16-erasure-restore-replay.md), **Architecture**, pruning rule | Existing default 90 days for settled pairs, longer than restorable backups; pending or invalid files never age out | Settled file removed first, applied row only after success; aggregate status/cursor remains, no expired manifest payload |

C1's **Tenant privacy settings — R3-3: Tenant privacy settings live in `module_configs`** records settings edits under the ordinary configuration resource kind `configs.module_config`, command id `privacy.settings.set`, with no input/stored values, free-text reference or undo snapshot. Its **Settings-command evidence expiry** owns those exact operation groups and their generic-age safeguard; they acquire neither a `privacy.` nor a `data_erasure.` prefix exemption, and unrelated config history remains generic history. Dedicated expiry uses owner services and DEC-C guards, and whole-entry deletion through DEC-B where applicable. It never age-strips the evidence into actor-only fragments or weakens R3-1's replay checks. `allowUnmatchedHolds` is the generic history policy's acknowledged opt-out, not permission to discard held evidence. Under **R4-3 — Expiry of tenant-export evidence with no tenant**, C8's **CLI, audit and output — Tenant-export evidence expiry** owns the null-tenant path in the same `privacy.tenant_export_evidence` set, bounded by `OM_PRIVACY_INSTALLATION_EVIDENCE_AGE_DAYS` (default 365 days, floor 30). The owner lists that installation setting in both `apps/mercato/.env.example` and `packages/create-app/template/.env.example`. No tenant `module_configs` age is applied to rows with `tenant_id` null, and the generic system-history evidence stage cannot absorb them. This closes their finite-age design gap; a scheduled `mercato privacy retention --installation --set privacy.tenant_export_evidence --apply` run enforces it once the owner implementation ships. Other excluded null-tenant evidence requires its actual owner’s finite expiry or an explicit gap.

### Enterprise policy prerequisites

Set ids use the declaring module's `data_erasure.` prefix under the record-retention naming rule. The former `audit_logs.*` ids were unreleased draft names; no shipped id is renamed.

Every handler batch reads `privacyRetentionPolicyService.getActiveWindow`, defined in the enterprise coverage spec's **Policy access** section. It requires an active policy for the exact tenant and set, the policy's window equal to the requested window, the 90-day floor, and apply mode for a write. The history handler also requires an active values policy, with `historyDays >= valuesDays`; an apply history policy requires an apply values policy. Missing service/policy is `policy_required`, a failed read is `policy_unavailable`, and inconsistent ages are `invalid_retention_windows`. These checks apply to the OSS command and raw handler calls as well as the scheduled engine. A policy version change invalidates continuation and requires a fresh preview.

The policy API validates both windows atomically when saving, activating or disabling either policy; it cannot disable the values policy while history is active. The backend form shows the consequences before apply is enabled. Scheduling runs values before history. An explicit history command first runs the values pass through the shared service for that scope/window, within the caller's overall limit; an incomplete values preparation stops history without deleting rows. The history handler enforces this preparation itself, so a direct call has the same ordering. The values handler never calls history, which prevents recursion. Counts distinguish prepared strips from deleted history. No command bypasses the active policies or their acknowledged consequences.

Entries with no tenant use the separate installation pass below, never a null `PrivacyScope`. A failed prerequisite writes only aggregate refusal evidence; no audit snapshot is cleared first.

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

`mercato data_erasure register-schedules` registers a separate system-scoped daily job `data_erasure.system_history_retention`, using the existing `schedulerService.register` capability and the module queue. The job invokes this service, not the tenant-policy loop; its payload defaults to preview. The new registration option `--apply-system-history` opts that job into apply after showing the same consequence text. Missing scheduler registration leaves the manual command usable and is reported as unscheduled. Both command and job process values then history, cap each database batch at 100 and the combined work at 1000 examined entries per invocation (or a smaller `--max`), and report more work with a continuation. The cursor binds system scope, stage, both ages, run cutoff and `(created_at, id)`; invalid/foreign cursors refuse.

Each database batch takes a transaction advisory lock through the shared `withAdvisoryXactLock` helper, under a fixed system-history key, so duplicate workers cannot mutate the same selection concurrently. Both modes use the R3-1 replay lease and refreshed row: live executors are skipped and retried, while a dead `undoing` claim without a lease is stripped or deleted safely. The system pass writes only aggregate evidence via `actionLogService.log`, resource kind `privacy.retention_run`, with null tenant and organization, no before/after values, and counts, windows, stage, completion and failure reason. It does not insert into tenant-required `privacy_operations`. System reports are operator-visible command/job results, not tenant operations API rows. These rows are excluded from both stages by the evidence prefix.

This service also owns its null-tenant `privacy.retention_run` summary expiry: a separate evidence stage deletes its terminal aggregate summaries after 365 days under assumption 9, through the exact-kind DEC-B delete call with `tenantId: null`. Its own summary resource id is `system-history:<run UUID>`; select only validated system summaries through `actionLogService.list` and exact resource pairs. Unresolved summaries and any row that cannot be identified as this service's aggregate, system-actor-only evidence are preserved and reported. The evidence stage shares explicit apply, lease, fixed cutoff, cursor and the invocation's total limit; preview and unset installation ages still delete nothing. Counts/dates may survive in a fresh aggregate summary, without old run ids, actor ids, references or payload. Other null-tenant evidence remains its actual owner's expiry handoff; this stage cannot erase it merely by prefix. In particular, null-tenant `privacy.tenant_export` groups use C8's same `privacy.tenant_export_evidence` set and R4-3 installation age, independently of this service's two history ages.

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
- THEN it is stripped as the erasure spec defines: its stored records, change values, undo token and all of its context but the actor are gone, the names of its changed fields remain, and it is marked

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
- **Enterprise `data_erasure`**: two prefixed retention sets, policy-validated handlers, paired policy API/form validation, consequence text; a separate system service, command, schedule and two installation ages. The policy reader is the enterprise coverage spec's service, resolved through DI.
- **Holds**: command and engine use the record-retention service's per-batch guard checks and record skips; declared audit resource pairs add direct exclusions under the acknowledged opt-out.
- **The record-retention service** calls the owning handler and drains after commits under R3-8. The DSR engine must call that service rather than loop `pruneRecords` itself.

| Touchpoint | Mechanism | Absent |
|---|---|---|
| Enterprise → change history | `actionLogService.applyRetention` by DI key | Audit module disabled, or the routine not yet shipped: the sets are not offered |
| Policy → tenant schedule | Engine daily pass through `privacyRetentionService.run` | No engine/policy: tenant handlers refuse |
| Handler → active window | `privacyRetentionPolicyService.getActiveWindow` by DI, owned by enterprise coverage | Missing/null refuses; errors fail closed |
| System schedule/command → null-tenant history | Separate `systemHistoryRetentionService` → audit owner, exact `tenantId: null` | Unset settings keep; no scheduler means manual only |
| Holds → pass | The engine's hold rule, with the set's `excludableSubjectKinds` and the policy's `allowUnmatchedHolds` | — |
| Readers of stripped entries | `strippedAt` and `changedFields` on the entry, from the erasure spec | — |

## 📝 Data Models

No table or column in this spec. `action_logs.stripped_at` and its partial index on tenant and `created_at` for entries not yet stripped are the erasure spec's; the values pass relies on that index, because the engine's daily pass starts from the beginning each day. The policy flag `allowUnmatchedHolds` is a column of the engine's policies table. The system schedule uses the existing scheduler's system-scope rows; it creates no nullable-tenant policy or operations row. Aggregate system audit evidence uses the already nullable action-log scope.

## 📝 API Contracts

The routine, as the erasure spec defines it:

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
```

- **Tenant handler input.** Required `scope.tenantId` is passed unchanged; it is never null. `olderThan` is `new Date(input.cutoff)` from the service's fixed eligibility cutoff from the bound continuation; the window is not subtracted twice. `mode` is `strip` for `data_erasure.change_values` and `delete` for `data_erasure.change_history`; `limit`, `after` and `dryRun` follow `pruneRecords`. Evidence prefixes are `['privacy.', 'data_erasure.', 'audit_logs.export']`. Pass `scope.organizationId` when supplied; tenant-wide engine passes omit it. Under an acknowledged opt-out pass `excludeSubjects` and explicit registry-derived `excludeRecords`; otherwise active holds skip before the call. Report `changed` as `deleted`, and `filesPending: 0`. If `skipped > 0`, return `done: false`, `incompleteReason: history_replay_pending` and a retry position at the original batch start, never a cursor past a live replay. The shared service preserves committed counts, performs R3-8 and stops incomplete; a later pass re-examines the skipped entries. The system service follows the same no-advance rule before moving to another stage.
- **Policy enforcement.** Every batch reads the exact active set policy, including its target, and both windows for a history pass through the coverage spec's Policy access service. A caller age is no substitute for a policy. API validators reject invalid window pairs and all policy updates retain the engine's optimistic-lock header and `updatedAt` conflict handling.
- **Declaration.** Each set declares `excludableSubjectKinds: []`, `targets: ['records']`, the correct module prefix and the floors above. **R3-2 — The registry carries the whole `privacy.ts` default export** owns discovery in the contract spec's **Architecture → Components** and **Phase 1 — Contract and discovery**.
- **From the erasure spec, DEC-B and R3-1:** `strippedAt`, `changedFields`, resolved-entry undo/redo 410, execution-time locked checks, shared replay leases and dead-claim removal. No local redesign of those contracts.
- **System entry.** The separate operator command/service above is the only entry with `tenantId: null`. Settings are `OM_ACTION_LOG_SYSTEM_VALUES_RETENTION_DAYS` and `OM_ACTION_LOG_SYSTEM_HISTORY_RETENTION_DAYS`, documented in the application and create-app template environment examples. No combined `values,history` setting is introduced.
- All new names and settings are additive; the old set ids and combined setting were unreleased draft names.

## 📝 Edge Cases & Failure Scenarios

| Case | Behaviour |
|---|---|
| An entry already stripped by an erasure | Marked by the same routine, so the values pass skips it; deleted at the history age |
| An entry in the state "undoing" | R3-1: a live replay lease skips it for retry; a dead claim without a lease is stripped/deleted safely, never reclaimed merely by age |
| A tenant with an active subject hold | Both sets are skipped for it and the pass is recorded with reason `hold_not_honourable`, by the engine and by the record-retention command alike |
| The same, with `allowUnmatchedHolds` on the policy | Entries whose resource, parent resource or related resource is a held subject's record are left out; entries that mention the subject only inside a snapshot are processed |
| A note on a held person, logged under the note with the person as parent and a deal as related resource (`customers/commands/comments.ts:132-140`) | Left out under `allowUnmatchedHolds`: the parent pair matches. An entry that names a held record only in its related pair is left out the same way |
| A hold is released | The next day's pass runs for the tenant again |
| A hold on one of the two sets | That set is skipped, as any held set is |
| An entry with no resource kind | Treated as ordinary history, not as evidence |
| An undo claimed while a pass runs | A live executor holds the shared replay lease and is skipped; otherwise the locked strip wins and a preloaded replay refuses before a handler or trace writes |
| Redo loaded before a strip commits | R3-1's execution-time locked check refuses it before the command writes a new log |
| Entries with no tenant and no installation ages | Kept; tenant passes cannot reach them |
| A partial or inverted installation pair | Refuse both system stages before mutation |
| A system run while tenant holds exist | Holds do not map null-tenant history; explicit system apply warns, and unset/preview preserves it |
| A command with no active set policy, or a history window below values | Handler refuses before calling the audit service |
| A large first pass | Batched under the engine's daily limit; a backlog takes several days |
| Sales history for an old order | Empty for stripped entries; the page says older history is no longer kept |

## 📝 Migration & Backward Compatibility

- Two correctly prefixed retention sets, a policy-reader consumer, separate system command/service/job and two settings: additive. The column, index, service method, response fields and the redo change are the erasure spec's, with its migration and compatibility notes.
- Resolved stripped undo/redo entries return 410 after authorization where replay used to succeed; a token already removed keeps ordinary unavailable behavior and undo is no longer offered. Tenant age-based changes require active apply policies. Null-tenant changes require both installation ages plus explicit system apply. The OSS erasure path independently strips entries under its own confirmed request and compatibility rules. R3-1 also closes an in-flight replay race; its owner carries that change.
- The old `audit_logs.change_values`, `audit_logs.change_history` and combined system setting were never shipped; implementations must use the corrected names. No frozen shipped surface is removed. If a downstream prototype shipped them, retain aliases and deprecate for at least one minor with upgrade notes before removal.
- `UPGRADE_NOTES.md` names the table of what stripping ends.

## 📋 Phasing

| Phase | Outcome | Depends on |
|---|---|---|
| Prerequisite | OSS erasure Phase 2: routine, stripped fields, replay checks and reader integration gate | DEC-B and R3-1; no enterprise-only replacement test |
| 1 | Enterprise: prefixed sets, policy/API floors and consequence text, hold rule and direct mappings; separate system pass and schedule | OSS prerequisite; engine Phase 3; coverage Policy access service |

The OSS routine, column/index and readers remain the erasure spec's Phase 2. Before enterprise policies can be enabled, the owner’s **TC-AUD-STRIPPED-OSS-001**, listed in its Phase 2, file manifest and Integration Coverage, must pass. Its `auditRetention.test.ts` and `auditReplayRetentionRace.test.ts` pin the shared lease, locked refresh and conditional strip/delete rule; there is no bare `undoing`-state exemption.

## 📋 Implementation Plan

1. Verify the OSS owner’s Phase 2 `applyRetention.test.ts`, `auditRetention.test.ts`, `auditReplayRetentionRace.test.ts`, `command-bus.history-stripped.test.ts`, audit route tests and `subjectHistoryService.test.ts`: live lease skips in both modes, safe dead-claim removal, locked refresh and conditional state mutations, both preloaded replay races, refreshed payloads and no snapshot traces. Require the owner-listed TC-AUD-STRIPPED-OSS-001 API/UI gate below before enabling enterprise policies. No duplicate OSS routine is defined here.
2. Add `data_erasure.change_values`/`change_history`, handler and policy reader consumer. Unit tests `actionHistoryRetention.test.ts`: module prefix, evidence/no kind, exact scope/cutoff, no-policy command/direct call, preview policy apply refusal, policy version change, history without values, inverted ages, declared direct record pairs and zero pending files. A fixed-cutoff dry run advances keysets across batches. Live replay skips leave the batch incomplete and its retry position cannot advance past them; a later dead-claim pass completes.
3. Policy form and API pair validation, including disable/activate, optimistic conflicts, consequence text and opt-out text. Unit tests `historyPolicyValidation.test.ts`; readers test `dealStageHistoryRetention.test.ts` pins existing fallback behavior before the strip and verifies that stripped fallback stages disappear while stored transitions survive.
4. System service/command/job and the two validated installation ages. Unit tests `systemHistoryRetention.test.ts`: both unset, partial, invalid and inverted; exact null tenant, evidence excluded from generic stages, fixed cursor and limits, duplicate worker lock, strip before delete, failed batch retry and no tenant ledger write. The dedicated evidence stage deletes only validated terminal aggregate system summaries older than 365 days, preserving unresolved, unidentified and tenant rows; it shares the combined bound and emits no copied actor/reference/run id. `systemHistorySchedule.test.ts` asserts separate system registration, default preview, explicit apply, no scheduler and exact service invocation.
5. Hold tests with the shared retention service: default skip; new hold between batches; release permits next run; opt-out matches resource/parent/related and explicit EUDR plot/evidence resource kinds; missing EUDR mapping refuses. Neither a derived identifier nor an unmapped kind is silently treated as matched.
6. TC-AUD-RETENTION-001, TC-AUD-SYSTEM-RETENTION-001 and policy UI coverage; docs and upgrade notes. Verify C8's `tenantExportEvidenceRetention.test.ts` and TC-TENANT-EXPORT-002 cover R4-3: installation default 365 and floor 30, the same set expiring due settled null-tenant groups, recent/unresolved groups preserved, tenant ages never applied to null-tenant rows, aggregate-only evidence and the setting present in both `.env.example` files. The generic system stages must preserve those groups for their owner. Generate discovered module files; keep system schedule changes in the enterprise module.
7. Archive this Delta into `.ai/specs/capabilities/change-history-retention.md` if that directory has been adopted by then.

| File | Action |
|---|---|
| `packages/enterprise/src/modules/data_erasure/{privacy.ts,lib/retention/*,backend/*,api/policies/*,cli.ts,di.ts,workers/*}` | Create / modify |
| `packages/enterprise/src/modules/data_erasure/__integration__/TC-AUD-RETENTION-001.spec.ts` | Create |
| `packages/enterprise/src/modules/data_erasure/__integration__/TC-AUD-SYSTEM-RETENTION-001.spec.ts` | Create |
| `packages/enterprise/src/modules/data_erasure/__tests__/{actionHistoryRetention,historyPolicyValidation,systemHistoryRetention,systemHistorySchedule}.test.ts` | Create |
| `packages/core/src/modules/customers/__tests__/dealStageHistoryRetention.test.ts` | Create reader characterization/regression |
| `packages/core/src/modules/audit_logs/__integration__/TC-AUD-STRIPPED-OSS-001.spec.ts` | OSS erasure-owner prerequisite |
| `apps/mercato/.env.example`, `packages/create-app/template/.env.example`, `UPGRADE_NOTES.md` | Document both system ages and consequences; use template sync |

The audit module's files, the readers and their tests are in the erasure spec's file manifest. The record-retention spec's one-sentence amendment is already made.

## 🧪 Integration Coverage

| Test | Covers |
|---|---|
| TC-AUD-STRIPPED-OSS-001 | OSS-only prerequisite owned by erasure Phase 2. Create own actor, customer, edit actions and a separate redo target; undo the target through `POST /api/audit_logs/audit-logs/actions/undo` so it is the actor's latest undone entry before stripping. Strip through the confirmed erasure/in-process test seam, preserving actor fixtures. `GET /api/audit_logs/audit-logs/actions` returns `strippedAt`, exact `changedFields` and no values/token; a scoped audit-service read proves actor-only context; `POST /api/audit_logs/audit-logs/actions/redo` for that eligible target returns 410. Open version history and CRM change log and assert localized stripped lines without old values. With barriers, preloaded undo/redo cannot replay after strip; both modes leave live leased claimed rows alone; an unleased stale claim from a dead executor is safely strip/delete eligible; finalizers never revive stripped content. Own fixtures and cleanup in `finally`; no enterprise module required. |
| TC-AUD-RETENTION-001 | Enterprise: create own actor, edited records and action entries, then backdate fixtures. No-policy command leaves them untouched; policy API refuses history below values and apply under preview policy. Create the two valid apply policies and run the registered pass. Older history disappears from the list API; middle entry has stripped fields/no values; recent history is unchanged. Redo 410 is tested with a separate actor's latest undone entry, undone before backdating and with no later undone action for that actor. Evidence survives. Own CRM-person and EUDR plot/evidence holds default-skip the tenant; opt-out preserves all three direct pairs including declared EUDR kinds, while another old entry is stripped. UI tests show the consequence text, invalid-window error, optimistic conflict and stripped line; legacy deal fallback loses stripped transitions and a deal with stored transitions keeps them. Query operations for skip/incomplete counts. Cleanup all policies, holds, records and entries in `finally`. |
| TC-AUD-SYSTEM-RETENTION-001 | Enterprise: own null-tenant and two-tenant action entries, ordinary and evidence, backdated in private fixtures. Unset/partial/inverted system ages change nothing. Invoke separate system command and enqueue/drain its registered job with valid ages, first preview then explicit apply; null-tenant ordinary entries strip/delete at the right ages, evidence and both tenants' entries survive. The generic tenant history command never reaches a null-tenant entry. Null-tenant `privacy.tenant_export` groups survive these generic stages; C8's TC-TENANT-EXPORT-002 separately verifies the same dedicated export-evidence set expires them under `OM_PRIVACY_INSTALLATION_EVIDENCE_AGE_DAYS`, default 365/floor 30, preserving recent/unresolved groups and using no tenant age. A separately owned terminal aggregate system summary past 365 days expires through its dedicated stage, while unidentified evidence and unresolved summaries stay. Assert aggregate system evidence, no tenant operations row, bounded continuation and idempotent retry. Restore process settings and remove all fixtures in `finally`. |

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
- **Mitigation**: Both sets preserve the evidence prefixes and C1's exact settings-command operation groups; dedicated owners enforce their own whole-entry expiry and recovery gates. R4-3 gives null-tenant `privacy.tenant_export` groups the installation age `OM_PRIVACY_INSTALLATION_EVIDENCE_AGE_DAYS`, default 365/floor 30, through C8's same dedicated set; generic system history never selects them.
- **Residual risk**: An evidence entry written under an unlisted kind, or a dedicated owner expiry not implemented/configured. The generic exclusion alone gives no finite bound; missing handoffs block program closure.

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
| Changes integrated through real call sites | Compliant | The routine's OSS caller is the erasure strip |
| Integration coverage | Specified | OSS reader/replay prerequisite plus self-contained enterprise policy and system tests |
| R4-3 null-tenant export evidence | Owner contract cited | Same `privacy.tenant_export_evidence` set; installation age default 365/floor 30 in both `.env.example` files, with C8 owner tests; no tenant-setting fallback or generic-history deletion |

**Verdict:** revised design with every assumption decided. Implementation waits for the erasure owner's Phase 2 integration/replay gate, the coverage policy reader and the engine's Phase 3; each PR goes through ordinary maintainer review. No implementation is claimed.

## Changelog

### 2026-11-16
- Written autonomously with resolved assumptions, after the record-retention spec's review removed change history from that spec. It carries that review's corrections: no entry is spared for being the latest undoable one; privacy and export entries are exempt; the deal stage history has its own table and is not a consequence; the capability is placed in Enterprise as the maintainers said.
- Revised after independent review. Undo cannot return a new status for a stripped entry, because it finds entries by the token that stripping clears; this token-path observation is superseded by R3-1 for already resolved undo entries, which now refuse under the execution lock too. The capability is two retention sets with one age each, so the retention-set contract and the engine's policy are unchanged. There is one stripping routine in the audit module, shared with the erasure spec's history strip, which gives it an OSS caller and makes "already stripped" detectable. Field names are computed before values are cleared, the backfill skips stripped entries, and the context is reduced to the actor. A partial index is added. Entries with no kind are no longer skipped by accident. The governance module's own entries join the evidence exemption. The readers' real behaviour with stripped entries is stated.
- Council review (Opus, GPT-5.6 Sol, DeepSeek V4 Flash, Kimi K3.1 Pro), high fixes: g5-09 — `applyRetention` lacked the inputs its erasure caller passes; the routine, `stripped_at`, its index and migration, the list fields and redo's 410 are now owned normatively by the OSS erasure spec, and this spec cites the full signature (organization scope, kinds and records to include or leave out, the three-column matching rule) and only states what its handler passes; the OSS phase and its files moved there. g5-10 — holds were matched on resource and parent resource only and snapshot-only mentions were stripped by default; holds now match on all three record column pairs, both sets declare `excludableSubjectKinds: []`, a tenant with an active subject hold is skipped with `hold_not_honourable`, and the only opt-out is the engine policy's `allowUnmatchedHolds`. Updated assumptions, Delta, edge cases, plan, TC-AUD-RETENTION-001, risks and compliance.

- Council round two fixes (GPT-6.1 Sol workers): r6-16 — policy-required handlers and paired windows in command/API/form; r6-17 — separate bounded system service, command and daily schedule; r6-26 — explicit owner audit resource mappings under opt-out; r6-27 — data_erasure set prefix; r6-36 — R3-1 locked replay prerequisite; r6-44 — legacy deal-stage fallback consequence/test; r6-45 — latest-undone redo fixture; g5-29 — OSS API/UI integration release gate in erasure Phase 2; g5-38 — existing conditional delete rule cited; F-73 — assumption 5; R1 system-window nit — two independent settings.
- Council round two fixes, pass two (GPT-6.1 Sol workers): W02 — consume R3-1 replay leases, locked execution checks and safe dead-claim stripping/deletion, retaining the exact DEC-B signature and enterprise policies; W03 — generic evidence prefixes remain excluded while dedicated owners receive finite expiry/surviving-field rules, defaulted under assumption 9; owner test names, section names, typed policy entry and live-replay retry positions aligned; null-tenant aggregate summaries gain separate finite expiry.
- Council round two fixes, pass three (GPT-6.1 Sol workers): consume C4’s now-named lease/locked-refresh/conditional-mutation tests and OSS gate; preserve live leased claims and safely strip/delete dead unleased claims. Cite both dedicated finite export-evidence sets and their shared aggregate logger, current erasure-evidence expiry, and ordinary configs-owned settings history without changing the generic exclusions.
- Council round two fixes, pass four alignment (GPT-6.1 Sol workers): cite the current settings-command, erasure, tenant-export and governance evidence owners, exact groups, clocks and preservation rules; retain the OSS replay gate and explicit null-tenant expiry gap without defining another contract.
- Council round two fixes, pass five gap closing (GPT-6.1 Sol workers): R4-3 — replace the stale null-tenant tenant-export expiry gap with C8’s installation setting `OM_PRIVACY_INSTALLATION_EVIDENCE_AGE_DAYS`, default 365/floor 30, through the same dedicated set; cite both environment examples and align owner-test gates, scope separation, risks and compliance.
