# Frontend Client Boundary Benchmark — Global ClientBootstrap POC

Date: 2026-05-13
Base: `open-mercato/open-mercato@develop`
Benchmark type: static initial client import graph from global app client entrypoints.

## Question

Does moving broad generated client bootstrap registries out of the eager global client graph produce a measurable reduction before doing a full page-template migration?

## Method

A local benchmark compared two variants:

1. **Baseline** — current `develop` behavior:
   - `apps/mercato/src/components/AppProviders.tsx` statically imports `ClientBootstrapProvider`.
   - `ClientBootstrapProvider` statically imports generated registries and side-effect files:
     - injection widgets/tables,
     - enabled module IDs,
     - dashboard widgets,
     - notification handlers,
     - translation fields,
     - messages client registry,
     - payments client registry.
2. **POC lazy bootstrap** — local benchmark-only patch:
   - `ClientBootstrapProvider` keeps the same component API.
   - Generated registries are moved from static top-level imports to dynamic imports inside the client bootstrap effect.
   - This is a measurement POC, not a production-ready patch; production work still needs route/surface-specific bootstrap ordering and hydration checks.

The analyzer recursively walked **static local imports** from:

- `apps/mercato/src/components/AppProviders.tsx`
- `apps/mercato/src/components/ClientBootstrap.tsx`

It records initial static graph size, generated files pulled into the initial graph, LOC, bytes, and heavy browser import hits. Dynamic imports are counted separately but are not included in the initial static graph.

## Results

| Metric | Baseline eager bootstrap | POC lazy bootstrap | Delta |
| --- | ---: | ---: | ---: |
| Initial static files | 374 | 321 | -53 / -14.2% |
| Generated files in initial graph | 9 | 1 | -8 / -88.9% |
| Initial static LOC | 66,547 | 63,218 | -3,329 / -5.0% |
| Initial static bytes | 2,336,019 | 2,224,677 | -111,342 / -4.8% |
| Heavy import hits in initial graph | 7 | 7 | no change |

## Interpretation

This confirms the architectural direction: broad generated registries in global client bootstrap materially increase the initial client graph. Even a narrow local POC that only moves `ClientBootstrap` registries behind dynamic imports removes:

- 53 files from the initial static graph,
- 8 generated registry files from the initial static graph,
- ~111 KB of source text from the initial static graph.

This does **not** yet measure the larger expected win from converting generated backend `page.tsx` roots from large client components into server roots with small client islands. The static guardrail currently reports:

- 908 top-level `"use client"` files,
- 168 backend page-root `"use client"` files,
- 65 client page roots over 300 LOC,
- 123 heavy browser import hits.

Those are the next benchmark targets.

## Caveats

- This benchmark is static import-graph evidence, not a full runtime RSS or Web Vitals benchmark.
- A full runtime benchmark requires a production-safe POC refactor and a generated app environment with matching generated files.
- The local app typecheck was blocked by generated files copied from another audit clone referencing `champion_crm` module paths that do not exist in this checkout. The analyzer itself is read-only and completed successfully.
- The lazy bootstrap POC must not be merged as-is without hydration/ordering tests for injection widgets, dashboards, notifications, messages, and payments.

## Recommended next benchmark

Create a production-safe POC branch for one high-impact route, for example:

- `packages/core/src/modules/sales/backend/sales/documents/[id]/page.tsx` — currently ~4,868 LOC client page root,
- or `packages/core/src/modules/catalog/backend/catalog/products/[id]/page.tsx` — currently ~3,181 LOC client page root.

Measure before/after:

- `yarn check:client-boundaries --json`,
- route initial static graph / build output,
- cold route load in preview,
- process-tree RSS while loading the route,
- interaction smoke for the extracted Client Islands.

---

# Route-Level POC Benchmark — Sales Document Detail

## Question

What happens when the largest backend client page root is converted into a server route shell with a deferred Client Island?

## Target

`packages/core/src/modules/sales/backend/sales/documents/[id]/page.tsx`

Baseline shape:

- top-level `"use client"`,
- ~4,868 LOC in the route page root,
- large interactive sales document detail UI directly at page-root level.

## Local POC shape

A benchmark-only local patch split the route into:

- `page.tsx` — small server route shell using `next/dynamic`,
- `SalesDocumentDetailClient.tsx` — unchanged original interactive client implementation.

This does not reduce the deferred client island yet. It measures the first architectural step: removing the large page root from the initial route shell and creating a clear island boundary.

## Route shell graph results

| Metric | Baseline client page root | POC server route shell | Delta |
| --- | ---: | ---: | ---: |
| Static files from route entry | 301 | 1 | -300 / -99.7% |
| Static LOC from route entry | 72,605 | 14 | -72,591 |
| Static bytes from route entry | 2,569,079 | 382 | -2,568,697 |
| `"use client"` files in route-entry graph | 145 | 0 | -145 |
| Heavy import hits in route-entry graph | 8 | 0 | -8 |
| Dynamic imports from route shell | 16 | 1 | split point introduced |

