# Variant form loading with empty price kinds

## TLDR

The catalog variant edit form must distinguish “price kinds are still loading” from “price kinds loaded successfully and the result is empty.” An organization with no configured price kinds is a valid state and must not leave the primary variant form in a permanent loading state.

**Scope:** one catalog UI loading-state correction and focused regression coverage. No API, data model, persistence, pricing calculation, or public contract changes.

## Overview

Catalog price kinds are optional organization-level configuration, but the variant edit page currently treats a non-empty price-kind collection as proof that its dependency has finished loading. This specification makes request readiness explicit so the existing edit flow works for both configured and unconfigured organizations without changing price semantics.

## Problem Statement

The existing variant loader uses a non-empty `priceKinds` array as both dependency readiness and data. When the price-kinds request completes with an empty list, the variant request never starts and the edit page remains blocked indefinitely.

## Proposed Solution

Track completion of the price-kinds request independently from its result. Start variant hydration after that request settles, including when it resolves to an empty list, while preserving the existing dependency ordering for configured price kinds.

### Design decisions

| Decision                                                  | Rationale                                                                                                                                           |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Add an explicit request-completion state                  | Array length cannot distinguish “not loaded” from the valid empty result.                                                                           |
| Gate variant hydration on completion, not cardinality     | Price-kind metadata must be known before mapping existing prices, but zero price kinds is still ready.                                              |
| Treat a handled price-kind request failure as settled     | The current loader already catches the failure and degrades to an empty list; the primary variant form should remain accessible instead of hanging. |
| Keep the change inside the existing page and focused test | No reusable abstraction or new dependency is justified for one local readiness bug.                                                                 |

### Alternative considered

Starting variant hydration immediately and refreshing prices later was rejected. It would change the current hydration sequence, introduce a second form-state merge, and create unnecessary risk of overwriting operator edits when configured price kinds arrive.

## User story

An operator editing a product variant in an organization without configured price kinds can load, edit, and save the variant instead of seeing an indefinite loading state.

## Architecture

The change remains in the existing client page:

`price-kinds request` → `request settled` → `variant + attachments + prices + product context` → `CrudForm hydrated`

The page continues to use the existing `readApiResultOrThrow`, `apiCall`, `CrudForm`, and catalog form helpers. The only new state is a local boolean (or equivalent explicit status) representing whether the price-kinds request has settled. The effect cleanup must prevent unmounted or superseded requests from updating either the data or readiness state.

### Frontend architecture contract

- **Server/client boundary:** unchanged. The existing route page remains a client component because it owns effects, router navigation, form state, and mutations.
- **`"use client"` ledger:** no new client files and no new client boundary.
- **Client blob and dependencies:** no new production dependency, provider, context, or shared state; the local state increase is one primitive readiness value.
- **Bundle, route, and memory budget:** no measurable bundle-size change and no additional request. Existing requests and their concurrency remain unchanged.
- **Hydration/interactivity evidence:** a jsdom render regression test must prove the primary form reaches hydrated, non-loading state after an empty price-kinds response.
- **Provider/bootstrap scope:** unchanged.

| Budget                                            | Target                                                                                                                      |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| New generated backend page-root client boundaries | 0                                                                                                                           |
| New heavy browser libraries or root imports       | 0                                                                                                                           |
| Additional network requests                       | 0                                                                                                                           |
| Touched client page/root files over 300 LOC       | 1 existing file; justified because the correction belongs to its existing local effects and adds only readiness bookkeeping |
| Per-route hydration/interactivity evidence        | Focused jsdom render test for the changed variant edit route                                                                |
| Performance evidence                              | Static diff confirms no request or dependency increase; focused runtime test confirms hydration completes                   |

### Market reference

