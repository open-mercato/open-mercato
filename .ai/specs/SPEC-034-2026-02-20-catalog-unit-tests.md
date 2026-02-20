# SPEC-030: Catalog Module Unit & UI Unit Tests

**Date:** 2026-02-20
**Status:** Draft
**Module:** `catalog` (`packages/core/src/modules/catalog/`)
**Related:** Issue #166, PR #142 (sales, catalog UI foundations)

---

## TLDR

**Key Points:**
- Add comprehensive unit tests and UI unit tests for all new catalog UIs introduced in PR #142
- Cover pure logic functions (form helpers, normalizers, combinators) and interactive component behaviors (data tables, editors, form sections)

**Scope:**
- 3 pure logic test files (~70 test cases, zero mocking)
- 8 component interaction test files (~92 test cases, jsdom + React Testing Library)
- Total: 11 new test files, ~162 test cases

**Concerns:**
- Heavy mock setup required for component tests due to external dependencies (React Query, i18n, API layer)

## Overview

PR #142 introduced significant catalog UI features: product CRUD pages, variant management, category hierarchy, price kind configuration, media management, and metadata editing. The catalog module has 14 existing test files, but only 3 cover UI components — and those are limited to shallow render-only assertions. This spec defines the test coverage needed to ensure correctness and prevent regressions.

> **Market Reference**: Studied Medusa.js and Saleor catalog test suites. Adopted their pattern of testing form helpers as pure functions separately from component rendering tests. Rejected their approach of testing full page components (too brittle with server-side dependencies) — we rely on Playwright integration tests for page-level coverage instead.

## Problem Statement

1. **Low UI test coverage**: The catalog module has 14 test files but only 3 cover UI components (`catalogComponentsRender.test.tsx`, `ProductImageCell.test.tsx`, `ProductsDataTable.test.tsx`) — the rest cover API routes, commands, pricing, and services. The UI tests are limited to basic render assertions with no interaction coverage.
2. **Untested pure logic**: `productForm.ts` exports 12+ pure functions used by both create and edit flows. Zero unit tests cover these.
3. **No interaction testing**: Existing tests only verify that components render without crashing. No tests for user interactions (add/remove entries, form field changes, dialog flows, confirmation dialogs).
4. **Regression risk**: Future changes to catalog UIs have no safety net beyond integration tests, which are slower and more expensive to run.

## Proposed Solution

Add unit tests in two phases, prioritized by value and implementation effort:

1. **Phase 1 — Pure Logic Tests**: Test all exported functions from `productForm.ts`, `variantForm.ts`, and `categoryTree.ts` as plain TypeScript. Zero React rendering, zero mocking. Highest value per line of test code.

2. **Phase 2 — Component Interaction Tests**: Test interactive behaviors of 8 catalog components using React Testing Library with the established mock patterns from `catalogComponentsRender.test.tsx`.

### Design Decisions

| Decision | Rationale |
|----------|-----------|
| Skip backend page tests | Pages are CrudForm wrappers — correctness covered by integration tests TC-CAT-001 through TC-CAT-012 |
| Skip `optionSchemaClient.ts` | Thin API client wrapper, low value for unit testing |
| Dedicated test files per component | Existing `catalogComponentsRender.test.tsx` provides breadth; new files add depth |
| Reuse existing mock setup | Follow patterns from `catalogComponentsRender.test.tsx` and `ProductsDataTable.test.tsx` |

## User Stories / Use Cases

- **Developer** wants to **refactor product form logic** so that **unit tests catch regressions before integration tests run**
- **Developer** wants to **add a new price kind display mode** so that **`normalizePriceKindSummary` tests validate the new mode is handled**
- **CI pipeline** wants to **run fast unit tests on every PR** so that **broken catalog UIs are caught in seconds, not minutes**

## Architecture

N/A — This spec adds test files only. No runtime architecture changes.

## Data Models

N/A — No entity or schema changes.

## API Contracts

N/A — No API changes.

## Internationalization (i18n)

N/A — Tests use mock translation function: `useT: () => (key, fallback) => fallback ?? key`.

## UI/UX

N/A — No UI changes. Tests verify existing UI behavior.

## Configuration

N/A — Uses existing Jest configuration from `packages/core/jest.config.cjs` (node environment for `.ts`, jsdom for `.tsx`).

## Migration & Compatibility

N/A — No database or API changes. Test files are additive.

## Implementation Plan

### Phase 1: Pure Logic Tests (Zero Mocking)

**Goal:** Cover all pure functions exported from form helper modules. These tests run in Node.js without jsdom, have no external dependencies, and execute in milliseconds.

#### Step 1.1: `productForm.test.ts`

**File:** `packages/core/src/modules/catalog/components/products/__tests__/productForm.test.ts`

**Functions to test (~50 test cases):**

