# CRM List Filter Redesign - Consolidated Implementation Spec

Status: In Progress (branch `feat/filters`, pending PR validation)
Date: 2026-05-10
Scope: OSS CRM list filtering for People, Companies, and Deals
Figma: https://www.figma.com/design/oTF1oZoaNgFUdtmxEX2oSc/SPEC-048-CRM-Detail-Pages-UX-Mockup?node-id=1063-92&m=dev

## TLDR

CRM list pages now use a single advanced filter tree experience instead of separate simple and advanced filter controls. The filter trigger lives in the DataTable toolbar beside search, AI, and Views. It opens a Figma-aligned anchored popover with field search, quick presets, saved filters, a Kendo-style `[And] [Or]` group toolbar, within-group drag reorder, inline validation, active chips, and a filter-aware empty state.

The implementation keeps the existing query engine contract: filters serialize to the v2 advanced filter URL format and compile into the existing list API query path. Legacy v1 flat filters still deserialize through the compatibility path. Deals keep their existing association ID filters for people and companies, but surface those selections as removable chips beside the new advanced filter chips. Saved filters are deliberately separate from Views/Perspectives and are not written to the perspectives API or shown in the Views dropdown.

No feature flag is used for this implementation. The new CRM filter UI is wired directly into the People, Companies, and Deals list pages.

## Historical Context

This spec consolidates three earlier design drafts (advanced-filter-tree-design, crm-filter-figma-redesign, and the redesign analysis) into a single PR-ready document. The drafts were removed before merge because the implementation diverged from them in important ways (no feature flag, anchored popover instead of centered dialog, Kendo-style combinator toggle instead of natural-language headers, association filters preserved on Deals). The pivot history is captured in the `Implementation Delta From Earlier Drafts` section below and in git history of the `feat/filters` branch.

## Problem Statement

The CRM list pages had several filter problems:

- Simple filters and advanced filters were separate UI systems, which made CRM list filtering harder to understand and created duplicated state.
- The previous advanced filter control was not aligned with the SPEC-048 Figma mockup. The mockup shows a toolbar-anchored Filters popover, while the earlier implementation used a detached dialog-style panel.
- Flat advanced filters could not express nested boolean intent clearly, especially when the same field appeared in multiple conditions.
- Active filters were not easy to inspect or remove from the list surface.
- Empty result states did not help the user recover from over-filtering.
- CRM owner presets could expose raw UUIDs if owner option metadata was not resolved.
- Existing URL and saved perspective compatibility needed to be preserved.

## Goals

1. Replace the dual simple/advanced filter UI on CRM list pages with one advanced filter tree UI.
2. Match the Figma direction: toolbar trigger, anchored popover, quick filters, searchable field picker, active chips, and compact operator/value controls.
3. Preserve existing list API behavior and URL compatibility.
4. Persist and restore advanced filter trees through DataTable perspectives.
5. Let users save reusable filters without creating or selecting a DataTable View/Perspective.
6. Keep non-CRM DataTable consumers stable.
7. Provide integration coverage using Open Mercato integration test naming conventions.

## Non-Goals

- No natural-language-to-filter AI conversion.
- No group-level NOT operator.
- No cross-group drag-and-drop reparenting.
- No database schema changes.
- No API route changes.
- No server-side shared saved-filter library in this branch; saved filters are local browser preferences.
- No redesign of non-CRM DataTable filter consumers.

## Proposed Solution

CRM pages configure DataTable with `advancedFilter.externalPopover`. In that mode, DataTable renders a single `Filters` toolbar trigger and suppresses the legacy `FilterBar` controls. The CRM page owns the popover state, renders `AdvancedFilterPanel` anchored to DataTable's trigger ref, and serializes the tree into existing v2 filter URL params for server-side list loading.

The advanced filter state is represented as a tree:

```ts
type FilterRule = {
  id: string;
  type: "rule";
  field: string;
  operator: string;
  value?: unknown;
};

type FilterGroup = {
  id: string;
  type: "group";
  combinator: "and" | "or";
  children: Array<FilterRule | FilterGroup>;
};

type AdvancedFilterTree = {
  root: FilterGroup;
};
```

Validation runs before apply. Invalid trees stay editable in the popover, but are not applied to the URL/list request until fixed. Empty trees serialize to no filter params, producing clean URLs.

## Architecture

### Shared Filter Model

Shared filter types live in the existing advanced filter contract in `packages/shared`.

Key behavior:

