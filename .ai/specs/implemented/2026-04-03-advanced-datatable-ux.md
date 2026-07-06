# Advanced DataTable UX

> **Status**: Implemented
> **Scope**: OSS (`packages/ui`, `packages/shared`, `packages/core`)
> **Created**: 2026-04-03

---

## TLDR

Upgrade the shared `DataTable` component with eight production-grade features: (1) clickable column-header sorting, (2) configurable bulk-action checkboxes with select-all, (3) page-size selector, (4) advanced filter builder with AND/OR logic and per-field operators, (5) scalable column chooser with search for entities with hundreds of fields, (6) sticky first data column and drag-and-drop column reorder, (7) virtual scrolling for large datasets, (8) auto-discovery of filter fields and column chooser fields from entity metadata. Initial rollout targets customers (people, companies) and deals; the component changes are platform-wide by design.

**UX designer requirements**: sticky first data column (not the checkbox), drag & drop columns, checkboxes, pagination, sorting on header click, reusable logic across companies/people/deals, table margins (not edge-to-edge).

**Post-implementation requirements** (added 2026-04-04):
- Bulk action buttons (e.g., "Delete selected") must only be visible when at least one row is selected
- Column chooser must not show a column in both "Selected" and "Available" sections simultaneously
- Advanced filter panel must open with one pre-populated condition row ready to fill (not empty requiring extra click)
- "Select field..." placeholder must not be selectable as a value in the filter field dropdown
- All entity fields (including detail-page-only fields like "Legal Name", "Website", "Domain") must appear in the filter and column chooser — auto-discovered from custom field definitions API
- Filter fields, column chooser fields, and search behavior must be auto-discoverable without hardcoded per-page arrays
- Search must be full-text across all main text columns (name, email, phone, description), not just the name column
- Sticky column must be the first data column (after the checkbox), not the checkbox itself — and must follow column reorder (whichever column is first becomes sticky)

---

## Problem Statement

The current `DataTable` component — used across every list page — lacks several features expected in a professional business application:

1. **No sorting on customers pages**: The `sortable` prop exists in DataTable but is not wired on the customers people/companies/deals pages. Users cannot sort by name, date, status, etc.
2. **Bulk actions require injection**: Checkboxes only appear when a module injects bulk actions via the widget system. There is no code-level configuration to enable built-in bulk actions (e.g., mass delete).
3. **Fixed page size**: Page size is hardcoded per page (typically 20). Users cannot choose 10/25/50/100.
4. **Primitive filtering**: The current `FilterOverlay` uses a flat form with predefined filter types. There is no AND/OR logic, no per-field operator selection (is, contains, equals, greater than), and no ability to add/remove filter conditions dynamically — unlike the CRM-style filter builder in the reference screenshot.
5. **Column chooser doesn't scale**: The Perspectives sidebar shows a checkbox list with up/down arrows. With 50+ fields (standard + custom), it becomes unusable — no search, no grouping, no way to find a specific field quickly.
6. **No sticky first column**: When tables have many columns and horizontal scroll, the identifier column (name/title) scrolls off-screen.
7. **No drag-and-drop column reorder**: Only up/down arrows in the Perspectives sidebar; no direct manipulation.
8. **Table extends to screen edges**: No breathing room / margins around the table.
9. **No virtual scrolling**: With large page sizes (50-100 rows) or wide tables with many columns, DOM rendering becomes sluggish. There is no row or column virtualization.

---

## Proposed Solution

Enhance the existing `DataTable` component in `packages/ui` (TanStack React Table foundation) with backward-compatible additions. All changes are opt-in via props so existing pages are unaffected until they adopt the new features.

