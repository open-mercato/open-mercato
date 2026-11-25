# Privacy coverage of OSS modules

> **Tracker:** open-mercato/open-mercato#8593
> **Program:** [program](2026-11-15-gdpr-ready-deployments-program.md)
> **Edition:** OSS code, run by Enterprise: these core-module handlers are what the Enterprise `privacy` module calls ([DSR engine](../enterprise/GDPR/2026-11-16-privacy-dsr-engine.md)). An Enterprise client may enable any of these modules, so every one must be covered before an Enterprise release claims GDPR readiness.
> **GDPR basis:** Art. 5(1)(d), 5(1)(e), 15, 16, 17, 17(3)(b), 20, 32

## TLDR

- Phase 1 fixes a live bug, independent of everything else: deleting a staff user leaves their per-user data and stored mailbox credentials behind because the cleanup subscribers read a field the event never sets, and deleting a portal user leaves its email, email hash, password hash and name.
- After that, every OSS module that stores personal data gets a `privacy.ts` declaration and a handler under the [data-class contract](2026-11-16-privacy-data-class-contract.md). One table below says, per module, what is held, what export returns, what erasure does and what is kept under Art. 17(3).
- Commercial records follow one Art. 17(3)(b) rule: keep a fixed buyer block for a period the tenant chooses, then anonymize through `pruneExpired`.
- AI chat transcripts copy CRM records into colleagues' conversations, where a person's erasure cannot find them. A tenant retention setting ends them.
- Phase 7 lets staff correct a portal user's sign-in email (Art. 16) without closing the account, so the person keeps their orders and claims.
- Enterprise modules (sso, security, record_locks, agent_orchestrator) are covered in [enterprise coverage](../enterprise/GDPR/2026-11-16-privacy-coverage-enterprise.md).

## Overview

The contract spec ships the three roots (`auth:user`, `customers:person`, `customer_accounts:user`). This spec covers every other OSS module, so that an export is complete and an erasure leaves no live copy outside stated limits. Operational copies are bounded by age in the [retention spec](2026-11-16-operational-retention-pruners.md) instead of being erased one by one.

> **Market reference.** WordPress core's eraser model lets each plugin report "removed" and "retained, with message"; Odoo's data-cleaning anonymizes partners that accounting entries still reference. Adopted: per-module outcomes with a retained reason, anonymize-in-place where accounting needs the record. Rejected: blanket deletion of business records, which breaks tax retention.

## Problem Statement

**User deletion leaves data behind (live bug).**

- `auth.user.deleted` carries `{ id, organizationId, tenantId }` (`auth/commands/users.ts:214-223`); the staff user row is hard-deleted.
- `communication_channels/subscribers/user-deleted-cascade.ts` reads `payload.userId` and returns early, so the user's channels stay connected. Even when it ran it only cleared `credentials_ref`; its comment says an integrations retention policy sweeps the orphaned credential, but `integrations/workers/` holds only `health-probe.ts` and `log-pruner.ts`. The unit test passes a hand-written `{ userId }` payload, which hid the bug.
- The enterprise `sso/subscribers/user-deleted-cleanup.ts` reads `payload.userId` too and passes `undefined` into one update and two deletes, with no tenant condition.
- No other module subscribes to `auth.user.deleted`, and no foreign key cascades from `users`. Notifications and preferences, push deliveries, devices (push tokens), session API keys (`api_keys.session_user_id`), private perspectives, dashboard layouts and widgets, onboarding requests and per-user `integration_credentials` stay after deletion.
- Portal-user delete calls `customerUserService.softDelete`, which only sets `deleted_at` and `is_active` (`customer_accounts/services/customerUserService.ts:156-169`); email, email hash, password hash and display name stay.
- Nothing sets MikroORM's `ignoreUndefinedInQuery` today. If it were set, an undefined condition would be dropped and the unfixed SSO code would delete every row of its three tables.

**Coverage.** No OSS module beyond the roots declares its personal data. Facts the rules below rely on: forms anonymize tombstones only fields flagged sensitive (`forms/services/anonymize-service.ts`); a closed warranty claim can return to `in_review` (`warranty_claims/data/constants.ts`); phone-call participants are deleted and rewritten on every ingest; gateway transactions created outside checkout carry no order or customer link; inbound email is copied into `messages` with the forwarder's address, not the customer's.

## Proposed Solution

### Shared rules

- **Owner-only.** A handler touches its own tables. Work on another module's rows goes through that module's DI service, named in API Contracts.
- **`touched` refs and `filesToDelete`.** Every changed or deleted record is returned in `touched`; the orchestrator strips its history, removes it from search and invalidates CRUD cache once, centrally. Each handler lists in `filesToDelete` the attachment ids of records it deleted or anonymized; files of records kept under `legal_retention` are not listed.
- **`open_case` means retry later.** A pending payment, open claim, locked cart or running workflow is reported as `open_case` with `retainedUntil: null`, and nothing in it changes.
- **Staff ids stay as references.** Author, assignee, sender, creator and actor user ids on records about someone else stay. After the user is deleted they point at no one.
- **Free-text mentions are a stated limit.** A subject named inside a comment, note, message body or document about someone else is not found. The deployment docs tell the controller to search and edit by hand when a request names such text.
- **Operational copies are bounded by age.** Notification copies naming the subject, queue jobs, webhook deliveries, integration and sync logs, dead letters and similar copies expire under the [retention spec](2026-11-16-operational-retention-pruners.md). Windows up to 30 days fit the one-month answer period of Art. 12(3); longer windows are disclosed in the docs.
- **Third-party copies** (payment providers, carriers, mail and telephony providers) are outside the platform; the docs carry the Art. 19 notice procedure.
- **Address-only subjects** follow the contract's lookup rule: hash match where the encryption map has a `hashField`, otherwise a decrypting scan of the module's own tenant rows, used only where this table says so.

### Commercial records — Art. 17(3)(b)

