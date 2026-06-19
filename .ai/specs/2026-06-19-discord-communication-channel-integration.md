# Discord two-way communication channel + AI bot

**Date**: 2026-06-19
**Status**: Draft — ready for pre-implementation review
**Scope**: Open Source
**Depends on**: [`SPEC-045d-communication-notification-hubs.md`](implemented/SPEC-045d-communication-notification-hubs.md) (Communication & Notification Hubs — the `communication_channels` hub + `ChannelAdapter` contract)
**Related**:
- [`SPEC-056-2026-02-22-whatsapp-ai-chat-integration.md`](SPEC-056-2026-02-22-whatsapp-ai-chat-integration.md) — first AI-assisted channel; easy-vs-complex reply tiering reused here.
- `packages/channel-gmail/` and `packages/channel-imap/` — reference provider packages (file layout, DI, health check, capabilities).
- `packages/ai-assistant/AGENTS.md` — `runAiAgentText` / `runAiAgentObject` programmatic agent invocation.

---

## TLDR

**Key points**

- Add a **Discord channel provider** package `@open-mercato/channel-discord` (module id `channel_discord`, provider key `discord`) under the existing `communication_channels` hub. No new framework primitives — it implements the existing `ChannelAdapter` contract.
- **Two-way by reusing the hub**: outbound goes through the hub's `deliver-outbound-message` command → Discord REST API; inbound flows into the hub's `ingest-inbound-message` command and emits `communication_channels.message.received`. Because both directions are hub commands/events, **every module** can send and receive Discord messages exactly the way it already sends/receives Gmail/WhatsApp/Slack — no Discord-specific coupling in consumer modules.
- **Open Mercato as a Discord bot**: a long-running **Gateway worker** (Discord's real-time WebSocket) bridges incoming Discord messages into the hub. A signed **Interactions** HTTP endpoint handles slash commands / button clicks (Discord Ed25519 request signing).
- **AI agent connected to Discord**: a hub subscriber on `communication_channels.message.received` (provider `discord`) invokes an `ai_assistant` agent through `runAiAgentText` / `runAiAgentObject`, then replies via `deliver-outbound-message`. The agent answers "easy" messages directly and produces a summary + proposed reply for "complex" ones (mutation-policy gated), mirroring SPEC-056.
- The spec documents **how to configure Discord** (application, bot, intents, token, public key, invite URL/scopes), **how to run it** (gateway worker + interactions route), and **how to test it** (local smoke test + integration test list).

**Concerns**

- Discord's transport is a persistent **Gateway WebSocket**, not inbound HTTP webhooks like Slack/WhatsApp. The hub's inbound model assumes either an HTTP webhook (`verifyWebhook`) or a poller (`fetchHistory`). The design resolves this with a dedicated gateway worker that calls the hub's ingest command directly, plus a thin signed HTTP interactions route — see § Architecture.
- Ed25519 signature verification on the interactions endpoint MUST be fail-closed (the shared webhook route treats a non-throwing `verifyWebhook` as "verified").
- AI auto-reply must never auto-send privileged actions — reuse the mutation-approval gate.

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
13. Final compliance report ✅
14. Changelog ✅

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
| Transport for inbound messages | Gateway WebSocket worker (not HTTP webhook) | Discord does not POST normal messages to a webhook; bots must connect to the Gateway. Mirrors how `channel-gmail` runs a worker, but socket-driven instead of poll-driven. |
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
3. **Slash commands / buttons**: Discord POSTs to
   `/api/communication_channels/webhook/discord`; the route fans out across active `discord`
   channels and calls `adapter.verifyWebhook` (Ed25519). On the initial `PING` (type 1) the route
   must answer `{ type: 1 }` (PONG); for application commands/components it normalizes to an inbound
   event. (Note: the existing route returns 202 + enqueues; the spec calls out that the interactions
   handshake needs a synchronous `{ type: 1 }` body — see § Backward compatibility, hub touch-point.)

### Adapter method map

| `ChannelAdapter` member | Discord implementation |
|-------------------------|------------------------|
| `providerKey` | `'discord'` |
| `channelType` | `'discord'` (the contract's `channelType` is `'whatsapp' \| 'slack' \| 'email' \| 'sms' \| string` — `'discord'` is allowed as a string) |
| `capabilities` | `threading: true` (Discord threads + reply-to), `richText: true` (markdown), `reactions: true`, `multiReactionPerUser: false`, `editMessage: true`, `deleteMessage: true`, `fileSharing: true` (≤8 MB default tier), `supportedBodyFormats: ['text','markdown']`, `maxBodyLength: 2000`, `realtimePush: true`, `interactiveComponents: true` |
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
| `/api/communication_channels/webhook/discord` | POST | Discord **Interactions** endpoint (slash commands, buttons, PING handshake). Unauthenticated; Ed25519 verification is the auth. |
| `/api/communication_channels/channels/{id}/test-send` | POST | Smoke-test outbound to the default channel. |
| `/api/communication_channels/channels/{id}/import-history` | POST | Optional backlog import via `fetchHistory`. |
| `/api/communication_channels/messages/{id}/reactions` | POST | Add a reaction (hub → `sendReaction`). |

### New provider-owned surface

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
| `lib/health.ts` | `channelDiscordHealthCheck` — validates bot token via `GET /users/@me`. |
| `workers/discord-gateway.ts` | Long-running gateway bridge → hub ingest. |
| `lib/capabilities.ts` | `ChannelCapabilities` (`realtimePush: true`, `editMessage: true`, `deleteMessage: true`). |
| `commands/register-slash-commands.ts` | Optional: registers application (slash) commands with Discord on connect. |

All API route files MUST export `openApi` (none are added here — the reused routes already exist).
The provider module MUST run `yarn generate` after adding DI/setup/acl/integration files.

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
https://<your-host>/api/communication_channels/webhook/discord
```

Discord immediately sends a signed `PING`; saving succeeds only if the endpoint answers `{ "type": 1 }`
with a valid Ed25519 verification against the **Public Key**. (Locally, expose the route via a tunnel
such as `cloudflared` / `ngrok`.) If you only need messages (not slash commands), this step is
optional — message traffic uses the Gateway, not this endpoint.

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
# 3. (Optional) register slash commands
yarn mercato channel_discord register-slash-commands --tenant <tenantId>
```

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

### Subscriber

`packages/channel-discord/src/modules/channel_discord/subscribers/ai-auto-reply.ts`:

```ts
export const metadata = {
  event: 'communication_channels.message.received',
  persistent: true,
  id: 'discord-ai-auto-reply',
}
```

The handler:

1. **Filters** to `payload.providerKey === 'discord'` and to channels that have AI auto-reply
   enabled (a per-channel setting; default off). Ignores messages the bot authored.
2. **Resolves the AI runtime softly.** `ai_assistant` is an OPTIONAL peer — the subscriber uses a
   local `tryResolve` and, if the AI module/runtime is absent, no-ops (the channel still works as a
   plain inbox). It MUST NOT hard-`requires` the AI module.
3. **Classifies** the message (easy vs complex) — reuse SPEC-056's tiering: a low-risk classifier
   call (or a confidence threshold from the agent's structured output) decides whether the bot may
   answer directly.
4. **Easy** → calls `runAiAgentText({ agentId, messages, authContext, container, sessionId })` to
   draft a reply, then sends it back through the hub command
   `communication_channels.message.deliver_outbound` (NOT a direct Discord call — keep the
   send path generic and audited). The Discord conversation/thread id is the `sessionId` so multi-turn
   context is preserved.
5. **Complex / low-confidence** → calls `runAiAgentObject` to produce a structured
   `{ summary, proposedReply }`, stores it, and surfaces it for human approval in the inbox UI. The
   human accepts/edits → `deliver-outbound-message`. No auto-send.

### Safety / RBAC

- The agent runs with a tenant-scoped `authContext` (system/service principal for the channel's
  tenant + org). `runAiAgentText` enforces the agent's `requiredFeatures`, `allowedTools`,
  `executionMode`, and `mutationPolicy` — the subscriber cannot widen them.
- **Auto-send never escalates privilege.** Any tool the agent might call that mutates data routes
  through the AI mutation-approval gate (`ai_pending_actions`); auto-reply is text only. Privileged
  actions surface as approval cards for a human, never executed unattended from a Discord message.
- The agent and its features are declared in whichever module owns it (e.g. a support agent in
  `customers`); `channel_discord` only wires the trigger. Tenants choose the agent id per channel.

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
| TC-CHANNEL-DISCORD-005 | Interactions endpoint security | `PING` with valid Ed25519 → `{ type: 1 }`; tampered signature → 401, no tenant-scoped work; non-interaction body → `eventType: 'other'` ack. |
| TC-CHANNEL-DISCORD-006 | Contact resolution | Unknown Discord sender creates an external contact; a stored-handle match links to an existing CRM person. |
| TC-CHANNEL-DISCORD-007 | Health check | `channelDiscordHealthCheck` returns healthy for a valid token stub, unhealthy on `401`. |
| TC-CHANNEL-DISCORD-008 | Tenant isolation | The shared webhook route's candidate fan-out pins the request to the channel whose public key verifies; a second tenant's Discord channel never receives another tenant's interaction. |
| TC-CHANNEL-DISCORD-009 | AI auto-reply (AI module present) | Easy message → `runAiAgentText` stub → `deliver-outbound-message`; complex message → propose-only, no auto-send. |
| TC-CHANNEL-DISCORD-010 | AI peer absent | With `ai_assistant` disabled, the subscriber no-ops and inbound still ingests (module-decoupling). |

Unit tests (provider package, jest): `convertOutbound`/`normalizeInbound` mapping, Ed25519 verify,
gateway identify/resume/backoff state machine, bot-self-message filter.

---

## Risks & impact review

| Risk | Severity | Mitigation |
|------|----------|------------|
| **Gateway ≠ webhook** — the hub assumes HTTP-webhook or poll inbound; Discord pushes over a socket. | High (design) | Dedicated gateway worker calls the hub's existing `ingest_inbound` command directly — the hub stays unchanged; the provider owns the socket lifecycle. `realtimePush: true` disables redundant polling. |
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
- **No hub contract change required for the core message path.** Outbound and inbound message flows
  reuse the existing `ChannelAdapter` methods and hub commands/events verbatim. `'discord'` is a
  valid `channelType` (the contract types it as `… | string`).
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
- **RBAC**: `channel_discord.view` / `.configure` added to `acl.ts` and `setup.ts`
  `defaultRoleFeatures`; sync via `yarn mercato auth sync-role-acls`. ✅
- **i18n / DS**: provider detail UI uses `useT` + locale files and DS tokens (no hardcoded strings
  or status colors). ✅
- **Generation**: run `yarn generate` after adding module files (DI/setup/acl/integration/worker/
  subscriber). ✅
- **Tests**: integration TC-CHANNEL-DISCORD-001..010 + provider unit tests, shipped with the
  implementation PR; no live Discord calls in CI. ✅

---

## Changelog

### 2026-06-19 — Initial draft

- Authored the Discord two-way communication channel + AI bot spec. Scope: new
  `@open-mercato/channel-discord` provider implementing the existing `ChannelAdapter`, a Gateway
  worker for real-time inbound, a signed Interactions endpoint, and an optional AI auto-reply
  subscriber via `runAiAgentText` / `runAiAgentObject`. Documented Discord configuration, run, and
  test runbook. Identified the one additive hub touch-point (interactions PING handshake) for
  pre-implementation review. No code changes — spec only.
