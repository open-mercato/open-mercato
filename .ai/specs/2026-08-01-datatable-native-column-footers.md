# Native DataTable Column Footers

> **Status**: Draft — ready for implementation
> **Scope**: OSS (`packages/ui`, example module)
> **Created**: 2026-08-01
> **Revised**: 2026-08-03
> **Existing implementation PR**: #3972
> **Consumer**: [`2026-08-01-sales-orders-aggregation-consumer.md`](./2026-08-01-sales-orders-aggregation-consumer.md)

## TLDR

Add one presentation primitive to the shared `DataTable`: render TanStack column footer definitions in a native `<tfoot>` whose cells stay aligned with the visible header/body columns. The primitive is data-source agnostic. It does not fetch, calculate, persist, or interpret aggregate values; callers supply footer renderers through the existing column definitions.

## Overview

This specification defines the presentation-only prerequisite for column-aligned totals and other footer content. It makes the existing TanStack footer extension seam visible in shared `DataTable`, preserves all current tables when no footer is declared, and proves layout/accessibility in a self-contained example. Backend aggregation and persisted controls remain separate capabilities.

## Resolved assumptions

| Question | Decision | Rationale |
|---|---|---|
| Data contract | Reuse TanStack `ColumnDef.footer` and `columnDef.meta` | These are the library's existing typed extension seams; a parallel footer registry would duplicate column identity and visibility state |
| Empty footer | Omit `<tfoot>` when no visible leaf column defines a footer | Avoids a blank row and preserves current markup for all existing tables |
| Vertical reachability | Keep the generic footer in normal table flow rather than making it vertically sticky | `DataTable` owns horizontal overflow but not a constrained vertical scroll container; adding one would create nested page/table scrolling, while viewport-sticky content would obscure rows and escape the table's semantic/layout ownership |
| Layout verification | Add a self-contained example route and Playwright case | The shared table has no stable standalone page for visual and DOM coverage |
| Existing PR | Treat #3972 as the implementation candidate for this spec | It already targets this capability; it must be brought into conformance and independently QA-approved before merge |

## Problem Statement

The current `DataTable` offers a free-form `:footer` injection spot below the table, but that spot cannot guarantee one value per visible column. Consumers that need totals or other column-aligned content would otherwise recreate visibility, selection, sticky-action, and horizontal-scroll layout outside the table.

TanStack already exposes a footer template on each column and computed footer groups. `DataTable` should render that native model without taking ownership of the values.

## Goals

- Render `table.getFooterGroups()` as semantic `<tfoot>` / `<tr>` / `<th>` markup when at least one visible leaf column has a footer.
- Use the same visible column order, widths, pinning/sticky classes, selection spacer, and optional actions column as the corresponding header/body cells.
- Render footer templates with TanStack `flexRender` and the footer context.
- Preserve horizontal scrolling and responsive column visibility.
- Provide unit, DOM, and real-browser layout coverage.

## Non-goals

- Fetching, computing, grouping, formatting, or caching aggregates.
- Adding aggregation menu controls or Perspective persistence.
- Changing `DataTable` row, pagination, sorting, filtering, selection, or injection contracts.
- Introducing a new app-level route registry or dependency.

## Proposed Solution

Render TanStack footer groups through native semantic table markup only when a visible column supplies `ColumnDef.footer`. Reuse the header/body column-order, width, pinning, selection, and action-column layout logic, and verify the primitive through focused DOM tests plus a static example route and Playwright scenario.

## Architecture

The change stays inside the existing `DataTable` client island, with a small shared internal cell-layout helper if needed. Column definitions remain caller-owned; TanStack owns grouping/context; the shared table owns only conditional `<tfoot>` markup. The example consumes the public component without adding a provider, route registry, server API, or cross-module dependency.

## Data Models

Not applicable: no entity, database, persisted setting, API DTO, migration, or snapshot changes. Footer renderers use TanStack's existing additive `ColumnDef.footer` and `columnDef.meta` types.

