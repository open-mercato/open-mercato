# Frontend Architecture Contract

Use this contract for every Next.js/App Router UI spec, generated frontend change, or feature that touches `app/**`, page/layout roots, shared providers, frontend generators, backend shell UI, or heavy interactive widgets.

## Required Contract

### 1. Server/Client Boundary Map

| Route / surface | Server root | Client islands | Data owner | Notes |
| --- | --- | --- | --- | --- |
| `/backend/example` | `page.tsx` | `ExampleTableClient`, `ExampleDialogClient` | server action/API/query | No page-root `"use client"` |

Rules:
- `page.tsx` and `layout.tsx` are server components by default.
- Client islands must be named and scoped to the route/feature.
- Shared providers must be route-scoped unless proven global.

### 2. `"use client"` Ledger

Every new or touched top-level `"use client"` file needs a ledger row:

| File | Reason | Imported by | Heavy deps? | Cleanup / hydration risk | Alternative rejected |
| --- | --- | --- | --- | --- | --- |

Reject specs that say only “needs interactivity”. The ledger must identify the exact browser-only capability: stateful form, DOM API, drag/drop, editor, chart/canvas, browser SDK, effect subscription, etc.

### 3. Client Blob Guardrail

No generated page root should become a large client-side blob. If a client file is expected to exceed 300 LOC or imports table/editor/calendar/graph/browser SDK dependencies, split it into smaller leaves or justify the exception.

### 4. Budgets

Declare budgets before implementation:

| Budget | Default target | Spec value |
| --- | --- | --- |
| Generated backend page-root `"use client"` | 0 new unallowlisted | |
| Touched client page/root files over 300 LOC | 0 unless justified | |
| Heavy browser libraries at page/provider root | 0 | |
| Per-route hydration smoke test | required for changed interactive route | |
| Performance evidence | static check + one runtime/build/bundle/RSS signal when feasible | |

If a feature cannot meet a default target, write the temporary exception and migration task in the spec.

### 5. Provider / Bootstrap Scope

List every provider/bootstrap registry touched by the feature:

| Provider/bootstrap | Global? | Scope | Why | Exit criteria to narrow |
| --- | --- | --- | --- | --- |

Global bootstrap must not import route-specific dashboards, injection widgets, notifications, messages, payments, editors, calendars, graphs, or browser SDKs without explicit architecture approval.

### 6. Test and Evidence Plan

A UI spec must define at least one verification path for each changed interactive route:

- hydration smoke or Playwright route load,
- key interaction test for table/form/dialog/editor/calendar/graph,
- `yarn check:client-boundaries` output,
- bundle/RAM/build evidence when the work is performance-sensitive.

## Review Gate

Before a Next.js/UI spec is approved, reviewers should be able to answer:

1. Where exactly is the Server/Client boundary?
2. Why does each `"use client"` file exist?
3. Which files are prevented from becoming client-side blobs?
4. What are the route/bundle/RAM budgets?
5. What hydration/interactivity test proves the route still works?
6. What performance evidence is required before merge?
