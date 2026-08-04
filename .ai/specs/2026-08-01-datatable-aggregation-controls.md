# DataTable Aggregation Controls and Perspective Persistence

> **Status**: Draft — ready for implementation
> **Scope**: OSS (`packages/shared`, `packages/ui`, `packages/core`)
> **Created**: 2026-08-01
> **Revised**: 2026-08-03
> **Prerequisites**: [`2026-08-01-datatable-native-column-footers.md`](./2026-08-01-datatable-native-column-footers.md), [`2026-07-24-datatable-column-aggregations.md`](./2026-07-24-datatable-column-aggregations.md), [`2026-08-01-sales-orders-aggregation-consumer.md`](./2026-08-01-sales-orders-aggregation-consumer.md)

## TLDR

Add one optional aggregation-only menu to eligible `DataTable` column headers and persist each user's supported function choices in the existing Perspective settings document. This spec changes only interaction and view-state persistence: it reuses the aggregate loader/lifecycle and native footer defined by the prerequisite specs, introduces no new aggregate API, and keeps all existing tables inert unless their columns explicitly opt in.

## Overview

This specification adds the persisted interaction layer after the backend service, Orders consumer, and native footer exist. It extends the existing `DataTable` Perspective state with one accepted aggregation-selection map, permits edits only on an active personal view, keeps role views read-only and no-view empty, and replaces the temporary Orders toggle through a mutually exclusive controller mode.

## Resolved assumptions

| Question | Decision | Rationale |
|---|---|---|
| Menu scope | Aggregation functions plus “None” only, opened by a new dedicated trigger | Sort, hide, pin, and general column menus are separate interaction work; `DataTable` has no existing column-menu trigger to reuse |
| Persistence | Existing per-user Perspective settings already owned by `DataTable` | Aggregation selection is view preference, not role policy or business data; shared UI already owns Perspective fetch/apply/save |
| Identity | Stable TanStack column id | Accessor labels and physical/API field names can differ and must not become persistence keys |
| Unsupported stale values | Sanitize and omit them on load and the next save | Columns/functions can change between releases; fail closed without breaking the Perspective |
| Defaults | No active aggregation unless the host supplies a documented default | Avoids new requests and UI changes on existing views |
| Selection ownership | Use exactly one accepted stable-column-id map for the active view | External-selection mode keeps the prerequisite `selections`; controls mode derives the map from `DataTable`'s accepted Perspective state, and the two modes are mutually exclusive |
| Save target | Only an active personal Perspective is editable | A role Perspective is shared/read-only here, and “No view” has no record/version to update safely |
| Orders adoption | Replace the temporary “Show totals” toggle in the same implementation | This is the controls capability's cutover acceptance criterion, not a separate deployable capability; the fixed toggle and per-column controls must never compete for precedence |

## Problem Statement

The aggregate/orders capability proves server totals with an ephemeral list-level toggle, but users who repeatedly inspect totals need a stable per-column choice. Persisting request fields or SQL selectors would leak route implementation into user settings. A general-purpose column menu would also bundle unrelated behavior.

This capability therefore stores only `{ stableColumnId: supportedFunction }` and lets the existing host/controller translate current eligible columns into aggregate requests.

## Goals

- Let a user choose one supported aggregation function or “None” from an eligible column header.
- Persist supported choices in the currently active personal Perspective.
- Restore choices without an extra request beyond existing Perspective loading.
- Prune unknown columns and unsupported functions before they reach the aggregate loader.
- Preserve DataTable behavior, markup, and network activity when no column opts in.
- Cover keyboard, screen-reader, persistence, stale-setting, and multi-view isolation behavior.

## Non-goals

- Sorting, hiding, pinning, grouping, formula builders, role defaults, or admin policy.
- Multiple simultaneous functions on one column.
- Adding a new Perspective endpoint, database column, aggregate route, or server selector.
- Persisting aggregate results.
- Keeping the prerequisite fixed “Show totals” toggle after Orders adopts these controls.

## Proposed Solution

