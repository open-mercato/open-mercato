# Stabilize develop CI — TC-EXAMPLE-017 post-save redirect never lands

Engine: om-auto-create-pr (steps: 5, --loop: no)

## Goal

Make `CI for Develop&Main` green on `develop` by fixing, at root cause, the
`ephemeral-integration (1/15)` shard failure in
`apps/mercato/src/modules/example/__integration__/TC-EXAMPLE-017-bound-extension-ui.spec.ts`.

## Evidence

Failing run: [32806947452](https://github.com/open-mercato/open-mercato/actions/runs/32806947452)
(head `4dbca7b35`), job `ephemeral-integration (1/15)`, 1 failed / 152 passed.
Failed on the first attempt AND on retry #1, so it is not a plain flake.

```
Error: expect(page).toHaveURL(expected) failed
Expected pattern: /\/backend\/todos(?:\?.*)?$/
Received string:  "http://127.0.0.1:5001/backend/todos/create"
  at TC-EXAMPLE-017-bound-extension-ui.spec.ts:273:26
```

What the downloaded shard artifacts prove:

- The create itself succeeded — `POST /api/example/todos` returned **201** in 74 ms.
- The whole widget lifecycle ran: console shows `Before save validation` →
  `Save triggered` → `After save complete`, and the page snapshot records
  `navigate={"ok":true,"target":"/backend/todos?flash=Todo%20created&type=success"}`.
  So `CrudForm`'s `onBeforeNavigate` guard allowed the redirect and
  `router.push(successRedirect)` was called.
- The router's RSC fetch for the redirect target,
  `GET /backend/todos?flash=Todo%20created&type=success&_rsc=…`, is recorded in the
  trace with **status `-1`** — it never received a response, for the full 20 s
  `toHaveURL` window.
- The server was healthy throughout: `/api/progress/active` polls at +4 s, +9 s,
  +14 s and +19 s all returned 200 on the same page, so this is neither a server
  hang nor socket-pool exhaustion.

Monotonic timestamps from `trace.zip` are the smoking gun:

| monotonic | event |
|---|---|
| 823894.431 | `setNetworkInterceptionPatterns [{glob: '**/api/example/todos'}]` (the test's `page.route`) |
| 824027.332 | `setNetworkInterceptionPatterns []` (the test's `page.unroute` in its `finally`) |
| 824029.625 | the redirect's `_rsc` request is issued — **2.3 ms after interception teardown** |

## Root cause

The spec holds the create `POST` with `page.route`, then tears the route down with
`await page.unroute(createRoute)` inside the same `finally` that releases the request —
i.e. microseconds after the `POST` resolves. `CrudForm` fires its post-save
`router.push()` immediately after `onAfterSave`, so the redirect's RSC fetch is issued
inside the CDP Fetch-domain teardown window and is stranded: the browser never resumes
it and no response ever arrives, so the URL stays on `/backend/todos/create`.

The race is timing-dependent, which is why it surfaced now — `develop` picked up
`f75c35b3d` (channel-discord), which changed integration-shard composition and shard-1
timing — but the defect is in the spec, not in the product.

## Scope

- Register the create interception once, before anything the test asserts on, and
  never tear it down mid-test — Playwright removes it at page close, where nothing is
  in flight that the test cares about.
- Mirror the identical change into the `create-app` template copy of the spec
  (`packages/create-app/template/...`), per the Template Sync Checklist.
- Record the trap in `.ai/lessons.md` so the next spec that holds a request does not
  reintroduce it.

## Non-goals

- No product/`CrudForm` change — the app behaved correctly.
- No change to the other `page.unroute` sites (`TC-MSG-013/014`, `TC-DOCUMENTS-014/016`);
  they tear down after the interaction has settled and nothing asserted afterwards
  depends on an in-flight request. Noted in the PR for follow-up, not touched here.
- No change to sharding, retries, or the CI workflow.

## Risks

- Low. Test-only change, confined to one spec plus its template mirror.
- Leaving the route registered for the remainder of the test keeps Playwright's
  interception on for `**/api/example/todos` only; the test issues no further POSTs to
  that URL, and non-POST requests are passed through unchanged.

## Progress

### Phase 1: Fix the stranded-redirect race

- [ ] 1.1 Hoist the create interception ahead of the asserted flow and drop the mid-test `page.unroute` in the app spec
- [ ] 1.2 Mirror the same change into the create-app template spec
- [ ] 1.3 Record the Playwright interception-teardown trap in `.ai/lessons.md`

### Phase 2: Validate and ship

- [ ] 2.1 Run the validation gate relevant to the change
- [ ] 2.2 Open the PR, label it, and drive CI to green
