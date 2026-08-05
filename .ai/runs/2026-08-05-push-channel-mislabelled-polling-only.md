# Execution plan — stop labelling push-driven channels "Polling only"

Fixes #4980.

## Goal

Make the profile "Your channels" grid tell the truth about how a channel receives inbound messages,
and stop `Poll now` reporting success for a channel the poll worker skips by definition.

## Context

`packages/core/src/modules/communication_channels/backend/profile/communication-channels/page.tsx`
derived its `Push` column from a hardcoded provider name:

```js
const supportsPush = row.original.providerKey === 'gmail'
```

Every other provider therefore rendered `Polling only`. That was harmless while the only providers
were Gmail and IMAP — both declare `realtimePush: false` and genuinely are polled — but #4391 ships
the first `realtimePush: true` provider (Discord, gateway-driven), so the label became the exact
opposite of the truth.

The row payload from `/api/communication_channels/me/channels` carried no capability information at
all, so the column had nothing else to key on.

Meanwhile `workers/poll-channel.ts` skips any channel whose stored capabilities say
`realtimePush !== false` (the back-compat default is "push"), and
`api/post/channels/[id]/poll-now/route.ts` enqueued that job unconditionally and answered
`202 { ok: true }`. The page turned that into a green toast promising messages "in a few seconds"
that could never arrive.

A naive swap of the condition would regress Gmail: Gmail declares `realtimePush: false` (polling is
kept as a deliberate fallback) yet is the one provider implementing `adapter.registerPush`. The
column needs two independent signals — *is this channel hub-polled?* and *can push be registered on
this provider?*

## Scope

- One shared predicate, `isHubPolledChannel`, so the worker, the API and the UI cannot drift apart.
- Two additive fields on the `me/channels` row payload.
- The `Push` column and the `Poll now` affordance in the profile page.
- A fail-closed guard on the `poll-now` route.
- Regression tests and locale strings for all five locales.

## Non-goals

- The Discord health-check false positive (issue's suggested fix 3). `validateCredentials` cannot
  confirm gateway intents through `GET /users/@me`; that belongs to #4391 and is tracked there
  (#4979 already parks a `4014` channel as `requires_reauth`).
- The platform-wide toast accessibility gap the reporter noted in passing (no `aria-live` on the
  flash container). Separate concern, separate change.
- Any schema, adapter-contract, or capability-shape change.

## Progress

- [x] Confirm the defect still reproduces on `develop` (triage gate)
- [x] Add `lib/polling-eligibility.ts` with `isHubPolledChannel` as the single definition of the
      back-compat default
- [x] Route `workers/poll-channel.ts` through the shared predicate (behaviour unchanged)
- [x] Serialize `supportsRealtimePush` and `supportsPushRegistration` from
      `api/get/me/channels/route.ts`, resolving the adapter registry server-side
- [x] Derive the `Push` column from those two flags instead of `providerKey === 'gmail'`
- [x] Disable `Poll now` for push-driven channels and explain why (tooltip + accessible name)
- [x] Refuse `poll-now` with 409 for push-driven channels instead of queueing a no-op job
- [x] Add locale strings for the new labels in en/pl/es/de/ko
- [x] Regression tests: predicate, serializer, `poll-now` guard, `Push` column and `Poll now` button
- [x] Full validation gate
- [ ] Review loop (`om-auto-review-pr`)
- [ ] UI verification evidence (`om-auto-qa-pr`)

## Verification

```
yarn build:packages   # 22/22
yarn generate         # 1/1, no generated drift
yarn build:packages   # 22/22
yarn i18n:check-sync  # all 5 locales in sync
yarn i18n:check-usage # advisory only
yarn typecheck        # 22/22
yarn test
yarn build:app
```

New tests (21 cases):

- `lib/__tests__/polling-eligibility.test.ts`
- `api/get/me/channels/__tests__/route.test.ts`
- `api/post/channels/[id]/poll-now/__tests__/route.test.ts`
- `backend/profile/communication-channels/__tests__/page.pushColumn.test.tsx`
