# DataTable interactive column resize + width persistence

## TLDR
**Key Points:**
- Backend `DataTable` columns can now be **resized by dragging** a handle on the header's right edge, and the widths **persist per user** (in `PerspectiveSettings`, and across a plain refresh via the local perspective snapshot) — resolves #1835.
- No new API route, no schema change: `columnSizing` is an additive optional field on the existing `PerspectiveSettings` contract, saved/loaded exactly like `columnOrder`/`columnVisibility`.
- Additive and opt-out-free: only columns the user actually drags get an explicit width; every other column keeps today's auto-layout + `meta.maxWidth` behavior unchanged.

**Scope:**
- `PerspectiveSettings.columnSizing?: Record<string, number>` (px, keyed by column id).
- A manual pointer-driven resize handle per data-column header (mirrors the deals-pipeline `LaneResizeHandle`), rAF-throttled, with a double-click reset.
- Width applied inline (`width`/`minWidth`/`maxWidth`) to the resized column's header and body cells, and used as the truncation max-width so content truncates at the dragged width.
- Persistence wired through the existing snapshot (`writePerspectiveSnapshot`) and the perspective save/apply paths; `sanitizePerspectiveSettings` validates + clamps untrusted widths to `[60, 900]` px.

**Concerns (if any):**
- Chose a manual resize handle over TanStack's built-in `columnSizing`/`table-layout: fixed` to avoid forcing fixed layout on every DataTable in the app (a broad regression surface). The manual approach keeps auto layout and touches only resized columns.

## Overview
`DataTable` already persists column order, visibility, sorting, filters, and page size via `PerspectiveSettings`. Column **width** was the one missing dimension: users could not drag column edges, and widths reset to code-defined `meta.maxWidth` defaults on every load. This adds interactive resizing and per-user width persistence.

