# Erasing people nobody has dealt with for a long time

> **Program:** part of package D3 of [`2026-11-15-gdpr-ready-deployments-program.md`](2026-11-15-gdpr-ready-deployments-program.md) (tracker open-mercato/open-mercato#8593), split from the record-retention spec.
> **Builds on:** [`2026-11-16-privacy-subject-erasure.md`](2026-11-16-privacy-subject-erasure.md), which does the erasing; [`2026-11-16-privacy-record-retention.md`](2026-11-16-privacy-record-retention.md), whose registry infrastructure this follows; Phase 6 aliases from [`2026-11-16-privacy-data-class-contract.md`](2026-11-16-privacy-data-class-contract.md); and the sales indexes of [`2026-11-16-privacy-coverage-commerce.md`](2026-11-16-privacy-coverage-commerce.md). **Consumed by** [`enterprise/GDPR/2026-11-16-privacy-dsr-engine.md`](../enterprise/GDPR/2026-11-16-privacy-dsr-engine.md), which schedules it.
> **Code baseline checked for this revision:** read-only snapshot `9e09023483`; specifications only, no runtime tests run.
> **Written autonomously.** No question was put to a person; the choices are listed under Resolved assumptions.

Extends: .ai/specs/GDPR/2026-11-16-privacy-subject-erasure.md
Extends: .ai/specs/GDPR/2026-11-16-privacy-record-retention.md

## 📝 TLDR

A contact added to the CRM five years ago and never touched since is still there, with everything known about them. So is a portal account that signed in once. Such records should not be kept indefinitely, but the product cannot say which people are inactive: nothing records a person's last activity, and the one timestamp that looks like it is moved by the system for its own reasons. **Proposed (future):** in two parts. First, the CRM keeps a last-activity time for each person — useful on its own as a field people can see and sort by. Second, a module can offer a list of people who look inactive; the list is checked against the module's own records and against what other modules know before anyone is treated as a candidate; and an operator, after previewing exactly who is on it, passes that list to the erase run, which decides per record what is deleted, anonymized or kept.

**Not in this spec:** what erasure does to each record (the erasure and coverage specs); staff users, who are never erased by age; schedules, holds and remembering failures between runs (the enterprise engine).

## 📝 Overview

> **Market reference.** HubSpot and Pipedrive both show a "last activity date" on a contact and let an administrator build a deletion rule on it; both compute it from logged interactions, not from the record's modification time. Adopted: a maintained last-activity time, and a rule on it that a person previews before applying. Rejected: trusting that time alone to decide an erasure.

## 📝 Resolved assumptions (autonomous defaults)

| # | Question | Chosen | Rationale |
|---|---|---|---|
| 1 | What counts as activity for a CRM person | An interaction, activity, comment or task about them; any command that changes them, whoever runs it; a deal they are linked to being changed; and anything another module reports | This is the widest definition the modules can maintain themselves. A wrong "inactive" erases an active customer and cannot be undone; a wrong "active" keeps a record one more period. Tenants tune retention by the age they pass, never by narrowing what counts. A bulk edit renews everyone it touches, which errs toward keeping. |
| 2 | How far the stored time is trusted | Only to narrow the search. Each batch is then checked against the person's own interactions, activities, comments, task links, deal links and the linked deals' own `updated_at` | Activity is also written without commands — an email linked to a person, a workflow task — and a missed writer makes people look older than they are. A wrong time must cost a lookup, not a person. |
| 3 | Portal users | Age is the later of creation and last sign-in; soft-deleted users also include deletion time. No new column; accepting an invitation is made to count as a sign-in | Nothing in the product renews a session in a way that would make a separate "last seen" worth keeping. |
| 4 | Other modules' knowledge | A module may declare that it can report a subject's latest activity; a candidate with a newer report is dropped | The CRM cannot see orders, claims or conversations, and must not read their tables. |
| 5 | Where retention for people is declared | In the retention registry of the record-retention spec, as a second kind of set, not on the data class | That spec settled that retention is not a property of a data class. |
| 6 | What an operator confirms | The list itself. Preview writes the candidates to a file; applying takes that file and erases only people on it who still qualify | A count or an age does not say who. The list changes from day to day. |
| 7 | A candidate with a related subject | For a portal account: the linked CRM person is left out, as in self-service. For a CRM person with a portal account: the later of the account's creation and last sign-in counts as activity; if both are old, the caller chooses between skipping the pair, the default, and excluding the related subject. No related subject is added to the evaluated list, including under unattended policies | R3-13 — No `related_subjects: include` anywhere is owned by the engine. Manual erasure of both requires two reviewed lists, one per set; the engine evaluates each separately under its own policy. |
| 8 | Floors | `customers.inactive_people` and `customer_accounts.inactive_users`: 365 days. Separate `customer_accounts.unverified_users`: 30 days, only never-verified users | An unverified account holds an address hostage and was never used. |
| 9 | Edition | The time, the listing and a manual command in OSS; schedules in Enterprise | DEC-2 and DEC-2b: the handlers live in the OSS modules that own the data, and the manual command runs beside the OSS erase invoker. Unattended schedules and policies are governance and belong to the enterprise engine (D5). |
| 10 | Activity arrives after the final check | Accept the documented short race after immediate per-subject re-evaluation; no cross-module fence is claimed | The re-check runs immediately before the dry run and again before apply, so the window is one subject's erasure. A person dormant past the set's floor rarely becomes active inside it, and the erase run still keeps what another module's rules require. A fence would make every activity writer in every module take one shared lock, a cross-module coupling the module rules forbid. |
| 11 | Scope of age-based erasure | Tenant-wide for preview, evaluation and apply; reject an organization restriction before any self-repair or erasure | R3-14 — The `eraseSubjects` entry point and the erasure spec's assumption 16 reject `organizationId`. Never remove a caller's restriction to obtain a tenant-wide scope. |

## 📝 Problem Statement

- **No last-activity value is stored.** The ones computed are forward-looking (`next_interaction_at`) or built per request for one screen (`customers/api/people/[id]/companies/enriched/route.ts:349`).
- **`updated_at` on a person is not a human signal.** The system moves it when it recomputes the next interaction (`customers/lib/interactionProjection.ts:62-87`), and an edit to the profile alone moves it only conditionally (`customers/commands/people.ts:1046-1053`).
- **Activity is written in three ways**: by commands; by direct ORM from the handler that links an email to a person (`customers/lib/link-channel-message-handler.ts:514-526`) and the one that links a workflow task (`lib/link-workflow-task-handler.ts:118`); and by imports, which call the people commands.
- **Child tables are indexed by the person**: interactions, activities, comments, task links and deal links each have an index that leads with the person. That suits "what is this person's latest activity" and not "who in the tenant has none since a date".
- **Other modules hold activity the CRM cannot see.** Orders and quotes name a person as the customer in one column and as the contact in another, which holds a profile id and has no index; quotes have no customer index at all (`sales/data/entities.ts:329, 356-360, 844-878`). Warranty claims and channel conversations name a person too.
- **Portal users.** `last_login_at` is set on password sign-in and magic-link verification, and not when an invitation is accepted (`customer_accounts/api/login.ts:129`; `api/invitations/accept.ts:70`). No shipped client calls the session-refresh route.
- **The erase run refuses a related subject that was not named**, in both directions, and portal accounts are linked to CRM people automatically.
- **The engine has its own loop**, with holds, back-off for failures, a rule for related subjects, a preference and an origin (`enterprise/GDPR/2026-11-16-privacy-dsr-engine.md`, "A retention pass"). Whatever filters candidates must be usable from it.
- **A person who was soft-deleted still has their data**; one who was anonymized by an earlier run still exists.

## 📝 Proposed Solution

### Part 1 — Last activity on a CRM person

- `customer_entities` gains `last_activity_at`, set when the person is created and moved forward — never back — by the module's commands and by the two handlers that write without them. The update does not touch `updated_at`, and when one change touches many people, such as a deal with several contacts, they are updated in one statement in a fixed order.
- A one-off command fills it for existing people from the newest of their own and their children's timestamps, including the current `updated_at` of every same-scope deal reached through their deal links, not merely the link time. The command and re-check share `lastActivity.ts` and the same scoped evidence query.
- The people list and detail show it, and the list can sort by it.

### Part 2 — Candidates

**Declaring.** The retention registry gains a second kind of set, for people: an id, the subject kind, a locale key for the sentence that says what "age" means, a minimum, the modules whose activity source it requires, and a handler with `listCandidates` and `evaluateCandidates`. Given a scope, an age, a limit and a position, it returns subject references and the next position. A second `evaluateCandidates` method checks explicitly supplied references without re-enumeration or pagination; apply uses it.

- `customers.inactive_people` selects by `last_activity_at`, then checks each batch against the person's interactions, activities, comments, task links, deal links and the linked deals' own `updated_at`, and drops anyone with something newer — moving their stored time forward as it does. It includes soft-deleted people, by the time they were deleted, and leaves out people already anonymized.
- `customer_accounts.inactive_users` has minimum 365 days and selects only email-verified accounts. `customer_accounts.unverified_users` has minimum 30 days and selects only accounts whose `email_verified_at` is null. Both use the latest of `created_at`, `last_login_at` and, for a deleted account, `deleted_at`. A verification after preview removes it from the unverified set; it cannot fall back to that set's short floor. Both explicitly include soft-deleted accounts, an exception to normal active-user lookup rules. Exclude the erasure owner's `anonymized_at` rows and its deterministic row-id email/hash placeholders (`anonymized-<row id>@anonymized.invalid`, erasure spec, “The three roots” and “Components → Placeholders”); `deleted_at` alone never proves anonymization. Reads use the encryption helpers.

**Other modules.** A module may declare an activity source for a subject kind: a function that, given a batch of subjects with their aliases, returns the latest activity it knows for each.

| Source | Reports |
|---|---|
| `sales` | The newest order or quote naming the person as customer or, through the profile alias, as contact |
| `warranty_claims` | The newest claim |
| `communication_channels` | The newest conversation with the person |
| `customer_accounts` | The later of creation and last sign-in of each linked portal account, also deletion time for a soft-deleted account |
| `forms` | The newest scoped submission `created_at`, `updated_at` or `submitted_at`; direct `subject_type = customer` submissions match the supplied portal-user reference or a `customer_accounts:user` in `linkedSubjects`, and invitations match the root's own `email_hashes` or a linked account's supplied `aliases.email_hashes`; unavailable linkage or incomplete attribution yields unknown, never no activity |
| `cart` | The newest `last_activity_at`/`updated_at` of scoped carts whose customer ids include the person; an active or locked basket blocks candidacy regardless of its age |

**Required sources.** A set names, in `requiredSources`, the modules whose activity source for its kind must be registered whenever that module is enabled. `customers.inactive_people` requires all six above; both portal-account sets require none. For forms, reuse the content-ai coverage handler's subject/alias matching within forms; it must declare complete attribution for the supplied batch before returning no activity. For cart, cover both `customer_id` and `customer_ids`, whose columns the current entity declares, and use the module's own service. Active/locked carts return an explicit block, rather than inventing a future activity time. A required module that is enabled — present in the module registry (`getModules()` in `@open-mercato/shared/lib/modules/registry`) — and declares no source for the kind is a missing source. A required module that is not enabled is a disabled source: its historical records may remain while its source cannot run, so a clean result would be unproven. While any required module is disabled, every entry point — listing, explicit evaluation and erasure, for the manual command and the engine — refuses with `required_source_disabled`, naming the modules, unless the caller supplies an explicit acknowledgement, `acknowledgedDisabledSources`, that names every currently disabled required module. The manual command records it inside the signed preview document, covered by its HMAC; the engine stores it as a validated policy field that is part of the policy settings digest, so changing it returns the policy to preview. An acknowledgement may name only modules in the set's `requiredSources`; naming a module that is enabled has no effect, because its source then runs. A module disabled after the acknowledgement was given, and not named in it, refuses again. Reports always list the acknowledged disabled modules; their activity is never reported as a clean source result.

The contract's “Aliases” names `profile_ids`, `email_hashes`, `phone_hashes` and `identifier_subject_ids`; it supplies no portal-user-id or forms-invitation-id alias for a CRM person. Its Phase 6 “Account-owned portal links for activity” defines `PrivacyLinkedSubject` and `customerAccountUserPrivacyHandler.resolveLinkedPortalSubjects({ scope, subject, after?, limit })`, including the privacy-owned activity-filter handoff. Under R4-12 — `linkedSubjects` in the activity input, the local `activity` input below adopts C1's `linkedSubjects?: readonly PrivacyLinkedSubject[]` on each supplied subject. Privacy verifies the CRM person through its owner and exhausts known keyset pages before invoking forms activity; only an exhausted known result with no links supplies an empty linked-subject list. The root's aliases stay unchanged and each linked account keeps its reference and aliases in its own envelope. Forms matches direct submissions by those supplied linked portal-user ids, including accounts with a different address, and invitation hashes by the root's own aliases or each linked account's aliases. Forms reads only its own tables. Missing, failed, malformed or incomplete linkage yields `status: 'unknown'` and refuses candidate publication/apply; an absent member cannot mean no linked account for a CRM person. An email-hash invitation match alone cannot certify direct submissions by a differently addressed linked account. This activity-only handoff never adds an erasure target or expands a portal export. Phase 2 source coverage and Phase 3 apply remain gated on implementation of C1's handoff and complete attribution; the API/UI activity field can ship independently.

**One filtered list for every caller.** `privacyRetentionService.listFilteredCandidates` first checks the set's required sources. While one is missing it lists nobody and refuses with reason `required_source_missing`, naming the module; while one is disabled and not acknowledged it lists nobody and refuses with `required_source_disabled`. Otherwise it asks the set for a batch, asks every source for that kind, and returns only those with nothing newer. The manual command and the enterprise engine both use the same source checks, evaluation and related-subject execution wrapper below. The engine keeps its policy loop; its related-subject policy follows R3-13 — No `related_subjects: include` anywhere — in `enterprise/GDPR/2026-11-16-privacy-dsr-engine.md`, “A retention pass” and its policy contract. Only skip (default) or exclude is valid at this shared boundary, including unattended subject policies, and a related subject is never added to the evaluated subjects list.

**The manual command.**

`mercato privacy retention-subjects --tenant <id> --set <id> --older-than-days <n> --out <file> [--after <cursor>] [--limit <n>] [--acknowledge-disabled-sources <module,...>]` writes the signed preview document below. `--limit` is an integer 1–1000, default 1000: the aggregate number of candidates one file may hold, not the service page size. The CLI repeatedly calls `listFilteredCandidates` with a page limit of `min(100, remainingFileCapacity)`, carries its opaque cursor and fixed scope/age/source-acknowledgement inputs unchanged, and appends only returned qualified candidates. Empty filtered pages still advance by the service cursor; a non-advancing cursor refuses rather than looping. Stop on source exhaustion or the file cap. Sign the service cursor after the last completely consumed page as the document continuation; never synthesize it from a returned subject or drop an unconsumed page suffix. A failure in any page publishes no partial preview. When more candidates remain, the document carries a signed `continuation`, and the next preview takes it as `--after`; each continuation file is a separately reviewed list with its own token. `--after` is an opaque position bound to the tenant, set and age; a mismatched position refuses. `--acknowledge-disabled-sources` is the explicit acknowledgement described under **Required sources**; it is recorded in the document. It may move stale `last_activity_at` forward through the filter's self-repair; it does not erase or otherwise change records. The artifact contains subject references and minimal qualification timestamps/source ids, all still personal data, but no names or contact details. Operators review ids against their authorized CRM/portal views if they need names; the command does not claim to supply a name-review artifact. Every entry point requires tenant-wide authority and a scope `{ tenantId }`. Reject `--org`, `--organization` or any `organizationId` with `TENANT_WIDE_SCOPE_REQUIRED` before evaluation or self-repair; never discard the restriction and retry. The engine establishes unrestricted authority under R3-9 — Organization-scope guard on every DSR route, in its owning spec; this command adds no route or replacement guard.

`mercato privacy retention-subjects --apply --from <file> --confirm <token> --reference <text> [--related skip|exclude] [--max <n>] [--resume-at <index>]` derives scope, set, age and any disabled-source acknowledgement exclusively from the verified document, not additional overriding flags. Validate the signature and scope before looking up any continuation. Recover outstanding work under “Durable child recovery”; validate expiry before any new candidate evaluation or self-repair. A valid but expired preview can identify its exact already-started child and authorizes no new work. Expiry for new work is checked once, at the start of each apply invocation; a run started before `expiresAt` finishes its list, because every batch is re-evaluated immediately before erasure. Processing walks the signed list in its canonical order from `--resume-at` (default 0, an integer index into that list). `--max` counts candidates for which this invocation attempts an R3-14 dry run; entries that evaluate as `not_found`, `not_qualifying` or `newly_active` are passed over without counting, so a re-run settles nobody twice. When `--max` stops the run it prints `nextIndex`; a later invocation of the same unexpired file with `--resume-at <nextIndex>` continues from its durable checkpoint and reaches the last entry exactly once. A requested CLI scope, if supplied by a common dispatcher, must exactly match the signed scope; conflicting filter flags refuse. Refuse without the lookup secret. Re-evaluate every listed reference in batches of at most 100 through `evaluateCandidates`, never by re-walking the set. Drop newly active or no-longer-qualifying subjects, refuse unknown/missing outcomes, and erase nobody absent from the signed list.

### Signed preview document

The zod-validated JSON document is version 1: `{ version: 1, scope: { tenantId }, setId, olderThanDays, issuedAt, expiresAt, after, limit, continuation, acknowledgedDisabledSources, subjects, evidence }`; the scope object is strict and permits no organization member. `after` and `continuation` are the opaque input and next positions, or null; `acknowledgedDisabledSources` is a sorted, possibly empty array of module ids. Subjects are unique and sorted by kind then id. `evidence` is keyed by that exact reference and contains only qualifying timestamps, source module ids and age basis, never names, addresses or aliases. `expiresAt` is one hour after `issuedAt`. Refuse an inconsistent, oversized (more subjects than its `limit`, over 1,000 subjects or over 32 MiB), duplicate-subject or non-canonical document. A larger result is split into separately reviewed preview files linked by `continuation`; never truncate a file without a signed continuation.

Call `deriveLookupPurposeKey('privacy-erasure-confirmation')` from `@open-mercato/shared/lib/encryption/aes`, exactly as the erasure spec's “The confirmation token” requires. C1 owns the new `deriveLookupPurposeKey(purpose: string): Buffer | null` seam in “A subject that is only an identifier”, under DEC-A — Subjects known only by an identifier (`privacy:identifier`); C4 adds that same export if it lands first. R3-14 owns the service entry point, not the token design. A null key refuses both preview and apply before evaluation or self-repair; never adopt the erasure command's record-only digest fallback. The HMAC-SHA-256 message is canonical JSON of `{ purpose: 'privacy-retention-preview-v1', document }`, covering every field including evidence, scope, set, age and expiry. The confirmation token is `rv1.<expiry>.<base64url-mac>`; validate encoding/length and compare using `crypto.timingSafeEqual`. The domain label prevents accepting an erasure token here. A caller-editable digest is not confirmation. Secret rotation invalidates outstanding previews and requires a new one.

Create the file with exclusive creation (`wx`), mode `0600`; never overwrite or follow a symlink. Reject symlinks, non-regular files, wrong ownership or group/world permission bits on apply; open once and verify/read from that descriptor to avoid replacement between checks. Do not print the document or its subject list to logs. Keep the file on refusal/incomplete runs for diagnosis until expiry; after a complete apply, unlink it. Deletion is not secure erasure on all filesystems; operators must keep the path off shared/synchronized storage and delete expired abandoned files. No claim of names being displayed or securely wiped is made. Retain audit evidence after local file deletion; the file is not an erasure-run store.

### Durable child recovery

Before invoking C4 apply, persist an outstanding child checkpoint linked to the parent retention execution and the exact subject/list index. Use the audit owner's encrypted context for the protected checkpoint, separate from the aggregate report. Bind the checkpoint to the tenant and set, validated selection/preview digest or engine policy execution, origin, original reference, planned exclusions, actor and preference. The checkpoint and its durable progress remain private and follow the parent evidence lifetime. Never write aliases, raw preview contents or subject lists. Use the same parent execution identity on restart: for CLI use the signed selection plus invocation identity saved in an owner-only continuation receipt, and for engine use its durable policy pass identity. Reopening an execution must recover the same receipt/journal identity, including after a crash before the first child result; provide a scoped recovery lookup by verified preview/selection identity for CLI and policy identity for engine. An ambiguous or unavailable lookup refuses new work. Serialize execution claims by parent identity with a process-death-releasing lease; C4 keeps its separate subject lock.

Before eligibility filtering, recomputing related subjects or honoring a requested resume index, recover the original outstanding child through C4's `privacySubjectService.resumeRetentionErasure({ scope, subject, reference, origin, actor }, { mode: 'apply' })`. C4 validates exact tenant, subject, retention origin and reference and reconstructs the immutable intent from its journal. If C4 returns null, no matching started or terminal journal exists: revalidate before starting, or record a terminal no-write skip when it no longer qualifies. If C4 returns incomplete or refuses, retain the checkpoint and stop before advancing to another candidate. If C4 returns verified terminal completion, including the original terminal receipt after a lost caller response, durably settle the checkpoint and then advance the cursor. Before first apply, bind a stable per-child audit reference to the checkpoint (a bounded operation-derived identifier, with the supplied operator reference retained in parent audit only); never regenerate it during recovery. Preserve any returned child run id privately, but recover by immutable intent even if the process stopped before receiving that id. Reopening a settled checkpoint is a no-op. A manually supplied index cannot jump over outstanding work, and a newly expired preview blocks new candidates but permits an authorized, exact outstanding-child recovery from the stored checkpoint. Recovery tests kill each caller after root commit and before final file/capture/event work, then verify the same journal and intent are resumed despite an anonymized root and a changed related closure.

### Per-candidate execution and related subjects

The shared `privacyRetentionService.eraseCandidates` wrapper accepts `related: 'skip' | 'exclude'`, rejecting any other value before evaluation. Both command and engine call it; it enforces the set floor and calls `evaluateCandidates` immediately before each candidate's erasure. R3-14 — The `eraseSubjects` entry point is owned by the erasure spec, API Contracts, “The `eraseSubjects` entry point (R3-14)”. Use its exact `PrivacyErasureOrigin`, `PrivacyActor`, `PrivacyErasurePreference` and `PrivacyErasureRunResult`; do not duplicate or narrow their meaning. For each eligible reference call `privacySubjectService.eraseSubjects({ scope: { tenantId }, subjects: [candidate], excludedRelated: [], prefer, actor, reference, origin, mode: 'dry-run' })`. `origin` is `retention` for the manual command and `engine:retention` for the engine. Keep the validated parent audit-only reference at most 120 characters. C4 receives the stable bounded child reference described under “Durable child recovery”. Match that candidate by kind/id in `PrivacyErasureRunResult.subjects[]` and inspect its `relatedSubjects`, then:

- For a portal-account candidate, exclude the full reported related closure, including the CRM person, as in self-service.
- For a CRM person, skip the pair by default if the dry run reports related subjects. Under exclude, pass the full closure as `excludedRelated`; never add it to `subjects`.
- If exclusions change, repeat dry run with that explicit `excludedRelated` closure. Apply only a valid plan for the same sole candidate and tenant-wide scope; a non-related refusal/incomplete plan never authorizes apply. Call `eraseSubjects` with all the same required fields, the selected exclusions and `mode: 'apply'`. A newly discovered related subject causes refusal and a fresh dry run; it is never silently included.
- Decide completion from that candidate's `subjects[]` entry: `complete` is counted complete only with no pending files and a consistent aggregate `complete: true`; `incomplete` and `refused` are counted separately with their typed sections and optional `refusalCode`; `not_found` is counted as already absent, not an erasure success or error. `runId` may be null and `reportDigest` identifies the canonical report; neither proves subject completion. Missing, duplicate or mismatched subject entries are an invalid result and stop apply/reporting as a failure. Preserve the unmodified typed result; never infer success from an outcome count or invent a second erasure result shape.

For new work, a source re-check immediately precedes the dry run and again immediately before apply. Outstanding child recovery follows its already journaled intent and C4 rechecks current safety guards. Activity can still arrive after the final check; no common cross-module transaction fences all activity writers. This is an accepted low-probability residual risk (assumption 10), stated below, not a claim of atomic inactivity. This spec adds no retention pre-flight fence.

The manual command alone requires an operator-reviewed signed list. The engine evaluates policy candidates without per-person human review, as its owner specifies, but never expands a candidate into an unreviewed related subject under R3-13. Neither path promises that dependent records owned by another person are untouched: R3-1 — The audit-history rule for every erasure in the erasure spec governs their edits and `historyRecords`; DEC-B — The audit-history strip routine remains owned there and is not reimplemented by this wrapper.

Reports count complete, incomplete, refused, not-found, skipped pairs, newly active and unknown separately, plus the erasure sections' deleted/anonymized/retained outcomes. Skips are not failures; unknown evaluation refuses the batch.

### Design decisions

| Decision | Rationale |
|---|---|
| The stored time narrows; the module's own records decide | See assumption 2. |
| It only moves forward, and the check repairs it | A late event or a missed writer corrects itself the first time the person is looked at. |
| A portal account's creation, sign-ins and deletion are activity for its person | Otherwise a customer who uses the portal and is never touched in the CRM looks inactive. |
| Shared list/evaluate/execution paths | Enumeration and explicit-list re-check use the same owning evidence queries and required-source policy; neither caller can include related subjects. |
| The preview is a file, and the token covers it | See assumption 6. |
| The erase run decides the outcome | A person with invoices is anonymized or kept by the rules of the module that holds them. |
| Related subjects are skipped or excluded, never included | A related subject is not on the reviewed list; see assumption 7. |
| A set names the sources it requires | A source that should exist and is not registered would make active people look inactive. The filter refuses instead. |
| A disabled required module refuses unless acknowledged | Disabling a formerly used module hides its activity while its records remain; assumption 1 makes a wrong "inactive" the costly error, so the unattended engine and the manual command both fail closed unless a person explicitly accepts the gap. |

### Alternatives considered

| Alternative | Why rejected |
|---|---|
| `updated_at` | See the problem statement. |
| Trusting the stored time | See assumption 2. |
| No stored time; probe every person each run | A lookup in five tables for every person in the tenant, every day. |
| A "last seen" column on portal users | See assumption 3. |
| A token over the class, the age and a count | It does not say who, and the count changes daily. |
| The CRM reading orders and claims itself | A cross-module table read. |
| `--related include` | It names to the erase run a subject that was never in the preview, never evaluated under its own set and floor, and never reviewed. |
| Registering the `sales` source before its indexes exist | A scan of orders and quotes by an unindexed column for every batch. The filter refuses instead until the indexes are there. |
| A per-tenant activity definition | See assumption 1. Each narrowing is a new way to erase an active customer; tenants choose the age instead. |
| Deferring apply until a retention pre-flight fence exists | See assumption 10. No common transaction spans every activity writer, and a shared lock would couple every module's writers. |

### Known limits

- Activity in a module that declares no source and that no set requires is invisible. Forms and cart are required sources, not omitted core activity. A person with only a signed document looks inactive until the documents module declares one and the set requires it.
- Disabling a formerly used required module hides its activity source while records may remain. Every entry point refuses with `required_source_disabled` until the module is re-enabled or an operator records an explicit acknowledgement naming it (in the signed preview, or as an engine policy field). Once acknowledged, activity in that module is invisible and reports name it; this design does not certify its tables empty.
- The time filled in for existing people is an estimate.
- The preview has no names; review by UUID may fail to reveal a business relationship. Operators may resolve ids in authorized views.
- A final-check/activity-write race remains across modules; assumption 10 accepts it.
- R4-12 adopts C1 Phase 6's CRM-to-portal linkage through the per-subject `linkedSubjects` activity input. Until that handoff is implemented and linkage is complete, unknown attribution refuses the batch rather than certifying inactivity.
- Scheduled policies have no per-candidate human review; the engine owns that risk and its review controls.
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
- THEN last activity does not change; the new last-activity setter itself never changes `updated_at`, while the existing projection still changes the person's version as today

#### ADDED Requirement: Candidates for erasure by age
The system SHALL list as candidates only people whose own records and every declared source show no activity within the given age, and SHALL list nobody while a source the set requires is missing for an enabled module.

##### Scenario: A required source is missing
- WHEN the `sales` module is enabled and declares no activity source for people
- THEN the filter lists nobody for `customers.inactive_people`, and refuses with reason `required_source_missing`, naming `sales`

##### Scenario: A required module is not enabled
- WHEN `warranty_claims` is not enabled and no acknowledgement names it
- THEN the filter lists nobody and preview, apply and the engine pass refuse with `required_source_disabled`, naming `warranty_claims`

##### Scenario: A disabled required module, acknowledged
- WHEN `warranty_claims` is not enabled and the signed preview, or the engine policy, acknowledges it
- THEN the filter runs without its source and every report names `warranty_claims` as acknowledged-disabled; a different required module disabled later, and not acknowledged, refuses again

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
The manual command SHALL erase by age only subjects named in its signed preview, re-evaluated immediately before apply. Both manual and engine execution SHALL reject include, and SHALL erase only explicitly eligible candidates, never an implicitly related subject. A final-check/activity-write race remains documented.

##### Scenario: Preview
- WHEN the command runs without the apply flag
- THEN it writes the protected list and keyed token, may repair stale last activity forward, and performs no erasure or other mutations

##### Scenario: Newly active
- WHEN a person on the list has become active since the preview
- THEN they are not erased, and are counted as dropped

##### Scenario: Changed file
- WHEN the file does not match the token
- THEN nothing is erased; changed scope, set, age, list, expiry or evidence and a forged token also refuse before self-repair; a valid but expired preview authorizes no new candidate and can only resume its original started child

##### Scenario: A linked pair
- WHEN a CRM-person candidate has a related subject and no choice was given
- THEN the pair is skipped and counted, and the command does not report a failure for it

##### Scenario: The related subject is excluded
- WHEN a candidate has a related subject that is not on the list, and `--related exclude` is given
- THEN only the candidate is an erasure target; the related subject is excluded, with any collateral record/history edits governed by R3-1

##### Scenario: No subject outside the list
- WHEN apply runs with any choice for related subjects
- THEN no outside subject is added as an erasure target; related inclusion is refused by the shared wrapper for command and engine callers, and collateral record edits follow R3-1

##### Scenario: Below the floor
- WHEN the age is under the set's minimum
- THEN the command refuses

##### Scenario: A list larger than one file
- WHEN more candidates qualify than the preview `--limit`
- THEN the file holds `--limit` subjects and a signed continuation, and a second preview with `--after` writes the next separately confirmed file

##### Scenario: Capped applies
- WHEN apply runs with `--max` and stops early
- THEN it prints `nextIndex`, and repeated invocations of the unexpired file with `--resume-at` reach the last entry exactly once, attempting no candidate twice

## 📝 Architecture

- **`customers`**: the column and its index; a forward-only setter called from its commands and the two link handlers; the fill command; the candidate set and its handler; the field on list and detail.
- **`customer_accounts`**: the invitation-accept route sets the sign-in time; the candidate set; an activity source for people.
- **`sales`, `warranty_claims`, `communication_channels`, `forms`, `cart`**: one scoped activity source each; module services own all table reads.
- **`packages/shared/src/modules/privacy.ts`**: the people kind of retention set, and `activitySources`, both members of the default export.
- **`privacy` module**: shared list/evaluate/execution methods, zod preview schema, HMAC verification and protected file handling; the command. R3-2 — The registry carries the whole `privacy.ts` default export in the contract spec owns loading the whole object; these are optional members of that object, not new generator work. The record-retention spec's `retentionSets`/`pruneRecords` contract remains separate from these `subjectRetentionSets`/candidate handlers.

| Touchpoint | Mechanism | Absent |
|---|---|---|
| Filter → set | The retention registry | Unknown set: reported |
| Filter → other modules | Declared sources, by DI key, given the root's aliases and C1's per-subject `linkedSubjects` envelope | A module the set requires, enabled with no source: the filter refuses. Any other module with none contributes nothing; stated as a limit |
| Command → erasure | `privacySubjectService.eraseSubjects` | Erase unavailable for the kind: the list can be written, and applying it erases nobody |
| Engine → filter/execution | The same evaluation and skip/exclude wrapper; R3-13 in the engine spec | No implicit related target, no per-person human-review claim |

## 📝 Data Models

| Table | Change |
|---|---|
| `customer_entities` | `last_activity_at` (`timestamptz`); an index on tenant and `last_activity_at` |

Additive, with a migration and snapshot; the index is created concurrently. The column is not user-editable and is not the version used for concurrent edits. The indexes the `sales` source needs — on the contact column of orders and quotes and on the customer column of quotes — are added by Phase 1 of the commerce coverage spec. The `sales` source is registered only once they exist. Until then `sales` is a required module with no source, so the filter refuses for `customers.inactive_people` wherever `sales` is enabled, and Apply does not ship (see Phasing).

## 📝 API Contracts

```ts
// Optional members of the privacy.ts default export; R3-2 owns the envelope; this spec owns the member collectors.
subjectRetentionSets?: Array<{
  id: string
  subjectKind: string
  title: string
  ageBasis: string
  minimumDays: number
  handlerService: string
  requiredSources?: string[]
}>
activitySources?: Array<{ subjectKind: string; service: string }>

type CandidateInput = {
  scope: PrivacyScope
  setId: string
  olderThanDays: number
  acknowledgedDisabledSources?: readonly string[]   // subset of the set's requiredSources
}
type CandidateEvaluation = {
  subject: PrivacySubjectReference
  status: 'eligible' | 'newly_active' | 'not_qualifying' | 'not_found' | 'unknown'
  source?: string
  lastActivityAt?: string
  reason?: string
}
// The set handler: both methods use the same owning evidence query.
listCandidates(input: CandidateInput & { limit: number; after?: string }):
  Promise<{ subjects: PrivacySubjectReference[]; next?: string }>
evaluateCandidates(input: CandidateInput & { subjects: readonly PrivacySubjectReference[] }):
  Promise<{ outcomes: CandidateEvaluation[] }>

// Activity source: exactly one result per requested reference.
activity(input: {
  scope: PrivacyScope
  subjects: ReadonlyArray<PrivacySubjectReference & {
    aliases?: PrivacySubjectAliases
    linkedSubjects?: readonly PrivacyLinkedSubject[]
  }>
}): Promise<Array<{
  subject: PrivacySubjectReference
  status: 'known' | 'unknown'
  latestAt: string | null
  blocksRetention?: boolean
}>>

// Retention service, shared by the command and engine.
listFilteredCandidates(input: CandidateInput & { limit: number; after?: string }):
  Promise<{ subjects: PrivacySubjectReference[]; next?: string }>
evaluateCandidates(input: CandidateInput & { subjects: readonly PrivacySubjectReference[] }):
  Promise<{ outcomes: CandidateEvaluation[] }>
eraseCandidates(input: CandidateInput & {
  subjects: readonly PrivacySubjectReference[]
  related: 'skip' | 'exclude'
  prefer: PrivacyErasurePreference
  actor: PrivacyActor
  reference: string
  origin: 'retention' | 'engine:retention'
}): Promise<PrivacyRetentionExecutionReport>
```

`PrivacyScope`, `PrivacySubjectReference`, readonly `PrivacySubjectAliases` and `PrivacyLinkedSubject` are imported from C1's shared contract in `packages/shared/src/modules/privacy.ts`; `PrivacyLinkedSubject` keeps exactly its owner-defined `{ subject: PrivacySubjectReference; aliases: PrivacySubjectAliases }` envelope. The erasure types and results are those of R3-14. `PrivacyRetentionExecutionReport` contains the counters specified above and the unmodified `PrivacyErasureRunResult[]`; it is not a substitute for that erasure contract. All inputs have zod schemas, unknown set/kind pairs and age below minimum refuse, and service page/evaluation limits are 1–100. The CLI’s separate 1–1000 file cap is implemented by bounded page aggregation, never passed through as a service limit. Validate linked references and aliases by C1's owner rules; missing, foreign, malformed or incomplete linkage cannot become a known no-match.

The service rejects any `CandidateInput.scope.organizationId` before enumeration, explicit evaluation, self-repair or erasure, and never derives a broader scope from it. It checks required modules next. Missing sources refuse with `{ reason: 'required_source_missing', modules: string[] }`; disabled required modules not named in `acknowledgedDisabledSources` refuse with `{ reason: 'required_source_disabled', modules: string[] }`; an acknowledgement naming a module outside `requiredSources` is invalid input. Each supplied reference must have exactly one outcome from the owning set and every source. Missing/duplicate/unknown results or thrown errors fail closed, never null-as-no-activity. Enumeration stops without publishing a partial preview on a source failure; apply reports unknown and refuses that batch. `evaluateCandidates` is limited to the supplied references, so recently active subjects cannot vanish because of a page boundary.

- Preview schema, token and file rules are specified in “Signed preview document”; apply obtains scope/set/age and the acknowledgement from it. `--max` counts attempted dry runs, may stop processing early and prints `nextIndex`; `--resume-at` continues from an index into the signed list. Neither can enlarge the signed target set or bypass re-checks; an incomplete file is kept and expires normally.
- CLI exit 0 for finished/skipped/newly-active/not-found results, 2 for incomplete/failed erasure, 1 for refused age/token/scope, unknown evaluation, missing or unacknowledged disabled source, or related include.
- List and detail person responses gain nullable `lastActivityAt`. In the people list route add the physical `last_activity_at` column to the CRUD `list.fields` allowlist and map `sortFieldMap.lastActivityAt` to that column. The normal HybridQueryEngine resolves ordinary fields and sorts against their base columns in `query_index/lib/engine.ts`. The API serializer reads the selected column and returns ISO UTC or null. Detail reads the same field from the scoped customer entity. Add both fields to the runtime and OpenAPI response schemas. Keep pagination and the existing stable sort tie-breaker. Do not serialize or sort from the possibly absent or stale `entity_indexes.doc` value. No new fulltext or vector attribute is required. UI list/detail use existing components and translated labels. Add `lastActivityAt` field-by-field to `customers.people` subject export in its handler; never spread the entity.
- `privacy.retention_run` audit uses a fresh retention-run UUID for a new execution, reused on every continuation as its resource id, separate from every child R3-14 erasure `runId`. It records scope, set, age, mode and aggregate counters, plus `status: 'running' | 'complete' | 'stopped' | 'incomplete' | 'refused'`, `terminal: boolean`, `requiredSideEffects: 'complete' | 'pending' | 'failed'`, `filesPending: number` and `continuationPending: boolean`. Compute these from the actual per-subject results and required history/file/cache/event work, never from a zero remaining candidate count. Running/incomplete work, pending files, failed/pending required effects or a continuation of committed unfinished work is unresolved and never terminal. An intentionally capped invocation may be stopped and terminal only when all work it began is settled; the unprocessed signed list is not proof of pending writes or of completed erasure. Missing/invalid completion metadata is unresolved. No preview subjects, evidence, aliases or free-text reference enter events. The erasure audit retains the reference under R3-14.

### Registry validation

The shared privacy module owns `getSubjectRetentionSets(modules)` and `getPrivacyActivitySources(modules)` under R3-2. Validate both optional members once per declaration with strict Zod schemas. A subject set requires a module-qualified id owned by its declaring module, a discovered record subject kind, nonempty translation keys and local DI handler key, an integer minimum of at least one day, and distinct valid required module ids. Reject duplicate set ids globally. A source requires a discovered subject kind and a local nonempty DI service key. Stamp the declaring module id at collection and reject duplicate registrations for its subject kind while allowing distinct modules to report that kind. Do not instantiate services or read the database during collection. Invalid or ambiguous declarations refuse list, evaluation and apply with bounded `retention_registry_invalid` metadata before any source or write is invoked. At runtime the set service must implement both candidate methods and each source must implement the documented activity method; fail closed on missing or incompatible registration, with `required_source_missing` for missing required providers and `retention_registry_invalid` for incompatible ones. Tests cover invalid shapes and keys, duplicate ids and sources, valid distinct owners, missing services and malformed method registrations.

### Retention-run evidence

The record-retention spec's “Retention-run evidence” owns expiry of these `privacy.retention_run` entries, through `privacy.retention_evidence` and `retention.privacy.retentionEvidenceAgeDays` (R3-3 — Tenant privacy settings live in `module_configs`): default 365 days, floor 30, as that owner's assumption 9 settles, extended by holds and unresolved work. This spec does not declare a second setting, set or expiry policy. Subject-set, activity-source, `evaluateCandidates` and `eraseCandidates` contracts remain owned here.

Only settled terminal evidence can expire. The evidence owner excludes unresolved retention runs and pending file/cache/required-side-effect work using the exact resource pair `{ resourceKind: 'privacy.retention_run', resourceId: retentionRunId }`, never a child erasure id or a bare UUID exclusion. Preserve that identity across every entry for the same invocation. The audit owner's `actionLogService.list` supplies the aggregate completion metadata above; unknown/unavailable completion refuses evidence expiry rather than guessing success. Dedicated expiry removes the full due entry, including actor/reference/context, through DEC-B — The audit-history strip routine. Its separate summary contains aggregate counts, dates and set id only: no subjects, preview contents, retention/erasure run ids, actor or reference. Active holds or explicit exclusions postpone expiry under the record-retention owner's rules. A missing scheduled command/engine policy or unresolved work means the finite target is not yet enforced; generic history's `privacy.` exclusion is no indefinite exemption.

## 📝 Edge Cases & Failure Scenarios

| Case | Behaviour |
|---|---|
| The fill command has not run | Existing people have no stored time and are not selected |
| A person created by an import after the fill | Has a time from creation |
| A source fails | The batch yields no candidates; the run stops and reports |
| A required source is missing for an enabled module | Nobody is listed; preview and apply refuse with `required_source_missing` and the module's id |
| A required module is disabled | Nobody is listed and nobody erased; preview, apply and the engine refuse with `required_source_disabled` unless the signed preview or the policy acknowledges that module |
| A required module is disabled between an acknowledged preview and apply, and not named | Apply refuses with `required_source_disabled` before evaluation |
| A related subject under `exclude` | Named as excluded, never an erasure target; collateral record/history edits follow R3-1 |
| A person soft-deleted two years ago | A candidate by the time of deletion |
| A portal account that never verified its address | Only unverified_users at 30 days; inactive_users rejects it; verification moves it to the 365-day set |
| A soft-deleted portal account | Latest creation/login/deletion defines age, even though ordinary email lookups filter deletedAt null; anonymized placeholder accounts never qualify |
| An invitation never accepted | Not a user; invitations expire and are cleaned by their own worker |
| The erase run retains or anonymizes | Counted as such; an anonymized person is not listed again |
| The erase run refuses, by a hold | Counted; listed again in the next preview |
| Preview is more than one hour old | A new selection or further candidate refuses as expired. An authorized exact continuation can settle an already-started child without authorizing new work. Create a fresh preview for further candidates. An invocation that started in time finishes its list |
| More candidates than one file's limit | The file ends with a signed continuation; the next preview starts there with `--after` |
| Preview has another scope/set/age or was edited | Refused before any self-repair or erasure |
| A linked deal was edited last month but its link is old | Re-check and fill use the deal updated_at; person is active |
| Activity arrives after final re-check | Remaining race is an accepted residual risk (assumption 10); no cross-module fence is claimed |
| A deal with fifty contacts is updated | One statement moves all fifty times, in id order |

## 📝 Migration & Backward Compatibility

Additive: one column, one index, two registry members (the people set carries an optional `requiredSources`), a command, shared list/evaluate/execution service methods, one response field and the same field in the explicit subject export. Accepting an invitation now sets the last sign-in time. Nothing is erased on upgrade. The manual command needs a completed fill and signed preview/apply. Engine scheduling follows its own authorized policy flow under R3-13; it uses the same evaluation and cannot include related subjects. New last-activity upkeep never changes optimistic-lock versions; the existing projection's version bump is preserved, not removed. The signed preview is a protected artifact that expires in an hour; its continuation and acknowledgement members, the `--after`/`--limit`/`--acknowledge-disabled-sources`/`--resume-at` flags and the `required_source_disabled` reason are part of the unreleased version 1 contract. Upgrade notes name both portal sets/floors, explicit soft-deleted inclusion and the remaining race/undeclared-source limits.

## 📋 Phasing

| Phase | Outcome | Ships alone |
|---|---|---|
| 1 | Last activity on a person: the column, its upkeep, the fill, the field | Yes |
| 2 | Sets, sources, the filter, preview | Contract Phase 1 supplies R3-2 discovery; source matching also requires contract Phase 6 aliases and the content-ai Phase 1 forms matching/linkage handoff. The `sales` source follows commerce Phase 1 indexes; until complete sources exist the filter refuses for affected enabled modules |
| 3 | Apply | After erasure Phase 4/R3-14, commerce Phase 1, the `sales` source and complete forms attribution; no missing source/linkage is bypassed |

## 📋 Implementation Plan

Preview acceptance tests cover 100, 101, 1000 and 1001 qualifying candidates, filtered-empty pages, a source failure after page one and a non-advancing cursor. Assert every service call is at most 100, no partial artifact on failure, and the signed continuation resumes without skipped or repeated candidates.

### Phase 1
1. **Characterize** that a system recomputation changes a person's `updated_at`, and that a linked email changes nothing on the person. Commit alone.
2. The column, index and forward-only setter; its call sites in the commands and the two handlers; creation sets it. Unit tests in `lastActivity.test.ts` per writer, for a stale deal link with a recent linked-deal edit in both fill/re-check, for recomputation preserving activity while retaining today's projection version bump, for setter-only writes preserving the version, and for a deal with many contacts. A test lists the module's commands and requires each to be marked as moving the time or as not concerning a person.
3. The fill command, in batches. Wire the base-column list selection and sort mapping, the list/detail serializers and response schemas, with both indexed and fallback query paths. Ship TC-CUSTOMERS-LAST-ACTIVITY-001 in this phase; Phase 1 cannot ship API/UI changes with unit coverage only. The additive explicit export field and its assertion ship when the contract's planned `customers.people` handler/export path exists (contract Phases 3–4), in the same change as that field; they do not block standalone activity API/UI delivery.

### Phase 2
1. The registry members and their validation, including `requiredSources`. Unit tests.
2. `customers.inactive_people`, with the re-check and the self-repair. Unit tests: old and truly inactive; old on record and recently active; soft-deleted; anonymized.
3. `customer_accounts`: the invitation fix; separate `inactive_users` and `unverified_users`; the source for people using max creation/login/deletion. `inactive-users.test.ts` tests both floors at the boundary, verification after preview, soft-deleted rows and anonymized exclusions. Ship an invitation-accept API integration assertion in this phase.
4. The `warranty_claims`, `communication_channels`, `forms` and `cart` sources; the `sales` source once the commerce coverage spec's Phase 1 indexes exist. Contract Phase 6 provides the declared aliases and its “Account-owned portal links for activity” seam; content-ai Phase 1 provides forms' invitation-hash matching. Implement the R4-12 per-subject `linkedSubjects` input and exhausted owner-page handoff before claiming complete direct-submission attribution. Unit tests per module in `privacy-activity.test.ts`, including contact aliases, recent form-only activity, an open-cart-only subject, unknown form attribution, a recent direct submission by a linked portal account with a different address and a new portal account that never signed in. Assert root-alias preservation, linked-account invitation matching, complete empty links, multiple pages, soft-deleted linked accounts, tenant/organization negatives and unknown/refusal for absent, failed, malformed or incomplete linkage; linked subjects never enter the erasure target list. Ship TC-PRIVACY-INACTIVE-SOURCES-001 for these real database paths in this phase.
5. `listFilteredCandidates` and explicit `evaluateCandidates`, with the required-source check before either path; preview with protected file, keyed token, `--after`/`--limit` continuation and the disabled-source acknowledgement. Unit tests with fake sets and sources, including: a required module enabled with no source refuses and lists nobody; a required module not enabled refuses with `required_source_disabled` and lists nobody; the same with an acknowledgement lists candidates and reports the module; an acknowledgement naming a non-required module is rejected; recent activity existing only in a disabled required module never makes that person a candidate without an acknowledgement; omissions/duplicates/source failures yield unknown and never eligibility. Multi-file preview: a result larger than `--limit` writes a signed continuation and the next file starts after it without overlap. `retention-preview.test.ts` covers edited subjects/evidence/continuation/acknowledgement, other tenant/org/set/age, expiry, malformed MAC, no secret, rotation, exclusive creation, symlinks, owner-only permissions and the 1,000-subject cap. Preview/self-repair behaviour is pinned in `inactive-people.test.ts`.

### Phase 3
1. Apply and the shared `eraseCandidates` wrapper: token validation before self-repair, explicit-subject re-check, exact R3-14 dry-run/apply flow and closure detection, the related-subject choice (`skip` or `exclude`), the counts. Unit tests, including: a related subject absent from the file is never added as an erasure target under either choice, while collateral edits follow R3-1; `include` is a usage error; a missing required source refuses apply; a required module disabled after an acknowledged preview, and not named in it, refuses apply; repeated `--max` applies with `--resume-at` reach the last entry exactly once, and a re-run from index 0 attempts no settled subject again; expiry is checked only at invocation start. `retention-apply.test.ts` asserts all required R3-14 input fields, `{ tenantId }` scope, manual/engine origins, every typed subject status, null run id, pending files, malformed/missing subject results and refusal/count semantics; dry-run closure excluded in full, newly discovered related subject refused, unknown outcomes fail closed, no cross-list targets, complete-file cleanup and expired/incomplete file handling. Organization-restricted command, signed-file and in-process inputs refuse before any self-repair or erasure; engine-shaped callers also reject include under R3-13.
2. Integration test TC-PRIVACY-INACTIVE-001; docs; `UPGRADE_NOTES.md` with the fill step. Extend `retention-apply.test.ts` with terminal versus unresolved audit metadata, child-run versus retention-run identity, pending effects/files and aggregate-only expiry summaries. Coordinate the subject-command evidence fixture in the record-retention spec's TC-PRIVACY-RETENTION-003; expiry runs there through its owner set, not a new subject-retention cleanup loop.
3. Archive this Delta into `.ai/specs/capabilities/inactive-subject-retention.md` if that directory has been adopted by then.

| File | Action |
|---|---|
| `packages/shared/src/modules/privacy.ts` | Modify |
| `packages/core/src/modules/customers/{data/entities.ts,migrations/*,lib/lastActivity.ts,lib/link-channel-message-handler.ts,lib/link-workflow-task-handler.ts,commands/*,cli.ts,privacy.ts,lib/privacy/*,api/people/*}` | Create / modify |
| `packages/core/src/modules/customer_accounts/{api/invitations/accept.ts,privacy.ts,lib/privacy/*}` | Create / modify |
| `privacy.ts` and one function in `sales`, `warranty_claims`, `communication_channels`, `forms`, `cart` | Create / modify |
| `packages/core/src/modules/privacy/{cli.ts,data/validators.ts,lib/retentionService.ts,lib/retentionPreview.ts}` and unit tests | Modify / create |
| `packages/core/src/modules/customers/backend/customers/people/{page.tsx,[id]/page.tsx}` and locales | Modify — translated field, existing DataTable/detail components |
| `packages/core/src/modules/customers/lib/privacy/*` | Modify — explicit lastActivityAt export field |
| `packages/core/src/modules/customers/__integration__/TC-CUSTOMERS-LAST-ACTIVITY-001.spec.ts` | Create — Phase 1 API/UI; extend with export assertion when that handler lands |
| `packages/core/src/modules/privacy/__integration__/TC-PRIVACY-INACTIVE-SOURCES-001.spec.ts` | Create — Phase 2 sources, sets and invitation acceptance |
| `packages/core/src/modules/privacy/__integration__/TC-PRIVACY-INACTIVE-001.spec.ts` | Create |

## 🧪 Integration Coverage

| Test | Covers |
|---|---|
| TC-CUSTOMERS-LAST-ACTIVITY-001 | Phase 1: create own person through API, log an interaction through its API and link an email through the module's real link path; list/detail lastActivityAt moves forward, next-interaction recomputation leaves activity unchanged, setter-only upkeep keeps updatedAt and projection retains existing version bump; GET people sorts it through the exact list API with two distinct timestamps and a tie across paginated results. Assert the normal query engine and fallback read and sort from the physical column while the index projection omits the field or contains a stale value. The list/detail UI displays a translated date; when the contract export handler exists, the same field's shipping change adds and tests explicit customers.people export inclusion |
| TC-PRIVACY-INACTIVE-SOURCES-001 | Phase 2: own recent form-only and cart-only activity prevent candidacy; C1 Phase 6's exhausted owner handoff supplies `linkedSubjects` per person, including multiple pages and soft-deleted links; a differently addressed linked portal account's recent direct submission blocks CRM candidacy; root and linked-account invitation hashes both match without alias merging; complete empty links are known, while absent, failed, malformed, foreign or incomplete linkage yields unknown/refusal, never no activity; linked subjects do not expand erasure targets; new never-signed-in portal account blocks its CRM person; with an injected registry in which a required module is disabled, a person active only in that module is not listed and the filter refuses `required_source_disabled`, while an acknowledgement lists others and names the module; both portal floors at 29/30/364/365 days; soft-deleted accounts use deletion time and anonymized marks/placeholders are excluded; verification changes set eligibility; invitation-accept API records last sign-in; source omission/error injection fails closed |
| TC-PRIVACY-INACTIVE-001 | Phase 3: create four own people across two organizations in the same tenant, one inactive, one with own recent order, one stale on record with own recent interaction, one linked to a portal user whose creation/login are also backdated. Tenant-wide preview lists first/fourth, self-repairs third; apply uses origin retention and typed per-subject completion, erases first and skips fourth by dry-run closure, leaves active two. A fresh exclude preview erases only fourth and excludes its full closure. Changed list/scope/set/age/acknowledgement, organization-restricted inputs and expired token refuse before writes; newly active fixture dropped; an apply with `--max 1` stops with `nextIndex` and a `--resume-at` invocation finishes the list; complete apply removes its owner-only file. Engine-shaped caller uses engine:retention and rejects include through the same wrapper |

Every test owns its tenants/organizations, people, portal users, roles, orders, forms/versions/submissions, carts, messages and files; create via APIs where available and backdate only fixture ids. Remove all in `finally`, including signed preview files, export artifacts and audit fixtures. Use the real database with injected clock/registry/source failures in-process for conditions a running app cannot change. No seed data or existing-module assumptions are required. Phase 1 API/UI coverage ships in Phase 1, not later. The engine owner supplies its scheduled-policy integration coverage under R3-13.

## 📝 Risks & Impact Review

#### An active customer is erased
- **Scenario**: Their activity is in a module that declares no source.
- **Severity**: High
- **Affected area**: customers of that tenant
- **Mitigation**: A 365-day floor; the candidate's own records are re-checked; the people set requires six sources, and the filter refuses while one of them is missing for an enabled module or disabled without an explicit acknowledgement; R4-12 passes each person's fully resolved linked portal subjects to forms, including differently addressed accounts, and missing or incomplete attribution is unknown; Apply ships only once the `sales` source is registered; the signed list contains ids and timestamps, and the operator may resolve ids in authorized screens; no command-provided name-review safeguard is claimed; the erase run still anonymizes or keeps what another module's rules require.
- **Residual risk**: Undeclared/unrequired modules such as documents remain invisible, as do disabled required modules an operator or policy has explicitly acknowledged; UUID review can miss a relationship; activity after the final check can race erasure. Assumption 1 takes the widest activity definition for that reason, and assumption 10 accepts the race. The engine has no per-person human review; its owner documents that policy risk.

#### A subject outside the reviewed list is erased
- **Scenario**: Apply names a candidate's related subject to the erase run, though it was never on the previewed list.
- **Severity**: High
- **Affected area**: portal accounts and CRM people linked to a candidate
- **Mitigation**: R3-13 in the engine spec and the shared execution wrapper refuse include for either caller; dry run discovers the full closure and apply receives explicit exclusions; tests assert that no outside subject becomes an erasure target. R3-1 governs collateral record edits and history stripping, not this target list.
- **Residual risk**: No implicit target is permitted. A caller bypassing the shared wrapper is an integration defect; engine integration coverage is owned by its spec. Dependent records about other people may still be edited under R3-1.

#### The stored time is wrong
- **Scenario**: A writer that should move it was missed.
- **Severity**: Low
- **Affected area**: how many lookups a run makes
- **Mitigation**: The re-check decides and repairs the time.
- **Residual risk**: The estimate may lag undeclared sources and the final activity race remains; known CRM evidence, including the deal's own timestamp, is rechecked. No blanket correctness guarantee is made.

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
| No cross-module table access | Compliant | Sources read their own tables; forms consumes C1's supplied linked account references and separate alias envelopes |
| Additive schema and contract | Compliant | One column; two optional registry members; R4-12 adopts C1's existing `PrivacyLinkedSubject` through the optional per-subject `linkedSubjects` member |
| Optimistic locking | Compliant | The new column is not the version and its upkeep does not bump it |
| Tenant scoping | Compliant | Every call takes a scope |
| Fail closed on incomplete activity evidence | Compliant design | Missing sources and unacknowledged disabled required modules refuse every entry point, manual and engine |
| Explicit, filtered erasure targets | Compliant design | Manual signed preview only; engine policy does not promise per-person human review; both callers use the same evaluation and skip/exclude wrapper under R3-13 |
| Edition | Compliant | Assumption 9 under DEC-2/DEC-2b: the time, listing and manual command in OSS; schedules in Enterprise |
| Integration coverage | Compliant design | Phase 1 list/detail/sort/UI test; export assertion ships with the handler/field once available; Phase 2 sources/floors/API test; Phase 3 signed apply and closure test |

**Verdict:** Design ready. Written upstream approval must name this proposed OSS carrier under [DEC-2](2026-11-15-gdpr-ready-deployments-program.md#decisions) before implementation or OSS submission. Phase 1 ships alone under assumption 1's activity definition. Phase 2 waits on contract discovery/Phase 6 aliases and complete forms attribution; Phase 3 also waits on erasure Phase 4/R3-14, commerce Phase 1 and the `sales` source. R4-12 adopts C1's forms linkage envelope in the activity input; implementation of the handoff and complete owner paging remain prerequisites, never permission for an incomplete source to certify inactivity. Apply accepts the documented final-check race under assumption 10.

## Changelog

### 2026-11-19 — Confirmed spec review corrections

- Separated the CLI preview file cap from the service page cap, froze bounded aggregation/cursor rules and added boundary/failure acceptance cases (F43).


### 2026-11-18

- Added durable recovery of in-flight child erasure journals before filtering and cursor advancement. Specified strict collection for sets and activity sources. Made people list projection and sorting use the base activity column and added tests for stale or missing index projections.

### 2026-11-17
- A disabled required activity module now refuses preview, apply and the engine with `required_source_disabled` unless an explicit acknowledgement is recorded in the signed preview or the engine policy; Delta, API, edge cases, tests and risks updated.
- Preview gains `--after`/`--limit` and a signed `continuation`, capped at 1,000 subjects per file; apply gains `--resume-at`, `--max` counts attempted dry runs, and expiry is checked at the start of each invocation.

### 2026-11-16
- Council round two fixes, pass five gap closing (GPT-6.1 Sol workers): adopt C1's per-subject linkedSubjects envelope under R4-12; specify linked portal-user and invitation matching, exhausted owner paging, fail-closed attribution, tests, risk mitigation and compliance without expanding erasure targets.
- Council round two fixes, pass four alignment (GPT-6.1 Sol workers): replace stale missing-linkage claims with C1 Phase 6's exact account-owned seam and existing handoff prerequisite, preserving unknown/refusal until the local activity input can consume it.
- Council round two fixes, pass three (GPT-6.1 Sol workers): preserve existing tenant-wide rejection before evaluation/self-repair; cite C1's exact purpose-key seam through C4 and refuse missing keys before preview writes; correct the Aliases section name; consume the record-retention owner's finite retention-run evidence expiry with exact resource identities and terminal/side-effect metadata.
- Council round two fixes, pass two (GPT-6.1 Sol workers): tenant-wide preview/evaluation/apply aligned with erasure assumption 16 and exact R3-14 inputs, origins and per-subject results; engine-owned R3-13 applies to unattended policies without extra subjects; contract alias/phase references corrected, unavailable forms-to-portal linkage fails closed, and portal anonymized marks use the root owner's shape; exact R3-1, R3-2, R3-9, DEC-A and DEC-B citations.
- Council round two fixes (GPT-6.1 Sol workers): r8-04 shared skip/exclude boundary and honest engine review limits; r8-06 signed scoped expiring preview; r8-10 remove unsupported name-review claim; r8-11 require forms/cart sources; r8-14 separate portal floors; r8-17 exact R3-14 dry-run/closure/apply; r8-21 portal creation activity; r8-22 Phase 1 API/UI integration; r8-29 preview self-repair; r8-31 explicit activity export; r8-34 accepted final-check race; g5-23 linked-deal timestamps; g5-24 soft-deleted portal accounts; g5-26 per-subject evaluation; g5-27 preserve projection version semantics; F-56 readonly aliases.
- Written autonomously with resolved assumptions.
- Rewritten after independent review. The stored time is no longer trusted to decide: each batch is checked against the person's own records, because activity is also written without commands and a missed writer would have made people look inactive. The sales source covers a person named as a contact, the common business case the first draft missed. One filter method serves both the manual command and the enterprise engine, which keeps its own loop. The preview is a file of who, and the token covers it; a count said nothing. A portal account's sign-ins count as activity for its person, and a linked pair is skipped by default without being reported as a failure. The portal "last seen" column is dropped in favour of the existing sign-in time. Retention for people is declared in the retention registry, not on the data class. Soft-deleted people and never-verified accounts are covered.
- Council review (Opus, GPT-5.6 Sol, DeepSeek V4 Flash, Kimi K3.1 Pro), high fixes: g5-03 — a people set names its required sources; `listFilteredCandidates` refuses with `required_source_missing` while one is missing for an enabled module; the `sales` source waits for the commerce coverage indexes and Phase 3 is gated on both; g5-05 — `--related include` is removed, so apply never erases a subject that is not on the reviewed list; a related subject is skipped with its pair or excluded, with scenarios, a risk and unit tests.
