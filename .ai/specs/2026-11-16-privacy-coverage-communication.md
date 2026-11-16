# Privacy coverage: communication

> **Program:** a coverage spec of [`2026-11-15-gdpr-ready-deployments-program.md`](2026-11-15-gdpr-ready-deployments-program.md) (tracker open-mercato/open-mercato#8593), for `messages`, `communication_channels`, `inbox_ops` and `phone_calls`.
> **Builds on:** [`2026-11-16-privacy-data-class-contract.md`](2026-11-16-privacy-data-class-contract.md), including its addendum on aliases and identifier subjects; [`2026-11-16-privacy-subject-erasure.md`](2026-11-16-privacy-subject-erasure.md), including its addendum; and [`2026-11-16-privacy-table-coverage.md`](2026-11-16-privacy-table-coverage.md).
> **Verified at** `main` @ `08dada9624` by reading each module's entities, encryption map and commands; nothing was run. Not traced: whether portal users can be message recipients, and custom fields on these entities.
> **Written autonomously.** No question was put to a person; the choices are listed under Resolved assumptions.

Extends: .ai/specs/2026-11-16-privacy-data-class-contract.md
Extends: .ai/specs/2026-11-16-privacy-subject-erasure.md

## 📝 TLDR

A message has a sender and recipients, and every one of them is a person. Erasing one of them must not destroy the others' record of the conversation — and must not leave the erased person's address and words behind either. Today these four modules can do neither: a sent message cannot be removed at all, the product does not even record whether a stored message came in or went out, an outside correspondent's address sits in several places across two modules, inbound mail is kept whole with every quoted third party, and a phone call's participants are rewritten from the provider each time the call is read again. **Proposed (future):** a data class per module and a stated rule for each kind of record. What an outside person sent to the company is cleared. What the company's staff wrote is kept as the company's record, with the outside person's address removed. An erased person's own copies are deleted. Each module is its own phase and ships its export and its erase together.

**Not in this spec:** messages inside CRM interactions, which the CRM class covers; dead-letter queues, which the pruner spec bounds; call transcripts, which have columns and no storage yet; notifications that quote a message, which the staff coverage spec covers.

## 📝 Resolved assumptions (autonomous defaults)

| # | Question | Chosen | Rationale |
|---|---|---|---|
| 1 | A staff user who sent messages | The messages stay, with the sender left as an id that no longer resolves. Their own inbox rows are deleted | ⚠ NEEDS HUMAN CONFIRMATION. Deleting a sent message hides it from everyone who received it; staff wrote on the company's behalf. The sender column cannot be empty. |
| 2 | What an outside person sent in | Subject and body cleared; the row kept, so that threads and counts hold | ⚠ NEEDS HUMAN CONFIRMATION. Keeping the text of a private person's messages after they ask for erasure is hard to justify; deleting rows breaks threads for the staff who took part. |
| 3 | What staff sent to an outside person | Kept, with the outside address and name removed | It is the company's own correspondence. A staff reply that quotes the person keeps the quote; that is a stated limit. |
| 4 | How to tell the two apart | A new stored direction on each message | Nothing stored today says whether a message came in or went out, and the sender column of inbound mail holds a staff user's id. |
| 5 | A correspondent with no record of their own | The contract's identifier subject | No row stands for such a person, and a hash must not become a subject's id. |
| 6 | Inbound mail held for processing | Content cleared; the row and its duplicate-detection hash kept | Deleting it would break references from the orders and messages it produced, and would let a redelivery re-create it. |
| 7 | A person merely quoted, copied in or mentioned | Not found, and said so | Finding them means decrypting and reading every message in the tenant. |
| 8 | Phone calls | The whole call's participants, the provider's copy and the recording are cleared; time, duration and status stay; a cleared call keeps its status updates and is never refilled with participants | ⚠ NEEDS HUMAN CONFIRMATION. Ingest rewrites the whole participant set, so one participant cannot be cleared alone; on a call with several outside parties the others' details go too. |
| 9 | A staff user's own mailbox connection | Disconnected, its identifying fields cleared, and its stored credential deleted | It is a secret that belongs to that person's account. |

## 📝 Problem Statement

**messages**

- Subject, body, one outside address with its hash, and an outside name are encrypted; the sender is a staff user id and cannot be empty (`messages/data/entities.ts:53, 98-122`). The outside address is the sender on inbound mail and the recipient on outbound; whether a message came from a channel is known only at the moment of the event (`commands/messages.ts:449`).
- Internal recipients have a row each; that table, the linked-object table — which holds a copy of the linked record — and the access-token table have no tenant column (`:204-320`).
- A recipient can remove their own row; a sender's removal hides the message from everyone; nothing hard-deletes a sent message, and no command updates one (`commands/messages.ts:1180-1224`).
- A daily counter of outside recipients stores a hash made with its own context string (`lib/externalEmailBudget.ts:208`), which no alias can match.
- Subject, body, the outside name and the address hash feed the search index (`search.ts:60-73`).

**communication_channels**

- Conversations link to a CRM person by `contact_person_id` (indexed) and hold a subject. External messages hold the sender's identifier and display name in clear. Channel links hold the message as received in `channel_payload` — including the from, to, cc and bcc of inbound mail — and in `channel_metadata` the raw headers, the subject and the message ids that threading matches on (`communication_channels/data/entities.ts:208-338`; `lib/email-mime.ts:509-527`; `lib/thread-matcher.ts:386-400`).
- Messages from chat and text channels have no email address at all.
- Inbound mail becomes a `messages` row whose sender column is a system user or, by a fallback, the conversation's assignee (`commands/ingest-inbound-message.ts:393-394, 434-438`).
- A channel may belong to one staff user, with an external identifier, a display name, state and a pointer to a stored credential. The subscriber meant to disconnect it when that user is deleted never runs (program package A9).

**inbox_ops**

- For each inbound email it stores raw text and HTML, a cleaned text, the parsed thread, the forwarding address and name, the to and reply-to addresses, encrypted; and in clear the message ids, references and a content hash under a unique index that makes a redelivery a duplicate (`inbox_ops/data/entities.ts:118-193`; `lib/emailParser.ts:99-102`).
- The forwarder is usually a staff member. The customer appears in the proposal's participants list, inside encrypted JSON, and as `matched_entity_id` or `created_entity_id` on proposal actions, in clear.
- What a proposal produced points back at it: an order's metadata, a message's source id, a linked-object row (`sales/inbox-actions.ts:71`; `inbox_ops/lib/messagesIntegration.ts:128, 190-205`).
- The module has no commands; changes are made in route handlers.

**phone_calls**

- Participants hold a number, a display name and an email, encrypted with no hash, and the whole set is deleted and rewritten on every ingest (`phone_calls/data/entities.ts:103-133`; `commands/calls.ts:34-59`). The call holds the provider's raw snapshot and facts, which repeat the numbers, and a recording address. Nothing links a call to a person.

**Fixtures exist** for inbound channel messages, inbound email and text extraction, and phone calls have integration tests of their own (`packages/core/src/helpers/integration/communicationChannelsFixtures.ts`, `inboxFixtures.ts`; `phone_calls/__integration__`).

## 📝 Proposed Solution

### Classes

| Class | Subject kinds | Finds by |
|---|---|---|
| `messages.messages` | `auth:user`; `customers:person`; `privacy:identifier` | Sender and recipient ids; `external_email_hash` against the `email_hashes` alias; message ids handed to it by the channels class |
| `communication_channels.conversations` | `auth:user`; `customers:person`; `privacy:identifier` | Channel owner; `contact_person_id`; a new hash of the sender identifier against the email and phone aliases |
| `inbox_ops.emails` | `customers:person` | `matched_entity_id` and `created_entity_id` on proposal actions |
| `phone_calls.calls` | `customers:person`; `privacy:identifier` | New hashes of the participant's number and email against the aliases |

### What erasure does

| Record | Outcome |
|---|---|
| A message a staff user sent | **Retained**; the sender id stays |
| A staff user's recipient rows and access tokens | **Deleted**; the message stays for the others |
| An inbound message from the erased person | Subject, body, action data and linked-record copies **cleared**; address, name and hash cleared; the row kept |
| An outbound message to the erased person | Address, name and hash **cleared**; the text **retained** |
| A message with no email address, from a chat or text channel | The channels class finds it by the sender identifier and asks the messages module's service to clear it by id, under the same two rules |
| A conversation whose contact is the erased person | Every link's message-as-received cleared; headers reduced to the message ids; the subject cleared on the links and on the conversation; sender identifiers and display names cleared; reactions' display names cleared |
| An external message found only by the sender's hash | Its identifier, display name and message-as-received cleared |
| A staff user's own channel | **Disconnected**; external identifier, display name and state cleared; the credential deleted through the integrations module's service |
| Inbound email in `inbox_ops` tied to the person | **Anonymized**: raw and cleaned text, thread, forwarding, to and reply-to addresses, the proposal's summary, participants and translations, action payloads and discrepancies cleared. The rows, the message ids and the content hash kept |
| A phone call with the person as a participant | Every participant row's number, name and email cleared; the provider's snapshot and facts and the recording address cleared; the recording file released; the call marked |

Each handler blanks through an internal function of its module, returns the records it touched as history records, and releases files through the attachments seam. For this path `messages` releases files through that seam and not by its own direct deletes.

### Schema and behaviour changes

- **`messages.direction`** — internal, inbound or outbound — written when a message is created. For existing rows, a one-off command in `communication_channels`, which knows which messages it ingested, tells the messages module's service which ids are inbound; a message with an outside address and no such record is outbound. Until it has run, a message with an outside address and no direction is treated as inbound — the choice that clears more.
- **Hashes**, written by each module in its own write path and filled by a one-off command, with the contract's fallback scan until then: `external_messages.sender_identifier_hash`; `phone_call_participants.phone_number_hash` and `email_hash`. Numbers are reduced to digits by the shared helper before hashing.
- **`phone_calls.anonymized_at`**: ingest still updates the call's status and duration and no longer writes participants, snapshot or recording.
- **The daily recipient counter** is pruned after a week by the module's own clean-up; its hash cannot be matched and it is declared as bounded by retention.
- **Indexes** led by the tenant on each new hash.

### Alternatives considered

| Alternative | Why rejected |
|---|---|
| Delete every message an erased person took part in | Destroys other people's records. |
| Keep the text an outside person sent | See assumption 2. |
| Decide by "the only outside party" | A message stores one address; copied-in parties are in another module's JSON. Not decidable. |
| A subject whose id is the address's hash | The hash would sit in audit entries, events and export documents and outlive the erasure. |
| Delete inbound mail in `inbox_ops` | See assumption 6. |
| Clear one phone participant | Ingest replaces the whole set; a row has no identity to keep. |
| Find mentions by scanning | See assumption 7. |

### Known limits

- A person quoted in a retained staff reply, copied in on someone else's message, or named in a call's summary is not found.
- In a conversation whose contact is someone else, an erased person who was only copied in keeps their address in that conversation's stored headers.
- A proposal whose participants list names the person with no matched or created id is not found.
- A person already anonymized in the CRM has no address left to compute aliases from; a class released later cannot find their address-keyed messages.
- Two people who share an address share its hash.
- In OSS, the only way to keep correspondence that is needed for a dispute is not to run the erasure; a legal hold is an enterprise control.
- A call cleared here still exists at the telephony provider.

## 📝 Delta

### Capability: privacy-coverage-communication

#### ADDED Requirement: Export of communication records
The system SHALL include in a subject's export the messages they sent or received, their conversations, inbound mail tied to them and calls they took part in.

##### Scenario: Staff user
- WHEN a staff user is exported
- THEN the document lists messages they sent and received, and no inbound mail that merely carries their id as a fallback sender

##### Scenario: Outside address
- WHEN an email address with no CRM record is exported
- THEN one subject covers the messages to and from that address

#### MODIFIED Requirement: Erasure with communication records
The system SHALL, on erasure, remove the subject's own copies, clear their address and name wherever it finds them, clear what an outside person sent in, keep what staff wrote, and leave other participants' access intact.

##### Scenario: A recipient among several
- WHEN one of three internal recipients is erased
- THEN the other two still open the message

##### Scenario: Inbound
- WHEN the outside sender of an inbound message is erased
- THEN the row remains, with no address, name, subject or body

##### Scenario: Outbound
- WHEN the outside recipient of a staff-written message is erased
- THEN the text remains and the address and name are gone

##### Scenario: A staff sender
- WHEN a staff user who sent a message is erased
- THEN the recipients still open it with its text, and the run reports it as retained

##### Scenario: A chat message
- WHEN the erased person wrote through a channel with no email address
- THEN the message is found by its sender identifier and its text is cleared

##### Scenario: Inbound mail redelivered
- WHEN an inbound email tied to an erased person is delivered again
- THEN it is still recognised as a duplicate and is not processed

##### Scenario: A call read again
- WHEN a cleared call is ingested again from the provider
- THEN its status is updated and its participants and snapshot stay cleared

##### Scenario: A staff user's mailbox
- WHEN a staff user with a connected mailbox is erased
- THEN the channel is disconnected and its credential no longer exists

Frozen by: `packages/core/src/modules/messages/__tests__/delete-for-actor.characterization.test.ts`, `packages/core/src/modules/phone_calls/__tests__/ingest-replaces-participants.characterization.test.ts`

## 📝 Architecture

- Each module: `privacy.ts`, a handler and internal blanking function under `lib/privacy/`, its registration, retained declarations.
- `messages`: the direction column; a service method that clears messages by id for erasure, and one that records directions for existing rows.
- `communication_channels`: the direction fill command; the sender hash.
- `integrations`: a service method that deletes one credential by reference.
- `phone_calls`: ingest honours the mark.
- `customers`: `resolveAliases` with `email_hashes` and `phone_hashes`.

| Touchpoint | Mechanism | Absent |
|---|---|---|
| Modules → a person's addresses and numbers | Aliases from the owner class or the identifier subject | Found by ids only |
| `communication_channels` → message text | The messages module's service, by message id | The channel side is cleared and the message reported as pending |
| `communication_channels` → stored credential | The integrations service | The channel is disconnected and the credential reported as pending |
| Classes → files | The attachments seam | Reported as pending |

## 📝 Data Models

| Table | Change |
|---|---|
| `messages` | `direction`, nullable until filled |
| `external_messages` | `sender_identifier_hash` |
| `phone_call_participants` | `phone_number_hash`, `email_hash` |
| `phone_calls` | `anonymized_at`, nullable |

Additive, with migrations, snapshots and tenant-led indexes.

## 📝 API Contracts

- Uses the contract's `resolveAliases`, `aliases` and `privacy:identifier`, and the erasure addendum's `historyRecords`. Adds no contract member.
- **`messages`** service: `clearForErasure(messageIds, rule)` and `recordDirections(ids, direction)`.
- **`integrations`** service: delete a credential by reference.
- **Commands**: `mercato communication_channels fill-message-directions`, `fill-privacy-hashes`; `mercato phone_calls fill-privacy-hashes`.
- No route changes.

## 📝 Edge Cases & Failure Scenarios

| Case | Behaviour |
|---|---|
| A message with an outside address and no direction yet | Treated as inbound: its text is cleared. The dry run counts such messages separately |
| A staff user who is the fallback sender of inbound mail | That mail is not theirs; it is handled for its outside sender |
| A person with several addresses | Every alias hash is matched |
| A number stored in a different format from the CRM's | Both sides reduce to digits before hashing |
| A conversation with a company's shared mailbox | The company is not a person; nothing is cleared |
| An executed proposal's order or message | Still points at the proposal row, which remains |
| A recording stored as an attachment | Released through the seam |
| A call still in progress | Left; reported as pending |
| Tables with no tenant column | Reached only through their message, whose tenant is checked first |
| The run's process has a different lookup secret from the app | Nothing is found by address; the dry run prints how many records were matched by address |

## 📝 Migration & Backward Compatibility

Additive columns, indexes, service methods and commands. `messages` keeps its direct attachment deletes for its existing commands. Sent messages still cannot be hard-deleted by users. Until the direction fill has run, erasure errs towards clearing text.

## 📋 Phasing

Each phase ships its module's export and erase together.

| Phase | Modules | Depends on |
|---|---|---|
| 1 | `messages` with `communication_channels` — ingest couples them | The contract's and the erasure spec's addenda; erasure spec, Phase 3; program package A9 |
| 2 | `inbox_ops` | The same |
| 3 | `phone_calls` | The same |

## 📋 Implementation Plan

### Phase 1
1. **Characterize** that a sender's delete hides a message from all recipients. Commit alone.
2. `messages.direction`: the column, set at creation; the service method and the channels fill command. Unit tests for each kind of message.
3. The sender-identifier hash in the write path, its fill command and fallback. `customers` publishes the aliases.
4. The two classes: export sections, resolution, a cross-tenant test.
5. The internal blanking functions and erase methods, with the outcomes above; the messages service's clear-by-id; the integrations credential method. Unit tests per outcome: a recipient among several; inbound; outbound; no direction; a chat message; a fallback sender; a conversation's headers reduced with threading still matching by message id.
6. Integration tests TC-PRIVACY-COMM-001 and 002.

### Phase 2
1. The `inbox_ops` class, its internal function and erase. Unit tests: an executed proposal's references still resolve; a redelivery is still a duplicate.
2. Integration test TC-PRIVACY-INBOX-001.

### Phase 3
1. **Characterize** that ingest rewrites a call's participants. Commit alone.
2. The hashes, the fill command, the mark and ingest's check. Update the characterization test.
3. The class and erase. Integration test TC-PRIVACY-CALLS-001.
4. Remove the four modules' tables from the coverage baseline; add fixtures to the verification suite.
5. Archive this Delta into `.ai/specs/capabilities/privacy-coverage-communication.md` if that directory has been adopted by then.

| File | Action |
|---|---|
| `packages/core/src/modules/{messages,communication_channels,inbox_ops,phone_calls}/{privacy.ts,lib/privacy/*,di.ts,cli.ts,data/entities.ts,migrations/*}` | Create / modify |
| `packages/core/src/modules/messages/commands/messages.ts`; `packages/core/src/modules/phone_calls/commands/calls.ts` | Modify |
| `packages/core/src/modules/integrations/lib/*`; `packages/core/src/modules/customers/lib/privacy/*` | Modify |
| One integration test per phase, in its module | Create |

## 🧪 Integration Coverage

The commands run as existing tests run commands, in a process that shares the app's lookup secret.

| Test | Covers |
|---|---|
| TC-PRIVACY-COMM-001 | A staff user sends a message to two colleagues and one outside address; an inbound message is seeded from that address with the existing fixture. The staff user's export lists the first and not the second; an identifier subject for the address lists both; a second tenant's messages do not appear |
| TC-PRIVACY-COMM-002 | Erasing one recipient leaves the message readable by the other. Erasing the address clears the inbound message's text and leaves the outbound one's, with no address on either. Erasing the sender leaves the text readable and is reported as retained |
| TC-PRIVACY-INBOX-001 | An inbound email is ingested with the existing fixture and matched to a person. After that person's erasure the email API returns it with no text or addresses, and sending the same email again is rejected as a duplicate |
| TC-PRIVACY-CALLS-001 | A call is ingested with a participant whose number matches a person. After erasure the call returns no participant details; ingesting it again updates its status and restores nothing |

## 📝 Risks & Impact Review

#### The company loses a record it needed
- **Scenario**: A customer's inbound emails are cleared and a dispute follows.
- **Severity**: High
- **Affected area**: the tenant's correspondence
- **Mitigation**: The dry run lists what would be cleared; staff-written replies are kept; an enterprise hold stops the run; assumption 2 is marked.
- **Residual risk**: Irreversible once applied, and OSS has no hold.

#### Staff text is cleared by mistake
- **Scenario**: Direction has not been filled, and an outbound message is treated as inbound.
- **Severity**: High
- **Affected area**: messages written before the upgrade
- **Mitigation**: The dry run counts messages with no direction separately and names the fill command; the upgrade note says to run it first.
- **Residual risk**: An operator who applies without running it.

#### An erased person's words remain
- **Scenario**: They are quoted in a reply by staff, which is kept.
- **Severity**: Medium
- **Affected area**: erasure completeness
- **Mitigation**: Stated as a limit in the run's report for this class.
- **Residual risk**: Quoted text in retained messages.

#### Other people's call details are cleared
- **Scenario**: A call had two outside parties and one is erased.
- **Severity**: Medium
- **Affected area**: that call
- **Mitigation**: Stated; assumption 8 is marked.
- **Residual risk**: Accepted, or the call is kept by a hold.

#### The wrong person's messages are cleared
- **Scenario**: Two people used one address.
- **Severity**: Medium
- **Affected area**: address-keyed messages
- **Mitigation**: The dry run shows the count found by address.
- **Residual risk**: A shared mailbox used by several private people.

## Final Compliance Report — 2026-11-16

- **Reviewed:** root `AGENTS.md`, `.ai/specs/AGENTS.md`, the contract's handler obligations and addendum. Not reviewed: these modules' own guides, where they exist.

| Rule | Status | Notes |
|---|---|---|
| No cross-module table access | Compliant | Aliases, service calls by id, the attachments seam |
| Lookups on a hash | Compliant | Written by each module itself |
| Tenant scoping | Compliant | Tables without a tenant column are reached only through a tenant-checked parent |
| Additive schema | Compliant | — |
| Integration coverage | Compliant | Four tests, using existing fixtures |

**Verdict:** not approved until assumptions 1, 2 and 8 are answered. The design is otherwise ready, one phase at a time.

## Changelog

### 2026-11-16
- Written autonomously with resolved assumptions.
- Rewritten after independent review. The staff-versus-outside rule could not be decided from stored data, so messages gain a stored direction, and the "only outside party" condition is dropped for a rule based on direction alone. The correspondent kind whose id was a hash is replaced by the contract's identifier subject. Chat and text messages, which have no address, are found by the channels class and cleared through the messages module's service. The inventory of where addresses live in channel links was wrong and is corrected. Inbound mail in `inbox_ops` is blanked instead of deleted, so that references from what it produced still resolve and a redelivery is still a duplicate. A cleared call keeps status updates. Hashes are written and filled by each module. Export and erase ship together. Integration tests use the fixtures that exist, which the first draft said did not.