| Function | Key Test Cases |
|----------|---------------|
| `buildOptionValuesKey` | Empty/undefined input, single key, multiple keys sorted alphabetically, undefined values coerced to empty |
| `haveSameOptionValues` | Identical records, undefined vs empty, different keys, different values, superset keys |
| `normalizeProductDimensions` | null/undefined/non-object → null, empty object → null, valid numeric fields, negative values stripped, string numbers coerced, unit trimming, partial dimensions |
| `normalizeProductWeight` | null → null, empty → null, value-only, unit-only, both fields, negative stripped |
| `updateDimensionValue` | Update numeric field, clear field with invalid input, update unit, create from null, return null when clearing last field |
| `updateWeightValue` | Update value, clear value, update unit, create from null, return null when clearing last field |
| `normalizePriceKindSummary` | null → null, missing required fields → null, camelCase props, snake_case props, displayMode defaults to 'excluding-tax', numeric id coercion |
| `formatTaxRateLabel` | Name only, with rate percentage, with code, with both rate and code, null rate |
| `buildOptionSchemaDefinition` | Empty options → null, valid options with choices, filtered empty labels, default name fallback |
| `convertSchemaToProductOptions` | null → empty, valid schema mapping, missing labels fallback |
| `buildVariantCombinations` | Empty options → empty, single option, two options (cartesian product), three options, option with no values → empty |
| `createVariantDraft` | Default values, override applied, taxRateId inheritance, unique id generation |
| `productFormSchema` | Title required, valid handle, invalid handle chars rejected, UUID fields, passthrough unknown fields |
| `createInitialProductFormValues` | Correct structure, mediaDraftId generated, contains default variant |

#### Step 1.2: `variantForm.test.ts`

**File:** `packages/core/src/modules/catalog/components/products/__tests__/variantForm.test.ts`

**Functions to test (~15 test cases):**

| Function | Key Test Cases |
|----------|---------------|
| `normalizeOptionSchema` | Non-array → empty, null → empty, valid entries mapped, null/non-object entries skipped, empty label values filtered |
| `buildVariantMetadata` | Valid object shallow-copied, null → empty object, undefined → empty object |
| `createVariantInitialValues` | Matches VARIANT_BASE_VALUES shape, unique mediaDraftId |
| `VARIANT_BASE_VALUES` | Shape verification: all required fields present with correct defaults |

#### Step 1.3: `categoryTree.test.ts`

**File:** `packages/core/src/modules/catalog/lib/__tests__/categoryTree.test.ts`

**Functions to test (~5 test cases):**

| Function | Key Test Cases |
|----------|---------------|
| `formatCategoryTreeLabel` | depth 0 → plain name, depth 1 → "↳ name", depth 2 → "\u00A0\u00A0↳ name", depth 3 → "\u00A0\u00A0\u00A0\u00A0↳ name", negative depth → plain name |

### Phase 2: Component Interaction Tests

**Goal:** Test user interactions beyond basic rendering. All tests use `@jest-environment jsdom` pragma and follow mock patterns from existing catalog tests.

**Shared mock setup** (reused across all Phase 2 files):
- `@open-mercato/shared/lib/i18n/context` → `useT` returns fallback-or-key translator
- `@open-mercato/ui/backend/utils/apiCall` → `apiCall`, `readApiResultOrThrow` as `jest.fn()`
- `@open-mercato/ui/primitives/*` → Simple DOM element wrappers
- `next/link` → `<a>` element
- `@tanstack/react-query` → Controlled `useQuery`/`useQueryClient` mocks

#### Step 2.1: `MetadataEditor.test.tsx`

**File:** `packages/core/src/modules/catalog/components/products/__tests__/MetadataEditor.test.tsx`

**Test cases (~15):**
- Expand/collapse toggle via button click
- Add entry appends new key-value pair via onChange
- Remove entry removes specific key via onChange
- Edit key input fires onChange with renamed key
- Edit value input fires onChange with updated value
- Value parsing: `"true"` → boolean, `"42"` → number, `"hello"` → string, `'{"a":1}'` → parsed JSON
- Empty state shows "No metadata" when expanded with no entries
- Renders initial entries from value prop correctly
- Embedded mode omits wrapper border
- Custom title and description props render

#### Step 2.2: `CategorySlugFieldSync.test.tsx`

**File:** `packages/core/src/modules/catalog/components/categories/__tests__/CategorySlugFieldSync.test.tsx`

**Test cases (~8):**
- Auto-sync: name change updates slug via setValue
- Manual override: editing slug to different value stops auto-sync
- Clear re-enables: clearing slug re-enables auto-sync from name
- Empty name clears slug when auto-mode is active
- No unnecessary setValue calls when slug already matches
- Preserves manually set slug on subsequent name changes

