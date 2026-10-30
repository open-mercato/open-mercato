# Assisted Selling

| Field | Value |
|-------|-------|
| **Status** | Specification (rev 6 — Release 5 spec revision; spec-only, not built) |
| **Created** | 2026-09-22 |
| **Suite** | [Ecommerce Suite Roadmap](./2026-08-14-ecommerce-suite-roadmap.md) — spec 13, **suite** Phase 4 |
| **Release 5 scope** | Phase 1 (`mode` `rep \| off`, no AI entities), Phase 2 items 1, 2 (server side), 3 (full console) and 5, Phase 4 — §11 "Release 5" block (D-R5-11, D-R5-15, D-R5-16). Out: Phase 2 item 4, Phase 3, Phase 5 |
| **Modules** | `assisted_selling` (new), `cart` (seam only — spec 5 rev 10 §7a), `ecommerce` (`storeContextService.resolveForBuyer`, SPEC-029; transport in internal Phase 5, not Release 5), `apps/storefront` (UI — spec 10 §5.9–§5.10, not Release 5) |
| **Depends on** | [Cart Module](./2026-08-14-cart-module.md) rev 10 (§7a seam, D-R5-21 identity binding, `cart.markConverted` `lineMap`), [SPEC-029](./SPEC-029-2026-02-17-ecommerce-storefront-module.md) `storeContextService.resolveForBuyer` (D-R5-22), the shared trusted command context helper `buildTrustedCommandContext` (X10), [Storefront Public API](./2026-08-14-storefront-public-api.md), [Storefront App](./2026-08-14-storefront-app.md), [Storefront Customer Account](./2026-08-14-storefront-customer-account.md) |
| **Release 5 analysis** | [`ANALYSIS-2026-10-26-assisted-selling-release-5.md`](./analysis/ANALYSIS-2026-10-26-assisted-selling-release-5.md) (S1–S25), [decisions](./analysis/ANALYSIS-2026-10-26-ecommerce-release-5-decisions.md) (D-R5-*), [cross-spec](./analysis/ANALYSIS-2026-10-26-ecommerce-release-5-cross-spec.md) (X1–X20) |
| **Related** | [ADR-7](./2026-08-14-ecommerce-suite-roadmap.md#adr-7--buyer-context-is-resolved-once-at-the-edge), [ADR-9](./2026-08-14-ecommerce-suite-roadmap.md#adr-9--buyer-scoped-prices-bucket-by-group-per-customer-contracts-are-an-overlay), [ADR-10](./2026-08-14-ecommerce-suite-roadmap.md#adr-10--a-proposal-is-a-cart-and-acceptance-is-a-merge), [SPEC-056 WhatsApp AI chat](./SPEC-056-2026-02-22-whatsapp-ai-chat-integration.md) |

---

## TLDR

**Key Points:**
- A buyer in the storefront receives "add this to your basket" suggestions from an AI agent, from a human sales rep working the admin console, or from both in one thread — and accepts or rejects them, line by line.
- **The unit of acceptance is a proposal cart, not a chat message.** The conversation is transport; the commitment is a separate `Cart` carrying the role `proposal` and pointing at the buyer's basket. Accepting is a **merge**. Nobody ever writes into a basket they do not own.
- **AI and rep are not two features.** They are two actor types producing one artifact on one thread, selected by `mode: 'ai' | 'rep' | 'both' | 'off'`. One set of commands, one acceptance path, one disclosure.
- Two approval planes exist and are not interchangeable. **AI → employee** already ships (`prepareMutation` + `AiPendingAction` + its confirm route) and is not re-specified. **Proposal → buyer** is new, and is a pre-flight preview followed by a re-resolving confirm — because the price shown in a proposal and the price charged after the merge are resolved at different moments.
- **Live is a transport layer over this model.** v1 is async: proposal, notification, polling. Real-time lands in **Phase 5** and changes nothing but the transport — it says only *that* something changed, and the client re-reads state through the API.

**Release 5 (rev 6):**
- Ships the **rep side only**: the settings validator accepts `mode: 'rep' | 'off'`; `ai` and `both` stay reserved enum values with no behaviour until Phase 3 (S10, D-R5-15). `AssistedSellingAiDraft` and `AssistedSellingAiTurn` are not created.
- Ships the staff routes, the full rep console (inbox, thread page, composer, proposal builder with the buyer's prices and provenance), the buyer thread routes with the `/thread/events` server contract, retention and erasure, and per-line attribution against order and quote lines (D-R5-15, D-R5-16, D-R5-26). There is no first-party storefront in Release 5; buyer clients are integrators calling the API.
- Every route lives under `/api/assisted_selling/…` (S4). The buyer credential is the `X-Cart-Token` header only (S8); an identified basket additionally requires its own buyer's customer session, otherwise `404` (D-R5-13, D-R5-21).
- Authoring resolves the target buyer through SPEC-029's `storeContextService.resolveForBuyer` with the thread's store (D-R5-22). On a login merge a live proposal is re-authored as its original author through `buildTrustedCommandContext`, audited as system-initiated (D-R5-14). An accepted proposal cannot be un-merged (D-R5-25).

**Scope:**
- `assisted_selling`: thread, participants, messages, proposal metadata and lifecycle, per-store settings, commission attribution
- The rep console in the backoffice, built from the existing `messages` and `detail` component families
- The AI actor: one proposing tool, one server-side runner, a per-store mutation policy, a budget and a rate limit
- The buyer-facing thread API and its polling transport; the real-time transport in Phase 5
- The presence disclosure obligation

**Out of scope:**
- A new chat module, and a `CartProposal*` entity family. Both are refused for reasons stated below, not merely omitted.
- Quote acceptance. `SalesQuote`/`SalesQuoteLine`/`SalesQuoteAdjustment` ship today (`packages/core/src/modules/sales/data/entities.ts:827`), with a token-addressed `POST /api/sales/quotes/accept` that converts to an order in one transaction, and spec 9 §8 contracts the authenticated portal twin behind `portal.quotes.accept`. This spec fills the gap **before** a quote exists.
- Co-browsing, screen sharing, voice. Presence (Phase 5) is "a rep is in this conversation", nothing more.
- Any change to how a buyer or a staff member authenticates.

**Concerns:**
- The store setting that decides whether an AI draft needs rep approval selects which of two agent declarations — differing only in **mutation policy** — one server-side runner executes, not a choice between runtimes — and the draft it produces is confirmed by a rep who was never in that agent's turn (§4.2)
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
| `cart.mergeUndo`, 15 min | `cart` §7.2 | Regret — for a login merge only; refused for a proposal acceptance (D-R5-25), where the buyer removes lines instead |
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
                                          ┌──────── cart (spec 5 rev 10) ──────┐
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
  POST /ai/actions/:id/confirm | /cancel        POST /cart/proposals/:proposalId/accept
  staff session required                       X-Cart-Token header; guest-reachable;
                                               identified basket: + its own customer session
  TTL 900 s                                    TTL = store proposal TTL (72 h default)
  ALREADY IMPLEMENTED — not re-specified       NEW — cart §7a
  PHASE 3 — not in Release 5                   RELEASE 5
```

They are not merely conventionally separate. `getAuthFromRequest` (`packages/shared/src/lib/auth/server.ts:479`) returns `{ auth: null, status: 'invalid' }` for any request-path session whose `payload.type === 'customer'` (`server.ts:421`; the cookie resolver applies the same rule at `:374`), so a buyer is structurally incapable of authenticating against the employee plane. A design that tried to route buyer acceptance through `AiPendingAction` would have to weaken that check, which exists to stop a staff-audience token being replayed as a customer one and vice versa.

### 4.2 `aiProposalsRequireRepApproval` is a mutation policy, not a runtime

> **Phase 3 — not in Release 5 (D-R5-15).** Everything in §4.2 and §4.3 describes the AI actor. Release 5 ships no agent declaration, tool, worker, AI participant, `AssistedSellingAiDraft` or `AssistedSellingAiTurn`, and the settings validator refuses `mode: 'ai' | 'both'` (§5.6, S10), so no AI participant can exist without an AI behind it and R3's AI disclosure is never false. The text stays as the Phase 3 design.

Rev 1 said this flag chose between two runtimes — the rep's backoffice chat when `true`, an autonomous server-side run when `false` — on the premise that `prepareMutation` needs a staff session. That premise is wrong, and the two-runtime design built on it is replaced.

**What actually gates an `isMutation` tool is the agent's `mutationPolicy`, not who is running it.** `prepareMutation` takes `tenantId`, `organizationId`, `userId`, `features` and a container (`packages/ai-assistant/src/modules/ai_assistant/lib/agent-tools.ts:248-265`); nothing in it checks for a staff session or `User.kind`. The agent principal of §4.3 supplies all five. The per-call decision is made at `agent-tools.ts:234-241` from the **effective** policy:

| Effective policy | An `isMutation` tool call… |
|---|---|
| `confirm-required` | always becomes an `AiPendingAction` |
| `destructive-confirm-required` | becomes an `AiPendingAction` only when the tool's `isDestructive` (a boolean or a per-call predicate) is true; otherwise it runs directly — the behaviour the comment at `agent-tools.ts:230-233` documents ("comment delete gates while comment create runs direct") |
| `read-only`, or undeclared | never reaches the model: the tool is filtered out (`agent-policy.ts:95`, `:217-231`) |

The effective policy is the most restrictive of the code-declared one and an optional `mutationPolicyOverride` (`resolveEffectiveMutationPolicy`, `agent-policy.ts:89-107`), `runAiAgentText` takes that override only from the tenant-wide `(tenant, organization, agent)` row (`agent-runtime.ts:1635-1641`); its input has no per-call override field (`RunAiAgentTextInput`, `agent-runtime.ts:93-180`). A per-store setting therefore cannot be expressed as an override at all — it has to be a choice of agent.

**The design, therefore: two agent declarations, one server-side runner, one tool.**

- Two agents share one prompt, one tool list and one set of `requiredFeatures: ['assisted_selling.proposals.author', 'cart.proposals.author']`, and both set `readOnly: false` — `isAgentReadOnly` defaults an undeclared agent to read-only and would drop the tool with `mutation_blocked_by_readonly` (`agent-policy.ts:131-134`, `:217-224`) — and `untrustedInput: true` (§6.5). They differ only in `mutationPolicy`: `assisted_selling.seller_reviewed` declares `confirm-required`; `assisted_selling.seller` declares `destructive-confirm-required`. The tool `assisted_selling.propose_cart_lines` declares `isMutation: true` and `isDestructive: false`.
- **Trigger.** A persistent subscriber on `assisted_selling.message.posted`, filtered to buyer-authored messages on a thread whose store's live `mode ∈ {ai, both}`, enqueues an `assisted-selling-ai-turn` job for the thread. A queue worker runs the turn — never the HTTP request that posted the message, and never inside the buyer's rate-limited route.
- **One turn per thread at a time, deduplicated inside this module (rev 3).** The platform queue offers no dedupe key — `EnqueueOptions` carries only `delayMs` (`packages/queue/src/types.ts:152-157`) and no strategy deduplicates — so the guarantee is a database one. `AssistedSellingAiTurn` (§5.9) has a partial unique index on `(tenant_id, thread_id)` where `status IN ('queued', 'running')`. The subscriber inserts a `queued` turn row and enqueues the job only when that insert succeeds; a unique-violation means a turn is already queued or running, and the subscriber does nothing — that turn will read the message. The worker moves the row `queued → running` with a conditional update (`WHERE status = 'queued'`) before calling the model. **Reads are recorded per message, not as a position (rev 5).** When the turn moves to `running`, the worker selects the thread's buyer messages with `ai_read_by_turn_id IS NULL` (§5.3) — the turn's **read set** — and folds exactly those into its input. A buyer message is **unread** while `ai_read_by_turn_id` is NULL; there is no cursor and no comparison by `sent_at`. A position would not do: `sent_at` is stamped when the message command runs, but the row becomes visible only when `withAtomicFlush` commits, so two concurrent posts can commit in the opposite order to their stamps, and a message committing after a later-stamped one that a turn already read would sort behind any cursor — never read, never screened, and replayed to every later turn as history. A per-message marker has no order to violate: a late-committing message is simply still NULL, and the next turn folds it in whatever its stamp. The worker writes `ai_read_by_turn_id = <turn id>` on exactly the ids of its read set, in the transaction that closes the row, and only once input moderation has ruled on the turn's input: when `runAiAgentText` resolves (the gate passed) or throws `AiModerationBlockedError` (the gate refused). **Any other ending marks nothing (rev 5)** — a turn that ends before the gate ruled (`turn_limit`, a principal that cannot be built, `AiModerationUnavailableError`) and equally a turn that throws **after** the gate passed (`provider_error`, a `budget` stop the runtime surfaces as a throw, a worker that dies and is swept `provider_error`). Its read set stays unread and is folded into, and re-screened by, the next turn; the turn is not retried. Whatever the failed turn already committed through a tool call before throwing stands — a proposal it published is not rolled back — so re-reading the same messages can produce a second proposal, which the proposal cap bounds (§6.5). When the turn ends (`finished` or `failed`), the worker first commits the row's closed status together with the markers and only **then**, if it marked any message, checks whether any buyer message on the thread is still unread; if one is, it inserts the next `queued` row and enqueues it. **A turn that marked nothing schedules no follow-up (rev 4, restated rev 5).** Its unread messages wait for the next turn, which the next buyer message triggers on its own; a follow-up from a turn that read nothing would find its own read set still unread, re-queue on every message and, at the turn cap, loop until the hour rolls over. The order matters: a message posted while the row is still open collides with it and relies on this check, and a message posted after the close finds no active turn and inserts its own — if both the worker and the subscriber try to insert, the partial unique index lets exactly one win and the other does nothing. A burst of messages therefore yields one turn, a message posted while a turn runs yields exactly one follow-up turn, no message is lost — at worst, after a turn that read nothing, it is read by the next turn — and no two turns ever run on one thread. A job whose turn row is missing or not `queued` exits without work, so a redelivered or re-enqueued job cannot start a second turn. A `queued` row whose job never arrived is recovered by §5.9's sweep, so a lost enqueue cannot hold a thread's AI silent.
- **Every buyer message a turn reads is moderated (rev 3).** The runtime's input moderation screens only the latest user message — `extractLatestUserText` (`agent-runtime.ts:1045`), used by the gate at `:1733` — on the assumption that earlier history "was screened on its own turn". Batching breaks that assumption: in a burst of three, messages 1–2 would reach the model unscreened. So the worker builds the model's messages such that **every buyer message not yet read by a previous turn is folded, in order, into the single final `user` message** of the turn, each prefixed with its send time; history precedes it. `untrustedInput: true` then forces moderation (`moderation-policy.ts:53`) over exactly the text no earlier turn screened. A moderation refusal fails the whole turn, publishes nothing and posts no reply (§8.8).
- **A refused message never reaches the model later (rev 4).** History may contain only buyer messages that an earlier turn read **and whose input passed moderation**; a message that was screened and refused is also "read", and would otherwise be replayed as unscreened history on the next turn — a refused jailbreak followed by "hi" would put the jailbreak in front of the model, because the gate screens only the new final message. So when the gate throws `AiModerationBlockedError`, the worker sets `ai_input_flagged_at` (§5.3) on every buyer message folded into that turn's final message, in the same transaction that closes the row `failed` (`moderation`) and writes their `ai_read_by_turn_id`. The runtime refuses the folded text as a whole and cannot say which part was flagged, so all of it is withheld, which fails closed. Every later turn excludes messages with `ai_input_flagged_at` set from its model input, as history and as unread text alike. They stay in the thread, for the buyer and the rep; only the model never sees them again. `AiModerationUnavailableError` is different: nothing was screened, so the turn closes `failed` (`moderation`), marks nothing, flags nothing, and the same messages are folded into — and screened by — the next turn.
- **Turns are capped per thread per hour (rev 3).** Before moving a turn to `running`, the worker counts that thread's turns started in the last hour; at `ai_max_turns_per_thread_per_hour` (§5.6) it closes the row `failed` with reason `turn_limit` and does not call the model. The refused turn read nothing, so it marks no message and schedules no follow-up (rev 4): at the cap, each buyer message yields exactly one `turn_limit` row and nothing re-queues itself. This bounds model usage for a buyer who never triggers a proposal — the proposal limit (§6.5) cannot, and the 30/min route limit alone would allow a full `loop.budget` per message.
- **Principal.** The worker calls `runAiAgentText` **with a container** and an auth context built for the store's `ai_agent_user_id` (§4.3, §5.6), its features loaded through `rbacService.loadAcl` exactly as for a human. Revoking the agent's role therefore still stops it.
- **The store flag picks the agent.** `aiProposalsRequireRepApproval: true` → the worker runs `assisted_selling.seller_reviewed`, and every proposal becomes an `AiPendingAction`. `false` → it runs `assisted_selling.seller`, and because the tool is non-destructive the call runs directly and publishes. Both are plain code declarations on the platform's existing contract; no override and no `ai-assistant` change is involved. **The tenant override row cannot be trusted to mean what its name says here, so the tool handler fails closed.** The platform ranks `confirm-required` as the *least* restrictive policy (`POLICY_RESTRICTIVENESS`, `agent-policy.ts:69-73`) and applies an override only when it ranks lower (`:105-107`). So a tenant cannot force `assisted_selling.seller` to `confirm-required` — the override is silently ignored — while an override of `destructive-confirm-required` on `assisted_selling.seller_reviewed` *is* accepted and, at runtime, lets the non-destructive tool publish directly: rep approval would disappear although the store says it is required. **The refusal is enforced in the tool handler, not the worker (rev 3).** On the direct path — no `approvedPendingActionId` in the handler context — the handler refuses, publishes nothing and logs the misconfiguration whenever the §5.9 turn named by `turnId` has `agent_id = 'assisted_selling.seller_reviewed'`: under that agent a direct call can only mean the effective policy was relaxed. This needs nothing from `ai_assistant` — its override reader, `resolveMutationPolicyOverride` (`agent-runtime.ts:1300`), is private and its repository is not in DI, and reading its table would be the coupling §5.8 refuses — and it has no timing gap, because `runAiAgentText` re-reads the override itself (`:1635`) and a worker-side check could pass a moment before the row changes. It also covers a run without a container. The worker performs no policy read of its own; if `ai-assistant` later exposes an effective-policy read in DI, the worker MAY use it as an early exit to skip a turn that the handler would refuse, but correctness never depends on it. A `read-only` override on either agent simply silences it, which is a legitimate kill switch. The store flag, not the tenant row, is the supported control.
- **Binding a tool call to its thread.** A tool handler receives tenant, organization, user, features and a container, and on confirm additionally `approvedPendingActionId` (`agent-tools.ts:152-166`, `pending-action-executor.ts:291-306`) — nothing that names the run, the conversation or the thread. The target therefore reaches the handler through tool input, and the input is model-controlled, so a buyer's injected text could otherwise point the agent at another buyer's conversation in the same store. The worker opens an `AssistedSellingAiTurn` (§5.9) before calling the model and puts that turn's id — a random v4 uuid, present only in *this* turn's prompt — into the system context; the tool's input carries it as `turnId`. **The id reaches the prompt through the shipped page-context hook**: the worker passes `pageContext: { entityType: 'assisted_selling:ai_turn', recordId: turnId }` to `runAiAgentText`, and both agents declare a `resolvePageContext` that loads the turn (tenant- and organization-scoped, and only while it is `running`) and returns the turn id plus the thread's non-personal context for `composeSystemPrompt` to append (`agent-runtime.ts:1223-1235`). Hydration is best-effort in the runtime — a throwing resolver is logged and skipped — which fails closed here: a prompt without the turn id yields tool calls whose `turnId` validates against nothing. The handler, on the direct path, accepts the call only when that turn exists in the tenant and organization, is `running`, belongs to `ctx.userId` (the agent principal) and is younger than the **effective** `maxWallClockMs` — the declared budget after any tenant runtime override (`AiAgentRuntimeOverrideRepository`, `loopMaxWallClockMs`), which the worker records on the turn row when it opens it — plus a margin; it takes the **thread** from the turn row and ignores anything else. Another thread's turn id never appears in this turn's context, so a model cannot produce it. On the confirm path it resolves the thread from the §5.8 draft row keyed by `approvedPendingActionId` instead, **refuses when no such draft row exists** — so a rep who selects `assisted_selling.seller_reviewed` in the backoffice chat and confirms their own call cannot publish it as an AI proposal — and refuses if that row's thread differs from the stored turn's. This is open question §11a Q3, because an additive run-context field on the handler context would be cleaner and is an `ai-assistant` contract change.
- **Never without a container.** `runAiAgentText` called without one silently lets mutation tools execute unintercepted (`canInterceptMutations`, `agent-tools.ts:349-350`). The worker MUST pass one, and §10 asserts that a turn run with `aiProposalsRequireRepApproval: true` produces an `AiPendingAction` and no proposal — which fails if that path is ever taken.

**How a pending draft reaches a rep who was not in the turn.** The worker runs with `sessionId = assisted_selling:thread:<threadId>` (the pending action's `conversationId`, `agent-runtime.ts:1655-1667`). `runAiAgentText` returns a streamed `Response`, and the `mutation-preview-card` UI part is **not** in it — the interceptor queues that part (`agent-tools.ts:265`), but `runAiAgentText` keeps only `{ agent, tools }` from tool resolution (`agent-runtime.ts:1660`) and never drains the queue. What the stream does carry is the tool **output**, which for a gated call is `formatPendingActionToolResult`'s `{ status: 'pending-confirmation', agentId, toolName, pendingActionId, expiresAt, message }` (`agent-tools.ts:178-190`) — the same JSON the shipped chat client parses to rebuild the card (`packages/ui/src/ai/useAiChat.ts:494-501`). The worker drains the stream to completion — it must anyway, to end the turn and close the §5.9 row — and reads `pendingActionId` and `expiresAt` from every tool output with that status. For each it writes one `AssistedSellingAiDraft` row (§5.8) joining the thread to the action — the platform offers no list of pending actions by conversation and no DI-exposed repository, so this module keeps its own join rather than reaching into `ai_assistant`'s tables. The console lists open drafts in `GET /threads/:id` (§6.1) and renders each with the unchanged `mutation-preview-card`, reading the action through `GET /api/ai/actions/:id`. A subscriber on the platform's frozen `ai.action.confirmed | .cancelled | .expired` events (`ai_assistant/events.ts`) sets the draft's `resolved_at`.

**How the agent's answer reaches the buyer (rev 3).** Answering questions is most of what the agent does in `mode: 'ai'`, so the reply path is specified as carefully as the proposal path:

- **The AI participant exists before the first turn.** When a thread opens under a live `mode ∈ {ai, both}` — by the buyer or by staff — the open command also creates one `ai_agent` participant with `actor_id` = the store's `ai_agent_user_id` and a `display_name` taken from store-level copy (a label such as "Shop assistant", never a human name). A thread opened under `rep` or `off` that later runs a turn after the mode changed gets the row from the worker, idempotently through §5.2's unique index, before the turn starts. The buyer's thread payload therefore lists the AI participant before any AI text exists.
- **History is mapped to model roles by author.** Buyer messages become `user` content (the unread ones folded into the final `user` message, per the moderation rule above). This agent's own earlier messages become `assistant` content. Rep messages and system messages become `assistant` content prefixed with a speaker label (`[sales representative]`, `[system]`), so the model can tell who said what on the seller side and never mistakes a rep's words for its own or for the buyer's. Participant display names are not sent; the labels are fixed strings.
- **The reply is posted by the worker, not by the model.** While draining the stream (above), the worker accumulates the final assistant text. When the turn ends `finished` with non-empty text, the worker posts it as one `AssistedSellingMessage` from the AI participant, through the same message command a rep's post uses — so it is encrypted, emits `assisted_selling.message.posted`, and appears in the buyer's next poll. A proposal published in the same turn carries its own message (§6.3 step 6); the reply is posted after it. A turn that fails, is cut by `loop.budget`, or is refused by moderation posts nothing (§8.8). The `message.posted` subscriber that triggers turns ignores messages from any participant other than `buyer`, so the reply cannot trigger another turn.
- **Model output is screened before a buyer sees it.** The platform moderates input only; nothing screens output. The worker therefore runs the reply text through the same moderation service the input gate uses — `moderationService`, registered in `ai_assistant/di.ts` — before posting it, and drops a flagged reply; if the service is unavailable the reply is dropped too, because an unscreened answer on a public surface is the failure this rule exists to prevent (logged, no message posted, the thread stays quiet as in §8.8). Output is rendered as `text`, never `markdown` or HTML, so model output cannot inject markup into the storefront.
- **AI disclosure is not a setting, exactly as rep presence is not (R3).** The AI participant is always in the buyer's thread payload while the store's mode permits the AI, every AI-authored message carries `actor_type: 'ai_agent'`, and the storefront renders a persistent "you are talking to an AI assistant" disclosure on the panel and an AI label on every AI message and proposal (`storefront-app.md` §5.10, R11). `AssistedSellingStoreSettings` has no column that can suppress it. This is a transparency obligation of its own (EU AI Act Art. 50: people must be informed they are interacting with an AI system), not a consequence of the rep rule.

**Who may confirm another principal's pending action.** The shipped confirm route does not require the confirmer to be the creator: it loads the row by id within the caller's tenant and organization (`AiPendingActionRepository.getById`) and then re-checks `ai_assistant.view`, the agent's `requiredFeatures` and the tool's policy against the **confirmer's** ACL (`api/ai/actions/[id]/confirm/route.ts:108-195`, `lib/pending-action-recheck.ts`). So any rep in the store's organization holding `ai_assistant.view`, `assisted_selling.proposals.author` and `cart.proposals.author` can confirm — which is the intended audience, and is why the agent declares both authoring features as `requiredFeatures`. The agent principal MUST belong to the store's organization, or no rep can ever see its drafts.

**Whose name goes on a confirmed proposal.** The confirm route executes the tool handler under the **confirmer's** identity (`userId: auth.sub`, `confirm/route.ts:201-208`). Taken literally, §6.3's "`authored_by_*` from `ctx.auth`" would then credit the rep with the AI's proposal, and §10's assertion that both paths produce an identical `authored_by_actor_type: 'ai_agent'` artifact would fail. The rule instead: the tool handler — reachable only through this agent — resolves the author as `ai_agent` / the store's `ai_agent_user_id` from settings on the server, and runs the §6.3 command under an auth context built for that principal (the same construction the worker uses). The confirming rep is recorded in `AssistedSellingProposal.approved_by_actor_id` (§5.4). Neither value ever comes from the tool's input schema.

**There is still exactly one approval step.** `prepareMutation` never invokes the handler; the handler runs from the confirm route. Before confirm there is no `AssistedSellingProposal` row — only the `AiPendingAction` and its §5.8 join row — and after confirm the proposal is created `published`. An intermediate `pending_rep_approval` status with a second "publish" action would be unreachable state and a second click for a decision already taken — the defect §2.3 indicts in `CartMergeLog.strategy`, reproduced. Cancelling the card leaves no proposal (§10).

With the flag `false`, **the buyer is the approver**: the proposal is published directly and acceptance is the approval. The buyer's accept is a real, informed, reversible confirmation of a *price*; R5 states plainly why it is not a substitute for a rep reviewing *content*.

**Ask First.** `packages/ai-assistant/AGENTS.md` lists "relaxing mutation policies" under Ask First. Declaring `destructive-confirm-required` on an agent whose only tool writes is exactly that, so the Phase 3 implementation PR MUST carry an explicit maintainer sign-off on it, not merely this spec's approval.

**A platform inconsistency this design depends on, stated so it is not discovered later.** The ranking comment at `agent-policy.ts:60-67` says `destructive-confirm-required` "forces confirmation for every write (including non-destructive ones)"; the runtime at `agent-tools.ts:236-239` gates only destructive calls under it. This spec relies on the runtime behaviour, which the adjacent comment in `agent-tools.ts` also documents. If the runtime is ever changed to match the ranking comment, `assisted_selling.seller` — and so the `false` setting — degrades to "every AI proposal needs a rep" — the fail-safe direction — and §10's "publishes directly and no `AiPendingAction` row is created" test catches it. Reconciling the comment with the runtime is platform work outside this spec.

The closest in-repo precedent for a server-side, propose-only agent run is `agent_orchestrator`'s runner (`packages/enterprise/src/modules/agent_orchestrator/lib/runtime/nativeAgentRunner.ts`). It is enterprise-only, so it is a reference for the shape, not a dependency.

### 4.3 The AI actor is a principal, not a category

The agent runs as an `auth.User` row carrying `kind: 'agent'` — the platform's existing notion of a non-human principal (`packages/core/src/modules/auth/data/entities.ts`, `UserKind = 'human' | 'agent' | 'service'`). Consequences, all of them free:

- It has an id, so `CartLine.added_by_actor_id` and `AssistedSellingAttribution.actor_id` are populated exactly as for a rep.
- It has roles and features, so `cart.proposals.author` gates it through the same ACL as a human, and revoking it is a role change rather than a code change.
- It is tenant- and organization-scoped, so it cannot propose across a tenant boundary.
- Audit reads identically for both actor types.

A service account with no row, or an enum value with no identity, would have given up all four.

### 4.4 Buyer-scoped transport

**v1 is polling, and the polling contract is written to be the same contract the stream will carry**, so Phase 5 is a transport swap and not a model change:

```
GET /api/assisted_selling/storefront/thread/events?since=<cursor>
  X-Cart-Token: <basket token>            (+ customer session when the basket is identified)
  → 200 { cursor, changed: boolean, threadUpdatedAt, proposalIds: string[] }   ETag: "<cursor>"
  → 304 when If-None-Match (or since) names the current cursor
```

Release 5 ships this server contract only (D-R5-15, S25); how often a client polls is the integrator's, documented in §6.2, not implemented by this module. It carries no message body, no line, no price. The client re-reads `GET /thread` and `GET /api/cart/proposals` when `changed` is true. That is the platform's existing discipline, not a new rule: `useMessagesSse` never opens a connection and never reads a payload — it subscribes to an event id and refetches over HTTP — and both shipped SSE routes cap payloads at `MAX_PAYLOAD_BYTES = 4096`, replacing anything larger with a bare `{ truncated: true, id, entityId }`.

**Phase 5 adds a `storefrontBroadcast` flag and one endpoint**, mirroring the two bridges that exist:

| | backoffice | portal | storefront (new) |
|---|---|---|---|
| Flag | `clientBroadcast` | `portalBroadcast` | `storefrontBroadcast` |
| Endpoint | `/api/events/stream` | `/api/customer_accounts/portal/events/stream` | `/api/ecommerce/storefront/events/stream` |
| Credential | staff session | customer JWT (cookie or Bearer) | **cart token** |
| Audience key | tenant + org + user + roles | tenant + org + `customerUserId` | tenant + store + **basket cart id**, resolved from the cart token at connect |

Three findings shape that row and each of them is a reason the Portal Event Bridge is not simply reused:

1. **It requires an authenticated `CustomerUser`.** Assisted selling must reach a guest, who has none. Presenting the cart token is what makes the guest case work at all. For an identified basket the stream applies the same binding as every buyer route (D-R5-21): the token plus the matching customer session, otherwise nothing is delivered. The token authenticates the connection; the audience is the cart id it resolves to, so a token rotation (§5.1) ends the old credential's reach at its next reconnect without any re-keying.
2. **It lives in `customer_accounts`.** Putting a storefront transport there contradicts the roadmap's namespace ownership and couples a separate application to the portal's auth model.
3. **`portalConnections` is a process-local `Set`.** Any endpoint of this shape needs `crossProcessBroadcast` before it is correct on more than one instance. This is stated here because the new endpoint must not inherit the limitation by copying the file.

**The fallback is mandatory and must be a runtime fallback.** The brief's premise that `useMessagesSse`/`useMessagesPoll` are an SSE-with-fallback precedent does not hold: `useMessages` picks between them once, at module-evaluation time, on `typeof window.EventSource !== 'undefined'`, and the choice is frozen. That is adequate behind an authenticated admin shell, where an absent `EventSource` is the only realistic failure. It is not adequate in front of a CDN (`storefront-app.md` §3.3 + R1), where the transport is present in the browser and blocked or buffered in transit. The storefront client must degrade to polling **on connection failure and on heartbeat timeout**, and recover to streaming on a later attempt.

### 4.5 Client boundary

The rep console is a backoffice surface under `packages/core/src/modules/assisted_selling/backend/`, composed from `@open-mercato/ui/backend/{messages,detail}` and reached through the standard page-metadata guards. It introduces no new provider and no new client bootstrap. The buyer-facing surfaces live in `apps/storefront` and are governed by [`storefront-app.md`](./2026-08-14-storefront-app.md) §3.1–§3.3 and §9 — the full Frontend Architecture Contract for that application is that spec's, and duplicating its budgets here would create a second copy to drift. **Release 5 has no first-party storefront** (D-R5-15): the buyer half is the §6.2 API, consumed by an integrator's storefront, and the storefront tray (Phase 2 item 4) is out.

---

## 5) Data Models

Standard scoped columns throughout (`id`, `tenant_id`, `organization_id`, `created_at`, `updated_at`, `deleted_at`). Table prefix `assisted_selling_`, per roadmap §8. Every cross-module reference is an FK id resolved through DI; there is no ORM relation to `cart`, `customers`, `customer_accounts`, `auth` or `sales`.

### 5.1 `AssistedSellingThread` (`assisted_selling_threads`)

| Column | Type | Notes |
|---|---|---|
| `store_id` | uuid | `ecommerce.EcommerceStore.id` |
| `buyer_cart_id` | uuid | The basket this conversation is about; `cart.Cart.id` |
| `customer_id` | uuid, nullable | Set once the buyer is identified |
| `customer_user_id` | uuid, nullable | `customer_accounts.CustomerUser.id`; NULL for a guest |
| `status` | text | `open \| closed` |
| `mode_snapshot` | text | The store `mode` in force when the thread opened, so a later settings change does not rewrite history |
| `assigned_actor_id` | uuid, nullable | The `auth.User` currently owning the conversation in the console. Set on first rep join, reassignable |
| `live_proposal_count` | integer | Maintained by the proposal commands and the terminal-state subscriber (§6.6). Exists so the inbox's "awaiting the buyer" filter is an indexed predicate rather than a join across a second module's table |
| `last_activity_at` | timestamptz | Drives the console's inbox ordering and the idle sweeper |
| `closed_at` | timestamptz, nullable | |

`organization_id` is **inherited from the basket** when the thread opens, never taken from the request or from the opening principal's selected organization (S9): a staff open reads the cart through `cart`'s organization-scoped admin read (§6.1), a buyer open through `cartService.resolveBasketByToken`.

Indexes: unique `(tenant_id, buyer_cart_id)` **where `status = 'open'`** — one *open* conversation per basket, closed ones unconstrained, and also the buyer routes' lookup; `(tenant_id, store_id, status, last_activity_at)` and `(tenant_id, store_id, assigned_actor_id, status)` for the console inbox.

**The uniqueness is partial for a reason the re-point below makes unavoidable.** A guest can hold a thread on a guest basket while the account they are about to log into already holds one on its own basket. Re-pointing then collides. The policy: **the guest thread is closed**, its live proposals are marked `superseded` and their proposal carts rejected (§6.6), and a system message in both threads names the other. Nothing is deleted and nothing is silently merged — two conversations with two histories become one live conversation and one readable archive. Making the index total would have turned that case into a subscriber crash at exactly the moment R10 exists to protect.

**No token and no token hash (rev 2).** Rev 1 stored `hashAuthToken(cartToken)` on the thread as the buyer routes' lookup key. That made every token rotation a thread write, and one rotation had no event to drive it: in §7.1's "customer cart empty → adopt the guest cart" row the token rotates (`cart` §8.3) while no cart becomes `merged`, so the stored hash went stale and the buyer's next poll returned `404` — R10's failure by the one path its mitigation did not cover. Nor could a subscriber ever re-hash a rotated token: events are signals and must not carry the raw credential. So the thread stores neither. A buyer route resolves the `X-Cart-Token` header to its **basket** cart through `cart`'s DI service (`cartService.resolveBasketByToken`, `cart` §8.3 — `kind = 'basket'` only), applies the identified-buyer binding (§6.2, D-R5-21), then finds the thread by `tenant_id`, `organization_id` and `buyer_cart_id`. Rotation changes nothing here; only a change of cart id (a real merge) needs the subscriber below. The raw token still never reaches this module's tables, which is what R8 required of the hash.

**Cart lifecycle is not thread lifecycle.** A guest→customer merge moves the buyer to a different `Cart` row (`cart` §7). A subscriber on `cart.cart.merged` — **filtered to `kind = 'basket'`**, because a proposal acceptance also moves the *proposal* cart to `merged` (`cart` §7a.1) and that must not re-point anything — re-points `buyer_cart_id` from the payload's `sourceCartId` to `targetCartId` and populates `customer_id`/`customer_user_id` from it (`cart` §11 defines the payload). Adoption (`cart` §7.1, first row) keeps the cart id, so the thread needs only its identity columns: a subscriber on `cart.cart.adopted` populates them. **Both subscribers scope by the payload's `tenantId` and `organizationId` before they look at a cart id** (S3, D-R5-32): `cart` rev 10 adds those fields to `cart.cart.merged` and `.adopted`, and a lookup by cart id alone would cross tenants by construction. A payload without them is logged and ignored, never resolved unscoped. Without these the conversation would be stranded on a `merged` cart, or keep treating an identified buyer as a guest, at exactly the moment the buyer logged in — the moment a rep is most likely to be mid-sentence.

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

The `ai_agent` participant is created when the thread opens under a live `mode ∈ {ai, both}`, or by the worker before the first turn otherwise (§4.2), so the buyer's payload discloses the AI before any AI text exists. In Release 5 no store can be in those modes (§5.6), so no `ai_agent` participant is ever created; the enum value is reserved. `presence_state` and `presence_updated_at` ship with the table (nullable/default `absent`) and are written by nothing until Phase 5.

`display_name` is snapshotted rather than joined so a thread still renders after a rep leaves the company, and it is **encrypted** because it is a named natural person disclosed across a trust boundary — declared in `assisted_selling/encryption.ts` and read through `findWithDecryption`. What a buyer is shown is a policy question owned by the store, not a schema question: see §8.3.

**Encrypted means not searchable, and the console must not pretend otherwise.** No inbox filter, sort or free-text search runs against `display_name`; the console filters by `assigned_actor_id`, store, status and live-proposal count, all of them plain indexed columns. A "find the thread with Anna" affordance would require either decrypting every row per query or a searchable shadow of the plaintext, and the second is the control this column exists to apply, undone.

### 5.3 `AssistedSellingMessage` (`assisted_selling_messages`)

| Column | Type | Notes |
|---|---|---|
| `thread_id` | uuid | |
| `participant_id` | uuid | Author |
| `body` | text | **Encrypted at rest** |
| `body_format` | text | `text` — the only value in Release 5 (S24). Bodies reach third-party storefronts the platform does not render, so no format with markup is offered whose render rule the platform cannot enforce; a later format is an additive enum value with its own rendering contract |
| `proposal_id` | uuid, nullable | Set when this message is the one that carries a proposal. Its `body` is the authoring `note` (§6.3, S19), empty when none was given |
| `sent_at` | timestamptz | |
| `ai_input_flagged_at` | timestamptz, nullable | Buyer messages only. Set when input moderation refused the AI turn this message was folded into; the message is then excluded from every later turn's model input (§4.2, rev 4). Not shown to the buyer |
| `ai_read_by_turn_id` | uuid, nullable | Buyer messages only (rev 5). The `AssistedSellingAiTurn` that folded this message into its input, written in the transaction that closes that turn and only once input moderation ruled (§4.2). NULL means unread. Set once and never rewritten. Not shown to the buyer |

Indexes: `(tenant_id, thread_id, sent_at, id)` — the display order, and the order in which a turn folds its read set and lays out history; it is **not** a read position (§4.2, rev 5). Partial `(tenant_id, thread_id)` where `ai_read_by_turn_id IS NULL` — the unread lookup the worker and the follow-up check run.

**Release 5:** `ai_input_flagged_at` and `ai_read_by_turn_id` ship as nullable columns so Phase 3 needs no migration on a populated table (S10); nothing writes or reads them. The partial unread index is created in Phase 3, because while nothing marks a message it would index every row. `ai_read_by_turn_id` has no FK, so the absence of `assisted_selling_ai_turns` does not matter.

A turn's model input is then three predicates over this table, none of them positional: **unread** = `ai_read_by_turn_id IS NULL`; **history** = `ai_read_by_turn_id IS NOT NULL AND ai_input_flagged_at IS NULL`; **follow-up due** = any unread buyer message on the thread.

`body` is free text written by and about identifiable people and is declared in `defaultEncryptionMaps`. It is **not** indexed for search in this spec: a searchable conversation corpus is a separate decision with its own retention and disclosure consequences, and `search.ts` registration is deliberately absent rather than forgotten.

### 5.4 `AssistedSellingProposal` (`assisted_selling_proposals`)

The metadata row, not a line model. Lines, quantities, prices, promotion effects and totals live entirely on the `Cart` it points at.

| Column | Type | Notes |
|---|---|---|
| `thread_id` | uuid | |
| `proposal_cart_id` | uuid | The `Cart` with `kind: 'proposal'` |
| `target_cart_id` | uuid | Denormalized from `Cart.proposed_to_cart_id`, so the console can list by target without reaching into `cart` |
| `authored_by_actor_type` | text | `rep \| ai_agent` — a buyer cannot propose to themselves |
| `authored_by_actor_id` | uuid | `auth.User.id`. Non-nullable: an unattributable proposal is the defect R6 describes. For `ai_agent` it is the store's `ai_agent_user_id`, resolved on the server — including when a rep's confirm runs the handler (§4.2) |
| `approved_by_actor_id` | uuid, nullable | `auth.User.id` of the rep who confirmed the AI draft (§4.2); NULL when no approval step ran. Taken from the confirm route's `ctx.auth`, never from input |
| `status` | text | `published \| accepted \| rejected \| withdrawn \| expired \| superseded` |
| `published_at` | timestamptz, nullable | |
| `expires_at` | timestamptz | From the store's `proposal_ttl_seconds`, which this module passes to `cart.proposal.create` as `ttlSeconds` (S5) — `cart` reads no table of this module; mirrors the proposal cart's own `expires_at` |
| `idempotency_key` | text | From the authoring body (§6.3). Unique per thread (S23) |
| `request_digest` | text | Digest of the normalized authoring body, so a replayed key with a different body is detected (§6.3) |
| `resolved_at` | timestamptz, nullable | |
| `rejection_reason` | text, nullable | Buyer-supplied, optional. **Encrypted at rest** |
| `ai_pending_action_id` | uuid, nullable | Set only when the proposal was created by confirming an AI draft (§4.2). Always NULL in Release 5, like `approved_by_actor_id` |
| `superseded_by_proposal_id` | uuid, nullable | Set when re-authored (§6.4) |
| `merge_log_id` | uuid, nullable | `cart.CartMergeLog.id`, set on acceptance — so the trail runs in both directions. Never cleared: an accepted proposal cannot be un-merged (D-R5-25, §6.6) |

Indexes: unique `(tenant_id, proposal_cart_id)`; **unique `(tenant_id, thread_id, idempotency_key)`** (S23); `(tenant_id, target_cart_id, status)`; `(tenant_id, status, expires_at)` for the sweeper.

**Why this is not the `CartProposal*` family the brief rules out.** It has no lines, no prices and no totals; it cannot be read without `cart`; and removing it would not make the proposal cart unusable, only unattributable. It is the join between a conversation and a basket, and it lives on the conversation's side because `cart` has no inbound dependency.

**Status is richer than `Cart.status` on purpose, and no richer than that.** `Cart.status` stays exactly as spec 5 defines it — a rejected proposal cart is `abandoned`, the existing terminal non-converting state. *Why* it ended is a fact about a conversation, and six reasons here cost `cart` nothing.

There is deliberately **no `draft` and no `pending_rep_approval`**. Every path that creates a row creates it `published` (§6.3, §4.2): a proposal held for rep approval does not exist yet — it is an `AiPendingAction` — and a half-built proposal in the console builder is unsaved form state, not a row. Carrying either value would put a status in the model that no command can produce, which is exactly the defect §2.3 indicts one document over.

**Transitions.**

| From | To | Written by |
|---|---|---|
| — | `published` | §6.3 command (the only creation path) |
| `published` | `accepted` \| `rejected` \| `expired` | §6.6 subscriber, from `cart.proposal.*` |
| `published` | `withdrawn` \| `superseded` | §6.4 command, which also rejects the proposal cart |

No other transition exists. **Every status other than `published` is final, `accepted` included (rev 6, D-R5-25).** Rev 5 had an `accepted → published | expired` transition driven by `cart.proposal.acceptance_undone`. `cart` rev 10 refuses `/current/undo-merge` on a merge whose source is a proposal with `409 merge_undo_not_supported_for_proposal`; the buyer removes unwanted lines through the ordinary line routes, the proposal stays `accepted`, and attribution keeps its lines.

**`live_proposal_count` has one owner: the §6.6 subscriber.** It decrements on every transition out of `published` that `cart` reports — `.accepted`, `.rejected` (whether or not the local status is overwritten), `.expired`. The §6.3 command increments on creation. The §6.4 commands **never** touch the counter: a withdrawal or supersession always rejects the proposal cart, and the resulting `cart.proposal.rejected` is what decrements, exactly once. Two writers of one counter was rev 1's ambiguity (m1).

**Every terminal state is written by one subscriber, not by the route that caused it** — see §6.6. `accepted`, `rejected` and `expired` are decided inside `cart`, which by §7a.6 there does not know this module exists. `withdrawn` and `superseded` are the exception by construction: they are this module's own decisions, written by the §6.4 command that makes them.

### 5.5 `AssistedSellingAttribution` (`assisted_selling_attributions`)

Written once, at conversion, and never updated.

| Column | Type | Notes |
|---|---|---|
| `sales_order_id` | uuid, nullable | FK id, no ORM relation. Set for the order outcome |
| `sales_order_line_id` | uuid, nullable | Order outcome; NULL only in the degraded case of §6.7 |
| `sales_quote_id` | uuid, nullable | Set for the quote outcome (`request_quote`, D-R5-20, D-R5-26). A check constraint requires exactly one of `sales_order_id` and `sales_quote_id` |
| `sales_quote_line_id` | uuid, nullable | Quote outcome; NULL only in the degraded case of §6.7. Not re-linked when the quote later converts to an order (outside Release 5, D-R5-26) |
| `cart_id` / `cart_line_id` | uuid | Provenance |
| `actor_type` | text | `buyer \| rep \| ai_agent \| merge \| system` — mirrors `CartLine.added_by_actor_type` |
| `actor_id` | uuid, nullable | |
| `thread_id` / `proposal_id` | uuid, nullable | NULL for a line the buyer added themselves |
| `line_net_amount` / `line_gross_amount` | numeric(16,4) | Snapshot at conversion |
| `currency_code` | text | |
| `converted_at` | timestamptz | |

Indexes: unique `(tenant_id, sales_order_line_id)` where not null; unique `(tenant_id, sales_quote_line_id)` where not null; `(tenant_id, cart_id)` — the subscriber's redelivery guard: a `cart.cart.converted` for a cart that already has attribution rows writes nothing; `(tenant_id, actor_type, actor_id, converted_at)` for the commission report.

`actor_type` is never `ai_agent` in Release 5 (no AI author exists) and the value stays reserved. Like `CartLine.added_by_actor_type`, it can still be `merge` or `system` for lines `cart` itself created.

**Amounts are snapshotted rather than joined.** A commission report run six months later must not change because an order was credited, and reading live `sales` rows would make it do exactly that. This is the same reasoning `CartLine` already applies to `name` and `sku`.

### 5.6 `AssistedSellingStoreSettings` (`assisted_selling_store_settings`)

| Column | Type | Notes |
|---|---|---|
| `store_id` | uuid | Unique per `(tenant_id, organization_id, store_id)` |
| `mode` | text | `ai \| rep \| both \| off`, default `off`. **Release 5 validator accepts `rep \| off` only** (S10, D-R5-15); `ai` and `both` stay in the column's enum, reserved, so Phase 3 adds behaviour without a migration |
| `ai_proposals_require_rep_approval` | boolean | Default `false`. Phase 3; not exposed by the Release 5 route or page |
| `proposal_ttl_seconds` | integer | Default `259200` (72 h); bounded `3600`–`1209600`, the bounds of `cart.proposal.create`'s `ttlSeconds` (S5) |
| `max_proposal_lines` | integer | Default `50` |
| `ai_max_proposals_per_thread_per_hour` | integer | Default `4`. Counts published AI proposals **and** AI drafts awaiting approval (§6.5) |
| `ai_max_turns_per_thread_per_hour` | integer | Default `20`. Bounds model usage per conversation, whether or not a turn proposes anything (§4.2, R4) |
| `conversation_retention_days` | integer | Default `365`, counted from `closed_at` (§5.10, §11a Q4) |
| `idle_close_days` | integer | Default `30`. An open thread with no activity for this long is closed by the idle sweeper, which starts its retention clock (§5.10) |
| `ai_agent_user_id` | uuid, nullable | The `auth.User` with `kind: 'agent'` this store's agent runs as (§4.3). **Required by the settings validator when `mode ∈ {ai, both}`** — a store cannot enable an AI actor without naming the principal it acts as, because every attribution, ACL check and audit line depends on it |

**Release 5.** The `ai_*` columns ship with their defaults so Phase 3 is additive behaviour, not a migration; the Release 5 `PUT /settings/:storeId` validator is `.strict()` over `mode`, `proposal_ttl_seconds`, `max_proposal_lines`, `conversation_retention_days` and `idle_close_days`, so a body carrying an `ai_*` field is a `400`, and nothing reads those columns.

**`mode_snapshot` has one consumer and it is not enforcement.** Enforcement reads the **live** `mode` (§6.3, §8.4); the snapshot on the thread exists so the console and the audit can say which rules a past conversation ran under. A column with no reader is the same defect as a status no command produces, so its reader is named here rather than assumed.

**Not a subtree of `EcommerceStoreSettings`.** SPEC-029 §5.1.1 deleted `features.enableReviews` and `features.enableWishlist` on the stated grounds that "a settings flag for an unbuilt feature is dead configuration", and roadmap §8 forbids a child spec introducing entities under another module's prefix. A settings subtree in `ecommerce` for a module that may not be installed is both of those mistakes at once.

**How a storefront learns the mode — deferred (S12, D-R5-15).** Rev 5 exposed the effective mode on the store context through a `tryResolve` read in `ecommerce`. Release 5 has no first-party storefront and so no consumer for it, and it would be an `ecommerce` change made for nobody, so it is deferred to the release that ships Phase 2 item 4. In Release 5 a buyer client learns it from the buyer routes themselves: `POST /thread` answers `409 assisted_selling_unavailable` under `off` (an open thread stays usable, §8.4), and an absent module answers `404` on every buyer route. When the exposure lands, it is resolved with `tryResolve` so an absent module degrades to `off` — the soft-optional pattern root `AGENTS.md` requires for an optional peer.

### 5.7 Encryption

`assisted_selling/encryption.ts`:

```typescript
export const defaultEncryptionMaps = [
  { entityId: 'assisted_selling:message',     fields: [{ field: 'body' }] },
  { entityId: 'assisted_selling:participant', fields: [{ field: 'displayName' }] },
  { entityId: 'assisted_selling:proposal',    fields: [{ field: 'rejectionReason' }] },
]
```

All reads go through `findWithDecryption` / `findOneWithDecryption`. The thread holds no cart token in any form (§5.1), so there is nothing token-shaped to map. The authoring `note` needs no map entry of its own: it is stored only as the body of the proposal's message (§6.3 step 6, S19), and the proposal cart's own `note` stays empty.

### 5.8 `AssistedSellingAiDraft` (`assisted_selling_ai_drafts`)

> **Phase 3 — not created in Release 5 (D-R5-15).** §5.8 and §5.9 are Phase 3 tables; Release 5 migrations do not create them.

A join row, not a proposal state — present only while `aiProposalsRequireRepApproval` is `true` (§4.2).

| Column | Type | Notes |
|---|---|---|
| `thread_id` | uuid | |
| `ai_pending_action_id` | uuid | `ai_assistant.AiPendingAction.id`; FK id only |
| `expires_at` | timestamptz | Copied from the pending action, for the console's "expired — re-propose" state (§6.4) |
| `resolved_at` | timestamptz, nullable | Set by the subscriber on `ai.action.confirmed \| .cancelled \| .expired` (§4.2), or at insert for a `rate_limited` draft |
| `resolution` | text, nullable | `confirmed \| cancelled \| expired \| rate_limited` |

Unique `(tenant_id, ai_pending_action_id)`; index `(tenant_id, thread_id, resolved_at)`; index `(tenant_id, thread_id, created_at)` for the proposal limit (§6.5).

It exists because nothing else can answer "which AI drafts are waiting in this conversation": `AiPendingAction` has no list-by-conversation read and its repository is not exposed through DI, and giving this module a query against `ai_assistant`'s table would be the cross-module coupling root `AGENTS.md` forbids. It carries no lines and no price — the pending action holds the tool input, and the proposal does not exist until confirm — so it is not the `draft` status §5.4 refuses.

### 5.9 `AssistedSellingAiTurn` (`assisted_selling_ai_turns`)

One row per agent turn, inserted `queued` by the buyer-message subscriber (or by the previous turn's follow-up rule), moved to `running` by the worker before the model is called, and closed when the stream ends (§4.2).

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | Random v4. Doubles as the turn's capability: it is placed in this turn's system context only, and the tool's `turnId` must name it |
| `thread_id` | uuid | |
| `agent_id` | text | `assisted_selling.seller` or `assisted_selling.seller_reviewed`, chosen from the store flag when the turn moves to `running` |
| `agent_user_id` | uuid | The principal the turn runs as |
| `status` | text | `queued \| running \| finished \| failed` |
| `failure_reason` | text, nullable | `turn_limit \| budget \| moderation \| policy_misconfigured \| provider_error \| queue_lost` |
| `enqueue_attempts` | integer | Default `1`; incremented each time the sweep re-enqueues a stale `queued` row |
| `effective_max_wall_clock_ms` | integer, nullable | The loop budget in force after tenant runtime overrides, recorded at `running`; the handler's age check reads it (§4.2) |
| `queued_at` / `started_at` / `finished_at` | timestamptz | `started_at` NULL while `queued` |

Indexes: **partial unique `(tenant_id, thread_id)` where `status IN ('queued', 'running')`** — the "one turn per thread at a time" guarantee the queue cannot give (§4.2); `(tenant_id, thread_id, started_at)` for the per-thread turn cap. It is also what the turn cap reads, so it is not a table added only for binding.

A `running` row whose `started_at` is older than `effective_max_wall_clock_ms` plus a margin belongs to a worker that died; the next subscriber insert that collides with it, and a periodic sweep, close it `failed` (`provider_error`) so a crashed worker cannot hold a thread's AI silent forever. They close it through the same close-then-follow-up step the worker uses. The dead worker never committed its markers, so the sweep marks nothing and queues no follow-up; its read set is read by the next turn (§4.2, rev 5).

**A `queued` row can be orphaned too (rev 4).** The subscriber commits the `queued` insert and then enqueues the job — two systems, with no atomicity between them — so a failed enqueue, a process killed between the two steps, or a job lost by the queue strategy leaves a `queued` row that no worker will ever pick up, and every later buyer message collides with it and does nothing. The same two paths recover it: a `queued` row whose `queued_at` is older than a module constant (`AI_TURN_QUEUED_STALE_MS`, default 5 minutes — many multiples of normal queue latency) is **re-enqueued**, with `queued_at` refreshed and `enqueue_attempts` incremented. Redelivery is safe by construction: the worker's conditional `queued → running` update lets exactly one job start the turn, and any other job finds the row not `queued` and exits. After three attempts the row is closed `failed` (`queue_lost`), marking nothing, instead, so a queue that is down does not cause an enqueue storm; its unread messages are read by the turn the next buyer message triggers.

### 5.10 Retention and erasure (rev 3)

Threads, messages, participant names and rejection reasons are personal data (§5.3, §5.7), so this module closes, erases or anonymizes them on the triggers below rather than keeping them for as long as the database lives:

| Trigger | Action |
|---|---|
| **Idle.** An open thread with `last_activity_at` older than the store's `idle_close_days` | Closed by the `assisted-selling-idle-close` sweeper (the "idle sweeper" §5.1 names); its live proposals are left to expire on their own `expires_at` |
| **Retention.** A closed thread with `closed_at` older than `conversation_retention_days` | The `assisted-selling-retention` sweeper hard-deletes its messages, participants and — from Phase 3 — AI turns and AI drafts, clears `rejection_reason` on its proposals, and soft-deletes the thread. Proposal metadata rows and attributions survive — they carry ids and amounts, not text — so commission reporting is unaffected |
| **Basket purge.** `cart.cart.purged` for a `kind = 'basket'` cart | The thread keyed on it is closed and erased immediately by the same routine, whatever its age: a conversation about a basket that no longer exists must not outlive it |
| **Buyer deletion.** `customer_accounts.user.deleted` | Every thread with that `customer_user_id` is closed and erased by the same routine. Precedent: `communication_channels/subscribers/user-deleted-cascade.ts`, which cascades on `auth.user.deleted` the same way |
| **Staff deletion.** `auth.user.deleted` for a rep | The rep's participant rows keep their id but their `display_name` is replaced with a fixed label ("Former team member"), so the buyer's history still reads coherently without naming a person who has left |

Erasure is a subscriber plus a sweeper in this module, keyed on events other modules already emit; no other module learns that assisted selling exists. Every erasure subscriber resolves threads within the payload's `tenantId` (and `organizationId` where the payload carries one) before matching `buyer_cart_id`, `customer_user_id` or a participant `actor_id`, and is idempotent on redelivery: an already-erased thread is skipped. The sweepers run per tenant and organization. The retention period is an open question with a default (§11a Q4).

**Release 5 ships all of §5.10 together with the first route that stores text about a buyer** (S7, D-R5-15): the staff message route of Phase 1 and the buyer routes of Phase 2 item 1 do not ship without the two sweepers and the three erasure subscribers.

**Conversation text is sent to the LLM provider (Phase 3 only).** In `mode ∈ {ai, both}` the worker decrypts buyer, rep and AI messages and sends them to the tenant's configured model provider for every turn (§4.2). That is a disclosure the store's privacy copy must make, and the storefront's AI disclosure (§4.2, `storefront-app.md` §5.10) links to it. Stores that cannot make it set `mode` to `rep` or `off`. Nothing is sent to a provider in those modes, and so nothing at all in Release 5.

---

## 6) API Contracts

Zod validators in `data/validators.ts`, types via `z.infer`. Every mutating route is a registered command with `withAtomicFlush` and post-commit side effects, per root `AGENTS.md`, and every custom write route runs the mutation guard registry (`runMutationGuards`) before its command. Every user-editable entity carries `updated_at` optimistic locking. Every route file exports `openApi`.

**Route prefix (rev 6, S4).** The module router derives `/api/<module_id>/<api subpath>` from the module id, so every route of this module lives under **`/api/assisted_selling/`** — the same shape as the shipped `/api/cart/current` and `/api/customer_groups/customer-groups/...`. Rev 5's `/api/assisted-selling/...` could not be produced by the router and is withdrawn everywhere in this spec.

### 6.1 Staff — `/api/assisted_selling/*`

`requireAuth`; features below. Reachable only by `auth.User` principals: human staff and API keys in Release 5, plus `kind: 'agent'` principals from Phase 3. **Every feature check goes through `rbacService.userHasAllFeatures(userId, features, { tenantId, organizationId })`** (S21) — declaratively through `requireFeatures` in route metadata, and in the handler wherever a second feature or a per-record check applies — so wildcard grants such as `assisted_selling.*` and `cart.*` match. A raw `features.includes(...)` comparison is a defect.

Paths below are relative to `/api/assisted_selling`.

| Method | Path | Feature | Purpose |
|---|---|---|---|
| GET | `/threads` | `assisted_selling.threads.view` | Console inbox; filter by store, status, `assigned_actor_id`, `live_proposal_count > 0`. **Not** by participant name — §5.2. Restricted to the caller's `organizationIds` (S9); `pageSize` ≤ 100 |
| GET | `/threads/:id` | `assisted_selling.threads.view` **+ `cart.proposals.view`** | Thread with participants, messages and proposals; `404` outside the caller's organizations |
| POST | `/threads` | `assisted_selling.threads.participate` + `cart.carts.view` | **Staff opens a conversation about a basket**, by cart id. Subject to the live `mode`. The cart is read through `cart`'s organization-scoped admin detail read (S9, below) |
| POST | `/threads/:id/join` | `assisted_selling.threads.participate` | Adds a `rep` participant. **Visible to the buyer immediately** (§8.3) |
| POST | `/threads/:id/leave` | `assisted_selling.threads.participate` | |
| POST | `/threads/:id/assign` | `assisted_selling.threads.participate` | Sets `assigned_actor_id`. Optimistic-locked on the thread's `updated_at`: two reps claiming the same conversation get one success and one `409`, never a silent last-write-wins |
| POST | `/threads/:id/messages` | `assisted_selling.messages.post` | `body_format: 'text'` only (S24) |
| POST | `/threads/:id/proposals` | `assisted_selling.proposals.author` + `cart.proposals.author` | Authors a proposal; wraps `cart.proposal.create` (§6.3) |
| POST | `/proposals/:id/withdraw` | `assisted_selling.proposals.author` | Withdraws before acceptance. **Also rejects the proposal cart** — §6.4 |
| POST | `/proposals/:id/reauthor` | `assisted_selling.proposals.author` + `cart.proposals.author` | New proposal from an expired, rejected, withdrawn or superseded one's lines, freshly priced (§6.4) |
| GET | `/attributions` | `assisted_selling.attributions.view` | Commission report read; filter by actor, period, store, outcome (order or quote); `pageSize` ≤ 100 |
| GET | `/settings/:storeId` | `assisted_selling.settings.manage` | Returns the store's settings with defaults when no row exists; `404` for a store outside the caller's organizations |
| PUT | `/settings/:storeId` | `assisted_selling.settings.manage` | Upserts; `mode` limited to `rep \| off` in Release 5 (§5.6); optimistic-locked on `updated_at` |

Every path with `:id` resolves the record within the caller's tenant and `organizationIds` and answers `404` otherwise, the same body as a nonexistent id.

**Organization scoping of a staff open (rev 6, S9).** `cart.carts.view` alone does not check the caller's organization scope. `POST /threads` therefore reads the basket through `cart`'s admin detail read — the same read `GET /api/cart/carts/:id` serves (K6), scoped to the caller's `organizationIds` — and answers `404` when it finds nothing, so a rep in organization A cannot open a thread on organization B's basket within one tenant. The thread inherits the cart's `organization_id` (§5.1). The console reads the buyer's basket for display through the same `GET /api/cart/carts/:id`.

**Staff can start a conversation, and the feature is close to useless if they cannot.** §1's motivating case — the rep who knows the 100-unit tier is four units away — is by construction one the buyer has not asked about. `POST /threads` takes a cart id the principal can already see under `cart.carts.view` within its own organizations, creates the thread, adds the rep as a participant and posts an opening message. The buyer's very next read shows all three, because §8.3 and R3 make a rep's presence non-suppressible: a staff-opened conversation is visible to the buyer from its first moment, exactly as a buyer-opened one is. There is no silent observation mode, and adding one would need a different spec and a different lawful basis. Release 5 ships this together with the buyer routes of §6.2 (S6): without a buyer-facing read, a staff-opened thread would be exactly the silent observation this paragraph forbids. When the basket already has an open thread, `POST /threads` creates nothing and answers `409 thread_already_open` with that thread's id, so the console navigates to it; only a `kind = 'basket'` cart in `active` status can be opened on (`409 cart_not_active` otherwise).

**Reading a thread requires `cart.proposals.view`, not only this module's feature.** `GET /threads/:id` returns proposals carrying the buyer's resolved unit prices and their `price_row_id` provenance (§7.2) — that is `cart`'s gated data, and serving it under a weaker local feature would undo the two-feature discipline this section defends one paragraph below.

Authoring requires **both** features by design: `assisted_selling.proposals.author` says a principal may participate in selling conversations, `cart.proposals.author` says it may put a priced basket in front of a buyer. Granting one without the other is a meaningful configuration — a rep who may converse but not propose — and collapsing them into one would remove it.

**There is no `publish` route.** A proposal is created published (§4.2, §5.4); a rep confirming the AI's preview card is the only approval step there is.

### 6.2 Buyer — `/api/assisted_selling/storefront/*`

Public, **cart-token bound**, rate limited per IP and per token. No ACL feature: the token holder is the buyer acting in their own conversation, and a guest has no ACL identity.

**Credential (rev 6, S8).** The token is the `X-Cart-Token` header and nothing else (`CART_TOKEN_HEADER`, `cart` §8.3, D-R4-6) — never a cookie and never a path segment. The platform reads no cookie for it; an integrator's storefront forwards the header. A request without the header, or with a token that resolves to no `kind = 'basket'` cart in the request's tenant, answers `404` with the unknown-resource body.

**Identified-buyer binding (rev 6, D-R5-13, D-R5-21).** When the resolved basket has `customer_user_id`, every route in this table additionally requires the customer session — `customer_accounts`' `getCustomerAuthFromRequest`, customer JWT as cookie or `Bearer` — whose `customerUserId` equals the basket's. Without it, or with another buyer's session, the route answers `404` with exactly the body of an unknown cart, so a token alone cannot tell an identified basket from a missing one. Guest baskets stay token-only. This is the same rule `cart` rev 10 applies to every `/api/cart/current/*` and `/api/cart/proposals/*` route, so the cart's own identity rewrite cannot bypass it (X1). The check runs before any thread lookup; a buyer route never reveals whether a thread exists for a basket it is not entitled to.

Paths below are relative to `/api/assisted_selling/storefront`.

| Method | Path | Limit (per IP and per token) | Purpose |
|---|---|---|---|
| GET | `/thread` | 120/min | The open thread for this basket with participants, messages (`text`) and proposal ids; `404` when none exists |
| POST | `/thread` | 10/min | Buyer opens a conversation; refused with `409 assisted_selling_unavailable` when the live `mode` is `off`. When the basket already has an open thread, returns it with `200` and creates nothing |
| POST | `/thread/messages` | 30/min | Posts a buyer message (`body_format: 'text'` only, S24); `404` when the basket has no open thread |
| GET | `/thread/events?since=` | 240/min | Change signal, contract below. `304` when current |

A rate-limited request answers `429` with `Retry-After`.

Proposal read, preview, accept and reject are **not here** — they are `GET /api/cart/proposals` and `POST /api/cart/proposals/:id/{preview,accept,reject}` (`cart` §10), addressed by proposal id under the buyer's own `X-Cart-Token` (plus the customer session for an identified basket, D-R5-13), because they are cart operations on the buyer's own basket. Giving this module a second way to mutate a cart would defeat the seam.

**`GET /thread/events` server contract (rev 6, S25).** It returns a signal, never content:

```typescript
{ cursor: string; changed: boolean; threadUpdatedAt: string; proposalIds: string[] }
```

- `cursor` is opaque to the client. It encodes the thread's `updated_at`, which every message, participant change and proposal status change on the thread advances.
- `changed` is `true` when `since` is absent or older than the current cursor. `proposalIds` lists the thread's proposals whose status changed after `since` (all of the thread's proposals when `since` is absent), so the client knows which `GET /api/cart/proposals` entries to re-read.
- The response carries `ETag: "<cursor>"` and `Cache-Control: private, no-cache`. A request whose `If-None-Match` or `since` names the current cursor answers **`304`** with no body, before any message or proposal read — the cheap path is one indexed thread read.
- No message body, line, price, participant name or proposal content ever appears in it, asserted against the response shape (§10).
- With no open thread it answers `404`, like `GET /thread`, so a client that has no thread polls nothing.

**Client cadence is the integrator's, not this module's (S25).** Release 5 implements no polling client. The documented recommendation for integrators: 5 s while the page is visible and a `rep` participant is present, 30 s while visible otherwise, suspended while hidden, backing off to 120 s after a run of unchanged responses, with jitter on every schedule, always sending `If-None-Match`. Behind a CDN this is the difference between a cheap request and a rendered one (R7). The per-token rate limit is what the server enforces regardless of the client.

### 6.3 Authoring a proposal

```
POST /api/assisted_selling/threads/:id/proposals
{
  lines: [{ productId, variantId?, quantity, configuration? }],   // 1 … max_proposal_lines
  note?: string,                                                   // plain text, ≤ 2000 chars
  idempotencyKey: string                                           // 8 … 128 chars
}
→ 201 { proposalId, proposalCartId, messageId, expiresAt, rejectedLines: [{ productId, variantId, reason }] }
→ 200 the original 201 body, when the same idempotencyKey is replayed with the same body
```

**Idempotency (rev 6, S23).** `cart`'s `CartIdempotencyKey` is keyed per cart, and the proposal cart does not exist yet when the call arrives, so this module owns the key: `AssistedSellingProposal.idempotency_key` with a unique `(tenant_id, thread_id, idempotency_key)` index and the normalized body's `request_digest`. The lookup runs first, before the mode check and before any `cart` call: a replay with the same digest returns the original result with `200` and creates nothing; a replay with a different digest answers `409 idempotency_key_mismatch`. Two concurrent first calls with one key both reach the insert; the unique index lets one commit, and the other's transaction — including the proposal cart `cart.proposal.create` created inside it — rolls back and it then answers as a replay. A double-submitted authoring call therefore never produces two proposal carts.

There is **no `assortmentScope` in the body** (rev 2). Rev 1 carried one, which let the author — and, through the tool's input schema, the LLM — choose the buyer's assortment. That contradicted step 2's own rule that the author's context is passed nowhere, and removed the first of R2's two controls. The body is validated with `.strict()`, so a request that still sends the field is a `400`, not a silently ignored value.

The command:

0. **Checks the live `mode`** against the authoring actor: `rep` requires `mode ∈ {rep, both}`, `ai_agent` requires `mode ∈ {ai, both}`, and `off` refuses both with `409 assisted_selling_unavailable`. In Release 5 the only reachable values are `rep` and `off`, so a rep authors under `rep` and nobody under `off`. The same check gates `POST /threads` and `/threads/:id/join`. It reads the store's current setting, not `mode_snapshot` — turning the AI off must stop it proposing into conversations that are already open, which is the whole point of turning it off. Already-published proposals and already-joined participants are untouched (§8.4).
1. Resolves the thread (tenant and `organizationIds` scoped, `status = 'open'`, else `404`) and its `buyer_cart_id`. Checks `lines.length ≤ max_proposal_lines` (`400` otherwise, §8.9).
2. **Resolves the target buyer on the server (rev 6, D-R5-22).** It reads the target basket's `store_id`, `channel`, `customer_id` and `customer_user_id` through `cart`'s DI read, and calls SPEC-029's `storeContextService.resolveForBuyer({ tenantId, organizationId, storeId, customerUserId, customerId })`, resolved with `tryResolve`. **This module always passes `storeId`** — the thread's `store_id`, which must equal the basket's — so the result carries the `assortmentScope` together with `customerIds` (person and company), `customerGroupIds`, `priceKindId`, `taxMode`, `currencyCode` and `buyerDigest`. The method is in-process only, never cached under the buyer's own 60 s key, and refuses a store outside the tenant. A guest target (`customerUserId` and `customerId` null) resolves the store's anonymous scope, exactly as the buyer's own anonymous request would. SPEC-029 owns the contract (Release 5 revision); §11's hard dependency records it. **Fail closed:** if `ecommerce` is absent, the method is missing, or the call fails for a storefront-channel target, authoring is refused with `503 assortment_scope_unavailable` and nothing is created.
3. Calls `cart.proposal.create` with the **target cart's id**, that scope, and `ttlSeconds` = the store's `proposal_ttl_seconds` (S5). The id, not the raw token: this module holds no token (§5.1), and a server caller has no business handling a buyer's credential. No promotion code is passed — `cart.proposal.create` has no code input in Release 5 (S14). Pricing as the buyer rather than the author is `cart`'s rule (§7a.2 there, R1 below), using `catalogBuyerPricingService` under the target's context. The authoring principal's own context is passed nowhere.
4. **Reports rejected lines (S13).** `cart.proposal.create` runs the §6a.1b visibility check against the resolved scope and emits `cart.line.visibility_rejected` with `triggeredBy: 'proposal_create'` for each line it refuses. The command returns those lines in `rejectedLines` — the author sees what did not make it, nothing is silently dropped. When every line is rejected, no proposal is created: the transaction rolls back and the route answers `422 proposal_has_no_lines` with the rejected lines.
5. Writes an `AssistedSellingProposal` with `authored_by_actor_*` taken from `ctx.auth` — **never** from the request body (R6) — plus `idempotency_key` and `request_digest`. In the AI path (Phase 3) `ctx.auth` is the agent principal even when a rep's confirm triggered the handler (§4.2); the rep goes in `approved_by_actor_id`.
6. Sets `status: 'published'` and increments `live_proposal_count`. There is no other status it could take: with rep approval on, this command runs only after a rep confirmed the preview card; with it off, the buyer is the approver (§4.2).
7. Posts an `AssistedSellingMessage` carrying `proposal_id`, so the proposal appears in the conversation rather than beside it. **Its `body` is the authoring `note`** (rev 6, S19), encrypted like every message body (§5.7), and empty when no note was given. The note is never written to the proposal cart's `note` column, which stays empty.
8. Emits `assisted_selling.proposal.published` after commit, with `tenantId` and `organizationId` in the payload (D-R5-32).

The scope resolved in step 2 is the **authoring-time** control. It is not the binding one: `cart` re-checks every line against the buyer's scope at `preview` and again at the merge boundary (§6a.5 there), each time taking the scope from the buyer's own storefront request — so a scope that narrowed after authoring is still enforced, and neither check trusts a value this module supplied.

### 6.4 Ending a proposal from this side: withdraw, supersede, re-author

**A status change here is never enough on its own.** `cart` decides whether a proposal can still be accepted, and it decides it from the proposal *cart*'s status (`cart` §7a.1) — it does not read this module's rows and by §7a.6 there it does not know they exist. So `POST /proposals/:id/withdraw` and any supersession MUST invoke `cart.proposal.reject` in the same command, inside the same atomic flush, before writing the local status. Neither touches `live_proposal_count`; the `cart.proposal.rejected` that follows decrements it (§5.4).

Without that, a rep withdrawing a mispriced suggestion changes a row nobody consults: the proposal cart stays `active`, the buyer's tray still shows it, its `preview` still succeeds, and the merge succeeds. That is the sharpest version of the failure this whole spec exists to avoid — a price the buyer accepts that the seller had already retracted.

`POST /proposals/:id/reauthor` creates a **new** proposal cart from the old one's lines, freshly priced against the target's current context, sets `superseded_by_proposal_id` on the old row, and — when the old proposal is not already terminal — rejects its cart by the same rule. It is the path for an expired, rejected, withdrawn or superseded proposal — the last covering §8.1's fallback, where a proposal was superseded with no successor and `superseded_by_proposal_id` is still NULL — and the path §8.1 uses instead of mutating `proposed_to_cart_id`.

**Route contracts (rev 6).**

- `POST /api/assisted_selling/proposals/:id/withdraw` — body `{ updatedAt? }` (or the standard optimistic-lock header). Only a `published` proposal can be withdrawn; any other status answers `409 proposal_not_live` with the current status. Emits `assisted_selling.proposal.withdrawn`.
- `POST /api/assisted_selling/proposals/:id/reauthor` — body `{ idempotencyKey, note? }`. Runs §6.3 in full for the **caller** (mode check, `resolveForBuyer`, `cart.proposal.create` with `ttlSeconds`, rejected-line report, the same idempotency rule and response shape), with the old proposal cart's lines as input. An `accepted` proposal answers `409 proposal_already_accepted`: its lines are in the buyer's basket and cannot come back out through this module (D-R5-25). Emits `assisted_selling.proposal.superseded` for the old row when it was still `published`, and `.published` for the new one.

Release 5 has no AI drafts, so the paragraph below applies from Phase 3.

This is also the answer to the `AiPendingAction` TTL. That plane expires a pending action after `AI_PENDING_ACTION_DEFAULT_TTL_SECONDS = 900` — fifteen minutes, sized for an employee watching a chat stream, not for a rep who stepped into a call. Rather than raise a platform-wide env var that governs every pending action in the system, an expired AI draft surfaces in the console as "expired — re-propose", and the one click re-authors it. Fifteen minutes later a fresh price is what the buyer should be shown anyway.

### 6.5 The AI tool

> **Phase 3 — not in Release 5 (D-R5-15).**

```typescript
defineAiTool({
  name: 'assisted_selling.propose_cart_lines',
  displayName: 'Propose lines to the buyer',
  inputSchema: proposeCartLinesInput,
  requiredFeatures: ['assisted_selling.proposals.author', 'cart.proposals.author'],
  tags: ['write', 'assisted-selling'],
  isMutation: true,
  isDestructive: false,
  isBulk: true,
  loadBeforeRecords: async (input, ctx) => /* per-line before-state for the preview card */,
  handler: async (input, ctx) => /* delegates to the §6.3 command */,
})
```

`isMutation: true` and `isDestructive: false` (§4.2): under the declared `confirm-required` every call becomes an `AiPendingAction`; under `assisted_selling.seller`'s declared `destructive-confirm-required` the non-destructive call runs directly. The input schema carries lines, quantities, configuration, a note and the `turnId` — **no** assortment scope, author, approver, thread or target cart. The handler derives the thread from the turn (or, on confirm, from the draft row), and everything else from the thread and the store's settings (§4.2).

Both agent declarations (§4.2) carry `readOnly: false`, `untrustedInput: true`, the same `requiredFeatures`, and loop controls using the shapes that exist:

```typescript
loop: {
  maxSteps: 6,
  budget: { maxToolCalls: 4, maxWallClockMs: 20_000, maxTokens: 30_000 },
  stopWhen: [{ kind: 'hasToolCall', toolName: 'assisted_selling.propose_cart_lines' }],
}
```

plus two per-thread limits, each with one enforcement point (rev 3 — rev 2 said both that the turns table feeds the hourly limit and that the command enforces it):

- **`ai_max_turns_per_thread_per_hour`** bounds model usage. The worker enforces it against `AssistedSellingAiTurn` before a turn runs (§4.2).
- **`ai_max_proposals_per_thread_per_hour`** bounds what reaches a rep or a buyer. It counts, for the thread and the last hour, AI-authored `AssistedSellingProposal` rows **plus** `AssistedSellingAiDraft` rows not resolved as `cancelled` or `rate_limited` — so drafts awaiting approval count. It is enforced by the **tool handler**, not the §6.3 command, because the command also serves reps and the limit is the AI's: on the direct path the handler refuses the call with `ai_proposal_limit`; on the confirm path it refuses the same way, so a rep cannot confirm a draft past the cap. With rep approval on, the handler does not run when the draft is created — `prepareMutation` creates the pending action without invoking it — so the worker applies the same count when it writes each §5.8 row after the stream drains, and writes a draft over the cap with `resolution: 'rate_limited'` and `resolved_at` set: it never appears in the console and its pending action simply expires.

`loop.budget` bounds one turn, the turn cap bounds model usage per conversation, the proposal cap bounds what is shown, and none substitutes for another (R4). **The per-turn budget is not fixed by this declaration:** a tenant runtime override can raise `loopMaxSteps`, `loopMaxToolCalls`, `loopMaxWallClockMs` and `loopMaxTokens` (`AiAgentRuntimeOverrideRepository.ts:15-23`), so the effective per-turn cost is an operator decision, and the worker records the effective wall-clock budget on the turn row (§5.9).

The agent sets `untrustedInput: true`. Buyer-authored message text reaches the model, which is the case the `untrustedInput` field documents as "a customer portal or public-widget surface" (`ai-agent-definition.ts`) and for which `moderation-policy.ts` forces input moderation to `enforced`. No shipped agent sets it today; this one must.

### 6.6 Terminal states are written by a subscriber

Acceptance, rejection and expiry are all decided inside `cart` — by `cart.proposal.accept`, `cart.proposal.reject` and the `expire-carts` sweeper. `cart` has no inbound dependency and never writes here. So this module learns of them the only way it can, and the only way root `AGENTS.md` permits across a module boundary: a subscriber.

An `assisted_selling` subscriber on `cart.proposal.accepted | .rejected | .expired` (`cart` §11) resolves the local row by the payload's `tenantId` and `organizationId` first, then `proposal_cart_id` (S3, D-R5-32; a payload without scope is logged and ignored), and writes:

| Event | Writes |
|---|---|
| `.accepted` | `status: 'accepted'`, `resolved_at`, `merge_log_id` from the event's `mergeLogId`, decrements `AssistedSellingThread.live_proposal_count` |
| `.rejected` | `status: 'rejected'` **unless already `withdrawn` or `superseded`** — those are this module's own terminal states and the cart rejection they themselves caused must not overwrite them — plus `resolved_at` and the decrement |
| `.expired` | `status: 'expired'`, `resolved_at`, decrement |

**No undo of an acceptance (rev 6, D-R5-25).** Rev 2–5 also subscribed to `cart.proposal.acceptance_undone` and reopened the proposal. `cart` rev 10 refuses `POST /api/cart/current/undo-merge` for a merge whose source is a proposal with `409 merge_undo_not_supported_for_proposal`, so that event is never emitted for an acceptance, this module does not subscribe to it, and `accepted` is final (§5.4). A buyer who regrets an accepted line removes it through the ordinary line routes; the proposal stays `accepted`, and every line the buyer keeps is attributed to its author at conversion (§6.7).

Then it emits `assisted_selling.proposal.accepted | .rejected | .expired` (§6.8), which is what the rep console reacts to. Three of the events §6.8 declares have no other emitter: without this subscriber the central artifact of the spec would never be marked accepted, `merge_log_id` would never be populated — despite §5.4 keeping it "so the trail runs in both directions" — and the console would never learn the buyer decided.

It is idempotent on `proposal_cart_id` plus target status, because an event bus may redeliver and a proposal must not be resolved twice.

### 6.7 Attribution at conversion

A subscriber on `cart.cart.converted` writes one `AssistedSellingAttribution` per cart line. The **actor** comes straight off the line: `added_by_actor_type`/`_id` survive a merge unrewritten (`cart` §14 asserts it), so the half that matters to commission needs no join at all.

The **conversation** half does, and `CartLine` carries no source-cart column. It resolves through the merge log: `CartMergeLog.proposal_cart_id` (`cart` §4.4) names the proposal, and `CartMergeLog.outcome` maps each source line to the target line it became — a shape `cart` rev 7 fixes for exactly this consumer, because rev 6 described `outcome` only as "per-line disposition and reason" and a disposition without a target line id cannot be joined to anything. The path is `target cart line → outcome entry → proposal_cart_id → AssistedSellingProposal → thread_id`. A line the buyer added themselves appears in no merge log and takes NULL for both, which is correct rather than degraded.

**The payload (rev 6, D-R5-16, D-R5-26).** `cart.markConverted` accepts, and `cart.cart.converted` carries, `{ cartId, tenantId, organizationId, checkoutSessionId, salesOrderId?, salesQuoteId?, lineMap?: Array<{ cartLineId; salesOrderLineId?; salesQuoteLineId? }> }` (`cart` rev 10 §11, K8). Checkout B.4 passes `salesOrderId` + `lineMap` with `salesOrderLineId` for the order outcome, and `salesQuoteId` + `lineMap` with `salesQuoteLineId` for the `request_quote` outcome (D-R5-20). **`lineMap` is mandatory in Release 5**; checkout's pre-implementation analysis verifies it.

The subscriber scopes by the payload's `tenantId` and `organizationId`, skips a cart that already has attribution rows (redelivery, §5.5), and writes one row per cart line:
- **order outcome** — `sales_order_id` and `sales_order_line_id` from the map;
- **quote outcome** — `sales_quote_id` and `sales_quote_line_id` from the map. When the merchant later converts the quote to an order, nothing is re-linked in Release 5 (D-R5-26); the commission report shows the quote.

**Degraded path, a safety net only.** Where `lineMap` is absent or does not cover a line, the subscriber degrades to document-level attribution — the line id NULL, amounts summed per actor — and emits `assisted_selling.attribution.degraded` so the gap is visible rather than silent. With D-R5-16 this is not the expected Release 5 behaviour, and §10 asserts that a normal checkout conversion produces no `degraded` event. It never infers the mapping from product identity: a cart may legitimately hold two lines of the same product with different `configuration_hash`, and a guess there would misattribute money.

### 6.8 Events

```typescript
'assisted_selling.thread.opened' | '.closed'
'assisted_selling.participant.joined' | '.left'
'assisted_selling.message.posted'
'assisted_selling.proposal.published' | '.accepted' | '.rejected' | '.withdrawn' | '.superseded' | '.expired'
'assisted_selling.attribution.degraded'      // operator-facing, §6.7
```

`.superseded` is emitted by the §6.4 command (m2 — rev 1 had the status and no event, so the console never learned of a supersession). Rev 2–5's `.reopened` is **removed** in rev 6: it existed only for an undone acceptance, which D-R5-25 refuses (§6.6). The module is unshipped, so removing the id breaks nothing.

**Every payload carries `tenantId` and `organizationId`** (D-R5-32), plus the ids it is about (`threadId`, and `proposalId`/`participantId`/`messageId` where relevant). No payload carries a message body, a display name, a line or a price; listeners re-read through the API.

`clientBroadcast: true` on thread, participant, message and proposal events so the rep console updates without polling — the console is a backoffice surface and the backoffice bridge already carries it. `storefrontBroadcast: true` on the same set from Phase 5 (not Release 5).

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

Admin-facing namespace only. There is deliberately **no** `portal.*` feature: the buyer's half is cart-token bound so that a guest reaches it, and the flat `portal.<resource>.<action>` namespace spec 9 §8.1 established presumes an authenticated `CustomerUser`. Adding one would make assisted selling logged-in-only by the back door. The identified-buyer binding of §6.2 is an identity match, not a feature check, so it adds no portal feature either.

**Grants (`setup.ts`, rev 6).** `admin` gets `assisted_selling.*`. `employee` gets `assisted_selling.threads.view`, `.threads.participate` and `.messages.post`; `assisted_selling.proposals.author`, `.attributions.view` and `.settings.manage` stay with `admin` or are granted by hand to the reps who sell — the least-privilege line D-R5-7 and D-R5-34 draw. Authoring additionally needs `cart.proposals.author` (and reading a thread `cart.proposals.view`), granted through `cart`. Existing tenants need `yarn mercato auth sync-role-acls` (S20). Every check is wildcard-aware through `rbacService` (§6.1, S21).

### 6.10 Error codes (rev 6)

| Status | Code | Where |
|---|---|---|
| `400` | validation error (zod field errors) | Any body; includes `assortmentScope` sent to authoring, more than `max_proposal_lines`, `body_format` other than `text`, `mode` other than `rep \| off` in Release 5, any `ai_*` settings field |
| `401` | — | Staff routes without a principal; `POST /threads/:id/proposals` presented with only a cart token (R9) |
| `403` | — | Missing feature (wildcard-aware) |
| `404` | unknown-resource body | Record outside the caller's tenant or organizations; buyer route with no/unknown `X-Cart-Token`; **identified basket without the matching customer session (D-R5-13, D-R5-21)**; no open thread for the basket |
| `409` | `assisted_selling_unavailable` | Live `mode` refuses the actor: opening, joining, authoring, re-authoring; buyer `POST /thread` under `off` |
| `409` | `thread_already_open` | Staff `POST /threads` on a basket with an open thread (body carries its id) |
| `409` | `cart_not_active` | Staff `POST /threads` on a cart that is not an `active` basket (`cart`'s code, passed through) |
| `409` | `proposal_not_live` | Withdraw of a proposal that is not `published` |
| `409` | `proposal_already_accepted` | Re-author of an `accepted` proposal (D-R5-25) |
| `409` | `idempotency_key_mismatch` | Authoring or re-author key replayed with a different body (S23) |
| `409` | optimistic-lock conflict (platform body) | `assign`, `withdraw`, `PUT /settings/:storeId` |
| `422` | `proposal_empty` | Passed through from `cart.proposal.create` (cart §15a): every authoring line rejected by the visibility check (S13) |
| `429` | — | Buyer route rate limit, with `Retry-After` |
| `503` | `assortment_scope_unavailable` | `resolveForBuyer` absent or failing for a storefront-channel target (§6.3 step 2) |

Phase 3 adds `ai_proposal_limit` (§6.5).

---

## 7) UI/UX

The buyer-facing surfaces are specified in [`storefront-app.md`](./2026-08-14-storefront-app.md) §5.9–§5.10, §11 R11–R13, §12 and §16 Epic G — that spec owns the storefront's components, budgets and accessibility gates, and duplicating them here would create a second copy to drift. This section covers the rep console only. Release 5 ships no storefront UI (D-R5-15).

**Release 5 console scope (D-R5-15, owner choice (a)) — the full console:**
- **Inbox** (`/backend/assisted-selling`): `DataTable` over `GET /threads` with filters for store, status, assignee ("mine", "unassigned", a named rep) and "awaiting the buyer" (`live_proposal_count > 0`), ordered by `last_activity_at`; row actions open, assign to me.
- **Thread page** (`/backend/assisted-selling/threads/[id]`): participants, timeline of messages and proposal cards, the buyer's basket summary read through `GET /api/cart/carts/:id`, join/leave/assign, and per proposal its status from the server, withdraw and re-author.
- **Composer**: plain-text messages (`text` only, S24).
- **Proposal builder**: lines (product, variant, quantity, configuration) up to `max_proposal_lines`, an optional note, submitted with a client-generated `idempotencyKey` reused on retry. After submit it shows `rejectedLines` (S13) and the created proposal **priced as the buyer**, each line with its `price_row_id` provenance (§7.2).
- **Settings page** (`/backend/assisted-selling/settings`): per store `mode` (`rep \| off`), proposal TTL, max lines, retention and idle-close days, through `CrudForm` with optimistic locking.
- **Attribution report** (Phase 4): `DataTable` over `GET /attributions` with actor, period, store and outcome filters.

Not in Release 5: the AI draft list (Phase 3), presence (Phase 5).

### 7.1 The rep console is assembled, not built

Under `packages/core/src/modules/assisted_selling/backend/assisted-selling/`, composed from what exists:

| Need | Component | Source |
|---|---|---|
| Inbox of live conversations | `DataTable` with row actions and filters | `@open-mercato/ui/backend` |
| Thread timeline | A thread viewer of `EmailThreadsPanel`'s shape, fed by this module's own producer | `@open-mercato/ui/backend/messages` |
| Page scaffolding, states | `detail` family — `SectionHeader`, `LoadingMessage`, `ErrorMessage`, `TabEmptyState`, `RecordNotFoundState` | `@open-mercato/ui/backend/detail` |
| Composer | `MessageComposer`'s inline variant | `@open-mercato/ui/backend/messages` |
| Proposal builder | `CrudForm` over a line-item field array | `@open-mercato/ui/backend` |
| AI draft awaiting approval (Phase 3) | `mutation-preview-card`, unchanged | `@open-mercato/ui/ai/parts` |
| Writes outside `CrudForm` (join, assign, withdraw, re-author, post, author) | `useGuardedMutation(...).runMutation(...)` with `retryLastMutation` in the injection context; conflicts through `surfaceRecordConflict` | `@open-mercato/ui/backend` |

`EmailThreadsPanel` documents itself as entity-agnostic and takes pre-fetched `threads`, so the reuse is genuine — but its only existing *producer* is the CRM endpoint behind `customers.people.view`, so this module supplies its own producer for that shape. That is the whole extent of the new UI code: a producer and a proposal builder.

`.ai/ui-backend-components.md`'s rule for this family applies unchanged — **message and thread surfaces subscribe through the shared hook; no custom polling in the backoffice.** The console is behind the admin shell, where `clientBroadcast` and the existing bridge already work. The `/thread/events` contract of §6.2 is the *buyer's* transport and does not belong here.

### 7.2 Rules that are this feature's, not the framework's

- **Nothing in the console mutates the buyer's cart.** The proposal builder writes to the proposal cart; the only path into the buyer's basket is the buyer's own acceptance. A "push to cart" affordance must not exist, and §10 asserts its absence by enumerating registered routes rather than by inspecting the UI.
- **A live proposal's status is rendered from the server's value**, never derived client-side from `expires_at` versus the clock — the same rule §5.4a and §5.5 of the storefront spec already apply to sort options and checkout steps, for the same reason.
- **Price provenance is shown to the rep.** Each proposal line renders the buyer's resolved unit price with the `price_row_id` explanation `cart` §5.1 already provides, labelled as the buyer's price. A rep who sees their own price and assumes it is the buyer's is R1 reaching the UI. The builder never prices a line itself: prices appear once `cart.proposal.create` has priced the proposal cart as the buyer, and Release 5 adds no pre-submit pricing read.
- **No undo affordance for an accepted proposal** (D-R5-25): the thread page shows `accepted` as final.
- Status uses `{property}-status-{status}-{role}` tokens; no hardcoded Tailwind status colours, no arbitrary values, no `dark:` overrides on semantic tokens.
- The proposal-builder dialog submits on `Cmd/Ctrl+Enter` and cancels on `Escape`; every icon-only button carries an `aria-label`; all copy resolves through `useT()`.

---

## 8) Edge Cases & Failure Scenarios

### 8.1 The buyer logs in mid-conversation

Login reaches the thread by one of two `cart` §7.1 paths, and they need different handling.

**Adoption** (the account had no cart): the guest cart is re-owned, re-priced and its token rotated, but it keeps its id. Nothing about the thread's key changes (§5.1); a `cart.cart.adopted` subscriber fills `customer_id`/`customer_user_id`. Live proposals keep pointing at the same basket and are **not** re-authored: `cart` §7a.2 re-derives a proposal's pricing context from its target on every re-price, and `preview` re-prices against the target's current buyer context anyway, so the buyer's newly known group reaches the proposal without this module doing anything.

**Merge** (both carts non-empty, or the guest cart empty — which `cart` records as a `keep_target` merge rather than an unrecorded discard, §7.1 there): `Cart.status` becomes `merged` and the buyer is on a different `Cart` row. The `cart.cart.merged` subscriber — `kind = 'basket'` only — re-points `buyer_cart_id` (§5.1).

A live proposal targeting the merged-away cart is **re-authored, not re-pointed**: the subscriber runs the §6.4 re-author path, producing a new proposal cart against the merged-into cart, freshly priced, with `superseded_by_proposal_id` set on the old row and the old proposal cart rejected. Re-pointing would mean mutating `Cart.proposed_to_cart_id` — a column `cart` §4.1 binds with a check constraint and exposes through no command; adding `cart.proposal.retarget` for one caller would widen a seam the brief deliberately keeps to three commands. Re-authoring also gets the pricing right for free, which re-pointing would not: the buyer's group has just become known, so every line may change, and a proposal carried across unrepriced would be the one basket in the session still priced as a guest.

**Which principal re-authors — decided (rev 6, D-R5-14; closes §11a Q1).** A subscriber has no `ctx.auth`, yet `cart.proposal.create` requires a principal holding `cart.proposals.author` (`cart` R15) and takes the actor from `ctx.auth` (`cart` R16). The `cart.cart.merged` subscriber therefore builds the context with the shared helper `buildTrustedCommandContext({ tenantId, organizationId, actor: { type: 'user', userId: <authored_by_actor_id> }, reason: 'assisted_selling.reauthor_on_merge' })` from `@open-mercato/shared/lib/commands/trustedContext` (X10), taking tenant and organization from the scoped event payload and the thread, never from any HTTP input; the helper loads that user's ACL fresh, and every feature check against it goes through `rbacService` (wildcards honoured). If `cart.proposal.create` refuses the context (`403`), the fallback below applies. It then re-runs §6.3 in full against the merged-into cart, freshly priced, including `resolveForBuyer` for the now-identified buyer; the idempotency key is derived from the old proposal's id, so a redelivered `cart.cart.merged` re-authors nothing twice.

- **Attribution stays the author's.** `authored_by_*` on the new row and every line's `added_by_actor_*` are the original author's, as commission requires.
- **The audit says who clicked: nobody.** The command's audit entry keeps the author as the actor and carries the helper's system-initiated marker with the reason, so a reviewer can tell an automatic re-authorship from a rep's click. Where the marker lives in the audit log is the helper's contract (X10), the same for every caller (re-author, pay-link cart seeding, checkout recovery).
- **Fallback: supersede and offer re-propose.** If the author no longer holds `cart.proposals.author` (wildcard-aware), is deactivated, or the live mode refuses the author's actor type (below), nothing is re-authored: the old proposal is superseded, its cart rejected, and a system message in the thread says the suggestion needs refreshing. The console surfaces it with the one-click re-propose of §6.4.

**Re-authoring re-runs §6.3 in full, including step 0's live-mode check.** If the store's mode now refuses the original author's actor type — an AI proposal after the store moved to `rep`, a rep proposal after it moved to `ai`, anything under `off` — the same fallback as the lost-ACL case applies: the old proposal is superseded, its cart rejected, nothing is re-authored, and the thread's system message offers re-propose to whichever actor the live mode still permits. The subscriber never bypasses the mode check to preserve a suggestion; §8.4's rule that already-published proposals survive a mode change covers proposals that stay put, not new ones created on the buyer's behalf.

The target is addressed by cart **id** throughout — this module never holds a token (§5.1, §6.3 step 3) — which is what lets a subscriber that has no buyer credential author against the merged-into cart at all.

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

Caught twice: at authoring, because a proposal against a storefront target inherits the target's channel and `cart` §6a.1's `assortmentScope` check therefore applies — against a scope this module resolves for the **target buyer** on the server, never one the author or the model supplies (§6.3 step 2); and at `preview` and the merge boundary by §6a.5, against the scope of the buyer's own request. The first produces a rejected line at authoring time the rep can see; the second produces a `product_unavailable` disposition in `mergeSummary`.

### 8.8 The AI is unavailable (Phase 3)

Provider outage, budget exhausted, moderation refusal. The thread continues; the buyer is not shown an error about a participant they did not know existed. In `mode: 'both'` the rep is unaffected. In `mode: 'ai'` the thread is simply quiet, which is the correct degradation for a channel nobody promised would answer.

### 8.9 The proposal exceeds cart limits

`cart` §13 R10 caps a cart at 200 lines and a batch at 100. `max_proposal_lines` (default 50) is checked first so the failure is a validation error at authoring, in the console, against the rep — not a partial merge at acceptance, against the buyer.

### 8.10 The buyer wants to undo an accepted proposal (rev 6, D-R5-25)

`POST /api/cart/current/undo-merge` on the acceptance merge answers `409 merge_undo_not_supported_for_proposal`. The buyer removes unwanted lines through the ordinary line routes. The proposal stays `accepted`, `merge_log_id` stays set, and the rep's thread shows it as accepted. Lines the buyer removed simply do not convert, so they are never attributed; lines the buyer keeps are. Rev 5's reopen path (`cart.proposal.acceptance_undone`, `.reopened`) no longer exists.

### 8.11 The basket converts to a quote, not an order (rev 6, D-R5-26)

When the buyer submits with `request_quote` (D-R5-20), checkout converts the cart with `salesQuoteId` and a `lineMap` of `{ cartLineId, salesQuoteLineId }`. The §6.7 subscriber attributes against quote lines. If the merchant later converts the quote to an order, Release 5 does not move the attribution to the order lines (D-R5-26); the report shows the quote as the outcome.

### 8.12 An identified buyer's token is replayed without their session (rev 6, D-R5-21)

A storefront keeps the cart token after the buyer logs out (shared workstation, kiosk), or the token leaks. Every buyer route of §6.2 answers `404` with the unknown-cart body, because the basket has `customer_user_id` and no matching customer session is presented. The conversation and the proposals stay unreadable. `cart` rev 10 applies the same rule on `/api/cart/current/*`, so an anonymous request can no longer re-identify the basket to a guest and then read the thread with the token alone (X1). After logout the storefront starts a new guest cart; a later login merges as in §8.1.

---

## 9) Risks & Impact Review

| # | Risk | Severity | Area | Failure scenario | Mitigation | Residual |
|---|---|---|---|---|---|---|
| R1 | Proposal priced as its author, not as the buyer | **High** | `assisted_selling`, `cart`, legal | A rep on a staff price kind, or an agent under a service principal, authors a proposal and `catalogBuyerPricingService` resolves against the author's context. The buyer accepts 84,00 zł; the mandatory post-merge re-price corrects it to 129,00 zł and `priceChanges` discloses an increase the buyer never agreed to. In B2B the two contexts differ by a negotiated contract, not a rounding. | §6.3 passes the **target cart's id** and never the author's context; `cart` §7a.2 makes the proposal cart copy the target's `customer_group_ids`, `price_kind_id`, `currency_code`, `tax_mode` and `buyer_digest` at creation and re-derive them on every re-price. Asserted by the §10 pricing-identity test (S22): a rep on a different price kind and group authors for a buyer with a per-customer contract overlay, and `unit_price_net`, `tax_rate` and `price_row_id` are byte-identical to the buyer's own `/api/cart/current` pricing of the same lines (`cart` R14) | Low |
| R2 | Proposal used as an assortment bypass | **Critical** | `cart` | `cart` §6a.4 exempts channels resolving no `StoreContext`. A proposal authored in an exempt channel and merged into a storefront basket carries lines that were never visibility-checked, through `checkout` into a `SalesOrder` — `cart` R11's failure text by a second route. | Two independent controls: the proposal cart inherits the **target's** channel, so §6a.1's per-line check applies at authoring, against the target buyer's scope resolved on the server (§6.3 step 2) — no request body or tool input can supply it, and authoring fails closed when it cannot be resolved; and §6a.5's pass at the merge boundary rejects anything that slipped, reporting it in `mergeSummary` rather than admitting or deleting it. Tracked as `cart` **R13** and shipped with `cart` **Phase 3**, because the defect exists independently of this feature | Low once `cart` Phase 3 ships and SPEC-029 gains `resolveForBuyer` — until then this feature MUST NOT be enabled, stated as a hard dependency in §11 |
| R3 | Presence treated as a feature flag rather than a disclosure obligation | **High** | `assisted_selling`, legal | A store disables the "someone is viewing your basket" notice to reduce friction. A named employee then observes a buyer's basket contents and activity with no indication to the buyer. Under GDPR this is processing the data subject has not been informed of, and the merchant is the controller. | The disclosure is **not configurable**: the thread response always carries the participant list, and the storefront always renders a rep participant's presence — and, from rev 3, the AI participant's, which is created before the first AI message and labels every AI message and proposal (§4.2; EU AI Act Art. 50). `AssistedSellingStoreSettings` has no column that could switch either off, which is the mitigation — a setting that does not exist cannot be set. A test asserts a rep participant and an AI participant always appear in the buyer's thread payload, and `storefront-app.md` §12 asserts it always renders. Retention is §5.10's; lawful basis, the provider disclosure and the buyer's right to end the conversation are stated in the store's privacy copy | Low — residual is a storefront deployment rendering the payload it is given incorrectly, covered by that spec's test |
| R4 | AI cost and abuse (Phase 3; in Release 5 only the buyer-route rate limits apply) | Medium | `assisted_selling`, `ai-assistant` | A scripted client opens threads and posts messages in a loop; each turn runs a model and a pricing pass. Cost scales with an attacker's patience, and a shared provider quota degrades every tenant. | Four bounds, none sufficient alone: `loop.budget` (`maxToolCalls`, `maxWallClockMs`, `maxTokens`) bounds one turn — **and a tenant runtime override can raise it** (§6.5), so its level is an operator decision; `ai_max_turns_per_thread_per_hour`, enforced by the worker against `AssistedSellingAiTurn`, bounds model usage per conversation whether or not anything is proposed; `ai_max_proposals_per_thread_per_hour`, counting drafts awaiting approval as well as published proposals, bounds what is shown; the §6.2 per-IP and per-token rate limits bound one client. One turn per thread runs at a time (§4.2), so a message burst costs one turn, not one per message. `POST /thread` is limited to 10/min and a thread is unique per cart, so thread creation is bounded by cart creation, which `cart` already rate-limits | Medium — an authenticated B2B buyer with a legitimate high-volume pattern is indistinguishable from abuse by rate alone; per-tenant budget review is an operational control, not a code one |
| R5 | Unreviewed AI proposal reaches the buyer (Phase 3; impossible in Release 5, `mode` is `rep \| off`) | Medium | `assisted_selling` | `ai_proposals_require_rep_approval` defaults to `false`, so in `mode: 'both'` a store publishes priced AI suggestions with no human in the loop. A hallucinated bundle or an inappropriate upsell is shown under the merchant's branding. | The buyer's acceptance is a real, informed, reversible confirmation: the pre-flight preview re-prices before anything merges, `mergeSummary` and `priceChanges` disclose the result, the buyer can remove accepted lines from the basket before checkout (an accepted proposal cannot be un-merged as a whole, D-R5-25), assortment is enforced twice (R2), and `untrustedInput: true` forces input moderation on the buyer-authored text that reaches the model — every unread buyer message is folded into the turn's final user message, because the runtime screens only that one (§4.2) — while the worker screens the AI's reply before posting it. A store wanting a human gate sets the flag `true` and gets the shipped `AiPendingAction` plane | **Medium, accepted as a product decision, and the two gates are not equivalent.** The buyer gate confirms a price; the rep gate would catch hallucinated, off-brand or manipulated *content* before it is displayed under the merchant's branding, and by §1's own definition the buyer is the party least able to judge whether the proposed part fits. Reversibility is thinner than it reads: there is no whole-proposal undo (D-R5-25), only removing lines one by one, and after conversion there is nothing to remove. The honest defence of the default is the trade-off, not a claim of a stronger gate — requiring approval would make `mode: 'both'` useless whenever no rep is online. A store that cannot accept this residual sets the flag |
| R6 | Attribution forged, or lost | Medium | `assisted_selling` | `authored_by_actor_id` or `added_by_actor_id` is written from request input, letting a caller credit another rep; or a conversion path forgets to emit `lineMap` and commission under-reports with no signal. | Actor columns are set from `ctx.auth`, never from the request body, and are non-nullable for `rep`/`ai_agent`; a test asserts a body-supplied actor id is ignored (`cart` R16). The missing-`lineMap` case degrades to order-level attribution and emits `assisted_selling.attribution.degraded` rather than writing nothing; the subscriber never infers the line mapping from product identity, because two lines may share a product and differ by `configuration_hash` | Low |
| R7 | Polling cost and thundering herd behind a CDN | Medium | `assisted_selling`, integrator storefronts | Every storefront session polls `/thread/events`. In Release 5 the client is an integrator's, whose cadence this module does not control (S25). At 5 s intervals across a busy store this is a sustained request rate against an origin the CDN cannot cache, and a deploy or an outage synchronizes every client into one burst. | The interval is adaptive — 5 s only while visible **and** a rep is present, 30 s otherwise, suspended while hidden, backing off to 120 s after a run of unchanged responses — with jitter on every schedule. `ETag`/`304` keeps an unchanged poll cheap. Polling starts only for a session that has a thread; the overwhelming majority of sessions never create one, and `GET /thread` returning `404` starts nothing | Medium until Phase 5 replaces the steady-state case with a stream; the fallback path retains this profile by design and that is the cost of the CDN requirement |
| R8 | A leaked cart token exposes a conversation | **High** | `assisted_selling` | The cart token is the credential for the buyer's half. `cart` R6 already rates its leakage High for basket and email exposure; a thread raises the stakes, because it holds free text written by and about identifiable people on both sides. | The token is never stored here in any form — a buyer route resolves it to a basket cart id through `cart` and the thread is keyed on that id (§5.1). Message bodies, participant display names and rejection reasons are encrypted at rest (§5.7). `cart` §8.3's existing controls apply unchanged: CSPRNG entropy, the `X-Cart-Token` header only, never a cookie or a path segment, rotated on merge, per-token rate limited. **For an identified basket the token alone reads nothing** (rev 6, D-R5-13, D-R5-21): every buyer route also requires the matching customer session and answers `404` otherwise, and `cart` rev 10 closes the identity rewrite that would otherwise turn the basket back into a guest one (§8.12). A token captured before login stops resolving the thread the moment `cart` rotates it, because the thread is found through the token's *current* cart and a rotated-out token resolves to none | Medium for guest baskets — a token leaked mid-session before any rotation still reads a guest's conversation, which is inherent to a guest-reachable surface with no second credential to present, and is the reason a guest thread must be treated as personal data from the first message. Low for identified baskets |
| R9 | Authoring reachable without a principal | **High** | `cart`, `assisted_selling` | Every other buyer-facing route is token-bound, so authoring is written the same way by symmetry. An attacker with a leaked token then injects priced lines into the buyer's own proposal tray, rendered in the store's branding and one click from the basket. | `POST /api/cart/proposals` and `POST /threads/:id/proposals` both require an authenticated principal holding `cart.proposals.author`; they are the only writes in this feature a cart token cannot reach. Asserted by a test presenting a valid token with no principal and expecting `401` (`cart` R15) | Low |
| R10 | Thread stranded by a cart lifecycle transition | Medium | `assisted_selling` | The buyer logs in, the cart merges and the token rotates. A thread keyed on the old cart resolves for nobody: the buyer polls and gets `404`, the rep sees a conversation that has gone silent, mid-sentence, at the exact moment the buyer identified themselves. | The thread is keyed on the basket cart id, never the token, so rotation alone — including adoption, which rotates the token and merges nothing — cannot strand it; a `kind = 'basket'` subscriber on `cart.cart.merged` re-points `buyer_cart_id` and one on `cart.cart.adopted` populates `customer_user_id`; a live proposal is **re-authored** as its original author against the merged-into cart, freshly priced, rather than re-pointed (§8.1) — re-pointing would need a `cart` command that does not exist and would carry a guest-priced basket into an identified session. Where the target already holds an open thread, §5.1's collision policy closes the guest thread and supersedes its proposals rather than violating the partial unique index. Both cases covered by integration tests | Low |
| R11 | Cross-tenant, cross-organization or cross-store thread access | **High** | `assisted_selling` | A thread is resolved from a cart token alone; a token replayed against another tenant's host returns another tenant's conversation. Or a rep in organization A opens a thread on organization B's basket in the same tenant (S9), or a subscriber finds a thread by cart id across tenants (S3). | Token resolution is `cart`'s and is tenant-scoped there; every thread query then filters `tenant_id` and `organization_id` before `buyer_cart_id`, and the thread additionally carries `store_id` which must match the resolved `StoreContext`. Staff opens read the cart through `cart`'s organization-scoped admin detail and the thread inherits the cart's organization (§6.1). Every subscriber scopes by the payload's `tenantId`/`organizationId`, which `cart` rev 10 adds to `cart.cart.merged`/`.adopted` and every `cart.proposal.*` event (D-R5-32). Cross-tenant token resolution is already rejected by `cart` (§14 there) and the same fixture is extended to the thread routes | Low |
| R12 | Conversation data kept forever, or sent where the buyer was not told | **High** | `assisted_selling`, legal | Threads and messages are encrypted but never deleted. A basket is purged after 90 days and its conversation lives on; a buyer deletes their account and their messages remain; in `ai`/`both` mode every message is decrypted and sent to the model provider with no line in the privacy copy saying so. | §5.10: an idle-close sweeper, a retention sweeper keyed on `closed_at` and the store's `conversation_retention_days`, and erasure subscribers on `cart.cart.purged` (baskets) and `customer_accounts.user.deleted`, plus rep-name anonymization on `auth.user.deleted`. The provider disclosure is stated as an obligation on the store's privacy copy and linked from the storefront's AI disclosure. Each trigger is covered by an integration test | Low — the retention period itself is a product and legal choice (§11a Q4); the mechanism is not |
| R13 | The platform acts as a named rep without their click | Medium | `assisted_selling`, audit | On a login merge the subscriber re-authors a live proposal as its original author (D-R5-14). Commission credits the rep, and an auditor reading the trail cannot tell the rep did not act. | The context is built only by `buildTrustedCommandContext` from the scoped event and the stored `authored_by_actor_id`, never from request input; the author's ACL is reloaded and the live mode re-checked, falling back to supersede-and-offer; the audit entry carries the helper's system-initiated marker and reason (§8.1) | Low — the author is credited for lines they did propose, re-priced for the now-identified buyer |
| R14 | Duplicate proposal on a retried authoring call | Medium | `assisted_selling`, `cart` | A rep double-submits, or a client retries after a timeout; two proposal carts with the same lines reach the buyer. | Unique `(tenant_id, thread_id, idempotency_key)` on the proposal row, looked up before any `cart` call; the losing concurrent insert rolls back its proposal cart; a different body under the same key answers `409 idempotency_key_mismatch` (§6.3, S23) | Low |

---

## 10) Integration Coverage

Shipping in the same change, per `.ai/qa/AGENTS.md`. Self-contained: fixtures created in setup through the API (store, products, price kinds, customer groups, a customer with a contract overlay, a customer user, a basket created through `/api/cart/current`, a staff user and an API key holding `assisted_selling.*`, `cart.proposals.author` and `cart.proposals.view`), removed in teardown, no reliance on seeded data. Release 5 has no author UI outside the console and no storefront, so the seam is driven through the API (S16): a **staff principal** (API key or staff session) opens threads and authors; a **buyer client** sends `X-Cart-Token` — plus a customer JWT (`Authorization: Bearer`) for an identified basket — and lists, previews and accepts through `/api/cart/proposals/*`.

### 10.1 Release 5 — every API path (rev 6)

**Staff routes** (`/api/assisted_selling/…`), each asserted for: happy path; tenant isolation and cross-tenant `404`; cross-organization `404` within one tenant (S9); a missing feature `403`, and a wildcard grant (`assisted_selling.*`, `cart.*`) accepted (S21); no principal `401`; optimistic-lock conflict on the mutating routes that carry one.

| Route | Release 5 cases beyond the common set |
|---|---|
| `GET /threads` | Filters by store, status, assignee and `live_proposal_count > 0`; no filter, sort or search over `display_name`; `pageSize` > 100 refused |
| `GET /threads/:id` | Refused (`403`) to a principal with `assisted_selling.threads.view` but not `cart.proposals.view`; proposals carry buyer prices and `price_row_id` |
| `POST /threads` | Opens on a basket of the caller's organization; `404` for a basket of another organization in the same tenant; `409 thread_already_open` with the existing id; `409 cart_not_active` for a non-active cart; `409 assisted_selling_unavailable` under `off`; thread inherits the cart's `organization_id` |
| `POST /threads/:id/join`, `/leave` | Join visible in the buyer's next `GET /thread`; refused under `off` |
| `POST /threads/:id/assign` | Two concurrent assigns: one success, one `409` |
| `POST /threads/:id/messages` | `body_format: 'markdown'` → `400`; body encrypted at rest (raw row differs from plaintext); appears in the buyer's next read |
| `POST /threads/:id/proposals` | §10.2–§10.4 below |
| `POST /proposals/:id/withdraw` | Rejects the proposal **cart**; a previously issued `acceptanceToken` is refused afterwards and nothing merges; non-`published` → `409 proposal_not_live` |
| `POST /proposals/:id/reauthor` | From expired, rejected, withdrawn and superseded: a freshly priced new proposal, old row `superseded_by_proposal_id` set, old cart terminal; from `accepted` → `409 proposal_already_accepted`; key replay idempotent |
| `GET /attributions` | Filters by actor, period, store and outcome; organization-scoped |
| `GET /settings/:storeId` | Defaults when no row exists; `404` for another organization's store |
| `PUT /settings/:storeId` | `mode: 'rep' \| 'off'` accepted; `ai` and `both` → `400` (S10); any `ai_*` field → `400`; `proposal_ttl_seconds` outside 3600–1209600 → `400`; optimistic-lock `409` |

**Buyer routes** (`/api/assisted_selling/storefront/…`), each asserted for: guest basket with `X-Cart-Token` only → works; no header, unknown token, a proposal cart's id used as a token, another tenant's token → `404`; **identified basket** (D-R5-13, D-R5-21) — token only → `404`; token plus another customer's JWT → `404`; token plus the basket's own customer JWT (cookie and Bearer both) → works; the `404` bodies are identical to an unknown cart's; per-IP and per-token rate limit → `429` with `Retry-After`; a cookie named like the token is ignored (S8).

| Route | Release 5 cases beyond the common set |
|---|---|
| `GET /thread` | `404` with no thread; with a staff-opened thread shows the thread, the rep participant and the opening message (S6) |
| `POST /thread` | Opens; `409 assisted_selling_unavailable` under `off`; with an open thread returns it `200` and creates nothing |
| `POST /thread/messages` | `text` only; `404` without an open thread; works on an open thread after the store moved to `off` (§8.4) |
| `GET /thread/events` | **ETag/304 (S25):** first call `200` with `ETag`; same `If-None-Match` → `304` with no body; `since` = current cursor → `304`; after a staff message → `200`, `changed: true`; after a proposal is published, accepted or withdrawn → its id in `proposalIds`; response shape has no body, line, price or name; `404` without a thread |

**Cart seam routes this module depends on** (`cart` rev 10 owns their tests; re-asserted here end to end): `GET /api/cart/proposals` and `POST /api/cart/proposals/:id/{preview,accept,reject}` with the same guest / identified-binding matrix as above.

### 10.2 Authoring and pricing identity

**Pricing identity (R1, S22):**
- A rep on a different price kind and a different customer group authors for a buyer whose resolution carries a per-customer contract overlay (`customerOverlayId` in the `buyerDigest`); every line's `unit_price_net`, `tax_rate` and `price_row_id` are byte-identical to the buyer's own `GET /api/cart/current` pricing of the same lines, and `preview` reports no price delta
- The same for a guest basket (anonymous scope)
- A proposal re-priced after the buyer's group changes follows the **buyer's** new group, not the author's

**Authoring (§6.3):**
- `resolveForBuyer` is called with the thread's `storeId` and the basket's identity, never the author's (D-R5-22); with `ecommerce` absent or the method failing → `503 assortment_scope_unavailable`, nothing created
- `assortmentScope` in the body → `400`; more than `max_proposal_lines` → `400`
- A restricted line is reported in `rejectedLines` and `cart.line.visibility_rejected` fires with `triggeredBy: 'proposal_create'` (S13); every line restricted → `422 proposal_empty` (cart code, passed through), no proposal cart exists
- The proposal cart's `expires_at` follows the store's `proposal_ttl_seconds`, passed as `ttlSeconds` (S5); the proposal cart has no promotion codes (S14)
- The `note` is the body of the proposal's message, encrypted; the proposal cart's `note` is empty (S19)
- **Idempotency (S23):** the same key and body twice → one proposal cart, second answer `200` with the first body; same key, different body → `409 idempotency_key_mismatch`; two concurrent calls with one key → exactly one proposal cart and one row
- `authored_by_actor_*` comes from the principal; a body-supplied actor id is ignored (R6)

### 10.3 Acceptance and terminal states

**Acceptance (the §6.2 ↔ `cart` §7a.4 seam):**
- `preview` creates nothing — cart, line, merge-log and proposal row counts unchanged before and after
- A stale `acceptanceToken` returns `409 proposal_changed` with a fresh preview and token, and merges nothing
- Tokens are single-use and expire after 15 minutes
- Per-line acceptance merges exactly the selected lines; unselected lines are recorded `declined`, neither merged nor deleted; `CartMergeLog.strategy` is `manual`
- Acceptance returns `mergeSummary` and `priceChanges` in one response
- **Undo refused (D-R5-25):** `POST /api/cart/current/undo-merge` on the acceptance merge → `409 merge_undo_not_supported_for_proposal`; the proposal row stays `accepted` with `merge_log_id` set; no `assisted_selling.proposal.*` event follows
- Acceptance against a `locked` target returns `423` with the session id
- Rejection leaves the target cart byte-identical and releases the proposal cart's code reservations

**Addressing (M4):**
- The proposal cart's own token is never returned by any route or event; presenting a proposal cart's id or any proposal-derived value as `X-Cart-Token` on `/api/cart/current` returns `404`, so no line route can reach a proposal. The admin `/api/cart/carts` routes are staff-only and refuse a token-only caller
- A line mutation (`add`, `update`, `remove`, `bulkAdd`, promotions) against a `kind = 'proposal'` cart is refused even when addressed internally by id
- `preview`, `accept` and `reject` for a proposal whose `proposed_to_cart_id` is not the presented token's basket return `404`, identical to a nonexistent id

**Assortment (R2):**
- A restricted product is rejected at authoring against a storefront target
- A rep whose own scope admits a product the buyer's does not still gets the line rejected (M2)
- A line that became restricted between authoring and acceptance is rejected at the merge boundary, reported in `mergeSummary` with `disposition: 'rejected'`, and is neither merged nor deleted
- Both paths emit `cart.line.visibility_rejected` with the correct `triggeredBy`

**Terminal states (§6.6):**
- `cart.proposal.accepted` sets `status: 'accepted'`, `resolved_at` and `merge_log_id`, and decrements `live_proposal_count`
- `cart.proposal.expired` and `.rejected` set their statuses; a `.rejected` arriving for a proposal already `withdrawn` or `superseded` does **not** overwrite it
- Redelivery of any of the three is idempotent
- An event with another tenant's `tenantId` and a colliding `proposalCartId` changes nothing (S3)
- `live_proposal_count` is decremented exactly once for a withdrawal and for a supersession — by the subscriber, not the command (m1)
- Each emits the matching `assisted_selling.proposal.*` event exactly once, with `tenantId` and `organizationId` (D-R5-32)

**Sweepers (M5, `cart` §12, S15):**
- A live proposal cart with no activity for longer than the cart inactivity window is **not** marked `abandoned`, and no `cart.proposal.rejected` fires; it expires at its own `expires_at` and `cart.proposal.expired` reaches the §6.6 subscriber
- An `abandoned` (rejected) proposal cart is never returned to `active`
- `purge-expired-carts` purges a resolved proposal cart 90 days after resolution unless a `CartMergeLog` references it, and emits `cart.cart.purged`; the proposal row survives and renders as purged rather than failing to load

**Mode enforcement (§6.3 step 0):**
- Under `rep` a rep opens, joins and authors; under `off` all three answer `409 assisted_selling_unavailable`
- Flipping the store to `off` mid-conversation stops new proposals and leaves an already-published one acceptable
- The check reads the live setting: a thread whose `mode_snapshot` is `rep` is refused once the store is `off`

### 10.4 Lifecycle, attribution, retention

**Lifecycle (§8):**
- Guest opens a thread, logs into an account with **no** cart (adoption): the token rotates, no cart merges, and the next `GET /thread` with the rotated token **and the customer JWT** still returns the thread, now carrying `customer_user_id`; the live proposal is not re-authored and its preview prices for the buyer's group (M6)
- The pre-login token no longer returns the thread after adoption or merge
- **Login merge re-author (D-R5-14):** guest opens a thread, receives a proposal, logs in, accepts: the thread follows the merged cart; the proposal is re-authored with `authored_by_actor_id` = the original rep and every line's `added_by_actor_id` = that rep, freshly priced for the identified buyer; the old proposal cart is terminal; acceptance succeeds on the new one (R10); the audit entry of the re-author command carries the system-initiated marker and reason and is distinguishable from a rep's own authoring; a redelivered `cart.cart.merged` creates no second proposal
- Fallback: with the author since stripped of `cart.proposals.author`, deactivated, or the store now `off`, the old proposal is superseded, nothing is re-authored, a system message is posted and the console offers re-propose (L7)
- `cart.cart.merged` / `.adopted` carrying another tenant's scope re-point nothing (S3)
- A proposal acceptance (the proposal cart becomes `merged`) re-points no thread
- The same flow where the account cart already holds an open thread: the guest thread closes, its proposals are superseded, both threads stay readable, and the partial unique index is never violated (§5.1)
- `mode: 'off'` refuses a new thread and leaves an open one usable
- An expired proposal is readable, not acceptable, and not deleted
- Two concurrent proposals from two reps are independently acceptable
- **Identified binding after logout (§8.12):** with the buyer's session gone, the token alone gets `404` on every buyer route; an anonymous `GET /api/cart/current` with the token does not re-identify the basket, and the thread stays unreadable

**Attribution (Phase 4, R6, D-R5-16, D-R5-26):**
- Order outcome: a checkout conversion with `salesOrderId` + `lineMap` writes one row per line with `sales_order_line_id`; a mixed cart (buyer lines + two reps' proposals) produces the correct split; no `assisted_selling.attribution.degraded` is emitted
- Quote outcome: a `request_quote` conversion with `salesQuoteId` + `lineMap` of `salesQuoteLineId` writes rows against quote lines
- `thread_id`/`proposal_id` resolve through `CartMergeLog.outcome`'s source→target line mapping; a line the buyer added themselves takes NULL for both and is not reported as degraded
- A line merged from a proposal keeps its author rather than being rewritten to `merge`; a line the buyer removed after acceptance is not attributed
- Amounts are snapshots: crediting the order afterwards does not change them
- Safety net: a `cart.cart.converted` without `lineMap` degrades to document-level attribution and emits `assisted_selling.attribution.degraded`
- Redelivery of `cart.cart.converted` writes nothing twice; another tenant's event writes nothing here

**Retention and erasure (§5.10, R12, S7):**
- A thread idle past `idle_close_days` is closed; a closed thread past `conversation_retention_days` loses its messages and participants, keeps its proposal metadata and attributions, and its proposals' `rejection_reason` is cleared
- `cart.cart.purged` for a basket erases its thread immediately; for a proposal cart it erases nothing
- `customer_accounts.user.deleted` erases every thread of that buyer; `auth.user.deleted` replaces a rep's `display_name` and keeps the thread readable
- Redelivery of any erasure event is a no-op; an erasure event for another tenant touches nothing here

**Presence and disclosure (R3):**
- A rep joining appears in the buyer's next thread read, with no store setting able to suppress it
- `AssistedSellingStoreSettings` has no column that suppresses it — asserted against the entity's column list, so a future addition fails this test
- No path produces a proposal in any status other than `published` at creation, and no `ai_agent` participant, proposal or attribution exists anywhere in the Release 5 suite run

### 10.5 Release 5 — key UI paths (console, Playwright)

The buyer half stays API-level because Release 5 has no storefront (S16). The console runs as a staff user holding the authoring features:
- **Inbox → thread → builder → published proposal:** the inbox lists live threads scoped to the operator's organization and filters by store, status, assignee and "awaiting the buyer"; opening a row shows participants, messages and proposals with loading, empty and error states; the builder adds lines, refuses more than `max_proposal_lines`, submits with `Cmd/Ctrl+Enter`, shows rejected lines, and the published proposal appears in the timeline with each line's buyer price and `price_row_id` provenance labelled as the buyer's
- Withdraw and re-author from the thread page update the status from the server value
- Assign to me, and a concurrent assignment surfaces the conflict bar
- Settings page offers `mode` `rep` / `off` only and saves with optimistic locking
- Attribution report lists rows for a converted cart
- **No console affordance writes to the buyer's cart**, asserted by enumerating the module's registered routes rather than by inspecting the UI

### 10.6 Later phases (not Release 5)

**Transport (Phase 5):**
- With the stream blocked in transit rather than absent from the browser, the client falls back to polling **at runtime** and recovers to streaming on a later attempt — the case the existing `useMessages` capability check does not cover
- A stream connection presenting another tenant's cart token, or an identified basket's token without its session, receives nothing
- A first-party client suspends polling while the tab is hidden and backs off after unchanged responses (with Phase 2 item 4)

**Presence (Phase 5) and AI disclosure (Phase 3):**
- An AI participant appears in the buyer's thread payload whenever the live mode permits the AI, with no store setting able to suppress it

**The AI actor (Phase 3, §4.2), unchanged from rev 5:**
- A buyer message on an `ai`/`both` thread enqueues one turn per thread; a burst of messages yields one turn; the turn runs in the worker, as the store's `ai_agent_user_id`, with a container
- Messages posted while a turn is `running` yield **exactly one** follow-up turn that reads all of them, never a concurrent second turn; a redelivered job for a closed turn does nothing; the partial unique index on `(tenant_id, thread_id)` is never violated (H1)
- In a burst of three buyer messages, all three reach the input moderation gate — a flagged first message refuses the turn even when the last is benign (M1)
- After a turn refused by input moderation, the next turn's model input contains neither the flagged message nor any message folded with it — not as history, not as unread text — and those messages carry `ai_input_flagged_at` and still appear in the buyer's thread payload; a turn that fails with `AiModerationUnavailableError` flags nothing, and its messages are folded into, and screened by, the next turn (N1)
- The turn cap refuses the (n+1)th turn in an hour with `failure_reason: 'turn_limit'` and calls no model, for a thread where nothing was ever proposed (M5); at the cap, one buyer message produces exactly one `turn_limit` row, that message keeps `ai_read_by_turn_id` NULL, and no follow-up turn is queued (N2)
- A `queued` row whose job was never enqueued is re-enqueued by the sweep once `queued_at` is older than `AI_TURN_QUEUED_STALE_MS`, and the turn then runs and reads the waiting messages; a buyer message colliding with such a row triggers the same recovery; a duplicate job produced by re-enqueueing does nothing; after three attempts the row closes `failed` (`queue_lost`) and the next buyer message starts a fresh turn (N3)
- A buyer message that commits after a turn has read a later-stamped one — forced by holding its transaction open across the turn — is still read by exactly one turn and passes the input moderation gate, and never reaches a model as history before that; the same for two messages with an equal `sent_at` (N4, L8)
- A turn that throws after the gate passed (provider error, thrown budget stop) marks none of its read set and queues no follow-up; the next buyer message's turn folds and screens those messages again, and a proposal the failed turn already published is not rolled back (L9)
- A finished turn posts its reply as one `AssistedSellingMessage` from the `ai_agent` participant, encrypted, visible in the buyer's next poll, and does not trigger another turn; a reply flagged by moderation, or produced while moderation is unavailable, posts nothing (M3)
- The `ai_agent` participant exists in the buyer's thread payload before the first AI message, and every AI message carries `actor_type: 'ai_agent'` (M3)
- With `ai_proposals_require_rep_approval: true`, the tool call produces an `AiPendingAction` and an `AssistedSellingAiDraft` row and **no `AssistedSellingProposal` row exists at all** until confirm; cancel leaves none; confirm creates it already `published`, with no second publish step and no route that could perform one
- A rep who was not in the turn sees the draft in the console and confirms it; the proposal records `authored_by_actor_type: 'ai_agent'` with the agent's id and `approved_by_actor_id` = that rep
- A principal lacking `cart.proposals.author` cannot confirm the draft (`403 agent_features_denied`), and one in a different organization cannot see it (`404`)
- With it `false`, the same tool call publishes directly and no `AiPendingAction` row is created — this also guards the platform-inconsistency note in §4.2
- The tool's input schema has no field for scope, author, approver, thread or target cart
- A tool call whose `turnId` names another thread's running turn, a finished turn, or a turn of a different agent principal is refused and publishes nothing; a confirmed draft whose §5.8 thread differs from its turn's is refused
- Both agent declarations resolve the tool (neither is read-only), and a tenant override of `destructive-confirm-required` on `assisted_selling.seller_reviewed` makes the **tool handler** refuse the direct call and publish nothing, rather than publishing without approval — including when the override is written after the turn started (M2); a `read-only` override on either agent silences it
- A confirm whose pending action has no §5.8 draft row — a rep running `assisted_selling.seller_reviewed` from the backoffice chat and confirming their own call — is refused and publishes nothing (L5)
- No path produces a proposal in any status other than `published` — asserted against the status column's distinct values across the whole suite run, so a future `draft` cannot appear without failing this test
- The artifact is **identical** in both cases once published — same proposal cart, same line prices, same `authored_by_actor_type: 'ai_agent'`
- An expired `AiPendingAction` surfaces as re-proposable, and re-authoring produces a freshly-priced new proposal with `superseded_by_proposal_id` set on the old row
- A `loop.budget` breach aborts the turn and publishes nothing
- The per-thread hourly limit refuses the (n+1)th proposal with `ai_proposal_limit`; with rep approval on, drafts awaiting approval count toward it, a draft over the cap is recorded `rate_limited` and never shown in the console, and a rep cannot confirm a draft past the cap (M5)
- The handler's age check uses the effective wall-clock budget: with a tenant override raising `loopMaxWallClockMs`, a call late in a long turn is still accepted (L4)
- Pricing identity holds for the autonomous agent principal exactly as for a rep

---

## 11) Implementation Phases

> **Phase numbers in this section are internal to this spec.** The suite's Phase 4 (roadmap §7, "Experience") is where all five of them live. Where another document says "assisted selling Phase 5" it means the fifth phase below, not a sixth suite phase.

**Hard dependencies (rev 6).**
- `cart` Phase 3 including §6a.5 must ship before any phase here is enabled in a live store (R2).
- The `cart` §7a proposal seam as revised in cart rev 10 — with `tenantId`/`organizationId` on `cart.cart.merged`, `.adopted` and every `cart.proposal.*` payload (S3, D-R5-32), `ttlSeconds` on `cart.proposal.create` (S5), `triggeredBy: 'proposal_create'` (S13), no promotion codes on proposals (S14), the proposal sweeper branches (S15), the identified-buyer binding on every buyer route (D-R5-21) and the undo refusal (D-R5-25) — must ship before Phase 1 here.
- SPEC-029's `storeContextService.resolveForBuyer({ tenantId, organizationId, storeId?, customerUserId?, customerId? })` (D-R5-22) must ship before Phase 1's authoring route. SPEC-029 owns its contract; this spec always calls it with `storeId`.
- The shared `buildTrustedCommandContext` helper (`@open-mercato/shared/lib/commands/trustedContext`, X10) must ship before the Phase 1 merge subscriber.
- Phase 4 needs checkout B.4 to pass `salesOrderId`/`salesQuoteId` and `lineMap` to `cart.markConverted` (K8, D-R5-16, D-R5-26).

### Release 5 (D-R5-11, D-R5-15, D-R5-16; confirmed by the cross-spec pass)

| Phase / item | Release 5 | Why |
|---|---|---|
| **Phase 1**, all items | **In**, with `mode` limited to `rep \| off`, no `AssistedSellingAiDraft`/`AiTurn`, store-context `mode` exposure deferred | The author side of the seam (D-R5-11); S10, S12 |
| **Phase 2** item 1 — buyer thread routes | **In**, with the D-R5-21 binding | R3: a staff-opened thread must be readable by the buyer (S6) |
| **Phase 2** item 2 — `/thread/events` | **In, server side only** | ETag/304 is ours; cadence is the integrator's (S25) |
| **Phase 2** item 3 — rep console | **In, full** (owner choice (a)) | Without it no merchant can sell with the feature |
| **Phase 2** item 5 — retention and erasure | **In** | Mandatory with the first route storing text about a buyer (S7) |
| **Phase 4** — attribution | **In**, `lineMap` mandatory, quote lines included | D-R5-16, D-R5-26; degraded path as safety net |
| Phase 2 item 4 — storefront tray | Out | No first-party storefront |
| Phase 3 — AI actor | Out | `ai`/`both` refused by the validator |
| Phase 5 — live transport, presence | Out | Polling covers Release 5 |

Implementation order inside the release (cross-spec wave plan): Phase 1 with Phase 2 items 1, 2 and 5 in wave 4, after the cart seam; Phase 2 item 3 and Phase 4 in wave 5, after checkout B.4.

#### Phase 1 — Foundation and the proposal seam (Release 5)

1. Module scaffold, entities (§5.1–§5.7, with the nullable `ai_*` message columns and the `ai_*` settings columns at their defaults; **not** §5.8/§5.9), migrations, `encryption.ts`, `acl.ts`, `setup.ts` with the §6.9 grants, `events.ts` (§6.8). Register the module **enabled in `apps/mercato/src/modules.ts` and commented out in the create-app template** (D-R5-36, D22 precedent), then `yarn template:sync:fix`, `yarn generate` and `yarn mercato auth sync-role-acls` (S20). The AI agent principal is **not** created here — it belongs to Phase 3.
2. `AssistedSellingStoreSettings` with `GET/PUT /settings/:storeId` and its admin page; validator `mode: rep | off` (S10). The store-context `mode` exposure is deferred (S12).
3. Thread, participant and message commands and the staff read/write routes under `/api/assisted_selling/` (S4), organization-scoped through `cart`'s admin detail read (S9), feature checks through `rbacService` (S21), `body_format: 'text'` (S24).
4. `POST /threads/:id/proposals` wrapping `cart.proposal.create` by target cart id with `ttlSeconds`, the `resolveForBuyer` scope (fail closed), the rejected-line report, the note as the message body (S19), the idempotency key (S23), and the pricing-identity test (S22).
5. Withdraw, supersede and re-author — each invoking `cart.proposal.reject` on the proposal cart, not only the local row (§6.4).
6. **The `cart.proposal.accepted | .rejected | .expired` subscriber** that writes every terminal state (§6.6), scoped by the payload's tenant and organization, and sole owner of `live_proposal_count`. No `.acceptance_undone` subscription (D-R5-25).
7. The `cart.cart.merged` (basket-only) and `cart.cart.adopted` subscribers, tenant-scoped: re-point, re-author live proposals as their original author through `buildTrustedCommandContext` with the system-initiated audit marker and the supersede fallback (D-R5-14), apply the collision policy (§5.1, §8.1).
8. Staff thread opening and assignment; the live-`mode` check on opening, joining and authoring.

**Gate:** a proposal is authored by a staff principal and accepted by a buyer client end to end through the API, guest and identified; the local row reaches `accepted` with `merge_log_id` populated; its line prices are byte-identical to the buyer's own resolution when the author's context differs; a withdrawn proposal cannot be accepted; an identified basket refuses the token alone with `404`.

#### Phase 2 — The human loop closes (Release 5: items 1, 2, 3, 5)

1. Buyer routes under `/api/assisted_selling/storefront/`: `GET/POST /thread`, `POST /thread/messages`, `GET /thread/events` — `X-Cart-Token` only, the identified-buyer binding (D-R5-13, D-R5-21), per-IP and per-token rate limits.
2. The `/thread/events` server contract: signal-only payload, `ETag`/`304`, rate limited (S25). The client cadence of §6.2 is documentation for integrators; Release 5 builds no polling client.
3. Rep console (D-R5-15, full): inbox with filters, thread page, composer, proposal builder with the buyer's prices and provenance, settings page; plus the attribution report with Phase 4 (§7).
4. *Out of Release 5:* storefront proposal tray and conversation panel (delivered in `storefront-app.md` Phase 3).
5. Retention and erasure (§5.10): the idle-close and retention sweepers, and the `cart.cart.purged`, `customer_accounts.user.deleted` and `auth.user.deleted` subscribers — shipped with the first route that stores buyer text, i.e. together with Phase 1 (S7).

**Gate:** a rep proposes from the console, a buyer client accepts two of five lines, the other three are recorded `declined`, and undo of that acceptance is refused with `409 merge_undo_not_supported_for_proposal`; `/thread/events` answers `304` for a current cursor; erasure on each trigger is verified; the console never exposes a write to the buyer's cart, asserted by route enumeration; the console Playwright path inbox → thread → builder → published proposal passes (§10.5).

#### Phase 4 — Attribution (Release 5)

1. `AssistedSellingAttribution` (order and quote columns, §5.5) and its migration.
2. The `cart.cart.converted` subscriber with `lineMap` for order and quote lines, the degraded safety net and its event (§6.7).
3. `GET /attributions` and the console report.

**Gate:** a mixed cart splits correctly per line for an order and for a quote; a normal checkout conversion emits no `degraded` event; amounts survive a later credit; a missing `lineMap` degrades visibly.

### Later (not Release 5)

Phase 2 item 4 (storefront tray), and Phases 3 and 5 below, with their unchanged design.

#### Phase 3 — The AI actor

1. The agent principal (`auth.User`, `kind: 'agent'`), its role grants, and the settings validator widened to `ai | both` (reserved since Release 5) and requiring `ai_agent_user_id` whenever `mode ∈ {ai, both}`; the `ai_*` settings fields exposed on the route and page. Migrations create `assisted_selling_ai_drafts` (§5.8), `assisted_selling_ai_turns` (§5.9) and the partial unread index on messages (§5.3); the `ai_*` message and settings columns already exist.
2. `assisted_selling.propose_cart_lines` with `isMutation: true`, `loadBeforeRecords` and both feature requirements.
3. The two agent declarations with `readOnly: false`, `loop.budget`, `stopWhen` and `untrustedInput: true`.
4. The runner: the buyer-message subscriber, the `assisted-selling-ai-turn` queue worker, `AssistedSellingAiTurn` with its partial unique index, per-message read marker (`AssistedSellingMessage.ai_read_by_turn_id`), follow-up rule and stale `queued`/`running` sweep, the fold of unread buyer messages into the final user message, the exclusion of moderation-refused messages from later turns, the page-context turn id, the agent-principal auth context, and agent selection from the store flag (§4.2). The handler's direct-path refusal under `assisted_selling.seller_reviewed`.
5. The AI participant, reply posting with output moderation, and the non-suppressible AI disclosure (§4.2). **Ask First** sign-off on declaring `destructive-confirm-required` recorded on the PR.
6. The rep-approval path: `AssistedSellingAiDraft`, the console's draft list over `mutation-preview-card`; confirm runs the handler as the agent principal and records the approver — one approval step, not two.
7. The per-thread turn cap and proposal cap (drafts counted, §6.5); the expired-draft re-propose affordance.

**Gate:** both settings of the approval flag produce an identical published artifact, attributed to the agent; a budget breach publishes nothing; the hourly limits refuse with distinguishable codes; a burst of messages yields one turn and one follow-up; the AI's reply reaches the buyer labelled as AI.

#### Phase 5 — Live transport and presence

1. `storefrontBroadcast` on `EventDefinition` and its predicate, mirroring `clientBroadcast` / `portalBroadcast` — including the two places that enumerate those flags today: the CLI generator's module facts (`packages/cli/src/lib/generators/module-facts.ts:680-683`) and the event bus's cross-process broadcast check (`packages/shared/src/modules/events/factory.ts:186`, which covers only `clientBroadcast`). Still an additive optional field, so no BC breach.
2. `/api/ecommerce/storefront/events/stream`, authenticated by the cart token and audience-keyed on the basket cart id it resolves to (§4.4), with `crossProcessBroadcast` so it is correct on more than one instance.
3. The storefront client's **runtime** fallback to polling and recovery to streaming.
4. Presence: participant state, the non-removable disclosure, and idle expiry.

**Gate:** with the stream blocked in transit the client degrades to polling without losing an event and recovers afterwards; a rep's presence is visible to the buyer and no setting suppresses it.

---

## 11a) Open Questions (rev 2; Q1 and Q2 closed in rev 6)

Rev 1 closed its Open Questions at the gate. The rev 2 review (M1–M6) surfaced three that the codebase cannot settle, because each is a trust, retention or contract decision rather than a mechanism, and the rev 3 review (M4) added a fourth. Each carries a default the spec is written against, so implementation is not blocked; a product owner overrides by amending this section.

1. ~~**Who re-authors a proposal when the buyer's cart merges on login (§8.1)?**~~ **Closed 2026-10-26 by D-R5-14: the default.** The original author, through `buildTrustedCommandContext` with that user's ACL freshly loaded, audited as system-initiated on the author's behalf; supersede with one-click re-propose when the author lacks `cart.proposals.author`, is deactivated, or the live mode refuses the actor type. The record of the question as it stood: *Default:* the original author, via a server-built auth context with that user's ACL freshly loaded; supersede-without-re-authoring when they no longer hold `cart.proposals.author`. *Why a question:* it is the platform acting as a named human without that human's click, which is new here — the only precedent (§4.2) acts as a non-human agent principal. *Alternative:* never auto re-author; supersede and let the console's one-click re-propose bring it back. Safer on trust, and the buyer loses the suggestion at the moment they log in until a rep acts — in `mode: 'ai'` the agent can re-propose on its next turn, in `rep` it waits for a human.
2. ~~**How long does a proposal cart outlive its resolution?**~~ **Closed by `cart`'s D-R4-20** (S15): purged 90 days after `resolved_at`; accepted proposals stay while `CartMergeLog` references them. The record as it stood: owned by `cart` (§16 Q6 there), recorded here because §7a.3's "remains readable as history" depends on it. *Default:* proposal carts purge on the same 90-day rule as any cart, counted from resolution; `purge-expired-carts` emits `cart.cart.purged`, and this module keeps the metadata row and renders "details purged". The accepted lines survive regardless in `CartMergeLog.source_snapshot`, which the purge already retains.
3. **How does a tool handler learn which thread its run is for (§4.2)?** *Default:* the turn-id capability — a random id present only in that turn's context, passed back as `turnId` and validated against `AssistedSellingAiTurn`. *Why a question:* it puts a binding value through model-controlled input, safe only because the value is unguessable and absent from every other turn's context. *Alternative:* an additive `runContext` (session id, caller-supplied metadata) on the handler context in `ai-assistant` — cleaner, reusable by any server-side agent, and a contract change needing that package's Ask First sign-off.
4. **How long is a conversation kept (§5.10)?** *Default:* `conversation_retention_days = 365` from `closed_at`, and `idle_close_days = 30`, both per store; erased immediately on basket purge or buyer deletion regardless. *Why a question:* the right period depends on the merchant's legal basis and jurisdiction, not on a mechanism. *Alternative:* tie it to the proposal-cart retention of Q2 (90 days from resolution), which is simpler but loses the conversation that explains an order a buyer later disputes.

---

## 12) Final Compliance Report

| Requirement | Status |
|---|---|
| No cross-module ORM relations | Every reference to `cart`, `sales`, `auth`, `customers`, `customer_accounts` and `ecommerce` is an FK id; services reached through DI; the optional peer is resolved with `tryResolve` |
| Tenant/organization scoping | Every entity and every query; thread resolution filters tenant and organization **before** `buyer_cart_id`, and additionally matches `store_id` (R11). Staff opens read the cart organization-scoped and the thread inherits the cart's organization (S9). Every subscriber scopes by the payload's `tenantId`/`organizationId` (S3, D-R5-32) |
| Module naming | snake_case module id `assisted_selling` — a mass noun, like the existing `auth` and `cart`, rather than forced into a plural that names nothing; singular entity ids; event ids `module.entity.action` with past-tense actions |
| Command pattern | Every mutation is a registered command with `withAtomicFlush` and post-commit side effects; custom write routes run `runMutationGuards`. Server-initiated commands (the login-merge re-author) build their context only through `buildTrustedCommandContext` and are audited as system-initiated (D-R5-14, X10) |
| Optimistic locking | `updated_at` on every user-editable entity; settings edits and thread assignment carry the standard header; conflicts surfaced through the shared conflict bar. Proposals are immutable once published — withdraw and re-author are status transitions guarded by the current status (§5.4), not edits |
| Encryption | `AssistedSellingMessage.body` (including the authoring note, S19), `AssistedSellingParticipant.displayName`, `AssistedSellingProposal.rejectionReason` declared in `defaultEncryptionMaps`; reads through `findWithDecryption`. No cart token is stored in any form; threads are keyed on the basket cart id |
| Zod validation | All routes; `z.infer` types; no `any` |
| ACL | Feature-gated admin namespace, checked wildcard-aware through `rbacService` (S21); grants in `setup.ts` with `sync-role-acls` (§6.9). Buyer surfaces deliberately ungated and `X-Cart-Token` bound, because a guest has no ACL identity; an identified basket additionally requires its own buyer's customer session, else `404` (D-R5-13, D-R5-21) |
| Rate limiting | Per IP and per token on all four public routes (`429` with `Retry-After`); `/thread/events` cheap through `ETag`/`304` (S25); from Phase 3, per thread on AI authoring and `loop.budget` on the agent turn |
| Events | `createModuleEvents`; every payload carries `tenantId` and `organizationId` (D-R5-32); `clientBroadcast` for the console; `storefrontBroadcast` from Phase 5; signal-only payloads. `.reopened` removed with the undo path (D-R5-25) |
| Canonical UI | `DataTable`, `CrudForm`, the `messages` and `detail` families, `apiCall`; no raw `fetch`, no hand-rolled dialog, no custom polling in the backoffice |
| Design system | Semantic status tokens; no arbitrary values; no `dark:` on semantic tokens; `Cmd/Ctrl+Enter` / `Escape` in dialogs; `aria-label` on icon-only buttons |
| i18n | All copy through locale files; internal-only throws prefixed `[internal]` |
| Backward compatibility | New module; its routes are frozen on ship under `/api/assisted_selling/` (S4). Changes it relies on elsewhere are additive and specified in their owners' Release 5 revisions: `storeContextService.resolveForBuyer` (SPEC-029, D-R5-22); `tenantId`/`organizationId` on `cart.cart.merged`/`.adopted`/`cart.proposal.*`, `ttlSeconds` on `cart.proposal.create`, `triggeredBy: 'proposal_create'`, and `salesOrderId`/`salesQuoteId`/`lineMap` on `cart.markConverted` (cart rev 10); the shared `buildTrustedCommandContext` helper (X10). The behaviour change on cart buyer routes (D-R5-21) is `cart`'s and recorded in its `UPGRADE_NOTES.md` entry. Phase 5 adds an **additive** `storefrontBroadcast?: boolean` on `EventDefinition`, so no deprecation protocol is triggered |
| Roadmap conformance | ADR-10 amended into the umbrella **before** this spec was written, per roadmap §1; ADR-7 and ADR-9 honoured by pricing against the target's buyer context |
| Module registration | Enabled in `apps/mercato/src/modules.ts`, commented out in the create-app template, `yarn template:sync:fix` (D-R5-36, S20) |
| Integration coverage | §10: every Release 5 API path (§10.1), the console Playwright path (§10.5), shipping in the same change |

---

## 13) Changelog

### 2026-10-26 (rev 6 — Release 5 spec revision)

Applies the Release 5 owner decisions D-R5-11, -13, -14, -15, -16, -21, -22, -25, -26, -32 and -36 and the pre-implementation findings S1–S25 (`ANALYSIS-2026-10-26-assisted-selling-release-5.md`), checked against the cross-spec pass X1–X20. The core decision is unchanged: a proposal is a cart, acceptance is a merge.

- **Scope (D-R5-11, D-R5-15, D-R5-16; header, TLDR, §11).** §11 is re-cut into a "Release 5" block — Phase 1 with `mode` `rep | off`, Phase 2 items 1, 2 (server side), 3 (full console) and 5, Phase 4 — and a "Later" block with Phase 2 item 4, Phase 3 and Phase 5. AI sections (§4.2, §4.3, §5.8, §5.9, §6.5) are marked Phase 3.
- **Route prefix (S4; §4.4, §6).** Every path is `/api/assisted_selling/…`; `/api/assisted-selling/…` is withdrawn.
- **Buyer credential and binding (S8, D-R5-13, D-R5-21; §4.1, §6.2, §8.12, R8).** `X-Cart-Token` header only, the cookie wording removed. An identified basket requires its own buyer's customer session on every buyer route, else `404` with the unknown-cart body.
- **`/thread/events` server contract (S25, §6.2).** Opaque cursor, `ETag`/`304`, signal-only payload, `404` without a thread; client cadence is integrator documentation.
- **`resolveForBuyer` (S1, D-R5-22; §6.3 step 2, §11).** Called with the thread's `storeId` per the SPEC-029 contract, in-process, fail closed with `503 assortment_scope_unavailable`.
- **Re-author on login merge (S11, D-R5-14; §8.1, R13, §11a Q1).** Original author through `buildTrustedCommandContext`, ACL reloaded, live mode re-checked, audited as system-initiated; supersede fallback. Q1 closed; Q2 closed by `cart`'s D-R4-20.
- **No undo of an accepted proposal (D-R5-25; §5.4, §6.6, §6.8, §8.10).** `accepted` is final; the `.acceptance_undone` subscription and `assisted_selling.proposal.reopened` are removed.
- **Attribution (D-R5-16, D-R5-26; §5.5, §6.7, §8.11).** `lineMap` mandatory; quote outcome attributed against `sales_quote_line_id`; the degraded path stays as a safety net.
- **Scoping (S3, S9, D-R5-32; §5.1, §6.1, §6.6, §6.8, R11).** Subscribers filter by payload tenant/organization; staff opens read the cart through `cart`'s organization-scoped admin detail and the thread inherits its organization; every event payload carries `tenantId`/`organizationId`.
- **Data model (S5, S10, S19, S23, S24; §5.3, §5.4, §5.6).** `ttlSeconds` passed to `cart.proposal.create`; `mode` validator `rep | off` with `ai`/`both` reserved; nullable `ai_*` columns kept; the note stored as the encrypted proposal message body; `idempotency_key` + `request_digest` with unique `(tenant_id, thread_id, idempotency_key)`; `body_format` `text` only.
- **Deferred (S12; §5.6).** The store-context `mode` exposure.
- **Authoring report (S13, S14; §6.3).** Rejected lines returned with `triggeredBy: 'proposal_create'`; no promotion codes on proposals.
- **RBAC and grants (S20, S21; §6.1, §6.9).** Wildcard-aware checks through `rbacService`; `setup.ts` grants; `sync-role-acls`.
- **Error codes (§6.10).** One table; new codes `thread_already_open`, `proposal_not_live`, `proposal_already_accepted`, `idempotency_key_mismatch` (409); `proposal_empty` passed through from cart.
- **Console (D-R5-15; §7).** Release 5 scope stated: inbox, thread page, composer, builder with buyer prices and provenance, settings, attribution report.
- **Stale references (S17).** Cart rev 8 → rev 10; `catalogPricingService` → `catalogBuyerPricingService`; `GET /api/cart/carts/:token`-style addressing → `/api/cart/current` with the token header, admin `/api/cart/carts` staff-only.
- **Coverage (S16, S22; §10).** Every Release 5 API path with the guest/identified binding matrix, ETag/304, retention and erasure, the pricing-identity test with a contract overlay, the login-merge re-author and its audit marker, undo refusal, quote attribution, and the console Playwright path inbox → thread → builder → published proposal.
- **Registration (D-R5-36, S20; §11, §12).** Enabled in `apps/mercato/src/modules.ts`, commented out in the create-app template.

### 2026-10-02 (rev 5 — specification re-review N4, L9)

Resolves the 2026-10-02 re-review of rev 4. The core decision is unchanged.

- **N4 — reads are recorded per message, not as a cursor (§4.2, §5.3, §5.9).** Rev 4's `(sent_at, id)` cursor assumed messages commit in `sent_at` order. They do not: `sent_at` is stamped when the command runs and the row is visible only after `withAtomicFlush` commits, so a message committing after a later-stamped one that a turn already read sorted behind the cursor and was never screened, then reached every later turn as history. `AssistedSellingAiTurn.input_through_sent_at` / `input_through_message_id` are removed; `AssistedSellingMessage.ai_read_by_turn_id` is added and written on exactly the turn's read set, in the closing transaction, once the gate has ruled. Unread, history and follow-up are now plain predicates over that column and `ai_input_flagged_at`. N2's guarantee is unchanged: a turn that read nothing marks nothing and schedules no follow-up. The `(sent_at, id)` index stays as display and fold order only. The §10 case is the late-commit scenario.
- **L9 — a turn that throws after the gate passed marks nothing (§4.2, §5.9).** Provider errors, a budget stop surfaced as a throw, and a dead worker swept `provider_error` are named alongside the pre-gate failures: the read set stays unread, is re-screened by the next turn, and the failed turn is neither retried nor followed up. A proposal the failed turn already published stands, bounded by the proposal cap. §10 case added.

### 2026-10-01 (rev 4 — specification re-review N1–N3, L8)

Resolves the 2026-09-30 re-review of rev 3. All four findings sit in the turn state machine rev 3 added; the core decision is unchanged.

- **N1 — a moderation-refused message never re-enters the model (§4.2, §5.3).** History holds only buyer messages read by a turn whose input passed moderation. On `AiModerationBlockedError` the worker sets the new `AssistedSellingMessage.ai_input_flagged_at` on every message folded into the refused turn, and later turns exclude them from model input entirely; `AiModerationUnavailableError` flags nothing and the messages are re-screened by the next turn.
- **N2 — a turn that read nothing schedules no follow-up (§4.2, §5.9).** The read cursor is set only once moderation has ruled on the turn's input; a turn with a NULL cursor (`turn_limit`, an unbuildable principal, moderation unavailable) queues no follow-up, so the turn cap cannot hot-loop the queue. Its unread messages wait for the next turn.
- **N3 — orphaned `queued` rows are recovered (§5.9).** The sweep and the subscriber's collision path re-enqueue a `queued` row older than `AI_TURN_QUEUED_STALE_MS` (redelivery is safe through a conditional `queued → running` update), and close it `failed` (`queue_lost`) after three attempts.
- **L8 — the cursor has a total order.** It is `(input_through_sent_at, input_through_message_id)`, compared in `(sent_at, id)` order, backed by a `(tenant_id, thread_id, sent_at, id)` index on messages.

### 2026-09-30 (rev 3 — specification review H1, M1–M5, L1–L7)

Resolves the 2026-09-29 specification review. The core decision is unchanged.

- **H1 — one turn per thread, deduplicated in this module (§4.2, §5.9).** The queue has no dedupe key. `AssistedSellingAiTurn` gains a `queued` status and a partial unique index on `(tenant_id, thread_id)` for `queued`/`running`; the subscriber enqueues only when its insert succeeds, and a finishing turn enqueues one follow-up when buyer messages arrived after `input_through_message_id`. Stale `running` rows are swept.
- **M1 — every batched buyer message is moderated.** The runtime screens only the latest user message, so all unread buyer messages are folded into the turn's final user message.
- **M2 — the rep-approval guarantee moves into the tool handler.** A direct call under `assisted_selling.seller_reviewed` is refused; the worker reads nothing from `ai_assistant`, removing both the coupling and the check-then-run race.
- **M3 — the AI's reply path and disclosure.** The AI participant exists before the first turn; history maps to model roles by author; the worker posts the reply through the message command after output moderation; AI disclosure is non-suppressible like rep presence (EU AI Act Art. 50), mirrored in `storefront-app.md` §5.10/R11.
- **M4 — retention and erasure (§5.10, R12, §11a Q4).** Idle-close and retention sweepers; erasure on basket purge and buyer deletion; rep-name anonymization on staff deletion; the LLM-provider disclosure.
- **M5 — model usage is bounded.** New `ai_max_turns_per_thread_per_hour`, enforced by the worker; the proposal cap counts drafts and is enforced by the tool handler (and by the worker when writing drafts), resolving rev 2's contradiction; R4 states the loop budget is tenant-overridable.
- **Lows:** R1 now says target cart **id** (L1); the staff-auth rejection cited at `server.ts:421` via `getAuthFromRequest` `:479` (L2); §11a count, roadmap row 13 → cart rev 8, §12 proposals immutable, `/assign` optimistic-locked (L3); the turn id travels via `pageContext` + `resolvePageContext`, age-checked against the effective budget (L4); confirm without a draft row is refused (L5); Phase 5 names the CLI generator and cross-process check (L6); re-authoring under a refusing mode falls back to supersede-and-offer (L7).


### 2026-09-27 (rev 2 — review findings M1–M6)

Resolves the six major findings of the 2026-09-25 specification review, each checked against `develop`. The core decision is unchanged: a proposal is a cart, acceptance is a merge.

- **M1 — the approval flag is a mutation policy, not a runtime (§4.2).** Rev 1 said `prepareMutation` needs a staff session; it needs a tenant, organization, user, features and a container, and what gates a tool is the agent's `mutationPolicy`. Two agent declarations differing only in `mutationPolicy` (`confirm-required` / `destructive-confirm-required`, both `readOnly: false`) run in a queue worker as the store's agent principal with a container; the store flag picks which — `runAiAgentText` has no per-call override. A turn row binds each tool call to its thread, because a handler receives no run context. Drafts reach reps through a new `AssistedSellingAiDraft` join row (§5.8); confirm is open to any same-organization rep holding the authoring features, and the handler runs as the agent with the rep recorded in the new `approved_by_actor_id`. The Ask First rule on relaxing mutation policies and a ranking-comment/runtime inconsistency in `agent-policy.ts` are stated.
- **M2 — the buyer's assortment scope is resolved on the server (§6.3).** Removed from the authoring body and the tool input; resolved for the target buyer through an additive `storeContextService.resolveForBuyer` recorded as an obligation on SPEC-029; authoring fails closed. `cart`'s merge-boundary pass takes the scope from the buyer's own request (`cart` §6a.5).
- **M3 — undo reaches this module.** `cart` emits `cart.proposal.acceptance_undone`; the §6.6 subscriber reopens the proposal (or marks it expired), and §5.4 now lists every transition.
- **M4 — proposals are addressed by id under the buyer's token.** `cart` §10 routes became `/api/cart/proposals/:proposalId/*`; a proposal cart's own token is never issued and token-bound line routes cannot reach a `kind = 'proposal'` cart.
- **M5 — sweepers re-specified (`cart` §9, §12).** Proposal carts are exempt from inactivity abandonment, `abandoned` is final for them, and retention is an explicit open question with a default (§11a Q2).
- **M6 — the login path.** The thread no longer stores a token hash: buyer routes resolve the token to a basket id through `cart`, so rotation — including adoption, which rotated the token with no event — cannot strand a thread. `cart.cart.merged` has a defined payload and is filtered to baskets; `cart.cart.adopted` is new; `cart.proposal.create` is keyed on the target cart id. The re-authoring principal is an open question with a default (§11a Q1).
- **Minors fixed with them:** one owner for `live_proposal_count` (m1); `assisted_selling.proposal.superseded` and `.reopened` events (m2); the merged-cart subscriber filters `kind = 'basket'` (m4).

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
- ~~**`ai_proposals_require_rep_approval` selects a runtime, not just a gate** (§4.2).~~ *Withdrawn in rev 2:* `prepareMutation` does not need a staff session, and the flag selects between two agent declarations that differ only in mutation policy, run by one server-side worker. What remains true is that a **buyer** cannot reach the employee plane, because `getAuthFromRequest` rejects customer-audience sessions outright (§4.1).

**Decisions taken at the Open Questions gate**, recorded so a later reader sees they were chosen rather than defaulted: the thread lives in a new `assisted_selling` module (not `customer_accounts`, not `cart`); v1 polls and real-time lands in Phase 5 as pure transport; acceptance is a pre-flight preview plus a re-resolving confirm, on the `resolutionToken` shape spec 9 §7.3 already fixed for shopping-list conversion; proposals expire after a configurable 72 h and remain readable as history; attribution is per line, in this module, written at conversion; AI drafts reach the buyer directly by default, with no rep suppression window, and `true` on the flag routes them through the shipped `AiPendingAction` plane (mechanism corrected in rev 2, §4.2); and the merge-visibility fix ships with `cart` Phase 3 rather than with this feature, because the defect it closes predates it.
