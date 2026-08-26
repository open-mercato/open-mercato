# Execution plan — honour a command interceptor's HTTP status on direct-`execute` routes

Closes #5097. Follow-up to #5067 (issue #5045), which shipped the contract but wired only two transports.

## Goal

A command interceptor that blocks with an explicit HTTP status surfaces that status on **every**
transport, not just on `makeCrudRoute` handlers and the action-log undo route. Before this change an
interceptor targeting `sales.*` answered `422` on CRUD-factory routes and a generic `400`/`500`
everywhere else — a contract that worked on one transport and not the others.

## Context

`getCommandInterceptorHttpRejection(err)` (`packages/shared/src/lib/commands/errors.ts`) already owns
the whole contract: `{ status, body }` for an interceptor rejection carrying an integer status in
400-599, `null` otherwise. Two call sites consumed it — `handleError` in
`packages/shared/src/lib/crud/factory.ts` and
`packages/core/src/modules/audit_logs/api/audit-logs/actions/undo/route.ts`. Every other route owns its
own `catch`, maps `isCrudHttpError`, and falls through to a generic answer, discarding the status the
interceptor set (`packages/core/src/modules/sales/api/quotes/accept/route.ts` was the issue's
representative case).

Inventory of the 77 `route.ts` files that mention the bus: 1 never calls it, 1 already adopted the mapper
(the undo route), 12 call it outside any `try/catch`, leaving **63 files** that own their error handling.
Of those, 12 delegate to a module-level error mapper, so the branch belongs in the mapper rather than in
each route — 51 route edits + 5 mapper edits.

## Scope

- 51 × `packages/core/src/modules/*/api/**/route.ts` — map the rejection immediately after the
  `isCrudHttpError` branch (or first in the `catch` where there is none), ahead of the generic fallback.
  Response construction mirrors each site: `NextResponse.json`, `Response.json`, or
  `withAdapterHeaders(NextResponse.json(...))` for the customers activities/todos adapters.
- `packages/checkout/src/modules/checkout/api/helpers.ts` — `handleCheckoutRouteError`, covering the 5
  checkout routes.
- `packages/enterprise/src/modules/security/api/{sudo,mfa,users,enforcement}/_shared.ts` — the four
  security mappers, covering 7 routes; plus
  `packages/enterprise/src/modules/security/api/profile/password/route.ts`, which maps inline.
- `packages/enterprise/jest.config.cjs` — `@open-mercato/cache` module mapping (mirrors the checkout
  config) so the security mappers are testable at all.
- Tests — a static coverage guard plus behavioral tests per distinct response shape.
- `.ai/specs/2026-08-06-command-interceptor-http-status.md` — transport-coverage table and Non-goals.

## Out of scope

The 12 routes that call the bus **outside** any `try/catch` (7 × `communication_channels`, 3 ×
`messages`, `messages/api/route.ts`, `customers/api/interactions/[id]/visibility`). Their rejection
propagates out of the handler; giving them error handling changes how every other failure there is
answered, which is a behavior change of its own. They are pinned in
`ROUTES_WITHOUT_OWN_ERROR_HANDLING` so the guard test stays honest about the gap.

## Decisions

- **No new shared wrapper.** The reviewer's minor 1 on #5067 asked to consider one. The mapper already
  *is* the shared helper — a wrapper returning `Response` would only inline the `NextResponse.json(...)`
  call, at the cost of a new exported contract surface and an idiom that diverges from the two
  transports that shipped first. Where a module already funnels route errors through one mapper, the
  branch went into that mapper instead, which is the real de-duplication (12 routes → 5 edits).
- **Insert position.** After the `isCrudHttpError` branch (mirrors `handleError`), else first in the
  `catch` (mirrors the undo route). Consequence: a deliberate business rejection is no longer written to
  the route's error log — consistent with both existing transports.

## Progress

- [x] Triage confirmed against `upstream/develop` — real, still-unfixed, no PR or commit in flight
- [x] Call-site inventory built from the TypeScript AST (77 files → 63 with own handling → 51 + 5 mappers)
- [x] 51 core routes map the rejection ahead of their generic fallback
- [x] `handleCheckoutRouteError` maps it for the checkout routes
- [x] The four enterprise-security mappers map it; `profile/password` maps it inline
- [x] `withAdapterHeaders` preserved on the customers activities/todos responses
- [x] Static coverage guard — `packages/core/src/__tests__/command-interceptor-http-coverage.test.ts`
- [x] Behavioral tests per response shape — staff accept, customers todos (adapter headers), directory
      branding, feature_toggles overrides, checkout mapper, all four security mappers
- [x] Behavioral tests extended to **every** module family with an edited route, at the maintainer's
      request: audit_logs (redo), auth (profile PUT — new file), dictionaries (entries reorder), messages
      (reply — asserts the rethrow for a statusless rejection), resources (tags assign), sales (quotes
      accept — the issue's representative route), translations (entity PUT), wms (warehouse-assignment
      DELETE — new file). `communication_channels` has no edited route; all seven of its call sites are
      catch-less and exempt.
- [x] Spec transport-coverage table and Non-goals updated; the migrated row is now ✅
- [x] Full validation gate — 7/8 green locally; `yarn test` red only on unrelated flakes (see the PR body)
- [x] PR opened with the full label set and a summary comment — #5181
- [x] Self-review pass — one real finding in the guard test fixed: the `dictionaries/…/entries` route was
      wrongly exempted as "handled by the CRUD factory" when it owns its own `catch` (it *had* adopted the
      mapper, so nothing was unmapped — but the false exemption would have hidden a future removal). The
      exemption list is gone, and a new AST-based case re-derives "no enclosing `try/catch`" for every
      remaining exemption, so a route that later grows one drops out and must adopt the mapper.
- [x] Maintainer review by `@adeptofvoltron` (2026-08-14) worked through: the two `eudr` batch routes are
      now an explicit, AST-derived exemption instead of a vacuously "covered" pair, the guard became
      path-scoped so a partially-migrated file fails, its boundaries are recorded in the header comment,
      and the catch-less gap has a tracked follow-up issue instead of living only in a test constant.
- [x] Base merge (2026-08-21) followed through: `develop` shipped the `warranty_claims` module and two new
      `communication_channels` routes after this branch last merged. 16 warranty-claims routes adopted the
      mapper, the two catch-less `communication_channels` routes joined the uncaught list, and the
      path-scoped guard surfaced one genuine pre-existing gap — `messages/api/[id]` `GET` dispatches
      `messages.recipients.mark_read` outside any `try`, so the file is recorded as uncaught for that
      handler while its `PATCH`/`DELETE` stay covered.
- [x] Maintainer review by `@pkarw` (2026-08-24) worked through: the `BACKWARD_COMPATIBILITY.md` ledger entry now
      carries the direct-`execute` transport rollout and the deliberately-uncovered surfaces, the outlier branch
      position in `security/api/profile/password` matches the other 78 sites, the spec front matter records this PR
      alongside #5067, and the second `eudr` batch route gained the behavioural test its twin already had.
- [x] Base merge (2026-08-26) followed through: `develop` had moved 19 commits and shipped `packages/channel-discord`
      — a fifth package with a bus-calling route, created after this branch opened. Its `ai-auto-reply` route mapped
      `isCrudHttpError` and rethrew everything else, so a deliberate 422 left the handler as an unhandled error. It now
      maps the rejection with the same rethrow-shape idiom as the `warranty_claims` portal routes, with a behavioural
      test, and the spec, ledger and coverage tables record it. The guard could not have caught this (it scans
      `packages/core`); widening its scope is tracked in #5636.
- [x] CI green on the PR head
