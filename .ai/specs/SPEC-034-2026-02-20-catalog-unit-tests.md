# SPEC-034: Catalog Module Test Coverage

**Date:** 2026-02-20
**Status:** Draft
**Module:** `catalog` (`packages/core/src/modules/catalog/`)
**Related:** Issue #166, PR #142 (sales, catalog UI foundations)

---

## TLDR

**Key Points:**

- Increase catalog module test coverage from ~57% to near 100% through unit tests and integration tests
- Unit tests cover pure logic functions and component interactions (Jest)
- Integration tests cover uncovered API routes and UI flows (Playwright)

**Scope:**

- Phase 1: 3 pure logic test files (~70 unit test cases, zero mocking)
- Phase 2: 8 component interaction test files (~92 unit test cases, jsdom)
- Phase 3: ~10 new integration test files covering uncovered API routes and UI flows (Playwright)
- Phase 4: New fixture helpers for integration test setup/teardown

**Concerns:**

- Integration tests require a running app instance (ephemeral or local)
- Heavy mock setup required for Phase 2 component tests

## Overview

PR #142 introduced significant catalog UI features: product CRUD pages, variant management, category hierarchy, price kind configuration, media management, and metadata editing. Current integration test coverage sits at ~57% (measured via `yarn test:integration:coverage`). 12 integration tests exist (TC-CAT-001 through TC-CAT-012) but they only cover happy paths — validation, error handling, and several API routes (offers, prices, option schemas) have zero coverage. Unit tests for pure form logic are also missing entirely.

> **Market Reference**: Studied Medusa.js and Saleor catalog test suites. Adopted their pattern of testing form helpers as pure functions separately from component rendering. For integration tests, adopted Saleor's approach of API-based fixture setup with UI-based flow verification.

## Problem Statement

1. **57% integration coverage**: 12 tests exist but only cover happy paths. Validation errors, edge cases, and error handling are mostly untested.
2. **Uncovered API routes**: Offers (full CRUD), Prices (update/delete), Categories (edit/delete), Option Schemas (update/delete), Product Media, and Dictionaries have zero integration test coverage.
3. **Uncovered UI flows**: Category editing/deletion, media management, advanced product filtering, and option schema management have no end-to-end tests.
4. **Untested pure logic**: `productForm.ts` exports 12+ pure functions used by create and edit flows. Zero unit tests cover these.
5. **No component interaction testing**: Existing unit tests only verify that components render without crashing. No tests for user interactions.

## Proposed Solution

Add tests in four phases, ordered by value:

1. **Phase 1 — Pure Logic Unit Tests**: Test all exported functions from `productForm.ts`, `variantForm.ts`, and `categoryTree.ts`. Zero mocking, runs in milliseconds.
2. **Phase 2 — Component Interaction Unit Tests**: Test interactive behaviors of 8 catalog components using React Testing Library.
3. **Phase 3 — Integration Tests**: Implement ~10 new Playwright tests covering uncovered API routes and UI flows. Target: bring integration coverage from ~57% to near 100%.
4. **Phase 4 — Fixture Helpers**: Add missing fixture helpers for categories, variants, offers, and price kinds.

### Design Decisions

| Decision | Rationale |
| --- | --- |
| Unit tests first, integration tests second | Unit tests catch logic bugs instantly; integration tests catch workflow bugs |
| Skip backend page unit tests | Pages are CrudForm wrappers — correctness covered by integration tests |
| API-based fixture setup for integration tests | More stable than UI-based setup, follows established pattern from TC-CAT-004+ |
| New TC numbers start at TC-CAT-013 | Continues from existing TC-CAT-012 |

### Alternatives Considered

| Alternative | Why Rejected |
| --- | --- |
| Integration tests only | Pure logic tests catch dimension/weight/pricing normalization bugs that are invisible to Playwright |
| Unit tests only | Does not address the 57% integration coverage gap that Piotr flagged |

## User Stories / Use Cases

- **Developer** wants to **refactor product form logic** so that **unit tests catch regressions before integration tests run**
- **QA engineer** wants to **run `yarn test:integration:coverage`** so that **catalog module shows near 100% coverage**
- **CI pipeline** wants to **run fast unit tests on every PR** so that **broken catalog UIs are caught in seconds, not minutes**
- **Developer** wants to **add a new offer type** so that **integration tests verify the full create-edit-delete lifecycle**