## API Contracts

Not applicable to HTTP: no endpoint or response changes. The public component contract is the already-optional `ColumnDef.footer`; existing callers without footer definitions retain identical markup and behavior.

## Detailed design

### Rendering rule

`DataTable` computes whether any currently visible leaf column has a non-null `columnDef.footer`. When false, it emits no `<tfoot>`. When true, it renders every footer group returned by TanStack so grouped-column `colSpan` behavior remains library-owned.

Each footer header is rendered with `flexRender(header.column.columnDef.footer, header.getContext())`. Placeholder headers render an empty cell. Missing footer definitions render an empty cell rather than collapsing the grid.

The cell class builder used by the header/body becomes a small shared internal helper so footer cells inherit the same width and pinned/sticky positioning. The footer row uses design-system border/background/text tokens already used by `DataTable`; it adds no hardcoded colors, arbitrary values, or `dark:` overrides.

### Structural columns

The DOM must stay rectangular in all supported table states:

- the bulk-selection checkbox column gets an empty footer cell with the same width;
- an injected or configured actions column gets an empty footer cell and the same sticky-right behavior;
- hidden leaf columns are absent because TanStack's visible footer groups are authoritative;
- grouped header placeholders retain their computed `colSpan`;
- pinning a data column applies the same left/right offsets to its footer cell;
- horizontal scrolling keeps the footer inside the same `<table>` element as header and body.

No separate footer model or index-based reconciliation is allowed. Stable TanStack column ids remain the identity.

### Vertical reachability decision

The native footer is deliberately not pinned to the viewport or the bottom of a new vertical table scroller. The current `DataTable` wrapper owns horizontal overflow only; the page remains the vertical scroll owner. A sticky `<tfoot>` without a constrained vertical table viewport does not remain visible at the top of a long page, while introducing a constrained viewport would create nested scrolling, change keyboard/touch behavior, and reduce usable row height on short lists.

The footer therefore remains in normal document order at the end of the current page of rows. This primitive also does not duplicate caller values near the filter bar because that would create a second, non-column-aligned presentation contract. A consumer whose primary workflow requires an always-visible summary may additionally render its own compact summary through the existing table toolbar/header surface, but that is an explicit consumer choice and does not replace the native footer. Integration coverage records this behavior: at the top of a long list the footer is off-screen, page scrolling reaches it, and no nested vertical scrollbar is introduced.

### Public surface

No new required `DataTable` prop is added. Existing callers opt in by defining a column footer:

```tsx
{
  id: 'totalGross',
  header: t('sales.orders.columns.totalGross'),
  accessorKey: 'totalGross',
  footer: ({ table }) => table.options.meta?.summary?.totalGross ?? null,
}
```

The example illustrates presentation only with local static values. The Orders consumer defines its separately typed metadata and explicit `footer` renderers in the linked consumer spec; this primitive does not standardize that data contract.

## Example and integration route

Add a committed example under the allowed module path:

- `apps/mercato/src/modules/example/backend/datatable-footer/page.tsx`
- `apps/mercato/src/modules/example/backend/datatable-footer/page.meta.ts`
- `apps/mercato/src/modules/example/__integration__/TC-UI-DATATABLE-FOOTER.spec.ts`

The route uses the existing `example.backend` feature, static deterministic rows, at least four data columns, row selection, an actions column, one hideable column, and a long row that forces horizontal overflow at the test viewport. All visible copy comes from the example module locale files for every supported locale.

Because a module page is added, run `yarn generate`; only the normal generated registry changes are expected. Do not hand-edit generated registries.

## Frontend Architecture Contract

### Server/client boundary map

| Surface | Server root | Client island | Data owner |
|---|---|---|---|
| Existing backend lists | existing generated pages | existing `DataTable` | caller owns supplied footer values |
| Example route | server page wrapper | minimal example table component if interaction requires it | deterministic local fixture |

