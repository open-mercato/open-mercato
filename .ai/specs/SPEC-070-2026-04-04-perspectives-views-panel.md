# SPEC-070: Perspectives Views Panel Redesign

## Overview

Redesign the perspectives UI panel (`PerspectiveSidebar.tsx`) to provide an intuitive views management experience with field search, clear private/public distinction, and streamlined view switching. This replaces the current unintuitive "perspectives" mechanism with a user-friendly "Views" panel.

Reference: T-FE-02

## Problem Statement

The current `PerspectiveSidebar` has several UX issues:

1. **No field search in column configuration** — users with 20+ columns must scroll through the entire list to find and toggle a specific field. There is no way to filter or search.
2. **Unintuitive "perspectives" terminology** — the concept of "perspectives" is unclear to most users. Industry-standard term is "views" or "customize" (as in Notion, Airtable, Linear).
3. **No clear private/public distinction** — the current split between "My perspectives" and "Role perspectives" is confusing. Users don't immediately understand who can see what.
4. **Clunky view switching** — activating a view requires opening the sidebar, finding the view, and clicking "Use". There's no quick-switch mechanism.
5. **Column reordering with arrows only** — moving columns up/down one position at a time is slow for large column sets. Drag-and-drop would be more efficient.

## Proposed Solution

A frontend-only redesign of the perspectives panel. The backend API and data model remain unchanged — this is purely a UI/UX improvement.

### 1. Rename "Perspectives" to "Views"

All user-facing labels change from "Perspectives" to "Views":
- "My perspectives" → "My views" (private)
- "Role perspectives" → "Shared views" (public)
- "Save perspective" → "Save view"
- Update all i18n keys under `ui.perspectives.*` → `ui.views.*` (keep old keys as fallbacks)

### 2. Field Search in Column Configuration

Add a search input at the top of the Columns section:

```
┌─────────────────────────────┐
│ 🔍 Search fields...         │
├─────────────────────────────┤
│ ☑ Company name              │
│ ☑ Contact email             │
│ ☐ Created at                │
│ ...filtered results...      │
└─────────────────────────────┘
```

- Filter `columnOptions` by `label` matching the search query (case-insensitive)
- Show match count: "3 of 24 fields"
- Clear button to reset search
- Empty state: "No fields matching '[query]'"

### 3. Private / Public Views Distinction

Replace the current two-section layout with a tabbed interface:

```
┌──────────────────────────────────┐
│  [Private]  [Shared]             │
├──────────────────────────────────┤
│  ★ My default view        ✕     │
│    Condensed contacts            │
│    Full details             ✕   │
│                                  │
│  ┌────────────────────────────┐  │
│  │ + Save current as new view│  │
│  └────────────────────────────┘  │
└──────────────────────────────────┘
```

**Private tab**: shows `perspectives` (user's own views)
**Shared tab**: shows `rolePerspectives` grouped by role, with role name as section header

Each view card shows:
- View name (bold)
- "Default" badge if `isDefault`
- Last updated date (relative: "2 hours ago", "yesterday")
- Delete button (private only)
- Active indicator (highlighted border when selected)

### 4. Quick View Switcher

Add a compact dropdown/popover above the DataTable (outside the sidebar) for fast view switching without opening the full panel:

```
┌─────────────────────────────────────────┐
│ Current view: [My default view ▾]  ⚙️   │
└─────────────────────────────────────────┘
```

- Dropdown lists all available views (private + shared)
- Click to switch instantly
- ⚙️ icon opens the full sidebar panel
- Shows "Unsaved changes" indicator if current table state differs from the active view

### 5. Improved Column Management

Replace arrow-based reordering with drag-and-drop:
- Each column row gets a drag handle (⠿)
- Drag to reorder
- Keep checkbox toggle for visibility
- Search filter (from point 2) works alongside drag-and-drop
- Consider using `@dnd-kit/core` if available in the project, otherwise `react-beautiful-dnd`

## Architecture

### Component Structure

```
packages/ui/src/backend/
├── PerspectiveSidebar.tsx        → ViewsPanel.tsx (rename + rewrite)
├── ViewsPanelPrivateTab.tsx      (new - private views list)
├── ViewsPanelSharedTab.tsx       (new - shared/role views list)  
├── ViewsColumnConfig.tsx         (new - column search + drag reorder)
├── ViewsSaveForm.tsx             (new - save view form)
└── ViewsQuickSwitcher.tsx        (new - dropdown above DataTable)
```

### Impact Analysis

**Files modified:**
- `packages/ui/src/backend/PerspectiveSidebar.tsx` — replaced by `ViewsPanel.tsx`
- `packages/ui/src/backend/DataTable.tsx` — add `ViewsQuickSwitcher` integration

**Files created:**
- 5 new component files (see structure above)

**No backend changes required.** The existing API (`/api/[tableId]/perspectives`) and data model (`Perspective`, `RolePerspective`) remain unchanged. The frontend maps the API response to the new UI structure.

**No database migrations required.**

**UMES events:** No new events needed. Existing perspective CRUD operations remain the same.

**i18n:** New translation keys under `ui.views.*` namespace. Old `ui.perspectives.*` keys kept as fallbacks during transition.

### Dependencies

Check if drag-and-drop library is already available:
```bash
grep -r "dnd-kit\|beautiful-dnd\|drag" package.json packages/ui/package.json
```

If not present, add `@dnd-kit/core` + `@dnd-kit/sortable` as dependency to `packages/ui`.

## Alternatives Considered

### A. Modify PerspectiveSidebar in place
Rejected — the component is 337 lines with mixed concerns (views list, column config, save form). Splitting into focused components is cleaner and more maintainable.

### B. Build as overlay module instead of editing packages/ui
Considered — but this is a core UI improvement that benefits all users. The perspectives module is ejectable, so custom implementations can still override. The core team should decide if this goes into core or as an overlay.

### C. Add backend support for "public" views (not role-scoped)
Deferred — the current `RolePerspective` model covers sharing via roles. A true "public to all users" view type could be added later with a new entity, but is out of scope for T-FE-02.

## Implementation Approach

### Phase 1: Component Refactor (no visual changes)
1. Split `PerspectiveSidebar.tsx` into 5 smaller components
2. Keep exact same behavior and appearance
3. Verify all existing tests pass

### Phase 2: Field Search
1. Add search input to `ViewsColumnConfig`
2. Filter column list by search query
3. Add match count display

### Phase 3: Private/Shared Tabs + Rename
1. Replace section layout with tabs
2. Rename all labels from "Perspectives" to "Views"
3. Add i18n keys

### Phase 4: Quick Switcher
1. Create `ViewsQuickSwitcher` dropdown
2. Integrate above `DataTable`
3. Add "unsaved changes" indicator

### Phase 5: Drag-and-Drop Columns
1. Add drag-and-drop library (if needed)
2. Replace arrow buttons with drag handles
3. Keep checkbox toggles

## Success Metrics

- Users can find a column in <3 seconds (via search) vs current scroll-based approach
- View switching takes 1 click (via quick switcher) vs current 3 clicks (open sidebar → find view → click Use)
- New users understand "Views" terminology without explanation

## Open Questions

1. **Core vs overlay?** — Should this go directly into `packages/ui` or be implemented as an overlay? Discuss with core team.
2. **Drag-and-drop library choice** — Is `@dnd-kit` preferred, or does the project have a different standard?
3. **Quick switcher placement** — Should it be part of the DataTable toolbar or a separate component above it?
4. **Migration path** — Should old `ui.perspectives.*` i18n keys be removed immediately or deprecated gradually?

## Changelog

### 2026-04-04
- Initial specification
