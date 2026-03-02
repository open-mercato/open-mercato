# SPEC-051: SonarQube - Code Duplication Reduction

## TLDR

**Key points**
- Target SonarQube duplication hotspots from scan on commit `5b9b8606` (develop, 2026-03-02) with a safety-first refactor.
- Keep only low/medium-risk deduplication in this spec. Defer high-risk cross-module command-set abstraction.
- Preserve all API paths, route exports (`GET`, `POST`, `PUT`, `DELETE`, `openApi`, `metadata`), command IDs, and event IDs.

**What changed in this revision**
- Removed global `packages/core/src/lib/*` helper placement from plan; all helpers are now in module-scoped paths or `packages/shared` when truly cross-cutting.
- Re-scoped risky command deduplication to a follow-up spec.
- Added explicit integration coverage matrix for affected API and UI paths.

## Overview

The SonarQube scan reports **14.4% duplication** across the repository. After excluding intentional duplication (app template mirror, generated artifacts, migration-style files), meaningful duplication remains in route handlers, dashboard widgets, and create/edit page form setup.

Not all duplication is equally safe to remove. Some repeated command files encode module-specific behavior (for example, customer deal linking and activity dictionary synchronization). This spec keeps only refactors that can be implemented without changing behavior or contract surfaces.

## Problem Statement

### High-confidence duplication
- Sales status routes (`order-statuses`, `payment-statuses`, `shipment-statuses`, `order-line-statuses`) are mostly structural duplicates.
- Sales line routes (`order-lines`, `quote-lines`) repeat large sections with route-specific differences.
- Sales dashboard widgets duplicate utility and route plumbing.
- Shipping/payment settings duplicate a common input renderer.
- Exchange-rate and scheduled-job create/edit pages duplicate field schemas, option loaders, and shared UI pieces.

### Duplication that is not safe to collapse in this pass
- Customers/staff/resources address, activity, and comment commands are similar but not behavior-equivalent.
- Customer commands include module-only behavior (deal scoping, parent resource resolution, dictionary sync) that is easy to break with a broad generic factory.

## Proposed Solution

Use a phased plan with strict boundaries:

1. Implement low-risk utility and UI helper extraction.
2. Implement route-level factories where wrappers remain thin and explicit.
3. Implement form-config extraction for create/edit pages while keeping mutation/data-loading flows separate.
4. Defer cross-module command-set factories to a dedicated follow-up spec with parity tests first.

### Scope Decisions

| Area | Decision | Reason |
|------|----------|--------|
| Sales status routes | In scope | High duplication, low behavior variance |
| Sales line routes | In scope with explicit per-route config | Similar structure but different projections and parent fields |
| Staff/resources activity API routes | In scope | Similar route scaffolding, no customer-specific deal logic |
| Dashboard widget API/client utilities | In scope | Mostly structural duplication |
| Provider field renderer extraction | In scope | Function is duplicated as-is |
| Exchange-rate form config extraction | In scope | Shared validation/options with separate create/update flow |
| Leave-request helpers | In scope (presentation helpers only) | Shared formatting/status helpers are safe |
| Scheduled-job form config extraction | In scope | Shared schema/options/payload editor are safe |
| Cross-module command-set factories (addresses/activities/comments) | Deferred | High behavior-divergence risk |

### Design Decisions

| Decision | Rationale |
|----------|-----------|
| Keep `normalizeAuthorUserId` in `packages/shared/src/lib/commands/helpers.ts` | Cross-cutting and domain-neutral, aligns with shared-package rules |
| Keep sales factories in `packages/core/src/modules/sales/lib/` | Sales-domain concern should stay in sales module |
| Put shared staff/resources activity-route helper in `packages/core/src/modules/entities/lib/` | Cross-module core helper without introducing `packages/core/src/lib` |
| Keep create/edit loaders and mutation calls in page files | Prevent accidental behavior drift in create vs edit logic |
| Preserve route file paths and exports | Required by auto-discovery and backward compatibility contract |
| Defer command-set factory work | Requires dedicated behavior-parity harness and separate migration plan |

## Architecture

No new module, entity, endpoint, or event surface is introduced.

