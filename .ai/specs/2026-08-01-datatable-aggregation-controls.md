# DataTable Aggregation Controls and Perspective Persistence

> **Status**: Draft — ready for implementation
> **Scope**: OSS (`packages/shared`, `packages/ui`, `packages/core`)
> **Created**: 2026-08-01
> **Prerequisites**: [`2026-08-01-datatable-native-column-footers.md`](./2026-08-01-datatable-native-column-footers.md), [`2026-07-24-datatable-column-aggregations.md`](./2026-07-24-datatable-column-aggregations.md), [`2026-08-01-sales-orders-aggregation-consumer.md`](./2026-08-01-sales-orders-aggregation-consumer.md)

## TLDR

Add one optional aggregation-only menu to eligible `DataTable` column headers and persist each user's supported function choices in the existing Perspective settings document. This spec changes only interaction and view-state persistence: it reuses the aggregate loader/lifecycle and native footer defined by the prerequisite specs, introduces no new aggregate API, and keeps all existing tables inert unless their columns explicitly opt in.

## Resolved assumptions

| Question | Decision | Rationale |
|---|---|---|
| Menu scope | Aggregation functions plus “None” only | Sort, hide, pin, and general column menus are separate interaction work |
| Persistence | Existing per-user Perspective settings | Aggregation selection is view preference, not role policy or business data |
| Identity | Stable TanStack column id | Accessor labels and physical/API field names can differ and must not become persistence keys |
| Unsupported stale values | Sanitize and omit them on load and the next save | Columns/functions can change between releases; fail closed without breaking the Perspective |
| Defaults | No active aggregation unless the host supplies a documented default | Avoids new requests and UI changes on existing views |
| Selection ownership | Reuse the prerequisite controller's `aggregation.selections` map | One stable-column-id map must drive footer loading, checked state, and persistence |
| Orders adoption | Replace the temporary “Show totals” toggle in the same implementation | The fixed toggle and per-column controls must never compete for precedence |

## Problem

The aggregate/orders capability proves server totals with an ephemeral list-level toggle, but users who repeatedly inspect totals need a stable per-column choice. Persisting request fields or SQL selectors would leak route implementation into user settings. A general-purpose column menu would also bundle unrelated behavior.

This capability therefore stores only `{ stableColumnId: supportedFunction }` and lets the existing host/controller translate current eligible columns into aggregate requests.

## Goals

- Let a user choose one supported aggregation function or “None” from an eligible column header.
- Persist supported choices in the existing Perspective settings owned by that user/view.
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

`requestField` and physical selectors are never persisted. `DataTable` uses `column.id` as the Perspective key and resolves the active function through the current column metadata before constructing the existing controller's `{ field, fn }` request. The controller's `aggregation.selections` is the only authoritative selection map.

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

Perspective ownership, tenant/organization scope, optimistic locking, and existing guarded mutation/error handling remain unchanged. The UI must preserve the current Perspective version header when saving this additional field.

### Header interaction

Eligible headers show the existing compact menu trigger next to the label. Its translated accessible name includes the column label. The menu contains:

- “None”;
- one translated item for each function in the column metadata, in metadata order.

The selected item uses the design-system menu checked state. Choosing an item calls the host's guarded Perspective save callback and shows a local pending state while the accepted `aggregation.selections` prop remains authoritative. Only a successful save updates that prop and causes the prerequisite summary controller to cancel/reload. A save failure surfaces through the existing Perspective error UI, clears the pending state, and leaves the last persisted selection/footer intact.

Keyboard behavior follows the existing menu primitive: Enter/Space opens, arrows move, Enter selects, and Escape closes and restores focus. No custom focus manager is added.

## Data flow and ownership

1. The host loads its existing Perspective, sanitizes its map, and passes it as the prerequisite controller's `aggregation.selections`.
2. `DataTable` matches that one map's keys to current stable column ids and functions to current metadata.
3. A user selection builds a proposed next map and calls the host's typed `onSelectionsChange(next)` callback without changing the accepted controller map.
4. The host writes the entire existing Perspective settings payload through the existing guarded/optimistically locked mutation path.
5. On success, the host supplies the accepted map through `aggregation.selections`; the controller aborts stale work and loads footer values. On failure, the accepted map never changes.

The host remains the sole API/persistence owner. `DataTable` neither imports Perspective routes nor serializes route filters.

## Public UI surface

Add optional typed props alongside the prerequisite controller:

```ts
aggregationControls?: {
  onSelectionsChange: (
    next: Readonly<Record<string, DataTableAggregationFn>>,
  ) => Promise<void>
  disabled?: boolean
}
```

The prop adds only mutation/control behavior. Checked state and aggregate loading both read the prerequisite `aggregation.selections`; there is no second selections property or adapter. Controls do not render unless both props exist. The implementation shares the prerequisite function type and must not collapse host persistence ownership into the generic table.

## Frontend Architecture Contract

### Server/client boundary map

| Surface | Server root | Client island | Data owner |
|---|---|---|---|
| Existing Perspective-backed list | existing generated page | existing list host and `DataTable` | host owns Perspective API and aggregate loader; table owns menu state/rendering |
| Existing Perspective API | existing authenticated route | none | existing tenant/user-scoped service |

### `"use client"` ledger