Add an optional `aggregations` map to `PerspectiveSettings`, extend `DataTable`'s existing sanitize/get/apply/save paths, and add a discriminated controls arm that cannot coexist with externally supplied selections. Eligible column headers expose only supported aggregate functions and “None”. A proposed choice becomes accepted only after the existing guarded, optimistically locked personal-Perspective save succeeds.

## Architecture

`DataTable` retains its current Perspective API/query/mutation ownership and owns the accepted selection state plus header interaction. The Sales host retains route/filter serialization and the summary loader. The controls mode reuses the prerequisite controller/formatter/footer types and imports no Sales API into shared UI. No-view has an empty map; role-view settings may drive read-only totals; personal views alone are mutable.

## Data Models

The only persisted-model change is additive `PerspectiveSettings.aggregations?: Record<stableColumnId, DataTableAggregationFn>` in the shared type, core zod validator, and UI sanitizer. No database column or migration is required because settings already persist as the existing document. Public/physical request fields and aggregate results are never stored.

## API Contracts

No new endpoint is introduced. Existing Perspective GET/POST routes accept and return the optional settings member under their current auth, tenant/user scope, mutation guard, and optimistic-lock contract. The existing Orders summary API is consumed through the prerequisite loader and is unchanged by this spec.

## Contract

### Column opt-in

The aggregate metadata from the Orders consumer/controller remains the source of supported functions. Controls appear only when the `aggregation` controller and all required column metadata exist:

```ts
meta: {
  aggregation: {
    requestField: 'grandTotalGrossAmount',
    functions: ['sum', 'avg'],
    groupKeyAccessor: 'currency',
    formatValue: formatAggregateCurrency,
  },
}
```

`requestField` and physical selectors are never persisted. `DataTable` uses `column.id` as the Perspective key and resolves the active function through the current column metadata before constructing the existing controller's `{ field, fn }` request. External-selection mode reads the prerequisite `aggregation.selections`; controls mode reads `acceptedAggregationSelections` from the active Perspective settings. The discriminated contract prevents both sources from existing at once.

### Perspective settings

Extend the existing exported settings type and matching runtime validator additively:

```ts
type DataTableAggregationFn = 'sum' | 'avg' | 'min' | 'max' | 'count'

type PerspectiveSettings = {
  // existing optional properties remain unchanged
  aggregations?: Record<string, DataTableAggregationFn>
}
```

The implementation updates the authoritative shared type, the core Perspective API validator, and the UI serializer/sanitizer together. The field is optional; missing data means no stored selection.

On load, the UI intersects stored keys with current columns and stored values with each column's current `functions`. Invalid entries are ignored and excluded the next time the Perspective is saved. A malformed non-object `aggregations` value fails normal API validation; an individually unknown function is rejected by the enum. No unsafe value is forwarded to the aggregate route.

Perspective ownership, tenant/organization scope, optimistic locking, and existing guarded mutation/error handling remain unchanged. `DataTable` extends its existing `sanitizePerspectiveSettings`, `getCurrentSettings`, and `applyPerspectiveSettings` paths so load, local snapshot, save, and server response all carry the same sanitized map. The existing save mutation updates the active personal Perspective in place with its current id/name/default metadata and the complete proposed settings, without applying or clearing role defaults. It preserves that record's `updatedAt` header.

### Header interaction

`DataTable` does not currently have a column-menu trigger, and the repository has no generic `DropdownMenu` primitive with the checked-item and arrow-key contract this control needs. Eligible headers therefore add one focused `ColumnAggregationMenu` component composed from the existing `IconButton`, `Popover`, and `Button` primitives. Its dedicated trigger sits next to the label/sort control, is `size="xs"` (24 by 24 CSS pixels), uses `type="button"`, and has a translated accessible name that includes the column label. This is the first column-header menu interaction in `DataTable`; it is not presented as reuse of an existing header affordance.

The trigger and sort control are sibling interactive elements; neither may contain the other. The sort control keeps the label and its current sort behavior, while the menu trigger owns only menu open/close. Activating the menu trigger by pointer, touch, Enter, or Space must not call `column.toggleSorting`, change `aria-sort`, or reorder rows. The sibling layout provides a visible gap and independent `focus-visible` treatment so a miss on the menu target cannot land inside the sort target.

