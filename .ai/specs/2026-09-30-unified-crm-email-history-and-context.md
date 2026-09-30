# Unified CRM Email History and Context — v2

**Status:** Draft — proposal awaiting maintainer review; implementation not started.
**Scope:** OSS — `customers` (owner), with additive contracts in `messages`, `communication_channels`, `attachments` and `@open-mercato/ui`.
**Date:** 2026-09-30

> **Status: v2 proposal for review.** The user accepted the unified product direction and requested this revision. This document does not claim maintainer approval or authorize implementation, deployment, migrations or permanent deletion.
> Supersedes the proposed direction in the attached **Company Conversation Context** v1, dated 2026-09-30. The original remains unchanged.

## 📝 TLDR

Provide one CRM email capability on Person and Company detail pages: the same Emails interface, authorized conversation reader, composer, complete history/search, and durable business context. Include the Person email improvements required for parity, security and preservation in this specification. Linking email to a business record changes relevance only; it never grants read access or sending authority.

## 📝 Accepted Direction

| Decision | Direction established in the conversation |
| --- | --- |
| Scope | One spec for People and Companies, including the necessary Person email fixes. |
| UX | Matching controls and matching authorized content for the same conversation. |
| Preservation | Authorized retained history remains reachable through normal CRM operations. |
| Lifecycle | Archive/Restore is the recommended routine lifecycle; retained mail is preserved. |
| Privacy | Relevance and sharing are separate; existing email privacy and tenant boundaries remain enforced. |
| Performance | Complete history is pageable and searchable; content is loaded in bounded pages. |

The preceding review and the user's acceptance resolve the product scope gate, including the decision to keep the Person fixes and Company capability in one spec. The API, data-model and migration sections below state the v2 design proposals explicitly; they are not descriptions of already implemented behavior.

## 📝 Overview

This is an OSS CRM capability for sales and account-management users. Person and Company pages become two entry points to the same email system. Business context persists as people change employer, records are archived, and mailboxes disconnect. Privacy remains an independent, current authorization decision.

### Plain-language example

Anna emails Jon about Acme's renewal. The conversation is related to Anna and Acme. Jon opens either record's Emails tab, reads the same authorized messages and replies using his authorized mailbox. The reply retains those business relationships. Jon can find the original agreement from several years ago without loading all mail into the browser. Archiving Anna or changing her employer leaves Acme's retained correspondence available. Unlinking Acme changes where the conversation appears; the email remains discoverable in the global email history.

Think of related records as labels on one conversation. Reading permission is a separate key; adding a label never hands someone that key.

| What the user does | What happens |
| --- | --- |
| Opens Anna or Acme → Emails | Uses the same reader, search, reply and attachment controls; that viewer sees the same readable messages in the same conversation. |
| Writes a new email from Acme | Acme is already selected as context; the user chooses the actual recipient and their authorized sender mailbox. |
| Links an old conversation | Adds the chosen Person/Company label without copying email or changing who can read it. |
| Replies | Keeps the conversation's context and lets the user review recipients; the new reply defaults private. |
| Archives Anna | Keeps the record inactive and discoverable; retained correspondence remains reachable. |
| Changes sharing | Shows which original email setting, Person-history grant or channel share supplies access; each authorized control changes only its stated scope. |

### Scope and boundaries

**Included:** shared Person/Company reader and host; complete conversation/message paging; authorized server search and historical discovery; persistent Person/Company relevance; New email, Reply and Reply all; safe delivery retries; durable authorization provenance; archive/restore and legacy CRM-delete compatibility; faithful undo; attachment authorization and retention; migration/reconciliation; privacy and performance verification.

**Deferred:** Deal context, bulk curation, new providers, delegated sending, Company sender identities, cross-mailbox deduplication, domain/AI relevance inference, administrator access to private correspondence, and a new permanent email-purge UI. This work defines safeguards around existing deletion paths; it does not create an unapproved purge capability.

### Evidence baseline

The v1 proposal cites `0c5dd630b583697a459e362aedb4d780168dc380`. The local checkout reviewed was `21a0083828faa434ca63b7f22484e998311a1850`. Some sharing features exist at the proposal's cited revision but not in that older local checkout. Implementation must recheck the then-current target branch and retain this distinction; absent features in the older checkout are not evidence that the v1 descriptions were fabricated.

Verified at the proposal's revision: Person history has no cursor, defaults to 50 threads, caps interaction scanning before grouping and retains at most 200 messages per returned thread; grants/shared-channel candidates are also capped. Person and Company delete physically remove interactions. Both undo paths omit email linkage/provider/visibility metadata. Reply continuation resolves the parent without the required email-read check. These dependencies are addressed below rather than reused unchanged.

### Established CRM practice