### Architecture Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Grid library | Keep TanStack Table | Already integrated, headless = full UI control, MIT license |
| Drag & drop | `@dnd-kit/core` + `@dnd-kit/sortable` | MIT, best React DnD library, works with any renderer |
| Virtual scrolling | `@tanstack/react-virtual` | Same TanStack ecosystem, MIT, tiny (~2KB), designed to pair with TanStack Table |
| Filter state shape | `{ logic: 'and'|'or', conditions: FilterCondition[] }` | Simple, serializable, extensible |
| Column discovery | Entity schema + custom fields auto-discovery | Eliminates manual column declaration for large field sets |
| Bulk actions | Code-level `bulkActions` prop | Configurable per page without injection system |

---

## Feature Design

### F1 — Column Header Sorting

**Current state**: `sortable` prop exists in DataTable, renders clickable headers with ▲/▼. Not used on customers pages.

**Changes**:
- Enable `sortable` on customers people, companies, and deals pages
- Add sort indicators that are always visible (muted up/down arrows), with the active direction highlighted
- Wire sorting to the API query parameter (`?sort=name&order=asc`)
- Support multi-column sort display (TanStack Table already supports this)

**Props** (no new props needed — just enable `sortable={true}` and wire `sorting`/`onSortingChange`):
```tsx
<DataTable
  sortable
  sorting={sorting}
  onSortingChange={setSorting}
/>
```

### F2 — Configurable Bulk Actions with Checkboxes

**Current state**: Checkboxes appear only when `hasInjectedBulkActions` is true.

**Changes**:
- Add a `bulkActions` prop that accepts an array of action definitions
- When `bulkActions` is provided (or injected bulk actions exist), show checkbox column
- Select-all checkbox selects all rows on the current page
- Bulk action toolbar appears above the table when rows are selected, showing count and action buttons

**New prop**:
```tsx
type BulkAction<T> = {
  id: string
  label: string
  icon?: React.ComponentType
  destructive?: boolean
  onExecute: (selectedRows: T[]) => Promise<void> | void
}

<DataTable
  bulkActions={[
    { id: 'delete', label: t('common.deleteSelected'), destructive: true, onExecute: handleBulkDelete },
  ]}
/>
```

### F3 — Page Size Selector

**Current state**: `pageSize` is set per-page (usually 20) with no UI to change it. Perspectives can persist it but there's no control.

**Changes**:
- Add a page-size dropdown next to the pagination controls
- Options: 10, 25, 50, 100 (configurable via prop)
- Default to current page's `pageSize` value
- Changing page size resets to page 1 and re-fetches
- Persist selection in perspective if perspectives are active

**New prop**:
```tsx
<DataTable
  pagination={{
    ...pagination,
    pageSizeOptions: [10, 25, 50, 100],  // new
    onPageSizeChange: setPageSize,         // new
  }}
/>
```

### F4 — Advanced Filter Builder (AND/OR Logic)

**Current state**: `FilterOverlay` renders a flat form with predefined typed filters. All conditions are implicitly AND. No dynamic add/remove.

**Changes**:
- Replace or extend `FilterOverlay` with a new `AdvancedFilterBuilder` component
- Each row: `[Logic toggle (AND/OR)] [Field selector] [Operator selector] [Value input] [Delete]`
- Logic toggle: first row shows "Where", subsequent rows show "And ▼" / "Or ▼" (clickable to toggle)
- `+ Add filter` button to append a condition row
- Field selector: searchable dropdown listing all entity fields + custom fields
- Operator selector: context-aware operators based on field type:

| Field type | Operators |
|------------|-----------|
| text/string | is, is not, contains, does not contain, starts with, ends with, is empty, is not empty |
| number | equals, not equals, greater than, less than, greater or equal, less or equal, between, is empty |
| date | is, is before, is after, between, is empty, is not empty |
| select/enum | is, is not, is any of, is none of, is empty |
| boolean | is true, is false |
| tags/multi | has any of, has all of, has none of, is empty |

- Value input adapts to field type (text input, number input, date picker, select dropdown, multi-select)
- Filter state is ephemeral (not saved to perspectives per Q2 answer)
- Displayed as a popover/dropdown panel from the "Filter" button in the toolbar

