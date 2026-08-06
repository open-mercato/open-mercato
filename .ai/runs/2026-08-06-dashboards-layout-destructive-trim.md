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
- No change to the PUT path or to `resolveAllowedWidgetIds`.
- No new invalidation triggers for `invalidateWidgetCache()`.

## Risks

- A user who legitimately has access to zero widgets keeps their stored layout rows
  instead of having them pruned on read. That is the safe direction: the response
  still exposes `allowedWidgetIds`, so nothing unauthorized renders.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Registry cache

- [ ] 1.1 Do not memoize an empty or rejected widget-registry resolution
- [ ] 1.2 Unit test: an empty first resolution is retried on the next call

### Phase 2: Non-destructive GET

- [ ] 2.1 Skip every layout write when the widget registry is empty
- [ ] 2.2 Unit tests: no flush and no layout mutation on an empty registry
- [ ] 2.3 Run the full validation gate