Pattern used in this spec:
- Extract pure/shared internals into helper/factory files.
- Keep existing auto-discovered route/page files as thin wrappers with explicit config.
- Do not move or rename route/page files.

## Data Models

No data model changes.

## API Contracts

No API contract changes are planned:
- No route URL changes.
- No request/response schema changes.
- No command ID, feature ID, or event ID changes.

## Migration & Backward Compatibility

No migration is required.

Backward compatibility rules satisfied by design:
- Auto-discovery file conventions: unchanged.
- API route URLs: unchanged.
- Event IDs and payload contracts: unchanged.
- Widget injection spot IDs: unchanged.
- Import paths for public package surfaces: unchanged.

## Implementation Plan

### Phase 1: Utility and UI Extraction (Low Risk)

#### Step 1.1: Shared author normalization

Keep existing shared-helper plan:
- Modify `packages/shared/src/lib/commands/helpers.ts`:
  - Add `AUTHOR_UUID_REGEX`
  - Add `normalizeAuthorUserId(parsedAuthor, authSub)`

Adopt helper in command files:
- `packages/core/src/modules/customers/commands/activities.ts`
- `packages/core/src/modules/staff/commands/activities.ts`
- `packages/core/src/modules/resources/commands/activities.ts`
- `packages/core/src/modules/customers/commands/comments.ts`
- `packages/core/src/modules/staff/commands/comments.ts`
- `packages/core/src/modules/resources/commands/comments.ts`

#### Step 1.2: Dashboard widget client utilities

Create `packages/core/src/modules/sales/widgets/dashboard/shared.ts` with:
- `readString()`
- `toDateInputValue()`
- `openNativeDatePicker()`
- `formatAmount()`

Use in:
- `packages/core/src/modules/sales/widgets/dashboard/new-orders/widget.client.tsx`
- `packages/core/src/modules/sales/widgets/dashboard/new-quotes/widget.client.tsx`

#### Step 1.3: Shared provider field input

Create `packages/core/src/modules/sales/components/ProviderFieldInput.tsx`.

Use in:
- `packages/core/src/modules/sales/components/ShippingMethodsSettings.tsx`
- `packages/core/src/modules/sales/components/PaymentMethodsSettings.tsx`

Verification checkpoint:
- `yarn build:packages`
- `yarn lint`
- `yarn test`

### Phase 2: Route Factories (Medium Risk)

#### Step 2.1: Sales status dictionary route factory

Create `packages/core/src/modules/sales/lib/makeStatusDictionaryRoute.ts`.

Refactor wrappers only:
- `packages/core/src/modules/sales/api/order-statuses/route.ts`
- `packages/core/src/modules/sales/api/payment-statuses/route.ts`
- `packages/core/src/modules/sales/api/shipment-statuses/route.ts`
- `packages/core/src/modules/sales/api/order-line-statuses/route.ts`

#### Step 2.2: Sales line route factory

Create `packages/core/src/modules/sales/lib/makeSalesLineRoute.ts`.

Hard requirement for safety:
- Wrapper config must preserve route-specific projections and fields (including fields that are not shared between order and quote variants).

Refactor wrappers:
- `packages/core/src/modules/sales/api/order-lines/route.ts`
- `packages/core/src/modules/sales/api/quote-lines/route.ts`

#### Step 2.3: Staff/resources activity route helper

Create `packages/core/src/modules/entities/lib/makeActivityRoute.ts`.

Refactor wrappers:
- `packages/core/src/modules/staff/api/activities.ts`
- `packages/core/src/modules/resources/api/activities.ts`

#### Step 2.4: Dashboard widget route helper

Create `packages/core/src/modules/sales/widgets/dashboard/makeDashboardWidgetRoute.ts` with shared:
- organization/date context parsing
- cache key construction
- common filter scaffolding

Keep per-widget mapping and schema local in each route.

Refactor wrappers:
- `packages/core/src/modules/sales/api/dashboard/widgets/new-orders/route.ts`
- `packages/core/src/modules/sales/api/dashboard/widgets/new-quotes/route.ts`

Verification checkpoint:
- `yarn build:packages`
- `yarn lint`
- `yarn test`

