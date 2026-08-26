# Discord two-way communication channel + AI bot

**Date**: 2026-06-19
**Status**: Draft — hub sender-identity contract **decided** (Variant A, 2026-08-13); see § Decided — hub sender-identity contract
**Scope**: Open Source
**Depends on**: [`SPEC-045d-communication-notification-hubs.md`](implemented/SPEC-045d-communication-notification-hubs.md) (Communication & Notification Hubs — the `communication_channels` hub + `ChannelAdapter` contract)
**Related**:
- [`SPEC-056-2026-02-22-whatsapp-ai-chat-integration.md`](SPEC-056-2026-02-22-whatsapp-ai-chat-integration.md) — first AI-assisted channel; easy-vs-complex reply tiering reused here.
- `packages/channel-gmail/` and `packages/channel-imap/` — reference provider packages (file layout, DI, health check, capabilities).
- `packages/ai-assistant/AGENTS.md` — `runAiAgentText` / `runAiAgentObject` programmatic agent invocation.
- **QA of #4391 against a real Discord bot filed four blockers; this spec is the decision record for
  the first and the reference for the rest:**
  - #4975 — inbound Discord messages are rejected (hub requires `externalEmail`) → § Backward
    compatibility touch-point 1, § Decided — hub sender-identity contract. **Decided (Variant A) and
    implemented; this issue is the one the decision resolves.**
  - #4976 — no product path to send a Discord message (both hub outbound endpoints require an email
    recipient) → touch-point 2, § Shared prerequisite. **Deferred by this spec, tracked there.**
  - #4977 — reconnecting Discord creates a duplicate channel (the `externalIdentifier = NULL`
    consequence) → touch-point 3, § Shared prerequisite. **Deferred by this spec, tracked there.**
  - #4978 — inbound messages are silently lost under `QUEUE_STRATEGY=local` → § Risks & impact
    review. **Out of scope for this spec** (queue/observability defect, independent of the identity
    contract).

---

## TLDR

**Key points**