**New types**:
```tsx
type FilterCondition = {
  id: string                    // unique row ID
  field: string                 // field accessor key
  operator: FilterOperator      // type-aware operator
  value: unknown                // typed value
}

type AdvancedFilterState = {
  logic: 'and' | 'or'          // global logic between conditions
  conditions: FilterCondition[]
}

type FilterFieldDef = {
  key: string                   // field accessor
  label: string                 // display name (i18n)
  type: 'text' | 'number' | 'date' | 'select' | 'boolean' | 'tags'
  group?: string                // for grouping in field selector (e.g., "Custom Fields", "Contact Info")
  loadOptions?: (query?: string) => Promise<FilterOption[]>  // for select/tags
}
```

**New prop**:
```tsx
<DataTable
  advancedFilter={{
    fields: filterFieldDefs,              // all filterable fields
    value: advancedFilterState,           // current filter state
    onChange: setAdvancedFilterState,      // state setter
    onApply: handleAdvancedFilterApply,   // triggers re-fetch
    onClear: handleAdvancedFilterClear,   // clears all conditions
  }}
/>
```

### F5 — Scalable Column Chooser with Search

**Current state**: Perspectives sidebar shows a flat checkbox list with up/down arrows. Unusable at scale.

**Changes**:
- New `ColumnChooser` panel (replaces the column section in PerspectiveSidebar)
- Opens as a side panel or dialog (not a dropdown — too small for hundreds of fields)
- **Search box** at the top for instant filtering of available columns
- **Grouped sections** (e.g., "Basic Info", "Contact", "Custom Fields", "Dates") — collapsible
- **Checkboxes** to toggle column visibility
- **Selected columns** section at the top showing active columns with drag handles for reorder
- **Auto-discovery**: columns are populated from entity schema + custom field definitions
- Each page declares a `columnDiscovery` config that maps entity fields to column definitions

**New prop**:
```tsx
type ColumnChooserConfig = {
  availableColumns: ColumnChooserField[]   // all possible columns
  // OR auto-discover from entityId:
  entityId?: string                         // auto-load from entity schema + custom fields
}

type ColumnChooserField = {
  key: string                // field accessor
  label: string              // display name
  group: string              // grouping category
  defaultVisible?: boolean   // shown by default
  alwaysVisible?: boolean    // cannot be hidden (e.g., name column)
  columnDef: ColumnDef<any>  // TanStack column definition
}

<DataTable
  columnChooser={{
    entityId: E.customers.customer_person,
    availableColumns: allPersonColumns,
  }}
/>
```

### F6 — Sticky First Data Column & Table Margins

**Changes**:
- The first data column (after the checkbox, if present) gets `position: sticky; left: 0; z-index: 10; background: bg-background` so it stays visible during horizontal scroll
- The checkbox column is NOT sticky — only the first data column (typically name/title) is pinned
- When columns are reordered via drag-and-drop, whichever column ends up in the first position automatically becomes the new sticky column
- Table container gets horizontal padding/margins (`mx-1 sm:mx-2`) so it doesn't touch screen edges
- Implemented via CSS — applied dynamically based on `headerIndex === 0` / `cellIndex === 0`

**New prop** — opt-in via `stickyFirstColumn={true}`. Defaults to `false` so existing pages are unaffected. Enabled on customers people, companies, and deals pages.

### F7 — Drag & Drop Column Reorder

**Changes**:
- Column headers become drag handles (or a grip icon appears on hover)
- Uses `@dnd-kit/core` + `@dnd-kit/sortable` for accessible, performant DnD
- Reorder persists in component state; saved if perspectives are active
- Works alongside the column chooser (reorder in chooser panel OR directly on headers)

**Implementation**: Wrap header row with `SortableContext` from dnd-kit; each header is a `useSortable` item.

### F8 — Virtual Scrolling

**Current state**: DataTable renders all rows in the DOM. With 50-100 rows and many columns (especially custom fields), this creates hundreds or thousands of DOM nodes, causing layout recalculation lag.

