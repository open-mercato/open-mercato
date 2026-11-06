# Dashboard v2 — Custom Metric wizard, drag-resize, catalog i18n

- **Status:** Draft
- **Scope:** OSS (core platform — `dashboards` module + `@open-mercato/ui` backend dashboard + `@open-mercato/shared` widget contract)
- **Date:** 2026-07-03
- **Owner:** Platform
- **Slug:** `dashboard-v2-metric-wizard-resize-i18n`
- **Follows:** [`2026-07-02-dashboard-v2-analytics-home.md`](2026-07-02-dashboard-v2-analytics-home.md)

## TLDR

**Key Points:**
- A post-QA follow-up to Dashboard v2 that fixes three usability defects surfaced while using the running app: (1) adding a **Custom Metric** widget silently appends an empty card below the fold, so the action looks broken; (2) the Custom Metric **"Źródło danych" (data source) and "Pole" (field) dropdown values render in English even in Polish**; (3) resizing a widget is only possible through a discrete size menu, which is unintuitive.
- **Fix 1 — Guided Custom Metric wizard with live preview.** A multi-step dialog (Data source → Measure → Visualize → Refine) with a persistent preview pane rendering the *real* widget on *real* data as you configure. Launched from the Add-widget dialog (pre-add) and re-opened for edit from the card. Retires the inline settings stack for Custom Metric; the never-empty card removes the "nothing happened" moment.
- **Fix 2 — Localize the analytics catalog labels.** Entity labels gain the `dashboards.catalog.entities.<entityType>` keys the v2 spec already promised but never shipped; field labels move from bare `humanize()` to a translated two-level fallback. Keys added for all 7 registered entities + their fields across `en/de/es/pl`.
- **Fix 3 — Drag-to-resize snapping to the existing sizes.** Edit-mode edge handles snap a card to `sm/md/lg/full`; the discrete `SizeMenu` stays as the keyboard/a11y fallback.
- **Zero new production dependencies, zero DB migrations, zero contract removals.** The only shared-contract change is **additive** (an optional `SetupWizard` field + `DashboardWidgetSetupProps` type on the widget module), so every existing widget and third-party consumer is unaffected.

**Scope:**
- `@open-mercato/shared` widget contract: additive optional `DashboardWidgetModule.SetupWizard` + `DashboardWidgetSetupProps` type.
- `@open-mercato/ui` `packages/ui/src/backend/dashboard/v2/`: wizard host wiring in `DashboardScreenV2`, edge drag-resize in `GridLayout`, gear→wizard routing + scroll-into-view in `WidgetCardV2`.
- `dashboards` module Custom Metric widget: extract shared catalog/field logic into `lib.ts`, add `SetupWizard.tsx`, wire `widget.ts`, slim `widget.client.tsx`.
- `dashboards` module `GET /api/dashboards/analytics/catalog`: localized entity + field labels.
- i18n: `dashboards.catalog.*` keys across `en/de/es/pl`.
- Unit + integration test coverage.

**Concerns:**
- Retiring the Custom Metric inline settings panel changes how existing Custom Metric cards are edited. Mitigated: the wizard is seeded from the same `CustomMetricSettings` and writes the same shape, so no persisted data changes; other widgets keep the inline panel.
- Drag-resize must not fight the dnd-kit sortable. Mitigated: only the grip carries drag listeners; the resize handle is a separate element with its own pointer handlers that `stopPropagation`.

## Overview

Dashboard v2 shipped the widget shell, the global date range, the Custom Metric widget, AI Insights, and Views. Using it against real data exposed three friction points that undercut the "best-in-class" goal: the flagship self-serve widget is effectively undiscoverable to configure, its builder shows English field names in non-English locales, and the sizing affordance does not match the direct-manipulation expectation a 12-column grid sets. All three are contained to the dashboard surface and share no data model, so they can ship together as polish without touching the v2 architecture.

## Problem Statement