## Problem Statement
- Columns cannot be resized; the only width control is the static, developer-set `meta.maxWidth` (truncation), which users cannot adjust (#1835, and the downstream symptom #2947 "Order number column too narrow").
- Any manual width would reset on refresh — there was no `columnSizing` in `PerspectiveSettings` and no resize UI.

## Proposed Solution
1. **Persistence type** — add `columnSizing?: Record<string, number>` to `PerspectiveSettings` (`packages/shared/src/modules/perspectives/types.ts`).
2. **State + wiring** (`packages/ui/src/backend/DataTable.tsx`) — a `columnSizing` React state (seeded from the initial/merged perspective settings) plus a ref mirror so the pointerup commit reads the latest widths without a stale closure.
3. **Resize handle** — `ColumnResizeHandle` renders an absolutely-positioned right-edge grip on each data-column header. A short, always-visible vertical grip marks every column edge as resizable (the discoverability affordance); it grows to full height and brightens to the primary colour on header/handle hover and while dragging, over a comfortable 12px hit area. It measures the header's real current width on pointer-down (so there is no jump on the first drag), tracks the pointer (rAF-throttled) to update `columnSizing` live, and commits to the snapshot on pointer-up. `stopPropagation` keeps the header reorder-DnD and sort-toggle from firing; double-click resets that column's width.
4. **Width application** — resized columns get inline `width`/`minWidth`/`maxWidth` on header (`SortableHeaderCell`/`TableHead`) and body cells, and the width overrides the truncation `maxWidth` so content truncates at the dragged width. Non-resized columns are untouched.
5. **Persistence** — `getCurrentSettings` includes `columnSizing` (saved with perspectives); `applyPerspectiveSettings` restores/clears it (so applying a saved view or selecting "No view" behaves correctly); a live commit merges widths into the local snapshot so they survive a refresh even without saving a perspective — including a "No view + widths" snapshot that would otherwise be cleared.

### Design Decisions
| Decision | Rationale |
|----------|-----------|
| Manual pointer handle, not TanStack `columnSizing` + `table-layout: fixed` | The table uses auto layout + `TruncatedCell(maxWidth)`. Forcing fixed layout to make TanStack sizing visible would change every DataTable's column distribution app-wide (high regression risk). The manual handle keeps auto layout and only pins the columns the user actually resizes — mirroring the already-shipped `LaneResizeHandle` pattern. |
| Widths in `PerspectiveSettings` | Matches `columnOrder`/`columnVisibility` exactly, so widths save per-user with perspectives and ride the same snapshot restore — pkarw's "store per user, similarly to perspectives". |
| Resize offered only on perspective-enabled tables (`enableColumnResize = perspectiveEnabled`) | Because the feature lives in the shared `DataTable`, it reaches **every** consumer with no per-table migration. But resizing is only useful where it persists (widths need `perspectiveTableId`), so it is gated on the perspective config: the ~47 backoffice list tables that pass `perspective` get it automatically, while the ~39 that opt out (settings/sub-tables, logs, and customer **portal** tables — which by convention omit column-management features) get no handle instead of a live-only resize that silently resets on reload. No data migration is needed — `columnSizing` is an additive optional JSON field; existing perspectives/snapshots without it keep working. |
| Clamp `[60, 900]` px in `sanitizePerspectiveSettings` | Widths come from untrusted sources (localStorage snapshot, saved-perspective API); clamping prevents a persisted/dragged value from collapsing a column or blowing out the table. |

## Data Models
`PerspectiveSettings` (additive, backward compatible):
```typescript
type PerspectiveSettings = {
  columnOrder?: string[]
  columnVisibility?: Record<string, boolean>
  columnSizing?: Record<string, number> // NEW (#1835): px width per column id
  filters?: Record<string, unknown>
  sorting?: Array<{ id: string; desc?: boolean }>
  pageSize?: number
  searchValue?: string
}
```
No DB/schema change: perspective settings are stored as JSON by the existing perspectives module; `columnSizing` is just another optional key. Old snapshots/perspectives without it keep working (widths simply default to auto).

## API Contracts
No new or changed endpoints. `GET/POST /api/perspectives/:tableId` carry the new optional `columnSizing` key inside `settings`. The server-side `perspectiveSettingsSchema` (`packages/core/src/modules/perspectives/data/validators.ts`) is extended to accept + validate it (`Record<columnId, int 60..900>`) — without that key zod would strip widths on save, so saved/role perspectives would never carry them. Old perspectives without the key remain valid.

## Integration Test Coverage (required)
- **TC-CRM-086** (`packages/core/src/modules/customers/__integration__/`): (1) on `/backend/customers/companies`, drags a column header's resize handle → the column widens; the width **survives a full page reload** (persisted snapshot); **double-click resets** the column to its auto width (self-contained — creates + deletes two companies); (2) on `/backend/logs` (a no-perspective table) asserts **no resize handle renders**, guarding the perspective gate.
- Unit: `DataTable.columnSizing.test.ts` (sanitize validation/clamping of untrusted widths, prototype-key rejection) and a `columnSizing` round-trip case in `DataTable.perspectiveStorage.test.ts`.

## Risks & Impact Review
### Data Integrity Failures
- Widths are presentation-only and clamped on read; a malformed/oversized persisted value cannot corrupt data or break layout (clamped to `[60, 900]`).

### Cascading Failures & Side Effects
- Change is additive and opt-out-free: unresized columns render exactly as before. Resize handle events `stopPropagation` so column reorder-DnD and sort remain intact (covered by existing DataTable tests, all green).
- `sanitizePerspectiveSettings` is now exported for unit testing (additive; no behavior change).

## Final Compliance Report
- `yarn typecheck` clean; `yarn eslint` on touched files: 0 errors (pre-existing warnings only); `yarn i18n:check-sync` clean (new `ui.dataTable.resizeColumn` key in en/pl/es/de across app + create-app template).
- `@open-mercato/ui` DataTable suite: 8 suites / 34 tests green (incl. the 2 new unit specs). TC-CRM-086 green against the dev server. Manually verified in-browser: persisted width applies to header + body cells after reload.

## Changelog
- 2026-07-05: Initial implementation (#1835). Added `PerspectiveSettings.columnSizing`; `ColumnResizeHandle` + width application + persistence in `DataTable.tsx`; `ui.dataTable.resizeColumn` i18n (4 locales, app + template); unit tests (`DataTable.columnSizing.test.ts`, storage round-trip) and integration test TC-CRM-086.