| File | Reason | Imported by | Heavy dependencies | Cleanup/hydration risk | Alternative rejected |
|---|---|---|---|---|---|
| `packages/ui/src/backend/DataTable.tsx` or extracted sibling (existing island) | header menu and local selection | backend lists | existing menu/TanStack only | persisted initial choices must be supplied before first render | route-specific control outside the column header cannot satisfy this capability |
| existing list host | owns Perspective save and aggregate request | module page | none new | failed save must clear pending UI and retain the accepted map | importing module APIs into shared UI would invert ownership |

### Budgets and evidence

- zero new production dependencies, providers, or page-root client islands;
- at most 120 net new shared UI LOC before extracting a focused aggregation-control component;
- no aggregate or Perspective request for tables without eligible metadata;
- one existing Perspective save per committed selection, with no save on open/cancel;
- restore/sanitize work is linear in visible columns plus stored entries;
- `yarn check:client-boundaries`, `yarn build:packages`, `yarn typecheck`, `yarn test`, and `yarn build:app` pass;
- Playwright covers keyboard choice, reload persistence, separate Perspective isolation, stale entry pruning, and failed-save rollback.

## UI, accessibility, and i18n

- Reuse the existing menu/dropdown and tooltip primitives; do not build a custom popover.
- All trigger labels, function names, “None”, loading, and failure text use locale keys in every supported UI locale.
- Use semantic/design-system foreground, border, checked, hover, and focus tokens; no hardcoded colors, arbitrary values, inline SVG, or `dark:` semantic overrides.
- The current function is exposed through checked-menu semantics and a concise translated tooltip; color alone never conveys state.
- Disabled state explains why controls cannot be changed while a prior Perspective save is in flight.

## Error and edge behavior

- Stored id no longer exists: ignore and prune on the next save.
- Function no longer supported by the current column: ignore and prune.
- Column is hidden: keep its valid stored selection, but the prerequisite loader requests only active visible eligible columns; revealing it restores the selection and reloads.
- Host has no Perspective/save callback: controls do not render.
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
- pending checked state, successful accepted-map update, failed-save pending-state clear, 409 conflict, and disabled-during-save behavior;
- no request on open/cancel and exactly one save on commit;
- keyboard/focus/accessibility assertions.

### Integration

Create self-contained Orders and Perspective fixtures through existing APIs, remove the temporary Orders toggle as part of adoption, select aggregates through the column controls, verify the footer, reload and verify restoration, switch to a second Perspective and verify isolation, inject one stale key through the fixture payload, then verify it is ignored/pruned. Assert the fixed toggle is absent so the two affordances cannot coexist. Clean up created data in `finally`; do not rely on demo data.

## Risks and rollback

| Risk | Severity | Mitigation |
|---|---|---|
| Persisted keys drift from current columns | Medium | stable ids plus allow-list sanitizer and pruning tests |
| UI preference diverges after failed save | Medium | rollback to last accepted map and existing conflict handling |
| Generic table becomes module-aware | Medium | typed host callback; no Perspective/API imports in `packages/ui` |
| Controls trigger unexpected requests | Low | explicit metadata + prop opt-in and no-active-default |

Rollback stops passing `aggregationControls` and removes the optional settings property. Existing Perspective documents containing the additive key remain readable because unknown optional settings are preserved/ignored according to the current serializer contract; no data migration is required.

## Migration & Backward Compatibility

| Surface | Change | Classification | Compatibility behavior |
|---|---|---|---|
| `PerspectiveSettings` | optional `aggregations` property | Additive | old payloads omit it; existing properties unchanged |
| DataTable prop | optional `aggregationControls` | Additive | existing callers render no controls and make no new requests |
| Column metadata | consumes optional prerequisite metadata | Additive | ineligible columns remain unchanged |
| Perspective API payload | accepts optional settings member | Additive | route/path/auth/version semantics unchanged |

No FROZEN identifier is renamed or removed. No deprecation bridge, database migration, or `UPGRADE_NOTES.md` entry is required.

## Implementation plan

1. Add the optional settings type/validator/serializer field and stale-entry sanitizer with compatibility tests.
2. Add the callback-only control prop and aggregation-only header menu using the prerequisite controller's authoritative selection map.
3. Connect accepted Perspective saves to that controller while preserving host API ownership and optimistic locking.
4. Adopt the controls on Orders by removing the temporary fixed toggle and initializing from the current Perspective.
5. Add accessibility, persistence, rollback, isolation, non-coexistence, and self-contained integration coverage.
6. Run the client-boundary and full configured validation gates and attach QA evidence.

## Final compliance report — 2026-08-01

- One independently deployable capability: choose and persist one supported aggregate function per eligible column.
- The service, native footer, and filter serialization remain owned by prerequisite specs.
- Perspective changes are optional/additive and keep existing tenant scope and optimistic locking.
- Route-specific API knowledge remains in the host; shared UI receives one authoritative typed selection map and a persistence callback.
- Orders adoption removes the temporary toggle, so there is one source of request selection and enablement.
- Dependency, client-boundary, LOC, request-count, i18n, DS, accessibility, failure, and integration budgets are explicit.

**Verdict:** fully specified and ready after all three prerequisite specs land.

## Changelog

| Date | Change |
|---|---|
| 2026-08-01 | Split aggregation controls and per-user persistence from PR #4455; limited the menu to aggregate choices, made Perspective storage additive, defined stale-entry pruning and host ownership, reused one authoritative controller selection map, required replacement of the temporary Orders toggle, and added explicit frontend and integration gates. |
