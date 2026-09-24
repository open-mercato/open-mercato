# Custom-Route After-Interceptor Response Headers

## TL;DR

An `after` API interceptor cannot set a response header today. `InterceptorAfterResult`
offers only `merge` and `replace`, so there is no way to return one; and the four routes
that call `runCustomRouteAfterInterceptors` discard the `headers` the runner hands back.
`makeCrudRoute` applies those headers on most of its branches but not on the three
command-backed `actions.*` success responses, so the same seam behaves differently
depending on which family of route - and which wiring within that family - an extension
attaches to, with no error either way.

This adds an optional `headers` to `InterceptorAfterResult`, merges it in
`runApiInterceptorsAfter`, passes the result through at the four custom-route call sites,
and closes the three factory success branches that dropped it. Purely additive: an
interceptor that returns no `headers` behaves exactly as before.

## Overview

- **Changed (type)**: `packages/shared/src/lib/crud/api-interceptor.ts` —
  `InterceptorAfterResult` gains an optional `headers?: Record<string, string>`
- **Changed (runner)**: `packages/shared/src/lib/crud/interceptor-runner.ts` —
  `runApiInterceptorsAfter` merges a returned `headers` over the accumulated ones
- **Changed (call sites)**: `packages/core/src/modules/auth/api/login.ts`,
  `packages/core/src/modules/wms/api/inventory/helpers.ts`,
  `packages/core/src/modules/wms/api/inventory/import/helpers.ts`,
  `packages/core/src/modules/wms/api/sales-orders/[salesOrderId]/warehouse-assignment/route.ts`
  — each forwards `intercepted.headers` on both the success and the interceptor-failure
  response
- **Changed (factory)**: `packages/shared/src/lib/crud/factory.ts` — the three command-backed
  `actions.*` success responses (POST create, PUT update, DELETE) now carry the after-interceptor
  headers. They forwarded them on the `!ok` branch only and built the success response without
  them; that was inert before this change and a dropped header after it
- **Not touched**: `InterceptorBeforeResult` (it already carries `headers`, on the request
  side), `packages/core/src/modules/integrations/api/umes-read.ts` (a fifth
  `runApiInterceptorsAfter` caller, which already forwards `intercepted.headers` on both
  branches), interceptor ordering, the `before` pipeline

## Problem Statement

`runApiInterceptorsAfter` returns `{ ok, statusCode, body, headers }`. The `headers` value
is seeded from the caller's `response.headers` and returned unchanged, because the loop
only ever reads `result.replace` / `result.merge` from an interceptor:

```ts
if (result.replace && typeof result.replace === 'object') {
  body = { ...result.replace }
} else if (result.merge && typeof result.merge === 'object') {
  body = { ...body, ...result.merge }
}
```

`InterceptorAfterResult` has no `headers` field, so this is not an oversight an interceptor
author can work around — the type does not let them express it.

Independently, the four `runCustomRouteAfterInterceptors` callers build their response as
`NextResponse.json(body, { status })` and never read `interceptedResponse.headers`. So even
the headers a route seeds itself are dropped on the way out.

`makeCrudRoute` mostly does the opposite. Its list, detail and legacy non-command
create/update/delete branches all return
`json(afterInterceptors.body, { status: afterInterceptors.statusCode, headers: afterInterceptors.headers })`,
on the rejection path as well as the success path.

Three branches do not: the `actions.*` paths wired through a `commandId` (POST create,
PUT update, DELETE) forward the headers when the interceptor *rejects* and then build the
success response as `json(resolvedPayload, { status })`. That was harmless before this
change — those call sites pass no `headers` to `applyInterceptorsAfter`, so the runner
seeded `{}` and echoed it back — but adding `headers` to the contract is exactly what turns
it into a dropped header. Fixing the custom routes without fixing these would leave a
distinction that is invisible from `api/interceptors.ts`: an interceptor targeting a CRUD
entity keeps its header on `GET` and on the legacy write paths, and loses it on any entity
whose route is wired through `opts.actions.*.commandId`.

