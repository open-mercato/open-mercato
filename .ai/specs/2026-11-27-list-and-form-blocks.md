# List and form blocks

Status: in progress
Date: 2026-11-27
Related: `.ai/specs/2026-11-24-business-blocks-and-component-showcase.md` (block rules, contracts, showcase), `.ai/specs/2026-11-25-component-spacing-standard.md`, `.ai/specs/2026-08-01-pinned-form-action-bar.md` (superseded on bar placement, see Decisions)

## TLDR

Six blocks are not enough to compose a screen. This spec adds three blocks for list and form screens (`bulk-action-bar`, `list-toolbar`, `form-save-bar`), extends `entity-header` so it also serves as a page header, and shows the existing `DataTable` in the showcase as a documented backend component. `DataTable` itself is not changed.

## Problem

- List screens have no reusable part for what sits above and below the table. Search, filters, applied filters and bulk actions are inline code inside `DataTable`; two modules already ship their own, differently looking bulk bars.
- Bulk actions sit in a corner of the filter row and scroll out of view. There is no clear-selection control and no overflow rule.
- Long forms show Save twice (header and footer) and neither stays in view. Nothing tells the user there are unsaved changes.
- Page headers exist in three forms (`PageHeader`, `FormHeader`, `EntityHeader`) with three truncation behaviours; only `EntityHeader` has structured actions and states.
- `DataTable` is used on about 150 screens but is absent from the showcase, so its inputs and host requirements are undocumented.

## Decisions

1. **Records table.** `DataTable` is documented in the showcase with local-data examples and a list of what it needs from the host (router, query client) and which features call the server (saved views, custom-field columns and filters, auto-discovered filters, export). It is not wrapped as a block: it depends on the router, the query client, the injection system and application events. A new presentational table block is a later, separate decision.
2. **Phones in a future table block.** Low-priority columns hide and the row expands; no card layout.
3. **Bulk action bar.** Floating at the bottom of the screen by default, `inline` for dialogs and panels.
4. **Form save bar.** At the bottom, visible only while there is something to report (unsaved changes, saving, saved, failed). This replaces the top-pinned header proposed in the 2026-08-01 draft for pages that adopt the block. `CrudForm` is a stable contract and is not changed here; adoption inside `CrudForm` needs its own spec.
5. **Page header.** No new block. `entity-header` gains tabs as data, a back link and a count next to the title. No breadcrumb prop: the application shell already shows the trail in the top bar.
6. **Order.** Bulk action bar, list toolbar, form save bar, entity-header extension, `DataTable` in the showcase.

Shared rules for all four: no data source inside, data in through props and events out through callbacks; sticky or floating behaviour is opt-in or has an in-flow placement; offsets use `--topbar-height` with a `0px` fallback and z-index tokens; action lists show a limited number of buttons with the rest in a menu, destructive actions always in the menu, and a disabled action can carry a visible reason; targets are 40 px below `sm`.

## Contracts

### `bulk-action-bar`

- **Input:** `selectedCount`, `totalCount?`, `allMatchingSelected?`, `summary?`, `actions: BlockAction[]`, `maxVisibleActions?`, `pendingActionKey?`, `progress?: { label; done?; total? }`, `position?: 'floating' | 'inline'`, `clearOnEscape?`.
- **Events:** `onAction(actionKey)`, `onClear()`, `onSelectAllMatching?()`.
- **Slots:** `trailing`.
- **State ownership:** the host owns selected ids (the block sees only the count), runs the actions, confirmation, progress and undo. The block owns per-action pending while a returned promise is unresolved, the overflow menu and the Escape listener. It renders nothing at zero selection without progress.

### `list-toolbar`

- **Input:** `search?: { value; placeholder?; debounceMs? }`, `quickFilters?`, `filtersActiveCount?`, `chips?` (human-readable labels), `maxVisibleChips?`, `views?` (each may carry `href`), `activeViewId?`, `primaryAction?`, `secondaryActions?`, `resultSummary?`, `busy?`, `sticky?: 'none' | 'top'`, `stickyOffset?`, `status?: 'loading' | 'ready'`.
- **Events:** `onSearchChange`, `onQuickFilterToggle`, `onOpenFilters(anchor)`, `onChipOpen`, `onChipRemove`, `onAddFilter`, `onClearAll`, `onViewChange`, `onAction`.
- **Slots:** `leading`, `searchTrailing`, `trailing`.
- **State ownership:** the host owns the applied search value, filters, active view and the filter panel. The block owns the search draft and debounce, the expanded state of the applied-filters row and the stuck state.
- **Layout:** the applied-filters row exists only when filters are applied. The page's main Create action normally stays in the page title row; the toolbar's primary action is optional.

### `form-save-bar`

- **Input:** `saveState: 'idle' | 'dirty' | 'saving' | 'saved' | 'failed'`, `message?`, `savedAt?`, `formId?`, `saveLabel?`, `resetLabel?`, `saveDisabledReason?`, `actions?`, `placement?: 'floating' | 'container' | 'inline'`, `alwaysVisible?`.
- **Events:** `onSave?()`, `onReset?()`, `onAction?(actionKey)`. `formId` or `onSave` is required.
- **Focus:** when the bar hides while keyboard focus is inside it, focus moves to the element returned by the optional `getReturnFocusTarget?()`, otherwise to the form named by `formId` (the form itself when it carries `tabindex`, else its first enabled field), otherwise it is left alone. Focus outside the bar is never moved.
- **Slots:** `leading`, `trailing`.
- **State ownership:** the host owns the form, dirty tracking, saving, navigation guards, keyboard shortcuts and conflict handling. The block owns pending during an `onSave` promise and the overflow menu. Hidden in `idle` unless `alwaysVisible`.

### `entity-header` additions (all optional)

- `tabs?: { key; label; icon?; count?; disabled?; href? }[]`, `activeTabKey?`, `onTabChange?(tabKey)`: an underline strip across the full header width; the host renders the panels.
- `backLabel?`, `backHref?`, `onBack?()`.
- `count?` next to the title.

## Backward compatibility

Additive only. New import paths `@open-mercato/ui/blocks/bulk-action-bar`, `/list-toolbar`, `/form-save-bar` and their contracts; new optional props on `EntityHeader`. No existing prop, slot, event, `data-slot` attribute, import path, API route or database object changes. `DataTable`, `CrudForm`, `FormHeader`, `FormFooter`, `FilterBar` and the module-local bulk bars keep their current behaviour; moving any screen onto the new blocks is a later, per-screen decision.

## Integration coverage

No API paths change. Coverage is unit and gallery level: contract tests and component tests per block, gallery render tests for the new entries, inventory and translation parity. UI paths for adoption are covered when a screen adopts a block.

## Risks

- **Sticky stacking.** The table header computes its offset from the top bar only; a sticky toolbar above it needs that offset included when a screen combines them. The progress bar under the top bar sticks at the same edge. Sticky stays opt-in.
- **Selection.** `DataTable` does not expose its selection, so pairing the bulk bar with it needs an additive `onSelectionChange` first. Selecting all matching rows changes what a bulk action receives and needs server support; the prop exists, adoption is later.
- **Conflict banner.** The edit-conflict banner renders at the top of the page; with a bottom save bar the host should also set `saveState="failed"` with a short message.
- **Two tables.** If a new table block is built later it can drift from `DataTable`; that work needs its own spec.

## Changelog

- 2026-11-27: Spec written; blocks, header extension and the `DataTable` showcase entry in progress.