1. **Silent add (Custom Metric).** `handleAddWidget` (`packages/ui/src/backend/dashboard/v2/DashboardScreenV2.tsx`) appends the widget with `meta.defaultSettings` and closes the dialog. Custom Metric's default is `entityType: null`, so it renders an `EmptyState` (`widget.client.tsx`) and is inserted last (`order: prev.length`) — below the fold on a populated dashboard. There is no scroll-to, no auto-open, no highlight. The only path to configuration is entering edit mode, locating the card, and clicking the gear. The user reads this as "nothing happened / it's broken."
2. **Untranslated catalog values.** In `api/analytics/catalog/route.ts`, entity labels use `translate('dashboards.catalog.entities.<entityType>', humanize(entityType))` but **no `dashboards.catalog.entities.*` keys exist in any locale**, so entities always fall back to English `humanize()`. Field labels use bare `humanize(field)` with **no translate call at all**, so they are always English. The `settings.entity` label ("Źródło danych") and `settings.field` label ("Pole") are translated, but their option values are not.
3. **Discrete-only resize.** Sizing is available only through the `SizeMenu` popover (`WidgetCardV2.tsx`), a button listing `sm/md/lg/full`. A 12-column grid invites direct edge-drag resizing; its absence makes sizing feel hidden and clumsy.

## Proposed Solution

Keep the v2 substrate — widget registry, `DashboardWidgetModule` contract, layout persistence, `WidgetDataService`/`AnalyticsRegistry`, the batched widget-data fetcher, Recharts wrappers — and add a wizard seam, an edge-resize interaction, and the missing i18n.

### Design Decisions

| Decision | Rationale |
|----------|-----------|
| Add an **optional** `SetupWizard` to `DashboardWidgetModule` (+ `DashboardWidgetSetupProps`) rather than a Custom-Metric-only hook in the shell | Keeps the v2 shell decoupled from widget specifics: the shell renders `widgetModule.SetupWizard` when present; the Custom Metric wizard lives in core next to its widget. Additive optional field → BC-safe (§ ADDITIVE-ONLY types). |
| Wizard preview renders the **real** `CustomMetricWidget` in `view` mode with draft settings | `useWidgetData` already has a standalone single-request fallback outside `WidgetDataBatchProvider`, so the preview shows real aggregated data with no duplicate chart code. Gating "Finish" on `buildRequest(...) !== null` reuses the widget's own validity rule. |
| Custom Metric create **and** edit both go through the wizard; retire its inline settings stack | One polished, previewable surface instead of a long unguided select stack; removes the empty-card-below-the-fold failure entirely. Other widgets (e.g. AI Insights) keep the generic inline settings panel unchanged. |
| Extract Custom Metric catalog/field logic into `custom-metric/lib.ts` (+ `useCustomMetricCatalog`) | The wizard and any residual inline rendering share one source of truth for field eligibility, aggregate options, group-by rules, and `normalizeSettings`; slims the 390-line `widget.client.tsx`. |
| Drag-resize snaps to the **existing** `sm/md/lg/full` sizes via a fraction-of-container calc; no new size model | Backward-compatible: reuses `onSizeChange` → `updateLayout` → PUT with no persistence or contract change. Fraction-based snapping is breakpoint-agnostic. Finer-grained spans were rejected to avoid a `DashboardWidgetSize` contract change. |
| Keep `SizeMenu` as the keyboard/a11y fallback | Edge-drag is pointer-only; the menu preserves keyboard and screen-reader control. |
| Field labels resolve via a **two-level** fallback: `dashboards.catalog.fields.<entityType>.<field>` → `dashboards.catalog.fields.<field>` → `humanize(field)` | Most field names repeat across entities (`status`, `createdAt`, `currencyCode`, `grandTotalGrossAmount`, …); a shared field key set stays DRY, with per-entity overrides only where humanization is ambiguous. Server-side resolution means the widget/wizard need no client change. |

### Alternatives Considered

- **Auto-open inline settings on add (no wizard).** Lighter, but keeps the unguided select stack and offers no real preview; rejected in favor of the wizard per product direction.
- **Generic configure-on-add for every widget.** Broader surface change touching all widgets for no immediate benefit (only Custom Metric needs setup); the additive seam leaves this open for later without doing it now.
- **Finer-grained column spans / free x-y resize.** Changes the `DashboardWidgetSize` contract and layout persistence and re-introduces collision complexity the v2 spec deliberately avoided; rejected.
- **Client-side label translation.** Would duplicate the catalog's field-eligibility knowledge in the client; server-side is the single source and keeps the wire payload localized.

