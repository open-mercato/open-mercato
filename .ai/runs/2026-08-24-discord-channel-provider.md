# Execution plan — clear the CHANGES_REQUESTED review on the Discord channel provider (adopted from PR #4391)

**Origin:** adopted — reconstructed by `om-auto-continue-pr` on 2026-08-24 because PR #4391 carried no execution plan (`om-auto-create-pr-loop` opened it from the spec PR chain and never committed one).
**PR:** #4391 · **Branch:** `feat/discord-channel-provider` (fork `wojciechszyjka/open-mercato-mk`) · **Base:** `develop`
**Author:** @wojciechszyjka — this plan interprets their intent; correct it by editing this file or commenting on the PR.

## 🎯 Goal

Resolve every finding in @pkarw's CHANGES_REQUESTED review of 2026-08-24 on head `dca01dab7` — one High, four Medium, three Low — so the only outstanding merge gate (the review gate) clears and the Discord channel provider is merge-ready.

## Scope

- `packages/channel-discord/src/modules/channel_discord/` — the interactions route and its verification helpers, the capability contract, the integration descriptor, the gateway worker, the CLI, the AI auto-reply subscriber.
- `packages/channel-discord/src/modules/channel_discord/i18n/` — the operator-facing credential help text (en/pl/de/es parity).
- `.ai/specs/2026-06-19-discord-communication-channel-integration.md` — bring the spec's Adapter method map and subscriber id in line with the shipped code, plus its changelog.

## Non-goals

Everything the review and the author already agreed to defer. None of these is touched by this run:

- **Documentation → #5545.** @pkarw explicitly waived docs for this PR ("the docs can follow in the subsequent PR", 2026-08-24 01:49). No docs are written here.
- **AI auto-reply productisation → #4778**, **slash-command / component round-trip → #4663**, **TC-CHANNEL-DISCORD-009/010 → #4665**, **hub reply 403 → #5535**, **hub channel identity → #4977.** All deliberately deferred and honestly declared in the PR body.
- No hub contract change, no schema change, no new production dependency — the PR's original constraints hold.

## Evidence

| Conclusion | Drawn from | Confidence |
|---|---|---|
| The goal is to clear the review gate, nothing more | `--goal` argument; @pkarw's 2026-08-24 01:49 comment; the `changes-requested` label | high |
| The eight findings and their exact file:line anchors | Review `#pullrequestreview-5003839570`, restated verbatim in the `--goal` | high |
| The unsigned-request path costs 1+N..1+2N DB round-trips today | `api/post/interactions/route.ts:44-99` — `findWithDecryption` + per-row `credentialsService.resolve` run before `handleDiscordInteraction` does any request validation | high |
| `threading: true` is unreachable | `convert-outbound.ts:81` reads `channelMetadata.replyToExternalId`; the only hub producers of outbound `channelMetadata` (`send-as-user.ts:250-261`, `deliver-outbound-message.ts:393`) write email-shaped `inReplyTo`/`references` and never `replyToExternalId`, which exists solely on the inbound `NormalizedInboundMessage` (`adapter.ts:157`). QA-confirmed on a live bot (#5541) | high |
| `GatewayJobPayload.organizationId` is accepted and discarded | `workers/discord-gateway.ts:63` declares it; `:185-186` and `:219` filter on `tenantId` only | high |
| CI is green and `qa-approved` is earned on this head | `--goal` context (verified upstream); @Kapsik89's live-bot QA matrix | high |

## Assumptions

- **The `application_id` narrowing is a narrowing, never an authorization decision.** The Ed25519 signature stays the sole gate; a forged `application_id` must still fail. Chosen because it is the most reversible reading of the review — it can only ever *shrink* the candidate set, so it cannot turn into an auth bypass.
- **Finding #5 is resolved by honouring `organizationId`, not dropping it.** The review states a preference ("prefer honouring it if it costs nothing") and it costs one filter key plus one registry field. Dropping a scope parameter is the less reversible choice.
- **Docs are genuinely out of scope**, on the reviewer's own instruction. If that reading is wrong, the fix is a follow-up commit, not a rewrite.

## Risks

- The P0 change reorders security-relevant control flow on an unauthenticated endpoint. Mitigated by keeping `handleDiscordInteraction` independently fail-closed (the hoisted guards are additive, never a replacement) and by call-count assertions that pin the ordering against silent regression.
- Flipping `threading` to `false` is a visible capability-contract change; it is the honest value and is pinned by a contract test naming the missing hub-side producer.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Already landed on this PR (reconstructed)

- [x] 1.1 Discord channel provider package, gateway worker, signed interactions route, integration + unit + integration tests, QA sign-off — dca01dab7

### Phase 2: P0 — stop the unauthenticated interactions endpoint from resolving every tenant's credentials

- [x] 2.1 Hoist the request-only guards (freshness + signature-header shape) ahead of the candidate load so an unsigned or stale POST touches the database zero times, and correct the "constant cost" comment in `lib/interactions-handler.ts` — 00449e6aa
- [x] 2.2 Narrow the candidate set by the body's `application_id` against the stored `applicationId` before the Ed25519 fan-out, as a narrowing only — 00449e6aa
- [x] 2.3 Tests: zero candidate-loader / credential-resolve calls on an unsigned or stale request (assert on call counts), and a forged `application_id` still fails verification — 00449e6aa

### Phase 3: P1 — the four Medium findings

- [x] 3.1 Flip `capabilities.threading` to `false` with a per-flag reason naming the missing hub-side producer, fix the justifying comment, pin it with a contract test — be1077b75
- [x] 3.2 Rewrite the `defaultChannelId` help text — #4976 is fixed and QA sent a real message through it — with en/pl/de/es parity — be1077b75
- [x] 3.3 Correct the spec's Adapter method map (`fileSharing`, `interactiveComponents`) and the subscriber `metadata.id`, plus a changelog entry — be1077b75
- [x] 3.4 Honour `GatewayJobPayload.organizationId` in both the channel filter and the reconciliation, with the scoped-payload regression test — be1077b75

### Phase 4: P2 — the three Low nits

- [x] 4.1 `integration.version` `'0.6.6'` → `'1.0.0'`, matching the sibling providers — be1077b75
- [x] 4.2 Switch `start-gateway` to `parseFlagsAndValues` and delete the buggy `parseArgs` — be1077b75
- [x] 4.3 Drop the unread `channel` parameter in `subscribers/ai-auto-reply.ts` instead of `void channel` — be1077b75

### Phase 5: Finish

- [x] 5.1 Merge current `develop` into the branch — 49e89f92e
- [x] 5.2 Full `validation.commands` gate plus `yarn test:scripts` (turbo does not pick up root `scripts/__tests__/`) — 7b1227f0c
- [ ] 5.3 Finding→commit mapping comment on the PR, labels normalized, re-request review from @pkarw
