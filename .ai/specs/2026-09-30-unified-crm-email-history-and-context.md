# Unified CRM Email History and Context

**Status:** Draft — proposal awaiting maintainer review; implementation not started.
**Scope:** OSS — `customers` (owner), with small additive contracts in `messages`, `communication_channels` and `@open-mercato/ui`.
**Date:** 2026-09-30 (revised 2026-10-09 after the 2026-10-02 review and 2026-10-08 re-review)

> **Proposal for review.** This document does not claim maintainer approval or authorize implementation, deployment, migrations or permanent deletion.

**Builds on (current foundation):**

- [`implemented/2026-05-27-crm-email-integration.md`](implemented/2026-05-27-crm-email-integration.md) — Person-anchored CRM email: `CustomerInteraction` email rows linked from `communication_channels` events, the Person Emails tab, compose, and owner-only private visibility (Company and Deal pages were out of its scope).
- [`implemented/2026-05-27-email-integration-inbound-reliability-and-threading.md`](implemented/2026-05-27-email-integration-inbound-reliability-and-threading.md) — source threading that produces the `Message.threadId` used for conversation grouping.
- [`2026-08-25-crm-channel-shared-visibility.md`](2026-08-25-crm-channel-shared-visibility.md), shipped in [#5756](https://github.com/open-mercato/open-mercato/pull/5756) — owner-controlled sharing of a mailbox owner's email history with one Person (`CustomerEmailConversationShare`, `customers.email.share_conversation`, `/api/customers/people/{id}/email-share`), plus shared-channel visibility.
- [`implemented/2026-05-12-crm-bulk-delete-and-person-dependency-guard.md`](implemented/2026-05-12-crm-bulk-delete-and-person-dependency-guard.md) — the `PERSON_HAS_DEPENDENTS` / `COMPANY_HAS_DEPENDENTS` delete guards this revision extends.

## 📝 TL;DR

Give Person and Company detail pages one shared **Emails** capability: the same reader, composer, complete paged history and server search. A conversation is attached to a record by an explicit **relevance link**; a relevance link never grants read access or sending authority.

The revision makes three structural choices:

1. **Retention by guarding DELETE, not by parallel authorization storage.** Person and Company DELETE refuse records that still hold source-linked email interactions, and point the user to Archive. A new override feature (held by administrators, including through the `customers.*` wildcard) keeps today's destructive delete available after explicit confirmation (for example data-protection requests or departed mailbox owners). The previously proposed `customer_email_authorization_anchors` and `customer_email_history_shares` tables, their dual writes and their reconciliation are removed (see [Retention and deletion model](#-retention-and-deletion-model) and [Alternatives considered](#-alternatives-considered)).
2. **Authorization stays in customers-owned rows.** Because email interactions can no longer be stranded by a CRM delete, the existing `customer_interactions` email rows plus `customer_email_conversation_shares` remain the complete authorization source. List, count, cursor and search are one customers-owned SQL statement; no cross-module SQL composition is required. A Phase 0 spike proves this against a reference fixture, with a defined fallback (see [API and query architecture](#-api-and-query-architecture)).
3. **Live defects are prerequisites, not scope.** The reply-parent read-check gap and the undo metadata loss (both already described in the public review) are standalone fixes that must land first, together with one privately tracked hardening item (see [Prerequisite correctness fixes](#-prerequisite-correctness-fixes)).

## ❓ Open Questions

Each question has a recommended default. The rest of this spec is written against the defaults; a different answer changes only the sections named.

| # | Question | Options | Recommended default | Sections affected |
| --- | --- | --- | --- | --- |
| Q1 | One spec or split specs? | (a) One spec for the shared Person/Company capability. (b) Split Person parity and Company Emails into two specs. | **(a)**, with the prerequisites P1–P3 split out of scope. Person and Company must read through the same authorization query and the same reader; splitting would let them diverge. Phase 0 gates everything else, so a negative spike result stops the whole spec rather than half of it. | Implementation phases |
| Q2 | Retention design (review M1). | (a) Extend the existing delete guards and route users to Archive. (b) Durable authorization anchors plus retained history shares, keeping DELETE permissive. | **(a)** — evaluated in [Alternatives considered](#-alternatives-considered). It removes two tables, a dual write and two Critical/High risks. Its one regression — ordinary users can no longer hard-delete a Person who holds CRM email — is bounded by the override in Q6. | Retention, Data model, Migration, Risks |
| Q3 | Authorization query architecture (review M3). | (a) Customers-local authorization over `customer_interactions` + `customer_email_conversation_shares`, with denormalized `conversation_key`/`message_id`/`email_at` columns and a correlated `search_tokens` EXISTS on the customers-owned `customers:customer_interaction` token rows. (b) A cross-module "opaque relation" composed by source ports. (c) Fallback projection `customer_email_conversation_index`. | **(a)**, proven by the Phase 0 spike; **(c)** if a spike criterion fails; **(b)** is not pursued, because no DI port in the repo returns a composable SQL fragment today and (a) does not need one. | API and query architecture, Phases |
| Q4 | Should CRM global history include channel mail that matched **no** Person at ingest? | (a) Defer: unmatched mail stays in the owner's Messages inbox; CRM history covers every CRM-captured email, including archived and former contacts. (b) Include it, which needs a customers-owned capture row for mail with no Person. | **(a)**. Option (b) re-introduces an anchor-like table for a minority case. It can be specified later as an additive follow-up. | Goals, Non-goals, Global history |
| Q5 | Error contract for the extended delete guard. | (a) Keep `PERSON_HAS_DEPENDENTS` / `COMPANY_HAS_DEPENDENTS` and add a `retainedEmail` blocker. (b) New `*_HAS_RETAINED_EMAIL` codes. | **(a)**. The OpenAPI response declares `code` as a literal (`api/people/route.ts:586`, `api/companies/route.ts:555`), and bulk delete already groups per-row 422 failures generically. Adding a blocker line is additive; a new code is not. | Retention, Compatibility |
| Q6 | Should hard delete of a Person who holds source-linked email remain possible? | (a) Only through a new override feature `customers.records.delete_retained_email` (honored by both Person and Company delete), which performs today's destructive delete after explicit confirmation and is recorded in the command log. (b) Never, until a full erasure workflow exists. (c) Always (no guard). | **(a)**. It keeps today's capability for data-protection requests and for Persons whose mailbox owner has left (nobody else can clear private rows), while ordinary users are routed to Archive. A full erasure of **source** mail (`messages`, `communication_channels`, provider copies) remains a separate future spec. | Retention, ACL, Non-goals |

## 🎯 Goals

1. **Parity:** the same viewer opening the same conversation from a Person or a Company sees the same authorized messages, order, privacy labels and actions.
2. **Explicit relevance:** conversations are attached to Person/Company records by explicit, correctable, undoable relevance links. Compose sets context; replies inherit it; historical links require confirmation.
3. **Complete reachability:** every CRM-captured email the viewer may read is reachable by paging and server search. Page sizes bound the work; they never bound the archive.
4. **Relevance is not permission:** creating, removing or restoring a relevance link never changes visibility, ownership, grants, channel sharing or send authority.
5. **Isolation:** every read and write is bound to the authenticated tenant and to an allowed organization, including All organizations mode.
6. **Preserved history:** archive/restore, employer changes and mailbox disconnection never remove CRM-captured email or its authorization. Ordinary CRM DELETE cannot strand it either: DELETE is refused while retained email exists. Only the explicit override (Q6) removes it, deliberately.

## 🚫 Non-goals

- Deal context, bulk curation, new providers, delegated sending, Company sender identities, cross-mailbox deduplication, domain/AI relevance inference.
- Administrator access to private correspondence. `customers.email.view_private` stays inert (`customers/acl.ts:88-98`).
- An erasure/purge capability for **source** mail (Q6). The override in Q6 removes CRM-held data only, exactly as DELETE does today.
- Unmatched channel mail (no Person matched at ingest) in CRM history (Q4).
- Implementing prerequisites P1–P3. They land separately (P3 per the `SECURITY.md` process).
- Exactly-once delivery across arbitrary providers.

## 📝 Problem statement and user stories

Company pages have no email surface. Person email history is bounded (50 threads, 1,000 scanned interactions, 200 messages per thread) and cannot be searched server-side. A Company view built from current employment would move history when people change jobs. Separate Person and Company implementations would disagree on which messages appear and which actions work. And today a CRM delete silently removes the CRM email record of a Person, so CRM history can be lost by a routine action.

| Story | Outcome | Acceptance |
| --- | --- | --- |
| U1 — Same conversation | Read and reply consistently from either related record. | A1, A2 |
| U2 — Old correspondence | Find an old, unloaded message (including archived contacts) and open its full history. | A3, A4 |
| U3 — Useful context | Compose in record context, link historical mail, correct relevance, undo a mistaken link. | A5, A6 |
| U4 — Privacy | Only explicit owner sharing widens access; relevance never does. | A7, A8 |
| U5 — Safe lifecycle | Archive instead of delete; a delete never silently loses CRM email. | A9, A10 |
| U6 — Reliable send | Review recipients/sender; a retry never sends twice from the CRM. | A11 |
| U7 — Large accounts | Browse and search large histories within budget, with clear sync/index states. | A13, A14 |

## 📝 Current behavior (baseline)

Verified against `develop` at `7187041c2c8fa483d2e76ba7c0197157b3decf1f` (2026-10-09). Line numbers are for orientation; implementation must re-check the then-current branch.

**Person email read path**
- `GET /api/customers/people/[id]/email-threads` (`api/people/[id]/email-threads/route.ts`, feature `customers.people.view`) calls `buildPersonEmailThreads` (`lib/personEmailThreads.ts`). There is no cursor. Defaults: `DEFAULT_MAX_THREADS = 50`, `DEFAULT_MAX_MESSAGES_PER_THREAD = 200` (L81-82). Interaction rows are scanned with `limit: maxThreads * 20` (L198) **before** grouping, so a Person with more than 1,000 visible email interactions loses older threads.
- Authorization is the `buildEmailVisibilityMikroFilter` / `applyEmailVisibilityFilter` predicate (`lib/visibilityFilter.ts`). An email row is visible when `visibility IS NULL`, `visibility <> 'private'`, `author_user_id = viewer`, it matches a conversation-share grant `(entity_id, author_user_id)`, or `channel_id` is in the shared-channel list.
- Grant and channel inputs (`lib/conversationShares.ts`):
  - `listGrantsForViewerOnPerson` (L106-119), used by the Person thread route (route L72), is **uncapped**.
  - `listGrantsForViewer` (L72-99), used by unscoped surfaces such as `/interactions` and `/activities`, is capped at `SHARE_ARM_MAX = 500` (L15) and logs truncation.
  - `listSharedChannelIds` (L208-250) is capped at `SHARED_CHANNEL_ARM_MAX = 500` (L194), logs truncation and fails closed to `[]` on error. It reads `CommunicationChannel` by string entity name (L221), the existing cross-module read pattern.
  - Grants and channel IDs are materialized as application arrays and expanded into one OR arm per grant.
- `MessageChannelLink` and `Message` rows are read by string entity name (`personEmailThreads.ts:220,240`). Customers also reads `message_channel_links`/`messages` directly elsewhere (raw SQL in `link-channel-message-handler.ts:303-325,414-420`; a read-only Kysely projection in `data/enrichers.ts:402-427` via `lib/kysely.ts`). `module-decoupling.test.ts` does not constrain these reads, and no DI port in the repo returns a SQL/Kysely fragment for another module to compose (the closest precedent is a direct import of `messages/lib/participantScope.ts:47-63` by `communication_channels/data/enrichers.ts`).

**Ingest**
- `lib/link-channel-message-handler.ts` creates email interactions only on **Person** entities (address match or a verified `crmPersonId` hint, L171-205). One row per Person, unique on `(entity_id, external_message_id)` (`customer_interactions_email_dedupe_uq`). It denormalizes `channel_id` and sets `visibility` to `private` for user-scoped channels and `shared` for tenant-scoped channels. Mail with no matched Person and no threading parent creates no CRM row.

**Delete and undo**
- `customers.people.delete` (`commands/people.ts:1222+`) refuses only for deal links (`PERSON_HAS_DEPENDENTS`, L241-262, check at L1246). Otherwise it hard-deletes (`nativeDelete`) the Person's interactions, including email interactions (L1259). The guard is not re-checked inside the delete transaction.
- `customers.companies.delete` (`commands/companies.ts`) refuses for person links, deal links and direct people (`COMPANY_HAS_DEPENDENTS`, L80-113), re-checks inside the transaction (L1018-1043), then hard-deletes the Company's interactions (L1054).
- `customer_email_conversation_shares.person_entity_id` has an FK without an `ON DELETE` action (`migrations/Migration20260825120000_customers.ts:11`), and neither delete command touches that table. Deleting a Person with **any** share row, active or revoked, therefore fails at the database instead of returning a structured 422.
- Undo snapshots omit `externalMessageId`, `channelId`, `channelProviderKey` and `visibility`: `PersonInteractionSnapshot` (`people.ts:117-136`, restore L1629-1652) and `CompanyInteractionSnapshot` (`companies.ts:173-192`, restore ~L1389). → **P2**.
- `customers.interactions.delete` (`commands/interactions.ts:1222+`) soft-deletes.

**Compose and reply**
- `POST /api/customers/people/[id]/emails` (feature `customers.email.compose`) accepts any `parentMessageId` (`route.ts:39`) and forwards it (L134) → `communication_channels/lib/send-as-user.ts:142` → `messages.messages.compose`. That command resolves the parent by `{ id, tenantId, organizationId, deletedAt: null }` only (`messages/commands/messages.ts:301-315`) and copies its `threadId`. There is no read check. → **P1**.
- `messages.messages.compose` already supports an optional `idempotencyKey` (schema L144, fast path L285-294, unique-violation race handling L413-421, column `messages.idempotency_key` with unique index `messages_idempotency_key_uq (tenant_id, idempotency_key)`). Inbound ingest uses it. `send-as-user.ts` (L128-146) does **not** pass one.
- `communication_channels/commands/deliver-outbound-message.ts` short-circuits with `already_delivered` when the message's link is already `queued`/`sent`/`delivered`/`read` (L212-225). The unique `message_channel_links.message_id` prevents duplicate links. The provider call has a documented at-least-once window: a crash between the provider accepting and the success flush re-sends on retry (L444-455).

**UI and extension points**
- `detail:customers.person:tabs` (`people-v2/[id]/page.tsx:302`) and `detail:customers.company:tabs` (`companies-v2/[id]/page.tsx:299`) are consumed (for example by `warranty_claims/widgets/injection-table.ts:12,20`). Neither is declared in `customers/extension-points.ts`. `section:customers.companies.detailTabs` is the component-replacement handle (`components/detail/CompanyDetailTabs.tsx:35`).
- `privateEmailCountEnricher` (`customers.private-email-count`, `data/enrichers.ts:218-310`) adds `_privateEmailCount` to Person responses.
- The `messages:message` search entity exists with `enabled: false` (`messages/search.ts:52-54`); enabling it is entity-wide (fulltext, vector and global search gated only by `messages.view`). This spec does **not** enable it.
- `customers:customer_interaction` is the query-index entity type of the interactions CRUD route (`api/interactions/route.ts:91-92`). It is registered in no `search.ts`, so `resolveReadableEntityTypes` (`shared/src/lib/search/entityAccess.ts:90-106`) withholds it from non-superadmin global search. Email interaction `title`/`body` hold the email subject and body text on the address-match path (`link-channel-message-handler.ts:240-250`); the threading-inheritance path writes `body: null` (`:466-467`). The query engine already composes correlated `search_tokens` EXISTS subqueries (`shared/src/lib/query/engine.ts:1823`; `shared/src/lib/search/tokenLookup.ts`); `search_tokens` is owned by `query_index`.

## 📖 Glossary

| Term | Meaning in this spec | Repo identifier |
| --- | --- | --- |
| **Message** | One source email. Owned by `messages`. | `Message` (`messages`) |
| **Channel link** | The per-channel delivery/ingest record of a message (provider IDs, delivery status). Owned by `communication_channels`. | `MessageChannelLink`; `CustomerInteraction.externalMessageId` points at its ID |
| **Conversation** | Messages grouped by source thread. The key is `thread:<Message.threadId>`, or `message:<Message.id>` when there is no thread. | `Message.threadId`; new `conversation_key` |
| **Email interaction** | The CRM row that records "this channel link concerns this Person, authored by this mailbox owner, with this visibility". It is the **authorization record** for CRM email. | `CustomerInteraction` with `interactionType = 'email'` and `externalMessageId` set |
| **Retained email** | Source-linked email interactions (`interactionType = 'email'`, `externalMessageId` set, not soft-deleted) on a record. The delete guard protects them. | — |
| **Visibility** | Per-interaction `private` / `shared` / legacy `null`. | `CustomerInteraction.visibility` |
| **Conversation share (grant)** | The owner hands their whole email history with **one Person** to every user with CRM access to that Person. It matches interactions by `(entity_id = person, author_user_id = owner)`. | `CustomerEmailConversationShare` |
| **Shared channel** | A mailbox marked as a team mailbox. All its email interactions are readable. | `CommunicationChannel.visibility = 'shared'` |
| **Relevance link** | A Person/Company label on a conversation. It changes **where** a conversation is listed, never **who** can read it. | new `CustomerEmailConversationLink` |
| **Person/Company association** | The existing employment relation between Person and Company. Used only to *suggest* relevance links, never to derive them. | `CustomerPersonCompanyLink`, `CustomerPersonProfile.company` |
| **Archive** | `CustomerEntity.isActive = false` through the existing update commands. History stays. | `isActive` |
| **Delete guard** | The 422 refusal of a destructive delete while dependents exist. | `PERSON_HAS_DEPENDENTS`, `COMPANY_HAS_DEPENDENTS` |

## 🗂️ Existing vs proposed data model

```
                         (customers-owned)                                      (source-owned)
 ┌──────────────────────────┐   entity_id   ┌──────────────────────────────┐ externalMessageId ┌────────────────────┐   messageId   ┌──────────┐
 │ CustomerEntity (Person)  │◀──────────────│ CustomerInteraction (email)  │──────────────────▶│ MessageChannelLink │──────────────▶│ Message  │
 │  EXISTING  isActive      │               │  EXISTING  authorUserId,     │   logical UUID    │  EXISTING          │               │ EXISTING │
 └──────────────────────────┘               │  visibility, channelId       │                   └────────────────────┘               │ threadId │
        ▲            ▲                      │  + NEW conversation_key      │                                                        └──────────┘
        │            │ person_entity_id     │  + NEW message_id, email_at  │
        │   ┌─────────────────────────────┐ └──────────────────────────────┘
        │   │ CustomerEmailConversation-  │      matched by (entity_id, author_user_id)
        │   │ Share  EXISTING (grant)     │──────────────────────────────────────▶ (authorization only)
        │   └─────────────────────────────┘
        │ entity_id (Person or Company)
 ┌──────────────────────────────────┐  conversation_key (same value, no FK)
 │ CustomerEmailConversationLink    │─────────────────────────────────────────▶ (relevance only, never authorization)
 │  NEW (relevance link)            │
 └──────────────────────────────────┘
```

| Entity | Status | Role |
| --- | --- | --- |
| `CustomerInteraction` (email) | Existing; **three additive nullable columns** `conversation_key text`, `message_id uuid`, `email_at timestamptz` (= `COALESCE(occurred_at, created_at)` at link time) plus the partial indexes the spike keeps. | Authorization record and grouping/search key. Denormalized like `channel_id` was, to avoid a cross-module join. `Message.threadId` is only set when null and never rewritten after send (`messages/commands/messages.ts:353-354`), so the copy is stable. |
| `CustomerEmailConversationShare` | Existing; **unchanged schema**. A Person delete (allowed only without retained email) captures and removes its share rows; undo restores the active ones. | Person-history grant. |
| `CustomerEmailConversationLink` | **New** `customer_email_conversation_links` (schema below). | Relevance label for Person/Company. |
| `Message` | Existing; **one additive nullable column** `idempotency_fingerprint` (see [Failure, retry and idempotency](#-failure-retry-and-idempotency)). | Content and threading. |
| `MessageChannelLink`, `CommunicationChannel` | Existing; unchanged. | Delivery and channel ownership. |
| ~~`customer_email_authorization_anchors`~~, ~~`customer_email_history_shares`~~ | **Removed from the proposal** (Q2). | — |

### `CustomerEmailConversationLink` — relevance only

| Column | Contract |
| --- | --- |
| `id` | UUID primary key; also the relationship *generation* (a relink creates a new row). |
| `tenant_id`, `organization_id` | Required; derived from the trusted record scope, never from input. |
| `entity_id` | Same-module FK to `customer_entities` (Person or Company; kind validated). |
| `conversation_key` | Server-derived source key (`thread:<uuid>` / `message:<uuid>`); no cross-module FK. |
| `origin` | `manual`, `compose`, `reply_inheritance`, `ingest_person`. |
| `linked_by_user_id` | Actor for audit; null for ingest. |
| `created_at`, `updated_at`, `deleted_at` | `updated_at` for optimistic locking (returned as `updatedAt`); `deleted_at` for user unlink. |

Indexes: unique active `(tenant_id, organization_id, entity_id, conversation_key) where deleted_at is null`; reverse lookup `(tenant_id, organization_id, conversation_key) where deleted_at is null`; and a plain `(tenant_id, organization_id, entity_id, conversation_key, created_at desc)` index for the ingest-link rule that looks up the latest generation, including unlinked rows. No subject, address, name, body or attachment is stored. A stale unlink/undo targets the old UUID/version, so it can never remove a newer relink (no ABA). Record DELETE captures the record's link rows (active and soft-deleted) in the undo snapshot and **hard-deletes** them, so soft-deleted rows cannot block the record's hard delete through the FK (the trap documented at `commands/companies.ts:1044-1051`); undo recreates them with their original IDs.

**Commands (all undoable through the command log, all with per-row optimistic locking):**

| Mutation | Command | Undo |
| --- | --- | --- |
| Link | `customers.email_conversation_link.create` | Soft-deletes only the generation it created; an already-active link is a no-op without undo. |
| Unlink | `customers.email_conversation_link.delete` | Restores the same generation only if no newer active link exists and the record/conversation are still accessible. |
| Compound edit | `customers.email_conversation_link.update_context` | Reverts only its own changed generations, atomically, with current version checks. |
| Ingest/compose/reply link | written inside `link-channel-message-handler.ts` / the CRM send command | Not user-undoable; idempotent on the active unique index. |

**Ingest-link rules.**
1. **Atomic with the interaction.** The `ingest_person` link is written in the same transaction as its interaction row. It is also (re)attempted on the handler's duplicate-interaction path, so a retried delivery repairs a link whose first write failed. Today `persistInteractions` flushes row by row and skips duplicates (`link-channel-message-handler.ts:533-565`); Phase 1 changes that.
2. **User unlink wins.** Ingest and reconciliation never create a link for `(entity, conversation_key)` when that pair's latest generation was removed by a user unlink (`deleted_at` set by `customers.email_conversation_link.delete`/`update_context`). Only an explicit user link re-attaches it.
3. **Reconciliation is narrow.** It only creates links for interactions that have a key and have **never** had a link generation for their `(entity, conversation_key)`. It never undoes a user decision.

## 🔒 Product invariants

1. **Parity:** for one viewer with access to both records, the same conversation through Person or Company yields the same authorized messages, order, privacy labels and actions. Only record-context listing and new-email defaults differ.
2. **Relevance is not permission:** the authorization predicate never reads `customer_email_conversation_links`. A link on a record that the viewer can see does not make any message readable. This includes linking a Person who already has share grants: a grant matches interactions **on that Person**, not conversations labelled with that Person.
3. **Complete reachability:** every CRM-captured email interaction the viewer may read is reachable by paging and search. No pre-page cap, grant array or roster limits the candidate set.
4. **Stable history:** archive/restore, employer change and mailbox disconnection do not modify email interactions, shares or links. Ordinary CRM DELETE is refused while retained email exists.
5. **Live privacy:** revocation of a share, a shared channel or record/organization access takes effect on the next server read, download or send validation. Undo of a relevance change never restores a grant.
6. **No concealed failures:** indexing, sync, link projection and source unavailability are explicit states, not empty results.
7. **Source ownership:** `messages`/`communication_channels` keep content, threading and delivery; `attachments` keeps files; `customers` owns interactions, shares and relevance links. No duplicate email store and no direct cross-module ORM relation.

## 🧱 Prerequisite correctness fixes

P1 and P2 are **live defects on `develop`**, independent of this proposal, and both were already described publicly in review 5391346456. P3 is a prerequisite hardening item tracked outside this document. All three must land as standalone, separately reviewed changes **before Phase 1**. This spec does not implement them. Later phases treat them as baseline and add only regression assertions to their own tests.

Why separately: P1 is an authorization gap in production code paths that exist today. It should not wait for a multi-phase design review. P2 silently widens privacy on undo today. P3 is tracked privately per `SECURITY.md`; this spec depends only on the invariant it guarantees. Each is a small, testable change in one module with its own risk profile. Bundling them would make the fixes wait on design approval, and it would mix a security fix into a feature PR's review and rollback unit.

GitHub search on 2026-10-09 (`parentMessageId`, "reply parent authorization", "undo email visibility", "undo externalMessageId") found no issue or PR for any of these defects. #6432 is an adjacent compose-gating bug (closed) and #6105 concerns reply-reference semantics; neither covers these. The reviewer's 2026-10-08 search found the same. No tracking item has been filed yet; the cells below are placeholders for the author/maintainers to fill. P1's details are already public through the review, so a normal fix PR (security-labelled) is appropriate; P2 is a normal bug issue; P3 goes through the private channel in `SECURITY.md`.

| ID | Defect | Evidence | Required fix (standalone) | Tracking |
| --- | --- | --- | --- | --- |
| **P1** | Reply continuation skips the read check on the parent. Any user with `customers.email.compose` can thread a reply onto any message in the org, including another user's private mail, and the reply inherits that message's `threadId`. | `api/people/[id]/emails/route.ts:39,134` → `send-as-user.ts:142` → `messages/commands/messages.ts:301-315` (as cited in review 5391346456) | Check parent readability under the policy of the surface that accepted the request, and return the same generic 404 for unknown and unreadable parents. The native Messages compose route applies the messages read policy. The CRM route accepts a parent that is readable under the CRM email predicate or natively readable, so a share grantee can still reply to shared mail they are not a native participant of. Forwarding then happens only through a trusted server-side option that is not reachable from HTTP input. A native-only check would break those legitimate grantee replies. Never silently fall back to `threadId = parentMessageId` for an unreadable parent. The exact mechanism is the P1 PR's decision. | `TBD — fix PR (not yet filed)` |
| **P2** | People/Company delete-undo restores email interactions without `externalMessageId`, `channelId`, `channelProviderKey` and `visibility`. A private email comes back as `visibility: null`, which is legacy-visible, and it loses its source link. | `people.ts:117-136`, `:1629-1652`; `companies.ts:173-192`, `~:1389` | Capture and restore all four fields in both snapshot types. For old command logs that lack the fields, restore `visibility: 'private'` (fail closed) and leave the link null, and do not default to `null`. Add regression tests for both record kinds. | `TBD — issue (not yet filed)` |
| **P3** | Hardening item tracked privately per `SECURITY.md`. | — | Must guarantee the **provenance invariant** this spec relies on: source-linked email interactions change only through trusted, source-verified paths. | `TBD — private report (not yet filed)` |

Once the delete guard lands (Phase 1), P2 is reached for **source-linked** email only through the Q6 override. It still matters for that override, for existing command logs and for manually logged email interactions with a visibility. That is why P2 stays a prerequisite and is not dropped.

## 🔐 Authorization model

**Single predicate, customers-owned.** A CRM email message is readable by viewer *V* in organization *O* when *V* holds the route's view feature and access to *O*, and **at least one** non-deleted email interaction row *i* for that channel link in *O* satisfies the existing predicate:

```
i.visibility IS NULL                                  -- legacy rows (unchanged v1 rule)
OR i.visibility <> 'private'                          -- shared
OR i.author_user_id = V                               -- mailbox owner
OR EXISTS (active share s: s.person_entity_id = i.entity_id AND s.owner_user_id = i.author_user_id)
OR i.channel_id IN (V's readable shared channels)     -- team mailbox
```

This is the predicate of `lib/visibilityFilter.ts` today, with two changes. The grant arm becomes a correlated EXISTS instead of an application array. The shared-channel input becomes complete, or else the read reports `unavailable`; it is never silently truncated. API-key callers (`api_key:*`) keep today's strict behavior: the port normalizes them to `viewer = NULL` with an empty shared-channel list, so no author arm, no grants and no shared channels apply (and no non-UUID value ever reaches a UUID comparison).

**Rules**
- **Relevance never authorizes.** The predicate never reads relevance links. A link only decides which conversations a record context lists. Inside a listed conversation, every readable message appears, whichever Person its interaction row is on. This is what gives parity.
- **Record access is checked separately.** A record-context route first loads the Person/Company and enforces view features and the record's own organization. Then the email predicate runs within that organization.
- **No admin bypass for reading.** Wildcards and `customers.email.view_private` grant no read access to private email. (The Q6 delete override, which wildcard holders do get, removes CRM rows; it never reveals content.) Share management stays owner-only (`customers.email.share_conversation`, owner derived from the caller).
- **Revocation is immediate.** Grants, shared channels and organization access are evaluated per request. Cursors carry no authority.
- **Archived records keep their interactions.** Archive changes nothing in the predicate.
- **Provenance invariant.** Source-linked email interactions change only through trusted, source-verified paths (guaranteed by prerequisite P3).
- **Writes re-check reads.** Reply parent (P1), attachment download, link/unlink and the access dialog all require the target to be readable under this predicate at the time of the request.
- **Related-record metadata.** `ingest_person` links reveal which Persons a conversation concerns. They are shown only to viewers who can read at least one message of that conversation and who can view the linked record; this matches the existing Person Emails tab, which already shows the Person the viewer opened. Accepted and documented.

**Native Messages surfaces.** This spec does not change who can read messages through the native Messages module. CRM routes authorize with the predicate above and then hydrate content through the messages source port. The previously proposed `messageReadPolicyRegistry` and "native recipient never bypasses channel-email policy" changes are **withdrawn** from this proposal. The inventory in [Cross-module behavior changes](#cross-module-behavior-changes-and-blast-radius) shows what they would have affected. If channel email in the native inbox needs tightening, that is a separate messages-owned change.

## 🗄️ Retention and deletion model

**Archive is the routine lifecycle.** `customers.people.update` / `customers.companies.update` with `isActive: false|true` are version-checked and undoable. Archive keeps every interaction, share and link. Archived records remain discoverable through an Active/Inactive/All record filter, and their Emails tab works unchanged.

**DELETE is guarded.** The existing guards gain a `retainedEmail` blocker (Q5):

| Command | New blocker (counted in scope, re-checked inside the delete transaction) | Also inside the transaction |
| --- | --- | --- |
| `customers.people.delete` | Interactions on the Person with `interactionType = 'email' AND externalMessageId IS NOT NULL AND deletedAt IS NULL`. | Lock the `CustomerEntity` row (`FOR UPDATE`) and re-run the count inside the transaction (`people.ts` checks outside today, L1246 vs transaction at L1253; companies already re-checks). Capture the Person's share rows and relevance links **inside the locked transaction** (today the snapshot is loaded in `prepare` and `execute`, both outside the transaction), then delete them: shares match only this Person's interactions, which this command removes, and leaving them would violate the share FK; links are hard-deleted for the same FK reason. Undo restores the captured active shares, links and interactions (P2). |
| `customers.companies.delete` | Source-linked email interactions on the Company. The primary ingest path creates none (`findPeopleByAddresses` and the hint are Person-only), but the threading-inheritance fallbacks do not filter by kind (`link-channel-message-handler.ts:303-325,427-446`), and the blocker is cheap insurance against any future path. It covers both. | Capture and hard-delete the Company's relevance links; undo recreates them. They are labels, so removing them strands no mail: it stays reachable from linked People and global history. |

Active shares are deliberately **not** a blocker, although the review suggested counting them. Revoking a share is owner-only, so a share blocker would leave non-owners unable to delete a Person whose source-linked mail is already gone. A share without source-linked interactions guards nothing that DELETE would strand.

The 422 message adds a count-free blocker, `customers.people.delete.blockers.retainedEmail` / `customers.companies.delete.blockers.retainedEmail` ("email history — archive instead"), and an archive hint. No count is shown, because it would include private rows the actor cannot read. Bulk delete reuses the same commands and reports the same per-row blocker. The row lock serializes against a concurrent ingest insert: the insert's FK check (`customer_interactions_entity_id_foreign`) waits and then fails once the Person is gone. Today that 23503 is not caught in `persistInteractions` (`link-channel-message-handler.ts:558-565`), so the persistent subscriber retries and re-matches without the deleted Person; Phase 1 adds an explicit catch so the outcome is "unmatched" rather than a retry loop. Mail is never half-attached. Tests must reproduce this race on Postgres.

**Override (Q6).** A new feature `customers.records.delete_retained_email` (declared in `customers/acl.ts`, granted to no default role beyond the existing `customers.*` wildcard holders) lets the delete commands skip the `retainedEmail` blocker when the request also carries `confirmRetainedEmailDelete: true` (an additive optional boolean on the existing DELETE body/query, declared in OpenAPI; ignored without the feature, so the 422 still applies). It then performs today's behavior: interactions, shares and links of the record are captured for undo (complete metadata, P2) and removed. Source mail is untouched, exactly as today. The command log records the actor and the override. This keeps data-protection deletes and the departed-owner case possible without making them the default path.

**What stays reachable after each operation**

| Operation | Email interactions | Shares | Relevance links | Source mail |
| --- | --- | --- | --- | --- |
| Archive / Restore | kept | kept | kept | kept |
| Employer change | kept | kept | kept; suggestions change only | kept |
| Mailbox disconnect (`isActive = false`) | kept; read stays, send becomes unavailable | kept | kept | kept |
| Shared channel soft-delete (`delete-channel.ts:109`) | kept; the **shared-channel arm is revoked** (the port, like `listSharedChannelIds` today, ignores deleted channels); owner, shared-visibility, legacy and grant arms are unaffected | kept | kept | kept |
| Unlink conversation from record | kept | kept | soft-deleted (undoable) | kept |
| DELETE Person with retained email | **refused (422)** | — | — | — |
| DELETE with the Q6 override | captured + removed, restored on undo | captured + removed, active ones restored on undo | captured + removed, restored on undo | kept |
| DELETE Person/Company without retained email | none source-linked; manual email rows removed, restored on undo (P2) | captured + deleted, active ones restored on undo | captured + removed, restored on undo | kept |
| One email interaction is removed from CRM (`customers.interactions.delete`) | soft-deleted, so it leaves CRM for everyone | kept | kept | kept in the owner's Messages inbox |

**Erasure (GDPR).** Today's DELETE removes CRM-held personal data — profile, addresses, comments, and the interaction copies of email subject/body (`people.ts:1253-1268`; `title`/`body` set at `link-channel-message-handler.ts:240-250`) — but leaves the `Message`, `MessageChannelLink`, attachments and provider copies untouched. The guard therefore **is a regression for ordinary users**: they can no longer remove that CRM data for a Person who has captured email. The Q6 override restores exactly today's capability for authorized administrators, so no deployment loses the ability to act on a data-protection request at the CRM level, including when the mailbox owner has left. A complete erasure of **source** mail stays a separate, future, explicitly authorized workflow; it is not made harder by this design. Retained mail never outranks a lawful erasure request. By contrast, the rejected anchor design would have kept Person-keyed authorization metadata after the Person was deleted, which is harder to erase.

## 🧭 API and query architecture

### Ports (new, typed, DI-registered)

The ports are owned where the data lives. Customers never imports peer entity classes. The existing string-entity-name reads in `personEmailThreads.ts` and `conversationShares.ts` move behind these ports.

```ts
// packages/core/src/modules/customers/lib/emailHistoryAccess.ts — DI key: 'customerEmailHistoryAccess'
export type CrmEmailViewer = {
  tenantId: string
  organizationId: string            // one concrete org per query; All-organizations fans out per allowed org
  userId: string | null             // the port maps 'api_key:*' to null → strict arms only
}

export type CrmEmailListInput = {
  context: { kind: 'person' | 'company'; recordId: string } | { kind: 'global' }
  q?: string                         // 1–200 chars, token AND semantics
  from?: Date
  to?: Date
  snapshotAt: Date
  after?: { latestAt: Date; conversationKey: string } | null   // decoded, verified cursor
  pageSize: number                   // 1–100
}

export type CrmEmailListResult =
  | { state: 'ready'; items: Array<{ conversationKey: string; latestReadableAt: Date; latestReadableLinkId: string }>; hasMore: boolean }
  | { state: 'indexing' | 'unavailable'; reason: 'search-index-incomplete' | 'shared-channels-incomplete' | 'source-unavailable' | 'query-failed' }

export interface CustomerEmailHistoryAccess {
  listConversations(viewer: CrmEmailViewer, input: CrmEmailListInput): Promise<CrmEmailListResult>
  listReadableLinks(viewer: CrmEmailViewer, input: {
    conversationKey: string; before?: { at: Date; linkId: string } | null; pageSize: number
  }): Promise<
    | { state: 'ready'; items: Array<{ messageChannelLinkId: string; messageId: string; emailAt: Date; access: 'owner' | 'shared' | 'legacy' | 'grant' | 'channel' }>; hasMore: boolean }
    | { state: 'unavailable'; reason: 'shared-channels-incomplete' | 'query-failed' }
  >
  canReadLink(viewer: CrmEmailViewer, messageChannelLinkId: string): Promise<boolean>   // false on any error (fail closed)
}

// packages/core/src/modules/communication_channels — DI key: 'communicationChannelHistoryAccess'
export interface CommunicationChannelHistoryAccess {
  // Complete list or an explicit incomplete result; never a silent truncation.
  listReadableSharedChannelIds(scope: { tenantId: string; organizationId: string }, viewerUserId: string):
    Promise<{ complete: true; ids: string[] } | { complete: false }>
}

// packages/core/src/modules/messages — DI key: 'messageEmailSource'
export interface MessageEmailSource {
  // Inputs are bounded by one page (≤ 100 IDs) that customers has already authorized.
  loadSummaries(scope: { tenantId: string; organizationId: string }, linkIds: string[]): Promise<EmailSummaryDto[]>
  loadMessages(scope: { tenantId: string; organizationId: string }, linkIds: string[]): Promise<EmailMessageDto[]>
  resolveConversationKey(scope: { tenantId: string; organizationId: string }, messageId: string): Promise<string | null>
}
```

The DTOs carry only fields the CRM reader renders (decrypted through the owning module's helpers). No ORM entity crosses a module boundary. Peer modules are resolved with the existing optional-resolution pattern.

**Failure behavior (all ports fail closed):** a missing or throwing peer port, an incomplete shared-channel list, or a database error yields `state: 'unavailable'` (or `false` from `canReadLink`), never an empty page and never a wider predicate. `loadSummaries`/`loadMessages` return only rows for the given IDs in the given scope; a requested ID that is missing is rendered as a labeled "content unavailable" item, not dropped. `messageEmailSource.resolveConversationKey` is introduced in Phase 1 (ingest needs it); the other methods in Phase 2.

### Query sketch (customers-only SQL, one statement)

Context listing for a Company (Person is the same with `entity_id = $person`; global omits the `ctx` filter). `$viewer` is `NULL` for API-key callers, and `$shared_channel_ids` is then empty:

```sql
WITH ctx AS (
  SELECT l.conversation_key
  FROM customer_email_conversation_links l
  WHERE l.tenant_id = $tenant AND l.organization_id = $org
    AND l.entity_id = $company AND l.deleted_at IS NULL
    AND l.created_at <= $snapshot
),
readable AS (
  SELECT i.conversation_key,
         i.external_message_id                         AS link_id,
         i.email_at                                    AS at
  FROM customer_interactions i
  WHERE i.tenant_id = $tenant AND i.organization_id = $org
    AND i.interaction_type = 'email' AND i.deleted_at IS NULL
    AND i.external_message_id IS NOT NULL AND i.conversation_key IS NOT NULL
    AND i.conversation_key IN (SELECT conversation_key FROM ctx)
    AND i.email_at <= $snapshot
    AND i.created_at <= $snapshot            -- late-ingested old mail waits for Refresh instead of jumping behind the cursor
    AND ( i.visibility IS NULL
       OR i.visibility <> 'private'
       OR i.author_user_id = $viewer
       OR ($viewer IS NOT NULL AND EXISTS (       -- API-key callers get no grants (as today)
                  SELECT 1 FROM customer_email_conversation_shares s
                  WHERE s.tenant_id = i.tenant_id AND s.organization_id = i.organization_id
                    AND s.person_entity_id = i.entity_id AND s.owner_user_id = i.author_user_id
                    AND s.deleted_at IS NULL))
       OR i.channel_id = ANY($shared_channel_ids) )
    -- only when q is present: every query token must hit this interaction's own tokens
    AND ( $no_query OR EXISTS (
          SELECT 1 FROM search_tokens st
          WHERE st.entity_type = 'customers:customer_interaction' AND st.entity_id = i.id::text
            AND st.tenant_id = i.tenant_id AND st.organization_id = i.organization_id
            AND st.token_hash = ANY($hashes)
          GROUP BY st.entity_id
          HAVING count(DISTINCT st.token_hash) >= $hash_count ) )
)
SELECT conversation_key, max(at) AS latest_at,
       (array_agg(link_id ORDER BY at DESC, link_id DESC))[1] AS latest_link_id
FROM readable
GROUP BY conversation_key
HAVING $after_at IS NULL
    OR max(at) < $after_at
    OR (max(at) = $after_at AND conversation_key > $after_key)
ORDER BY latest_at DESC, conversation_key ASC
LIMIT $page_size + 1;
```

- **Isolation:** `tenant_id` and one concrete `organization_id` are bound in every table reference, including the share EXISTS and `search_tokens`. All-organizations mode runs one query per allowed organization and merges by the same order key, or uses `organization_id = ANY($allowedOrgs)` with the share EXISTS correlated on `i.organization_id`. The spike chooses between the two.
- **Viewer binding:** `$viewer` and `$shared_channel_ids` come from the authenticated context and the channel port, never from HTTP input. `$shared_channel_ids` is a complete list of shared **channels** (small, per org). It is not a message or grant array.
- **Keyset:** the `HAVING` condition is the exact complement of `ORDER BY latest_at DESC, conversation_key ASC`. Both `email_at <= $snapshot` and `created_at <= $snapshot` keep each conversation's `latest_at` frozen for the traversal; rows ingested after the snapshot appear on Refresh.
- **Search uses customers-owned tokens.** `search_tokens` is the `query_index` token table that the query engine already correlates (`engine.ts:1823`). The tokens used here are those of `customers:customer_interaction` — the query-index entity type of the interactions CRUD route — whose `title`/`body` already hold the email subject/body text. Nothing in `messages` is enabled: `messages:message` stays `enabled: false`, so no fulltext, vector or global-search exposure is added, and no email content goes to vector/AI providers. Because `customers:customer_interaction` is registered in no `search.ts`, non-superadmin global search does not return it (`entityAccess.ts:90-106`). Phase 0 checks whether superadmin token search can return interaction rows today; if it can, Phase 1 adds the type to `listSearchTokenExcludedEntityTypes` (`query_index/lib/search-entity-policy.ts:44`) so this design adds no new superadmin exposure. Token caps apply (`OM_SEARCH_MAX_TOKENS_PER_FIELD`, default 5,000 distinct tokens per field), so terms beyond the cap in very long bodies are not findable; this is documented, not hidden.
- **Messages inside a conversation** use the same `readable` predicate filtered by `conversation_key`. One message can have several interaction rows (one per matched Person), so an inner `SELECT DISTINCT ON (link_id) … ORDER BY link_id, at DESC` deduplicates first; the outer query orders `(at DESC, link_id DESC)` and keysets on `before`.
- **Hydration:** customers passes the ≤100 authorized link IDs of the page to `messageEmailSource`. That bounded array is the only cross-module data flow on the read path.
- **Statement budget:** one list statement, one shared-channel port call (cacheable per request), one hydration call per page. That fits the ≤8-statement target for a single organization. All-organizations mode with per-org fan-out is budgeted per organization; the `= ANY($allowedOrgs)` variant keeps one statement. The spike picks the variant.

Supporting index (customers, additive):
`create index customer_interactions_email_conv_idx on customer_interactions (tenant_id, organization_id, conversation_key, email_at desc) where interaction_type = 'email' and deleted_at is null and conversation_key is not null` for context listing and message paging, and `customer_interactions_email_time_idx on customer_interactions (tenant_id, organization_id, email_at desc) where interaction_type = 'email' and deleted_at is null and conversation_key is not null` for the global list (no `conversation_key` prefix). The spike keeps only the indexes whose plans it proves. The existing `customer_email_conv_shares_lookup_idx (tenant_id, organization_id, person_entity_id)` serves the share EXISTS.

### Phase 0 — authorization-query spike

Time-boxed (≤ 5 working days), on a branch, with throwaway prototype code (migration, seed script, the SQL above). Only evidence is kept — plans, timings, the equivalence report — recorded in this spec's changelog. No product code is merged.

**Reference fixture (per organization, seeded by script, encrypted columns on):** 100,000 email interactions over 10,000 conversations; one Company with 2,000 linked conversations; one conversation with 2,000 messages; 1,000 active share rows; 600 shared channels; at least 60 % private traffic the viewer cannot read; 20 % of messages matched to several Persons; archived Persons; legacy `visibility IS NULL` rows. Record hardware, Postgres version and settings. **Budgets (warm, production mode):** p95 list/message page ≤ 500 ms; indexed search p95 ≤ 1 s; first 25-summary payload ≤ 128 KiB; ≤ 8 data-access statements per request excluding auth/bootstrap, not growing with grants, Persons or threads.

**Success criteria (all required):**
1. The list statement above (Person, Company and global; with and without `q`) and the message-page statement meet the budgets, with plans that use the proposed indexes and the share index, and no sequential scan of `customer_interactions` outside the scoped partition.
2. Results equal a brute-force reference (load everything, apply `buildEmailVisibilityMikroFilter` semantics in memory) for every fixture viewer, including API-key callers: zero false positives and zero false negatives.
3. `conversation_key`, `message_id` and `email_at` can be derived for every fixture interaction from data available to `link-channel-message-handler.ts` (the `MessageChannelLink.messageId` it already reads, then `Message.threadId`), so Phase 1 can populate them at ingest and backfill in batches of ≤ 500.
4. Interactions created by `link-channel-message-handler.ts` (which uses `em.create`, not the CRUD command) either already receive `customers:customer_interaction` token rows, or the spike identifies the query-index upsert Phase 1 must emit; and the superadmin global-search check described above is recorded.

**Fallback (if 1 fails):** a customers-owned projection `customer_email_conversation_index`, with one row per `(tenant, org, conversation_key, entity_id, author_user_id, visibility_class, channel_id)` and `latest_at`. It is maintained in the same customers transaction as every email-interaction write (create, visibility change, delete, undo). There is no cross-module dual write, because all inputs are customers-owned. Listing groups over this smaller table; message paging still uses `customer_interactions`. If only the search part of criterion 1 fails, search falls back to `findEntityIdsBySearchTokens` (`tokenLookup.ts`) restricted to the record context's interactions, with an explicit `indexing`/too-broad state instead of an unbounded ID list.

**If criterion 2, 3 or 4 fails,** the spike reports `BLOCKED` and the spec returns to review. No later phase starts on an unproven query; Phases 1–5 below assume the spike result recorded in the changelog.

**`indexing` detection:** the access service reports `indexing` while the scope's Phase 5 reindex/backfill progress job has not completed (existing progress-job state). After that, per-row token lag is normal query-index eventual consistency: a just-ingested message is browsable immediately and searchable after its index event is processed. This is documented in the UI copy rather than reported as an error.

### Endpoints

All paths are under `/api`. Existing paths stay supported. Every route exports per-method `metadata` and `openApi`, validates input with zod, uses trusted scope and goes through the command/mutation-guard registry. All responses are `Cache-Control: private, no-store`.

| Method and path | Purpose | Authorization |
| --- | --- | --- |
| `GET /customers/people/[id]/email-conversations` | Conversation page for Person context. | `customers.people.view`; record's own org. |
| `GET /customers/companies/[id]/email-conversations` | Same for Company context. | `customers.companies.view` + `customers.people.view`; record's own org. |
| `GET /customers/email-conversations` | Global CRM email history (all CRM-captured email the viewer can read); used by Link existing. | `customers.people.view`; allowed orgs. |
| `GET /customers/email-conversations/[key]/messages` | Chronological message page. | `customers.people.view`; predicate per message. |
| `GET /customers/email-conversations/[key]/related-records` | Paged visible relevance links with link ID, kind and `updatedAt`. | Conversation readable + view access per returned record, applied before paging. |
| `GET /customers/email-conversations/[key]/access` | Per-message access explanation (`owner`/`shared`/`legacy`/`grant`/`channel`) for readable messages; owner-only link to the existing share control. | Conversation readable. |
| `GET /customers/email-senders` | Paged actor-owned email channels, with a verified default. | `customers.email.compose` + `customers.people.view`. |
| `GET /customers/email-messages/[messageId]/attachments[/[attachmentId]]` | Authorized attachment list and stream (payload parts and `messages:message` rows). | Predicate on the message; plus `checkAttachmentAccess` for attachment-module rows. |
| `POST /customers/email-conversation-links` / `DELETE …/[id]` | Link / unlink one record. | Record view/manage + conversation readable; optimistic lock on the link. |
| `POST /customers/email-conversations/[key]/related-records` | Atomic compound link/unlink deltas (1–20). | As above for every affected record; per-child version check. |
| `POST /customers/email-conversations/send` and `…/[key]/reply` | New email / reply with context. | `customers.email.compose`; reply parent readable (P1 baseline + predicate). |
| `GET /customers/email-deliveries/[operationId]` | Delivery status for the actor's own send. | Actor only. |

**Link contracts.** `POST /customers/email-conversation-links` body `{ recordId, recordKind: 'person'|'company', conversationKey }` → `201` new generation or `200` already active: `{ id, recordId, recordKind, conversationKey, updatedAt, created }`. `DELETE /customers/email-conversation-links/[id]` requires the optimistic-lock header for that link → `{ ok: true }`; unknown/inaccessible/already-deleted → the same `404`. The compound `POST …/[key]/related-records` body is `{ changes: [{ operation: 'link', recordId, recordKind, recordUpdatedAt } | { operation: 'unlink', linkId, updatedAt, recordUpdatedAt }] }` (1–20 changes, no duplicate targets). It commits all or nothing, using each child's own version (never a parent header), and returns `{ createdLinks, removedLinkIds, unchangedLinkIds }`. Linking requires record view/manage and current conversation readability, not active employment.

**Send contracts.** `POST /customers/email-conversations/send` accepts `{ clientRequestId (uuid), channelId, to, cc?, bcc?, subject, body, visibility, relatedRecords? (≤ 20 record refs) }` within the existing recipient/content limits. `POST …/[key]/reply` accepts the same plus the exact `parentMessageId`. The server derives thread and reply headers, checks the parent (P1 plus CRM predicate), prefills recipients from Reply-To/From and authorized To/Cc, and never inherits Bcc. Both return `202 { operationId, messageId, status }`. New replies default to `private`. Reply context is inherited from the conversation's active links (`origin = 'reply_inheritance'`).

**Paging contracts:**
- Summary query: `cursor?`, `pageSize?` (default 25, max 100), `q?` (1–200), `from?`, `to?`.
- The response shape lists only authorized participants, channels and related records, previewed at 5/3/3 with `hasMore` flags, and has `state: 'ready' | 'syncing' | 'indexing' | 'unavailable'`.
- Cursors are opaque, versioned and authenticated, bound to viewer, scope, filter and `snapshotAt`, with bounded expiry. Tampered or expired cursors return a generic cursor error with a restart action.
- The cursor order is `(latest readable time DESC, conversation_key ASC)`. Messages are ordered by source time plus a stable link ID.
- Re-evaluate authorization on every page. The cursor stores a fingerprint of the viewer's grant set, shared-channel set and the context's active link set; a mismatch on the next page restarts traversal with a generic notice. While a scope's key backfill is running, rows that gain a `conversation_key` can join a running traversal; the UI shows `syncing` for that period instead of promising gap-free paging.

Unknown, out-of-scope and unreadable targets return the same `404`. Version conflicts use the shared `409` body.

The previous revision's source-email Trash view (retained-source Trash reading and the source deletion-Undo tightening) is **removed from this scope**. It depended on source soft-delete semantics that this proposal does not otherwise touch. It can follow as a messages-owned spec.

## 🖥️ UI/UX

- A shared `CrmEmailConversationsTab` and `useCrmEmailConversations` serve both record types. `PersonEmailThreadsTab` stays as a compatibility wrapper/re-export. The tabs reuse `EmailThreadsPanel`, `ComposeEmailDialog` and the message renderer through additive props.
- **Extension points.** `detail:customers.person:tabs` and `detail:customers.company:tabs` are consumed today but **not declared** in `customers/extension-points.ts`. This work **declares both additively** with `detailHost(...)`, keeping their IDs and current meaning. `section:customers.companies.detailTabs` keeps its meaning. New email-host/action spots are declared and typed. No existing ID is renamed.
- **Global history page.** `/backend/customers/email-history` uses the same reader with `customers.people.view` page metadata. It is a CRM page rather than a view inside the Messages inbox for two reasons. Its authorization (shares, shared channels, legacy visibility) and actions (link/unlink records) are customers-owned. Embedding them in `messages` would make that module depend on the optional `customers` module.
- Both record types get the same controls: Emails tab name, search, date range, Refresh, Link existing, New email, Load older, access labels, Related records, Reply, Reply all and attachments.
- New email from a Company prefills the Company context and asks for a recipient. It never auto-selects a contact.
- Link existing searches global CRM history, including archived Persons and Persons who have since changed employer.
- The access dialog explains which arm grants access (owner, shared, legacy, Person-history grant, shared channel) and links to the owner-only share control.
- No counts or placeholders for hidden private messages are shown in the new hosts. The `privateEmailCountEnricher` response shape is preserved for compatibility.
- States, accessibility, the design-system rules, dialog keyboard handling (Cmd/Ctrl+Enter, Escape), draft protection (failed sends keep parent, sender, recipients, body and context), `useGuardedMutation` with `retryLastMutation`, `apiCall`, i18n and the frontend budgets apply:
  - zero new client page roots;
  - incremental initial JS ≤35 KiB gzip;
  - lazy composer ≤50 KiB gzip;
  - ≤10 MiB retained heap after ten tab switches.

## 🧩 Implementation phases

Prerequisites P1–P3 land first, separately (P3 per the `SECURITY.md` process). Phase 0 must report `PASS` (or `PASS with fallback`) before Phase 1 starts.

| Phase | Content | Exit evidence |
| --- | --- | --- |
| **0 — Spike** | Authorization-query spike above. | Recorded plans/latencies, equivalence report, token-coverage and superadmin-search findings; decision PASS / PASS-with-fallback / BLOCKED in the changelog. |
| **1 — Retention guard, schema and ingest** | Extend both delete guards (Q5) with the override feature (Q6); add the people in-transaction re-check, row lock and in-transaction capture of shares/links; create the link table; add `conversation_key`/`message_id`/`email_at` and indexes; add `messageEmailSource.resolveConversationKey`; make `link-channel-message-handler.ts` populate the new columns, write one `ingest_person` link per matched Person (idempotent on the active unique index; null key → row stays `syncing` and the link is written by reconciliation), catch the FK race, write the body text on the threading-inheritance path too (today `body: null`, `:466-467`), and emit the query-index upsert identified in Phase 0. | A9, A10; race test on Postgres; new ingest appears on the Person tab; generator diff limited to the intended migration. |
| **2 — Read path** | `customerEmailHistoryAccess`, the channel port and the rest of the messages port, contextual/global listing, message paging, search over `customers:customer_interaction` tokens, and adapters for the existing Person `email-threads` DTO and `threadKey`. | A1, A3, A4, A7, A13 (budgets re-measured on real code); `module-decoupling.test.ts` and optional-module checks with `messages`/`communication_channels` disabled (Emails reports `unavailable`). |
| **3 — Relevance and send** | Link/unlink/compound commands with undo, CRM send/reply over the existing compose with the `idempotencyKey` and fingerprint, delivery status, attachment routes. | A5, A6, A8, A11. |
| **4 — UI** | Shared host on Person and Company, global history page, extension-point declarations, locales. | A2, A12; both main UI paths. |
| **5 — Backfill and activation** | Backfill `conversation_key`/`message_id`/`email_at`; reindex `customers:customer_interaction` email rows; seed relevance links from existing Person interactions; parity comparison; activate both hosts together behind one feature toggle. | A14; UPGRADE_NOTES. |

## 🔄 Migration and backfill

The data migration is small:
- **Schema (customers):** the new `customer_email_conversation_links` table, three nullable columns on `customer_interactions`, and the partial indexes the spike keeps. **Schema (messages):** one nullable `idempotency_fingerprint` column on `messages`. **ACL:** one new feature `customers.records.delete_retained_email`. All additive; the normal `yarn db:generate` review flow. Nothing is applied locally without asking.
- **Backfill 1 — keys:** for email interactions with `external_message_id` and a null `conversation_key`, set `email_at = COALESCE(occurred_at, created_at)` and resolve `message_id` and `conversation_key` through `messageEmailSource` in checkpointed queue batches of ≤500 rows per transaction. Rows that cannot be resolved stay null, are counted as `syncing`, and are listed in a scoped recovery report. They are never guessed.
- **Backfill 2 — relevance:** create one `origin = 'ingest_person'` relevance link per distinct `(Person, conversation_key)` from existing interactions. Company links are **not** inferred from employment.
- **Backfill 3 — search tokens:** a query-index reindex of `customers:customer_interaction` email rows (existing reindex/queue path), so rows created by ingest before Phase 1 get tokens. `messages:message` is not touched.
- No authorization data is migrated, because none moves. **Parity check:** for representative owners, grantees, shared-channel viewers and API-key callers, the new Person route must return a **superset** of the old Person route's authorized link set. The only allowed additions are (a) rows previously hidden by the 50-thread/1,000-interaction truncation, (b) readable messages filed on other Persons inside conversations linked to this Person (the intended parity change), and (c) rows previously hidden by the `SHARE_ARM_MAX` (500) or `SHARED_CHANNEL_ARM_MAX` (500) truncation. Any row the old route returned that the new one does not, and any addition outside (a)–(c), blocks activation. The global route is compared the same way against the unscoped `/interactions` predicate, including viewers with >500 grants.
- Work over 1,000 rows runs as background jobs with progress, retries and operator-visible state. Both local and async queue strategies are supported.

## 🛡️ Security and tenant/org isolation

- Every statement binds `tenant_id` and an allowed `organization_id`, including the share EXISTS, `search_tokens`, links and hydration ports. Record routes enforce the record's own organization.
- The authorization predicate is evaluated before search, grouping, counts, ordering and cursor boundaries. There is no post-page filtering and no capped grant array.
- The reply parent, attachments, link/unlink and delivery status each re-check the predicate (or actor ownership) per request. A queued send re-checks parent readability and channel eligibility at dispatch.
- No relevance-based access. No admin bypass for reading email. API-key callers stay strict.
- Bodies, subjects, addresses and filenames never appear in logs, events or telemetry. New events (`customers.email_conversation_link.created|deleted`) carry scoped IDs only and are not `clientBroadcast`.
- Email content is not sent to vector or AI providers. Search uses the existing hashed `query_index` tokens of `customers:customer_interaction`; `messages:message` search stays disabled; no new entity type is registered for global search.
- Provenance invariant: source-linked email interactions change only through trusted, source-verified paths (P3).

### Attachments

CRM attachment routes require the message predicate. For files stored as `messages:message` `Attachment` rows they also require `checkAttachmentAccess`. Inbound channel attachments live in the channel payload, not the attachments module, and are served by `messageEmailSource`. The routes stream through authenticated endpoints with `private, no-store`. The generic attachments module routes are **not changed by this proposal**. The previously proposed gating of the generic file and DELETE routes is withdrawn from scope. The inventory below records who it would affect, so that a separate attachments-owned change can be judged on its own.

### Cross-module behavior changes and blast radius

The previous revision proposed two changes that alter behavior for existing users of other modules. This inventory, taken from `develop` `7187041c2`, states who would lose access. On that basis, **both changes are withdrawn from this proposal's scope**. The revision also deliberately does **not** enable `messages:message` search: enabling that entity is entity-wide (fulltext, vector and global search gated only by `messages.view`, `messages/search.ts:52-54`) and would expose other users' private channel mail to any `messages.view` holder. The CRM capability does not need them, because CRM routes authorize with the customers predicate and never fall back to native permissions. If maintainers want either tightening, it should be its own messages- or attachments-owned change under `BACKWARD_COMPATIBILITY.md`.

**(a) "Native recipient status never bypasses private channel-email policy" (messages read path).**

| Who has native access to channel email today | Evidence | Would lose access under the withdrawn change? |
| --- | --- | --- |
| Inbound: one `MessageRecipient`, the conversation's assignee (`mapping.assignedUserId`), else the mailbox owner (`channel.userId`); none for an unassigned tenant-wide channel. No address matching of other org users. | `communication_channels/commands/ingest-inbound-message.ts:388,408-410`; recipient insert `messages/commands/messages.ts:358-359` | **Yes, for one population:** a user to whom a thread on a *personal* mailbox was reassigned (`PUT …/threads/[threadId]/assign`, `communication_channels/api/put/threads/[threadId]/assign/route.ts`). They receive recipient rows for later inbound messages, while the CRM interaction is `private` to the owner. The owner keeps access (author arm). |
| Outbound send-as-user: sender is the actor (who must own the channel); **no** recipient rows. | `send-as-user.ts:101,128-147` | No — the sender is the CRM author. |
| Non-participants via channel fallback: `GET /api/messages/[id]` admits a non-sender/non-recipient only through `hasChannelThreadReadAccess` (requires `messages.view`). The rule is owner-only for personal mailboxes and open to all callers for tenant-wide channels (`userId == null`). | `messages/api/[id]/route.ts` (sender/recipient/channel checks ~L112-147); `messages/lib/routeHelpers.ts:71-117`; `communication_channels/lib/access-control.ts:109-129` | Tenant-wide channel mail is ingested into CRM as `shared` (`link-channel-message-handler.ts` visibility rule), so nobody loses access. Personal mailboxes: no change (owner-only already). |
| Message list `GET /api/messages`: participant-scoped (sender or recipient row), no channel fallback. | `messages/api/route.ts:192-223`; `messages/lib/participantScope.ts:47-63` | Same population as row 1 (reassigned thread assignees). |

**(b) Gating generic attachment file and DELETE routes for message-owned files.**

| Surface today | Evidence | Who would be affected by gating |
| --- | --- | --- |
| `GET /api/attachments/file/[id]`: `requireAuth: false`, then `checkAttachmentAccess`. That check is partition/tenant/org only, with no `entityId`/`recordId` or feature check. | `attachments/api/file/[id]/route.ts:20-22,46-50,72`; `attachments/lib/access.ts:45-95` | Any authenticated user in the same tenant+org who has an attachment ID of a `messages:message` file and is not a participant: they **can** download today and would lose that. Message participants download through `messages/api/[id]/attachments` (sender/recipient or public + channel access, `route.ts:50-66`) and would be unaffected. |
| `DELETE /api/attachments` and `DELETE /api/attachments/library/[id]`: `attachments.manage`, scope check, then `em.remove` **and** storage `delete` of the bytes. | `attachments/api/route.ts:55,670-718`; `attachments/api/library/[id]/route.ts:49,255-256` | Holders of `attachments.manage` (typically admins) who today can delete any message-owned file, **including bytes shared with forward copies** (`copyAttachmentsForForwardMessages` reuses `storagePath`, `messages/lib/attachments.ts:149-200`). |
| Message-owned deletes inside messages: `messages.attachments.unlink_from_draft` deletes rows only (no bytes); `delete_for_actor` soft-deletes recipient/message and leaves attachments untouched. | `messages/commands/attachments.ts:152`; `messages/commands/messages.ts:1098-1150` | Unaffected. |
| **Inbound channel email attachments are not `Attachment` rows**: MIME parts are normalized to `data:` URLs in the channel payload. | `communication_channels/lib/email-mime.ts:336-362` | Gating the attachments module would not protect them at all. CRM attachment reads therefore go through `messageEmailSource` (payload parts and any `messages:message` rows) behind the CRM predicate. |

Net effect for this proposal: **no access is removed from any existing user.** The CRM routes are new surfaces with their own authorization. The two findings above (reassigned-assignee native access to private CRM mail, and same-org download of message files by ID) are recorded for maintainers as possible follow-ups. They are not changed here.

## ♻️ Failure, retry and idempotency

**Existing mechanisms (reused, not replaced)**
- `messages.messages.compose` `idempotencyKey`: an optional string ≤255 with a unique index `messages_idempotency_key_uq (tenant_id, idempotency_key)`. A repeat returns the existing message (L285-294), and a concurrent duplicate resolves to the winner (L413-421).
- `deliver-outbound-message.ts`: the link short-circuit on `queued`/`sent`/`delivered`/`read` (L212-225) plus unique `message_channel_links.message_id` prevent a second provider call for a message whose delivery completed.

**Gaps this spec closes (and only these)**
1. **Client retry after a lost response creates a second message.** The CRM send path (`send-as-user.ts:128-146`) passes no `idempotencyKey`. New CRM send/reply endpoints accept a client `clientRequestId` (UUID) and pass `idempotencyKey = 'crm-send:' + actorUserId + ':' + clientRequestId` to the existing compose. A retry returns the same message, and the outbound short-circuit then prevents a second delivery.
2. **The same key with a different payload is silently accepted.** Messages adds an optional nullable `idempotency_fingerprint` (a hash of parent, channel, recipients, subject and body) stored with the message. A repeat with the same key and a different fingerprint returns `409`. This is additive in messages.
3. **No status for the actor.** `GET /customers/email-deliveries/[operationId]` (operation = message ID, actor-only) maps the existing link `deliveryStatus` to `queued | sent | failed`. A link that stays `pending` past a threshold is shown as `delivery_unknown`, with guidance not to resend. No new intent table or state machine is added.
4. **Context lost if the CRM projection fails after compose.** Relevance links for the new conversation are written in a customers transaction after compose returns the `threadId`. A retry with the same `clientRequestId` returns the same message and re-applies the links; the active-link uniqueness makes this a no-op when they already exist.

The provider-level at-least-once window (L444-455) is unchanged and documented. Exactly-once delivery is not promised.

**Other failure states:** a peer module is missing → `unavailable` + Retry. Search tokens are incomplete → `indexing` + browse. Shared-channel list is incomplete → `unavailable`. Unresolved `conversation_key` → `syncing`. Revocation while open → clear bodies/attachments and keep the draft. A stale link/unlink → `409` without partial change.

### Edge cases

| Trigger | Required behavior |
| --- | --- |
| Person changes Company | Interactions, shares and links stay; new Company context needs an explicit link. |
| Archive/restore or CRM owner reassignment | No change to mailbox authorship, shares, links or reachability. |
| DELETE of a Person with captured email | 422 with the archive hint; only the Q6 override deletes, with complete undo. |
| Concurrent ingest during DELETE | Row lock serializes; ingest re-matches without the deleted Person; no half-attached rows. |
| Mailbox disconnected | Read stays; send shows the channel as unavailable. |
| Shared channel soft-deleted | The shared-channel arm is revoked on the next request; other arms unaffected. |
| Share revoked between pages | Next page applies the new predicate; a detected change restarts traversal. |
| Share revoked after a reply is queued | The worker re-checks parent readability and channel eligibility before dispatch and fails safely. |
| Old mail ingested late | `created_at <= snapshot` keeps it out of the running traversal; it appears on Refresh. |
| `Message.threadId` unresolved at ingest | Row stays `syncing`; reconciliation fills the key and the `ingest_person` link. |
| Provider times out after accepting | `delivery_unknown`; same `clientRequestId` returns the same message; no blind resend. |
| Link projection fails after send | Retry with the same `clientRequestId` re-applies links idempotently. |
| New inbound mail in a conversation the user unlinked from a Person | No `ingest_person` link is re-created (ingest-link rule 2); the mail stays reachable through other links and global history. |
| Ingest link write fails after the interaction committed | Cannot happen: both are in one transaction; a retried delivery also repairs a missing link on the duplicate path. |
| `messages`/`communication_channels` disabled | Record pages load; Emails shows `unavailable`. |

## 🧪 Testing and QA

Integration tests ship with each phase in module `__integration__` directories. Every fixture (tenant, org, users, channels, people, companies, messages, shares, files) is created in setup through API helpers and removed in teardown. There is no demo data and no live provider.

| ID | Required proof | Paths |
| --- | --- | --- |
| A1 | Same viewer sees the same messages/order/actions on Person and Company, including a message whose interaction row is only on a second Person. | Both context lists, messages, both tabs. |
| A2 | Identical loading/empty/error/unavailable states; keyboard and narrow layout. | Both hosts. |
| A3 | Conversation 51+, message 201+ and interaction 1,001+ reachable. A viewer with 1,000+ grants and 600+ shared channels on the global route sees the complete set; an incomplete shared-channel list yields `unavailable`. Revoke or unlink between pages enforces live privacy, and a restart reaches the full set. | Context/global lists, message pages. |
| A4 | Server search finds old subject/body terms (within the documented per-field token cap) and archived-contact mail; before the scope's reindex completes, search reports `indexing`; non-superadmin global search returns no `customers:customer_interaction` hits. | Global/context search, Link existing, global search route. |
| A5 | Link/unlink never changes access, including linking a Person who holds share grants; the last unlink leaves mail in global history. | Link POST/DELETE, compound action, undo. |
| A6 | Concurrent duplicate create, unlink/relink, stale undo and a compound action with one stale child are all-or-nothing. After a user unlink, a new inbound message in that conversation does not re-create the link, and reconciliation does not either. | Link commands, undo, ingest, reconciliation. |
| A7 | Owner/shared/legacy/grant/channel/mixed access; no admin bypass; no cross-tenant/org access; API-key strict; All organizations works; the provenance invariant holds (regression for P3). | Every read path. |
| A8 | An authorized CRM viewer can list/download attachments; an unreadable message's attachments return 404. | CRM attachment routes. |
| A9 | Archive/restore, employer change and channel disconnect preserve history; revoking a share, un-sharing or soft-deleting a shared channel removes that arm on the next request. Newly ingested mail appears on the Person tab (ingest link). | Record updates, channel actions, share route, ingest. |
| A10 | Person/Company DELETE with retained email returns 422 `PERSON_HAS_DEPENDENTS`/`COMPANY_HAS_DEPENDENTS` with the count-free `retainedEmail` blocker; without retained email it succeeds even with active/revoked share rows and soft-deleted links; undo restores links and previously active shares; the Q6 override deletes only with the feature and confirmation flag and undoes completely. Concurrent ingest during delete never half-attaches (reproduced on Postgres). Bulk delete reports per row. | Both delete commands, override, bulk delete. |
| A11 | Reply with an unreadable parent → 404 (P1 regression). Retry with the same `clientRequestId` → one message and one delivery. Same key with a different payload → 409. Status lookup is actor-only. Failed link projection is recovered by retry. | Send/reply, status, outbound worker. |
| A12 | The extension spots are declared; the warranty_claims tabs still render on both pages. | Both detail pages. |
| A13 | Reference fixture meets the p95, statement-count and payload budgets; bundle/heap budgets are met. | Read/search plans, route loads. |
| A14 | Backfill interruption/retry, null-key recovery report, parity comparison and toggle rollback. | Backfill worker, toggle. |

Unit tests cover conversation-key normalization, cursor encode/verify, the predicate builder (kysely and mikro parity, as today), the fingerprint and guard counting. The implementation gate runs the configured validation commands plus the affected integration tests, the decoupling test and the client-boundary comparison.

## ⚠️ Risks

| ID | Scenario | Severity | Mitigation | Residual |
| --- | --- | --- | --- | --- |
| R1 | Relevance accidentally used as authorization (for example a Company list that also filters messages by link). | Critical | The predicate never reads links (invariant 2); A5/A7 negatives; one shared predicate builder with kysely/mikro parity tests. | Review discipline on future query edits. |
| R2 | The delete guard blocks users who expect DELETE to work, including for data-protection requests. | Medium | The 422 names the blocker and offers Archive; the Q6 override keeps today's delete for authorized administrators; bulk delete reports per row; precedent from the 2026-05-12 guard; documented in UPGRADE_NOTES. | Ordinary users must ask an administrator; source-mail erasure still needs a future workflow. |
| R3 | The spike passes on the fixture but the plan regresses on real data skew. | High | Index plus measured budgets in Phase 2/5; fallback projection already specified; operator-visible latency metrics. | Capacity varies by deployment. |
| R4 | `conversation_key` backfill leaves rows null, so they are missing from lists. | High | Null rows are counted as `syncing` and listed in a recovery report; the old Person route stays available until the parity check passes. | Unresolvable legacy links stay owner-visible in Messages only. |
| R5 | Search exposes private email terms or grows `search_tokens`. | Medium | Only existing `customers:customer_interaction` query-index tokens are used (hashed); `messages:message` stays disabled; the type is not registered for global search and is excluded from superadmin token search if Phase 0 finds it exposed; authorization is applied in the same statement before matching. | Token rows grow with interaction volume, as for any indexed entity. |
| R6 | Duplicate delivery on retry. | High | Existing `idempotencyKey` and outbound short-circuit; fingerprint 409; `delivery_unknown` guidance. | Provider at-least-once window (L444-455). |
| R7 | Share rows deleted with their Person lose audit history of revoked grants. | Low | Active shares are captured and restored on undo. Revoked rows grant nothing. The delete is in the command log. | Audit of past revoked grants for deleted Persons is not retained. |
| R8 | Optional modules or workers are down and appear as empty history. | Medium | Explicit `unavailable`/`syncing`/`indexing` states; retry. | Delayed recovery. |
| R9 | Email interactions are altered outside the source-verified path, weakening the authorization record or the guard. | Critical | Prerequisite P3 lands before Phase 1; A7 regression. | Direct ORM writes by third-party code are not a supported path. |

## 🔀 Alternatives considered

### Retention: delete guard (adopted) vs anchors + retained history shares (previous revision)

The previous revision kept Person/Company DELETE permissive. It added `customer_email_authorization_anchors` (one durable row per original interaction provenance) and `customer_email_history_shares` (a copy of each grant without the live Person FK). `CustomerEmailConversationShare` then became a compatibility projection kept in sync by dual writes.

| Dimension | Delete guard + Archive (adopted) | Anchors + history shares (rejected) |
| --- | --- | --- |
| Preservation of email history | Complete: the rows that hold CRM email are removed only by an explicit per-row CRM delete or by the audited Q6 override. | Complete, but only if the anchor projection is current at delete time (old R4). |
| Authorization/history semantics | One authorization source, the existing interactions + shares, already tested and shipped. | Two sources (live interaction and retained anchor) that must agree; access after deletion depends on a historical Person key with no live record. |
| GDPR / erasure | Ordinary users lose the ability to remove CRM-held email copies for such Persons (a real, intended regression); the Q6 override keeps today's CRM-level deletion for authorized administrators, including when the mailbox owner has left. Source mail is left untouched exactly as today; its erasure is a separate future workflow. | Keeps DELETE as today, but Person-keyed authorization metadata outlives the Person; any erasure must also find and purge anchors and history shares. |
| Delete vs Archive expectations | Clear: Archive is reversible and keeps history; DELETE refuses while history exists and says why. This matches the existing deal-link and person-link guards. | Ambiguous: DELETE "succeeds" but the Person's mail and grants continue to exist and grant access through a record that no longer exists. |
| Migration complexity | Three nullable columns plus one new link table; key backfill only. | Two new authority tables, a backfill of every interaction into anchors and every share into history shares, and a reconciliation report. |
| Dual-write risk | None: every write touches one customers table set in one transaction. | Every share/visibility change writes two tables; old R2 (grants diverge) was rated Critical. |
| Compatibility burden | One additive blocker line in an existing 422 and one additive ACL feature; no entity contract changes. | New public routes (`email-authorization-anchors`, `email-history-shares`), a retained-grant UI and a long-term projection to deprecate later. |
| Operational failure modes | A user sees a 422 and archives instead. | Projection lag, divergence detection, repair tooling and a minimum safe rollback version, because rollback to a pre-bridge build could reopen revoked grants. |
| Implementation size | Small: two delete commands, one migration, one ACL feature, tests. | Large: three entities, two command families, two routes, reconciliation worker, UI. |
| Future maintenance | Nothing new to keep in sync. | Permanent two-table invariants for every future share/visibility feature. |

**Decision:** adopt the delete guard. For ordinary users it removes "hard-delete a Person who has CRM-captured email" and replaces it with Archive. For authorized administrators the Q6 override keeps today's behavior. The one capability neither design offered — erasing the source mail — needs **less** retained Person-linked data, not more, and is a separate future workflow.

### Authorization query

- **Cross-module "opaque relation" composed by source ports (previous revision):** would require a new query-engine primitive for cross-module EXISTS with no precedent in the repo. Rejected in favor of customers-local authorization, which needs no such primitive once interactions are durable.
- **Materialized `authorized_message_link` per viewer:** grows with viewers × messages and needs invalidation on every grant change. It is not needed unless the spike fails; the per-conversation fallback index is smaller and viewer-independent.

### Other

- **Current-affiliation roll-up for Company email:** moves history when people change employer and includes unrelated mail. Rejected as the canonical Company view; used only for suggestions.
- **Company-only link table with unchanged Person APIs:** fails parity, paging and reply validation. Rejected.
- **Snapshotting grants or marking retained mail shared:** makes revocation ineffective. Rejected.
- **A new global conversation identity:** changes source threading/deduplication. Deferred.
- **A CRM view inside the Messages inbox:** see the UI section. Rejected because it would couple `messages` to `customers`.

## 🚀 Rollout and compatibility

| Surface | Strategy |
| --- | --- |
| Person `email-threads` and `emails` APIs | Paths, defaults and DTO fields stay; they are routed through the new access service, with an additive cursor. The in-repo host moves to the new API. |
| Thread DTO/component imports | Preserved through wrappers/re-exports; existing `threadKey` values are translated at the adapter. |
| `CustomerEmailConversationShare` entity/routes | Unchanged. |
| People/Company DELETE | Additive `retainedEmail` blocker under the existing 422 codes (Q5), plus an additive override feature `customers.records.delete_retained_email` and request confirmation flag (Q6). Documented as a behavior tightening in UPGRADE_NOTES; precedent from the 2026-05-12 guard. |
| `customer_interactions` | Three nullable columns plus partial indexes; no change to existing fields. P3 ships separately with its own upgrade note. |
| Messages compose | Optional `idempotency_fingerprint` column and check; existing `idempotencyKey` semantics are unchanged. |
| Search | No change to `messages:message` (stays disabled); at most an additive exclusion of `customers:customer_interaction` from superadmin token search (Phase 0 decides). |
| Extension spots | `detail:customers.person:tabs` and `detail:customers.company:tabs` declared additively; no ID renamed. |
| Enricher `customers.private-email-count` | Shape preserved; not rendered by new hosts. |
| Native Messages and generic attachment routes | **Unchanged by this proposal.** |
| Events | New `customers.email_conversation_link.created/deleted` via `createModuleEvents`; existing IDs retained. |

**Activation:** both hosts behind one customers feature toggle, enabled after A1–A14 pass. Rollback of the hosts means disabling the toggle; the additive schema is kept. The delete guard (Phase 1) is not behind that toggle: it ships as a normal behavior change, and rolling it back means reverting that release, which restores today's permissive delete and loses nothing else. Because no authorization data moved, rolling back to the previous build cannot reopen a revoked grant. This removes the "minimum safe rollback version" constraint of the previous revision.

## Final Compliance Report — 2026-10-09

| Rule source | Rule | Status | Notes |
| --- | --- | --- | --- |
| Root/core architecture | No cross-module ORM relations; source ownership | Designed compliant | Customers-only SQL; logical IDs; typed DI ports for the new read path (existing string-entity reads elsewhere are untouched). |
| Root/core scoping | Tenant/org on every query | Designed compliant | Bound in every table reference, including `search_tokens` and the share EXISTS. |
| Core API/commands | metadata/OpenAPI, zod, guards, undo | Designed compliant | All new routes; link commands undoable; send not undoable. |
| Root concurrency | `updated_at`, scoped headers, conflict UI | Designed compliant | Links versioned; per-child headers in compound action. |
| Encryption | Owning helpers; no ciphertext ILIKE | Designed compliant | Existing hashed query-index tokens; decryption in the owning modules. |
| Backward compatibility | Additive; tightening documented | Designed compliant | Delete guard tightening + UPGRADE_NOTES; extension spots declared additively. |
| Spec/QA | Integration coverage per affected path | Designed compliant | A1–A14. |

Implementation evidence (spike results, plans, benchmarks) is pending. This spec is not maintainer-approved.

## Changelog

### 2026-10-09 — Revision for review findings (2026-10-02 review, 2026-10-08 re-review)

- **M1:** Evaluated the delete-guard alternative across ten dimensions and adopted it. Removed `customer_email_authorization_anchors`, `customer_email_history_shares`, their dual writes, routes, retained-grant UI and the minimum-safe-rollback constraint.
- **M2:** Moved the reply-parent read check (P1) and the undo metadata loss (P2) to "Prerequisite correctness fixes" as standalone fixes that land first, with tracking placeholders (none existed on 2026-10-09). Added P3, a privately tracked prerequisite that guarantees the provenance invariant the delete-guard design relies on.
- **M3:** Replaced the "opaque relation" with customers-local authorization. Added typed port signatures for customers, communication_channels and messages (with fail-closed behavior), a SQL sketch, a Phase 0 spike with an inline reference fixture, budgets and success criteria, and a fallback projection. Search uses existing customers-owned query-index tokens; `messages:message` search stays disabled.
- **m1:** Corrected the cap baseline. `listGrantsForViewerOnPerson` is uncapped; `SHARE_ARM_MAX = 500` applies only to `listGrantsForViewer`; `SHARED_CHANNEL_ARM_MAX = 500` applies to `listSharedChannelIds`.
- **m2:** Documented the existing compose `idempotencyKey` and the outbound sent-link short-circuit, and limited new work to the four gaps they leave.
- **m3:** Both `detail:customers.*:tabs` spots are declared additively (both are undeclared today).
- **m4:** Added numbered Open Questions Q1–Q6 with defaults.
- **m5:** Added a glossary and an existing-vs-proposed data model.
- **m6:** Added the cross-module blast-radius inventory and withdrew the native-recipient and generic-attachment-route changes from scope.
- **Nit:** One line on why the global history is a CRM page and not a Messages view.
- Removed the retained-source Trash scope (it depended on source soft-delete semantics outside this proposal) and the unmatched-mail scope (Q4).
- Added the Q6 override feature for administrators (keeps today's CRM-level delete for data-protection requests and departed owners), the relevance-link schema/commands/contracts, the ingest-time `ingest_person` link writer, problem statement, user stories and edge cases.
- Re-verified all baseline facts against `develop` `7187041c2`.

### 2026-09-30 — Initial proposal

- Proposed a unified Person/Company CRM email capability with complete history/search, relevance links, shared reader/composer, anchors/history shares for retention, and a phased plan.
