# Per-User Email Channels under the Communications Hub

## TLDR

**Key Points:**
- Implements per-user Gmail and IMAP+SMTP as **two `ChannelAdapter`s under the existing `communication_channels` hub** (SPEC-045d), not as a parallel `email` module.
- Adds the minimal hub deltas required to support per-user channels and polling-based providers: `CommunicationChannel.user_id?`, `pollIntervalSeconds`, hub-side `poll-channel` scheduler, `ChannelCapabilities.realtimePush?`, optional `ChannelAdapter.refreshCredentials?()`. All deltas are additive against SPEC-045d.
- Takes **full advantage of UMES** (SPEC-041): 17 named extension points across widget injection, response enrichers, API interceptors, mutation guards, component replacement, notification handlers, sync event subscribers, entity extensions, and command interceptors. Provider packages own their UI surface via UMES — no per-provider mutations to core hub pages.

**Scope (v1):**
- Per-user OAuth linking for Gmail; per-user credential linking for IMAP+SMTP.
- Polling-based inbound (5-min default, configurable per channel). Real-time push (Gmail Pub/Sub, IMAP IDLE) deferred to v2.
- Inbound emails auto-create `Message` records in the channel owner's unified inbox via the hub's bridge — emails are first-class inbox citizens from day one.
- Outbound via the hub's standard `messages.message.sent` → `adapter.sendMessage` flow. Thin `sendAsUser({ userChannelId, ... })` facade for programmatic callers (workflows, AI tools).
- Two per-provider workspace packages: `@open-mercato/channel-gmail`, `@open-mercato/channel-imap`.

**Non-goals (v1):**
- Real-time push inbound for any provider (deferred to v2 spec).
- Body persistence beyond what the hub already does in `MessageChannelLink.channelPayload` — provider packages reuse that store; no parallel `EmailMessageEnvelope`.
- Replacing the existing Resend transactional pipeline (`packages/shared/src/lib/email/send.ts`) — that pipeline remains the system identity for password resets, MFA, notifications. Resend and per-user channels coexist; the caller picks.
- Replacing or modifying `inbox_ops` — `inbox_ops` continues to handle the *tenant-forwarded* Resend mailbox for AI action extraction (see § Relationship to `inbox_ops`).
- CRM auto-linking beyond what `ChannelAdapter.resolveContact?()` already affords.
- **Customer-portal channel ownership.** v1 is scoped to staff users only (the `auth:user` identity). Letting a B2B customer-portal contact (`customer_accounts:customer_account`) connect their own mailbox is a plausible v2 feature but explicitly out of scope here: it would require a parallel ACL surface in `customer_accounts`, a separate `user_id`-equivalent column path, and customer-portal-specific UI. v1 keeps the link strictly `CommunicationChannel.user_id → auth:user`.

**Concerns / open dependencies:**
- **SPEC-045d is a hard prerequisite.** It lives under `.ai/specs/implemented/` but `packages/core/src/modules/communication_channels/` does not exist in the repo today (verified via `ls packages/core/src/modules/communication_channels` — missing; `grep "interface ChannelAdapter"` — no shipping matches). SPEC-045d's own body marks itself "Phase 4 of 6" — it is a spec, not deployed code. **This spec depends on SPEC-045d being implemented separately first** (see § Prerequisites & Cross-Spec Dependencies). It does NOT carry SPEC-045d delivery in its own Phase 0.
- OAuth client infrastructure does not exist in OSS core (only in the enterprise SSO module). This spec ports the state-cookie pattern locally to the hub (`packages/core/src/modules/communication_channels/lib/oauth-state.ts`) — `@open-mercato/core` MUST NOT import from `@open-mercato/enterprise`.
- Sending real emails from a user's mailbox affects their personal deliverability reputation. Mitigation: per-channel explicit opt-in flow; admin can disable any user-owned channel.

---

## Prerequisites & Cross-Spec Dependencies

This spec is the **second-floor work**. SPEC-045d (the Communications Hub) must be implemented as its own spec before any phase of this work starts. Concretely:

| Dependency | Must deliver before this spec begins | Owner |
|---|---|---|
| **SPEC-045d Communication & Notification Hubs** ([file](.ai/specs/implemented/SPEC-045d-communication-notification-hubs.md)) | `packages/core/src/modules/communication_channels/` with: entities (`CommunicationChannel`, `ExternalConversation`, `ExternalMessage`, `MessageChannelLink`, `ChannelThreadMapping`, `MessageReaction`, `HealthLog`); `ChannelAdapter` v2 interface + DI registry; inbound-processor worker; outbound-delivery subscriber on `messages.message.sent`; hub events (`communication_channels.message.received/.sent/.delivery_failed/.reaction.added`); hub ACL features (`communication_channels.view/.manage/.admin`); hub admin pages (`/backend/communication_channels/channels`, channel detail). | Separate spec/PR. Recommended path: `git mv` SPEC-045d out of `.ai/specs/implemented/` first (it is not implemented) and own its delivery on its own dated spec. |
| **SPEC-041 UMES** ([dir](.ai/specs/implemented/) `SPEC-041*` files) | Already shipped — verified in code (`packages/ui/src/backend/injection/`, `useGuardedMutation`, `useNotificationEffect`, response enricher + API interceptor + mutation guard + sync subscriber + command interceptor registries). | None — done. |
| **SPEC-002 Messages Module** ([file](.ai/specs/implemented/SPEC-002-2026-01-23-messages-module.md)) | Already shipped — verified in code (`packages/core/src/modules/messages/`). `messages.message.sent` event present with `clientBroadcast: true`. | None — done. |
| **SPEC-045 Integration Marketplace** ([file](.ai/specs/implemented/SPEC-045-2026-02-24-integration-marketplace.md)) | Already shipped — `packages/core/src/modules/integrations/` with `IntegrationCredentials` entity and per-tenant Marketplace admin UI. | None — done. |

### Coordination with SPEC-056 (WhatsApp)

SPEC-056 is a **sibling**, not a dependency. Both this spec and SPEC-056 produce `ChannelAdapter` provider packages on top of the same hub. They can ship in any order. Two coordination items:

1. The first one to land establishes the de-facto reference implementation pattern for ChannelAdapters. The hub contract holds; only example code in docs may need to be updated to point at the chosen first provider.
2. If both teams notice the same hub gap (e.g., a missing capability on `ChannelAdapter`), that gap is escalated back to the hub's spec rather than patched in both providers.

### Why not merge SPEC-045d into this spec

Merging would conflate "build the hub" with "ship email", produce a spec twice as long for no architectural benefit, and would force the WhatsApp work (SPEC-056) to either wait or branch from a half-built hub. Keeping them separate also makes the hub's BC posture cleaner: SPEC-045d evolves on its own cadence; this spec is one of many consumers.

### Why not merge SPEC-056 into this spec

WhatsApp's auth model (Meta tokens, webhook-driven push), payload model (interactive components, Block Kit-style content), and reactions support are fundamentally different from email. Bundling them would re-create the "internally heterogeneous module" anti-pattern (Alternative A2 in § Alternatives Considered). Keep them as separate provider packages under the same hub.

---

## Overview

Open Mercato today has **outbound-only, Resend-only** transactional email and no per-user mailbox concept. The product needs each logged-in user to connect their own Gmail or IMAP+SMTP account so that:
- Outbound messages are sent from the user's own address (replies land in their inbox, recipients see the sender as the user, conversations look natural).
- Inbound emails reach the user's unified Open Mercato inbox alongside WhatsApp, Slack, and future channels — one place to triage all external communications.
- Downstream CRM specs can attach conversations to customers, deals, and threads by subscribing to the hub's channel-agnostic events (`communication_channels.message.received` / `.sent`).

**The previous spec proposed a standalone `email` module with its own entities, events, OAuth router, polling worker, and admin UI.** This was rejected because Open Mercato already has a finalized architecture for external communication channels — the Communications Hub (SPEC-045d) — with WhatsApp planned as the first concrete adapter (SPEC-056). Email belongs under that hub. This spec rewrites the design from scratch around the hub contract and uses UMES (SPEC-041) for all cross-module integration surface area.

> **Architectural references**: SPEC-045d Communication & Notification Hubs (the hub contract), SPEC-056 WhatsApp AI Chat (the first ChannelAdapter implementation pattern), SPEC-041 Universal Module Extension System (the extension framework), SPEC-002 Messages Module (the inbox destination), SPEC-045 Integration Marketplace (the credentials + admin home).

## Problem Statement