### `"use client"` ledger

| File | Reason | Imported by | Heavy dependencies | Cleanup/hydration risk | Alternative rejected |
|---|---|---|---|---|---|
| `packages/ui/src/backend/DataTable.tsx` (existing) | TanStack table state and rendering | backend tables | none new | conditional `<tfoot>` must produce the same first render on server/client | a separate client footer would break semantic table layout |
| example client component, if needed | toggles visibility/selection for layout proof | example server page | none | static initial state and no effects | a production module page would couple the proof to business fixtures |

### Budgets and evidence

- zero new production dependencies;
- zero new providers or app bootstrap changes;
- no new page-root `"use client"` directive;
- shared implementation at most 80 net new LOC, excluding tests;
- `DataTable` without footer definitions has byte-for-byte equivalent row/header behavior and no `<tfoot>`;
- `yarn check:client-boundaries`, `yarn generate`, `yarn build:packages`, `yarn typecheck`, `yarn test`, and `yarn build:app` pass;
- Playwright screenshots/DOM assertions cover wide and narrow viewports, hidden columns, bulk selection, and sticky actions.
- A long-list Playwright case confirms the footer stays in normal document flow, is reached by page scrolling, and does not introduce a nested vertical scroll container.

## Accessibility and UX

- Use semantic `<tfoot>` and `<th scope="col">` cells.
- Text alignment follows the owning column; numeric footer renderers can opt into the same numeric alignment through existing column metadata.
- Empty cells have no focus target and no redundant accessible label.
- The footer does not create a second horizontal scroll container.
- The footer does not create a vertical scroll container or viewport-sticky overlay; the page remains the vertical scroll owner.
- Loading/error controls are consumer concerns; this primitive only renders their supplied accessible content.

## Test plan

### Unit and DOM

- no footer definitions: no `<tfoot>` and existing snapshots remain unchanged;
- one and several footer definitions: cells align to visible leaf columns;
- grouped headers/placeholders preserve `colSpan`;
- hidden and reordered columns update the footer order;
- selection and actions structural cells remain present;
- left/right pinned columns reuse the expected classes/offsets;
- long list: footer is not visible at the page top, becomes visible through page scroll, and creates no nested vertical scrollbar;
- renderer receives a valid TanStack footer context.

### Integration

The self-contained Playwright test opens the example route, verifies semantic footer cells and their values, hides a column, selects a row, exercises the row action, and checks footer alignment at desktop and narrow widths. Fixtures are local/static and require no seeded data. The test restores any changed local UI state in `finally`.

## Risks & Impact Review

| Risk | Severity | Affected area | Mitigation | Residual risk |
|---|---|---|---|---|
| Footer drifts from structural columns | Medium | DataTable layout/selection/actions | one TanStack footer-group source plus bulk/actions regression matrix | Low: future structural columns must extend the matrix |
| Sticky or horizontal layout regresses | Medium | Responsive/sticky table UX | reuse shared cell-class logic and browser checks at two widths | Low: browser-engine differences remain covered by QA |
| A long list hides the footer below the fold | Medium | Summary reachability | explicitly retain page-owned vertical scrolling, document the non-sticky tradeoff, cover it in Playwright, and allow consumers to add a separate toolbar/header summary when always-visible output is their primary workflow | Medium: reading a footer still requires page scrolling by design |
| Existing tables gain empty markup | Low | All DataTable callers | omit `<tfoot>` unless a visible footer exists | Minimal: malformed third-party footer definitions can still render empty cells |

Rollback removes the conditional footer rendering and example page. No data, API, or persistence migration exists.

## Migration & Backward Compatibility

This change consumes the already-additive optional `ColumnDef.footer` property and adds no required prop, route contract, event id, widget spot, database surface, or import path. Existing tables without footer renderers preserve behavior. No deprecation or `UPGRADE_NOTES.md` entry is required.

