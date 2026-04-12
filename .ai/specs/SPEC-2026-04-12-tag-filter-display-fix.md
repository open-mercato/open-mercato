# SPEC: Fix Tag Filter Labels for Persisted Tag Selections

**Issue:** open-mercato/open-mercato#238
**Date:** 2026-04-12
**Status:** In Progress
**Scope:** UI bug fix for existing filter rendering behavior; no API, schema, or contract changes

## TL;DR

Several list pages allow filtering by `tagIds`, but persisted selected values can render as raw UUIDs instead of human-readable labels after the filter overlay is closed, reopened, or reconstructed from existing state.

The immediate fix is consumer-side:
- keep a stable in-page tag ID to label lookup for each affected table
- wire `formatValue` for each `tagIds` filter so both `FilterOverlay` and `FilterBar` can resolve labels even when the local option list is incomplete
- reuse existing tag-label state where it already exists instead of introducing duplicate caches

This spec intentionally does not change shared `FilterBar` or `FilterOverlay` behavior. That would be a broader hardening change and should be handled separately if we want to reduce future footguns.

## Overview

Tag-based filters are implemented with shared `FilterOverlay`, `FilterBar`, and `TagsInput` primitives. Those components can render user-friendly labels when either:
- the selected values are present in the current option map, or
- the filter definition provides `formatValue`

In the affected pages, selected `tagIds` can outlive the transient option map used during selection. When that happens, the UI falls back to the raw stored value, which is a UUID.

The fix is to make label resolution durable at the page level for each affected filter definition.

## Problem Statement

The current draft problem statement is directionally correct but too broad. The bug is not simply "tag filters display UUIDs"; it is more specific:

- `FilterOverlay` resolves tag labels from `formatValue` when provided, otherwise from a temporary `optionMap`
- `FilterBar` resolves active chip labels from `formatValue` for primitive values, but does not perform tag-specific lookup from `f.options`
- therefore, any `tagIds` filter without `formatValue` can display UUIDs when the current selected values are not available in the local option set

This is most likely to happen when filter state is persisted or reconstructed, for example:
- after applying a filter and closing the overlay
- after reopening the overlay in a new render cycle
- after hydrating state from query params or other previously applied filter values
- when the selected tag was not part of the currently loaded suggestion set

## Current Code Reality

Shared behavior:
- `packages/ui/src/backend/FilterOverlay.tsx`
  - tag rendering prefers `formatValue`, otherwise falls back to `optionMap.get(val)?.label ?? val`
- `packages/ui/src/backend/FilterBar.tsx`
  - active chip rendering prefers `formatValue`, but does not perform a tag-aware lookup through `f.options`

Affected consumers:
- `packages/core/src/modules/sales/components/documents/SalesDocumentsTable.tsx`
  - `tagIds` filter has `options` and `loadOptions`, but no `formatValue`
- `packages/core/src/modules/customers/backend/customers/people/page.tsx`
  - page already stores `tagIdToLabel`, but `tagIds` filter does not use it via `formatValue`
- `packages/core/src/modules/customers/backend/customers/companies/page.tsx`
  - page already stores `tagIdToLabel`, but `tagIds` filter does not use it via `formatValue`
- `packages/core/src/modules/resources/backend/resources/resources/page.tsx`
  - page already stores merged `tagOptions`, but `tagIds` filter does not use them via `formatValue`

Reference implementation:
- `packages/core/src/modules/catalog/components/products/ProductsDataTable.tsx`
  - uses stable option caches plus `formatValue` for tag rendering

## Goals

- Ensure selected `tagIds` render as tag labels, not UUIDs, in both `FilterOverlay` and `FilterBar`
- Fix the affected pages with the smallest safe change
- Preserve existing API routes, filter IDs, and URL/query behavior

## Non-Goals

- No API response changes
- No database changes
- No shared framework behavior changes in `FilterBar`, `FilterOverlay`, or `TagsInput`
- No expansion of tag filtering to additional pages beyond those already identified

## Proposed Solution

For each affected page, ensure the `tagIds` filter definition provides:

```ts
formatValue: (value) => tagLabelLookup[value] ?? value
```

Implementation rules:

1. Reuse existing page-level tag label state where available.
2. Only add new cache state where the page does not already retain tag labels.
3. Keep `loadTagOptions` responsible for updating the stable label lookup used by `formatValue`.
4. Do not change filter IDs, query parameter names, or tag option API calls.

### Per-File Plan

#### Sales

File:
- `packages/core/src/modules/sales/components/documents/SalesDocumentsTable.tsx`

Change:
- keep using the existing `tagOptions` collection
- add a stable lookup for selected tag labels, either by:
  - deriving from `tagOptions`, or
  - adding a dedicated cache only if a derived lookup is awkward
- add `formatValue` to the `tagIds` filter

#### Customers People

File:
- `packages/core/src/modules/customers/backend/customers/people/page.tsx`

Change:
- zero-risk one-liner: page already has `tagIdToLabel` state (line ~173) used elsewhere for label resolution
- add `formatValue: (value) => tagIdToLabel[value] ?? value` to the `tagIds` filter
- no new state needed