**Changes**:
- Integrate `@tanstack/react-virtual` for row virtualization
- Only render rows visible in the viewport plus an overscan buffer (default 10 rows)
- Table body gets a fixed max height (configurable, default: fill available viewport) with vertical scroll
- Row heights are measured dynamically (not fixed) to support variable-height content
- Column virtualization for tables with 20+ visible columns: only render columns in the horizontal viewport
- Sticky checkbox column is excluded from column virtualization (always rendered)

**New prop**:
```tsx
<DataTable
  virtualized              // boolean, default false — enables row + column virtualization
  virtualizedMaxHeight={600}  // optional, px — max height before scroll; default: auto-fill viewport
  virtualizedOverscan={10}    // optional — rows to render outside viewport; default: 10
/>
```

**How it works**:
- `useVirtualizer` from `@tanstack/react-virtual` manages visible row range
- Table `<tbody>` is a scroll container with `overflow-y: auto` and a spacer element for total height
- Only visible `<tr>` elements are mounted; rows outside viewport are unmounted
- For column virtualization: `useVirtualizer` on horizontal axis, sticky checkbox column excluded via `rangeExtractor`
- Compatible with sorting, filtering, bulk selection, pagination — virtualization is purely a rendering optimization

**Performance targets**:
- 100 rows x 50 columns: smooth 60fps scroll
- 1000 rows (if page size is uncapped for export previews): no jank

### F9 — Auto-Discovery of Filter Fields & Column Chooser Fields

> Added 2026-04-04. Eliminates hardcoded per-page field arrays.

**Problem**: Each list page required manually maintaining three parallel arrays — `advancedFilterFields`, `columnChooserFields`, and `columns` — that diverged over time. Custom fields and detail-page fields (e.g., "Legal Name", "Website") were missing from filters and column chooser.

**Solution**: A `useAutoDiscoveredFields` hook in `packages/ui` derives both `AdvancedFilterFieldDef[]` and `ColumnChooserField[]` automatically from:
1. The DataTable `columns` prop (existing rendered columns with `accessorKey` + `header`)
2. Custom field definitions fetched via `useCustomFieldDefs(entityIds)` (all fields, not just filterable/listVisible)

**Auto mode API**:
```tsx
<DataTable
  advancedFilter={{ auto: true, value, onChange, onApply, onClear }}
  columnChooser={{ auto: true }}
  entityIds={[E.customers.customer_entity, E.customers.customer_company_profile]}
/>
```

**Column metadata hints** (optional, via TanStack `ColumnMeta`):
```tsx
{
  accessorKey: 'status',
  header: 'Status',
  meta: {
    filterType: 'select',           // override auto-inferred type
    filterOptions: statusOptions,    // provide select options
    columnChooserGroup: 'Basic Info', // grouping in column chooser
    alwaysVisible: true,             // cannot be hidden
  },
}
```

**Type mapping** (`CustomFieldDefDto.kind` → `FilterFieldType`):
| Kind | FilterFieldType |
|------|----------------|
| `text`, `multiline` | `text` |
| `select`, `dictionary`, `currency`, `relation` | `select` |
| `boolean` | `boolean` |
| `integer`, `float` | `number` |
| `date` | `date` |
| `attachment` | skipped |

**Backward compatible**: Pages passing `{ fields: [...] }` or `{ availableColumns: [...] }` continue to work unchanged.

### F10 — Full-Text Search Across All Text Columns

> Added 2026-04-04. Search box was only querying `display_name`.

**Problem**: The search box on list pages only filtered by the name column (`display_name` via `$ilike`). Users expected to find records by email, phone, or description.

**Solution**: Server-side `buildFilters` in CRUD routes now queries multiple text columns via `$or`:
- **People/Companies**: `display_name`, `primary_email`, `primary_phone`, `description`
- **Deals**: `title`, `description`

**Query engine enhancement**: Added `$or` support to `normalizeFilters` in `packages/shared/src/lib/query/join-utils.ts` and OR-group handling in the query engine. Filters with an `orGroup` marker are applied as `WHERE (col1 ILIKE ? OR col2 ILIKE ? OR ...)` instead of individual AND conditions.

