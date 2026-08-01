# Dashboards `in` / `not_in` Aggregation Filter Operators

Issue: #4669 (follow-up from #4629)

## Goal

Cover the untested `in` and `not_in` widget-data filter operators in
`packages/core/src/modules/dashboards/lib/aggregations.ts` and act on what the coverage reveals.

## Finding

The operators are not merely untested — they are broken for every possible value.

MikroORM does not bind parameters at the driver level. `AbstractSqlConnection.execute` calls
`platform.formatQuery`, which interpolates each parameter into the SQL text, and
`BasePostgreSqlPlatform.escape` renders a JavaScript array as a bare comma-separated list. The
`= ANY(?)` / `!= ALL(?)` form therefore produced SQL PostgreSQL rejects:

| Value passed by the caller | Rendered SQL | PostgreSQL 17 |
|---|---|---|
| `['completed', 'shipped']` | `status = ANY('completed', 'shipped')` | `syntax error at or near ","` |
| `['completed']` | `status = ANY('completed')` | `malformed array literal: "completed"` |
| `[]` | `status = ANY()` | `syntax error at or near ")"` |
| `'completed'` | `status = ANY('completed')` | `malformed array literal: "completed"` |

`not_in` fails identically through `!= ALL(?)`. Both operators are reachable from the public
`WidgetDataRequest` operator union and the widget-data API schema, so any caller using them got a
500 rather than a filtered aggregation.

## Decision

Fix the binding rather than remove the operators. The operator union
(`services/widgetDataService.ts`) and the request schema (`api/widgets/data/schema.ts`) are public
contract surfaces under `BACKWARD_COMPATIBILITY.md`; removing members is a breaking change, while
the operators themselves are the natural way to express set membership.

The fix renders one placeholder per member — `col IN (?, ?)` / `col NOT IN (?, ?)` — so every value
is escaped by its own JavaScript type, and handles the empty set explicitly (`FALSE` for `in`,
`TRUE` for `not_in`) because `IN ()` is a syntax error.

## Scope

- `packages/core/src/modules/dashboards/lib/aggregations.ts` — the `in` / `not_in` branches of the
  shared `buildWhereClause`, used by both `buildAggregationQuery` and `buildGroupSourceRowsQuery`.
- Unit coverage in `lib/__tests__/aggregations.test.ts`.
- Integration coverage in `__integration__/TC-DASH-010-set-filter-operators.spec.ts`.

## Non-goals

- No change to the operator union, the request schema, or any other operator.
- No change to how `organization_id = ANY(?::uuid[])` binds — that path already passes a PostgreSQL
  array literal with an explicit cast and works.

## Progress

- [x] Reproduce the defect at the driver layer (`PostgreSqlPlatform.formatQuery`) and against a live
      PostgreSQL 17 server.
- [x] Expand `in` / `not_in` into per-member placeholders with explicit empty-set handling.
- [x] Unit tests: generated SQL fragment, bound-parameter shape, single-member, scalar, empty set,
      and the encrypted group-source row query.
- [x] Unit test asserting the fully rendered SQL through the real `PostgreSqlPlatform.formatQuery`
      — the exact text the server receives — plus a regression record of the rejected old form.
- [x] Integration spec driving both operators through the widget-data route to PostgreSQL.
- [x] Validation gate.
- [ ] PR opened, labels requested from a maintainer.

## Verification notes

The jest layer cannot open a PostgreSQL connection, so unit coverage asserts on the output of the
same interpolation the runtime performs. Live-server confirmation comes from
`TC-DASH-010-set-filter-operators.spec.ts` and, during development, from executing the generated
SQL directly against PostgreSQL 17 (results in the table above).