## Deferred client island graph

The POC intentionally kept the client implementation unchanged. The deferred island still has the original graph:

| Metric | Deferred Client Island |
| --- | ---: |
| Static files | 301 |
| Static LOC | 72,605 |
| Static bytes | 2,569,079 |
| `"use client"` files | 145 |
| Heavy import hits | 8 |

## Interpretation

This confirms the second part of the proposed architecture:

1. **Server route shell first** removes the large client blob from the route root and creates an explicit streaming/loading boundary.
2. **Further client-island decomposition** is still needed to reduce the deferred client chunk itself.

In other words, the first split gives an immediate route-shell boundary and avoids treating the whole page root as client-owned. The next work is to split the deferred island into smaller islands such as totals, line items, payments, shipments, returns, notes, custom fields, and send-message dialog.

## Recommended production refactor sequence

1. Rename the current page implementation to a client leaf.
2. Add a server page shell with loading/error boundary.
3. Move server-readable data fetches into the server shell where safe.
4. Split heavy tabs/dialogs into separate dynamic islands:
   - items/line-item dialog,
   - payments,
   - shipments/returns,
   - notes/custom fields,
   - send-message dialog.
5. Measure each split with:
   - `yarn check:client-boundaries --json`,
   - route shell graph,
   - deferred island graph,
   - preview cold-load + interaction smoke,
   - RSS/process-tree sampling when environment is stable.

---

# Deeper route graph scan — top client page roots

The first two benchmarks show the mechanism. I also scanned the largest current top-level client `page.tsx` roots to identify where the migration should start.

## Top route-entry graphs

| Route/page root | Root LOC | Static files from route entry | Static LOC from graph | `"use client"` files in graph | Heavy import hits | Read |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| `sales/backend/sales/documents/[id]/page.tsx` | 4,868 | 301 | 72,605 | 145 | 8 | Highest priority; large edit/detail workflow with line-item dialogs, payments, shipments, notes, custom fields. |
| `catalog/backend/catalog/products/[id]/page.tsx` | 3,181 | 178 | 40,222 | 96 | 4 | High priority; product detail should become server shell + form/media/variant islands. |
| `catalog/backend/catalog/products/create/page.tsx` | 2,085 | 109 | 24,641 | 56 | 2 | Good generator/template target for create forms. |
| `workflows/frontend/checkout-demo/page.tsx` | 1,914 | 8 | 2,486 | 4 | 0 | Large local component, but graph is small; split for maintainability more than bundle. |
| `integrations/backend/integrations/[id]/page.tsx` | 1,326 | 158 | 34,794 | 91 | 3 | High priority; detail/config page pulls common rich backend UI. |
| `customers/backend/customers/deals/page.tsx` | 1,123 | 109 | 20,946 | 55 | 4 | List page archetype; DataTable island candidate. |
| `workflows/backend/definitions/visual-editor/page.tsx` | 1,076 | 192 | 44,156 | 113 | 21 | Heavy-widget archetype; graph/editor should be dynamic/local only. |
| `data_sync/backend/data-sync/page.tsx` | 1,023 | 96 | 18,513 | 45 | 4 | List/admin dashboard archetype. |
| `customers/backend/customers/people/page.tsx` | 1,003 | 109 | 20,826 | 55 | 4 | Generated/list archetype; DataTable island candidate. |
| `customers/backend/customers/companies/page.tsx` | 976 | 109 | 20,799 | 55 | 4 | Generated/list archetype; DataTable island candidate. |

## What the route scan says

There are three different problem types, and they should not be refactored with one generic pattern.

### 1. Detail/edit mega-pages

Examples:

- sales document detail,
- catalog product detail,
- integration detail.

Current smell:

- page root owns browser state, effects, dialogs, tabs, custom fields, notes, and multiple mutation surfaces,
- server-readable shell data is mixed with client-only interaction state,
- large shared widgets enter the page graph immediately.

Target shape:

```text
[id]/
  page.tsx                       # server shell; fetches shell data and permissions
  loading.tsx                    # route shell loading
  error.tsx                      # route shell error
  server/
    getShellData.ts              # server data/cache/revalidation
    Header.server.tsx
    Summary.server.tsx
  islands/
    MainFormIsland.tsx           # client; form state only
    ItemsIsland.tsx              # client; line item table/dialog
    NotesIsland.tsx              # client; notes/comments
    CustomFieldsIsland.tsx       # client; custom fields editor
    MessagesIsland.tsx           # client; send dialog/message runtime
  actions/
    update*.ts                   # server action or API wrapper
```

Review rule: the server shell can import server components and serializable data helpers. It must not import editor/calendar/graph/browser SDKs or global widget registries.

### 2. Generated list pages

Examples:

- customers people/companies/deals,
- data sync,
- many CRUD index pages.

Current smell:

- page root is client just to host filters/table/actions,
- `DataTable`, advanced filters, injection widgets, and query helpers enter at page-root level.

Target shape:

```text
<entity>/
  page.tsx                       # server shell; title, permissions, initial params
  server/
    getListShellData.ts
  islands/
    EntityDataTableIsland.tsx    # client DataTable + filters only
    EntityBulkActionsIsland.tsx  # optional client island
```

Generator rule: generated list `page.tsx` must be server by default. The generator may create `EntityDataTableIsland.tsx` with `"use client"`, but it must also emit a client-boundary ledger entry.

### 3. Heavy-widget pages

Examples:

- workflow visual editor,
- graph/canvas/calendar/editor pages.

Current smell:

- page root imports heavy browser widget stack,
- graph/editor dependencies appear in route-entry graph,
- high heavy import count (`workflow visual editor`: 21 hits in this scan).

Target shape:

```text
visual-editor/
  page.tsx                       # server shell with metadata and access checks
  loading.tsx
  islands/
    VisualEditorIsland.tsx       # dynamic import; graph/canvas only here
    NodeEditDialogIsland.tsx     # separate if large
```

Review rule: graph/editor/calendar dependencies must be route-local and dynamic. They should never be imported by shared providers, root layouts, or generated page roots.

## Generator contract: exact output shape

For generated CRUD modules, the generator should emit this structure by default:

```text
backend/<route>/
  page.tsx                       # server component, no "use client"
  loading.tsx                    # optional, server-safe
  error.tsx                      # optional client error boundary only when needed
  server/
    getPageShellData.ts          # permissions, dictionary/static data, initial query params
  islands/
    <Entity>TableIsland.tsx      # "use client"; DataTable/filter state
    <Entity>FormIsland.tsx       # "use client"; CrudForm/dialog state
    <Entity>ActionsIsland.tsx    # optional; browser-only actions
  client-boundary.ledger.md      # generated or appended report explaining client files
```

Generated `page.tsx` should look closer to:

```tsx
export default async function Page({ searchParams }: PageProps) {
  const shell = await getPageShellData(searchParams)
  return (
    <Page>
      <PageHeader title={shell.title} />
      <Suspense fallback={<LoadingMessage message="Loading table…" />}>
        <EntityTableIsland initialQuery={shell.initialQuery} permissions={shell.permissions} />
      </Suspense>
    </Page>
  )
}
```

Generated island should look closer to:

```tsx
"use client"

export function EntityTableIsland({ initialQuery, permissions }: Props) {
  return <DataTable initialQuery={initialQuery} permissions={permissions} />
}
```

## What to benchmark next

The next production PR should pick one route and run a stepwise benchmark:

1. Baseline route graph.
2. Server shell + one client island.
3. Split first heavy island.
4. Split dialogs/tabs.
5. Runtime preview smoke.

For each step, record:

- static route-entry graph,
- deferred island graph,
- `yarn check:client-boundaries --json`,
- cold route load timing if preview is available,
- interaction smoke for the changed island,
- process RSS if the environment is stable.

Recommended first target: `sales/backend/sales/documents/[id]/page.tsx`, because it combines the worst root size, largest route graph, many client files, and multiple interaction surfaces.

---

# Runtime benchmark — cold Next dev route compile

This is the first runtime benchmark pass. It gives real process/time data from Next itself, not only static import-graph data.

Raw artifact: `.ai/analysis/frontend-client-boundary-runtime-benchmark-2026-05-13.json`

## Method

- Runtime: `next dev --webpack`, Next `16.2.6`.
- Turbopack was attempted first, but it panicked before route compilation in this workspace with:
  - `Symlink [project]/node_modules is invalid, it points out of the filesystem root`.
- Cache: `apps/mercato/.mercato/next` removed before every run.
- Runs: 2 cold runs per variant.
- Route requested: `/backend/sales/documents/benchmark-document-id?kind=order`.
- Metrics captured: ready time, first/second route request time, RSS before route, RSS after first route, peak RSS across the process tree.

## Variants

- `baseline`: current `develop` behavior.
- `no-global-bootstrap`: benchmark-only POC replacing `ClientBootstrapProvider` with a no-op provider. This simulates removing app-global generated registry imports from the root provider tree. It is **not production-ready**; it measures the upper bound of moving generated registries to route/surface-local islands.
- `no-global-bootstrap-route-shell`: same as `no-global-bootstrap`, plus the sales document page root becomes a small server route shell with the old 4,868 LOC page deferred into a dynamic client island.

## Results

Averages across 2 cold runs:

| Variant | First route request | Second route request | RSS before route | RSS after first route | Peak RSS | Status |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| `baseline` | 26.62s | 3.11s | 433.5 MB | 5,498.2 MB | 6,120.8 MB | 500 |
| `no-global-bootstrap` | 23.92s | 2.97s | 435.6 MB | 5,020.0 MB | 5,725.4 MB | 500 |
| `no-global-bootstrap-route-shell` | 24.10s | 2.67s | 434.4 MB | 5,105.6 MB | 5,706.6 MB | 500 |

