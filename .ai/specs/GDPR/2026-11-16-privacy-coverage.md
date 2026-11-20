# Privacy coverage of OSS modules

> **Tracker:** open-mercato/open-mercato#8593
> **Program:** [program](2026-11-15-gdpr-ready-deployments-program.md)
> **Edition:** OSS (handlers are inert seams; the invoker is the Enterprise `privacy` module, [DSR engine](../enterprise/GDPR/2026-11-16-privacy-dsr-engine.md))
> **GDPR basis:** Art. 5(1)(e), 15, 17, 17(3)(b), 20, 32

## TLDR

- Phase 1 fixes a live bug, independent of everything else: deleting a staff user leaves their per-user data and stored mailbox credentials behind because the cleanup subscribers read a field the event never sets, and deleting a portal user leaves its email, email hash, password hash and name.
- After that, every OSS module that stores personal data gets a `privacy.ts` declaration and a handler under the [data-class contract](2026-11-16-privacy-data-class-contract.md). One table below says, per module, what is held, what export returns, what erasure does and what is kept under Art. 17(3).
- Commercial records follow one Art. 17(3)(b) rule: keep a fixed buyer block for a period the tenant chooses, then anonymize through `pruneExpired`.
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

- An order is a commercial record when it has an invoice or a payment that is not failed or cancelled; a payment of unknown status counts.
- On erasure the sales handler keeps, for a commercial record, the buyer block: buyer display name, person and company names, billing and shipping address lines (name, company, street lines, building, flat, city, region, postal code, country), tax identifiers and tax amounts, lines, totals, dates and document numbers. It clears now: email, phone, CRM address ids, coordinates, address `purpose`, preferred names, job titles, comments, internal notes, external and customer references, personal line descriptions and metadata, and credit-memo reasons. It reports `legal_retention` with `retainedUntil = placed_at + period`, or `null` when the tenant has set no period.
- The period is the class's `retentionSetting`, `sales.retention.commercialRecordsDays`, in `module_configs`. The tenant chooses it (for example five years from the end of the tax year in Poland, eight to ten in Germany). The platform sets no default; unset means keep, and the docs tell the controller to set it.
- `pruneExpired(scope, olderThan)` anonymizes every commercial record placed before `olderThan`, not only those of erased subjects, in batches of at most `limit`. The Enterprise runner calls it with `now − period`.
- Quotes and orders that are not commercial records are anonymized at once: snapshots, comments, notes, references and personal line text cleared; numbers and totals kept.
- Completed checkout payments follow the same rule with `checkout.retention.completedPaymentsDays`.
- Files attached to a retained order (invoice and credit-note documents) are kept with it and not listed in `filesToDelete`; files of orders anonymized at once are listed.

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
| ai_assistant | S (P mentioned) | conversations, messages, participants, pending actions, usage events, moderation flags, agent runs with steps and tool calls | S | S: delete everything they own; P: delete pending actions that target them | — | colleagues' transcripts mentioning P: limit, soft-deleted chats age bound |
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

**Sales and checkout.** The sales handler finds documents by `customer_entity_id` and `customer_contact_id`, applies the commercial-record rule and calls `shippingCarrierService.clearForOrders` for anonymized orders. The checkout handler finds transactions by email and calls `paymentGatewayService.clearPersonalData` for their gateway rows. Payment providers refund and poll with the typed provider id columns, which stay.