## Architecture

N/A — This spec adds test files only. No runtime architecture changes.

## Data Models

N/A — No entity or schema changes.

## API Contracts

N/A — No API changes. Integration tests verify existing API contracts:

**Currently covered:**

- `POST/GET /api/catalog/products` (TC-CAT-001, TC-CAT-012)
- `PATCH /api/catalog/products/[id]` (TC-CAT-003)
- `DELETE /api/catalog/products` (TC-CAT-004)
- `POST/PATCH /api/catalog/variants` (TC-CAT-005, TC-CAT-006)
- `POST /api/catalog/categories` (TC-CAT-007, TC-CAT-008)
- `POST/DELETE /api/catalog/price-kinds` (TC-CAT-010)

**To be covered in Phase 3:**

- `PUT/DELETE /api/catalog/categories` (edit, delete)
- `GET/POST/PUT/DELETE /api/catalog/offers` (full CRUD)
- `GET/PUT/DELETE /api/catalog/prices` (list, update, delete)
- `PUT/DELETE /api/catalog/option-schemas` (update, delete)
- `GET /api/catalog/product-media` (list)

## Internationalization (i18n)

N/A — Unit tests use mock translation function. Integration tests use the running app's locale.

## UI/UX

N/A — No UI changes. Tests verify existing UI behavior.

## Configuration

- **Unit tests**: Existing Jest configuration from `packages/core/jest.config.cjs`
- **Integration tests**: Existing Playwright configuration from `.ai/qa/tests/playwright.config.ts` (timeout: 20s, retries: 1, workers: 1)

## Migration & Compatibility

N/A — No database or API changes. Test files are additive.

## Implementation Plan

### Phase 1: Pure Logic Unit Tests (Zero Mocking)

**Goal:** Cover all pure functions exported from form helper modules. Runs in Node.js without jsdom, no external dependencies, executes in milliseconds.

#### Step 1.1: `productForm.test.ts`

**File:** `packages/core/src/modules/catalog/components/products/__tests__/productForm.test.ts`

**Functions to test (~50 test cases):**

| Function | Key Test Cases |
| --- | --- |
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
| --- | --- |
| `normalizeOptionSchema` | Non-array → empty, null → empty, valid entries mapped, null/non-object entries skipped, empty label values filtered |
| `buildVariantMetadata` | Valid object shallow-copied, null → empty object, undefined → empty object |
| `createVariantInitialValues` | Matches VARIANT_BASE_VALUES shape, unique mediaDraftId |
| `VARIANT_BASE_VALUES` | Shape verification: all required fields present with correct defaults |

#### Step 1.3: `categoryTree.test.ts`

**File:** `packages/core/src/modules/catalog/lib/__tests__/categoryTree.test.ts`

**Functions to test (~5 test cases):**

| Function | Key Test Cases |
| --- | --- |
| `formatCategoryTreeLabel` | depth 0 → plain name, depth 1 → "↳ name", depth 2 → indented "↳ name", negative depth → plain name |

### Phase 2: Component Interaction Unit Tests

**Goal:** Test user interactions beyond basic rendering. All tests use `@jest-environment jsdom` pragma and follow mock patterns from existing catalog tests.

**Shared mock setup** (reused across all Phase 2 files):

- `@open-mercato/shared/lib/i18n/context` → `useT` returns fallback-or-key translator
- `@open-mercato/ui/backend/utils/apiCall` → `apiCall`, `readApiResultOrThrow` as `jest.fn()`
- `@open-mercato/ui/primitives/*` → Simple DOM element wrappers
- `next/link` → `<a>` element
- `@tanstack/react-query` → Controlled `useQuery`/`useQueryClient` mocks

#### Step 2.1: `MetadataEditor.test.tsx` (~15 test cases)

Expand/collapse toggle, add/remove/edit entries, value type parsing (boolean, number, JSON), empty state, embedded mode, custom title.

#### Step 2.2: `CategorySlugFieldSync.test.tsx` (~8 test cases)

