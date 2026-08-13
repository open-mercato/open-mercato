# Hub sender-identity contract — Variant A: conditional `externalEmail`

Closes #4975.
Source doc: `.ai/specs/2026-06-19-discord-communication-channel-integration.md`
(§ Open decision — hub sender-identity contract)

Engine: om-auto-create-pr (steps: 8, --loop: no)

## Goal

Make the hub accept a message from an external sender that has no email address, so a non-email
channel provider (Discord first, Slack/Telegram/SMS later) can complete an inbound compose instead
of failing validation deterministically — and lock that behaviour behind a test that runs on
`develop`, where no provider-side fixture can bypass it.

## Decision being implemented

**Variant A**, decided by @pkarw on 2026-08-13 (out-of-band, relayed and recorded on
[#4975](https://github.com/open-mercato/open-mercato/issues/4975#issuecomment-5280211475)):
require `externalEmail` only when the originating channel is email-typed; **fail closed** when the
channel type is unknown or absent, preserving today's behaviour for every existing caller.

A+ and B stay available as later, purely additive extensions. C (synthesising
`<discordUserId>@discord.invalid`) stays declined.

## Scope

1. `packages/core/src/modules/messages/data/validators.ts` — conditional, fail-closed
   `externalEmail` requirement driven by a new optional `sourceChannelType` input.
2. Channel-type resolution threaded into **both** call sites of `composeMessageSchema`:
   `messages/commands/messages.ts` (ingest, via `messages.messages.compose`) and
   `messages/api/route.ts` (`POST /api/messages`).
3. `packages/core/src/modules/messages/api/openapi.ts` — the published request contract.
4. `communication_channels` test-seed: a real inbound action that drives
   `ingest_inbound_message` (and therefore `composeMessageSchema`) instead of the raw-SQL bypass
   that let CI stay green while three defects were live.
5. Acceptance test: a non-email provider completes an inbound compose end to end.
6. Spec § Open decision closed out with the chosen variant.

## Non-goals

- **`packages/channel-discord` provider code** — untouched by instruction. `TC-CHANNEL-DISCORD-003`
  lives on #4391's branch (`wojciechszyjka/open-mercato-mk:feat/discord-channel-provider`); the
  package does not exist on `develop`, so its rewrite cannot land in this PR. The hub-side root
  cause it depends on (the compose-bypassing seed path) **is** fixed here, and the durable
  equivalent of its missing assertion ships on `develop` as step 3.2.
- **#4976** (outbound endpoints hard-wire an email recipient) and **#4977** (channel identity
  sniffed from `username ?? email ?? fromAddress`). Unsolved by every variant, explicitly out of
  scope of this decision, and not silently folded in.
- **A+** (CRM-side identity key) — additive, deliberately deferred, not foreclosed.
- No database migration, no persisted column: `sourceChannelType` is validation context only.

## Risks

- **Fail-open regression.** If the channel-type test were permissive (e.g. "anything that is not
  literally `email` waives the requirement"), a typo'd or attacker-supplied type would silently
  disable a data-quality rule. Mitigated by an explicit allow-list of recognized non-email channel
  types; every unrecognized value falls through to today's behaviour.
- **Client-supplied bypass.** `POST /api/messages` must not let a caller assert its own channel
  type — that would make the waiver self-service. Mitigated by resolving the type server-side from
  the referenced conversation / parent message and stripping any client-sent value.
- **Cross-module coupling.** `messages` may not reach into `communication_channels` entities
  directly. Mitigated by a soft-resolved DI facade, mirroring the existing
  `communicationChannelsSendAsUser` pattern; when the facade is absent, resolution returns
  `undefined` and the fail-closed default applies.

## Implementation Plan

### Phase 1: Hub contract — conditional, fail-closed `externalEmail`

- 1.1 Add the channel-type identity helper and the optional `sourceChannelType` input; make the
  `superRefine` email requirement conditional. Unit tests for both branches and for fail-closed.
- 1.2 Publish the client-facing request contract without the server-resolved field
  (`api/openapi.ts`, route `openApi` doc).

### Phase 2: Both call sites of `composeMessageSchema`

- 2.1 Ingest path: pass the channel type from `ingest-inbound-message.ts` through
  `messages.messages.compose`.
- 2.2 `POST /api/messages`: resolve the channel type server-side via a soft-resolved
  `communication_channels` DI facade; never trust a client-sent value.

### Phase 3: Remove the bypass and add the acceptance test

- 3.1 Test-seed: drive the real ingest command for a non-email channel, with no invented address.
- 3.2 Acceptance test — a non-email provider completes an inbound compose end to end.

### Phase 4: Record the decision

- 4.1 Close out the spec's § Open decision — hub sender-identity contract.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Hub contract — conditional, fail-closed `externalEmail`

- [ ] 1.1 Channel-type helper, `sourceChannelType` input, conditional `superRefine` + unit tests
- [ ] 1.2 Client-facing request contract in `api/openapi.ts` and the route `openApi` doc

### Phase 2: Both call sites of `composeMessageSchema`

- [ ] 2.1 Ingest path passes the channel type through `messages.messages.compose`
- [ ] 2.2 `POST /api/messages` resolves the channel type server-side via a soft-resolved facade

### Phase 3: Remove the bypass and add the acceptance test

- [ ] 3.1 Test-seed drives the real ingest command for a non-email channel
- [ ] 3.2 Acceptance test — a non-email provider completes an inbound compose end to end

### Phase 4: Record the decision

- [ ] 4.1 Spec § Open decision closed out with Variant A