**Search placeholder** updated to "Search by name, email, phone…" to indicate broader scope.

---

## Backward Compatibility

All features are opt-in via new props. Existing pages that don't pass these props see zero behavior change.

| Feature | Opt-in mechanism | Default |
|---------|-----------------|---------|
| Sorting | `sortable={true}` | `false` (unchanged) |
| Bulk actions | `bulkActions={[...]}` | `undefined` (unchanged) |
| Page size selector | `pagination.pageSizeOptions` | `undefined` (no selector) |
| Advanced filter | `advancedFilter={...}` | `undefined` (old FilterOverlay) |
| Column chooser | `columnChooser={...}` | `undefined` (old perspective sidebar) |
| Sticky first data column | `stickyFirstColumn={true}` | `false` (not sticky) |
| DnD column reorder | Enabled when `columnChooser` is set | Disabled |
| Virtual scrolling | `virtualized` | `false` |
| Auto-discovery | `advancedFilter.auto` / `columnChooser.auto` | Manual fields |
| Full-text search | Server-side `$or` in `buildFilters` | Name only |

The existing `filters`/`filterValues`/`onFiltersApply`/`onFiltersClear` props remain functional for pages using the old filter model. The `advancedFilter` prop is a separate code path.

---

## Data Flow

```
User interacts with filter/sort/page-size
  → Component state updates (sorting, advancedFilterState, pageSize)
  → Parent page re-fetches from API with query params:
      ?sort=name&order=asc
      &filter[logic]=and
      &filter[conditions][0][field]=status&filter[conditions][0][op]=is&filter[conditions][0][value]=active
      &filter[conditions][1][field]=created_at&filter[conditions][1][op]=after&filter[conditions][1][value]=2026-01-01
      &pageSize=50&page=1
  → API applies conditions server-side
  → Response rendered in DataTable
```

**Column chooser flow**:
```
User opens column chooser
  → Panel shows all available columns (from entity schema + custom fields)
  → User searches, checks/unchecks columns
  → Column visibility state updates
  → DataTable re-renders with selected columns
  → If perspectives active, state is auto-saved
```

---

## Implementation Plan

### Phase 1 — DataTable Core Enhancements (packages/ui)

**Step 1.1 — Table margins and layout cleanup**
- Add consistent horizontal padding to `DataTable` container
- Ensure table doesn't extend to screen edges
- Verify no visual regressions across existing pages

**Step 1.2 — Sorting activation and improved indicators**
- Update sort indicator to always show muted arrows, highlight active direction
- No DataTable code change needed for the indicator beyond CSS
- Wire `sortable`, `sorting`, `onSortingChange` on customers people, companies, and deals pages
- Map sorting state to API query params in each page's fetch logic

**Step 1.3 — Page size selector**
- Add `pageSizeOptions` and `onPageSizeChange` to `PaginationProps`
- Render a select dropdown next to pagination controls
- Reset to page 1 on page size change
- Wire on customers people, companies, and deals pages

**Step 1.4 — Configurable bulk actions**
- Add `bulkActions` prop to `DataTable`
- Show checkbox column when `bulkActions` is provided (merge with existing injection-based logic)
- Render bulk action toolbar above table when rows are selected
- Wire "Delete selected" bulk action on customers people, companies, and deals pages
- Ensure confirmation dialog before destructive bulk actions

**Step 1.5 — Virtual scrolling**
- Install `@tanstack/react-virtual`
- Create `VirtualizedTableBody` component that replaces the standard `<tbody>` when `virtualized` is true
- Implement row virtualization with `useVirtualizer` — scroll container with measured row heights
- Implement column virtualization for wide tables (20+ columns) — exclude sticky columns from virtual range
- Add `virtualized`, `virtualizedMaxHeight`, `virtualizedOverscan` props to DataTable
- Enable on customers people, companies, and deals pages
- Verify compatibility with sorting, bulk selection, sticky column, and DnD reorder