Measured deltas vs baseline:

| Change | First route request | Second route request | RSS after first route | Peak RSS |
| --- | ---: | ---: | ---: | ---: |
| Remove global bootstrap imports | -2.70s / -10.1% | -0.15s / -4.7% | -478.2 MB / -8.7% | -395.4 MB / -6.5% |
| Remove global bootstrap + route shell | -2.52s / -9.5% | -0.45s / -14.4% | -392.6 MB / -7.1% | -414.2 MB / -6.8% |

## Runtime failure is itself evidence

The current baseline returns `500`, but the failure happens during real Next route compilation and is directly relevant:

```text
Module not found: Can't resolve 'child_process'

Import trace:
bullmq -> @open-mercato/queue -> @open-mercato/events -> @open-mercato/core/bootstrap
-> @open-mercato/shared/lib/di/container
-> customers/message-objects
-> .mercato/generated/messages.client.generated.ts
-> src/components/ClientBootstrap.tsx
-> src/components/AppProviders.tsx
```

That means the current app-global bootstrap is pulling server-only queue/runtime code into the browser/client graph. This is exactly the kind of regression the proposed client-boundary guardrail should block.

## Readout

1. The global bootstrap fix has a real measured upside before any page refactor:
   - about **2.7s faster** cold route compile,
   - about **478 MB lower RSS after first route compile**,
   - about **395 MB lower peak RSS**.
2. The route-shell POC does not materially beat the no-global-bootstrap POC yet because the backend catch-all/global generated graph still dominates compilation before the specific sales document island boundary can pay off.
3. The route-shell split is still valuable after the global/catch-all blockers are fixed: static graph evidence shows the sales document page root currently drags a 301-file / 72,605 LOC client graph from a single 4,868 LOC `"use client"` route module.

## Honest caveats

- This is a dev compile benchmark, not production Lighthouse/Web Vitals.
- Turbopack could not be used in this workspace because of the symlink panic above, so this runtime pass uses webpack.
- All variants still return `500`; the benchmark is valid for **compile-time/RSS deltas up to the current failure point**, not for successful end-to-end rendering.
- `no-global-bootstrap` is an upper-bound POC, not a mergeable implementation. The real implementation should register generated widgets/messages/payments from the route or surface that needs them, with tests proving no behavior regression.

## Practical conclusion

Expected first production win should come from this order:

1. Fix `ClientBootstrapProvider` so app root does not import broad generated registries or server-only dependency chains.
2. Fix generated backend catch-all/module registry so route compilation is not dominated by unrelated backend modules.
3. Then split `sales/backend/sales/documents/[id]/page.tsx` into server shell + smaller client islands.

The runtime benchmark says the global bootstrap fix alone is plausibly worth about **400–500 MB lower dev compile RSS** and **~2.7s faster cold route compile** in this workspace. The static graph benchmark says the sales document route split is still the highest-value page refactor after global/catch-all blockers are removed.

---

# More views/components — route shell POC and hotspot scan

Raw artifacts:

- `.ai/analysis/frontend-client-boundary-route-shell-poc-2026-05-14.json`
- `.ai/analysis/frontend-client-boundary-component-hotspots-2026-05-14.json`

This expands the benchmark beyond the sales document route. It applies the same benchmark-only route-shell POC to several large current `"use client"` page roots: move the existing page implementation to a deferred client island and leave `page.tsx` as a tiny server shell.

Important: this is a boundary benchmark, not a mergeable refactor. The deferred island still contains the old graph. The goal is to show how much static route-entry pressure disappears when the route root stops being the client blob.

## Multi-view route-shell POC

| View | Root LOC | Baseline files | Shell files | Files cut | Baseline graph LOC | Shell graph LOC | `"use client"` files cut | Heavy hits cut |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `sales/backend/sales/documents/[id]/page.tsx` | 4868 | 301 | 1 | -300 / -99.7% | 72,605 | 10 | -145 | -8 |
| `catalog/backend/catalog/products/[id]/page.tsx` | 3181 | 178 | 1 | -177 / -99.4% | 40,222 | 10 | -96 | -4 |
| `catalog/backend/catalog/products/create/page.tsx` | 2085 | 109 | 1 | -108 / -99.1% | 24,641 | 10 | -56 | -2 |
| `integrations/backend/integrations/[id]/page.tsx` | 1326 | 158 | 1 | -157 / -99.4% | 34,794 | 10 | -91 | -3 |
| `workflows/backend/definitions/visual-editor/page.tsx` | 1076 | 192 | 1 | -191 / -99.5% | 44,156 | 10 | -113 | -21 |
| `customers/backend/customers/deals/page.tsx` | 1123 | 109 | 1 | -108 / -99.1% | 20,946 | 10 | -55 | -4 |
| `data_sync/backend/data-sync/page.tsx` | 1023 | 96 | 1 | -95 / -99.0% | 18,513 | 10 | -45 | -4 |
| `customers/backend/customers/people/page.tsx` | 1003 | 109 | 1 | -108 / -99.1% | 20,826 | 10 | -55 | -4 |
| `customers/backend/customers/companies/page.tsx` | 976 | 109 | 1 | -108 / -99.1% | 20,799 | 10 | -55 | -4 |

