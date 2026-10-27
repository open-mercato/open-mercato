---
title: "Toggling Playwright request interception strands in-flight requests"
modules: ["platform","example","create_app"]
areas: ["testing","debugging","integration"]
topics: ["testing","template-sync","dev-runtime"]
---

# Toggling Playwright request interception strands in-flight requests

**Context**: `TC-EXAMPLE-017` held the create `POST` with `page.route(...)`, then called
`await page.unroute(...)` in the `finally` that released it. On `develop` the shard failed
twice in a row with `expect(page).toHaveURL` timing out on `/backend/todos/create` even
though the `POST` returned `201`, the whole widget lifecycle logged, and the widget's own
`onBeforeNavigate` diagnostic recorded `{"ok":true,"target":"/backend/todos?flash=…"}`.

**Problem**: `page.route()`/`page.unroute()` enable and disable the browser's Fetch domain.
A request issued inside that transition window is stranded — the browser never resumes it
and no response ever arrives, so the request sits pending until the test times out. The
trace makes it unambiguous: `setNetworkInterceptionPatterns []` at monotonic `824027.332`,
the redirect's `_rsc` fetch issued at `824029.625`, and status `-1` for the rest of the run
while `/api/progress/active` polls on the same page kept returning `200`. Because
`CrudForm` fires its post-save `router.push()` microseconds after the create response
resolves, unrouting next to a save lands exactly in that window. The symptom looks like a
product bug ("the form does not redirect") and reads as a flake, but it is neither: the
server is healthy and the client did call `router.push`.

**Rule**: Install a `page.route(...)` before anything the test asserts on, and do not tear
it down while the page is still live — let Playwright remove it at page close. Never place
`page.unroute(...)` adjacent to an action that triggers a client-side navigation or any
other request the test then waits on. When a route genuinely must be removed mid-test, do
it at a quiet point and never immediately before a navigation assertion.

**Debugging note**: `status: -1` in a Playwright trace's `*.network` entries means "no
response was ever recorded". Cross-check against unrelated polls in the same trace — if
those still return `200`, the server is fine and the stranded request is a client- or
harness-side problem, not a server hang or socket-pool exhaustion.

**Applies to**: every Playwright integration spec that intercepts requests, and the
`create-app` template mirrors of those specs (keep both copies in lockstep).