## Architecture

### Shared contract (`packages/shared/src/modules/dashboard/widgets.ts`)

```ts
export type DashboardWidgetSetupProps<TSettings = unknown> = {
  open: boolean
  initialSettings: TSettings
  context: DashboardWidgetRenderContext
  onComplete: (settings: TSettings) => void
  onCancel: () => void
}

export type DashboardWidgetModule<TSettings = unknown> = {
  metadata: DashboardWidgetMetadata
  Widget: ComponentType<DashboardWidgetComponentProps<TSettings>>
  hydrateSettings?: (raw: unknown) => TSettings
  dehydrateSettings?: (settings: TSettings) => unknown
  SetupWizard?: ComponentType<DashboardWidgetSetupProps<TSettings>> // NEW, optional
}
```

Both additions are optional; no existing field changes. `DashboardWidgetMetadata` is unchanged (presence of `SetupWizard` is the sole signal).

### Custom Metric widget (`packages/core/src/modules/dashboards/widgets/dashboard/custom-metric/`)

- `lib.ts` (new): pure helpers moved out of `widget.client.tsx` — `normalizeSettings`, `metricFields`, `groupFields`, `findField`, `firstMetricField`, `buildRequest`, `clampLimit`, the `CatalogEntity`/`CatalogField` types, `VISUALIZATIONS`/`GRANULARITY_OPTIONS`, and `useCustomMetricCatalog()` (the catalog fetch/loading/error hook).
- `SetupWizard.tsx` (new): the `DashboardWidgetSetupProps<CustomMetricSettings>` dialog. Uses `StepIndicator`, `Select`, `Input`, `DateRangeSelect`, `Button`, `Dialog`. Renders the live preview by mounting `CustomMetricWidgetClient` in `mode="view"` with the draft settings and the passed `context`, wrapped in a `WidgetDataBatchProvider`. Steps:
  1. **Data source** — entity select (labels from the catalog API, now localized).
  2. **Measure** — aggregate select + metric field select (driven by `metricFields`).
  3. **Visualize** — visualization select; conditionally group-by (+ granularity for `line`, + limit for `bar/donut/table`).
  4. **Refine** — title input, date-range mode + preset.
  - "Finish" disabled until `buildRequest(normalized, entity, context) !== null`. `Cmd/Ctrl+Enter` finishes; `Escape` cancels.
- `widget.ts`: add `SetupWizard` to the module, lazy-loaded (`React.lazy(() => import('./SetupWizard'))`, rendered under `Suspense` by the shell) so it stays code-split. Metadata unchanged.
- `widget.client.tsx`: import helpers from `lib.ts`; the `mode === 'settings'` branch is removed (Custom Metric is configured via the wizard). `view` rendering is unchanged.

### Shell (`packages/ui/src/backend/dashboard/v2/`)

- `DashboardScreenV2.tsx`:
  - New state `wizard: { widgetId; itemId: string | null; initialSettings } | null`.
  - **Add flow:** in `AddWidgetDialog`'s `onAdd`, if the selected widget's loaded module exposes `SetupWizard`, open the wizard (`itemId: null`, `initialSettings = meta.defaultSettings`) instead of appending. On `onComplete(settings)`, append the fully-configured item and scroll it into view; on `onCancel`, no-op. Non-wizard widgets append as today.
  - **Edit flow:** a card requests edit via a new `onEditSettings` (wizard widgets) vs. the existing `onToggleSettings` (inline). Wizard edit opens the wizard with `itemId` + the item's hydrated settings; `onComplete` updates that item's `settings`.
  - After any add (wizard or direct), scroll the new card into view via a ref keyed by the new item id.
  - Renders `widgetModule.SetupWizard` for the active `wizard.widgetId`.
