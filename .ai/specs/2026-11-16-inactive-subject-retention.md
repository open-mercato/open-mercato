# Erasing people nobody has dealt with for a long time

> **Program:** part of package D3 of [`2026-11-15-gdpr-ready-deployments-program.md`](2026-11-15-gdpr-ready-deployments-program.md) (tracker open-mercato/open-mercato#8593), split from the record-retention spec.
> **Builds on:** [`2026-11-16-privacy-subject-erasure.md`](2026-11-16-privacy-subject-erasure.md), which does the erasing; [`2026-11-16-privacy-record-retention.md`](2026-11-16-privacy-record-retention.md), whose registry this follows; and the alias and index additions of [`2026-11-16-privacy-coverage-commerce.md`](2026-11-16-privacy-coverage-commerce.md). **Consumed by** [`enterprise/2026-11-16-privacy-dsr-engine.md`](enterprise/2026-11-16-privacy-dsr-engine.md), which schedules it.
> **Verified at** `main` @ `08dada9624` by reading code; nothing was run.
> **Written autonomously.** No question was put to a person; the choices are listed under Resolved assumptions.

Extends: .ai/specs/2026-11-16-privacy-subject-erasure.md
Extends: .ai/specs/2026-11-16-privacy-record-retention.md

## 📝 TLDR

A contact added to the CRM five years ago and never touched since is still there, with everything known about them. So is a portal account that signed in once. Such records should not be kept indefinitely, but the product cannot say which people are inactive: nothing records a person's last activity, and the one timestamp that looks like it is moved by the system for its own reasons. **Proposed (future):** in two parts. First, the CRM keeps a last-activity time for each person — useful on its own as a field people can see and sort by. Second, a module can offer a list of people who look inactive; the list is checked against the module's own records and against what other modules know before anyone is treated as a candidate; and an operator, after previewing exactly who is on it, passes that list to the erase run, which decides per record what is deleted, anonymized or kept.

**Not in this spec:** what erasure does to each record (the erasure and coverage specs); staff users, who are never erased by age; schedules, holds and remembering failures between runs (the enterprise engine).

## 📝 Overview

> **Market reference.** HubSpot and Pipedrive both show a "last activity date" on a contact and let an administrator build a deletion rule on it; both compute it from logged interactions, not from the record's modification time. Adopted: a maintained last-activity time, and a rule on it that a person previews before applying. Rejected: trusting that time alone to decide an erasure.

## 📝 Resolved assumptions (autonomous defaults)

| # | Question | Chosen | Rationale |
|---|---|---|---|
| 1 | What counts as activity for a CRM person | An interaction, activity, comment or task about them; any command that changes them, whoever runs it; a deal they are linked to being changed; and anything another module reports | ⚠ NEEDS HUMAN CONFIRMATION. Each tenant will have its own idea. This is the widest definition the modules can maintain themselves. |
| 2 | How far the stored time is trusted | Only to narrow the search. Each batch is then checked against the person's own interactions, activities, comments, tasks and deal links | Activity is also written without commands — an email linked to a person, a workflow task — and a missed writer makes people look older than they are. A wrong time must cost a lookup, not a person. |
| 3 | Portal users | Age is the last sign-in, or creation if they never signed in. No new column; accepting an invitation is made to count as a sign-in | Nothing in the product renews a session in a way that would make a separate "last seen" worth keeping. |
| 4 | Other modules' knowledge | A module may declare that it can report a subject's latest activity; a candidate with a newer report is dropped | The CRM cannot see orders, claims or conversations, and must not read their tables. |
| 5 | Where retention for people is declared | In the retention registry of the record-retention spec, as a second kind of set, not on the data class | That spec settled that retention is not a property of a data class. |
| 6 | What an operator confirms | The list itself. Preview writes the candidates to a file; applying takes that file and erases only people on it who still qualify | A count or an age does not say who. The list changes from day to day. |
| 7 | A candidate with a related subject | For a portal account: the linked CRM person is left out, as in self-service. For a CRM person with a portal account: the account's sign-ins count as activity; if both are old, the caller chooses, and the default is to skip the pair and count it | Erasing a person and leaving their login, or the reverse, by default would surprise someone. |
| 8 | Floors | 365 days. 30 days for a portal account whose address was never verified | An unverified account holds an address hostage and was never used. |
| 9 | Edition | The time, the listing and a manual command in OSS; schedules in Enterprise | ⚠ NEEDS HUMAN CONFIRMATION, as for the rest of this package. |

## 📝 Problem Statement

- **No last-activity value is stored.** The ones computed are forward-looking (`next_interaction_at`) or built per request for one screen (`customers/api/people/[id]/companies/enriched/route.ts:349`).
- **`updated_at` on a person is not a human signal.** The system moves it when it recomputes the next interaction (`customers/lib/interactionProjection.ts:62-87`), and an edit to the profile alone moves it only conditionally (`customers/commands/people.ts:1046-1053`).
- **Activity is written in three ways**: by commands; by direct ORM from the handler that links an email to a person (`customers/lib/link-channel-message-handler.ts:514-526`) and the one that links a workflow task (`lib/link-workflow-task-handler.ts:118`); and by imports, which call the people commands.
- **Child tables are indexed by the person**: interactions, activities, comments, task links and deal links each have an index that leads with the person. That suits "what is this person's latest activity" and not "who in the tenant has none since a date".
- **Other modules hold activity the CRM cannot see.** Orders and quotes name a person as the customer in one column and as the contact in another, which holds a profile id and has no index; quotes have no customer index at all (`sales/data/entities.ts:329, 356-360, 844-878`). Warranty claims and channel conversations name a person too.
- **Portal users.** `last_login_at` is set on password sign-in and magic-link verification, and not when an invitation is accepted (`customer_accounts/api/login.ts:129`; `api/invitations/accept.ts:70`). No shipped client calls the session-refresh route.
- **The erase run refuses a related subject that was not named**, in both directions, and portal accounts are linked to CRM people automatically.
- **The engine has its own loop**, with holds, back-off for failures, a rule for related subjects, a preference and an origin (`enterprise/2026-11-16-privacy-dsr-engine.md`, "A retention pass"). Whatever filters candidates must be usable from it.
- **A person who was soft-deleted still has their data**; one who was anonymized by an earlier run still exists.

## 📝 Proposed Solution

### Part 1 — Last activity on a CRM person

- `customer_entities` gains `last_activity_at`, set when the person is created and moved forward — never back — by the module's commands and by the two handlers that write without them. The update does not touch `updated_at`, and when one change touches many people, such as a deal with several contacts, they are updated in one statement in a fixed order.
- A one-off command fills it for existing people from the newest of their own and their children's timestamps.
- The people list and detail show it, and the list can sort by it.

### Part 2 — Candidates

**Declaring.** The retention registry gains a second kind of set, for people: an id, the subject kind, a locale key for the sentence that says what "age" means, a minimum, and a handler with one method, `listCandidates`. Given a scope, an age, a limit and a position, it returns subject references and the next position.

- `customers.inactive_people` selects by `last_activity_at`, then checks each batch against the person's interactions, activities, comments, task links and deal links, and drops anyone with something newer — moving their stored time forward as it does. It includes soft-deleted people, by the time they were deleted, and leaves out people already anonymized.
- `customer_accounts.inactive_users` selects by last sign-in, or creation.

**Other modules.** A module may declare an activity source for a subject kind: a function that, given a batch of subjects with their aliases, returns the latest activity it knows for each.

| Source | Reports |
|---|---|
| `sales` | The newest order or quote naming the person as customer or, through the profile alias, as contact |
| `warranty_claims` | The newest claim |
| `communication_channels` | The newest conversation with the person |
| `customer_accounts` | The newest sign-in of a portal account linked to the person |

**One filtered list for every caller.** `privacyRetentionService.listFilteredCandidates` asks the set for a batch, asks every source for that kind, and returns only those with nothing newer. The manual command and the enterprise engine both call it. The engine keeps its own loop around it.

**The manual command.**

`mercato privacy retention-subjects --tenant <id> --set <id> --older-than-days <n> --out <file>` writes the filtered candidates — references only — to a file, with a token over the file's contents, and changes nothing.

`mercato privacy retention-subjects --apply --from <file> --confirm <token> --reference <text> [--related skip|exclude|include] [--max <n>]` checks each listed subject again through the same filter, and passes those that still qualify to the erase run with origin `retention`. Someone who has become active since the preview is dropped. Nobody who was not on the list is touched.

It reports how many were erased, anonymized, retained, refused, skipped as a pair, and dropped as newly active. Skips are not failures.

### Design decisions

| Decision | Rationale |
|---|---|
| The stored time narrows; the module's own records decide | See assumption 2. |
| It only moves forward, and the check repairs it | A late event or a missed writer corrects itself the first time the person is looked at. |
| A portal account's sign-ins are activity for its person | Otherwise a customer who uses the portal and is never touched in the CRM looks inactive. |
| One filter method | The engine and the command must not disagree about who is a candidate. |
| The preview is a file, and the token covers it | See assumption 6. |
| The erase run decides the outcome | A person with invoices is anonymized or kept by the rules of the module that holds them. |

### Alternatives considered

| Alternative | Why rejected |
|---|---|
| `updated_at` | See the problem statement. |
| Trusting the stored time | See assumption 2. |
| No stored time; probe every person each run | A lookup in five tables for every person in the tenant, every day. |
| A "last seen" column on portal users | See assumption 3. |
| A token over the class, the age and a count | It does not say who, and the count changes daily. |
| The CRM reading orders and claims itself | A cross-module table read. |

### Known limits

- Activity in a module that declares no source is invisible. A person with only a signed document looks inactive until the documents module declares one.
- The time filled in for existing people is an estimate.
- The manual command remembers nothing between runs: a person the erase run refused is offered again in the next preview. The engine keeps that memory.

## 📝 Delta

### Capability: inactive-subject-retention

#### ADDED Requirement: Last activity
The system SHALL record when a CRM person was last active, SHALL never move that time backwards, and SHALL NOT move it for the system's own recomputations.

##### Scenario: An interaction
- WHEN an interaction is logged for a person
- THEN the person's last activity is no earlier than that interaction

##### Scenario: A linked email
- WHEN an email is linked to a person without a command
- THEN the last activity moves forward

##### Scenario: A system recomputation
- WHEN the system recomputes a person's next interaction with no other change
- THEN the last activity does not change, and neither does the person's version for concurrent edits

#### ADDED Requirement: Candidates for erasure by age
The system SHALL list as candidates only people whose own records and every declared source show no activity within the given age.

##### Scenario: Stored time is stale
- WHEN a person's stored time is old and they have an interaction from last week
- THEN they are not a candidate, and their stored time is corrected

##### Scenario: Active elsewhere
- WHEN a person has no CRM activity for three years and is the contact on a company's order from last month
- THEN they are not a candidate

##### Scenario: Active in the portal
- WHEN a person's linked portal account signed in last month
- THEN they are not a candidate

##### Scenario: Already anonymized
- WHEN a person was anonymized by an earlier run
- THEN they are not listed

#### ADDED Requirement: Erasure by age, from a reviewed list
The system SHALL erase by age only people named in a previewed list, and only those who still qualify when it is applied.

##### Scenario: Preview
- WHEN the command runs without the apply flag
- THEN it writes the list and a token and changes nothing

##### Scenario: Newly active
- WHEN a person on the list has become active since the preview
- THEN they are not erased, and are counted as dropped

##### Scenario: Changed file
- WHEN the file does not match the token
- THEN nothing is erased

##### Scenario: A linked pair
- WHEN a candidate has a related subject and no choice was given
- THEN the pair is skipped and counted, and the command does not report a failure for it

##### Scenario: Below the floor
- WHEN the age is under the set's minimum
- THEN the command refuses

## 📝 Architecture

- **`customers`**: the column and its index; a forward-only setter called from its commands and the two link handlers; the fill command; the candidate set and its handler; the field on list and detail.
- **`customer_accounts`**: the invitation-accept route sets the sign-in time; the candidate set; an activity source for people.
- **`sales`, `warranty_claims`, `communication_channels`**: one activity source each.
- **`packages/shared/src/modules/privacy.ts`**: the people kind of retention set, and `activitySources`, both members of the default export.
- **`privacy` module**: `listFilteredCandidates` on the retention service; the command.

| Touchpoint | Mechanism | Absent |
|---|---|---|
| Filter → set | The retention registry | Unknown set: reported |
| Filter → other modules | Declared sources, by DI key, given aliases | A module with none contributes nothing; stated as a limit |
| Command → erasure | `privacySubjectService.eraseSubjects` | Erase unavailable for the kind: the list can be written, and applying it erases nobody |
| Engine → filter | The same method | — |

## 📝 Data Models

| Table | Change |
|---|---|
| `customer_entities` | `last_activity_at` (`timestamptz`); an index on tenant and `last_activity_at` |

Additive, with a migration and snapshot; the index is created concurrently. The column is not user-editable and is not the version used for concurrent edits. The indexes the `sales` source needs — on the contact column of orders and quotes and on the customer column of quotes — are added by the commerce coverage spec; until they exist, the `sales` source is not registered.

## 📝 API Contracts

```ts
// members of the default export of privacy.ts
subjectRetentionSets?: Array<{
  id: string; subjectKind: string
  title: string; ageBasis: string        // locale keys
  minimumDays: number; handlerService: string
}>
activitySources?: Array<{ subjectKind: string; service: string }>

// the set's handler
listCandidates(input: { scope: PrivacyScope; olderThanDays: number; limit: number; after?: string })
  : Promise<{ subjects: PrivacySubjectReference[]; next?: string }>

// a source
(input: { scope: PrivacyScope; subjects: Array<PrivacySubjectReference & { aliases?: Record<string, string[]> }> })
  => Promise<Record<string, string | null>>        // ISO time per subject id

// the service
listFilteredCandidates(input: { scope; setId; olderThanDays; limit; after? })
  : Promise<{ subjects: PrivacySubjectReference[]; next?: string }>
```

- CLI as above. Exit 0 when finished, whatever was skipped; 2 when an erasure failed or was incomplete; 1 on a refused age, a bad token or an unknown set.
- The person response gains `lastActivityAt`.
- Audit entry `privacy.retention_run`, as for record retention.
- A token is required here and not for record retention, because this erases people and that prunes rows.

## 📝 Edge Cases & Failure Scenarios

| Case | Behaviour |
|---|---|
| The fill command has not run | Existing people have no stored time and are not selected |
| A person created by an import after the fill | Has a time from creation |
| A source fails | The batch yields no candidates; the run stops and reports |
| A person soft-deleted two years ago | A candidate by the time of deletion |
| A portal account that never verified its address | A candidate after 30 days |
| An invitation never accepted | Not a user; invitations expire and are cleaned by their own worker |
| The erase run retains or anonymizes | Counted as such; an anonymized person is not listed again |
| The erase run refuses, by a hold | Counted; listed again in the next preview |
| The list is a week old | Applied to those who still qualify; the docs recommend a fresh preview |
| A deal with fifty contacts is updated | One statement moves all fifty times, in id order |

## 📝 Migration & Backward Compatibility

Additive: one column, one index, two registry members, a command, a service method, one response field. Accepting an invitation now sets the last sign-in time. Nothing is erased on upgrade, and nothing can be until the fill has run and someone previews and applies a list.

## 📋 Phasing

| Phase | Outcome | Ships alone |
|---|---|---|
| 1 | Last activity on a person: the column, its upkeep, the fill, the field | Yes |
| 2 | Sets, sources, the filter, preview | After the contract's first phase |
| 3 | Apply | After the erasure spec's third phase |

## 📋 Implementation Plan

### Phase 1
1. **Characterize** that a system recomputation changes a person's `updated_at`, and that a linked email changes nothing on the person. Commit alone.
2. The column, index and forward-only setter; its call sites in the commands and the two handlers; creation sets it. Unit tests per source of activity, for the recomputation, and for a deal with many contacts. A test lists the module's commands and requires each to be marked as moving the time or as not concerning a person.
3. The fill command, in batches. The field on list and detail, with sorting.

### Phase 2
1. The registry members and their validation. Unit tests.
2. `customers.inactive_people`, with the re-check and the self-repair. Unit tests: old and truly inactive; old on record and recently active; soft-deleted; anonymized.
3. `customer_accounts`: the invitation fix; `inactive_users`; the source for people. Unit tests.
4. The `sales`, `warranty_claims` and `communication_channels` sources. Unit tests per module, including a contact found through the alias.
5. `listFilteredCandidates`; the command's preview with its file and token. Unit tests with fake sets and sources.

### Phase 3
1. Apply: the token, the re-check, the related-subject choice, the counts. Unit tests.
2. Integration test TC-PRIVACY-INACTIVE-001; docs; `UPGRADE_NOTES.md` with the fill step.
3. Archive this Delta into `.ai/specs/capabilities/inactive-subject-retention.md` if that directory has been adopted by then.

| File | Action |
|---|---|
| `packages/shared/src/modules/privacy.ts` | Modify |
| `packages/core/src/modules/customers/{data/entities.ts,migrations/*,lib/lastActivity.ts,lib/link-channel-message-handler.ts,lib/link-workflow-task-handler.ts,commands/*,cli.ts,privacy.ts,lib/privacy/*,api/people/*}` | Create / modify |
| `packages/core/src/modules/customer_accounts/{api/invitations/accept.ts,privacy.ts,lib/privacy/*}` | Create / modify |
| `privacy.ts` and one function in `sales`, `warranty_claims`, `communication_channels` | Create / modify |
| `packages/core/src/modules/privacy/{cli.ts,lib/retentionService.ts}` | Modify |
| `packages/core/src/modules/privacy/__integration__/TC-PRIVACY-INACTIVE-001.spec.ts` | Create |

## 🧪 Integration Coverage

| Test | Covers |
|---|---|
| TC-PRIVACY-INACTIVE-001 | Four people are created through the API and their stored times backdated with a direct query: one with nothing else; one with an order created today; one with an interaction logged today, whose stored time is left stale; one linked to a portal user. The preview file lists only the first and the fourth. Applying it with the token erases the first; the fourth is counted as a skipped pair; the second and third are still returned by `GET /api/customers/people`, and the third's `lastActivityAt` has moved forward. A changed file is refused. Everything created is removed |

## 📝 Risks & Impact Review

#### An active customer is erased
- **Scenario**: Their activity is in a module that declares no source.
- **Severity**: High
- **Affected area**: customers of that tenant
- **Mitigation**: A 365-day floor; the candidate's own records are re-checked; four sources from the start; the operator reviews the list by name before applying; the erase run still anonymizes or keeps what another module's rules require.
- **Residual risk**: A person erased whom the tenant would have kept. Assumption 1 is marked for that reason.

#### The stored time is wrong
- **Scenario**: A writer that should move it was missed.
- **Severity**: Low
- **Affected area**: how many lookups a run makes
- **Mitigation**: The re-check decides and repairs the time.
- **Residual risk**: None for correctness; some extra work.

#### The edition question moves the command
- **Scenario**: Maintainers place all retention in Enterprise.
- **Severity**: Medium
- **Affected area**: the command and service
- **Mitigation**: The column, sets and sources are in the owning modules either way; Phase 1 has no such dependency.
- **Residual risk**: As stated in the record-retention spec.

#### Extra writes on a hot table
- **Scenario**: Every interaction also updates the person's row.
- **Severity**: Low
- **Affected area**: `customer_entities`
- **Mitigation**: One conditional update that does nothing when the stored time is already later, and does not change the row's version.
- **Residual risk**: Contention under bulk imports of interactions; the import path sets the time once per person.

## Final Compliance Report — 2026-11-16

- **Reviewed:** root `AGENTS.md`, `.ai/specs/AGENTS.md`, `BACKWARD_COMPATIBILITY.md`.

| Rule | Status | Notes |
|---|---|---|
| No cross-module table access | Compliant | Sources are functions of the owning modules, given aliases |
| Additive schema and contract | Compliant | One column; two optional registry members |
| Optimistic locking | Compliant | The new column is not the version and its upkeep does not bump it |
| Tenant scoping | Compliant | Every call takes a scope |
| Edition | Open | See assumption 9 |
| Integration coverage | Compliant | One test |

**Verdict:** Phase 1 approved. Phases 2 and 3 wait on assumption 9, the contract and the erasure spec.

## Changelog

### 2026-11-16
- Written autonomously with resolved assumptions.
- Rewritten after independent review. The stored time is no longer trusted to decide: each batch is checked against the person's own records, because activity is also written without commands and a missed writer would have made people look inactive. The sales source covers a person named as a contact, the common business case the first draft missed. One filter method serves both the manual command and the enterprise engine, which keeps its own loop. The preview is a file of who, and the token covers it; a count said nothing. A portal account's sign-ins count as activity for its person, and a linked pair is skipped by default without being reported as a failure. The portal "last seen" column is dropped in favour of the existing sign-in time. Retention for people is declared in the retention registry, not on the data class. Soft-deleted people and never-verified accounts are covered.
