# Dashboard v2 — the analytics home for /backend

- **Status:** Draft
- **Scope:** OSS (core platform — `dashboards` module + `@open-mercato/ui` backend dashboard)
- **Date:** 2026-07-02
- **Owner:** Platform
- **Slug:** `dashboard-v2-analytics-home`

## TLDR

**Key Points:**
- Rebuild the main `/backend` dashboard as **Dashboard v2**: a Shopify-class analytics home — glanceable KPI cards with sparklines and period deltas, a **global date range + comparison** control that drives every analytics widget, a cleaner 12-column grid with drag-to-reorder and per-widget sizing, first-class loading/empty states, and a modern visual design on DS tokens.
- Two new capabilities make it "best in class" rather than a reskin: a **Custom Metric widget** (self-serve KPI/chart builder over the existing `AnalyticsRegistry` — any current or future module that registers analytics entities becomes dashboard-buildable with zero dashboard code), and an **AI Insights digest** ("what changed & why" bullets grounded in real aggregates, via the tenant-configured LLM, degrading gracefully to a pure-numbers digest when no AI provider is configured).
- **Zero new production dependencies** (dnd-kit, Recharts, react-day-picker-free date presets — all already available or hand-built on existing primitives) and **zero DB migrations** (`layoutJson` is versioned JSON; the schema grows additively).
- **Backward compatibility without a route fork:** the `DashboardScreen` export becomes v2; the v1 implementation is preserved as `DashboardScreenLegacy`, mounted at a new `/backend/dashboard/legacy` page as an escape hatch (customers-v2 precedent: old surface kept, default repointed). All existing widgets render on v2 unchanged — the widget contract only gains optional fields.

**Scope:**
- v2 shell (header, global date range + compare, customize mode, 12-col grid, dnd-kit reorder, size menu incl. new `full` size, skeletons/empty states) in `packages/ui/src/backend/dashboard/v2/`.
- Global date-range plumbed to widgets via additive contract fields; the 10 `dashboards.analytics.*` widgets consume it.
- `GET /api/dashboards/analytics/catalog` + Custom Metric widget.
- `GET /api/dashboards/insights` + AI Insights widget.
- Legacy escape-hatch route; ACL feature additions; i18n (en/de/es/pl); integration tests.
- **Dashboard presets ("Views"):** named, per-user layout snapshots stored additively in `layoutJson` (`presets[]` + `activePresetId`; no migration). A header switcher saves the current dashboard as a view, switches between views (each keeps its own widgets, sizes, and date range), and deletes them. The top-level `items`/`preferences` always mirror the active view so the legacy screen and all BC readers keep working.

**Concerns:**
- The `DashboardScreen` export changes behavior (same props contract, new UI). Mitigated by the legacy export + route and by sharing the same persistence/API so switching back loses nothing.
- LLM output quality/cost for the digest. Mitigated: numbers are computed deterministically server-side; the model only narrates them; result cached 1h per (tenant, org, range); hard fallback to numbers-only.

## Overview

The `/backend` home is the first screen every Open Mercato user sees. Today it is a flat 3-column grid of widgets with three fixed sizes, per-widget date settings, browser-native drag-drop, and no insight layer. It answers "what are my numbers?" poorly and "what changed?" not at all. Competitors (Shopify home, WooCommerce Analytics, HubSpot dashboards) treat the analytics home as their storefront: glanceable KPI cards with period comparison, one global date control, drill-through, and — since 2025 — an AI digest of what changed. Open-source commerce rivals (Medusa, Saleor) ship almost nothing here, which makes this surface a visible differentiator.

> **Market Reference:** Studied Shopify admin home/Analytics, WooCommerce Analytics, HubSpot reporting, Salesforce CRM Analytics, Odoo dashboards, Metabase, Medusa/Saleor admins. **Adopted:** Shopify's card canon (value + sparkline + Δ% vs comparison period), Woo's global date picker with explicit compare toggle and reorderable sections, HubSpot's per-dashboard AI summaries grounded in report data, Metabase's "AI lands in an editable, inspectable artifact" principle (our Custom Metric widget). **Rejected:** free-form NL Q&A as a primary interface (2026 practitioner consensus: unreliable without a semantic layer), autonomous/agentic dashboards and per-tenant forecasting (explainability + data-volume prerequisites), prompt-generated layouts (demo-ware), and a free-pixel grid à la Salesforce (flow grid with size presets matches Shopify/Woo and needs no new dependency).

## Problem Statement

1. **Ugly / dated:** plain cards, no sparklines, inconsistent chrome, spinner-based loading, no empty-state guidance.
2. **Not functional enough:** no global date range — each widget carries its own period setting, so the dashboard can silently mix periods; no comparison convention; KPI cards lack trend context.
3. **Hard to configure:** customize mode is coarse (reorder + 3 sizes); no way to build a widget for a metric the platform didn't pre-build; role/user visibility exists but the catalog UX is thin.
4. **No insight layer:** nothing tells the user what changed and why; the platform has an AI assistant subsystem but the dashboard ignores it.
5. **Extensibility is real but invisible:** `AnalyticsRegistry` + `WidgetDataService` can aggregate any registered entity, but only pre-built widgets expose it.

## Proposed Solution