The result is a seam that is honoured unevenly, with no error anywhere. An extension adding
a cache hint, a correlation id or a `Set-Cookie` to `auth/login`, a `wms` route or a
command-backed CRUD action gets no error and no effect — the failure mode that costs the
most to diagnose.

## Design

### `headers` on the after result

```ts
export type InterceptorAfterResult = {
  merge?: Record<string, unknown>
  replace?: Record<string, unknown>
  headers?: Record<string, string>
}
```

Optional, so every existing interceptor keeps compiling and behaving identically.

### Merge semantics

Headers are merged over what has accumulated so far, in execution order:

```ts
if (result.headers && typeof result.headers === 'object') {
  headers = mergeResponseHeaders(headers, result.headers)
}
```

The **last interceptor to run wins** a collision. That matches the body `merge`, which is
also last-writer-wins, so one rule covers both halves of the result. Note interceptors run
in *descending* `priority`, so the winner is the lowest-priority entry; the field's doc
comment says so, because the intuition runs the other way.

Merging rather than replacing keeps a header the route seeded unless an interceptor names
that header.

**Names are lower-cased on the way in**, on the seeded bag as well as on each interceptor's
result. A plain object spread keys on the exact string, so `{ 'X-Foo': 'a' }` from one
interceptor and `{ 'x-foo': 'b' }` from another both survive as distinct keys — and
`new Headers(obj)` then *appends* rather than replaces, so the response carries
`x-foo: a, b`. Header names are case-insensitive, so two interceptors that both believe they
set the same header would get a concatenation instead of the documented last-wins. Every
current caller seeds `{}` or a single lower-case name, so normalising the seed changes
nothing observable today.

**An invalid header fails through the runner's own attribution.** A name that is not an
RFC 9110 token, or a value carrying NUL/CR/LF, does not throw in the merge — it throws later,
inside `new Headers()` at whichever call site builds the response, where the route's outer
catch turns it into a generic 500 with no interceptor id. Every other way an interceptor can
fail here is attributed (a throw becomes `toErrorBody(interceptor.id, error)`, a timeout a
504 naming the interceptor), so the merge validates and throws into that same path. The
status the caller sees is unchanged — it was already a 500 — and the id is no longer lost.

### Both response paths

The call sites forward `headers` on the interceptor-failure path (`!ok`, i.e. the 500 and
504 the runner mints) as well as on success, because that is what `makeCrudRoute` does and
a correlation id is most useful on the response that failed.

## Alternatives Considered

- **Fix only the four call sites.** Passing `intercepted.headers` through without adding
  the type field changes nothing observable: those callers seed `headers: {}` and no
  interceptor can add to it. It would leave the seam just as inert while looking fixed.
- **Fix only the type and the runner.** Then a returned header would reach `makeCrudRoute`
  responses and still vanish on the four custom routes — the same split this spec exists to
  remove, moved one step along.
- **Let `after` return a `Headers` instance.** `InterceptorResponse.headers` is already a
  `Record<string, string>` on the way in; a second shape on the way out would need
  normalising at every call site for no gain.

## Backward Compatibility

Additive. `headers` is optional on a result type that interceptors construct, never one
they consume positionally, so no existing interceptor changes shape or behaviour.

The one behavioural change is that headers a custom route seeds itself now reach the
response. Today all four callers seed `{}`, so nothing observable changes without an
interceptor that opts in.

## Testing

- `packages/shared/src/lib/crud/__tests__/custom-route-interceptor.test.ts` — a returned
  header reaches the result alongside the seeded ones; the last interceptor to run wins a
  collision; a collision differing only in case resolves last-wins rather than concatenating;
  a route-seeded name is lower-cased; an invalid name and a CRLF value each fail with the
  runner's attributed 500 and leave the seeded headers intact.