### Phase 3: Create/Edit Form Config Extraction (Medium Risk)

#### Step 3.1: Exchange rates

Create `packages/core/src/modules/currencies/backend/exchange-rates/exchangeRateFormConfig.ts`:
- shared field groups
- shared `loadCurrencyOptions`
- shared validation helper

Keep these in page files:
- create page scope defaults (`organizationId`, `tenantId`)
- edit page record loading and update flow

Modify:
- `packages/core/src/modules/currencies/backend/exchange-rates/create/page.tsx`
- `packages/core/src/modules/currencies/backend/exchange-rates/[id]/page.tsx`

#### Step 3.2: Leave requests

Create `packages/core/src/modules/staff/backend/staff/leave-requests/leaveRequestHelpers.ts` with presentation helpers only:
- `resolveStatusVariant()`
- `formatDateLabel()`
- `formatDateRange()`

Do not extract accept/reject workflow handling.

Modify:
- `packages/core/src/modules/staff/backend/staff/leave-requests/[id]/page.tsx`
- `packages/core/src/modules/staff/backend/staff/my-leave-requests/[id]/page.tsx`

#### Step 3.3: Scheduled jobs

Create `packages/scheduler/src/modules/scheduler/backend/config/scheduled-jobs/scheduledJobFormConfig.ts`:
- shared schema/field config
- `loadTargetOptions`, `loadQueueOptions`, `loadCommandOptions`
- timezone option helper
- `PayloadJsonEditor`

Keep these in page files:
- create vs update mutation calls
- edit page loading/error handling

Modify:
- `packages/scheduler/src/modules/scheduler/backend/config/scheduled-jobs/new/page.tsx`
- `packages/scheduler/src/modules/scheduler/backend/config/scheduled-jobs/[id]/edit/page.tsx`

Verification checkpoint:
- `yarn build:packages`
- `yarn lint`
- `yarn test`

### Deferred (Follow-up Spec)

Out of scope for this spec:
- `makeAddressCommandSet`
- `makeActivityCommandSet`
- `makeCommentCommandSet`

A dedicated follow-up spec is required with:
- explicit behavior-parity matrix per module (customers/staff/resources)
- targeted integration coverage for deal-linking/dictionary side effects
- migration plan for command-level extraction order

## File Manifest