**Forms full-erasure mode.** `AnonymizeService.anonymize` gains `{ mode: 'sensitive' | 'erasure' }`, default `sensitive` (today's behaviour). `erasure` tombstones every answer in every revision, including revisions already anonymized, clears `change_summary`, does what `sensitive` does to uploads, the PDF link, invitations and submit metadata, clears `ip` and `ua` on the submission's access-audit rows, and sets new `forms_form_submission.erased_at`. With `erased_at` set, save, submit, reopen, upload and PDF regeneration refuse. The submission row and its consent records stay. The retention spec schedules forms retention and decides which mode it uses. Tables without `tenant_id` are reached through a parent that has it.

**form_to_deals.** When the module lands, its subscriber on `forms.submission.anonymized` (any mode) uses its submission-to-deal map to release the projected CV and files through the attachments service and delete the mapped `cf.*` values through `entitiesPrivacyService`. It never edits a Person found by email dedup; a Person the bridge created is erased through the `customers:person` root like any other.

**Messages.** For S: delete their `message_recipients` rows; messages they sent stay with `sender_user_id` as a reference. For an outside party matched by `external_email_hash` or plaintext: clear `external_email`, `external_name`, `external_email_hash` and `external_email_error`, and clear subject and body when the message was inbound from them. Clear `entity_snapshot` on `message_objects` that point at the subject's record. `messagesPrivacyService.clearBySource` clears messages created from another module's record; inbox_ops uses it for its `inbox_ops:inbox_email` copies.

**Communication channels.** Match `external_messages.sender_identifier` (plaintext, normalized) and `external_conversations.contact_person_id`. Clear sender identifier and name, conversation subject, inbound `channel_payload` and `channel_metadata`. Outbound content written by staff stays with the outside address removed.

**Phone calls.** Clearing a call clears all its participants, because the provider snapshot repeats every number. `phone_calls.privacy_cleared_at` is the refill guard: the ingest command keeps participants, raw snapshot and facts empty for a cleared call when the provider sends it again. The recording attachment is listed in `filesToDelete`.

**Workflows.** An instance references the subject when its `context`, a step's input or output, a user task's `form_data` or assignee, or an event's `event_data` contains the subject id (jsonb path match on the id string). `COMPLETED`, `FAILED`, `CANCELLED` and `COMPENSATED` graphs are deleted with steps, branches, tasks and events; any other status is `open_case`.

**AI assistant.** For S, delete conversations they own with messages and participants, their participant rows elsewhere, pending actions they created, usage events, moderation flags and agent runs with steps and tool calls. Override tables keep `created_by_user_id` as a reference. For P, delete pending actions whose target records are the person's.

**Staff and planner.** For TM, delete addresses, job histories, comments, activities and their custom values, timesheet preferences, project memberships, entry tags and planner rules now, and clear free-text notes on decided leave requests (they can hold health data). The employment block (member name and user id, leave dates and status, time entries, report entries) is reported `legal_retention`, `retainedUntil: null`; the controller deletes it in the UI when the labour-law period ends, as the deployment docs describe. For P and PU, clear reporter and author display copies and the text of support tickets and task comments they wrote.

## Data Models

| Column | Purpose |
|---|---|
| `customer_users.anonymized_at` | Set by `customerUserService.anonymize` (Phase 1; also used by the contract's root) |
| `forms_form_submission.erased_at` | Write barrier after full erasure |
| `warranty_claims.anonymized_at` | Blocks `closed → in_review` for an anonymized claim |
| `phone_calls.privacy_cleared_at` | Ingest refill guard |

All are nullable timestamps with no backfill. Retention periods are `module_configs` entries: `sales.retention.commercialRecordsDays`, `checkout.retention.completedPaymentsDays`.

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
| `workflowPrivacyService.deleteTerminalInstance(scope, instanceId)` | workflows | Deletes a `COMPLETED`, `CANCELLED` or `FAILED` instance with its steps, branches, events and user tasks; refuses a running one; used by the workflows handler, the retention age bound and the Enterprise agent class |

Each module adds `privacy.ts` and registers its handler in `di.ts` under `<module>PrivacyHandler`. No route, event, ACL feature or CLI command is added.

## Migration & Compatibility

- **UPGRADE_NOTES:** "Deleting a staff user now deletes their notifications, devices, push deliveries, session API keys, private perspectives, dashboard layouts, onboarding requests and stored integration credentials. Deleting a portal user now replaces its email and name with placeholders and removes its password hash."
- **BACKWARD_COMPATIBILITY:** the `auth.user.deleted` id and payload, both existing subscriber ids, the `softDelete` signature and every route are unchanged; new subscribers, service methods, the forms `mode` argument and nullable columns are additive. Undoing a staff-user delete restores the account, not the per-user stores already deleted.
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
8. Integration tests: `TC-PRIVACY-CASCADE-001` to `003`.

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
2. Documents, workflows and ai_assistant handlers.
3. Lower the baseline. Tests: `TC-PRIVACY-FORMS-001`, `-DOCUMENTS-001`, `-WORKFLOWS-001`, `-AI-001`.

### Phase 5 — Communication
1. `messages/di.ts` with `messagesPrivacyService`; messages, communication_channels, inbox_ops and phone_calls handlers; `privacy_cleared_at` ingest guard.
2. Lower the baseline. Tests: `TC-PRIVACY-MESSAGES-001`, `-CHANNELS-001`, `-INBOX-001`, `-CALLS-001`.

### Phase 6 — Staff, planner, remaining exemptions
1. Staff and planner handlers; eudr exemption with its reason.
2. The baseline holds no OSS table; only enterprise tables remain until the enterprise coverage spec claims them. Tests: `TC-PRIVACY-STAFF-001`, `-PLANNER-001`.

## Integration Coverage

Phase 1 tests are Playwright tests in the owning module's `__integration__` folder. Handler tests are PostgreSQL-backed jest tests (`*.integration.test.ts`, `yarn test:pg-integration`), because OSS has no route that runs a handler. Every test creates its own users, tenants and records and removes them in `finally`.

| Test | Asserts |
|---|---|
| `TC-PRIVACY-CASCADE-001` | A staff user connects a channel with `seedConnectedChannel` (writes a per-user credential) and is deleted through the API; the channel is disconnected and no `integration_credentials` row with that user id remains; a second user's channel and credential are unchanged |
| `TC-PRIVACY-CASCADE-002` | After deleting a staff user with a notification, preference, device, push delivery, session API key, private perspective and dashboard layout, none remains; a second user's rows remain |
| `TC-PRIVACY-CASCADE-003` | Deleting a portal user through the admin API leaves a placeholder email, null password hash, placeholder name and no sessions; a new account can register with the old email |
| `TC-PRIVACY-USERSTORES-001` | Per-user handlers export without tokens or secrets and erase only the subject's rows in the subject's tenant |
| `TC-PRIVACY-SALES-001` | An invoiced order keeps the buyer block and loses email, phone, notes and coordinates, `retainedUntil` follows the setting or is null; a quote is anonymized; `pruneExpired` anonymizes past-period orders only; carrier label cleared only for the anonymized order |
| `TC-PRIVACY-CHECKOUT-001` | Completed payment keeps name and amount, failed payment anonymized, pending payment `open_case` and unchanged; gateway metadata cleared, provider ids kept |
| `TC-PRIVACY-CART-001`, `-WARRANTY-001`, `-PROMOTIONS-001`, `-GROUPS-001` | Deletion or anonymization per the table; locked cart and open claim unchanged; anonymized claim cannot be reopened |
| `TC-PRIVACY-FORMS-001` | Erasure tombstones unflagged answers in every revision and the change summary, clears access-audit IP; save and PDF regeneration refuse afterwards; consent record kept |
| `TC-PRIVACY-DOCUMENTS-001`, `-WORKFLOWS-001`, `-AI-001` | Documents keep content and lose the subject's favourites and shares; terminal workflow graph deleted, running one `open_case`; owned AI conversations and pending actions deleted |
| `TC-PRIVACY-MESSAGES-001`, `-CHANNELS-001`, `-INBOX-001`, `-CALLS-001` | Inbound text from the subject cleared, staff text kept with the outside address removed; inbox copy in `messages` cleared; a cleared call stays cleared after re-ingest |
| `TC-PRIVACY-STAFF-001`, `-PLANNER-001` | Non-HR rows deleted, employment block reported `legal_retention`; member rules deleted, shared rule sets kept |

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
