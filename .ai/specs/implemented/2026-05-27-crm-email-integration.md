# CRM Email Integration — Person-anchored send / receive via Communications Hub

## TLDR

**Key points**
- Adds per-user **send + receive email** capability to the CRM module, anchored to `CustomerPersonProfile` (the natural identifier-by-email-address entity). Deal and Company pages are explicitly out of scope for v1.
- **Approach 1 (event-driven subscriber)**: customers module subscribes to the existing hub events `communication_channels.message.received` and `communication_channels.message.sent`, resolves People by address, creates `CustomerInteraction` rows (one per match) with `interactionType='email'`. The same subscriber path handles inbound and outbound — one linking codepath.
- **Reuses existing surfaces**: `CustomerInteraction` is the timeline home (it already has `interactionType='email'` in the schema and the activity-add menu); `sendAsUser({ userChannelId, … })` is the outbound facade (already shipped on the hub); `ActivityDialog`/`ActivityTimeline`/`ActivityCard` already render the row.
- **No changes to the hub** (`communication_channels`) or `messages` module — CRM is a downstream consumer.

**Scope (v1)**
- Surface: a dedicated **Emails** tab on the Person detail page (`PersonEmailThreadsTab`, rendered via the shared `EmailThreadsPanel` from `@open-mercato/ui/backend/messages`) — a Gmail-style threaded view. Emails are also rendered as cards on the existing activity timeline. Both surfaces are **built by direct composition** in the customers module, not via UMES injection widgets (see § Architecture).
- Outbound: `<ComposeEmailDialog>` (a direct component, reached from the Emails tab's "New email" / per-thread "Reply" controls); calls `sendAsUser` with the user's connected channel; subscriber creates a linked `CustomerInteraction` on `communication_channels.message.sent`.
- Inbound: subscriber on `communication_channels.message.received`; resolves every Person whose `email` matches any of From/To/Cc; creates one `CustomerInteraction` per match. Unmatched addresses are ignored (email still lives in the unified Messages inbox).
- **Per-email visibility (strict owner-only, NO admin bypass)**: an email `CustomerInteraction` (`interactionType='email'`) defaults to `'private'` (visible only to its author — the mailbox owner, `author_user_id`). `visibility='shared'` makes it visible to ALL users with CRM access to that Person. `visibility='private'` keeps it visible to the author alone. Admins do NOT bypass this in v1 — `customers.email.view_private` is declared but **inert** (a v2-oversight hook). The owner flips a single email via `PATCH /api/customers/interactions/{id}/visibility` (owner-only; 404 to non-owners). Teammates see an opaque count of private emails on the same Person ("5 more emails (private to teammates)") but never the bodies.
- **Threading inheritance**: a reply auto-links to whatever Person the parent thread already links to, via `In-Reply-To` / `References` lookup. Survives the case where a reply's `From` is a previously-unknown address.

**Non-goals (v1)**
- Deal-page or Company-page email surfaces. Those derive trivially via the existing `CustomerDealPersonLink` / `CustomerPersonCompanyLink` join tables and are tracked as a v2 spec; v1 keeps the surface minimal.
- Bcc-to-CRM dropbox (per-user generated forwarding address).
- AI-assisted deal linking.
- Attachment send/receive — the hub adapters currently declare `fileSharing: false` after the 2026-05-26 fix pass. Attachments land when the hub flips that flag.
- New email composer features (templates, snippets, signatures beyond what the user's mailbox provides).

**Concerns**
- One queue hop between "Send" and "timeline updates" — sub-100ms on the dev queue, <500ms on Redis. Mitigated by `clientBroadcast: true` on the new `customers.email.linked` event so the Person page refetches the timeline via SSE.
- "Private by default" is a real default but the user may want a tenant-level admin toggle ("default to shared in this tenant") — this is a v1.1 follow-up.

---

## Prerequisites & Cross-Spec Dependencies

This spec assumes the following are already implemented:

| Dependency | Status | Reference |
|---|---|---|
| Communications Hub (SPEC-045d) | Implemented (current branch) | `packages/core/src/modules/communication_channels/` |
| Per-user email channels (Gmail / IMAP) | Implemented (current branch) | `packages/channel-{gmail,imap}/` + spec [`2026-05-21-email-integration-foundation.md`](2026-05-21-email-integration-foundation.md) |
| `sendAsUser({ userChannelId, … })` facade | Implemented | `packages/core/src/modules/communication_channels/api/post/send-as-user/route.ts` |
| Hub events `communication_channels.message.received` / `.sent` with `clientBroadcast: true` | Implemented | `packages/core/src/modules/communication_channels/events.ts` |
| `customers` module CRUD primitives | Implemented (reference module) | `packages/core/src/modules/customers/` |
| Shared `EmailThreadsPanel` UI | Implemented | `packages/ui/src/backend/messages/EmailThreadsPanel.tsx` |

No additional hub changes are required. Cross-tenant + per-user isolation in the hub (the user_id scoping on `CommunicationChannel` + `IntegrationCredentials`) is already in place.

---

## Overview

Open Mercato's CRM module (`customers`) currently logs emails as `CustomerInteraction` rows with `interactionType='email'` — but the existing "Compose email" affordance in `ActivitiesAddNewMenu` only writes a log entry; **no actual email leaves the system**. Sales reps must compose in their own mail client and (best case) manually copy the conversation back into the CRM as a free-text interaction. Inbound emails don't appear in the CRM at all unless someone forwards them through `inbox_ops` (a different, AI-extraction-focused pipeline).

The Communications Hub (SPEC-045d) + per-user email channels (2026-05-21 spec) close the platform gap: any user can connect Gmail / IMAP, and the platform can send + receive on their behalf. **This spec wires that capability into the CRM** so emails appear on Person timelines automatically and the user can compose without leaving the Person detail page.

> **Architectural references**: SPEC-045d (the hub contract), 2026-05-21 spec (per-user channels + `sendAsUser`), ARCHITECTURE.md §4 (a module composes its OWN pages directly — the email surface is direct composition, not UMES injection), the customers module's existing `CustomerInteraction` schema and `ActivityTimeline` render path, and the shared `EmailThreadsPanel`.

---

## Problem Statement

1. **Emails are siloed from the CRM**. Reps copy/paste threads as notes, lose context, miss recipients. The platform already has the user's mailbox connected for outbound (per the 2026-05-21 spec) — but the CRM doesn't see those sends.
2. **Inbound emails never auto-attach to the right contact**. Even when the unified Messages inbox shows a new email from a known customer, the customer's Person record stays blank unless someone manually logs the conversation.
3. **No outbound surface from the Person page**. The `ActivitiesAddNewMenu` includes an "email" option but it produces a log entry only; the platform doesn't send anything.
4. **Privacy concern when we DO sync mailboxes**. A user's personal mailbox often contains content that shouldn't auto-leak to every teammate. The CRM needs a per-email visibility model so sharing is opt-in, not the default.

---

## Proposed Solution

**Approach 1 — event-driven subscriber** (selected during brainstorming):

```
┌─────────────────────────────────────────────────────────────┐
│ CRM (customers module) — NEW code                           │
│                                                             │
│ ├ subscribers/link-channel-message.ts                       │
│ │   listens to communication_channels.message.received      │
│ │   listens to communication_channels.message.sent          │
│ │   (delegates to lib/link-channel-message-handler.ts)      │
│ │                                                           │
│ ├ api/people/[id]/emails/route.ts          (POST compose)   │
│ ├ api/people/[id]/email-threads/route.ts   (GET threads)    │
│ ├ api/interactions/[id]/visibility/route.ts (PATCH)         │
│ │                                                           │
│ ├ lib/personEmailThreads.ts  (server-side thread grouping)  │
│ ├ lib/visibilityFilter.ts    (owner-only email filter)      │
│ │                                                           │
│ ├ components/detail/PersonEmailThreadsTab.tsx  (Emails tab;  │
│ │   toolbar Refresh/New email + Connect CTA via              │
│ │   EmailThreadsPanel)                                       │
│ ├ components/detail/ComposeEmailDialog.tsx                  │
│ ├ components/detail/EmailCardActions.tsx                    │
│ ├ components/detail/EmailReplyForwardActions.tsx            │
│ │   (composed directly into ActivityCard.tsx — no widgets)  │
│ │                                                           │
│ └ events.ts: customers.email.linked  (clientBroadcast)     │
└─────────────────────────────────────────────────────────────┘
                            ▲
                            │ subscribes to (no reverse dep)
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ Communications Hub  (UNCHANGED in this spec)                │
│                                                             │
│ emits communication_channels.message.received / .sent       │
│ MessageChannelLink.channelMetadata carries From/To/Cc       │
│ sendAsUser() is the outbound facade                         │
└─────────────────────────────────────────────────────────────┘
```

The CRM is a downstream consumer; the hub stays generic. Same linking codepath for inbound (poll worker) and outbound (compose dialog).

### Design Decisions

| Decision | Rationale |
|---|---|
| **Person is the canonical anchor (not Deal or Company)** | Emails are tied to email addresses; addresses belong to People. Deal/Company surfaces in v2 derive trivially via the existing `CustomerDealPersonLink` + `CustomerPersonCompanyLink` join tables, so we don't lose anything by deferring them. Matches Pipedrive's day-to-day model. |
| **Extend `CustomerInteraction` rather than add a new entity** | The `email` `interactionType` already exists, the timeline already renders it, undo + custom fields are already wired. Adding 3 nullable columns + 2 indexes is cheaper than a parallel table + UNION ALL timeline. |
| **Event-driven subscriber (Approach 1)** | Single linking codepath for inbound + outbound. BC-clean (hub doesn't know about CRM). Threading inheritance falls out naturally. Sub-100ms latency via `clientBroadcast: true`. |
| **Auto-link every matching Person** | Multiple People can match (To: alice@x.com Cc: bob@y.com — both customers). Creating one interaction per match is the only correct option; the unique index makes it idempotent. |
| **Private-by-default visibility, per-email sharing flag, strict owner-only (NO admin bypass)** | Personal mailboxes carry non-CRM content. Default-shared would leak; always-private would break handoffs. The owner can opt a single email into `'shared'`; otherwise it stays visible to its author alone — and in v1 **not even an admin/superadmin bypasses this** (strict owner-only, matching the channel-level privacy model in `2026-05-21-email-integration-foundation.md`). `customers.email.view_private` is declared but inert; an audited v2 oversight feature will re-activate it. |
| **Direct composition for the email surface (NOT UMES injection widgets)** | The customers module owns the Person detail page, so it composes its own Emails tab, compose dialog, and email-card actions directly (ARCHITECTURE.md §4: a module composes its OWN pages directly; self-injection is an anti-pattern). UMES injection is for cross-module / third-party extension, which this is not. The originally-planned `widgets/injection/person-send-email/` and `person-email-card-actions/` were therefore never built. |
| **No raw FK across module boundary** | Per root `AGENTS.md`. `customer_interactions.external_message_id` is a UUID; the cross-module link is declared via `EntityExtension` in `customers/data/extensions.ts`. |
| **Visibility enforced at the DB layer**, not just response enricher | Defense in depth. The interactions where-builder (`lib/visibilityFilter.ts`) filters non-author private rows out at query time so they never enter the response. Enricher would still ship the row to memory and rely on serialization to redact. |

### Alternatives Considered

| Alternative | Why Rejected |
|---|---|
| **Approach 2: sync link inside `sendAsUser` wrapper** | Asymmetric (sync outbound vs async inbound = two codepaths). Couples sendAsUser's transaction to a customers table the hub shouldn't know about. The queue hop is fast enough that the sync approach has no real win. |
| **Approach 3: response enricher only, no own row** | Forces every Person GET to query MessageChannelLink. No audit trail, no undo, can't filter the activities timeline by email, no visibility flag persistence. |
| **Add Deal + Company surfaces in v1** | Tripled scope without a forcing function. Both derive from Person via existing join tables; doing them later is one PR per surface. |
| **Public-to-tenant visibility model** | Leaks personal mailbox content (NDA threads, salary, etc.) to every teammate the moment it lands in CRM. Unacceptable per the user-isolation contract. |
| **Strictly private (no sharing option)** | Breaks rep-to-rep handoff workflows. Defeats half the point of having CRM. |
| **Admin bypass on private emails (admin sees all bodies)** | Rejected for v1 in favor of strict owner-only. Auto-creating CRM rows from a user's personal mailbox and then letting admins read every body re-creates the privacy leak the visibility model exists to prevent. Team oversight is deferred to an explicit, audited v2 capability (the inert `customers.email.view_private` hook). |

> **Design evolution — the Emails tab.** This spec originally listed "a dedicated Mail tab inside CRM (Pipedrive-style)" as a non-goal and rejected alternative, on the theory that the unified Messages inbox at `/backend/messages` already covers it. During implementation the design evolved: a dedicated, Person-anchored **Emails** tab (`PersonEmailThreadsTab` via the shared `EmailThreadsPanel`) is now the intended, canonical surface. It is **not** a re-render of the global inbox — it is scoped to one Person, threads that Person's conversations Gmail-style, and enforces the owner-only visibility filter. The CRM value (anchoring to an entity) is preserved; the threaded presentation is the natural home for it. The former non-goal and rejected-alternative row are removed accordingly.

---

## User Stories

- **As a sales rep**, I want to **send an email to a contact from the Person detail page** so that **the conversation appears on their timeline without me leaving the CRM**.
- **As a sales rep**, I want **incoming replies from a known contact to appear on their Person timeline automatically** so that **I don't have to copy/paste thread context to keep records honest**.
- **As a sales rep**, I want **inbox content private by default** so that **personal correspondence (HR, salary, vendor NDAs) that happens to mention a customer doesn't auto-leak to my team**.
- **As a sales rep**, I want to **flip a single email to "share with team" when handing a contact off** so that **a teammate can read the conversation history without me forwarding it manually**.
- **As a teammate**, I want to **see that a colleague has private email history with this contact** so that **I know to ask them before reaching out cold**, without seeing the content.
- **As a privacy-conscious user**, I want **my private emails to stay private even from admins in v1** so that **personal mailbox content auto-linked into CRM is never read by anyone but me unless I explicitly share it**. (Team oversight is deferred to an explicit, audited v2 capability — see the design-evolution note in § Proposed Solution. `customers.email.view_private` is declared but inert in v1 and grants no read/write bypass.)

---

## Architecture

### File layout

The email surface is built by **direct composition** in the customers module — no UMES injection widgets (see the design decision in § Proposed Solution). The shipped layout:

```
packages/core/src/modules/customers/
  api/
    interactions/
      [id]/
        visibility/
          route.ts                            # PATCH visibility (private | shared) — owner-only, 404 to non-owner, NO admin bypass
    people/
      [id]/
        emails/
          route.ts                            # POST compose+send
        email-threads/
          route.ts                            # GET threaded list (the Emails tab reads THIS)
  components/
    detail/
      PersonEmailThreadsTab.tsx               # Emails tab — Gmail-style threaded view via EmailThreadsPanel; owns the Refresh / New email toolbar, the compose entry point, and the no-channel "Connect your mailbox" CTA
      ComposeEmailDialog.tsx                  # modal (mirrors ActivityDialog UX)
      EmailCardActions.tsx                    # actions on an email timeline card
      EmailReplyForwardActions.tsx            # Reply / Reply All / Forward action menu
      ActivityCard.tsx                        # composes EmailCardActions / EmailReplyForwardActions directly
  data/
    extensions.ts                             # NEW EntityExtension: customer_interaction.external_message_id → communication_channels:message_channel_link
  events.ts                                   # extended with `customers.email.linked`
  lib/
    personEmailThreads.ts                     # server-side thread grouping (backs GET email-threads); owner-only scoped
    visibilityFilter.ts                       # applyEmailVisibilityFilter / buildEmailVisibilityMikroFilter — owner-only, no admin bypass
    link-channel-message-handler.ts           # shared linking logic invoked by the subscriber (inbound + outbound, threading inheritance)
  migrations/
    Migration20260527<HHmmss>_customers_email_integration.ts
  subscribers/
    link-channel-message.ts                   # on .message.received + .message.sent (delegates to lib/link-channel-message-handler.ts)
  __integration__/
    TC-CRM-EMAIL-001.spec.ts                  # outbound E2E: send creates private interaction + cross-user filtering (currently test.skip; un-skipped via the channel-seeding fixture)
    TC-CRM-EMAIL-002.spec.ts                  # inbound: auto-link by From               (to be written)
    TC-CRM-EMAIL-003.spec.ts                  # multi-match: To+Cc → 3 interactions       (to be written)
    TC-CRM-EMAIL-004.spec.ts                  # no-match: 0 interactions, still in Messages inbox (to be written)
    TC-CRM-EMAIL-005.spec.ts                  # threading inheritance via In-Reply-To      (to be written)
    TC-CRM-EMAIL-006.spec.ts                  # visibility flip: owner flips; non-owner AND admin both blocked (404), owner-only
    TC-CRM-EMAIL-007.spec.ts                  # no-channel-connected UX state
    TC-CRM-EMAIL-VISIBILITY-001.spec.ts       # strict owner-only read filter on email interactions (no admin bypass)
```

### Module-graph compliance

The email surface is composed directly into the existing Person detail page (`backend/customers/people-v2/[id]/page.tsx`) — no new injection widgets and no `apps/mercato/src/modules.ts` change. Run `yarn mercato configs cache structural --all-tenants` after the change as a matter of course (per root AGENTS.md mandate after backend page changes) to refresh `nav:*` cache and Turbopack module-graph fingerprints.

### OSS independence

`@open-mercato/core` (customers module) MUST NOT import from `@open-mercato/enterprise`. Grep verification in Phase 1 acceptance:
```bash
grep -r "@open-mercato/enterprise" packages/core/src/modules/customers/
# Expected: only pre-existing matches unrelated to this spec
```

### Outbound flow (compose)

```
Person detail page → Emails tab → "New email" (or per-thread "Reply") control
  (PersonEmailThreadsTab via EmailThreadsPanel — a direct component, NOT an injection widget)
  ↓ (user has ≥1 connected, status='connected' channel; otherwise the control is replaced with a Connect CTA)
ComposeEmailDialog (modal — a direct component)
  • To prefilled = person.email; user can edit; can add Cc/Bcc
  • Subject + body (rich-text editor primitive)
  • "Send as" dropdown — user's connected channels; defaults to primary, persists last choice
  • Visibility radio: "Private to me" (default) / "Visible to teammates"
  • Cmd/Ctrl+Enter submit; Esc cancel
  ↓
POST /api/customers/people/{personId}/emails
  body (flat): { userChannelId, to, cc?, subject, body, bodyFormat, visibility,
                 inReplyTo?, references?, parentMessageId? }
  ↓
Route handler:
  1. Loads person; verifies person.tenantId === auth.tenantId
  2. Loads channel; verifies channel.userId === auth.sub (per-user enforcement; the hub also checks but we double-up)
  3. Calls sendAsUser({ userChannelId, to, cc, subject, body, bodyFormat, inReplyTo, references,
                        channelMetadata: { crmVisibility: visibility, crmPersonId: personId } })
  ↓
Hub creates Message + emits messages.message.sent
  ↓
Hub outbound-delivery subscriber forwards via channel adapter
  ↓
Hub emits communication_channels.message.sent (clientBroadcast: true — already configured)
  ↓
customers/subscribers/link-channel-message.ts fires (persistent subscriber → lib/link-channel-message-handler.ts)
  • Re-fetches MessageChannelLink + Message by messageId
  • Reads channelMetadata.crmVisibility (defaults to 'private' if absent)
  • Collects To/Cc addresses + the explicit crmPersonId hint
  • Resolves matching People by address (tenant-scoped, lowercased) — also honors crmPersonId hint
  • For each matched Person, INSERT INTO customer_interactions … ON CONFLICT DO NOTHING
  • Emits customers.email.linked once per (person, message) row created
  ↓
Browser SSE bridge (clientBroadcast) → Emails tab / timeline live-refresh (useAppEvent)
```

### Inbound flow (auto-link)

```
External mailbox receives email
  ↓
Hub poll worker (channel-{gmail,imap})
  ↓
Hub inbound-processor: creates Message + MessageChannelLink + ExternalMessage; emits communication_channels.message.received
  ↓
customers/subscribers/link-channel-message.ts fires (persistent → lib/link-channel-message-handler.ts)
  • Re-fetches MessageChannelLink by messageChannelLinkId; reads channelMetadata
  • Extracts addresses: lowercase, dedupe, normalize From / To / Cc
  • Resolves matching People by address (tenant-scoped)
  • For each matched Person:
      INSERT INTO customer_interactions
        (entity, external_message_id, visibility='private',
         interaction_type='email', author_user_id=channel.userId,
         subject, body, occurred_at=link.createdAt, channel_provider_key, …)
      ON CONFLICT (entity, external_message_id) WHERE deleted_at IS NULL DO NOTHING
  • Threading inheritance:
      - Read In-Reply-To + References from channelMetadata.headers (these are RFC 5322
        Message-ID strings like '<abc@example.com>')
      - Look up MessageChannelLink rows in this tenant where
        channelMetadata.messageId matches ANY of those Message-IDs (JSONB query;
        narrow by tenant + provider_key for selectivity)
      - For each matching parent MessageChannelLink, find CustomerInteraction rows
        with external_message_id = parent.id
      - For each such parent interaction, also INSERT INTO customer_interactions
        with entity = parent.entity for THIS message (deduped via the unique index
        so we don't double-link if the address match already produced a row)
      - Net effect: replies stay on the right Person's timeline even when the
        sender of the reply is a previously-unknown address
  • Emits customers.email.linked per row created
  • If zero matches → no-op; email stays in Messages inbox but not in CRM
```

### Visibility enforcement (strict owner-only, layers of defense)

**v1 is strict owner-only with NO admin bypass.** A `private` email `CustomerInteraction` is visible to its author (`author_user_id` = the mailbox owner) and to no one else — not even an admin or superadmin. A `shared` email is visible to every user with CRM access to the Person. This matches the channel-level privacy model in `2026-05-21-email-integration-foundation.md`. `customers.email.view_private` is declared but **inert** in v1 (a v2-oversight hook that grants no read/write bypass today).

**Layer 1 — DB filter** (`customers/lib/visibilityFilter.ts`)

Every read path that returns email `customer_interactions` applies the owner-only filter (`applyEmailVisibilityFilter` for query-builder paths / `buildEmailVisibilityMikroFilter` for MikroORM paths). The predicate, in effect:
```
(interaction_type != 'email')
  OR (visibility = 'shared')
  OR (visibility = 'private' AND author_user_id = currentUserId)
```
There is **no admin-bypass branch** — the filter applies uniformly to every caller, admins included. Wired into the interactions list (`customers/api/interactions/route.ts`), interaction counts, the activities timeline, the person/company detail read models, and the Person Emails-tab thread grouping (`customers/lib/personEmailThreads.ts`, which additionally scopes threads to `author_user_id = viewer` and stays fail-closed when authorship can't be established).

**Layer 2 — Owner-only guard on PATCH visibility**

`PATCH /api/customers/interactions/{id}/visibility` returns 404 (not 403, to avoid leaking existence) when `interaction.author_user_id !== currentUser.id`. **Admins are also returned 404** — holding `customers.email.view_private` grants no bypass in v1. The route also 404s when `interaction_type !== 'email'` (visibility is meaningless on calls/meetings/tasks). Even loading the row to inspect `author_user_id` goes through `findOneWithDecryption` with the visibility filter, so a non-author can never see the row in the first place.

**Layer 3 — Subscriber audit**

`link-channel-message.ts` (via `lib/link-channel-message-handler.ts`) always sets `author_user_id = channel.userId` (the mailbox owner) and `visibility = 'private'` for personal channels. For tenant-scoped channels (no `userId` — e.g. WhatsApp / shared inboxes), `visibility` defaults to `'shared'` because there is no "owner" to keep it private to.

**Teammate-visible private count** (UX honesty)

A small response enricher on the Person detail GET counts non-author private emails:
```sql
SELECT COUNT(*) FROM customer_interactions
WHERE entity = $personId
  AND interaction_type = 'email'
  AND tenant_id = $tenantId
  AND deleted_at IS NULL
  AND visibility = 'private'
  AND author_user_id != $currentUserId
```
Surfaced on the Person header as "5 emails private to teammates". Metadata only — never content, and the count is shown to admins exactly as to any other teammate (admins do not see the underlying bodies in v1).

---

## Data Models

This spec adds **zero new tables**. All deltas are additive columns on the existing `customer_interactions` table.

### `customer_interactions` (extended)

```sql
-- Illustrative — generated by `yarn db:generate`
ALTER TABLE customer_interactions
  ADD COLUMN external_message_id UUID NULL,    -- linked to communication_channels:message_channel_link via EntityExtension
  ADD COLUMN visibility TEXT NULL,             -- 'private' | 'shared' for email rows; NULL for non-email rows
  ADD COLUMN channel_provider_key TEXT NULL;   -- 'gmail' | 'imap' — denormalized for filter UX

CREATE INDEX customer_interactions_external_msg_idx
  ON customer_interactions (external_message_id)
  WHERE external_message_id IS NOT NULL;

CREATE UNIQUE INDEX customer_interactions_email_dedupe_uq
  ON customer_interactions (entity, external_message_id)
  WHERE external_message_id IS NOT NULL AND deleted_at IS NULL;

-- Optional but recommended: index for the per-user visibility filter
CREATE INDEX customer_interactions_email_visibility_idx
  ON customer_interactions (entity, interaction_type, visibility, author_user_id)
  WHERE interaction_type = 'email' AND deleted_at IS NULL;
```

The partial unique index `customer_interactions_email_dedupe_uq` makes the subscriber idempotent: on re-delivery of the same hub event, the second INSERT is silently swallowed via `ON CONFLICT DO NOTHING`.

### `data/extensions.ts` (customers module)

```ts
import type { EntityExtension } from '@open-mercato/shared/modules/extensions'

export const extensions: EntityExtension[] = [
  {
    from: 'customers:customer_interaction',
    field: 'external_message_id',
    to: 'communication_channels:message_channel_link',
    kind: 'one-to-one-optional',
  },
]
```

The dependency direction is customers → communication_channels (downstream consumer), never the reverse.

### Existing entities — unchanged

`CustomerPersonProfile`, `CustomerCompanyProfile`, `CustomerDeal`, `CustomerActivity`, `MessageChannelLink`, `Message` — all untouched.

---

## API Contracts

All routes export per-method `metadata` with `requireAuth` + `requireFeatures` and `export default <METHOD>` (per packages/core/AGENTS.md). All routes export `openApi`. Custom write routes wire `validateCrudMutationGuard` + `runCrudMutationGuardAfterSuccess`.

### `POST /api/customers/people/{personId}/emails`
- **Features**: `customers.email.compose`
- **Body**:
  ```ts
  z.object({
    userChannelId: z.string().uuid(),
    to: z.array(z.string().email()).min(1).max(50),
    cc: z.array(z.string().email()).max(50).optional(),
    bcc: z.array(z.string().email()).max(50).optional(),
    subject: z.string().min(1).max(500),
    body: z.string().min(1).max(500_000),
    bodyFormat: z.enum(['text', 'html']).default('html'),
    visibility: z.enum(['private', 'shared']).default('private'),
    inReplyTo: z.string().optional(),       // for Reply / Reply All
    references: z.array(z.string()).optional(),
  })
  ```
- **Server**:
  1. Verify `person.tenantId === auth.tenantId` (404 otherwise — don't leak existence).
  2. Verify `channel.userId === auth.sub` AND `channel.status === 'connected'` (409 otherwise).
  3. Call `sendAsUser({ userChannelId, …, channelMetadata: { crmVisibility, crmPersonId } })`.
  4. Return `{ messageId, status }`. The interaction row is created asynchronously by the subscriber; the response doesn't wait for it.
- **Errors**: 401 (no auth), 403 (no feature), 404 (person not found or wrong tenant), 409 (channel not connected / not owner), 422 (body validation), 502 (provider error from sendAsUser).

### `GET /api/customers/people/{personId}/email-threads` — the Emails tab data source

The Emails tab reads a **dedicated threaded endpoint** (not the generic `GET /api/customers/interactions` list and not a planned `GET .../emails`). The route groups the Person's email interactions into Gmail-style conversations server-side via `customers/lib/personEmailThreads.ts`.
- **Features**: `customers.people.view` + `customers.email.compose`
- **Response**: `{ threads: [...] }` — one entry per conversation (subject, participants, last activity, message count, ordered messages with direction + headers).
- **Visibility**: applies the owner-only filter (`personEmailThreads.ts` scopes to `author_user_id = viewer` plus ownerless shared rows; fail-closed when authorship is unestablished). **No admin bypass.**

The generic `GET /api/customers/interactions?entityId={personId}&interactionType=email` list still exists and also applies the Layer 1 owner-only filter (`applyEmailVisibilityFilter`), but the Emails tab does not depend on it. The opaque `privateCount` for the Person header is exposed via a **response enricher on the Person detail GET** (see § Phase 4).

### `PATCH /api/customers/interactions/{interactionId}/visibility`
- **Features**: `customers.email.compose` (the same feature that lets you create one)
- **Body**: `z.object({ visibility: z.enum(['private', 'shared']) })`
- **Server**:
  1. Load interaction with the Layer 1 owner-only visibility filter applied; 404 if not visible to caller. The route also verifies `interaction_type = 'email'` and 404s otherwise (this route is email-only; visibility is meaningless on calls/meetings/tasks).
  2. Verify `interaction.author_user_id === auth.sub`. 404 otherwise. **This is strict owner-only: an admin holding `customers.email.view_private` is also returned 404 in v1 — that feature grants no bypass.**
  3. Update `visibility`. Emit `customers.email.visibility_changed` event (additive).
- **Errors**: 401, 403, 404, 422.

The route lives under `customers/api/interactions/[id]/visibility/route.ts` (not under a virtual `customer-emails` resource) because the underlying entity is a `CustomerInteraction`.

### Internal — no new public-facing routes for the subscriber path

`customers.email.linked` is the new event ID. Declared in `customers/events.ts`:
```ts
{ id: 'customers.email.linked',
  label: 'Email linked to Person',
  category: 'crud',
  clientBroadcast: true }      // browser SSE for live timeline refresh
{ id: 'customers.email.visibility_changed',
  label: 'Email visibility changed',
  category: 'lifecycle',
  clientBroadcast: true }
```

### `OpenAPI` exports

All three new routes (`POST .../emails`, `GET .../email-threads`, `PATCH .../interactions/{id}/visibility`) export an `openApi` block per `packages/core/AGENTS.md`. Ad-hoc shapes for the compose POST, the threaded GET, and the visibility PATCH.

---

## I18n

Per `packages/shared/AGENTS.md`. New keys live in the customers module's `i18n/{en,pl,es,de}.json`.

Required namespaces:
- `customers.email.compose.title` / `.send` / `.cancel`
- `customers.email.compose.to` / `.cc` / `.bcc` / `.subject` / `.body`
- `customers.email.compose.sendAs` / `.visibility.private` / `.visibility.shared`
- `customers.email.compose.noChannel.cta` / `.noChannel.title`
- `customers.email.timeline.privateCount` (e.g. "%{count} emails private to teammates")
- `customers.email.timeline.replyAll` / `.forward` / `.reply`
- `customers.email.visibility.flipToShared.success` / `.flipToPrivate.success`
- `customers.email.errors.channelNotConnected` / `.recipientRequired` / `.sendFailed`

Use `useT()` client-side, `resolveTranslations()` server-side. The `yarn i18n:check-sync` gate enforces parity across the 4 locales.

---

## UI/UX

All of the following are **directly composed** into the Person detail page (`backend/customers/people-v2/[id]/page.tsx`) — there are no UMES injection widgets for the email surface (see § Proposed Solution).

- **Emails tab** (`PersonEmailThreadsTab`): a dedicated tab alongside Notes/Activities/Deals/Addresses/Tasks. Renders the shared `EmailThreadsPanel` (`@open-mercato/ui/backend/messages`) — a Gmail-style threaded view (thread list left, conversation right), backed by `GET /api/customers/people/{id}/email-threads`. This is the **single email entry point**: the panel's toolbar exposes "Refresh" and "New email" (compose via `ComposeEmailDialog`). A duplicate top-of-page "Sync / Send email" button pair (the `PersonEmailActions` header component) that previously sat in the page header **has been removed** in this PR as a duplicate, so the Emails tab is the only place to compose.
- **No-channel state**: when the current user has no connected channel, the "New email" / "Reply" controls are hidden and a "Connect your mailbox" link to `/backend/profile/communication-channels` is shown instead.
- **Email row on activity timeline**: uses the existing `ActivityCard` rendering. Subject + sender (or first recipient for outbound) + body preview. Icon: `<Mail>` with `bg-status-info-soft text-status-info-fg` semantic tokens. `ActivityCard.tsx` composes `EmailCardActions` / `EmailReplyForwardActions` directly.
- **Email body rendering**: bodies are shown as text in v1 (HTML rendering via a sanitized renderer is deferred; see TC-CRM-EMAIL-010 notes).
- **Reply / Reply All / Forward**: reuse `ComposeEmailDialog` with pre-filled `inReplyTo`, `references`, `parentMessageId`, To/Cc/Subject (`Re: …` / `Fwd: …`) so the reply joins the same thread. One component, three entry points — all direct component actions on the email card (`EmailReplyForwardActions`), not injection-widget actions.
- **Visibility toggle**: a small lock/people icon on each email card. Click → confirm dialog → `PATCH .../interactions/{id}/visibility`. Shown **only to the author** (Layer 2 owner-only). There is no admin-override affordance in v1 — admins do not get a cross-user visibility control.

### Compose dialog UX

- Modal (matches `ActivityDialog` UX).
- Cmd/Ctrl+Enter submit, Esc cancel.
- "Send as" dropdown — populates from `GET /api/communication_channels/me/channels` (already shipped). Defaults to the user's primary channel; remembers last choice via localStorage scoped by `tenantId`.
- Visibility radio: "Private to me" (default) / "Visible to teammates". A small inline tooltip explains the difference.
- All icon-only buttons have `aria-label`.
- Loading state during send (button → spinner). On success: modal closes, flash message "Email sent". On failure: stays open, flash message with error.

### Frontend Architecture Contract

- **Server / Client boundary**:
  - `people-v2/[id]/page.tsx` — already a client component (existing).
  - `PersonEmailThreadsTab.tsx` — client component (new); renders `EmailThreadsPanel` and owns the toolbar + Connect CTA.
  - `ComposeEmailDialog.tsx` — client component (new). ~10 KB gzipped.
  - `EmailCardActions.tsx` / `EmailReplyForwardActions.tsx` — client components (new), composed into `ActivityCard.tsx`.
- **No new global providers**.
- **Client bundle guardrail**: no provider SDK in the client bundle (no googleapis, no imapflow/nodemailer). Server-side only.
- **Route budget**: Person detail page adds <15 KB gzipped (well within the existing route's headroom).
- **Hydration test**: Person detail Playwright test (TC-CRM-EMAIL-010) asserts the Emails tab renders and its compose/reply controls are interactive.

---

## Configuration

No new env vars. The existing hub env (`OM_HUB_OAUTH_STATE_KEY`, `OM_HUB_POLL_*`) covers everything the CRM consumes downstream.

---

## Migration & Backward Compatibility

| Surface | Change | Impact |
|---|---|---|
| `customer_interactions` table | 3 additive nullable columns + 2 indexes + 1 unique-partial index | None on existing rows; legacy interactions keep null in the new columns. |
| `customer_interactions` API | 3 new optional fields surfaced (external_message_id, visibility, channel_provider_key) | Additive; existing clients ignore new fields. |
| New events | `customers.email.linked` + `customers.email.visibility_changed` | Additive event IDs; existing subscribers unaffected. |
| New ACL features | `customers.email.compose` + `customers.email.view_private` | Additive. `customers.email.compose` default-granted to `admin` + `employee` + `manager`; `view_private` default-granted to `admin` only. Run `yarn mercato auth sync-role-acls` on deploy. |
| New API routes | `POST /api/customers/people/{id}/emails`, `GET /api/customers/people/{id}/email-threads`, `PATCH /api/customers/interactions/{id}/visibility` | New paths only; no existing routes renamed. |
| `EntityExtension` declaration | New entry in `customers/data/extensions.ts` | Additive. |
| `customers/setup.ts` | New `defaultRoleFeatures` entries for the two new features | Additive. |
| Hub module (`communication_channels`) | **No changes** | None. |
| Messages module | **No changes** | None. |
| Existing `ActivityCard` | Extended in place to compose `EmailCardActions` / `EmailReplyForwardActions` (direct composition; no new widgets) | None on non-email cards. |

No deprecations. No data migration of existing rows (the dedupe partial unique index applies only to rows where `external_message_id IS NOT NULL`, so legacy email log interactions are untouched).

After deploy: run `yarn mercato auth sync-role-acls` to grant the two new features to existing tenants, then `yarn mercato configs cache structural --all-tenants` to refresh the nav/module-graph caches after the Person-page composition change.

---

## Implementation Plan

> Each phase ships its own module-local `__integration__/TC-CRM-EMAIL-*.spec.ts`. No phase is marked complete without its integration tests passing.

### Phase 1 — Schema + helper + subscriber (inbound)

**Goal**: any inbound email auto-links to matching People; no compose UI yet.

1. Add 3 additive columns + 2 indexes via `data/entities.ts`; generate scoped migration via `yarn db:generate` and update `migrations/.snapshot-open-mercato.json`.
2. Add `data/extensions.ts` declaring the cross-module link.
3. Add address-resolution logic (case-insensitive, tenant-scoped, batched) used by the linking handler.
4. Add `lib/visibilityFilter.ts` (`applyEmailVisibilityFilter` / `buildEmailVisibilityMikroFilter` — strict owner-only, no admin bypass) and wire into the existing `customers/api/interactions/route.ts` GET.
5. Add `subscribers/link-channel-message.ts` (delegating to `lib/link-channel-message-handler.ts`) listening to `communication_channels.message.received` only (outbound side comes in Phase 2).
6. Add `customers.email.linked` event to `events.ts` with `clientBroadcast: true`.
7. Add `customers.email.compose` + `customers.email.view_private` to `acl.ts` + `setup.ts` `defaultRoleFeatures`. `view_private` is declared but inert in v1. Run `yarn mercato auth sync-role-acls` on deploy.
8. Unit tests:
   - address resolution: empty, mixed case, multi-match, tenant-scoped, normalization.
   - `link-channel-message-handler` (inbound only): 1-match / 3-match / 0-match / no tenantId fail-closed / idempotent retry / threading inheritance.
   - `visibilityFilter`: own private visible, others' private hidden, shared visible to all, **admin NOT bypassed (others' private stays hidden for admins too)**.
9. Module-local integration tests:
   - `TC-CRM-EMAIL-002`: hub emits `message.received` → interaction created on Person timeline.
   - `TC-CRM-EMAIL-003`: To+Cc with 3 known People → 3 interactions.
   - `TC-CRM-EMAIL-004`: no-match → 0 interactions; email still in Messages inbox.
   - `TC-CRM-EMAIL-005`: reply auto-links via In-Reply-To chain.
10. **Acceptance gates**:
    - `yarn typecheck` + `yarn test` + `yarn i18n:check-sync` + `yarn build:packages` all pass.
    - Integration tests above pass against real Postgres + Redis.
    - `grep -r "@open-mercato/enterprise" packages/core/src/modules/customers/` returns no new matches.

### Phase 2 — Outbound compose API + subscriber outbound branch

**Goal**: user can compose+send from a Person page; outbound emails auto-link.

1. Add `api/customers/people/[id]/emails/route.ts` (POST compose, flat body) + `api/customers/people/[id]/email-threads/route.ts` (GET threaded list, backed by `lib/personEmailThreads.ts`) with full zod validation + mutation guard.
2. Extend `link-channel-message.ts` (via the shared handler) to also handle `communication_channels.message.sent` (reads `channelMetadata.crmVisibility` and `crmPersonId` hint).
3. Add `customers.email.compose` feature wiring (already in `acl.ts` from Phase 1; here we use it on the POST route).
4. Unit tests:
   - Compose route validation (zod): rejects 0 recipients, oversized body, missing subject, missing userChannelId.
   - Compose route auth: 404 on wrong-tenant person, 409 on disconnected channel.
   - `link-channel-message.test.ts` (outbound branch): visibility propagation, crmPersonId hint takes precedence over address match when present.
5. Module-local integration tests:
   - `TC-CRM-EMAIL-001` outbound end-to-end: User A sends → interaction with `visibility='private'` + `author_user_id=A` created → User A sees it; User B's GET on same Person returns the interaction filtered out + `privateCount=1`.
6. **Acceptance**: User can compose+send against a real (stubbed or env-gated) Gmail/IMAP account; the timeline updates within 1s of send (via clientBroadcast SSE).

### Phase 3 — Emails tab + compose / reply UI (direct composition)

**Goal**: full UI on the Person detail page, composed directly (no injection widgets).

1. Add `components/detail/ComposeEmailDialog.tsx` (modal, mirrors `ActivityDialog`).
2. Add `components/detail/PersonEmailThreadsTab.tsx` (renders the shared `EmailThreadsPanel`, which provides the Refresh / New email toolbar and swaps to a Connect CTA when the user has no connected channel). Wire the Emails tab directly into `backend/customers/people-v2/[id]/page.tsx`.
3. Add `components/detail/EmailReplyForwardActions.tsx` + `components/detail/EmailCardActions.tsx` and compose them directly into `ActivityCard.tsx` for Reply / Reply All / Forward.
4. Email body rendered as text in v1 (sanitized-HTML renderer deferred).
5. Add i18n keys in all 4 locales.
6. Run `yarn mercato configs cache structural --all-tenants` to refresh nav/module-graph caches after the page composition change.
7. Unit tests: ComposeEmailDialog form validation; Reply/Forward pre-fill correctness; `ActivityCard` email-action rendering.
8. Module-local integration tests:
   - `TC-CRM-EMAIL-007` no-channel UX: user without connected channel sees Connect CTA; user with connected channel sees the New email control.
   - `TC-CRM-EMAIL-010` (QA scenario) covers the Emails-tab thread UI + compose/reply wiring.
9. **Acceptance**: end-to-end compose works in a browser preview against a connected Gmail account.

### Phase 4 — Visibility toggle UI + private-count enricher + docs

**Goal**: per-email sharing UX (strict owner-only) + user-facing docs.

1. Add `PATCH /api/customers/interactions/{id}/visibility` route with the owner-only mutation guard (no admin bypass).
2. Add the visibility-toggle icon to the email card (`EmailCardActions`) — shown to the author only; no admin-override affordance in v1.
3. Add the private-count response enricher on the Person detail GET.
4. Emit `customers.email.visibility_changed` event on each flip.
5. Module-local integration tests:
   - `TC-CRM-EMAIL-006` visibility lifecycle: non-author cannot flip (404), author flips private→shared, teammate now sees it, no-op flip returns `changed: false`, **an admin holding `customers.email.view_private` is ALSO blocked (404) — strict owner-only**, author restores.
   - `TC-CRM-EMAIL-VISIBILITY-001`: the owner-only read filter hides another user's private email from a non-author (admins included).
6. Add user-facing doc at `apps/docs/docs/user-guide/customers-email.mdx`: connect mailbox → send email from Person → understanding private vs shared (strict owner-only; no admin bypass in v1) → reply/forward workflow.
7. Add developer doc snippet to `packages/core/src/modules/customers/AGENTS.md` describing the new subscriber + owner-only visibility model so future entity-anchored email work knows the pattern.
8. **Acceptance**: integration tests pass; docs reviewed.

### File Manifest

| File | Action | Phase |
|---|---|---|
| `packages/core/src/modules/customers/data/entities.ts` | Extend `CustomerInteraction` with 3 columns | 1 |
| `packages/core/src/modules/customers/data/extensions.ts` | Add EntityExtension | 1 |
| `packages/core/src/modules/customers/migrations/Migration20260527…_customers_email_integration.ts` | Create | 1 |
| `packages/core/src/modules/customers/migrations/.snapshot-open-mercato.json` | Update | 1 |
| `packages/core/src/modules/customers/lib/link-channel-message-handler.ts` | Create (shared linking + address resolution + threading inheritance) | 1 |
| `packages/core/src/modules/customers/lib/visibilityFilter.ts` | Create (`applyEmailVisibilityFilter` / `buildEmailVisibilityMikroFilter` — owner-only) | 1 |
| `packages/core/src/modules/customers/api/interactions/route.ts` | Wire `applyEmailVisibilityFilter` into where-builder | 1 |
| `packages/core/src/modules/customers/subscribers/link-channel-message.ts` | Create (inbound branch; delegates to handler) | 1 |
| `packages/core/src/modules/customers/events.ts` | Add 2 events | 1 |
| `packages/core/src/modules/customers/acl.ts` | Add 2 features (`view_private` inert in v1) | 1 |
| `packages/core/src/modules/customers/setup.ts` | Add `defaultRoleFeatures` | 1 |
| `packages/core/src/modules/customers/api/people/[id]/emails/route.ts` | Create (POST compose) | 2 |
| `packages/core/src/modules/customers/api/people/[id]/email-threads/route.ts` | Create (GET threaded list) | 2 |
| `packages/core/src/modules/customers/lib/personEmailThreads.ts` | Create (server-side thread grouping; owner-only scoped) | 2 |
| `packages/core/src/modules/customers/subscribers/link-channel-message.ts` | Extend (outbound branch) | 2 |
| `packages/core/src/modules/customers/components/detail/ComposeEmailDialog.tsx` | Create | 3 |
| `packages/core/src/modules/customers/components/detail/PersonEmailThreadsTab.tsx` | Create (Emails tab via `EmailThreadsPanel`; provides the Refresh / New email toolbar, compose entry point, and no-channel Connect CTA) | 3 |
| `packages/core/src/modules/customers/components/detail/EmailReplyForwardActions.tsx` | Create | 3 |
| `packages/core/src/modules/customers/components/detail/EmailCardActions.tsx` | Create | 3 |
| `packages/core/src/modules/customers/components/detail/ActivityCard.tsx` | Modify (compose email-card actions directly) | 3 |
| `packages/core/src/modules/customers/backend/customers/people-v2/[id]/page.tsx` | Modify (add Emails tab) | 3 |
| `packages/core/src/modules/customers/i18n/{en,pl,es,de}.json` | Add ~20 keys per locale | 3 |
| `packages/core/src/modules/customers/api/interactions/[id]/visibility/route.ts` | Create (owner-only) | 4 |
| `packages/core/src/modules/customers/data/enrichers.ts` | Add private-count enricher | 4 |
| `apps/docs/docs/user-guide/customers-email.mdx` | Create | 4 |
| `packages/core/src/modules/customers/__integration__/TC-CRM-EMAIL-{001..007}.spec.ts` + `TC-CRM-EMAIL-VISIBILITY-001.spec.ts` | Create across phases | 1–4 |

---

## Testing Strategy

**Unit (Jest)** — colocated with each new file in `__tests__/`. Per phase, see Implementation Plan.

**Integration (Playwright)** — module-local in `customers/__integration__/`. Target state of the suite:

| Test | Asserts | Status |
|---|---|---|
| `TC-CRM-EMAIL-001` | outbound E2E: send → subscriber → private interaction (`author_user_id=A`); User A sees it, User B's GET filters it out + sees `privateCount=1` | Exists, currently `test.skip`; **to be un-skipped** via the new channel-seeding fixture |
| `TC-CRM-EMAIL-002` | inbound auto-link by From → interaction on Person timeline | **To be written** |
| `TC-CRM-EMAIL-003` | multi-match (To+Cc, 3 known People) → 3 interactions | **To be written** |
| `TC-CRM-EMAIL-004` | no-match → 0 interactions; email still in Messages inbox | **To be written** |
| `TC-CRM-EMAIL-005` | reply auto-links via In-Reply-To / References chain (threading inheritance) | **To be written** |
| `TC-CRM-EMAIL-006` | visibility lifecycle: non-author blocked (404), author flips private→shared, no-op flip `changed:false`, **admin holding `customers.email.view_private` ALSO blocked (404) — strict owner-only**, author restores | Exists (already asserts owner-only) |
| `TC-CRM-EMAIL-007` | no-channel-connected UX state | Exists |
| `TC-CRM-EMAIL-VISIBILITY-001` | strict owner-only read filter: another user's private email is hidden from a non-author (admins included) | Exists |
| `/email-threads` visibility test | the threaded endpoint scopes to the viewer's own + ownerless shared threads; no admin bypass | **To be added** |

QA scenario markdowns live in `.ai/qa/scenarios/TC-CRM-EMAIL-*.md`. `TC-CRM-EMAIL-010-person-thread-ui.md` (Emails-tab presentation + compose/reply) is present; markdowns for `TC-CRM-EMAIL-001..007` and `TC-CRM-EMAIL-VISIBILITY-001` are still to be authored alongside the to-be-written specs.

**Cross-cutting**: customers cross-tenant isolation tests assert an email-linked interaction is never visible to a different tenant's GET. The Person-detail Emails-tab render is covered by `TC-CRM-EMAIL-010`.

---

## Risks & Impact Review

### Data integrity

#### Duplicate interaction rows on event re-delivery
- **Scenario**: hub event bus re-delivers `communication_channels.message.received` after a transient failure; subscriber runs twice.
- **Severity**: Medium
- **Mitigation**: Partial unique index `customer_interactions_email_dedupe_uq` on `(entity, external_message_id)`. Subscriber uses `INSERT … ON CONFLICT DO NOTHING`.
- **Residual risk**: None.

#### Threading inheritance loops on circular reference chains
- **Scenario**: a malformed inbound email has a References header that points back at itself.
- **Severity**: Low
- **Mitigation**: References lookup is bounded to a single SQL query (no recursive walk); no cycle is possible because we don't traverse multi-hop.
- **Residual risk**: None.

### Tenant + user isolation

#### Cross-tenant Person leakage via address match
- **Scenario**: subscriber resolves Person by email; a Person in tenant A and tenant B share the same email address.
- **Severity**: Critical
- **Mitigation**: `findPeopleByAddresses` always filters by tenantId. The email arrives via a per-tenant channel, so the subscriber knows which tenant scope to use. Integration test verifies cross-tenant assertion.
- **Residual risk**: None at DB layer; defense in depth via per-route audit.

#### Cross-user email content leakage via shared interaction row
- **Scenario**: User A's private email appears on a Person's timeline; User B opens the Person; sees A's email body.
- **Severity**: Critical
- **Mitigation**: 3-layer enforcement (DB filter at query time + mutation guard on PATCH + subscriber audit on every linked-row insert). Integration test verifies User B does NOT receive the row, only the opaque count.
- **Residual risk**: None at DB layer; defense in depth via per-route audit.

#### Mistakenly-shared email via mis-click
- **Scenario**: User A clicks the wrong button and shares an email to teammates that should have stayed private.
- **Severity**: Medium
- **Mitigation**: Confirm dialog on share / unshare; the PATCH route emits `customers.email.visibility_changed`. The **author** can flip it back to private at any time (strict owner-only — an admin cannot revert it on the author's behalf in v1, since admins have no cross-user visibility control).
- **Residual risk**: Operator UX issue, not a security issue. The confirm dialog reduces but doesn't eliminate it.

### Cascading failures

#### CRM subscriber failure blocks event bus
- **Scenario**: `link-channel-message` throws on every event; hub event bus retries indefinitely.
- **Severity**: Medium
- **Mitigation**: Subscriber is `persistent: true`. Errors are caught, logged at the command level, and the subscriber returns success after MAX_RETRIES = 3 with audit. Hub's event-bus dead-letter queue catches the rest.
- **Residual risk**: Sustained failures pile up in the DLQ; alert on DLQ size.

#### Compose route hangs on slow hub
- **Scenario**: `sendAsUser` takes >30s because the user's provider is rate-limiting.
- **Severity**: Low
- **Mitigation**: Compose route returns 502 with the hub's error after the hub's existing per-provider timeout. The dialog stays open, user can retry.
- **Residual risk**: None.

### Operational

#### Volume spike on a Person with many shared emails
- **Scenario**: a Person has 5000 linked email interactions; opening the Person GET pulls them all.
- **Severity**: Low
- **Mitigation**: GET is paginated (existing `customer_interactions` pagination — limit ≤ 100). Timeline UI lazy-loads via cursor pagination.
- **Residual risk**: Sustained high-volume relationships work as designed.

#### Person delete with linked email interactions
- **Scenario**: a Person is deleted; what happens to the linked emails?
- **Severity**: Medium
- **Mitigation**: Existing `CustomerInteraction.entity` soft-delete cascade applies — the interaction's `deleted_at` is set when the Person is soft-deleted. The underlying `MessageChannelLink` row in the Messages inbox is untouched (the user's email history doesn't disappear from the inbox just because a CRM contact was removed).
- **Residual risk**: None.

### Privacy & compliance

#### Personal mailbox content auto-creating CRM records
- **Scenario**: User A's personal Gmail receives an email from a customer; auto-linked interaction goes into CRM; if the email also has personal content (e.g. "by the way, I'm in town next week, let's grab coffee"), that ends up in the CRM record body.
- **Severity**: High (for GDPR / business hygiene reasons)
- **Mitigation**: visibility defaults to `'private'`; only the channel owner sees the body. Owner can delete an interaction (soft-delete) without affecting the underlying inbox copy.
- **Residual risk**: User trust in the "private-by-default" guarantee. Documented in the user-facing docs explicitly.

#### Per-user channel-owner audit trail
- **Scenario**: in an incident review, the admin needs to know who handled which contact.
- **Severity**: Medium (this is a feature, not a risk)
- **Mitigation**: `author_user_id` on every linked interaction = the mailbox owner; queryable via the existing audit and changelog systems. The Person header surfaces the per-teammate **private-email count** (the "private count" enricher already in scope) — **metadata only**. In v1 (strict owner-only) admins see those counts exactly as any teammate does but **do not** get the underlying bodies; full body-level oversight is the deferred, audited v2 capability.
- **Residual risk**: v1 deliberately trades admin body-level visibility for user privacy. If an incident genuinely requires reading a private email, that is an explicit v2 oversight decision, not a v1 default.

---

## Final Compliance Report — 2026-05-27

### AGENTS.md Files Reviewed
- `AGENTS.md` (root)
- `packages/core/AGENTS.md`
- `packages/core/src/modules/customers/AGENTS.md`
- `packages/core/src/modules/communication_channels/AGENTS.md` (implied via the hub spec)
- `packages/shared/AGENTS.md`
- `packages/ui/AGENTS.md`
- `packages/events/AGENTS.md`
- `packages/queue/AGENTS.md`
- `.ai/specs/AGENTS.md`
- `.ai/ds-rules.md`, `.ai/ui-components.md`

### Specs Reviewed
- `2026-05-21-email-integration-foundation.md` — per-user email channels (consumer-side reference)
- `SPEC-045d-communication-notification-hubs.md` — hub contract
- `SPEC-041-2026-02-24-universal-module-extension-system.md` — UMES contract
- `SPEC-002-2026-01-23-messages-module.md` — Messages module reference

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|---|---|---|---|
| root AGENTS.md | No direct ORM relationships between modules | Compliant | `external_message_id` is a UUID column + `EntityExtension` declaration |
| root AGENTS.md | Tenant + organization scoping | Compliant | All new queries scope by `tenantId`; `customer_interactions` already carries the columns |
| root AGENTS.md | Zod validation + derived types | Compliant | All new API bodies validated; types derived via `z.infer` |
| root AGENTS.md | Encryption helpers (`findOneWithDecryption` / `findWithDecryption`) | Compliant | New read paths use the helpers (consistent with the existing customers module) |
| root AGENTS.md | RBAC via features | Compliant | 2 new features `customers.email.compose` + `customers.email.view_private` |
| root AGENTS.md | Run `mercato auth sync-role-acls` on deploy | Compliant | Documented in deploy notes |
| root AGENTS.md | Run `mercato configs cache structural` after backend page changes | Compliant | Documented in Phase 3 acceptance (email surface is direct composition into the Person page; no injection widgets) |
| packages/core/AGENTS.md | Per-method `metadata` exports | Compliant | All 3 new routes |
| packages/core/AGENTS.md | `openApi` exports | Compliant | All 3 new routes |
| packages/core/AGENTS.md | `validateCrudMutationGuard` + `runCrudMutationGuardAfterSuccess` for bespoke writes | Compliant | POST emails + PATCH visibility |
| packages/core/AGENTS.md | `export default <METHOD>` at end of every route file | Compliant | All 3 new routes |
| packages/core/AGENTS.md | Workers/subscribers export `metadata` | Compliant | `link-channel-message.ts` exports `{ event, persistent: true, id }` |
| packages/core/AGENTS.md | Events use `createModuleEvents` + `as const` | Compliant | `customers/events.ts` already uses this pattern |
| packages/ui/AGENTS.md | `useGuardedMutation` for non-CrudForm writes | Compliant | Visibility flip, compose send |
| packages/ui/AGENTS.md | `apiCall` not raw `fetch` | Compliant | All new client code |
| packages/ui/AGENTS.md | `CrudForm` / `DataTable` / semantic status tokens / lucide via registry / `aria-label` / dialog keyboard shortcuts / `pageSize ≤ 100` | Compliant | Documented |
| `.ai/ds-rules.md` | Semantic tokens, no arbitrary text sizes, no `dark:` on status | Compliant | UI section explicit |
| `.ai/specs/AGENTS.md` | Required sections, risk register format | Compliant | All present, format matches |
| spec-writing skill | Frontend Architecture Contract | Compliant | Client-bundle guardrail, hydration test |
| spec-writing skill | Security: input validation, parameterized queries, XSS, secret exclusion | Compliant | Documented; HTML sanitizer from hub used for inbound body render |

### Internal Consistency Check

| Check | Status | Notes |
|---|---|---|
| Data model matches API contracts | Pass | The 3 new columns map 1:1 to fields on the new routes |
| API contracts match UI/UX | Pass | Compose dialog → POST emails; visibility toggle → PATCH visibility |
| Risks cover all write operations | Pass | Compose, auto-link insert, visibility flip, delete cascade |
| Events use existing infra, new IDs documented | Pass | 2 new events declared in `customers/events.ts` |
| Encryption: no new sensitive columns added | Pass | The new columns are operational metadata, not PII; body content is already on `MessageChannelLink.channelPayload` which the hub already encrypts |
| BC analysis covers every modified surface | Pass | Table enumerates every contract surface as additive |
| OSS independence enforced | Pass | Phase 1 acceptance includes grep verification |

### Non-Compliant Items

None.

### Verdict

- **Fully compliant with hub + AGENTS.md**. Approved for implementation pending writing-plans handoff. (Note: the original review assumed a UMES-injection surface; the shipped implementation uses direct composition per ARCHITECTURE.md §4 — see the 2026-06-02 changelog entry.)

---

## Changelog

### 2026-06-02 — Reconciled with shipped implementation

Updated the spec to match the code on `feat/demo-hoodie`. The design diverged from the original plan in four ways and a privacy decision was confirmed; all changes are documentation-only.

- **Strict owner-only email visibility, NO admin bypass (confirmed v1 decision).** Rewrote the TLDR visibility bullet, the visibility Design Decision, User Story #6 (was "admin audit / admin bypass via `customers.email.view_private`"), the Visibility-enforcement section (Layers 1–3 + teammate-count: removed the `hasAdminBypass` filter branch and the "admins still see actual content" line), the PATCH API contract (step 2 no longer grants admins a bypass — admin is also returned 404), the two affected Risk entries ("Mistakenly-shared email" and "Per-user channel-owner audit trail"), Phase 1/4 steps, and TC-006's description. `customers.email.view_private` is documented as **declared but inert** in v1 (a v2-oversight hook). Aligns with the channel-level privacy model in `2026-05-21-email-integration-foundation.md`.
- **Emails tab is the intended design (was a non-goal).** Removed the "standalone Mail tab" non-goal and the matching rejected-alternative row; added a design-evolution note. The canonical surface is now the Person-anchored **Emails** tab (`PersonEmailThreadsTab` via the shared `EmailThreadsPanel`), backed by `GET /api/customers/people/[id]/email-threads` and server-side grouping in `lib/personEmailThreads.ts`.
- **Direct composition, not UMES injection widgets.** The planned `widgets/injection/person-send-email/` and `person-email-card-actions/` were never built. Updated the Proposed-Solution diagram, File layout, File Manifest, Architecture/UI-UX sections, Phase 3, the module-graph note, and the compliance report to reflect direct components (`PersonEmailThreadsTab` — which renders the shared `EmailThreadsPanel` and owns the Refresh / New email toolbar + Connect CTA — `ComposeEmailDialog`, `EmailCardActions`, `EmailReplyForwardActions` composed into `ActivityCard.tsx`) per ARCHITECTURE.md §4 (a module composes its own pages directly; self-injection is an anti-pattern).
- **Single Send entry point.** Documented that the duplicate top-of-page "Sync / Send email" button pair (the `PersonEmailActions` header component) **has been removed** in this PR as a duplicate, leaving the Emails tab's "Refresh / New email" controls — provided by the shared `EmailThreadsPanel` rendered inside `PersonEmailThreadsTab`, compose via `ComposeEmailDialog` — as the only email entry point.
- **Actual endpoints + flat compose body.** Corrected the compose body to the flat shape `{ userChannelId, to, cc?, subject, body, bodyFormat, visibility, inReplyTo?, references?, parentMessageId? }`; documented `GET .../email-threads` (the tab's data source) and `PATCH .../interactions/[id]/visibility` (owner-only). Corrected internal lib names (`visibilityFilter.ts`, `personEmailThreads.ts`, `link-channel-message-handler.ts`).
- **Testing strategy to the target state.** TC list now reflects: TC-001 exists but is `test.skip` (to be un-skipped via a new channel-seeding fixture); TC-002..005 to be written (inbound auto-link, multi-match, no-match, threading); TC-006 asserts strict owner-only (admin also blocked); `TC-CRM-EMAIL-VISIBILITY-001` declared; a new `/email-threads` visibility test to be added. `.ai/qa/scenarios/TC-CRM-EMAIL-010-person-thread-ui.md` already covers the Emails-tab presentation.

### 2026-05-27 — Initial spec

Brainstormed and approved with the user. Key decisions:
- v1 scope: Person-only (Deal + Company surfaces deferred to v2).
- Data model: extend `CustomerInteraction` with 3 nullable columns + 2 indexes; no new tables.
- Linking: event-driven subscriber (Approach 1) listening to `communication_channels.message.received` + `.sent`; one codepath for inbound + outbound.
- Auto-link: every matching Person on every address (From, To, Cc).
- Visibility: private-by-default; per-email sharing flag; opaque private-count visible to teammates.
- 4 implementation phases with module-local integration tests per phase.
