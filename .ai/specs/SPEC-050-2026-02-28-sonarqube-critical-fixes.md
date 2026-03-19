# SPEC-050: SonarQube — Zero Bugs, Zero Blockers

## TLDR

**Key Points:**
- Clean up SonarQube scan findings (2026-02-27, commit `ce2a072`). Goal: A reliability rating.
- ~112 actionable fixes (including corrected fix approaches) + 11 false positives to suppress. Purely mechanical. No features, no refactoring, no scope creep.

**Scope (actionable fixes):**
- 31 × S2871: bare `.sort()` calls missing comparators
- 17 × S5850: ambiguous regex alternation
- 13 × S6544: 12 async handler `void` prefixes + 1 dead-code guard removal (4 CrudForm false positives excluded — see below)
- 16 × css:S4662: Tailwind v4 at-rules SonarQube doesn't know about (config suppression)
- 14 × S1082: clickable `<div>`s needing keyboard/ARIA fixes (2 excluded as false positives — see below)
- 11 × S6440: React Hooks called inside conditionals
- 4 × S3923: ternary/conditional returning the same thing both ways
- 2 × S4335, 2 × S3799, 1 × S6324, 1 × S5256

**False positives (suppress, do not fix):**
- 4 × S3516: all 4 "constant-return" functions are intentional — mutable accumulator patterns or side-effect gates
- 4 × S6544 (CrudForm.tsx): `() => Promise<void>` assigned to `() => void` is valid TypeScript
- 2 × S1082 (InlineEditors.tsx): outer container div has `onClick` but inner child already has `role="button"` + keyboard handlers
- 1 × S4158: upgrade-actions.ts iteration over empty array is infrastructure placeholder

**Corrected diagnoses (still actionable, different fix):**
- 1 × S6544 (attachments route): dead `if (!params)` guard — remove dead code, not a floating promise
- 3 × S1082 (ConfirmDialog.tsx, AppShell.tsx): ARIA attributes (`role="presentation"`, `aria-hidden`), not `role="button"`

**Concerns:**
- RowActions.tsx (S6440) has 10 hooks called behind an early return. Restructuring it is the riskiest change in this spec since it touches every DataTable in the app. Code review confirmed all 10 hooks are safe to hoist — none depend on guard-computed values.

## Overview

The SonarQube scan covers 363k LOC. Security and maintainability are both A-rated. Reliability sits at D because of these 119 bugs — mostly warnings that happen to be technically correct but practically harmless today. The problem is that "harmless today" has a shelf life. Bare `.sort()` on UUID arrays works until someone adds a numeric field to the list. Regex without grouping works until a colleague copies the pattern and gets the precedence wrong.

This is a good-citizen pass. Fix the warnings, make intent explicit everywhere, and get the report clean so it stays useful as a regression gate.

> **Reference**: The S2871 rule tracks TC39 spec behavior — default `.sort()` is always lexicographic. ESLint's `@typescript-eslint/require-array-sort-compare` enforces the same thing. We're not chasing SonarQube for its own sake here; explicit comparators are simply better TypeScript.

## Problem Statement

**The `.sort()` gap (31 hits)** — Every bare `.sort()` in the codebase operates on string arrays (UUIDs, cache keys, display labels). Lexicographic sort happens to produce correct results for these, but the intent is invisible. A reviewer can't tell whether the author thought about it or just forgot the comparator. Worse, if the array type drifts (e.g., someone starts putting numbers in a tag list), the sort silently breaks.

**Ambiguous regex (17 hits)** — Alternation precedence in regex is a well-known readability trap. `/foo|bar_baz/` — does that match `foo` or `bar_baz`? Or `foo_baz` and `bar_baz`? The current patterns are correct, but a maintainer shouldn't need to mentally parse operator precedence to verify that.

**Swallowed promises (12 actionable hits, 5 false positives)** — Async functions passed as `onChange` or `onClick` handlers where the caller expects `void`. React and DOM won't `.catch()` the returned promise. If the async handler throws, the error vanishes. The 4 CrudForm.tsx hits are false positives — TypeScript's return-void compatibility rule makes `() => Promise<void>` assignable to `() => void` by design. The attachments route hit is a misclassified dead-code guard, not a floating promise.