The menu contains:

- “None”;
- one translated item for each function in the column metadata, in metadata order.

Menu items use `role="menuitemradio"` plus `aria-checked`, with the existing lucide check icon as the visual selected state. With an active personal Perspective, choosing an item builds a proposed map and invokes `DataTable`'s existing guarded Perspective save. The proposal is pending UI only: `acceptedAggregationSelections` remains authoritative until the successful response is applied through `applyPerspectiveSettings`. Only that success transition changes footer requests. A failure surfaces through the existing Perspective error UI, clears pending state, and leaves the last persisted selection/footer intact.

With “No view” active, the accepted map is `{}`, no totals load, and menu items are disabled with a translated explanation that a personal view must be saved or activated before editing totals. With a role Perspective active, its stored valid selections render and load totals, but the same menu items remain read-only with that explanation. This control never creates a Perspective implicitly and never mutates a role-owned Perspective.

`ColumnAggregationMenu` explicitly owns the small menu keyboard contract that no existing generic primitive provides: Enter/Space on the trigger opens the `Popover`; opening focuses the checked item or “None”; Arrow Up/Down and Home/End move a single roving tab stop without saving; Enter/Space commits only the focused choice; and Escape closes the popover and restores focus to the trigger. Pointer/touch selection commits the clicked item once. The focus implementation is local to this focused component and does not create a new public generic menu API.

## Data flow and ownership

1. `DataTable` uses its existing Perspective query/apply path to sanitize the active view's `aggregations` into `acceptedAggregationSelections`.
2. It matches that map's keys to current stable column ids and functions to current metadata; the same accepted map drives checked state and summary loading.
3. A user may propose a next map only while an active personal Perspective exists; “No view” and role views remain read-only.
4. `DataTable` merges the proposal into `getCurrentSettings()` and updates that personal record through its existing guarded/optimistically locked save mutation. The accepted map does not change while the request is pending.
5. On success, `applyPerspectiveSettings` installs the server-returned accepted map; the controller aborts stale work and loads footer values. On failure, pending state clears and the accepted map never changes.

`DataTable` remains the sole Perspective API/persistence owner, as it is today. The Sales host remains the sole owner of route-specific filter serialization and `loadSummary`; shared UI gains no Sales import.

## Public UI surface

Extend the prerequisite controller with a second, mutually exclusive mode:

```ts
type DataTableAggregationSource =
  | {
      selections: Readonly<Record<string, DataTableAggregationFn>>
      controls?: never
    }
  | {
      selections?: never
      controls: { persistence: 'active-personal-perspective' }
    }

aggregation?: {
  summaryKey: string
  loadSummary: DataTableSummaryLoader
} & DataTableAggregationSource
```

The existing external-selection arm remains source-compatible for the temporary Orders toggle and other callers. Controls mode adds no callback and forbids `selections`; checked state, aggregate loading, and persistence all read the one accepted map maintained by `DataTable`'s Perspective state. Controls render only for eligible columns in controls mode and are editable only for an active personal Perspective. Runtime development assertions and type tests reject a configuration that supplies both `selections` and `controls`.

## Frontend Architecture Contract

### Server/client boundary map

| Surface | Server root | Client island | Data owner |
|---|---|---|---|
| Existing Perspective-backed list | existing generated page | existing list host and `DataTable` | table owns Perspective API/accepted selections/menu; host owns aggregate filter serializer and loader |
| Existing Perspective API | existing authenticated route | none | existing tenant/user-scoped service |

### `"use client"` ledger