## What this says


Across these 9 views, every tested route root drops to a 1-file static route-entry graph in the POC because the heavy browser implementation moves behind an explicit island boundary. The deferred island is still heavy, but the route root stops forcing all of it into the initial route-entry graph.

The pattern repeats across different surfaces:

- sales document detail: mega edit/detail workflow;
- catalog product detail/create: form-heavy CRUD;
- integrations detail: config/detail workflow;
- workflow visual editor: heavy graph/editor widget;
- customers/data-sync pages: generated list/DataTable archetype.

## Component hotspots

These are the shared components that repeatedly appear near the top of route graphs. They should not be imported casually by page roots or global providers.

| Component/hotspot | Self LOC | Static files | Static graph LOC | `"use client"` files | Heavy hits | Dynamic imports |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `ui/backend/CrudForm.tsx` | 4238 | 94 | 20,227 | 51 | 1 | 12 |
| `ui/backend/DataTable.tsx` | 2916 | 86 | 17,059 | 40 | 3 | 9 |
| `sales/components/documents/LineItemDialog.tsx` | 2843 | 166 | 34,467 | 64 | 2 | 14 |
| `ui/primitives/rich-editor.tsx` | 1579 | 11 | 2,286 | 5 | 0 | 0 |
| `ui/backend/custom-fields/FieldDefinitionsEditor.tsx` | 1447 | 94 | 20,227 | 51 | 1 | 12 |
| `ui/backend/detail/NotesSection.tsx` | 1363 | 51 | 8,278 | 31 | 1 | 0 |
| `workflows/components/NodeEditDialog.tsx` | 1434 | 35 | 6,998 | 23 | 2 | 0 |
| `ui/backend/filters/AdvancedFilterBuilder.tsx` | 969 | 15 | 2,852 | 5 | 0 | 2 |
| `shared/modules/widgets/injection-loader.ts` | 554 | 8 | 2,098 | 0 | 0 | 7 |
| `ui/backend/messages/SendObjectMessageDialog.tsx` | n/a | 128 | 24,961 | 69 | 2 | 12 |

## Design implication


The target is not “never use these components”. The target is:

1. keep route roots server-first;
2. import heavy components only inside named client islands;
3. split mega components by interaction surface;
4. stop global providers from importing generated registries that pull unrelated module graphs;
5. make generator output server roots + island files by default.

Concrete examples:

- `DataTable` belongs inside `<Entity>DataTableIsland.tsx`, not in a top-level client `page.tsx`;
- `CrudForm` belongs inside `<Entity>FormIsland.tsx` or a dialog island;
- `LineItemDialog`, payments, shipments, returns, notes, custom fields should be separate sales document islands;
- `NodeEditDialog` / graph editor dependencies should be dynamic and route-local;
- message/payment/widget generated registries should register from the surface that needs them, not from `AppProviders`.

## Prioritized refactor queue from this wider scan


1. Global bootstrap/generated registry fix — proven runtime gain and current client compile failure source.
2. Sales document detail — largest route root and biggest graph in this scan.
3. Catalog product detail/create — same form-heavy pattern, likely generator/template impact.
4. Workflow visual editor — highest heavy-hit count; isolate graph/editor stack.
5. Generated list pages — customers/data-sync archetype; fix once in generator and fan out broadly.


---

# RAM impact summary

## Directly measured RSS reduction

The runtime benchmark measures real process-tree RSS during cold Next dev route compilation.

| Variant | RSS after first route compile | Peak RSS | Delta vs baseline |
| --- | ---: | ---: | ---: |
| Baseline | 5,498.2 MB | 6,120.8 MB | — |
| No global bootstrap imports POC | 5,020.0 MB | 5,725.4 MB | -478.2 MB after compile / -395.4 MB peak |
| No global bootstrap + route shell POC | 5,105.6 MB | 5,706.6 MB | -392.6 MB after compile / -414.2 MB peak |

So the real measured RAM win from removing app-global generated registry imports is roughly:

- **~400–500 MB less RSS** during cold dev route compilation;
- **~6–9% lower process-tree RSS** in this benchmark;
- plus **~2.5–2.7s faster** first route compile.

This is the most defensible RAM number in this PR because it comes from actual process RSS, not static import counts.

## What the multi-view scan says about future RAM wins