**Conditional hooks (11 hits)** — RowActions.tsx has an early-return guard before its hooks. React's reconciler tracks hooks by call order, not by name. If the early return triggers on one render but not the next, the hook call count changes and React throws. This hasn't surfaced because the guard condition is stable in practice — but it's a time bomb if anyone touches the condition logic.

**Missing keyboard handlers (14 actionable hits, 2 false positives)** — `<div onClick={...}>` without `onKeyDown` + `role="button"` means the element is invisible to keyboard navigation. WCAG 2.1 compliance issue. Code review found that InlineEditors.tsx (2 hits) has keyboard handlers on an inner child element — the outer container `onClick` is not the interactive target (false positives). ConfirmDialog.tsx and AppShell.tsx backdrop/layout divs (3 hits) need ARIA attributes (`role="presentation"` or `aria-hidden="true"`) instead of `role="button"` — these are still actionable fixes, just a different pattern.

**Constant-return functions (4 blockers — all false positives)** — SonarQube flags functions where every code path returns the same variable. Code review found all 4 are intentional patterns: mutable accumulator objects (Map/Set) that are populated between early-return and final-return, side-effect gates that persist data conditionally, or same-variable returns where one path returns `null` and the other returns a mutated entity. None are dead branches or stubs. Suppress with inline comments.

**CSS false positives (16 hits)** — SonarQube's CSS parser doesn't recognize Tailwind v4's `@source` and `@custom-variant` directives. Not our problem, but it pollutes the report.

## Proposed Solution

One fix per category, applied mechanically. No surrounding cleanup. No "while we're here" changes.

### Decisions

| Decision | Why |
|----------|-----|
| `localeCompare` for string sorts (default) | Handles Unicode correctly, documents intent, SonarQube and ESLint both recommend it |
| Ordinal comparison `(a < b ? -1 : a > b ? 1 : 0)` for fixed-format strings (HH:MM, etc.) | `localeCompare` could produce locale-sensitive variations for structured format strings |
| `(a, b) => a - b` if a numeric sort is found | Standard numeric comparator |
| Non-capturing groups `(?:...)` for regex | Zero-cost at runtime, makes alternation boundaries visible |
| `void` prefix for fire-and-forget async handlers | Explicit "I know this returns a promise and I'm discarding it" |
| Widen prop type to `() => void \| Promise<void>` for CrudForm false positives | TypeScript return-void compatibility makes these safe; `void` prefix in JSX props would break handlers |
| Per-site ARIA approach for S1082 keyboard a11y | `role="button"` only for truly interactive divs; `role="presentation"` / `aria-hidden` for layout/backdrop wrappers |
| Suppress S3516 with `// NOSONAR` inline comments | All 4 are false positives — mutable accumulator patterns and side-effect gates |
| Suppress css:S4662 in `sonar-project.properties` | False positive — don't touch valid Tailwind syntax |

### Rejected Alternatives

| Alternative | Why Not |
|-------------|---------|
| Global S2871 suppression | Hides real bugs. The fix is trivial and makes code better. |
| Replace `.sort()` with lodash `sortBy` | Adding a dependency to avoid a one-liner is absurd. |
| Full RowActions.tsx rewrite | Out of scope. Minimal hook reordering is enough. |

## Implementation Plan

Single pass, single commit. ~112 actionable fixes + 11 false positive suppressions, all independent of each other — no ordering constraints, no intermediate build gates. The full manifest is below, grouped by fix pattern for readability, not by execution order.

Run `yarn build:packages` once at the end to confirm nothing broke.

---

### Sort Comparators — S2871 (31 fixes)

Every bare `.sort()` gets an explicit comparator. All 31 are string arrays. The fix is uniform: `.sort((a, b) => a.localeCompare(b))`. If any call turns out to operate on numbers or objects during implementation, use the appropriate comparator instead.