- Add a **Discord channel provider** package `@open-mercato/channel-discord` (module id `channel_discord`, provider key `discord`) under the existing `communication_channels` hub. No new framework primitives — it implements the existing `ChannelAdapter` contract.
- **Two-way by reusing the hub**: outbound goes through the hub's `deliver-outbound-message` command → Discord REST API; inbound flows into the hub's `ingest-inbound-message` command and emits `communication_channels.message.received`. Because both directions are hub commands/events, **every module** can send and receive Discord messages exactly the way it already sends/receives Gmail/WhatsApp/Slack — no Discord-specific coupling in consumer modules.
- **Open Mercato as a Discord bot**: a long-running **Gateway worker** (Discord's real-time WebSocket) bridges incoming Discord messages into the hub. A signed **Interactions** HTTP endpoint handles slash commands / button clicks (Discord Ed25519 request signing).
- **AI agent connected to Discord** (see § AI bot wiring): a hub subscriber on `communication_channels.message.received` (provider `discord`) invokes an object-mode `ai_assistant` agent through `runAiAgentObject` under a tenant-scoped service principal, then replies via the hub's generic compose → `deliver-outbound-message` path. The agent answers "easy" messages directly and produces a summary + proposed reply for "complex" ones, mirroring SPEC-056; the proposal lands in the operator's inbox with approve/dismiss actions. Off by default per channel, armed from the channel's AI auto-reply settings form.
- The spec documents **how to configure Discord** (application, bot, intents, token, public key, invite URL/scopes), **how to run it** (gateway worker + interactions route), and **how to test it** (local smoke test + integration test list).

**Concerns**

- Discord's transport is a persistent **Gateway WebSocket**, not inbound HTTP webhooks like Slack/WhatsApp. The hub's inbound model assumes either an HTTP webhook (`verifyWebhook`) or a poller (`fetchHistory`). The design resolves this with a dedicated gateway worker that calls the hub's ingest command directly, plus a thin signed HTTP interactions route — see § Architecture.
- Ed25519 signature verification on the interactions endpoint MUST be fail-closed (the shared webhook route treats a non-throwing `verifyWebhook` as "verified").
- AI auto-reply must never auto-send privileged actions — reuse the mutation-approval gate.
- **The hub's message path is email-shaped and Discord cannot satisfy it.** Sender identity, outbound
  recipient validation, and channel identity all assume an email address. This was mis-stated as
  "no hub contract change required" until QA of #4391 against a real Discord bot proved otherwise
  (#4975). See § Backward compatibility and § Decided — hub sender-identity contract — the sender-identity
  half is resolved (Variant A); the outbound-recipient and channel-identity halves remain open as
  #4976 and #4977.

---

## Required sections (MUST include)

1. TLDR ✅
2. Overview ✅
3. Problem statement ✅
4. Proposed solution ✅
5. Architecture ✅
6. Data models ✅
7. API & adapter contracts ✅
8. Discord configuration (run & test) ✅
9. AI bot wiring ✅
10. Integration test coverage ✅
11. Risks & impact review ✅
12. Backward compatibility ✅
13. Decided — hub sender-identity contract ✅ (Variant A, 2026-08-13)
14. Final compliance report ✅
15. Changelog ✅

---

## Overview

Open Mercato already has a unified **Communications Hub** (`communication_channels`) that bridges
external chat/email channels into the platform Messages module. Provider packages
(`channel-gmail`, `channel-imap`) implement a single `ChannelAdapter` contract and register
themselves in the hub's adapter registry. The hub owns inbound ingestion, threading, contact
resolution, conversation lifecycle, and outbound delivery; the provider owns credentials,
transport, and message encode/decode.

This spec adds **Discord** as the next provider, with two explicit product goals beyond "another
inbox channel":

1. **Open Mercato behaves like a Discord bot.** It connects to a Discord server (guild) with a bot
   token, receives messages and interactions in real time, and can post messages, replies, and
   reactions back.
2. **An AI-framework agent can be connected to Discord.** Inbound Discord messages can be answered
   by an `ai_assistant` agent automatically (with human-in-the-loop for anything risky), so a
   tenant can run a support/ops bot in their Discord without writing bespoke code.

Because the bot is delivered as a hub provider, the **send/receive capability is generic**: any
module that already speaks to the hub (composing a `Message`, subscribing to
`communication_channels.message.received`, calling `deliver-outbound-message`) automatically gains
the ability to send and receive Discord messages once a Discord channel is connected.

**Target audience**: tenants who run a Discord community/server for customers or staff and want
those conversations, notifications, and (optionally) an AI assistant inside Open Mercato.

**Package locations**

- **Hub (unchanged)**: `packages/core/src/modules/communication_channels/` — registry, entities,
  ingest/deliver commands, events, the unauthenticated `api/post/webhook/[provider]` route, polling
  + push workers. This spec aims to require **no contract change** to the hub; see § Backward
  compatibility for the one hub touch-point under negotiation (a `gateway` inbound mode).
- **New provider**: `packages/channel-discord/` (module id `channel_discord`) — Discord REST client,
  Gateway client, `DiscordChannelAdapter` implementing `ChannelAdapter`, `integration.ts`,
  health check, gateway worker, interactions route, credential schemas.
- **AI wiring**: a subscriber inside `channel_discord` (the optional consumer owns the glue) that
  resolves the `ai_assistant` runtime via a soft `tryResolve` and calls `runAiAgentText` /
  `runAiAgentObject`. The AI assistant module is an **optional** peer — when it is absent the
  subscriber no-ops and the channel still works as a plain inbox.

> **Market reference**: Discord bots are normally built directly against discord.js / the Gateway.
> We adopt the bot connectivity and slash-command interactions, but route every message through the
> hub so Discord conversations are first-class CRM data (threaded, contact-resolved, AI-summarizable)
> and so any module can use Discord as a transport. We defer voice, a no-code slash-command builder,
> and "Login with Discord" identity.

---

## Problem statement

- **No Discord presence.** A grep of the repo returns zero Discord references; tenants who live in
  Discord have no way to bring those conversations into Open Mercato or to drive Open Mercato from
  Discord.
- **Bots are normally bespoke.** Building a Discord bot today means a standalone discord.js service
  with its own persistence, auth, and deploy — none of it integrated with tenant scoping, RBAC,
  CRM contacts, or the AI assistant.
- **Modules can't reach Discord.** Even though the hub already lets modules send/receive over
  Gmail/IMAP/WhatsApp/Slack, there is no Discord transport, so notifications and conversations can't
  flow to Discord through the existing seams.
- **AI assistant is in-app only.** The `ai_assistant` agents run from the in-app chat UI
  (`<AiChat>` / command palette). There is no path for an agent to answer an external Discord
  message and reply, even though `runAiAgentText` already supports programmatic invocation.

---

## Proposed solution

1. **Discord provider package** implementing `ChannelAdapter` (`channelType: 'discord'`,
   `providerKey: 'discord'`). Outbound `sendMessage` posts via the Discord REST API
   (`POST /channels/{channel_id}/messages`). `convertOutbound` maps the hub's normalized body
   (`text`/`markdown`/`html`) to Discord message content (markdown-native, ≤2000 chars, optional
   embeds/attachments). `normalizeInbound` maps a Discord message object to
   `NormalizedInboundMessage`. Reactions map to `PUT/DELETE /channels/{id}/messages/{id}/reactions`.

2. **Gateway worker for real-time inbound.** A long-running `workers/discord-gateway.ts` opens a
   Discord Gateway WebSocket per active Discord channel/bot, subscribes to `MESSAGE_CREATE`,
   `MESSAGE_REACTION_ADD/REMOVE`, identifies with the bot token + intents, and on each event calls
   the hub's `communication_channels.message.ingest_inbound` command directly (same command the
   webhook route enqueues). This is the key design choice — Discord pushes over a socket, not HTTP.

3. **Signed Interactions endpoint** for slash commands and component (button/select) interactions.
   Discord delivers these over HTTP with Ed25519 request signing. The adapter's `verifyWebhook`
   verifies the `X-Signature-Ed25519` / `X-Signature-Timestamp` headers against the channel's
   stored **public key**, handling the mandatory `PING`→`PONG` handshake, and normalizes
   command/component payloads into the hub.

4. **AI bot tier** (optional): a `channel_discord` subscriber on
   `communication_channels.message.received` filters to `providerKey === 'discord'`, classifies the
   message, and either (a) auto-replies for "easy" messages via `runAiAgentText` →
   `deliver-outbound-message`, or (b) posts a summary + proposed reply for human approval on
   "complex"/low-confidence messages. Auto-send is gated by the agent's `mutationPolicy` and the
   per-tenant mutation-policy override — privileged actions always require approval.

5. **Configuration, run, and test runbook** (§ Discord configuration) so an operator can stand up
   the bot end-to-end and verify it locally.

### Design decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Transport for inbound messages | Gateway WebSocket worker (not HTTP webhook) | Discord does not POST normal messages to a webhook; bots must connect to the Gateway. The email providers are poll/push-driven by the hub's own workers; Discord introduces a *provider-owned* long-running worker (a new pattern, allowed because `workers/*.ts` auto-discovers in any module). |
| Transport for slash commands / buttons | Signed HTTP Interactions endpoint | Discord *does* POST interactions to a configured URL with Ed25519 signing — fits the hub's `api/post/webhook/[provider]` route + `verifyWebhook`. |
| Outbound | Discord REST API from `sendMessage` | Standard bot send; no socket needed for sending. |
| Identity model | Bot token per Discord channel (guild/bot), not per-end-user OAuth | A bot posts as itself; end users are external senders resolved to CRM contacts via `resolveContact`. "Login with Discord" identity is out of scope. |
| `realtimePush` capability | `true`, with the gateway worker as the live source | Tells the hub not to schedule polling for this channel (the socket delivers events). |
| AI auto-send boundary | Easy = auto, complex = propose-only; mutation-gated | Reuse SPEC-056 tiering and the AI mutation-approval contract; never auto-execute privileged writes. |

---

## Architecture

```
                         DISCORD (a guild/server)
        ┌──────────────────────────┬─────────────────────────────┐
        │ Gateway (WebSocket)      │ Interactions (HTTPS POST,    │
        │ MESSAGE_CREATE,          │ Ed25519-signed: slash cmds,  │
        │ REACTION_ADD/REMOVE      │ buttons, PING handshake)     │
        └────────────┬─────────────┴───────────────┬─────────────┘
                     │ (1) socket events            │ (2) signed HTTP
                     ▼                               ▼
  packages/channel-discord                 communication_channels
  workers/discord-gateway.ts               api/post/webhook/[provider=discord]/route.ts
        │ identify(botToken, intents)            │ adapter.verifyWebhook (Ed25519, fail-closed)
        │ on event → normalizeInbound            │ → enqueue inbound-processor
        ▼                                         ▼
        └──────────────┬──────────────────────────┘
                       ▼
        communication_channels command:
        communication_channels.message.ingest_inbound
        (dedup, thread match, contact resolve, compose Message)
                       │
                       ├── emits communication_channels.message.received  (clientBroadcast)
                       │        │
                       │        ├── existing hub subscribers (notifications, indexing, …)
                       │        └── channel_discord subscriber (AI bot, optional) ──┐
                       │                                                            │
                       ▼                                                            ▼
        Operator UI (Messages / inbox)                          runAiAgentText / runAiAgentObject
                                                                (ai_assistant, optional peer)
                                                                            │
                                                                  classify easy vs complex
                                                                            │
                                              easy → auto-reply             complex → propose
                                                            │                         │
                                                            ▼                         ▼
                       communication_channels command: deliver-outbound-message  (human approves)
                                                            │
                                                            ▼
                       DiscordChannelAdapter.sendMessage → Discord REST  POST /channels/{id}/messages
```

### Outbound path (any module → Discord)

1. A module (or a user in the inbox UI, or the AI subscriber) calls the hub command
   `communication_channels.message.deliver_outbound` with the target channel + normalized body —
   exactly as it does for Gmail/WhatsApp today. Modules never import anything Discord-specific.
2. The hub resolves the `discord` adapter from the registry, calls `convertOutbound` then
   `sendMessage`, persists the `ExternalMessage` + `MessageChannelLink`, and emits
   `communication_channels.message.sent`.
3. `sendMessage` calls Discord REST `POST /channels/{channel_id}/messages` with the bot token
   (`Authorization: Bot <token>`), returns `{ externalMessageId, status: 'sent' }`.

### Inbound path (Discord → any module)

1. **Messages**: the gateway worker receives `MESSAGE_CREATE`, skips the bot's own messages,
   `normalizeInbound`s the payload, and invokes `communication_channels.message.ingest_inbound`
   with the channel scope. The hub dedups by `(channel_id, external_message_id)`, matches/creates
   the thread, resolves the CRM contact (`resolveContact` using the Discord user id/handle), composes
   the platform `Message`, and emits `communication_channels.message.received`.
2. **Reactions**: `MESSAGE_REACTION_ADD/REMOVE` → `normalizeInboundReaction` →
   reaction-processor (existing hub path).
3. **Slash commands / buttons**: Discord POSTs to the provider-owned
   `/api/channel_discord/interactions`; the route screens the request, fans out Ed25519
   verification across the active `discord` channels of the claimed application, and pins the
   tenant to the channel whose public key verifies. The initial `PING` (type 1) is answered
   synchronously with `{ type: 1 }` (PONG) — which is why the route is provider-owned rather than
   the hub's generic webhook route, which 202-acks and enqueues. Application commands, components
   and modal submissions are answered with a deferred ack and dispatched into the SAME hub inbound
   queue used above — see § Interactions dispatch.

### Adapter method map

| `ChannelAdapter` member | Discord implementation |
|-------------------------|------------------------|
| `providerKey` | `'discord'` |
| `channelType` | `'discord'` (the contract's `channelType` is `'whatsapp' \| 'slack' \| 'email' \| 'sms' \| string` — `'discord'` is allowed as a string) |
| `capabilities` | **As shipped.** Declared `true`: `recipientFormat: 'provider-native'` (a Discord recipient is a channel snowflake, never an address), `richText: true` (markdown), `reactions: true`, `editMessage: true`, `deleteMessage: true`, `conversationHistory: true`, `supportedBodyFormats: ['text','markdown']`, `maxBodyLength: 2000`, `realtimePush: true`, `interactiveComponents: true` (slash commands, buttons, select menus and modal submissions are dispatched into the hub's inbound queue and answered with a real follow-up — see § Interactions dispatch). Declared **`false`**, because the first release does not implement them and the hub would otherwise route work this adapter silently drops — each with its reason recorded in `lib/capabilities.ts`: `threading` (nothing hub-side writes `replyToExternalId` into *outbound* metadata; it exists only on the inbound normalized shape), `fileSharing` / `inlineImages` (`convertOutbound` drops attachments and the REST client has no multipart upload), plus `multiReactionPerUser`, `typingIndicators`, `presence`, `richBlocks`, `stickers`, `readReceipts`, `deliveryReceipts`, `contactCards`, `locationSharing`, `voiceNotes`. A flag flips back to `true` only in the change that implements it, guarded by the parity test in `lib/__tests__/capabilities.test.ts` |
| `sendMessage` | REST `POST /channels/{id}/messages` (`Authorization: Bot <token>`) |
| `verifyWebhook` | Ed25519 verify of interactions POST; **throws** on failure (fail-closed). Plain messages do not arrive here — they come via the gateway worker — so for a non-interaction body it returns `eventType: 'other'` (route acks without tenant-scoped work) |
| `normalizeInbound` | Discord message object → `NormalizedInboundMessage` (sender id/handle, content, attachments, `replyToExternalId` from `message_reference`) |
| `normalizeInboundReaction` | `MESSAGE_REACTION_*` → `InboundReactionEvent` |
| `convertOutbound` | normalized body → `{ content, embeds?, allowed_mentions }`; markdown passes through; html is downconverted to markdown |
| `sendReaction` / `removeReaction` | `PUT/DELETE /channels/{id}/messages/{mid}/reactions/{emoji}/@me` |
| `editMessage` / `deleteMessage` | `PATCH/DELETE /channels/{id}/messages/{mid}` |
| `resolveContact` | maps Discord user id + username/global_name to a `ContactHint` (no email/phone; sets `displayName`, `externalProfileUrl`, best-effort CRM match by handle) |
| `fetchHistory` | optional backfill via `GET /channels/{id}/messages?before=` (cursor = message id); used by the explicit import-history endpoint, not for live delivery |
| `validateCredentials` | live `GET /users/@me` with the bot token to confirm token + intents at connect time |
| OAuth methods (`buildOAuthAuthorizeUrl`, `exchangeOAuthCode`, `refreshCredentials`) | **omitted** — bot token is static; no per-user OAuth |
| Push methods (`registerPush`, `applyPushNotification`) | **omitted** — the gateway worker is the live source, not Gmail-style Pub/Sub push |

### Gateway worker design

- File: `packages/channel-discord/src/modules/channel_discord/workers/discord-gateway.ts`
  (auto-discovered worker; `metadata = { queue: 'channel_discord_gateway', concurrency: 1 }`).
  **New pattern note**: this is a *provider-owned* long-running worker, which neither reference
  package ships — `channel-gmail` and `channel-imap` have no `workers/` directory; the hub itself
  owns the polling/push workers (`communication_channels/workers/{poll-channel,poll-tick,inbound-processor,gmail-history-sync}.ts`).
  A worker file under any module's `workers/` is auto-discovered, so a provider package shipping
  one is allowed by the framework — it is simply novel relative to the email providers, which are
  poll/push-driven by the hub rather than socket-driven by the provider.
- On boot / channel-connect, opens one Gateway connection per active `discord` channel
  (`is_active`, not deleted). Performs the Identify handshake with the bot token and the declared
  **gateway intents** (`GUILDS`, `GUILD_MESSAGES`, `MESSAGE_CONTENT`, `GUILD_MESSAGE_REACTIONS`,
  optionally `DIRECT_MESSAGES`). Maintains heartbeat + resume (session id + sequence) and reconnects
  with backoff on close codes; surfaces fatal auth failures (`4004`/`4014`) by emitting
  `communication_channels.channel.requires_reauth` so the hub flags the channel.
- For each relevant event it builds a `NormalizedInboundMessage` (via the adapter) and calls the
  hub ingest command with the channel's tenant scope. It MUST ignore events authored by the bot's
  own user id to avoid feedback loops.
- The worker is the reason the channel advertises `realtimePush: true`: the hub's polling scheduler
  skips channels whose adapter declares realtime push, so there is no redundant `fetchHistory`
  polling for live traffic.
- **Single-connection discipline**: Discord allows one Gateway identify per bot token at a time.
  The worker uses `concurrency: 1` and a per-channel lock so a tenant's bot has exactly one live
  socket; horizontal scaling uses Discord sharding keyed by guild count (documented as a scale-out
  note, single shard for the first release).

---

## Data models

No new hub entities. Discord reuses the hub's existing entities (`CommunicationChannel`,
`ExternalConversation`, `ExternalMessage`, `MessageChannelLink`, `ChannelThreadMapping`).

- `CommunicationChannel.providerKey = 'discord'`, `channelType = 'discord'`,
  `externalIdentifier = <bot application id or guild id>`.
- `CommunicationChannel.credentialsRef` → encrypted credentials resolved via
  `integrationCredentialsService` under scope `channel_discord` (mirrors `channel_gmail` /
  `channel_imap`). Credential shape (Zod, in `lib/credentials.ts`):

  ```ts
  // packages/channel-discord/src/modules/channel_discord/lib/credentials.ts
  const discordCredentialsSchema = z.object({
    botToken: z.string().min(1),          // "Bot <token>" — never logged
    applicationId: z.string().min(1),     // for registering slash commands
    publicKey: z.string().min(1),         // Ed25519 hex — verifies interactions
    guildId: z.string().optional(),       // scope the bot to one guild (recommended)
    defaultChannelId: z.string().optional(), // default outbound text channel
  })
  ```

- `CommunicationChannel.channelState` (JSONB, additive) holds gateway resume state
  (`{ sessionId, sequence, resumeGatewayUrl }`) so the worker can resume instead of re-identify.
- `ExternalConversation.externalConversationId = <discord channel id or thread id>`.
- `ExternalMessage.externalMessageId = <discord message id>`; `channelContentType = 'discord'`;
  `channelPayload` stores the raw Discord message object for fidelity.
- Contact resolution: Discord senders have no email/phone, so `resolveContact` returns a
  `ContactHint` with `displayName`, `externalProfileUrl` (`https://discord.com/users/<id>`), and an
  optional CRM match by stored handle. Unmatched senders create a system-owned external contact, as
  with other channels.

---

## API & adapter contracts

### Reused hub routes (no change to call sites)

| Route | Method | Use for Discord |
|-------|--------|-----------------|
| `/api/communication_channels/channels/connect/credentials` | POST | Connect a Discord channel with bot token + public key (credential-based connect, same as IMAP). |
| `/api/communication_channels/channels/{id}/test-send` | POST | Smoke-test outbound to the default channel. |
| `/api/communication_channels/channels/{id}/import-history` | POST | Optional backlog import via `fetchHistory`. |
| `/api/communication_channels/messages/{id}/reactions` | POST | Add a reaction (hub → `sendReaction`). |

### New provider-owned surface

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/channel_discord/interactions` | POST | Discord **Interactions** endpoint (slash commands, buttons, modal submissions, PING handshake). Unauthenticated at the platform layer; Ed25519 verification is the auth, fail-closed. Provider-owned because Discord requires a synchronous PONG the hub's generic webhook route cannot return. |
| `/api/channel_discord/channels/{id}/ai-auto-reply` | GET / PUT | Per-channel AI auto-reply settings. GET returns the stored state, the eligible agents, and per agent whether the auto-reply principal could actually invoke it; PUT arms or disarms through the settings command. Gated on `channel_discord.view` / `channel_discord.configure`. |
| `/api/channel_discord/ai-auto-reply/channels` | GET | Every Discord channel's auto-reply state in one query, for the integration detail panel. Deliberately does **not** build the agent directory — the panel renders booleans, not a picker — and pins its own `metadata.path` so the collection cannot be mistaken for a channel id. |

| File | Purpose |
|------|---------|
| `integration.ts` | `IntegrationDefinition` — category `communication`, hub `communication_channels`, credential fields (bot token, application id, public key, guild id), `healthCheck.service: 'channelDiscordHealthCheck'`, detail widget spot. |
| `di.ts` | `register(container)` — registers the `DiscordChannelAdapter` and `channelDiscordHealthCheck` under the exact `healthCheck.service` name. |
| `setup.ts` | Registers the adapter at import time; declares `defaultRoleFeatures`; reads env preset (see below). |
| `acl.ts` | `channel_discord.view`, `channel_discord.configure`. |
| `lib/adapter.ts` | `DiscordChannelAdapter implements ChannelAdapter`. |
| `lib/discord-rest.ts` | REST client (send/edit/delete/reactions/history/`users/@me`). Swappable via `setDiscordRestClient` test hook. |
| `lib/discord-gateway-client.ts` | Gateway WebSocket client (identify/heartbeat/resume). Swappable via `setDiscordGatewayClient` test hook. |
| `lib/interactions-verify.ts` | Ed25519 verification (`tweetnacl` or Node `crypto.verify('ed25519', …)`) + PING handling. |
| `lib/interactions-handler.ts` | Screening gate, per-candidate signature fan-out, tenant pinning, and the response the endpoint returns for each interaction type. |
| `lib/interactions-dispatch.ts` | Pure builders: read a verified interaction, render it as text, synthesize the hub inbound job, send the follow-up. |
| `lib/interactions-queue.ts` | `channel_discord_interactions` queue name, job payload type, memoized queue instance. |
| `lib/slash-commands.ts` | The command definitions `register-slash-commands` registers, plus validation for an operator-supplied JSON list. |
| `workers/discord-interactions.ts` | Interaction dispatch worker → hub inbound queue + Discord follow-up. |
| `lib/health.ts` | `channelDiscordHealthCheck` — validates bot token via `GET /users/@me`. |
| `workers/discord-gateway.ts` | Long-running gateway bridge → hub ingest. |
| `lib/capabilities.ts` | `ChannelCapabilities` (`realtimePush: true`, `editMessage: true`, `deleteMessage: true`). |
| `cli.ts` → `register-slash-commands` | Registers application (slash) commands against one guild (`PUT /applications/{app}/guilds/{guild}/commands`). Operator-run, not automatic — registration is a per-guild decision. |

All API route files MUST export `openApi`; `api/interactions/route.ts` does, and pins its operator-facing path explicitly in `metadata.path`.
The provider module MUST run `yarn generate` after adding DI/setup/acl/integration files.

### Interactions dispatch (issue #4663)

Discord closes an interaction that is not answered within **three seconds**, and a
deferred acknowledgement leaves the user looking at "thinking…" until something
replaces it. Both facts shape the design: the HTTP route does only what is fast
and synchronous, and the two slow halves — the hub write and the follow-up REST
call — run in a worker.

| Stage | Where | What it does |
|-------|-------|--------------|
| Screen | `lib/interactions-handler.ts` → `screenInteractionRequest` | Rejects on the request alone (missing / malformed signature header, stale timestamp) before any database work. |
| Verify + pin | `handleDiscordInteraction` | Ed25519 fan-out over the `application_id`-narrowed candidates; the match pins tenant and organization. |
| Answer | `api/interactions/route.ts` | PING → PONG. Dispatchable type → deferred ack **plus** the `dispatch` payload. Autocomplete → empty choice list (Discord rejects a deferred ack there). Anything else, or a payload with no follow-up token / channel / invoking user → an ephemeral "not handled" reply, never a promise the provider cannot keep. |
| Hand off | route → `lib/interactions-queue.ts` | Enqueues on `channel_discord_interactions` **before** returning the ack; a queue that cannot accept the job downgrades the response to a visible error. |
| Dispatch | `workers/discord-interactions.ts` | Synthesizes a Discord message object from the interaction, enqueues it on the hub's existing `communication-channels-inbound` queue, then replaces the placeholder over Discord's interaction-webhook endpoints. |

**Dispatchable types:** `APPLICATION_COMMAND` (2), `MESSAGE_COMPONENT` (3) and
`MODAL_SUBMIT` (5). Each becomes one hub message whose `externalMessageId` is the
interaction snowflake, so a redelivered interaction dedups instead of duplicating.

**Why a synthesized message rather than a new hub path:** the hub contract stays
untouched. `inbound-processor` calls `adapter.normalizeInbound` on whatever `raw`
it is handed, so an interaction lands in the same conversation, under the same
tenant scope, with the same dedup discipline as anything typed in the channel.
`normalizeInboundDiscordMessage` adds `discordInteractionId` /
`discordInteractionType` / `discordCommandName` / `discordComponentCustomId` to
`channelMetadata` so a consumer can tell a command from a chat message without
re-parsing `channelPayload`.

**Follow-up:** `PATCH /webhooks/{app}/{token}/messages/@original` first, because
that is the call that ends the "thinking…" state; `POST /webhooks/{app}/{token}`
is the fallback when the original response is already gone. Neither carries the
bot token — the interaction token in the URL is the credential — and the queue
payload carries a credential *scope*, never a secret, because the local queue
strategy persists payloads to disk as plain JSON.

**Capability contract:** `interactiveComponents` flips to `true` in the same
change, pinned by the parity test in `lib/__tests__/capabilities.test.ts`, which
drives the whole path (dispatch → hub job → follow-up) rather than asserting the
flag against itself.

---

## Discord configuration (run & test)

This is the operator runbook the brief explicitly asks for: how to configure Discord, run it,
and test it.

### 1. Create the Discord application + bot

1. Go to <https://discord.com/developers/applications> → **New Application**. Name it (e.g.
   "Open Mercato Bot"). Copy the **Application ID** and the **Public Key** from the *General
   Information* tab — both go into the channel credentials.
2. Open the **Bot** tab → the application already has a bot user. Click **Reset Token** and copy
   the **bot token** (shown once). This is the `botToken` credential — store it encrypted; never log
   or commit it.
3. Under **Privileged Gateway Intents**, enable **MESSAGE CONTENT INTENT** (required to read message
   text) and **SERVER MEMBERS INTENT** if you need member metadata. `GUILD_MESSAGES` and
   `GUILD_MESSAGE_REACTIONS` are non-privileged and enabled via the Identify intents bitfield.

### 2. Invite the bot to a server (guild)

Build an OAuth2 invite URL with the `bot` and `applications.commands` scopes and the minimum bot
permissions (View Channels, Send Messages, Read Message History, Add Reactions, Manage Messages if
you want edit/delete):

```
https://discord.com/oauth2/authorize?client_id=<APPLICATION_ID>&scope=bot+applications.commands&permissions=<PERMISSIONS_INTEGER>
```

`<PERMISSIONS_INTEGER>` is the OR of the permission bits (e.g. View Channels `0x400` + Send Messages
`0x800` + Read Message History `0x10000` + Add Reactions `0x40` = `67648`; add Manage Messages
`0x2000` for edit/delete). Open the URL, pick the target server, authorize. Note the **Guild ID**
(enable Developer Mode in Discord → right-click the server → *Copy Server ID*) for the `guildId`
credential, and the target text channel's id for `defaultChannelId`.

### 3. Set the Interactions endpoint (slash commands / buttons)

In the application's **General Information** tab, set **Interactions Endpoint URL** to your public
hub route:

```
https://<your-host>/api/channel_discord/interactions
```

Discord immediately sends a signed `PING`; saving succeeds only if the endpoint answers `{ "type": 1 }`
with a valid Ed25519 verification against the **Public Key**. (Locally, expose the route via a tunnel
such as `cloudflared` / `ngrok`.) If you only need messages (not slash commands), this step is
optional — message traffic uses the Gateway, not this endpoint.

Once the endpoint is set and commands are registered (§ 5), a slash command or a button press is
recorded in the hub inbox and answered in Discord — see § Interactions dispatch.

### 4. Connect the channel in Open Mercato

In `/backend/integrations`, find **Discord**, and connect a channel with the credential fields
(`botToken`, `applicationId`, `publicKey`, `guildId`, `defaultChannelId`). `validateCredentials`
calls `GET /users/@me` to confirm the token before persisting.

Optional env preconfiguration (provider-owned, applied from `setup.ts`, rerunnable via a provider
CLI command — same pattern as other providers):

| Env var | Purpose |
|---------|---------|
| `OM_CHANNEL_DISCORD_BOT_TOKEN` | Bootstrap bot token for tenant setup. |
| `OM_CHANNEL_DISCORD_APPLICATION_ID` | Bootstrap application id. |
| `OM_CHANNEL_DISCORD_PUBLIC_KEY` | Bootstrap Ed25519 public key. |
| `OM_CHANNEL_DISCORD_GUILD_ID` | Default guild to scope the bot to. |
| `OM_CHANNEL_DISCORD_DEFAULT_CHANNEL_ID` | Default outbound text channel. |
| `OM_CHANNEL_DISCORD_GATEWAY_DISABLED` | When truthy, skip starting the gateway worker (useful in CI / when only outbound is needed). |

### 5. Run it

```bash
# 1. App + workers (the gateway worker auto-registers via the module's worker discovery)
yarn dev
# 2. Confirm the gateway connected (look for the identify/ready log)
#    The worker emits communication_channels.channel.requires_reauth on 4004/4014 auth failures.
# 3. (Optional) register slash commands for a guild
yarn mercato channel_discord register-slash-commands --tenant <tenantId> --org <organizationId>
#    Add --guild <guildId> to override the stored credential, or
#    --commands <path-to-json> to register your own definitions.
```

The dispatch worker (`channel_discord_interactions`) is an ordinary module worker
picked up by the app's standard worker runner — unlike `start-gateway`, nothing
has to be started by hand for slash commands to be answered.

### 6. Test it

- **Outbound smoke test**: `POST /api/communication_channels/channels/{id}/test-send` (or click
  *Test send* in the channel detail UI). The bot posts to `defaultChannelId`; verify the message
  appears in Discord.
- **Inbound smoke test**: type a message in the connected Discord channel. Within a second it
  should appear in the Open Mercato inbox (the `communication_channels.message.received` event also
  broadcasts to the browser via SSE). Confirm the sender resolved to a contact (or a new external
  contact was created).
- **Reaction test**: react to a message in Discord; confirm the reaction lands on the platform
  message. React from the inbox UI; confirm it appears in Discord.
- **Interactions test** (if configured): run a registered slash command; confirm the signed POST
  verifies and the command normalizes into the hub. A tampered signature MUST be rejected (401),
  never acknowledged.
- **AI bot test**: see § AI bot wiring.

---

## AI bot wiring

The brief's headline: *an `ai_framework`-based agent can be connected to Discord via communication
channels*. This is done **without** new framework primitives, using the programmatic agent runtime.

> ### Delivered (2026-08-24, issue #4778)
>
> This section was a design target between 2026-08-01 and 2026-08-24. The 2026-07-30 re-review of
> #4391 established that the subscriber as originally written could not invoke any agent the
> repository shipped — it called `runAiAgentObject` with `features: []`, and every shipped agent was
> chat-mode and feature-gated, so both the feature gate and the object-mode gate denied it — and that
> no product surface wrote the `aiAutoReplyEnabled` / `aiAgentId` keys that arm it. The feature was
> therefore de-scoped and tracked as #4778.
>
> #4778 closes all four halves of that finding, and the section below describes what ships:
>
> 1. **An agent the repository actually ships.** `channel_discord/ai-agents.ts` declares
>    `channel_discord.auto_reply` — object-mode, `readOnly`, `mutationPolicy: 'read-only'`, gated on
>    the real feature `channel_discord.ai_auto_reply.run`.
> 2. **A documented service-principal flow.** `lib/ai-service-principal.ts` resolves the tenant's
>    channel-bot user and loads its real ACL, falling back to a single code-declared grant. It never
>    passes `features: []` and never runs as a super-admin.
> 3. **A configuration path.** `PUT /api/channel_discord/channels/{id}/ai-auto-reply` behind a
>    `CrudForm` settings page, zod-validated, tenant-scoped, mutation-guarded, optimistic-locked on
>    the channel's `updated_at`, and persisted through the command bus.
> 4. **A proposal surface.** The `complex` tier files an internal message carrying the drafted reply
>    with approve/dismiss actions, instead of logging and returning.
>
> `@open-mercato/ai-assistant` is declared as an optional peer
> (`peerDependenciesMeta.optional`), the provider advertises AI auto-reply again (the `ai` tag is
> back on the integration descriptor), and the policy/runtime are exercised for real in
> `__tests__/ai-auto-reply.policy.integration.test.ts` rather than mocked away. The live end-to-end
> validation against a real Discord application stays with #4665's TC-CHANNEL-DISCORD-009/010.

### Subscriber

`packages/channel-discord/src/modules/channel_discord/subscribers/ai-auto-reply.ts`:

```ts
export const metadata = {
  event: 'communication_channels.message.received',
  persistent: true,
  id: 'channel_discord:ai-auto-reply',
}
```

The `id` is `module_id:subscriber-name`, matching the shipped code. Subscriber ids drive
dedup, so this string is a contract in its own right: renaming it makes the platform treat
the subscriber as a new one and re-deliver events it has already handled.

The handler:

1. **Filters** to `payload.providerKey === 'discord'` and to channels that have AI auto-reply
   enabled (a per-channel setting; default off). Ignores messages the bot authored.
2. **Resolves the AI runtime softly.** `ai_assistant` is an OPTIONAL peer — the subscriber uses a
   local `tryResolve` and, if the AI module/runtime is absent, no-ops (the channel still works as a
   plain inbox). It MUST NOT hard-`requires` the AI module.
3. **Classifies** the message (easy vs complex) — SPEC-056's tiering, implemented as a conservative
   regex gate in `lib/ai-reply.ts` that can only ever escalate a message AWAY from auto-send.
4. **Drafts** through `runAiAgentObject({ agentId, input, authContext, container, sessionId })`. The
   Discord thread id is the `sessionId` so multi-turn context is preserved. The agent declares its
   own output schema, so the subscriber passes no caller schema and the model is held to the shape
   the policy layer validated the agent against:
   `{ reply, summary, confidence, requiresHuman }`.
5. **Routes** on three independent signals. Auto-send requires all of them: the tiering says `easy`,
   the model sets `requiresHuman: false`, and `confidence` clears `AUTO_SEND_MIN_CONFIDENCE` (0.6).
   Any single "no" files a proposal instead.
   - **Auto-send** composes a public reply in the thread through
     `messages.messages.compose`; the hub's outbound bridge then delivers it via
     `deliver_outbound` (NOT a direct Discord call — the send path stays generic and audited).
   - **Propose** files an INTERNAL message of type `channel_discord.ai_reply_proposal` addressed to
     the conversation's assignee, carrying the drafted reply as its body and approve/dismiss
     actions. Approving dispatches `channel_discord.ai_reply_proposal.approve`, which composes the
     public reply attributed to the approving operator. With no assignee to address, the proposal is
     stored as a draft so the text is not lost, and the subscriber logs that nobody was notified.

The two proposal commands are dispatchable because `channel_discord/message-types.ts` declares them
as `defaultActions` of its message type: the messages module builds its allowlist of dispatchable
action commands from registered message types, so an action naming an unregistered command is
rejected by the confused-deputy guard.

### Safety / RBAC

- The agent runs with a tenant-scoped `authContext` produced by
  `lib/ai-service-principal.ts`. Two identities, in order: a real channel-bot user
  (`system+communication_channels@<tenantId>.local`) whose role grants are loaded through
  `rbacService.loadAcl`, or — when the tenant has none — the provider's own service principal
  carrying exactly one non-data feature, `channel_discord.ai_auto_reply.run`. `isSuperAdmin` is
  always false on both paths, so an inbound message from a public Discord server can never borrow a
  super-admin's ACL. `runAiAgentObject` enforces the agent's `requiredFeatures`, `allowedTools`,
  `executionMode`, and `mutationPolicy` against that principal — the subscriber cannot widen them.
- **Auto-send never escalates privilege — structurally, not by convention.** The agent is
  object-mode, and `runAiAgentObject` discards the resolved tool map before calling
  `generateObject`, so no tool is reachable from an inbound Discord message at all. Auto-reply is
  text only. An agent that did carry mutation tools would still route them through the AI
  mutation-approval gate (`ai_pending_actions`).
- Tenants choose the agent id per channel. The picker offers only object-mode agents, because those
  are the only ones the runtime would accept; pointing a channel at an agent from another module
  additionally requires granting that agent's `requiredFeatures` to the tenant's channel-bot user.

### Why this also satisfies "every module can send/receive Discord"

Because the AI path uses the same generic hub command (`deliver-outbound-message`) and the same
generic event (`message.received`) any other module already uses, **no module needs Discord-specific
code**. A notifications module emitting to the hub, a sales module posting an order update, or a
custom subscriber answering support questions all reach Discord through the channel the operator
connected — Discord is just another `providerKey`.

---

## Integration test coverage

Per project rules, every new feature lists integration coverage for all affected API/UI paths, and
the implementing PR ships these tests. Tests MUST be self-contained (create fixtures in setup, clean
up in teardown, no reliance on seeded/demo data). Discord REST + Gateway are stubbed via the
`setDiscordRestClient` / `setDiscordGatewayClient` test hooks — **no live Discord calls in CI**.

| ID | Path / behavior | Asserts |
|----|-----------------|---------|
| TC-CHANNEL-DISCORD-001 | Connect channel via `POST /channels/connect/credentials` | `validateCredentials` (`GET /users/@me` stub) accepts a good token, rejects a bad one with field errors. |
| TC-CHANNEL-DISCORD-002 | Outbound `test-send` | `convertOutbound` + `sendMessage` posts to `defaultChannelId`; `ExternalMessage` + `MessageChannelLink` persisted; `message.sent` emitted. |
| TC-CHANNEL-DISCORD-003 | Inbound message via gateway worker | A stubbed `MESSAGE_CREATE` → `ingest_inbound` → `message.received`; dedup on replay; bot's own messages ignored. |
| TC-CHANNEL-DISCORD-004 | Inbound reaction | Stubbed `MESSAGE_REACTION_ADD/REMOVE` → reaction processor; reaction visible on platform message. |
| TC-CHANNEL-DISCORD-005 | Interactions endpoint security | `PING` with valid Ed25519 → `{ type: 1 }`; tampered signature → 401, no tenant-scoped work; non-interaction body → `eventType: 'other'` ack; a fully-formed slash command signed by an unknown key → 401, never a deferred ack. |
| TC-CHANNEL-DISCORD-006 | Contact resolution | Unknown Discord sender creates an external contact; a stored-handle match links to an existing CRM person. |
| TC-CHANNEL-DISCORD-007 | Health check | `channelDiscordHealthCheck` returns healthy for a valid token stub, unhealthy on `401`. |
| TC-CHANNEL-DISCORD-008 | Tenant isolation | The interactions route's candidate fan-out pins the request to the channel whose public key verifies; a second tenant's Discord channel never receives another tenant's interaction. |
| TC-CHANNEL-DISCORD-009 | AI auto-reply (AI module present) | Easy message → agent draft → `deliver-outbound-message`; complex message → propose-only, no auto-send. |
| TC-CHANNEL-DISCORD-010 | AI peer absent | With `ai_assistant` disabled, the subscriber no-ops and inbound still ingests (module-decoupling). |

Unit tests (provider package, jest): `convertOutbound`/`normalizeInbound` mapping, Ed25519 verify,
gateway identify/resume/backoff state machine, bot-self-message filter.

### What ships in the implementation PR, and where the ceiling is

TC-CHANNEL-DISCORD-001..008 ship as executable Playwright specs in
`packages/channel-discord/src/modules/channel_discord/__integration__/`.

TC-009 and TC-010 assert AI auto-reply behaviour. The behaviour now exists (#4778), and the halves
that do not need a live Discord application or a live model are covered at the jest level, driving
the **real** `agent-policy` / `agent-runtime` rather than a stub:
`__tests__/ai-auto-reply.policy.integration.test.ts` (policy accepts the service principal in object
mode, still denies `features: []`, still denies a chat-mode domain agent, and the subscriber reaches
compose through the real runtime) and `subscribers/__tests__/ai-auto-reply.test.ts` (tiering, the
propose-only guarantee, the peer-absent no-op that TC-010 describes). What stays with #4665 is the
Playwright half: driving the real app against a real Discord application end to end.

Each shipped spec drives the real app; where a sub-assertion would need a live Discord
application, the spec states the ceiling and names the unit test that owns that half. The honest
split:

| ID | Runs against the app | Ceiling (stays unit-tested) |
|----|----------------------|------------------------------|
| 001 | Adapter registration (unknown provider → 404 vs `discord` → 422) and fail-closed, offline credential validation with per-field errors; a rejected connect leaves no channel | A token Discord actually accepts (`GET /users/@me`) |
| 002 | test-send refuses unauthenticated callers, malformed ids and channels the caller does not own — before any adapter resolves | The outbound payload conversion + REST post |
| 003 | A `providerKey: 'discord'` inbound message persists as a delivered inbound link inside the channel's health window | The socket state machine and replay dedup |
| 004 | Reaction add/remove round-trip on a Discord-provider message through the hub's thread mapping | Gateway reaction frame decoding |
| 005 | The signed interactions route, fail-closed on every path: unsigned, wrong key, tampered body, stale timestamp (replay guard answers before the candidate fan-out), non-JSON | The PONG success path (needs a channel whose stored key matches the signer) |
| 006 | An inbound Discord message from a known contact creates **exactly one** CRM interaction, attributed to `discord` — proving the provider adds no contact-resolution logic of its own | — |
| 007 | Health surface: tenant-scoped guards plus a fixed numeric snapshot that counts Discord traffic | `channelDiscordHealthCheck`'s own Discord probe |
| 008 | The shared interactions URL is a black box for an unverified caller: identical rejections across applications, no channel/tenant/organization identifier in the body | The positive pinning case (two live bot tokens) |

Specs 003, 004, 006 and 007's snapshot case use the hub's env-gated seeding fixture
(`OM_ENABLE_TEST_CHANNEL_SEEDING`) and skip with a stated reason when the flag is off — the same
convention the hub's own `TC-CHANNEL-API-*` and `TC-CRM-EMAIL-*` specs follow. 001, 002, 005, 008
and 007's guard cases need no fixture and run unconditionally.

---

## Risks & impact review

| Risk | Severity | Mitigation |
|------|----------|------------|
| **Gateway ≠ webhook** — the hub assumes HTTP-webhook or poll inbound; Discord pushes over a socket. | High (design) | Dedicated gateway worker calls the hub's existing `ingest_inbound` command directly — no hub change on the *transport* axis; the provider owns the socket lifecycle. `realtimePush: true` disables redundant polling. Verified live during QA of #4391: the socket state machine works. |
| **Email-shaped sender identity** — the hub requires `externalEmail` on every public message, validates outbound recipients as emails, and derives channel identity from email-shaped credential keys. Discord has none of these. | **Critical (blocker)** | Inbound Discord is non-functional and messages are lost silently (dead BullMQ job, channel still `Connected`, integration still `Healthy`) — see #4975. The silent-loss half of that symptom is a separate, independently tracked defect (#4978, `QUEUE_STRATEGY=local` swallows the failure and the inbound path logs nothing) and is **out of scope for this spec** — fixing the identity contract makes the message land, fixing #4978 makes a future failure visible. The sender-identity half is **decided and implemented** (Variant A — see § Decided — hub sender-identity contract). Three exact touch-points with file:line in § Backward compatibility. |
| **Interactions PING handshake** needs a synchronous `{ type: 1 }` response, but the shared webhook route currently 202-acks and enqueues. | Medium | See § Backward compatibility — a small additive hub touch-point (let `verifyWebhook` return a synchronous body for the handshake) OR a dedicated signed `api/post/webhooks/discord` route (like the existing dedicated `webhooks/gmail` route). Decide in pre-implementation; both are additive. |
| **Ed25519 fail-open** — the route treats a non-throwing `verifyWebhook` as verified. | High (security) | Adapter MUST throw on any verification failure and return `eventType: 'other'` for non-interaction bodies, per the documented security contract in `lib/adapter.ts`. Covered by TC-005/TC-008. |
| **Bot token leakage** | High (security) | Token stored via `integrationCredentialsService` (encrypted), never logged; health check uses it server-side only. |
| **Single-identify constraint / reconnect storms** | Medium | `concurrency: 1` per channel, exponential backoff, resume via stored session id + sequence; fatal auth codes emit `requires_reauth`. |
| **AI auto-reply hallucination / unsafe send** | Medium | Easy-vs-complex tiering, confidence threshold, text-only auto-send, mutation-approval gate for any write; auto-reply default OFF per channel. |
| **Feedback loop** (bot answering its own messages) | Medium | Worker filters events authored by the bot's own user id; ingest dedups by external message id. |
| **Rate limits** (Discord 429) | Low/Med | REST client respects `Retry-After`; outbound goes through the hub's queued delivery worker. |
| **Scale (many guilds)** | Low | Single shard first release; document Discord sharding as the scale-out path. |

---

## Backward compatibility

- **Additive only.** New package `@open-mercato/channel-discord`; new provider key `discord`; new
  ACL features `channel_discord.*`; new env vars `OM_CHANNEL_DISCORD_*`. No existing event ids,
  API routes, DI names, ACL ids, widget spot ids, or DB schema change.
- **The core message path DOES require hub changes** (corrected 2026-08-05). An earlier revision of
  this section claimed *"No hub contract change required for the core message path — outbound and
  inbound message flows reuse the existing `ChannelAdapter` methods and hub commands/events
  verbatim."* **That claim is false.** QA of #4391 against a real Discord bot on a real guild, with a
  human typing a real message, disproved it empirically (#4975): every inbound Discord message dies
  in hub validation, three retries, then a dead BullMQ job — while the channel still reports
  `Connected` and the integration reports `Healthy`. `'discord'` is indeed a valid `channelType`
  (the contract types it as `… | string`), but the hub's message path assumes an **email-shaped
  sender identity** in three concrete places, and Discord can satisfy none of them.

#### Touch-point 1 — sender identity must be an email (blocks all inbound)

- `packages/core/src/modules/messages/data/validators.ts:107` — `externalEmail: z.string().email().optional()`:
  when supplied it MUST parse as an email address.
- `packages/core/src/modules/messages/data/validators.ts:131` (inside the `composeMessageSchema`
  `superRefine`, lines 121–137) — for any non-draft message with `visibility === 'public'`, a missing
  `externalEmail` raises `externalEmail is required when visibility is public`.
- The hub's ingest command hardcodes exactly that shape:
  `packages/core/src/modules/communication_channels/commands/ingest-inbound-message.ts:351` sets
  `visibility: 'public' as const` and `:354` passes `externalEmail: contactHint?.email ?? undefined`.
- A Discord `ContactHint` has no `email` — by this spec's own design (§ API & adapter contracts,
  `resolveContact` row: *"no email/phone"*). So `messages.messages.compose` throws a `ZodError` on
  **every** inbound Discord message. Inbound is non-functional in every configuration, and outbound
  is blocked as a consequence: `deliver-outbound-message` needs a `conversationId` from a thread, and
  threads are created by inbound messages.

#### Touch-point 2 — outbound routes require an email recipient (and a subject)

- `packages/core/src/modules/communication_channels/api/post/channels/[id]/test-send/route.ts:33`
  (body schema at `:32`) — `to: z.string().email()`; `subject` is optional here (`:34`).
- `packages/core/src/modules/communication_channels/api/post/send-as-user/route.ts:20` (body schema
  at `:17`) — `to: z.array(z.string().email()).min(1)`, and `:26` requires a **non-empty** `subject`
  (`z.string().min(1).max(500)`).
- A Discord recipient is a channel/user snowflake, not an email address, and Discord messages have no
  subject. Both routes reject a structurally valid Discord send, so the admin UI's "Test send" button
  and the send-as-user path cannot reach a Discord channel at all.

#### Touch-point 3 — channel identity is inferred from email-shaped credential keys

- `packages/core/src/modules/communication_channels/commands/connect-credential-channel.ts:161-169`
  derives the channel's `externalIdentifier` as
  `credentials.username ?? credentials.email ?? credentials.fromAddress` (then lowercased when it
  contains `@`).
- The Discord credential bag is `{ botToken, applicationId, publicKey, guildId, defaultChannelId }`
  (§ Data models) — it matches none of those three keys, so a connected Discord channel persists
  `externalIdentifier = NULL`. That silently disables the cross-provider duplicate-mailbox guard and
  the per-`(tenant, user, provider, mailbox)` heal index for Discord, and it contradicts § Data
  models, which states `externalIdentifier = <bot application id or guild id>`.

#### Touch-point 4 — interactions handshake (already known before QA)

- **One hub touch-point under negotiation (interactions handshake).** The Discord Interactions PING
  requires a synchronous `{ type: 1 }` response, whereas the generic `api/post/webhook/[provider]`
  route 202-acks and enqueues. Two additive options, decided in pre-implementation review:
  1. Extend the generic route to let an adapter return a synchronous handshake body from
     `verifyWebhook` (additive optional field; existing providers unaffected), **or**
  2. Ship a dedicated signed `api/post/webhooks/discord/route.ts` in the hub (precedent: the
     existing dedicated `api/post/webhooks/gmail/route.ts`), keeping the generic route untouched.
  Both are additive and break no existing provider. The spec recommends option 2 (least blast radius;
  follows the Gmail precedent), to be confirmed with the hub owner per the AGENTS.md "Ask First /
  contract surface" rule.
- Follows the deprecation protocol only if option 1 is chosen and any shared type gains a field —
  it would be additive/optional, no removal.

#### How the contradiction survived review — a lesson for non-email providers

Both halves of the truth were already written **in this document**, one section apart, and nobody
joined them:

- § API & adapter contracts, `resolveContact` row: *"maps Discord user id + username/global\_name to a
  `ContactHint` (**no email/phone**; sets `displayName`, `externalProfileUrl`, …)"* — restated in
  § Data models: *"Discord senders have no email/phone"*. The provider code says the same thing
  (`packages/channel-discord/src/modules/channel_discord/lib/normalize-inbound.ts:31`, on the #4391
  branch).
- § Backward compatibility: *"reuse the existing hub commands/events **verbatim**"*.

The second statement is only true if the hub is identity-agnostic. Nobody checked whether it is,
because the hub's own providers — `channel-gmail`, `channel-imap` — are both email providers, so the
email assumption had never been exercised as an assumption. It was invisible precisely because it had
always held. The design review reasoned about the *transport* difference (socket vs webhook, which
this spec handled correctly and which QA confirmed works live) and never about the *identity*
difference.

CI did not catch it either, and for a related reason: `TC-CHANNEL-DISCORD-003` passes while feeding
the hub fixture data the adapter can never produce — a seeded `externalIdentifier` of
`discord-003-<stamp>@test-seed.local`, a `to:` of the same invented address, and a `subject`. It
drives the `test-seed` fixture endpoint, so `normalizeInboundDiscordMessage` never executes on that
path. A test that satisfies a contract with data the production code cannot generate proves nothing
about the contract.

**Rules this yields for every future non-email provider** (Discord, Slack, Telegram, SMS, in-app
chat, WhatsApp Business ids):

1. A "no hub change required" claim MUST be verified against the hub's *validators*, not only its
   method signatures. A `ChannelAdapter` method that compiles can still be rejected at runtime by a
   Zod refinement two commands downstream.
2. Whenever a spec states a provider **lacks** a platform field (no email, no phone, no subject, no
   threading), the same spec MUST trace every hub surface that requires that field and record the
   result. The absence statement and the compatibility statement belong in the same review.
3. Integration tests for a provider MUST drive the provider's own normalize/convert code path with
   provider-shaped data. Seeded fixtures that inject platform-shaped values (an email for a channel
   that has no emails) hide exactly the contract this class of provider breaks.

This is why the second Discord provider onto the hub will be cheap: the identity contract, once
generalized, is generalized for everyone.

---

## Decided — hub sender-identity contract

> **DECISION — 2026-08-13: Variant A.** Taken by @pkarw as the hub owner, recorded on
> [#4975](https://github.com/open-mercato/open-mercato/issues/4975#issuecomment-5280211475).
> This section is no longer open; the variant analysis below is retained as the reasoning behind it.
>
> | Variant | Outcome |
> |---|---|
> | **A** — conditional, fail-closed `externalEmail` requirement | ✅ **Chosen and implemented.** |
> | **A+** — A plus a CRM-side identity key | 🔓 Still available as a later extension. Additive, not foreclosed, and unchanged in cost by shipping A first. |
> | **B** — generic `externalIdentity` on `messages` | 🔓 Still available as a later generalization, on the same terms the § Recommendation states. |
> | **C** — synthetic `<discordUserId>@discord.invalid` | ❌ Declined. Unchanged. |
>
> **What shipped with A** (`packages/core`, no migration, no persisted column):
>
> - `messages/data/validators.ts` — `composeMessageSchema` gains an optional `sourceChannelType`, and
>   the `superRefine` requires `externalEmail` for a public message only when that type is email-typed.
>   The recognized non-email types live in `messages/lib/channel-sender-identity.ts`; anything else —
>   unknown, empty or absent — keeps the pre-decision behaviour, so the relaxation can never be
>   reached by a typo or by a caller asserting an unfamiliar type.
> - **Both** call sites, per the § Variant A caveat that A without the second one unblocks the inbound
>   leg only: `communication_channels/commands/ingest-inbound-message.ts` forwards the channel type it
>   already has, and `messages/api/route.ts` (`POST /api/messages`) resolves it **server-side** from
>   the referenced conversation or parent message through the
>   `communicationChannelsResolveChannelType` DI facade. A client-supplied `sourceChannelType` is
>   discarded — accepting it would make the waiver self-service.
> - `messages/api/openapi.ts` publishes `composeMessageRequestSchema`, the compose contract minus the
>   server-resolved field, so the documented request shape matches what the route reads.
> - The test-seed harness gained a non-email stub provider and an `ingest-inbound` action that runs
>   the **real** ingest command, replacing the raw-SQL bypass that let an inbound test pass while
>   compose rejected every real message. `TC-CHANNEL-IDENTITY-001` is the acceptance test: a provider
>   with no sender email completes an inbound compose end to end.
>
> **Classification: additive / non-breaking.** The change widens the accepted inputs; nothing is
> removed, renamed or narrowed, so `BACKWARD_COMPATIBILITY.md`'s deprecation protocol is not
> triggered. A caller that supplies no channel type sees byte-identical behaviour.
>
> **Still open, and not addressed by this decision:** #4976 (outbound endpoints hard-wire an email
> recipient) and #4977 (channel identity inferred from `username ?? email ?? fromAddress`). They are
> unsolved by *every* variant — see § Shared prerequisite — so two-way Discord is still incomplete
> until they land.

Decision owner: the `communication_channels` / `messages` hub owner (root `AGENTS.md` → "Ask First:
changing public contracts"). Every variant below touches `packages/core`, so this spec doubles as the
required "Migration & Backward Compatibility" reference per `BACKWARD_COMPATIBILITY.md` § Deprecation
Protocol, step 5.

The options were **A** (relax the refinement — the minimal unblocker), **A+** (A plus a CRM-side
identity key), **B** (a generic `externalIdentity` persisted on `messages`) and the rejected **C**
(synthetic email). § Recommendation records why A+ superseded the earlier Variant B recommendation,
and why A was nonetheless landable on its own.

### Variant A — relax the hub's email requirement (conditional validation)

Make the sender-identity requirement conditional instead of unconditional: in
`composeMessageSchema`'s `superRefine` (`messages/data/validators.ts:129-137`), require
`externalEmail` for a `visibility: 'public'` message **only when the originating channel is
email-typed** (or, equivalently, only when the caller supplies no other sender identity), and let the
hub's ingest command pass the channel type through. `externalEmail` keeps its `z.string().email()`
shape; no new field, no new column.

| Aspect | Assessment |
|---|---|
| Contract surfaces touched | Cat. 1 (`data/validators.ts` — FROZEN convention file, rule: *"MUST NOT remove or narrow existing schemas"*), Cat. 3 (function signatures — if the compose input gains an optional channel-type argument) |
| Classification | **Additive / non-breaking.** The change *widens* the set of accepted inputs; nothing is removed, renamed, or narrowed. Per the Allowed-vs-Breaking quick reference, "add optional field" and relaxation are OK for convention files and function params. |
| Deprecation protocol required? | **No.** Nothing is removed or renamed, so steps 1–4 do not apply; step 5 (spec reference) is satisfied by this section. |
| Blast radius | Small — one refinement plus one call site. No DB migration, no API response change, no new field for consumers to learn. |
| Residual risk | Behavioral relaxation: a caller that today relies on the hub rejecting a public message without an email would stop seeing that error for non-email channels. Mitigate by keying the relaxation on channel type (fail-closed: unknown/absent channel type keeps requiring the email), never on "field simply absent". |
| Leaves unsolved | Touch-points 2 and 3 (see the shared prerequisite below) — Variant A only unblocks inbound. Plus the non-ingest compose paths below, and CRM person matching (§ Variant A+). |

**What the fail-closed rule costs — the compose paths that stay blocked.** `composeMessageSchema` is
not reached only through `ingest-inbound-message`: it is the body schema of the public compose route
(`packages/core/src/modules/messages/api/route.ts:448`, `composeMessageSchema.parse(body)`) and is
published in the OpenAPI surface (`packages/core/src/modules/messages/api/openapi.ts:267`). Keying
the relaxation on a channel type that only the ingest command passes through means every *other*
public compose still fails with the same `ZodError` — an operator composing a new public message on a
Discord conversation from the backoffice, or any integration calling `POST /api/messages`. **Variant A
as sketched unblocks the inbound leg only; it does not by itself deliver a working two-way Discord
flow from the product UI.** Closing that gap means threading the same channel-type (or conversation
id → channel type) resolution into the compose route, which is a second, larger call site than the
"one refinement plus one call site" the table above prices — decide it together with the variant, not
after.

The reassuring half, true under every variant: **the reply path is unaffected.**
`replyMessageSchema` (`packages/core/src/modules/messages/data/validators.ts:248-266`) never requires
`externalEmail`, and `replyMessageCommand` (`commands/messages.ts:741-744`) copies `visibility` and
`externalEmail` from the original message, so an agent replying into a Discord thread keeps working
with a `NULL` identity once the inbound message exists.

### Variant A+ — Variant A plus a CRM-side identity key (recommended)

Variant A, plus the one change that actually makes a Discord sender resolvable to a CRM person:
a lookup key for non-email identities on `customers:customer_entity` and the corresponding branch in
`buildPersonLookupFilter`
(`packages/core/src/modules/communication_channels/lib/contact-resolver.ts:145-149`), which today can
only filter by `primary_email` or `primary_phone`. **No `messages`-side column**: the provider-native
identity is already persisted (see Variant B below), and `resolveContact` already receives the raw
snowflake as `ContactResolverInput.senderIdentifier` (`contact-resolver.ts:22`, passed at
`ingest-inbound-message.ts:292-317`) — the missing half is exclusively on the CRM side.

Two shapes are available for that key, and the choice is the CRM owner's, not this spec's:

- **A custom field on `customer_entity`** (e.g. `discord_user_id`) — no migration at all, and the
  query engine already filters custom fields with the `cf:<key>` selector convention
  (`packages/shared/src/lib/query/types.ts:12`, `:93`), so `buildPersonLookupFilter` gains a branch
  returning `{ 'cf:discord_user_id': value, kind: 'person' }`. Cheapest, per-provider.
- **A generic `(kind, value)` identity record** on the person — one migration, provider-neutral,
  and the shape the second and third non-email provider will want. Preferable if more than one
  non-email channel is on the roadmap.

Either way the hub side is identical: `resolveContact` passes the identity it already has, and the
filter learns one more way to match.

| Aspect | Assessment |
|---|---|
| Contract surfaces touched | Variant A's surfaces, plus Cat. 8 (DB schema — a new nullable column or a custom-field definition on `customer_entity`) and the `buildPersonLookupFilter` branch (module-internal, not a contract surface) |
| Classification | **Additive / non-breaking.** A new nullable/defaulted column is allowed under the ADDITIVE-ONLY DB rules; the filter gains a branch, no existing branch changes. |
| Deprecation protocol required? | **No.** Nothing is removed or renamed. |
| Blast radius | Small–medium — Variant A's refinement and call sites, one CRM migration + snapshot, one filter branch. No change to the `messages` contract, no response-shape change, no new field for hub consumers to learn. |
| Residual risk | The CRM key has to be populated for a match to happen (manual entry or an onboarding flow); until it is, resolution falls back to display name exactly as today — i.e. no regression, just an unrealized upside. |
| Leaves unsolved | Touch-points 2 and 3 (shared prerequisite). Non-ingest compose paths (above) unless the channel-type threading covers them. |

### Variant B — add a generic sender identity (`externalIdentity`)

Introduce an optional, provider-neutral identity alongside `externalEmail`:
`externalIdentity: { kind: 'email' | 'discord' | 'slack' | …, value: string, displayName?: string }`.
`composeMessageSchema` accepts `externalEmail` **or** `externalIdentity`; the refinement requires
*one of the two* for a public message. `resolveContact`'s `ContactHint` gains the same optional
shape, and `messages` persists it (new nullable column / JSONB, e.g. `external_identity`).

**Corrected costing — two claims in the original write-up of this variant do not hold.** Both were
checked against the hub as it stands on `develop`:

1. **The provider-native identity is already persisted; the new column duplicates it.**
   `ExternalMessage.senderIdentifier`
   (`packages/core/src/modules/communication_channels/data/entities.ts:243-244`,
   `sender_identifier text NULL`) stores the Discord snowflake for every inbound channel message —
   the row is created unconditionally on every ingest with `senderIdentifier: m.senderIdentifier`
   (`ingest-inbound-message.ts:426-438`) — and
   `MessageChannelLink` (`:269` onwards) joins it 1:1 to the platform `Message`: `message_id` carries
   the unique index `message_channel_links_message_uq` (`:268`), `external_message_id` is written on
   every inbound ingest (`ingest-inbound-message.ts:450-465`), and the link row already carries
   `provider_key` and `channel_type`. *"Which non-email identity sent this platform message, on which
   provider"* is therefore answerable today with a join and no migration.
2. **A `messages`-side column does not unlock CRM matching.** Contact resolution runs *before*
   compose — `resolveContact` at step (4) (`ingest-inbound-message.ts:292-317`), compose at step (5)
   (`:387`) — and it already receives the raw snowflake (`ContactResolverInput.senderIdentifier`,
   `contact-resolver.ts:22`). What blocks the match is the CRM side: `buildPersonLookupFilter`
   (`contact-resolver.ts:145-149`) can only filter `customers:customer_entity` by `primary_email` or
   `primary_phone`, and no field on a CRM person can hold a Discord id to match against. Adding
   `messages.external_identity` leaves that filter returning `null` for every Discord sender, so
   resolution still falls back to `displayName` — **the exact outcome this variant was justified as
   fixing.** That unlock is Variant A+, and it is independent of where the identity is stored.

What Variant B does buy, honestly stated: a *hub-level* identity slot on `messages` itself, usable by
a caller that has no `MessageChannelLink` to join through — the non-ingest compose paths named under
Variant A. That is a real but narrow benefit, and it is the only one left after the two corrections
above.

| Aspect | Assessment |
|---|---|
| Contract surfaces touched | Cat. 1 (`data/validators.ts` — **three sites, not one**: `composeMessageSchema:107`, `updateDraftSchema:186`, and the inbox filter in `listMessagesSchema:220`; without the parallel `externalIdentity` treatment a non-email sender's message cannot be draft-edited or filtered by sender), Cat. 2 (public types — `ContactHint`, compose input), Cat. 7 (API routes — new optional request/response field), Cat. 8 (DB schema — new nullable column) |
| Classification | **Additive / non-breaking**, provided `externalEmail` stays supported: optional-field additions are explicitly allowed on convention files, type interfaces, and API request/response schemas; a new nullable column with a default is allowed under ADDITIVE-ONLY DB rules. |
| Deprecation protocol required? | **Not for the addition itself.** It becomes required the moment anyone wants to *retire* `externalEmail` in favor of `externalIdentity` — that is a removal from a FROZEN/STABLE surface and needs the full protocol: `@deprecated` JSDoc, a dual-accept bridge for ≥1 minor version, an `UPGRADE_NOTES.md` entry, and a spec reference. This spec recommends never scheduling that removal: `externalEmail` should remain the email-typed shorthand indefinitely. |
| Blast radius | Medium — three validator schemas, a public type, a migration + snapshot, response serialization, and CRM contact-resolution code paths. **Plus a third identity store for the same value** (`messages.external_identity` alongside `external_messages.sender_identifier`), which has to be kept consistent with the one the ingest path already writes. |
| Residual risk | Two identity fields can drift (a message carrying both, disagreeing). Mitigate with a refinement that rejects a mismatched pair, and by having the hub derive `externalIdentity = { kind: 'email', value: externalEmail }` when only the legacy field is supplied. **Second drift axis introduced by the correction above**: `messages.external_identity` and the linked `external_messages.sender_identifier` can disagree for the same message, with no single source of truth. |
| Leaves unsolved | **CRM person matching for non-email senders** — `buildPersonLookupFilter` still returns `null` for a Discord sender, so `matchedPersonId` stays unresolved and resolution falls back to display name. Closing that needs the CRM-side key of Variant A+, which this variant does not include. Also still needs the shared prerequisite for touch-points 2 and 3. |

### Rejected — Variant C: synthesize `<discordUserId>@discord.invalid`

Satisfies the validator without changing any contract, and is the wrong fix: it writes fabricated
email addresses into CRM data, breaks contact resolution and de-duplication for every non-email
provider, and would need a data cleanup the day a real identity contract lands. Recorded here so the
option is visibly declined rather than silently re-proposed.

### Shared prerequisite (needed under any variant)

Touch-points 2 and 3 are independent of the identity-storage choice and must be decided together
with it. Both are already filed as blockers from the same QA pass and are **deferred by this spec,
not solved by it**: touch-point 2 is #4976, touch-point 3 is #4977.

- **Recipient/subject validation** (`test-send/route.ts:33`, `send-as-user/route.ts:20` and `:26`) —
  tracked as **#4976**: widen `to` to accept a provider-native recipient (union of email and
  adapter-validated identifier) and make `subject` conditional on the channel's capabilities.
  Widening a request schema is **additive** under Cat. 7 (only *removing* response fields or renaming
  routes is breaking).
  **Security control that MUST survive the widening**: `send-as-user/route.ts:26` is
  `z.string().min(1).max(500).regex(/^[^\r\n]*$/)` — the regex (documented at `:23-25`, and applied
  to `inReplyTo` / `references` too) rejects CR/LF so a caller cannot inject extra email headers, e.g.
  a hidden `Bcc`, through the subject or threading fields. Making `subject` optional or conditional
  MUST keep that guard on every code path where a subject *is* supplied; dropping the regex while
  relaxing the schema would trade an ingest bug for a header-injection hole.
  **Status (2026-08-13): half landed.** `test-send/route.ts` now validates the recipient through
  `capabilities.recipientFormat` (`'email'` by default, so Gmail/IMAP are byte-identical;
  `'provider-native'` for id-addressed providers), so the documented outbound smoke test is reachable
  for Discord. `send-as-user` is **not** fixed and cannot be fixed here: `lib/send-as-user.ts:134`
  feeds `input.to[0]` into `externalEmail` on `messages.messages.compose`, i.e. straight into the
  touch-point 1 validator this section is still deciding. Widening its schema alone would move the
  422 one layer deeper. It lands with the variant decision — as does the conditional `subject`.
  **Status (2026-08-26): `test-send` complete.** The 2026-08-13 change fixed the recipient's
  *format* but left its *presence* mandatory, so the smoke test § 6 actually documents — the one
  with no recipient, posting to `defaultChannelId` — still had no request shape. `to` is now
  optional at the schema, and `validateOutboundRecipient` accepts an omitted recipient when (and
  only when) the adapter declares `'provider-native'`, because those adapters carry their own
  configured target. The email path is unchanged: no email adapter has a default address, so
  `'email'` — the format every existing provider resolves to — still requires a recipient.
  Omission means `undefined` alone; `null` and `''` remain 422 on every provider, so a caller who
  meant to name a recipient and got it wrong is never silently rerouted to the provider default.
  The CR/LF and allowlist guards are untouched — an absent value carries no payload to filter.
  `send-as-user` remains out, now tracked separately as **#5528**.
- **Channel identity** (`connect-credential-channel.ts:161-169`) — tracked as **#4977** (the measured
  consequence: reconnecting Discord creates a duplicate channel, because the duplicate-mailbox guard
  stops applying once `externalIdentifier` is `NULL`): let the adapter supply its own
  channel identifier (an optional `ChannelAdapter` method, e.g. `resolveChannelIdentity(credentials)`,
  falling back to today's `username ?? email ?? fromAddress` when absent). An **optional** method on
  a public interface is additive under Cat. 2; the fallback keeps every existing provider byte-identical.

### Recommendation

**Ship Variant A+ (Variant A plus the CRM-side identity key), plus the shared prerequisite. This
reverses the earlier recommendation of Variant B, which rested on a cost/benefit that does not
survive contact with the code.**

The earlier argument for Variant B was that Variant A "leaves the platform with no way to *store* who
a non-email sender is". That is false: `external_messages.sender_identifier` stores exactly that for
every inbound channel message and `message_channel_links` joins it 1:1 to the platform message. The
second half of the argument — that Variant B gives CRM resolution "a real key for non-email senders"
— is also false: resolution is blocked in `buildPersonLookupFilter`, on the CRM side, and a column on
`messages` does not touch it. With both halves removed, Variant B pays a migration, three validator
schemas, a public type, response serialization and a duplicated identity store for one narrow
benefit (an identity slot for compose paths that have no channel link), while **Variant A+ buys the
CRM unlock that was Variant B's headline justification, for a smaller change and no duplicated
storage.**

Sequencing for the hub owner:

1. **Variant A** is the unblocker for #4975 and can land alone — inbound Discord messages start
   landing. Its honest limit is the compose paths named above: the inbound leg works, the operator's
   compose-on-a-Discord-conversation path does not until the channel-type resolution is threaded into
   `POST /api/messages` too.
2. **The CRM-side key (A+)** is what makes those messages resolve to a person instead of a display
   name. It is independent of the identity-storage decision and is worth landing in the same release
   — otherwise Discord contacts stay display-name-only, which was the failure mode the whole variant
   comparison was trying to avoid.
3. **Variant B stays on the table as a later generalization, not a prerequisite.** The moment a
   provider needs a sender identity on a message that has *no* `MessageChannelLink` — a caller-supplied
   external sender through `POST /api/messages` — the `messages`-side field earns its cost. Until
   then it duplicates storage the hub already has. Nothing in Variant A+ blocks adding it later:
   both are additive, and the deprecation protocol is not triggered by either.

The generalization worry that motivated Variant B ("Slack/Telegram/SMS would each re-open this
decision") is answered by A+ rather than by B: the channel-type-keyed refinement and the CRM identity
key are provider-neutral, so the second non-email provider inherits both.

### Test consequence (mandatory under any variant)

`TC-CHANNEL-DISCORD-003` MUST stop seeding an invented email (`…@test-seed.local`) and MUST drive
`normalizeInboundDiscordMessage` on the real path, or the defect regresses immediately with a green
suite. Add coverage for a public message composed with **no** email (accepted for a Discord channel,
still rejected for an email channel), for `test-send` to a Discord channel id, and for a connected
Discord channel persisting a non-null `externalIdentifier`.

Under the recommended Variant A+, one more case is required, because it is the only proof the CRM
unlock actually happened: with the non-email identity key populated on a CRM person, an inbound
Discord message from that sender MUST resolve `matchedPersonId` to that person (and MUST still fall
back to `displayName`, without failing ingest, when no person carries the key).

Two notes for whoever picks this up. First, `TC-CHANNEL-DISCORD-003` does not exist on `develop` — it
lives on the #4391 branch together with the rest of the provider suite (tracked by #4665), so a reader
looking for it on `develop` will find it only in this spec's own test table (§ Integration test
coverage). Second, the acceptance criterion that actually protects the hub is broader than the
TC-003 rewrite and belongs on the implementation PR: **a test asserting that a non-email provider can
complete an inbound compose end to end.** The absence of exactly that assertion is what let the
original "no hub contract change required" claim ship (§ How the contradiction survived review,
rule 3), and no variant should be considered done without it.

---

## Final compliance report

- **Module boundaries**: Discord logic lives entirely in `packages/channel-discord/`; no Discord
  code in `packages/core`. Consumer modules reach Discord only through generic hub commands/events.
  ✅ (matches the `channel-gmail` / `channel-imap` rule).
- **Optional coupling**: the AI auto-reply subscriber treats `ai_assistant` as an optional peer via
  `tryResolve` and no-ops when absent; the upstream hub never imports the provider. ✅
- **Tenant isolation**: inbound is pinned to the channel whose credentials verify; gateway worker
  carries the channel's tenant scope into the ingest command; no cross-tenant data exposure. ✅
- **Security**: Ed25519 fail-closed; encrypted bot token; no credential logging; auto-send is
  text-only and mutation-gated. ✅
- **RBAC**: `channel_discord.view` / `.configure` / `.ai_auto_reply.run` added to `acl.ts` and
  `setup.ts` `defaultRoleFeatures`; sync via `yarn mercato auth sync-role-acls`. ✅
- **i18n / DS**: provider detail UI uses `useT` + locale files and DS tokens (no hardcoded strings
  or status colors). ✅
- **Generation**: run `yarn generate` after adding module files (DI/setup/acl/integration/worker/
  subscriber). ✅
- **Tests**: provider unit tests plus executable integration specs TC-CHANNEL-DISCORD-001..008,
  shipped with the implementation PR; no live Discord calls in CI. TC-009/TC-010 land with the AI
  auto-reply feature they assert on (issue #4778) — jest-level against the real policy/runtime here,
  Playwright-level with #4665. ✅ (see § What ships in the implementation PR)
  ⚠️ TC-CHANNEL-DISCORD-003 currently passes on fixture data the adapter cannot produce — it MUST be
  rewritten to drive `normalizeInboundDiscordMessage` (§ Decided → Test consequence). The hub-side
  cause is fixed — the seed endpoint no longer bypasses compose — so that rewrite is now unblocked.
- **Hub contract**: ✅ **sender identity decided and implemented** (Variant A, 2026-08-13, merged as
  #5252) — see § Decided — hub sender-identity contract. Outbound recipients follow in #5261, which
  validates them per the adapter's declared `capabilities.recipientFormat`. ⚠️ Still open: #5528 (the
  `send-as-user` facade and the new-conversation composer) and #4977 (channel identity inferred from
  `username ?? email ?? fromAddress`).

---

## Changelog

### 2026-08-25 — Arming an auto-reply channel is authorized, and a dormant one says so (re-review of PR #4391)

- **§ AI bot wiring → A configuration path.** The settings route checked that the chosen agent was
  *shaped* right — object-mode, so `runAiAgentObject` would take it — and stopped there. The runtime
  asks a second question: `checkAgentPolicy` runs the agent's `requiredFeatures` against the
  principal from `lib/ai-service-principal.ts`, which carries one grant unless the tenant created a
  channel-bot user with a wider role. An operator could therefore pick an agent from another module,
  the PUT would succeed, the UI would read "Auto-reply on", and every inbound message would be denied
  inside the subscriber. The route now resolves that same principal and refuses the save, naming the
  missing grants; the comparison goes through the platform's `authorizeFeatures`, one feature at a
  time, so wildcard grants resolve exactly as the runtime resolves them. The picker labels an agent
  the principal cannot invoke instead of offering it silently.
- **New § A visible failure mode.** A save-time check goes stale the moment a role is edited, and
  the subscriber degrades every failure to a no-op by design, so "armed but answering nothing" had
  to become observable rather than merely rarer. Each failure now writes
  `channelState.aiAutoReplyLastError` (through `lib/channel-state-store.ts`, keeping the single-writer
  contract on the arming keys intact) and the next successful attempt clears it. The channel row's
  own `lastError` is deliberately untouched: the hub owns it for delivery and polling and clears it
  on a successful poll, so borrowing it would let the two failure kinds erase each other.
- **§ New provider-owned surface.** Lists the settings route, which the table had never carried, plus
  the new `GET /api/channel_discord/ai-auto-reply/channels`. The integration panel was listing
  channels and then calling the per-channel settings route once per channel — 41 requests and 40
  agent-registry loads to render 40 booleans. One query replaces them, and a test asserts the route
  never builds the agent directory so the N+1 cannot creep back.
- Tests: a route-level arming matrix (refused agent, provider agent under the bare service principal,
  foreign agent once granted, wildcard grant, disarm, masked 404, absent peer, wrong shape), the
  feature-comparison matrix against the real `authorizeFeatures`, the marker's write/clear/dedup/
  truncation/scope rules, and subscriber coverage proving a marker write can never escalate a
  degraded no-op into a thrown handler.

### 2026-08-24 — AI auto-reply implemented and re-scoped in (issue #4778)

Reverses the 2026-08-01 de-scope. § AI bot wiring describes shipped behaviour again, and the
provider advertises AI auto-reply in its module and integration descriptions with the `ai` tag
restored — in the same change that makes the feature real, not before it.

- **A production agent.** `channel_discord/ai-agents.ts` declares `channel_discord.auto_reply`:
  object-mode with a declared `{ reply, summary, confidence, requiresHuman }` output schema,
  `readOnly: true`, `mutationPolicy: 'read-only'`, `allowedTools: []`, and
  `requiredFeatures: ['channel_discord.ai_auto_reply.run']`. Object mode is what makes the
  propose-only guarantee mechanical: `runAiAgentObject` discards the resolved tool map before
  calling `generateObject`, so no tool — privileged or otherwise — is reachable from an inbound
  Discord message.
- **A service principal with real features.** `lib/ai-service-principal.ts` replaces `features: []`.
  It resolves the tenant's channel-bot user and loads its real ACL through `rbacService.loadAcl`,
  falling back to one code-declared, non-data grant when a tenant has no such user. `isSuperAdmin`
  is clamped to false on both paths, and the clamp is logged when a bot user turns out to be one.
- **A configuration path.** `GET`/`PUT /api/channel_discord/channels/{id}/ai-auto-reply` behind a
  `CrudForm` page at `/backend/channel_discord/channels/{id}/ai-auto-reply`, reached from an
  AI auto-reply panel on the Discord integration's detail page. The write is zod-validated,
  tenant-scoped, mutation-guarded, optimistic-locked on the channel's `updated_at`, and persisted
  through `channel_discord.channel.update_ai_auto_reply` — which merges rather than replaces
  `channelState`, so a settings save cannot clobber the gateway's resume cursor. Enabling is
  refused when the AI peer is absent, when the chosen agent is one the runtime would reject on
  shape, and when the auto-reply principal does not hold that agent's `requiredFeatures` — the
  three questions `runAiAgentObject` → `checkAgentPolicy` asks at run time, asked at save time
  against the same principal and through the platform's own `authorizeFeatures`, so wildcard role
  grants resolve identically. The picker labels an agent the principal cannot invoke with the
  grants it is missing rather than silently offering it.
- **A visible failure mode.** Every auto-reply failure still degrades to a no-op — a broken model
  must never become a send — but the reason is now parked on the channel
  (`channelState.aiAutoReplyLastError`, written only through `lib/channel-state-store.ts`) and
  cleared by the next attempt that gets through. A save-time check cannot close this on its own,
  because a role edited after the channel was armed makes that verdict stale; without the marker,
  an armed channel that answers nothing looks identical to a healthy one. The settings page shows
  it as a banner and the integration panel flips the channel's tag from "Auto-reply on" to
  "Auto-reply failing".
- **A proposal surface for the `complex` tier.** `message-types.ts` registers
  `channel_discord.ai_reply_proposal` with approve/dismiss `defaultActions`, which is also what
  allowlists the two commands in `commands/ai-reply-proposal.ts` against the messages module's
  confused-deputy guard. Approving composes the public reply attributed to the approving operator;
  with no assignee to address, the proposal is stored as a draft and the miss is logged.
- **Optional peer declared.** `@open-mercato/ai-assistant` is now in `peerDependencies` with
  `peerDependenciesMeta.optional: true`. The runtime coupling stays soft — a dynamic import behind
  a DI presence check — and the type import is erased at build.
- **Tests.** `__tests__/ai-auto-reply.policy.integration.test.ts` drives the REAL `agent-policy` and
  `agent-runtime` (only the model call is stubbed, through the runtime's own `generateObject`
  escape hatch), asserting that the shipped agent passes in object mode, that `features: []` is
  still denied, that a chat-mode domain agent is still denied, and that the subscriber reaches
  compose through the real runtime. The dormancy contract that asserted nothing could arm the
  subscriber is replaced by an armed contract asserting the inverse properties that now matter:
  one writer for the arming keys, the write going through the command bus, and no `features: []`
  regression. Plus unit coverage for the settings command (merge, clear-on-disable, 409 on a stale
  save) and the approval commands.
- **Capabilities untouched.** No `ChannelCapabilities` flag flips back to `true`: auto-reply is a
  hub subscriber, not an adapter capability, and declaring a flag for it would route adapter work
  here that the adapter does not implement. Documented in `lib/capabilities.ts`.
- Live end-to-end validation against a real Discord application remains with #4665's
  TC-CHANNEL-DISCORD-009/010.

### 2026-08-24 — Interactions dispatch implemented; `interactiveComponents` flips to `true` (issue #4663)

- **New § Interactions dispatch.** The endpoint no longer stops at a deferred
  acknowledgement. A verified `APPLICATION_COMMAND` / `MESSAGE_COMPONENT` /
  `MODAL_SUBMIT` is handed to `workers/discord-interactions.ts`, which normalizes
  it into the hub's existing `communication-channels-inbound` queue as a
  synthesized Discord message and then replaces the "thinking…" placeholder over
  Discord's interaction-webhook endpoints. The hub contract is untouched: the
  interaction reaches the hub through `adapter.normalizeInbound`, exactly like a
  message typed in the channel.
- **§ Adapter method map → `capabilities`.** `interactiveComponents` moves from
  the deliberately-`false` list to the shipped-`true` list, in the same change
  that makes components round-trip, guarded by a parity test that drives dispatch
  → hub job → follow-up rather than asserting the flag against itself.
- **Autocomplete and unhandled types are answered honestly.** Autocomplete gets
  the empty choice list Discord requires (it rejects a deferred ack there);
  anything else, and any payload missing the follow-up token / channel / invoking
  user, gets a visible ephemeral reply. The endpoint never returns a deferred ack
  it cannot redeem.
- **§ 3 Set the Interactions endpoint.** The URL was still the hub's generic
  `/api/communication_channels/webhook/discord`; the shipped route is
  `/api/channel_discord/interactions`, and operators who copied the old value
  would have failed the PING handshake.
- **§ New provider-owned surface.** The speculative
  `commands/register-slash-commands.ts` row is replaced by the shipped
  `cli.ts → register-slash-commands` command, and the four new interaction files
  are listed.

### 2026-08-24 — Spec re-aligned with the shipped implementation (review of PR #4391)

- **§ Adapter method map → `capabilities`.** The row still advertised the pre-implementation
  intent — `threading: true`, `fileSharing: true` (≤8 MB default tier) and
  `interactiveComponents: true` — while the shipped `lib/capabilities.ts` declares all three
  `false`. The row now carries the shipped values, split into what is backed by an adapter
  method and what is deliberately declared `false` with its reason, and names the parity test
  that pins them. A spec that over-promises a capability is worse than one that says nothing:
  the hub routes work on these flags, so a `true` nothing implements is work silently dropped.
- **§ Subscriber `metadata.id`.** The spec gave `'discord-ai-auto-reply'`; the code ships
  `'channel_discord:ai-auto-reply'`. Subscriber ids drive dedup, so an id copied from the spec
  into a later change would have been read as a different subscriber and re-delivered events
  already handled. The spec now carries the shipped id and states why it is a contract.
- **`threading` was demoted, not merely re-documented.** It shipped as `true` on the strength
  of `convertOutbound` emitting `message_reference` from `channelMetadata.replyToExternalId` —
  but no hub producer writes that key into *outbound* metadata (`send-as-user.ts` and
  `deliver-outbound-message.ts` write the email-shaped `inReplyTo` / `references`), and
  `replyToExternalId` exists only on the inbound `NormalizedInboundMessage` shape, so the
  branch was unreachable in production. Confirmed against a live bot in #5541. The conversion
  is kept so the flag flips back with the hub-side producer and nothing else.

### 2026-08-13 — Hub sender-identity contract decided: Variant A (issue #4975)

- **§ Open decision — hub sender-identity contract is now § Decided.** @pkarw chose **Variant A**:
  require `externalEmail` on a public message only when the originating channel is email-typed, and
  fail closed when the channel type is unknown or absent. A+ and B stay available as later, purely
  additive extensions; C (synthetic `@discord.invalid`) stays declined. The variant analysis is
  retained unchanged as the reasoning that produced the decision.
- Recorded what shipped with A: the optional `sourceChannelType` input and the conditional refinement
  in `messages/data/validators.ts`, the recognized non-email channel types in
  `messages/lib/channel-sender-identity.ts`, and channel-type resolution at **both** call sites —
  `ingest-inbound-message.ts` forwarding the type it already has, and `POST /api/messages` resolving
  it server-side via the `communicationChannelsResolveChannelType` DI facade. Threading the second
  call site was mandatory: § Variant A's own caveat is that A without it unblocks the inbound leg
  only, leaving an operator composing on a Discord conversation still rejected.
- Noted that a client-supplied `sourceChannelType` is discarded by the route, and that
  `messages/api/openapi.ts` therefore publishes `composeMessageRequestSchema` — the compose contract
  minus the server-resolved field — so the documented request shape matches what the route reads.
- Recorded the fix for the reason CI stayed green through three live defects: the test-seed
  `emit-inbound` action composed nothing (it inserted the `messages` row with raw SQL), so no
  validator ever ran on that path. A non-email stub provider and a new `ingest-inbound` action that
  drives the real `ingest_inbound_message` command replace that bypass, and
  **`TC-CHANNEL-IDENTITY-001`** is the acceptance test the § Test consequence section asked for: a
  provider whose senders have no email address completes an inbound compose end to end, on `develop`,
  where no provider-side fixture can bypass it.
- Restated the limits: this decision resolves touch-point 1 only. #4976 and #4977 are unsolved by
  every variant and still block a complete two-way Discord flow, and the A+ CRM-side identity key
  (which is what makes a Discord sender resolve to a person rather than a display name) remains
  deliberately deferred.
  
### 2026-08-26 — Touch-point 2: the `test-send` half completed (#4976)

- The smoke test § 6 "Test it" documents — `POST /channels/{id}/test-send` with **no** recipient,
  so the bot posts to `defaultChannelId` — now has a request shape. The 2026-08-13 change fixed
  the recipient's format but left `to` mandatory, so the credential field the connect dialog asks
  for was still read by no product path unless an inbound thread already existed. `to` is now
  `.optional()` and `validateOutboundRecipient` accepts an omitted recipient for a
  `'provider-native'` adapter, whose own `resolveTargetChannelId` fallback then applies.
- **The optionality is provider-derived, not caller-derived**, and that is the whole safety
  argument: an email provider has no default address to fall back to, so `'email'` — the format
  every existing provider resolves to, declared or defaulted — still answers `Recipient is
  required`. An integration case on a seeded connected channel pins this so the optionality
  cannot be made unconditional by accident.
- Omission is `undefined` only. `null` and `''` stay 422 on **every** provider: a caller that sent
  an explicit empty recipient meant to address someone and got it wrong, and rerouting that to the
  provider default would deliver the message somewhere the caller never named.
- The CR/LF, allowlist and `..` guards § Shared prerequisite marks MUST-survive are untouched —
  they sit after the omission branch and an absent value carries nothing to filter.
- Still open on this touch-point: `send-as-user` and the conditional `subject`, now tracked as
  **#5528**. Also unimplemented, and noted here rather than silently carried: § 6's "(or click
  *Test send* in the channel detail UI)" — no such control exists in any `.tsx`, so the API is
  currently the only smoke-test path.
- Additive under Cat. 7 (a required request field became optional; no caller that sent `to` is
  affected); no deprecation protocol required.

### 2026-08-13 — Touch-point 2 partially implemented (#4976)

- The outbound smoke test is reachable again for a non-email provider:
  `api/post/channels/[id]/test-send/route.ts` no longer hard-wires `to: z.string().email()`. It
  validates through the new optional `ChannelCapabilities.recipientFormat`, which defaults to
  `'email'` — every existing provider keeps byte-identical validation — and accepts a
  provider-issued id when a provider declares `'provider-native'`.
- The CR/LF guard § Shared prerequisite flags as MUST-survive was **extended, not relaxed**: the
  provider-native path also rejects whitespace, `/`, `\`, `?`, `#` and `..`, so a recipient cannot
  steer an adapter that interpolates it into a REST path (Discord posts to
  `/channels/{recipient}/messages`).
- `send-as-user` and the conditional `subject` remain **open** and still block on the variant
  decision, for the reason now recorded inline in § Shared prerequisite.
- Additive under Cat. 2 (optional interface field) and Cat. 7 (widened request schema); no
  deprecation protocol required.

### 2026-08-05 — Backward-compatibility correction (QA of #4391, issue #4975)

- Removed the false claim that the core message path needs no hub contract change. QA against a real
  Discord bot proved every inbound message is rejected by hub validation.
- Documented the three concrete touch-points with file and line: sender identity
  (`messages/data/validators.ts:107` + `:131`, driven by
  `communication_channels/commands/ingest-inbound-message.ts:351`/`:354`), outbound recipient and
  subject validation (`api/post/channels/[id]/test-send/route.ts:33`,
  `api/post/send-as-user/route.ts:20` and `:26`), and channel identity inference
  (`commands/connect-credential-channel.ts:161-169`). The previously known interactions-handshake
  touch-point is retained as the fourth.
- Added § Open decision — hub sender-identity contract: Variant A (conditional validation),
  Variant A+ (A plus a CRM-side identity key) and Variant B (generic `externalIdentity`), each
  classified against `BACKWARD_COMPATIBILITY.md` — all additive, none requiring the deprecation
  protocol for the addition itself — plus the rejected synthetic-email option, the shared
  prerequisite for touch-points 2 and 3 (#4976, #4977), a recommendation, and the mandatory test
  consequence for TC-CHANNEL-DISCORD-003.
- **Corrected the variant costing after review (#4998).** The first draft of the section recommended
  Variant B on two claims that do not hold against the code: that Variant A leaves the platform
  unable to store a non-email sender (it does not — `external_messages.sender_identifier` stores it
  and `message_channel_links` joins it 1:1 to the message), and that a `messages.external_identity`
  column would unlock CRM contact resolution (it would not — resolution is blocked in
  `buildPersonLookupFilter`, which can only match `primary_email` / `primary_phone`). The
  recommendation is now **Variant A+**: relax the refinement, keep the identity where it is already
  persisted, and add the CRM-side lookup key that was Variant B's headline justification. Variant B
  is retained as a later generalization with its remaining narrow benefit stated. Also documented the
  non-ingest compose paths Variant A leaves blocked, linked #4976/#4977/#4978 for the deferred and
  out-of-scope touch-points, named all three `externalEmail` validator sites, and flagged the CR/LF
  header-injection guard on `send-as-user`'s `subject` that any widening must preserve.
- **Re-grounded every citation on the current `develop` head (`c514f2eb3`).** All 30 `file:line`
  references added by this correction still resolve to the quoted code after the base advanced;
  one off-by-one was found and fixed — `ContactResolverInput.senderIdentifier` is at
  `communication_channels/lib/contact-resolver.ts:22`, not `:21` (which is the `adapter` field).
- Recorded how the contradiction survived review: this document already contained both halves
  (`resolveContact` — *"no email/phone"* — and the "verbatim reuse" claim) one section apart. Kept as
  a documented lesson for future non-email providers, with three rules derived from it.
- Added the identity blocker to § Risks & impact review, corrected the "hub stays unchanged" clause
  on the gateway row, and moved Status to blocked. No code changes — spec only.

### 2026-08-01 — AI auto-reply de-scoped from the first release

- Recorded the de-scope decision the 2026-07-30 re-review asked for: § AI bot wiring keeps the
  design but is now marked as the design target rather than shipped behavior, and the TLDR says the
  same. The provider stops advertising AI auto-reply in its module and integration descriptions
  (the `ai` tag is gone), and the subscriber's own documentation states that it ships dormant,
  why arming it by hand would still be denied by the agent policy, and that the `complex` tier
  drops the message with a log line because its approval surface does not exist yet.
- Production agent invocation, the configuration path that writes `aiAutoReplyEnabled` / `aiAgentId`,
  the proposal surface and the optional peer declaration are tracked in issue #4778, together with
  TC-CHANNEL-DISCORD-009/010. No behavior change — the subscriber was already inert; this removes
  the claims that it was not.

### 2026-08-01 — Integration coverage shipped (TC-001..008)

- Replaced the compliance report's blanket "TC-001..010 shipped" claim with what the implementation
  PR actually delivers: eight executable Playwright specs under
  `packages/channel-discord/src/modules/channel_discord/__integration__/`, each stating the ceiling
  of what can be asserted without a live Discord application and naming the unit test that owns the
  remaining half. TC-009/TC-010 assert AI auto-reply behavior and therefore move with that feature
  to issue #4778. No behavior change — spec accuracy plus new tests.

### 2026-06-19 — Initial draft

- Authored the Discord two-way communication channel + AI bot spec. Scope: new
  `@open-mercato/channel-discord` provider implementing the existing `ChannelAdapter`, a Gateway
  worker for real-time inbound, a signed Interactions endpoint, and an optional AI auto-reply
  subscriber via `runAiAgentText` / `runAiAgentObject`. Documented Discord configuration, run, and
  test runbook. Identified the one additive hub touch-point (interactions PING handshake) for
  pre-implementation review. No code changes — spec only.
