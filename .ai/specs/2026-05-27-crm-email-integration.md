# CRM Email Integration — Person-anchored send / receive via Communications Hub

## TLDR

**Key points**
- Adds per-user **send + receive email** capability to the CRM module, anchored to `CustomerPersonProfile` (the natural identifier-by-email-address entity). Deal and Company pages are explicitly out of scope for v1.
- **Approach 1 (event-driven subscriber)**: customers module subscribes to the existing hub events `communication_channels.message.received` and `communication_channels.message.sent`, resolves People by address, creates `CustomerInteraction` rows (one per match) with `interactionType='email'`. The same subscriber path handles inbound and outbound — one linking codepath.
- **Reuses existing surfaces**: `CustomerInteraction` is the timeline home (it already has `interactionType='email'` in the schema and the activity-add menu); `sendAsUser({ userChannelId, … })` is the outbound facade (already shipped on the hub); `ActivityDialog`/`ActivityTimeline`/`ActivityCard` already render the row.
- **No changes to the hub** (`communication_channels`) or `messages` module — CRM is a downstream consumer.

**Scope (v1)**
- Outbound: `<ComposeEmailDialog>` on the Person detail page; calls `sendAsUser` with the user's connected channel; subscriber creates a linked `CustomerInteraction` on `messages.message.sent`.
- Inbound: subscriber on `communication_channels.message.received`; resolves every Person whose `email` matches any of From/To/Cc; creates one `CustomerInteraction` per match. Unmatched addresses are ignored (email still lives in the unified Messages inbox).
- **Per-email visibility**: defaults to `'private'` (only the channel-owner sees the body). A `PATCH /api/customer-emails/{id}/visibility` lets the owner flip a single email to `'shared'`. Teammates see an opaque count of private emails on the same Person ("5 more emails (private to teammates)") but never the bodies.
- **Threading inheritance**: a reply auto-links to whatever Person the parent thread already links to, via `In-Reply-To` / `References` lookup. Survives the case where a reply's `From` is a previously-unknown address.

