# Privacy coverage: communication

> **Program:** a coverage spec of [`2026-11-15-gdpr-ready-deployments-program.md`](2026-11-15-gdpr-ready-deployments-program.md) (tracker open-mercato/open-mercato#8593), for `messages`, `communication_channels`, `inbox_ops` and `phone_calls`; and, assigned after the council review, `packages/channel-*`.
> **Builds on:** [`2026-11-16-privacy-data-class-contract.md`](2026-11-16-privacy-data-class-contract.md), including its addendum on aliases and identifier subjects; [`2026-11-16-privacy-subject-erasure.md`](2026-11-16-privacy-subject-erasure.md), including its addendum; and [`2026-11-16-privacy-table-coverage.md`](2026-11-16-privacy-table-coverage.md).
> **Cross-spec contracts:** [`encryption-map-coverage-and-backfill`](2026-11-16-encryption-map-coverage-and-backfill.md), [`privacy-verification-suite`](2026-11-16-privacy-verification-suite.md), [`tenant-exit-export`](2026-11-16-tenant-exit-export.md) and [`privacy-coverage-people-ops`](2026-11-16-privacy-coverage-people-ops.md).
> **Verified at** `main` @ `08dada9624` by reading each module's entities, encryption map and commands; nothing was run. Not traced: whether portal users can be message recipients, and custom fields on these entities.
> **Written autonomously.** No question was put to a person; the choices are listed under Resolved assumptions.

Extends: .ai/specs/GDPR/2026-11-16-privacy-data-class-contract.md
Extends: .ai/specs/GDPR/2026-11-16-privacy-subject-erasure.md

## 📝 TLDR

A message has a sender and recipients, and every one of them is a person. Erasing one of them must not destroy the others' record of the conversation — and must not leave the erased person's address and words behind either. Today these four modules can do neither: a sent message cannot be removed at all, the `messages` table has no direction even though channel links store it, an outside correspondent's address sits in several places across two modules, inbound mail is kept whole with every quoted third party, and a phone call's participants are rewritten from the provider each time the call is read again. **Proposed (future):** a data class per module and a stated rule for each kind of record. What an outside person sent to the company is cleared. What the company's staff wrote is kept as the company's record, with the outside person's address removed. An erased person's own copies are deleted. Each module is its own phase and ships its export and its erase together.

**Not in this spec:** messages inside CRM interactions, which the CRM class covers; dead-letter queues, which the pruner spec bounds; call transcripts, which have columns and no storage yet; notifications about unrelated sources. Message-source notifications and their push-delivery copies are cleared through services specified here; the staff coverage spec covers recipient-owned notification rows.

## 📝 Resolved assumptions (autonomous defaults)

| # | Question | Chosen | Rationale |
|---|---|---|---|
| 1 | A staff user who sent messages | The messages stay, with the sender left as an id that no longer resolves. Their own inbox rows are deleted | Staff wrote on the company's behalf, so a sent message is the company's record, retained as `evidence`; deleting it would hide it from everyone who received it. The sender column cannot be empty. A name the sender typed into the text stays with it. |
| 2 | What an outside person sent in | Subject and body cleared; the row kept, so that threads and counts hold | A private person's own words are what the erasure request is about, so the text goes. Deleting the rows would break threads and replies for the staff who took part; an id-only shell keeps them. A tenant that needs the text for a legal claim does not run the erasure, or holds the subject in Enterprise. |
| 3 | What staff sent to an outside person | Kept, with the outside address and name removed | It is the company's own correspondence. A staff reply that quotes the person keeps the quote; that is a stated limit. |
| 4 | How to tell the two apart | A new stored direction on each message | `external_messages.direction` and `message_channel_links.direction` already exist; the fill copies their direction into `messages`. Copies with no channel link, including inbox_ops copies, need their own rule; the sender column of inbound mail holds a staff user's id. |
| 5 | A correspondent with no record of their own | The contract's identifier subject, exported and erased with `--email` or `--phone`. Its id is the contract's derived id, which matches no column | No row stands for such a person, and a hash must not become a subject's id. |
| 6 | Inbound mail held for processing | Content cleared; the row and its unkeyed duplicate-detection hash retained and reported as pseudonymous | Deleting it would break references from the orders and messages it produced, and would let a redelivery re-create it. |
| 7 | A person merely quoted, copied in or mentioned | Not found, and said so | Finding them means decrypting and reading every message in the tenant. |
| 8 | Phone calls | The whole call's participants, the provider's copy and the recording are cleared; time, duration and status stay; a cleared call keeps its status updates and is never refilled with participants | Ingest rewrites the whole participant set, so one participant cannot be cleared alone, and a partial clear would be refilled. Clearing every participant removes more than was asked, never less; time, duration and status keep the call's business record. On a call with several outside parties the others' details go too; the dry run reports every call it will clear. |
| 9 | A staff user's own mailbox connection | In the records group the channels class disconnects the channel and clears its identifying fields, state and `credentials_ref`, and deletes no credential. In a DSR run, R4-1's call to the integrations method is placed in the credentials group: `integrations.user_credentials`, the only deleting class, freshly lists the user's rows and deletes them through the integrations service. On ordinary user delete, A9's channel cascade calls the same `deleteUserCredential` | C4 permits credential deletion only after every records class succeeds, so a records-group call would break the barrier. The fresh user-id listing, owned by people-ops, already reaches every row a channel pointed at, including disconnected and soft-deleted ones, so the channels class hands nothing across. One deleting owner and one integrations service serve both paths. A9's ordinary-delete transaction has no barrier and may ship first. |

## 📝 Problem Statement

**messages**

- Subject, body, one outside address and an outside name are encrypted; the outside-address lookup hash is a separate digest; the sender is a staff user id and cannot be empty (`messages/data/entities.ts`). The outside address is the sender on inbound mail and the recipient on outbound; the inbound-from-channel flag is supplied at compose/event time, while direction remains in channel links (`commands/messages.ts`).
- Internal recipients have a row each; that table, the linked-object table — which holds a copy of the linked record — and the access-token table have no tenant column (the same source).
- A recipient can remove their own row; a sender's removal hides the message from everyone; nothing hard-deletes a sent message, and no command updates one (`commands/messages.ts`).
- A daily counter of outside recipients stores a hash made with its own context string (`lib/externalEmailBudget.ts`), which no alias can match.
- **`external_email_hash` is written only by the encryption service, while it encrypts.** The map names it (`messages/encryption.ts`); the encrypt step sets it beside the ciphertext (`shared/lib/encryption/tenantDataEncryptionService.ts`) and returns the payload unchanged when encryption is off (the same source). The module only reads the column (`search.ts`; `api/route.ts`). With encryption off, or for a row written before the map named the hash, it is empty. Its index is on the hash alone, not led by the tenant (`data/entities.ts`).
- Subject, body, the outside name and the address hash feed the search index (`search.ts`).

**communication_channels**

- Conversations link to a CRM person by `contact_person_id` (indexed) and hold a subject. External messages hold the sender's identifier and display name in clear. Channel links hold the message as received in `channel_payload` — including the from, to, cc and bcc of inbound mail — and in `channel_metadata` the raw headers, the subject and the message ids that threading matches on (`communication_channels/data/entities.ts`; `lib/email-mime.ts`; `lib/thread-matcher.ts`).
- Messages from chat and text channels have no email address at all.
- Inbound mail becomes a `messages` row whose sender column is a system user or, by a fallback, the conversation's assignee (`commands/ingest-inbound-message.ts`).
- A channel may belong to one staff user, with an external identifier, a display name, state and a pointer to a stored credential. The subscriber meant to disconnect it when that user is deleted never runs (program package A9).

**inbox_ops**

- For each inbound email it stores raw text and HTML, a cleaned text, the parsed thread, the forwarding address and name, the to and reply-to addresses, encrypted; and in clear the message ids, references and a content hash under a unique index that makes a redelivery a duplicate (`inbox_ops/data/entities.ts`; `lib/emailParser.ts`).
- The forwarder is usually a staff member. The extraction-time CRM match is `participants[].matchedContactId` with `matchedContactType`, inside encrypted JSON (`subscribers/extractionWorker.ts`). Action `matched_entity_id` and `created_entity_id` are written only on execution (`lib/executionEngine.ts`), so those columns miss pending and rejected proposals.
- What a proposal produced points back at it: an order's metadata, a message's source id, a linked-object row (`sales/inbox-actions.ts`; `inbox_ops/lib/messagesIntegration.ts`).
- **Every inbound email is also copied into `messages`.** The copy has type `inbox_ops.email`, source `inbox_ops:inbox_email` with the email's id, and the whole raw thread, quoted third parties included, as its body, up to 50,000 characters. Its outside address is the forwarder's, usually a staff member's (`inbox_ops/lib/messagesIntegration.ts`). The messages class cannot find it by the customer's address, and no channel record says it came in. A reply drafted from a proposal is copied as `inbox_ops.reply`, addressed to the customer and written by staff (`inbox_ops/lib/messagesIntegration.ts`).
- The module has no commands; changes are made in route handlers.

**phone_calls**

- Participants hold a number, a display name and an email, encrypted with no hash, and the whole set is deleted and rewritten on every ingest (`phone_calls/data/entities.ts`; `commands/calls.ts`). The call holds the provider's raw snapshot and facts, which repeat the numbers, and a recording address. Nothing links a call to a person.

**Notification copies.** `messages/subscribers/message-notification.ts` copies the subject and outside sender into each recipient's `messages.new` notification, keyed by source `(message, messageId)`. `notifications/data/entities.ts` stores title, body and template variables; `push_notifications/data/entities.ts` stores the delivery payload. Erasing only the recipient does not clear copies about an outside sender.

**Fixtures exist** for inbound channel messages, inbound email and text extraction, and phone calls have integration tests of their own (`packages/core/src/helpers/integration/communicationChannelsFixtures.ts`, `inboxFixtures.ts`; `phone_calls/__integration__`).

## 📝 Proposed Solution

### Classes

| Class | Subject kinds | Finds by |
|---|---|---|
| `messages.messages` | `auth:user`; `customers:person`; `customer_accounts:user`; `privacy:identifier` | Sender and recipient ids, `action_taken_by_user_id` and recipient `confirmed_by_user_id`; `external_email_hash`, now written by the module itself, against the `email_hashes` alias; message ids handed to it by the channels class; copies handed to it by source by the inbox_ops class |
| `communication_channels.conversations` | `auth:user`; `customers:person`; `customer_accounts:user`; `privacy:identifier` | Channel owner, conversation/thread `assigned_user_id`, reaction `reacted_by_user_id`; `contact_person_id`; B1's sender-identifier hash against email aliases; normalized-phone comparison through the bounded decrypting fallback when stored spelling cannot match phone aliases |
| `inbox_ops.emails` | `customers:person`; `customer_accounts:user`; `privacy:identifier` | New module-owned participant lookup rows written at parsing and extraction, including extraction-time CRM matches; executed action ids as a second path; participant address hashes against `email_hashes`; copies in `messages` by source |
| `phone_calls.calls` | `customers:person`; `customer_accounts:user`; `privacy:identifier` | New hashes of the participant's number and email against the aliases |

Staff export includes action/confirmation rows, conversation and thread assignments, and reactions. Erasure leaves those staff attribution ids as unresolved ids, clears copied reaction names, and reports retained attribution. Staff-id reactions remain; external-subject reactions use constraint-safe deletion.

The four classes declare `erasureGroup: 'records'` and own no subject kind. The channels handler disconnects and clears identifying fields, state and `credentials_ref`, including on soft-deleted channels. Under R4-1, people-ops' `integrations.user_credentials` is the only class that deletes credential rows, through the integrations-owned `integrationCredentialsService`; A9's channel cascade calls its `deleteUserCredential({ scope: PrivacyScope, userId, credentialId })`. There is no `communication_channels.user_credentials` class. C4's “The run”, steps 5–6, separately requires every records class to succeed before any credential deletion; integrations then freshly lists all scoped user-owned rows, including disconnected and soft-deleted residual rows, without relying on cleared channel pointers. A missing or failed enabled channel class prevents the credentials group.

**DSR call placement (R4-1).** In a DSR run the channels class makes no credential call: it runs in `records`, and C4 permits no credential deletion there. R4-1's call to the integrations method is placed in the credentials group, where `integrations.user_credentials` freshly lists the user's rows by user id and deletes each through the integrations service. It needs no pointer or id from the channels class, because the listing includes disconnected and soft-deleted rows. The channels class's read-only pre-flight still requires `integrationCredentialsService` by DI, so a disconnect never runs where nothing can delete the credential later. A records failure leaves every credential in place, and a retry re-lists them. A9's ordinary-user-delete cascade has no barrier: it calls `deleteUserCredential` and clears the pointer in one transaction, and may deliver the scoped method first.

Every class declaring `privacy:identifier` also declares `customers:person` and `customer_accounts:user`, per C1's identifier coverage guard and owner `providedAliases`, under **DEC-A — Subjects known only by an identifier (`privacy:identifier`)**. Portal-user matching is by email alias, not an invented portal recipient-id column. Missing required aliases or a truncated fallback makes coverage incomplete.

A correspondent with no record is the contract's `privacy:identifier` subject (contract spec, "A subject that is only an identifier"): its id is the derived `idv1_` id, and it is erased with `mercato privacy erase --email` or `--phone`, repeating the flag on apply (erasure spec, "Erasing by email or phone"). With no lookup secret configured, erase by identifier exits 1.

### What erasure does

| Record | Outcome |
|---|---|
| A message a staff user sent | **Retained**; the sender id and attachments stay |
| A staff user's recipient rows and access tokens | **Deleted**; the message stays for the others |
| An inbound message from the erased person | Subject, body, action data and linked-record copies **cleared**; address, name and hash cleared; attachments released; the row kept. Message-source notification copies are cleared for every recipient |
| An outbound message to the erased person | Address, name and hash **cleared**; text and attachments **retained**. Channel link payloads and headers are scrubbed by message id through the channels service |
| A message with no email address, from a chat or text channel | The channels class finds it through a linked person or an email/phone alias, exports it through `exportForPrivacy`, and calls `clearForErasure` by id under the same direction rules; an unlinked provider-only account is a reported limit |
| A conversation whose contact is the erased person | Every link's message-as-received cleared; headers reduced to message ids; subjects, sender identifiers, hashes and names cleared. Every inbound linked message, email included, is handed to the messages service even if its old address matches no current alias. External reactions attributable to the subject are deleted, including their provider ids; reactions on cleared inbound messages whose external actor cannot be distinguished are deleted and counted |
| An external message found only by the sender's hash | Its identifier, display name and message-as-received cleared |
| A staff user's own channel | **Disconnected**; external identifier, display name, state and `credentials_ref` cleared. Only people-ops' `integrations.user_credentials` deletes personal credential rows, after every records class succeeds, by a fresh scoped user-id listing |
| Inbound email in `inbox_ops` tied to the person | **Cleared, with a pseudonymous deduplication shell retained**: subject replaced by a localized placeholder; `raw_text`, `raw_html`, `cleaned_text`, `thread_messages`, forwarding address/name, `to_address`, `reply_to`, `processing_error` and metadata cleared (required address columns use empty placeholders). Proposal summary, participants and translations; action description, payload and execution error; discrepancy description, expected and found values cleared. Lookup rows deleted. `attachment_ids` released and emptied. Rows, message ids, references and unkeyed `content_hash` retained solely for deduplication and explicitly reported |
| The email's copy in `messages` (`inbox_ops.email`) | Cleared under the inbound rule: subject, body, action data, linked-record copies, address, name and hash. The row is kept. The inbox_ops class asks the messages module's service to clear the messages whose source is `inbox_ops:inbox_email` with the email's id and whose type is `inbox_ops.email`, and reports the result as its own section. A reply copy (`inbox_ops.reply`) is staff's message to the customer, found by the customer's address, and follows the outbound rule |
| A message derived from a cleared inbound message | Cleared under the same rule. A Discord AI reply proposal is stored as a message whose source is `messages.message` and the inbound message's id, with a summary of it as subject and a drafted reply as body |
| A phone call with the person as a participant | Every participant row's number, name, email, both lookup hashes, `provider_participant_id` and metadata cleared; provider snapshot and facts, recording URL and recording attachment cleared; recording file released; call marked |

Each handler blanks through an internal function of its module. Internal blanking writes no undo snapshot or audit entry containing cleared values. Per **R3-1 — The audit-history rule for every erasure** (erasure spec, “The audit-history rule for every erasure (R3-1)” and API Contracts, “Audit history — `audit_logs`”), `historyRecords` includes every edited or deleted message, recipient/token/object row, channel/conversation/link/reaction, inbox email/proposal/action/discrepancy, call/participant and delegated notification/delivery record, including rows owned by other people. Delegated services return their own history records. Dry run discovers these before the first write; the erasure engine owns the two history-strip passes and execution-time undo/redo refusal (**DEC-B — The audit-history strip routine**), not these handlers.

Files are released through the erasure spec's attachments seam inside the clearing transaction, passing its exact trailing `{ em }` options with the current transaction manager, with that subject run's `attachmentOrigin` as the seam's `origin`; only the durable pending-deletion drain runs after commit. Cleared inbound and derived messages release their attachments; retained outbound and staff messages keep theirs. Inbox `attachment_ids` use `releaseByIds` with the expected inbox owner, verified by the attachments service; foreign ownership is skipped and reported as incomplete file cleanup, never silently called erased. For this path `messages` uses the seam, not its existing direct deletes.

### History records by class (R3-1)

| Class | Records supplied to the erasure history strip |
|---|---|
| `messages.messages` | Every edited/deleted message as `messages.message`, with recipient, object and access-token row ids; delegated notification/delivery and file records; derived messages included |
| `communication_channels.conversations` | Channel ids as `communication_channels.channel` (the current audit kind), plus every changed conversation, external message, link, thread mapping and deleted/changed reaction; all delegated message/history ids |
| `inbox_ops.emails` | Every changed email, proposal, action, discrepancy and removed privacy-lookup row; delegated message/notification/file history ids |
| `phone_calls.calls` | Call ids as `phone_calls.phone_call`, plus every changed participant and recording/file row |

These mappings cover colleagues' records as well as the subject's. Include changed `message_confirmations`, shared recipient/object rows and every delegated child. Supply explicit `{ resourceKind, resourceId }` pairs: actual logged kind, or the discovered module entity id with `:` replaced by `.` for unlogged rows, per R3-1. Dry run and apply return the same planned identities; an unplanned row causes `REPLAN_REQUIRED` before mutation. Both strips use `includeSubjects` and `includeRecords`; execution rechecks undo/redo under lock. No new snapshot is written.

### Source notification copies

The messages service calls new `notificationService.clearSourceForErasure({ scope, sourceEntityType: 'message', sourceEntityIds, dryRun })` for every cleared message, including derived and inbox copies. The notifications module blanks `title`, `body`, title/body variables, `action_data`, `action_result`, arbitrary data, source-bearing links/group keys and push overrides that can carry copied text, keeping only ids and the localized cleared-message template. It calls a new push module service by notification ids to clear matching delivery payloads, `provider_response` and error text. Each service owns its tables and returns `{ affected, historyRecords, sections }`, with `sections: PrivacyErasureSectionResult[]` containing the exact retained shell evidence below and separate cleared sections. Dry run and apply obtain actual notification/delivery survivor and history identities from those owners; callers cannot infer them from message ids or recipient counts. This is a source-based operation across every recipient in the checked tenant/organization, not a deletion of colleagues' inbox rows. Missing required service support leaves the section incomplete. Delivered device or email copies cannot be recalled and are reported as a limit.

### Outcomes and run evidence

Use the erasure spec's closed outcomes/reasons. Required message/channel/notification/push/credential/file methods are checked in read-only pre-flight; absence refuses before writes. Late loss fails the class and leaves an incomplete run, exit 2. There is no `pending` section outcome. Physical file deletion failures are durable `filesPending`; ownership skips also prevent completion.

Verification's “Definition and run evidence” owns the `retained` declarations and matching rules. C4's API Contracts, “Contract additions — `@open-mercato/shared/modules/privacy`”, owns `PrivacyRetainedRecord` and `PrivacyErasureSectionResult.retainedRecords`/`dataClassId`; these type additions are already specified. Each row below expands into `{ section, table, columns, reason }` per table under the named class. Each actual retained section returns the exact table, row id, allowed columns and reason in `retainedRecords`; the runner stamps `dataClassId`. Handler population remains required before verification can pass. No counts or retainable columns on another row excuse a survivor. Split cleared and retained subsets; surviving ids/digests are pseudonymous evidence, not anonymous shells. The completion event omits `retainedRecords`; exact row evidence stays in the private report/encrypted audit.

| Class / section | Table: literal retained columns | Reason |
|---|---|---|
| `messages.messages` / `staff_correspondence` | `messages`: `id`, `sender_user_id`, `subject`, `body`, `action_data`, `action_result`, `action_taken_by_user_id`, `thread_id`, `parent_message_id`, `source_entity_type`, `source_entity_id` on retained staff-authored rows | `evidence` |
| `messages.messages` / `message_shell` | `messages`: `id`, `sender_user_id`, `action_taken_by_user_id`, `thread_id`, `parent_message_id`, `source_entity_type`, `source_entity_id`; `message_confirmations`: `id`, `message_id`, `confirmed_by_user_id`; surviving `message_recipients`: `id`, `message_id`, `recipient_user_id`; cleared `message_objects`: `id`, `message_id`, `entity_id` | `evidence` |
| `messages.messages` / `outbound_correspondence` | `messages`: `id`, `sender_user_id`, `subject`, `body`, `action_data`, `action_result`, `action_taken_by_user_id`, `thread_id`, `parent_message_id`, `source_entity_type`, `source_entity_id` on retained outbound rows after outside address/name/hash removal | `evidence` |
| `messages.messages` / `source_notification_shell` | `notifications`: `id`, `recipient_user_id`, `source_module`, `source_entity_type`, `source_entity_id` | `other_party` |
| `messages.messages` / `source_push_shell` | `push_notification_deliveries`: `id`, `notification_id`, `user_device_id`, `user_id`, `token_snapshot` | `other_party`; colleague device attribution only, never the erased recipient's own delivery |
| `communication_channels.conversations` / `channel_attribution` | `communication_channels`: `id`, `user_id`; `external_conversations`: `id`, `channel_id`, `contact_person_id`, `assigned_user_id`, `external_conversation_id`; `channel_thread_mappings`: `id`, `channel_id`, `assigned_user_id`, `message_thread_id`, `external_conversation_id`, `external_thread_ref`; retained staff `message_reactions`: `id`, `message_id`, `reacted_by_user_id` | `other_party` |
| `communication_channels.conversations` / `thread_shell` | `external_messages`: `id`, `channel_id`, `conversation_id`, `external_message_id`; `message_channel_links`: `id`, `message_id`, `external_message_id`, `external_conversation_id`, reduced `channel_metadata` (threading ids only); `channel_thread_tokens`: `id`, `message_thread_id` | `evidence` |
| `inbox_ops.emails` / `deduplication_evidence` | `inbox_emails`: `id`, `message_id`, `content_hash`, `in_reply_to`, `references`; `inbox_proposals`: `id`, `inbox_email_id`, `reviewed_by_user_id`; `inbox_proposal_actions`: `id`, `proposal_id`, `matched_entity_id`, `created_entity_id`, `executed_by_user_id`; `inbox_discrepancies`: `id`, `proposal_id`, `action_id` | `evidence` |
| `inbox_ops.emails` / `processing` | `inbox_emails`: `id`, `message_id`, `content_hash`, `forwarded_by_address`, `forwarded_by_name`, `to_address`, `reply_to`, `subject`, `raw_text`, `raw_html`, `cleaned_text`, `thread_messages`, `processing_error`, `metadata`, `attachment_ids` | `open_case` |
| `phone_calls.calls` / `call_shell` | `phone_calls`: `id`, `external_call_id`, `external_conversation_id`, `communication_projection_id`; `phone_call_participants`: `id`, `phone_call_id` | `evidence` |
| `phone_calls.calls` / `active_call` | `phone_calls`: `id`, `raw_snapshot`, `provider_facts`, `recording_url`, `recording_attachment_id`; `phone_call_participants`: `id`, `phone_call_id`, `phone_number`, `email`, `display_name`, `phone_number_hash`, `email_hash`, `provider_participant_id`, `metadata` | `open_case` |

Processing evidence expands to deferred children: `inbox_proposals` columns `id`, `inbox_email_id`, `summary`, `participants`, `translations`, `metadata`; `inbox_proposal_actions` columns `id`, `proposal_id`, `description`, `payload`, `execution_error`, `metadata`; `inbox_discrepancies` columns `id`, `proposal_id`, `action_id`, `description`, `expected_value`, `found_value`, `metadata`, all in section `processing` with `open_case`. Include exact delegated message/notification/file retained evidence, including `shared_record` attachments; no blanket copied-payload allowance. `integrations.user_credentials`, owned by people-ops, has no retained-secret allowance: unsafe deletion refuses or fails. An early interrupted run may keep inactive pointers for retry but cannot report complete.

For each message/file owner declare `staff_files` and `outbound_files` (`evidence`), `shared_files` (`shared_record`) and `processing_files` (`open_case`) for `attachments`: literal columns `id`, `entity_id`, `record_id`, `file_name`, `storage_path`, `storage_metadata`, `url`, `content`. Staff/outbound files stay only with their retained correspondence; shared files require another live record and processing files require deferred inbox/call work. Emit separate declarations/sections for each reason, and only actual owner-supplied `retainedRecords`, never guessed attachment rows or assignment identities. Channels/inbox flatten delegated sections under their own invoking class, with the same explicit declarations; the runner stamps that class's id. Use the attachments owner's returned `attachmentId` as the exact attachment `rowId`, never the message/record id. Owner metadata/history/byte-evidence capabilities are required before G6 can certify retained files; missing support remains incomplete and cannot justify a foreign-table read.

Every retained section states its endpoint. Correspondence, attribution, threading/deduplication and cleared colleague shells use `retainedUntil: null`: no age set is specified for them here. Colleague notification/delivery cleanup may remove its own rows but supplies no deadline for these shells. `processing` and `active_call` also use null, with the explicit cause that completion requires processing/call termination followed by a retried erasure, not a scheduled age bound. Shared files remain until the last live reference is removed; retained correspondence files have no end set. No seven-day counter bound is applied to these records.

### Table coverage and independent probes

**DEC-G — The tenant-export reader and its declarations** owns separate `tableExports` and scan mode. C5's “Declarations and row subsets” owns `tables`, `entityIds`, `covered_via_seam` and `seams`; **R3-2 — The registry carries the whole `privacy.ts` default export** owns collection. Declare only own-module tables, once. Complex relation-based slices or unhandled remainders in messages/channels/inbox/calls stay explicitly baselined until full coverage exists; finding one person's copies is not a whole-table exemption. Shared notifications, push deliveries, attachments and credentials remain declared by their owners: consuming classes list actual discovered entity ids, and seam claims require the owner's `{ id, handlerService, entityIds }` plus consuming class ids. Use no foreign-table class claim. Dead letters, settings, throttles and the seven-day counter need reviewed classifications; a duration alone is not C5's `retention_bounded`, which requires a declared set. Preserve unresolved baseline entries.

After canonical-column review, `noSearchableText` lists `message_recipients`, `message_confirmations` and `channel_thread_tokens` on their respective owning classes; id/presence probes still apply. Owner test helpers capture all fixture row keys and tenant/organization attribution before erasure, then probe those exact keys even if the parent is gone. Cover recipients, objects, tokens, confirmations, thread/reaction rows, inbox children/lookups and participants; assert absence or this run's exact retained evidence. Id-only tables may declare `noSearchableText` after column review, but still require presence checks. A join to a deleted parent cannot prove absence. Test probes return only presence and fixture-id references, with no production route. Production owner readers use tenant-exit's exact `PrivacyTableReader` (“Shared owner-reader contract”) for both `export` and `scan`, its read-only transaction, stable ids, 1–100 batches and explicit ownership/decryption/failure gaps.

Changed queued notification/push/extraction/reprocess/counter jobs preserve valid top-level `tenantId`, optional `organizationId` and their real `jobType`. Verification's queue-owned `findValuesByScope` checks scope before values, including coalesced pending payloads; malformed/unscoped/sealed jobs remain gaps. No queue-file fallback.

### Inbox lookup and processing barrier

`inbox_ops` adds `inbox_email_privacy_participants`, with tenant, organization, email id, nullable `contact_entity_id`, nullable `contact_entity_type`, and nullable `email_hash`. Parsing writes hashes for every parsed participant address, including the original sender in parsed threads; extraction adds the enriched participants' typed CRM matches and hashes before any action executes. The lookup is independent of proposal status. The hash is `hashForLookup` over trimmed, lower-case email with no context, written whether encryption is on or off; matching uses the contract's `lookupHashCandidates`. `mercato inbox_ops fill-privacy-lookups --tenant <id> [--after <cursor>] [--batch-size <1..100>] [--apply]` decrypts existing emails/proposals and fills empty typed matches/hashes under C1's initial-coverage convention; non-empty hash repair belongs to B1 Phase D's “Coverage-owned hash refreshes”, which invokes this owner implementation under “Maintenance write safety”, recomputing verified addresses under the current secret rather than treating generic coverage-fill permission as overwrite authority; the contract's bounded decrypting fallback covers incomplete fills and reports truncation as incomplete. Register the hash for B1 Phase D rehashing (DEC-F). Lookup rows are coverage-declared under this class and removed on erasure; they are internal, not user-editable.

A locked email in `processing` is retained as `open_case`, and its copies are left and reported for retry after processing. All worker claims, reprocess requests and erasure serialize on that email row. Otherwise erasure sets `inbox_emails.anonymized_at` in the same transaction as clearing; every claim/reprocess refuses a marked row. The final extraction write and message-copy creation re-check the locked row. A worker paused after claim therefore prevents erasure from claiming success; a late queued reprocess cannot restore cleared text. Redelivery still meets the retained deduplication keys.

### Modules assigned after the council review

**DEC-J — Modules with no coverage owner** assigns `packages/channel-*` here. The family had no coverage owner. The nine packages — `channel-apns`, `channel-discord`, `channel-expo`, `channel-fcm`, `channel-gmail`, `channel-imap`, `channel-resend`, `channel-ses` and `channel-smtp` — were read in their modules. None has an entity, a migration or a snapshot, so none has a table to declare. What they keep about a person is stored by other modules:

| Packages | Person data found | Decision |
|---|---|---|
| `channel-gmail`, `channel-imap`, `channel-discord` (inbound) | Each adapter normalizes inbound mail or chat for the `communication_channels` ingest, which writes conversations, external messages, channel links and `messages` rows (`communication_channels/lib/adapter.ts`; `packages/channel-gmail/src/modules/channel_gmail/lib/adapter.ts`). A per-user mailbox keeps its credential in `integrations` | **Covered** by the channels and messages classes here, and only people-ops' `integrations.user_credentials` for personal credential deletion after disconnect and the records barrier |
| `channel-discord` (AI proposals) | A reply proposal is a `messages` row of type `channel_discord.ai_reply_proposal` whose source is `messages.message` and the inbound message's id; its subject is a summary of the inbound message and its body a drafted reply (`lib/ai-proposal.ts`; `lib/ai-proposal-contract.ts`). Channel state holds the gateway session, sequence and bot user id (`lib/channel-state-store.ts`) | **Design**: `clearForErasure` also clears every message whose source is `messages.message` and a cleared inbound message's id, under the inbound rule. `messages.message` is the messages module's own record kind, so no other module's knowledge is needed. Channel state holds nothing about a person |
| `channel-discord` (senders) | A Discord user is named by a numeric id, which is neither an email address nor a phone number | **Known limit**: no alias matches it. Their messages are found only through a conversation whose `contact_person_id` is the person |
| `channel-smtp`, `channel-ses`, `channel-resend`, `channel-apns`, `channel-fcm`, `channel-expo` | Outbound transports. They send what `messages`, `notifications` and `push_notifications` give them and keep only the tenant's credentials and integration state (`packages/channel-smtp/src/modules/channel_smtp/lib/preset.ts`; `packages/channel-ses/src/modules/channel_ses/lib/preset.ts`; `packages/channel-resend/src/modules/channel_resend/lib/preset.ts`). Device tokens live in `devices` | **Exempt**: no stored person data. Sender addresses in credentials are the tenant's configuration. Integration log lines are bounded by retention, as the people-ops spec states |

A later channel package that adds a table declares it in its own `privacy.ts`. Duplicate-ingest handling preserves erased external reaction deletion; the privacy mark/cleared sender state on the source prevents recreation from a repeated provider event.

### Schema and behaviour changes

- **`messages.direction`** — `internal`, `inbound` or `outbound` — is server-only. Trusted compose callers may set it; `inbox_ops` sets `inbound` on email copies and `outbound` on staff reply copies. Omitted direction is inbound for trusted `inboundFromChannel`, outbound for a server-resolved `sourceChannelType` or an outside address, and internal otherwise. Client request schemas omit it and `POST /api/messages` strips it before validation.
  - `mercato communication_channels fill-message-directions` copies each existing link's stored direction through `messagePrivacyService.recordDirections`; conflicting evidence remains unresolved. Non-channel rows with an outside address follow the verified compose rule only when their source is known; ambiguous rows remain null.
  - `mercato inbox_ops fill-message-directions` marks `inbox_ops.email` inbound and `inbox_ops.reply` outbound, correcting prior fills; the channels command leaves those source-owned rows alone, so order does not matter.
  - `messages.checkErasable` refuses before any mutation with `MESSAGE_DIRECTION_UNRESOLVED` while any matched message with an outside address lacks direction. The refusal names both fill commands. Dry run counts unresolved rows. No apply guesses inbound.
- **Hashes** are written by each module and filled by its command, with the contract's bounded fallback: `messages.external_email_hash`, `external_messages.sender_identifier_hash`, both call participant hashes, and the inbox lookup table's `email_hash`. Email uses the contract's normalized form with no context; phone participants use its shared digits-only helper. The B1 sender hash retains B1's stored-identifier normalization; formatted phone senders use the bounded fallback, hashing `normalizePhoneDigits` of verified decrypted text against `phone_hashes`, with truncation reported incomplete. Do not assume that stored sender hashes use digits-only normalization. Initial coverage fills use C1's locked empty-only convention. Non-empty old-secret repair is expressly owned by B1 Phase D, “Coverage-owned hash refreshes” and “Maintenance write safety”; its coordinated refreshes cover all four modules and must recompute stale non-null values under the current secret.
- **`phone_calls.anonymized_at`**: ingest of a marked call updates only status, timings and duration. It writes no participants, raw snapshot, provider facts, recording URL or recording attachment, including on a re-ingest.
- **Daily recipient counter**: add an idempotent scheduled worker, registered by `messages/setup.ts`, that deletes `message_external_recipient_days` rows whose UTC day is older than seven days, per tenant in batches of at most 100. Its hash has a separate context and cannot be matched by subject; the privacy table declaration is bounded by this new prune, not by an existing cleanup. This is an operational counter, not subject history.
- **Indexes** are tenant-led on every hash, inbox typed contact lookup, and message source. Existing indexes stay.

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
- A provider-only chat account, including an unlinked Discord id with no email or phone, cannot be selected by the contract. Its messages are found only through a conversation linked to a CRM person. Every communication run reports this provider-account limit; no unsupported identifier flag is added.
- In a conversation whose contact is someone else, an erased person who was only copied in keeps their address in that conversation's stored headers.
- A participant named only in free text, with no extraction-time CRM match, action match or parsed email address, is not found. Pending and rejected proposals with a typed extraction-time match are covered.
- A person already anonymized in the CRM has no address left to compute aliases from; a class released later cannot find their address-keyed messages.
- Two people who share an address share its hash.
- In OSS, the only way to keep correspondence that is needed for a dispute is not to run the erasure; a legal hold is an enterprise control.
- A staff user has no owner-provided address alias today. Their `forwarded_by_address`/name, the outside fields on inbox message copies, and address-only call participants cannot be reached by staff id. Staff exports omit mail merely forwarded by them and address-only calls; every staff run lists these gaps as unresolved coverage, alongside its id-based results. This is not a claim of complete staff erasure.
- Delivered push/email copies and calls at the telephony provider remain outside this database erasure.

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
- THEN, with a linked CRM conversation or an email/phone sender alias, its text first appears in export through the messages service and is cleared on erasure

##### Scenario: Unlinked chat account
- WHEN a provider-only chat account has no CRM link, email or phone
- THEN the run reports the provider-account limit without claiming to have found it

##### Scenario: Inbound mail redelivered
- WHEN an inbound email tied to an erased person is delivered again
- THEN it is still recognised as a duplicate and is not processed

##### Scenario: The copy of an inbound email
- WHEN a person matched at extraction is erased before any proposal action executes
- THEN the email's copy in `messages` remains, with no subject, body or address, although its outside address was the forwarder's

##### Scenario: Encryption off
- WHEN encryption is off and a message is sent to an outside address that is then erased
- THEN the message is found by its address hash and its address is cleared

##### Scenario: A derived proposal
- WHEN an inbound chat message that has an AI reply proposal is cleared
- THEN the proposal's subject and body are cleared too

##### Scenario: A call read again
- WHEN a cleared call is ingested again from the provider
- THEN only status, timings and duration update; participants, snapshot, provider facts and recording stay cleared

##### Scenario: A staff user's mailbox
- WHEN a staff user with a connected mailbox is erased
- THEN the channel disconnects and clears its pointer in the records group; after every records class succeeds, only people-ops' `integrations.user_credentials` deletes the freshly listed personal credentials

##### Scenario: Unresolved direction
- WHEN a matched message with an outside address has no direction
- THEN pre-flight refuses before any write and names both fills

##### Scenario: Notification copies
- WHEN a cleared inbound message has notifications and push deliveries for two recipients
- THEN every stored subject/sender variable and payload is cleared through the owning services

##### Scenario: Inbox processing
- WHEN extraction has claimed a matched email and is paused
- THEN erasure retains it and its copies as `open_case`; retry after completion clears both and a marked row cannot be reprocessed

Frozen by: `packages/core/src/modules/messages/__tests__/delete-for-actor.characterization.test.ts`, `packages/core/src/modules/phone_calls/__tests__/ingest-replaces-participants.characterization.test.ts`

## 📝 Architecture

- Each module owns `privacy.ts`, its handler, internal blanking, DI and coverage declarations. No peer table is accessed directly.
- `messages` owns source-based export/clear, derived-message traversal, notification propagation and the counter prune. Channels owns linked-message discovery, fills and channel-copy clearing. Inbox owns its lookups and processing barrier; calls owns its ingest guard.
- Communication Phase 1 owns channel disconnect/reference clearing in the records group, and A9's channel-cascade call to `deleteUserCredential`. In a DSR run, R4-1's call is placed in the credentials group: people-ops' `integrations.user_credentials` alone deletes credentials, after the records barrier (Classes, "DSR call placement"). No communication handler queries integrations tables. A9's separate ordinary-delete transaction may ship first.

| Touchpoint | Mechanism | Absent |
|---|---|---|
| Classes → addresses | Owner aliases or identifier subject | Id matches only; stated staff gap |
| Channels/inbox → message text | `messagePrivacyService` by DI, selectors by id or source | Section incomplete |
| Messages → channel copies | `channelPrivacyService` by matched message id | Section incomplete |
| Messages → notification → push copies | Owning services by source, then notification ids | Section incomplete if copies cannot be cleared |
| Classes → files | Attachments seam, ambient transaction and origin | Required capability absence refuses pre-flight; late failure is incomplete exit 2; durable objects use `filesPending` |

## 📝 Data Models

| Table | Change |
|---|---|
| `messages` | Nullable `direction`; tenant-led hash and source indexes; existing index stays |
| `external_messages` | Nullable `sender_identifier_hash`, tenant-led index |
| `inbox_emails` | Nullable `anonymized_at` checked by every processing path |
| `inbox_email_privacy_participants` | Internal UUID row with tenant/organization, email id, nullable `contact_entity_id`, `contact_entity_type`, `email_hash`, `created_at`, `updated_at`; tenant-led indexes on typed contact and hash; no cross-module ORM relationship |
| `phone_call_participants` | Nullable `phone_number_hash`, `email_hash`, tenant-led indexes |
| `phone_calls` | Nullable `anonymized_at` |

Additive migrations and snapshots. Internal lookup rows and marks have no edit form. Existing editable entities keep `updated_at`, response `updatedAt` and optimistic locking. All new service inputs use zod and `PrivacyScope`, with organization constraints carried through every call. API `pageSize` stays at or below 100; scans use the contract's bounded keyset routine.

## 📝 API Contracts

- The contract owns aliases and identifier derivation (DEC-A), registry discovery (R3-2) and fallback bounds. The erasure spec owns pre-flight, all history records and both strip passes (R3-1/DEC-B), and attachments. No new privacy-contract member.
- New DI `messagePrivacyService` exposes `exportForPrivacy({ scope, selector })`, `clearForErasure({ scope, selector, rule, dryRun, origin })` and `recordDirections({ scope, selector, direction, overwrite })` and read-only `checkForErasure({ scope, selector })`. Selector is `{ messageIds }` or `{ source: { entityType, entityIds, messageType } }`. Export returns deduplicated sections flagged `freeText`, including truncation. Clear handles derived messages, attachments and notifications and returns `{ affected, historyRecords, sections }`, carrying exact C4 retained shell/file evidence from every owner. Callers preserve those sections in their class results. `checkForErasure` returns the selected history records and unresolved-direction count; the messages, channels and inbox classes call it from their own `checkErasable` for every id/source selector before the erasure engine permits a write. Thus source-only and old-address messages receive the same refusal, with no reliance on class execution order.
- New DI `channelPrivacyService.clearMessageCopiesForErasure({ scope, messageIds, dryRun })` clears payload and metadata by message id, dropping `to`, `cc`, `bcc` and sender-bearing headers even on outbound links, retaining only threading message ids; result `{ affected, historyRecords, sections }`, with exact retained threading-row evidence. This scrub never calls the messages service again, so the reverse hand-off cannot recurse.
- Notification and push methods follow Source notification copies. Existing signatures stay. Creation/delivery retries re-read cleared source message/notification state, rather than inserting captured text; a cleared source renders the localized placeholder. Already delivered copies remain a reported limit.
- **Compose:** optional `direction` belongs only to the trusted command schema. Omit it from `composeMessageRequestSchema`, strip it in `POST /api/messages`, and derive it from server facts. A channel reply without an address is outbound. Existing URL, ACL and response contracts stay; OpenAPI uses the client schema.
- **Credential method:** DI `integrationCredentialsService` gains `deleteUserCredential({ scope: PrivacyScope, userId, credentialId })` hard-deletes the named row only with `tenant_id = scope.tenantId`, `user_id = userId` and, when present, `(organization_id = scope.organizationId OR organization_id IS NULL)`. Tenant-wide calls keep each row's actual organization predicate. Include soft-deleted rows; never act on `user_id IS NULL`, another user or another tenant. Validate with zod; use the caller's transactional manager through DI, return safe metadata/history only, and write no secret snapshot. Missing row is idempotent. All channel/A9/repair callers pass the trusted scope. For ordinary A9 cleanup, recheck reference ownership and clear the channel pointer only after successful/idempotent deletion; a failure rolls back that cleanup transaction. A9's channel cascade calls this method. In a DSR run, `integrations.user_credentials` alone deletes, in the credentials group, through the same integrations service (Classes, "DSR call placement"); there is no communication credential class, and no records-group handler calls a deleting credential method. No credential values enter the history plan.
- **Commands:** messages, phone_calls and communication_channels `fill-privacy-hashes`, inbox_ops `fill-privacy-lookups`, and communication_channels/inbox_ops `fill-message-directions` require `--tenant <id> [--after <cursor>] [--batch-size <1..100>] [--apply]`, default preview and batch 100. Use immutable UUID keysets, bounded batch transactions, locked empty-only initial coverage writes and an opaque scope-bound continuation with scanned/filled/skipped counts. Preview writes neither database nor KMS. Rerun from the start catches earlier-id insertions. Source-specific correction of a known erroneous inbox direction follows the explicit direction rule above, never a generic hash overwrite. No implicit all-tenant decryption or plaintext/hash logging.
- `mercato communication_channels fill-privacy-hashes` is an additive wrapper that delegates `sender_identifier_hash` work to exactly `mercato communication_channels fill-lookup-hashes --tenant <id> [--batch-size <1..100>] [--apply]`, owned by **R3-12 — Fill commands for module-written hashes** in B1. It uses one implementation and B1's stored-sender normalization; the canonical command resumes by rerunning from the start, while the wrapper's cursor only narrows its bounded coverage traversal. It introduces no new canonical B1 flag.
- **Non-empty hash maintenance:** B1 Phase D's “Coverage-owned hash refreshes” explicitly coordinates `messages`, `inbox_ops`, `communication_channels` and `phone_calls`; its owning commands recompute stale non-null old-secret hashes from verified decrypted sources under the current secret, leaving already-current targets unchanged. The named commands route empty targets through C1's initial-fill writer and stale populated targets through B1's explicitly owned maintenance updater; no extra CLI mode or flag is invented. This is the B1 maintenance/rehash path, not implicit permission for any new coverage fill to overwrite populated hashes. Apply its “Maintenance write safety”: exact tenant/null-safe actual organization, conditional source-and-target comparison, per-row savepoints, no `updated_at` bump or protected-value snapshot. Missing secret/keys refuse before mutation; unreadable source, collision or concurrent change preserves that row and leaves maintenance incomplete. Ordinary writers leave null without a lookup secret. Email uses the normalized no-context `email_hashes` form, phone participants use C1's `normalizePhoneDigits`, and sender hashes retain B1's exact normalization. **DEC-F — The B1 hand-offs** owns mapped `mercato entities rehash-lookups` and Phase D; the customers columns and `mercato customers fill-lookup-hashes` are introduced there and do not exist today.

## 📝 Edge Cases & Failure Scenarios

| Case | Behaviour |
|---|---|
| A message with an outside address and no direction yet | Pre-flight refuses with unresolved count and both fill commands, before writes |
| The messages hash fill has not run for a tenant | Rows with an outside address and no hash are scanned by decrypting, within the contract's bound; the run says the scan was used |
| Encryption is off | The module writes the address hash itself, so the address is still found |
| The email's copy in `messages` | Found by its source, not by its outside address, which is the forwarder's; cleared with the email |
| The channels fill runs after the inbox_ops fill | It writes only rows with no direction, so the copies stay inbound |
| A message derived from a cleared inbound message | Cleared under the same rule |
| A staff user who is the fallback sender of inbound mail | That mail is not theirs; it is handled for its outside sender |
| A person with several addresses | Every alias hash is matched |
| A number stored in a different format from the CRM's | Both sides reduce to digits before hashing |
| A conversation with a company's shared mailbox | The company is not a person; nothing is cleared |
| An executed proposal's order or message | Still points at the proposal row, which remains |
| A recording stored as an attachment | Released through the seam |
| A call still in progress | `retained` / `open_case`, `retainedUntil: null`; retry after completion |
| Tables with no tenant column | Reached only through their message, whose tenant is checked first |
| The run's process has a different lookup secret from the app | Nothing is found by address; the dry run prints how many records were matched by address |
| `erase --email` or `--phone` with no lookup secret configured | Refused with exit 1, as the erasure spec says |
| A records class fails after disconnection | Credentials remain; deletion belongs only to the later credentials group |
| Pending/rejected proposal | Found through typed extraction-time match without executing an action |
| Unmatched original sender | Found by parsed address hash as identifier subject; redelivery stays duplicate |
| Staff address-only forwarding or call details | Reported as unresolved staff coverage, not called erased |

## 📝 Migration & Backward Compatibility

Schema, service and CLI additions preserve routes and existing signatures. Direction is server-only. Run both fills before erasing ambiguous historical messages; pre-flight refuses unresolved matches. Inbox lookup fills and the bounded fallback cover old proposals. B1 Phase D refreshes old-secret hashes. Upgrade notes name the new refusal and processing retry. Existing user message-deletion semantics stay. The new scheduled seven-day prune removes operational counts, not subject history. **R3-5 — Holds, honestly** applies: enterprise owns legal holds, OSS record retention has manual exclusions, and operational counters have no subject hold support. No local migration is applied in this spec task.

## 📋 Phasing

Each phase ships its module's export and erase together.

| Phase | Modules | Depends on |
|---|---|---|
| 1 | `messages` with `communication_channels` — ingest couples them — and the direction of `inbox_ops` copies | The contract's and the erasure spec's addenda, including the identifier subject: a derived id (contract spec, "A subject that is only an identifier") and `erase --email` and `--phone` across dry run and apply (erasure spec, "Erasing by email or phone", its Phase 4); erasure spec, Phase 3 |
| 2 | `inbox_ops` | The same |
| 3 | `phone_calls` | The same |

## 📋 Implementation Plan

### Phase 1
1. Characterize sender deletion in `messages/__tests__/delete-for-actor.characterization.test.ts`.
2. Add direction, trusted derivation, client stripping and both fills. `privacy-direction.test.ts` covers inbound/outbound chat, fill order and unresolved refusal; `api/__tests__/route.privacy-direction.test.ts` proves a client cannot set direction.
3. Add hashes/fills/indexes. `privacy-hashes.test.ts` covers encryption on/off, normalized no-context email and digits-only phone alias parity, bounded fallback and scope; the initial-coverage writer leaves populated targets alone and routes stale ones to the B1 updater. Test the channels wrapper delegates to R3-12's exact implementation. B1 Phase D maintenance cases seed non-null old-secret hashes in messages/channels/call participants, recompute under the current secret, and assert preview/rerun, no-secret refusal, unreadable-source preservation, source/target conditional updates and unchanged versions across tenant/organization controls.
4. Implement classes and export/clear seams. `privacy-message-copies.test.ts` covers chat export, old linked email addresses, identifier-only outbound headers, derived proposals, all history records, inbound file release, retained outbound files and staff attribution export. Test C4's channel disconnect/reference clearing without records-stage credential deletion, integrations-owned re-listing of connected/disconnected/soft-deleted rows, records failure preserving credentials, scoped A9 retry and user/tenant/organization predicates. Test the placement under Classes: in a DSR run the channels class makes no credential call during records, integrations deletes every freshly listed row in the credentials group, A9's channel cascade calls the same `deleteUserCredential`, and there is no communication credential class. `privacy-reaction-erasure.test.ts` checks external actor/provider ids disappear by constraint-safe deletion, staff attribution ids remain, and duplicate ingest cannot recreate erased external reactions.
5. Implement notification/push source clearing; `privacy-source-notifications.test.ts` checks two recipients, title/sender/payload markers, absent-service incomplete results and retries. Register the scheduled counter prune; `external-recipient-prune.test.ts` checks an injected clock, seven-day boundary, batches and tenant isolation.
6. TC-PRIVACY-COMM-001 and 002; register module-owned C8 `PrivacyTableReader` implementations in both modes before G6, declare proven C5 coverage/seams, exact retained evidence/end causes and orphan-safe captured-row probes. Test scoped queued copies through the producer/scanner's real scope contract.

### Phase 2
1. Add inbox lookup entity, migration/snapshot, parser/extraction writes and fill. `privacy-inbox-lookups.test.ts` covers unexecuted and rejected matches, unmatched sender, empty-only coverage fill and fallback. B1 Phase D's coordinated refresh test changes the secret with an existing non-null participant hash, proves normalized no-context email alias parity, preview/no-write and rerun behavior, exact tenant/organization controls, no-secret refusal, unreadable-source preservation, source-and-target conditional updates and unchanged user-visible versions.
2. Full clearing, in-transaction release, copy clearing and processing mark. `privacy-inbox-erasure.test.ts` checks every listed field, file ownership, retained hash report and history records. `privacy-inbox-processing-race.test.ts` pauses after claim, observes open-case retention, completes extraction, retries erasure, and refuses queued reprocessing.
3. TC-PRIVACY-INBOX-001.

### Phase 3
1. Characterize ingest replacing participants in `phone_calls/__tests__/ingest-replaces-participants.characterization.test.ts`.
2. Hashes, fill, mark and scalar/participant guard. `privacy-call-ingest.test.ts` checks provider ids, metadata, both hashes, snapshot, provider facts and recording before/after re-ingest.
3. TC-PRIVACY-CALLS-001; remove only C5-proven table/subset claims from baseline, add verification fixtures and archive Delta only if capability directory is adopted.

| File | Action |
|---|---|
| `packages/core/src/modules/{messages,communication_channels,inbox_ops,phone_calls}/{privacy.ts,lib/privacy/*,di.ts,cli.ts,data/entities.ts,migrations/*}` | Create / modify, including snapshots |
| `packages/core/src/modules/messages/{commands/messages.ts,data/validators.ts,api/route.ts,setup.ts,workers/privacy-recipient-prune.ts,lib/externalEmailBudget.ts}` | Direction, trusted input, hashes and new scheduled prune |
| `packages/core/src/modules/communication_channels/commands/{ingest-inbound-message.ts,deliver-outbound-message.ts}` | Hash writes and duplicate-ingest privacy checks |
| `packages/core/src/modules/inbox_ops/{lib/emailParser.ts,lib/messagesIntegration.ts,subscribers/extractionWorker.ts,api/emails/[id]/reprocess/route.ts}` | Lookups, source directions and processing barrier |
| `packages/core/src/modules/phone_calls/commands/calls.ts` | Ingest guard |
| `packages/core/src/modules/{notifications,push_notifications}/{lib/privacy/*,di.ts}`; `packages/core/src/modules/messages/subscribers/message-notification.ts` | Copy clearing and retry-safe reads through services |
| Named unit tests and each module's `__integration__/` tests | Create |

## 🧪 Integration Coverage

Every test creates its own tenants, users, records and files with fixtures/APIs, shares the app's lookup secret, and removes remaining records/files in `finally`. No demo data. Use authorized APIs and tenant-scoped internal reads.

| Test | Covers |
|---|---|
| TC-PRIVACY-COMM-001 | An unlinked portal account's published email alias reaches messages/channels/inbox/calls without a CRM link. Unit helper fixtures also supply phone aliases to all applicable channel/call predicates; today's portal owner promises email only, so no integration fixture invents a portal phone field. Missing required aliases report incomplete rather than a clean result. Staff export includes sent/received, actions/confirmations, assignments and reactions, excluding fallback authorship. Linked chat text appears in export before erase; unlinked chat and staff address-only forwarding/call fixtures produce explicit limits. Other tenant absent |
| TC-PRIVACY-COMM-002 | Recipient erase preserves colleague access; identifier dry run/apply clears inbound text/files and two recipients' notification/push markers. Outbound text/files stay while link `to`/`cc`/`bcc`/headers clear. Linked inbound old-address email clears; null direction refuses before writes. Staff disconnect/reference clearing precedes deletion only by integrations; a records failure keeps all credentials, and retry re-lists them without channel pointers. The DSR call-order case asserts no credential call during records and integrations-only deletion in the credentials group; A9's ordinary delete uses the same `deleteUserCredential`. Check message detail, notification list and file download API/UI paths |
| TC-PRIVACY-INBOX-001 | Include an unlinked portal account matched only by email alias, without a CRM record. Ingest extraction-matched unexecuted email, rejected proposal and unmatched original sender. Person/address export includes them. Erasure clears all listed fields, subject/files and source message copies; reply text/files stay. Check email detail, `/api/messages` by source, download, reprocess refusal, duplicate redelivery and retained-hash report; paused processing stays open-case until retry |
| TC-PRIVACY-CALLS-001 | Include an unlinked portal account reached by its real email alias; unit fixtures test supplied phone aliases, and unsupported owner aliases fail closed. Seed provider ids, metadata, hashes, snapshot, facts and recording. Export then erase; detail/download show clearing. Re-ingest updates only status/timings/duration and restores none; another tenant unchanged |

## 📝 Risks & Impact Review

#### A credential is deleted before the records barrier
- **Scenario**: a records-group handler deletes a mailbox credential, so a later records failure leaves the account recoverable without it.
- **Severity**: High
- **Affected area**: personal credentials and retry safety
- **Mitigation**: The channels class only disconnects and clears pointers in records; `integrations.user_credentials` alone deletes, after every records class succeeds, by a fresh user-id listing. Unit tests and TC-PRIVACY-COMM-002 assert no records-stage deletion.
- **Residual risk**: A credentials-group failure after disconnect leaves the account locked, with its channels disconnected, until a re-run, as C4 states.

#### The company loses a record it needed
- **Scenario**: A customer's inbound emails are cleared and a dispute follows.
- **Severity**: High
- **Affected area**: the tenant's correspondence
- **Mitigation**: The dry run lists what would be cleared; staff-written replies are kept; an enterprise hold stops the run; assumption 2 states the rule.
- **Residual risk**: Irreversible once applied, and OSS has no hold.

#### Staff text is cleared by mistake
- **Scenario**: Direction has not been filled; guessing inbound would destroy staff text.
- **Severity**: High
- **Affected area**: messages written before the upgrade
- **Mitigation**: Pre-flight refuses unresolved matches before any mutation, naming both fills; trusted-only direction blocks client spoofing.
- **Residual risk**: An incorrect trusted writer or fill; the refusal protects missing direction only.

#### An erased person's words remain
- **Scenario**: They are quoted in a reply by staff, which is kept.
- **Severity**: Medium
- **Affected area**: erasure completeness
- **Mitigation**: Stated as a limit in the run's report for this class.
- **Residual risk**: Quoted text in retained messages.

#### An outside correspondent is not found
- **Scenario**: Encryption is off, or a message predates the hash, so `external_email_hash` is empty and an erasure reports nothing found.
- **Severity**: High
- **Affected area**: messages to and from outside addresses
- **Mitigation**: `messages` writes the hash itself whether or not encryption is on, a fill command covers existing rows, and the fallback scan runs until it has. The dry run says when the scan was used.
- **Residual risk**: A process with a different lookup secret from the app, as for every address lookup.

#### An inbound email survives in `messages`
- **Scenario**: A customer matched in inbox_ops is erased, and the email's copy in `messages` keeps the whole thread, because its outside address is the forwarder's and nothing marks it inbound.
- **Severity**: High
- **Affected area**: inbound mail copied by inbox_ops
- **Mitigation**: The inbox_ops class clears its copies by source through the messages service, under the inbound rule. Copies are composed as inbound from now on, and the inbox_ops fill marks existing ones. TC-PRIVACY-INBOX-001 checks the copy.
- **Residual risk**: Text staff copied from the email into a message of their own, as with any quote.

#### Other people's call details are cleared
- **Scenario**: A call had two outside parties and one is erased.
- **Severity**: Medium
- **Affected area**: that call
- **Mitigation**: Stated in assumption 8; the dry run reports every call it will clear, before apply.
- **Residual risk**: Accepted; in Enterprise a hold keeps the call.

#### A retained deduplication digest remains linkable
- **Scenario**: An operator guesses subject/sender/body text and recomputes inbox_ops' unkeyed SHA-256 content hash.
- **Severity**: Medium
- **Affected area**: retained inbox deduplication shells
- **Mitigation**: Report the hash and message ids as retained pseudonymous data solely for redelivery prevention; never label the shell anonymous.
- **Residual risk**: Guess confirmation remains possible while the deduplication key is kept.

#### The wrong person's messages are cleared
- **Scenario**: Two people used one address.
- **Severity**: Medium
- **Affected area**: address-keyed messages
- **Mitigation**: The dry run shows the count found by address.
- **Residual risk**: A shared mailbox used by several private people.

## Final Compliance Report — 2026-11-16

- **Reviewed:** root `AGENTS.md`, `.ai/specs/AGENTS.md`, the contract's handler obligations and addendum. Checked the notification, push and attachment module guides for the new service boundaries; no runtime tests were run.

| Rule | Status | Notes |
|---|---|---|
| No cross-module table access | Compliant | Aliases, service calls by id and by source, the attachments seam |
| Lookups on a hash | Compliant | Written by each module itself, `messages.external_email_hash` included, with encryption on or off |
| Tenant scoping | Compliant | Tables without a tenant column are reached only through a tenant-checked parent; the new indexes are led by the tenant |
| Additive schema | Compliant | — |
| Every module assigned | Compliant | `packages/channel-*` hold no table; one design item and one limit recorded |
| Integration coverage | Planned | Four self-contained scenarios including API/UI, history, files, races and scope; not run |
| Credential ordering | Compliant | Channels disconnect and clear pointers in records; only `integrations.user_credentials` deletes, in the credentials group, through the integrations service whose `deleteUserCredential` A9 calls |
| Staff address/provider-only account gaps | Stated limits | Explicit in each relevant run report |

**Verdict:** approved for implementation. Every assumption is settled, including the R4-1 DSR call placement. Phase 1 is not started before the erasure spec's Phase 4 has landed.

## Changelog

### 2026-11-16
- Written autonomously with resolved assumptions.
- Rewritten after independent review. The staff-versus-outside rule could not be decided from stored data, so messages gain a stored direction, and the "only outside party" condition is dropped for a rule based on direction alone. The correspondent kind whose id was a hash is replaced by the contract's identifier subject. Chat and text messages, which have no address, are found by the channels class and cleared through the messages module's service. The inventory of where addresses live in channel links was wrong and is corrected. Inbound mail in `inbox_ops` is blanked instead of deleted, so that references from what it produced still resolve and a redelivery is still a duplicate. A cleared call keeps status updates. Hashes are written and filled by each module. Export and erase ship together. Integration tests use the fixtures that exist, which the first draft said did not.
- Council review (Opus, GPT-5.6 Sol, DeepSeek V4 Flash, Kimi K3.1 Pro), high fixes: **g3-09** — `messages.external_email_hash` was written only by the encryption service while encrypting, so with encryption off or for older rows outside correspondents were never found; `messages` now writes it in every command that sets the address, a fill command and the fallback scan cover existing rows, and a tenant-led index is added. **g3-10** — inbox_ops copies every inbound email, whole thread included, into `messages` under the forwarder's address, and nothing cleared it; the inbox_ops class now clears its copies by source through the messages service under the inbound rule, copies are composed with a direction, and an inbox_ops fill marks existing ones inbound in either order with the channels fill; TC-PRIVACY-INBOX-001 asserts the copy is cleared. Also recorded the dependency on the contract spec's "A subject that is only an identifier" and the erasure spec's "Erasing by email or phone" for erasing an address, and added "Modules assigned after the council review" for `packages/channel-*`: no tables, exemptions with reasons, Discord AI reply proposals cleared with their inbound message, and a stated limit for Discord user ids. From the other fixers: every class states `erasureGroup: 'records'`; identifier subjects cite the contract and erasure specs' sections and exit 1 with no lookup secret; the integrations credential delete acts only on a user's row in the given tenant, never a tenant-wide credential, and may ship first with the program's A9 fix.

- Council round two fixes (GPT-6.1 Sol workers): r5-03 — notification/push copies; r5-07/r5-15 — extraction matches and unmatched sender; r5-16 — direction refusal; r5-17 — credential ordering; r5-18 — staff-address gap report; r5-31/r5-34 — provider fields and re-ingest; r5-32/r5-33 — full inbox clearing and barrier; r5-35/r5-36 — old-address email and trusted direction; r5-44/r5-45 — counter prune and attachment outcomes; g3-20/g3-28 — export and outbound-link seams; g3-29 — provider-only limit; g3-45 — staff attribution; g3-47 — channel direction and hash wording.

- Council round two fixes, pass two (GPT-6.1 Sol workers): aligned aliases, R3-1 plans, scoped credential ownership/ordering, closed outcomes, B1 fill names and maintenance rules, C5 partial/seam coverage and exact retained evidence/probes.

- Council round two fixes, pass three (GPT-6.1 Sol workers): reconciled integrations-only DSR credential deletion and the separate scoped A9 method; consumed C4 history/evidence contracts; added colleague source-shell, outbound/file evidence and unbounded causes; aligned the channels fill wrapper and B1-owned non-null refreshes with C1 initial-fill safety, explicit rotation fixtures and unlinked portal alias tests.
- Council round two fixes, pass four alignment (GPT-6.1 Sol workers): corrected retained-evidence provenance to G6's declarations/matching and C4's existing PrivacyRetainedRecord and section fields, preserving exact handler population, private report/audit evidence and records-before-credentials ordering.
- Council round two fixes, pass six final fixes (GPT-6.1 Sol workers): restate R4-1's integrations-only deletion ownership and required communication/A9 shared-method calls consistently with people-ops; record the unresolved communication DSR call placement across C4's records barrier in the plan, tests, risk and compliance without inventing a resolution.