Auto-sync on name change, manual override stops sync, clear re-enables sync, empty name clears slug.

#### Step 2.3: `CategorySelect.test.tsx` (~10 test cases)

Renders nodes, empty/custom empty option, value change, fetch on mount, loading/error states, disabled prop.

#### Step 2.4: `VariantBuilder.test.tsx` (~15 test cases)

BasicsSection (inputs, switches, errors), OptionValuesSection (empty/select changes), DimensionsSection, PricesSection (price inputs, tax select, empty state), MediaSection.

#### Step 2.5: `ProductMediaManager.test.tsx` (~12 test cases)

Empty state, media grid rendering, default badge, set default, remove media, file size formatting.

#### Step 2.6: `PriceKindSettings.test.tsx` (~12 test cases)

Load data, create/edit/delete dialog flow, validation, search filter, Cmd+Enter shortcut, disabled code in edit mode.

#### Step 2.7: `CategoriesDataTable.test.tsx` (~10 test cases)

Render rows, feature-gated create button, search, delete with confirmation, tree indentation.

#### Step 2.8: `ProductCategorizeSection.test.tsx` (~10 test cases)

Three TagsInput fields, correct values, onChange handlers, error display.

### Phase 3: Integration Tests (Playwright)

**Goal:** Cover uncovered API routes and UI flows. Bring integration coverage from ~57% to near 100%. All tests follow the established patterns from TC-CAT-001 through TC-CAT-012.

**Conventions:**

- Files in `packages/core/src/modules/catalog/__integration__/`
- API-based fixture setup, cleanup in `finally` blocks
- Unique test data via `Date.now()` suffixes
- Login via `login(page, 'admin')` helper
- Source scenario linked in file header comment

#### Current Coverage Gaps

| API Route | Current Status | Gap |
| --- | --- | --- |
| `PUT /api/catalog/categories` | Not tested | No category edit test |
| `DELETE /api/catalog/categories` | Not tested | No category delete test |
| `GET/POST/PUT/DELETE /api/catalog/offers` | Not tested | No offer tests at all |
| `GET/PUT/DELETE /api/catalog/prices` | Partially tested | Only creation via variant form |
| `PUT/DELETE /api/catalog/option-schemas` | Not tested | No option schema lifecycle test |
| `GET /api/catalog/product-media` | Not tested | No media listing test |
| Duplicate SKU validation | Scenario defined, not tested | TC-CAT-002 only tests missing title |
| Advanced filtering | Scenario defined, not tested | TC-CAT-012 only tests name/SKU search |
| Soft-delete verification | Scenario defined, not tested | TC-CAT-004 only tests UI dialog |

#### Step 3.1: TC-CAT-013 — Category Edit and Delete

**File:** `packages/core/src/modules/catalog/__integration__/TC-CAT-013.spec.ts`

**Tests:**

- Create category via API fixture → navigate to edit page → update name → save → verify updated in list
- Create category via API fixture → delete via row action → confirm → verify removed from list
- Attempt to delete category with children → verify prevention or cascade behavior

**API coverage:** `PUT /api/catalog/categories`, `DELETE /api/catalog/categories`

#### Step 3.2: TC-CAT-014 — Offer CRUD Lifecycle

**File:** `packages/core/src/modules/catalog/__integration__/TC-CAT-014.spec.ts`

**Tests:**

- Create offer via API → verify in list
- Update offer title/dates → verify changes persist
- Delete offer → verify removed from list
- Create offer with invalid date range → verify validation error

**API coverage:** `GET/POST/PUT/DELETE /api/catalog/offers`

#### Step 3.3: TC-CAT-015 — Price Management

**File:** `packages/core/src/modules/catalog/__integration__/TC-CAT-015.spec.ts`

**Tests:**

- Create product + variant via API → add price via API → verify price listed
- Update price amount → verify updated value
- Delete price → verify removed
- Create price with zero amount → verify allowed
- Create price with negative amount → verify validation

**API coverage:** `GET/PUT/DELETE /api/catalog/prices`

#### Step 3.4: TC-CAT-016 — Option Schema Management

**File:** `packages/core/src/modules/catalog/__integration__/TC-CAT-016.spec.ts`

**Tests:**

