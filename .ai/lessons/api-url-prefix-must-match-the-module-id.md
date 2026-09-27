---
title: "A route's metadata.path is the URL; the OpenAPI document is not"
modules: ["hr_management","fleet_management","transport_operations","saudi_localization","cli","shared"]
areas: ["module-data","testing","integration"]
topics: ["auto-discovery","generated-files","error-states"]
---

# A route's metadata.path is the URL; the OpenAPI document is not

Three app modules shipped with **every** API call broken: `fleet_management`, `hr_management` and
`transport_operations` (plus `saudi_localization`, which was written later against the same habit).
Nothing failed — not `tsc`, not lint, not jest, not `yarn generate`, not the dictionary gates. The
screens simply rendered empty lists, because the URL the client built was a 404.

## What actually decides the URL

The runtime matches the request path after `/api` against **`metadata.path` verbatim**
(`matchRoutePattern` in `packages/shared/src/modules/registry.ts` — case-insensitive, but
separator- and prefix-sensitive; the manifest the router searches is built from that same declared
value).

Two other places compose the URL differently, and they are what makes this trap invisible:

| Source | How it composes the URL |
|---|---|
| runtime manifest (the router) | `metadata.path`, exact |
| OpenAPI generator (`packages/cli/src/lib/generators/openapi.ts`) | `/api/<moduleId>/<route directory segments>` — the declared path is ignored |
| docs + every client helper | `fetchCrudList('<moduleId>/<resource>')` → `/api/<moduleId>/<resource>` |

So a route in `hr_management/api/leave-requests/route.ts` declaring `path: '/hr/leave-requests'`
is served at `/api/hr/leave-requests`, is **advertised** in the generated OpenAPI as
`/api/hr_management/leave-requests`, and is **called** by the screen as
`hr_management/leave_requests` (snake case too). Three spellings, none of them reachable. Core
modules never show this because their module id and their route prefix are the same word
(`catalog/products`), which is exactly why the convention looked optional.

## The rules

1. **Declare `metadata.path` as `/<moduleId>/<route directories>`.** `/shipping-carriers/...` for
   `shipping_carriers` is the tolerated variant (kebab module id); a *shortened* prefix (`/hr` for
   `hr_management`) is the defect.
2. **Client resource strings are `<moduleId>/<resource>`**, with the resource spelled like the route
   directory (kebab case) — `hr_management/leave-requests`, not `hr_management/leave_requests`.
3. Removing the `path` export entirely is also correct: the generator then falls back to
   `<moduleId>/<route directories>`, the same value the other two layers assume.

## Guard

`packages/core/src/__tests__/crud-resource-path.test.ts` checks both directions against the
generated route shards (the manifest's own input, not the OpenAPI document, which omits routes that
do not export `openApi`):

- every `/api/…` string the module sources build — CRUD helpers, `*RESOURCE*` constants and bare
  literals — must be a registered path (or a static `src/app/api/**` route, or a path an optional
  package declares, or a prefix for a template literal cut off by `${…}`);
- no route may declare a prefix that is its own module id truncated at a separator.

An intentional exception is written down as `// api-path-exempt: <reason>` near the URL (the example
module probes a provider that ships no route in this repository), so it stays reviewable.

## Verified by

`yarn generate` must run before the guard in CI, because the shards are its input; without them the
existence check warns and skips, while the prefix check still runs.