- `serializeTree(tree)` returns `{}` when the tree contains no rules.
- v2 filter params remain the canonical URL representation for advanced trees.
- Legacy v1 flat filters continue to deserialize through the compatibility path.
- `FilterFieldDef` supports filter display metadata such as `group` and `iconName`.
- `FilterOption` supports a semantic `tone`.
- `mapDictionaryColorToTone(color)` maps dictionary/custom-field colors into semantic filter option tones, including `pink`.

### DataTable Shell

DataTable owns the common toolbar surface and saved perspective integration.

Relevant API additions:

```ts
type DataTableAdvancedFilterConfig = {
  fields: FilterFieldDef[];
  tree: AdvancedFilterTree;
  onTreeChange: (tree: AdvancedFilterTree) => void;
  triggerRef?: React.RefObject<HTMLButtonElement | null>;
  externalPopover?: boolean;
  onTriggerClick?: () => void;
  onApplyTree?: (tree: AdvancedFilterTree) => void;
};

type DataTableProps = {
  activeFilterChips?: React.ReactNode;
  filterAwareEmptyState?: {
    active: boolean;
    entityNamePlural: string;
    canRemoveLast: boolean;
    onClearAll: () => void;
    onRemoveLast: () => void;
  };
};
```

When `externalPopover` is true:

- DataTable renders the `Filters` trigger in the toolbar row with search, AI, and Views.
- DataTable does not render the old inline `FilterBar` filters for that table.
- The trigger exposes `data-testid="advanced-filter-trigger"`.
- DataTable does not render `Save filter`; saved filters belong to `AdvancedFilterPanel`, not to perspectives.
- DataTable persists the advanced tree into perspective filters when the user saves a View.
- Restoring a perspective calls `advancedFilter.onApplyTree` so the owning CRM page and hook state stay in sync.

### Advanced Filter Panel

`AdvancedFilterPanel` renders a Radix popover anchored to DataTable's trigger ref. It is not a viewport-centered dialog and does not use a page-level backdrop.

Panel responsibilities:

- Render quick filters when presets are supplied.
- Render saved filters when `savedFilterStorageKey` is supplied.
- Save the current filter tree into a filter-owned browser storage namespace, separate from DataTable perspectives.
- Render an empty state when no rules exist.
- Render `AdvancedFilterBuilder` for tree editing.
- Display pending validation errors.
- Flush pending valid changes before close/apply where needed.
- Allow nested popover/select portals without closing the outer filter popover.

### Filter Builder

`AdvancedFilterBuilder` renders the editable tree using a Kendo React Filter–style layout.

Behavior:

- Each group renders a single toolbar at the top with, in this order:
  - `[And] [Or]` segmented toggle (the brand-violet–filled side is the active combinator)
  - `+ Add condition` button (opens the field picker)
  - `+ Add group` (root) or `+ Add subgroup` (nested) button
  - `x` delete button (non-root only, right-aligned)
- The toggle is the SINGLE source of truth for the group's combinator. Clicking the unselected side dispatches `updateGroupCombinator`. There are no per-row connector words and no `Where:` prefix anywhere — the toolbar is the only combinator UI.
- To mix AND with OR, the user clicks `+ Add subgroup`, which spawns a nested group with its own toolbar and combinator toggle. The shape mirrors `CompositeFilterDescriptor` semantics in third-party filter libraries (e.g. Kendo React Filter): one `logic` per group, mixed logic via nested groups.
- Rule rows display only the active controls: drag handle, field picker, operator, value input, delete. No leading text decoration.
- Rules can be reordered within the same group through drag-and-drop.
- Cross-group drag-and-drop is intentionally unsupported.
- Users can add conditions and subgroups until the documented caps are reached.
- Rule inputs support text, number, date, select, multi-select, and between operators.
- Select options can display semantic tone dots.

Tree limits remain:

- Maximum group depth: 3
- Maximum children per group: 15
- Maximum total rules: 50

### Tree Reducer

The reducer supports these actions:

- `addRule`
- `addGroup`
- `removeNode`
- `updateRule`
- `updateGroupCombinator`
- `reorderChildren`
- `removeLast`
- `replaceRoot`

`addedAt` is runtime-only metadata used to support "remove last filter" behavior. It is not part of the persisted filter contract.

There is no per-connector flip action. Combinator changes go through `updateGroupCombinator` (the natural-language header). Mixing AND with OR is expressed by adding an explicit subgroup, never by mutating an in-place row connector.

### Validation

`validateTreeForApply(tree, fields)` blocks applying incomplete filters but keeps the editor interactive.

Rules:

- Valueless operators are valid without a value.
- `between` requires both boundary values.
- Multi-value operators require at least one selected value.
- Other value operators require a non-blank value.
- There is no undocumented minimum text length gate.

### Active Chips