The route-shell scan does not directly convert to MB. It shows how much code is removed from each route-entry graph. That matters because Next/Turbopack/webpack need to parse, transform, analyze, cache, and retain module metadata for these graphs during development and build.

| View | Files removed from route-entry graph | Static LOC removed | `"use client"` files removed | RAM read |
| --- | ---: | ---: | ---: | --- |
| Sales document detail | 300 | 72,595 | 145 | Highest RAM-risk route in scan. |
| Catalog product detail | 177 | 40,212 | 96 | High RAM-risk detail/form route. |
| Catalog product create | 108 | 24,631 | 56 | Generator/template target. |
| Integrations detail | 157 | 34,784 | 91 | High RAM-risk config/detail route. |
| Workflow visual editor | 191 | 44,146 | 113 | Heavy-widget route; highest heavy-hit count. |
| Customers deals list | 108 | 20,936 | 55 | Generated DataTable/list archetype. |
| Data sync list | 95 | 18,503 | 45 | Generated DataTable/list archetype. |
| Customers people list | 108 | 20,816 | 55 | Generated DataTable/list archetype. |
| Customers companies list | 108 | 20,789 | 55 | Generated DataTable/list archetype. |

Important: these are **not additive RAM savings**. The compiler shares/cache modules, so we should not say “9 routes × 400 MB”. The safe claim is:

- the global bootstrap fix already shows **~400–500 MB measured RSS reduction**;
- route-shelling the largest views removes **95–300 files per route-entry graph** from the server route boundary;
- after the global/catch-all blockers are fixed, each converted page should reduce per-route compile pressure and make dev/build memory spikes less likely.

## How to phrase the RAM claim publicly

Recommended wording:

> Runtime benchmark shows the app-global bootstrap cleanup reduces cold dev route compile memory by about 400–500 MB RSS in this workspace. The wider route scan shows the same boundary problem across major views: route-shelling large client page roots removes 95–300 files and 18k–72k LOC from individual route-entry graphs. Those route-level numbers are static graph pressure, not direct MB yet, but they identify where the next measured RAM reductions should come from.

---

# Deeper RAM investigation — generated/global graph root causes

Raw artifacts:

- `.ai/analysis/frontend-client-boundary-global-generated-graphs-2026-05-14.json`
- `.ai/analysis/frontend-client-boundary-generated-import-classification-2026-05-14.json`
- `.ai/analysis/frontend-client-boundary-messages-client-impact-2026-05-14.json`
- `.ai/analysis/frontend-client-boundary-modules-runtime-breakdown-2026-05-14.json`
- `.ai/analysis/frontend-client-boundary-i18n-json-size-2026-05-14.json`

## Global/generated graph sizes

| Entry | Static files | Static LOC | `"use client"` files | Heavy hits | Dynamic imports |
| --- | ---: | ---: | ---: | ---: | ---: |
| `AppProviders.tsx` | 374 | 66,547 | 204 | 7 | 92 |
| `ClientBootstrap.tsx` | 368 | 66,253 | 201 | 7 | 92 |
| backend catch-all `backend/[...slug]/page.tsx` | 399 | 63,098 | 133 | 3 | 216 |
| `.mercato/generated/modules.runtime.generated.ts` | 1,003 | 200,617 | 136 | 4 | 1,143 |
| `.mercato/generated/messages.client.generated.ts` | 337 | 64,590 | 200 | 7 | 35 |
| `.mercato/generated/backend-routes.generated.ts` | 101 | 4,216 | 0 | 0 | 198 |

## `modules.runtime.generated.ts` is too broad

Breakdown:

- 551 static imports;
- 1,106 dynamic imports;
- 1,657 total import references;
- 1,284 unique import targets;
- static imports include:
  - 46 module indexes,
  - 41 ACL files,
  - 42 setup files,
  - 13 encryption files,
  - 199 page meta files,
  - 164 i18n JSON imports.

Top module families by generated import references:

| Module | Import references |
| --- | ---: |
| sales | 149 |
| customers | 132 |
| customer_accounts | 88 |
| staff | 81 |
| auth | 72 |
| catalog | 64 |
| checkout | 63 |
| workflows | 55 |
| ai_assistant | 52 |
| entities | 46 |

This file is probably acceptable for a server-side module runtime registry, but it should not leak into client/provider graphs and should not make one route pay for all modules when only route metadata or one component loader is needed.

## Eager i18n JSON import cost

`modules.runtime.generated.ts` statically imports 128 module i18n JSON files, totaling about **3.0 MB raw JSON**.

Largest groups include:

- customers: ~610 KB across de/es/pl/en;
- sales: ~381 KB across de/es/pl/en;
- workflows: ~329 KB across de/es/pl/en;
- staff: ~264 KB across de/es/pl/en;
- resources: ~231 KB across de/es/pl/en.

These should be treated as locale/module-scoped data, not unconditional runtime imports for every route graph.