## Implementation plan

1. Add the conditional native footer rendering using TanStack footer groups and shared cell-layout logic.
2. Add unit/DOM coverage for visibility, grouping, structural columns, horizontal pinning, normal-flow vertical behavior, and the no-footer case.
3. Add the example module page, translated copy, and self-contained Playwright layout scenario.
4. Run generation and the frontend/full repository gates, attach browser evidence, and obtain independent QA approval for #3972 because it carries `needs-qa`.

## Final Compliance Report — 2026-08-01

### AGENTS.md Files Reviewed

- `AGENTS.md`
- `.ai/specs/AGENTS.md`
- `BACKWARD_COMPATIBILITY.md`
- `packages/ui/AGENTS.md`
- `packages/ui/src/backend/AGENTS.md`
- `.ai/ds-rules.md`
- `.ai/ui-components.md`

### Compliance Matrix

| Rule Source | Rule | Status | Evidence |
|---|---|---|---|
| root `AGENTS.md` | Keep changes minimal and use shared UI primitives | Compliant | one conditional native footer path in existing `DataTable`; no dependency/provider |
| `packages/ui/AGENTS.md` | Preserve DataTable extension/layout behavior | Compliant | TanStack groups and existing visibility/pinning/structural-column logic remain authoritative |
| `packages/ui/src/backend/AGENTS.md` | Use standard loading/error/data-call helpers | N/A | presentation primitive performs no asynchronous data call |
| design-system guides | Semantic tokens, shared primitives, accessible icons/interactions | Compliant | existing table tokens/primitives are reused; no hardcoded colors, arbitrary values, or inline SVG |
| `BACKWARD_COMPATIBILITY.md` | Component contracts change additively | Compliant | consumes existing optional `ColumnDef.footer`; no required prop/import/path changes |
| `.ai/specs/AGENTS.md` | UI paths require integration/browser evidence | Compliant | self-contained DOM and Playwright coverage plus independent QA are required |

### Internal Consistency Check

| Check | Status | Notes |
|---|---|---|
| Data models match API contracts | N/A | no data model or HTTP contract |
| API contracts match UI/UX section | N/A | presentation receives caller-rendered footer content |
| Risks cover all operations | Pass | structural alignment, responsive layout, and dormant behavior are covered |
| Commands defined for all mutations | N/A | no mutation |
| Cache strategy covers all read APIs | N/A | no API or cache |
| Linked specs conflict with this contract | Pass | linked consumers provide data but do not alter footer semantics |

### Non-Compliant Items

None.

### Verdict

**Fully compliant: approved and ready for implementation.**

## Changelog

| Date | Change |
|---|---|
| 2026-08-03 | Recorded the explicit non-sticky vertical behavior after Zielivia's review: the page remains the vertical scroll owner, the primitive creates no nested scroller or duplicate summary surface, and long-list browser coverage verifies the documented tradeoff. Removed the symbolic fallback from the public example. |
| 2026-08-01 | Split the native footer presentation primitive from PR #4455's aggregate service and control/persistence proposals; defined semantic markup, structural-column layout, a self-contained example, browser coverage, and frontend budgets. |

### Review — 2026-08-01

- **Reviewer**: Codex fresh-context review
- **Security**: Passed; no data/API surface
- **Performance**: Passed; dormant markup and LOC/bundle budgets are explicit
- **Cache**: N/A
- **Commands**: N/A
- **Risks**: Passed
- **Verdict**: Approved

### Review — 2026-08-03

- **Reviewer**: Codex with Zielivia feedback and fresh-context scope check
- **Security**: Passed; no data/API surface
- **Performance**: Passed; the design avoids a new vertically constrained scroll container
- **Cache**: N/A
- **Commands**: N/A
- **Risks**: Passed; long-list reachability is now an explicit, tested normal-flow tradeoff
- **Verdict**: Approved