`ActiveFilterChips` renders applied top-level filters below the toolbar.

Behavior:

- Hidden while the filter popover is open.
- Hidden when there are no valid visible filters.
- Filters out invalid incomplete rules.
- Renders one chip per top-level child.
- Group chips summarize direct rule children and show an additional count where needed.
- Removing a chip removes the corresponding tree node.

### Filter-Aware Empty State

When a CRM list has no results and active advanced filters exist, DataTable renders `FilteredEmptyResults` instead of a generic empty state.

Actions:

- Clear all filters.
- Remove the most recently added filter when possible.

### Quick Filters

Quick filters are page-owned presets rendered inside the popover.

```ts
type FilterPreset = {
  id: string;
  labelKey: string;
  iconName?: string;
  requiresUser?: boolean;
  build: (ctx: { userId?: string; now: Date }) => AdvancedFilterTree;
};
```

Presets with `requiresUser` are hidden until the current backend user id is available.

Current CRM presets:

- People:
  - Recently active
  - My contacts
  - Hot leads
  - Stale 30 days
- Companies:
  - My accounts
  - Recently created
  - Inactive 60 days
- Deals:
  - My deals
  - Closing this month
  - Won this quarter

The earlier "At risk" deal preset is intentionally omitted because the Deals model does not expose a first-class risk signal.

### Saved Filters

Saved filters are reusable filter trees inside the filter popover. They are intentionally not Views/Perspectives.

Contract:

- The CRM page supplies `savedFilterStorageKey` to `AdvancedFilterPanel`.
- `AdvancedFilterPanel` stores records under `open-mercato:advanced-filters:{key}` in `localStorage`.
- Records contain `{ id, name, tree, createdAt, updatedAt }`, where `tree` is the v2 persisted advanced filter tree (`{ v: 2, root }`).
- Saving a filter updates an existing saved filter with the same name or prepends a new one.
- Saved filters are capped at 20 per CRM list page.
- Applying a saved filter calls `onChange(tree)` and closes the filter popover.
- Deleting a saved filter only removes the local saved-filter record.
- Saved filters never call `/api/perspectives`, never change `activePerspectiveId`, and never appear in the Views dropdown.

Current storage scopes:

- People: `customers.people.list`
- Companies: `customers.companies.list`
- Deals: `customers.deals.list`

### CRM Page Wiring

People, Companies, and Deals list pages:

- Own the advanced filter tree state.
- Configure DataTable in `externalPopover` mode.
- Render `AdvancedFilterPanel` anchored to DataTable's toolbar trigger.
- Render active chips below the toolbar.
- Serialize advanced filters into existing list URL params.
- Restore saved perspective filters into local tree state and hook state.
- Resolve owner filter options for chips, editing, and user-based presets.
- Include custom-field filters with field groups and option tones.

Deals additionally keep legacy association filters for selected people and companies because those list queries use association ID narrowing outside the advanced filter tree. The page renders those association filters as removable chips beside advanced filter chips.

### AI Trigger Placement

The CRM AI search/list trigger is registered in the `search-trailing` slot for:

- People list
- Companies list
- Deals list

This keeps the toolbar order aligned with the Figma direction: search, AI, Filters, Views.

## API Contracts

No new API routes are added.

No existing API route contract is removed or renamed.

Advanced filters continue to be sent through the existing v2 filter URL format:

```text
filter[v]=2
```

The page-level request path continues to convert URL params into the list API query contract. CRM list APIs continue to receive filter conditions through the existing query engine surface.

Legacy v1 filter URLs continue to be accepted and converted through `flatToTree` / deserialization compatibility.

Deals continue to accept existing people/company association filters outside the advanced filter tree.

## Perspective Contract

Saved DataTable perspectives may persist the advanced filter tree in the existing perspective filter payload when a user explicitly saves a View. This is separate from saved filters. When a perspective is restored:

1. DataTable detects the persisted tree payload.
2. DataTable deserializes it into an `AdvancedFilterTree`.
3. DataTable calls `advancedFilter.onApplyTree(tree)`.
4. The CRM page updates local state and the advanced filter hook state.
5. Selecting `No view` clears the active perspective and applies an empty advanced filter tree.

This avoids divergence between DataTable's restored perspective state and the CRM page-owned filter popover state.

Saving a filter from `AdvancedFilterPanel` does not create a perspective, does not select a view, and does not affect the Views/Perspectives menu.

## Backward Compatibility

The change is additive for shared/DataTable contracts:

- New DataTable props are optional.
- Existing DataTable consumers continue to use legacy filters unless they opt into `advancedFilter.externalPopover`.
- Existing advanced filter URL v2 support remains.
- Legacy v1 flat filter URLs remain supported.
- Saved filters are local browser preferences and do not change server or perspective contracts.
- Existing list API paths remain unchanged.
- No database schema or migration is required.
- `FilterFieldDef` gains optional `group?` / `iconName?`, `FilterOption` gains optional `tone?`, `FilterOptionTone` extends additively with `'pink'`, and `Tag` gains a `'pink'` variant — all additive per BC §2.
- `Dialog` gains an optional `elevated?: boolean` prop (renders at the new `z-modal-elevated = 55` z-index) so dialogs opened from inside popovers are not occluded.
- `DataTable` gains optional `activeFilterChips?` and `filterAwareEmptyState?` props; existing callers are unaffected.
- Customers AI trigger widget feature gate intentionally narrows from `[customers.people.view, ai_assistant.view]` (AND-evaluated, which hid the trigger from companies-only and deals-only viewers) to `[ai_assistant.view]`. The host CRM list routes still enforce their respective `customers.people.view` / `customers.companies.view` / `customers.deals.view` guards, so the effective access surface is unchanged — only the redundant per-entity gate on the widget is dropped. The new injection-table mapping for `data-table:customers.deals.list:search-trailing` is additive and reuses the existing widget.

The CRM list UI behavior changes intentionally: People, Companies, and Deals use the new filter UI directly. There is no runtime feature flag for this branch.

## Implementation Delta From Earlier Drafts

The implemented approach differs from the original drafts in these important ways:

- The feature is not guarded by `OM_FILTERS_REDESIGN_V2`.
- The filter panel is an anchored popover, not a centered dialog.
- The `Filters` trigger moved into the DataTable toolbar row.
- The old `FilterBar` is suppressed only for DataTable instances using `externalPopover`.
- Owner options are resolved for CRM presets, chips, and editing so user UUIDs are not exposed as labels.
- Deals receive the AI list trigger as part of this feature.
- Deals keep legacy association filters for selected people/companies and display them as chips.
- The "At risk" deal preset is omitted because there is no stable risk field.
- Text filters do not require a minimum of three characters.
- Drag-and-drop is limited to within-group reorder.
- Per-row connector affordances were removed in two steps. First, `splitConnectorAt` and its SQL-precedence auto-restructuring were removed because the auto-restructuring "mangled" the tree — clicking one connector pulled neighbors into a new synthetic subgroup. After replacing the row popover with a display-only label, the labels still looked clickable to non-technical users (because they sat where interactive controls used to be), so the row connectors and the `Where:` prefix were dropped entirely and the natural-language group header was replaced with a Kendo-style `[And] [Or]` segmented toggle that sits in a single toolbar at the top of every group alongside `+ Add condition`, `+ Add subgroup`, and the group `x`. Combinator changes flow exclusively through that toggle (`updateGroupCombinator`); mixing AND with OR requires an explicit subgroup. The data shape matches Kendo React Filter's `CompositeFilterDescriptor` semantics 1:1 (one logic per group, nested groups for mixed logic).
- Empty trees serialize to no params.
- Custom-field dictionary colors map into semantic option tones.
- Saved filters moved into `AdvancedFilterPanel` local storage so they remain separate from Views/Perspectives.

## Test Coverage

Unit/component coverage includes:

- Advanced filter builder rendering and interactions
- Advanced filter panel anchoring and validation display
- Active filter chips
- Filter-aware empty state
- Field picker search/grouping
- Quick filter presets
- Saved filter save/apply behavior stays separate from perspectives
- Tree reducer actions and limits
- Validation rules
- Shared filter serialization/deserialization
- Advanced filter hook auto-apply and validation suppression

Integration coverage follows Open Mercato naming conventions:

- `TC-CRM-031.spec.ts` - DataTable advanced filter builder coverage
- `TC-CRM-046.spec.ts` - Deals list association filter compatibility
- `TC-CRM-047.spec.ts` - Advanced filter URL roundtrip coverage
- `TC-CRM-059.spec.ts` - People CRM filter UX
- `TC-CRM-060.spec.ts` - Companies CRM filter UX
- `TC-CRM-061.spec.ts` - Deals CRM filter UX
- `TC-CRM-062.spec.ts` - Keyboard reorder behavior
- `TC-CRM-063.spec.ts` - Filter-aware empty state
- `TC-CRM-064.spec.ts` - Validation blocks invalid apply

Integration suite results are tracked per branch tip via `yarn test:integration`; do not pin a specific pass/fail count in this spec — re-run the suite on the merge commit and record the result in the PR description.

## Risks & Impact Review