| # | File | Line | What's being sorted |
|---|------|------|---------------------|
| 1 | `packages/shared/src/lib/crud/factory.ts` | 619 | ID dedup |
| 2 | `packages/shared/src/lib/crud/factory.ts` | 628 | ID dedup |
| 3 | `packages/shared/src/lib/crud/enricher-runner.ts` | 93 | Record IDs for cache key |
| 4 | `packages/shared/src/lib/openapi/generator.ts` | 1258 | API paths |
| 5 | `packages/shared/src/lib/openapi/generator.ts` | 1261 | HTTP methods |
| 6 | `packages/shared/src/lib/openapi/generator.ts` | 1338 | Schema keys |
| 7 | `packages/shared/src/lib/cache/segments.ts` | 33 | Cache segment keys |
| 8 | `packages/shared/src/lib/entities/system-entities.ts` | 30 | Entity IDs |
| 9 | `packages/shared/src/lib/hotkeys/index.ts` | 39 | Modifier tokens (canonical form) |
| 10 | `packages/core/src/modules/sales/commands/documents.ts` | 3219 | Tag IDs |
| 11 | `packages/core/src/modules/sales/commands/documents.ts` | 3220 | Tag IDs |
| 12 | `packages/core/src/modules/sales/api/dashboard/widgets/new-orders/route.ts` | 66 | Org IDs for cache key |
| 13 | `packages/core/src/modules/sales/api/dashboard/widgets/new-quotes/route.ts` | 67 | Org IDs for cache key |
| 14 | `packages/core/src/modules/sales/components/documents/ShipmentDialog.tsx` | 174 | String array |
| 15 | `packages/core/src/modules/resources/commands/resources.ts` | 137 | Tag IDs |
| 16 | `packages/core/src/modules/currencies/services/providers/raiffeisen.ts` | 70 | HH:MM time keys — use ordinal `(a < b ? -1 : a > b ? 1 : 0)` not `localeCompare` |
| 17 | `packages/core/src/modules/catalog/backend/catalog/products/create/page.tsx` | 1025 | Error field keys |
| 18 | `packages/core/src/modules/catalog/components/products/productForm.ts` | 287 | Option values |
| 19 | `packages/core/src/modules/attachments/components/AttachmentLibrary.tsx` | 76 | JSON keys |
| 20 | `packages/core/src/modules/auth/commands/users.ts` | 744 | User names |
| 21 | `packages/core/src/modules/auth/backend/users/page.tsx` | 271 | Role names |
| 22 | `packages/core/src/modules/customers/cli.ts` | 1174 | CLI output |
| 23 | `packages/core/src/modules/perspectives/services/perspectiveService.ts` | 55 | Role IDs for cache key |
| 24 | `packages/core/src/modules/api_docs/frontend/docs/api/page.tsx` | 19 | API paths |
| 25 | `packages/core/src/modules/entities/lib/field-definitions.ts` | 51 | Field names |
| 26 | `packages/core/src/modules/entities/lib/install-from-ce.ts` | 61 | Entity keys |
| 27 | `packages/core/src/modules/query_index/lib/engine.ts` | 1353 | Entity IDs for cache key |
| 28 | `packages/scheduler/src/modules/scheduler/api/targets/route.ts` | 35 | Target names |
| 29 | `packages/cli/src/lib/utils.ts` | 70 | File paths |
| 30 | `packages/cli/src/lib/testing/integration.ts` | 758 | File paths |
| 31 | `packages/cli/src/lib/generators/entity-ids.ts` | 132 | Entity IDs |

### Regex Grouping — S5850 (17 fixes)

For each flagged regex, wrap the alternation in a non-capturing group `(?:...)` to make precedence explicit. Read the full pattern first — the goal is to document existing behavior, not change it.

