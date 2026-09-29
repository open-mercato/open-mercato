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

- No change to the operator union or to any operator other than `in` / `not_in`.
- No change to how `organization_id = ANY(?::uuid[])` binds — that path already passes a PostgreSQL
  array literal with an explicit cast and works.
- No bound on the number of set-filter members — tracked separately as #4855.

## Review follow-up — `null` members (major finding, @MStaniaszek1998)

`api/widgets/data/schema.ts` typed the filter value as `z.unknown().optional()`, so `{"value": null}`
and arrays containing `null` were accepted. `normalizeSetFilterValues` treats `null` as an ordinary
member, so the predicate rendered as `column IN (NULL)` / `column NOT IN (NULL)`, which evaluates to
SQL NULL for every row: zero rows, no error, a plausible-looking zero on a dashboard.

`undefined` is not expressible in JSON, so the documented empty-set path is reachable only by omitting
the `value` key, while `{"value": null}` — the shape a client naturally sends — landed on the
undocumented `[null]` path.

Of the three remedies the review offered, this takes the third: reject `null` and null-containing
arrays for `in` / `not_in` at `widgetDataRequestSchema`, so the failure stays loud and moves to the
boundary. Partitioning nulls into `IS NULL` / `IS NOT NULL` (option 1) would guess at intent the API
never expressed, and silently folding `null` into the empty set (option 2) keeps a silent wrong answer.
The guard is operator-scoped: `is_null` / `is_not_null` build their predicate from the operator alone
and never read the value, so callers passing an explicit `null` there keep working.

### Second line of defense in the SQL builder

Rejecting at the schema closes the HTTP path, but `buildAggregationQuery` is also reachable in-process
and its `filters[].value` is typed `unknown`, so nothing stops a future caller from handing the builder
the very shape the boundary now refuses. `normalizeSetFilterValues` therefore throws on a null or
undefined member instead of rendering it. A throw is the right failure here precisely because it is
loud: the alternative — folding the member into the empty set — reproduces the silent zero this finding
is about, and the builder has no way to answer with a 400. The `[internal]` prefix marks the message as
never user-facing, per the i18n convention.

Route-level coverage records that the boundary rejection is what a caller actually observes: the
widget-data route answers `400` with the issue list and the widget-data service is never invoked.
`TC-DASH-010` asserts the same thing against a live server, so the documented behaviour is proven at
the layer a dashboard client sees rather than only in the validator.

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
- [x] PR opened, labels requested from a maintainer.
- [x] Review round 1 (@MStaniaszek1998): reject `null` and null-containing arrays for `in` / `not_in`
      at `widgetDataRequestSchema`, with unit coverage for `value: null`, `value: [null]`, a null
      member mixed with valid ones, and the `is_null` / `is_not_null` carve-out.
- [x] Review round 1, hardening: `normalizeSetFilterValues` throws on a null/undefined member so
      in-process callers cannot reach the silent path either, plus a route case (400 with issues, the
      widget-data service never invoked), a builder case proving falsy-but-not-null members
      (`''`, `0`, `false`) still render, and a `TC-DASH-010` assertion that the null shape answers 400.
- [ ] Re-review by @MStaniaszek1998.

## Verification notes

The jest layer cannot open a PostgreSQL connection, so unit coverage asserts on the output of the
same interpolation the runtime performs. Live-server confirmation comes from
`TC-DASH-010-set-filter-operators.spec.ts` and, during development, from executing the generated
SQL directly against PostgreSQL 17 (results in the table above).
