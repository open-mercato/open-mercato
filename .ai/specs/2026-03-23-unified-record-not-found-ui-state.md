# Unified Record Not Found UI State

| Field | Value |
|-------|-------|
| Status | Draft |
| Scope | OSS |
| Owner | UI / Backend pages |
| Related Guides | `packages/ui/AGENTS.md`, `packages/ui/src/backend/AGENTS.md` |
| Related Specs | `SPEC-041i-detail-page-bindings.md` |

## TLDR

Backend detail and edit pages should handle missing records the same way everywhere. When a requested record does not exist, the page must stop before rendering the form or detail sections and show a shared not-found state built on `ErrorMessage`, with a clear back-to-list action.

## Overview

The current backend UI mixes several patterns for missing records:

- some pages render `ErrorMessage` directly
- some pages render custom centered markup with plain text and a button
- some pages collapse `not found` and generic load failures into the same branch
- some pages still keep form/detail layout concerns mixed into the failure path

This feature request standardizes the not-found experience for any record-backed backend page: products, orders, quotes, users, staff resources, companies, deals, and similar entity detail/edit views.

## Problem Statement

When a user opens `/backend/.../[id]` for a deleted, invalid, or inaccessible record, the UI should behave predictably. Today it does not.

Observed gaps:

- visual inconsistency across modules
- repeated custom markup instead of shared UI
- missing or inconsistent back-to-list action
- forms/detail sections can remain coupled to missing-record code paths
- some pages treat transport/load failures as "not found", which weakens the UX signal

Representative current patterns exist in:

- `packages/core/src/modules/catalog/backend/catalog/products/[id]/page.tsx`
- `packages/core/src/modules/customers/backend/customers/companies/[id]/page.tsx`
- `packages/core/src/modules/customers/backend/customers/deals/[id]/page.tsx`
- `packages/core/src/modules/auth/backend/users/[id]/edit/page.tsx`
- `packages/core/src/modules/resources/backend/resources/resources/[id]/page.tsx`

## Proposed Solution

Introduce one shared backend UI primitive for record-missing states, implemented on top of `ErrorMessage`.

Proposed component:

- `packages/ui/src/backend/detail/RecordNotFoundState.tsx`

Proposed behavior:

1. Center the state inside the page body.
2. Render `ErrorMessage` as the core visual message.
3. Support a primary recovery action such as "Back to list".
4. Return early from the page before rendering `CrudForm`, detail sections, tabs, or mutation controls.
5. Keep generic operational failures separate from true not-found states.

Proposed component contract:

```tsx
type RecordNotFoundStateProps = {
  label: string
  description?: string
  backHref?: string
  backLabel?: string
  action?: React.ReactNode
  className?: string
}
```

Default rendering rule:

- if `backHref` is provided, render a `Button asChild variant="outline"` action below the `ErrorMessage`
- if `action` is provided, use it as an override

## Architecture

### 1. Shared Page-State Contract

Record-backed backend pages should distinguish these states explicitly:

- `loading`
- `ready`
- `notFound`
- `error`

Recommended page rule:

```tsx
if (isLoading) return <LoadingMessage ... />
if (isNotFound) return <RecordNotFoundState ... />
if (error) return <ErrorMessage label={error} />
return <CrudFormOrDetailPage ... />
```

This is intentionally different from `if (error || !data)`, because an empty record result should not be merged with a transport or parsing failure.

### 2. Missing-Record Detection

Pages may detect `notFound` in different ways depending on the existing API shape:

- detail endpoint returns HTTP `404`
- list endpoint returns `200` with `items[0]` missing
- normalized detail payload exists but lacks the required root entity id

The page should convert these cases into `isNotFound = true` and avoid storing them as a generic error string unless the API returned a user-facing localized message.

### 3. ErrorMessage Reuse

`ErrorMessage` already supports:

- `label`
- `description`
- `action`

That means the new shared state stays additive and low-risk. The new component only standardizes page-level layout and default button behavior; it does not replace `ErrorMessage` for inline section errors.

### 4. Navigation Contract

Every record-backed detail/edit page should expose a deterministic return path:

- products -> products list
- companies -> companies list
- deals -> deals list
- users -> users list
- resources -> resources list

If a page has no natural list page, the page may pass a custom `action` instead of `backHref`.

## Data Models

No database or ORM changes.

No new persisted data.

## API Contracts

No server API changes are required.

Existing API behavior remains valid:

- `404` detail responses remain `404`
- list endpoints that return empty `items` remain unchanged

This feature is a UI normalization layer that standardizes how pages interpret existing "record missing" outcomes.

## UI Coverage

The rollout should cover record-backed backend detail/edit pages, starting with representative pages that already show the inconsistency:

- `/backend/catalog/products/[id]`
- `/backend/customers/companies/[id]`
- `/backend/customers/deals/[id]`
- `/backend/auth/users/[id]/edit`
- `/backend/resources/resources/[id]`
- `/backend/sales/documents/[id]`

The final implementation should then be applied broadly to other record pages that follow the same load-edit pattern.

## Integration Coverage

Key UI paths to cover:

- open an existing record and confirm the normal form/detail page still renders
- open a non-existent record id and confirm only the shared not-found state renders
- confirm the back-to-list action navigates to the expected list page
- confirm the form submit controls are absent in the not-found state

Key API paths to exercise through UI:

- one page backed by a list API that returns an empty result set
- one page backed by a detail API that returns HTTP `404`

## Phasing

### Phase 1. Shared Primitive

- add `RecordNotFoundState` to `packages/ui/src/backend/detail`
- export it from the package barrel
- keep it built on the existing `ErrorMessage`

### Phase 2. Representative Rollout

- adopt the shared primitive in representative catalog, customers, auth, resources, and sales pages
- split `notFound` from generic `error` in those pages where needed

### Phase 3. Coverage Sweep

- search all backend `[id]` pages
- normalize remaining record-backed pages to the shared contract
- add integration coverage for representative routes

## Implementation Plan

1. Add a shared `RecordNotFoundState` page-level component in `packages/ui/src/backend/detail/`.
2. Export it from `packages/ui/src/backend/detail/index.ts`.
3. Update representative pages to track `isNotFound` separately from `error`.
4. Replace ad hoc missing-record markup with the shared primitive.
5. Ensure each adopted page passes a deterministic `backHref` and translated back label.
6. Add integration tests for at least one list-backed page and one detail-endpoint-backed page.

## Risks & Impact Review

| Risk | Severity | Affected Area | Mitigation | Residual Risk |
|------|----------|---------------|------------|---------------|
| Pages continue to collapse `error` and `notFound` into one branch | Medium | Backend detail/edit UX | Require explicit `isNotFound` state in rollout pages | Medium |
| Some pages lack an obvious list route | Low | Navigation consistency | Allow custom `action` override | Low |
| Broad rollout misses older modules | Medium | UX consistency | Phase 3 repo-wide sweep over backend `[id]` pages | Low |
| Inline section errors get incorrectly replaced by page-level state | Low | Detail sub-sections | Limit scope to page-level record load only | Low |

## Migration & Backward Compatibility

This change is additive.

Backward-compatibility impact:

- no API routes change
- no import path removals
- no event ids change
- no widget ids change
- no database schema changes

Existing pages can adopt the new component incrementally.

## Acceptance Criteria

- Missing-record backend pages show a shared page-level state built on `ErrorMessage`.
- The page does not render `CrudForm`, detail sections, tabs, or record actions when the record is missing.
- The not-found state offers a clear recovery action, preferably back to the owning list page.
- Generic load failures remain visually separate from true not-found states.
- Representative integration tests verify the shared behavior.

## Final Compliance Report

- Uses existing shared UI primitives instead of new ad hoc markup.
- Keeps scope in `packages/ui` and consuming backend pages.
- Introduces no cross-module ORM coupling.
- Introduces no contract-surface breakage.
- Preserves i18n-first page messaging by requiring translated labels per page.
- Follows the backend UI guideline to use `LoadingMessage` and `ErrorMessage` for page states.

## Changelog

- 2026-03-23: Initial draft for unified backend record-not-found page handling.
