# Execution plan — restore an outbound path for non-email channels (#4976)

**Brief:** QA of [#4391](https://github.com/open-mercato/open-mercato/pull/4391) against a real
Discord bot found that nothing in the product can ask the Discord adapter to send, even though the
adapter itself posts fine. Every hub outbound endpoint validates the recipient as an email address,
so a Discord channel snowflake is rejected before it ever reaches an adapter.

## Goal

Make the hub's documented outbound smoke test —
`POST /api/communication_channels/channels/{id}/test-send` — reachable for a provider whose
recipients are provider-issued identifiers rather than email addresses, without prejudging the
sender-identity contract decision still open on [#4975](https://github.com/open-mercato/open-mercato/issues/4975).

## Scope

The merged spec `.ai/specs/2026-06-19-discord-communication-channel-integration.md`
(§ *Shared prerequisite (needed under any variant)*) already prescribes this fix and classifies it
as **additive**: widen `to` to a union of email and adapter-validated identifier, keeping the CR/LF
guard intact.

In scope:

- `packages/core/src/modules/communication_channels/lib/adapter.ts` — a new **optional**
  `ChannelCapabilities.recipientFormat` (`'email' | 'provider-native'`), absent ⇒ `'email'`.
- `packages/core/src/modules/communication_channels/lib/outbound-recipient.ts` (new) — the shared
  validator both formats route through.
- `packages/core/src/modules/communication_channels/api/post/channels/[id]/test-send/route.ts` —
  stop hard-wiring `z.string().email()`; validate against the resolved adapter's capabilities.
- `packages/core/src/modules/communication_channels/lib/email-capabilities.ts` — state
  `recipientFormat: 'email'` on the shared email baseline.
- Unit coverage, the provider docs, and the spec's status + changelog.

### Non-goals

- **`send-as-user` is deliberately excluded, and not for reasons of size.** `lib/send-as-user.ts:134`
  funnels `input.to[0]` into `externalEmail` on `messages.messages.compose`, which is exactly the
  validator (`messages/data/validators.ts:107` + its `superRefine`) that #4975 is blocked on.
  Widening that route's schema alone would move the 422 one layer deeper and let the endpoint claim
  a capability it still does not have. It lands with the #4975 variant decision.
- Making `subject` conditional on capabilities — same dependency, same PR later.
- Anything from #4977 (channel identity `NULL`) or #4978 (queue loss).
- Adding a Discord adapter; `packages/channel-discord` is still unmerged on #4391.

## Implementation Plan

### Phase 1 — Teach the hub that recipients have shapes

Add the optional capability, the shared validator, and route the test-send endpoint through it.
The default must keep Gmail/IMAP byte-identical, and the provider-native branch must be stricter
than "anything non-empty" — the recipient reaches adapters that interpolate it into a REST path.

### Phase 2 — Prove it and record it

Unit-test the full matrix (both formats, injection and traversal attempts, shape guards), document
the new capability for provider authors, and update the spec so the open decision reflects what has
actually landed.

## Progress

Issue: #4976

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Teach the hub that recipients have shapes

- [x] 1.1 Add optional `ChannelCapabilities.recipientFormat`, defaulting to email when absent
- [x] 1.2 Add `lib/outbound-recipient.ts` with `validateOutboundRecipient`
- [x] 1.3 Widen the `test-send` body schema and validate against the resolved adapter
- [x] 1.4 Declare `recipientFormat: 'email'` on `baseEmailCapabilities`

### Phase 2: Prove it and record it

- [x] 2.1 Unit tests covering both formats, CR/LF + path-traversal rejection, and shape guards
- [x] 2.2 Document the recipient shape in the communication-channels provider guide
- [x] 2.3 Record status + changelog in the Discord spec, including why `send-as-user` is excluded

### Validation gate result

Filled in on the PR after the gate run.