| Risk | Severity | Affected Surface | Mitigation | Residual Risk |
|------|----------|------------------|------------|---------------|
| Saved perspectives restore stale or malformed filter payloads | Medium | DataTable perspectives | Detect persisted tree shape and fall back through compatibility handling | Low |
| Owner presets expose raw UUID labels | Medium | CRM owner filters | Resolve assignable staff options and include current user fallback option | Low |
| Users cannot easily express mixed AND/OR within a single visual group | Low | Filter builder | Row connectors are display-only and reflect the group combinator 1:1; mixing requires `+ Add subgroup`, mirroring widely-understood `CompositeFilterDescriptor` semantics | Low |
| Existing non-CRM DataTables lose simple filters | High | Shared UI | `externalPopover` opt-in only; legacy `FilterBar` remains default | Low |
| Deals association filters diverge from advanced chips | Medium | Deals list | Keep association filters as separate chips and clear handlers | Medium |
| Incomplete filters accidentally apply | Medium | CRM list requests | Validation blocks apply and surfaces pending errors | Low |
| Saved filters are mistaken for views | Medium | CRM filter UX | Saved filters are owned by `AdvancedFilterPanel`, stored under a filter namespace, and never use `/api/perspectives` | Low |

## Final Compliance Report

| Requirement | Status | Notes |
|-------------|--------|-------|
| Figma-aligned toolbar trigger | Done | Trigger is in DataTable toolbar beside search, AI, and Views |
| Anchored popover | Done | Panel uses trigger ref anchoring |
| Single CRM filter UI | Done | Legacy `FilterBar` suppressed for CRM external popover mode |
| Advanced tree filters | Done | v2 tree model with nested groups |
| URL compatibility | Done | v2 canonical, v1 fallback retained |
| Perspective persistence | Done | Persist/restore advanced tree with `onApplyTree` |
| Save filter | Done | Filter popover exposes a filter-owned save dialog and local saved-filter list, separate from Views |
| Quick filters | Done | Page-owned presets for People, Companies, Deals |
| Active chips | Done | Top-level chips plus Deals association chips |
| Filter-aware empty state | Done | Clear all and remove last actions |
| Owner option labels | Done | Staff option resolver used by CRM pages |
| Custom-field option tones | Done | Dictionary color to semantic tone mapping |
| Integration test naming | Done | New tests use `TC-CRM-0XX.spec.ts` convention |

## Changelog

- 2026-05-10: Created consolidated CRM list filter redesign spec from the original tree design, original Figma redesign draft, later implementation changes, review fixes, and final validation results.
- 2026-05-10: Clarified that saved filters are a filter-popover feature backed by a local saved-filter namespace and are separate from DataTable Views/Perspectives.
- 2026-05-10: Removed the per-row connector flip affordance and the `splitConnectorAt` reducer action. Row connectors (`and`/`or`) became display-only labels driven by the parent group's combinator; combinator edits flowed exclusively through the natural-language group header. This eliminated the SQL-precedence auto-restructure that visibly "mangled" filters when users tried to flip a single connector.
- 2026-05-10: Replaced the natural-language group header (`All of the following must be true:` / `Any of the following are true:`) with a Kendo-style `[And] [Or]` segmented toggle, dropped the `Where:` row prefix, and dropped the now-redundant `and`/`or` row labels entirely. The "+ Add condition" / "+ Add subgroup" buttons and the group `x` were moved into the same toolbar as the toggle so each group has ONE place to manage everything. Reason: after the previous iteration, non-technical users still treated the static row labels as clickable and reported the feature as broken when nothing happened on click. Eliminating the misleading affordance and matching the Kendo React Filter pattern 1:1 makes the combinator control unmistakable. New i18n keys: `ui.advancedFilter.combinator.and` / `combinator.or` / `combinator.label`. Removed: `ui.advancedFilter.where`, `allMatch`, `anyMatch`. Lower-case `connector.and` / `connector.or` are kept for the drag ghost preview.
- 2026-05-11: Renamed from `2026-05-10-crm-filter-approach.md` to `2026-05-10-crm-list-filter-redesign.md` to match the naming pattern used by sibling CRM specs (e.g. `2026-04-06-crm-detail-pages-ux-enhancements.md`). Removed the three superseded draft files (`2026-05-07-advanced-filter-tree-design.md`, `2026-05-08-crm-filter-figma-redesign.md`, `analysis/ANALYSIS-2026-05-08-crm-filter-figma-redesign.md`) — their content is captured in the consolidated spec and in git history. Documented additional BC bullets (`Dialog.elevated`, `DataTable` new optional props, `Tag` `pink` variant, AI trigger feature-gate narrowing) and removed the pinned integration test count claim.