- `GridLayout.tsx`:
  - `SortableGridItem` renders an edit-mode resize handle (right edge + bottom-right corner affordance). Pointer-drag computes `fraction = (pointerX − cardLeft) / containerWidth`, snaps to nearest of `[0.25, 0.5, 0.75, 1.0]`, maps to `{sm, md, lg, full}` via a new `fractionToSize` helper (with `sizeToFraction` for the inverse), and calls a new `onResize(item.id, size)` prop live; a snap outline previews the target span. Handle is its own element with `onPointerDown`/`stopPropagation` so the dnd-kit sortable never activates; enabled at `md+`.
  - `GridLayoutProps` gains `onResize: (id: string, size: DashboardWidgetSize) => void`; the container measures width via a `ref`.
- `WidgetCardV2.tsx`:
  - The settings gear routes to the wizard when the widget module has `SetupWizard`, otherwise to the inline `onToggleSettings` (unchanged). `SizeMenu` stays.

### Catalog i18n (`packages/core/src/modules/dashboards/api/analytics/catalog/route.ts`)

- Entity label: unchanged call shape; keys added.
- Field label: replace `label: humanize(field)` with `label: resolveFieldLabel(entityType, field, translate)` where

```ts
function resolveFieldLabel(entityType, field, translate) {
  const humanized = humanize(field)
  const shared = translate(`dashboards.catalog.fields.${field}`, humanized)
  return translate(`dashboards.catalog.fields.${entityType}.${field}`, shared)
}
```

`translate` already returns its fallback when a key is missing, so the chain degrades cleanly to humanized English.

## Data Models

None. No entity, migration, or `layoutJson` shape change. Widget size persistence reuses the existing `DashboardWidgetSize` union and the current PUT `/api/dashboards/layout` payload.

## API Contracts

- `GET /api/dashboards/analytics/catalog` — **response shape unchanged**; `entities[].label` and `entities[].fields[].label` are now localized to the request locale instead of always-English `humanize()`. No schema, status, or field change; OpenAPI doc unchanged.
- No new endpoints. Layout PUT/GET unchanged.
- Shared type contract: `DashboardWidgetModule` gains an optional `SetupWizard`; `DashboardWidgetSetupProps` is a new exported type. Additive per BACKWARD_COMPATIBILITY (types are ADDITIVE-ONLY).

## Integration & Test Coverage

**Unit**
- `fractionToSize` / `sizeToFraction` round-trip and snap boundaries (`packages/ui`).
- `resolveFieldLabel` two-level fallback (per-entity override → shared → humanize) and entity-label key usage — extend `api/analytics/catalog/__tests__/route.test.ts` with a translate spy asserting the keys requested for both entity and field labels.
- Wizard Finish-gating: `buildRequest` returns `null` until entity + metric (and group-by where required) are set (`custom-metric` lib test).

**Integration (Playwright, extends the TC-DB2 suite)**
- **TC-DB2-006 — Custom Metric wizard.** Enter customize → Add widget → pick Custom Metric → wizard opens → choose source/measure/visualization → preview renders a numeric value → Finish → a configured KPI card appears (not an empty state) → reload persists the configuration. Self-contained: creates its own fixtures via API where needed, cleans up the layout in teardown.
- **TC-DB2-007 — Drag resize.** Enter customize → drag a card's edge handle rightward → it snaps to `full` (12-col span) → save → reload persists the size.

## Risks & Impact Review

| # | Risk / failure scenario | Severity | Affected area | Mitigation | Residual |
|---|-------------------------|----------|---------------|------------|----------|
| 1 | Retiring the inline settings panel breaks editing of Custom Metric cards created before this change | Medium | dashboards custom-metric | Wizard is seeded from the same hydrated `CustomMetricSettings` and writes the same dehydrated shape; no persisted data migration; other widgets keep inline settings | Low |
| 2 | Resize handle competes with dnd-kit sortable, causing accidental reorders or stuck drags | Medium | ui GridLayout | Only the grip button carries sortable listeners; the resize handle is a separate element with its own `onPointerDown` + `stopPropagation`; enabled only in edit mode at `md+` | Low |
| 3 | Wizard preview issues an unbatched widget-data request per keystroke (load/cost) | Low | dashboards widget-data API | Preview updates are debounced/settings-driven (recompute only on committed setting changes, not raw input), and reuse the same authenticated single endpoint already used for standalone widget previews | Low |
| 4 | Missing/incorrect locale keys leave some labels English or mis-humanized | Low | i18n | Two-level fallback always degrades to humanized English (never a raw key); `yarn i18n:check` / `i18n:check-values` cover coverage; unit test asserts key usage | Low |
| 5 | Third-party widget module authored against the old `DashboardWidgetModule` type | Low | shared contract | `SetupWizard` is optional; absence = current behavior; no field removed or renamed | None |