#### Customers Companies

File:
- `packages/core/src/modules/customers/backend/customers/companies/page.tsx`

Change:
- zero-risk one-liner: page already has `tagIdToLabel` state (line ~163) used elsewhere for label resolution
- add `formatValue: (value) => tagIdToLabel[value] ?? value` to the `tagIds` filter
- no new state needed

#### Resources

File:
- `packages/core/src/modules/resources/backend/resources/resources/page.tsx`

Change:
- page already has `tagOptions` as `FilterOption[]` state (line ~76) and passes it as `options`
- add `formatValue: (val) => tagOptions.find((o) => o.value === val)?.label ?? val` to the `tagIds` filter
- no new state needed; `.find()` is fine for typical tag counts

## Why Not Fix the Shared Components?

There is a legitimate product-level improvement available in shared UI:
- `FilterBar` could become tag-aware and resolve labels from filter options for tag filters, reducing the chance of future omissions

This spec intentionally does not include that work because:
- it broadens scope from a targeted bug fix to framework behavior
- it would require reviewing all current `tags` filter consumers for subtle behavior changes
- the current issue can be fixed safely with narrow consumer changes

If we want to harden the shared layer later, that should be tracked as a separate follow-up spec or issue.

## Architecture Impact

No architectural changes.

This is a consumer-side rendering fix using already-supported `formatValue` hooks in the existing shared filter components.

## Data Models

No data model changes.

## API Contracts

No API contract changes.

Existing API paths remain unchanged:
- `/api/catalog/tags`
- `/api/customers/tags`
- `/api/resources/tags`
- any existing sales tag option fetch path used by `SalesDocumentsTable`

Existing filter parameter names remain unchanged:
- `tagIds`

## Backward Compatibility

No contract-surface changes are proposed.

Specifically unchanged:
- filter IDs
- API route URLs
- response shapes
- import paths
- widget IDs
- ACL features

This is additive consumer wiring of an already-supported filter callback.

## Risks And Impact Review

### Risk 1: Fix appears to work only during in-overlay selection

- Scenario: manual QA adds a tag and immediately sees a correct label because the overlay still has an in-memory option map, but persisted filter rendering is still broken elsewhere
- Severity: Medium
- Affected area: QA confidence, regression detection
- Mitigation: require verification after apply/reopen/reload or other state reconstruction
- Residual risk: Low

### Risk 2: Duplicate tag caches drift or become harder to maintain

- Scenario: a page already has tag-label state, but implementation adds a second cache with overlapping responsibility
- Severity: Low
- Affected area: maintainability
- Mitigation: reuse existing label state wherever present
- Residual risk: Low

### Risk 3: Future tag filters repeat the omission

- Scenario: a new page adds a `tags` filter without `formatValue`, causing the same UUID regression later
- Severity: Medium
- Affected area: future UI consistency
- Mitigation: document this as a shared-layer hardening opportunity; consider follow-up issue for `FilterBar`
- Residual risk: Medium

## Verification

Verification must exercise persisted or reconstructed filter state, not just the initial selection path.

Required manual verification for each affected page:
- open the list page
- add a tag filter and apply it
- confirm the active filter chip shows the tag label, not the UUID
- reopen the filter overlay and confirm the selected tag pill/input still shows the label
- refresh the page or otherwise reconstruct the page state if the page persists filters in URL or local state
- confirm filtering still returns the correct records

Affected pages:
- sales documents list
- customers people list
- customers companies list
- resources list

## Integration Test Coverage

Minimum automated coverage:
- add one integration test for a representative affected page that reproduces the persisted-label path, not just initial selection

Recommended first test:
- `tests/sales/tag-filter-display.spec.ts`

Required assertions:
- create a tag and an entity using that tag
- apply the tag filter through the UI
- assert the active filter chip shows the tag label
- reopen the filter UI and assert the selected tag still renders by label
- confirm the filtered result set is correct

Optional follow-up coverage if this area proves fragile:
- customers people tag filter label rendering
- customers companies tag filter label rendering
- resources tag filter label rendering

## Open Questions

All resolved:

- ~~Does the sales documents page already retain enough tag option state?~~ **Yes.** `tagOptions` (`FilterOption[]`) is stable page-level state at line ~157. A `.find()` lookup or small derived cache both work; `.find()` is sufficient for typical tag counts.
- ~~Do any of the affected pages hydrate filter state from URL parameters?~~ **Covered by verification steps.** The verification plan already requires testing after state reconstruction (refresh/reopen). Specific URL hydration testing is optional follow-up coverage.

## Final Compliance Report

- Scope remains a small UI bug fix
- No API, schema, or contract changes
- Proposed implementation follows the repo principle of minimal impact
- Spec intentionally documents the tactical choice to avoid shared framework changes in this patch

## Changelog

- 2026-04-12: Rewrote draft to reflect the real persisted-label failure mode, require stronger verification, and prefer reuse of existing tag-label state instead of duplicating caches.
- 2026-04-12: Closed open questions after code verification. All four pages already have the required tag-label state — no new caches needed. Status → In Progress.
