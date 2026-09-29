---
title: "Out-of-band bumps in browser optimistic-lock tests must not change the row's visible name"
modules: ["ui","webhooks","cli"]
areas: ["backend-ui","integration","testing"]
topics: ["concurrency","data-scoping","optimistic-locking"]
---

# Out-of-band bumps in browser optimistic-lock tests must not change the row's visible name

**Context**: `TC-LOCK-OSS-043` browser test for WHK-01 bumped the webhook's `name` field out-of-band to advance `updated_at` and make the in-page lock token stale.

**Problem**: If Next.js or the client re-fetches the list after the out-of-band PUT, the row's accessible name changes (`"QA Lock 043 bumped ${stamp}"`), so the Playwright row locator `/QA Lock 043 ${stamp}\b/` no longer matches. The test failed intermittently with `element(s) not found` on `getByRole('button', { name: /open actions/i })` scoped inside the now-gone row.

**Rule**: In browser-driven optimistic-lock tests, the out-of-band bump must touch only fields that are not part of the row's visible text or accessible name (e.g. `description`, a hidden metadata field, an unrendered flag). This ensures the row locator remains stable regardless of whether the page re-fetches data after the bump.

**Applies to**: All `TC-LOCK-*` browser tests that locate a row by its name and then trigger an out-of-band write before interacting with the row's actions.