## `messages.client.generated.ts` is the main client poison path

`messages.client.generated.ts` imports only 16 modules, but the imported modules are huge graph roots:

| Imported module | Static files | Static LOC | `"use client"` files | Heavy hits |
| --- | ---: | ---: | ---: | ---: |
| `customers/message-objects` | 315 | 62,957 | 189 | 7 |
| `staff/message-objects` | 143 | 26,376 | 79 | 2 |
| `sales/message-objects` | 143 | 26,234 | 79 | 2 |
| `catalog/message-objects` | 141 | 26,095 | 77 | 2 |
| `currencies/message-objects` | 141 | 26,033 | 77 | 2 |
| `resources/message-objects` | 141 | 26,029 | 77 | 2 |

This explains the runtime failure and RAM spike: a global client bootstrap imports message-object registries that drag broad module graphs, including server-only queue/event/bootstrap dependencies.

## Backend catch-all pressure

`backend/[...slug]/page.tsx` has a 399-file / 63,098 LOC route graph before any specific module page is loaded. It imports backend route metadata and middleware registries plus shared server/auth/DI infrastructure. The generated `backend-routes.generated.ts` itself is relatively small, but it contains 295 import references and 198 dynamic imports.

The likely problem is not just one file; it is the combination of:

1. catch-all backend route;
2. generated metadata/loader registries;
3. component replacement/widget registry hooks;
4. request DI/server infrastructure;
5. app-global client bootstrap importing unrelated generated registries.

## New investigation conclusions

Priority list is now clearer:

1. **Fix `ClientBootstrapProvider` / `messages.client.generated.ts` first.** This is the measured 400–500 MB RSS win and the direct source of the `bullmq -> child_process` client compile failure.
2. **Split `messages.client.generated.ts` by message object/surface.** A global import of customers message objects alone has a 315-file / 62,957 LOC graph.
3. **Stop `modules.runtime.generated.ts` from being a broad static import hub where route-local metadata would do.** Its 551 static imports and 3 MB of eager i18n JSON are a likely build/dev memory multiplier.
4. **Make i18n module/locale scoped.** Do not statically import all module locales into the runtime registry.
5. **Audit backend catch-all registry loading.** One backend page request currently starts with a 399-file route graph before the target module page graph is considered.
6. **Then refactor largest page roots into server shell + islands.** Route-shelling pages is still the right page-level fix, but the global/generated graph needs to be reduced first to make the runtime win visible per view.

---

# Deeper investigation 2 — barrel imports and message component registries

Raw artifacts:

- `.ai/analysis/frontend-client-boundary-barrel-registry-scan-2026-05-14.json`
- `.ai/analysis/frontend-client-boundary-message-object-import-breakdown-2026-05-14.json`
- `.ai/analysis/frontend-client-boundary-customers-message-ui-subpath-poc-2026-05-14.json`
- `.ai/analysis/frontend-client-boundary-customers-message-direct-import-poc-2026-05-14.json`
- `.ai/analysis/frontend-client-boundary-messages-client-direct-components-poc-2026-05-14.json`
- `.ai/analysis/frontend-client-boundary-root-ui-import-pocs-2026-05-14.json`

## New finding: `@open-mercato/ui` root barrel is dangerous in client/runtime registries

The UI package root is a large barrel:

| Entry | Static files | Static LOC | `"use client"` files | Heavy hits | Notes |
| --- | ---: | ---: | ---: | ---: | --- |
| `packages/ui/src/index.ts` | 314 | 62,866 | 189 | 7 | Root barrel exports broad backend/frontend UI. |
| `packages/ui/src/backend/detail/index.ts` | 145 | 31,847 | 83 | 3 | Detail barrel is also broad. |
| `packages/ui/src/backend/messages/index.ts` | 140 | 25,992 | 77 | 2 | Message barrel pulls composer/dialog/picker hooks, not just preview/detail. |
| `packages/ui/src/backend/forms/index.ts` | 19 | 3,314 | 6 | 0 | Smaller but still not free. |

Only a few source files import the UI root, but the impact is large when those files are pulled by generated registries:

```text
apps/mercato/src/components/AppProviders.tsx
packages/core/src/modules/customers/message-objects.ts
packages/core/src/modules/feature_toggles/components/FeatureToggleOverrideCard.tsx
packages/core/src/modules/entities/components/UserEntitiesTable.tsx
packages/create-app/template/src/components/AppProviders.tsx
```

## POC: direct message component imports

`customers/message-objects.ts` currently imports only two components from the UI root:

```ts
import { MessageObjectDetail, MessageObjectPreview } from '@open-mercato/ui'
```

Changing that to direct component imports has a massive graph effect:

| Variant | Static files | Static LOC | `"use client"` files | Heavy hits | Static bytes |
| --- | ---: | ---: | ---: | ---: | ---: |
| baseline `@open-mercato/ui` root | 315 | 62,957 | 189 | 7 | 2,214,251 |
| `@open-mercato/ui/backend/messages` barrel | 141 | 26,083 | 77 | 2 | 904,902 |
| direct `MessageObjectDetail` / `MessageObjectPreview` files | 11 | 944 | 3 | 0 | 26,405 |

Direct-import delta vs baseline:

- **-304 files**;
- **-62,013 LOC**;
- **-186 `"use client"` files**;
- **-7 heavy hits**;
- **-2.19 MB static bytes**.

This is likely one of the highest-value small fixes in the whole investigation.

## POC: all message-object modules use direct message component imports

Applying the same direct import pattern across customer/sales/catalog/staff/resources/currencies message-object modules reduces the generated client message registry graph:

| Entry | Static files | Static LOC | `"use client"` files | Heavy hits | Dynamic imports | Static bytes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `messages.client.generated.ts` baseline | 337 | 64,590 | 200 | 7 | 35 | 2,268,972 |
| direct message component imports POC | 164 | 27,835 | 89 | 2 | 30 | 963,016 |

Delta:

- **-173 files**;
- **-36,755 LOC**;
- **-111 `"use client"` files**;
- **-5 heavy hits**;
- **-1.31 MB static bytes**.

This does not solve everything, but it cuts a huge chunk from the global message registry graph without changing message behavior conceptually.

## POC: other root UI imports

Two other root UI imports show the same problem:

| File | Baseline files | POC files | Files cut | Baseline LOC | POC LOC | LOC cut | Client files cut |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `entities/components/UserEntitiesTable.tsx` | 315 | 88 | -227 | 62,989 | 17,215 | -45,774 | -148 |
| `feature_toggles/components/FeatureToggleOverrideCard.tsx` | 318 | 100 | -218 | 63,323 | 21,121 | -42,202 | -136 |

These are not necessarily the top runtime blockers, but they prove that the root UI barrel should be forbidden in route/client/generator-sensitive code.

## Additional registry scan findings

| Entry | Static files | Static LOC | Client files | Heavy hits | Dynamic imports |
| --- | ---: | ---: | ---: | ---: | ---: |
| `core/bootstrap.ts` | 45 | 7,019 | 0 | 0 | 3 |
| `core/modules/customers/index.ts` | 145 | 31,337 | 2 | 0 | 15 |
| `core/modules/sales/index.ts` | 153 | 39,976 | 1 | 0 | 15 |
| `core/modules/catalog/index.ts` | 132 | 26,526 | 1 | 0 | 15 |
| `backend-middleware.generated.ts` | 5 | 772 | 0 | 0 | 6 |
| `api-routes.generated.ts` | 8 | 1,990 | 0 | 0 | 445 |
| `frontend-routes.generated.ts` | 8 | 1,575 | 0 | 0 | 30 |

The middleware/api/frontend generated registries look less suspicious than `modules.runtime.generated.ts` and `messages.client.generated.ts`. The next focus should stay on UI barrels + message registry + module runtime/i18n breadth.

## Updated root-cause map

The RAM problem is now likely a stack of these issues:

1. `ClientBootstrapProvider` globally imports generated registries.
2. `messages.client.generated.ts` imports message-object modules globally.
3. Message-object modules import broad UI barrels (`@open-mercato/ui` or `@open-mercato/ui/backend/messages`) when they only need tiny preview/detail components.
4. UI barrels pull `CrudForm`, `DataTable`, rich editor, custom fields, notes, dialogs, hooks, and other backend UI into unrelated client graphs.
5. `modules.runtime.generated.ts` is a broad static import hub with 551 static imports and 3 MB eager i18n JSON.
6. Backend catch-all starts with a 399-file graph before target page logic.
7. Large `"use client"` page roots add per-view spikes on top.

This means we should not jump straight to page refactors. The first production fixes should remove accidental breadth from generated/global registries and root barrels; otherwise every page-level benchmark is dominated by global graph noise.

# PoC code delivery

Follow-up to review feedback asking for runnable PoC code, not only benchmark artifacts.

Added in the PoC code branch:

- `apps/mercato/src/components/ClientBootstrap.tsx` and `packages/create-app/template/src/components/ClientBootstrap.tsx` now lazy-load generated client registries from the bootstrap effect instead of statically importing them into the app root client graph.
- `packages/core/src/modules/{catalog,currencies,customers,resources,sales,staff}/message-objects.ts` now imports `MessageObjectDetail` and `MessageObjectPreview` directly from their component files instead of the UI root/backend messages barrel.
- `.ai/analysis/frontend-client-boundary-poc-code-2026-05-14.md` documents run instructions, CI commands, manual smoke checks, and known PoC limitations.

Validation performed locally:

```bash
yarn install --immutable
yarn build:packages
yarn generate
yarn turbo run typecheck --filter=@open-mercato/core --filter=@open-mercato/app
```