Keep the proven substrate — widget registry & discovery, `DashboardWidgetModule` contract, layout/visibility persistence, `WidgetDataService` + `AnalyticsRegistry`, Recharts wrappers — and rebuild the shell plus two flagship widgets on top of it.

### Design Decisions

| Decision | Rationale |
|----------|-----------|
| v2 replaces the default `DashboardScreen`; v1 kept as `DashboardScreenLegacy` at `/backend/dashboard/legacy` | User asked to avoid a v2 route fork if BC allows. The widget contract and persistence are shared, so in-place replacement is safe; the legacy route is the customers-v2-style escape hatch. `apps/mercato/src/app/(backend)/backend/page.tsx` does not change (frozen app surface). |
| No feature toggle for the switch | `feature_toggles` unknown-flag default is *off*, which would strand v2 behind per-tenant seeding; a legacy route is simpler, discoverable, and needs no toggle lifecycle. |
| Flow grid (12-col, order-based, size presets) + dnd-kit sortable — not react-grid-layout | dnd-kit is already a workspace dependency; free x/y grids add collision/complexity for little ops value; Shopify/Woo both use flow layouts. Zero new deps. |
| Global date range lives in layout `preferences` (per user), passed to widgets via additive `context.dateRange` | Additive on both the persistence shape and the widget contract (§27 ADDITIVE-ONLY). Widgets opt in via `metadata.respectsDashboardDateRange`. |
| Custom Metric widget reads a new read-only catalog API over `AnalyticsRegistry` | Turns the existing extensibility mechanism into a user-facing feature; future modules get dashboard coverage by registering analytics entities — no dashboard code. |
| New widget ids live under the `dashboards.analytics.*` namespace: `dashboards.analytics.customMetric`, `dashboards.analytics.aiInsights` | Existing tenants have **non-empty seeded role allowlists** (`DashboardRoleWidgets`), so a brand-new widget id ships invisible. The analytics namespace satisfies `resolveAnalyticsWidgetIds` (`lib/role-widgets.ts`) for new tenants; for existing tenants, `setup.ts` appends the two ids to role allowlists that already contain analytics widgets (idempotent upgrade). |
| AI digest = deterministic aggregates first, LLM narrates second | Numbers come from `WidgetDataService` (same path as KPI widgets); the LLM never computes. Wrong-number risk ≈ 0; no-provider fallback still ships value. |
| Digest provider resolution mirrors `inbox_ops/lib/llmProvider.ts` (`createModelFactory`) | Proven core→ai-assistant precedent, per-tenant provider/model resolution, typed `no_provider_configured` failure. |

### Alternatives Considered

| Alternative | Why Rejected |
|-------------|-------------|
| Parallel `/backend/dashboard-v2` route, v1 stays default | Home is a landing surface, not a linkable detail page; forking it splits bookmarks/muscle memory and doubles nav work. Escape hatch achieves the same rollback. |
| react-grid-layout 2.x free grid | New prod dependency; pixel grids complicate responsive + a11y; not needed for the target UX. |
| NL question → chart (Sidekick/Metabot style) | Needs a semantic layer + query sandbox to be trustworthy; deferred (the catalog API is the future foundation). |
| Multiple named dashboards / tabs | Real feature, real scope; v2 grid + role visibility covers the core need; follow-up spec. |
| Materialized pre-aggregation tables | Current ad-hoc aggregation + 2-min cache is fine at target scale; revisit with evidence. |

## User Stories / Use Cases

- **Store owner** wants to open `/backend` and see revenue, orders, AOV, and new customers for a chosen period vs the previous one, so that the day starts with the pulse in under 30 seconds.
- **Ops lead** wants to change one global date range (and compare toggle) and have every analytics card follow, so that numbers are never silently mixed across periods.
- **Power user** wants to build a KPI/chart for any registered metric (e.g., "count of workflow runs this week", "sum of order refunds by region"), so that they don't wait for a pre-built widget.
- **Manager** wants a short "what changed & why" digest each morning, grounded in the real numbers, so that anomalies surface without scanning charts.
- **Module author** wants their module's entities to appear in the metric catalog by registering them once in `AnalyticsRegistry`, so that dashboards support their module with zero dashboard code.
- **Cautious admin** wants to switch a user back to the legacy dashboard instantly if anything looks wrong.

## Architecture