| # | File | Line |
|---|------|------|
| 1 | `packages/shared/src/lib/utils.ts` | 14 |
| 2 | `packages/shared/src/lib/encryption/kms.ts` | 84 |
| 3 | `packages/shared/src/lib/crud/cache.ts` | 58 |
| 4 | `packages/shared/src/lib/crud/cache-stats.ts` | 28 |
| 5 | `packages/core/src/modules/catalog/commands/products.ts` | 353 |
| 6 | `packages/core/src/modules/catalog/commands/shared.ts` | 44 |
| 7 | `packages/core/src/modules/inbox_ops/lib/emailParser.ts` | 109 |
| 8 | `packages/core/src/modules/workflows/components/DefinitionTriggersEditor.tsx` | 96 |
| 9 | `packages/core/src/modules/workflows/lib/graph-utils.ts` | 634 |
| 10 | `packages/core/src/modules/resources/lib/seeds.ts` | 320 |
| 11 | `packages/core/src/modules/customers/cli.ts` | 998 |
| 12 | `packages/core/src/modules/customers/lib/detailHelpers.ts` | 33 |
| 13 | `packages/core/src/modules/auth/cli.ts` | 101 |
| 14 | `packages/core/src/modules/entities/cli.ts` | 305 |
| 15 | `packages/core/src/modules/attachments/lib/partitionEnv.ts` | 9 |
| 16 | `packages/core/src/modules/business_rules/components/utils/formHelpers.ts` | 75 |
| 17 | `packages/cli/src/lib/utils.ts` | 176 |

### Promise Void Context — S6544 (12 `void` prefix fixes + 1 dead-code removal + 4 false positives)

Prefix async handlers with `void` where the caller doesn't await the result.

| # | File | Lines | What it is |
|---|------|-------|------------|
| 1 | `packages/core/src/modules/query_index/components/QueryIndexesTable.tsx` | 379, 383, 389, 398, 404, 414, 420 | Table row actions |
| 2 | `packages/core/src/modules/workflows/backend/instances/page.tsx` | 291, 299 | Table row actions |
| 3 | `packages/core/src/modules/workflows/backend/tasks/page.tsx` | 299 | Table row action |
| 4 | `packages/search/src/modules/search/api/reindex/route.ts` | 197, 253 | Route callbacks |

#### False Positives — suppress, do not fix

**CrudForm.tsx (4 sites: lines 1971, 2015, 2043, 2107):** `handleDelete` is `async () => Promise<void>` passed as `onDelete` where `() => void` is expected. This is valid TypeScript — `() => Promise<void>` is assignable to `() => void` by the return-void compatibility rule. React ignores event handler return values. The `void` prefix in a JSX prop context would evaluate to `undefined`, breaking the handler. **Fix:** Widen the `onDelete` prop type in `FormActionButtons`/`FormHeader` to `() => void | Promise<void>` to silence the linter, or suppress with `// NOSONAR`.

**Attachments route (line 54):** The spec originally described this as "Promise in boolean check." The actual code is `if (!params) return null` where `params` is a Next.js 15 `Promise<RouteParams>`. A Promise object is always truthy, so `!params` is always `false` — this is **dead code** (unreachable branch), not a floating promise. The `await params` at line 56 is already correct. **Fix:** Remove the dead `if (!params)` guard entirely.

### Conditional React Hooks — S6440 (11 fixes, 2 files)

Two files, two different problems.

**RowActions.tsx (10 hooks behind early return):** Move all hooks above the early-return guard. The guard becomes a conditional return _after_ hooks run. Same behavior, correct hook ordering — the standard React pattern for components with guard clauses.

**useConfirmDialog.tsx (useEffect inside callback):** `DialogMountTracker` is a function component created inside `useCallback`, with `useEffect` in its body. SonarQube flags `useEffect` inside a callback context. The current code works correctly at runtime (React calls `DialogMountTracker` as a component via `<DialogMountTracker />`), but violates the static Rules of Hooks analysis. **Fix:** Extract `DialogMountTracker` as a module-level function component outside the hook, accepting `trackerRef` as a prop:

```tsx
// Module level, outside useConfirmDialog:
function DialogMountTracker({ trackerRef }: { trackerRef: React.MutableRefObject<boolean> }) {
  React.useEffect(() => {
    trackerRef.current = true
    return () => { trackerRef.current = false }
  }, [trackerRef])
  return null
}
```

Then render with `<DialogMountTracker trackerRef={isDialogElementRenderedRef} />` inside the memo. This eliminates the `useEffect`-inside-`useCallback` violation without adding unnecessary state complexity.