- Create option schema via API → verify in list
- Update schema name and options → verify changes persist
- Delete option schema → verify removed
- Attempt to delete schema referenced by products → verify prevention

**API coverage:** `PUT/DELETE /api/catalog/option-schemas`

#### Step 3.5: TC-CAT-017 — Advanced Product Filtering

**File:** `packages/core/src/modules/catalog/__integration__/TC-CAT-017.spec.ts`

**Tests:**

- Create products in different categories → filter by category → verify correct results
- Create products with different tags → filter by tag → verify correct results
- Create active and inactive products → filter by status → verify correct results
- Combine category + status filters → verify intersection

**API coverage:** `GET /api/catalog/products` with filter params

#### Step 3.6: TC-CAT-018 — Duplicate SKU Validation

**File:** `packages/core/src/modules/catalog/__integration__/TC-CAT-018.spec.ts`

**Tests:**

- Create product with SKU via API → attempt create with same SKU → verify validation error
- Create variant with SKU → attempt create another variant with same SKU → verify error

**API coverage:** `POST /api/catalog/products` (validation), `POST /api/catalog/variants` (validation)

#### Step 3.7: TC-CAT-019 — Product Soft-Delete Verification

**File:** `packages/core/src/modules/catalog/__integration__/TC-CAT-019.spec.ts`

**Tests:**

- Create product with variants via API → delete product → verify product absent from list
- Verify variants are also soft-deleted (not visible in variant list)
- Verify product still accessible via direct API call with `includeDeleted` param (if supported)

**API coverage:** `DELETE /api/catalog/products` (cascade verification)

#### Step 3.8: TC-CAT-020 — Product Media Management

**File:** `packages/core/src/modules/catalog/__integration__/TC-CAT-020.spec.ts`

**Tests:**

- Create product → upload image via UI → verify media appears in gallery
- Set image as default → verify default badge
- Remove image → verify removed from gallery
- Verify `GET /api/catalog/product-media` returns correct items

**API coverage:** `GET /api/catalog/product-media`

#### Step 3.9: TC-CAT-021 — Product with Multiple Variants

**File:** `packages/core/src/modules/catalog/__integration__/TC-CAT-021.spec.ts`

**Tests:**

- Create product → add 3 variants with different SKUs and prices → verify all listed
- Edit second variant price → verify only that variant updated
- Delete one variant → verify remaining variants intact

**API coverage:** Full variant lifecycle with multiple variants

#### Step 3.10: TC-CAT-022 — Pricing Edge Cases

**File:** `packages/core/src/modules/catalog/__integration__/TC-CAT-022.spec.ts`

**Tests:**

- Create price with very high value (999999.99) → verify precision
- Create price with many decimal places → verify rounding behavior
- Create price kind with different display modes → verify correct formatting
- Duplicate price kind code → verify validation error

**API coverage:** `POST /api/catalog/prices` (edge cases), `POST /api/catalog/price-kinds` (validation)

### Phase 4: Fixture Helpers

**Goal:** Reduce boilerplate in integration tests by adding missing fixture helpers.

**File:** `packages/core/src/modules/core/__integration__/helpers/catalogFixtures.ts` (extend existing)

**New helpers:**

| Helper | Purpose |
| --- | --- |
| `createCategoryFixture(request, token, { name, parentId? })` | API-based category creation |
| `deleteCategoryIfExists(request, token, categoryId)` | Idempotent category cleanup |
| `createVariantFixture(request, token, productId, { name, sku })` | API-based variant creation |
| `deleteVariantIfExists(request, token, productId, variantId)` | Idempotent variant cleanup |
| `createOfferFixture(request, token, { title, productId, channelId })` | API-based offer creation |
| `deleteOfferIfExists(request, token, offerId)` | Idempotent offer cleanup |
| `createPriceKindFixture(request, token, { code, title })` | API-based price kind creation |
| `deletePriceKindIfExists(request, token, priceKindId)` | Idempotent price kind cleanup |

### File Manifest