```
apps/mercato/src/app/(backend)/backend/page.tsx        (UNCHANGED — mounts DashboardScreen)
packages/ui/src/backend/dashboard/
  index.ts                    → export DashboardScreen (now v2), DashboardScreenLegacy (v1), unchanged types
  DashboardScreen.tsx         → becomes a thin compatibility shim: re-exports v2 as DashboardScreen (+ DashboardScreenLegacy) so any deep import of this path stays consistent with the package index
  legacy/DashboardScreenLegacy.tsx → the current v1 implementation, moved verbatim (renamed export only)
  v2/DashboardScreenV2.tsx    → new shell (client): header, grid, customize mode
  v2/DashboardHeader.tsx      → greeting, global DateRangePicker + compare, refresh-all, customize toggle
  v2/DateRangePicker.tsx      → presets (Today…YTD) + custom from/to + compare select; existing primitives only
  v2/WidgetCardV2.tsx         → card chrome, size menu, remove, settings flip, skeleton, error, EmptyState
  v2/GridLayout.tsx           → 12-col CSS grid + dnd-kit sortable (order-based)
  v2/dateRange.ts             → DashboardDateRange type helpers, preset→(from,to) resolution (tenant TZ note)
packages/shared/src/modules/dashboard/widgets.ts       → ADDITIVE: size 'full'; context.dateRange?; metadata.respectsDashboardDateRange?
packages/core/src/modules/dashboards/
  backend/dashboard/legacy/page.tsx (+ page.meta.ts)   → mounts DashboardScreenLegacy (requireAuth + dashboards.view)
  api/analytics/catalog/route.ts                       → GET catalog (entity types, fields, aggregates, groupable)
  api/insights/route.ts                                → GET KPI deltas + optional LLM digest (cached)
  lib/insights.ts                                      → deterministic KPI delta computation + digest prompt + numeric post-validation + cache
  lib/kpiRequests.ts                                   → single source of truth: the WidgetDataRequest builders for revenue / orders / AOV / new-customers, extracted from the existing KPI widgets and reused by BOTH those widgets and the insights API (dashboard and digest can never disagree)
  api/openapi.ts                                       → widen dashboardWidgetSummarySchema.defaultSize + layout schemas for 'full' and preferences; add the two new routes
  widgets/dashboard/custom-metric/{config,widget,widget.client}.tsx
  widgets/dashboard/ai-insights/{config,widget,widget.client}.tsx
  acl.ts                                               → + dashboards.insights.view, dashboards.catalog.view
  data/validators.ts                                   → size enum + 'full'; layout object shape {items, preferences?}
  api/layout/route.ts                                  → read both layout shapes (array | object), write object; preferences passthrough
  api/layout/[itemId]/route.ts                         → PATCH must resolve items through the same dual-shape normalizer (today it does findIndex on the raw stored JSON and would 500 on the object shape)
  data/entities.ts                                     → widen the layoutJson property type to the union (array | object)
  setup.ts                                             → append the two new widget ids to existing tenants' role allowlists (idempotent, mirrors the analytics-widget rollout mechanism in lib/role-widgets.ts)
```

- **Data flow (unchanged core):** widgets → `useWidgetData()` → `POST /api/dashboards/widgets/data/batch` → `WidgetDataService` (org/tenant-scoped SQL aggregation, 120s cache). v2 adds `dateRange` custom `{from,to}` support to the widget-data request validator (additive; presets continue to work).
- **Global date range:** `DashboardScreenV2` owns `dateRange` state (hydrated from layout `preferences`, default `last_30_days` + `previous_period`), passes it via the existing `context` prop. **Override semantics are an explicit tri-state**, because existing analytics widgets hydrate a *required* per-widget `dateRange` from defaults (a saved value is indistinguishable from an intentional choice): widget settings gain `dateRangeMode: 'global' | 'custom'`; the settings hydrator defaults **missing** `dateRangeMode` to `'global'` (the v2 experience — the global range wins), and the previously saved per-widget preset remains stored and takes effect only when the user selects `'custom'` in the widget's settings. On the legacy screen (no global range in context) widgets behave exactly as today regardless of mode.
- **Comparison semantics (explicit design — today `getPreviousPeriod` is preset-driven and `comparison.type: 'previous_year'` is validated but ignored):** for a range `[from, to]` (custom or preset-resolved), `previous_period` = the same-length window immediately before (`[from − N days, from − 1]` where `N = to − from + 1`); `previous_year` = `[subYears(from, 1), subYears(to, 1)]`. `getPreviousPeriod` lives in `packages/ui/src/backend/date-range/dateRanges.ts` (already imported server-side by `widgetDataService` via `@open-mercato/ui/backend/date-range`); it gains the range-based path and honors `previous_year` there. The fix applies to both the widget-data path and the insights API so the compare toggle is truthful.
- **AI digest flow:** widget → `GET /api/dashboards/insights?from&to&compare` → `lib/insights.ts` computes the KPI deltas via `WidgetDataService`, **using the exact same `WidgetDataRequest` builders as the four existing KPI widgets** (extracted to `lib/kpiRequests.ts` — revenue/orders/AOV/new-customers definitions have one source of truth; the KPI widgets are refactored to import from it) → **per-entity RBAC:** each KPI's source entity is checked against the caller's granted features via the `AnalyticsRegistry` entry's `requiredFeatures` (same rule as the widget-data route); metrics the caller may not query are omitted from the response and from the digest input → if `createModelFactory` resolves a provider, narrate into ≤5 bullets (strict JSON via `generateObject`, temperature low) → **numeric post-validation:** every number in the generated bullets must match a value present in the deterministic metrics payload (formatting-tolerant: rounding, %, currency); bullets that fail are dropped, and if all fail the digest degrades to `null` (numbers-only fallback) — prompting alone is not the guarantee, validation is → cache 1h via DI cache; **cache key = hash(tenantId, full effective organization scope — the sorted resolved org-id set or the `all` marker, mirroring the widget-data cache — from, to, compare)** so multi-org/unrestricted views never share entries with a narrower org view; tags `dashboards:insights:{tenantId}` for invalidation; on `no_provider_configured` or any LLM error return `digest: null` with `aiAvailable: false` — the widget renders the deltas list (still useful).
- **Commands & Events:** none new (no new entities; layout writes go through the existing route). Undo: N/A — same per-user-preference semantics as v1.

## Data Models

**No new entities. No migrations.** `DashboardLayout.layoutJson` (existing JSON column) evolves additively:

```ts
// stored: legacy shape = DashboardLayoutItem[]  |  v2 shape = DashboardLayoutState
type DashboardLayoutState = {
  items: DashboardLayoutItem[]            // unchanged item shape; size gains 'full'
  preferences?: {
    dateRange?: { preset: DashboardDateRangePreset | 'custom'; from?: string; to?: string; compare: 'previous_period' | 'previous_year' | 'none' }
  }
}
```

The preset union gains an explicit `'custom'` member: `preset: 'custom'` REQUIRES `from`/`to` (zod refinement); named presets ignore `from`/`to`. This is how a custom global range persists and round-trips.

**Storage vs response contract:** the dual shape applies only to the *stored* `layoutJson`. The layout **API response envelope is unchanged** — it already returns an object (`{ items, … }`); v2 adds the optional `preferences` field to it. No client ever receives a bare array, so array-expecting clients cannot exist at the API level.

Read path normalizes both shapes (shared normalizer used by the layout GET/PUT route **and** the PATCH `[itemId]` route); write path persists the object shape; the `DashboardLayout.layoutJson` entity property type widens to the union. `DashboardLayoutItem` keeps `{ id, widgetId, order, priority?, size?, settings? }` with `size: 'sm' | 'md' | 'lg' | 'full'` (v1's `sizeClass()` gains an explicit `full`→`lg` case — today an unknown size falls through to a 1-column span; grid spans in v2: sm=3, md=6, lg=9, full=12 of 12). Multiple instances of one `widgetId` are already supported (`id` is the instance key) — the Custom Metric widget relies on this.

## API Contracts

### GET `/api/dashboards/analytics/catalog`
- Guard: `requireAuth` + `dashboards.catalog.view`. Read-only, served from `AnalyticsRegistry` (in-memory).
- Response: `{ entities: [{ entityType, label, dateField, fields: [{ field, label, kind: 'numeric'|'text'|'uuid'|'timestamp'|'jsonb', aggregates: ('sum'|'avg'|'count'|'min'|'max')[], groupable: boolean }] }] }` — `kind` is the registry's own field-kind union (`packages/shared/src/modules/analytics.ts`); **`dateField` is the entity's canonical date field from its registry config** — the Custom Metric widget uses it for date-range filtering and time-granularity groupBy. The registry stores no aggregate/groupable/label metadata, so the catalog **derives** it: aggregates — `numeric` → `sum|avg|min|max|count`, all other kinds → `count`; groupable — `text`/`uuid` → true, `timestamp` → true (with granularity), `numeric`/`jsonb` → false; labels — humanized field/entity names with i18n override keys (`dashboards.catalog.entities.<entityType>`).
- Entities whose registry entries declare `requiredFeatures` are filtered against the caller's granted features (no entity names leak to users who can't query them).
- OpenAPI declared; tenant-safe (registry is code-defined, not data).

### Custom Metric settings → widget-data request (explicit mapping)
The widget's settings are a validated subset that maps 1:1 onto the **existing** `WidgetDataRequest`: `{ entityType, metric: { field, aggregate }, groupBy?: { field, granularity?, limit? }, visualization: 'kpi'|'line'|'bar'|'donut'|'table', title, dateRangeMode }`. View mode composes the request as: `entityType`/`metric`/`groupBy` verbatim from settings; `dateRange` from the global range (or the widget's custom one per `dateRangeMode`) applied over the catalog's `dateField`; `comparison` only for `kpi`. Visualization constraints (enforced in the settings UI): `kpi` = no groupBy; `line` = groupBy on `dateField` with granularity; `bar`/`donut`/`table` = categorical groupBy (+ `limit ≤ 20`). **Server-side authority is unchanged:** the widget-data route already validates `entityType`/fields against the `AnalyticsRegistry` and the caller's features — the catalog only improves the picker; it grants nothing.

### GET `/api/dashboards/insights?from=YYYY-MM-DD&to=YYYY-MM-DD&compare=previous_period|previous_year`
- Guard: `requireAuth` + `dashboards.insights.view`. Zod-validated query; range capped at 366 days. Comparison windows follow the explicit semantics defined in Architecture (range-based `previous_period` / `previous_year`).
- Response: `{ metrics: [{ key: 'revenue'|'orders'|'aov'|'new_customers', value, previousValue, deltaPct }], digest: { bullets: string[], generatedAt } | null, aiAvailable: boolean, cached: boolean }`
- Digest bullets are generated ONLY from the returned metrics payload (prompt embeds the numbers; model may not introduce new figures). Cached 1h per (tenant, org, from, to, compare) via DI cache with tag invalidation available.

### Existing routes (BC)
- `GET/PUT /api/dashboards/layout`: accepts legacy array and v2 object `layoutJson`; PUT zod schema gains `preferences` (optional) and `size: 'full'`. Response adds `preferences` (additive). PATCH item route unchanged.
- `POST /api/dashboards/widgets/data(/batch)`: `dateRange` gains optional `{ from, to }` custom variant (additive union member).

## Internationalization (i18n)