Both need manual smoke testing — RowActions is used on every list page in the app.

| # | File | Lines |
|---|------|-------|
| 1 | `packages/ui/src/backend/RowActions.tsx` | 18–67 |
| 2 | `packages/ui/src/backend/confirm-dialog/useConfirmDialog.tsx` | 106 |

### Keyboard Accessibility — S1082 (14 fixes + 2 false positives)

Each S1082 site must be evaluated individually. Not all `<div onClick>` elements are interactive targets — some are layout wrappers, backdrop overlays, or containers where an inner child already provides keyboard access.

#### Pattern A: Truly interactive divs — add `role="button"` + `tabIndex={0}` + `onKeyDown`

```tsx
<div
  onClick={handleClick}
  onKeyDown={(e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      handleClick(e)
    }
  }}
  role="button"
  tabIndex={0}
>
```

| # | File | Line(s) | Notes |
|---|------|---------|-------|
| 1 | `packages/ui/src/backend/messages/MessageObjectRecordPicker.tsx` | 99 | Interactive picker item |
| 2 | `packages/ui/src/backend/notifications/NotificationItem.tsx` | 172 | Clickable notification row |
| 3 | `packages/ui/src/backend/FilterOverlay.tsx` | 175 | Filter chip toggle |
| 4 | `packages/ui/src/backend/PerspectiveSidebar.tsx` | 128 | Perspective selection item |
| 5 | `packages/core/src/modules/inbox_ops/widgets/notifications/ProposalCreatedRenderer.tsx` | 40 | Notification click target |
| 6 | `packages/core/src/modules/sales/widgets/notifications/SalesOrderCreatedRenderer.tsx` | 60 | Notification click target |
| 7 | `packages/core/src/modules/sales/widgets/notifications/SalesQuoteCreatedRenderer.tsx` | 60 | Notification click target |
| 8 | `packages/scheduler/src/modules/scheduler/components/ExecutionDetailsDialog.tsx` | 120 | Interactive detail element |
| 9 | `packages/scheduler/src/modules/scheduler/components/JobLogsModal.tsx` | 101 | Interactive log element |
| 10 | `packages/search/src/modules/search/frontend/components/sections/VectorSearchSection.tsx` | 597 | Interactive search element |
| 11 | `packages/core/src/modules/customers/components/detail/InlineEditors.tsx` | 536 | Interactive inline edit trigger |

#### Pattern B: Backdrop/layout divs — use ARIA attributes, not `role="button"`

| # | File | Line(s) | Fix | Reason |
|---|------|---------|-----|--------|
| B1 | `packages/ui/src/backend/confirm-dialog/ConfirmDialog.tsx` | 173 | Add `role="presentation"` | Outer wrapper around interactive trigger element — div is layout, not the click target |
| B2 | `packages/ui/src/backend/confirm-dialog/ConfirmDialog.tsx` | 178 | Suppress — native `<dialog>` | Backdrop click-to-close on `<dialog>` element; browser handles `Escape` natively |
| B3 | `packages/ui/src/backend/AppShell.tsx` | 1555 | Add `aria-hidden="true"` | Mobile drawer backdrop overlay — decorative, not interactive |

#### False positives — no fix needed

| # | File | Line(s) | Reason |
|---|------|---------|--------|
| FP1 | `packages/ui/src/backend/detail/InlineEditors.tsx` | 271 | Inner child div already has `role="button"` + `tabIndex={0}` + `onKeyDown`; outer container `onClick` is propagation handling |
| FP2 | `packages/ui/src/backend/detail/InlineEditors.tsx` | 581 | Same pattern — keyboard access on inner `{...interactiveProps}` div |

### Blocker Code Smells — S3516 (0 fixes — all 4 are false positives, suppress only)

Code review found all 4 functions are intentional patterns, not dead branches. SonarQube is fooled by same-variable returns where the value is mutated between paths, or where the branch controls meaningful side effects. **Do not simplify. Add `// NOSONAR` inline comments with explanations.**