### Phase 2 — Advanced Filter Builder (packages/ui)

**Step 2.1 — FilterCondition types and state management**
- Define `FilterCondition`, `AdvancedFilterState`, `FilterFieldDef` types in `packages/shared`
- Create `useAdvancedFilter` hook for state management (add/remove/update conditions, toggle logic)

**Step 2.2 — AdvancedFilterBuilder component**
- Build the filter builder UI component matching the reference screenshot
- Row layout: `[Logic] [Field ▼] [Operator ▼] [Value input] [🗑]`
- First row: "Where" label; subsequent rows: "And/Or" toggle
- `+ Add filter` button
- Field selector: searchable dropdown with grouping
- Operator selector: adapts to selected field type
- Value input: adapts to field type (text, number, date picker, select, multi-select)

**Step 2.3 — Wire advanced filter to DataTable**
- Add `advancedFilter` prop to DataTable
- Render filter button in toolbar that opens the builder as a popover panel
- Show active filter count badge on the button
- Display active filter summary chips below the toolbar

**Step 2.4 — API query parameter contract**
- Define how advanced filter state serializes to API query params
- Implement server-side parsing in the CRUD factory / query engine
- Support AND/OR logic in query construction
- Wire on customers people, companies, and deals pages

### Phase 3 — Column Chooser & Reorder (packages/ui)

**Step 3.1 — Column auto-discovery infrastructure**
- Create `useEntityColumns` hook that loads available columns from entity schema + custom field definitions
- Map entity fields to `ColumnChooserField` with type, label, group
- Support custom field groups (fieldsets) as column groups

**Step 3.2 — ColumnChooser panel component**
- Build side panel / dialog UI
- Search box at top with instant filtering
- Grouped, collapsible sections
- Checkboxes for visibility toggle
- "Selected columns" section at top with drag handles
- "Select all" / "Deselect all" per group

**Step 3.3 — Drag & drop column reorder**
- Install `@dnd-kit/core` + `@dnd-kit/sortable`
- Implement DnD on column headers (grip handle on hover)
- Implement DnD in the column chooser "selected columns" list
- Persist order in component state; sync with perspectives if active

**Step 3.4 — Sticky checkbox column**
- Apply `position: sticky; left: 0; z-index: 1` to the checkbox column `<th>`/`<td>` when `bulkActions` is provided
- Add subtle right border shadow on the sticky column when table is scrolled horizontally
- Ensure sticky works with horizontal overflow on the table container
- No separate prop — automatic when checkboxes are present

**Step 3.5 — Wire column chooser on customers pages**
- Define full column sets for people, companies, and deals (all entity fields + custom fields)
- Enable `columnChooser` prop
- Verify drag & drop reorder works end-to-end

### Phase 4 — Polish & Integration Testing

**Step 4.1 — Responsive behavior**
- Ensure filter builder works on smaller screens (stack layout)
- Column chooser panel responsive behavior
- Page size selector placement on narrow viewports

**Step 4.2 — i18n**
- Add translation keys for all new UI strings (filter operators, column chooser labels, bulk action labels)
- Verify translations work with `useT()`

**Step 4.3 — Integration tests**
- Test sorting: click header → verify sort order changes, API called with sort params
- Test bulk actions: select rows → execute action → verify operation and selection clear
- Test page size: change size → verify re-fetch with new size
- Test advanced filter: add conditions with AND/OR → verify results match
- Test column chooser: search, toggle columns, verify table updates
- Test drag & drop: reorder columns, verify new order persists
- Test sticky column: horizontal scroll, verify first column stays visible
- Test virtual scrolling: scroll through 100 rows, verify no missing rows, correct row content after scroll

---

## Risks & Impact Review