- `packages/shared/src/lib/crud/__tests__/crud-factory.test.ts` — the POST create, PUT update
  and DELETE command-backed action success responses each carry an interceptor header, and the
  operation header still attaches alongside it.
- `packages/core/src/modules/auth/api/__tests__/login.test.ts` — the header reaches the
  actual HTTP response, the auth cookies the route sets survive it, and a header accumulated
  by a higher-priority interceptor before a lower-priority one throws reaches the 500.
- `packages/core/src/__tests__/after-interceptor-response-headers-coverage.test.ts` — a source
  sweep over every workspace: a file that calls either after-runner must forward `headers` on
  every response it builds from the result. This is the guard for the four custom-route call
  sites, which is a per-site obligation with nothing structural behind it — dropping the
  forward produces no type error and no failing route test. It also fixes the scan against the
  five known call sites, so a scan that silently matches nothing cannot pass vacuously.

Every assertion above was verified to be load-bearing by reverting the corresponding line
alone and watching it fail:

| Reverted | Fails |
|---|---|
| `factory.ts` success-branch `headers:` (×3) | 4 `crud-factory.test.ts` cases |
| `interceptor-runner.ts` normalise + validate | 4 `custom-route-interceptor.test.ts` cases |
| `login.ts:230` (failure path) | the accumulated-header case — 16/16 passed before this change |
| any wms `headers: intercepted.headers` | the coverage sweep |

## Risks & Impact Review

| Risk | Assessment |
|---|---|
| An interceptor sets `set-cookie` on `auth/login`, where the route also sets `auth_token` / `session_token` afterwards | The route applies its own cookies through `res.cookies.set(...)` *after* `NextResponse.json(body, { headers })`, so a route cookie wins its own name and an interceptor cookie of a different name rides alongside. Pinned by the existing `the auth cookies the route sets survive the interceptor headers` case. An interceptor that names `set-cookie` itself replaces the seeded value for that key, which is the documented last-wins rule. |
| The three factory success branches are a behaviour change on a hot path | They are additive: `afterInterceptorHeaders` stays `undefined` unless an after interceptor ran AND returned headers, and `json(payload, { status, headers: undefined })` is identical to `json(payload, { status })`. `attachOperationHeader` still runs afterwards, so the operation header keeps winning its own name. |
| Lower-casing the seeded bag changes what an `after` hook reads from `response.headers` | All five callers seed `{}` or a single lower-case name today, so nothing observable changes. The alternative — normalising only the interceptor's side — would leave a seeded `X-Foo` and an interceptor's `x-foo` still colliding into a concatenation, which is the defect being fixed. |
| Validation turns a previously-working response into a 500 | It does not: an invalid header already produced a 500, thrown unattributed inside `new Headers()` at the call site. The status is unchanged and the interceptor id is added. |
| An extension relies on the previous concatenation behaviour for a repeated header | Out of scope by construction — `InterceptorAfterResult.headers` is introduced by this change, so no interceptor can have depended on it. A genuinely repeatable header (`set-cookie` with several values) is not expressible in a `Record<string, string>` either before or after; that remains a known limitation of the shape, not a regression. |

## Changelog

| Date | Change |
|------|--------|
| 2026-08-28 | `InterceptorAfterResult.headers` added; runner merges it; the four `runCustomRouteAfterInterceptors` call sites forward it on both response paths. |
| 2026-09-10 | Review round 1. The three command-backed `makeCrudRoute` action success branches now forward the headers too (they were dropping them, which this change is what made a bug); header names merge case-insensitively; an invalid name or NUL/CR/LF value fails through the runner's attributed error instead of throwing unattributed at the call site; the wms callers' two byte-identical return arms collapsed to one; the login failure-path test made discriminating; a source-sweep coverage guard added; `packages/core/AGENTS.md` and `SPEC-041e-api-interceptors.md` corrected. |