[TanStack Query](https://tanstack.com/query/latest/docs/framework/react/reference/useQuery) models request status separately from returned data and derives initial loading from request state, not collection cardinality. This design adopts that same distinction locally without adding a query library: an empty successful result is data, while request completion is control state.

## Data Models

No entities, columns, relations, migrations, tenant-scoping rules, or encryption maps change. The empty price-kind list is organization-scoped data returned by the existing API.

## API Contracts

No API route, request, response, validation, authentication, authorization, or OpenAPI contract changes.

The existing `GET /api/catalog/price-kinds?pageSize=100` response remains valid when `items` is an empty array. Existing variant, attachment, price, product, and tax-rate requests remain unchanged.

## UI/UX

- Preserve the existing `CrudForm` loading presentation while price-kind readiness and variant hydration are pending.
- When price kinds resolve to `[]`, continue hydration and render the existing form with an empty prices section.
- When the price-kinds request fails and the existing error handler degrades to `[]`, continue loading the variant form; retain existing logging and do not introduce new user-facing copy.
- Preserve configured-price-kind behavior, not-found handling, load errors, optimistic locking, delete handling, and navigation.
- No new visual component, styling, icon, dialog, or accessibility surface is introduced.

## Internationalization

No new user-facing strings or locale keys are required.

## Migration & Compatibility

This is backward-compatible and deployment-safe. It changes only a client-side readiness predicate and adds no persisted state or public contract. Rollback is a code revert; no data rollback is required.

## Implementation Plan

### Phase 1 — Regression test

1. Extend `packages/core/src/modules/catalog/backend/catalog/products/[productId]/variants/[variantId]/__tests__/page.parallelLoad.test.tsx` so the price-kinds mock can return an empty `items` array.
2. Render the edit page with that response, resolve the existing independent secondary reads, and assert that the variant request runs and `CrudForm` receives hydrated initial values with `isLoading: false`.
3. Add a second case in which the price-kinds request rejects, then assert that the handled failure still dispatches the variant request and reaches the same hydrated, non-loading form state.
4. Confirm both focused cases fail before the readiness fix.

### Phase 2 — Loading-state correction

1. In `packages/core/src/modules/catalog/backend/catalog/products/[productId]/variants/[variantId]/page.tsx`, represent price-kind request completion separately from `priceKinds`.
2. Set the request to pending when the effect starts, update data only while active, and mark it settled in `finally` only while active.
3. Gate the variant-loading effect on request completion rather than `priceKinds.length`, keeping `priceKinds` in the dependency list so configured kinds still feed price mapping.
4. Run the focused catalog page test and the smallest relevant type/build validation.

### Verification

- Automated regression: empty price kinds dispatch the variant and secondary reads and hydrate `CrudForm`.
- Failure regression: a rejected price-kinds request follows the existing handled-empty fallback, dispatches variant hydration, and does not leave `CrudForm` loading indefinitely.
- Existing behavior: non-empty price kinds still dispatch attachments, prices, and product context concurrently.
- Headed QA: in an organization with no price kinds, open an existing variant, confirm the form finishes loading, edit a non-price field, save, reopen, and verify the value persisted.
- Integration-test rationale: no new `.ai/qa/tests/` case is required because no API or cross-boundary contract changes; the defect is the client effect's readiness predicate and is deterministically covered by the component render test. The headed QA scenario verifies the assembled user flow.

## Risks & Impact Review

#### Variant hydration runs before price-kind data is ready

- **Scenario:** The readiness flag is set before the price-kinds request settles, so configured prices are mapped without display-mode metadata.
- **Severity:** Medium
- **Affected area:** Catalog variant edit form and price draft display.
- **Mitigation:** Set readiness only in the active request's `finally` path and keep `priceKinds` in the variant effect dependencies; retain the existing non-empty regression test.
- **Residual risk:** Low; focused tests cover empty and configured results.

#### Stale request updates an unmounted page

- **Scenario:** A slow request settles after navigation or effect replacement and updates local state.
- **Severity:** Low
- **Affected area:** Catalog variant edit page lifecycle.
- **Mitigation:** Use the effect's cancellation flag for both data and readiness updates.
- **Residual risk:** Low; this follows the page's existing cancellation pattern.

#### Price-kind failure is mistaken for valid configuration

- **Scenario:** A transient request failure yields the same empty prices UI as an organization with no configured price kinds.
- **Severity:** Low
- **Affected area:** Prices section on the variant edit form.
- **Mitigation:** Preserve existing error logging and graceful degradation; this change does not suppress or reinterpret the error. A richer section-level error state is out of scope.
- **Residual risk:** Accepted; the primary form remains usable and behavior is no worse than the existing caught-empty fallback.

### Operational impact

There is no migration, cache invalidation, background work, event emission, write-path, tenant-isolation, or scaling impact. The blast radius is one catalog edit route. Existing logs remain the detection mechanism for price-kind request failures; the regression test prevents reintroducing the indefinite-loading condition.

## Final Compliance Report — 2026-07-10

### AGENTS.md files reviewed

- `AGENTS.md`
- `.ai/specs/AGENTS.md`
- `packages/core/AGENTS.md`
- `packages/core/src/modules/catalog/AGENTS.md`
- `packages/ui/AGENTS.md`
- `packages/ui/src/backend/AGENTS.md`
- `BACKWARD_COMPATIBILITY.md`

### Compliance matrix

| Rule source                   | Rule                                                            | Status    | Notes                                                                                                                       |
| ----------------------------- | --------------------------------------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------- |
| Root `AGENTS.md`              | Preserve behavior unless a behavior change is requested         | Compliant | Only the invalid permanent-loading outcome changes; configured-price and mutation behavior remains intact.                  |
| Root `AGENTS.md`              | Use canonical UI/data helpers                                   | Compliant | Existing `CrudForm`, `apiCall`, and `readApiResultOrThrow` remain in use.                                                   |
| Root `AGENTS.md`              | New public code must be reachable from real call sites          | Compliant | The local state participates directly in the existing page effects.                                                         |
| `.ai/specs/AGENTS.md`         | Include required sections, risks, compliance, and changelog     | Compliant | All required sections are present; N/A surfaces are explicit.                                                               |
| `packages/core/AGENTS.md`     | Preserve tenant scope and mutation/locking guards               | N/A       | No API, query, or mutation path changes.                                                                                    |
| Catalog `AGENTS.md`           | Use canonical catalog pricing pipeline                          | Compliant | Pricing calculation and resolver behavior are unchanged.                                                                    |
| `packages/ui/AGENTS.md`       | Keep loading flags local and reset errors before each load      | Compliant | The existing page-local `loading` and `error` lifecycle remains; the new readiness state is local to its dependency effect. |
| UI backend `AGENTS.md`        | Use `CrudForm`, shared data helpers, and explicit record states | Compliant | Existing `CrudForm`, `apiCall`, not-found, error, and ready rendering paths remain intact.                                  |
| UI design-system rules        | Use shared primitives, semantic tokens, and accessible controls | N/A       | No visual markup, styles, controls, or copy change.                                                                         |
| Backward compatibility policy | Protect public contracts                                        | Compliant | No public contract changes.                                                                                                 |

### Internal consistency check

| Check                                     | Status | Notes                                                                |
| ----------------------------------------- | ------ | -------------------------------------------------------------------- |
| Data models match API contracts           | Pass   | Neither changes.                                                     |
| API contracts match UI/UX                 | Pass   | The existing valid empty response now advances the existing UI flow. |
| Risks cover all changed behavior          | Pass   | Readiness timing, cancellation, and failure fallback are covered.    |
| Commands defined for mutations            | N/A    | No mutation is introduced or changed.                                |
| Cache strategy covers read APIs           | N/A    | No cache behavior or new read API is introduced.                     |
| Frontend boundary and performance budgets | Pass   | No new boundary, provider, dependency, or request.                   |

### Non-compliant items

None.

### Verdict

**Fully compliant: Approved — ready for implementation after the repository's contribution gates are satisfied.**

## Changelog

### 2026-07-10

- Initial specification for distinguishing price-kind request readiness from an empty result on the variant edit page.

### Review — 2026-07-10

- **Reviewer:** Agent self-review, fresh-context scope-cohesion review, and independent primary review
- **Scope cohesion:** Passed — one local loading-state correction; no split warranted
- **Security:** Passed — no auth, tenant boundary, input, or persistence change
- **Performance:** Passed — no new request or dependency; hydration unblocks for a valid empty result
- **Cache:** N/A — no cache behavior changes
- **Commands:** N/A — no mutation or command changes
- **Risks:** Passed — readiness timing, cleanup, and handled request failure are covered
- **Primary review:** Passed after adding rejected-request coverage and explicit backend-UI compliance mappings
- **Verdict:** Approved