| Risk | Severity | Mitigation |
|------|----------|------------|
| Advanced filter API query format is a new contract surface | Medium | Define a clear, versioned query param schema; keep backward compat with existing `?status=active` style filters |
| `@dnd-kit` adds bundle weight (~15-20KB gzipped) | Low | Tree-shakable; only loaded on pages using DnD |
| Column auto-discovery may expose internal fields | Medium | Whitelist mechanism: pages declare which entity fields are column-eligible |
| Sticky column CSS conflicts with existing table styles | Low | Scoped via DataTable-specific class names; test across all pages |
| Server-side AND/OR filter parsing complexity | Medium | Limit to flat conditions (no nested groups); validate condition count (max 20) |
| Bulk delete of many records could timeout | Medium | Use background job for large selections; show progress feedback |
| Virtual scrolling breaks accessibility (screen readers) | Medium | Keep semantic `<table>` structure; use `aria-rowcount`/`aria-rowindex` on virtualized rows; test with VoiceOver |
| Variable row heights cause scroll jumpiness | Low | Use `measureElement` for dynamic measurement; overscan buffer smooths edge cases |
| Auto-discovery exposes all custom fields including internal ones | Low | All fields come from the tenant-scoped definitions API; no system/internal fields exposed |
| `$or` query engine support may have edge cases | Medium | Limited to flat OR groups; validated via `orGroup` marker; only applied to resolved base columns |
| Full-text search on multiple columns may be slow without indexes | Medium | Fields searched are standard indexed columns; custom fields use the search token system |

---

## Out of Scope

- Infinite scroll (continuous loading without pagination)
- Nested filter groups (AND within OR) — flat conditions only for now
- Column pinning (beyond sticky first column)
- Inline cell editing
- Excel export
- Filter persistence in perspectives (explicitly deferred per requirements)
- Drag & drop row reorder

---

## Dependencies

| Dependency | Version | License | Size | Purpose |
|------------|---------|---------|------|---------|
| `@dnd-kit/core` | ^6.x | MIT | ~12KB gzip | DnD foundation |
| `@dnd-kit/sortable` | ^8.x | MIT | ~5KB gzip | Sortable preset for column reorder |
| `@dnd-kit/utilities` | ^3.x | MIT | ~2KB gzip | DnD utility hooks |
| `@tanstack/react-virtual` | ^3.x | MIT | ~2KB gzip | Row and column virtualization |

No other new dependencies. All other features built on existing TanStack React Table APIs.

---

## Implementation Status

| Phase | Status | Date | Notes |
|-------|--------|------|-------|
| Phase 1 — DataTable Core Enhancements | Done | 2026-04-03 | Margins, sorting indicators, page size selector, bulk actions, virtual scrolling |
| Phase 2 — Advanced Filter Builder | Done | 2026-04-03 | Types, UI component, server-side parser, wired on customer pages |
| Phase 3 — Column Chooser & DnD Reorder | Done | 2026-04-03 | ColumnChooserPanel, header DnD, sticky first data column, wired on customer pages |
| Phase 4 — Polish & Integration Testing | Done | 2026-04-03 | i18n keys, build verified, all features wired end-to-end |
| Phase 5 — Auto-Discovery & Full-Text Search | Done | 2026-04-04 | useAutoDiscoveredFields hook, auto mode props, $or query engine support, multi-field search |
| Phase 6 — UX Bug Fixes | Done | 2026-04-04 | Sticky column corrected, bulk action visibility, column chooser dedup, filter UX, page size dropdown |

### Phase 1 — Detailed Progress
- [x] Step 1.1: Table margins and layout cleanup
- [x] Step 1.2: Sorting activation and improved indicators (always-visible muted arrows)
- [x] Step 1.3: Page size selector (pageSizeOptions + onPageSizeChange)
- [x] Step 1.4: Configurable bulk actions (bulkActions prop + selected count display)
- [x] Step 1.5: Virtual scrolling (@tanstack/react-virtual, row virtualization with spacer rows)