- An order is a commercial record when it has an invoice or a payment that is not failed or cancelled; a payment of unknown status counts. A quote never is.
- On erasure a commercial record keeps the buyer block the invoice needs and loses everything else now; quotes and other orders are anonymized at once. Field by field, files included: [CRM and Sales in detail](#crm-and-sales-in-detail). A retained order is reported `legal_retention` with `retainedUntil = placed_at + period`, or `null` when the tenant has set no period.
- The period is the class's `retentionSetting`, `sales.retention.commercialRecordsDays`, in `module_configs`. The tenant chooses it (for example five years from the end of the tax year in Poland, eight to ten in Germany). The platform sets no default; unset means keep, and the docs tell the controller to set it.
- `pruneExpired(scope, olderThan)` anonymizes every commercial record placed before `olderThan`, not only those of erased subjects, in batches of at most `limit`. The Enterprise runner calls it with `now − period`.
- Completed checkout payments follow the same rule with `checkout.retention.completedPaymentsDays`.

## Architecture

### Module table

Subjects: P = CRM person, PU = portal user, S = staff user, TM = team member, R = form respondent, X = known only by email or phone. Roots are specified in the contract spec.

| Module | Subjects | Personal data (tables / fields) | Export | Erase action | Retention (Art. 17(3)) | Notes |
|---|---|---|---|---|---|---|
| auth | S | `users`, `user_consents`, sessions, ACL, sidebar | yes, no secrets | delete (root) | consent proof kept, IP and source cleared | root |
| customers | P | entities, profile, addresses, comments, activities, interactions, links, deal text | yes | delete, or anonymize in place when a deal or retained record links | — | root |
| customer_accounts | PU | `customer_users`, sessions (IP, UA), invitations, verifications, resets | yes | anonymize: placeholder email and hash, no password or name | — | root; Phase 1 reuses the routine for ordinary delete |
| notifications | S | `notifications` (title, body, variables), `notification_preferences` | yes | delete recipient's rows and preferences | — | copies naming others: age bound |
| push_notifications | S | `push_notification_deliveries` (payload) | yes, no tokens | delete | — | also age bound |
| devices | S | `user_devices` (push token, platform) | platform and versions | delete | — | |
| api_keys | S | `api_keys` with `session_user_id` | name and dates | delete the user's session keys | — | `created_by` kept as staff reference |
| perspectives | S | `perspectives` | yes | delete | — | `role_perspectives` exempt |
| dashboards | S | `dashboard_layouts`, `dashboard_user_widgets` | yes | delete | — | `dashboard_role_widgets` exempt |
| integrations | S | `integration_credentials` with `user_id` (mailbox OAuth tokens) | metadata only | hard delete | — | `integration_logs` age bound; states and mappings exempt |
| onboarding | S | `onboarding_requests` (email, names, organization name, password hash until completed) | yes, no hashes | delete rows with the user's id | — | unfinished signups age bound |
| sales | P, PU via person | orders and quotes: `customer_snapshot`, address snapshots, `tax_info`, comments, internal notes, references, line text and metadata; `sales_document_addresses`; notes; credit-memo reason | yes | commercial record: reduce to buyer block; other documents anonymized now; address rows of anonymized documents deleted | commercial record for the tenant's period, then `pruneExpired` | orders found by `customer_entity_id` and `customer_contact_id`; orderless invoices, credit memos and payments have no subject link: limit |
| shipping_carriers | P via order | `carrier_shipments.label_data`, `tracking_events` | via sales | follows the order: kept with a retained order, cleared with an anonymized one | follows order | webhook events and idempotency keys age bound |
| checkout | P, X | `checkout_transactions`: email, first and last name, phone, `customer_data`, accepted consents, IP, UA | yes | completed: keep name, amount, consents, gateway id, clear the rest; failed, cancelled, expired: anonymize; pending, processing: `open_case` | completed payments for the tenant's period | email has no hash: decrypting scan (low volume) |
| payment_gateways | via checkout | `gateway_transactions.gateway_metadata`, `webhook_log`, `redirect_url`, `client_secret`; operation payloads | via checkout | clear those fields; keep provider ids, status, amounts, currency | follows payment | rows not created by checkout carry no subject link: age bound only, limit |
| cart | P, PU, X | `carts` (customer ids, email, note, metadata), lines, `cart_merge_logs.source_snapshot`, `cart_idempotency_keys.response_body` | yes | delete cart with lines, applications and idempotency rows; clear merge-log snapshots; `locked`: `open_case` | — | email by decrypting scan |
| warranty_claims | P, PU, X | claims (`customer_name`, `contact_email`, notes, resolution, return label and tracking), line fault and inspection text, event bodies, registrations (notes, proof file) | yes | `closed` or `cancelled`: anonymize and set `anonymized_at`, which blocks reopening; other statuses: `open_case`; registrations deleted | — | files listed in `filesToDelete` |
| promotions | P | `promotion_code_reservations`, `promotion_code_usages`, `promotion_usages` | yes | delete reservations; null `customer_id` on usages | — | |
| customer_groups | P | `customer_group_memberships` (notes) | yes | delete memberships | — | |
| forms | R (PU or X), S | revisions (answers, `change_summary`), inline uploads and PDF, invitations (email, name), access-audit IP and UA | yes: every revision, consents, invitations, uploads | full-erasure mode | `forms_consent_record` kept as proof of consent | invitation email by decrypting scan |
| form_to_deals | via forms | projected CV and files on the deal, mapped `cf.*` values | via customers | on `forms.submission.anonymized` delete them | — | module not in code yet; never edits a Person found by email dedup |
| messages | S, P, PU, X | subject, body, `external_email`, `external_name`, `external_email_hash`, error text, `message_recipients`, `message_objects.entity_snapshot` | yes | see rules | — | forwards and quoted threads: limit |
| communication_channels | P, X, S | `external_conversations` (subject, `contact_person_id`), `external_messages` (sender identifier and name), `message_channel_links` (`channel_payload`, `channel_metadata`), user-owned channels | yes | clear identifiers, names, payloads and inbound content; staff mailbox disconnected and its credential deleted (Phase 1) | — | dead letters age bound |
| inbox_ops | X, P | `inbox_emails` raw, HTML, cleaned and thread text, addresses; proposal participants and summary; action payloads | yes | clear content of emails the subject took part in; keep message ids and content hash for deduplication; clear the `messages` copy | — | decrypting scan; raw content age bound |
| phone_calls (+ `tillio` provider) | X, P | `phone_call_participants` (number, name, email, metadata), `phone_calls.raw_snapshot`, `provider_facts`, `recording_url`, recording attachment | yes | clear every participant of the call and the raw data; keep times, duration, status; set `privacy_cleared_at` | — | decrypting scan; provider-side recordings: docs |
| workflows | P, PU | `workflow_instances.context`, step input and output, `user_tasks.form_data`, `workflow_events.event_data` | yes | delete terminal instance graphs that reference the subject; others `open_case` | — | terminal instances age bound |
| ai_assistant | S (P quoted) | conversations, messages (`content`, tool `ui_parts`), participants, pending actions, usage events, moderation flags, agent runs with steps and tool calls | S | S: delete everything they own; P: delete pending actions that target them | conversations end by the tenant's `ai_assistant.retention.conversationDays` | colleagues' transcripts quoting P are not found per person and end by that setting; soft-deleted chats age bound |
| staff | TM, S, P and PU copies | member addresses, job histories, comments, activities, timesheet preferences, project memberships, entry tags, custom values; leave requests, time entries, report entries; ticket and comment author copies | yes | delete non-HR rows now; clear customer copies | employment records under labour and tax law, then deleted in the UI (docs procedure) | `auth:user` export lists the linked member in `related` |
| planner | TM | `planner_availability_rules` of the member | yes | delete | — | rule sets exempt |
| documents | S, P | favourites, watchers, user shares; `document_entity_links` label | S | S: delete favourites, watches and user shares; P: replace the link label | documents, versions and comments kept as organization work product (`other_party`) | content mentions: limit |
| eudr | producers (name only) | plot and evidence `producer_name`, notes, locations | — | procedure: keep for the EUDR record period, then edit or delete in the UI | Reg. (EU) 2023/1115 record keeping | tables exempt with that reason |
| attachments | files of records | `attachments` (file, extracted `content`), extractions, sections | listed by owners in export `files` | orchestrator deletes the ids owners list in `filesToDelete` through the attachments service (new tenant-scoped `attachmentService.deleteByIds(scope, ids)`) | — | exempt with that reason |
| entities | values of records | `custom_field_values` | via owners | via `entitiesPrivacyService` (contract spec) | — | tenant-defined custom entities: limit |
| audit_logs | all | `action_logs` snapshots and payloads; `access_logs` | — | history stripped per `touched` record (`stripForResources`) | `audit_logs.action_log` class, declared in [audit-snapshot redaction](2026-11-16-audit-snapshot-redaction.md); its `pruneExpired` is run by the Enterprise runner | `access_logs` exempt: already bounded inline |
| query_index, search | all | `entity_indexes`, `search_tokens`, vector and fulltext stores | — | orchestrator removes per `touched` record | — | derived copies, exempt |
| Operational stores | all | `webhooks` deliveries and ingestions, `data_sync` runs, `sync_excel_uploads` (sample rows, file), `business_rules` `rule_execution_logs`, `progress_jobs`, gateway session initializations and webhook events, carrier webhook events | — | — | age bound in the retention spec (or holds no personal data) | exempt with that reason; messages send-budget counters exempt (per-user counts only) |
| No personal data | — | catalog, currencies, dictionaries, directory, feature_toggles, configs, availability, translations, wms, ecommerce, resources (staff author ids as references) | — | — | — | exempt; organization names that are a sole trader's name: limit |

### Per-module rules

**Per-user stores.** Each module owns a persistent `auth.user.deleted` subscriber (Phase 1) and a handler (Phase 2). Both call one module-local `deleteForUser(scope, userId)`, so ordinary deletion and an erasure run leave the same state.

**Sales and checkout.** The sales rule is spelled out in [CRM and Sales in detail](#crm-and-sales-in-detail). The checkout handler finds transactions by email and calls `paymentGatewayService.clearPersonalData` for their gateway rows. Payment providers refund and poll with the typed provider id columns, which stay.

**Forms full-erasure mode.** `AnonymizeService.anonymize` gains `{ mode: 'sensitive' | 'erasure' }`, default `sensitive` (today's behaviour). `erasure` tombstones every answer in every revision, including revisions already anonymized, clears `change_summary`, does what `sensitive` does to uploads, the PDF link, invitations and submit metadata, clears `ip` and `ua` on the submission's access-audit rows, and sets new `forms_form_submission.erased_at`. With `erased_at` set, save, submit, reopen, upload and PDF regeneration refuse. The submission row and its consent records stay. The retention spec schedules forms retention and decides which mode it uses. Tables without `tenant_id` are reached through a parent that has it.

**form_to_deals.** When the module lands, its subscriber on `forms.submission.anonymized` (any mode) uses its submission-to-deal map to release the projected CV and files through the attachments service and delete the mapped `cf.*` values through `entitiesPrivacyService`. It never edits a Person found by email dedup; a Person the bridge created is erased through the `customers:person` root like any other.

**Messages.** For S: delete their `message_recipients` rows; messages they sent stay with `sender_user_id` as a reference. For an outside party matched by `external_email_hash` or plaintext: clear `external_email`, `external_name`, `external_email_hash` and `external_email_error`, and clear subject and body when the message was inbound from them. Clear `entity_snapshot` on `message_objects` that point at the subject's record. `messagesPrivacyService.clearBySource` clears messages created from another module's record; inbox_ops uses it for its `inbox_ops:inbox_email` copies.

**Communication channels.** Match `external_messages.sender_identifier` (plaintext, normalized) and `external_conversations.contact_person_id`. Clear sender identifier and name, conversation subject, inbound `channel_payload` and `channel_metadata`. Outbound content written by staff stays with the outside address removed.

**Phone calls.** Clearing a call clears all its participants, because the provider snapshot repeats every number. `phone_calls.privacy_cleared_at` is the refill guard: the ingest command keeps participants, raw snapshot and facts empty for a cleared call when the provider sends it again. The recording attachment is listed in `filesToDelete`.

**Workflows.** An instance references the subject when its `context`, a step's input or output, a user task's `form_data` or assignee, or an event's `event_data` contains the subject id (jsonb path match on the id string). `COMPLETED`, `FAILED`, `CANCELLED` and `COMPENSATED` graphs are deleted with steps, branches, tasks and events; any other status is `open_case`.

**AI assistant.** For S, delete conversations they own with messages and participants, their participant rows elsewhere, pending actions they created, usage events, moderation flags and agent runs with steps and tool calls. Override tables keep `created_by_user_id` as a reference. For P, delete pending actions whose target records are the person's.

**AI conversation retention.** Assistant messages keep the model's answer (`content`) and the tools' `ui_parts`, which copy CRM records (names, emails, order lines) into a colleague's transcript. A person's erasure does not find those copies, and today a conversation that nobody deletes is kept forever; only soft-deleted chats are pruned ([retention spec](2026-11-16-operational-retention-pruners.md)). The `ai_assistant` conversation class therefore declares `retentionSetting: 'ai_assistant.retention.conversationDays'`. Its `pruneExpired(scope, olderThan)` deletes conversations whose `last_message_at` (else `created_at`) is older than the cutoff, with their participants, messages and the chat uploads those messages list (through `attachmentService.deleteByIds`). A conversation with a `pending` action is skipped until the action resolves. Unset keeps conversations, as today; the deployment docs ask the controller to set a period and name 90 days as a starting point.

**Staff and planner.** For TM, delete addresses, job histories, comments, activities and their custom values, timesheet preferences, project memberships, entry tags and planner rules now, and clear free-text notes on decided leave requests (they can hold health data). The employment block (member name and user id, leave dates and status, time entries, report entries) is reported `legal_retention`, `retainedUntil: null`; the controller deletes it in the UI when the labour-law period ends, as the deployment docs describe. For P and PU, clear reporter and author display copies and the text of support tickets and task comments they wrote.

### Portal sign-in email correction — Art. 16

A portal user's email is their sign-in name. Neither the portal profile route nor the staff route can change it (`customer_accounts/api/admin/users/[id].ts`, schema `adminUpdateUserSchema` in `data/validators.ts:108-115`). The only correction today is a new account. Deleting the old one anonymizes it, and the person's orders, carts and claims stay with an account they can no longer open. Art. 16 asks for a correction that keeps the account.

- **Route.** `POST /api/customer_accounts/admin/users/[id]/change-email`, body `{ email }`, feature `customer_accounts.manage`. Staff with that feature can already set a portal user's password (`admin/users/[id]/reset-password.ts`), so no new power is granted.
- **Checks.** zod email. 404 for a user of another tenant or organization, or a deleted one. 409 `customer_accounts.email_taken` when a live account of the tenant has the same `email_hash`. 409 `customer_accounts.user_anonymized` when `anonymized_at` is set. 400 when the address does not change.
- **Effect, in one transaction** (`customerUserService.changeEmail(userId, scope, email)`): set `email` and recompute `email_hash` as signup does; set `email_verified_at` to null; revoke every session (`customerSessionService.revokeAllUserSessions`); delete the user's unused verification, magic-link and password-reset tokens. Login already refuses an unverified account (`customer_accounts/api/login.ts:116`), so nobody signs in until the new address is confirmed.
- **Mail.** A verification link to the new address (`customerTokenService.createEmailVerification` and the existing verify route), and a notice to the old address that staff changed the sign-in email, with no link.
- **Event.** `customer_accounts.user.email_changed` with `{ id, tenantId, organizationId }` and no addresses.
- **UI.** A "Change sign-in email" action on the portal user page (`backend/customer_accounts/users/[id]/page.tsx`): a dialog with the new address (`Cmd/Ctrl+Enter`, `Escape`), run through `useGuardedMutation`, locale keys for every string.
- Self-service change by the portal user, and recovery after an account takeover, stay deferred ([scope record](../analysis/ANALYSIS-2026-11-20-gdpr-scope-minimization.md)).

### CRM and Sales in detail

What erasing one person does in `customers` and `sales`, table by table. Tables and columns are checked against `data/entities.ts` and `encryption.ts` of `customers`, `sales` and `shipping_carriers`. The person root is defined in the [contract spec](2026-11-16-privacy-data-class-contract.md#customersperson); this section spells it out.

#### CRM (`customers`)

The root runs after every other class. **Delete path** (`customers.people.delete` with `skipLog`): no deal links the person and no class retained a record. **Anonymize path**: a deal links the person, or the orchestrator passes `prefer: 'anonymize'`. Every changed or deleted row goes into `touched`.

| Entity / table | Personal data | Delete path | Anonymize path | Notes |
|---|---|---|---|---|
| `customer_entities`, kind `person` | `display_name`, `primary_email`, `primary_phone`, `description`, `next_interaction_name` (encrypted, no lookup hash) | row deleted | row and id kept; `display_name` set to the placeholder, the other four nulled, `anonymized_at` set | status, lifecycle stage, source and `owner_user_id` (staff) stay |
| `customer_people` (profile) | `first_name`, `last_name`, `preferred_name`, `job_title`, `department`, `seniority`, `timezone`, `linked_in_url`, `twitter_url`, `company_entity_id` | deleted | row kept, all ten nulled | its id is `customer_contact_id` on orders and quotes |
| `customer_addresses` | `name`, `company_name`, `address_line1`/`2`, `building_number`, `flat_number`, `city`, `region`, `postal_code`, `country`, `latitude`, `longitude`, `purpose` | deleted | deleted | order copies: Sales table |
| `customer_comments` | `body` | deleted | deleted | includes comments on a deal filed under the person |
| `customer_activities` | `subject`, `body`, custom values | deleted | deleted | |
| `customer_interactions` | `title`, `body`, `location`, `participants`, `linked_entities`, custom values | deleted | deleted | another record's interaction naming the person: its `linked_entities` label becomes the placeholder (jsonb id match) and the `participants` entry with the subject's email loses name and email |
| `customer_tag_assignments`, `customer_label_assignments` | tags and labels staff put on the person | deleted | deleted | tags and labels themselves are configuration |
| `customer_person_company_links`, `customer_person_company_roles` | where the person works, role values | deleted | deleted | the command deletes links, not roles, and the roles FK has no cascade (`customers/migrations/Migration20260411130944.ts:17`): the handler deletes roles first |
| `customer_entity_roles` | staff user assigned to the person (`user_id`, `role_type`) | deleted by the handler | deleted | polymorphic `entity_id`, no FK; the command leaves it |
| `customer_todo_links` | link to a task | deleted | deleted | the task belongs to its own module |
| `customer_email_conversation_shares` | which mailbox owner shared the person's emails | deleted | deleted | |
| `customer_deal_people` | link, `role` | deleted | kept, pointing at the anonymized row | |
| `customer_deals`, only this person linked | `title`, `description`, `loss_notes`, custom values, files | — (a deal link forces anonymize) | amounts, currency, pipeline, stage, status, probability, dates kept; `title` placeholder; `description`, `loss_notes` nulled; custom values deleted; files in `filesToDelete` | counted in `anonymized` |
| `customer_deals`, also linked to another person or a company | same | — | unchanged | `retained`: `other_party`, `retainedUntil: null` |
| Custom-field values | `customers:customer_entity` (entity id), `customers:customer_person_profile` (profile id), `customers:customer_activity`, `customers:customer_interaction` | first two hard-deleted by the command; the rest by the handler through `entitiesPrivacyService` | all through `entitiesPrivacyService` | soft-deleted values included |
| Attached files | attachments of the person, its activities, interactions and sole-person deals | `filesToDelete` | `filesToDelete` | the command does not touch attachments |
| Companies: kind `company`, `customer_companies`, `customer_company_billing`, `customer_deal_companies` | legal and brand name, domain, `tax_id`, company email and phone | untouched | untouched | not natural persons, exempt; a sole trader whose company name, email or phone names them is a stated limit, edited by hand (docs) |
| Portal account (`customer_users`) | email, name, password hash, sessions | — | — | its own subject, `customer_accounts:user`, found by the same email and confirmed by the operator; always anonymized: placeholder email, no password or name, `person_entity_id` nulled (contract) |

The delete path emits `customers.person.deleted`; `sales:reconcile-on-person-delete` then nulls `customer_entity_id` on the person's orders and quotes.

**Example.** Erasure request for Jan Kowalski, who has 2 paid orders (one invoiced), 1 open quote, 1 deal with only him linked, and 3 addresses. Sales retains both orders, so the orchestrator passes `prefer: 'anonymize'`; the sole-person deal would force it anyway.
- Remains: his `customer_entities` and profile rows under the placeholder name, every field above nulled, `anonymized_at` set; the deal with its amount, currency, stage, status and dates under a placeholder title; the `customer_deal_people` link.
- Cleared: the 3 addresses, his comments, activities, interactions, tags, labels, company links and roles, entity roles, todo links and conversation shares; his and the deal's custom values; his and the deal's files.
- Report: `deleted` counts the 3 addresses and the other deleted child rows, `anonymized: 2` (person, deal), `retained: []`, `touched` lists the person, profile, deal and every deleted row, `filesToDelete` lists the files. His name and billing address survive only as the orders' own copy (Sales below).

#### Sales (`sales`)

The sales handler runs before the root. It finds orders and quotes by `customer_entity_id` (the person's entity id) and `customer_contact_id`, which holds the person's `customer_people.id`, not the entity id (`sales/commands/documents.ts:839-845`). A commercial record keeps what the invoice must state under VAT Directive 2006/112/EC Art. 226 (customer's full name and address, point 5; VAT id, point 4; nature and quantity of goods, point 6; dates, rates and amounts) for the storage period each member state sets under Art. 247, which the tenant enters as `sales.retention.commercialRecordsDays` (no default; unset keeps the record with `retainedUntil: null`). Orders and quotes have no email or phone column: both sit in `customer_snapshot`. `sales_channels.contact_email` and `contact_phone` are the seller's channel contact, not the buyer's.

| Entity / table | Personal data | Commercial record, kept (Art. 17(3)(b)) | Quote or non-commercial order, anonymized now | After the period (`pruneExpired`) |
|---|---|---|---|---|
| Orders and quotes: `customer_snapshot` | `customer` (`displayName`, `primaryEmail`, `primaryPhone`, person `firstName`, `lastName`, `preferredName`, company `legalName`, `brandName`, `domain`, `websiteUrl`), `contact` (names, `jobTitle`, `department`) | rebuilt from an allowlist: `customer.id`, `kind`, `displayName`, person `firstName`, `lastName`, company `legalName`; all else dropped, the whole `contact` block included | null | null |
| `billing_address_snapshot` | name, company, street lines, building, flat, city, region, postal code, country; CRM address `id`, `purpose`, `latitude`, `longitude`, `isPrimary` | address lines kept (Art. 226(5)); `id`, `purpose`, coordinates, `isPrimary` dropped | null | null |
| `shipping_address_snapshot` | same | same as billing, because it is the information used to determine where transport of the goods ends, which OSS records must hold (Implementing Reg. 282/2011 Art. 63c(1)) and on which the place of supply and intra-EU exemption rest (Directive Art. 33, 138). For a tenant that sells only domestically this keeps more than its VAT records need; a per-tenant "keep shipping address" switch is a possible later refinement, not a legal requirement | null | null |
| `tax_info` | buyer VAT id, tax breakdown | VAT id and tax amounts kept (Art. 226(4), (8)–(10)); other keys dropped | null | null |
| `comments`, `internal_notes` (orders only), `external_reference`, `customer_reference`, `metadata` | free text, references | nulled | nulled | — |
| `acceptance_token` (quotes only) | public quote link | — | nulled; the link stops working | — |
| `customer_entity_id`, `customer_contact_id` | link to the person | kept; the person row is anonymized, not deleted | kept; `customer_entity_id` nulled by the reconcile subscriber if the root then deletes the person | nulled |
| Numbers, status, currency, totals, dates, method snapshots | — | kept | kept | kept |
| `sales_document_addresses` ("the address on an order" beyond the two snapshots) | the snapshot address fields plus `customer_address_id` | address lines kept; `customer_address_id`, `purpose`, `latitude`, `longitude` nulled | rows deleted | rows deleted |
| `sales_order_lines`, `sales_quote_lines` | `description`, `comment`, `configuration`, `metadata` | `name`, `sku`, product ids, `catalog_snapshot`, quantities, prices, tax kept (Art. 226(6)); the four fields nulled | the four fields nulled | — |
| `sales_invoices`, `sales_invoice_lines` | no buyer columns: an invoice prints the order's `customer_snapshot`, `billing_address_snapshot` and `tax_info`; `metadata` | rows and lines kept as issued (Art. 233 integrity of content); `metadata` nulled | — (an invoice makes the order a commercial record) | kept; the buyer copy on the order is gone |
| `sales_credit_memos`, `sales_credit_memo_lines` | `reason`, `metadata` | `reason` and `metadata` nulled; lines kept as issued | — | kept |
| `sales_notes` (context order, quote, invoice or credit memo) | `body` | deleted | deleted | — |
| `sales_payments` | `payment_reference`, `metadata` | amount, currency, status, dates and reference kept; `metadata` nulled | reference and `metadata` nulled | reference nulled |
| `sales_shipments`, `sales_returns` | shipment `notes`, `metadata`; return `reason`, `notes` | nulled; tracking numbers, dates, quantities kept | nulled | — |
| `carrier_shipments` (`shipping_carriers`) | `label_data`, `label_url`, `tracking_events[].location` | kept with the shipping address, as proof of dispatch and delivery | cleared by `shippingCarrierService.clearForOrders` | cleared by `clearForOrders` |
| Attached files (invoice and credit-note PDFs, other order and quote files) | file content | kept, not in `filesToDelete` | listed in `filesToDelete` | deleted by the sales handler through `attachmentService.deleteByIds`, since `pruneExpired` returns counts only |

Invoices, credit memos and payments with no order carry no subject link and are a stated limit (module table). After the period `pruneExpired` writes through the sales commands, so search and cache follow their side effects; history copies age out under the `audit_logs.action_log` class.

**Example (same request).** Period set to 1825 days. Order A, placed 2025-03-10, paid and invoiced; order B, placed 2026-06-02, paid, not invoiced; quote Q, open.
- A and B keep the buyer block (his name, billing and shipping address lines, VAT id), lines, totals, numbers and dates; A keeps its invoice, lines and PDF; both keep payments, shipments, tracking and labels. Cleared: email, phone, the `contact` block, comments, internal notes, references, line descriptions, CRM address ids, coordinates, payment metadata; their `sales_notes` are deleted.
- Q keeps its number, totals and line names; snapshots, comments, references, `acceptance_token` and line text are cleared, its address rows and notes deleted, its files listed.
- Report: `deleted` counts Q's address rows and every deleted note, `anonymized: 1` (Q), `retained: [{ table: 'sales_orders', count: 1, reason: 'legal_retention', retainedUntil: '2030-03-09' }, { table: 'sales_orders', count: 1, reason: 'legal_retention', retainedUntil: '2031-06-01' }, { table: 'sales_invoices', count: 1, reason: 'legal_retention', retainedUntil: '2030-03-09' }]`, `touched` lists A, B, Q and their changed children, `filesToDelete` lists Q's files. A and B are in `touched` (their email and notes changed) but not in `anonymized`. One `retained` entry per table and `retainedUntil`; lines, addresses, payments and shipments kept with an order are not listed apart. With no period set: one `sales_orders` entry with `count: 2` and one `sales_invoices` entry, both `retainedUntil: null`.
- From 2030-03-10 the runner's `pruneExpired(scope, now − 1825 days)` anonymizes A (buyer block, links and address rows gone, PDF deleted, label cleared); B follows from 2031-06-02.

## Data Models

| Column | Purpose |
|---|---|
| `customer_users.anonymized_at` | Set by `customerUserService.anonymize` (Phase 1; also used by the contract's root) |
| `forms_form_submission.erased_at` | Write barrier after full erasure |
| `warranty_claims.anonymized_at` | Blocks `closed → in_review` for an anonymized claim |
| `phone_calls.privacy_cleared_at` | Ingest refill guard |

All are nullable timestamps with no backfill. Retention periods are `module_configs` entries: `sales.retention.commercialRecordsDays`, `checkout.retention.completedPaymentsDays`, `ai_assistant.retention.conversationDays`.

## API Contracts

| Seam | Owner | Contract |
|---|---|---|
| `readAuthUserDeletedPayload(payload)` | shared, `packages/shared/src/lib/auth/userDeletedEvent.ts` | Zod-parses `{ id, tenantId, organizationId }`; uses legacy `userId` only when `id` is absent; returns `null` when there is no id or no tenant; never logs the payload |
| `integrationCredentialsService.deleteForUser({ tenantId, userId })` | integrations | Hard-deletes every credential row with that `user_id` in the tenant, soft-deleted rows included; never touches `user_id IS NULL` rows; returns the count |
| `customerUserService.anonymize(userId, scope)` | customer_accounts | As in the contract spec; `softDelete` calls it |
| `shippingCarrierService.clearForOrders(scope, orderIds)` | shipping_carriers | Clears `label_data` and personal `tracking_events` fields; returns `touched` |
| `paymentGatewayService.clearPersonalData(scope, transactionIds)` | payment_gateways | Clears `gateway_metadata`, `webhook_log`, `redirect_url`, `client_secret` and operation payloads; returns `touched` |
| `messagesPrivacyService.clearBySource(scope, sourceEntityType, sourceIds)` | messages (new `di.ts`) | Clears subject, body and outside fields of messages created from those records; returns `touched` |
| `AnonymizeService.anonymize(id, scope, { mode })` | forms | Additive optional argument; default unchanged |
| `attachmentService.readByIds(scope, ids)` / `deleteByIds(scope, ids)` | attachments | Tenant-scoped read and hard delete (row and stored object) by attachment id, for the Enterprise run; refuses ids outside the tenant; idempotent |
| `customerPersonLookupService.getProfileId(scope, personEntityId)` | customers | Person entity id → `customer_people.id`; used by the sales handler for `customer_contact_id` (defined in the contract spec) |
| `POST /api/customer_accounts/admin/users/[id]/change-email`, `customerUserService.changeEmail(userId, scope, email)`, event `customer_accounts.user.email_changed` | customer_accounts | Phase 7 staff correction of a portal sign-in email; additive route, method and event |
| `workflowPrivacyService.deleteTerminalInstance(scope, instanceId)` | workflows | Deletes a `COMPLETED`, `CANCELLED` or `FAILED` instance with its steps, branches, events and user tasks; refuses a running one; used by the workflows handler, the retention age bound and the Enterprise agent class |

Each module adds `privacy.ts` and registers its handler in `di.ts` under `<module>PrivacyHandler`. Apart from Phase 7's route and event and Phase 1's cleanup commands, no route, event, ACL feature or CLI command is added.

## Migration & Compatibility

- **UPGRADE_NOTES:** "Deleting a staff user now deletes their notifications, devices, push deliveries, session API keys, private perspectives, dashboard layouts, onboarding requests and stored integration credentials. Deleting a portal user now replaces its email and name with placeholders and removes its password hash." A second line: "Staff can change a portal user's sign-in email; the account must confirm the new address before it signs in again."
- **BACKWARD_COMPATIBILITY:** the `auth.user.deleted` id and payload, both existing subscriber ids, the `softDelete` signature and every route are unchanged; new subscribers, service methods, the forms `mode` argument, nullable columns, the change-email route and its event are additive. Undoing a staff-user delete restores the account, not the per-user stores already deleted.
- Rows left by users deleted before Phase 1 are not found by the new subscribers. The deployment docs give a per-table check for user ids absent from `users`; the Enterprise erase run or a manual delete removes them.

## Risks & Impact Review

#### A subscriber change deletes another user's rows
- **Scenario**: A missing id becomes an empty condition, or `ignoreUndefinedInQuery` is enabled later.
- **Severity**: Critical
- **Affected area**: every `auth.user.deleted` subscriber, enterprise SSO
- **Mitigation**: the shared parser returns `null` and the subscriber issues no statement; every query carries the tenant; a guard test fails if any `MikroORM.init` call sets `ignoreUndefinedInQuery`.
- **Residual risk**: Low.

#### A retained commercial record keeps too much or too little
- **Scenario**: A snapshot carries extra keys, or the tenant never sets a period.
- **Severity**: High
- **Affected area**: sales, checkout
- **Mitigation**: the buyer block is rebuilt from a fixed allowlist, never copied; an unset period reports `retainedUntil: null` and the docs require the controller to set one.
- **Residual risk**: The legal period is the controller's choice.

#### Clearing gateway data breaks a refund
- **Scenario**: A provider adapter reads a key from `gateway_metadata` to refund.
- **Severity**: Medium
- **Affected area**: payment_gateways, provider packages
- **Mitigation**: clearing keeps the typed id, status and amount columns; Phase 3 tests a refund after clearing for each first-party adapter.
- **Residual risk**: A late provider webhook can add new metadata to a cleared row; such rows are age-bounded by the retention spec.

#### Cleared data is refilled
- **Scenario**: A provider re-sends a call, a form is saved again, or a closed claim is reopened.
- **Severity**: Medium
- **Affected area**: phone_calls, forms, warranty_claims
- **Mitigation**: `privacy_cleared_at`, `erased_at` and `anonymized_at` guards checked in the owner's write path.
- **Residual risk**: None known for these three paths.

#### The subject remains in free text or third-party copies
- **Scenario**: A colleague's note names the person; a payment provider keeps the payer.
- **Severity**: Medium
- **Affected area**: comments, messages, documents, AI transcripts, providers
- **Mitigation**: stated limits in the docs, with the manual search and Art. 19 procedures.
- **Residual risk**: Accepted and disclosed.

## Implementation Plan

### Phase 1 — User-delete cascade fix
1. Add `readAuthUserDeletedPayload` with unit tests (`id`, legacy `userId`, both, neither, missing tenant).
2. `communication_channels/subscribers/user-deleted-cascade.ts`: use the parser; keep the disconnect; correct the false retention-sweep comments there and in `commands/disconnect-channel.ts`. Rebuild its unit test from `userCrudEvents.buildPayload`.
3. Enterprise `sso/subscribers/user-deleted-cleanup.ts`: same parser and a tenant condition; its tests are in the enterprise coverage spec.
4. Add a persistent `auth.user.deleted` subscriber to each of notifications, push_notifications, devices, api_keys, perspectives, dashboards and onboarding, calling its module-local `deleteForUser`, and one to integrations calling `integrationCredentialsService.deleteForUser`; each with a unit test.
5. Add `customer_users.anonymized_at` and `customerUserService.anonymize`; `softDelete` calls it. Both delete routes keep revoking sessions.
6. Add `packages/shared/src/lib/db/__tests__/orm-config-guard.test.ts`: fails if any `MikroORM.init` call in `packages/shared/src/lib/db/mikro.ts` or `packages/cli/src/lib/db/commands.ts` sets `ignoreUndefinedInQuery`.
7. Rows left by users deleted before this fix: `mercato communication_channels cleanup-deleted-users` and the per-module equivalents (one per subscriber added in step 4; SSO in the enterprise coverage spec). Each takes `--tenant`, finds user ids in its own rows with no live `users` row (checked through `authService`), reports by default and deletes only with `--apply`; idempotent; unit test per command.
8. Person delete with company roles: `customers.people.delete` hard-deletes the person (`em.remove`) but not its `customer_person_company_roles` rows, whose foreign key has no `ON DELETE` (`customers/migrations/Migration20260411130944.ts:17`), so deleting anyone with a company role fails today. The command deletes the person's role rows and `customer_entity_roles` rows before the remove. Unit test plus `TC-PRIVACY-CASCADE-004`: a person linked to a company with a role is deleted through the API; no role or entity-role row remains.
9. Integration tests: `TC-PRIVACY-CASCADE-001` to `004`.

### Phase 2 — Per-user stores and cross-cutting declarations
1. `privacy.ts` and handlers for notifications, push_notifications, devices, api_keys, perspectives, dashboards, integrations and onboarding, reusing `deleteForUser`.
2. Exempt declarations for attachments, `access_logs`, query_index, the operational stores and the modules with no personal data (entities is declared in the contract spec).
3. Lower the coverage baseline. Tests: handler unit tests; `TC-PRIVACY-USERSTORES-001`.

### Phase 3 — Commerce
1. Sales (buyer block, `pruneExpired`, setting), shipping_carriers, checkout, payment_gateways, cart, warranty_claims (`anonymized_at` and reopen guard), promotions, customer_groups.
2. Refund-after-clearing tests for the Stripe, Autopay and Tpay adapters.
3. Lower the baseline. Tests: `TC-PRIVACY-SALES-001`, `-CHECKOUT-001`, `-CART-001`, `-WARRANTY-001`, `-PROMOTIONS-001`, `-GROUPS-001`.

### Phase 4 — Forms, documents, workflows, AI
1. Forms `erasure` mode and `erased_at` barrier; forms handler; form_to_deals rule recorded for when that module lands.
2. Documents, workflows and ai_assistant handlers, including the conversation `pruneExpired` and its `retentionSetting`.
3. Lower the baseline. Tests: `TC-PRIVACY-FORMS-001`, `-DOCUMENTS-001`, `-WORKFLOWS-001`, `-AI-001`.

### Phase 5 — Communication
1. `messages/di.ts` with `messagesPrivacyService`; messages, communication_channels, inbox_ops and phone_calls handlers; `privacy_cleared_at` ingest guard.
2. Lower the baseline. Tests: `TC-PRIVACY-MESSAGES-001`, `-CHANNELS-001`, `-INBOX-001`, `-CALLS-001`.

### Phase 6 — Staff, planner, remaining exemptions
1. Staff and planner handlers; eudr exemption with its reason.
2. The baseline holds no OSS table; only enterprise tables remain until the enterprise coverage spec claims them. Tests: `TC-PRIVACY-STAFF-001`, `-PLANNER-001`.

### Phase 7 — Portal sign-in email correction
Independent of the contract; may ship with Phase 1.
1. Validator, `customerUserService.changeEmail`, route with `openApi`, event, the two emails, i18n keys. Unit tests: taken address, anonymized user, unchanged address, other tenant, tokens deleted, sessions revoked, no address in the event payload.
2. Detail-page action and dialog. Test: `TC-PRIVACY-CACC-EMAIL-001`.

## Integration Coverage

Phase 1 tests are Playwright tests in the owning module's `__integration__` folder. Handler tests are PostgreSQL-backed jest tests (`*.integration.test.ts`, `yarn test:pg-integration`), because OSS has no route that runs a handler. Every test creates its own users, tenants and records and removes them in `finally`.

| Test | Asserts |
|---|---|
| `TC-PRIVACY-CASCADE-001` | A staff user connects a channel with `seedConnectedChannel` (writes a per-user credential) and is deleted through the API; the channel is disconnected and no `integration_credentials` row with that user id remains; a second user's channel and credential are unchanged |
| `TC-PRIVACY-CASCADE-002` | After deleting a staff user with a notification, preference, device, push delivery, session API key, private perspective and dashboard layout, none remains; a second user's rows remain |
| `TC-PRIVACY-CASCADE-003` | Deleting a portal user through the admin API leaves a placeholder email, null password hash, placeholder name and no sessions; a new account can register with the old email |
| `TC-PRIVACY-CASCADE-004` | A person linked to a company with a role value is deleted through `DELETE /api/customers/people`; the delete succeeds and no `customer_person_company_roles` or `customer_entity_roles` row of the person remains; the company and its other people are unchanged |
| `TC-PRIVACY-USERSTORES-001` | Per-user handlers export without tokens or secrets and erase only the subject's rows in the subject's tenant |
| `TC-PRIVACY-SALES-001` | An invoiced order keeps the buyer block and loses email, phone, notes and coordinates, `retainedUntil` follows the setting or is null; a quote is anonymized; `pruneExpired` anonymizes past-period orders only; carrier label cleared only for the anonymized order |
| `TC-PRIVACY-CHECKOUT-001` | Completed payment keeps name and amount, failed payment anonymized, pending payment `open_case` and unchanged; gateway metadata cleared, provider ids kept |
| `TC-PRIVACY-CART-001`, `-WARRANTY-001`, `-PROMOTIONS-001`, `-GROUPS-001` | Deletion or anonymization per the table; locked cart and open claim unchanged; anonymized claim cannot be reopened |
| `TC-PRIVACY-FORMS-001` | Erasure tombstones unflagged answers in every revision and the change summary, clears access-audit IP; save and PDF regeneration refuse afterwards; consent record kept |
| `TC-PRIVACY-DOCUMENTS-001`, `-WORKFLOWS-001`, `-AI-001` | Documents keep content and lose the subject's favourites and shares; terminal workflow graph deleted, running one `open_case`; owned AI conversations and pending actions deleted; conversation `pruneExpired` deletes a conversation past the period with its messages and listed uploads, and keeps a newer one and one with a pending action |
| `TC-PRIVACY-MESSAGES-001`, `-CHANNELS-001`, `-INBOX-001`, `-CALLS-001` | Inbound text from the subject cleared, staff text kept with the outside address removed; inbox copy in `messages` cleared; a cleared call stays cleared after re-ingest |
| `TC-PRIVACY-STAFF-001`, `-PLANNER-001` | Non-HR rows deleted, employment block reported `legal_retention`; member rules deleted, shared rule sets kept |
| `TC-PRIVACY-CACC-EMAIL-001` | Playwright, `customer_accounts/__integration__`. Staff change a fixture portal user's email through the detail page: the old session stops working; login with the old address fails; login with the new address is refused until the link sent to it is used, then succeeds; the account still owns its fixture order and cart; a taken address returns 409; the event payload holds no address |

## Final Compliance Report — 2026-11-20

| Rule source | Rule | Status | Notes |
|---|---|---|---|
| root AGENTS.md | No direct ORM relationships or cross-module table access | Compliant | Cross-module work through owner DI services |
| root AGENTS.md | Tenant and organization scoping | Compliant | Every handler and subscriber query |
| root AGENTS.md | Integration tests ship with the change | Compliant | One per module, listed per phase |
| BACKWARD_COMPATIBILITY.md | Event ids, payloads, routes, signatures unchanged | Compliant | Additive seams and columns only |
| packages/core/AGENTS.md | Subscribers idempotent and persistent where needed | Compliant | All new `auth.user.deleted` subscribers are persistent and idempotent |

Verdict: ready for implementation; Phase 1 can ship before the contract.

## Changelog

### 2026-11-20
- Rewritten to minimal GDPR scope; replaces the four domain coverage specs.
- Added "CRM and Sales in detail" (field-by-field erasure for `customers` and `sales`, with worked examples); the commercial-record field list moved there.
- Post-minimization review: AI conversation retention setting (transcripts that quote a person end by a tenant period); Phase 7 staff correction of a portal sign-in email (Art. 16), the staff slice of the dropped portal-email-change draft.