| File | Action | Phase | Purpose |
|------|--------|-------|---------|
| `packages/shared/src/lib/commands/helpers.ts` | Modify | 1 | Shared author normalization helper |
| `packages/core/src/modules/sales/widgets/dashboard/shared.ts` | Create | 1 | Shared dashboard widget client utilities |
| `packages/core/src/modules/sales/components/ProviderFieldInput.tsx` | Create | 1 | Shared field input renderer |
| `packages/core/src/modules/sales/components/ShippingMethodsSettings.tsx` | Modify | 1 | Use shared renderer |
| `packages/core/src/modules/sales/components/PaymentMethodsSettings.tsx` | Modify | 1 | Use shared renderer |
| `packages/core/src/modules/sales/lib/makeStatusDictionaryRoute.ts` | Create | 2 | Status route factory |
| `packages/core/src/modules/sales/api/order-statuses/route.ts` | Modify | 2 | Thin wrapper |
| `packages/core/src/modules/sales/api/payment-statuses/route.ts` | Modify | 2 | Thin wrapper |
| `packages/core/src/modules/sales/api/shipment-statuses/route.ts` | Modify | 2 | Thin wrapper |
| `packages/core/src/modules/sales/api/order-line-statuses/route.ts` | Modify | 2 | Thin wrapper |
| `packages/core/src/modules/sales/lib/makeSalesLineRoute.ts` | Create | 2 | Sales line route factory |
| `packages/core/src/modules/sales/api/order-lines/route.ts` | Modify | 2 | Thin wrapper |
| `packages/core/src/modules/sales/api/quote-lines/route.ts` | Modify | 2 | Thin wrapper |
| `packages/core/src/modules/entities/lib/makeActivityRoute.ts` | Create | 2 | Shared staff/resources activity route helper |
| `packages/core/src/modules/staff/api/activities.ts` | Modify | 2 | Thin wrapper |
| `packages/core/src/modules/resources/api/activities.ts` | Modify | 2 | Thin wrapper |
| `packages/core/src/modules/sales/widgets/dashboard/makeDashboardWidgetRoute.ts` | Create | 2 | Shared dashboard widget route helper |
| `packages/core/src/modules/sales/api/dashboard/widgets/new-orders/route.ts` | Modify | 2 | Thin wrapper |
| `packages/core/src/modules/sales/api/dashboard/widgets/new-quotes/route.ts` | Modify | 2 | Thin wrapper |
| `packages/core/src/modules/currencies/backend/exchange-rates/exchangeRateFormConfig.ts` | Create | 3 | Shared exchange-rate form config |
| `packages/core/src/modules/currencies/backend/exchange-rates/create/page.tsx` | Modify | 3 | Use shared config |
| `packages/core/src/modules/currencies/backend/exchange-rates/[id]/page.tsx` | Modify | 3 | Use shared config |
| `packages/core/src/modules/staff/backend/staff/leave-requests/leaveRequestHelpers.ts` | Create | 3 | Leave-request display helpers |
| `packages/core/src/modules/staff/backend/staff/leave-requests/[id]/page.tsx` | Modify | 3 | Use shared helpers |
| `packages/core/src/modules/staff/backend/staff/my-leave-requests/[id]/page.tsx` | Modify | 3 | Use shared helpers |
| `packages/scheduler/src/modules/scheduler/backend/config/scheduled-jobs/scheduledJobFormConfig.ts` | Create | 3 | Shared scheduled-job form config |
| `packages/scheduler/src/modules/scheduler/backend/config/scheduled-jobs/new/page.tsx` | Modify | 3 | Use shared config |
| `packages/scheduler/src/modules/scheduler/backend/config/scheduled-jobs/[id]/edit/page.tsx` | Modify | 3 | Use shared config |
| `packages/core/src/modules/customers/commands/activities.ts` | Modify | 1 | Use shared `normalizeAuthorUserId` |
| `packages/core/src/modules/staff/commands/activities.ts` | Modify | 1 | Use shared `normalizeAuthorUserId` |
| `packages/core/src/modules/resources/commands/activities.ts` | Modify | 1 | Use shared `normalizeAuthorUserId` |
| `packages/core/src/modules/customers/commands/comments.ts` | Modify | 1 | Use shared `normalizeAuthorUserId` |
| `packages/core/src/modules/staff/commands/comments.ts` | Modify | 1 | Use shared `normalizeAuthorUserId` |
| `packages/core/src/modules/resources/commands/comments.ts` | Modify | 1 | Use shared `normalizeAuthorUserId` |

## Testing Strategy

### Build and unit checks
- `yarn build:packages`
- `yarn lint`
- `yarn test`
- Add focused unit tests for each new factory/helper.
- Implement integration tests from the matrix in the same implementation change set.

### Integration Coverage Matrix

| Area | API paths | UI paths | Required coverage |
|------|-----------|----------|-------------------|
| Sales status routes | `/api/sales/order-statuses`, `/api/sales/order-line-statuses`, `/api/sales/shipment-statuses`, `/api/sales/payment-statuses` | Sales status settings UI (`/backend/sales/configuration`) | Extend existing sales integration tests to validate list/create/update/delete parity per status kind |
| Sales line routes | `/api/sales/order-lines`, `/api/sales/quote-lines` | Sales document detail/create flows (`/backend/sales/documents/*`) | Keep and extend quote/order line integration coverage (create/list/update/delete and filters) |
| Activity routes | `/api/staff/activities`, `/api/resources/activities` | Staff/resource detail pages using activities adapters | Add or extend integration coverage for list/create/update/delete parity and tenant/org scoping |
| Dashboard widgets | `/api/sales/dashboard/widgets/new-orders`, `/api/sales/dashboard/widgets/new-quotes` | Dashboard widgets rendering on backend dashboard | Keep existing route tests and add parity checks for date-range/custom range behavior |
| Exchange-rate form config | `/api/currencies/exchange-rates` | `/backend/exchange-rates/create`, `/backend/exchange-rates/[id]` | Run existing currency integration tests and add/extend UI flow coverage for create/edit validation parity |
| Leave-request helpers | `/api/staff/leave-requests`, `/api/staff/leave-requests/accept`, `/api/staff/leave-requests/reject` | `/backend/staff/leave-requests/[id]`, `/backend/staff/my-leave-requests/[id]` | Ensure manager and self-service detail flows are both covered |
| Scheduled-job form config | `/api/scheduler/jobs`, `/api/scheduler/targets` | `/backend/config/scheduled-jobs/new`, `/backend/config/scheduled-jobs/[id]/edit` | Add integration coverage for create/edit scheduled job flows and target/queue/command selectors |

