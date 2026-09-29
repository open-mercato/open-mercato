---
title: "Backend `[id]` pages read the route param from the `params` prop, never `useParams()`"
modules: ["eudr","customers"]
areas: ["backend-ui","umes"]
topics: ["routing","generated-files"]
---

# Backend `[id]` pages read the route param from the `params` prop, never `useParams()`

**Context**: New eudr detail pages used `useParams()` from `next/navigation`; under the backend catch-all router it returns the catch-all's own params (the slug array), so the module-level `[id]` never resolved and every detail page short-circuited to the not-found state without a single API call (2026-07-06, caught only in the preview loop — list-page smokes and API tests stayed green).

**Rule**: Module backend dynamic pages must accept `{ params }: { params?: { id?: string } }` as a component prop (the module page router injects it), like `customers/backend/customers/people/[id]/page.tsx`. Never call `useParams()` for module-declared segments.

**Applies to**: every `packages/**/src/modules/**/backend/**/[param]/page.tsx`.
