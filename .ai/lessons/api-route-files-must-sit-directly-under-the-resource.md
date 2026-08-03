---
title: "Auto-discovery routing surprises only a running app catches"
modules: ["documents","cli","ui"]
areas: ["module-data","backend-ui","testing"]
topics: ["auto-discovery","generated-files","error-states"]
---

# Auto-discovery routing surprises only a running app catches

Both failures below compile, typecheck and pass jest, because the wrong value is a
plain string. Only driving a booted app surfaces them.

**API routes.** OM **auto-prefixes the module id** into API URLs, so a route file must sit
DIRECTLY under `api/<resource>/route.ts` (like `customers`: `api/activities/route.ts` →
`/api/customers/activities`) — NOT under an `api/<module-name>/` subdir. Documents shipped
`api/documents/*`, which the generator doubled to `/api/documents/documents/*`, so EVERY
documents route 404'd at the intended `/api/documents/*`. Fix: move `api/<module>/*` → `api/*`
(module-root imports lose one `../`; `_shared`/sibling imports move together, unchanged).
The generated `api-routes.generated.ts` shows the real `path`. Backend pages are NOT affected —
`backend/<module>/page.tsx` maps directly to `/backend/<module>`.

**Backend detail pages.** They render through the **catch-all
`apps/mercato/src/app/(backend)/backend/[...slug]/page.tsx`**, so Next's `useParams()` only
exposes `slug` (an array) — NEVER the `[id]` segment. A page reading `useParams().id` gets
`undefined` and shows "not found" WITHOUT ever calling the API. Read the id from the **`params`
prop** the manifest wrapper passes (`export default function Page({ params }: { params?: { id?:
string } })` → `params?.id`, the convention used by `customers/companies-v2/[id]`), with a
`usePathname()` last-segment fallback.
