# Custom-Route After-Interceptor Response Headers

## TL;DR

An `after` API interceptor cannot set a response header today. `InterceptorAfterResult`
offers only `merge` and `replace`, so there is no way to return one; and the four routes
that call `runCustomRouteAfterInterceptors` discard the `headers` the runner hands back.
`makeCrudRoute` already applies those headers, so the same seam behaves differently
depending on which family of route an extension attaches to, with no error either way.

This adds an optional `headers` to `InterceptorAfterResult`, merges it in
`runApiInterceptorsAfter`, and passes the result through at the four custom-route call
sites. Purely additive: an interceptor that returns no `headers` behaves exactly as before.

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
- **Not touched**: `InterceptorBeforeResult` (it already carries `headers`, on the request
  side), `makeCrudRoute` (already correct), interceptor ordering, the `before` pipeline

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

`makeCrudRoute` does the opposite. Every one of its after-interceptor branches returns
`json(afterInterceptors.body, { status: afterInterceptors.statusCode, headers: afterInterceptors.headers })`,
on the rejection path as well as the success path.

The result is a seam that is honoured for factory routes and silently inert for custom
ones. An extension adding a cache hint, a correlation id or a `Set-Cookie` to
`auth/login` or a `wms` route gets no error and no effect — the failure mode that costs
the most to diagnose.

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
  headers = { ...headers, ...result.headers }
}
```

The **last interceptor to run wins** a collision. That matches the body `merge`, which is
also last-writer-wins, so one rule covers both halves of the result. Note interceptors run
in *descending* `priority`, so the winner is the lowest-priority entry; the field's doc
comment says so, because the intuition runs the other way.

Merging rather than replacing keeps a header the route seeded unless an interceptor names
that exact header.

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
  collision.
- `packages/core/src/modules/auth/api/__tests__/login.test.ts` — the header reaches the
  actual HTTP response, the auth cookies the route sets survive it, and the failure path
  still returns its status.

Each half was verified to be load-bearing by reverting it alone and watching the route-level
tests fail.
