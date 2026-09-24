# Execution plan: Created column with sort and filter on the People and Companies lists

## Goal

Let CRM users see, sort, and filter the People and Companies lists by creation date, with a date filter that covers whole calendar days.

## Scope

- `packages/core/src/modules/customers/backend/customers/{people,companies}/page.tsx`: add a `Created` column (row mapping from `created_at`, `Dates`/`Activity` groups, `created_at` filter key).
- `packages/core/src/modules/customers/backend/customers/listSorting.ts`: map the `createdAt` column to the existing `createdAt` API sort field.
- `packages/core/src/modules/customers/lib/createdAtDayFilter.ts` plus the people and companies list API routes: expand date-only `created_at` rules to whole days before the advanced-filter tree is compiled.
- `packages/core/src/modules/customers/i18n/*.json`: `customers.{people,companies}.list.columns.createdAt` in all five locales.
- Tests: unit (sort mapping, day expansion), jsdom list-column tests, and a Playwright integration spec.

## Non-goals

- No change to the shared advanced-filter compiler (`packages/shared/src/lib/query/advanced-filter-tree.ts`). The whole-day rewrite is scoped to `created_at` on these two list APIs.
- No schema, migration, or API contract change: `created_at` is already stored, returned, and mapped in `sortFieldMap`.
- No change to the Deals list (covered separately by #6295).

## Implementation Plan

### Phase 1: List column, sorting, and whole-day filter

- 1.1 Add the Created column with sort mapping and translations to the People and Companies lists.
- 1.2 Treat date-only `created_at` filter values as whole days in the People and Companies list APIs.
- 1.3 Add the Playwright integration spec for sort and filter by creation date.

### Phase 2: Regression coverage

- 2.1 Add jsdom list-column tests for the People and Companies Created column (header, formatted value, sort wiring).

### Phase 3: Validation

- 3.1 Run the full validation gate.

## Risks

- Date-only filter values are read in the database session time zone, matching every other date filter in the platform. A user far from UTC may see a record created close to midnight counted on the adjacent day.
- Open PR #5974 localizes the column-chooser and filter group labels on the same two pages. Whichever lands second adapts the new column's `Dates`/`Activity` group labels.
- `yarn test` in `@open-mercato/cli` fails locally only when the temp dir lives inside the repository (this runner's `TMPDIR`); it passes under a system temp dir and in upstream CI on the same base.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: List column, sorting, and whole-day filter

- [ ] 1.1 Add the Created column with sort mapping and translations to the People and Companies lists
- [ ] 1.2 Treat date-only created_at filter values as whole days in the People and Companies list APIs
- [ ] 1.3 Add the Playwright integration spec for sort and filter by creation date

### Phase 2: Regression coverage

- [ ] 2.1 Add jsdom list-column tests for the People and Companies Created column

### Phase 3: Validation

- [ ] 3.1 Run the full validation gate