#### Step 2.3: `CategorySelect.test.tsx`

**File:** `packages/core/src/modules/catalog/components/categories/__tests__/CategorySelect.test.tsx`

**Test cases (~10):**
- Renders provided nodes as select options
- Includes "Root level" empty option by default
- Custom emptyOptionLabel renders
- No empty option when includeEmptyOption=false
- Selecting option calls onChange with value
- Selecting empty option calls onChange with null
- Fetch on mount when no nodes and fetchOnMount=true
- No fetch when nodes provided
- Disabled prop disables select element
- Inactive categories show "(inactive)" suffix

#### Step 2.4: `VariantBuilder.test.tsx`

**File:** `packages/core/src/modules/catalog/components/products/__tests__/VariantBuilder.test.tsx`

**Test cases (~15):**
- **BasicsSection:** Renders name/SKU/barcode inputs, onChange calls setValue, default/active switch toggles, error messages display
- **OptionValuesSection:** Returns null when no optionDefinitions, renders select per option, changing select calls setValue
- **DimensionsSection:** Renders dimension and weight inputs
- **PricesSection:** Renders price input per price kind, empty state message, tax rate select, currency/displayMode labels
- **MediaSection:** Renders ProductMediaManager with correct entity ID

#### Step 2.5: `ProductMediaManager.test.tsx`

**File:** `packages/core/src/modules/catalog/components/products/__tests__/ProductMediaManager.test.tsx`

**Test cases (~12):**
- Empty state shows "No media uploaded yet"
- Renders image thumbnails for each item
- Default badge shown on matching defaultMediaId item
- Set default: star button click calls onDefaultChange
- Remove media: trash button calls apiCall(DELETE) then onItemsChange
- Remove default media also calls onDefaultChange with null/first remaining
- File size formatting renders correctly
- Choose files button present

#### Step 2.6: `PriceKindSettings.test.tsx`

**File:** `packages/core/src/modules/catalog/components/__tests__/PriceKindSettings.test.tsx`

**Test cases (~12):**
- Loads and renders price kinds on mount
- Search input filters displayed items
- "Add price kind" opens dialog with empty form
- "Edit" row action opens dialog pre-filled with entry data
- Create submission sends POST to correct endpoint
- Edit submission sends PUT with entry id
- Validation: submit without code/title shows error
- Delete with confirmation dialog
- Cancel closes dialog and resets form
- Cmd+Enter keyboard shortcut triggers submit
- Disabled code field in edit mode
- Error handling shows flash on API failure

#### Step 2.7: `CategoriesDataTable.test.tsx`

**File:** `packages/core/src/modules/catalog/components/categories/__tests__/CategoriesDataTable.test.tsx`

**Test cases (~10):**
- Renders title and data rows from useQuery
- Feature check controls Create button visibility
- Search re-fetches with search param
- Delete with confirmation calls apiCallOrThrow DELETE
- Tree indentation for depth > 0
- Row actions only render when canManage is true
- Loading state passes to DataTable

#### Step 2.8: `ProductCategorizeSection.test.tsx`

**File:** `packages/core/src/modules/catalog/components/products/__tests__/ProductCategorizeSection.test.tsx`

**Test cases (~10):**
- Renders three TagsInput sections (categories, channels, tags)
- Passes correct values from form values
- Category onChange calls setValue('categoryIds', ...)
- Channel onChange calls setValue('channelIds', ...)
- Tags onChange calls setValue('tags', ...)
- Error display for each field when errors present
- Help text renders for each section

### File Manifest

| File | Action | Purpose |
|------|--------|---------|
| `packages/core/src/modules/catalog/components/products/__tests__/productForm.test.ts` | Create | Pure logic tests for all productForm.ts exports |
| `packages/core/src/modules/catalog/components/products/__tests__/variantForm.test.ts` | Create | Pure logic tests for variantForm.ts exports |
| `packages/core/src/modules/catalog/lib/__tests__/categoryTree.test.ts` | Create | Pure logic tests for formatCategoryTreeLabel |
| `packages/core/src/modules/catalog/components/products/__tests__/MetadataEditor.test.tsx` | Create | Interaction tests for MetadataEditor |
| `packages/core/src/modules/catalog/components/categories/__tests__/CategorySlugFieldSync.test.tsx` | Create | Interaction tests for CategorySlugFieldSync |
| `packages/core/src/modules/catalog/components/categories/__tests__/CategorySelect.test.tsx` | Create | Interaction tests for CategorySelect |
| `packages/core/src/modules/catalog/components/products/__tests__/VariantBuilder.test.tsx` | Create | Interaction tests for VariantBuilder sections |
| `packages/core/src/modules/catalog/components/products/__tests__/ProductMediaManager.test.tsx` | Create | Interaction tests for ProductMediaManager |
| `packages/core/src/modules/catalog/components/__tests__/PriceKindSettings.test.tsx` | Create | Interaction tests for PriceKindSettings |
| `packages/core/src/modules/catalog/components/categories/__tests__/CategoriesDataTable.test.tsx` | Create | Interaction tests for CategoriesDataTable |
| `packages/core/src/modules/catalog/components/products/__tests__/ProductCategorizeSection.test.tsx` | Create | Interaction tests for ProductCategorizeSection |