### Phase 2 — Detailed Progress
- [x] Step 2.1: FilterCondition types and state management (packages/shared)
- [x] Step 2.2: AdvancedFilterBuilder component with condition rows
- [x] Step 2.3: Wire advanced filter to DataTable (toggle button, filter panel, active count badge)
- [x] Step 2.4: Server-side query parameter parsing (deserialize + convert to Where)
- [x] Step 2.5: Wire advancedFilter on people, companies, deals pages

### Phase 3 — Detailed Progress
- [x] Step 3.1: ColumnChooserPanel with search, grouping, checkboxes
- [x] Step 3.2: Drag & drop column reorder via @dnd-kit (in chooser panel + table headers)
- [x] Step 3.3: Sticky first data column (not checkbox) — follows reorder
- [x] Step 3.4: Wire column chooser on customer pages (people, companies, deals)
- [x] Step 3.5: DnD column reorder on table headers via SortableHeaderCell + HeaderDndWrapper

### Phase 4 — Detailed Progress
- [x] Step 4.1: i18n keys for all new UI strings (en.json)
- [ ] Step 4.2: Integration tests (deferred to separate PR)
- [x] Step 4.3: Build verification — all 18 packages pass
- [x] Step 4.4: Virtual scrolling enabled on customer pages

### Phase 5 — Auto-Discovery & Full-Text Search (added 2026-04-04)
- [x] Step 5.1: `buildAdvancedFilterFieldsFromCustomFields()` in customFieldFilters.ts
- [x] Step 5.2: `useAutoDiscoveredFields` hook — derives filter + column chooser fields from columns + custom field defs
- [x] Step 5.3: Extended DataTable props with `{ auto: true }` mode for advancedFilter and columnChooser
- [x] Step 5.4: Migrated people, companies, deals pages to auto mode (deleted hardcoded arrays, added column meta hints)
- [x] Step 5.5: Added `$or` support to query engine normalizer + engine (orGroup-based WHERE ... OR ...)
- [x] Step 5.6: Multi-field search in CRUD routes (people/companies: name+email+phone+description; deals: title+description)
- [x] Step 5.7: Updated search placeholders to indicate broader scope

### Phase 6 — UX Bug Fixes (added 2026-04-04)
- [x] Step 6.1: Sticky column corrected — first data column, not checkbox; follows DnD reorder
- [x] Step 6.2: Bulk action buttons hidden when no rows selected (was: disabled but visible)
- [x] Step 6.3: Column chooser dedup — available section excludes already-selected columns
- [x] Step 6.4: Advanced filter opens with pre-populated condition row (was: empty requiring extra click)
- [x] Step 6.5: "Select field..." placeholder disabled in filter dropdown (was: selectable)
- [x] Step 6.6: All custom field defs included in auto-discovery (was: only filterable/listVisible)
- [x] Step 6.7: Page size dropdown spacing fixed (was: text and arrow overlapping)
- [x] Step 6.8: DnD column reorder state persistence fixed (was: snapping back to original position)
- [x] Step 6.9: DndContext moved outside `<table>` to prevent invalid `<div>` inside `<thead>` hydration errors

---

## Changelog

| Date | Change |
|------|--------|
| 2026-04-03 | Initial skeleton with open questions |
| 2026-04-03 | Full spec after Q&A — 4 phases, 8 features, UX designer notes incorporated |
| 2026-04-03 | Added F8 — virtual scrolling via `@tanstack/react-virtual` (row + column virtualization) |
| 2026-04-03 | Implementation: Phase 1-3 complete, Phase 4 i18n done |
| 2026-04-03 | All phases complete: server-side filter parsing, column chooser + DnD on pages, advanced filter on pages, virtual scrolling enabled |
| 2026-04-04 | Added F9 (auto-discovery) and F10 (full-text search). Post-implementation requirements documented. |
| 2026-04-04 | Phase 5: useAutoDiscoveredFields hook, auto mode props, $or query engine support, customer pages migrated to auto mode |
| 2026-04-04 | Phase 6: UX bug fixes — sticky column, bulk action visibility, column chooser dedup, filter UX, page size dropdown, DnD persistence, hydration fix |