| # | File | Line | Why it's a false positive |
|---|------|------|--------------------------|
| 1 | `packages/enterprise/src/modules/record_locks/lib/recordLockService.ts` | 461 | `saveSettings` returns `settings` in both paths by design — the branch controls whether settings are persisted to the config service. Collapsing would break non-enterprise/test deployments where `moduleConfigService` is `null`. |
| 2 | `packages/shared/src/lib/encryption/find.ts` | 40 | `findOneWithDecryption` returns `record` in both paths, but the early return is `null` and the final return is a **decrypted entity** (mutated by `decryptEntitiesWithFallbackScope`). SonarQube is fooled by the same variable name — the values are fundamentally different. |
| 3 | `packages/core/src/modules/sales/lib/shipments/snapshots.ts` | 33 | `ensureLineMap` returns the same `Map` reference in both paths, but the Map is **populated from a DB query** between the early-return (skip when no missing IDs) and the final return. The branch is a performance short-circuit avoiding unnecessary I/O. |
| 4 | `packages/ui/src/backend/utils/nav.ts` | 32 | `fetchFeatureGrants` returns the same `Set` reference, but it's populated by a `fetch` call between the early-return (empty input) and the final return. Function is already `@deprecated`. Same mutable-accumulator pattern as #3. |

### Remaining One-offs (10 fixes + 1 false positive)

| Rule | File | Line | What to do |
|------|------|------|------------|
| S4335 | `packages/search/src/fulltext/types.ts` | 18 | Drop the empty type from the intersection |
| S4335 | `packages/shared/src/modules/search.ts` | 10 | Same |
| S3923 | `packages/core/src/modules/sales/components/documents/SalesDocumentsTable.tsx` | 235 | Ternary returns same value both sides — simplify |
| S3923 | `packages/core/src/modules/catalog/components/PriceKindSettings.tsx` | 88 | Same |
| S3923 | `packages/ui/src/backend/DataTable.tsx` | 1608 | `{typeof error === 'string' ? error : error}` — both branches identical. Simplify to `{error}` |
| S3923 | `packages/ui/src/backend/operations/store.ts` | 78 | `source.actionLabel === null ? null : null` — nested ternary always null. Simplify to `typeof source.actionLabel === 'string' ? source.actionLabel : null` |
| S3799 | `packages/create-app/template/.../widget.client.tsx` | 54 | Empty destructure `{}` — replace with `_props` or remove param |
| S3799 | `apps/mercato/.../widget.client.tsx` | 54 | Same (mirror file) |
| S6324 | `packages/cli/src/lib/testing/integration.ts` | 163 | Strip control character from regex |
| S5256 | `packages/ui/src/primitives/table.tsx` | 5 | `TableHeader` does not use `cn()` for className merging unlike sibling components (`TableRow`, `TableHead`, `TableCell`). Add `cn()` wrapper for consistency |

#### False positives — suppress, do not fix

| Rule | File | Line | Reason |
|------|------|------|--------|
| S4158 | `packages/core/src/modules/configs/lib/upgrade-actions.ts` | 43 | `upgradeActions` is an empty registration array by design — modules push into it at boot time. The filter/sort function is infrastructure, not dead code. Suppress with `// NOSONAR`. |

### SonarQube Config — Tailwind v4 False Positives (16 suppressions)

Add exclusion to `sonar-project.properties`:

```properties
# Tailwind CSS v4 at-rules (@source, @custom-variant) not in SonarQube's CSS grammar yet
sonar.issue.ignore.multicriteria=e1
sonar.issue.ignore.multicriteria.e1.ruleKey=css:S4662
sonar.issue.ignore.multicriteria.e1.resourceKey=**/*.css
```

## Risks & Impact Review

### Data Integrity / Tenant Isolation / Migration
Not applicable. No queries change. No schema changes. No API contracts change. Nothing gets deployed differently.

### Cascading Failures
Sort comparators produce identical output for the current data (all string arrays). Regex grouping is semantically identical. The only structural change is the hook reordering in RowActions.tsx, which changes call timing but not behavior.