### Testing Strategy

- **Phase 1 tests**: Run with `npx jest packages/core/src/modules/catalog/components/products/__tests__/productForm.test.ts` (no jsdom needed)
- **Phase 2 tests**: Run with `npx jest packages/core/src/modules/catalog/components/` (jsdom environment via pragma)
- **Full suite**: `yarn test -- --filter=@open-mercato/core`
- **Type check**: `yarn typecheck`
- **Lint**: `yarn lint`

## Risks & Impact Review

### Test Reliability

#### Mock Drift
- **Scenario**: Component APIs change but test mocks retain stale shapes, causing false positives (tests pass but component is broken)
- **Severity**: Medium
- **Affected area**: All Phase 2 component tests
- **Mitigation**: Tests import real types from source modules for mock data shapes. TypeScript compilation catches shape mismatches.
- **Residual risk**: Mocked UI primitives (Button, Input, Dialog) may diverge from real component behavior. Acceptable because integration tests cover real rendering.

#### Flaky Async Tests
- **Scenario**: `waitFor` timeouts or race conditions in component tests that rely on mock async responses
- **Severity**: Low
- **Affected area**: Phase 2 tests using `mockResolvedValueOnce`
- **Mitigation**: Use deterministic mock return values. Avoid real timers. Follow established patterns from `ProductsDataTable.test.tsx`.
- **Residual risk**: Minimal — existing catalog tests prove the pattern is stable.

#### createLocalId Non-Determinism
- **Scenario**: Functions using `Math.random()` via `createLocalId()` produce non-deterministic IDs, making exact equality assertions fragile
- **Severity**: Low
- **Affected area**: Phase 1 tests for `createVariantDraft`, `createInitialProductFormValues`, `buildOptionSchemaDefinition`
- **Mitigation**: Assert on structure and properties, not exact ID values. Use `expect.any(String)` for generated IDs.
- **Residual risk**: None.

### Data Integrity Failures

N/A — Tests do not modify any persistent state.

### Cascading Failures & Side Effects

N/A — Tests are isolated via Jest and have no side effects.

### Tenant & Data Isolation Risks

N/A — Tests do not access any tenant-scoped data.

### Migration & Deployment Risks

N/A — No database or API changes. Test files are additive and cannot break production.

### Operational Risks

N/A — Tests run in CI only. No runtime operational impact.

## Final Compliance Report — 2026-02-20

### AGENTS.md Files Reviewed
- `AGENTS.md` (root)
- `packages/core/AGENTS.md`
- `packages/core/src/modules/catalog/AGENTS.md`
- `packages/ui/AGENTS.md`
- `packages/ui/src/backend/AGENTS.md`
- `.ai/qa/AGENTS.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| root AGENTS.md | No `any` types | Compliant | Tests use typed mocks with `jest.Mock` casts |
| root AGENTS.md | Validate inputs with zod | Compliant | `productFormSchema` tests validate zod behavior |
| root AGENTS.md | Use `apiCall`/`readApiResultOrThrow` | Compliant | Tests mock these correctly |
| root AGENTS.md | i18n: `useT()` client-side | Compliant | All component tests mock `useT` |
| root AGENTS.md | Test files in `__tests__/` | Compliant | All files placed in `__tests__/` directories |
| packages/core/AGENTS.md | Test naming: `*.test.ts`/`*.test.tsx` | Compliant | All files follow convention |
| catalog/AGENTS.md | Use `selectBestPrice` for pricing | N/A | Tests mock pricing, don't implement it |
| .ai/qa/AGENTS.md | Integration tests self-contained | N/A | This spec covers unit tests only |

### Internal Consistency Check

| Check | Status | Notes |
|-------|--------|-------|
| Data models match API contracts | N/A | No data models or API contracts in this spec |
| API contracts match UI/UX section | N/A | No API or UI changes |
| Risks cover all write operations | N/A | No write operations |
| Commands defined for all mutations | N/A | No mutations |
| Cache strategy covers all read APIs | N/A | No cache changes |
| Test file manifest matches implementation plan | Pass | All 11 files listed in both sections |
| Phase ordering is incrementally deliverable | Pass | Phase 1 has zero dependencies; Phase 2 reuses established patterns |

### Non-Compliant Items

None.

### Verdict

**Fully compliant** — Approved for implementation.

## Changelog

### 2026-02-20
- Initial specification