## Implementation Status

| Phase | Status | Date | Notes |
|-------|--------|------|-------|
| 1 — Foundation (shared contract + lib extraction) | Done | 2026-07-03 | `DashboardWidgetSetupProps` + optional `SetupWizard` added additively; Custom Metric logic extracted to `custom-metric/lib.ts`; `widget.client.tsx` slimmed (inline settings branch removed) |
| 2 — Catalog i18n | Done | 2026-07-03 | `resolveFieldLabel` two-level fallback in the catalog route; `dashboards.catalog.*` keys added across en/de/es/pl; verified live in Polish (entities + fields, incl. per-entity `id` override) |
| 3 — Drag-resize | Done | 2026-07-03 | `sizeSnap.ts` helpers; edge handle in `GridLayout`; `onResize` wired to the existing size-change path; `SizeMenu` kept; stable `DndContext id` added |
| 4 — Wizard | Done | 2026-07-03 | `custom-metric/SetupWizard.tsx` (4 steps + debounced live preview of the real widget); shell add/edit routing + scroll-into-view; `WidgetCardV2` gear routes to wizard for wizard-widgets |
| 5 — Tests + gate | Done | 2026-07-03 | Unit (snap helpers, lib `buildRequest` gating, catalog route localization); TC-DB2-004 updated for the wizard add-flow; TC-DB2-006 (wizard) + TC-DB2-007 (resize) added |

## Final Compliance Report

- **Typecheck:** `yarn typecheck` — 21/21 packages pass.
- **Build:** `yarn build:packages` — 21/21 pass; `yarn generate` clean.
- **Unit tests:** `@open-mercato/core` custom-metric (`config`, `lib`) + `analytics/catalog/route` (entity/field localization) pass; `@open-mercato/ui` `sizeSnap` passes.
- **i18n:** `yarn i18n:check` — sync/usage/hardcoded pass (values check is advisory Phase-1, exit 0). Catalog + wizard keys added to the 4 dashboards-module locales; `dashboard.v2.resizeWidget` added to the 4 app + 4 template locales; all files kept codepoint-sorted.
- **Live verification (dev app, port 3400):** (1) Add → Custom Metric opens the wizard; picking a data source renders a real-data KPI preview ("count of Sales orders = 4"); Finish persists a **configured** widget (`entityType: sales:orders`), not an empty card. (2) In Polish, the "Źródło danych" dropdown shows localized values ("Zamówienia sprzedaży", "Produkty", …) and field labels are Polish (catalog API: "Kanał", "Waluta", "Suma całkowita (brutto)", `id` → "Zamówienie"). (3) Dragging a card's edge handle snapped `md → sm` and persisted via the layout PUT.
- **Backward compatibility:** the only contract-surface change is additive — `DashboardWidgetModule` gains an optional `SetupWizard` field and a new `DashboardWidgetSetupProps` type. No field removed/renamed, no route/schema/DB/DI/ACL/event change. `GET /api/dashboards/analytics/catalog` response shape is unchanged (labels are now localized).
- **Known minor artifact:** opening the wizard from the Add-widget dialog leaves the closed Add-widget dialog mounted mid-exit (Radix Presence); it is `aria-hidden` + `pointer-events:none`, sits behind the wizard overlay (not user-visible), and unmounts when the wizard closes. A 200 ms deferred open did not change Radix's unmount timing, so it was reverted to keep the transition snappy.

## Changelog

- 2026-07-03 — Draft created (follow-up to Dashboard v2). Defines the Custom Metric setup wizard + live preview, edge drag-resize snapping to existing sizes, and analytics-catalog entity/field localization. No DB migration, no endpoint addition, one additive shared-contract change.
- 2026-07-03 — Implemented all phases and verified live (wizard + preview, Polish catalog labels, drag-resize). Unit + integration tests (TC-DB2-006/007) added; TC-DB2-004 updated for the wizard add-flow.