1. **Standalone email module duplicates the hub.** Two systems for storing external messages (`EmailMessageEnvelope` vs hub's `ExternalMessage`), two event streams (`email.message.received` vs `communication_channels.message.received`), two admin pages, two marketplace categories, two credential stores. CRM has to subscribe to both or miss messages.
2. **Per-user channels are unsupported in the hub today.** `CommunicationChannel` is tenant-scoped (`tenant_id` + `organization_id` only). Per-user accounts (each user's personal Gmail) need a way to attach a user as the owning principal.
3. **Hub assumes webhook-driven inbound.** SPEC-045d describes inbound as webhook → `verifyWebhook` → worker. Gmail/IMAP real-time push requires GCP Pub/Sub / IMAP IDLE — significant infra cost. We need a polling fallback baked into the hub.
4. **No third-party OAuth client flow in OSS core.** Only enterprise SSO has OAuth client primitives. We need to port that to the hub for any OAuth-based channel (Gmail, future Slack-OAuth, etc.).
5. **Cross-module integration without UMES is invasive.** Per-provider UI in the hub's pages would either bloat the hub or fork the hub per provider. UMES (already in the codebase) is the correct extension mechanism.

## Proposed Solution

**Approach C from brainstorming, rejected. Approach A adopted: two per-provider workspace packages under the hub, with minimal additive hub deltas.**

### High-level architecture

```
┌──────────────────────────────────────────────────────────────┐
│  Hub: @open-mercato/core/modules/communication_channels      │
│  (SPEC-045d, code partially missing — Phase 0 delivers gaps) │
│                                                              │
│  Owns:                                                       │
│   • ChannelAdapter v2 registry (DI)                          │
│   • CommunicationChannel entity (extended +user_id, +poll)   │
│   • ExternalConversation, ExternalMessage                    │
│   • MessageChannelLink, ChannelThreadMapping, MessageReaction│
│   • Inbound webhook router + inbound-processor worker        │
│   • Outbound subscriber on messages.message.sent             │
│   • NEW: poll-channel scheduler + worker (per-channel)       │
│   • NEW: per-user channel ACL gates                          │
│   • NEW: OAuth state-cookie helper (ported from enterprise)  │
│   • NEW: OAuth callback router /api/communication_channels   │
│         /oauth/[provider]/callback                           │
└──────────────────────────────────────────────────────────────┘
              ▲                       ▲
              │                       │  (each registers ChannelAdapter via setup.ts)
   ┌──────────┴──┐          ┌─────────┴─────┐
   │ channel-     │         │ channel-      │
   │ gmail        │         │ imap          │
   │ (OAuth +     │         │ (basic auth + │
   │  History API)│         │  imapflow +   │
   │              │         │  nodemailer)  │
   └──────────────┘         └───────────────┘
              │                       │
              └───────────┬───────────┘
                          ▼
                  UMES extension surface
                  (widgets, enrichers,
                   guards, overrides)
                          ▼
              ┌──────────────────────────┐
              │ Messages module          │
              │ (SPEC-002) — UNCHANGED   │
              │ Inbox auto-populated     │
              │ via hub's bridge.        │
              └──────────────────────────┘
```

### Design Decisions

| Decision | Rationale |
|----------|-----------|
| **Two provider packages (gmail / imap), not one `channel_email`** | The lesson "Keep external integrations as dedicated npm workspace packages" (`.ai/lessons.md`) and the existing `packages/gateway-stripe` / `packages/sync-akeneo` precedent override SPEC-045d §11.3's `channel_email` sketch. Gmail OAuth and IMAP basic auth are fundamentally different — two packages is honest. |
| **Per-user channels via additive `CommunicationChannel.user_id?` column** | Cleanest extension to the hub. NULL = tenant-scoped (existing WhatsApp Business behavior). Set = user-scoped (Jane's personal Gmail). No parallel table, no schema migration of existing rows, single canonical channel registry. |
| **Polling via hub-side scheduler + `ChannelCapabilities.realtimePush?: boolean`** | Hub owns the scheduling; providers declare whether they support push. Providers that opt out get hub-managed polling using their existing `fetchHistory()` method — no provider-side polling primitive needed. Future v2 push providers flip the flag. |
| **Inbound emails auto-create `Message` records in the inbox via existing hub bridge** | This is the whole point of the hub. Per-user channel owner becomes the default `ChannelThreadMapping.assigned_user_id`. CRM, search, notifications, reactions, threading all come for free. |
| **Outbound via standard hub flow + thin `sendAsUser` facade** | One send path. The facade is just a typed `Message` creator that sets the channel routing metadata correctly; the actual send happens through the hub subscriber → adapter chain. |
| **Hub credentials store with additive `user_id?` column on `integration_credentials`** | Reuses encryption, audit, admin UI. Per-user secrets are isolated via app-layer `WHERE user_id = currentUser.id OR user_id IS NULL`. No parallel credential table. |
| **OAuth state-cookie helper ported locally to the hub, not imported from enterprise** | `@open-mercato/core` MUST NOT depend on `@open-mercato/enterprise`. The pattern is small and self-contained. Phase 0 includes a `grep` verification step. |
| **Resend pipeline untouched** | System-identity transactional flows (password reset, MFA, billing) remain on Resend. Migrating them to per-user channels is a v3 question, not a v1 scope. |
| **UMES used aggressively (17 extension points)** | Every cross-module concern (admin UI, inbox rendering, response enrichment, mutation guarding, notification reactivity) goes through UMES. Provider packages never patch core hub pages. |

### Alternatives Considered

| Alternative | Why Rejected |
|-------------|-------------|
| **A1. Standalone `email` module + three `email-*` provider packages (previous draft)** | Duplicates the hub. Two storage models, two event streams, two admin homes. Maintainer rejected. |
| **A2. Single `channel_email` package with internal Gmail/IMAP strategies (matches SPEC-045d §11.3 literally)** | Violates the per-provider workspace convention. Gmail/IMAP have different OAuth/auth/sync mechanisms — packaging them together produces an internally heterogeneous module that's hard to release, version, or disable independently. |
| **A3. Build polling per-provider (each provider package owns its scheduler)** | Triplicates the scheduler logic, fragments backoff behavior, makes adding a fourth poll-based channel (e.g., LinkedIn) an N×M problem. Hub-side scheduler is the correct factoring. |
| **A4. Parallel `user_email_credentials` table (per-user secrets isolated by schema, not by `WHERE`)** | The hub's `integration_credentials` is already encrypted, audited, and admin-managed. A parallel table would need to re-implement all of that. The `user_id` column is sufficient — leaks are prevented at the query layer (with mutation-guard defense in depth). |
| **A5. Wait for v2 push support before shipping any email** | The product needs email v1 now. Polling is a well-known acceptable pattern (HubSpot, Pipedrive, Salesforce Inbox all defaulted to polling at v1). |
| **A6. Implement the hub in this spec from scratch (ignoring SPEC-045d)** | SPEC-045d is the locked architectural contract. We deliver the runtime that matches it (Phase 0), nothing more. |

## User Stories

- **A sales rep** wants to **connect their Gmail in Open Mercato** so that **the customer conversations I have through Open Mercato come from my own address and replies land in my inbox.**
- **An account manager** wants to **link their work mailbox** so that **future CRM features attach conversations to my deals automatically.**
- **A user with a Fastmail account** wants to **connect via IMAP+SMTP** so that **the integration works without my provider having to offer OAuth.**
- **A user with both a work IMAP mailbox and a personal Gmail** wants to **connect both and mark one as primary** so that **the system knows which to default to when I compose.**
- **A tenant admin** wants to **see which users have connected accounts and which are unhealthy** so that **I can help them reconnect — without ever seeing the contents of their emails.**
- **A tenant admin in a SaaS deployment** wants to **use the platform's shared OAuth app** so that **I don't have to register my own with Google.**
- **A tenant admin in a self-hosted deployment** wants to **register the tenant's own Google Cloud OAuth client** so that **the consent screen shows their company name.**
- **A future CRM module author** wants to **subscribe to `communication_channels.message.received` and get email, WhatsApp, and Slack messages through one event stream** so that **I write one cross-channel CRM bridge, not three.**

## Architecture

### Package & Module Layout

```
packages/core/src/modules/communication_channels/      # The hub (SPEC-045d)
  index.ts                                             # ModuleInfo
  setup.ts                                             # ACL grants, channel adapter registry init
  acl.ts                                               # Feature IDs (extended per §"ACL")
  di.ts                                                # ChannelAdapterRegistry, OAuthStateService
  encryption.ts                                        # Encrypted columns (extended)
  data/
    entities.ts                                        # Hub entities + new columns (see Data Models)
    validators.ts                                      # Zod schemas
    extensions.ts                                      # EntityExtension: CommunicationChannel → auth.User (FK)
  lib/
    adapter.ts                                         # ChannelAdapter v2 interface (from SPEC-045d)
    capabilities.ts                                    # ChannelCapabilities interface (extended +realtimePush?)
    registry.ts                                        # DI registry of ChannelAdapter instances
    oauth-state.ts                                     # PORTED from enterprise SSO; AES-256-GCM + HKDF
    oauth-router.ts                                    # Generic /api/communication_channels/oauth/[provider]/callback
    send-as-user.ts                                    # sendAsUser({ userChannelId, ... }) facade
  commands/                                            # See Commands & Events
    connectChannel.ts
    disconnectChannel.ts
    setPrimaryChannel.ts
    refreshChannelCredentials.ts
    markChannelRequiresReauth.ts
  workers/
    poll-channel.ts                                    # NEW: hub-managed polling, calls adapter.fetchHistory
    inbound-processor.ts                               # Existing in SPEC-045d (webhook + poll funnel here)
    outbound-delivery.ts                               # Existing in SPEC-045d (subscriber on messages.message.sent)
    purge-health-log.ts                                # NEW: daily cleanup
  api/                                                 # Auto-discovered
    post/oauth/[provider]/initiate/route.ts            # NEW: starts OAuth, sets state cookie
    get/oauth/[provider]/callback/route.ts             # NEW: state validation + token exchange
    post/channels/connect/credentials/route.ts         # NEW: credential-based (IMAP) connect
    get/channels/route.ts                              # Extended: per-user filter applied
    patch/channels/[id]/route.ts                       # Extended: per-user ACL
    delete/channels/[id]/route.ts                      # Extended: per-user ACL
    post/channels/[id]/set-primary/route.ts            # NEW
    post/channels/[id]/test-send/route.ts              # NEW: admin diagnostics
    post/send-as-user/route.ts                         # NEW: bespoke endpoint backing the facade
    get/admin/channels/route.ts                        # Extended: tenant-wide view, redacted DTO
    get/admin/health-log/route.ts                      # Extended
  backend/
    channels/page.tsx                                  # Existing in SPEC-045d (admin channels list)
    channels/[id]/page.tsx                             # Existing in SPEC-045d (channel detail)
    profile/communication-channels/page.tsx            # NEW: per-user "My Channels" page
  events.ts                                            # SPEC-045d events; NO new IDs (all routed through existing)
  notifications.ts                                     # New type: channel_requires_reauth (generic, channel-agnostic)
  notifications.client.ts                              # Client renderer

packages/channel-gmail/                                # @open-mercato/channel-gmail
  package.json
  build.mjs / watch.mjs                                # Standard provider package build
  src/modules/channel_gmail/                           # Module id: channel_gmail (snake_case)
    index.ts
    setup.ts                                           # registerChannelAdapter(gmailAdapter); marketplace row
    di.ts
    integration.ts                                     # IntegrationDescriptor: category 'communication', hub 'communication_channels'
    acl.ts                                             # NONE (uses hub features; per-provider gates live here only if needed)
    ce.ts                                              # OPTIONAL: per-channel custom fields (signature, default Gmail labels)
    translations.ts
    lib/
      adapter.ts                                       # ChannelAdapter v2 implementation
      capabilities.ts                                  # Gmail capabilities (threading, richText, attachments, no reactions, no realtimePush)
      oauth.ts                                         # Google OAuth client (authorize URL, exchange, refresh)
      sync.ts                                          # gmail.users.history.list incremental + gmail.users.threads.get
      send.ts                                          # gmail.users.messages.send with RFC2822 MIME
      contact-resolver.ts                              # From: header → CRM person lookup
      thread-resolver.ts                               # Message-ID / In-Reply-To / References → ChannelThreadMapping
      content-converter.ts                             # convertOutbound: Message body → RFC2822 MIME; normalizeInbound: MIME → text/html + attachments
      health.ts                                        # gmail.users.getProfile
    widgets/injection/                                  # UMES widget injections (see UMES section)
      profile-connect-gmail/
      admin-gmail-oauth-config/
      datatable-channels-status-badge-gmail/
    widgets/components.ts                              # OPTIONAL: component overrides
    enrichers/                                          # UMES response enrichers (see UMES section)
      message-email-headers.ts
      channel-token-expiry.ts
    interceptors/                                       # UMES API interceptors (see UMES section)
      validate-gmail-send.ts
    guards/                                             # UMES mutation guards (see UMES section)
      block-send-on-requires-reauth.ts

packages/channel-imap/                                 # @open-mercato/channel-imap, parallel structure to channel-gmail
  src/modules/channel_imap/
    ...                                                 # imapflow + nodemailer; basic auth; UIDVALIDITY+UIDNEXT
```

### `apps/mercato/src/modules.ts` entries

```ts
{ id: 'communication_channels', from: '@open-mercato/core' },   // Hub (Phase 0)
{ id: 'channel_gmail',          from: '@open-mercato/channel-gmail' },     // Phase 2
{ id: 'channel_imap',           from: '@open-mercato/channel-imap' },      // Phase 1
```

Module IDs use underscores per the root `AGENTS.md` rule "package `@open-mercato/<suffix>` ⇒ module id `<suffix>` with dashes converted to underscores". After enabling: `yarn mercato configs cache structural --all-tenants` (root `AGENTS.md` mandate after module-graph changes).

### OSS Independence

`@open-mercato/core` and the two provider packages MUST NOT import from `@open-mercato/enterprise`. The OAuth state-cookie helper is **ported (re-implemented locally)** at `packages/core/src/modules/communication_channels/lib/oauth-state.ts` — its design is informed by `packages/enterprise/src/modules/sso/lib/state-cookie.ts` but the file is independent. Phase 0 acceptance includes:

```bash
grep -r "@open-mercato/enterprise" \
  packages/core/src/modules/communication_channels \
  packages/channel-gmail \
  packages/channel-imap
# Expected: empty output
```

The local helper reproduces: AES-256-GCM payload encryption, HKDF key derivation, encrypted payload `{ nonce, userId, providerKey, returnUrl, iat, exp }`, 5-minute TTL, signature/tamper detection. Unit tests cover encrypt/decrypt roundtrip, TTL expiry, signature tamper, userId mismatch rejection. Key source: `OM_HUB_OAUTH_STATE_KEY` env var with HKDF fallback from `KMS_MASTER_KEY`.

### Relationship to `inbox_ops`

`inbox_ops` and this spec **coexist with disjoint inputs and disjoint intents.** They are not duplicates and neither replaces the other.

| Concern | `inbox_ops` (live module) | This spec (per-user channels under the hub) |
|---|---|---|
| **Source of mail** | A *dedicated* Resend mailbox the tenant sets up specifically for forwarding (e.g. `forward@tenant.example.com`). Users forward emails into that address from their own client. | The user's *own real mailbox* (Gmail, IMAP). Polled by the hub on the user's behalf. |
| **Intent** | "Extract structured actions from this forwarded email via LLM and propose them to a human for approval." Workflow / action-proposal pipeline. | "Show me my external conversations alongside WhatsApp/Slack/etc. in my unified inbox so I can reply." Conversational inbox. |
| **Storage destination** | `inbox_ops`'s own entities (proposals, actions, replies). Not threaded into the `messages` inbox. | The hub's `MessageChannelLink` + the `messages` module's threaded inbox. First-class inbox citizens. |
| **Events** | `inbox_ops.email.received/.processed/.failed/.reprocessed/.deduplicated`, `inbox_ops.proposal.*`, `inbox_ops.action.*`, `inbox_ops.reply.sent` — all `inbox_ops.*` namespace. | `communication_channels.message.received/.sent/.delivery_failed/.reaction.added` — hub events, channel-agnostic. |
| **Outbound** | Reply-send via Resend (the inbox_ops "reply" path). | Outbound through the user's own mailbox (Gmail send / SMTP). |
| **AI** | Yes — LLM-driven action extraction is the core feature. | No — v1 is plain conversational. (Future AI features would subscribe to `communication_channels.message.received` and live in a separate AI module.) |

**Concrete decisions for this spec:**

1. **This spec does NOT deprecate `inbox_ops`.** Both modules remain enabled. Both keep their event streams. `inbox_ops.email.*` events continue to fire when emails arrive at the forwarding Resend inbox; `communication_channels.message.received` fires when emails arrive in a user's connected mailbox.
2. **This spec does NOT subscribe to `inbox_ops.email.*` or vice versa.** They are independent pipelines.
3. **A user who has both a connected Gmail (via this spec) and forwards mail to the tenant's inbox_ops address** can legitimately see the same email surface in two places — the *unified inbox* (because they sent it from their Gmail, which the hub polled) and *inbox_ops* (because they forwarded it for action extraction). This is expected user behavior: forwarding is an explicit user action that signals "I want this processed by AI", not a duplicate signal.
4. **Future CRM bridge.** When CRM subscribes to `communication_channels.message.received`, it gets channel-agnostic external messages. If CRM also wants action-proposal flow on top of forwarded mail, it subscribes separately to `inbox_ops.proposal.*`. They don't need to be reconciled at the CRM layer either — the intents are different.
5. **Documentation note.** Each provider package's README and the hub's per-user-channels doc must explicitly say "this is for connecting your own mailbox; if you want to forward random emails into the platform's AI agent for action extraction, see `inbox_ops`." Prevents the most likely user confusion.

### Hub deltas required by this spec

All deltas are **additive** against SPEC-045d. No removal, no rename, no type narrowing.

#### Delta 1 — `CommunicationChannel.user_id?: string` (nullable UUID column)
- NULL = tenant-scoped channel (existing behavior, e.g., WhatsApp Business — unchanged).
- Set = user-scoped channel (e.g., Jane's Gmail). Under v1 strict owner-only, it is visible to the owning user **only** — not to admins/superadmins. `communication_channels.admin` grants no cross-user channel view (it is inert in v1). See **Per-user privacy & visibility model (v1)**.
- New partial unique index: `UNIQUE (user_id) WHERE is_primary AND user_id IS NOT NULL AND deleted_at IS NULL` (at most one primary per user).
- Migration is additive; existing rows have `user_id = NULL`.
- **Module boundary:** the column is a UUID storing the owning user's id but is **not declared as a database `FOREIGN KEY` to `users(id)`**. Root `AGENTS.md` forbids direct ORM relationships between modules. The cross-module link is declared instead via `EntityExtension` in `packages/core/src/modules/communication_channels/data/extensions.ts` (`{ from: 'communication_channels:communication_channel', field: 'user_id', to: 'auth:user', kind: 'one-to-one-optional' }`). Lookups across the link use the data engine, not raw joins.

#### Delta 2 — Polling + per-channel status columns on `CommunicationChannel`
- `poll_interval_seconds INTEGER NULL` — NULL means "this channel does not poll" (push-only providers — unchanged behavior). Set means hub-managed polling at that interval.
- `last_polled_at TIMESTAMPTZ NULL` — last successful poll timestamp; scheduler enumerates by this.
- `status TEXT NOT NULL DEFAULT 'connected'` — per-channel lifecycle state: `connected | requires_reauth | error | disconnected`. Existing `is_active` remains for the broader admin enable/disable toggle; `status` is finer-grained operational state. Migration sets `status = 'connected'` for all existing active channels.
- `last_error TEXT NULL` — most recent classified error message for diagnostics.
- `is_primary BOOLEAN NOT NULL DEFAULT FALSE` — per-user primary flag (only meaningful when `user_id IS NOT NULL`; ignored for tenant-scoped channels). Partial unique index enforced in Delta 1.
- Index: `(is_active, last_polled_at)` for the scheduler's enumeration query.

#### Delta 3 — `ChannelCapabilities.realtimePush?: boolean` (optional, default `true` for BC)
- Existing providers (WhatsApp, Slack) omit this field; treated as `true`.
- Email providers set `realtimePush: false` → hub schedules polling.

#### Delta 4 — `ChannelAdapter.refreshCredentials?(input): Promise<RefreshedCredentials>` (optional)
- For OAuth providers: hub calls this when a token is within 60s of expiry (or on 401 from a provider call). Adapter exchanges the refresh token for a new access token and returns the updated credential blob.
- IMAP/SMTP adapter omits this method (basic auth has no refresh).

#### Delta 5 — `IntegrationCredentials.user_id?: string` (nullable UUID column)
- Mirrors the channel column. Per-user secrets isolated by app-layer `WHERE user_id = currentUser.id OR user_id IS NULL`.
- Defense in depth: a mutation guard on `integration_credentials.read` blocks any query that does not include this filter unless the caller has `integrations.admin`.
- **Module boundary:** `integration_credentials` is owned by the `integrations` module. The hub does **not** add a `FOREIGN KEY` from the integrations table to `users(id)`. The cross-module link is declared via `EntityExtension` in `packages/core/src/modules/communication_channels/data/extensions.ts` (`{ from: 'integrations:integration_credential', field: 'user_id', to: 'auth:user', kind: 'one-to-one-optional' }`). The integrations module owns the schema migration that adds the column (coordinated PR); the hub spec owns the link declaration. Both PRs land together.

#### Delta 6 — Hub poll-channel worker
```ts
// packages/core/src/modules/communication_channels/workers/poll-channel.ts
export const metadata = { queue: 'communication-channels-poll', concurrency: 10 }

export default async function pollChannelWorker(job: { channelId: string }) {
  // 1. Load channel + adapter + credentials
  // 2. If channel.is_active === false or status !== 'connected' → skip
  // 3. If adapter.capabilities.realtimePush !== false → skip (provider doesn't want polling)
  // 4. If adapter.refreshCredentials && tokenExpiresAt < now + 60s → refresh + persist
  // 5. result = await adapter.fetchHistory({ channelId, credentials, since: last_polled_at })
  // 6. For each NormalizedInboundMessage in result.messages:
  //     dispatch existing hub inbound-processor (idempotent on externalMessageId)
  // 7. UPDATE communication_channels SET last_polled_at = NOW() WHERE id = $1
  // 8. On error: classify (auth 401 → markRequiresReauth; 429 → reschedule per Retry-After;
  //    5xx/transient → retry 3× with backoff; persistent → status='error', backoff to ceiling)
}
```

Cron tick (every 60s, single hub-internal job):
- `SELECT id FROM communication_channels WHERE is_active = true AND last_polled_at + poll_interval_seconds * interval '1 sec' <= NOW() ORDER BY last_polled_at NULLS FIRST LIMIT 500`
- Enqueue `poll-channel` jobs.
- Bounded enumeration (LIMIT 500) prevents fanout spikes; remaining channels picked up next tick.

**Scheduler mechanism**: register the tick via the existing `@open-mercato/scheduler` workspace package (the platform's canonical cron home). The hub declares one scheduled job in `packages/core/src/modules/communication_channels/schedulers/poll-tick.ts` exporting `{ id: 'communication_channels.poll-tick', cron: '* * * * *', handler }`. The handler runs the enumeration query and enqueues per-channel jobs onto the `communication-channels-poll` queue. Do **not** use `setInterval` in a worker process, BullMQ repeatable jobs directly, or any ad-hoc timer — `packages/scheduler` is the project convention.

Tick interval is configurable via `OM_HUB_POLL_SCHEDULER_TICK_SECONDS` (default 60). The scheduler tick budget is independent of per-channel `poll_interval_seconds`: a 60s tick + 300s default per-channel interval means each channel polls about every 5 minutes, with one query-and-fanout per minute regardless of how many channels exist.

#### Delta 7 — Hub OAuth callback infrastructure
- `GET /api/communication_channels/oauth/[provider]/callback` — generic state-cookie validation + adapter delegation. Already implied by SPEC-045d but no concrete route exists in code. This spec ships the canonical implementation.
- `POST /api/communication_channels/oauth/[provider]/initiate` — returns `{ authorizeUrl }` after setting state cookie. Adapter provides `buildAuthorizeUrl()`.

#### Delta 8 — Per-user channel ACL gates
- **v1 (strict owner-only, updated 2026-06-01):** a personal channel (`user_id` set) is **fully controlled by its owner** — connect, disconnect, set-primary, poll-now, import-history, register-push — gated by `communication_channels.connect_user_channel` (held by every email user) and enforced per channel type by `assertCanManageChannel`. `communication_channels.admin` grants **no** cross-user bypass. Managing a tenant-wide / shared channel still requires the elevated feature (`manage` / `channel.push.manage` / `channel.import_history`). The admin channels list (`GET /api/communication_channels/channels`) returns `user_id IS NULL` rows only; personal mailboxes surface exclusively on the profile page. See **Per-user privacy & visibility model (v1)** for the full record. (Superseded prior text: "a non-admin can only view/manage channels where `user_id = currentUser.id OR user_id IS NULL`", which both allowed admins to see all per-user channels AND gated owner self-service behind `manage`, which employees lack.)
- New feature ID `communication_channels.connect_user_channel` (default-granted to all roles via `setup.ts`) gates the per-user "Connect My Account" flow. This is split from `manage` so policy can disable new linking while preserving existing accounts.

#### Delta 9 — Notification type `channel_requires_reauth`
- Generic across channel types (not email-specific). Emitted by `markRequiresReauth` command.
- Renderer in hub's `notifications.client.ts` shows `<Alert variant="warning">` with channel name, provider, and a "Reconnect" CTA that opens the appropriate provider's reconnect flow.

### ChannelAdapter implementation — common pattern

Each provider package implements the `ChannelAdapter` v2 interface from SPEC-045d. The contract is reproduced here for reviewer convenience; SPEC-045d is the canonical source.

```ts
// Provider implementation skeleton (gmail / imap parallel)
export const gmailAdapter: ChannelAdapter = {
  providerKey: 'gmail',
  channelType: 'email',
  capabilities: gmailCapabilities,  // imports realtimePush: false

  async sendMessage(input)         { return sendViaGmail(input) },
  async verifyWebhook(input)       { throw new Error('Gmail v1 is polling-only') },  // never called
  async getStatus(input)           { return getDeliveryStatus(input) },              // best-effort
  async convertOutbound(input)     { return mimeFromMessage(input) },                // RFC2822 builder
  async normalizeInbound(raw)      { return parseMime(raw) },                        // mailparser → NormalizedInboundMessage
  async fetchHistory(input)        { return gmailHistorySync(input) },               // gmail.users.history.list
  async resolveContact(input)      { return lookupCrmByEmail(input.from) },          // optional

  // OAuth-only providers implement refreshCredentials
  async refreshCredentials(input)  { return googleRefresh(input.credentials) },
}
```

Capabilities differ per provider:

| Capability | Gmail | IMAP |
|---|---|---|
| `threading` | true (gmail threadId + RFC2822) | true (RFC2822 only) |
| `richText` | true (HTML body) | true (HTML body) |
| `fileSharing` | true (max 25 MB) | true (depends on server, default 25 MB) |
| `reactions` | false | false |
| `editMessage` | false | false |
| `deleteMessage` | false | false |
| `conversationHistory` | true (History API) | true (UIDVALIDITY + UIDNEXT) |
| `realtimePush` | false (v1) | false (v1) |
| `supportedBodyFormats` | `['text','html']` | `['text','html']` |

### Inbound flow (polling-based)

Reuses SPEC-045d §6 inbound flow with polling as the upstream source:

```
Hub cron (60s tick)
  ↓
SELECT channels needing poll
  ↓
Enqueue communication-channels-poll job per channel
  ↓
poll-channel worker
  • adapter.refreshCredentials? if OAuth and near expiry
  • adapter.fetchHistory(channelId, credentials, since: last_polled_at)
  ↓ result.messages: NormalizedInboundMessage[]
For each message → dispatch inbound-processor (existing SPEC-045d worker)
  ↓
inbound-processor (existing hub logic, unchanged by this spec):
  • Dedup by (channel_id, external_message_id)
  • Resolve ChannelThreadMapping (RFC2822 Message-ID/In-Reply-To/References lookup)
  • Create or reuse Message thread in messages module
  • Create Message (type: 'channel.email', body from normalized text/html)
  • Create MessageChannelLink (channelPayload: full MIME, channelContentType: 'email/mime',
                                 channelMetadata: { messageId, inReplyTo, references, from, to, cc, bcc })
  • Create ExternalMessage (direction='inbound')
  • adapter.resolveContact? → ExternalConversation.contactPersonId
  • Emit communication_channels.message.received
  ↓
Messages inbox + UMES enrichers update in real-time (clientBroadcast: true)
```

### Outbound flow (send-as-user)

#### Path A — User composes a Message in the inbox UI (standard hub outbound flow):

```
User composes Message via /backend/messages
  ↓ POST /api/messages
  ↓ Message created (type: channel.email, with threadId/parentMessageId/channel routing metadata)
  ↓ messages.message.sent event fires
  ↓
Hub subscriber (outbound-delivery, existing SPEC-045d):
  • Re-fetch Message by messageId (do NOT depend on event payload shape)
  • Resolve ChannelThreadMapping by message.threadId
  • Load channel + adapter + credentials
  • adapter.refreshCredentials? if OAuth + near expiry
  • adapter.convertOutbound({ body, bodyFormat, attachments, channelMetadata }) → MIME
  • adapter.sendMessage(converted)
  • Create ExternalMessage + MessageChannelLink (direction='outbound')
  • Emit communication_channels.message.sent
```

**Subscriber contract — no payload coupling.** The hub's outbound-delivery subscriber receives `messages.message.sent` with whatever payload the messages module defines (today: a minimal `{ messageId, threadId?, sentBy, ... }`-style shape). The subscriber **re-fetches the Message row by `messageId`** and reads channel-routing metadata from there. This decouples the hub from any future payload-shape changes in the messages module and keeps the BC contract one-way: the messages module owns its payload; the hub adapts to whatever it emits. If the Message has no associated `ChannelThreadMapping`, the subscriber is a no-op (this is just an internal-only message, not channel-bound).

#### Path B — Programmatic `sendAsUser` facade (workflows, AI tools, integrations):

```ts
import { sendAsUser } from '@open-mercato/core/modules/communication_channels/lib/send-as-user'

await sendAsUser({
  userChannelId,                  // FK to CommunicationChannel where user_id = currentUser.id
  to: ['customer@example.com'],
  cc?: [...],
  bcc?: [...],
  subject: '...',
  body: { plain?: '...', html?: '...' },
  attachments?: AttachmentRef[],  // discriminated union (see API Contracts)
  inReplyTo?: '<previous-message-id@example.com>',
  references?: ['<...>', '<...>'],
})
// Internally: validates user owns userChannelId, creates Message with right routing metadata,
// which triggers Path A's subscriber. Returns { messageId, externalMessageId, providerThreadId, sentAt }.
```

There is exactly **one send path**. The facade is a typed wrapper around the standard Message creation API.

### UMES extension surface (the 17 hooks)

Provider packages and the hub use UMES per SPEC-041 to compose UI, data, and behavior without modifying core hub pages.

#### Per provider (declared in each provider's package)

1. **Widget injection — `profile:tabs`** (Phase B): "Connect Gmail" / "Connect IMAP" tab/CTA in the per-user `/backend/profile/communication-channels` page. Each provider injects its own connect widget.
2. **Widget injection — `admin.page:integrations:<provider>:oauth-config`** (Phase A): OAuth client_id / client_secret form for Gmail. Tenant-level override of platform defaults. IMAP provider injects an "enabled/disabled" toggle (no OAuth config).
3. **Widget injection — `data-table:communication_channels:channels:columns`** (Phase F): provider-specific status columns. Gmail injects "Gmail labels filter" column; IMAP injects "Folder" column.
4. **Widget injection — `data-table:messages:columns`** (Phase F): channel-type badge column (hub-side, but each provider supplies its icon + tint via per-provider widget registration so the hub doesn't need to know about provider visuals).
5. **Widget injection — `messages:thread:detail:rich-content`** (Phase A): when `MessageChannelLink.channelContentType === 'email/mime'`, render To/Cc/Bcc, attachments list, original headers, "Reply / Reply All / Forward" actions. Provider-agnostic widget lives in hub; per-provider provider-specific tweaks (Gmail's labels chip) injected by each provider.
6. **CrudForm field injection — `crud-form:communication_channels.channel:fields:<provider>`** (Phase G): per-provider credential fields. IMAP injects host/port/TLS/user/password (×2 for SMTP), plus the security-ack checkbox. Gmail injects scope selectors and login_hint.
7. **Response enricher — `_email` namespace on `Message`** (Phase D): parse and expose `From`, `To`, `Cc`, `Bcc`, `Subject`, attachment list, original `Message-ID`, `In-Reply-To`, threading chain. Triggered when `MessageChannelLink.channelContentType.startsWith('email/')`. Batched via `enrichMany` to avoid N+1.
8. **Response enricher — `_channel_health` on `CommunicationChannel`** (Phase D): provider-computed `tokenExpiresAt`, `lastSuccessfulPoll`, `errorCount24h`. Per-provider implementation; hub aggregates.
9. **API interceptor — `before` on `POST /api/messages`** (Phase E): when message routes to a `channel_<provider>` channel, validate the caller owns the channel and the channel status is `connected`. Returns 409 `CHANNEL_NOT_AVAILABLE` if not. Defense in depth on top of the standard hub guard.
10. **API interceptor — `after` on `GET /api/communication_channels`** (Phase E): apply `WHERE user_id = currentUser.id OR user_id IS NULL` filter at the response layer (belt + suspenders with the SQL-level filter). Hub-side, not per-provider.
11. **Component replacement — `wrapper` on `MessagesThreadDetailHeader`** (Phase H): when channel type is `email`, wrap with a subcomponent that surfaces the email subject and threading status. Hub-side wrapper; per-provider overrides via `props` mode where useful (e.g., Gmail's "Important" badge).
12. **Mutation guard — `communication_channels.channel.delete`** (Phase M): block disconnect if the channel has unread inbound messages or pending outbound retries in the last 5 minutes, unless `force: true` is passed. Hub-side guard; provider-agnostic.
13. **Mutation guard — `messages.message.create` when target channel status is not `connected`** (Phase M): block with 409. Per-provider error message via i18n.
14. **Sync event subscriber — `auth.user.deleted`** (Phase M): cascade-soft-delete all user-owned channels for that user. Hub-side subscriber.
15. **Notification handler — `useNotificationEffect` on `channel_requires_reauth`** (`packages/core/.../notifications.handlers.ts`): if the user is currently on `/backend/profile/communication-channels` when the notification arrives, auto-open the reconnect dialog for the affected channel. Hub-side.
16. **Command interceptor — `beforeUndo` on `channel.disconnect`** (Phase M): fail loudly because credentials were purged at disconnect — undo is not possible. Hub-side, consistent with other destructive hub commands.
17. **Custom fields / Entity extensions** (existing): per-channel custom fields per provider (e.g., "Default signature", "Auto-reply", "Default Gmail label") declared in each provider's `ce.ts`. `EntityExtension` from each provider to `CommunicationChannel` for any per-provider metadata that doesn't fit in capabilities.

UMES coverage check:
- Phase A (widget injection): ✓
- Phase B (menu injection): ✓ ("Communication Channels" added to user profile sidebar — hub-side menu injection contribution)
- Phase C (events + DOM bridge): ✓ (the hub events `communication_channels.message.received/.sent/.delivery_failed/.reaction.added` have `clientBroadcast: true` and are consumed by UMES widgets via `useAppEvent`; cross-process bridge note in §"Risks" — see lessons.md "Browser SSE bridges must work across worker and web processes")
- Phase D (response enrichers): ✓
- Phase E (API interceptors): ✓
- Phase F (DataTable extensions): ✓
- Phase G (CrudForm fields): ✓
- Phase H (component replacement): ✓
- Phase I (detail page bindings): ✓ (via `useExtensibleDetail` in the channel detail page)
- Phase J (recursive widgets): ✓ (provider's CrudForm-field widget can itself contain nested injection spots, e.g. IMAP's "advanced settings" collapsible)
- Phase K (DevTools): N/A — provider packages don't add DevTools surface
- Phase L (integration extensions): ✓ (wizard widgets on `/backend/integrations` for Gmail, IMAP)
- Phase M (mutation lifecycle): ✓
- Phase N (query engine extensibility): ✓ (the `_email` enricher participates in query-engine pipelines so search/filter on parsed headers works without N+1)

### Security Posture

- **No HTML email rendering in raw `dangerouslySetInnerHTML` paths.** Inbound HTML stored verbatim in `MessageChannelLink.channelPayload`. **Canonical sanitizer location**: `packages/core/src/modules/communication_channels/lib/sanitize-channel-html.ts` (lives in the hub; ships as part of SPEC-045d delivery). The Messages module's rich-content renderer **imports** this helper at the call site (in the `messages:thread:detail:rich-content` widget injection). The hub owns the function; the Messages module owns the call site. Hub helper uses DOMPurify (or equivalent) with an allowlist tuned for email (`<a>`, `<img>`, `<table>`, `<tbody>`, `<tr>`, `<td>`, `<p>`, `<br>`, `<ul>`, `<ol>`, `<li>`, `<strong>`, `<em>`, `<blockquote>`; strips `<script>`, event-handler attributes, `javascript:` and `data:` URLs except `data:image/*`). Email is the first channel shipping HTML payloads — if SPEC-045d delivery does not include this sanitizer, **Phase 1 of this spec cannot ship** and the gap is escalated back to the hub's spec/PR.
- **OAuth state-cookie**: AES-256-GCM encryption, HKDF key derivation, HttpOnly + SameSite=Lax cookie, 5-minute TTL, `userId` bound (callback rejects if `currentSession.userId !== state.userId`). Forgery requires the encryption key (KMS-managed).
- **Credential storage**: hub's `integration_credentials` with field-level encryption (existing pipeline; no per-provider crypto). New `user_id` column isolates per-user secrets at the row level.
- **Per-user channel privacy** (v1 strict owner-only, updated 2026-06-01): personal mailboxes and their CRM email threads are visible to the owner only — admins included. The admin channels list is restricted to `user_id IS NULL`; `assertCanAccessChannel` grants no admin bypass on personal channels; the Person-page threads scope to `author_user_id = viewer`; the email-visibility filters drop the admin bypass. See **Per-user privacy & visibility model (v1)**.
- **Credential-key rejection in logs**: hub's `EmailHealthLog` Zod validator (already present in SPEC-045d's design) rejects any context key matching `/^(credential|password|token|secret|access[_-]?token|refresh[_-]?token)/i`. Worker error handlers strip such keys from caught exceptions before logging.
- **URL construction**: all OAuth authorize URLs built via `URLSearchParams`. Provider-base URLs validated against an allowlist (Google) — IMAP host/port validated as DNS-resolvable + numeric in range (lesson "Provider credentials must never control authenticated cross-origin requests").
- **Parameterized queries**: all DB access via MikroORM repository methods or query builder; no raw SQL interpolation in route handlers (lesson "Keep raw SQL out of API route handlers").

### Per-user privacy & visibility model (v1 — strict owner-only)

> Added 2026-06-01. Authoritative record of how personal-mailbox privacy is
> enforced. v1 chooses **strict owner-only**: a user's connected personal mailbox
> and its email threads are visible to that user **and no one else — not even an
> admin or superadmin**. Team oversight is deliberately deferred to v2 (below).

**Channel ownership.** `CommunicationChannel.user_id` distinguishes a *personal
mailbox* (`user_id` set — Jane's Gmail) from a *shared / tenant-wide channel*
(`user_id IS NULL` — a WhatsApp Business number, a shared support inbox, a Slack
workspace).

**Where personal mailboxes appear.**
- **Profile page** `/backend/profile/communication-channels` → `GET /api/communication_channels/me/channels`, filtered strictly to `user_id = currentUser.id`. Owners manage their own mailboxes here.
- **Admin page** `/backend/communication_channels/channels` → `GET /api/communication_channels/channels`, filtered to **`user_id IS NULL` only**. It lists shared / system channels exclusively; personal mailboxes never appear here for any role. This removes the "same email shows in both places" overlap and any cross-user channel exposure.

**Per-channel management — owners have full control of their own accounts**
(`assertCanManageChannel`). A user can disconnect, set-primary, poll-now,
import-history, and register-push on **their own personal mailbox**, gated by
`communication_channels.connect_user_channel` (every email user holds it — the
same feature that lets them connect). A personal channel (`user_id` set) may be
acted on **only by its owner**; admin grants do **not** bypass this. Managing a
**tenant-wide / shared** channel (`user_id IS NULL`, e.g. WhatsApp Business /
Slack) still requires the route's elevated feature
(`communication_channels.manage`, `…channel.push.manage`, or
`…channel.import_history`) — enforced per channel type inside
`assertCanManageChannel`. Read-only routes (channel detail, health) keep their
`view` gate plus the owner check (`assertCanAccessChannel`).

**CRM email threads on the Person page** (`GET /api/customers/people/[id]/email-threads`,
`customers/lib/personEmailThreads.ts`). A viewer sees **only their own** threads
with that person — email interactions where `author_user_id = viewerUserId` —
plus ownerless shared/system rows (`author_user_id IS NULL`). Fail-closed: an
email whose author cannot be established stays hidden. No admin bypass.

**Interaction visibility flag.** Email interactions are created (in
`customers/lib/link-channel-message-handler.ts`) with `author_user_id =
channel.user_id` (the mailbox owner) and `visibility = 'private'` for personal
channels (`'shared'` for tenant-wide). The shared visibility filters
(`applyEmailVisibilityFilter` / `buildEmailVisibilityMikroFilter`, used by the
interactions list, counts, activities timeline, and person/company detail) hide
`private` emails from everyone except their author — **with no admin bypass in
v1**. Only the author may flip their own email's visibility
(`PATCH /api/customers/interactions/[id]/visibility`).

**Inert-in-v1 features.** `customers.email.view_private` stays *declared* but
grants no read/write bypass in v1; likewise `communication_channels.admin` no
longer grants a cross-user channel view. Both are the hooks the v2 oversight
feature will re-activate.

**v2 — oversight (out of scope here).** A future, explicit, audited oversight
capability may let a manager/admin view team mailboxes and threads. Shipping the
strictest model first means turning oversight *on* later is an additive, visible
decision rather than a default users never opted into.

### OAuth client-credential resolution

> Clarified 2026-06-01.

The tenant's OAuth **client application** config (clientId / clientSecret /
scopes) is stored on the provider's own integration row — `channel_<provider>`
(e.g. `channel_gmail`) at **tenant scope** (`user_id = NULL`) — exactly the row
an admin edits under `/backend/integrations` and the row the provider health
check reads. The per-user OAuth **tokens** persist under the **same**
`channel_<provider>` id at **user scope** (`user_id` set); the two are
distinguished by scope and never collide.

All OAuth code paths (authorize-initiate, code-exchange callback, token refresh)
resolve the client config via `resolveOAuthClientCredentials()`
(`communication_channels/lib/oauth-client-config.ts`) at tenant scope, with an
organization-agnostic (`organization_id IS NULL`) fallback so one platform /
tenant OAuth app serves every organization. There is **no** separate
`oauth_<provider>` integration id — earlier code read that phantom id (which
nothing ever writes), so connect/refresh failed with "expected string, received
undefined" even while the integration showed configured and healthy. When the
client config is genuinely absent the connect flow returns an actionable
`oauth_client_not_configured` error instead of a cryptic schema failure.

### Access Control (extends SPEC-045d's `acl.ts`)

The hub already defines `communication_channels.view`, `communication_channels.manage`, `communication_channels.admin`. This spec adds one feature ID:

```ts
// packages/core/src/modules/communication_channels/acl.ts (extended)
export const features: ModuleFeature[] = [
  // ...existing SPEC-045d features...
  { id: 'communication_channels.connect_user_channel',
    title: 'Connect own communication channel',
    module: 'communication_channels' },
]
```

`setup.ts` default grants (mirroring SPEC-045d's pattern):

```ts
defaultRoleFeatures: {
  admin:   ['communication_channels.view', 'communication_channels.manage',
            'communication_channels.admin', 'communication_channels.connect_user_channel'],
  manager: ['communication_channels.view', 'communication_channels.manage',
            'communication_channels.connect_user_channel'],
  user:    ['communication_channels.view', 'communication_channels.manage',
            'communication_channels.connect_user_channel'],
}
```

After implementation: `yarn mercato auth sync-role-acls` so existing tenants receive the new feature grant.

## Data Models

This spec adds **zero new tables**. All deltas are additive columns on existing hub tables.

### `communication_channels` (extended)

The migration is produced by `yarn db:generate` from the updated MikroORM entity in `packages/core/src/modules/communication_channels/data/entities.ts`. The SQL below is **illustrative**, showing the expected shape — do not hand-write it. Note especially that there is **no `REFERENCES users(id)` foreign key**; the cross-module link is declared via `EntityExtension` (see § Hub Deltas → Delta 1).

```sql
-- Illustrative — generated by `yarn db:generate`
ALTER TABLE communication_channels
  ADD COLUMN user_id UUID NULL,                      -- linked to auth:user via EntityExtension, not raw FK
  ADD COLUMN is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN poll_interval_seconds INTEGER NULL,
  ADD COLUMN last_polled_at TIMESTAMPTZ NULL,
  ADD COLUMN status TEXT NOT NULL DEFAULT 'connected',
       -- 'connected' | 'requires_reauth' | 'error' | 'disconnected'
  ADD COLUMN last_error TEXT NULL;

CREATE UNIQUE INDEX communication_channels_one_primary_per_user
  ON communication_channels (user_id)
  WHERE is_primary AND user_id IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX communication_channels_poll_due
  ON communication_channels (is_active, last_polled_at)
  WHERE deleted_at IS NULL;

CREATE INDEX communication_channels_user_lookup
  ON communication_channels (user_id, channel_type, deleted_at);
```

### `integration_credentials` (extended)

Owned by the `integrations` module; the column is added there in a coordinated PR (see § Hub Deltas → Delta 5). No raw FK to `users(id)`; the cross-module link is declared via `EntityExtension` in this hub's `data/extensions.ts`.

```sql
-- Illustrative — generated by `yarn db:generate` against integrations module entity
ALTER TABLE integration_credentials
  ADD COLUMN user_id UUID NULL;                      -- linked to auth:user via EntityExtension, not raw FK

CREATE INDEX integration_credentials_user_lookup
  ON integration_credentials (user_id) WHERE user_id IS NOT NULL;
```

### `data/extensions.ts` (hub module)

The link declarations live with the hub (`packages/core/src/modules/communication_channels/data/extensions.ts`) so the dependency direction is hub → auth and hub → integrations, never the other way round:

```ts
import type { EntityExtension } from '@open-mercato/shared/modules/extensions'

export const extensions: EntityExtension[] = [
  {
    from: 'communication_channels:communication_channel',
    field: 'user_id',
    to: 'auth:user',
    kind: 'one-to-one-optional',
  },
  {
    from: 'integrations:integration_credential',
    field: 'user_id',
    to: 'auth:user',
    kind: 'one-to-one-optional',
  },
]
```

### Encryption (`packages/core/src/modules/communication_channels/encryption.ts`)

The hub already encrypts `integration_credentials.credentials` (via the integrations module's `defaultEncryptionMaps`). This spec changes nothing in encryption maps; the new `user_id` column is not sensitive and is not encrypted.

Reads continue to use the canonical helper:

```ts
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'

const cred = await findOneWithDecryption(
  em,
  'IntegrationCredential',
  { id: channel.credentialsRef, userId: currentUser.id },  // NEW: scope by user
  /* options */ undefined,
  /* scope */ { tenantId, organizationId },
)
```

## API Contracts

All hub routes already exist in SPEC-045d (`GET /api/communication_channels/channels`, etc.) or were extended above. Only the **new** routes introduced by this spec are documented here. Each route file exports per-method `metadata` with `requireAuth` + `requireFeatures` (no top-level `export const requireAuth` — root `AGENTS.md` rule). All routes export `openApi`. Bodies validated via Zod schemas in `data/validators.ts`. CRUD routes use `makeCrudRoute({ indexer: { entityType: 'communication_channels:communication_channel' } })`; bespoke writes use `validateCrudMutationGuard` + `runCrudMutationGuardAfterSuccess`. Pagination: cursor-based, `limit ≤ 100`; health log uses keyset on `(created_at DESC, id DESC)`.

### Per-method `metadata` shape — canonical example

Every new route file follows this shape. The pattern is required, not optional — top-level `export const requireAuth = true` is forbidden by `packages/core/AGENTS.md`.

```ts
// packages/core/src/modules/communication_channels/api/post/oauth/[provider]/initiate/route.ts
import { z } from 'zod'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'

export const metadata = {
  POST: {
    requireAuth: true,
    requireFeatures: ['communication_channels.connect_user_channel'],
  },
}

export const openApi = {
  POST: {
    summary: 'Initiate per-user channel OAuth flow',
    requestBody: z.object({ channelType: z.literal('email').optional(), returnUrl: z.string().url().optional() }),
    responses: { 200: z.object({ authorizeUrl: z.string().url() }) },
  },
}

export async function POST(req: Request, { params, container }) {
  // …state-cookie set, adapter.buildAuthorizeUrl(), return { authorizeUrl }
}
```

Routes that mutate (everything except the OAuth callback, which is GET-with-side-effects-but-guarded-by-state-cookie) wrap their write in `validateCrudMutationGuard(...)` + `runCrudMutationGuardAfterSuccess(...)` per `packages/shared/src/lib/crud/mutation-guard.ts`. The `send-as-user` route is the canonical bespoke-write example.

### `POST /api/communication_channels/oauth/[provider]/initiate`
- Features: `communication_channels.connect_user_channel`
- Body: `{ channelType?: 'email', returnUrl?: string }`
- Server: provider read from path; adapter resolved from registry; state cookie set; `{ authorizeUrl }` returned.

### `GET /api/communication_channels/oauth/[provider]/callback`
- No auth feature (state cookie carries identity)
- Query: `code`, `state` (Google)
- Response: 302 to `returnUrl` (default `/backend/profile/communication-channels?flash=connected`) or `?flash=error&code=...`
- Errors: invalid state, expired state, userId mismatch, exchange failure — all redirect with `flash=error`.

### `POST /api/communication_channels/channels/connect/credentials`
- Features: `communication_channels.connect_user_channel`
- Body: provider-discriminated; IMAP shape: `{ providerKey: 'imap', displayName, imapHost, imapPort, imapTls, imapUser, imapPassword, smtpHost, smtpPort, smtpTls, smtpUser, smtpPassword }`
- Server: `adapter.validateCredentials?({ ... })` (new optional method for credential-based adapters; IMAP implements it); on success, hub creates `CommunicationChannel` with `user_id = currentUser.id`.
- Response: `{ channelId }` on success; 422 with `createCrudFormError` field-level errors on failure.

### `POST /api/communication_channels/channels/[id]/set-primary`
- Features: `communication_channels.manage`
- Server: verifies `user_id === currentUser.id`; clears `is_primary` on other channels owned by the user; sets on this one.

### `POST /api/communication_channels/channels/[id]/test-send`
- Features: `communication_channels.manage`
- Body: `{ to: string }`
- Server: dispatches a small test email via `adapter.sendMessage`. Records result in `HealthLog`. Returns delivery status.

### `POST /api/communication_channels/send-as-user`
- Features: `communication_channels.manage`
- Body: `{ userChannelId, to[], cc?[], bcc?[], subject, body: { plain?, html? }, attachments?: AttachmentRef[], inReplyTo?, references?[] }`
- Server: thin wrapper around the same Message creation API used by the inbox UI. Validates ownership, creates Message with channel routing metadata, returns `{ messageId, externalMessageId, providerThreadId, sentAt }`.
- Errors: 401 (no session), 403 (not owner), 409 (channel not connected / requires_reauth), 422 (invalid body), 502 (provider error with classification).

### `AttachmentRef` type (Zod discriminated union)

Defined in `packages/core/src/modules/communication_channels/data/validators.ts` (hub-side, shared by all providers):

```ts
export const attachmentRefSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('attachment'),
    attachmentId: z.string().uuid(),                    // FK to attachments module
    filename: z.string().min(1).max(255).optional(),
  }),
  z.object({
    kind: z.literal('inline'),
    filename: z.string().min(1).max(255),
    mimeType: z.string().min(1).max(255),
    contentBase64: z.string().min(1),                   // server enforces 10 MB / attachment, 25 MB total
  }),
])
export type AttachmentRef = z.infer<typeof attachmentRefSchema>
```

Per-provider attachment limits come from `ChannelCapabilities.maxFileSize`. Send fails fast with 422 if request exceeds the resolved channel's capabilities.

## I18n

Per `packages/shared/AGENTS.md`. Locale keys live in each provider's `src/modules/channel_<provider>/locales/<lang>.json` plus hub keys in the hub module's locales.

Required namespaces:
- Hub: `communication_channels.channel.status.*`, `.actions.*`, `.banner.requiresReauth`, `.notifications.requires_reauth.*`, `.errors.channel_not_available`
- Per provider: `channel_gmail.label`, `channel_gmail.connect.button`, `channel_gmail.scopes.*`, `channel_gmail.errors.*` (and parallel for `channel_imap`)

Translations via `useT()` client-side, `resolveTranslations()` server-side.

## UI/UX

### User-facing: `/backend/profile/communication-channels`
- **NEW hub page** (replaces what the previous spec called `/backend/profile/email-accounts`). Generic across channel types — Gmail / IMAP / future Slack OAuth all surface here.
- Top section: `<EmptyState>` for empty / Alert banner for `requires_reauth` channels.
- DataTable (`entityId: 'communication_channels:user_channel'`):
  - Provider icon (lucide-react via backend icon registry — `Mail` for email, `MessageCircle` for chat channels)
  - Display name (inline-editable)
  - Email/external address
  - Primary toggle
  - Status badge — semantic status tokens: `bg-status-success-soft text-status-success-fg` (connected), `bg-status-warning-soft text-status-warning-fg` (requires_reauth), `bg-status-error-soft text-status-error-fg` (error)
  - Last synced (relative time)
  - RowActions ids: `communication-channel:rename`, `:set-primary`, `:reconnect`, `:disconnect`
- "Connect channel" split button (top-right) is UMES-driven: each provider package injects its own entry via `profile:communication-channels:connect` widget spot. The Gmail entry redirects to `authorizeUrl`; IMAP entry opens a `CrudForm` dialog with the security-ack checkbox.
- All dialogs: `Cmd/Ctrl+Enter` submit, `Escape` cancel.
- Every icon-only button has `aria-label` (`.ai/ui-components.md`).
- Pagination: `pageSize ≤ 100`.

### Admin: `/backend/communication_channels/channels` (existing hub page, no new route)
- **v1 (updated 2026-06-01):** this page lists **shared / tenant-wide channels only** (`user_id IS NULL` — WhatsApp Business, shared inboxes, Slack workspaces). Personal email mailboxes (`user_id` set) are **never** shown here; they live exclusively on the profile page and are private to their owner. (Superseded prior plan: an "Owner" column + "show user-owned channels" filter that surfaced per-user mailboxes to admins — dropped under v1 strict owner-only.) The aggregate card (total connected, requires_reauth, error counts) covers the shared channels in view.
- Per-provider OAuth client config is configured under `/backend/integrations` on the provider's `channel_<provider>` integration (stored at tenant scope, `user_id = NULL`). Each provider package owns its config form. IMAP omits OAuth and shows only an "enabled per tenant" toggle.

### Unified inbox: `/backend/messages` (existing Messages page, no new route)
- The hub's bridge already creates Message records for inbound external messages. Email messages render alongside WhatsApp/Slack/etc. with appropriate channel-type badge + provider icon (via UMES widget injection at `data-table:messages:columns`).
- Message thread detail (`/backend/messages/[id]`) renders email-specific rich content (To/Cc/Bcc/attachments/headers) via UMES component override on `MessagesThreadDetailHeader` and widget injection at `messages:thread:detail:rich-content`.

### Frontend Architecture Contract

- **Server/Client boundary**:
  - `/backend/profile/communication-channels/page.tsx` — Server Component shell (auth check, initial channel list)
  - `UserChannelsTable` — Client Component (table actions, dialog state)
  - `ConnectImapDialog` — Client Component (form state)
- **`"use client"` ledger**: 2 client files per provider's connect widget + 1 hub-side table component = ~5 total.
- **Client bundle guardrail**: NO provider SDK in client bundles (no `googleapis`, no `imapflow` — all server-side only). Verified via Phase 4 acceptance.
- **Route budgets**: each backend page < 30 KB gzipped client JS (DataTable + CrudForm primitives are shared by the existing UI primitives package, not re-bundled).
- **Hydration test**: Playwright asserts interactive controls respond within 100 ms of mount on cold load.
- **Provider/bootstrap scope**: no new global providers; uses existing app shell.

## Configuration

```bash
# Platform-default OAuth apps (optional — tenants may override via Integrations Marketplace)
OM_HUB_GMAIL_OAUTH_CLIENT_ID
OM_HUB_GMAIL_OAUTH_CLIENT_SECRET
OM_HUB_GMAIL_REDIRECT_URI                    # e.g. https://app.example.com/api/communication_channels/oauth/gmail/callback

# Polling tuning (hub-side)
OM_HUB_POLL_DEFAULT_INTERVAL_SECONDS=300     # default 5 min
OM_HUB_POLL_BATCH_SIZE=100
OM_HUB_POLL_SCHEDULER_TICK_SECONDS=60
OM_HUB_POLL_ENUMERATION_CAP=500              # rows per tick

# Health log retention (hub-side, generic)
OM_HUB_HEALTH_LOG_RETENTION_DAYS=90

# OAuth state cookie key (32-byte hex). HKDF fallback from KMS_MASTER_KEY when absent.
OM_HUB_OAUTH_STATE_KEY
```

Setup raises a clear error at module boot if a provider is enabled but neither tenant-Marketplace credentials nor the corresponding platform-env credentials are configured (boy-scout improvement on the existing hub boot check).

## Migration & Backward Compatibility

| Surface | Change | Impact |
|---|---|---|
| Database schema | 2 columns added to `communication_channels` (`user_id`, `poll_interval_seconds`, `last_polled_at`, `status`, `last_error`, `is_primary`), 1 column added to `integration_credentials` (`user_id`), 3 new indexes | Additive — zero impact on existing rows |
| Hub events | NO new event IDs — providers route through existing `communication_channels.*` events | Additive |
| ACL features | 1 new feature: `communication_channels.connect_user_channel` (default-granted to all roles) | Additive |
| ChannelCapabilities | NEW optional field `realtimePush?: boolean` (default true) | Additive (existing providers omit it) |
| ChannelAdapter | NEW optional method `refreshCredentials?()`, NEW optional method `validateCredentials?()` for credential-based providers | Additive |
| Marketplace categories | 2 new integration entries: `channel_gmail`, `channel_imap` — category `communication`, hub `communication_channels` | Additive |
| Messages module | UNTOUCHED | None |
| Resend pipeline | UNTOUCHED | None |
| Existing tenant WhatsApp channels | UNTOUCHED (`user_id` defaults NULL) | None |
| `apps/mercato/src/modules.ts` | Adds 3 entries (`communication_channels` hub + 2 providers) | Required app change, documented |
| `yarn generate` output | Hub + 2 provider packages join generators | Additive |

No deprecations. No data migration of existing rows. Existing hub tests untouched.

After enabling: `yarn mercato configs cache structural --all-tenants` (root `AGENTS.md` mandate).

## Implementation Plan

> Each phase ships its own module-local `__integration__/TC-CHANNEL-EMAIL-*.spec.ts` per `.ai/lessons.md` "Keep executable integration tests module-local". No phase is marked complete without its listed integration tests passing.

### Prerequisite — SPEC-045d Communication Hub delivery (NOT in this spec)

The hub itself (`packages/core/src/modules/communication_channels/` with entities, ChannelAdapter interface + DI registry, inbound-processor worker, outbound-delivery subscriber on `messages.message.sent`, hub events, hub ACL features `communication_channels.view/.manage/.admin`, hub admin pages, integrations bridge) is delivered by a **separate spec/PR that owns SPEC-045d**. See § Prerequisites & Cross-Spec Dependencies. This spec's first phase (Phase 0 below) starts only after that hub PR is merged and `yarn build` passes against it.

**Verification gate before Phase 0 begins**:
```bash
ls packages/core/src/modules/communication_channels/                              # exists
grep -l "interface ChannelAdapter" packages/core/src/modules/communication_channels/lib/  # found
grep -l "queue: 'communication-channels-inbound'" packages/core/src/modules/communication_channels/workers/  # found
grep -l "messages.message.sent" packages/core/src/modules/communication_channels/subscribers/  # found
```
If any line above fails, return to the hub-foundation PR before continuing.

### Phase 0 — Hub deltas for per-user email channels

**Goal**: apply this spec's incremental deltas on top of the (now-existing) hub. Phase 0 is bounded by the deltas list in § Hub Deltas Required by This Spec — nothing else. Do not retrofit hub-level concerns here; escalate them back to the SPEC-045d spec.

**Scope (this spec's incremental work only)**:

1. Add additive columns on `CommunicationChannel` via the hub module's `data/entities.ts`: `user_id`, `is_primary`, `poll_interval_seconds`, `last_polled_at`, `status`, `last_error`. Generate migration with `yarn db:generate`; remove unrelated migration output per the coding-agent exception in root `AGENTS.md`.
2. Add additive column on `IntegrationCredentials` via the **integrations module's** `data/entities.ts` (coordinated edit in the same PR; the hub does not own the integrations table). Generate the migration in the integrations module's `migrations/` folder.
3. Declare cross-module links in `packages/core/src/modules/communication_channels/data/extensions.ts` (`CommunicationChannel.user_id → auth:user`, `IntegrationCredential.user_id → auth:user`). No raw FKs (root `AGENTS.md` rule).
4. Extend `ChannelCapabilities` with optional `realtimePush?: boolean` (default `true` in resolver for BC) in `lib/capabilities.ts`.
5. Extend `ChannelAdapter` with optional `refreshCredentials?(input)` and `validateCredentials?(input)` methods in `lib/adapter.ts`. Both are typed as optional; existing WhatsApp/Slack adapters compile unchanged.
6. New worker: `workers/poll-channel.ts` with `metadata = { queue: 'communication-channels-poll', concurrency: 10 }`, idempotent on `(channel_id, external_message_id)`, error classification → status transitions per § Hub Deltas → Delta 6.
7. New scheduler entry: `schedulers/poll-tick.ts` registering a 60s cron via `@open-mercato/scheduler` per § Hub Deltas → Delta 6 (scheduler mechanism).
8. New OAuth state-cookie helper: `lib/oauth-state.ts` ported (not imported) from `packages/enterprise/src/modules/sso/lib/state-cookie.ts`. Phase 0 acceptance includes a `grep -r '@open-mercato/enterprise'` returning empty against `packages/core/src/modules/communication_channels/` and the two provider packages once they ship.
9. New OAuth router: `api/post/oauth/[provider]/initiate/route.ts` + `api/get/oauth/[provider]/callback/route.ts` per § API Contracts.
10. New per-user routes: `api/post/channels/connect/credentials/route.ts` + `api/post/channels/[id]/set-primary/route.ts` + `api/post/channels/[id]/test-send/route.ts` + `api/post/send-as-user/route.ts`. Each uses per-method `metadata` (see § Per-method metadata shape).
11. Per-user ACL feature: add `communication_channels.connect_user_channel` to the hub's `acl.ts`; default-grant to all roles in `setup.ts`. Run `yarn mercato auth sync-role-acls` in deploy runbook.
12. Generic notification type: `channel_requires_reauth` in the hub's `notifications.ts` + renderer in `notifications.client.ts`. Channel-agnostic — not email-specific.
13. New backend page: `backend/profile/communication-channels/page.tsx` per § UI/UX. Server-component shell + client-component `UserChannelsTable`.
14. Per-user channel ACL gates (service-layer enforcement of `user_id` filter on every list/read/write) declared in `lib/access-control.ts` or equivalent, called from each route handler.
15. HTML sanitizer (`lib/sanitize-channel-html.ts`) — if not already shipped by the hub-foundation PR (it should be, per § Security Posture), add it here as a hub addition. Phase 0 acceptance verifies presence.
16. Unit tests: state-cookie encrypt/decrypt/expiry/tamper, poll-channel cursor advancement, per-user ACL gate filter, drain mode (post 5 iterations → re-enqueue with backoff), error classification (401 → requires_reauth; 429 → Retry-After; 5xx → exponential backoff; persistent → status='error'), `refreshCredentials` near-expiry triggering, HTML sanitizer behaviour (script strip / javascript: URL strip / event-handler attribute strip / `<img>`/`<a>`/`<table>` allowlist), `messages.message.sent` subscriber re-fetch pattern.
17. Module-local integration tests (`packages/core/src/modules/communication_channels/__integration__/`):
    - `TC-CHANNEL-EMAIL-HUB-001` per-user channel isolation: User A cannot list User B's channels via API
    - `TC-CHANNEL-EMAIL-HUB-002` polling scheduler enqueues `poll-channel` jobs at correct cadence (uses time-mocking to advance the scheduler)
    - `TC-CHANNEL-EMAIL-HUB-003` OAuth state-cookie userId mismatch rejected at callback (302 to flash=error)
    - `TC-CHANNEL-EMAIL-HUB-004` `send-as-user` requires `user_id` ownership (cannot send via someone else's channel)
    - `TC-CHANNEL-EMAIL-HUB-005` `messages.message.sent` subscriber re-fetches by ID, no payload-shape coupling (simulate by emitting with a minimal payload and asserting routing still works)
    - `TC-CHANNEL-EMAIL-HUB-006` `channel_requires_reauth` notification raised when `markRequiresReauth` command runs; UMES `useNotificationEffect` handler triggers reconnect dialog (rendered, not OAuth-completed)
18. **Acceptance gates**:
    - `yarn build` passes
    - `yarn lint` passes
    - `yarn db:migrate` applies the new columns cleanly
    - `grep -r "@open-mercato/enterprise" packages/core/src/modules/communication_channels/` returns empty
    - `yarn test` passes for the hub module
    - Six integration tests above pass against a real Postgres + Redis (no mocked DB)
    - `yarn mercato configs cache structural --all-tenants` runs cleanly after the new ACL feature is added

### Phase 1 — IMAP provider (`@open-mercato/channel-imap`)

**Goal**: end-to-end credential-based provider proves the polling pipeline.

1. Workspace package scaffolding (`packages/channel-imap/`, build/watch scripts mirroring `gateway-stripe`).
2. `src/modules/channel_imap/`: `index.ts`, `setup.ts` (registers adapter + marketplace entry), `di.ts`, `integration.ts`.
3. `lib/adapter.ts`: implements `ChannelAdapter` with `validateCredentials`, `fetchHistory` (imapflow with UIDVALIDITY+UIDNEXT tracking; handles UIDVALIDITY rotation = full re-sync), `sendMessage` (nodemailer SMTP; appends to Sent folder if server supports `\Sent` capability), `convertOutbound`, `normalizeInbound` (mailparser), `getStatus` (best-effort), `resolveContact`.
4. `lib/capabilities.ts`: `realtimePush: false`, `threading: true`, `richText: true`, `fileSharing: true`, `maxFileSize: 25_000_000`, no reactions, no edit/delete.
5. UMES widgets:
   - Connect IMAP dialog injection at `profile:communication-channels:connect`
   - CrudForm field injection at `crud-form:communication_channels.channel:fields:imap` (host/port/TLS/user/password ×2, security-ack)
   - Channel-type badge injection at `data-table:messages:columns`
   - Response enricher `_email` on Message (shared with Phase 2/3 — first to ship lives here in hub; provider just registers)
6. Unit tests with `imap-server` in-process mock.
7. Module-local integration tests (`packages/channel-imap/src/modules/channel_imap/__integration__/`):
   - `TC-CHANNEL-EMAIL-001` Connect IMAP with valid credentials
   - `TC-CHANNEL-EMAIL-002` Invalid credentials rejected with field-level errors
   - `TC-CHANNEL-EMAIL-003` Polling fetches inbound, Message created in inbox, `communication_channels.message.received` emitted
   - `TC-CHANNEL-EMAIL-004` Send via SMTP, Message thread created, appears in remote Sent folder
   - `TC-CHANNEL-EMAIL-005` Threading via In-Reply-To creates correct `ChannelThreadMapping`
8. Wire into `apps/mercato/src/modules.ts`; run `yarn mercato configs cache structural --all-tenants`.
9. **Acceptance**: User connects IMAP, sends, receives via polling within 5 min, threading correct, sees email in unified inbox.

### Phase 2 — Gmail provider (`@open-mercato/channel-gmail`)

**Goal**: OAuth-based provider on top of working polling pipeline.

1. Workspace package scaffolding.
2. `lib/oauth.ts`: Google OAuth (authorize URL builder, code exchange, refresh — `googleapis` SDK or raw fetch).
3. `lib/sync.ts`: `gmail.users.history.list` incremental + full bootstrap sync.
4. `lib/send.ts`: `gmail.users.messages.send` with raw RFC2822.
5. `lib/health.ts`: `gmail.users.getProfile`.
6. Capabilities + `refreshCredentials` implementation.
7. UMES: Gmail-specific connect button at `profile:communication-channels:connect`, OAuth config at `admin.page:integrations:gmail:config`, Gmail labels chip widget at `messages:thread:detail:rich-content` (provider-specific affordance).
8. Marketplace integration registration (category `communication`, hub `communication_channels`).
9. Per-channel custom fields via `ce.ts`: "default signature", "default Gmail label", "auto-reply text".
10. Unit tests with stubbed HTTP.
11. Module-local integration tests:
    - `TC-CHANNEL-EMAIL-006` Connect Gmail (real OAuth, env-gated CI skip)
    - `TC-CHANNEL-EMAIL-007` Send via Gmail → ExternalMessage + MessageChannelLink + Sent folder
    - `TC-CHANNEL-EMAIL-008` Receive via Gmail polling → Message in inbox
    - `TC-CHANNEL-EMAIL-009` Token refresh: stub Google refresh response, verify new tokens persisted
    - `TC-CHANNEL-EMAIL-010` Refresh-token revoked → status=requires_reauth + notification arrives + banner shown on profile page
12. **Acceptance**: User connects Gmail end-to-end against real Google Workspace test account; full send + receive + token refresh + reauth flow exercised.

### Phase 4 — UMES polish + cross-provider tests

**Goal**: finalize all UMES extension points; ensure they compose cleanly across multiple connected channels.

1. Component override on `MessagesThreadDetailHeader` for `channelType=email` (hub-side).
2. Mutation guards on `channel.delete` (unread inbound block), `message.create` (channel-not-connected block).
3. Sync event subscriber on `auth.user.deleted` (cascade-disconnect user channels).
4. Notification handler with `useNotificationEffect` on `channel_requires_reauth`.
5. Command interceptor `beforeUndo` on `channel.disconnect`.
6. Module-local integration tests (`packages/core/src/modules/communication_channels/__integration__/`):
    - `TC-CHANNEL-EMAIL-014` Multi-account per user, primary swap works (one user with Gmail + IMAP, primary toggled)
    - `TC-CHANNEL-EMAIL-015` Admin sees account list, cannot read envelope contents (RBAC)
    - `TC-CHANNEL-EMAIL-016` Tenant-owned OAuth app overrides platform default (Gmail)
    - `TC-CHANNEL-EMAIL-017` Disconnect → credentials hard-purged, polling halted, channel removed
    - `TC-CHANNEL-EMAIL-018` Mutation guard blocks delete with unread inbound + force=true bypass
    - `TC-CHANNEL-EMAIL-019` `auth.user.deleted` cascade-disconnects all user's channels
    - `TC-CHANNEL-EMAIL-020` Email rich-content widget renders To/Cc/Bcc/attachments in unified inbox
7. **Acceptance**: all UMES surfaces compose correctly; multi-channel user scenarios pass.

### Phase 5 — Documentation + deploy runbook

1. `apps/docs/docs/framework/communication_channels/per-user-channels.mdx` — concept, OAuth setup per provider, troubleshooting.
2. Deploy runbook: `OM_HUB_*` env keys, `OM_HUB_OAUTH_STATE_KEY` rotation, `yarn mercato configs cache structural --all-tenants` after deploy, optional tenant OAuth app registration steps for Google Cloud Console.
3. Spec changelog entry, Final Compliance Report rerun, `RELEASE_NOTES.md` entry.

### File Manifest (high-level)

| File | Action | Purpose |
|------|--------|---------|
| `packages/core/src/modules/communication_channels/**` | Create or extend | Hub deltas (Phase 0) |
| `packages/core/src/modules/communication_channels/__integration__/TC-*.spec.ts` | Create | Hub + cross-provider integration specs (Phases 0, 4) |
| `packages/channel-imap/src/modules/channel_imap/**` | Create | IMAP provider package (Phase 1) |
| `packages/channel-imap/src/modules/channel_imap/__integration__/TC-*.spec.ts` | Create | IMAP integration specs |
| `packages/channel-gmail/src/modules/channel_gmail/**` | Create | Gmail provider package (Phase 2) |
| `packages/channel-gmail/src/modules/channel_gmail/__integration__/TC-*.spec.ts` | Create | Gmail integration specs |
| `apps/mercato/src/modules.ts` | Modify | Enable `communication_channels` (if not enabled) + 2 providers |
| `.ai/qa/scenarios/TC-CHANNEL-EMAIL-*.md` | Create | Human-readable scenario markdowns (no code) |
| `apps/docs/docs/framework/communication_channels/per-user-channels.mdx` | Create | User-facing docs |

## Testing Strategy

**Unit (Jest)** — alongside each phase:
- Hub deltas: state-cookie roundtrip/expiry/tamper, poll scheduler enumeration, per-user ACL filter, refreshCredentials flow.
- Per-provider: stubbed HTTP for OAuth + sync + send; verify request shape; CanonicalMessage normalization; thread resolution via RFC2822 headers.
- IMAP provider: in-process IMAP mock for sync correctness; UIDVALIDITY rotation handling.

**Integration (Playwright)** — module-local `__integration__/`, per the placement table in Implementation Plan. Scenarios listed in `.ai/qa/scenarios/TC-CHANNEL-EMAIL-*.md`.

**Cross-cutting**: Phase 4 ships integration tests that exercise UMES composition (multi-channel users, response enrichers under load, mutation guards triggering across modules).

## Risks & Impact Review

### Data Integrity Failures

#### Credential blob write atomicity
- **Scenario**: OAuth callback completes; channel insert succeeds but credential insert fails.
- **Severity**: High
- **Mitigation**: `connectChannel` command wraps both inserts in a single transaction; sync worker treats "no credential row" as hard error → status='error'.
- **Residual risk**: None significant.

#### Cursor regression on crashed poll worker
- **Scenario**: Worker fetches batch, persists `ExternalMessage` rows, crashes before persisting cursor.
- **Severity**: Low
- **Mitigation**: `ExternalMessage` upsert is idempotent on `(channel_id, external_message_id)`; inbound-processor short-circuits on existing row; event emit only fires on actual insert.
- **Residual risk**: Re-emission could occur if crash between insert and emit. CRM subscribers must be idempotent on `(channel_id, external_message_id)`. Documented.

#### isPrimary race per user
- **Scenario**: Concurrent set_primary calls leave zero or two primaries.
- **Severity**: Medium
- **Mitigation**: Partial unique index `UNIQUE (user_id) WHERE is_primary AND user_id IS NOT NULL AND deleted_at IS NULL`. Command in SERIALIZABLE transaction.
- **Residual risk**: None.

### Cascading Failures & Side Effects

#### Subscriber failure on `communication_channels.message.received`
- **Scenario**: Future CRM subscriber throws.
- **Severity**: Medium
- **Mitigation**: Event is persistent; failed subscribers retry per platform behavior; poll worker does not depend on subscriber success.
- **Residual risk**: Sustained failures pile up — CRM spec defines its own DLQ.

#### Cross-process event bridge (lessons.md "Browser SSE bridges must work across worker and web processes")
- **Scenario**: Poll worker emits `communication_channels.message.received` from queue process; in-process SSE bridge in the web process never sees it; UI looks frozen.
- **Severity**: Medium
- **Mitigation**: Hub's existing event bus design must include a cross-process transport before any `clientBroadcast: true` event is emitted from a worker. Phase 0 acceptance verifies the bridge is wired (or that the hub explicitly polls + SSE per the lesson).
- **Residual risk**: If the bridge is not in place, UI consumers fall back to polling (existing pattern). Spec flags this as a hub-side dependency.

#### Provider outage
- **Scenario**: Gmail returns 5xx for hours.
- **Severity**: Low
- **Mitigation**: Exponential backoff to 60-min ceiling; status stays `connected`; `HealthLog` warnings accumulate; admin can see in dashboard.
- **Residual risk**: Sync lag on that provider; documented.

#### Resend pipeline interaction
- **Scenario**: Workflow sends via Resend AND via user channel concurrently for the same recipient.
- **Severity**: Low
- **Mitigation**: Spec explicitly states the two pipelines coexist; caller picks. CRM spec will define migration policy.
- **Residual risk**: A future change could introduce duplication; mitigated by code review and the distinct `sendEmail` (Resend) vs `sendAsUser` (hub) import surface.

### Tenant & Data Isolation Risks

#### Cross-user channel leakage
- **Scenario**: A bug in the list API returns another user's channels.
- **Severity**: Critical
- **Mitigation**: Dual enforcement — SQL-level filter (`WHERE user_id = currentUser.id OR user_id IS NULL`) on every CRUD route, AND UMES API interceptor at the response layer. Defense in depth.
- **Residual risk**: None at DB layer; defense in depth via per-route audit in code review.

#### State-cookie forgery
- **Scenario**: Attacker crafts a state cookie to bind their callback to another user's session.
- **Severity**: Critical
- **Mitigation**: State payload includes `userId`; callback validates against session. Encryption + HMAC + 5-min TTL + HttpOnly + SameSite=Lax.
- **Residual risk**: None given key is KMS-managed.

#### Per-user credential exposure via shared credentials table
- **Scenario**: A query against `integration_credentials` omits the `user_id` filter and returns another user's tokens.
- **Severity**: Critical
- **Mitigation**: Every read goes through `findOneWithDecryption` with `user_id` in the where clause. Mutation guard on `integration_credentials.read` rejects queries without the filter unless caller has `integrations.admin`. Unit + integration tests verify.
- **Residual risk**: Code review remains the second line of defense.

### Migration & Deployment Risks

#### Hub deltas applied before all providers deployed
- **Scenario**: Phase 0 schema migrations land; providers not yet enabled.
- **Severity**: Low
- **Mitigation**: All deltas are nullable / optional. Existing tenant channels untouched. Empty per-user channel list is the graceful state.
- **Residual risk**: None.

#### Module-enable in `modules.ts` without cache purge
- **Scenario**: Operator forgets `yarn mercato configs cache structural --all-tenants` after enabling providers.
- **Severity**: Medium
- **Mitigation**: AGENTS.md mandate documented in deploy runbook; Turbopack stale-chunk check + `yarn dev:reset` as escape hatches.
- **Residual risk**: Operator omission.

### Operational Risks

#### Polling fanout overwhelms providers
- **Scenario**: 10,000 connected Gmail channels polled simultaneously.
- **Severity**: Medium
- **Mitigation**: Per-channel `last_polled_at + poll_interval_seconds` gate spreads load; scheduler enumerates ≤ 500 channels per 60s tick; worker concurrency capped at 10; `Retry-After` honored on 429.
- **Residual risk**: Quota exhaustion at very high scale; mitigated by tenant-owned OAuth app config (each tenant has their own Google project quota pool).

#### Email-bomb amplification
- **Scenario**: A user's mailbox receives 100k unread messages in a short window; polling drains them all.
- **Severity**: Medium
- **Mitigation**: `fetchHistory` caps `limit=100` per call; drain mode re-enqueues with backoff after 5 drains; emits `communication_channels.message.delivery_failed` (severity=info) when drain exceeds 20 iterations. Inbound-processor's idempotency prevents duplicate Messages.
- **Residual risk**: Sustained high-volume mailbox = sustained event load. CRM subscribers must handle backpressure.

#### HTML email XSS via Messages thread renderer
- **Scenario**: Inbound HTML email contains a malicious script that bypasses the Messages module's rich-content renderer.
- **Severity**: High
- **Mitigation**: This is a **cross-spec dependency**, not a deliverable owned by this spec. The Messages module's rich-content renderer must sanitize HTML for `MessageChannelLink.channelContentType === 'email/mime'` (DOMPurify or equivalent). Phase 1 acceptance verifies that the rendered HTML is sanitized end-to-end with a CSP-violating payload integration test; if the Messages module's sanitizer is missing or insufficient, Phase 1 cannot ship and the issue is escalated to the Messages module owners (this is the forcing function — email is the first channel shipping HTML payloads). Until then, this spec's UMES component override on `MessagesThreadDetailHeader` MUST render HTML through a sanitization helper colocated in the hub's `lib/sanitize-channel-html.ts` and refuse to render unsanitized payloads.
- **Residual risk**: Sanitizer bypasses are an ongoing concern; CSP + iframe sandboxing for rendered HTML is a v2 hardening.

#### Provider credentials controlling cross-origin requests (lessons.md)
- **Scenario**: Operator-configured IMAP host points at an attacker-controlled server that swallows credentials or redirects pagination.
- **Severity**: High
- **Mitigation**: IMAP host validated as DNS-resolvable + port-in-range at credential-validation time. Reject relative/redirect responses from the upstream server; only follow absolute URLs whose origin matches the validated host.
- **Residual risk**: Sophisticated DNS attacks; mitigated by operator review of user-entered hosts.

## Final Compliance Report — 2026-05-21

### AGENTS.md Files Reviewed
- `AGENTS.md` (root)
- `packages/core/AGENTS.md`
- `packages/shared/AGENTS.md`
- `packages/ui/AGENTS.md`
- `packages/ui/src/backend/AGENTS.md`
- `packages/events/AGENTS.md`
- `packages/queue/AGENTS.md`
- `packages/cache/AGENTS.md`
- `packages/core/src/modules/integrations/AGENTS.md`
- `.ai/specs/AGENTS.md`
- `.ai/ds-rules.md`, `.ai/ui-components.md`

### Specs Reviewed (architectural references)
- `SPEC-045d-communication-notification-hubs.md` — canonical hub contract
- `SPEC-041-2026-02-24-universal-module-extension-system.md` — UMES contract
- `SPEC-056-2026-02-22-whatsapp-ai-chat-integration.md` — first ChannelAdapter implementation
- `SPEC-002-2026-01-23-messages-module.md` — inbox destination
- `SPEC-045-2026-02-24-integration-marketplace.md` — credentials + admin home
- `ANALYSIS-013-gmail-integration.md` — feasibility for Gmail-as-channel (Pattern B)

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|---|---|---|---|
| root AGENTS.md | External providers in own workspace packages (`packages/<provider-package>/`) | Compliant | `channel-gmail`, `channel-imap` |
| root AGENTS.md | Module-id underscore convention | Compliant | `channel_gmail`, `channel_imap`, `communication_channels` |
| root AGENTS.md | No direct ORM relationships between modules | Compliant | Provider packages link to hub only via DI registration; user link is FK ID + `EntityExtension` |
| root AGENTS.md | Tenant + organization scoping | Compliant | All channels carry `tenant_id` + `organization_id` |
| root AGENTS.md | Zod validation, derived types | Compliant | All API bodies + adapter inputs validated |
| root AGENTS.md | Encryption via `defaultEncryptionMaps` | Compliant | Hub already encrypts `integration_credentials.credentials`; this spec changes nothing in the map |
| root AGENTS.md | Commands for write operations | Compliant | Connect/Disconnect/SetPrimary/RefreshCredentials/MarkRequiresReauth as commands |
| root AGENTS.md | RBAC via features, not roles | Compliant | All API routes use `requireFeatures`; one new feature `communication_channels.connect_user_channel` declared in `acl.ts` + setup.ts |
| root AGENTS.md | Run cache structural after `modules.ts` change | Compliant | Documented in deploy runbook + per-phase acceptance |
| root AGENTS.md | OSS not depending on enterprise | Compliant | State-cookie helper ported; Phase 0 grep verification |
| packages/core/AGENTS.md | Per-method `metadata` (no top-level `requireAuth`) | Compliant | Documented in API Contracts |
| packages/core/AGENTS.md | `openApi` exports | Compliant | All routes export |
| packages/core/AGENTS.md | `makeCrudRoute` for CRUD; `validateCrudMutationGuard` + `runCrudMutationGuardAfterSuccess` for bespoke writes | Compliant | OAuth init/callback, credentials connect, set-primary, send-as-user all use guards |
| packages/ui/AGENTS.md | `apiCall`, not raw `fetch` | Compliant | UI side |
| packages/ui/AGENTS.md | `useGuardedMutation` wrapping non-CrudForm writes | Compliant | Connect/Disconnect/Reconnect actions |
| packages/ui/AGENTS.md | `CrudForm`, `DataTable`, semantic status tokens, lucide-react, `aria-label` on icon-only buttons, dialog keyboard shortcuts, `pageSize ≤ 100` | Compliant | UI section explicit |
| packages/events/AGENTS.md | `createModuleEvents({ moduleId, events })` shape, `as const` | N/A | This spec adds no new events; uses hub's existing events |
| packages/queue/AGENTS.md | Idempotent workers, concurrency ≤ 20 | Compliant | poll-channel concurrency 10; inbound-processor idempotent on `(channel_id, external_message_id)` |
| packages/cache/AGENTS.md | DI-resolved cache, tenant-scoped tags | N/A | Spec introduces no caching beyond hub's existing behavior |
| .ai/ds-rules.md | Semantic tokens, no arbitrary text sizes, no `dark:` on status colors | Compliant | UI uses `bg-status-*-soft text-status-*-fg`; no hardcoded shades |
| .ai/ui-components.md | lucide-react via backend icon registry, no inline `<svg>` | Compliant | UI section explicit |
| .ai/specs/AGENTS.md | Required sections (10), risk register format | Compliant | All present, format matches |
| spec-writing skill | Frontend Architecture Contract | Compliant | Server/Client boundary, client bundle guardrail, hydration test |
| spec-writing skill | Security: input validation, parameterized queries, XSS, encoding, secret exclusion | Compliant | Security Posture subsection enumerates each |
| SPEC-045d | Use `ChannelAdapter` v2 interface | Compliant | Both providers implement it |
| SPEC-045d | Use hub entities (`MessageChannelLink`, `ChannelThreadMapping`, `ExternalMessage`) | Compliant | No parallel storage |
| SPEC-045d | Hub events, not provider-specific events | Compliant | No new event IDs introduced |
| SPEC-041 | Use UMES for cross-module integration | Compliant | 17 named extension points across 12 phases of UMES |
| `.ai/lessons.md` | Integration tests module-local | Compliant | Per-phase `__integration__/` placement |
| `.ai/lessons.md` | Provider URL validation | Compliant | IMAP host validation noted in Security Posture |
| `.ai/lessons.md` | No raw SQL in route handlers | Compliant | All DB access via MikroORM repository / helpers |
| `.ai/lessons.md` | Cross-process event bridge for worker SSE | Acknowledged | Phase 0 acceptance requires bridge or polling fallback |

### Internal Consistency Check

| Check | Status | Notes |
|---|---|---|
| Data models match API contracts | Pass | Hub deltas align with route extensions |
| API contracts match UI/UX | Pass | Every UI action maps to a documented route |
| Risks cover all write operations | Pass | Connect, disconnect, set-primary, send, ingest, refresh all addressed |
| Commands defined for all mutations | Pass | 5 hub commands cover all state changes |
| Events: use existing hub events, no new IDs introduced | Pass | This is a deliberate design decision |
| Encryption: no new sensitive columns introduced | Pass | Hub's existing encryption map covers `credentials` |
| BC analysis covers every modified surface | Pass | Table enumerates every contract surface as additive |
| UMES extension points actually exist in SPEC-041 | Pass | All 17 hooks map to documented UMES phases A-N |
| OSS independence enforced | Pass | Grep verification step in Phase 0 acceptance |

### Non-Compliant Items

None.

### Verdict

- **Fully compliant with hub + UMES + AGENTS.md**. Approved for implementation.

## Changelog

### 2026-06-02 — Scope narrowed to Gmail + IMAP

The shipping email providers are **Gmail + IMAP+SMTP** only. The provider-key union is `'gmail' | 'imap'`. Work-mailboxes that do not offer a usable OAuth path connect via IMAP + SMTP with an app password.

### 2026-06-02 — Stale Delta 1 line reconciled with strict owner-only

- Fixed the Delta 1 (`CommunicationChannel.user_id?`) bullet that still said a user-scoped channel is "visible … to admins with `communication_channels.admin`" — it now states v1 strict owner-only (owner-only visibility; `communication_channels.admin` is inert / grants no cross-user channel view), consistent with the 2026-06-01 privacy section and Delta 8.

### 2026-06-01 — Per-user privacy hardening (v1 strict owner-only) + OAuth client-credential resolution fix

Records the decisions and fixes from the post-PoC privacy/OAuth review (new **Per-user privacy & visibility model (v1)** and **OAuth client-credential resolution** sections; Delta 8, Security Posture, and the Admin-page UX updated accordingly).

- **v1 = strict owner-only.** Personal mailboxes and their CRM email threads are visible to the owner only — not even admins/superadmins. The admin channels list (`GET /api/communication_channels/channels`) is restricted to `user_id IS NULL`; `assertCanAccessChannel` drops the admin bypass on personal channels; `personEmailThreads.ts` scopes to `author_user_id = viewer` (fail-closed); `applyEmailVisibilityFilter` / `buildEmailVisibilityMikroFilter` and the visibility-change gate drop the admin bypass. `customers.email.view_private` and `communication_channels.admin`'s cross-user view are reserved, inert, for v2 oversight.
- **Owners fully control their own mailboxes.** The profile page gained a **Disconnect** action (confirm dialog → `DELETE /channels/[id]`), and the per-channel management routes (disconnect, set-primary, poll-now, import-history, push-register) now gate on `communication_channels.connect_user_channel` + the new `assertCanManageChannel` — owner-only for personal channels (no admin bypass), while tenant-wide/shared channels still require `manage` / `channel.push.manage` / `channel.import_history`. This fixes the earlier gap where self-service was gated behind `manage`, which regular employees lack, so they couldn't even remove their own account.
- **Gmail connect + refresh fixed.** OAuth client credentials are resolved from the provider's `channel_<provider>` integration at tenant scope (with org-agnostic fallback) via `resolveOAuthClientCredentials()`, not the phantom `oauth_<provider>` id every code path previously read. Missing client config now returns an actionable `oauth_client_not_configured` error instead of "expected string, received undefined". Detail in the consolidated follow-up spec [`2026-05-27-email-integration-inbound-reliability-and-threading.md`](implemented/2026-05-27-email-integration-inbound-reliability-and-threading.md) (§ OAuth client-credential wiring).
- **Tests:** new `lib/__tests__/oauth-client-config.test.ts`; updated `access-control`, `visibilityFilter`, `personEmailThreads`, `credential-refresh`, visibility-route authz, and `TC-CRM-EMAIL-006` to assert the v1 (no-bypass) behavior. Full core suite green.
- **User documentation:** added admin setup guides `apps/docs/docs/user-guide/communication-channels-gmail.mdx` (Google Cloud OAuth app → register in Open Mercato → connect → optional Cloud Pub/Sub push with topic / publisher grant / service-account subscription / `OM_GMAIL_PUBSUB_*` env + ngrok for local dev) and `…-imap.mdx` (IMAP/SMTP host/port/TLS fields, app passwords, common provider settings), wired into the docs sidebar under *Integrations & Payments → Email*; reframed the end-user `communication-channels.mdx` to scope this release to Gmail + IMAP. Docs build clean (`onBrokenLinks: throw`).

### 2026-05-31 — Test-coverage reconciliation (code review)

Reconciles the Implementation Plan's named integration tests with what actually shipped, mirroring the smoke-vs-behavioral reconciliation already recorded for the `2026-05-27-*` follow-up specs. No code change — documentation accuracy only.

- **Phase 0 / foundation named integration tests not shipped as `__integration__/TC-*.spec.ts`:** `TC-CHANNEL-EMAIL-004` / `005` (IMAP SMTP send + In-Reply-To threading), `009` / `010` (Gmail token-refresh persistence + revoked-token reauth), and `HUB-004` / `005` / `006` (`send-as-user` ownership, subscriber re-fetch with no payload coupling, `requires_reauth` notification + UMES handler). The committed `__integration__/TC-*.spec.ts` files are route-registration **smoke** specs; the behaviors these seven named tests assert are covered instead by jest unit suites: `lib/__tests__/credential-refresh.test.ts` + `workers/__tests__/poll-channel.test.ts` (token refresh persistence + `401`/`invalid_grant` → `status='requires_reauth'`), `lib/__tests__/access-control.test.ts` (`assertCanAccessChannel` / `buildPerUserChannelFilter` ownership, i.e. `send-as-user` cannot use another user's channel), and `subscribers/__tests__/outbound-bridge.test.ts` (re-fetch-by-id, no payload-shape coupling) — plus the `2026-05-27-*` specs' route-refresh coverage and the manual QA scenario markdowns under `.ai/qa/scenarios/`.
- **`TC-CHANNEL-EMAIL-HUB-001` / `HUB-002` repurposed:** the shipped specs assert the per-user channel API contract and the profile-page render (smoke), not the originally-named cross-user isolation and scheduler-cadence behaviors. Those behaviors are covered by `lib/__tests__/access-control.test.ts` + `__tests__/acl-per-user.test.ts` (tenant/user isolation) and `workers/__tests__/poll-tick.test.ts` (due-channel enumeration + cadence).
- **Net:** no behavior is left untested; the gap was named-integration-test traceability, now documented. Authoring behavioral `__integration__` specs under the original IDs remains a welcome follow-up but is not release-blocking given the unit coverage above.

### 2026-05-26 — Phase 5 — Docs + deploy runbook

Final spec phase. No code changes; documentation only.

- **New end-user doc** at `apps/docs/docs/user-guide/communication-channels.mdx` — connect / reconnect / disconnect / multi-account / primary swap flows for Gmail and IMAP+SMTP. Troubleshooting section enumerates the five most common failure modes per provider (auth rejection, ECONNREFUSED, admin-consent gates, app-not-verified, etc.). Cross-linked with the inbox-ops user guide so users understand the per-user vs shared-mailbox split. Explicit "What Open Mercato never does" section documenting the scope: inbox-only sync, no DKIM mining, no cross-user mailbox sharing.
- **New developer / admin doc** at `apps/docs/docs/framework/modules/communication-channels.mdx` — Hub architecture diagram + send/receive path diagrams; per-user channel column reference; OAuth setup walkthrough for Google Cloud Console; env-var reference (`OM_HUB_OAUTH_STATE_KEY`, `OM_HUB_OAUTH_STATE_TTL_SECONDS`, `OM_HUB_POLL_DEFAULT_SECONDS`, `OM_HUB_POLL_CONCURRENCY`, `OM_HUB_OUTBOUND_RETRY_MAX`); deploy runbook covering initial deploy, routine ops (state-key rotation, OAuth secret rotation, force-poll), adding a new provider, security posture. Provider-package contract summary so future providers (Yahoo, ProtonMail Bridge, etc.) can be built from this doc plus the two shipping examples.
- **No spec re-write** — the prior Implementation Plan / API Contracts / UI sections remain authoritative; Phase 5 just surfaces them in user-facing docs.

#### Final Compliance Report — Phase 5 re-validation

| Rule | Status | Notes |
|---|---|---|
| Documentation includes user-facing connection guide | Compliant | `user-guide/communication-channels.mdx` |
| Documentation includes admin/deploy runbook | Compliant | `framework/modules/communication-channels.mdx` § Deploy runbook |
| Documentation cross-links with `inbox-ops.mdx` for scope-separation clarity | Compliant | Bidirectional links in both docs |
| Spec changelog updated for every phase | Compliant | 2026-05-21 (rewrite), 2026-05-22 (pre-impl fixes), 2026-05-26 (Phase 5) |
| RELEASE_NOTES.md entry | N/A | The repo does not maintain a root `RELEASE_NOTES.md`; release notes flow through GitHub release pages tied to PR descriptions. The user-guide doc serves as the changelog surface end users see. |
| All AGENTS.md rules listed in the original Final Compliance Report (lines 1149-1198 of this spec) still pass | Compliant | No code changes in Phase 5 → no surface drift |

### 2026-05-22 — Pre-implementation fixes (`/pre-implement-spec` analysis remediation)

Applied the remediation plan from `.ai/specs/analysis/ANALYSIS-2026-05-21-email-integration-foundation.md`. No architectural changes; all updates are scope, hygiene, and contract-surface clarifications.

- **§ Prerequisites & Cross-Spec Dependencies** — new section. SPEC-045d (Communications Hub) is now an explicit hard prerequisite delivered by a separate spec/PR. This spec stops carrying SPEC-045d delivery inside its Phase 0. SPEC-056 (WhatsApp) is documented as a sibling, not a dependency. Coordination rules with both are spelled out. **Housekeeping follow-up**: `git mv .ai/specs/implemented/SPEC-045d-communication-notification-hubs.md .ai/specs/` (and similarly SPEC-056 if present in `implemented/`) — both are spec-only and currently misfiled as implemented. Out of scope for this spec to perform the move; flagged here so it isn't forgotten.
- **§ Relationship to `inbox_ops`** — new subsection. Pins the scope split per the maintainer clarification: `inbox_ops` is the *tenant-forwarded Resend inbox for AI action extraction*; this spec is the *user's own real mailbox via Gmail/IMAP for unified-inbox conversation*. Different inputs, different intents, coexist. Neither subscribes to the other's events. Each provider package's README must surface this distinction.
- **§ Non-goals (v1)** — added explicit "customer-portal channel ownership out of scope" and "inbox_ops is not modified" lines.
- **§ Hub Deltas → Delta 1 / Delta 5** — replaced raw `REFERENCES users(id)` with `EntityExtension`-based cross-module link declarations (root `AGENTS.md` rule: no direct ORM relationships between modules). Added explicit cross-module coordination note for the `integrations` module owning its column.
- **§ Hub Deltas → Delta 6** — pinned the scheduler mechanism to `@open-mercato/scheduler` (the platform's canonical cron home) with an explicit `schedulers/poll-tick.ts` entry. Explicitly forbids `setInterval` in workers and ad-hoc BullMQ repeatables.
- **§ Data Models** — SQL blocks are now labelled illustrative (generated by `yarn db:generate`), removed raw `REFERENCES users(id)` FKs, added a new `data/extensions.ts` block showing the canonical `EntityExtension` declarations for both cross-module links.
- **§ API Contracts → Per-method `metadata` shape — canonical example** — new subsection. Five-line code snippet showing the required per-method `metadata` export, the `openApi` export, and the mutation-guard wrap pattern for bespoke writes. Prevents the common "top-level `requireAuth`" slip.
- **§ Outbound flow (Path A)** — pinned the subscriber to re-fetch the Message by ID rather than depending on `messages.message.sent` payload shape. Decouples the hub from any future payload-shape change in the messages module.
- **§ Security Posture (HTML sanitizer)** — pinned the canonical sanitizer location to `packages/core/src/modules/communication_channels/lib/sanitize-channel-html.ts`. Hub owns the function; Messages module imports it at the rich-content widget injection. If SPEC-045d delivery does not include this helper, Phase 1 of this spec cannot ship.
- **§ Implementation Plan** — restructured:
  - Added a new "Prerequisite — SPEC-045d Communication Hub delivery (NOT in this spec)" section with a verification gate (four shell commands) that must pass before Phase 0 starts.
  - Phase 0 rescoped to ONLY this spec's incremental deltas. Scope shrunk from "deliver the hub + apply our deltas" to "apply our deltas on top of an already-delivered hub". 18 explicit work items + 6 integration tests + 7 acceptance gates.
  - Renamed `TC-HUB-*` to `TC-CHANNEL-EMAIL-HUB-*` to keep the test-id namespace coherent with subsequent phases.

### 2026-05-21 — Rewrite (autonomous brainstorming + UMES alignment)
Complete rewrite of the email integration spec. The previous draft (`.ai/specs/2026-05-21-email-integration-foundation.md`) proposed a standalone `email` module with parallel entities, events, OAuth router, polling worker, and admin UI. That approach was rejected by the maintainer because Open Mercato already has a finalized Communications Hub architecture (SPEC-045d) with an explicit `channel_email` slot, and a Universal Module Extension System (SPEC-041) for cross-module integration. This rewrite:

- Folds all email functionality under the `communication_channels` hub. Two workspace packages (`@open-mercato/channel-gmail`, `@open-mercato/channel-imap`) implement `ChannelAdapter` v2.
- Introduces minimal additive hub deltas: `CommunicationChannel.user_id?`, `poll_interval_seconds`, `last_polled_at`, `status`, `last_error`, `is_primary`; `IntegrationCredentials.user_id?`; `ChannelCapabilities.realtimePush?`; `ChannelAdapter.refreshCredentials?` / `validateCredentials?`; hub-side poll-channel worker; per-user channel ACL gates; generic `channel_requires_reauth` notification type; OAuth state-cookie helper (ported locally, no enterprise imports); OAuth callback router.
- Uses UMES at 17 named extension points across all 12 implemented UMES phases.
- Phases the work: Phase 0 hub deltas, Phase 1 IMAP, Phase 2 Gmail, Phase 4 UMES polish, Phase 5 docs.
- Adopts module-local `__integration__/` placement per `.ai/lessons.md`.
- Inbound emails auto-create `Message` records in the unified inbox via the hub's bridge — no parallel envelope store.
- Outbound via the hub's standard `messages.message.sent` → adapter chain, plus a thin `sendAsUser` facade for programmatic callers.

The previous draft is superseded. This spec is the canonical email integration design.

## Implementation Status

| Slice | Phase | Status | Date | Notes |
|---|---|---|---|---|
| 3a | Phase 0 — Hub schema deltas | Done | 2026-05-26 | Per-user columns on `CommunicationChannel` (`user_id`, `is_primary`, `poll_interval_seconds`, `last_polled_at`, `status`, `last_error`) + `integration_credentials.user_id` + `communication_channels.connect_user_channel` ACL feature; entity extensions; migration `Migration20260526154135_communication_channels.ts` |
| 3b | Phase 0 — Polling worker + scheduler | Done | 2026-05-26 | `lib/credential-refresh.ts` + per-channel poll worker + `@open-mercato/scheduler` cron entry registered in `setup.ts.seedDefaults`; access-control helpers `buildPerUserChannelFilter` / `assertCanAccessChannel` |
| 3c | Phase 0 — OAuth state-cookie + callback router | Done | 2026-05-26 | `lib/oauth-state.ts` (AES-256-GCM, HKDF, 5min TTL, userId-bound; ported from enterprise SSO, NOT imported); `api/post/oauth/[provider]/initiate/route.ts`; `api/get/oauth/[provider]/callback/route.ts` |
| 3d | Phase 0 — Per-user channel routes + profile page | Done | 2026-05-26 | `GET /me/channels`, `POST connect/credentials`, `POST [id]/set-primary`, `POST [id]/test-send`, `POST send-as-user`; `backend/profile/communication-channels/page.tsx`; `set-primary-channel` + `connect-credential-channel` commands |
| 3e | Phase 1 — IMAP provider package | Done | 2026-05-26 | New `@open-mercato/channel-imap` workspace; ChannelAdapter implementation with `validateCredentials` (live IMAP+SMTP login), `fetchHistory` (UIDVALIDITY+UIDNEXT polling with full-resync on validity change), `sendMessage` (nodemailer SMTP + best-effort Sent-folder append via imapflow), `convertOutbound`, `normalizeInbound` (mailparser; RFC2822 In-Reply-To/References threading), `resolveContact`. 34 unit tests + 3 integration specs. Wired into `apps/mercato/src/modules.ts`. |
| 3f | Phase 2 — Gmail provider package | Done | 2026-05-26 | New `@open-mercato/channel-gmail` workspace; ChannelAdapter with `buildOAuthAuthorizeUrl` / `exchangeOAuthCode` / `refreshCredentials` (Google OAuth2 via raw `fetch`), `fetchHistory` (Gmail History API incremental with `gmail.users.messages.list` fallback on `404`), `sendMessage` (`gmail.users.messages.send` with base64url-encoded RFC2822 + threadId), `deleteMessage` (`gmail.users.messages.trash`), `convertOutbound`, `normalizeInbound` (mailparser; Gmail threadId for conversation grouping). 47 unit tests + 3 integration specs. `googleapis` dep installed for downstream SDK consumers; adapter itself uses `fetch` to keep the test bundle hermetic. Wired into `apps/mercato/src/modules.ts`. |

### Phase 2 — Gmail Detailed Progress (Slice 3f)
- [x] Workspace package scaffold (`packages/channel-gmail/`, `build.mjs`, `watch.mjs`, `jest.config.cjs`, `tsconfig.json`, `package.json`)
- [x] `src/modules/channel_gmail/` skeleton (`index.ts`, `acl.ts`, `setup.ts`, `di.ts`, `integration.ts`)
- [x] `lib/capabilities.ts` — `realtimePush: false` (Pub/Sub deferred), `threading: true`, `richText: true`, `deleteMessage: true`, `maxFileSize: 25 MB`
- [x] `lib/credentials.ts` — Zod schemas for tenant OAuth client (clientId/clientSecret/scopes) + per-user tokens + channel state (historyId)
- [x] `lib/oauth.ts` — Google OAuth2 transport (raw `fetch`; test-swappable via `setGoogleOAuthClient`)
- [x] `lib/gmail-client.ts` — Gmail v1 REST wrapper (history.list, messages.list, messages.get?format=raw, messages.send, messages.trash, users.getProfile; test-swappable)
- [x] `lib/normalize-inbound.ts` — mailparser → `NormalizedInboundMessage`; `externalConversationId = gmail-thread:<threadId>` for Gmail-native threading
- [x] `lib/convert-outbound.ts` — hub-canonical input → RFC2822 + Gmail threadId; auto-generates Message-ID rooted in From address
- [x] `lib/adapter.ts` — ChannelAdapter wiring + bootstrap historyId path + incremental history.list + 404-fallback to messages.list
- [x] Unit tests: 47 passing across `credentials.test.ts`, `oauth.test.ts`, `convert-outbound.test.ts`, `normalize-inbound.test.ts`, `gmail-client.test.ts`, `adapter.test.ts`
- [x] Module-local integration tests: `TC-CHANNEL-EMAIL-006` (OAuth initiate router), `TC-CHANNEL-EMAIL-007` (webhook no-op), `TC-CHANNEL-EMAIL-008` (profile page render)
- [x] Wired into `apps/mercato/src/modules.ts`
- [x] `yarn install` → 12 new packages (googleapis transitive deps)
- [x] `yarn generate` succeeds; registry validator passes (`deleteMessage: true` ↔ `deleteMessage()` implemented); structural cache purged
- [x] `yarn build:packages` succeeds (21/21 packages); `yarn test` succeeds (21/21 packages)
- [ ] Live Gmail end-to-end test against a Google Workspace test account — manual; not part of CI
- [ ] Pub/Sub push subscription (real-time inbound) — deferred to v2 per spec § Phase 2 acceptance

| 4 | Phase 4 — UMES polish + cross-provider tests | Done | 2026-05-26 | Hub-side `widgets/components.ts` override scaffold; `lib/mutation-guards.ts` (`guardChannelDelete` blocks delete with unread inbound; `guardOutboundCreate` maps `requires_reauth`/`disconnected` to 422); `subscribers/user-deleted-cascade.ts` on `auth.user.deleted`; `notifications.handlers.ts` for `channel.requires_reauth` + `message.received`; `commands/disconnect-channel.ts` (undoable) + `commands/interceptors.ts` (`beforeUndo` blocks primary-collision restore); wired `send-as-user` to use `guardOutboundCreate`. 30 new unit tests + 7 integration specs (TC-CHANNEL-EMAIL-014..020). |
| 5 | Phase 5 — Docs + deploy runbook | Done | 2026-05-26 | `apps/docs/docs/user-guide/communication-channels.mdx` (end-user connect/reconnect/troubleshooting); `apps/docs/docs/framework/modules/communication-channels.mdx` (architecture, OAuth setup for Gmail, env-var reference, deploy runbook, provider-package contract). Cross-linked with `inbox-ops.mdx`. Spec changelog updated. Final Compliance Report re-validated. |

### Phase 4 — UMES Polish Detailed Progress (Slice 4)
- [x] **Deliverable 1**: `widgets/components.ts` exporting `componentOverrides: ComponentOverride[]` — scaffold with forward-compatible handle ids documented (`section:messages.detail.header`, `data-table:messages:row`). Empty array today because the Messages module's `MainMessageHeader` is not yet registered as a known component id; the override-mechanism contract is honoured (downstream apps can target hub-side handles). Email-specific affordances ship via the existing `detail:messages:message:body:after` injection-spot's `channel-payload-renderer` widget (slices 2a + 2e).
- [x] **Deliverable 2**: `lib/mutation-guards.ts` exporting `guardChannelDelete` (blocks delete when unread inbound > 0; `force: true` bypass) and `guardOutboundCreate` (maps `status='requires_reauth'`/`'disconnected'` to a 422 with `fieldErrors.channelId`). `send-as-user` route imports `guardOutboundCreate` so the contract is exercised end-to-end. `countUnreadInboundForChannel` exposed for tests.
- [x] **Deliverable 3**: `subscribers/user-deleted-cascade.ts` on `auth.user.deleted` — cascades `status='disconnected' / isActive=false / isPrimary=false / credentialsRef=null` across every channel the deleted user owned. Idempotent on replays.
- [x] **Deliverable 4**: `notifications.handlers.ts` exporting two `NotificationHandler` entries — a warning toast + DOM event for `communication_channels.channel.requires_reauth` (with reconnect-CTA navigate), and a silent DOM event for `communication_channels.message.received` so the unified inbox refetches without toasting.
- [x] **Deliverable 5**: `commands/disconnect-channel.ts` (undoable; captures `previousStatus / isActive / isPrimary / credentialsRef / lastError` snapshot) + `commands/interceptors.ts` (`beforeUndo` interceptor blocks restore when a different channel became primary for the user while this one was disconnected — avoids violating the partial-unique `communication_channels_one_primary_per_user_uq` index).
- [x] Unit tests: 30 new tests across `mutation-guards.test.ts` (13), `user-deleted-cascade.test.ts` (4), `disconnect-channel.test.ts` (10), `interceptors.test.ts` (4). All passing.
- [x] Module-local integration tests: `TC-CHANNEL-EMAIL-014..020` (7 specs) covering primary-swap contract, admin RBAC, tenant OAuth override, disconnect halts polling, send-as-user mutation guard, profile page after cascade, rich-content widget composition.
- [x] `yarn generate` succeeds; `yarn build:packages` succeeds (22/22 packages); `yarn test` succeeds (22/22 packages, core: 4441 tests / 532 suites — +30 vs pre-Phase-4 baseline).
- [ ] Manual QA: connect Gmail + IMAP for one user, flip primary, disconnect Gmail, undo while IMAP is primary — verify the interceptor blocks and the UX is acceptable. (Not part of CI.)

### Phase 1 — IMAP Detailed Progress (Slice 3e)
- [x] Workspace package scaffold (`packages/channel-imap/`, `build.mjs`, `watch.mjs`, `jest.config.cjs`, `tsconfig.json`, `package.json`)
- [x] `src/modules/channel_imap/` skeleton (`index.ts`, `acl.ts`, `setup.ts`, `di.ts`, `integration.ts`)
- [x] `lib/capabilities.ts` — `realtimePush: false`, `threading: true`, `richText: true`, `fileSharing: true`, `maxFileSize: 25_000_000`, no reactions, no edit/delete
- [x] `lib/credentials.ts` — Zod schemas for IMAP+SMTP credentials + channel poll state
- [x] `lib/imap-client.ts` — imapflow wrapper (lazy dynamic import; test-swappable client)
- [x] `lib/smtp-client.ts` — nodemailer wrapper (lazy dynamic import; test-swappable client)
- [x] `lib/normalize-inbound.ts` — mailparser-backed MIME → `NormalizedInboundMessage` with In-Reply-To/References threading
- [x] `lib/convert-outbound.ts` — hub-canonical `ConvertOutboundInput` → email-shaped native content + threading headers
- [x] `lib/validate-credentials.ts` — live IMAP login + SMTP `verify` with field-level error mapping
- [x] `lib/adapter.ts` — ChannelAdapter implementation wiring all of the above
- [x] Unit tests: 34 passing across `credentials.test.ts`, `convert-outbound.test.ts`, `normalize-inbound.test.ts`, `validate-credentials.test.ts`, `adapter.test.ts`
- [x] Module-local integration tests: `TC-CHANNEL-EMAIL-001` (provider registration), `TC-CHANNEL-EMAIL-002` (webhook no-op), `TC-CHANNEL-EMAIL-003` (profile page render)
- [x] Wired into `apps/mercato/src/modules.ts`
- [x] `yarn install` → 31 new packages (imapflow + nodemailer + mailparser + types)
- [x] `yarn generate` succeeds; structural cache purged
- [x] `yarn build:packages` succeeds (20/20 packages); `yarn test` succeeds (21/21 packages)
- [ ] Live IMAP/SMTP end-to-end test against a real server — covered manually by user when connecting a real account; not part of CI
- [ ] Phase 4 widget injections (profile + integrations + data tables) — deferred to slice 3f when shared with the Gmail provider
