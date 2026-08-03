---
title: "API routes live under api/<resource>, not api/<module>"
modules: ["documents","cli"]
areas: ["module-data","architecture","testing"]
topics: ["auto-discovery","generated-files","testing"]
---

# API routes live under api/<resource>, not api/<module>

**Context**: Documents shipped its routes as `api/documents/*`, mirroring the module folder name.

**Problem**: OM **auto-prefixes the module id** into API URLs, so a route file must sit DIRECTLY under `api/<resource>/route.ts` (like `customers`: `api/activities/route.ts` → `/api/customers/activities`) — NOT under an `api/<module-name>/` subdir. The generator doubled the segment to `/api/documents/documents/*`, so EVERY documents route 404'd at the intended `/api/documents/*`.

**Rule**: Move `api/<module>/*` → `api/*` (module-root imports lose one `../`; `_shared`/sibling imports move together, unchanged). Backend pages are NOT affected — `backend/<module>/page.tsx` maps directly to `/backend/<module>`.

**Applies to**: every module's API tree. Build, typecheck and jest all pass (URLs are strings); the generated `api-routes.generated.ts` shows the real `path`. Only **running the integration tests against a booted app** catches it — compiled and discovered is not the same as executed.