| File | Action | Purpose |
| --- | --- | --- |
| `catalog/components/products/__tests__/productForm.test.ts` | Create | Pure logic tests |
| `catalog/components/products/__tests__/variantForm.test.ts` | Create | Pure logic tests |
| `catalog/lib/__tests__/categoryTree.test.ts` | Create | Pure logic tests |
| `catalog/components/products/__tests__/MetadataEditor.test.tsx` | Create | Component interaction tests |
| `catalog/components/categories/__tests__/CategorySlugFieldSync.test.tsx` | Create | Component interaction tests |
| `catalog/components/categories/__tests__/CategorySelect.test.tsx` | Create | Component interaction tests |
| `catalog/components/products/__tests__/VariantBuilder.test.tsx` | Create | Component interaction tests |
| `catalog/components/products/__tests__/ProductMediaManager.test.tsx` | Create | Component interaction tests |
| `catalog/components/__tests__/PriceKindSettings.test.tsx` | Create | Component interaction tests |
| `catalog/components/categories/__tests__/CategoriesDataTable.test.tsx` | Create | Component interaction tests |
| `catalog/components/products/__tests__/ProductCategorizeSection.test.tsx` | Create | Component interaction tests |
| `catalog/__integration__/TC-CAT-013.spec.ts` | Create | Category edit and delete |
| `catalog/__integration__/TC-CAT-014.spec.ts` | Create | Offer CRUD lifecycle |
| `catalog/__integration__/TC-CAT-015.spec.ts` | Create | Price management |
| `catalog/__integration__/TC-CAT-016.spec.ts` | Create | Option schema management |
| `catalog/__integration__/TC-CAT-017.spec.ts` | Create | Advanced product filtering |
| `catalog/__integration__/TC-CAT-018.spec.ts` | Create | Duplicate SKU validation |
| `catalog/__integration__/TC-CAT-019.spec.ts` | Create | Product soft-delete verification |
| `catalog/__integration__/TC-CAT-020.spec.ts` | Create | Product media management |
| `catalog/__integration__/TC-CAT-021.spec.ts` | Create | Multiple variants lifecycle |
| `catalog/__integration__/TC-CAT-022.spec.ts` | Create | Pricing edge cases |
| `core/__integration__/helpers/catalogFixtures.ts` | Modify | Add new fixture helpers |

All paths relative to `packages/core/src/modules/`.

### Testing Strategy

- **Phase 1 & 2**: `yarn test -- --filter=@open-mercato/core`
- **Phase 3**: `yarn test:integration` (requires running app or ephemeral environment)
- **Coverage check**: `yarn test:integration:coverage` (target: near 100% for catalog module)
- **Type check**: `yarn typecheck`
- **Lint**: `yarn lint`

## Risks & Impact Review

### Test Reliability

#### Mock Drift (Unit Tests)

- **Scenario**: Component APIs change but test mocks retain stale shapes, causing false positives
- **Severity**: Medium
- **Affected area**: Phase 2 component tests
- **Mitigation**: Tests import real types from source modules. TypeScript compilation catches shape mismatches.
- **Residual risk**: Mocked UI primitives may diverge from real behavior. Acceptable because integration tests cover real rendering.

#### Flaky Async Tests (Unit Tests)

- **Scenario**: `waitFor` timeouts or race conditions in component tests
- **Severity**: Low
- **Affected area**: Phase 2 tests using `mockResolvedValueOnce`
- **Mitigation**: Use deterministic mock return values. Follow established patterns from `ProductsDataTable.test.tsx`.
- **Residual risk**: Minimal — existing catalog tests prove the pattern is stable.

#### createLocalId Non-Determinism (Unit Tests)

- **Scenario**: Functions using `Math.random()` via `createLocalId()` produce non-deterministic IDs
- **Severity**: Low
- **Affected area**: Phase 1 tests for `createVariantDraft`, `buildOptionSchemaDefinition`
- **Mitigation**: Assert on structure, not exact ID values. Use `expect.any(String)`.
- **Residual risk**: None.

#### Integration Test Environment Stability

- **Scenario**: Integration tests fail due to app startup issues, database state, or port conflicts
- **Severity**: Medium
- **Affected area**: All Phase 3 tests
- **Mitigation**: Use ephemeral environment (`yarn test:integration:ephemeral`). API-based fixture setup with cleanup in `finally` blocks. Unique test data via `Date.now()`.
- **Residual risk**: Shared database state between tests if cleanup fails. Mitigated by unique naming.

