# Privacy coverage: forms, documents, EUDR and the assistant

> **Program:** a coverage spec of [`2026-11-15-gdpr-ready-deployments-program.md`](2026-11-15-gdpr-ready-deployments-program.md) (tracker open-mercato/open-mercato#8593), for `forms`, `documents`, `eudr` and `ai_assistant`.
> **Builds on:** [`2026-11-16-privacy-data-class-contract.md`](2026-11-16-privacy-data-class-contract.md) and [`2026-11-16-privacy-subject-erasure.md`](2026-11-16-privacy-subject-erasure.md), including their addenda; [`2026-11-16-privacy-table-coverage.md`](2026-11-16-privacy-table-coverage.md), [`2026-11-16-privacy-record-retention.md`](2026-11-16-privacy-record-retention.md) and [`2026-11-16-forms-retention-scheduling.md`](2026-11-16-forms-retention-scheduling.md), which adds the reason to the forms anonymized event.
> **Verified at** `main` @ `08dada9624` by reading each module's entities, encryption map and services; nothing was run. Whether collaborative-editing state embeds an author's identity, where form PDF snapshots are stored and where assistant chat files are stored were not read.
> **Written autonomously.** No question was put to a person; the choices are listed under Resolved assumptions.

Extends: .ai/specs/2026-11-16-privacy-data-class-contract.md
Extends: .ai/specs/2026-11-16-privacy-subject-erasure.md

## 📝 TLDR

Four modules hold what people wrote. A form's answers are tied to a respondent who may be a portal user or someone known only by the email an invitation went to; the one existing "anonymize" removes only the answers a form designer flagged as sensitive, and leaves the rest. A document is written by several people and kept as plaintext with a hundred versions. EUDR records name producers — often individual farmers — with no id at all. An assistant conversation holds its owner's prompts and whatever the tools said about third parties, and a deleted one is only hidden. None of the four can export or erase. **Proposed (future):** a data class for each; an erasure mode for forms that removes every answer, including those of a submission the retention job already processed; and a stated rule for the rest: what one person made alone is removed, what several people share is kept and reported for a person to look at, and what the law says to keep is kept until the date the law gives. Each module is its own phase and ships its export and its erase together.

**Not in this spec:** people mentioned inside a document's text or an assistant transcript; form subject types a tenant invents for itself; removing an author's marks from collaborative-editing history.

## 📝 Resolved assumptions (autonomous defaults)

| # | Question | Chosen | Rationale |
|---|---|---|---|
| 1 | Erasing a form respondent | Every answer, every uploaded file, the stored PDF copy and the respondent's details are removed. The submission's shell — which form, when, its state — and its consent record stay, and the form's statistics stop counting the submission's answers | The existing service keeps unflagged answers, which is not erasure. The consent record holds no personal data by design. |
| 2 | A respondent known only by an invitation's email | The contract's identifier subject, matched on a new hash of the invitation's address. A portal user or a CRM person with the same address reaches the same submissions through their own address alias | No other record stands for them, and a forms handler cannot read another module's addresses. |
| 3 | A staff user's documents | Kept and reported as shared records. Their favourites, watches and personal shares are deleted; ownership and authorship stay as ids | ⚠ NEEDS HUMAN CONFIRMATION. A document is the organization's work, usually written by several people; ownership cannot be empty and cannot be transferred today. |
| 4 | A CRM person linked to a document | The link's copied label is replaced by a placeholder, and the document is reported as retained for a person to review | The module can insert a record's field values into the document's body, where they persist in the content and in up to a hundred versions. The handler cannot find or remove them. |
| 5 | EUDR records | Kept while the due-diligence statement they belong to is less than five years old, and reported with that date. Records never tied to a submitted statement, or older, are blanked | The regulation sets five years from the statement. The date is in the module's own data. |
| 6 | A staff user's assistant conversations | Those they own are deleted, whatever their visibility. In others' conversations only their participation is removed | ⚠ NEEDS HUMAN CONFIRMATION. Only the owner can write in a conversation, so a "shared" one is still its owner's transcript, shown to others. Deleting it removes it for them. |
| 7 | Usage and moderation rows, and the user's pending actions | Deleted for the user | They exist only to account for or act for that user. |

## 📝 Problem Statement

**forms**

- A submission names its subject by a free-form type and an id. The code fixes two: `customer` with a portal user's id, and `forms_invitation` with the invitation's id for an anonymous respondent (`forms/lib/portal-subject-policy.ts:20, 36`; `services/distribution-service.ts:328`).
- Answers are in revisions, encrypted with the module's own keys; uploads are stored inline under the same keys, not in the attachments module (`forms/encryption.ts:6-10`; `services/attachment-service.ts:149-155`). Five of its tables carry an organization and no tenant.
- The anonymize service tombstones only fields flagged sensitive, clears upload bytes and names — the stored PDF copy is one such upload — nulls the invitation's email, name and reference, and replaces the IP and user agent. It leaves other answers, the ids of who started, submitted and saved, and the access audit's IP and user agent (`services/anonymize-service.ts:68-166`). It skips any revision already marked anonymized (`:96`), and retention treats that mark as final (`lib/retention.ts:64`). A cleared PDF copy can be regenerated (`workers/pdf-snapshot.ts:72`).
- Statistics are tallied from the current revision's decoded values (`services/analytics-service.ts:197-206`).
- An invitation holds the recipient's email and name, encrypted through the ordinary encryption map, with no hash (`forms/encryption.ts:17-28`). An invitation may have no submission yet. Nothing deletes a submission.

**documents**

- A document has an owner who cannot be empty, and no command transfers ownership; content is plaintext because merging and search need it; up to 100 versions and 500 comments are kept (`documents/data/entities.ts:42, 89-95, 306-365`; `lib/historyPolicy.ts:3-6`).
- Shares, favourites and watches are per user; folders have an owner too. Links to CRM records copy a label, encrypted and not nullable (`:568-600`). The module can insert a linked record's field values into the body (`lib/recordFieldInsertion.ts`). Comments' mentions hold user ids, not names.

**eudr**

- Plots hold a producer's name, encrypted, their own name, an external id and the plot's geometry; evidence submissions hold a producer's name, a location, notes and a supplier copy with a display name; risk assessments hold an assessor's name as free text. There is no user or person id (`eudr/data/entities.ts:72-181, 292-310`).
- Evidence belongs to a due-diligence statement, which records when it was submitted (`:142, 247`).

**ai_assistant**

- A conversation has an owner, who cannot be empty, and a visibility — private, shared or organization-wide. Only the owner can add to it or manage its participants (`ai_assistant/data/repositories/AiChatConversationRepository.ts:454, 626, 687-692`).
- Pending actions have a creator who cannot be empty, may belong to no conversation, and hold the records an action would change — which may be a customer's — encrypted (`data/entities.ts:155-209`). They expire by a change of status and are never removed.
- Usage events and moderation flags are per user; four tables of overrides record who created and changed them.
- Deleting a conversation hides it and its messages. No event says a conversation was deleted.

## 📝 Proposed Solution

### Classes

| Class | Subject kinds | Finds by | On erasure |
|---|---|---|---|
| `forms.submissions` | `customer_accounts:user`; `customers:person`; `privacy:identifier` | Subject type `customer` with the portal user's id; a new hash of the invitation's address against the `email_hashes` alias | Every answer in every revision, uploads and their names, the PDF copy, the invitation's details, the submission's IP and user agent **cleared**; an invitation with no submission has its details cleared. The submission, its state and its consent record **retained** as evidence |
| `forms.staff_activity` | `auth:user` | Who started, submitted, saved, acted, or read | The access audit's IP and user agent for that user **cleared**; the ids stay |
| `documents.documents` | `auth:user`; `customers:person` | Owner, author, sharer, watcher; `customer_entity_id` on links | Favourites, watches and personal shares **deleted**. Owned and co-written documents, folders, versions and comments **retained** as shared records. A linked person's copied label replaced, and the linked documents **retained** and listed for review |
| `eudr.records` | `customers:person`; `privacy:identifier` | The supplier id; a new hash of the producer's name against a name alias, as a candidate match | Under a submitted statement less than five years old: **retained**, with the date. Otherwise the producer's name, notes and the supplier's display name **cleared**; the plot's geometry and identifiers kept |
| `ai_assistant.conversations` | `auth:user` | Owner, participant; the user id on usage, moderation and pending-action rows | Conversations they own **deleted** with messages, participants, pending actions and files. Their participant rows elsewhere **deleted**. Their usage and moderation rows and their pending actions **deleted** |

`customer_accounts.users` publishes the portal user's `email_hashes`, as `customers.people` does, so that a portal user also reaches the forms they were invited to by email.

Exports follow the same finds: a respondent's answers decrypted through the forms module's own service; a staff user's documents by title, without content; a producer's plots and evidence; a user's own conversations.

### The forms erasure mode

The anonymize service gains a mode and the submission a second mark.

- `sensitive`, the existing behaviour, is what retention uses.
- `erasure` tombstones every answer in every revision, whether or not the revision was already anonymized, and sets `erased_at`.
- A submission with `erased_at` is not given a new PDF copy, and its answers are left out of the form's statistics.

### Names as identifiers

The contract's identifier subject is extended to a name: resolving by `--name` offers one, with a `name_hashes` alias, and every match made through it is a candidate, never exact. EUDR is its first user. The producer-name hash is written by the module and filled for existing rows by its own command.

### Pending assistant actions

Besides deleting the erased user's own, the module's existing clean-up removes actions that were resolved or expired more than thirty days ago. That bounds the copies of customers' records they hold, which no handler can find by person.

### Tables without a tenant

Five forms tables have only an organization. The handler reaches them through their submission, whose tenant it has already checked.

### Schema changes

- `forms_invitation.recipient_email_hash`; `forms_form_submission.erased_at`.
- `eudr_plots.producer_name_hash`, `eudr_evidence_submissions.producer_name_hash`.
- Each hash is written in the module's own write path and filled by a one-off command, as the contract's addendum requires.

### Alternatives considered

| Alternative | Why rejected |
|---|---|
| Delete submissions | A form's counts, and any consent record pointing at the submission, would break. |
| Reuse the existing anonymize as it is | It leaves most answers. |
| Reassign an erased user's documents to an administrator | No transfer exists, and choosing a new owner is a decision for a person. |
| Delete an erased user's comments and versions | It rewrites history that others rely on. |
| Keep EUDR records with no end | The period is computable; "until a policy says otherwise" is not defensible when the date is known. |
| One subject per plot for a producer | One farmer would be many subjects. |
| Keep the text of a shared conversation its owner is erased from | Only the owner wrote it. |
| Clear a linked person's data from document bodies | The handler cannot find inserted values in content, editing state and versions. |
| A separate `forms:respondent` kind | The identifier subject already stands for a person known only by an address. |

### Known limits

- A person named in a document's text, a comment, an assessment note or a transcript is not found.
- A linked person's field values inserted into a document's body stay there; the run lists those documents for review.
- A submission whose subject type is one the tenant invented is found only through an address.
- Collaborative-editing state may carry marks of who typed what. This spec does not remove them.
- A producer is found by name only, as a candidate; an assessor's name is free text and is not found.
- A person already anonymized in the CRM has no address left to compute aliases from.

## 📝 Delta

### Capability: privacy-coverage-content-ai

#### ADDED Requirement: Export of content records
The system SHALL include in a subject's export their form submissions with answers, the titles of documents they own or wrote in, EUDR records that name them, and their own assistant conversations.

##### Scenario: Portal respondent
- WHEN a portal user who submitted a form is exported
- THEN the document has their answers in readable form

##### Scenario: Invited by email
- WHEN the address an invitation was sent to is exported
- THEN one subject covers the submissions made under that address

##### Scenario: A portal user who was also invited by email
- WHEN a portal user whose address received an invitation is exported
- THEN that submission is included

#### MODIFIED Requirement: Removing a respondent's answers
The system SHALL, on erasure, remove every answer and upload of a respondent's submissions, not only those flagged as sensitive, and SHALL keep the submission's shell and consent record.

##### Scenario: Unflagged answer
- WHEN a respondent with an answer in a field not flagged sensitive is erased
- THEN that answer is gone, and the form still lists the submission

##### Scenario: Already anonymized by retention
- WHEN the retention job has already removed a submission's flagged answers and the respondent is then erased
- THEN the remaining answers are removed too

##### Scenario: No new copy
- WHEN an erased submission's PDF copy is requested again
- THEN none is generated

##### Scenario: Retention is unchanged
- WHEN the forms retention job anonymizes a submission by age
- THEN only flagged answers are removed, as today

Frozen by: `packages/core/src/modules/forms/services/__tests__/anonymize-service.characterization.test.ts`

#### ADDED Requirement: Erasure with shared work
The system SHALL, on erasing a staff user, delete what was theirs alone and keep and report what others share.

##### Scenario: A conversation they own
- WHEN a user who owns a conversation shared with colleagues is erased
- THEN the conversation and its messages no longer exist

##### Scenario: A conversation they only joined
- WHEN the user was a participant in someone else's conversation
- THEN that conversation is unchanged for the others, and the user is no longer a participant

##### Scenario: A document
- WHEN the user owned a document others edited
- THEN the document still opens for them, the run reports it as retained as a shared record, and the user's favourite on it is gone

#### ADDED Requirement: EUDR records and the five-year period
The system SHALL keep an EUDR record that belongs to a statement submitted less than five years ago, saying until when, and SHALL blank a producer's name in any other.

##### Scenario: Within five years
- WHEN erasure is requested for a producer named on evidence under a statement submitted two years ago
- THEN nothing is removed and the run reports the date three years on

##### Scenario: No statement
- WHEN the producer is named only on a plot never tied to a submitted statement
- THEN the name is cleared

## 📝 Architecture

- Each module: `privacy.ts`, a handler and internal blanking function under `lib/privacy/`, its registration, retained declarations, table declarations.
- `forms`: the erasure mode and mark; the statistics and PDF-copy checks; the invitation hash.
- `eudr`: the name hashes; the statement-age rule.
- `ai_assistant`: the class shares its delete routine with the retention set of the record-retention spec; files are released through the attachments seam; the pending-action clean-up.
- `customer_accounts`: `resolveAliases` with the portal user's `email_hashes`.
- The contract: the identifier subject accepts a name.

| Touchpoint | Mechanism | Absent |
|---|---|---|
| Run → forms answers | The forms module's own decrypting service | Forms keys unavailable: the section is reported as failed |
| `forms`, `eudr` → an address or a name | Aliases from an owner class or the identifier subject | Found by ids only |
| `documents` → a CRM person | `customer_entity_id` on its own link table | — |
| Classes → files | The attachments seam; forms clears its own inline uploads | Reported as pending |

## 📝 Data Models

| Table | Change |
|---|---|
| `forms_invitation` | `recipient_email_hash`, indexed with the tenant |
| `forms_form_submission` | `erased_at`, nullable |
| `eudr_plots`, `eudr_evidence_submissions` | `producer_name_hash`, indexed with the tenant |

Additive, with migrations and snapshots.

## 📝 API Contracts

- **Contract**: the identifier subject accepts `--name` and carries `name_hashes`; matches through it are candidates. `customer_accounts.users` implements `resolveAliases`.
- **`forms`** anonymize service: `mode: 'sensitive' | 'erasure'`, default `sensitive`. The `forms.submission.anonymized` event's reason — added by the forms retention spec — gains `erasure`.
- **Commands**: `mercato forms fill-privacy-hashes`, `mercato eudr fill-privacy-hashes`.
- No route changes. The submission response gains `erasedAt`.

## 📝 Edge Cases & Failure Scenarios

| Case | Behaviour |
|---|---|
| A submission still in progress | Treated the same; its answers so far are removed |
| A form that was deleted with submissions remaining | The submissions are still found by subject |
| A respondent who is both a portal user and was once invited by email | One run for the portal user reaches both, through their address alias |
| An invitation that was never answered | Its recipient details are cleared |
| The forms master key is not configured in the process running the command | Export and erasure of answers fail for that class and say why |
| A document with a single author, shared with nobody | Still retained; the operator may delete it by the ordinary route, and the dry run lists such documents separately |
| An organization-wide conversation the user owned | Deleted, as any conversation they own |
| A pending assistant action created by the user, with or without a conversation | Deleted |
| A producer's name that matches several plots | One subject; each record is handled by the statement rule |
| Evidence under a draft statement | No duty yet; blanked |
| The forms retention job meets an erased submission | It skips it |

## 📝 Migration & Backward Compatibility

Additive: four columns, one service option, one value on an event's reason, two commands. The existing anonymize route and the forms retention job behave as before. Resolved and expired pending assistant actions start being removed after thirty days.

## 📋 Phasing

Each phase ships its module's export and erase together.

| Phase | Module | Depends on |
|---|---|---|
| 1 | `forms` | The addenda; erasure spec, Phase 3; the forms retention spec |
| 2 | `ai_assistant` | The same; the record-retention spec for the shared delete routine |
| 3 | `documents` | The same |
| 4 | `eudr` | The same; the name form of the identifier subject |

## 📋 Implementation Plan

### Phase 1 — forms
1. **Characterize** that the anonymize service leaves an unflagged answer and skips an already-anonymized revision. Commit alone.
2. The mode and the `erased_at` mark; the PDF-copy and statistics checks. Unit tests: erasure alone; sensitive then erasure; a request for a new copy; statistics before and after.
3. The invitation hash in the write path, its fill command and fallback. `customer_accounts` publishes the alias.
4. The two classes, with export and erase; tables without a tenant reached only through a checked submission; an invitation with no submission. Unit tests and a cross-tenant test.
5. Integration test TC-PRIVACY-FORMS-001.

### Phase 2 — assistant
1. The class, sharing the retention set's delete routine: owned conversations, participant rows, usage, moderation and pending actions. The pending-action clean-up. Unit tests per outcome.
2. Integration test TC-PRIVACY-ASSISTANT-001.

### Phase 3 — documents
1. The class: per-user rows deleted; documents retained and listed; a linked person's label replaced. Declare every table, including folders. Unit tests.
2. Integration test TC-PRIVACY-DOCS-001.

### Phase 4 — EUDR
1. The name form of the identifier subject in the contract and the `privacy` module. Unit tests.
2. The name hashes, the fill command, the class with the statement-age rule. Unit tests: within five years; older; a draft statement; no statement.
3. Integration test TC-PRIVACY-EUDR-001.
4. Each module's declared tables leave the coverage baseline; fixtures join the verification suite.
5. Archive this Delta into `.ai/specs/capabilities/privacy-coverage-content-ai.md` if that directory has been adopted by then.

| File | Action |
|---|---|
| `packages/core/src/modules/forms/{privacy.ts,lib/privacy/*,services/anonymize-service.ts,services/analytics-service.ts,workers/pdf-snapshot.ts,data/entities.ts,migrations/*,cli.ts}` | Create / modify |
| `packages/documents/src/modules/documents/{privacy.ts,lib/privacy/*,di.ts}` | Create / modify |
| `packages/core/src/modules/eudr/{privacy.ts,lib/privacy/*,di.ts,cli.ts,data/entities.ts,migrations/*}` | Create / modify |
| `packages/ai-assistant/src/modules/ai_assistant/{privacy.ts,lib/privacy/*,workers/*}` | Create / modify |
| `packages/core/src/modules/customer_accounts/lib/privacy/*`; `packages/core/src/modules/privacy/*` | Modify |
| One integration test per module, in its package | Create |

## 🧪 Integration Coverage

| Test | Covers |
|---|---|
| TC-PRIVACY-FORMS-001 | A portal user submits a form with one flagged and one unflagged answer; their export has both. A second submission is made through an emailed invitation, using the existing distribution fixtures; the address's export has it. After erasure the submission API returns neither answer and the form still lists the submission; a second tenant's data never appears |
| TC-PRIVACY-ASSISTANT-001 | A staff user owns a conversation shared with a colleague and takes part in the colleague's. After erasure a direct query finds no row of the first; the colleague still opens the second, without the erased participant |
| TC-PRIVACY-DOCS-001 | A document the user owns and a colleague edited still opens for the colleague; the run reports it as retained; the user's favourite is gone |
| TC-PRIVACY-EUDR-001 | With the module's existing API fixtures: a producer named on evidence under a recently submitted statement is reported as retained with a date; one named only on a plot with no statement has their name cleared |

After a user is erased, their own routes are unobservable; the tests check by direct query and through a colleague's or an administrator's session.

## 📝 Risks & Impact Review

#### An answer survives erasure
- **Scenario**: A revision or an upload is missed by the erasure mode.
- **Severity**: High
- **Affected area**: respondents
- **Mitigation**: The mode walks every revision, anonymized or not; the PDF copy is one of the uploads it clears and is not regenerated; the verification suite plants a marker in an unflagged answer and scans.
- **Residual risk**: Low.

#### Shared work is kept against a person's wishes
- **Scenario**: A former employee asks for their documents and transcripts to be erased.
- **Severity**: Medium
- **Affected area**: staff subjects
- **Mitigation**: The run reports each retained item with its reason, so the controller can answer the request; assumptions 3 and 6 are marked.
- **Residual risk**: A controller who disagrees must delete by the ordinary routes.

#### A colleague loses a conversation they were reading
- **Scenario**: The owner of a shared conversation is erased.
- **Severity**: Medium
- **Affected area**: participants of that conversation
- **Mitigation**: The dry run lists owned conversations that others can see; assumption 6 is marked.
- **Residual risk**: Accepted, or the conversation is kept by a hold.

#### A linked person's data stays in a document
- **Scenario**: Their field values were inserted into the body.
- **Severity**: Medium
- **Affected area**: documents linked to CRM records
- **Mitigation**: The run lists every linked document for review and says why.
- **Residual risk**: A reviewer who does not open them.

#### The five-year rule is wrong for a tenant
- **Scenario**: Another law, or a dispute, requires a record for longer.
- **Severity**: Medium
- **Affected area**: EUDR records
- **Mitigation**: An enterprise hold; the dry run shows each record's date.
- **Residual risk**: OSS has no hold.

#### A forms table is read without its tenant
- **Scenario**: A handler queries a table that has only an organization.
- **Severity**: High
- **Affected area**: tenant isolation
- **Mitigation**: Those tables are reached only through a submission already checked for the tenant; a unit test with two tenants.
- **Residual risk**: Low.

## Final Compliance Report — 2026-11-16

- **Reviewed:** root `AGENTS.md`, `.ai/specs/AGENTS.md`, the contract's handler obligations. Not reviewed: the forms, documents and assistant guides in full.

| Rule | Status | Notes |
|---|---|---|
| No cross-module table access | Compliant | Each class in its own module |
| Tenant in every query | Compliant by route | Five forms tables through their checked parent; declared |
| Lookups on a hash | Compliant | One new hash column |
| Additive schema and API | Compliant | — |
| Retain only with a listed reason | Compliant | `evidence`, `shared_record`, `legal_retention` |
| Integration coverage | Compliant | One test per module, with existing fixtures |

**Verdict:** approved as a design, one module at a time, subject to assumptions 3 and 6.

## Changelog

### 2026-11-16
- Written autonomously with resolved assumptions.
- Revised after independent review. The forms erasure mode would have skipped any submission the retention job had already processed, leaving its unflagged answers; it now ignores that mark and sets its own, which also stops a cleared PDF copy being regenerated and keeps erased answers out of statistics. The respondent kind is replaced by the contract's identifier subject, and portal users publish an address alias, since a forms handler cannot read another module's addresses. A conversation is its owner's transcript — only the owner can write in it — so an erased owner's conversations are deleted and nothing is "kept without an author". EUDR retention is computed from the statement's submission date instead of being indefinite, and a producer is one subject, found by a name hash. A linked person's document is reported for review, because their field values may be in its body. Pending assistant actions are cleaned by age. Every module has an integration test; the first draft wrongly said two had no fixtures.