| File | Reason | Imported by | Heavy dependencies | Cleanup/hydration risk | Alternative rejected |
|---|---|---|---|---|---|
| `packages/ui/src/backend/DataTable.tsx` or extracted `ColumnAggregationMenu` sibling (existing island) | new dedicated header-menu trigger, local roving focus, and selection | backend lists | existing `IconButton`/`Popover`/`Button`/TanStack only | persisted initial choices must be supplied before first render; trigger events must never reach the sibling sort control | route-specific control outside the column header cannot satisfy this capability |
| `packages/ui/src/backend/DataTable.tsx` Perspective paths (existing island) | fetch/apply/guarded-save accepted selection state | Perspective-enabled backend lists | existing React Query/API/guard utilities only | save success is the only accepted-map transition; no-view/role-view controls stay read-only | moving current Perspective ownership into every module host would duplicate established shared behavior |
| existing Sales list host | owns only aggregate filter serialization and `loadSummary` | Sales module page | none new | filter key must match visible rows | importing Sales routes into shared UI would invert ownership |

### Budgets and evidence

- zero new production dependencies, providers, or page-root client islands;
- at most 120 net new shared UI LOC before extracting a focused aggregation-control component;
- no aggregation-attributable aggregate or Perspective request for tables without eligible metadata; existing Perspective-enabled tables retain their normal Perspective query;
- one existing Perspective save per committed selection on an active personal view, with no save on open/cancel/disabled choice;
- the new menu trigger keeps a 24 by 24 CSS-pixel target at every supported viewport and never changes sorting when activated;
- restore/sanitize work is linear in visible columns plus stored entries;
- `yarn check:client-boundaries`, `yarn build:packages`, `yarn typecheck`, `yarn test`, and `yarn build:app` pass;
- Playwright covers keyboard choice, reload persistence, separate Perspective isolation, stale entry pruning, and failed-save rollback.

## UI, accessibility, and i18n

- Add a focused `ColumnAggregationMenu` from the existing `IconButton`, `Popover`, `Button`, and tooltip primitives; keep its roving-focus/menuitemradio behavior private, do not invent a generic dropdown API or add a dependency, and do not treat the current full-cell sort button as a menu trigger.
- All trigger labels, function names, “None”, loading, and failure text use locale keys in every supported UI locale.
- Use semantic/design-system foreground, border, checked, hover, and focus tokens; no hardcoded colors, arbitrary values, inline SVG, or `dark:` semantic overrides.
- The current function is exposed through checked-menu semantics and a concise translated tooltip; color alone never conveys state.
- Disabled state explains why controls cannot be changed while a prior Perspective save is in flight.
- The sort control and 24 by 24 menu target have independent accessible names, focus rings, and hit areas; opening or choosing from the menu never changes sort state.

## Error and edge behavior

- Stored id no longer exists: ignore and prune on the next save.
- Function no longer supported by the current column: ignore and prune.
- Column is hidden: keep its valid stored selection, but the prerequisite loader requests only active visible eligible columns; revealing it restores the selection and reloads.
- Controls mode without Perspective configuration: controls do not render.
- “No view” active: accepted selections are `{}`, no summary request runs, choices are disabled with a translated “save or activate a personal view” explanation, and no save occurs.
- Role Perspective active: its valid stored selections are accepted and totals may load, but choices are read-only with the translated personal-view explanation and no save occurs.
- Save returns optimistic-lock 409: use the existing unified conflict UI, clear pending state, and retain the accepted map.
- Aggregate load fails after a successful save: keep the preference, show the prerequisite non-blocking footer error, and allow retry.
- Rapid selections: controls are disabled while the guarded save is pending; only an accepted selection drives summary generation.
- Different Perspectives on the same table keep independent maps.

## Test plan

### Shared/type/API

- optional `aggregations` round-trips with all five functions;
- omitted field preserves old Perspective payloads;
- malformed object/function rejects without weakening existing validation;
- tenant/user ownership and optimistic-lock behavior remain covered;
- unrelated Perspective settings survive a save.

### UI

- control absent for ineligible columns and absent prop;
- function list follows metadata and selected check state;
- stable column id, not label/accessor/request field, is persisted;
- unknown columns/functions are ignored and pruned;
- hidden-column selection behavior;
- external/controller-mode type compatibility plus rejection of simultaneous `selections` and `controls`;
- active-personal pending checked state, successful accepted-map update through `applyPerspectiveSettings`, failed-save pending-state clear, 409 conflict, and disabled-during-save behavior;
- no-view accepted map is empty/no summary runs, while role-view stored totals render; both keep controls read-only with the translated reason;
- no request on open/cancel and exactly one save on commit;
- keyboard/focus/accessibility assertions, including a 24 by 24 target-size check;
- pointer, touch, Enter, and Space activation of the menu trigger opens the menu without invoking the sibling sort handler or changing row order.

