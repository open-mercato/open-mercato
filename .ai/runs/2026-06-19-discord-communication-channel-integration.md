# Execution Plan — Discord 2-way Communication Channel + AI Bot

**Date:** 2026-06-19
**Slug:** discord-communication-channel-integration
**Branch:** feat/discord-communication-channel-integration
**Owner:** pkarw
**Type:** docs-only (spec authoring)

## Goal

Author a spec for a two-way Discord integration delivered as a `communication_channels`
channel provider package (`@open-mercato/channel-discord`). Outcome: Open Mercato can act
as a Discord bot — every module can send and receive Discord messages through the existing
hub commands/events, and an `ai_framework`-based agent can be wired to Discord so inbound
messages are answered automatically. The spec MUST document how to configure Discord
(application, bot token, gateway/interactions), how to run it, and how to test it.

## Scope

- **Deliverable:** one OSS spec file `.ai/specs/2026-06-19-discord-communication-channel-integration.md`.
- The spec describes a new provider package `packages/channel-discord/` (module id `channel_discord`,
  provider key `discord`) implementing the existing `ChannelAdapter` contract.
- No production code in this PR — this is the spec only. Implementation is a follow-up.

### Non-goals (documented in the spec)

- Not implementing the provider package in this PR.
- No changes to the `communication_channels` hub contract (`ChannelAdapter`) — the spec must
  fit the existing contract; any gap is called out as a hub change to negotiate separately.
- No new framework primitives. Reuse hub commands (`deliver-outbound-message`,
  `ingest-inbound-message`), events, the unauthenticated webhook route, and the AI framework's
  `runAiAgentText` / `runAiAgentObject` programmatic helpers.
- No voice, no slash-command builder UI, no Discord OAuth "Login with Discord" identity (deferred).

## Source / reference material

- `packages/core/src/modules/communication_channels/lib/adapter.ts` — `ChannelAdapter` contract.
- `packages/core/src/modules/communication_channels/api/post/webhook/[provider]/route.ts` — inbound route.
- `packages/core/src/modules/communication_channels/commands/{ingest-inbound-message,deliver-outbound-message}.ts`.
- `packages/core/src/modules/communication_channels/events.ts` — bridge + lifecycle events.
- `packages/channel-gmail/` and `packages/channel-imap/` — reference provider packages.
- `.ai/specs/implemented/SPEC-045d-communication-notification-hubs.md` — hub foundation.
- `.ai/specs/SPEC-056-2026-02-22-whatsapp-ai-chat-integration.md` — AI-channel precedent.
- `packages/ai-assistant/AGENTS.md` + `agent-runtime.ts` (`runAiAgentText` / `runAiAgentObject`).

## Risks (brief)

- **Discord gateway vs webhooks.** Discord bots receive events over a persistent WebSocket
  Gateway, not inbound HTTP webhooks (unlike Slack/WhatsApp). The hub's inbound model assumes
  an HTTP webhook (`verifyWebhook`) OR a poller (`fetchHistory`). The spec must resolve this:
  a long-running gateway worker that bridges Gateway events into `ingest-inbound-message`, plus
  the signed HTTP **Interactions** endpoint for slash commands. Flag the `realtimePush`/gateway
  shape as the main design decision.
- **`realtimePush` semantics.** Document how the channel avoids the hub's polling scheduler when
  the gateway worker is the live source.
- **Tenant fan-out / signature verification** on the shared webhook route — Discord interactions
  use Ed25519 request signing; ensure fail-closed verification per the route's security contract.
- **AI auto-reply safety.** Reuse the WhatsApp spec's easy-vs-complex tiering and mutation-policy
  gating; never auto-send privileged actions.

## Implementation Plan

### Phase 1: Spec authoring

- 1.1 Write spec skeleton with all MUST sections (TLDR, Overview, Problem, Proposed Solution,
  Architecture, Data Models, API/Adapter Contracts, Discord configuration, Run & Test, AI bot
  wiring, Integration test coverage, Risks & Impact, Backward-Compatibility, Final Compliance,
  Changelog).
- 1.2 Fill Architecture + adapter-method mapping (which `ChannelAdapter` methods the Discord
  adapter implements; gateway worker design; interactions endpoint; outbound REST send).
- 1.3 Write the "Configure Discord" runbook (create application + bot, intents, token, public key,
  invite URL/scopes/permissions, env vars) and the "Run it / Test it" section (local gateway
  worker, smoke test, integration test list).
- 1.4 Write the AI-bot section: subscriber on `communication_channels.message.received` →
  `runAiAgentText`/`runAiAgentObject` → `deliver-outbound-message`; tiering + mutation policy.
- 1.5 Self-review the spec for implementation accuracy (file paths, command ids, event ids,
  env names) and DS/BC compliance; fix.

### Phase 2: PR finalization

- 2.1 Open PR against develop, apply labels (review, feature, documentation, priority, risk),
  run `om-auto-review-pr` autofix pass, post summary comment.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Spec authoring

- [ ] 1.1 Spec skeleton with all MUST sections
- [ ] 1.2 Architecture + adapter-method mapping
- [ ] 1.3 Configure / Run / Test Discord runbook
- [ ] 1.4 AI-bot wiring section
- [ ] 1.5 Self-review for accuracy + BC/DS compliance

### Phase 2: PR finalization

- [ ] 2.1 Open PR, labels, auto-review pass, summary comment
