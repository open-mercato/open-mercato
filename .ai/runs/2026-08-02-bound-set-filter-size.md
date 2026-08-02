# Bound the size of `in` / `not_in` widget-data set filters at the request schema

## Goal

Give the dashboards widget-data endpoint an explicit, discoverable upper bound on how many
members an `in` / `not_in` filter may carry, so an oversized set filter is refused by request
validation with a 400 that names the offending filter instead of being expanded into a
proportionally large SQL statement.

Closes [#4852](https://github.com/open-mercato/open-mercato/issues/4852), the follow-up recorded
as a Minor finding in the review of [#4821](https://github.com/open-mercato/open-mercato/pull/4821).

## Scope

- Constrain `filters[].value` for the `in` / `not_in` operators in
  `packages/core/src/modules/dashboards/api/widgets/data/schema.ts` to an array of primitives
  with one explicitly named maximum length.
- Express the limit exactly once, as an exported constant, so the single POST route, the batch
  route, and the generated OpenAPI document all inherit the same number.
- Add unit coverage for both edges (at the limit, one over the limit) plus the surrounding
  shapes: non-array values, non-primitive members, unaffected scalar operators, and the
  400 the route actually returns.
- Assert that the limit reaches the generated OpenAPI schema as `maxItems`, so third-party
  dashboard widgets can discover it without reading the source.

## Non-goals

- `packages/core/src/modules/dashboards/lib/aggregations.ts` is deliberately left as-is. The
  issue is explicit that the bound belongs to validation, not to SQL rendering:
  `buildWhereClause` can only truncate a filter (silently changing what the caller asked for)
  or throw from deep inside query construction, and neither produces a usable API error.
- No change to the set of supported operators, to filter semantics, or to any other part of
  the widget-data contract.
- No schema, migration, dependency, or UI change.

## Implementation Plan

### Phase 1: Bound the request schema

1. Introduce a single exported maximum for set-filter members, with the justification for the
   chosen number recorded next to it.
2. Split the filter object into an `in` / `not_in` branch that requires a bounded array of
   primitives and a scalar branch that keeps today's permissive `value`, joined by a
   discriminated union on `operator` so validation errors carry the exact filter path.
3. Derive the existing exported `filterOperatorSchema` from the two operator groups so a future
   operator cannot be added without deciding which validation shape it takes.

### Phase 2: Coverage

1. Unit-test the schema edges: at the limit accepted, one member over rejected as `too_big` with
   the `filters.<index>.value` path, non-array and non-primitive values rejected, scalar
   operators unchanged.
2. Unit-test that the route answers an over-limit request with 400 and the issue list, not a 500
   and not a truncated result set.
3. Unit-test that the generated OpenAPI document carries `maxItems` for the set-filter branch.

### Phase 3: Verification and delivery

1. Run the configured validation gate, open the PR against `develop`, and run the authoritative
   review pass.

## Risks

- **Tightening an existing surface.** Requests that today send a non-array or non-primitive
  `value` for `in` / `not_in` start receiving a 400. Those requests already could not produce a
  correct query — `= ANY('abc')` is not a valid predicate — so the change turns a silent
  malfunction into an explicit error rather than breaking working callers. No in-repository
  caller uses `in` / `not_in`; the only shipped widget that came close (`pipeline-summary`)
  deliberately uses `is_null` instead.
- **Rejecting an empty member list.** The minimum of one member is a deliberate addition beyond
  the letter of the acceptance criteria and is called out separately in the PR body so a
  reviewer can strike it. Once #4821 lands, an empty array renders `col IN ()`, which is a
  PostgreSQL syntax error and therefore a 500; refusing it at the schema is the same argument
  the issue makes for the upper bound.
- **Choice of the number.** 200 is a judgement call the issue explicitly delegates ("pick a
  number and justify it in the PR"). It is deliberately generous relative to the neighbouring
  limits in the same surface and is a constant, so raising it later is a one-line change.
- **Overlap with #4821.** That PR is still open and touches only `aggregations.ts` and its
  tests; this branch touches only the schema and its tests, so the two do not conflict and can
  merge in either order.

## Progress

PR: #4855

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

- [x] Phase 1.1 — single exported maximum with justification — 9f9090680
- [x] Phase 1.2 — discriminated filter union bounding `in` / `not_in` — 9f9090680
- [x] Phase 1.3 — `filterOperatorSchema` derived from the two operator groups — 9f9090680
- [x] Phase 2.1 — schema edge coverage — 9f9090680
- [x] Phase 2.2 — route 400 coverage — 9f9090680
- [x] Phase 2.3 — OpenAPI `maxItems` coverage — 9f9090680
- [ ] Phase 3.1 — validation gate, PR, review pass
