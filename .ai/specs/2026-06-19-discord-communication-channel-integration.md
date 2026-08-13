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
- **AI agent connected to Discord**: a hub subscriber on `communication_channels.message.received` (provider `discord`) invokes an `ai_assistant` agent through `runAiAgentText` / `runAiAgentObject`, then replies via `deliver-outbound-message`. The agent answers "easy" messages directly and produces a summary + proposed reply for "complex" ones (mutation-policy gated), mirroring SPEC-056.
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
- **RBAC**: `channel_discord.view` / `.configure` added to `acl.ts` and `setup.ts`
  `defaultRoleFeatures`; sync via `yarn mercato auth sync-role-acls`. ✅
- **i18n / DS**: provider detail UI uses `useT` + locale files and DS tokens (no hardcoded strings
  or status colors). ✅
- **Generation**: run `yarn generate` after adding module files (DI/setup/acl/integration/worker/
  subscriber). ✅
- **Tests**: integration TC-CHANNEL-DISCORD-001..010 + provider unit tests, shipped with the
  implementation PR; no live Discord calls in CI. ⚠️ TC-CHANNEL-DISCORD-003 currently passes on
  fixture data the adapter cannot produce — it MUST be rewritten to drive
  `normalizeInboundDiscordMessage` (§ Decided → Test consequence). The hub-side cause is fixed —
  the seed endpoint no longer bypasses compose — so that rewrite is now unblocked.
- **Hub contract**: ✅ **sender identity decided and implemented** (Variant A, 2026-08-13) — see
  § Decided — hub sender-identity contract. ⚠️ The outbound-recipient (#4976) and channel-identity
  (#4977) halves remain open, so a complete two-way Discord flow still depends on them.

---

## Changelog

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

### 2026-06-19 — Initial draft

- Authored the Discord two-way communication channel + AI bot spec. Scope: new
  `@open-mercato/channel-discord` provider implementing the existing `ChannelAdapter`, a Gateway
  worker for real-time inbound, a signed Interactions endpoint, and an optional AI auto-reply
  subscriber via `runAiAgentText` / `runAiAgentObject`. Documented Discord configuration, run, and
  test runbook. Identified the one additive hub touch-point (interactions PING handshake) for
  pre-implementation review. No code changes — spec only.
