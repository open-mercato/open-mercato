# Execution plan — close @pkarw's two review blockers on the channel-reply fix (adopted from PR #5645)

**Origin:** adopted — reconstructed by `om-auto-continue-pr` on 2026-08-26 because PR #5645 carried no execution plan (it was opened by an earlier automation run that never committed one).
**PR:** #5645 · **Branch:** `fix/issue-5535-reply-inbound-channel-message` · **Base:** `develop`
**Author:** @wojciechszyjka — this plan interprets the review feedback on that PR; correct it by editing this file or commenting on the PR.

## 🎯 Goal

`GET /api/messages/{id}` and the `communication_channels` outbound bridge must both close the authorization and delivery-intent gaps @pkarw's `CHANGES_REQUESTED` review found, with a regression test per blocker that drives the real cross-module seam rather than the mocked component in isolation, so PR #5645 can be re-reviewed and merged.

## Scope

- `packages/core/src/modules/communication_channels/subscribers/outbound-bridge.ts` and the lib module that answers "was this message meant to leave the platform?".
- `packages/core/src/modules/messages/api/[id]/route.ts` — the channel-thread fallback added by this PR (the feature gate and the thread-slice visibility filter).
- `packages/core/src/modules/messages/api/route.ts` — the new 409 refusal string (review minor).
- `packages/core/src/modules/messages/lib/channelThreadAccess.ts` — the inert `features` plumbing (review nit).
- Tests in both modules, plus the `messages` locale files for the translated error.

## Non-goals

- The inbox **list** route's participant scope (`applyMessageParticipantScope`) — already recorded in the PR body as a follow-up; it changes what a list endpoint returns to every caller and deserves its own change and review.
- Migrating the other nine hardcoded error strings in the compose handler — only the string this PR introduced is in scope.
- Widening `GET /api/messages/{id}`'s route-level `requireAuth: true` into a route-wide `requireFeatures` — that would deny participants who legitimately read their own messages without `messages.view`. The gate belongs on the channel fallback path this PR added.
- Executing `TC-CHANNEL-REPLY-001`; it needs a live application environment and belongs to the QA pass.

## Evidence

| Conclusion | Drawn from | Confidence |
|---|---|---|
| Blocker 1: the bridge enqueues internal/forwarded messages for external delivery | @pkarw review (2026-08-26T08:56Z) § Blockers 1, with the `forwardMessageCommand` field-by-field trace; confirmed by reading `commands/messages.ts:903-916` and `outbound-bridge.ts:133-183` | high |
| Blocker 2: the detail-route channel fallback is ungated | Same review § Blockers 2; confirmed by `api/[id]/route.ts:33` (`GET: { requireAuth: true }`) and `access-control.ts:89` (`void userFeatures`) | high |
| Each blocker needs a test that crosses the module seam | Same review § Tests & validation, and the user's instruction on this run | high |
| The minor is the new 409 string; the nit is the inert `features` plumbing | Same review § Minor / § Nits | high |
| The repository rule for a user-facing error string is `t('module.errors.<key>')`, not the `[internal]` opt-out | root `AGENTS.md` § UI & HTTP; precedent in `auth/api/login.ts`, `attachments/api/route.ts` | high |

## Assumptions

- The review's suggested fix for blocker 1 ("return early when `visibility === 'internal'`") is necessary but not sufficient: `forwardMessageCommand` copies `visibility` from the original, so a forward of a **public** inbound message stays public. The forward therefore needs its own signal. The `messages.message.sent` payload already declares `forwardedFrom`, which records the operator's intent; nothing observable on the `messages` row distinguishes a forward from a reply (both set `parentMessageId` and both can carry platform recipient rows once `replyAll` is used), so the payload field is the only precise discriminator. Documented at the call site.
- `messages.view` is the right feature for the detail-route fallback gate — the minimum the review names, and the feature that already gates `DELETE` on the same route.
- The nit is resolved by documenting the `features` plumbing rather than deleting it: it mirrors `assertCanAccessChannel`'s own retained signature and its docblock's "reserved for the v2 admin-oversight feature". Deleting it would diverge the facade from the function it delegates to.

## Risks

- Over-blocking outbound delivery would silently drop an operator's legitimate reply — the same class of failure this PR set out to fix. Mitigated by keeping the intent guard to two narrow, explicitly-tested signals and by leaving the existing "operator reply is delivered" test in place as the counter-case.
- Filtering internal-visibility messages out of the channel thread slice changes what the detail route returns for a caller who *is* a participant of those internal notes; the filter must keep participants' own internal messages visible.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Already landed on this PR (reconstructed)

- [x] 1.1 Channel-thread access facade, DI registration, `messages`-side `tryResolve` wrapper, reply-guard widening, outbound-bridge origin test, compose threading, detail-route fallback — c7f33fe1, 1b687da9

### Phase 2: Blocker 1 — outbound delivery intent guard

- [x] 2.1 Add the delivery-intent predicate and wire it into the outbound bridge — 1a2f1004
- [x] 2.2 Regression test driving `messages.messages.forward` through the real bridge seam — 1a2f1004

### Phase 3: Blocker 2 — gate and filter the detail-route channel fallback

- [x] 3.1 Gate the channel fallback on an explicit feature and filter internal-visibility thread messages to participants — 7f3f89e7
- [x] 3.2 Regression test exercising the detail route as a caller holding no features — 7f3f89e7

### Phase 4: Review minor and nit

- [x] 4.1 Translate the new 409 refusal string across all locales — b82bc962
- [x] 4.2 Document the `features` plumbing as a pass-through, not an authorization input — b82bc962

### Phase 5: Validation, review and hand-back

- [x] 5.1 Run the full configured validation gate — all eight commands green locally on `b82bc962` (plus `yarn lint`: 0 errors, 10 pre-existing warnings in untouched files)
- [x] 5.2 Run `om-auto-review-pr 5645 --autofix`, push, and re-request review from @pkarw — re-review of `3e62eb24` found no blocker or major in the follow-up work and recorded all four inherited findings as fixed; autofix had nothing to apply. `changes-requested` → `review`, review re-requested from @pkarw.

### Phase 6: UI QA against a live app (added after the QA pass found a blocker)

- [x] 6.1 Provision an ephemeral app from the PR head and execute `TC-CHANNEL-REPLY-001` for the first time — it **failed** on `b683e650` with `403` on `GET /api/messages/{id}`: the Phase 3 gate read `ctx.auth.features`, and the session JWT carries no `features` claim, so it denied every caller including a tenant admin
- [x] 6.2 Resolve the gate through `rbacService.userHasAllFeatures` instead, drop the test stub that hid it, and pin the regression — c160232e
- [x] 6.3 Re-run `TC-CHANNEL-REPLY-001` on the fixed head — passes (25.3s) — c160232e
- [x] 6.4 Drive the browser through the whole #5535 journey and verify blocker 1 on the live system: the reply is delivered (channel total 2), the forward is not (total stays 2) — evidence posted on the PR
- [x] 6.5 Re-run the full validation gate on the fixed head

> QA note: `OM_ENABLE_TEST_CHANNEL_SEEDING` is set nowhere in the CLI runner or the CI workflow, so `TC-CHANNEL-REPLY-001` and every sibling channel spec `test.skip` silently in CI. That is why a defect this size survived an all-green run, and it is worth wiring in its own change.