### SonarQube verification
- Re-run SonarQube after Phase 3 and compare duplication metrics against baseline.

## Risks & Impact Review

### Risk: Behavior drift in route factories
- **Scenario**: Factory config misses a route-specific projection/filter and changes API behavior.
- **Severity**: Medium
- **Affected area**: Sales line/status routes, dashboard widget routes, staff/resources activities route.
- **Mitigation**: Keep wrappers explicit, add route-parity integration assertions per path.
- **Residual risk**: Low.

### Risk: UI create/edit flow drift after form extraction
- **Scenario**: Shared config accidentally pulls create-only or edit-only logic into the wrong flow.
- **Severity**: Medium
- **Affected area**: Exchange rates, scheduled jobs, leave-request detail pages.
- **Mitigation**: Keep data loading/mutation logic in page files; extract only shared fields/options/presentation helpers.
- **Residual risk**: Low.

### Risk: Scope creep into high-risk command abstractions
- **Scenario**: Implementation starts generic command-set refactor in this spec and breaks module-specific side effects.
- **Severity**: High
- **Affected area**: Customer/staff/resource command behavior.
- **Mitigation**: Explicitly out of scope in this spec; require follow-up spec before implementation.
- **Residual risk**: Low once scope control is enforced.

### Tenant and security impact
- No planned change to tenant/org scoping rules, auth guards, or permission checks.

### Migration/deployment impact
- No migration, no downtime requirement, no contract-version bump.

## Final Compliance Report - 2026-03-02

### Documentation Reviewed
- `README.md`
- `ARCHITECTURE.md`
- `BACKWARD_COMPATIBILITY.md`
- Root `AGENTS.md`
- `packages/core/AGENTS.md`
- `packages/shared/AGENTS.md`
- `packages/ui/AGENTS.md`
- `packages/ui/src/backend/AGENTS.md`
- `packages/core/src/modules/sales/AGENTS.md`
- `packages/core/src/modules/customers/AGENTS.md`
- `packages/core/src/modules/currencies/AGENTS.md`
- `.ai/specs/AGENTS.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| root AGENTS.md | Core features should live under `packages/<package>/src/modules/<module>/` | Compliant | Removed `packages/core/src/lib/*` from plan |
| root AGENTS.md | Shared package must stay domain-neutral | Compliant | Only author normalization helper in shared |
| root AGENTS.md | API routes must preserve `openApi` exports | Compliant | Thin-wrapper route approach keeps exports |
| root AGENTS.md | Write operations via command pattern | Compliant | No command pattern replacement in this spec |
| root AGENTS.md | Specs must include integration coverage for affected API/UI paths | Compliant | Added explicit integration matrix |
| root AGENTS.md + package guides | If module has no local AGENTS file, apply root/package-level rules | Compliant | Applied for staff/resources and scheduler paths in this scope |
| BACKWARD_COMPATIBILITY.md | Contract surfaces must not break | Compliant | No URL, event ID, feature ID, or export contract changes |

### Non-Compliant Items

None after this revision.

### Verdict

**Conditionally compliant and implementation-ready** for Phases 1-3.

Condition:
- Command-set factory work remains out of scope until a follow-up spec is approved.

## Changelog

### 2026-03-02
- Initial specification.
- Revised after safety/convention review:
  - removed risky cross-module command-set factory implementation from scope
  - corrected helper placement to module-scoped paths
  - added explicit integration coverage matrix and backward-compatibility section