**Non-goals (v1)**
- Deal-page or Company-page email surfaces. Those derive trivially via the existing `CustomerDealPersonLink` / `CustomerPersonCompanyLink` join tables and are tracked as a v2 spec; v1 keeps the surface minimal.
- A standalone "Mail" tab inside CRM (Pipedrive's mailbox view). Users already have the unified Messages inbox; v1 doesn't duplicate it.
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
| Per-user email channels (Gmail / Microsoft / IMAP) | Implemented (current branch) | `packages/channel-{gmail,microsoft,imap}/` + spec [`2026-05-21-email-integration-foundation.md`](2026-05-21-email-integration-foundation.md) |
| `sendAsUser({ userChannelId, … })` facade | Implemented | `packages/core/src/modules/communication_channels/api/post/send-as-user/route.ts` |
| Hub events `communication_channels.message.received` / `.sent` with `clientBroadcast: true` | Implemented | `packages/core/src/modules/communication_channels/events.ts` |
| UMES (SPEC-041) for injection widgets | Implemented | `packages/ui/src/backend/injection/` |
| `customers` module CRUD primitives | Implemented (reference module) | `packages/core/src/modules/customers/` |

No additional hub changes are required. Cross-tenant + per-user isolation in the hub (the user_id scoping on `CommunicationChannel` + `IntegrationCredentials`) is already in place.

---

## Overview

Open Mercato's CRM module (`customers`) currently logs emails as `CustomerInteraction` rows with `interactionType='email'` — but the existing "Compose email" affordance in `ActivitiesAddNewMenu` only writes a log entry; **no actual email leaves the system**. Sales reps must compose in their own mail client and (best case) manually copy the conversation back into the CRM as a free-text interaction. Inbound emails don't appear in the CRM at all unless someone forwards them through `inbox_ops` (a different, AI-extraction-focused pipeline).

The Communications Hub (SPEC-045d) + per-user email channels (2026-05-21 spec) close the platform gap: any user can connect Gmail / Microsoft 365 / IMAP, and the platform can send + receive on their behalf. **This spec wires that capability into the CRM** so emails appear on Person timelines automatically and the user can compose without leaving the Person detail page.

> **Architectural references**: SPEC-045d (the hub contract), 2026-05-21 spec (per-user channels + `sendAsUser`), SPEC-041 UMES (injection widgets), the customers module's existing `CustomerInteraction` schema and `ActivityTimeline` render path.

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
│ │                                                           │
│ ├ lib/find-people-by-addresses.ts                           │
│ │                                                           │
│ ├ api/people/[id]/emails/route.ts          (POST + GET)     │
│ ├ api/customer-emails/[id]/visibility/route.ts (PATCH)      │
│ │                                                           │
│ ├ components/detail/ComposeEmailDialog.tsx                  │
│ ├ widgets/injection/person-send-email/                      │
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
| **Private-by-default visibility, per-email sharing flag** | Personal mailboxes carry non-CRM content. Default-shared would leak; always-private would break handoffs. Pipedrive's model is the right balance. |
| **No raw FK across module boundary** | Per root `AGENTS.md`. `customer_interactions.external_message_id` is a UUID; the cross-module link is declared via `EntityExtension` in `customers/data/extensions.ts`. |
| **Visibility enforced at the DB layer**, not just response enricher | Defense in depth. The interactions where-builder filters private rows out at query time so they never enter the response. Enricher would still ship the row to memory and rely on serialization to redact. |

### Alternatives Considered

| Alternative | Why Rejected |
|---|---|
| **Approach 2: sync link inside `sendAsUser` wrapper** | Asymmetric (sync outbound vs async inbound = two codepaths). Couples sendAsUser's transaction to a customers table the hub shouldn't know about. The queue hop is fast enough that the sync approach has no real win. |
| **Approach 3: response enricher only, no own row** | Forces every Person GET to query MessageChannelLink. No audit trail, no undo, can't filter the activities timeline by email, no visibility flag persistence. |
| **Add Deal + Company surfaces in v1** | Tripled scope without a forcing function. Both derive from Person via existing join tables; doing them later is one PR per surface. |
| **A dedicated "Mail" tab in CRM (Pipedrive-style)** | Duplicates the existing unified Messages inbox at `/backend/messages`. The user can already see all their emails there; the CRM value is *anchoring to entities*, not re-rendering the inbox. |
| **Public-to-tenant visibility model** | Leaks personal mailbox content (NDA threads, salary, etc.) to every teammate the moment it lands in CRM. Unacceptable per the user-isolation contract. |
| **Strictly private (no sharing option)** | Breaks rep-to-rep handoff workflows. Defeats half the point of having CRM. |

---

## User Stories

- **As a sales rep**, I want to **send an email to a contact from the Person detail page** so that **the conversation appears on their timeline without me leaving the CRM**.
- **As a sales rep**, I want **incoming replies from a known contact to appear on their Person timeline automatically** so that **I don't have to copy/paste thread context to keep records honest**.
- **As a sales rep**, I want **inbox content private by default** so that **personal correspondence (HR, salary, vendor NDAs) that happens to mention a customer doesn't auto-leak to my team**.
- **As a sales rep**, I want to **flip a single email to "share with team" when handing a contact off** so that **a teammate can read the conversation history without me forwarding it manually**.
- **As a teammate**, I want to **see that a colleague has private email history with this contact** so that **I know to ask them before reaching out cold**, without seeing the content.
- **As an admin**, I want **the same per-email visibility flag visible to me** so that **I can review/audit at the message level when investigating an incident** (admin bypass via `customers.email.view_private`).

---

## Architecture

### File layout

```
packages/core/src/modules/customers/
  api/
    interactions/
      [id]/
        visibility/
          route.ts                            # PATCH visibility (private | shared)  (Phase 4)
    people/
      [id]/
        emails/
          route.ts                            # POST compose+send (Phase 2)
                                              # (List of emails for a Person uses the existing
                                              #  GET /api/customers/interactions endpoint with
                                              #  ?entityId=…&interactionType=email — extended
                                              #  with the Layer 1 visibility filter)
  components/
    detail/
      ComposeEmailDialog.tsx                  # modal (mirrors ActivityDialog UX)
      EmailReplyForwardActions.tsx            # Reply / Reply All / Forward action menu on email cards
  data/
    extensions.ts                             # NEW EntityExtension: customer_interaction.external_message_id → communication_channels:message_channel_link
  events.ts                                   # extended with `customers.email.linked`
  lib/
    find-people-by-addresses.ts               # batch lookup, lowercased + tenant-scoped
    visibility-filter.ts                      # buildPrivateInteractionFilter(currentUserId, callerFeatures)
  migrations/
    Migration20260527<HHmmss>_customers_email_integration.ts
  subscribers/
    link-channel-message.ts                   # on .message.received + .message.sent
  widgets/
    injection/
      person-send-email/                      # "Send email" button OR Connect CTA in person detail header
        widget.client.tsx
        widget.ts
      person-email-card-actions/              # Reply/Forward actions on email timeline cards
        widget.client.tsx
        widget.ts
  __integration__/
    TC-CRM-EMAIL-001.spec.ts                  # outbound: send creates private interaction
    TC-CRM-EMAIL-002.spec.ts                  # inbound: auto-link by From
    TC-CRM-EMAIL-003.spec.ts                  # multi-match: To+Cc → 3 interactions
    TC-CRM-EMAIL-004.spec.ts                  # no-match: 0 interactions, still in Messages inbox
    TC-CRM-EMAIL-005.spec.ts                  # threading inheritance via In-Reply-To
    TC-CRM-EMAIL-006.spec.ts                  # visibility flip + admin bypass + cross-user denial
    TC-CRM-EMAIL-007.spec.ts                  # no-channel-connected UX state
```

### Module-graph compliance

After this PR lands, run `yarn mercato configs cache structural --all-tenants` (per root AGENTS.md mandate after backend page or sidebar changes — the new compose dialog is reached via an injection widget so technically no `apps/mercato/src/modules.ts` change is needed, but the structural cache must be refreshed for the new injection widget to register).

### OSS independence

`@open-mercato/core` (customers module) MUST NOT import from `@open-mercato/enterprise`. Grep verification in Phase 1 acceptance:
```bash
grep -r "@open-mercato/enterprise" packages/core/src/modules/customers/
# Expected: only pre-existing matches unrelated to this spec
```

### Outbound flow (compose)

```
Person detail page → "Send email" injection-widget button
  ↓ (user has ≥1 connected, status='connected' channel; otherwise button is replaced with Connect CTA)
ComposeEmailDialog (modal)
  • To prefilled = person.email; user can edit; can add Cc/Bcc
  • Subject + body (rich-text editor primitive)
  • "Send as" dropdown — user's connected channels; defaults to primary, persists last choice
  • Visibility radio: "Private to me" (default) / "Visible to teammates"
  • Cmd/Ctrl+Enter submit; Esc cancel
  ↓
POST /api/customers/people/{personId}/emails
  body: { userChannelId, to[], cc?[], bcc?[], subject, body, bodyFormat, visibility }
  ↓
Route handler:
  1. Loads person; verifies person.tenantId === auth.tenantId
  2. Loads channel; verifies channel.userId === auth.sub (per-user enforcement; the hub also checks but we double-up)
  3. Calls sendAsUser({ userChannelId, to, cc, bcc, subject, body, bodyFormat,
                        channelMetadata: { crmVisibility: visibility, crmPersonId: personId } })
  ↓
Hub creates Message + emits messages.message.sent
  ↓
Hub outbound-delivery subscriber forwards via channel adapter
  ↓
Hub emits communication_channels.message.sent (clientBroadcast: true — already configured)
  ↓
customers/subscribers/link-channel-message.ts fires (persistent subscriber)
  • Re-fetches MessageChannelLink + Message by messageId
  • Reads channelMetadata.crmVisibility (defaults to 'private' if absent)
  • Collects To/Cc/Bcc addresses + the explicit crmPersonId hint
  • findPeopleByAddresses(em, addresses, tenantId) — also honors crmPersonId hint
  • For each matched Person, INSERT INTO customer_interactions … ON CONFLICT DO NOTHING
  • Emits customers.email.linked once per (person, message) row created
  ↓
Browser SSE bridge (clientBroadcast) → Person detail page refetches timeline
```

### Inbound flow (auto-link)

```
External mailbox receives email
  ↓
Hub poll worker (channel-{gmail,microsoft,imap})
  ↓
Hub inbound-processor: creates Message + MessageChannelLink + ExternalMessage; emits communication_channels.message.received
  ↓
customers/subscribers/link-channel-message.ts fires (persistent)
  • Re-fetches MessageChannelLink by messageChannelLinkId; reads channelMetadata
  • Extracts addresses: lowercase, dedupe, normalize From / To / Cc / Bcc
  • findPeopleByAddresses(em, addresses, tenantId)
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

### Visibility enforcement (3 layers of defense)

**Layer 1 — DB filter** (`customers/lib/visibility-filter.ts`)

Every read path that returns `customer_interactions` applies:
```ts
function buildPrivateInteractionFilter(
  currentUserId: string,
  hasAdminBypass: boolean,
): Knex.QueryCallback {
  return (qb) => {
    if (hasAdminBypass) return        // admin sees all
    qb.where((sub) =>
      sub.where('interaction_type', '!=', 'email')
         .orWhere('visibility', '=', 'shared')
         .orWhere((own) =>
           own.where('visibility', '=', 'private')
              .andWhere('author_user_id', '=', currentUserId)
         )
    )
  }
}
```

Wired into `customers/api/interactions/route.ts` and `customers/api/people/[id]/emails/route.ts` GET handlers.

**Layer 2 — Mutation guard on PATCH visibility**

`PATCH /api/customer-emails/{id}/visibility` returns 404 (not 403, to avoid leaking existence) when:
- `interaction.author_user_id !== currentUser.id` AND
- caller does not have `customers.email.view_private` (admin feature)

Even loading the row to inspect `author_user_id` goes through `findOneWithDecryption` with the visibility filter, so a non-owner non-admin can never see the row in the first place.

**Layer 3 — Subscriber audit**

`link-channel-message.ts` always sets `author_user_id = channel.userId` (the mailbox owner). For tenant-scoped channels (no userId — e.g. WhatsApp), `visibility` defaults to `'shared'` because there is no "owner" to keep it private to.

**Teammate-visible private count** (UX honesty)

A small response enricher on the Person detail GET runs:
```sql
SELECT COUNT(*) FROM customer_interactions
WHERE entity = $personId
  AND interaction_type = 'email'
  AND tenant_id = $tenantId
  AND deleted_at IS NULL
  AND visibility = 'private'
  AND author_user_id != $currentUserId
```
Surfaced on the Person header as "5 emails private to teammates". Metadata only — never content. Admins still see actual content via Layer 1's admin bypass.

---

## Data Models

This spec adds **zero new tables**. All deltas are additive columns on the existing `customer_interactions` table.

### `customer_interactions` (extended)

```sql
-- Illustrative — generated by `yarn db:generate`
ALTER TABLE customer_interactions
  ADD COLUMN external_message_id UUID NULL,    -- linked to communication_channels:message_channel_link via EntityExtension
  ADD COLUMN visibility TEXT NULL,             -- 'private' | 'shared' for email rows; NULL for non-email rows
  ADD COLUMN channel_provider_key TEXT NULL;   -- 'gmail' | 'microsoft' | 'imap' — denormalized for filter UX

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

### Email list — uses existing `GET /api/customers/interactions`

The existing CRUD route already supports filtering by `entityId` and `interactionType`:
```
GET /api/customers/interactions?entityId={personId}&interactionType=email&limit=25
```
This spec extends that route's where-builder to apply the **Layer 1 visibility filter** (`buildPrivateInteractionFilter`). No new GET route is needed. The opaque `privateCount` for the Person header is exposed via a **response enricher on the Person detail GET** (see § Phase 4), not by this list endpoint.

### `PATCH /api/customers/interactions/{interactionId}/visibility`
- **Features**: `customers.email.compose` (the same feature that lets you create one)
- **Body**: `z.object({ visibility: z.enum(['private', 'shared']) })`
- **Server**:
  1. Load interaction with the Layer 1 visibility filter applied; 404 if not visible to caller. The route also verifies `interaction_type = 'email'` and 404s otherwise (this route is email-only; visibility is meaningless on calls/meetings/tasks).
  2. Verify `interaction.author_user_id === auth.sub` OR caller has `customers.email.view_private` (admin bypass). 404 otherwise.
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

All three routes export an `openApi` block per `packages/core/AGENTS.md`. Discriminated unions handled via `createCrudOpenApiFactory` for the GET list; ad-hoc shapes for POST/PATCH.

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

### Person detail page additions

- **Header action row**: new "Send email" button (uses `<Mail>` from the lucide icon registry, same icon as `ActivitiesAddNewMenu`). Implemented as a UMES injection widget at the existing person-detail header spot — customers module doesn't have to know about communication_channels imports directly.
- **No-channel state**: when `GET /api/communication_channels/me/channels` returns empty for the current user, the button is replaced by a `<Button variant="outline" asChild><Link href="/backend/profile/communication-channels">Connect your mailbox</Link></Button>` block with brief copy.
- **Email row on activity timeline**: uses the existing `ActivityCard` rendering. Subject + sender (or first recipient for outbound) + first ~200 chars body preview. Icon: `<Mail>` with `bg-status-info-soft text-status-info-fg` semantic tokens.
- **Email detail side drawer**: opening an email card shows full body (sanitized HTML per the hub's `sanitize-channel-html.ts` helper), attachments list (read-only), To/Cc/Bcc, Reply / Reply All / Forward action buttons.
- **Reply / Reply All / Forward**: reuse `ComposeEmailDialog` with pre-filled `inReplyTo`, `references`, To/Cc/Subject (`Re: …` / `Fwd: …`). One component, three entry points (each is an injection-widget action on the email card).
- **Visibility toggle**: a small lock/people icon on each email card. Click → confirm dialog → `PATCH visibility`. Only shown to the owner (Layer 2). Admins see a separate "admin override" icon they can click; logs to audit.

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
  - `ComposeEmailDialog.tsx` — client component (new). ~10 KB gzipped.
  - `person-send-email/widget.client.tsx` — client component (new). ~2 KB.
- **No new global providers**.
- **Client bundle guardrail**: no provider SDK in the client bundle (no googleapis, no @microsoft/microsoft-graph-client). Server-side only.
- **Route budget**: Person detail page adds <15 KB gzipped (well within the existing route's headroom).
- **Hydration test**: existing Person detail Playwright test extended to assert the Send Email button is interactive within 100ms of mount.

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
| New API routes | `POST /api/customers/people/{id}/emails`, `GET /api/customers/people/{id}/emails`, `PATCH /api/customer-emails/{id}/visibility` | New paths only; no existing routes renamed. |
| `EntityExtension` declaration | New entry in `customers/data/extensions.ts` | Additive. |
| `customers/setup.ts` | New `defaultRoleFeatures` entries for the two new features | Additive. |
| Hub module (`communication_channels`) | **No changes** | None. |
| Messages module | **No changes** | None. |
| Existing `ActivityDialog` / `ActivityTimeline` / `ActivityCard` | Unchanged — new emails render through the existing path | None. |

No deprecations. No data migration of existing rows (the dedupe partial unique index applies only to rows where `external_message_id IS NOT NULL`, so legacy email log interactions are untouched).

After deploy: run `yarn mercato auth sync-role-acls` to grant the two new features to existing tenants, then `yarn mercato configs cache structural --all-tenants` to register the new injection widgets.

---

## Implementation Plan

> Each phase ships its own module-local `__integration__/TC-CRM-EMAIL-*.spec.ts`. No phase is marked complete without its integration tests passing.

### Phase 1 — Schema + helper + subscriber (inbound)

**Goal**: any inbound email auto-links to matching People; no compose UI yet.

1. Add 3 additive columns + 2 indexes via `data/entities.ts`; generate scoped migration via `yarn db:generate` and update `migrations/.snapshot-open-mercato.json`.
2. Add `data/extensions.ts` declaring the cross-module link.
3. Add `lib/find-people-by-addresses.ts` (case-insensitive, tenant-scoped, batched).
4. Add `lib/visibility-filter.ts` (`buildPrivateInteractionFilter`) and wire into the existing `customers/api/interactions/route.ts` GET.
5. Add `subscribers/link-channel-message.ts` listening to `communication_channels.message.received` only (outbound side comes in Phase 2).
6. Add `customers.email.linked` event to `events.ts` with `clientBroadcast: true`.
7. Add `customers.email.compose` + `customers.email.view_private` to `acl.ts` + `setup.ts` `defaultRoleFeatures`. Run `yarn mercato auth sync-role-acls` on deploy.
8. Unit tests:
   - `find-people-by-addresses.test.ts`: empty, mixed case, multi-match, tenant-scoped, normalization.
   - `link-channel-message.test.ts` (inbound only): 1-match / 3-match / 0-match / no tenantId fail-closed / idempotent retry / threading inheritance.
   - `visibility-filter.test.ts`: own private visible, others' private hidden, shared visible to all, admin bypass.
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

1. Add `api/customers/people/[id]/emails/route.ts` (POST + GET) with full zod validation + mutation guard.
2. Extend `link-channel-message.ts` to also handle `communication_channels.message.sent` (reads `channelMetadata.crmVisibility` and `crmPersonId` hint).
3. Add `customers.email.compose` feature wiring (already in `acl.ts` from Phase 1; here we use it on the POST route).
4. Unit tests:
   - Compose route validation (zod): rejects 0 recipients, oversized body, missing subject, missing userChannelId.
   - Compose route auth: 404 on wrong-tenant person, 409 on disconnected channel.
   - `link-channel-message.test.ts` (outbound branch): visibility propagation, crmPersonId hint takes precedence over address match when present.
5. Module-local integration tests:
   - `TC-CRM-EMAIL-001` outbound end-to-end: User A sends → interaction with `visibility='private'` + `author_user_id=A` created → User A sees it; User B's GET on same Person returns the interaction filtered out + `privateCount=1`.
6. **Acceptance**: User can compose+send against a real (stubbed or env-gated) Gmail/IMAP account; the timeline updates within 1s of send (via clientBroadcast SSE).

### Phase 3 — ComposeEmailDialog + injection widgets

**Goal**: full UI on the Person detail page.

1. Add `components/detail/ComposeEmailDialog.tsx` (modal, mirrors `ActivityDialog`).
2. Add `widgets/injection/person-send-email/` — header button injection that swaps to a Connect CTA when `GET /api/communication_channels/me/channels` is empty.
3. Add `components/detail/EmailReplyForwardActions.tsx` + the email-card-actions injection widget for Reply / Reply All / Forward.
4. Email detail side drawer — render full body through the hub's `sanitize-channel-html.ts` helper.
5. Add i18n keys in all 4 locales.
6. Run `yarn mercato configs cache structural --all-tenants` to register the new injection widgets.
7. Unit tests: ComposeEmailDialog form validation; Reply/Forward pre-fill correctness.
8. Module-local integration tests:
   - `TC-CRM-EMAIL-007` no-channel UX: user without connected channel sees Connect CTA; user with connected channel sees Send button.
9. **Acceptance**: end-to-end compose works in a browser preview against a connected Gmail account.

### Phase 4 — Visibility toggle UI + private-count enricher + docs

**Goal**: per-email sharing UX + audit hooks + user-facing docs.

1. Add `PATCH /api/customer-emails/{id}/visibility` route with mutation guard + admin bypass.
2. Add the visibility-toggle icon to the email-card injection widget (owner only; admin override icon for admins).
3. Add the private-count response enricher on the Person detail GET.
4. Emit `customers.email.visibility_changed` event on each flip.
5. Add audit log entry on admin bypass flip.
6. Module-local integration tests:
   - `TC-CRM-EMAIL-006` visibility lifecycle: non-owner cannot flip (404), owner flips private→shared, teammate now sees it; admin bypass flips a teammate's email back to private, audit log records who did it.
7. Add user-facing doc at `apps/docs/docs/user-guide/customers-email.mdx`: connect mailbox → send email from Person → understanding private vs shared → reply/forward workflow → admin visibility override.
8. Add developer doc snippet to `packages/core/src/modules/customers/AGENTS.md` describing the new subscriber + visibility model so future entity-anchored email work knows the pattern.
9. **Acceptance**: all 7 integration tests pass; docs reviewed.

### File Manifest

| File | Action | Phase |
|---|---|---|
| `packages/core/src/modules/customers/data/entities.ts` | Extend `CustomerInteraction` with 3 columns | 1 |
| `packages/core/src/modules/customers/data/extensions.ts` | Add EntityExtension | 1 |
| `packages/core/src/modules/customers/migrations/Migration20260527…_customers_email_integration.ts` | Create | 1 |
| `packages/core/src/modules/customers/migrations/.snapshot-open-mercato.json` | Update | 1 |
| `packages/core/src/modules/customers/lib/find-people-by-addresses.ts` | Create | 1 |
| `packages/core/src/modules/customers/lib/visibility-filter.ts` | Create | 1 |
| `packages/core/src/modules/customers/api/interactions/route.ts` | Wire `buildPrivateInteractionFilter` into where-builder | 1 |
| `packages/core/src/modules/customers/subscribers/link-channel-message.ts` | Create (inbound branch) | 1 |
| `packages/core/src/modules/customers/events.ts` | Add 2 events | 1 |
| `packages/core/src/modules/customers/acl.ts` | Add 2 features | 1 |
| `packages/core/src/modules/customers/setup.ts` | Add `defaultRoleFeatures` | 1 |
| `packages/core/src/modules/customers/api/people/[id]/emails/route.ts` | Create (POST + GET) | 2 |
| `packages/core/src/modules/customers/subscribers/link-channel-message.ts` | Extend (outbound branch) | 2 |
| `packages/core/src/modules/customers/components/detail/ComposeEmailDialog.tsx` | Create | 3 |
| `packages/core/src/modules/customers/components/detail/EmailReplyForwardActions.tsx` | Create | 3 |
| `packages/core/src/modules/customers/widgets/injection/person-send-email/*` | Create | 3 |
| `packages/core/src/modules/customers/widgets/injection/person-email-card-actions/*` | Create | 3 |
| `packages/core/src/modules/customers/i18n/{en,pl,es,de}.json` | Add ~20 keys per locale | 3 |
| `packages/core/src/modules/customers/api/interactions/[id]/visibility/route.ts` | Create | 4 |
| `packages/core/src/modules/customers/data/enrichers.ts` | Add private-count enricher | 4 |
| `apps/docs/docs/user-guide/customers-email.mdx` | Create | 4 |
| `packages/core/src/modules/customers/__integration__/TC-CRM-EMAIL-{001..007}.spec.ts` | Create across phases | 1–4 |

---

## Testing Strategy

**Unit (Jest)** — colocated with each new file in `__tests__/`. Per phase, see Implementation Plan. Total ~25 new unit tests.

**Integration (Playwright)** — module-local in `customers/__integration__/`, per the placement table in the Implementation Plan. Scenarios listed in `.ai/qa/scenarios/TC-CRM-EMAIL-*.md` (one markdown per spec).

**Cross-cutting**: existing customers cross-tenant isolation tests are extended with one assertion that an email-linked interaction is never visible to a different tenant's GET. Existing person-detail Playwright is extended to assert the Send Email button is interactive within 100ms of mount.

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
- **Mitigation**: Confirm dialog on share / unshare; the PATCH route audits to `customers.email.visibility_changed` event; admin can revert.
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
- **Mitigation**: `author_user_id` on every linked interaction = the mailbox owner; queryable via the existing audit and changelog systems. The Person detail page can surface a "Communication history" tab showing all teammates and their interaction counts (this is the "private count" enricher already in scope).

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
| root AGENTS.md | Run `mercato configs cache structural` after new injection widgets | Compliant | Documented in Phase 3 acceptance |
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

- **Fully compliant with hub + UMES + AGENTS.md**. Approved for implementation pending writing-plans handoff.

---

## Changelog

### 2026-05-27 — Initial spec

Brainstormed and approved with the user. Key decisions:
- v1 scope: Person-only (Deal + Company surfaces deferred to v2).
- Data model: extend `CustomerInteraction` with 3 nullable columns + 2 indexes; no new tables.
- Linking: event-driven subscriber (Approach 1) listening to `communication_channels.message.received` + `.sent`; one codepath for inbound + outbound.
- Auto-link: every matching Person on every address (From, To, Cc).
- Visibility: private-by-default; per-email sharing flag; opaque private-count visible to teammates.
- 4 implementation phases with module-local integration tests per phase.