#### Selector Fragility (Integration Tests)

- **Scenario**: UI element selectors break when component markup changes
- **Severity**: Medium
- **Affected area**: Phase 3 UI-based tests
- **Mitigation**: Use stable Playwright locators (`getByRole`, `getByLabel`, `getByText`). Avoid CSS selectors.
- **Residual risk**: Some tests may need `.first()` chaining for ambiguous labels. Document these as known fragile points.

### Data Integrity Failures

N/A — Unit tests do not modify persistent state. Integration tests create and clean up their own data.

### Cascading Failures & Side Effects

N/A — Unit tests are isolated. Integration tests use isolated fixture data.

### Tenant & Data Isolation Risks

- **Scenario**: Integration tests create data visible to other tests
- **Severity**: Low
- **Mitigation**: Unique `Date.now()` suffixes on all test data. Cleanup in `finally` blocks. Single worker execution.
- **Residual risk**: Orphaned test data if cleanup fails. Acceptable in ephemeral environments.

### Migration & Deployment Risks

N/A — No database or API changes. Test files are additive.

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
| --- | --- | --- | --- |
| root AGENTS.md | No `any` types | Compliant | Tests use typed mocks with `jest.Mock` casts |
| root AGENTS.md | Validate inputs with zod | Compliant | `productFormSchema` tests validate zod behavior |
| root AGENTS.md | Use `apiCall`/`readApiResultOrThrow` | Compliant | Unit tests mock these; integration tests use real app |
| root AGENTS.md | i18n: `useT()` client-side | Compliant | All component tests mock `useT` |
| root AGENTS.md | Test files in `__tests__/` | Compliant | Unit tests in `__tests__/`, integration in `__integration__/` |
| packages/core/AGENTS.md | Test naming conventions | Compliant | `*.test.ts`/`*.test.tsx` for unit, `TC-CAT-*.spec.ts` for integration |
| catalog/AGENTS.md | Use `selectBestPrice` for pricing | N/A | Tests mock pricing, don't implement it |
| .ai/qa/AGENTS.md | Integration tests self-contained | Compliant | All Phase 3 tests create own fixtures and clean up |
| .ai/qa/AGENTS.md | No hardcoded record IDs | Compliant | All tests use dynamic IDs from fixture creation |
| .ai/qa/AGENTS.md | Cleanup in finally blocks | Compliant | All fixture-based tests use `finally` for teardown |
| .ai/qa/AGENTS.md | No per-test timeout/retry overrides | Compliant | Relies on global Playwright config |

### Internal Consistency Check

| Check | Status | Notes |
| --- | --- | --- |
| Data models match API contracts | N/A | No data models or API changes |
| API contracts match UI/UX section | N/A | No API or UI changes |
| Risks cover all write operations | N/A | No write operations |
| Commands defined for all mutations | N/A | No mutations |
| Cache strategy covers all read APIs | N/A | No cache changes |
| Test file manifest matches implementation plan | Pass | All 22 files listed in both sections |
| Phase ordering is incrementally deliverable | Pass | Each phase is independently shippable |
| Integration tests cover all uncovered API routes | Pass | Phase 3 covers offers, prices, categories edit/delete, option schemas, media |

### Non-Compliant Items

None.

### Verdict

**Fully compliant** — Approved for implementation.

## Changelog

### 2026-02-20

- Initial specification (unit tests only)

### 2026-02-20 (v2)

- Renamed from SPEC-030 to SPEC-034 (SPEC-030 through SPEC-033 taken in upstream)
- Added Phase 3: Integration Tests (10 new Playwright test files, TC-CAT-013 through TC-CAT-022)
- Added Phase 4: Fixture Helpers (extend catalogFixtures.ts)
- Updated title from "Unit & UI Unit Tests" to "Test Coverage"
- Updated TLDR, Problem Statement, and Proposed Solution to reflect integration test scope
- Added API Contracts section documenting current vs. to-be-covered routes
- Added integration-specific risks (environment stability, selector fragility, tenant isolation)
- Updated compliance matrix with `.ai/qa/AGENTS.md` rules