### Integration

Create self-contained Orders plus personal/role Perspective fixtures through existing APIs, remove the temporary Orders toggle as part of adoption, select aggregates on an active personal view, verify the footer, reload and verify restoration, and switch to a second personal view to verify isolation. Activate “No view” and verify the accepted map/footer is empty with no summary request; activate a role view and verify its stored valid totals render but controls cannot save. Inject one stale key through the personal fixture payload, then verify it is ignored/pruned on the next personal save. Assert the fixed toggle is absent so the two affordances cannot coexist. Clean up created data in `finally`; do not rely on demo data.

## Risks & Impact Review

| Risk | Severity | Affected area | Mitigation | Residual risk |
|---|---|---|---|---|
| Persisted keys drift from current columns | Medium | Saved personal/role views | stable ids plus allow-list sanitizer and pruning tests | Low: removed columns remain inert until the next personal save prunes them |
| UI preference diverges after failed save | Medium | Footer/check-state correctness | save-success-only accepted transition and existing conflict handling | Low: network errors retain the last persisted map |
| Generic table duplicates or bypasses existing Perspective behavior | Medium | All Perspective-enabled tables | extend current query/apply/save paths and guarded mutation; add no module-specific route knowledge | Low: internal refactors must keep one accepted map |
| New header-menu trigger accidentally sorts the table | Medium | Every opted-in DataTable header | separate sibling controls, 24 by 24 target, independent focus states, and pointer/touch/keyboard non-sorting regressions | Low: future header refactors must retain the interaction boundary |
| Controls trigger unexpected requests | Low | Client/API load | explicit metadata + mutually exclusive controls opt-in and no-view empty default | Low: active stored selections intentionally trigger one bounded summary request |

Rollback switches Orders from controls mode back to the prerequisite external-selection mode and removes the optional settings property. Existing Perspective documents containing the additive key remain readable because unknown optional settings are preserved/ignored according to the current serializer contract; no data migration is required.

## Migration & Backward Compatibility

| Surface | Change | Classification | Compatibility behavior |
|---|---|---|---|
| `PerspectiveSettings` | optional `aggregations` property | Additive | old payloads omit it; existing properties unchanged |
| DataTable aggregation source | optional discriminated `controls` arm | Additive | existing required-`selections` callers remain valid; controls and selections cannot coexist |
| Column metadata | consumes optional prerequisite metadata | Additive | ineligible columns remain unchanged |
| Perspective API payload | accepts optional settings member | Additive | route/path/auth/version semantics unchanged |

No FROZEN identifier is renamed or removed. No deprecation bridge, database migration, or `UPGRADE_NOTES.md` entry is required.

## Implementation plan

1. Add the optional settings type/validator/serializer field and stale-entry sanitizer with compatibility tests.
2. Extend `DataTable`'s existing Perspective sanitizer/get/apply paths with one accepted aggregation map and add the discriminated controls-mode arm.
3. Add the new dedicated 24 by 24 aggregation-menu trigger as a sibling of the existing sort control, connect active-personal choices to the guarded save mutation, keep no-view/role-view choices read-only, and prove menu activation cannot sort.
4. Adopt controls mode on Orders by removing the temporary fixed toggle and ceasing to pass external `selections`.
5. Add accessibility, persistence, rollback, isolation, non-coexistence, and self-contained integration coverage.
6. Run the client-boundary and full configured validation gates and attach QA evidence.

## Final Compliance Report — 2026-08-01

### AGENTS.md Files Reviewed

- `AGENTS.md`
- `.ai/specs/AGENTS.md`
- `BACKWARD_COMPATIBILITY.md`
- `packages/shared/AGENTS.md`
- `packages/core/AGENTS.md`
- `packages/ui/AGENTS.md`
- `packages/ui/src/backend/AGENTS.md`
- `.ai/ds-rules.md`
- `.ai/ui-components.md`