### False Positive Risk
11 findings are classified as false positives after code review. The risk of suppressing these is low — each has been individually verified with source code analysis. The S3516 "blocker" reclassification is the most impactful: SonarQube's D reliability rating counts these 4 as blockers, but they are all intentional mutable-accumulator or side-effect-gate patterns. Suppressing them with `// NOSONAR` + explanatory comments preserves the code's intent while clearing the report.

### Risk Register

#### Sort comparator applied to non-string array
- **Scenario**: One of the 31 `.sort()` calls actually operates on numbers or mixed types, and `localeCompare` corrupts the order.
- **Severity**: Medium
- **Affected area**: Cache key generation, display ordering
- **Mitigation**: All 31 sites are pre-audited — SonarQube S2871 specifically fires on string-typed `.sort()`. Each fix must still be verified against the surrounding code during implementation.
- **Residual risk**: Low.

#### RowActions hook reorder breaks table menus
- **Scenario**: Moving hooks above the early return changes when certain effects run, causing action menus to misbehave.
- **Severity**: High
- **Affected area**: Every DataTable row action menu in the application
- **Mitigation**: The hooks already execute on every render where the guard passes — moving them above the guard just means they also execute (as no-ops) when the guard would have returned early. Manual testing required on customers, products, and orders list views.
- **Residual risk**: Medium — the one change where "mechanical" doesn't mean "trivial."

#### Regex grouping changes match semantics
- **Scenario**: Wrapping alternation in `(?:...)` inadvertently shifts the group boundary and changes what the regex matches.
- **Severity**: Medium
- **Affected area**: Email parsing, CLI utilities, workflow triggers
- **Mitigation**: Each regex must be read individually. Non-capturing groups are semantically neutral when the boundary matches the existing implicit precedence.
- **Residual risk**: Low — the patterns are flagged precisely because the implicit precedence is ambiguous, so both interpretations must already be acceptable.

## Manual Testing Checklist

After all fixes are applied and `yarn build:packages` passes, walk through the following areas. The goal is to catch regressions from the three non-trivial fix categories: hook reordering (RowActions), keyboard accessibility additions, and promise void wrapping. The sort and regex fixes are behavior-preserving by construction, but the pages below exercise them too, so a single pass covers everything.

### RowActions — highest risk, test first

The hook reorder in RowActions.tsx affects every DataTable with row actions. Open each page, click the three-dot menu on a row, and confirm actions render and fire correctly.

| Page | URL | What to verify |
|------|-----|----------------|
| People list | `/backend/customers/people` | Row actions menu opens, Edit/Delete work, bulk select doesn't break |
| Companies list | `/backend/customers/companies` | Same — different entity, same RowActions component |
| Products list | `/backend/catalog/products` | Row actions, especially Duplicate and Delete |
| Orders list | `/backend/sales/orders` | Row actions on documents (View, Edit, Clone, Delete) |
| Quotes list | `/backend/sales/quotes` | Same pattern as orders |
| Users list | `/backend/auth/users` | Edit/Deactivate actions, role-gated actions visible for admin |
| Workflow instances | `/backend/workflows/instances` | Cancel/Retry actions on workflow rows |
| Workflow tasks | `/backend/workflows/tasks` | Complete/Reassign actions |
| Query indexes | `/backend/query-index` | Reindex/Delete actions — these also cover the S6544 void fixes |
| Search reindex | `/backend/search` | Trigger reindex, confirm no silent failures (S6544 fix) |

### Confirm Dialog — useConfirmDialog.tsx

The `useEffect` extraction could affect dialog lifecycle. Test any delete flow that shows a confirmation popup.

| Action | Where to trigger |
|--------|-----------------|
| Delete a person | People list → row action → Delete → confirm dialog appears → confirm → record deleted |
| Delete a product | Products list → same flow |
| Cancel a delete | Any list → Delete → confirm dialog → press Escape or click Cancel → nothing happens |
| Keyboard: Cmd+Enter | Open any confirm dialog → press Cmd+Enter → should confirm |

### Keyboard Accessibility — S1082 fixes

Tab-navigate through these components and confirm Enter/Space triggers the click handler. Don't just click — use the keyboard.

