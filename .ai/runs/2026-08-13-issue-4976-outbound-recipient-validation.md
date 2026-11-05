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

- [x] 1.1 Add optional `ChannelCapabilities.recipientFormat`, defaulting to email when absent — 7ac18fb674
- [x] 1.2 Add `lib/outbound-recipient.ts` with `validateOutboundRecipient` — 7ac18fb674
- [x] 1.3 Widen the `test-send` body schema and validate against the resolved adapter — 7ac18fb674
- [x] 1.4 Declare `recipientFormat: 'email'` on `baseEmailCapabilities` — 7ac18fb674

### Phase 2: Prove it and record it

- [x] 2.1 Unit tests covering both formats, CR/LF + path-traversal rejection, and shape guards — 7ac18fb674
- [x] 2.2 Document the recipient shape in the communication-channels provider guide — 7ac18fb674
- [x] 2.3 Record status + changelog in the Discord spec, including why `send-as-user` is excluded — 7ac18fb674

### Validation gate result

All eight configured `validation.commands` pass on `7ac18fb674`, run in **local mode** (no compose
`app` container was running): `build:packages` ✅, `generate` ✅ (no generated-file drift),
`build:packages` ✅, `i18n:check-sync` ✅ (5 locales in sync), `i18n:check-usage` ✅ (advisory-only
unused-key report, unchanged by this PR), `typecheck` ✅, `test` ✅, `build:app` ✅.

`yarn test` needed a second look and is reported honestly rather than as a clean pass:

- The turbo run aborted at `@open-mercato/cli#test` with a process exit code of 1 while jest itself
  reported `Tests: 1664 passed, 1664 total / Ran all test suites`. Re-run alone, the package is
  **87/87 suites, 1679/1679 tests, exit 0**.
- Because turbo aborts on first failure, `@open-mercato/core#test` never ran in that pass. Run
  directly it reports **9630/9630 tests passed** with 2 suites *failed to run* — a jest worker killed
  with `SIGSEGV`, one of them `payment_gateways/data/__tests__/encryption.test.ts`, which this PR does
  not touch. Zero assertions failed.
- Re-running those suites together with the whole `communication_channels` module: **69/69 suites,
  625/625 tests, green.**

Both failures are the known local worker/memory ceiling under load, not regressions. CI runs the
gate on a quiet machine and is the authoritative signal.