### Compliance Matrix

| Rule Source | Rule | Status | Evidence |
|---|---|---|---|
| root `AGENTS.md` | Preserve tenant/user scope and optimistic locking | Compliant | existing Perspective routes/guarded mutation/version header remain authoritative |
| `packages/shared/AGENTS.md` | Keep shared types additive and validated | Compliant | optional enum-valued settings map is shared by type, zod validator, and sanitizer |
| `packages/core/AGENTS.md` | Validate API input and preserve mutation guards | Compliant | no route bypass; existing Perspective POST validation/guard pipeline is extended additively |
| `packages/ui/AGENTS.md` | DataTable owns Perspective behavior; non-CrudForm writes use guarded mutation | Compliant | existing DataTable query/apply/save and `useGuardedMutation` paths are reused |
| UI backend + design-system guides | Use API helpers, i18n, primitives, keyboard/focus, semantic tokens | Compliant | a focused component composes existing `IconButton`/`Popover`/`Button` primitives, explicitly separates its target from sorting, owns the missing menu keyboard contract, and reuses apiCall/tooltip/conflict helpers plus translated accessible states |
| `BACKWARD_COMPATIBILITY.md` | Public UI/settings contracts change additively | Compliant | optional settings property and discriminated controls arm preserve external-selection callers |
| `.ai/specs/AGENTS.md` | One capability and self-contained API/UI coverage | Compliant | personal/no-view/role-view persistence and Orders adoption are covered with cleanup |

### Internal Consistency Check

| Check | Status | Notes |
|---|---|---|
| Data models match API contracts | Pass | optional settings map matches shared/core/UI validation and the existing document API |
| API contracts match UI/UX section | Pass | only active personal views save; no-view is empty and role-view is read-only |
| Risks cover all write operations | Pass | guarded save, failure/conflict, stale keys, and rollback are covered |
| Commands defined for all mutations | N/A | Perspective uses the existing guarded route/service contract; no new command surface |
| Cache strategy covers all read APIs | Pass | existing Perspective React Query behavior is unchanged; summaries use prerequisite no-cache loader |
| Prerequisite/follow-up contracts agree | Pass | controls arm is mutually exclusive with external selections and replaces the Orders toggle |

### Non-Compliant Items

None.

### Verdict

**Fully compliant: approved and ready after all three prerequisite specs land.**

## Changelog

| Date | Change |
|---|---|
| 2026-08-03 | Corrected the interaction contract after Zielivia's review: the column-menu trigger is new, has a 24 by 24 target independent from the existing sort control, and carries pointer/touch/keyboard tests proving menu activation cannot sort. Reconfirmed that Orders adoption is the capability's cutover criterion rather than a second independently deployable feature. |
| 2026-08-01 | Split aggregation controls and per-user persistence from PR #4455; limited the menu to aggregate choices, made Perspective storage additive, defined stale-entry pruning, aligned ownership with `DataTable`'s existing Perspective query/apply/save paths, made controls mode mutually exclusive with external selections, defined active-personal/no-view/role-view behavior, required replacement of the temporary Orders toggle, and added explicit frontend and integration gates. |

### Review — 2026-08-01

- **Reviewer**: Codex fresh-context review
- **Security**: Passed
- **Performance**: Passed; one guarded save and bounded summary lifecycle are explicit
- **Cache**: Passed; existing Perspective query behavior unchanged
- **Commands**: N/A; existing guarded Perspective mutation retained
- **Risks**: Passed
- **Verdict**: Approved after prerequisites

### Review — 2026-08-03

- **Reviewer**: Codex with Zielivia feedback and fresh-context scope check
- **Security**: Passed
- **Performance**: Passed; the new trigger adds no dependency or request
- **Cache**: Passed; existing Perspective and summary ownership remain unchanged
- **Commands**: N/A; the existing guarded Perspective mutation is retained
- **Risks**: Passed; the new trigger/sort collision now has an explicit target, event boundary, risk entry, and regression coverage
- **Verdict**: Approved after prerequisites
