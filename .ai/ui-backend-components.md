# Backend Components Reference

Decision tables, exports, props, and MUST rules for the backend component families in `packages/ui/src/backend/`. Primitives (Button, Input, Tabs, …) are covered in [`.ai/ui-components.md`](./ui-components.md); foundation rules live in [`.ai/ds-rules.md`](./ds-rules.md); `DataTable` and `CrudForm` workflow guidance lives in [`packages/ui/AGENTS.md`](../packages/ui/AGENTS.md).

**Prime rule: check this file BEFORE building any chart, filter, section, schedule, or message UI from scratch.** Every family below already ships loading/error/empty handling, i18n wiring, and DS-token compliance — hand-rolled replacements are a review blocker.

## Table of Contents

- [Master decision table](#master-decision-table)
- [Charts & KPIs](#charts--kpis)
- [Filters](#filters)
- [Detail sections](#detail-sections)
- [Page scaffolding](#page-scaffolding)
- [Feedback & system banners](#feedback--system-banners)
- [Notifications](#notifications)
- [Schedule](#schedule)
- [Messages](#messages)
- [Forms chrome](#forms-chrome)
- [Table utilities](#table-utilities)
- [Internal — do not consume](#internal--do-not-consume)

---

## Master decision table

| I need to… | Use this | Import |
|---|---|---|
| List records with sorting/paging/filters | `DataTable` — see `packages/ui/AGENTS.md` | `@open-mercato/ui/backend/DataTable` |
| Build a create/edit form | `CrudForm` — see `packages/ui/AGENTS.md` | `@open-mercato/ui/backend/crud` |
| Show a KPI number with trend | `KpiCard` | `@open-mercato/ui/backend/charts` |
| Render bar / line / pie chart | `BarChart` / `LineChart` / `PieChart` | `@open-mercato/ui/backend/charts` |
| Tiny inline trend line | `Sparkline` | `@open-mercato/ui/backend/charts` |
| Compact "top N" ranking table | `TopNTable` | `@open-mercato/ui/backend/charts` |
| Search box + filter overlay row | `FilterBar` | `@open-mercato/ui/backend/FilterBar` |
| Standalone filter sheet | `FilterOverlay` | `@open-mercato/ui/backend/FilterOverlay` |
| Composable AND/OR filter tree UI | `AdvancedFilterPanel` (+ `useAdvancedFilterTree`) | `@open-mercato/ui/backend/filters/AdvancedFilterPanel` |
| Applied-filter chips row | `ActiveFilterChips` | `@open-mercato/ui/backend/filters/ActiveFilterChips` |
| One-click filter presets | `QuickFilters` | `@open-mercato/ui/backend/filters/QuickFilters` |
| Empty list (no records at all) | `ListEmptyState` | `@open-mercato/ui/backend/filters/ListEmptyState` |
| Empty results due to filters / search | `FilteredEmptyResults` / `SearchEmptyResults` | `@open-mercato/ui/backend/filters/FilteredEmptyResults` (DataTable renders these automatically) |
| Loading / error / not-found states | `LoadingMessage` / `ErrorMessage` / `RecordNotFoundState` | `@open-mercato/ui/backend/detail` |
| Notes / activities / addresses / tags / attachments tab | `NotesSection` / `ActivitiesSection` / `AddressesSection` / `TagsSection` / `AttachmentsSection` | `@open-mercato/ui/backend/detail` |
| Custom-field values panel | `CustomDataSection` | `@open-mercato/ui/backend/detail` |
| Inline-editable field list on a detail page | `DetailFieldsSection` (or `InlineTextEditor` & friends) | `@open-mercato/ui/backend/detail` |
| Empty tab inside a detail page | `TabEmptyState` | `@open-mercato/ui/backend/detail` |
| Page wrapper + title row | `Page` / `PageHeader` / `PageBody` | `@open-mercato/ui/backend/Page` |
| Section heading with count + action | `SectionHeader` / `CollapsibleSection` | `@open-mercato/ui/backend/SectionHeader` |
| Page with left section nav (profile-style) | `SectionPage` / `SectionNav` | `@open-mercato/ui/backend/section-page` |
| Settings area page | `SettingsPageWrapper` / `SettingsNavigation` | `@open-mercato/ui/backend/settings` |
| Dashboard widgets | `registerDashboardWidgets` / `useWidgetData` (screen is framework-mounted) | `@open-mercato/ui/backend/dashboard` |
| Toast after CRUD success/failure | `flash()` | `@open-mercato/ui/backend/FlashMessages` |
| Confirmation before destructive action | `ConfirmDialog` / `useConfirmDialog` | `@open-mercato/ui/backend/confirm-dialog` |
| Surface a 409 edit conflict | `surfaceRecordConflict` | `@open-mercato/ui/backend/conflicts` |
| Undo bar after bulk/destructive op | `pushOperation` (banner is AppShell-mounted) | `@open-mercato/ui/backend/operations/store` |
| Guided "next step" callout | `NextStepCallout` | `@open-mercato/ui/backend/NextStepCallout` |
| Collapsible inline help box | `ContextHelp` | `@open-mercato/ui/backend/ContextHelp` |
| Generic empty state | `EmptyState` | `@open-mercato/ui/backend/EmptyState` |
| Notification inbox UI | `NotificationPanel` / `NotificationItem` / hooks | `@open-mercato/ui/backend/notifications` |
| Calendar / availability view | `ScheduleView` | `@open-mercato/ui/backend/schedule` |
| Compose / send a message about a record | `MessageComposer` / `SendObjectMessageDialog` | `@open-mercato/ui/backend/messages` |
| Email thread timeline on a detail page | `EmailThreadsPanel` | `@open-mercato/ui/backend/messages` |
| Form/detail page header & footer | `FormHeader` / `FormFooter` / `FormActionButtons` / `ActionsDropdown` | `@open-mercato/ui/backend/forms` |
| Per-row "…" menu in tables | `RowActions` | `@open-mercato/ui/backend/RowActions` |
| Truncate long cell text with tooltip | `TruncatedCell` (or `meta.truncate` on the column) | `@open-mercato/ui/backend/TruncatedCell` |
| Boolean check/x icon, enum badge | `BooleanIcon` / `EnumBadge` | `@open-mercato/ui/backend/ValueIcons` |

---

## Charts & KPIs

Dashboard-grade visualization components with built-in `loading` / `error` / empty handling. All charts consume the shared `CHART_COLORS` palette (`var(--chart-1)`…`var(--chart-5)`) via `ChartContainer`.

```typescript
import { KpiCard, Sparkline, BarChart, LineChart, PieChart, TopNTable, CHART_COLORS, getChartColor } from '@open-mercato/ui/backend/charts'
```

| Export | Key props | Notes |
|---|---|---|
| `KpiCard` | `title`, `value: number \| null`, `trend?: { value, direction: 'up' \| 'down' \| 'unchanged' }`, `comparisonLabel?`, `loading?`, `error?`, `formatValue?`, `prefix?`/`suffix?`, `headerAction?`, `footer?` | Renders a delta badge from `trend` (`DeltaBadge` also exported) |
| `Sparkline` | `values: number[]`, `ariaLabel` (required), `width?`, `height?` | Inline SVG trend line |
| `BarChart` | `data`, `index`, `categories: string[]`, `layout?: 'vertical' \| 'horizontal'`, `colors?`, `valueFormatter?`, `showLegend?`, `showGridLines?`, `categoryLabels?`, `emptyMessage?` | `data` is `Record<string, string \| number \| null>[]` |
| `LineChart` | Same as `BarChart` plus `showArea?`, `curveType?: 'linear' \| 'natural' \| 'monotone' \| 'step'`, `connectNulls?` | |
| `PieChart` | `data: { name, value }[]`, `variant?: 'pie' \| 'donut'`, `showLabel?`, `showTooltip?` | |
| `TopNTable` | `data`, `columns: { key, header, formatter?, align?, width? }[]`, `maxRows?`, `emptyMessage?` | Compact ranking table for dashboard cards |
| `ChartContainer`, `ChartTooltipContent`, `CHART_COLORS`, `getChartColor`, `ChartConfig` | | Building blocks for custom Recharts compositions |

### Example

```tsx
import { KpiCard, BarChart } from '@open-mercato/ui/backend/charts'
import { useT } from '@open-mercato/shared/lib/i18n/context'

function DealsOverview({ stats, loading }: { stats: DealStats | null; loading: boolean }) {
  const t = useT()
  return (
    <div className="grid gap-4 md:grid-cols-3">
      <KpiCard
        title={t('customers.deals.kpi.openValue')}
        value={stats?.openValue ?? null}
        trend={stats ? { value: stats.delta, direction: stats.delta >= 0 ? 'up' : 'down' } : undefined}
        loading={loading}
      />
      <BarChart
        title={t('customers.deals.kpi.byStage')}
        data={stats?.byStage ?? []}
        index="stage"
        categories={['count']}
        loading={loading}
      />
    </div>
  )
}
```

### MUST rules

1. Charts MUST color series with `chart-*` tokens (named `chart-blue`/`chart-emerald`/… or `var(--chart-1)`…`var(--chart-5)`) — NEVER `status-*` tokens, never raw hex. See `.ai/ds-rules.md` → chart palette.
2. NEVER derive an entity's status color from a chart color, or vice versa.
3. Always pass `loading` and `error` through to the component instead of conditionally rendering your own spinner/error markup.
4. `Sparkline` requires `ariaLabel` — pass a translated description.

**Reference call site:** `packages/core/src/modules/customers/components/DealsKpiStrip.tsx` (KpiCard) and `packages/core/src/modules/customers/components/detail/dashboard/helpers.ts` (charts).

---

## Filters

Two layers. **Basic:** `FilterBar` (search input + "Filters" trigger opening `FilterOverlay`) — this is what `DataTable` wires automatically from its `filters` prop; use directly only for non-DataTable list surfaces. **Advanced:** the AND/OR tree builder used by CRM-style list pages.

```typescript
import { FilterBar } from '@open-mercato/ui/backend/FilterBar'
import { FilterOverlay, type FilterDef, type FilterValues } from '@open-mercato/ui/backend/FilterOverlay'
import { AdvancedFilterPanel } from '@open-mercato/ui/backend/filters/AdvancedFilterPanel'
import { ActiveFilterChips } from '@open-mercato/ui/backend/filters/ActiveFilterChips'
import { QuickFilters, type FilterPreset } from '@open-mercato/ui/backend/filters/QuickFilters'
import { ListEmptyState } from '@open-mercato/ui/backend/filters/ListEmptyState'
import { useAdvancedFilterTree } from '@open-mercato/ui/backend/hooks/useAdvancedFilter'
```

| Export | Import path | Key props / purpose |
|---|---|---|
| `FilterBar` | `…/backend/FilterBar` | `searchValue`/`onSearchChange`, `filters: FilterDef[]`, `values`, `onApply`, `onClear`, `leadingItems`/`trailingItems`/`searchTrailing`, `layout: 'stacked' \| 'inline'` |
| `FilterOverlay` | `…/backend/FilterOverlay` | `filters`, `initialValues`, `open`/`onOpenChange`, `onApply`, `onClear` — the sheet `FilterBar` opens; also exports `FilterDef` (`type: 'text' \| 'select' \| 'checkbox' \| 'dateRange' \| 'tags' \| 'combobox'`, `loadOptions?` async) |
| `AdvancedFilterPanel` | `…/backend/filters/AdvancedFilterPanel` | `fields`, `value: AdvancedFilterTree`, `onChange`, `onApply`, `onClear`, `pendingErrors`, `userId`, `presets`, `open`/`onOpenChange`, `savedFilterStorageKey?` — popover hosting the builder, quick filters, and saved filters |
| `AdvancedFilterBuilder` | `…/backend/filters/AdvancedFilterBuilder` | Bare tree editor (`fields`, `value`, `onChange`, `onApply`, `onClear`) — already embedded in `AdvancedFilterPanel`; only use standalone for custom hosts |
| `ActiveFilterChips` | `…/backend/filters/ActiveFilterChips` | `tree`, `fields`, `onRemoveNode`, `onOpen` — renders applied conditions as removable chips |
| `QuickFilters` | `…/backend/filters/QuickFilters` | `presets: FilterPreset[]` (`{ id, labelKey, build(ctx) }`), `userId`, `onApply` |
| `useAdvancedFilter` / `useAdvancedFilterTree` | `…/backend/hooks/useAdvancedFilter` | State + validation + serialization for the tree; pair with `AdvancedFilterPanel` |
| `ListEmptyState` | `…/backend/filters/ListEmptyState` | `entityName`, `createHref`/`onCreate`, `createLabel` — "no records yet" state with create action |
| `FilteredEmptyResults` | `…/backend/filters/FilteredEmptyResults` | `entityNamePlural`, `onClearAll`, `onRemoveLast`, `onClearSearch` — "filters matched nothing" state |
| `SearchEmptyResults` | `…/backend/filters/SearchEmptyResults` | `query`, `entityNamePlural`, `onClearSearch` — "search matched nothing" state |

### Example

```tsx
const t = useT()
<FilterBar
  searchValue={search}
  onSearchChange={setSearch}
  searchPlaceholder={t('currencies.list.searchPlaceholder')}
  filters={[{ id: 'isActive', label: t('currencies.list.filters.active'), type: 'checkbox' }]}
  values={filterValues}
  onApply={setFilterValues}
  onClear={() => setFilterValues({})}
/>
```

### MUST / NEVER rules

1. Inside `DataTable`, pass `filters`/`filterValues`/`onFiltersApply` props — DataTable renders `FilterBar`, `FilteredEmptyResults`, and `SearchEmptyResults` itself. NEVER mount a second `FilterBar` above a `DataTable`.
2. Advanced-filter pages MUST use the full trio (`AdvancedFilterPanel` + `ActiveFilterChips` + `useAdvancedFilterTree`) — do not rebuild condition chips by hand.
3. `FilterPreset.labelKey` is an i18n key, not display text.
4. Distinguish empty states: no records at all → `ListEmptyState`; filters active → `FilteredEmptyResults`; search active → `SearchEmptyResults`.
5. `FilterEmptyState` and `FilterFieldPicker` (same folder) are internals of `AdvancedFilterPanel` — do not import them directly.

**Reference call site:** `packages/core/src/modules/customers/backend/customers/people/page.tsx` (full advanced-filter wiring), `packages/core/src/modules/currencies/backend/currencies/page.tsx` (basic `FilterBar`).

---

## Detail sections

Building blocks for record detail pages (`[id]/page.tsx`): page-level states, tabbed sections backed by data adapters, and inline editors. Everything exports from the family index.

```typescript
import {
  LoadingMessage, ErrorMessage, RecordNotFoundState, TabEmptyState,
  NotesSection, ActivitiesSection, AddressesSection, TagsSection,
  AttachmentsSection, CustomDataSection, DetailFieldsSection,
  InlineTextEditor, InlineMultilineEditor, InlineSelectEditor,
} from '@open-mercato/ui/backend/detail'
```

| Export | Key props / purpose |
|---|---|
| `LoadingMessage` | `label` (required, translated) — the standard section/page loading row |
| `ErrorMessage` | `label`, `description?`, `action?` — destructive-toned alert; reserve for genuine failures |
| `AccessDeniedMessage` | Standard 403 state |
| `RecordNotFoundState` | `label`, `description?`, `backHref`/`backLabel`, `action?` — neutral missing-record state |
| `TabEmptyState` | `title`, `description?`, `action?: { label, onClick, icon?, disabled? }` — empty-but-healthy tab |
| `NotesSection` | `entityId`, `viewerUserId`, `dataAdapter: NotesDataAdapter`, `emptyState`, `addActionLabel`, markdown preference hooks — comments/notes tab |
| `ActivitiesSection` | `entityId`, `dataAdapter: ActivitiesDataAdapter`, `activityTypeLabels`, `loadActivityOptions`, `emptyState` — activity timeline tab with dictionary-driven types |
| `AddressesSection` | `entityId`, `dataAdapter: AddressDataAdapter`, `addressTypesAdapter?`, `loadFormat?`, `emptyState` — address tiles + editor (also exports `AddressTiles`, `AddressEditor`, `AddressView`, `formatAddressLines`) |
| `TagsSection` | `title`, `tags: TagOption[]`, `loadOptions`, `createTag`, `onSave({ next, added, removed })`, `labels`, `canEdit?`, `autoSave?` |
| `AttachmentsSection` | Upload/list/preview/delete for record attachments (with `AttachmentMetadataDialog`, `AttachmentDeleteDialog`, `AttachmentVisualPreview`) |
| `CustomDataSection` | `entityIds`, `values`, `onSubmit`, `title`, `labels`, `loadFields?` — renders the record's custom fields as an editable panel |
| `DetailFieldsSection` | Declarative list of inline-editable fields (`DetailFieldConfig`: text / multiline / select / custom) |
| `InlineTextEditor` / `InlineMultilineEditor` / `InlineSelectEditor` | Click-to-edit primitives used by `DetailFieldsSection` and detail headers |

### Example — page-level state flow

```tsx
const t = useT()
if (isLoading) return <LoadingMessage label={t('customers.people.detail.loading')} />
if (notFound) {
  return (
    <RecordNotFoundState
      label={t('customers.people.detail.notFound')}
      backHref="/backend/customers/people"
      backLabel={t('customers.people.detail.backToList')}
    />
  )
}
if (error) return <ErrorMessage label={error} />
```

### MUST / NEVER rules

1. Record-backed pages MUST follow `loading → notFound → error → ready` — return early per state; NEVER render `CrudForm`, sections, tabs, or record actions when the record is missing.
2. A missing record is NOT an error — use `RecordNotFoundState`, never `ErrorMessage`.
3. Sections take **data adapters** — implement the adapter against your module's API (using `apiCall`); do not fork a section to change its fetching.
4. All labels (`emptyLabel`, `addActionLabel`, `labels`, `emptyState`) MUST come from `useT()` / locale files.
5. Use `TabEmptyState` for empty tabs — not ad hoc centered `<div>` markup.

**Reference call site:** `packages/core/src/modules/customers/backend/customers/companies-v2/[id]/page.tsx`.

---

## Page scaffolding

Structural wrappers for backend pages.

| Export | Import | Purpose |
|---|---|---|
| `Page`, `PageHeader`, `PageBody` | `@open-mercato/ui/backend/Page` | Standard page wrapper (`space-y-6`), title row (`title`, `description?`, `actions?`), and content wrapper |
| `SectionHeader` | `@open-mercato/ui/backend/SectionHeader` | Section heading: `title`, `count?` (muted badge), `action?` |
| `CollapsibleSection` | `@open-mercato/ui/backend/SectionHeader` | Same header with chevron toggle; `defaultCollapsed?`, controlled `collapsed`/`onCollapsedChange`, `children` |
| `SectionPage`, `SectionNav` | `@open-mercato/ui/backend/section-page` | Page with grouped left navigation (`sections: SectionNavGroup[]`, `activePath`, `userFeatures?: Set<string>`) — items support `labelKey`, `requireFeatures`, nesting |
| `SettingsPageWrapper`, `SettingsNavigation` | `@open-mercato/ui/backend/settings` | Settings-area page shell: `sections: SectionNavGroup[]`, `requiredFeatures: string[]`; `SettingsNavigation` renders the settings card grid |
| `registerDashboardWidgets`, `useWidgetData`, `WidgetDataBatchProvider` | `@open-mercato/ui/backend/dashboard` (+ `…/dashboard/widgetRegistry`, `…/dashboard/widgetData`) | Dashboard widget registry + batched data fetching. `DashboardScreen` itself is mounted by the framework — modules ship widgets, never the screen |

### Example

```tsx
import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { useT } from '@open-mercato/shared/lib/i18n/context'

export default function CurrenciesPage() {
  const t = useT()
  return (
    <Page>
      <PageHeader title={t('currencies.list.title')} description={t('currencies.list.description')} />
      <PageBody>{/* DataTable, sections… */}</PageBody>
    </Page>
  )
}
```

### MUST rules

1. Every backend page MUST wrap content in `Page` — never bare `<div className="p-6">` roots.
2. `SectionNavItem.requireFeatures` MUST use immutable ACL feature IDs from the module's `acl.ts`.
3. Dashboard widgets fetch through `useWidgetData` (batched) — NEVER call `apiCall` per widget inside a dashboard grid.
4. Do not mount `DashboardScreen` from module code.

**Reference call sites:** `packages/core/src/modules/auth/lib/profile-sections.tsx` (SectionPage), `packages/core/src/modules/auth/backend/sidebar-customization/page.tsx` (settings), `packages/core/src/modules/dashboards/widgets/dashboard/top-products/widget.client.tsx` (useWidgetData).

---

## Feedback & system banners

App-level feedback surfaces. The banners (`FlashMessages`, `LastOperationBanner`, `RecordConflictBanner`, `ProgressTopBar`) are **singletons mounted by AppShell** — modules talk to them through their store helpers, never by mounting the component again.

| Export | Import | Purpose |
|---|---|---|
| `flash(message, type)` | `@open-mercato/ui/backend/FlashMessages` | Toast after CRUD success/failure (`'success' \| 'error' \| 'warning' \| 'info'`) |
| `withFlash(url, message, type)`, `pushWithFlash(router, url, message)` | `@open-mercato/ui/backend/utils/flash` | Flash that survives a navigation |
| `ConfirmDialog`, `useConfirmDialog` | `@open-mercato/ui/backend/confirm-dialog` | Confirmation dialog: `onConfirm`, `title?`, `text?`, `variant?: 'default' \| 'destructive'`, `loading?`, optional `trigger` (declarative mode); the hook returns `{ confirm(options), dialogProps }` |
| `EmptyState` | `@open-mercato/ui/backend/EmptyState` | Re-export of `@open-mercato/ui/primitives/empty-state` for backend imports |
| `surfaceRecordConflict(error, t, options?)` | `@open-mercato/ui/backend/conflicts` | Resolves a 409 to the shared conflict bar (`RecordConflictBanner`); returns `false` when the error is not a conflict so callers fall back to normal handling. `CrudForm`/`useGuardedMutation` call it automatically |
| `showRecordConflict`, `dismissRecordConflict`, `useRecordConflict` | `@open-mercato/ui/backend/conflicts` | Lower-level conflict store access (rarely needed) |
| `pushOperation`, `useLastOperation`, `markUndoSuccess`, `dismissOperation`, `coalesceLastOperations` | `@open-mercato/ui/backend/operations/store` | Feed the AppShell-mounted `LastOperationBanner` (undo bar) after destructive/bulk operations |
| `ProgressTopBar` | `@open-mercato/ui/backend/progress/ProgressTopBar` | Sticky operation-progress bar — AppShell-mounted; drive it with `ProgressJob`s (see `packages/core/src/modules/progress/AGENTS.md`), never mount your own |
| `NextStepCallout` | `@open-mercato/ui/backend/NextStepCallout` | Guided callout: `title`, `description?`, `steps?: { id, label, state }[]`, `actionLabel`, `onAction`, `status?` with tone/progress |
| `ContextHelp` | `@open-mercato/ui/backend/ContextHelp` | Collapsible inline help box: `title`, `children`, `defaultOpen?`, `bulb?` |

### Example

```tsx
const t = useT()
const { confirm, dialogProps } = useConfirmDialog()

async function handleDelete(id: string) {
  const ok = await confirm({ title: t('currencies.delete.title'), variant: 'destructive' })
  if (!ok) return
  try {
    await runMutation({ operation: () => apiCallOrThrow(`/api/currencies/${id}`, { method: 'DELETE' }) })
    flash(t('currencies.delete.success'), 'success')
  } catch (err) {
    if (!surfaceRecordConflict(err, t)) flash(t('currencies.delete.error'), 'error')
  }
}
// render <ConfirmDialog {...dialogProps} /> once in the page
```

### MUST / NEVER rules

1. NEVER use `window.confirm` — always `ConfirmDialog`/`useConfirmDialog`.
2. NEVER mount your own `FlashMessages`, `LastOperationBanner`, `RecordConflictBanner`, or `ProgressTopBar` — AppShell owns them; call the store helpers.
3. Every non-`CrudForm` mutation error path MUST try `surfaceRecordConflict(err, t)` before generic error handling (409s must never be swallowed).
4. NEVER add custom per-page progress bars for DataTable bulk work — return `{ ok, progressJobId }` and let `ProgressTopBar` display it.
5. Flash copy comes from locale files — `flash(t('module.action.success'), 'success')`.

**Reference call site:** `packages/core/src/modules/customers/backend/customers/people-v2/[id]/page.tsx` (confirm + flash + conflicts), `packages/core/src/modules/customers/backend/customers/deals/page.tsx` (operations store).

---

## Notifications

Bell trigger, sliding panel, and item renderer for in-app notifications, plus the data hooks. Notification *types and renderers* are declared module-side (`notifications.ts` / `notifications.client.ts` — see `packages/core/AGENTS.md` → Notifications); these components are the shared UI.

```typescript
import { NotificationBell, NotificationPanel, NotificationItem, NotificationCountBadge, useNotifications, useNotificationEffect } from '@open-mercato/ui/backend/notifications'
```

| Export | Key props / purpose |
|---|---|
| `NotificationBell` | `t: TranslateFn`, `customRenderers?` — bell + badge + panel, wired to the notifications API (AppShell renders one in the topbar) |
| `NotificationPanel` | `open`/`onOpenChange`, `notifications`, `unreadCount`, `onMarkAsRead`, `onExecuteAction`, `onDismiss`, `onMarkAllRead`, `dismissUndo?`/`onUndoDismiss?`, `t`, `customRenderers?: Record<type, Renderer>` |
| `NotificationItem` | `notification`, `onMarkAsRead`, `onExecuteAction`, `onDismiss`, `t`, `customRenderer?` |
| `NotificationCountBadge` | `count` — the tiny unread badge |
| `useNotifications` / `useNotificationsSse` / `useNotificationsPoll` | Data layer (SSE with poll fallback) |
| `useNotificationEffect(type, effect)` | Component-scoped side effect when a matching notification arrives — use instead of custom polling |

`NotificationPanel` filters with `Tabs variant="underline"` and passes the unread count through `TabsTrigger count` — reuse that pattern for any inbox-style tab row.

### MUST rules

1. Custom notification look = `customRenderers` map (type → renderer component), NEVER a fork of `NotificationPanel`.
2. Renderers live in the owning module's `widgets/notifications/` and use `useT()`.
3. For "when notification X arrives, refresh Y" use `useNotificationEffect` — no polling loops.

**Reference call site:** `packages/core/src/modules/notifications/frontend/NotificationInboxPageClient.tsx`.

---

## Schedule

Calendar/availability UI. `ScheduleView` is the entry point: it composes `ScheduleToolbar` (view switcher + range nav + timezone) with a lazily-loaded calendar for `day`/`week`/`month` and `ScheduleAgenda` for list mode.

```typescript
import { ScheduleView, ScheduleToolbar, ScheduleGrid, ScheduleAgenda, type ScheduleItem, type ScheduleRange, type ScheduleViewMode } from '@open-mercato/ui/backend/schedule'
```

| Export | Key props / purpose |
|---|---|
| `ScheduleView` | `items: ScheduleItem[]`, `view: 'day' \| 'week' \| 'month' \| 'agenda'`, `range: { start, end }`, `onRangeChange`, `onViewChange`, `onItemClick?`, `onSlotClick?`, `timezone?`/`onTimezoneChange?` — use this unless you need a bare sub-view |
| `ScheduleToolbar` | View-mode segmented control + range navigation |
| `ScheduleGrid` | Bare time-grid renderer (`items`, `range`, `timezone`, `onItemClick`, `onSlotClick`) |
| `ScheduleAgenda` | Bare agenda-list renderer (same props) |
| Types | `ScheduleItem` (`kind: 'availability' \| 'event' \| 'exception'`, `status?: 'draft' \| 'negotiation' \| 'confirmed' \| 'cancelled'`, `subjectType?: 'member' \| 'resource'`, `linkHref?`), `ScheduleRange`, `ScheduleSlot`, `ScheduleViewMode` |

`ScheduleCalendar` is a **default export loaded dynamically inside `ScheduleView`** (`ssr: false`) — do not import it directly; render `ScheduleView` instead.

### MUST rules

1. Keep view/range state in the page and pass it down — `ScheduleView` is fully controlled.
2. Map your domain records into `ScheduleItem` (with `metadata` for round-tripping) instead of extending the component.
3. Item `color` must resolve to a DS token value, not a hardcoded hex.

**Reference call site:** `packages/core/src/modules/planner/components/AvailabilitySchedule.tsx`.

---

## Messages

Cross-module messaging UI: compose messages (optionally linked to a record and sent via email), pick target records, and show email threads on detail pages.

```typescript
import { MessageComposer, SendObjectMessageDialog, MessageObjectRecordPicker, MessageObjectPreview, MessageObjectDetail, EmailThreadsPanel, MessagesIcon, useMessages } from '@open-mercato/ui/backend/messages'
```

| Export | Key props / purpose |
|---|---|
| `MessageComposer` | `variant?`, `open`/`onOpenChange` or `inline`, `contextObject?` (the record the message is about), `defaultValues?` (`type`, `recipients`, `subject`, `body`, `priority`, `visibility`, `sendViaEmail`, …), `lockedType?`, `onSuccess?`/`onCancel?` — the full compose form (CrudForm-based) |
| `SendObjectMessageDialog` | `object: MessageComposerContextObject` (required), `defaultValues?`, `lockedType?`, `buttonVariant?`/`buttonSize?`/`buttonLabel?`, `viewHref?`, `onSuccess?` — self-contained "Send message" button + dialog for detail pages; prefer this over wiring `MessageComposer` manually |
| `MessageObjectRecordPicker` | Search-and-pick a record to attach as message context |
| `MessageObjectPreview` / `MessageObjectDetail` | Render the linked record inside a message (compact / full) |
| `EmailThreadsPanel` | `threads: EmailThread[]` with `EmailThreadMessage` items (direction, status) — email-thread timeline tab; pair with `mergeOptimisticEmailThreads` for optimistic sends |
| `MessagesIcon` | Unread-aware messages icon for headers |
| `useMessages` / `useMessagesSse` / `useMessagesPoll` | Message data layer (SSE with poll fallback) |

`MessagePrioritySelector` is internal to the composer form groups — priorities come through `defaultValues.priority` (`'low' | 'normal' | 'high' | 'urgent'`).

### Example

```tsx
const t = useT()
<SendObjectMessageDialog
  object={{ entityType: 'customers:person', entityId: person.id, label: person.displayName }}
  buttonVariant="outline"
  buttonLabel={t('customers.people.detail.sendMessage')}
  onSuccess={() => refetchThreads()}
/>
```

### MUST rules

1. Detail-page "send a message about this record" = `SendObjectMessageDialog`; NEVER hand-roll a dialog around `MessageComposer`.
2. Message list/thread pages subscribe through `useMessages` — no custom polling.
3. Optimistic email sends MUST go through `mergeOptimisticEmailThreads` so pending state renders consistently.

**Reference call sites:** `packages/core/src/modules/customers/backend/customers/people/[id]/page.tsx` (SendObjectMessageDialog), `packages/core/src/modules/customers/components/detail/PersonEmailThreadsTab.tsx` (EmailThreadsPanel).

---

## Forms chrome

Header/footer chrome for form and detail pages. `CrudForm` renders `FormHeader mode="edit"` + `FormFooter` automatically — import these directly only for non-CrudForm pages and detail views.

```typescript
import { FormHeader, FormFooter, FormActionButtons, ActionsDropdown, type ActionItem } from '@open-mercato/ui/backend/forms'
```

| Export | Key props / purpose |
|---|---|
| `FormHeader` (edit mode) | `mode?: 'edit'`, `backHref`/`backLabel`, `title?`, `actions?: FormActionButtonsProps` — compact header for create/edit pages |
| `FormHeader` (detail mode) | `mode: 'detail'`, `title` (string or `InlineTextEditor`), `entityTypeLabel?`, `subtitle?`, `statusBadge?`, `menuActions?: ActionItem[]` (rendered as "Actions" dropdown), `utilityActions?`, `onDelete?`/`deleteLabel?`/`isDeleting?` — large header for view pages |
| `FormFooter` | `actions: FormActionButtonsProps`, `embedded?` — bottom action row |
| `FormActionButtons` | `showDelete?`/`onDelete?`, `cancelHref`, `submit?: { formId?, pending?, label?, pendingLabel? }`, `extraActions?` — the standardized Delete / Cancel / Save row |
| `ActionsDropdown` | `items: ActionItem[]` (`{ id, label, icon?, onSelect, disabled?, loading? }`), `triggerMode?: 'label' \| 'icon'` — context-action dropdown used by detail headers |

### MUST rules

1. Delete/Cancel/Save are always standalone buttons (via `FormActionButtons`); contextual actions (Convert, Send, Archive…) go into `menuActions` — never the other way around.
2. All buttons in the row share `default` size (h-9) — see `.ai/ui-components.md` → Button same-row rules.
3. `ActionItem.id` values are stable identifiers (`convert`, `archive`) — tests and injections target them.
4. `FormHeader` emits injection spots (`form-header:edit` / `form-header:detail`) — keep them intact when composing custom headers.

**Reference call site:** `packages/core/src/modules/customers/components/detail/CompanyDetailHeader.tsx` (detail mode), `packages/core/src/modules/customers/components/detail/create/CreateDealForm.tsx` (edit mode).

---

## Table utilities

Small helpers for DataTable columns and row menus.

| Export | Import | Purpose |
|---|---|---|
| `RowActions`, `RowActionItem` | `@open-mercato/ui/backend/RowActions` | Per-row "…" menu: `items: { id?, label, onSelect?, href?, destructive? }[]` |
| `TruncatedCell` | `@open-mercato/ui/backend/TruncatedCell` | Truncate + tooltip: `maxWidth?`, `tooltipContent?`, `disabled?`. DataTable applies it automatically from column `meta.truncate`/`meta.maxWidth` — import directly only outside DataTable |
| `BooleanIcon` | `@open-mercato/ui/backend/ValueIcons` | Check/x icon for boolean cells (`value`, `trueLabel`/`falseLabel`) |
| `EnumBadge`, `EnumBadgeMap` | `@open-mercato/ui/backend/ValueIcons` | Badge per enum value: `value`, `map: Record<string, { label, className?, icon? }>`, `fallback?` |
| `useSeverityPreset` | `@open-mercato/ui/backend/ValueIcons` | Ready-made `EnumBadgeMap` for severity levels |

### Example

```tsx
const t = useT()
rowActions={(row) => (
  <RowActions
    items={[
      { id: 'edit', label: t('ui.actions.edit'), href: `/backend/currencies/${row.id}/edit` },
      { id: 'delete', label: t('ui.actions.delete'), destructive: true, onSelect: () => handleDelete(row.id) },
    ]}
  />
)}
```

### MUST rules

1. `RowActions` items MUST have stable `id`s (`edit`, `open`, `delete`) — DataTable resolves row-click defaults from them (`rowClickActionIds` defaults to `['edit', 'open']`).
2. Prefer column `meta.truncate`/`meta.maxWidth` over wrapping cells in `TruncatedCell` manually.
3. `EnumBadgeMap.className` values MUST use `status-*` semantic tokens — never raw color classes.

**Reference call site:** `packages/core/src/modules/currencies/backend/currencies/page.tsx` (RowActions + ValueIcons).

---

## Internal — do not consume

Shell and infrastructure components. They are wired once by the framework (AppShell mounts the banners, guards, and chrome); importing them from module code is a review blocker.

| Component | One-liner |
|---|---|
| `AppShell` | The backend chrome: sidebar, topbar, banners (`FlashMessages`, `LastOperationBanner`, `RecordConflictBanner`, `ProgressTopBar`), notification bell |
| `BackendChromeProvider` | Context provider for shell chrome state |
| `AuthSessionGuard` | Session/keepalive guard wrapping backend routes |
| `OrganizationScopeBoundary` | Locks org scope on settings paths |
| `CollapsibleNavSection` | Sidebar nav group internals |
| `PerspectiveSidebar` | Saved-perspective sidebar internals |
| `ProfileDropdown`, `UserMenu` | Topbar user menu internals |
| `SettingsButton`, `IntegrationsButton` | Topbar shortcut buttons |
| `DashboardScreen` | The framework-mounted dashboard host — modules register widgets instead (see Page scaffolding) |
| `FilterEmptyState`, `FilterFieldPicker` | Internals of `AdvancedFilterPanel` |
| `MessagePrioritySelector`, `NotificationDispatcher` | Internals of the composer / notification runtime |
| `WebhookSetupGuide` | Special-purpose setup panel with a single call site (`integrations/backend/integrations/[id]/page.tsx`) — not a general-purpose component |
