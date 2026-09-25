# Assisted Selling

| Field | Value |
|-------|-------|
| **Status** | Specification (rev 1) |
| **Created** | 2026-09-22 |
| **Suite** | [Ecommerce Suite Roadmap](./2026-08-14-ecommerce-suite-roadmap.md) — spec 13, **suite** Phase 4 |
| **Modules** | `assisted_selling` (new), `cart` (seam only — spec 5 rev 7 §7a), `ecommerce` (transport, internal Phase 5), `apps/storefront` (UI — spec 10 §5.8–§5.9) |
| **Depends on** | [Cart Module](./2026-08-14-cart-module.md) rev 7, [Storefront Public API](./2026-08-14-storefront-public-api.md), [Storefront App](./2026-08-14-storefront-app.md), [Storefront Customer Account](./2026-08-14-storefront-customer-account.md) |
| **Related** | [ADR-7](./2026-08-14-ecommerce-suite-roadmap.md#adr-7--buyer-context-is-resolved-once-at-the-edge), [ADR-9](./2026-08-14-ecommerce-suite-roadmap.md#adr-9--buyer-scoped-prices-bucket-by-group-per-customer-contracts-are-an-overlay), [ADR-10](./2026-08-14-ecommerce-suite-roadmap.md#adr-10--a-proposal-is-a-cart-and-acceptance-is-a-merge), [SPEC-056 WhatsApp AI chat](./SPEC-056-2026-02-22-whatsapp-ai-chat-integration.md) |

---

## TLDR

**Key Points:**
- A buyer in the storefront receives "add this to your basket" suggestions from an AI agent, from a human sales rep working the admin console, or from both in one thread — and accepts or rejects them, line by line.
- **The unit of acceptance is a proposal cart, not a chat message.** The conversation is transport; the commitment is a separate `Cart` carrying the role `proposal` and pointing at the buyer's basket. Accepting is a **merge**. Nobody ever writes into a basket they do not own.
- **AI and rep are not two features.** They are two actor types producing one artifact on one thread, selected by `mode: 'ai' | 'rep' | 'both' | 'off'`. One set of commands, one acceptance path, one disclosure.
- Two approval planes exist and are not interchangeable. **AI → employee** already ships (`prepareMutation` + `AiPendingAction` + its confirm route) and is not re-specified. **Proposal → buyer** is new, and is a pre-flight preview followed by a re-resolving confirm — because the price shown in a proposal and the price charged after the merge are resolved at different moments.
- **Live is a transport layer over this model.** v1 is async: proposal, notification, polling. Real-time lands in **Phase 5** and changes nothing but the transport — it says only *that* something changed, and the client re-reads state through the API.

**Scope:**
- `assisted_selling`: thread, participants, messages, proposal metadata and lifecycle, per-store settings, commission attribution
- The rep console in the backoffice, built from the existing `messages` and `detail` component families
- The AI actor: one proposing tool, two runtimes, a budget and a rate limit
- The buyer-facing thread API and its polling transport; the real-time transport in Phase 5
- The presence disclosure obligation

**Out of scope:**
- A new chat module, and a `CartProposal*` entity family. Both are refused for reasons stated below, not merely omitted.
- Quote acceptance. `SalesQuote`/`SalesQuoteLine`/`SalesQuoteAdjustment` ship today (`packages/core/src/modules/sales/data/entities.ts:827`), with a token-addressed `POST /api/sales/quotes/accept` that converts to an order in one transaction, and spec 9 §8 contracts the authenticated portal twin behind `portal.quotes.accept`. This spec fills the gap **before** a quote exists.
- Co-browsing, screen sharing, voice. Presence (Phase 5) is "a rep is in this conversation", nothing more.
- Any change to how a buyer or a staff member authenticates.

**Concerns:**
- The store setting that decides whether an AI draft needs rep approval does not merely change a gate — it changes which runtime the agent executes in, because the employee approval plane is structurally unreachable without a staff session
- A conversation is personal data on both sides, and it is addressable by a cart token that belongs to a guest with no account to revoke
- Polling a buyer-facing endpoint from behind a CDN is a cost and a correctness problem before it is a latency problem

---

## 1) Overview

Assisted selling is the part of a sale where somebody who is not the buyer knows something the buyer does not — that this pump needs that seal, that the 100-unit tier is four units away, that the item in the basket was superseded last month. Today that knowledge reaches the buyer as prose, and the buyer retypes it.

This spec gives that knowledge a shape the buyer can accept in one click: a priced basket, authored by someone else, merged into the buyer's own on acceptance and on nothing else. The conversation around it is transport. The module owns the conversation and the proposal's metadata; `cart` owns everything priced; `sales` owns everything that becomes an order.

---

## 2) Problem Statement

### 2.1 The commitment has nowhere to live

A rep who wants to say "add these three items" has two options today and both are wrong.

Editing the buyer's basket is forbidden by `cart-module.md` §10.2 — *"support may inspect and force a re-price but not edit a buyer's basket"* — and would be wrong even if it were permitted, because the buyer did not agree to it. No amount of audit logging converts an unagreed mutation into a proposal.

Sending a message that describes the items makes the message the commitment. The buyer retypes it, transcription error becomes pricing error, and there is nothing to accept — only something to read and act on manually.

### 2.2 The prohibition had no counterpart

§10.2's rule is right and, on its own, was a dead end: it named what staff must not do and said nothing about what they should. A boundary with no specified alternative gets closed by whoever is under pressure first, in whatever way is available — usually a direct write behind a feature flag nobody revisits. Rev 7 of that spec turns the prohibition into a contract, and this spec is the counterpart it now points at.

### 2.3 The machinery already exists and nothing reaches it

Everything the acceptance of a suggestion needs was built for guest→customer merge and is sitting unused for this purpose:

| Mechanism | Where | What acceptance needs it for |
|---|---|---|
| `mergeSummary` | `cart` §7.2 | Telling the buyer exactly what came across |
| `CartMergeLog.source_snapshot` | `cart` §4.4 | An append-only record of what was proposed |
| `cart.mergeUndo`, 15 min | `cart` §7.2 | Regret |
| Mandatory whole-cart re-price | `cart` §7.3 | The price the buyer actually pays |
| `strategy: 'manual'` | `cart` §4.4 | Per-line acceptance |

The last row is the sharpest: `manual` was a legal value of `CartMergeLog.strategy` that §7.1's policy table could never produce. The model admitted a case the specification could not reach.

### 2.4 Attribution was impossible

`CartLine.added_by` was `buyer | agent | merchant | merge` with no id anywhere on the line. Which rep, which agent — unanswerable. No commission, no audit, no way to tell a support caller who put a line in their basket.

### 2.5 The AI question was mis-filed

`cart-module.md` Open Question 4 asked *"whether an AI-proposed line needs explicit buyer confirmation before it counts toward totals"* and reserved it as "an approval-contract question for the AI framework". It was not. It was a modelling question about where an unaccepted intention lives, and the same answer serves a human rep, about whom the AI framework has nothing to say. Rev 7 closes it: an unaccepted line is not in the buyer's cart at all.

---

## 3) Proposed Solution

### 3.1 One artifact, two actor types

```
        ┌──────────────────────── assisted_selling ────────────────────────┐
        │  Thread ── Participant[]  (buyer · rep · ai_agent)               │
        │     │                                                            │
        │     ├── Message[]            free text, either direction         │
        │     ├── Proposal[]           metadata + lifecycle ──┐            │
        │     └── Attribution[]        written at conversion  │            │
        └─────────────────────────────────────────────────────┼────────────┘
                                                              │ proposal_cart_id
                                                              ▼
                                          ┌──────── cart (spec 5 rev 7) ───────┐
             buyer's basket  ◄──merge──   │  Cart { kind: 'proposal',          │
             Cart { kind: 'basket' }      │         proposed_to_cart_id }      │
                                          │  priced as the TARGET buyer        │
                                          └────────────────────────────────────┘
```

A rep and an AI agent produce the same row, through the same command, priced the same way, accepted the same way. `mode` decides which actor types may author; it does not fork the path.

### 3.2 What each side owns

| Concern | Owner | Why not the other |
|---|---|---|
| Lines, prices, totals, limits, TTL sweeping | `cart` | It already does no arithmetic of its own and delegates totals to `sales`; a second pricing path is the one thing ADR-2 exists to prevent |
| Thread, participants, message bodies, presence | `assisted_selling` | `cart` has no inbound dependency (§3.1 there) and must not learn a conversation exists |
| Proposal lifecycle *reasons* — rejected, withdrawn, superseded | `assisted_selling` | `Cart.status` stays untouched and orthogonal; why a proposal ended is metadata about a conversation |
| Buyer-scoped real-time signal | `ecommerce` | It is a generic transport, not an assisted-selling feature, and `ecommerce` is the module that resolves `StoreContext` at the edge |
| Order creation, quote conversion | `sales` / `checkout` | Already shipped; this spec ends at the cart |

### 3.3 Why not a `messages`-module thread

The platform has a `messages` module with threading, recipients, polymorphic record links, magic-link tokens and a registry of message types. Reusing it for the *data* was the obvious first answer and it does not survive contact with the schema:

- `Message.sender_user_id` is a non-nullable `uuid` referencing `auth.User`, and `MessageRecipient.recipient_user_id` likewise (`packages/core/src/modules/messages/data/entities.ts:53,160`). There is no `customer_user_id` and no actor-type column anywhere in the module.
- A buyer is a `customer_accounts.CustomerUser` — a different table with no foreign key to `users`, separated down to the JWT audience — or, for a guest, no user at all.
- Every route in the module is behind staff `requireAuth`.

Making `messages` carry a buyer would mean a nullable sender, a polymorphic recipient and a customer-auth path through a module whose every consumer today assumes staff. That is a larger and riskier change than a purpose-shaped table, and it would be made to a module with live data behind it.

**The UI is reused, and that is where the reuse was always worth having.** `EmailThreadsPanel` documents itself as an entity-agnostic thread viewer that "can be dropped onto the CRM Person page, a Company page, or any module" and takes pre-fetched `threads` (`packages/ui/src/backend/messages/EmailThreadsPanel.tsx:70-75`). The rep console supplies its own producer for that shape. The `detail` family supplies the page scaffolding. No new chat UI is built.

### 3.4 Why not a `CartProposal*` entity family

A proposal needs lines, quantities, configuration, unit prices, tier resolution, promotion effects, tax mode and totals. Every one of those exists on `Cart`/`CartLine` and is produced by a path that is contractually the same path the order will use. A parallel family would duplicate all of it, and the totals half is precisely what ADR-2 forbids duplicating.

What a proposal needs *beyond* a cart is small and is not line-shaped: which thread it belongs to, who authored it, when it was published, when it expires, and why it ended. That is one metadata row in the owning module — `AssistedSellingProposal` — carrying `proposal_cart_id`. It is not a line model, not a price model and not a second cart.

### 3.5 What the market does, and what this skips

Salesforce and SAP ship "assisted service" as an agent taking over the buyer's session and editing the cart directly, with an audit trail. Shopify's POS-adjacent clienteling and Commercetools' "my-cart on behalf of" do the same. It is the simplest model and it is the one rejected here, for the reason §2.1 gives: the buyer did not agree, and the merchant then owns a mutation the buyer will dispute.

What those platforms get right and this spec takes: the conversation and the commercial artifact are separate objects, and the artifact outlives the conversation. What they carry and this skips: a full co-browsing and session-takeover stack, a bespoke chat product, and a separate "clienteling" data model parallel to the cart.

The closest in-repo precedent is SPEC-056's tiering — *"complex messages: AI does **not** send; it produces a proposed message for the human to accept, edit, or reject"*. This spec applies the same shape with a cart as the artifact instead of a message, which is why §5 can reuse the shipped approval plane rather than invent one.

---

## 4) Architecture

### 4.1 The two approval planes, and why they cannot be one

```
  AI ──draft──► EMPLOYEE                        PROPOSAL ──published──► BUYER
  prepareMutation + AiPendingAction             preview → acceptanceToken → accept
  POST /ai/actions/:id/confirm | /cancel        POST /carts/:t/proposals/:p/accept
  staff session required                       cart token; guest-reachable
  TTL 900 s                                    TTL = store proposal TTL (72 h default)
  ALREADY IMPLEMENTED — not re-specified       NEW — cart §7a
```

They are not merely conventionally separate. `getAuthFromRequest` returns `{ auth: null, status: 'invalid' }` for any session whose `payload.type === 'customer'` (`packages/shared/src/lib/auth/server.ts:374`), so a buyer is structurally incapable of authenticating against the employee plane. A design that tried to route buyer acceptance through `AiPendingAction` would have to weaken that check, which exists to stop a staff-audience token being replayed as a customer one and vice versa.

### 4.2 `aiProposalsRequireRepApproval` selects a runtime, not just a gate

This is the least obvious consequence in the spec and the one an implementer will otherwise discover the hard way.

`prepareMutation` requires a staff context — `tenantId`, `organizationId`, `userId`, `features` — and is invoked by the tool-call wrapper inside a chat turn (`packages/ai-assistant/src/modules/ai_assistant/lib/agent-tools.ts:218-270`). It therefore only exists where an employee is operating the agent.

| Setting | Where the agent runs | Approval |
|---|---|---|
| `aiProposalsRequireRepApproval: true` | **Rep's copilot** — the agent runs inside the rep's backoffice chat, in the rep's staff session. The proposing tool is `isMutation: true`, so the existing wrapper produces an `AiPendingAction` and renders `mutation-preview-card`. | The rep confirms the card. **That confirm is the approval and the publication**: the tool handler does not run until confirm, so the proposal comes into existence already `published` |
| `aiProposalsRequireRepApproval: false` *(default)* | **Autonomous** — the agent runs server-side against the thread, triggered by buyer activity. There is no staff session, so `prepareMutation` does not and cannot apply. | **The buyer is the approver.** The proposal is published directly and acceptance is the approval |

The second row is not a hole in the approval model; it is the approval model. The buyer's accept is a real, informed, reversible confirmation of a priced basket — it is a stronger gate than a colleague clicking Confirm on a card, and it is the gate the whole design is built around.

The tool is declared `isMutation: true` in both cases. In the autonomous runtime that declaration still does work: it makes the tool ineligible for a read-only agent and forces it onto the agent's `allowedTools` whitelist explicitly.

**There is exactly one approval step in the copilot runtime, not two.** `prepareMutation` never invokes the tool handler — it builds a preview and returns; the handler runs later, from the confirm route. So before a rep confirms there is no `AssistedSellingProposal` row at all, only an `AiPendingAction`, and after confirm the proposal is created `published`. An intermediate `pending_rep_approval` status with a second "publish" action would be unreachable state and a second click for a decision already taken — the defect §2.3 indicts in `CartMergeLog.strategy`, reproduced. Cancelling the card leaves no proposal (§10).

### 4.3 The AI actor is a principal, not a category

The autonomous agent runs as an `auth.User` row carrying `kind: 'agent'` — the platform's existing notion of a non-human principal (`packages/core/src/modules/auth/data/entities.ts`, `UserKind = 'human' | 'agent' | 'service'`). Consequences, all of them free:

- It has an id, so `CartLine.added_by_actor_id` and `AssistedSellingAttribution.actor_id` are populated exactly as for a rep.
- It has roles and features, so `cart.proposals.author` gates it through the same ACL as a human, and revoking it is a role change rather than a code change.
- It is tenant- and organization-scoped, so it cannot propose across a tenant boundary.
- Audit reads identically for both actor types.

A service account with no row, or an enum value with no identity, would have given up all four.

### 4.4 Buyer-scoped transport

**v1 is polling, and the polling contract is written to be the same contract the stream will carry**, so Phase 5 is a transport swap and not a model change:

```
GET /api/assisted-selling/storefront/thread/events?since=<cursor>
  → 200 { cursor, changed: boolean, threadUpdatedAt, proposalIds: string[] }
  → 304 when the cursor is current
```

It carries no message body, no line, no price. The client re-reads `GET /thread` and `GET /carts/:token/proposals` when `changed` is true. That is the platform's existing discipline, not a new rule: `useMessagesSse` never opens a connection and never reads a payload — it subscribes to an event id and refetches over HTTP — and both shipped SSE routes cap payloads at `MAX_PAYLOAD_BYTES = 4096`, replacing anything larger with a bare `{ truncated: true, id, entityId }`.

**Phase 5 adds a `storefrontBroadcast` flag and one endpoint**, mirroring the two bridges that exist:

| | backoffice | portal | storefront (new) |
|---|---|---|---|
| Flag | `clientBroadcast` | `portalBroadcast` | `storefrontBroadcast` |
| Endpoint | `/api/events/stream` | `/api/customer_accounts/portal/events/stream` | `/api/ecommerce/storefront/events/stream` |
| Credential | staff session | customer JWT (cookie or Bearer) | **cart token** |
| Audience key | tenant + org + user + roles | tenant + org + `customerUserId` | tenant + store + **cart token hash** |

Three findings shape that row and each of them is a reason the Portal Event Bridge is not simply reused:

1. **It requires an authenticated `CustomerUser`.** Assisted selling must reach a guest, who has none. Keying the audience on the cart token hash is what makes the guest case work at all, and it degrades correctly for an identified buyer because the token is still the credential their browser holds.
2. **It lives in `customer_accounts`.** Putting a storefront transport there contradicts the roadmap's namespace ownership and couples a separate application to the portal's auth model.
3. **`portalConnections` is a process-local `Set`.** Any endpoint of this shape needs `crossProcessBroadcast` before it is correct on more than one instance. This is stated here because the new endpoint must not inherit the limitation by copying the file.

**The fallback is mandatory and must be a runtime fallback.** The brief's premise that `useMessagesSse`/`useMessagesPoll` are an SSE-with-fallback precedent does not hold: `useMessages` picks between them once, at module-evaluation time, on `typeof window.EventSource !== 'undefined'`, and the choice is frozen. That is adequate behind an authenticated admin shell, where an absent `EventSource` is the only realistic failure. It is not adequate in front of a CDN (`storefront-app.md` §3.3 + R1), where the transport is present in the browser and blocked or buffered in transit. The storefront client must degrade to polling **on connection failure and on heartbeat timeout**, and recover to streaming on a later attempt.

### 4.5 Client boundary

The rep console is a backoffice surface under `packages/core/src/modules/assisted_selling/backend/`, composed from `@open-mercato/ui/backend/{messages,detail}` and reached through the standard page-metadata guards. It introduces no new provider and no new client bootstrap. The buyer-facing surfaces live in `apps/storefront` and are governed by [`storefront-app.md`](./2026-08-14-storefront-app.md) §3.1–§3.3 and §9 — the full Frontend Architecture Contract for that application is that spec's, and duplicating its budgets here would create a second copy to drift.

---

## 5) Data Models

Standard scoped columns throughout (`id`, `tenant_id`, `organization_id`, `created_at`, `updated_at`, `deleted_at`). Table prefix `assisted_selling_`, per roadmap §8. Every cross-module reference is an FK id resolved through DI; there is no ORM relation to `cart`, `customers`, `customer_accounts`, `auth` or `sales`.

### 5.1 `AssistedSellingThread` (`assisted_selling_threads`)

| Column | Type | Notes |
|---|---|---|
| `store_id` | uuid | `ecommerce.EcommerceStore.id` |
| `buyer_cart_id` | uuid | The basket this conversation is about; `cart.Cart.id` |
| `buyer_cart_token_hash` | text | `hashAuthToken(cartToken)`. The audience key for the buyer-facing routes and for the Phase 5 stream. **Never the raw token** |
| `customer_id` | uuid, nullable | Set once the buyer is identified |
| `customer_user_id` | uuid, nullable | `customer_accounts.CustomerUser.id`; NULL for a guest |
| `status` | text | `open \| closed` |
| `mode_snapshot` | text | The store `mode` in force when the thread opened, so a later settings change does not rewrite history |
| `assigned_actor_id` | uuid, nullable | The `auth.User` currently owning the conversation in the console. Set on first rep join, reassignable |
| `live_proposal_count` | integer | Maintained by the proposal commands and the terminal-state subscriber (§6.6). Exists so the inbox's "awaiting the buyer" filter is an indexed predicate rather than a join across a second module's table |
| `last_activity_at` | timestamptz | Drives the console's inbox ordering and the idle sweeper |
| `closed_at` | timestamptz, nullable | |

Indexes: unique `(tenant_id, buyer_cart_id)` **where `status = 'open'`** — one *open* conversation per basket, closed ones unconstrained; `(tenant_id, buyer_cart_token_hash)`; `(tenant_id, store_id, status, last_activity_at)` and `(tenant_id, store_id, assigned_actor_id, status)` for the console inbox.

**The uniqueness is partial for a reason the re-point below makes unavoidable.** A guest can hold a thread on a guest basket while the account they are about to log into already holds one on its own basket. Re-pointing then collides. The policy: **the guest thread is closed**, its live proposals are marked `superseded` and their proposal carts rejected (§6.6), and a system message in both threads names the other. Nothing is deleted and nothing is silently merged — two conversations with two histories become one live conversation and one readable archive. Making the index total would have turned that case into a subscriber crash at exactly the moment R10 exists to protect.

**The token hash, not the token.** The raw cart token is the only credential an anonymous cart has (`cart` §8.3, R6) and it is deliberately kept out of URLs and logs. Storing it here in clear would put it in a second table with a different access pattern and a different audience. `hashAuthToken` is the platform's existing one-way treatment for exactly this, already used by `MessageAccessToken` and by the public quote-acceptance route.

**Cart lifecycle is not thread lifecycle.** A guest→customer merge rotates the cart token and moves the buyer to a different `Cart` row (`cart` §7, §8.3). A subscriber on `cart.cart.merged` re-points `buyer_cart_id` to `merged_into_cart_id`, re-hashes the new token and populates `customer_user_id`. Without it the conversation would be stranded on a `merged` cart at exactly the moment the buyer logged in — the moment a rep is most likely to be mid-sentence.

### 5.2 `AssistedSellingParticipant` (`assisted_selling_participants`)

| Column | Type | Notes |
|---|---|---|
| `thread_id` | uuid | |
| `actor_type` | text | `buyer \| rep \| ai_agent` |
| `actor_id` | uuid, nullable | `customer_accounts.CustomerUser.id` for an identified buyer; `auth.User.id` for `rep` and `ai_agent` (the latter carrying `kind: 'agent'`, §4.3). NULL only for a guest buyer |
| `display_name` | text | Snapshot, shown to the other party. Encrypted at rest |
| `joined_at` / `left_at` | timestamptz | |
| `presence_state` | text | `absent \| present` — Phase 5 |
| `presence_updated_at` | timestamptz, nullable | Phase 5 |

Unique `(thread_id, actor_type, actor_id)` among non-deleted rows.

`display_name` is snapshotted rather than joined so a thread still renders after a rep leaves the company, and it is **encrypted** because it is a named natural person disclosed across a trust boundary — declared in `assisted_selling/encryption.ts` and read through `findWithDecryption`. What a buyer is shown is a policy question owned by the store, not a schema question: see §8.3.

**Encrypted means not searchable, and the console must not pretend otherwise.** No inbox filter, sort or free-text search runs against `display_name`; the console filters by `assigned_actor_id`, store, status and live-proposal count, all of them plain indexed columns. A "find the thread with Anna" affordance would require either decrypting every row per query or a searchable shadow of the plaintext, and the second is the control this column exists to apply, undone.

### 5.3 `AssistedSellingMessage` (`assisted_selling_messages`)

| Column | Type | Notes |
|---|---|---|
| `thread_id` | uuid | |
| `participant_id` | uuid | Author |
| `body` | text | **Encrypted at rest** |
| `body_format` | text | `text \| markdown` |
| `proposal_id` | uuid, nullable | Set when this message is the one that carries a proposal |
| `sent_at` | timestamptz | |

Index `(tenant_id, thread_id, sent_at)`.

`body` is free text written by and about identifiable people and is declared in `defaultEncryptionMaps`. It is **not** indexed for search in this spec: a searchable conversation corpus is a separate decision with its own retention and disclosure consequences, and `search.ts` registration is deliberately absent rather than forgotten.

### 5.4 `AssistedSellingProposal` (`assisted_selling_proposals`)

The metadata row, not a line model. Lines, quantities, prices, promotion effects and totals live entirely on the `Cart` it points at.

| Column | Type | Notes |
|---|---|---|
| `thread_id` | uuid | |
| `proposal_cart_id` | uuid | The `Cart` with `kind: 'proposal'` |
| `target_cart_id` | uuid | Denormalized from `Cart.proposed_to_cart_id`, so the console can list by target without reaching into `cart` |
| `authored_by_actor_type` | text | `rep \| ai_agent` — a buyer cannot propose to themselves |
| `authored_by_actor_id` | uuid | `auth.User.id`. Non-nullable: an unattributable proposal is the defect R6 describes |
| `status` | text | `published \| accepted \| rejected \| withdrawn \| expired \| superseded` |
| `published_at` | timestamptz, nullable | |
| `expires_at` | timestamptz | From the store's `proposal_ttl_seconds`; mirrors the proposal cart's own `expires_at` |
| `resolved_at` | timestamptz, nullable | |
| `rejection_reason` | text, nullable | Buyer-supplied, optional. **Encrypted at rest** |
| `ai_pending_action_id` | uuid, nullable | Set only in the rep-copilot runtime (§4.2) |
| `superseded_by_proposal_id` | uuid, nullable | Set when re-authored (§6.4) |
| `merge_log_id` | uuid, nullable | `cart.CartMergeLog.id`, set on acceptance — so the trail runs in both directions |

Indexes: unique `(tenant_id, proposal_cart_id)`; `(tenant_id, target_cart_id, status)`; `(tenant_id, status, expires_at)` for the sweeper.

**Why this is not the `CartProposal*` family the brief rules out.** It has no lines, no prices and no totals; it cannot be read without `cart`; and removing it would not make the proposal cart unusable, only unattributable. It is the join between a conversation and a basket, and it lives on the conversation's side because `cart` has no inbound dependency.

**Status is richer than `Cart.status` on purpose, and no richer than that.** `Cart.status` stays exactly as spec 5 defines it — a rejected proposal cart is `abandoned`, the existing terminal non-converting state. *Why* it ended is a fact about a conversation, and six reasons here cost `cart` nothing.

There is deliberately **no `draft` and no `pending_rep_approval`**. Every path that creates a row creates it `published` (§6.3, §4.2): a proposal held for rep approval does not exist yet — it is an `AiPendingAction` — and a half-built proposal in the console builder is unsaved form state, not a row. Carrying either value would put a status in the model that no command can produce, which is exactly the defect §2.3 indicts one document over.

**Every terminal state is written by one subscriber, not by the route that caused it** — see §6.6. `accepted`, `rejected` and `expired` are decided inside `cart`, which by §7a.6 there does not know this module exists.

### 5.5 `AssistedSellingAttribution` (`assisted_selling_attributions`)

Written once, at conversion, and never updated.

| Column | Type | Notes |
|---|---|---|
| `sales_order_id` | uuid | FK id, no ORM relation |
| `sales_order_line_id` | uuid, nullable | NULL only in the degraded case of §6.7 |
| `cart_id` / `cart_line_id` | uuid | Provenance |
| `actor_type` | text | `buyer \| rep \| ai_agent \| merge \| system` — mirrors `CartLine.added_by_actor_type` |
| `actor_id` | uuid, nullable | |
| `thread_id` / `proposal_id` | uuid, nullable | NULL for a line the buyer added themselves |
| `line_net_amount` / `line_gross_amount` | numeric(16,4) | Snapshot at conversion |
| `currency_code` | text | |
| `converted_at` | timestamptz | |

Indexes: unique `(tenant_id, sales_order_line_id)` where not null; `(tenant_id, actor_type, actor_id, converted_at)` for the commission report.

**Amounts are snapshotted rather than joined.** A commission report run six months later must not change because an order was credited, and reading live `sales` rows would make it do exactly that. This is the same reasoning `CartLine` already applies to `name` and `sku`.

### 5.6 `AssistedSellingStoreSettings` (`assisted_selling_store_settings`)

| Column | Type | Notes |
|---|---|---|
| `store_id` | uuid | Unique per `(tenant_id, organization_id, store_id)` |
| `mode` | text | `ai \| rep \| both \| off`, default `off` |
| `ai_proposals_require_rep_approval` | boolean | Default `false` |
| `proposal_ttl_seconds` | integer | Default `259200` (72 h) |
| `max_proposal_lines` | integer | Default `50` |
| `ai_max_proposals_per_thread_per_hour` | integer | Default `4` |
| `ai_agent_user_id` | uuid, nullable | The `auth.User` with `kind: 'agent'` this store's agent runs as (§4.3). **Required by the settings validator when `mode ∈ {ai, both}`** — a store cannot enable an AI actor without naming the principal it acts as, because every attribution, ACL check and audit line depends on it |

**`mode_snapshot` has one consumer and it is not enforcement.** Enforcement reads the **live** `mode` (§6.3, §8.4); the snapshot on the thread exists so the console and the audit can say which rules a past conversation ran under. A column with no reader is the same defect as a status no command produces, so its reader is named here rather than assumed.

**Not a subtree of `EcommerceStoreSettings`.** SPEC-029 §5.1.1 deleted `features.enableReviews` and `features.enableWishlist` on the stated grounds that "a settings flag for an unbuilt feature is dead configuration", and roadmap §8 forbids a child spec introducing entities under another module's prefix. A settings subtree in `ecommerce` for a module that may not be installed is both of those mistakes at once. The storefront learns the effective mode through the store-context read, resolved with `tryResolve` so an absent module degrades to `off` rather than failing to boot — the soft-optional pattern root `AGENTS.md` requires for an optional peer.

### 5.7 Encryption

`assisted_selling/encryption.ts`:

```typescript
export const defaultEncryptionMaps = [
  { entityId: 'assisted_selling:message',     fields: [{ field: 'body' }] },
  { entityId: 'assisted_selling:participant', fields: [{ field: 'displayName' }] },
  { entityId: 'assisted_selling:proposal',    fields: [{ field: 'rejectionReason' }] },
]
```

All reads go through `findWithDecryption` / `findOneWithDecryption`. `buyer_cart_token_hash` is **not** in this map because it is a one-way hash, not a recoverable secret — encrypting it would make the lookup it exists for impossible.

---

## 6) API Contracts

Zod validators in `data/validators.ts`, types via `z.infer`. Every mutating route is a registered command with `withAtomicFlush` and post-commit side effects, per root `AGENTS.md`. Every user-editable entity carries `updated_at` optimistic locking.

### 6.1 Staff and agent — `/api/assisted-selling/*`

`requireAuth`; features below. Reachable only by `auth.User` principals, human or `kind: 'agent'`.

| Method | Path | Feature | Purpose |
|---|---|---|---|
| GET | `/threads` | `assisted_selling.threads.view` | Console inbox; filter by store, status, `assigned_actor_id`, `live_proposal_count > 0`. **Not** by participant name — §5.2 |
| GET | `/threads/:id` | `assisted_selling.threads.view` **+ `cart.proposals.view`** | Thread with participants, messages and proposals |
| POST | `/threads` | `assisted_selling.threads.participate` + `cart.carts.view` | **Staff or agent opens a conversation about a basket**, by cart id. Subject to the live `mode` |
| POST | `/threads/:id/join` | `assisted_selling.threads.participate` | Adds a `rep` participant. **Visible to the buyer immediately** (§8.3) |
| POST | `/threads/:id/leave` | `assisted_selling.threads.participate` | |
| POST | `/threads/:id/assign` | `assisted_selling.threads.participate` | Sets `assigned_actor_id` |
| POST | `/threads/:id/messages` | `assisted_selling.messages.post` | |
| POST | `/threads/:id/proposals` | `assisted_selling.proposals.author` + `cart.proposals.author` | Authors a proposal; wraps `cart.proposal.create` |
| POST | `/proposals/:id/withdraw` | `assisted_selling.proposals.author` | Withdraws before acceptance. **Also rejects the proposal cart** — §6.4 |
| POST | `/proposals/:id/reauthor` | `assisted_selling.proposals.author` | New proposal from an expired, rejected or withdrawn one's lines, freshly priced (§6.4) |
| GET | `/attributions` | `assisted_selling.attributions.view` | Commission report read; filter by actor, period, store |
| GET/PUT | `/settings/:storeId` | `assisted_selling.settings.manage` | |

**Staff can start a conversation, and the feature is close to useless if they cannot.** §1's motivating case — the rep who knows the 100-unit tier is four units away — is by construction one the buyer has not asked about. `POST /threads` takes a cart id the principal can already see under `cart.carts.view`, creates the thread, adds the rep as a participant and posts an opening message. The buyer's very next read shows all three, because §8.3 and R3 make a rep's presence non-suppressible: a staff-opened conversation is visible to the buyer from its first moment, exactly as a buyer-opened one is. There is no silent observation mode, and adding one would need a different spec and a different lawful basis.

**Reading a thread requires `cart.proposals.view`, not only this module's feature.** `GET /threads/:id` returns proposals carrying the buyer's resolved unit prices and their `price_row_id` provenance (§7.2) — that is `cart`'s gated data, and serving it under a weaker local feature would undo the two-feature discipline this section defends one paragraph below.

Authoring requires **both** features by design: `assisted_selling.proposals.author` says a principal may participate in selling conversations, `cart.proposals.author` says it may put a priced basket in front of a buyer. Granting one without the other is a meaningful configuration — a rep who may converse but not propose — and collapsing them into one would remove it.

**There is no `publish` route.** A proposal is created published (§4.2, §5.4); a rep confirming the AI's preview card is the only approval step there is.

### 6.2 Buyer — `/api/assisted-selling/storefront/*`

Public, **cart-token bound**, rate limited per IP and per token. No ACL feature: the token holder is the buyer acting in their own conversation, and a guest has no ACL identity. The token arrives as it does everywhere else in this suite — an httpOnly cookie or a header, never a path segment (`cart` §8.3, `storefront-app.md` R7).

| Method | Path | Limit | Purpose |
|---|---|---|---|
| GET | `/thread` | 120/min | The thread for this cart token; `404` when none exists |
| POST | `/thread` | 10/min | Buyer opens a conversation; refused with `409 assisted_selling_unavailable` when `mode: 'off'` |
| POST | `/thread/messages` | 30/min | |
| GET | `/thread/events?since=` | 240/min | Polling cursor. `304` when current |

Proposal read, preview, accept and reject are **not here** — they are `/api/cart/carts/:token/proposals*` (`cart` §10), because they are cart operations on the buyer's own basket. Giving this module a second way to mutate a cart would defeat the seam.

`GET /thread/events` returns a signal, never content:

```typescript
{ cursor: string; changed: boolean; threadUpdatedAt: string; proposalIds: string[] }
```

Client cadence: 5 s while the tab is visible and a `rep` participant is present, 30 s while visible otherwise, suspended while hidden, and backing off to 120 s after a run of unchanged responses. `ETag`/`If-None-Match` so an unchanged poll is a `304` — behind a CDN this is the difference between a cheap request and a rendered one (R7).

### 6.3 Authoring a proposal

```
POST /api/assisted-selling/threads/:id/proposals
{
  lines: [{ productId, variantId?, quantity, configuration? }],   // ≤ max_proposal_lines
  note?: string,
  assortmentScope: EffectiveAssortmentScope,                      // cart §6a.1
  idempotencyKey: string
}
```

The command:

0. **Checks the live `mode`** against the authoring actor: `rep` requires `mode ∈ {rep, both}`, `ai_agent` requires `mode ∈ {ai, both}`, and `off` refuses both with `409 assisted_selling_unavailable`. The same check gates `POST /threads` and `/threads/:id/join`. It reads the store's current setting, not `mode_snapshot` — turning the AI off must stop it proposing into conversations that are already open, which is the whole point of turning it off. Already-published proposals and already-joined participants are untouched (§8.4).
1. Resolves the thread and its `buyer_cart_id`.
2. Calls `cart.proposal.create` with the **target cart's token**, which is what makes the proposal price as the buyer rather than as the author (`cart` §7a.2, R1 below). The authoring principal's own context is passed nowhere.
3. Writes an `AssistedSellingProposal` with `authored_by_actor_*` taken from `ctx.auth` — **never** from the request body (R6).
4. Sets `status: 'published'`. There is no other value it could take: in the copilot runtime this command runs only after the rep confirmed the preview card, and in the autonomous runtime the buyer is the approver (§4.2).
5. Posts an `AssistedSellingMessage` carrying `proposal_id`, so the proposal appears in the conversation rather than beside it.
6. Emits `assisted_selling.proposal.published` after commit.

### 6.4 Ending a proposal from this side: withdraw, supersede, re-author

**A status change here is never enough on its own.** `cart` decides whether a proposal can still be accepted, and it decides it from the proposal *cart*'s status (`cart` §7a.1) — it does not read this module's rows and by §7a.6 there it does not know they exist. So `POST /proposals/:id/withdraw` and any supersession MUST invoke `cart.proposal.reject` in the same command, inside the same atomic flush, before writing the local status.

Without that, a rep withdrawing a mispriced suggestion changes a row nobody consults: the proposal cart stays `active`, the buyer's tray still holds a valid token, and the merge succeeds. That is the sharpest version of the failure this whole spec exists to avoid — a price the buyer accepts that the seller had already retracted.

`POST /proposals/:id/reauthor` creates a **new** proposal cart from the old one's lines, freshly priced against the target's current context, sets `superseded_by_proposal_id` on the old row, and — when the old proposal is not already terminal — rejects its cart by the same rule. It is the path for an expired, rejected or withdrawn proposal, and the path §8.1 uses instead of mutating `proposed_to_cart_id`.

This is also the answer to the `AiPendingAction` TTL. That plane expires a pending action after `AI_PENDING_ACTION_DEFAULT_TTL_SECONDS = 900` — fifteen minutes, sized for an employee watching a chat stream, not for a rep who stepped into a call. Rather than raise a platform-wide env var that governs every pending action in the system, an expired AI draft surfaces in the console as "expired — re-propose", and the one click re-authors it. Fifteen minutes later a fresh price is what the buyer should be shown anyway.

### 6.5 The AI tool

```typescript
defineAiTool({
  name: 'assisted_selling.propose_cart_lines',
  displayName: 'Propose lines to the buyer',
  inputSchema: proposeCartLinesInput,
  requiredFeatures: ['assisted_selling.proposals.author', 'cart.proposals.author'],
  tags: ['write', 'assisted-selling'],
  isMutation: true,
  isBulk: true,
  loadBeforeRecords: async (input, ctx) => /* per-line before-state for the preview card */,
  handler: async (input, ctx) => /* delegates to the §6.3 command */,
})
```

`isMutation: true` in both runtimes (§4.2): in the copilot runtime it produces the `AiPendingAction`; in the autonomous runtime it keeps the tool off read-only agents and forces an explicit `allowedTools` entry.

The agent is declared with loop controls, using the shapes that exist:

```typescript
loop: {
  maxSteps: 6,
  budget: { maxToolCalls: 4, maxWallClockMs: 20_000, maxTokens: 30_000 },
  stopWhen: [{ kind: 'hasToolCall', toolName: 'assisted_selling.propose_cart_lines' }],
}
```

plus `ai_max_proposals_per_thread_per_hour` enforced by the command itself. The budget bounds one turn; the per-thread limit bounds a conversation; neither substitutes for the other (R4).

The agent sets `untrustedInput: true`. Buyer-authored message text reaches the model, which is the case the `untrustedInput` field documents as "a customer portal or public-widget surface" (`ai-agent-definition.ts`) and for which `moderation-policy.ts` forces input moderation to `enforced`. No shipped agent sets it today; this one must.

### 6.6 Terminal states are written by a subscriber

Acceptance, rejection and expiry are all decided inside `cart` — by `cart.proposal.accept`, `cart.proposal.reject` and the `expire-carts` sweeper. `cart` has no inbound dependency and never writes here. So this module learns of them the only way it can, and the only way root `AGENTS.md` permits across a module boundary: a subscriber.

An `assisted_selling` subscriber on `cart.proposal.accepted | .rejected | .expired` (`cart` §11) resolves the local row by `proposal_cart_id` and writes:

| Event | Writes |
|---|---|
| `.accepted` | `status: 'accepted'`, `resolved_at`, `merge_log_id` from the event's `mergeLogId`, decrements `AssistedSellingThread.live_proposal_count` |
| `.rejected` | `status: 'rejected'` **unless already `withdrawn` or `superseded`** — those are this module's own terminal states and the cart rejection they themselves caused must not overwrite them — plus `resolved_at` and the decrement |
| `.expired` | `status: 'expired'`, `resolved_at`, decrement |

Then it emits `assisted_selling.proposal.accepted | .rejected | .expired` (§6.8), which is what the rep console reacts to. Three of the events §6.8 declares have no other emitter: without this subscriber the central artifact of the spec would never be marked accepted, `merge_log_id` would never be populated — despite §5.4 keeping it "so the trail runs in both directions" — and the console would never learn the buyer decided.

It is idempotent on `proposal_cart_id` plus target status, because an event bus may redeliver and a proposal must not be resolved twice.

### 6.7 Attribution at conversion

A subscriber on `cart.cart.converted` writes one `AssistedSellingAttribution` per cart line. The **actor** comes straight off the line: `added_by_actor_type`/`_id` survive a merge unrewritten (`cart` §14 asserts it), so the half that matters to commission needs no join at all.

The **conversation** half does, and `CartLine` carries no source-cart column. It resolves through the merge log: `CartMergeLog.proposal_cart_id` (`cart` §4.4) names the proposal, and `CartMergeLog.outcome` maps each source line to the target line it became — a shape `cart` rev 7 fixes for exactly this consumer, because rev 6 described `outcome` only as "per-line disposition and reason" and a disposition without a target line id cannot be joined to anything. The path is `target cart line → outcome entry → proposal_cart_id → AssistedSellingProposal → thread_id`. A line the buyer added themselves appears in no merge log and takes NULL for both, which is correct rather than degraded.

It depends on the payload requirement rev 7 records on that event: `salesOrderId` plus `lineMap: Array<{ cartLineId, salesOrderLineId }>`. **Where `lineMap` is absent the subscriber degrades to order-level attribution** — `sales_order_line_id` NULL, amounts summed per actor — and emits `assisted_selling.attribution.degraded` so the gap is visible rather than silent. It never infers the mapping from product identity: a cart may legitimately hold two lines of the same product with different `configuration_hash`, and a guess there would misattribute money.

### 6.8 Events

```typescript
'assisted_selling.thread.opened' | '.closed'
'assisted_selling.participant.joined' | '.left'
'assisted_selling.message.posted'
'assisted_selling.proposal.published' | '.accepted' | '.rejected' | '.withdrawn' | '.expired'
'assisted_selling.attribution.degraded'      // operator-facing, §6.7
```

`clientBroadcast: true` on thread, participant, message and proposal events so the rep console updates without polling — the console is a backoffice surface and the backoffice bridge already carries it. `storefrontBroadcast: true` on the same set from Phase 5.

`assisted_selling.attribution.degraded` is **not** broadcast to either: it is an operator signal, the same reasoning `cart.line.visibility_rejected` already applies.

### 6.9 ACL

```typescript
export const features = [
  { id: 'assisted_selling.threads.view',        title: 'View selling conversations' },
  { id: 'assisted_selling.threads.participate', title: 'Join selling conversations' },
  { id: 'assisted_selling.messages.post',       title: 'Post in selling conversations' },
  { id: 'assisted_selling.proposals.author',    title: 'Author proposals' },
  { id: 'assisted_selling.attributions.view',   title: 'View sales attribution' },
  { id: 'assisted_selling.settings.manage',     title: 'Manage assisted selling settings' },
]
```

Admin-facing namespace only. There is deliberately **no** `portal.*` feature: the buyer's half is cart-token bound so that a guest reaches it, and the flat `portal.<resource>.<action>` namespace spec 9 §8.1 established presumes an authenticated `CustomerUser`. Adding one would make assisted selling logged-in-only by the back door.

---

## 7) UI/UX

The buyer-facing surfaces are specified in [`storefront-app.md`](./2026-08-14-storefront-app.md) §5.8–§5.9, §11 R10, §12 and §16 Epic F — that spec owns the storefront's components, budgets and accessibility gates, and duplicating them here would create a second copy to drift. This section covers the rep console only.

### 7.1 The rep console is assembled, not built

Under `packages/core/src/modules/assisted_selling/backend/assisted-selling/`, composed from what exists:

| Need | Component | Source |
|---|---|---|
| Inbox of live conversations | `DataTable` with row actions and filters | `@open-mercato/ui/backend` |
| Thread timeline | A thread viewer of `EmailThreadsPanel`'s shape, fed by this module's own producer | `@open-mercato/ui/backend/messages` |
| Page scaffolding, states | `detail` family — `SectionHeader`, `LoadingMessage`, `ErrorMessage`, `TabEmptyState`, `RecordNotFoundState` | `@open-mercato/ui/backend/detail` |
| Composer | `MessageComposer`'s inline variant | `@open-mercato/ui/backend/messages` |
| Proposal builder | `CrudForm` over a line-item field array | `@open-mercato/ui/backend` |
| AI draft awaiting approval | `mutation-preview-card`, unchanged | `@open-mercato/ui/ai/parts` |

`EmailThreadsPanel` documents itself as entity-agnostic and takes pre-fetched `threads`, so the reuse is genuine — but its only existing *producer* is the CRM endpoint behind `customers.people.view`, so this module supplies its own producer for that shape. That is the whole extent of the new UI code: a producer and a proposal builder.

`.ai/ui-backend-components.md`'s rule for this family applies unchanged — **message and thread surfaces subscribe through the shared hook; no custom polling in the backoffice.** The console is behind the admin shell, where `clientBroadcast` and the existing bridge already work. The polling of §6.2 is the *buyer's* transport and does not belong here.

### 7.2 Rules that are this feature's, not the framework's

- **Nothing in the console mutates the buyer's cart.** The proposal builder writes to the proposal cart; the only path into the buyer's basket is the buyer's own acceptance. A "push to cart" affordance must not exist, and §10 asserts its absence by enumerating registered routes rather than by inspecting the UI.
- **A live proposal's status is rendered from the server's value**, never derived client-side from `expires_at` versus the clock — the same rule §5.4a and §5.5 of the storefront spec already apply to sort options and checkout steps, for the same reason.
- **Price provenance is shown to the rep.** Each proposal line renders the buyer's resolved unit price with the `price_row_id` explanation `cart` §5.1 already provides, labelled as the buyer's price. A rep who sees their own price and assumes it is the buyer's is R1 reaching the UI.
- Status uses `{property}-status-{status}-{role}` tokens; no hardcoded Tailwind status colours, no arbitrary values, no `dark:` overrides on semantic tokens.
- The proposal-builder dialog submits on `Cmd/Ctrl+Enter` and cancels on `Escape`; every icon-only button carries an `aria-label`; all copy resolves through `useT()`.

---

## 8) Edge Cases & Failure Scenarios

### 8.1 The buyer logs in mid-conversation

The cart merges, the token rotates, `Cart.status` becomes `merged` and the buyer is now on a different `Cart` row. A subscriber on `cart.cart.merged` re-points the thread's `buyer_cart_id` and re-hashes the token (§5.1).

A live proposal targeting the old cart is **re-authored, not re-pointed**: the subscriber runs the §6.4 re-author path, producing a new proposal cart against the merged-into cart, freshly priced, with `superseded_by_proposal_id` set on the old row and the old proposal cart rejected. Re-pointing would mean mutating `Cart.proposed_to_cart_id` — a column `cart` §4.1 binds with a check constraint and exposes through no command; adding `cart.proposal.retarget` for one caller would widen a seam the brief deliberately keeps to three commands. Re-authoring also gets the pricing right for free, which re-pointing would not: the buyer's group has just become known, so every line may change, and a proposal carried across unrepriced would be the one basket in the session still priced as a guest.

Where the target cart already holds an open thread, §5.1's collision policy applies instead: the guest thread closes, its live proposals are superseded and their carts rejected, and a system message in both names the other.

### 8.2 The buyer's cart expires or is abandoned

The thread stays `open` but no proposal can be accepted, because acceptance merges into a cart that is no longer `active`. The buyer sees the conversation and a statement that the basket expired. The rep sees the same. Nothing is deleted.

### 8.3 A rep joins, and the buyer must be told

Joining creates a participant row and the buyer's next read of the thread shows it. The disclosure is **not a setting** — see R3.

### 8.4 Mode changes while a thread is open

Enforcement reads the **live** mode, not `mode_snapshot` (§5.6, §6.3 step 0). Turning the store to `off`, or from `both` to `rep`, immediately stops the disallowed actor from opening threads, joining and proposing — including into conversations already open, which is the point of turning it off.

It closes no thread and voids no **already-published** proposal. A buyer mid-conversation finishes it; a suggestion already on screen with a price on it stays acceptable until it expires or is withdrawn. Retroactively voiding a published, priced proposal because an operator flipped a setting is a withdrawal the buyer never sees explained, and the explicit path for changing one's mind is §6.4's withdraw, which does tell them.

`mode_snapshot` is read by the console and the audit to say which rules a past conversation ran under. It never gates anything.

### 8.5 Two reps propose at once

Both proposals are live. They are separate carts and separate rows; neither blocks the other; the buyer may accept both, either or neither. There is no lock, because a proposal changes nothing until accepted, and each acceptance goes through the target cart's own optimistic lock in turn.

### 8.6 The buyer accepts while checkout holds the lock

`423 Locked` with the checkout session id (`cart` §9, §7a.4). The storefront sends the buyer back to checkout rather than showing a failure.

### 8.7 The AI proposes something the buyer may not see

Caught twice: at authoring, because a proposal against a storefront target inherits the target's channel and `cart` §6a.1's `assortmentScope` check therefore applies; and at the merge boundary by §6a.5. The first produces a rejected line at authoring time the rep can see; the second produces a `product_unavailable` disposition in `mergeSummary`.

### 8.8 The AI is unavailable

Provider outage, budget exhausted, moderation refusal. The thread continues; the buyer is not shown an error about a participant they did not know existed. In `mode: 'both'` the rep is unaffected. In `mode: 'ai'` the thread is simply quiet, which is the correct degradation for a channel nobody promised would answer.

### 8.9 The proposal exceeds cart limits

`cart` §13 R10 caps a cart at 200 lines and a batch at 100. `max_proposal_lines` (default 50) is checked first so the failure is a validation error at authoring, in the console, against the rep — not a partial merge at acceptance, against the buyer.

---

## 9) Risks & Impact Review

| # | Risk | Severity | Area | Failure scenario | Mitigation | Residual |
|---|---|---|---|---|---|---|
| R1 | Proposal priced as its author, not as the buyer | **High** | `assisted_selling`, `cart`, legal | A rep on a staff price kind, or an agent under a service principal, authors a proposal and `catalogPricingService` resolves against the author's context. The buyer accepts 84,00 zł; the mandatory post-merge re-price corrects it to 129,00 zł and `priceChanges` discloses an increase the buyer never agreed to. In B2B the two contexts differ by a negotiated contract, not a rounding. | §6.3 passes the **target cart's token** and never the author's context; `cart` §7a.2 makes the proposal cart copy the target's `customer_group_ids`, `price_kind_id`, `currency_code`, `tax_mode` and `buyer_digest` at creation and re-derive them on every re-price. Asserted by a test that authors as a rep on a different price kind and compares against the buyer's own resolution (`cart` R14) | Low |
| R2 | Proposal used as an assortment bypass | **Critical** | `cart` | `cart` §6a.4 exempts channels resolving no `StoreContext`. A proposal authored in an exempt channel and merged into a storefront basket carries lines that were never visibility-checked, through `checkout` into a `SalesOrder` — `cart` R11's failure text by a second route. | Two independent controls: the proposal cart inherits the **target's** channel, so §6a.1's per-line check applies at authoring; and §6a.5's pass at the merge boundary rejects anything that slipped, reporting it in `mergeSummary` rather than admitting or deleting it. Tracked as `cart` **R13** and shipped with `cart` **Phase 3**, because the defect exists independently of this feature | Low once `cart` Phase 3 ships — until then this feature MUST NOT be enabled, stated as a hard dependency in §11 |
| R3 | Presence treated as a feature flag rather than a disclosure obligation | **High** | `assisted_selling`, legal | A store disables the "someone is viewing your basket" notice to reduce friction. A named employee then observes a buyer's basket contents and activity with no indication to the buyer. Under GDPR this is processing the data subject has not been informed of, and the merchant is the controller. | The disclosure is **not configurable**: the thread response always carries the participant list, and the storefront always renders a rep participant's presence. `AssistedSellingStoreSettings` has no column that could switch it off, which is the mitigation — a setting that does not exist cannot be set. A test asserts a rep participant always appears in the buyer's thread payload, and `storefront-app.md` §12 asserts it always renders. Retention, lawful basis and the buyer's right to end the conversation are stated in the store's privacy copy, not here | Low — residual is a storefront deployment rendering the payload it is given incorrectly, covered by that spec's test |
| R4 | AI cost and abuse | Medium | `assisted_selling`, `ai-assistant` | A scripted client opens threads and posts messages in a loop; each turn runs a model and a pricing pass. Cost scales with an attacker's patience, and a shared provider quota degrades every tenant. | Three bounds, none sufficient alone: `loop.budget` (`maxToolCalls`, `maxWallClockMs`, `maxTokens`) bounds one turn; `ai_max_proposals_per_thread_per_hour` bounds one conversation; the §6.2 per-IP and per-token rate limits bound one client. `POST /thread` is limited to 10/min and a thread is unique per cart, so thread creation is bounded by cart creation, which `cart` already rate-limits | Medium — an authenticated B2B buyer with a legitimate high-volume pattern is indistinguishable from abuse by rate alone; per-tenant budget review is an operational control, not a code one |
| R5 | Unreviewed AI proposal reaches the buyer | Medium | `assisted_selling` | `ai_proposals_require_rep_approval` defaults to `false`, so in `mode: 'both'` a store publishes priced AI suggestions with no human in the loop. A hallucinated bundle or an inappropriate upsell is shown under the merchant's branding. | The buyer's acceptance is a real, informed, reversible confirmation: the pre-flight preview re-prices before anything merges, `mergeSummary` and `priceChanges` disclose the result, `cart.mergeUndo` reverses it for 15 minutes, assortment is enforced twice (R2), and `untrustedInput: true` forces input moderation on the buyer-authored text that reaches the model. A store wanting a human gate sets the flag `true` and gets the shipped `AiPendingAction` plane | **Medium, accepted as a product decision, and the two gates are not equivalent.** The buyer gate confirms a price; the rep gate would catch hallucinated, off-brand or manipulated *content* before it is displayed under the merchant's branding, and by §1's own definition the buyer is the party least able to judge whether the proposed part fits. Reversibility is thinner than it reads: `mergeUndo` lasts 15 minutes and accept→checkout is routinely shorter, and after conversion there is no undo. The honest defence of the default is the trade-off, not a claim of a stronger gate — requiring approval would make `mode: 'both'` useless whenever no rep is online. A store that cannot accept this residual sets the flag |
| R6 | Attribution forged, or lost | Medium | `assisted_selling` | `authored_by_actor_id` or `added_by_actor_id` is written from request input, letting a caller credit another rep; or a conversion path forgets to emit `lineMap` and commission under-reports with no signal. | Actor columns are set from `ctx.auth`, never from the request body, and are non-nullable for `rep`/`ai_agent`; a test asserts a body-supplied actor id is ignored (`cart` R16). The missing-`lineMap` case degrades to order-level attribution and emits `assisted_selling.attribution.degraded` rather than writing nothing; the subscriber never infers the line mapping from product identity, because two lines may share a product and differ by `configuration_hash` | Low |
| R7 | Polling cost and thundering herd behind a CDN | Medium | `assisted_selling`, `apps/storefront` | Every storefront session polls `/thread/events`. At 5 s intervals across a busy store this is a sustained request rate against an origin the CDN cannot cache, and a deploy or an outage synchronizes every client into one burst. | The interval is adaptive — 5 s only while visible **and** a rep is present, 30 s otherwise, suspended while hidden, backing off to 120 s after a run of unchanged responses — with jitter on every schedule. `ETag`/`304` keeps an unchanged poll cheap. Polling starts only for a session that has a thread; the overwhelming majority of sessions never create one, and `GET /thread` returning `404` starts nothing | Medium until Phase 5 replaces the steady-state case with a stream; the fallback path retains this profile by design and that is the cost of the CDN requirement |
| R8 | A leaked cart token exposes a conversation | **High** | `assisted_selling` | The cart token is the credential for the buyer's half. `cart` R6 already rates its leakage High for basket and email exposure; a thread raises the stakes, because it holds free text written by and about identifiable people on both sides. | The token is never stored in clear here — the thread is keyed on `hashAuthToken(token)` (§5.1). Message bodies, participant display names and rejection reasons are encrypted at rest (§5.7). `cart` §8.3's existing controls apply unchanged: CSPRNG entropy, header or httpOnly cookie only, never a path segment, rotated on merge, per-token rate limited. Rotation on merge re-keys the thread, so a token captured before login stops resolving it | Medium — a token leaked mid-session before any rotation still reads the conversation, which is inherent to a guest-reachable surface with no second credential to present, and is the reason a guest thread must be treated as personal data from the first message |
| R9 | Authoring reachable without a principal | **High** | `cart`, `assisted_selling` | Every other buyer-facing route is token-bound, so authoring is written the same way by symmetry. An attacker with a leaked token then injects priced lines into the buyer's own proposal tray, rendered in the store's branding and one click from the basket. | `POST /carts/:token/proposals` and `POST /threads/:id/proposals` both require an authenticated principal holding `cart.proposals.author`; they are the only writes in this feature a cart token cannot reach. Asserted by a test presenting a valid token with no principal and expecting `401` (`cart` R15) | Low |
| R10 | Thread stranded by a cart lifecycle transition | Medium | `assisted_selling` | The buyer logs in, the cart merges and the token rotates. A thread keyed on the old cart resolves for nobody: the buyer polls and gets `404`, the rep sees a conversation that has gone silent, mid-sentence, at the exact moment the buyer identified themselves. | A subscriber on `cart.cart.merged` re-points `buyer_cart_id`, re-hashes the token and populates `customer_user_id`; a live proposal is **re-authored** against the merged-into cart, freshly priced, rather than re-pointed (§8.1) — re-pointing would need a `cart` command that does not exist and would carry a guest-priced basket into an identified session. Where the target already holds an open thread, §5.1's collision policy closes the guest thread and supersedes its proposals rather than violating the partial unique index. Both cases covered by integration tests | Low |
| R11 | Cross-tenant or cross-store thread access | **High** | `assisted_selling` | A thread is resolved by cart-token hash alone; a hash collision or a token replayed against another tenant's host returns another tenant's conversation. | Every query filters `tenant_id` and `organization_id` before the token hash, and the thread additionally carries `store_id` which must match the resolved `StoreContext`. Cross-tenant token resolution is already rejected by `cart` (§14 there) and the same fixture is extended to the thread routes | Low |

---

## 10) Integration Coverage

Shipping in the same change, per `.ai/qa/AGENTS.md`. Self-contained: fixtures created in setup through the API, removed in teardown, no reliance on seeded data.

**Every API path.** Each of the thirteen staff routes and four buyer routes — counting `GET` and `PUT /settings/:storeId` separately — asserted for: happy path; tenant isolation; cross-tenant rejection; a missing or insufficient ACL feature (`403`); an absent principal where one is required (`401`); optimistic-lock conflict on the mutating routes; and rate-limit enforcement on the four public ones.

**Pricing identity (R1):**
- A rep whose own resolution differs from the buyer's — different price kind, different group, different currency display mode — authors a proposal; every line's `unit_price_net`, `tax_rate` and `price_row_id` are byte-identical to the buyer's own resolution of the same products
- The same for the autonomous agent principal
- A proposal re-priced after the buyer's group changes follows the **buyer's** new group, not the author's

**Acceptance (the §6.2 ↔ `cart` §7a.4 seam):**
- `preview` creates nothing — cart, line, merge-log and proposal row counts unchanged before and after
- A stale `acceptanceToken` returns `409 proposal_changed` with a fresh preview and token, and merges nothing
- Tokens are single-use and expire after 15 minutes
- Per-line acceptance merges exactly the selected lines; unselected lines are recorded `declined`, neither merged nor deleted; `CartMergeLog.strategy` is `manual`
- Acceptance returns `mergeSummary` and `priceChanges` in one response
- `cart.mergeUndo` within 15 minutes reverses it and restores the proposal to `published` when it has not expired
- Acceptance against a `locked` target returns `423` with the session id
- Rejection leaves the target cart byte-identical and releases the proposal cart's code reservations

**Assortment (R2):**
- A restricted product is rejected at authoring against a storefront target
- A line that became restricted between authoring and acceptance is rejected at the merge boundary, reported in `mergeSummary` with `disposition: 'rejected'`, and is neither merged nor deleted
- Both paths emit `cart.line.visibility_rejected` with the correct `triggeredBy`

**Terminal states (§6.6):**
- `cart.proposal.accepted` sets `status: 'accepted'`, `resolved_at` and `merge_log_id`, and decrements `live_proposal_count`
- `cart.proposal.expired` and `.rejected` set their statuses; a `.rejected` arriving for a proposal already `withdrawn` or `superseded` does **not** overwrite it
- Redelivery of any of the three is idempotent
- Each emits the matching `assisted_selling.proposal.*` event exactly once

**Withdraw, supersede, re-author (§6.4):**
- `withdraw` rejects the proposal **cart**, not only the local row: a buyer presenting a previously-valid `acceptanceToken` afterwards is refused and nothing merges
- `reauthor` from an expired, a rejected and a withdrawn proposal each produce a freshly-priced new proposal with `superseded_by_proposal_id` set, and leave the old cart terminal
- Promotion code reservations held by a withdrawn proposal cart are released

**Mode enforcement (§6.3 step 0):**
- `mode: 'rep'` refuses an `ai_agent` author with `409`; `mode: 'ai'` refuses a `rep` author; `off` refuses both, and refuses `POST /threads` and `join`
- Flipping the store to `off` mid-conversation stops new proposals and leaves an already-published one acceptable
- The check reads the live setting: a thread whose `mode_snapshot` is `both` is still refused once the store is `rep`

**Staff-opened threads (§6.1):**
- A rep opens a thread against a basket the buyer never asked about; the buyer's next read shows the thread, the participant and the opening message
- No route creates a thread or joins one without the buyer seeing it (R3)

**The two runtimes (§4.2):**
- With `ai_proposals_require_rep_approval: true`, the tool call produces an `AiPendingAction` and **no `AssistedSellingProposal` row exists at all** until confirm; cancel leaves none; confirm creates it already `published`, with no second publish step and no route that could perform one
- With it `false`, the same tool call publishes directly and no `AiPendingAction` row is created
- No path produces a proposal in any status other than `published` — asserted against the status column's distinct values across the whole suite run, so a future `draft` cannot appear without failing this test
- The artifact is **identical** in both cases once published — same proposal cart, same line prices, same `authored_by_actor_type: 'ai_agent'`
- An expired `AiPendingAction` surfaces as re-proposable, and re-authoring produces a freshly-priced new proposal with `superseded_by_proposal_id` set on the old row
- A `loop.budget` breach aborts the turn and publishes nothing
- The per-thread hourly limit refuses the (n+1)th proposal with a distinguishable code

**Console reads (§6.1):**
- `GET /threads/:id` is refused to a principal holding `assisted_selling.threads.view` but not `cart.proposals.view`
- The inbox filters by store, status, `assigned_actor_id` and live-proposal count, and exposes no filter, sort or search over `display_name` (§5.2)

**Presence and disclosure (R3):**
- A rep joining appears in the buyer's next thread read, with no store setting able to suppress it
- `AssistedSellingStoreSettings` has no column that suppresses it — asserted against the entity's column list, so a future addition fails this test

**Attribution (R6):**
- One row per converted cart line, with the actor that added it; a mixed cart (buyer lines + rep proposal + AI proposal) produces the correct split
- `thread_id`/`proposal_id` resolve through `CartMergeLog.outcome`'s source→target line mapping; a line the buyer added themselves takes NULL for both and is not reported as degraded
- A line merged from a proposal keeps its author, rather than being rewritten to `merge`
- Amounts are snapshots: crediting the order afterwards does not change them
- A `cart.cart.converted` without `lineMap` degrades to order-level attribution and emits `assisted_selling.attribution.degraded`
- A body-supplied `actor_id` is ignored

**Lifecycle (§8):**
- Guest opens a thread, receives a proposal, logs in, accepts: the thread follows the merged cart, the proposal is **re-authored** against it and freshly priced, the old proposal cart is terminal, and acceptance succeeds on the new one (R10)
- The same flow where the account cart already holds an open thread: the guest thread closes, its proposals are superseded, both threads stay readable, and the partial unique index is never violated (§5.1)
- `mode: 'off'` refuses a new thread and leaves an open one usable
- An expired proposal is readable, not acceptable, and not deleted
- Two concurrent proposals from two reps are independently acceptable

**Transport:**
- `GET /thread/events` returns `304` for a current cursor and never carries a message body, a line or a price — asserted against the response shape
- The client suspends polling while the tab is hidden and backs off after unchanged responses
- **Phase 5:** with the stream blocked in transit rather than absent from the browser, the client falls back to polling **at runtime** and recovers to streaming on a later attempt — the case the existing `useMessages` capability check does not cover
- A stream connection presenting another tenant's cart token receives nothing

**Key UI paths** (`storefront-app.md` §12 owns the storefront half): the console inbox lists live threads scoped to the operator's organization; the thread page renders participants, messages and proposals with loading, empty and error states; the proposal builder refuses more than `max_proposal_lines`; a proposal line shows the buyer's resolved price with its provenance; **no console affordance writes to the buyer's cart**, asserted by enumerating the module's registered routes rather than by inspecting the UI.

---

## 11) Implementation Phases

> **Phase numbers in this section are internal to this spec.** The suite's Phase 4 (roadmap §7, "Experience") is where all five of them live. Where another document says "assisted selling Phase 5" it means the fifth phase below, not a sixth suite phase.

**Hard dependency:** `cart` Phase 3 including §6a.5 must ship before any phase here is enabled in a live store (R2). `cart` Phase 4 (§7a) must ship before Phase 1 here.

### Phase 1 — Foundation and the proposal seam

1. Module scaffold, entities, migrations, `encryption.ts`, `acl.ts`, `setup.ts` with the default role grants. The AI agent principal is **not** created here — it belongs to Phase 3, with the actor that needs it.
2. `AssistedSellingStoreSettings` with its admin page and the `tryResolve` exposure of the effective mode on the store context.
3. Thread, participant and message commands and the staff read/write routes.
4. `POST /threads/:id/proposals` wrapping `cart.proposal.create`, with the target-context pricing rule and its test.
5. Withdraw, supersede and re-author — each invoking `cart.proposal.reject` on the proposal cart, not only the local row (§6.4).
6. **The `cart.proposal.*` subscriber that writes every terminal state** (§6.6). Without it nothing in this module ever records that a buyer accepted.
7. The `cart.cart.merged` subscriber: re-point, re-author live proposals, apply the collision policy (§5.1, §8.1).
8. Staff thread opening and assignment; the live-`mode` check on opening, joining and authoring.

**Gate:** a proposal is authored and accepted end to end through the API, and the local row reaches `accepted` with `merge_log_id` populated; its line prices are byte-identical to the buyer's own resolution when the author's context differs; a withdrawn proposal cannot be accepted.

### Phase 2 — The human loop closes

1. Buyer routes: `GET/POST /thread`, `POST /thread/messages`, `GET /thread/events` with `ETag`.
2. The polling client contract — adaptive interval, jitter, visibility suspension, backoff.
3. Rep console: inbox, thread page, composer, proposal builder, price provenance.
4. Storefront proposal tray and conversation panel (delivered in `storefront-app.md` Phase 3).

**Gate:** a rep proposes, a buyer accepts two of five lines, the other three are recorded `declined`, undo reverses it; the console never exposes a write to the buyer's cart, asserted by route enumeration.

### Phase 3 — The AI actor

1. The agent principal (`auth.User`, `kind: 'agent'`), its role grants, and the settings validator requiring `ai_agent_user_id` whenever `mode ∈ {ai, both}`.
2. `assisted_selling.propose_cart_lines` with `isMutation: true`, `loadBeforeRecords` and both feature requirements.
3. The agent definition with `loop.budget`, `stopWhen` and `untrustedInput: true`.
4. The copilot runtime: `AiPendingAction` path, `mutation-preview-card`; confirm runs the handler, which creates the proposal already published — one approval step, not two (§4.2).
5. The autonomous runtime: server-side trigger on buyer activity, direct publish.
6. Per-thread rate limit; the expired-draft re-propose affordance.

**Gate:** both runtimes produce an identical published artifact; a budget breach publishes nothing; the hourly limit refuses with a distinguishable code.

### Phase 4 — Attribution

1. `AssistedSellingAttribution` and its migration.
2. The `cart.cart.converted` subscriber, including the degraded path and its event.
3. `GET /attributions` and the console report.

**Gate:** a mixed cart splits correctly per line; amounts survive a later credit; a missing `lineMap` degrades visibly.

### Phase 5 — Live transport and presence

1. `storefrontBroadcast` on `EventDefinition` and its predicate, mirroring `clientBroadcast` / `portalBroadcast`.
2. `/api/ecommerce/storefront/events/stream`, audience-keyed on the cart-token hash, with `crossProcessBroadcast` so it is correct on more than one instance.
3. The storefront client's **runtime** fallback to polling and recovery to streaming.
4. Presence: participant state, the non-removable disclosure, and idle expiry.

**Gate:** with the stream blocked in transit the client degrades to polling without losing an event and recovers afterwards; a rep's presence is visible to the buyer and no setting suppresses it.

---

## 12) Final Compliance Report

| Requirement | Status |
|---|---|
| No cross-module ORM relations | Every reference to `cart`, `sales`, `auth`, `customers`, `customer_accounts` and `ecommerce` is an FK id; services reached through DI; the optional peer is resolved with `tryResolve` |
| Tenant/organization scoping | Every entity and every query; thread resolution filters tenant and organization **before** the token hash, and additionally matches `store_id` (R11) |
| Module naming | snake_case module id `assisted_selling` — a mass noun, like the existing `auth` and `cart`, rather than forced into a plural that names nothing; singular entity ids; event ids `module.entity.action` with past-tense actions |
| Command pattern | Every mutation is a registered command with `withAtomicFlush` and post-commit side effects |
| Optimistic locking | `updated_at` on every user-editable entity; settings and proposal edits carry the standard header; conflicts surfaced through the shared conflict bar |
| Encryption | `AssistedSellingMessage.body`, `AssistedSellingParticipant.displayName`, `AssistedSellingProposal.rejectionReason` declared in `defaultEncryptionMaps`; reads through `findWithDecryption`. The cart token is stored as a one-way hash, never encrypted-and-recoverable |
| Zod validation | All routes; `z.infer` types; no `any` |
| ACL | Feature-gated admin namespace; buyer surfaces deliberately ungated and cart-token bound, because a guest has no ACL identity |
| Rate limiting | Per IP and per token on all four public routes; per thread on AI authoring; `loop.budget` on the agent turn |
| Events | `createModuleEvents`; `clientBroadcast` for the console; `storefrontBroadcast` from Phase 5; signal-only payloads |
| Canonical UI | `DataTable`, `CrudForm`, the `messages` and `detail` families, `apiCall`; no raw `fetch`, no hand-rolled dialog, no custom polling in the backoffice |
| Design system | Semantic status tokens; no arbitrary values; no `dark:` on semantic tokens; `Cmd/Ctrl+Enter` / `Escape` in dialogs; `aria-label` on icon-only buttons |
| i18n | All copy through locale files; internal-only throws prefixed `[internal]` |
| Backward compatibility | New module. The one platform-contract change is an **additive** `storefrontBroadcast?: boolean` on `EventDefinition` (Phase 5), matching the existing `clientBroadcast` / `portalBroadcast` optional flags, so no deprecation protocol is triggered. `cart`'s seam changes are breaking on paper only — that module has no implementation anywhere in the repository |
| Roadmap conformance | ADR-10 amended into the umbrella **before** this spec was written, per roadmap §1; ADR-7 and ADR-9 honoured by pricing against the target's buyer context |
| Integration coverage | §10, shipping in the same change |

---

## 13) Changelog

### 2026-09-22 (rev 1)

Initial specification, written against [ADR-10](./2026-08-14-ecommerce-suite-roadmap.md#adr-10--a-proposal-is-a-cart-and-acceptance-is-a-merge), which was added to the umbrella first because roadmap §1 requires a deviating child spec to amend it before departing from §5.

**What this document found already wrong or unstated, rather than merely absent:**

- **`cart-module.md` §10.2 stated a prohibition with no counterpart**, which is a gap rather than a boundary. Rev 7 of that spec turns it into a contract; this spec is the counterpart.
- **`CartMergeLog.strategy` admitted `manual` and no policy row could produce it** — a value the model allowed and the specification could not reach. Per-line acceptance reaches it.
- **`CartLine.added_by` named a question it could not answer**, carrying no id at all.
- **`cart` Open Question 4 was mis-filed** as an approval-contract question for the AI framework. It is a modelling question, its answer serves a human rep equally, and rev 7 closes it by dissolving it.
- **`cart` §6a.4 composed with merge into a bypass of that spec's R11**, independently of this feature. Recorded as `cart` **R13** and shipped with `cart` **Phase 3**.
- **The brief's premise that `useMessagesSse` + `useMessagesPoll` are an SSE-with-fallback precedent does not hold.** `useMessages` chooses between them once, at module-evaluation time, on `typeof window.EventSource !== 'undefined'`, and freezes the choice. That is adequate behind an admin shell; in front of a CDN the transport is present in the browser and blocked in transit, so §4.4 requires a **runtime** fallback and Phase 5 tests it by blocking the stream rather than removing the API.
- **The `messages` module cannot host this thread as data**, though it was the obvious candidate: `Message.sender_user_id` and `MessageRecipient.recipient_user_id` are non-nullable staff `uuid`s and there is no actor-type column. The UI families are reused; the schema is not.
- **The Portal Event Bridge cannot serve the storefront**: it requires an authenticated `CustomerUser` (excluding guests), lives in the `customer_accounts` namespace, and keeps connections in a process-local `Set` that needs `crossProcessBroadcast` before it is correct on more than one instance.
- **`AI_PENDING_ACTION_DEFAULT_TTL_SECONDS` is 900 s**, sized for an employee watching a chat stream. Rather than raise a platform-wide env var governing every pending action in the system, §6.4 makes an expired draft one-click re-proposable — and a fresh price after fifteen minutes is what the buyer should be shown anyway.
- **`ai_proposals_require_rep_approval` selects a runtime, not just a gate** (§4.2). `prepareMutation` needs a staff context, so the employee approval plane is structurally unreachable in the autonomous case — not by policy, but because `getAuthFromRequest` rejects customer-audience sessions outright.

**Decisions taken at the Open Questions gate**, recorded so a later reader sees they were chosen rather than defaulted: the thread lives in a new `assisted_selling` module (not `customer_accounts`, not `cart`); v1 polls and real-time lands in Phase 5 as pure transport; acceptance is a pre-flight preview plus a re-resolving confirm, on the `resolutionToken` shape spec 9 §7.3 already fixed for shopping-list conversion; proposals expire after a configurable 72 h and remain readable as history; attribution is per line, in this module, written at conversion; AI drafts reach the buyer directly by default, with no rep suppression window, and `true` on the flag routes them through the shipped `AiPendingAction` plane; and the merge-visibility fix ships with `cart` Phase 3 rather than with this feature, because the defect it closes predates it.
