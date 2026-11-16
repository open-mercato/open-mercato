# Change-history retention

> **Program:** part of package D3 of [`../2026-11-15-gdpr-ready-deployments-program.md`](../2026-11-15-gdpr-ready-deployments-program.md) (tracker open-mercato/open-mercato#8593), split from the record-retention spec. Tracks #2980, where a maintainer placed this capability in Enterprise.
> **Builds on:** [`../2026-11-16-privacy-record-retention.md`](../2026-11-16-privacy-record-retention.md) for retention sets and [`2026-11-16-privacy-dsr-engine.md`](2026-11-16-privacy-dsr-engine.md) for policies and schedules.
> **Verified at** `main` @ `08dada9624` by reading code and the issue; nothing was run.
> **Written autonomously.** No question was put to a person; the choices are listed under Resolved assumptions.

Extends: .ai/specs/2026-11-16-privacy-record-retention.md
Extends: .ai/specs/enterprise/2026-11-16-privacy-dsr-engine.md

## 📝 TLDR

Every change made through the product is recorded with a full copy of the record before and after, and kept forever. That history is what makes undo, version history and the change log work. It is also the largest store of personal data in the system, the only copy of every hard-deleted record, and it has no end. **Proposed (future):** a tenant can set two ages. Past the first, an entry keeps who did what and when, and loses its copies of the data — and with them, undo. Past the second, the entry is deleted. Entries that are themselves evidence of privacy operations and of exports are exempt. The stripping itself is one routine in the audit module, shared with the erasure spec, which needs the same thing for one person's entries.

**Not in this spec:** removing the duplicated undo payload that sales commands store, the other half of #2980, which is an OSS clean-up; the access log; removing one person's entries, which the erasure spec does.

## 📝 Overview

> **Market reference.** Salesforce keeps field history for 18 to 24 months and archives or deletes beyond; Jira and GitLab keep an activity line indefinitely while pruning the heavy payload behind it. Adopted: two stages — keep the line, drop the payload; then drop the line — and a longer life for compliance evidence. Rejected: a single age at which everything goes, which makes an administrator choose between long accountability and short data.

## 📝 Resolved assumptions (autonomous defaults)

| # | Question | Chosen | Rationale |
|---|---|---|---|
| 1 | Edition | Policies, schedules and the retention sets in Enterprise. One routine in OSS `audit_logs` that strips or deletes a selection of entries, which the OSS erasure spec also calls | ⚠ NEEDS HUMAN CONFIRMATION. The maintainer's statement on #2980 says this capability will not be accepted in the open-source edition. The routine has a real OSS caller, by subject; selecting by age is the part that serves only Enterprise. If that is refused, Enterprise has no way to do this without writing to a core table. |
| 2 | Default | Nothing is stripped or deleted until a tenant sets a policy | Deleting undo history on upgrade is not something to do unasked. |
| 3 | Shape | Two retention sets, "change values" and "change history", each with one age | The retention-set contract has one window per set and two fixed targets. Two sets need no change to it or to the engine's policy. |
| 4 | Floors | Values no sooner than 90 days; history no sooner than values | The change log's own ranges go up to 90 days. |
| 5 | Undo | Ends when an entry's values are stripped. No entry is spared for being the latest undoable one | Sparing it would keep exactly the snapshots of records nobody touched again — hard-deleted people above all — which is what retention is for. |
| 6 | Evidence | Entries for privacy operations, exports and the governance module's own actions are in neither set | In OSS these entries are the only record that an erasure, an export, a hold release or a policy change happened, and their reasons are in the part stripping would clear. A third set for them is left for a person to ask for. |
| 7 | Entries with no tenant | Handled by an installation-level setting that the enterprise module reads | They belong to no tenant, and a tenant-scoped run can never reach them. |

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
- **The erasure spec already defines a strip**: clearing the stored records, change set, replay payload and undo token of one subject's entries. No code does it yet.

## 📝 Proposed Solution

### One routine in `audit_logs`

`actionLogService.applyRetention` selects entries — by tenant or "no tenant", by age, by resource kinds to include or leave out, by subjects to include or leave out — and either strips or deletes them, in batches, returning counts and a position.

**Strip**, in this order, for an entry that is not in the middle of an undo:

1. computes the names of changed fields if the entry has none;
2. clears the command payload, the record before and after, the change set and the undo token;
3. reduces the context to the actor it names;
4. sets `stripped_at`.

The update is conditional on the entry's state, so it cannot race an undo that has claimed it. The backfill of changed-field names skips stripped entries.

**Delete** removes the row.

Two callers:

- the erasure spec's history strip, by subject — which thereby marks what it strips;
- the enterprise retention sets below, by age.

### Enterprise

The governance module declares two retention sets whose handler calls that routine:

| Set | What a pass does | Floor |
|---|---|---|
| `audit_logs.change_values` | Strips entries older than the window | 90 days |
| `audit_logs.change_history` | Deletes entries older than the window | 90 days, and not below the first set's window where both have a policy |

Both leave out entries whose resource kind begins with `privacy.` or `data_erasure.`, or is `audit_logs.export`, and include entries with no kind. Both honour subjects to leave out, matched on the entry's resource and parent resource.

An installation-level setting, read by the enterprise module, gives the two ages for entries with no tenant.

The policy form for either set shows, before it can be saved, what stripping ends.

### What stripping ends

| Feature | After an entry is stripped |
|---|---|
| Undo of that action | Not offered: the token is gone, and a stale one is answered as any unknown token is |
| Redo of that action | Refused, with a message that its history is no longer kept |
| Restoring a hard-deleted record | Not possible |
| Version history and the change log | Show that a change was made, by whom, to which fields, and when — not the values. Both screens are changed to build a stripped line from the field names |
| Sales document history | A stripped status change appears as a plain action line, and a filter for status changes no longer finds it |
| Warranty replacement-order check | It reads entries of any age for one order and refuses when it cannot tell. The step bounds it or states the effect |
| Audit page | The line remains, marked as stripped |
| Record-lock conflict notice | Reads the latest entry; unaffected at a 90-day floor |

### Design decisions

| Decision | Rationale |
|---|---|
| Two stages, as two sets | See the market reference and assumption 3. |
| One routine, shared with erasure | Two strips of the same columns in one module would drift, and "already stripped" could not be told. |
| Field names are computed before the values are cleared | They are derived from the values; clearing first destroys their source. |
| The context is reduced, not kept | It can hold a client address or whatever an interceptor put there. |
| Selection by resource kind, in SQL | It is stored in clear and indexed; the command id is not. |
| Stripped entries are marked | Readers can say "values no longer kept" instead of showing an empty change. |

### Alternatives considered

| Alternative | Why rejected |
|---|---|
| An environment variable and a worker in OSS | What #2980 first proposed; refused for OSS. |
| Keep the latest undoable entry per record | See assumption 4. |
| Delete only | Forces a choice between accountability and data. |
| Strip by setting columns to null from Enterprise | A cross-module write. |
| A two-window policy on one set with new target names | Changes the retention-set contract and the engine's policy for one consumer. |

## 📝 Delta

### Capability: change-history-retention

#### ADDED Requirement: Two-stage retention of change history
The system SHALL, under a tenant's policies, remove the stored data from change-history entries older than one age and delete entries older than another, and SHALL do neither without a policy.

##### Scenario: No policy
- WHEN a tenant has set no policy
- THEN no entry is changed

##### Scenario: Stripped
- WHEN an entry is older than the values window
- THEN its stored records, change values, undo token and all of its context but the actor are gone, the names of its changed fields remain, and it is marked

##### Scenario: An entry with no field names yet
- WHEN such an entry is stripped
- THEN the names are computed first and kept

##### Scenario: Deleted
- WHEN an entry is older than the history window
- THEN it is gone

##### Scenario: Evidence
- WHEN an entry records an erasure, an export, a retention pass, a hold release or a policy change
- THEN neither set touches it

##### Scenario: A subject to leave out
- WHEN a held person's entries are older than the window
- THEN entries whose resource or parent resource is that person are untouched

##### Scenario: Below the floor
- WHEN a values window under ninety days is entered
- THEN it is refused

#### MODIFIED Requirement: Redo availability
The system SHALL refuse redo for an action whose entry has been stripped, and SHALL say why.

##### Scenario: Old action
- WHEN a user tries to redo an action whose entry was stripped
- THEN they are told its history is no longer kept

Frozen by: `packages/core/src/modules/audit_logs/__tests__/action-log-undo-availability.characterization.test.ts`

## 📝 Architecture

- **OSS `audit_logs`**: `applyRetention` on the service; `stripped_at`; the backfill skips stripped entries; redo and the list response understand a stripped entry; the list response gains the names of changed fields.
- **OSS readers**: the version-history panel and the CRM change log render a stripped line from those names.
- **OSS erasure**: `subjectHistoryService` calls the same routine, by subject.
- **Enterprise `data_erasure`**: the two retention sets and their handler; the policy forms' consequence text; the installation setting.
- **The record-retention spec** is amended in one sentence: a set's handler touches only its own module's tables *or calls the owning module's service*.

| Touchpoint | Mechanism | Absent |
|---|---|---|
| Enterprise → change history | `actionLogService.applyRetention` by DI key | Audit module disabled: the sets are not offered |
| Policy → schedule | The engine's daily pass | No engine: nothing runs |
| Readers of stripped entries | `strippedAt` and `changedFields` on the entry | — |

## 📝 Data Models

| Table | Change |
|---|---|
| `action_logs` | A nullable `stripped_at` (`timestamptz`); a partial index on tenant and `created_at` for entries not yet stripped |

Additive; the index is created concurrently. The engine's daily pass starts from the beginning each day, and without the partial index the values pass would walk every entry it had already stripped.

## 📝 API Contracts

```ts
applyRetention(input: {
  tenantId: string | null
  olderThan?: Date
  mode: 'strip' | 'delete'
  limit: number
  after?: string
  excludeResourceKindPrefixes?: string[]
  includeSubjects?: PrivacySubjectReference[]     // the erasure caller
  excludeSubjects?: PrivacySubjectReference[]     // holds
  dryRun: boolean
}): Promise<{ matched: number; changed: number; next?: string; done: boolean }>
```

- Action-log list responses gain `strippedAt` and `changedFields`. Redo returns 410 with a code for a stripped entry. Undo is unchanged: a stripped entry has no token to present.
- Setting `OM_ACTION_LOG_SYSTEM_RETENTION_DAYS`, as `values,history`, for entries with no tenant; unset means keep. It is read by the enterprise module and documented with the other enterprise settings, in both `.env.example` files.
- All additive.

## 📝 Edge Cases & Failure Scenarios

| Case | Behaviour |
|---|---|
| An entry already stripped by an erasure | Marked by the same routine, so the values pass skips it; deleted at the history age |
| An entry in the state "undoing" | Left for the next pass |
| A hold on the entry's subject | The engine passes the subject to be left out, matched on the entry's resource and parent resource; an entry that only mentions the person inside another record's snapshot is not matched, and the sets declare that |
| An entry with no resource kind | Treated as ordinary history, not as evidence |
| An undo claimed while a pass runs | The strip's update does not match an entry in that state |
| Entries with no tenant and no installation setting | Kept |
| A large first pass | Batched under the engine's daily limit; a backlog takes several days |
| Sales history for an old order | Empty for stripped entries; the page says older history is no longer kept |

## 📝 Migration & Backward Compatibility

- One nullable column, one index, one service method, two response fields, one setting: additive.
- Redo of a stripped entry returns 410 where it used to succeed, and undo of it is no longer offered. Both happen only after a tenant sets a policy, or after an erasure strips that person's entries.
- `UPGRADE_NOTES.md` names the table of what stripping ends.

## 📋 Phasing

| Phase | Outcome | Depends on |
|---|---|---|
| 1 | The routine, the column and index, readers that understand a stripped entry. Ships with the erasure spec's history strip, its first caller | Erasure spec, Phase 2 |
| 2 | Enterprise: the two sets, their policy text, the installation setting | The engine spec, Phase 3; assumption 1 |

## 📋 Implementation Plan

### Phase 1
1. **Characterize** that an old undo token works and that nothing removes entries. Commit alone.
2. The column, the partial index and migration; `applyRetention` with unit tests: the strip's order and exactly what it clears and keeps; an entry with no field names; an entry mid-undo; delete; kinds left out by prefix and entries with no kind; subjects included and left out; a dry run across batches; entries with no tenant.
3. The backfill skips stripped entries. Unit test, including the forced form.
4. `subjectHistoryService` calls the routine. The erasure spec's own tests cover the result.
5. The list response's two fields; redo for a stripped entry; the version-history panel and the change log. Update the characterization test. Read the warranty check and either bound it or record its behaviour here.

### Phase 2
1. The two retention sets and their handler. Unit tests, with the evidence prefixes.
2. The policy forms' consequence text and floors; the rule that history is not below values.
3. The installation setting and its pass. Unit tests.
4. Integration test TC-AUD-RETENTION-001; docs.
5. Archive this Delta into `.ai/specs/capabilities/change-history-retention.md` if that directory has been adopted by then.

| File | Action |
|---|---|
| `packages/core/src/modules/audit_logs/{data/entities.ts,migrations/*,services/actionLogService.ts,api/audit-logs/actions/**}` | Modify |
| `packages/ui/src/backend/version-history/*`, `packages/core/src/modules/customers/components/detail/ChangelogTab.tsx` | Modify |
| `packages/enterprise/src/modules/data_erasure/{privacy.ts,lib/retention/*,backend/*}` | Create / modify |
| `packages/enterprise/src/modules/data_erasure/__integration__/TC-AUD-RETENTION-001.spec.ts` | Create |
| `.ai/specs/2026-11-16-privacy-record-retention.md`, `.ai/specs/2026-11-16-privacy-subject-erasure.md` | Modify — the two amendments named above |

## 🧪 Integration Coverage

| Test | Covers |
|---|---|
| TC-AUD-RETENTION-001 | In the enterprise environment. A record is created and edited through the API and its entries backdated with a direct query. A policy with both windows is set; the pass is enqueued and drained. The older entry is gone from `GET /api/audit_logs/audit-logs/actions`; the middle one is returned with `strippedAt`, its changed field names and no values, and redo of it returns 410; a recent one is unchanged and still undoes. An erasure entry of the same age is untouched. The step confirms how a test starts the engine's pass; the governance module does not exist yet |

## 📝 Risks & Impact Review

#### History is removed and then needed
- **Scenario**: A tenant sets a short strip age and later must restore a deleted record or show what a field used to be.
- **Severity**: High
- **Affected area**: undo, restore, audits
- **Mitigation**: No default; a 90-day floor; the consequences are shown on the form; the line itself survives until the second age.
- **Residual risk**: Irreversible by design.

#### Evidence is lost
- **Scenario**: Erasure and export entries are deleted with the rest.
- **Severity**: High
- **Affected area**: accountability
- **Mitigation**: They are left out by resource-kind prefix in both sets.
- **Residual risk**: An evidence entry written under a kind outside those prefixes.

#### The OSS routine is refused
- **Scenario**: Maintainers read selection by age in core as the capability they placed in Enterprise.
- **Severity**: High
- **Affected area**: this spec's split
- **Mitigation**: The routine has an OSS caller, the erasure strip; no schedule, command or setting for it exists in OSS. Assumption 1 is marked.
- **Residual risk**: If refused, age-based retention of change history has no home that respects module boundaries.

#### A stripped line shows as an empty change
- **Scenario**: A reader builds its row from the cleared columns.
- **Severity**: Medium
- **Affected area**: version history, the change log, sales history
- **Mitigation**: The list response carries the field names and the mark; the two screens are changed; sales history's behaviour is stated.
- **Residual risk**: A third-party screen that reads the old columns.

#### A hold is not honoured
- **Scenario**: A held person's data sits inside another record's stored snapshot and is stripped.
- **Severity**: Medium
- **Affected area**: legal holds
- **Mitigation**: The sets declare what they can attribute; the engine skips them for a tenant when a hold cannot be honoured that way and the administrator has asked for strict handling.
- **Residual risk**: By default such entries are stripped.

## Final Compliance Report — 2026-11-16

- **Reviewed:** root `AGENTS.md`, `.ai/specs/AGENTS.md`, `BACKWARD_COMPATIBILITY.md`.

| Rule | Status | Notes |
|---|---|---|
| Enterprise scope in the enterprise specs directory | Compliant | The OSS seam is stated |
| No cross-module table access | Compliant | Through the owning module's service |
| Additive schema and API | Compliant | One column, one field |
| Behaviour change documented | Compliant | Redo returns 410 for stripped entries |
| Changes integrated through real call sites | Compliant | The routine's OSS caller is the erasure strip |
| Integration coverage | Compliant | One test |

**Verdict:** design ready; Phase 1 ships with the erasure strip; Phase 2 waits for the engine and for assumption 1.

## Changelog

### 2026-11-16
- Written autonomously with resolved assumptions, after the record-retention spec's review removed change history from that spec. It carries that review's corrections: no entry is spared for being the latest undoable one; privacy and export entries are exempt; the deal stage history has its own table and is not a consequence; the capability is placed in Enterprise as the maintainers said.
- Revised after independent review. Undo cannot return a new status for a stripped entry, because it finds entries by the token that stripping clears; only redo changes. The capability is two retention sets with one age each, so the retention-set contract and the engine's policy are unchanged. There is one stripping routine in the audit module, shared with the erasure spec's history strip, which gives it an OSS caller and makes "already stripped" detectable. Field names are computed before values are cleared, the backfill skips stripped entries, and the context is reduced to the actor. A partial index is added. Entries with no kind are no longer skipped by accident. The governance module's own entries join the evidence exemption. The readers' real behaviour with stripped entries is stated.