| Component | Where to find it | Keyboard test |
|-----------|-----------------|---------------|
| Inline editors | `/backend/customers/people/{id}` detail page | Tab to an inline-editable field, press Enter to activate |
| Notification items | Click bell icon in topbar | Tab through notifications, press Enter to navigate |
| Filter overlay | Any list page → click filter icon | Tab through filter chips, Enter to toggle |
| Perspective sidebar | Any list page with saved views | Tab to a perspective item, Enter to select |
| Confirm dialog overlays | Trigger any confirm dialog | Tab to overlay backdrop, ensure it doesn't trap focus incorrectly |
| Vector search section | `/backend/search` → Vector tab | Tab to interactive elements, confirm Enter works |
| Scheduler execution details | `/backend/scheduler` → click a job | Tab through detail dialog elements |

### CrudForm — no code changes (S6544 false positives)

CrudForm.tsx `handleDelete` sites are false positives — no code changes applied. No manual testing required for this category. CrudForm behavior is exercised incidentally by the RowActions and Confirm Dialog tests above.

### Sort Order Spot-Checks

These are sanity checks — the sort fix is mechanical, but worth a glance to confirm nothing looks scrambled.

| Area | What to check |
|------|---------------|
| API docs page | `/backend/api-docs` — endpoints should appear in alphabetical path order |
| Users page | `/backend/auth/users` — role names in columns should be sorted sensibly |
| Shipment dialog | Create an order → add shipment → line items should appear in correct order |
| Product create errors | Submit invalid product form → error keys should be in field order, not random |
| Hotkeys | Open command palette (Cmd+K) — keyboard shortcuts should display consistently |

### Regex Spot-Checks

Low risk, but confirm these workflows still parse correctly.

| Area | What to check |
|------|---------------|
| Email parsing | If inbox_ops is enabled: send a test email → confirm it's parsed into the right fields |
| Customer import (CLI) | `yarn cli customers:import --help` — confirm CLI parses flags correctly |
| Workflow triggers | Open a workflow definition → triggers tab → event pattern filter should work |
| Product search | Search for a product with special characters in the name — confirm results are correct |

### Build and Lint Gate

After manual testing, run the full verification:

```bash
yarn build:packages    # Must pass — confirms no type errors introduced
yarn lint              # Must pass — catches any formatting/style regressions
yarn test              # Run existing unit tests
```

## Migration & Compatibility

No breaking changes. No database migrations. No API contract modifications. Zero backward-compatibility surface areas affected. Ships as a normal commit.

## Final Compliance Report — 2026-02-28

### AGENTS.md Files Reviewed
- `AGENTS.md` (root)
- `packages/shared/AGENTS.md`
- `packages/ui/AGENTS.md`
- `packages/ui/src/backend/AGENTS.md`
- `packages/core/AGENTS.md`
- `packages/cli/AGENTS.md`
- `packages/search/AGENTS.md`
- `packages/cache/AGENTS.md`
- `packages/events/AGENTS.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| root AGENTS.md | No direct ORM relationships between modules | N/A | No ORM changes |
| root AGENTS.md | Filter by organization_id | N/A | No query changes |
| root AGENTS.md | No `any` types | Compliant | No new types introduced |
| root AGENTS.md | Don't add docstrings/comments to unchanged code | Compliant | Touches only the flagged lines |
| root AGENTS.md | Confirm project builds after changes | Compliant | `yarn build:packages` after all fixes applied |
| packages/ui/AGENTS.md | Use Button/IconButton, not raw `<button>` | N/A | No new buttons added |
| packages/shared/AGENTS.md | Boolean parsing via parseBooleanToken | N/A | No boolean logic changes |

### Internal Consistency Check

| Check | Status | Notes |
|-------|--------|-------|
| Data models match API contracts | N/A | No data model or API changes |
| Risks cover all write operations | N/A | No write operations introduced |
| Commands defined for all mutations | N/A | No mutations introduced |
| Changes preserve existing behavior | Pass | All fixes are mechanical |
| False positives individually verified | Pass | 11 findings verified against source code as intentional patterns |