Module-owned strings (widgets, catalog picker, insights copy incl. the "Connect an AI provider…" hint) in `packages/core/src/modules/dashboards/i18n/{en,de,es,pl}.json`. Shell strings (`dashboard.*` flat dot-keys: greeting, date presets, compare labels, customize actions, legacy-switch labels) live where the existing shell keys live — `apps/mercato/src/i18n/{en,de,es,pl}.json` — and are mirrored into the create-app template (`yarn template:sync` / template i18n files) so scaffolded apps stay in sync. No hardcoded user-facing strings (checker-clean); internal errors prefixed `[internal]`.

## UI/UX

- **Header:** `text-2xl font-bold tracking-tight` greeting with user name (from layout context), org label; right side: DateRangePicker (popover, preset list + two date inputs for custom, compare select), refresh-all (existing `refreshToken` mechanism), Customize toggle. Dialog/popover keyboard rules: `Cmd/Ctrl+Enter` apply, `Escape` cancel; `aria-label` on all icon-only buttons; lucide-react icons.
- **KPI cards with sparklines — explicit data contract:** `KpiCard` gains an optional additive `trend?: number[]` prop rendering the existing `Sparkline`. KPI widgets (and the Custom Metric `kpi` visualization) fetch the trend as a **second batched widget-data request** — same `entityType`/`metric`, `groupBy` on the entity's date field with auto granularity over the active range — through the existing batch endpoint (one HTTP round-trip, standard 120s cache). Sparkline failure degrades to the scalar card (never blocks the KPI).
- **Grid:** 12-col (`grid-cols-12`), gap-4; responsive: sm widgets 2-up on md screens, stack on mobile. Cards `rounded-xl shadow-sm p-4 bg-card border-border`. KPI cards: label `text-overline font-semibold uppercase`, value `text-2xl font-bold`, delta chip on semantic status tokens (`{property}-status-{success|danger}-{role}` — up/down/neutral), sparkline (existing `Sparkline`).
- **Customize mode:** dnd-kit sortable reorder (keyboard-accessible), size menu (sm/md/lg/full) on the card, remove, add-widget catalog dialog (reuses existing allowed-widget resolution incl. role/user visibility), "Reset layout", link to legacy dashboard.
- **Repeatable widgets:** additive metadata flag `supportsMultipleInstances?: boolean`. The v1 add-widget flow filters out already-added `widgetId`s, which would block a second Custom Metric; the v2 add dialog keeps widgets with this flag addable regardless of existing instances (each add creates a new layout-item `id`). `dashboards.analytics.customMetric` declares it; the legacy screen keeps v1 behavior (flagged widgets simply can't be added twice there — acceptable).
- **Loading:** skeleton cards (no spinners on first paint); per-widget `ErrorMessage` + retry; `EmptyState` with "Add widgets" CTA when layout is empty.
- **AI Insights widget (md):** digest bullets with delta chips; numbers-only fallback + provider hint when `aiAvailable: false`; "Generated at …" caption; refresh honors the 1h cache (`force=1` not exposed in v1).
- **Custom Metric widget (settings mode):** entity → field → aggregate → optional groupBy/granularity → visualization (kpi | line | bar | donut | table) → title. View mode renders via existing chart wrappers + `useWidgetData`.
- **Boy Scout:** any touched v1 lines migrate to semantic tokens.

### Frontend Architecture Contract

| Route / surface | Server root | Client islands | Data owner |
|---|---|---|---|
| `/backend` | `apps/mercato…/backend/page.tsx` (unchanged, server) | `DashboardScreenV2` (+ lazy widget clients) | `/api/dashboards/*` |
| `/backend/dashboard/legacy` | new `legacy/page.tsx` (server) | `DashboardScreenLegacy` | same APIs |

`"use client"` ledger (new files): `DashboardScreenV2.tsx` (layout state, DnD, save queue), `DashboardHeader.tsx` (popover state), `DateRangePicker.tsx` (form state), `WidgetCardV2.tsx` (settings flip, dnd handle), `GridLayout.tsx` (dnd-kit context), `custom-metric/widget.client.tsx` + `ai-insights/widget.client.tsx` (data fetching, settings). Widget clients stay lazy via `lazyDashboardWidget`. Budgets: no new page-root `"use client"` (page roots stay server); each new client file ≤300 LOC (split otherwise — `DashboardScreenV2` composes, never monoliths); no heavy browser SDKs (dnd-kit + recharts already present, lazy); hydration proof = Playwright route load + interaction tests (below); `yarn check:client-boundaries` clean.

Writes: layout PUT/PATCH from v2 go through `useGuardedMutation` (file-level optimistic-lock/mutation-guard coverage — v2 files are new and must comply; no raw `fetch`; `apiCall` everywhere).

## Migration & Compatibility

Contract surfaces touched (all ADDITIVE per `BACKWARD_COMPATIBILITY.md` §27):
- `@open-mercato/ui/backend/dashboard` exports: `DashboardScreen` keeps its (prop-less) signature — new implementation; `DashboardScreenLegacy` added. Standalone apps importing `DashboardScreen` get v2 automatically and can pin `DashboardScreenLegacy` if desired (release-notes entry).
- `DashboardWidgetModule` / `DashboardWidgetComponentProps` / `DashboardLayoutItem` (shared types): optional fields + enum value added; nothing removed or renamed. All existing widgets render unchanged (verified in tests); existing `packages/ui` dashboard test files updated where they assert on the old export wiring.
- API: new routes only; existing routes accept strictly more (layout object shape, `full` size, custom dateRange). Old clients (v1 screen, mobile shells) keep working: array layout still accepted and returned fields unchanged.
- ACL: new feature ids `dashboards.insights.view`, `dashboards.catalog.view` (additive; synced to admin+employee defaults in module setup; #2151 noted — declared with explicit dependency on `dashboards.view`). The insights route additionally enforces each KPI's source-entity `requiredFeatures` (per-entity RBAC, matching the widget-data route).
- Release notes: a RELEASE_NOTES.md entry documents the `DashboardScreen` v2 swap, the `DashboardScreenLegacy` escape hatch (`/backend/dashboard/legacy`), and the exact command that rolls the two new widget ids onto existing tenants' role allowlists (the module-setup sync used by deploys; named in the entry).
- No DB schema change; no event-id, widget-spot, or DI-key changes. `layoutJson` object shape is forward-written only after a user saves on v2; until then stored data is untouched.
- Rollback: revert release OR point users at `/backend/dashboard/legacy`; v2-saved layouts remain readable by v1 route code (normalizer ships in the same change as the shape).

## Implementation Plan

Each phase leaves the app green (build + tests).

### Phase 1 — Contract & API groundwork
1. `packages/shared/…/widgets.ts`: add `'full'` size, `context.dateRange?`, `metadata.respectsDashboardDateRange?`, `metadata.supportsMultipleInstances?` (+ types exported). `dashboards/api/openapi.ts`: widen `defaultSize`/layout schemas accordingly (+ `preferences`).
2. `dashboards/data/validators.ts` + `api/layout/route.ts` + `api/layout/[itemId]/route.ts` + `data/entities.ts`: shared dual-shape layoutJson normalizer (read array|object, write object; PATCH resolves items through it), `preferences` passthrough, size enum, entity property type widened. v1 `sizeClass()` gains the `full`→`lg` case.
3. Widget-data validator: custom `{from,to}` dateRange member; `WidgetDataService`/`buildAggregationQuery` support (existing preset path untouched); `lib/dateRanges.ts#getPreviousPeriod` range-based path + honor `previous_year` (currently validated but ignored).
4. Unit tests: layout shape normalizer round-trips (incl. PATCH path + GET-flush shape preservation); validator BC (old payloads still pass); comparison-window math (custom previous_period / previous_year).

### Phase 2 — v2 shell
5. `packages/ui/src/backend/dashboard/v2/*`: screen, header, date-range picker, grid (dnd-kit), card, skeletons; legacy impl moves to `legacy/DashboardScreenLegacy.tsx`; `DashboardScreen.tsx` becomes the compat shim; `index.ts` re-exports (`DashboardScreen`→v2, `DashboardScreenLegacy`). v2 add dialog honors `supportsMultipleInstances`.
6. Legacy route page in `dashboards/backend/dashboard/legacy/` (+ meta guard).
7. Analytics widgets (10 files): `dateRangeMode: 'global' | 'custom'` tri-state (hydrator defaults missing → `'global'`), consume `context.dateRange`; KPI widgets fetch the sparkline series via the batch endpoint and pass `trend` to `KpiCard` (new optional prop).
8. Unit tests: date-preset resolution; screen renders widgets from a mocked registry; size mapping; `dateRangeMode` hydration; KpiCard trend rendering.

### Phase 3 — Custom Metric widget
9. `api/analytics/catalog/route.ts` (+ openapi) over `AnalyticsRegistry`.
10. `widgets/dashboard/custom-metric/*` (settings builder + view via chart wrappers).
11. Unit tests: catalog shape; settings hydrate/dehydrate.

### Phase 4 — AI Insights
12. `lib/kpiRequests.ts` (extract the four KPI `WidgetDataRequest` builders; refactor the KPI widgets to import them). `lib/insights.ts` (deterministic metrics via `WidgetDataService` + `kpiRequests`; per-entity `requiredFeatures` RBAC; digest via `createModelFactory` `generateObject`, mirroring `inbox_ops/lib/llmProvider.ts`; numeric post-validation of bullets against the metrics payload; DI cache 1h keyed on the full effective org scope + range + compare).
13. `api/insights/route.ts` (+ openapi); `widgets/dashboard/ai-insights/*`.
14. acl.ts additions (`dependsOn: ['dashboards.view']` — supported via `shared/src/security/aclDependencies.ts`) + `sync-role-acls`/setup role sync + role-allowlist append for the two new widget ids (existing tenants); i18n for all four locales.
15. Unit tests: insights computation with mocked service; no-provider fallback; cache hit path; per-entity RBAC omission; numeric post-validation drops a mocked hallucinated bullet (fabricated number) and degrades to numbers-only when all bullets fail.

### Phase 5 — Integration tests, DS pass, docs
16. Integration tests below; `om-ds-guardian` pass; `apps/docs` dashboards page refresh (screenshots deferred to QA).

## Integration Test Coverage (mandatory — ships with this change)

Module-local `packages/core/src/modules/dashboards/__integration__/` (self-contained fixtures via API, cleanup in teardown):
- **TC-DB2-001 — insights API.** Seed orders across two periods via API; `GET /api/dashboards/insights` returns correct value/previous/deltaPct per metric (numbers equal what the KPI widgets' shared request builders produce); 403 without `dashboards.insights.view`; **metrics whose source entity the caller lacks `requiredFeatures` for are omitted**; 400 on invalid range; `aiAvailable:false` + `digest:null` when no provider configured (deterministic CI path); second call `cached:true`.
- **TC-DB2-002 — analytics catalog API.** Returns registered entity types with fields/aggregates; 403 without feature; entries match `AnalyticsRegistry` (e.g., `sales:orders` present).
- **TC-DB2-003 — layout BC round-trip.** PUT the pre-v2 body (`{items}` without `preferences` — the only body shape the route ever accepted; the *stored* legacy array shape is normalizer-covered by unit tests) → GET returns normalized items (BC); PUT v2 object with `preferences.dateRange` + a `full`-size item → GET round-trips both; **PATCH `/api/dashboards/layout/:itemId` succeeds after an object-shape PUT** (dual-shape normalizer in the PATCH route); invalid size rejected 400; second user's layout isolated (tenant/user scoping).
- **TC-DB2-004 — /backend v2 UI (Playwright, two tests).** (a) Route loads with KPI skeletons → cards render **including a sparkline SVG in a KPI card**; change global preset → widgets refetch (network assertion on batch request carrying the new range) and the trigger label commits. (b) Customize: reorder via pointer drag-and-drop (dnd-kit; the KeyboardSensor stays wired for a11y), resize to `full`, add widget from catalog, save → reload persists; legacy route renders `DashboardScreenLegacy` at `/backend/dashboard/legacy`.
- **TC-DB2-005 — custom metric widget (Playwright).** Add Custom Metric, configure `sales:orders` count by day (line), renders chart from real seeded data; second instance with different config coexists.

## Risks & Impact Review

#### Default-screen swap regresses a daily-use surface
- **Scenario:** v2 bug (hydration, layout save, widget crash) degrades the landing page for all users at once.
- **Severity:** High
- **Affected area:** `/backend` home, all tenants.
- **Mitigation:** legacy screen + route ships in the same release; v2 reuses v1's data paths (registry, layout API, widget data) so blast radius is the shell, not data; per-widget error boundaries keep one bad widget from killing the page; Playwright coverage on the critical paths.
- **Residual risk:** visual polish issues → acceptable, needs-qa label + self-QA evidence.

#### Layout dual-shape normalizer corrupts saved layouts
- **Scenario:** normalizer mishandles legacy arrays → user layouts reset or fail validation on PUT.
- **Severity:** Medium
- **Affected area:** dashboards layout API (both screens).
- **Mitigation:** pure function + unit tests both directions; TC-DB2-003 round-trips (including PATCH-after-object-PUT); write path only upgrades shape on explicit user save. Note: the existing GET handler already flushes normalized items back on read (`layout/route.ts`) — the normalizer must be shape-preserving on that path (never rewrites a legacy array to the object shape without an explicit user save).
- **Residual risk:** low.

#### Cross-tenant/insights leakage
- **Scenario:** insights or catalog responses leak another org's aggregates via cache-key or scoping bugs.
- **Severity:** Critical
- **Affected area:** insights API, cache.
- **Mitigation:** all aggregation flows through the existing org/tenant-scoped `WidgetDataService`; cache keys embed tenantId+orgId (mirrors existing widget-data cache); catalog is code-defined metadata (no tenant data); integration tests assert scoping.
- **Residual risk:** minimal — same class of controls as the existing widget data path.

#### LLM digest wrong/embarrassing output
- **Scenario:** model states numbers not in the payload or hallucinates causes.
- **Severity:** Medium
- **Affected area:** AI Insights widget.
- **Mitigation:** metrics computed deterministically and displayed independently of the digest; prompt constrains to provided figures with JSON schema output; low temperature; digest is clearly labeled AI-generated; cache limits cost; kill-switch = revoke `dashboards.insights.view` or leave provider unconfigured.
- **Residual risk:** narrative-quality variance — acceptable for an explicitly-AI feature.

#### Widget-data custom range performance
- **Scenario:** long custom ranges (≤366d) on large orgs produce slow aggregation queries.
- **Severity:** Low/Medium
- **Affected area:** widget data API.
- **Mitigation:** range cap; existing 120s cache; identical query shape to existing presets (already indexed by scoping columns); no N+1 (batch endpoint).
- **Residual risk:** slow first paint on cold cache for huge tenants — same as v1 today.

## Final Compliance Report — 2026-07-02

### AGENTS.md Files Reviewed
- `AGENTS.md` (root), `packages/core/AGENTS.md` (API Routes, Widgets, Access Control, Encryption), `packages/ui/AGENTS.md` + `packages/ui/src/backend/AGENTS.md`, `packages/shared/AGENTS.md`, `packages/cache/AGENTS.md`, `packages/ai-assistant/AGENTS.md`, `.ai/ds-rules.md`, `.ai/specs/AGENTS.md`, `BACKWARD_COMPATIBILITY.md`.

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| root AGENTS.md | No cross-module ORM relations | Compliant | No new entities; catalog/insights read code-defined registry + scoped aggregates |
| root AGENTS.md | Tenant/org scoping everywhere | Compliant | All reads via scoped `WidgetDataService`; cache keys embed scope |
| root AGENTS.md | Optimistic locking on new editable entities | N/A → Compliant | No new entities; new UI writes use `useGuardedMutation` (file-level guard satisfied) |
| root AGENTS.md | zod validation, `z.infer`, no `any` | Compliant | New/extended validators in `data/validators.ts` |
| core AGENTS.md | Routes export openApi | Compliant | Both new routes declare openApi |
| core AGENTS.md | Feature-gated guards via acl.ts ids | Compliant | Two new feature ids, declared + role-synced (with `dependsOn: dashboards.view`) |
| core AGENTS.md | Encryption for sensitive columns | N/A | No new persisted PII; digest cache holds aggregate numbers only |
| ui AGENTS.md | `apiCall`/`useGuardedMutation`, `LoadingMessage`/`ErrorMessage`, dialogs Cmd+Enter/Esc, pageSize ≤100 | Compliant | Specified in UI/UX section |
| root AGENTS.md / i18n | No hardcoded user-facing strings | Compliant | i18n section; 4 locales |
| ds-rules | Semantic status tokens; no arbitrary values; chart token palette | Compliant | Delta chips + charts on tokens |
| BACKWARD_COMPATIBILITY.md | Contract surfaces additive-only or deprecation protocol | Compliant | Additive types/enum/API fields; `DashboardScreen` behavior swap mitigated by legacy export + route + release note |
| cache AGENTS.md | DI-resolved cache, tag invalidation | Compliant | Insights cache via DI with scope tags |

### Internal Consistency Check

| Check | Status |
|-------|--------|
| Data models match API contracts | Pass |
| API contracts match UI/UX section | Pass |
| Risks cover all write operations | Pass (layout writes only) |
| Commands defined for all mutations | N/A — no new mutations beyond existing layout route |
| Cache strategy covers all read APIs | Pass (insights 1h; catalog in-memory; widget-data existing 120s) |

### Non-Compliant Items
None identified.

### Verdict
**Fully compliant** — ready for implementation (pending pre-implement audit + spec-stage cross-model review).

## Changelog
### 2026-07-03
- Post-review iteration (user feedback after visual QA of the running app): (1) **drag morph fixed** — the sortable grid item used `CSS.Transform` (which bakes dnd-kit's `scaleX`/`scaleY` for mixed-size neighbours) and comically stretched the dragged card; switched to `CSS.Translate` so it keeps its own size. (2) **Flagship widgets highlighted** — the Add-widget dialog now has a "Featured" section that promotes Custom Metric + AI Insights with icons, descriptions, and a brand accent, so self-serve metric building and the AI digest are discoverable instead of buried. (3) **Confirmed per-user scope** — layouts are already scoped by `userId` (never global); presets inherit the same per-user scoping. (4) **Dashboard presets/Views added** — named layout snapshots in `layoutJson` (`presets[]` + `activePresetId`, capped at 12, no migration), a header `PresetSwitcher` to save/switch/delete, with the top-level layout mirroring the active view for BC. New `layoutState` normalizer + validator coverage; i18n across 4 locales + create-app template.

### 2026-07-02
- Initial specification (research: repo deep-dive + competitor/library analysis; grounded against current dashboards module, shared widget contract, feature_toggles, ai-assistant model factory).
- Pre-implement audit applied (`.ai/specs/analysis/ANALYSIS-2026-07-02-dashboard-v2-analytics-home.md`): PATCH `[itemId]` route added to the dual-shape work; new-widget role-allowlist rollout for existing tenants; explicit custom-range comparison semantics (incl. fixing ignored `previous_year`); catalog metadata derivation rules aligned to the registry's real field kinds; v1 `sizeClass` `full` mapping; entity type widening; GET-flush shape preservation.
- Code-review jury applied (fresh Claude reviewer FAIL→fixed; DeepSeek 1 blocker; Kimi 3 blockers; Codex 2 confirmed + 1 recorded disagreement): legacy `sizeClass` `full`→`lg` mapping (+ its local type union); 14 missing `aiInsights` i18n keys across 4 locales + `generatedAt` placeholder mismatch; Reset-layout gated on `canConfigure` (menu + handler); `retryLastMutation` added to the guarded-mutation context; `apps/docs` dashboards page refreshed for v2; digest numeric validation whitelists range-derived numbers so comparison-window phrasing survives; layout save queued outside the React state updater (StrictMode double-PUT); default global range resolved at call time (midnight staleness); Codex's insights-RBAC org-scope objection verified as matching the existing widget-data route convention (recorded as platform-level follow-up, not a regression). During integration verification the suite also caught and fixed three v2 product bugs: background `load()` clobbering the user's chosen date range, background reloads cancelling in-flight drags, and `handleReorder` splicing without reindexing `order` so every reorder silently reverted.
- Spec-stage cross-model jury applied (Codex + Kimi + DeepSeek, all `fail` → reconciled): `dateRangeMode` tri-state for global-vs-widget range; per-entity `requiredFeatures` RBAC on insights; insights cache key = full effective org scope; `supportsMultipleInstances` repeatable-widget contract; KPI sparkline series contract (`KpiCard.trend` + batched groupBy request); digest numeric post-validation (enforced, not prompted); `lib/kpiRequests.ts` single source of truth for KPI definitions; catalog `dateField` + Custom-Metric→widget-data mapping; `preset: 'custom'` persistence rule; `api/openapi.ts` schema widening; storage-vs-response-envelope clarification; deep-import compat shim (`DashboardScreen.tsx` re-exports v2); RELEASE_NOTES.md entry incl. tenant rollout command.
