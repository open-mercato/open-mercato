---
title: "Backend detail pages read the id from the params prop"
modules: ["documents","ui"]
areas: ["backend-ui","debugging"]
topics: ["auto-discovery","ui-components","error-states"]
---

# Backend detail pages read the id from the params prop

**Context**: The documents editor page resolved its record with `useParams().id` and silently rendered "not found".

**Problem**: OM backend pages render through the **catch-all `apps/mercato/src/app/(backend)/backend/[...slug]/page.tsx`**, so Next's `useParams()` only exposes `slug` (an array) — NEVER the `[id]` segment. A detail page that reads `useParams().id` gets `undefined` and shows "not found" WITHOUT ever calling the API.

**Rule**: Read the id from the **`params` prop** the manifest wrapper passes (`export default function Page({ params }: { params?: { id?: string } })` → `params?.id`, the convention used by `customers/companies-v2/[id]`), with a `usePathname()` last-segment fallback.

**Applies to**: every backend detail/edit page. Build, typecheck and jest cannot catch this — only driving the page in a real browser does, since an API-only integration suite never renders it.