Explicit communication-to-record relevance and capture during composition are established patterns. EspoCRM recognizes related records and allows users to set a Parent; SuiteCRM relates imported/composed mail to CRM records; Frappe CRM provides contextual email on Lead/Deal surfaces. These examples support convenient capture and correctable context, not a universal requirement to copy all contact mail onto every affiliated Company. [EspoCRM](https://docs.espocrm.com/user-guide/emails/), [SuiteCRM](https://docs.suitecrm.com/user/daily-activities/composing-emails/), [Frappe CRM](https://docs.frappe.io/crm/email-communication).

V2 adopts persistent context, familiar email actions and explicit correction. It does not import another product's sharing model or automatically expose private correspondence to all Company viewers.

## 📝 Problem Statement

Company pages lack an email surface, while Person email history is bounded and difficult to search comprehensively. A current-employment join makes account history move when affiliations change. A manual-only picker restricted to current contacts leaves old or unmatched correspondence undiscoverable. Separate Person and Company implementations would also produce conflicting message subsets, actions and error behavior.

Retaining message bytes is insufficient: deleting their last CRM interaction, losing sharing provenance, restricting attachments differently, or silently truncating a query can make those bytes practically inaccessible. V2 treats reachability, authorization and recovery as part of preservation.

## 📝 Product Invariants

1. **Parity:** the same viewer, with access to both records, opening the same conversation through Person or Company receives the same authorized messages, order, privacy information and available email actions. Only record-context listing and new-email defaults differ.
2. **Relevance is not permission:** creating, deleting or restoring a business link does not modify visibility, ownership, grants, channel sharing or send authority. This also applies to manually linking a Person with pre-existing sharing grants.
3. **Complete reachability:** every retained, imported message and attachment the viewer is authorized to read is reachable through ordinary history/search/recovery paths. Bounded pages limit work, not the archive's extent.
4. **Stable account context:** employment changes, archive/restore, mailbox disconnection and CRM record deletion do not erase retained email or its authorization provenance.
5. **Live privacy:** revoked grants stop access on the next server read, download or send validation. Restoring records or undoing a relevance change never resurrects a revoked grant.
6. **No concealed failures:** indexing, synchronization, linkage and attachment failures are explicit states with recovery actions, not successful empty results.
7. **Source ownership:** messages/communication_channels keep content, channel and delivery ownership; attachments keeps file ownership; customers owns relevance and CRM authorization provenance. No duplicate email store or direct cross-module ORM relation.

These guarantees cover retained/imported data and normal CRM operations. They do not authorize another user's private mail, imply that unsynchronized provider content is stored, or make deliberate authorized purge reversible. Access revocation and deliberate source purge are explicit security/destruction events, distinct from unlinking or CRM deletion.

## 📝 User Stories / Use Cases

| Story | User outcome | Acceptance reference |
| --- | --- | --- |
| U1 — Same conversation | Read/reply consistently from either related record. | A1, A2 |
| U2 — Old correspondence | Find an unloaded old message or former-contact thread and open its full history. | A3, A4 |
| U3 — Useful context | Compose in record context, link historical mail, correct relevance and undo a mistaken link. | A5, A6 |
| U4 — Privacy | Share only with an explicit authorized action; private content and attachments stay protected. | A7, A8 |
| U5 — Safe continuity | Archive or delete a CRM record without stranding retained correspondence; restore faithfully. | A9, A10 |
| U6 — Reliable send | Review recipients/sender, preserve a failed draft and avoid duplicate delivery on retry. | A11 |
| U7 — Fast, understandable history | Browse large accounts and recognize unavailable/syncing/recovery states. | A12, A13 |

## 📝 Proposed Solution

### V2 design decisions

| Decision | V2 proposal and rationale |
| --- | --- |
| Business context | Persistent conversation-to-record associations for both Person and Company. Compose establishes explicit context; replies inherit it; historical suggestions require confirmation. |
| Archive | Use existing `CustomerEntity.isActive = false/true` through guarded, undoable updates. The UI explains that Archive makes the record inactive and retains history. Existing inactive records remain discoverable; no new interpretation of DELETE. |
| Authorization preservation | Add durable per-message provenance anchors, independent of deletable interaction rows, and stable historical Person keys on current sharing grants. Archive alone is insufficient while legacy DELETE remains compatible. |
| Identity | Use server-derived `thread:<Message.threadId>` where available, otherwise `message:<Message.id>` or `link:<MessageChannelLink.id>`. Preserve v1 key adapters. Never infer identity from subject or merge separately imported mailbox copies. |
| Discovery | Search the complete authorized retained history, including unassigned and former-contact mail. Active affiliation is a suggestion, not a linking condition. |
| Permissions | Reuse existing record-view/manage, compose and owner-only sharing features. Keep `customers.email.view_private` inert. |
| Delivery | One shared composer and source-owned delivery path; persist delivery intent and business context before dispatch. |
| Rollout | Additive schema/services/APIs, resumable backfill, dual-write validation, coordinated Person/Company activation. Preserve old endpoints/imports/spots. |

Separate ingest-time **identity matching** from **Company relevance**. Trusted address matching may establish the original Person provenance and Person context, using encryption-aware lookup. It must not automatically label all correspondence with every current Company. Historical Company links are suggested from known context and confirmed by the user. Ambiguous mail remains available in global history and Link existing.

### Alternatives considered

- **Current-affiliation roll-up:** convenient initially, but moves historical context and includes unrelated mail. Rejected as the canonical Company view.
- **Company-only link table plus unchanged Person APIs:** small but fails parity, complete discovery, reply validation and lifecycle preservation. Rejected for the accepted scope.
- **Archive without durable anchors:** preserves routine archived records but leaves legacy CRM DELETE able to strand mail and grants. Rejected as the complete retention solution.
- **Snapshotting grants or marking retained mail shared:** makes revocation ineffective or widens access. Rejected.
- **New global conversation identity:** useful future work, but changes source threading/deduplication and is unnecessary for a consistent first release. Deferred.

## 📝 Architecture

### Ownership and proposed DI contracts

The following are **new proposed contracts**, not claims that these services already exist:

| Owner | Contract | Responsibility |
| --- | --- | --- |
| customers | `crmEmailConversationReader` | Context authorization, record associations and DTO normalization; both record routes use it. |
| customers | `crmEmailAccessPolicy` | Parameterized, indexed authorized channel-link selection from original provenance anchors and current grants; no content reads. |
| messages | `messageEmailSource` | Scoped conversation/message paging, encrypted content, safe summaries, keyword search, reply-parent validation and attachment-parent identification. |
| messages | `messageReadPolicyRegistry` | Typed source-owned registry that separates channel-email base authorization from optional additional grants; native permissions remain unchanged for messages not classified as channel email. |
| communication_channels | `communicationChannelHistoryAccess` | Retained channel read eligibility, distinct from connected/send eligibility. |
| communication_channels | `communicationChannelEmailSenders` | Bounded actor-owned email-channel selection and current source send eligibility; no credentials or delegated identities. |
| attachments | existing `attachmentService` | Scoped file listing/streaming/release and partition checks; email-owned files also require message authorization. |

Source-owned, immutable channel provenance classifies retained channel email before evaluating permissions; retain that classification through channel disconnection, source-link tombstones and CRM deletion. A mutable CRM interaction type or native MessageRecipient row cannot change it. For channel email, the source base policy admits verified original mailbox ownership or retained shared-channel read eligibility; generic native sender/recipient or administrator permissions are not an alternative bypass. Customers registers an optional grant contributor for explicit shared, verified legacy-null and current original Person/owner-history grants. Missing/disabled customers contributes no such grants and cannot reopen a native-recipient fallback. If a required source classification/channel policy cannot be resolved, the email path fails closed with an unavailable state. Messages not classified as channel email, including other channel types, keep their existing native behavior.

Customers owns its optional contribution to the generic registry. Upstream modules do not import or resolve a customers-specific service. The contributor validates trusted tenant/org/user context and returns an authorized channel-link selection rather than a caller-supplied boolean. Its implementation reads customers tables and resolves only the needed source/channel ports; it does not recursively call the combined message reader. The typed registry distinguishes unavailable required base policy from an absent optional grant provider. It must not implement an unrestricted OR with existing native permissions.

Use the sanctioned source-owned DI/query ports for peer data. A query port may accept an opaque, parameterized server-only relation selecting authorized MessageChannelLink IDs, bound to trusted tenant/org/viewer context, through the shared query engine. It must compose inside the database plan, never become a raw caller-supplied ID list or materialize the archive into an application array. It cannot accept raw SQL/table names from HTTP input. Messages owns joins to messages tables; communication_channels owns channel/link joins and supplies a typed relation through its coordinating port; customers owns anchor/grant joins. `messageEmailSource` coordinates those ports without peer ORM/table access. Define and type this selection contract in the owning source packages' public exports before wiring it.

### Read flow

1. Resolve authenticated actor, tenant and permitted organizations. For a record context, load the correct Person/Company and enforce access against that record's own organization, including All organizations mode.
2. Build scoped relevance and authorized channel-link selections. Apply source channel-email classification/base policy, then the optional CRM grants over **all original anchors**: explicit shared, legitimate legacy-null and current original Person/owner grant. Require the appropriate view feature. Native recipient status never bypasses private channel-email policy; absent optional grants leave verified owner/shared-channel access intact.
3. Apply authorization before keyword matching, summary generation, grouping, counts, sorting and cursor boundaries. Use EXISTS/relational selections, never capped grant arrays or post-page filtering.
4. Deduplicate original anchors by actual message/channel-link identity, group using the server conversation key and page by the latest readable message.
5. Load only the requested authorized summaries/bodies via `messageEmailSource`; use the owning encryption helpers. Return only related records the viewer can see.

Person relevance no longer constrains which readable messages appear **inside** a selected conversation. An authorized continuation from a newly CC'd colleague appears consistently on both pages. This intentionally improves the Person reader; a component-only extraction would not achieve it.

### Ingestion and projection consistency

Trusted inbound/outbound linkage creates provenance anchors idempotently, including retained channel mail with no matched Person. Matching a Person adds a separate original provenance row and relevance link. Manual relevance never creates a provenance row or a grant. Source linkage, mailbox owner/author, channel/provider, email classification and original Person permission scope are verified server facts; ordinary interaction create/update, author reassignment or type switching cannot fabricate or rewrite them.

Source modules emit typed lifecycle events; the customers-owned optional subscriber maintains its projection. Persist event delivery/reconciliation through the existing queue contract. Visibility/grant changes owned by customers update active interaction metadata and retained anchors atomically in the same customers transaction. Cross-module source writes remain source-owned and communicate through events; do not perform peer ORM writes inside a customers route.

A queued or failed projection must remain observable. The global source history retains the mail; CRM shows pending synchronization/linkage and an explicit recovery path. A deletion transaction verifies/persists provenance from its current interactions before removing them, so projection lag cannot destroy the last authorization anchor. Rollout is gated on completed initial backfill and reconciliation.

### Optional-module behavior

Customers owns guarded peer resolution. Without messages/communication_channels, record pages still load and Emails shows unavailable with Retry; existing stored customer metadata is untouched. Missing attachment service yields an attachment-unavailable state and fails closed. A disabled search backend yields search-unavailable and full paged browsing; it must not report zero matches. The supported complete-search deployment uses the baseline database token strategy, without requiring an external search/vector provider.

### Commands and events

| Mutation | Command / existing path | Undo and side effects |
| --- | --- | --- |
| Link context | `customers.email_conversation_link.create` | Undo only the active generation created by this command; an existing link is a no-op. |
| Unlink context | `customers.email_conversation_link.delete` | Restore the same generation only after current access/record checks; never overwrite a newer relink. |
| Edit Related records | `customers.email_conversation_link.update_context` | Bounded atomic link/unlink changes; undo only its own changed generations with current authorization/version checks. |
| Archive/Restore | existing `customers.people.update` / `customers.companies.update` | Version-checked `isActive` update; undo restores prior active state only. |
| Visibility | existing interaction visibility commands and new `customers.email_authorization_anchor.update_visibility` | Owner-only, exact original anchor, transactionally mirrored to its live interaction if present; current-version undo never revives a revoked grant. |
| Share/revoke | existing `customers.email_conversation_share.*` plus retained grant adapter | Preserve owner-only authority, stable scope and optimistic locking. |
| Compose/reply | `customers.email.compose` orchestration over the existing source send service | External delivery is not undoable; use delivery intent/idempotency and explicit recovery. |
| CRM delete/undo | existing People/Company commands | Ensure anchors before deletion; restore complete linkage/privacy; preserve retained grant keys. |
| Backfill/reconcile | `customers.email_history.reconcile` with queue worker | Idempotent projection work; no email delivery or destructive cleanup. |

Define additive `customers.email_conversation_link.created`, `.deleted` and `customers.email_history.reconciled` events through `createModuleEvents`; payloads contain scoped IDs and outcomes only. Retain existing event IDs. New email-context/access events are not tenant-wide `clientBroadcast` events. Refresh originating UI directly and other visible authorized hosts through bounded refresh; do not disclose private IDs through SSE.

## 📝 Data Models

### CustomerEmailConversationLink — business relevance

New customers-owned `customer_email_conversation_links`:

| Column | Contract |
| --- | --- |
| `id` | UUID primary key and relationship generation. |
| `tenant_id`, `organization_id` | Required, derived from trusted record scope. |
| `entity_id` | Same-module FK to CustomerEntity; Person or Company, validated kind. |
| `conversation_key` | Server-derived source identity; no cross-module ORM relation. |
| `linked_by_user_id`, `origin` | Audit actor; `manual`, `compose`, `ingest_person` or `reply_inheritance`. |
| `created_at`, `updated_at`, `deleted_at` | Versioned soft-deletable association. Return `updatedAt` for custom guarded writes. |

Unique active `(tenant_id, organization_id, entity_id, conversation_key)`; context lookup on that tuple; reverse lookup `(tenant_id, organization_id, conversation_key)` where active. Choose the conservative `updated_at` guard even though assignment rows can qualify for an exemption. A recreated link receives a new generation; stale unlink/undo targets the old UUID/version, preventing ABA races.

No subject, address, name, body or attachment is stored here. CRM hard-delete captures/removes its business links for compatible undo; email content and authorization anchors survive. After a record is gone, the mail remains reachable globally or from other linked records. Recreating an unrelated Person with the same address does not inherit the deleted Person's authorization scope.

### CustomerEmailAuthorizationAnchor — original permission provenance

New customers-owned `customer_email_authorization_anchors`:

| Column | Contract |
| --- | --- |
| `id`, `tenant_id`, `organization_id` | UUID and required trusted scope. |
| `source_interaction_id` | Nullable logical UUID; surviving metadata must not cascade with interaction deletion. |
| `historical_person_entity_id` | Nullable stable logical Person UUID for the original grant scope; no live FK. Null for source-verified unmatched channel provenance. |
| `message_channel_link_id`, `message_id` | Logical source UUIDs, scoped and verified through the source service. |
| `message_thread_id`, `conversation_key` | Nullable source thread UUID plus server-normalized fallback key. Source changes reconcile atomically. |
| `owner_user_id`, `channel_id`, `channel_provider_key` | Exact original mailbox-author/channel provenance; record ownership is unrelated. |
| `visibility`, `visibility_origin` | `private`/`shared`; null allowed only for verified legacy-null provenance. New unmatched anchors default private. |
| `source_detached_at` | Original CRM interaction removal; does not revoke read access. |
| `created_at`, `updated_at`, `deleted_at` | Versioned metadata; deleted only by explicit source retention/purge policy, never manual relevance. |

Preserve one row per original interaction provenance, not one arbitrary row per message. Unique scoped non-null source-interaction ID; a separate partial unique key prevents duplicate unmatched channel provenance for a message link. Index scoped conversation/message/link lookups; index `(tenant_id, organization_id, historical_person_entity_id, owner_user_id)` for grants and scoped owner/channel visibility predicates.

This is authorization metadata, not a content store. Use the verified source owner and **current** grants. Live interaction visibility and its exact retained anchor are updated atomically; legacy and v2 routes use the same policy. Each original anchor is a separate versioned permission scope, so a retained visibility edit requires that anchor's own updatedAt rather than a record/message timestamp. There is no extra shared aggregate/root anchor that could keep mail shared after its original visibility is made private.

Source-linked author/owner, channel/provider, message/link IDs, email classification and original Person authorization scope are immutable to ordinary interaction edits. Reject generic create/update values that fabricate or alter source-email provenance, including author spoofing, type switching of a source-linked interaction, and a claimed source link without trusted source evidence. The verified ingestion/compose path derives these fields server-side. Ordinary non-source CRM notes retain their existing editing behavior and cannot mint source-email authority. Generic edits to labels or business relevance cannot retarget a Person-history grant. A genuine source correction, if required, uses a separately specified owner-authorized/source-verified repair operation with an audit trail and explicit permission-set reconciliation; arbitrary authorization re-anchoring is not part of v2. Document the security tightening of the existing generic mutation paths under the compatibility protocol.

There are no new PII labels/addresses in this table. Any new label/header/body snapshot introduced during implementation requires an explicit module `encryption.ts` map and decryption-helper reads; unencrypted free-text fallback is forbidden.

### CustomerEmailHistoryShare — compatible retained grant authority

Add customers-owned `customer_email_history_shares` with `id`, required tenant/org, `historical_person_entity_id` (logical UUID), `owner_user_id`, `shared_by_user_id`, `created_at`, `updated_at` and `deleted_at`. Preserve the existing share ID when backfilling. Unique active scoped `(historical_person_entity_id, owner_user_id)` and indexed EXISTS lookups; no live Person FK and no copied labels/content.

This retains the **same existing owner/Person-history grant**, independently of the required live Person relation on `CustomerEmailConversationShare`. Keeping the legacy relation/property unchanged avoids introducing nullable values into its public entity contract. The old table remains a compatibility projection for live-Person APIs. Sharing mutations update the current retained authority and its live projection in the same customers transaction; legacy readers consult the shared policy. New grant creation requires a real in-scope Person and the authenticated mailbox owner. Revocation remains possible after that Person is deleted.

CRM hard-delete explicitly captures/removes the legacy FK projection, including inactive rows that otherwise block deletion, while retaining the current history authority. Undo rebinds the original stable IDs only if the retained authority is still active; it must never recreate a subsequently revoked grant. Backfill/reconciliation cannot overwrite a newer revoke. New People with matching addresses do not inherit old grants.

Existing live-Person share routes/DTOs remain compatible. Add a retained-context control for the mailbox owner to inspect/revoke their same historical grant after the live Person disappears. Explain its full historical scope; it is not a thread-only grant. Normal record-view/manage permissions and administrator wildcards do not confer ownership or sharing authority.

This additional table is a deliberate compatibility cost. A future deprecation can consolidate storage after downstream consumers migrate; v2 must not silently change the existing exported relation's required type.

### Existing entities and delivery intents

Reuse CustomerEntity `isActive`, `updatedAt`, existing Message/MessageChannelLink/ExternalConversation and source attachment records. ExternalConversation exists; v2 does not assert that the platform lacks every conversation entity. `Message.threadId` remains the grouping identity currently used by CRM; separately ingested copies can differ, while explicit cross-channel replies can legitimately inherit a parent's thread ID.

Source-owned outbound delivery needs a durable intent keyed by `(tenant, organization, actor, clientRequestId)` and a payload fingerprint. Extend an existing suitable source job/outbox record when available; otherwise add an append-only source-owned intent, with no new production dependency. Its states are `prepared`, `queued`, `delivered`, `failed` and `delivery_unknown`; store content only through existing encrypted draft/message payload storage and logical references, not in customers tables. Persist the exact parent, channel, recipient payload and requested record context before provider dispatch. Reused keys with different payloads return conflict; active/unknown intents never trigger a blind second provider send.

## 📝 API Contracts

All paths below are under `/api`. Existing paths stay supported. V2 introduces an additive family and moves both in-repo hosts onto it. Every route exports per-method `metadata` and `openApi`, validates zod inputs, uses trusted scope and the command/mutation-guard registry. Custom actions use the supported route-mutation-guard wrapper where available, otherwise the registry directly; do not copy deprecated guard helpers from old routes.

### Reads and discovery

| Method and path | Input / response | Authorization |
| --- | --- | --- |
| `GET /customers/people/[id]/email-conversations` | Conversation summary page for Person context. | `customers.people.view`; record's own tenant/org access. |
| `GET /customers/companies/[id]/email-conversations` | Same summary page for Company context. | `customers.companies.view` + `customers.people.view`; record scope. |
| `GET /customers/email-conversations` | Same page across accessible CRM email, including unassigned mail; used by Link existing and global history. | `customers.people.view`; allowed orgs and current email access. |
| `GET /customers/email-conversations/[key]/messages` | Chronological message page, accessed independently of a particular record. | `customers.people.view`; current email access to each returned message. |
| `GET /customers/email-conversations/[key]/related-records` | Paged visible Person/Company associations with link ID, kind, link `updatedAt` and record `updatedAt`. | Current conversation access plus view access for each returned record, before paging. |
| `GET /customers/email-conversations/[key]/access` | Current per-email access explanations plus paged owner controls, original anchor IDs/updatedAt and retained grant IDs/updatedAt where manageable. | Current read access; owner-only management information. |
| `GET /customers/email-senders` | Paged source-owned sender choices, including a verified eligible default and owned disconnected choices with disabled state. | `customers.email.compose`, `customers.people.view`; actor-owned email channels in the concrete permitted org. |
| `GET /customers/email-messages/[messageId]/attachments` | Paged authorized attachment metadata and authenticated download paths. | Exact message read plus attachment scope/partition policy. |
| `GET /customers/email-messages/[messageId]/attachments/[attachmentId]` | Authorized binary/preview stream. | Revalidate message and exact attachment-parent assignment on every request. |

Summary query: `cursor?`, `pageSize?` (default 25, maximum 100), `q?` (trimmed 1–200 characters), `from?`, `to?`, `history=active|trash` (default active). Global discovery optionally accepts `excludeRelatedTo` with validated record kind/ID and record access, and `organizationId` restricted to the authenticated allowed set. Archive state does not filter email authority. A Person/Company list has an explicit Active/Inactive-or-archived/All record filter; direct archived-record pages retain history.

Summary response:

```ts
type ConversationPage = {
  items: Array<{
    conversationKey: string
    subject: string
    snippet: string
    latestReadableMessageAt: string
    latestReadableMessageId: string
    participants: Array<{ name?: string; address: string }>
    hasMoreParticipants: boolean
    channels: Array<{ id: string; label: string; canSend: boolean }>
    hasMoreChannels: boolean
    accessSummary: 'private' | 'shared' | 'mixed'
    relatedRecords: Array<{ id: string; kind: 'person' | 'company'; label: string }>
    hasMoreRelatedRecords: boolean
    hasMissingContent: boolean
  }>
  nextCursor: string | null
  snapshotAt: string
  state: 'ready' | 'syncing' | 'indexing' | 'unavailable'
}
```

All summary fields derive from authorized messages only. Participant/Bcc disclosure follows source delivery permissions; Bcc is never exposed to another participant or copied into Reply all. Omit unavailable message counts rather than reporting a retained slice as the total. UI may show an exact accessible count only when computed from the complete authorized set.

Summary metadata is a labeled preview: at most five authorized participants, three channels and three visible related records; bound subject/snippet/label previews without altering stored source values. The hasMore flags refer only to additional authorized entries. Complete participants/headers are available in the paged message reader, complete context in Related records, and sender choices through the proposed source-owned paged sender port/API. No preview cutoff limits archive reachability. Related-record, attachment and owner-access reads accept cursor/pageSize (default 25, maximum 100), enforce access before stable ID/time ordering, and return items/nextCursor. Picker inputs are also server-paged/searchable; never preload the entire contact or channel roster.

`GET /customers/email-senders` accepts permitted concrete organizationId, cursor/pageSize and optional q. Return `{ items:[{ id, label, fromAddress, isPrimary, canSend, disabledReason? }], nextCursor, defaultSender }`; defaultSender is one verified eligible choice with the same fields, or null, and all entries are actor-owned email channels. Derive an eligible primary/default server-side, return its authorized choice even if it is outside the current search page, and require explicit review of any sender change. Revalidate eligibility on send/dispatch. This is a new bounded CRM contract over source-owned data; it does not claim the existing `/communication_channels/me/channels` profile endpoint is paged or change its default response.

Message query: `before?`, `pageSize?` (default 25, maximum 100), `history` and optional `context` used solely to enforce route/record view permissions. Return `{ items, olderCursor, hasMore, state }`; items include source message ID, sender/To/Cc, subject, sanitized body/body format, sent/received time, authorized access label, source delivery status and an attachment preview/continuation to the complete paged attachment list. Fetch newest bounded messages first and display them chronologically; loading older prepends without losing scroll position. Missing content remains a labeled authorized item with available recovery, never an omitted row or fabricated body.

Cursor contract: opaque authenticated token with version, viewer/scope/filter binding, authorized ordering tuple, snapshot time and bounded expiry. Conversation order is `(latest readable message time DESC, conversation key ASC)`; message order uses source timestamp plus stable message ID. For list traversal, calculate the latest readable time from messages at or before the snapshot and relevance established by that snapshot. New arrivals/links appear on Refresh. Stable traversal without duplicates/gaps is guaranteed while access, existing relevance, history state and source ordering remain unchanged; it is not a snapshot of permissions.

Re-evaluate current grants on every page; a cursor never grants access. Revocation can change a conversation's latest readable time, and unlink/trash/reconciliation can change membership. On a detected change, discard affected cursors and restart the list with a generic history-changed notice, retaining the draft/selected conversation only if still readable. Clients deduplicate loaded keys and offer Refresh throughout; a refresh starts a fresh complete traversal. Do not claim gap-free traversal across concurrent policy/relevance mutations. Tests must prove immediate authorization on the next page and complete reachability after restart, not freeze revoked access for paging stability. Tampered/mismatched/expired tokens produce a generic cursor error and restart action, without exposing hidden IDs or counts.

Search: server-side baseline token keyword matching across authorized retained subject, participants and plain-text email body; multiple query tokens use documented AND semantics, with normalized word matching rather than arbitrary substring promises. Date/context filters apply to the same authorized candidate set. Page/search must not first select only 50 conversations, 200 messages, 500 grants or the current contact roster. Index all supported retained body content, including terms near the end of long bodies, through source-owned encrypted/token indexing. Do not use ILIKE against ciphertext or send private mail to a vector/AI provider. Missing/incomplete indexes report indexing/unavailable and expose Retry/browse; they do not masquerade as a complete zero-match result.

### Business associations

`POST /customers/email-conversation-links`:

```json
{ "recordId": "uuid", "recordKind": "person", "conversationKey": "server-issued-key" }
```

Require that record's view/manage features, `customers.people.view`, and current conversation readability. Active affiliation is not required. Validate IDs/kind in the same scope. Return `201` for a new generation or `200` for an already-active link: `{ id, recordId, recordKind, conversationKey, updatedAt, created }`. Concurrent duplicate creates converge through the active unique constraint. A result containing `created:false` carries no destructive undo.

`DELETE /customers/email-conversation-links/[id]` requires the same access and an optimistic-lock header for that link. Soft-delete its exact version; return `{ ok:true }`. Unknown/inaccessible/already-deleted links return the same `404`. `409` uses the shared conflict body.

`POST /customers/email-conversations/[key]/related-records` is the bounded compound action used by the Related records dialog; it changes explicit deltas, not the entire relationship set:

```json
{
  "changes": [
    { "operation": "link", "recordId": "uuid", "recordKind": "company", "recordUpdatedAt": "ISO-8601" },
    { "operation": "unlink", "linkId": "uuid", "updatedAt": "ISO-8601", "recordUpdatedAt": "ISO-8601" }
  ]
}
```

Allow 1–20 changes, reject duplicate/conflicting targets, and require current conversation readability plus view/manage features for every affected record in the same concrete org. The server derives an unlink's record from its scoped link. Revalidate each record version and each existing link's own version through the framework's scoped command optimistic-lock guard; never apply a parent record header to a child link. Commit all changes in one customers transaction or none. Return `200 { createdLinks, removedLinkIds, unchangedLinkIds }` plus the standard command/undo metadata. Each returned active link has id/recordId/kind/updatedAt. A target that became unavailable yields generic `404`; a stale version yields the shared `409` conflict and no partial changes.

Active-link uniqueness makes duplicate creates no-ops, including within a retry. An already-committed unlink is not replayed against a later relink generation: a repeated stale compound request returns `404`/`409` and the UI reloads before a new explicit submission. Transport uncertainty triggers read/reconciliation, not a blind replay. The command log records only changed generations; undo revalidates all affected access/versions and is atomic, never removes an unrelated link or resurrects a grant. Multi-conversation bulk curation remains deferred.

Undo uses the command log and current access, record existence and link generation. A newer association is never silently removed or replaced. Removing the last business link leaves the message in global history; associations are not the authorization proof.

### New email and replies

`POST /customers/email-conversations/send` uses the existing recipient/content/channel limits and visibility enum, plus `clientRequestId` UUID and at most 20 related records. Each record must be in scope with its manage feature. A new email may have a selected Person, Company, both or neither; actual To/Cc/Bcc recipients are explicit. Do not invent a placeholder Person for an unknown address.

`POST /customers/email-conversations/[key]/reply` accepts the same content/channel fields, `clientRequestId` and the **exact** `parentMessageId`. The server derives the conversation/thread and reply headers. It verifies the parent exists, belongs to the allowed tenant/org and requested conversation, and is currently readable, then verifies compose feature and source send eligibility. Never silently turn an unknown/inaccessible parent into a new thread. Recipients are prefilled from the selected message's Reply-To/From and authorized To/Cc; remove the chosen sender and deduplicate. Users can review/edit recipients. Bcc is not inherited.

Reply business context is inherited from all existing active conversation relationships in the concrete org. It does not depend on a selected current Person and does not require managing every inherited record. Additional context changes use the separate authorized association operation. Different authorized actor-owned channels may continue the same source thread; this does not grant send-as authority over the original channel.

Both writes return `202 { operationId, messageId?, status }`. A queued response means durable intent accepted, not provider delivery. The operation can be read through `GET /customers/email-deliveries/[operationId]` by its authenticated actor only, with state `queued|delivered|failed|delivery_unknown`, source result IDs and a minimal actionable error. Message/delivery IDs are returned only where readable.

Persist the source-owned intent and logical CRM context before external dispatch. A durable source event projects returned source IDs and links into customers. Failures retry the projection, not the provider send. Same idempotency key/payload returns the same operation; changed payload returns `409`. If provider acceptance is uncertain, retain `delivery_unknown`, reconcile by provider IDs/operation markers when supported, and require an explicit recovery decision before any send that might duplicate delivery. Exactly-once delivery across arbitrary providers is not promised.

Sharing/visibility of each new reply defaults private and remains an independent authorized setting. Replying to shared mail does not automatically share the reply. Existing MIME/header behavior and actor attribution remain source-owned.

### Retained sharing, lifecycle and error semantics

`PATCH /customers/email-authorization-anchors/[id]/visibility` accepts `{ "visibility": "private" }`, with allowed visibility values private/shared. Require `customers.email.compose`, `customers.people.view`, current email readability, verified matching mailbox owner and the optimistic-lock header for this exact anchor's updatedAt. Reject caller-supplied owner/Person/channel fields with the strict schema: they are not editable inputs. Atomically change only this original permission scope and its matching live interaction, if it still exists; return `{ id, messageId, messageChannelLinkId, visibility, updatedAt }`. The same operation works after CRM hard-delete. Unknown/inaccessible anchors return generic `404`; stale versions return shared `409`; source-verification failure is `503`. Both legacy visibility writes and this command use the same transactional service and update the anchor version.

Access controls use paged `GET .../access` (default 25, maximum 100) to inspect all manageable original anchors without a hidden cutoff. The usual single-anchor email shows one visibility control. Where a message has several original permission scopes/mailbox copies, label those controls separately and require an explicit choice of the scope to change; there is no misleading global Private toggle. A private setting does not revoke a historical Person grant, channel sharing, another original shared anchor or another owner's copy. Show the effective access explanation separately and provide the authorized grant/channel control for the actual source of access. Undo uses the current exact anchor/live-projection versions and cannot restore an unrelated revoked grant.

`DELETE /customers/email-history-shares/[id]` revokes the same historical owner/Person-history grant, including after CRM deletion. Require `customers.email.share_conversation`, authenticated matching mailbox owner and version header; update retained authority and any live compatibility projection atomically. Existing live grant creation and visibility routes remain available and synchronize through the common service. Do not add a Company-wide grant or administrator bypass.

Archive/Restore refers to CRM records and uses the existing version-checked People/Company update APIs with `isActive:false/true`. Existing DELETE APIs retain their CRM-destructive meaning while capturing links/complete interaction metadata and ensuring retained anchors; they do not purge source mail or source-owned attachments.

Source email Trash is separate. V2 adds complete authorized retained-history reading/search/download in the Trash view, including the actor's own recipient tombstones and globally soft-deleted retained source messages where the viewer still has current email access. A recipient-only deletion affects that actor's Active/Trash membership, not other viewers; a global soft deletion moves retained content to authorized Trash history. Both views enforce the same current email/attachment policy. It does not claim that a durable source restore API already exists. Existing source deletion Undo remains available subject to current actor/scope/access and exact tombstone/version checks; add missing version metadata additively if the source path needs it. Undo never restores revoked grants or overwrites later source changes. A new durable move-from-Trash restore command is outside v2. The Trash UI offers Open retained email and available Undo, and uses Restore only for CRM Archive. No new generic permanent purge endpoint is introduced.

Common errors: `400` malformed keys/cursors, `401` unauthenticated, `403` missing operation feature, `404` unknown/out-of-scope/unreadable target, `409` optimistic/idempotency conflict, `422` field validation, `503` unavailable source/search capability. A mixed-access conversation omits unreadable messages without exposing their existence. Access revocation while open clears stale bodies, attachments and optimistic context after the next failed revalidation, preserves the actor's unsent draft, and shows a generic access-changed state.

## 📝 UI/UX

### Shared host and components

Use a common `CrmEmailConversationsTab` and `useCrmEmailConversations` on both record types, plus `/backend/customers/email-history` using the same reader and `customers.people.view` page metadata. Expose Email history from the customers navigation and both Emails hosts, including when a record has no linked conversations. `PersonEmailThreadsTab` remains an additive compatibility wrapper/re-export. Reuse the existing `EmailThreadsPanel`, `ComposeEmailDialog` and message renderer through additive props for summaries, pagination, host empty states, related records and actions; avoid parallel UI implementations.

The dedicated conversation list remains the established `EmailThreadsPanel` family. Do not replace it with a generic grid; ordinary tabular pickers use DataTable with stable IDs. Composition/association dialogs use CrudForm where applicable; custom email hosts retain their required draft/reply behavior and wrap every mutation with `useGuardedMutation`, exposing `retryLastMutation` in injection context. All data calls use shared `apiCall` helpers and defensive JSON parsing.

Company Emails is a built-in customers tab. Preserve `detail:customers.company:tabs` and `section:customers.companies.detailTabs` with their existing meanings, and preserve Person spots/handles. Additive email-host/action spots must be declared and typed, with no renaming of existing extension IDs.

### Identical experience

Both record types use the tab name **Emails**, search, date range, Active/Trash history filter, Refresh, Link existing, New email, conversation selection, older-conversation/message loading, message access labels, Related records, Reply, Reply all and attachments. Source unavailable/send-ineligible states affect both identically. A record tab lists its linked conversations; global history includes linked/unlinked accessible mail.

New email on a Person prefills that Person's known address and context. Company context prefills the Company, then asks the user to choose a contact or enter an address; never select an arbitrary first Person. Affiliation suggestions include the complete existing link/profile union and explicitly searchable archived contacts. Unknown addresses are allowed through existing send validation. Replies use the selected message and preserve context independently of employment.

Link existing searches whole authorized history, including old, unmatched and former-contact mail, and keeps permission labels visible. Related records can be corrected without changing access. Optional polish may suggest already-known explicit context to reduce an empty Company starting experience; this is not an implementation gate or an inference engine. Suggestions require confirmation and expose only authorized candidates. Domain/AI inference remains deferred.

The per-email access dialog separates the editable visibility of each original permission scope from effective access through other anchors, an owner's historical Person grant or channel sharing. A normal single-scope email has one simple control; multiple scopes are explicitly labeled and pageable. Explain the broader grant's scope before using its owner-only control, including after a Person is deleted. Turning one visibility setting private cannot be presented as revoking every other source of access. Do not add counts/placeholders for hidden private messages to either new host; retain existing public enrichers for compatibility without rendering them as different Person/Company UI behavior.

### States, navigation and accessibility

Use shared `LoadingMessage`, `ErrorMessage`, `EmptyState`, `Alert`, `StatusBadge`, `FormField`, `SectionHeader` and confirmation/conflict helpers. Separate initial loading, empty context, no search matches, paging error, missing body/file, indexing/syncing, disconnected mailbox, read revocation and disabled module. A failed page preserves previously loaded authorized content and offers Retry. Synchronization coverage is explicit when provider data is incomplete.

Desktop uses list/reader composition. At narrow widths, selecting a conversation opens/focuses the reader and provides Back to conversations, preserving query, loaded pages and scroll. Opening a related record keeps the conversation selected when it is available there. Loading older messages preserves reading position; refresh does not discard a draft or abruptly reorder the selected conversation.

Keyboard operation, meaningful focus restoration, screen-reader announcements, visible focus and labeled icon buttons are required. Every dialog supports Cmd/Ctrl+Enter and Escape. Cancel/route navigation protects a nonempty unsent draft with the shared confirmation pattern. Keep drafts in memory unless using existing secure source draft storage; do not persist email bodies in raw localStorage. Failed send retains parent, sender, recipients, body, access choice and context. Retrying must not use a newly selected contact/channel.

Use semantic design-system tokens, shared Button/IconButton controls and lucide-react icons. Touched legacy lines follow the Boy Scout rule. No new primitive, arbitrary sizes/status colors or pasted mockup CSS. Add all copy to the actual supported customers/ui/message locales through `useT`/`resolveTranslations`; use generic email-history empty copy rather than contact-only wording.

The conversation preview created during review illustrates flows, not a production layout contract. This spec's component/accessibility rules govern implementation.

### Frontend Architecture Contract

| Surface | Current boundary / planned client leaves | Data owner |
| --- | --- | --- |
| People and Companies v2 detail routes | Existing client page roots remain a documented legacy exception; add a scoped email leaf, no new page-root client conversion or provider. | Guarded record APIs and shared email API. |
| Global email/history entry | Server page/metadata shell where feasible, with the same client email leaf. Existing Messages root stays intact. | Source-owned authorized history plus CRM adapter. |
| Shared email host | Stateful selected conversation, paging/search state, abortable requests and visible-tab refresh. | Server authorization/API. |
| Compose/association/access dialogs | Scoped form/draft state, keyboard and conflict handling. Lazy-load composition leaves. | Guarded command APIs. |

Client ledger: the existing Person/Company roots need routing, inline edit and injection hooks; v2 adds no new responsibility there. The Person wrapper contains context/default props only. `CrmEmailConversationsTab` owns list/reader selection; `useCrmEmailConversations` owns abort/effect cleanup and refresh; compose owns draft and recipient editing; association/access dialogs own their guarded forms. Source modules, ORM, tokens/crypto and registries are server-only imports.

Budgets: zero newly converted client page roots, zero new global providers/bootstrap imports, each new client leaf/hook at most 300 LOC unless review documents a split/exception, zero new heavy editor/browser SDKs at route/provider roots. Existing large client roots are retained rather than expanded into larger email implementations. Measure both routes against their baseline: proposed incremental email initial-route JS budget <=35 KiB gzip excluding already-shared dependencies; lazy composer payload <=50 KiB gzip. After ten tab/record switches, subscriptions/timers return to baseline and retained heap growth attributable to the feature is <=10 MiB after collection in the documented browser harness. These are acceptance targets, not measured results.

Require route hydration/interactivity tests on both pages, `yarn check:client-boundaries` baseline comparison, production bundle evidence and one memory/refresh cleanup trace. Feature hooks/providers mount only with their visible host and clean up on unmount, org switch, navigation and logout.

## 📝 Security, Attachments and Performance

### Unified message and attachment policy

The same email-read decision governs summary, body, search, reply parent, attachment metadata, download, inline image, thumbnail and exports. Channel-email classification/base policy takes precedence over generic native permissions; optional CRM grants extend only that policy. Native message-recipient status alone must not bypass private channel-email privacy, including when customers is disabled/unavailable or a CRM interaction is deleted/retyped. For unassigned mail, source-verified mailbox ownership/shared-channel eligibility supplies access. Required source-policy failure is closed, with no partition-only/native-recipient fallback. Return channel/copy metadata only for authorized links, not every source copy of an otherwise readable message. Messages not classified as channel email, including other channel types, keep their native permissions.

Current attachment-list sender/recipient checks do not cover CRM sharing; generic file partition/scope checks alone do not cover private-email authorization. Add a source-owned, generic attachment-parent policy contribution from messages. Attachments resolves its registered policy without importing customers; messages uses its read policy and exact scoped attachment assignment. `checkAttachmentAccess` remains mandatory and is combined with the email gate, not treated as a substitute.

Direct generic file/preview/thumbnail routes for message-owned attachments must enforce that same parent gate, including when the caller holds an administrator role. If the parent/service is unavailable, fail closed with a recoverable state; never return a partition-only fallback. Private email files must not use public storage URLs/CDN caching; serve through authenticated scoped endpoints with `private,no-store` and safe content headers. Verify inline content and attachment filenames/URLs cannot inject HTML or access unrelated storage assignments. Remote tracking/images follow the established sanitized email policy and are not fetched automatically to make a preview appear complete.

Routine removal from a CRM record or draft must not release retained sent/received-email files. The current generic attachment DELETE combines attachments.manage/scope checks with physical removal; it is not a separate reviewed email-purge authority. Preserve non-email deletion behavior. Block physical removal of retained email-owned files through that generic path unless an explicit source purge policy, authorization and retention review have been approved independently; ordinary attachment management or administrator privileges are insufficient. No new email-purge capability is authorized by v2.

If an independently authorized source purge applies, permanent release uses `attachmentService.releaseScoped` with exact scope/owner/partition; commit metadata before provider byte cleanup and observe/retry cleanup failures. Preserve the both-or-neither scope invariant; v2 email attachments are fully tenant/org scoped. Do not fabricate partial-null rows or copy bytes/content to bypass source permissions.

### Query, indexing and refresh budgets

Support contextual lookup by the active-link index, anchor/grant EXISTS predicates, source scoped thread/message/time indexes and scoped hashed search tokens. Do not assert existing indexes alone prove a fast plan. Inspect representative EXPLAIN ANALYZE plans; add only measured supporting indexes in their owning modules.

Proposed reference fixture per organization: 100,000 retained email messages, 10,000 conversations, a Company with 2,000 linked conversations, a conversation with 2,000 messages, 1,000 active historical share scopes and multiple retained shared channels. Include substantial unreadable private traffic, duplicate Person provenance and encrypted bodies. Record hardware/database/browser configuration. Acceptance targets on warm local production-mode runs: p95 list/detail <=500 ms, indexed search <=1 s, first 25-summary payload <=128 KiB, and <=8 data-access SQL statements per list/detail/search request excluding framework auth/bootstrap; query count must not grow per Person/thread/grant. Message/body payload bounds follow existing source content limits and the 100-item page maximum; large attachments stream individually.

These targets require measured implementation evidence; failure must be addressed or explicitly reviewed before rollout. Avoid unbounded application ID/grant arrays, N+1 hydration, full-archive decryption and decrypting bodies before authorization. Operations exceeding 1,000 rows use resumable queue workers, typically <=500 rows per transaction, with existing connection/concurrency budgets. Sensitive email content is not exported to fulltext/vector providers merely to satisfy latency.

Reuse existing refresh/event helpers. Keep the 20-second background refresh only while the host and document are visible; run at most one in-flight request per viewer/context/query, debounce keyword input (~300 ms), abort superseded requests and bound the post-send fast-refresh window. No polling in hidden tabs; no new custom queue/process or duplicate source credential refresh. Fetch summaries before bodies; attach large message rendering to bounded pages.

### Cache and observability

All email/access/attachment responses initially use `Cache-Control: private, no-store`; server authorization/content response caching is disabled. A future cache requires scoped viewer/permission keys and reviewed invalidation. Existing CRM cache/index writes invalidate record-context and grant/anchor aliases after commit in execute and undo; use DI cache helpers with tenant/org tags, not raw Redis/SQLite.

Logs/events/telemetry contain scoped IDs, durations, row counts, job states and error fingerprints, never bodies, subjects, addresses, attachment filenames or credentials. Use the shared logger and reportError for recorded failures. Observe provenance reconciliation lag, failed jobs, missing-content recovery, grant consistency mismatches, delivery-unknown operations and latency/query-count budgets. A permission mismatch fails closed and surfaces operational recovery rather than silently sharing legacy-null data.

## 📝 Migration & Backward Compatibility

### Contract inventory

| Surface | Compatibility strategy |
| --- | --- |
| Existing Person `email-threads` and `emails` APIs | Keep paths, defaults and required DTO fields. Route through common policy; add optional cursor/continuation metadata where safe. The in-repo Person host adopts the new API. |
| Existing thread DTO/component imports | Preserve old exports and signatures through wrappers/re-exports; new pagination/access fields are additive. Keep v1 threadKey translation at the adapter. |
| Existing share entity, FK relation and routes | Keep their required public properties and live-record responses. Add separate retained authority and synchronize commands; no nullable relation retrofit. |
| People/Company update/delete | Archive uses existing isActive update semantics. DELETE still removes CRM records, while retaining independent source email/permission provenance and capturing context for undo. |
| Existing visibility/sharing features | Same owner-only behavior, wildcard-aware operation guards, no private-mail admin bypass. Legacy API keys never gain private access through a fabricated actor. |
| Generic interaction provenance edits | Ordinary content/relevance edits remain; source-linked author/type/channel/link/original Person authority is source-verified and cannot be fabricated or rewritten. Document security tightening and any safe migration/repair path. |
| Extension spots/handles/events/DI | Existing IDs and exports remain. Proposed services/registry are additive typed public contracts; no generated files edited by hand. |
| Attachment routes | Preserve non-email behavior. Add email-parent authorization to email-owned resources and correct authorized CRM-shared access. Document security tightening in UPGRADE_NOTES with operator recovery for legacy public file storage. |
| Reserved private-count enricher | Preserve its public shape during deprecation; new unified hosts do not render hidden-private counts. Document the legacy exception; do not copy it onto Company history. |

Source parent validation closes unauthorized continuation rather than removing the public parent field. Source channel-email classification, provenance-edit restrictions, attachment retention gates and current-authorized source Undo are security tightenings of existing behavior; inventory downstream consumers and document them explicitly. Any contract change that cannot retain a safe bridge must follow BACKWARD_COMPATIBILITY.md; do not assume the emergency security exception applies. A qualifying exception needs the documented vulnerability argument, upgrade instructions and named human maintainer approval. No implementation is authorized by this draft's status.

### Rollout sequence

1. Add tables/indexes and additive source read/authorization/attachment contracts. Ship faithful People/Company undo and reply-parent checks with regression coverage. Keep v2 UI inactive while preparing history.
2. Start dual writes for provenance, business context and grant authority; capture ingestion/backfill watermark. Apply visibility/sharing/delete changes transactionally in customers. Source events carry logical references; persistent reconciliation handles delivery lag.
3. Run idempotent scoped backfill in queue batches (<=500 rows/transaction), checkpointing stable source IDs. Populate exact existing provenance, live Person relevance, current grants and unassigned channel provenance from source-verified ownership. Do not infer Company links from current employment. Detect prior v1 Company links if present and import their verified server keys idempotently.
4. Reconcile every retained email link against source IDs, original visibility/owner/channel, grant state and context. Source services expose bounded inventory/read ports; no peer-table scraping. Search indexes cover the same supported archive. Bad/missing provenance goes to a scoped recovery report; never default an unknown private visibility to null/shared.
5. Compare old/new authorized message sets for representative owners/grantees, including users with >500 grants and channels, and then validate the full fixture suite. Compare counts, IDs, metadata and source-controlled content/attachment integrity fingerprints without logging plaintext. Permission expansions require an explained existing-source authorization basis; unexplained differences block activation.
6. Activate the same shared host/API on Person and Company under one customers-owned feature toggle using the existing toggle framework. Enable only after migration, privacy, attachment and performance gates pass. Show synchronization coverage explicitly. The global-history recovery entry is available with the rollout.

Large backfills are not one-shot tenant upgrade-banner transactions. They use existing progress/queue contracts with checkpoints, retries and operator-visible state. Work above 1,000 rows is background work. Keep both local and async queue strategies supported. A server crash cannot turn a partial backfill into successful completion.

### Deletion and restoration reconciliation

Before People/Company deletion, persist/verify every affected retained anchor and capture complete interaction fields: externalMessageId, channelId, channelProviderKey, visibility, author and existing content/custom snapshots. Preserve current historical grant authority; explicitly remove legacy FK projection rows so they cannot block the compatible hard-delete path. Remove/capture business links in the same customers transaction; source messages and retained file assignments are not removed.

Undo restores original entity/link IDs and complete metadata, subject to current versions and uniqueness. It restores live grant projections only from still-active retained authority. Old incomplete command logs must consult trustworthy durable/source provenance; never infer private metadata from missing fields. Where historical information cannot be reconstructed, report incomplete restoration and retain owner-accessible source mail rather than claiming successful privacy-equivalent undo. Pre-existing missing provider bodies/files cannot be recreated by schema migration; recovery status remains visible.

### Rollback and operations

Before activation, take the normal scoped backup/recovery checkpoint and verify restoration in the test environment. Application rollback disables v2 hosts/routes and retains additive data. Never drop anchors/grants/links or replay delivery intents to roll back. After v2 activity, rollback may target only a compatibility release that still honors retained grant revocations and provenance-aware deletion; rolling back to an arbitrary pre-bridge build could reopen privacy or loss bugs and is forbidden. Document this minimum safe rollback version in UPGRADE_NOTES at implementation time.

This task writes no migrations or application code and applies no local database changes. Implementation includes scoped ORM migration/snapshot files, uses the normal generator review workflow and requests authorization separately before applying migrations to a developer database.

## 📝 Edge Cases & Failure Scenarios

| Trigger | Required behavior |
| --- | --- |
| Person changes Company | Existing conversation context and original grant scopes remain; new context requires explicit choice. |
| Record archive/restore or owner reassignment | isActive/CRM owner changes do not modify mailbox authorship, grants, attachments or email reachability. |
| CRM record hard-delete | Retained anchors/grants preserve mail access globally/through other records; deleted context is captured for undo. |
| Channel disconnect/soft-delete | Sending becomes unavailable; source-owned retained read eligibility preserves previously granted historical access. Explicit channel-share revocation still revokes access. |
| Source email trash | Respect actor-recipient/global tombstones in Active/Trash; retained reading/search/download stays authorized. Existing deletion Undo is checked against current access/versions; no new durable source Restore is promised. |
| User loses grant/record/org permission | Revalidate reads/downloads; clear no-longer-authorized UI. Retain source data and unsent actor draft; do not restore grants by undo. |
| Grant revoked after send queued | Worker rechecks actor, scope, exact parent read and channel send eligibility immediately before provider dispatch. Fail safely if revoked; after provider acceptance, delivery cannot be undone. |
| Cross-channel reply | Continue only a currently readable exact parent; preserve source identity and context. Do not deduplicate distinct mailbox copies by subject. |
| Null thread ID later resolves | Reconcile verified source key to thread key, merge duplicate context associations atomically, retain audit generations and prevent stale undo. |
| Search/index/linkage backlog | Show indexing/synchronizing or recovery status; source global history remains reachable. Never return an apparently complete empty archive. |
| Provider times out after accepting | Delivery unknown; reconcile before resend. Keep draft and exact intent; no automatic fresh key or new contact target. |
| Association projection fails after send | Provider delivery state is preserved; retry projection only and show pending context. |
| Missing body or attachment | Preserve authorized item metadata and a clear missing/recovery state; no fabricated success or public-file fallback. |
| Disabled peer module | Record pages work; unavailable features fail closed and offer Retry. |
| Concurrent relink, revoke or restore | Exact generation/version checks; atomic compound deltas; conflict/reload instead of overwriting newer state. Paging after access/relevance changes restarts with live permissions. |

## 📝 Risks & Impact Review

### R1 — Relevance creates unintended private access

- **Scenario:** linking a Person lets their pre-existing grant match mail that was never in that original authority scope.
- **Severity:** Critical.
- **Affected area:** associations, shared reader, search and attachments.
- **Mitigation:** immutable source-email classification/provenance; generic create/update cannot spoof owner/type/source scope; separate original anchors from business links; current grants over original stable Person keys; no native-recipient fallback when customers is absent; privacy-negative tests.
- **Residual risk:** integration code can still misidentify provenance; activation requires old/new permission-set reconciliation and a single policy implementation.

### R2 — Retained grants diverge from the legacy projection

- **Scenario:** a legacy revoke updates only one table, or backfill/undo overwrites a later revoke.
- **Severity:** Critical.
- **Affected area:** grant/visibility commands, legacy readers and restoration.
- **Mitigation:** one versioned service/transaction for every command and generic update path; stable IDs, current authority, checkpointed backfill and negative concurrent-revoke tests. Fail closed on mismatch.
- **Residual risk:** third-party direct ORM mutations are not a supported guard bypass; document reconciliation and supported mutation contracts.

### R3 — Attachment URL bypass or physical loss

- **Scenario:** a CRM grant is denied by sender-only listing, or a generic file/public URL exposes private mail; unlink/delete removes retained bytes.
- **Severity:** Critical.
- **Affected area:** attachment listing, binary/image/thumbnail routes and deletion/storage.
- **Mitigation:** combined source message and partition/assignment gate on every access path; authenticated private streams; block generic physical deletion of retained email files without independently approved source purge authority; post-commit scoped release only for that purge; audit legacy public URLs/storage.
- **Residual risk:** already disclosed public bytes cannot be made undisclosed; migrate/rotate the affected storage references and report the exposure for operator action.

### R4 — Destructive CRM deletion outruns provenance projection

- **Scenario:** a queued ingest subscriber has not persisted the final authorization anchor when the Person is deleted.
- **Severity:** High.
- **Affected area:** People/Company delete/undo, grants and Company/global history.
- **Mitigation:** verify/upsert trusted interaction provenance inside the deletion transaction, retain current grants, preserve exact snapshot metadata and test both record types.
- **Residual risk:** old incomplete history requires source-backed recovery; unrecoverable prior metadata is reported rather than fabricated.

### R5 — Pagination/search silently omits authorized history

- **Scenario:** pre-page caps, hidden-message ordering, grant truncation, encrypted ILIKE or incomplete tokens leave old mail unreachable.
- **Severity:** High.
- **Affected area:** all list/message/search/discovery endpoints.
- **Mitigation:** relational authorization before ordering/paging; snapshot cursors with stable-traversal guarantees limited to unchanged access/relevance; restart after detected changes; complete source token indexing; explicit incomplete states and tests beyond former boundaries.
- **Residual risk:** concurrent arrivals appear on Refresh; documented keyword matching is not arbitrary substring or semantic search.

### R6 — Duplicate or unauthorized delivery

- **Scenario:** a retry sends twice, a mutable UI target changes the recipient, or a worker uses a parent/channel after revocation.
- **Severity:** High.
- **Affected area:** compose, reply, queue and providers.
- **Mitigation:** durable scoped intent/fingerprint, actor-only operation lookup, fixed targets, dispatch-time revalidation and delivery-unknown reconciliation. Source delivery stays outside reversible CRM transactions.
- **Residual risk:** arbitrary providers may not offer definitive reconciliation; a human recovery decision may be required, and delivered email cannot be unsent.

### R7 — Large-account load or sensitive indexing

- **Scenario:** unbounded grants/N+1 bodies overload the DB, or private bodies enter an external vector index.
- **Severity:** High.
- **Affected area:** query ports, search/index workers and UI.
- **Mitigation:** scoped indexed selections, eight-query target, bounded hydration/jobs, database token baseline, excluded/hash-only PII policy and measured large encrypted fixtures. No external email embeddings.
- **Residual risk:** deployment capacity varies; published p95/heap/bundle targets require evidence and operator configuration.

### R8 — Rollback reopens a security or loss path

- **Scenario:** a pre-bridge build ignores a retained revoke or hard-deletes the last provenance.
- **Severity:** High.
- **Affected area:** deployment, recovery and downstream clients.
- **Mitigation:** additive schema, safe compatibility release floor, tested backups/rollback and upgrade notes. No destructive schema rollback or intent replay.
- **Residual risk:** unsafe downgrade remains an operator action outside the supported rollback contract; instructions must state it plainly.

### R9 — Optional modules or workers are unavailable

- **Scenario:** a disabled source or stopped worker appears as empty history; UI polling and background jobs multiply load.
- **Severity:** Medium.
- **Affected area:** record pages, linkage/indexing/delivery and queue resources.
- **Mitigation:** fail-closed unavailable/pending states, durable events/reconciliation, one visible-host refresh, effect cleanup and shared connection budgets.
- **Residual risk:** background work is delayed while workers are unavailable; recovery is observable rather than instantaneous.

## 📋 Acceptance & Integration Coverage

Executable integration tests ship with each affected implementation phase in module `__integration__` directories. Create tenant/org/users/channels/records/messages/grants/files in setup with shared API fixture helpers, and clean up in finally/teardown. Use deterministic mocked source/provider behavior for delivery tests; no demo data, personal inboxes or live secrets.

| ID | Required proof | API / key UI paths |
| --- | --- | --- |
| A1 | Same viewer opens same thread on Person and Company: identical authorized messages/order/access/actions, including a continuation anchored to a different Person. | Both contextual lists, messages, related records; both Emails tabs. |
| A2 | Identical empty/loading/error/revoked/disabled states and shared keyboard/mobile behavior. | Both routes/hosts, disabled-module and hydration tests. |
| A3 | Conversation 51+ and message 201+ are reachable; 1,000+ grants and channels do not truncate visibility; stable snapshot traversal has no duplicates/gaps while access/relevance/history/order are unchanged. Revoke/unlink between pages enforces live privacy, and Refresh/restart reaches the complete newly authorized set. | Context/global lists and message pages; Load older/earlier, access-change restart. |
| A4 | Server search finds old unloaded body terms, encrypted subjects/participants, long-body tail tokens and old/unmatched/archived-contact mail; indexing failures are explicit. | Global/context search, Link existing, archived record selection. |
| A5 | Link/unlink never alters access, including a newly linked Person with existing grants; last unlink leaves mail globally available. | Link POST/DELETE, related-record dialog, global history, undo. |
| A6 | Concurrent duplicate create, unlink/relink and stale undo respect ID generations/updatedAt; a compound action is bounded and commits all deltas or none, including one revoked/inaccessible/stale child. Uncertain retries never overwrite a newer generation; guessed private links reveal nothing. | Link POST/DELETE, compound Related records POST, command/undo and dialog conflict paths. |
| A7 | Owner/shared/legitimate legacy/null/Person grant/shared-channel/mixed access behaves consistently; no admin bypass, metadata/count/cursor leak or cross-tenant/org access; All organizations works. Native-recipient plus private provenance grants no read when not owner/grantee, including customers disabled/unavailable. Generic create/update/type/author/source-link/Person-scope spoofing cannot fabricate authority. | Every read/search/context/access path, generic interaction mutations, required-policy failure and API-key negatives. |
| A8 | Authorized CRM-shared viewer can list/download retained attachments; unauthorized user cannot use generic file, inline image, thumbnail, public URL, export or administrator partition checks as a bypass. | CRM attachment routes plus existing message/generic attachment routes and file deletion. |
| A9 | Employer changes, owner reassignment, archive/restore, channel disconnect/soft-delete preserve history; explicit grant/channel-share revocation removes access on the next validation. Retained visibility PATCH works after CRM deletion, checks the exact anchor version, atomically synchronizes its live projection and explains other effective grants. | Record updates, channel actions, reads/downloads, anchor visibility PATCH, retained-grant DELETE and legacy share/visibility writes. |
| A10 | People AND Company hard-delete/undo preserve mail, exact linkage/privacy and current grants; inactive legacy FK rows do not block deletion; old incomplete snapshots never become shared by default. | Both delete/undo command families, global/Company history and retained-access controls. |
| A11 | Exact-parent/actor/channel checks, To/Cc/Reply all/Bcc correctness, cross-channel continuation, failed drafts, idempotency collisions, ambiguous delivery and worker-time revocation work. | New send/reply, legacy Person send, operation lookup, dispatch/projection workers and both composers. |
| A12 | Active/Trash membership respects actor/global tombstones; all authorized retained Trash content/files are pageable/searchable/readable, available deletion Undo checks current actor/access/version, and revoked grants stay revoked. Purged/missing content is explicit; null keys reconcile; separate imported copies stay separate; stopped workers do not imply empty history. | History active/trash, retained reader/download, existing source deletion Undo, message/key reconciliation and sync recovery. |
| A13 | Large encrypted reference fixture meets p95/query/payload budgets; summary context/participant/channel previews and context/access/file/sender pickers stay bounded with complete continuation; routes meet bundle/heap and cleanup budgets. | Read/search plans, sender API/selector, production route loads, ten navigation/tab cycles, queue backfill modes. |
| A14 | Backfill interruption/retry, concurrent revoke, activation, rollback and minimum safe compatibility build preserve verified content/access/context sets. | Reconciliation inventory/worker, legacy/v2 comparison and rollout toggle. |

Unit tests target pure conversation-key normalization, cursor validation/order, access predicates, provenance/grant projection rules, header/recipient handling, generation-aware undo and idempotency state transitions. Do not substitute unit mirrors of implementation for integration privacy/retention evidence.

The implementation gate uses the configured ordered validation commands: build packages, generate, build packages, i18n sync/usage, typecheck, test and build app, plus affected self-contained integration tests, module-decoupling checks, client-boundary comparison and documented performance evidence. Select the runner once according to the repository Docker/local rules and report it. Spec-only validation does not run application builds or apply migrations.

## 📋 Phasing

All phases belong to the accepted unified specification. Foundations can land incrementally, but the new Company capability is not declared complete until Person parity, full-history reachability, security, retention and recovery gates pass. Do not defer those guarantees to optional follow-ups.

1. **Security and retained authority:** exact reply-parent checks, faithful undo, durable original anchors/grants, attachment ownership gates and retained channel access.
2. **Shared source/history contracts:** typed optional read-policy/query ports, complete paging/search, identity adapters, trash/recovery and legacy-policy bridges.
3. **Persistent business context and reliable delivery:** Person/Company relevance, concurrency-safe commands, capture/inheritance and delivery intents/reconciliation.
4. **Shared UI:** both Emails hosts, historical discovery, composer/access controls, archived/global recovery navigation and consistent states.
5. **Backfill, verification and coordinated activation:** resumable projections/indexes, parity/security reconciliation, performance evidence and safe rollout/rollback.

## 📋 Implementation Plan

### Phase 1 — Security and retained authority

1. Pin the actual target-branch baseline and inventory every email visibility/share/interaction provenance/deletion mutation, message attachment access path and source retention operation. Add regression fixtures reproducing the known reply/undo/FK/attachment and author/type/provenance-spoofing gaps. **Verify:** negative API tests demonstrate each baseline condition without provider secrets.
2. Add the three customers-owned entities, validators, migrations/snapshot metadata, encryption review and indexed grant/provenance service. Preserve legacy share types/routes; source-verify immutable provenance on generic create/update; route all legacy and retained-anchor visibility/grant mutations through one transactional service. **Verify:** A7/A9/A10, exact-anchor conflicts/live projection, concurrent revoke and no-op generator schema diff.
3. Ensure provenance on People/Company delete, capture/restore complete snapshots and current grants, and reuse isActive update for archive/restore with parent-version headers. Add retained channel-read eligibility distinct from send status. **Verify:** both lifecycle families and A9/A10 remain usable with unchanged required contracts.
4. Add exact reply-parent checks to source compose/send, and the generic message-owned attachment-parent gate to list/file/preview/delete paths. **Verify:** A8/A11; non-email attachment behavior and optional-module tests pass.

### Phase 2 — Shared source/history contracts

5. Publish typed source-owned classification/base-policy/query contracts and the optional customers grant contributor, using authorized channel-link relations with trusted scope and explicit missing-provider semantics; no native email-recipient fallback, circular reader call or peer ORM access. Wire the policy into legacy/v2 message, reply and attachment paths. **Verify:** disabled customers/messages/channel combinations, private-plus-native-recipient negatives and A1/A7/A8.
6. Add contextual/global summary, complete message paging, bounded related-record/access/attachment/sender reads and retained Trash reading/search/download. Tighten existing source deletion Undo with current actor/scope/access and exact tombstone/version checks. Define authenticated snapshot cursors, change/restart behavior and v1 key/DTO adapters. **Verify:** all affected read/Undo routes, >50/>200/>500 boundaries, between-page revoke/unlink and A1/A3/A12/A13.
7. Index/search retained source email through database tokens with correct encryption/hash-only field policies, bounded workers and explicit incomplete states. **Verify:** encrypted and long-body search, archived/unassigned discovery and A4/A13.

### Phase 3 — Context and reliable delivery

8. Implement guarded versioned link/unlink/compound association commands, events and generation-aware undo. Preserve scope and prevent relevance from minting authority. **Verify:** A5/A6 and guesses/revocations after dialog open.
9. Add source-owned durable delivery intent/status lookup and shared new-send/reply orchestration. Persist explicit context, actor/channel/parent/recipients; revalidate at dispatch and reconcile source IDs/CRM context through durable events. **Verify:** A11, failed provider/ambiguous delivery and failed projection recovery without duplicate send.

### Phase 4 — Shared UI

10. Extract shared leaves/hook using EmailThreadsPanel/ComposeEmailDialog; preserve the Person wrapper and extension contracts; mount matching Person/Company Emails hosts and the global recovery entry. **Verify:** A1/A2, component contract tests, hydration and client-boundary ledger.
11. Implement full-history linking/search, recipient defaults, per-email/access-grant explanations, archive navigation, pagination scroll/focus and draft/conflict/retry behavior with complete locales. **Verify:** both main UI paths, A4/A5/A7/A11/A12 on keyboard, narrow screen and dark appearance.

### Phase 5 — Backfill and release evidence

12. Add idempotent scoped inventory/backfill/reconciliation jobs and progress, using source ports and checkpoints. Verify old/new IDs/content-permission metadata, including worker interruption and concurrent revoke. **Verify:** A14 with local and async queue strategies.
13. Record reference-fixture EXPLAIN plans, p95/query counts, payload/bundle sizes, cleanup/heap traces and all mandatory API/UI regression results. Fix budget failures before activation. **Verify:** A13 and configured build/typecheck/i18n/test gate.
14. Write UPGRADE_NOTES, minimum safe rollback version, operator recovery and feature toggle activation criteria. Activate Person/Company together only after the evidence passes; keep the spec pending until deployment evidence exists. **Verify:** A14 toggle/rollback rehearsal and human review of contract/security changes.

### Implementation file manifest (proposed)

| Area | Expected ownership/files |
| --- | --- |
| Customers data/policy | `data/entities.ts`, `data/validators.ts`, `lib/visibilityFilter.ts`, new `lib/emailHistoryAccess.ts`/`lib/emailConversationReader.ts`, grant/provenance services, `di.ts`, migrations/snapshot. |
| Customers commands | Existing People/Company/interaction/share commands; new context-link/compound and retained-anchor visibility commands, compose orchestration and reconciliation command. |
| Customers APIs | Additive paths listed in API Contracts; old Person email routes and existing visibility/share routes remain adapters. |
| Customers UI | Existing PersonEmailThreadsTab/ComposeEmailDialog and CompanyDetailTabs; new scoped shared leaves/hooks and dialogs; actual locales and stable extension declarations. |
| Source email | messages/communication_channels public source services, immutable email classification/base policy, optional grant registry, token search, source intent/delivery worker/status, lifecycle events, history/trash access and authorized/versioned deletion Undo. |
| Attachments | Existing service/generic parent-policy integration; message attachment listing, file/preview/thumbnail and protected deletion; no storage-driver construction in customers. |
| UI package | Additive EmailThreadsPanel/message component props and source-authorized attachment paths; preserve exports. |
| Tests/docs | Customers/source/attachments module `__integration__` and targeted unit tests, decoupling/client-boundary evidence, docs and UPGRADE_NOTES. |

No new provider-specific configuration, production dependency, global bootstrap email import, release/PR automation change or generated registry edit is part of this spec.

## Final Compliance Report — 2026-09-30

### AGENTS.md Files Reviewed

- Root AGENTS.md and Task Router.
- `packages/core/AGENTS.md`, customers and attachments module guides.
- `packages/ui/AGENTS.md`, `packages/ui/src/backend/AGENTS.md`, `packages/shared/AGENTS.md`.
- `packages/events/AGENTS.md`, `packages/queue/AGENTS.md`, `packages/search/AGENTS.md`.
- `.ai/specs/AGENTS.md`, `.ai/qa/AGENTS.md`, BACKWARD_COMPATIBILITY.md and the spec-writing checklist/frontend contract.

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
| --- | --- | --- | --- |
| Root/core architecture | No cross-module ORM relations; source ownership and optional coupling. | Designed compliant | Three customers-owned tables, logical source IDs, source-owned ports and optional registry contribution. |
| Root/core scoping | Trusted tenant/org and All organizations handling. | Designed compliant | Every record/message/grant/file/cursor/operation boundary is scoped. |
| Core API/commands | metadata/OpenAPI, zod, mutation guards and command side effects. | Designed compliant | Explicit on all proposed routes and write paths; legacy helper replacement included. |
| Root concurrency | updatedAt, scoped headers and shared conflict UI. | Designed compliant | Link generations, original visibility anchors, grants and record updates versioned; compound child guards use each child's version. |
| Core/shared encryption | Owning encryption maps/helpers; no ciphertext ILIKE or ad hoc crypto. | Designed compliant | Content remains source-owned; source tokens/hash-only policies and no plaintext vector content. |
| UI/backend/DS | Shared component families, apiCall, guarded writes, i18n and accessibility. | Designed compliant | Existing email family, shared dialogs/states and no mockup CSS copied into production. |
| Attachments guide | Source DI, scope invariant, partition/read checks and post-commit release. | Designed compliant | Combined email-parent gate closes listing/download inconsistency and generic private-file bypass. |
| Events/queue | Typed scoped events, idempotent durable work, bounded worker/pool usage. | Designed compliant | Projection/reconcile jobs and no private event broadcasts/custom queues. |
| Search/performance | Scoped token indexing, complete cursor paging, bounded queries and measurement. | Designed compliant | Explicit archive coverage, fixtures and latency/query/bundle/heap targets. |
| Compatibility | Preserve frozen/stable APIs/types/events/spots, document security tightening. | Designed compliant | Additive API/services and retained grant authority preserve the existing live relation; upgrade/rollback requirements explicit. |
| Spec/QA | Unified user-approved scope, phases, risks and self-contained API/UI coverage. | Designed compliant | A1–A14 map to phases and affected paths. |

### Internal Consistency Check

| Check | Status | Notes |
| --- | --- | --- |
| Data models match API contracts | Pass at design level | Relevance links, original authority, retained grants and delivery intent are separate. |
| API contracts match UI/UX | Pass at design level | Both hosts use the same routes/policy/controls; global recovery is explicit. |
| Risks cover all write operations | Pass at design level | Link/undo, grant/visibility, archive/delete, delivery, projection, attachment and rollout addressed. |
| Commands and undo defined | Pass at design level | Reversible CRM changes and irreversible external delivery distinguished. |
| Cache strategy covers reads/writes | Pass at design level | private/no-store, no content response cache, existing post-commit alias invalidation. |
| Implementation evidence | Pending | No application code, migration, delivery, security exploit reproduction or production benchmark was run for this document. |

### Non-Compliant Items / Review Conditions

No known design-rule violation is intentionally accepted. The existing large client page roots are a documented baseline exception; implementation must add no new client-root conversion or email blob. Required implementation evidence, final source-port typing/query plans, downstream compatibility review and named maintainer approval for any qualifying security exception remain release gates. These are not an assertion that this proposal is already production verified.

### Verdict

V2 is a consolidated, reviewable design proposal. It is not maintainer-approved or implemented. Implementation must preserve the stated contracts and meet the evidence gates; discovery of a new contract incompatibility requires updating this spec before changing that surface.

## Changelog

### 2026-09-30 — v2

- Replaced the Company-only/manual-current-contact scope with one unified Person/Company CRM email capability, as requested by the user.
- Added complete history/search, consistent composition/retry, privacy-safe association and shared reader/UI contracts.
- Added Archive/Restore and independent original authorization/grant retention without changing legacy hard-delete into archive.
- Included both Person and Company undo fixes, source reply validation, grant/channel cap removal and complete attachment access/retention requirements.
- Corrected source identity assumptions, retained optional-module ownership, defined additive APIs, migration/rollback, explicit failure states and measured performance targets.
- Added self-contained API/UI acceptance matrix, frontend contract, risk register and phased implementation plan.

### Review — 2026-09-30

- **Reviewer:** Primary agent plus independent scope-cohesion and retention/technical reviewers. Scope review found no blocking cohesion defect. All six technical corrections were incorporated and independently rechecked; no remaining blocker was identified in the reviewed security, retention and concurrency areas. This is a design review, not runtime verification.
- **Security:** Defined source-email authorization precedence/missing-provider behavior, immutable verified provenance, retained visibility mutation, current grants, reply-parent checks and attachment access/retention; implementation verification pending.
- **Performance:** Indexed/relational query and bounded-load targets specified; benchmarks pending implementation.
- **Cache:** private/no-store and post-commit scoped invalidation specified.
- **Commands:** Compound context deltas and exact-anchor visibility have explicit guarded API/command/undo contracts; delivery has explicit irreversible/idempotency semantics. Trash promises retained reading and existing authorized Undo, rather than an undocumented source restore API.
- **Risks:** Concrete severity/mitigation/residual risks documented.
- **Verdict:** Proposal for maintainer review; no implementation or deployment approval claimed.
