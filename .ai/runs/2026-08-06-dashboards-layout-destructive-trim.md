# Fix: dashboards layout GET must never persist a trim computed from an empty registry

Issue: #5041
Engine: om-auto-create-pr (steps: 5, --loop: no)

## Goal

Stop the dashboards layout GET endpoint from permanently erasing users' saved
layouts when the widget registry resolves empty, and stop that empty registry from
being cached for the lifetime of the process.

## Background

Two compounding problems:

1. `dashboards/lib/widgets.ts` memoizes `widgetEntriesPromise` on first call. A call
   that lands during process boot can cache an empty module list forever — every
   user then sees "no widgets". A rejected promise sticks in the same way.
2. `dashboards/api/layout/route.ts` GET intersects the saved layout with
   `allowedWidgetIds` and **persists** the trimmed result. With (1) supplying an
   empty allowlist, a read request rewrites every layout it serves to `[]`, and the
   loss survives the restart that fixes the registry.

## Scope

- `packages/core/src/modules/dashboards/lib/widgets.ts` — do not cache an empty or
  rejected registry resolution; the next call retries.
- `packages/core/src/modules/dashboards/api/layout/route.ts` — treat an empty widget
  registry as a transient state: serve the layout read-only, persist nothing (no
  trim, no defaults seeding).
- Unit tests for both.

## Non-goals

- Not removing the trim itself when the registry is healthy — pruning widgets a user
  genuinely lost access to stays the intended behavior.
- No change to `resolveAllowedWidgetIds`.
- No new invalidation triggers for `invalidateWidgetCache()`.

Originally "no change to the PUT path" was a non-goal too. Review of #5054 showed
`PUT` carries the *same* data loss — it filters the submitted layout through the
same registry-derived allowlist and persists `[]` while answering `{ ok: true }` —
so leaving it would have shipped a fix that reads as "layouts are safe now" while
the write path stayed exposed. It is in scope as of Phase 3.

## Risks

- A user who legitimately has access to zero widgets keeps their stored layout rows
  instead of having them pruned on read. That is the safe direction: the response
  still exposes `allowedWidgetIds`, so nothing unauthorized renders.

## Progress

PR: #5054

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Registry cache

- [x] 1.1 Do not memoize an empty or rejected widget-registry resolution — 21b527666
- [x] 1.2 Unit test: an empty first resolution is retried on the next call — 21b527666

### Phase 2: Non-destructive GET

- [x] 2.1 Skip every layout write when the widget registry is empty — 21b527666
- [x] 2.2 Unit tests: no flush and no layout mutation on an empty registry — 21b527666
- [x] 2.3 Run the full validation gate

### Phase 3: Review follow-up (#5054 changes-requested)

- [ ] 3.1 Refuse the layout PUT with 503 while the widget registry is empty, and document the 503 in the OpenAPI doc
- [ ] 3.2 Unit tests: PUT persists nothing on an empty registry, still saves and still filters on a healthy one
- [ ] 3.3 Drop a rejected widget-module loader from `widgetCache` instead of memoizing it, with a regression test
- [ ] 3.4 Rename `registryLoaded` to `hasRegisteredWidgets`, matching the client-side name for the same idea
- [ ] 3.5 Pin the boundary the new flag sits on: a healthy registry with an empty allowlist must still trim and still seed
- [ ] 3.6 Re-run the full validation gate
