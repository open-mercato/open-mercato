# Superadmin Users List Context Scope

## TLDR

**Key Points:**
- `/backend/users` must respect the tenant and organization selected in the topbar context switcher for superadmin sessions.
- Selecting "All organizations" shows all users in the selected tenant, while no selected tenant preserves the existing global superadmin view.

**Scope:**
- Read behavior for `GET /api/auth/users`.
- Existing users list UI, which already refetches on organization scope changes.
- Unit and integration coverage for selected tenant, selected organization, all organizations, explicit organization filters, and search.

**Concerns:**
- This is a tenant isolation and UX consistency fix; the route must not accidentally remove the superadmin global view when no tenant is selected.

## Overview

The users list currently behaves inconsistently for superadmins. The topbar can show a selected tenant and organization, and related filter options are scoped to that selection, but the rows returned by `/api/auth/users` remain global unless the table's own organization filter is applied.

The fix makes the users API use the same selected context source as the backend chrome: `om_selected_tenant` and `om_selected_org`. The route remains backward-compatible by keeping a global superadmin view when no selected tenant cookie exists.

**Market Reference:** Django Admin and mature multi-tenant SaaS consoles generally make the active tenant/workspace selector affect list data by default, with a separate explicit global/all mode. This spec follows that model and rejects an implicit global view under a scoped topbar because it hides the active data boundary from operators.

## Problem Statement

When a superadmin selects a tenant/organization from the topbar and opens `/backend/users`, the table can still show users from every tenant and organization. At the same time, the organization filter options can appear scoped to the selected context. This makes the page internally inconsistent and can mislead an operator about which tenant's users they are viewing.

## Proposed Solution

`GET /api/auth/users` will resolve the selected organization scope for superadmin requests when `om_selected_tenant` is present. The existing `resolveOrganizationScopeForRequest` helper provides tenant selection, selected organization, and descendant-aware `filterIds`.

| Decision | Rationale |
|----------|-----------|
| Scope rows from the API, not only the UI | Prevents exports, pagination, search, and direct API use from drifting from the page state. |
| Require selected tenant cookie before scoping superadmin reads | Preserves the existing global superadmin read when no tenant is selected. |
| Use `OrganizationScope.filterIds` for selected organizations | Matches existing descendant-aware organization scoping behavior. |

## User Stories / Use Cases

- **Superadmin** wants to select a tenant in the topbar so that `/backend/users` shows only that tenant's users.
- **Superadmin** wants to select an organization so that the users list narrows to that organization and its descendants.
- **Superadmin** wants to select all organizations in a tenant so that the list shows the whole tenant without cross-tenant rows.
- **Admin** wants the existing organization-specific users list behavior to remain unchanged.

## Architecture

The auth users route remains in `packages/core/src/modules/auth/api/users/route.ts`.

Read flow:

1. Authenticate the request with `getAuthFromRequest`.
2. Resolve superadmin status through existing RBAC loading.
3. For non-superadmin users, keep the current actor tenant filter.
4. For superadmin users with `om_selected_tenant`, call `resolveOrganizationScopeForRequest({ container, auth, request, tenantId })`.
5. Apply `tenantId` and descendant-aware `organizationId in filterIds` filters to the user query.
6. Apply explicit table filters (`organizationId`, `roleId`, `name`, `search`) as additional narrowing clauses.

No commands, events, subscribers, workers, or cache invalidation are introduced because this is a read-only behavior change.

## Data Models

No data model changes.

Existing fields used:

- `User.tenantId`
- `User.organizationId`
- `Organization.descendantIds` indirectly through `resolveOrganizationScopeForRequest`

## API Contracts

### List Users

- `GET /api/auth/users`
- Existing query params remain unchanged: `id`, `page`, `pageSize`, `search`, `name`, `organizationId`, `roleId`.
- Existing response shape remains unchanged: `{ items, total, totalPages, isSuperAdmin? }`.
- Behavior change:
  - superadmin + selected tenant filters by `tenantId`
  - superadmin + selected tenant + selected organization filters by `tenantId` and selected organization descendants
  - superadmin + selected tenant + `__all__` organization filters by `tenantId` only
  - superadmin without selected tenant remains global

## Internationalization (i18n)

No new user-facing strings.

## UI/UX

No structural UI changes. `/backend/users` already calls `useOrganizationScopeVersion()` and refetches when the selected topbar organization changes. The page's existing scoped organization filter options now match the API result set.

## Configuration

No env vars or tenant settings.

## Migration & Compatibility

No migration is required.

Compatibility:

- The API route URL, HTTP methods, and response fields remain stable.
- Explicit filters remain additive narrowing behavior.
- Superadmin global read remains available when no selected tenant cookie is present.
- OpenAPI copy is updated to describe effective selected scope instead of only "current tenant".

## Implementation Plan

### Phase 1: API Scope Fix

1. Import `getSelectedTenantFromRequest` and `resolveOrganizationScopeForRequest`.
2. Resolve `effectiveTenantId`, `effectiveSelectedOrganizationId`, and `effectiveOrganizationIds` before building query filters.
3. Apply tenant and organization scope filters before explicit table filters.
4. Use effective tenant scope for search token lookup and audit/custom-field scope fallbacks.
5. Update the OpenAPI GET description.

### Phase 2: Tests

1. Extend `users.route.test.ts` with selected tenant, selected org, all organizations, explicit organization, and search-token tenant tests.
2. Add Playwright integration coverage for scoped superadmin `/backend/users`.
3. Run targeted unit and integration checks.

## Risks & Impact Review

#### Cross-Tenant Data Leakage Remains
- **Scenario**: The users route ignores selected tenant cookies and keeps returning global rows under a scoped topbar.
- **Severity**: High
- **Affected area**: `GET /api/auth/users`, `/backend/users`, exports
- **Mitigation**: Apply tenant filtering in the API from the existing selected scope helper.
- **Residual risk**: Low; direct superadmin global access intentionally remains when no tenant is selected.

#### Over-Scoping Superadmin Global Workflows
- **Scenario**: The fix scopes every superadmin request by the actor's original tenant even when no selected tenant exists.
- **Severity**: Medium
- **Affected area**: Superadmin user administration
- **Mitigation**: Only apply selected-scope behavior when `om_selected_tenant` is present.
- **Residual risk**: Low; users can clear tenant selection to return to global view.

#### Search Results Drift From Row Scope
- **Scenario**: Search token lookup remains global while the final rows are tenant-scoped, causing confusing counts or unnecessary work.
- **Severity**: Medium
- **Affected area**: `/api/auth/users?search=...`
- **Mitigation**: Pass the effective tenant scope into search token lookup when selected.
- **Residual risk**: Low; final row query still enforces scope.

## Final Compliance Report — 2026-05-19

### AGENTS.md Files Reviewed
- `AGENTS.md` (root)
- `packages/core/AGENTS.md`
- `packages/core/src/modules/auth/AGENTS.md`
- `packages/ui/AGENTS.md`
- `BACKWARD_COMPATIBILITY.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| root AGENTS.md | Always filter by organization_id for tenant-scoped entities | Compliant | Selected organization uses `OrganizationScope.filterIds`; selected tenant uses `tenantId`. |
| packages/core/AGENTS.md | API routes MUST export `openApi` | Compliant | Existing `openApi` remains and description is updated. |
| packages/core/src/modules/auth/AGENTS.md | Use existing RBAC and superadmin semantics | Compliant | Existing superadmin detection remains; selected scope only narrows reads. |
| BACKWARD_COMPATIBILITY.md | API route URLs and response fields are stable | Compliant | No route or response-field removal. |
| packages/ui/AGENTS.md | Lists use DataTable | Compliant | Existing DataTable page remains unchanged. |

### Internal Consistency Check

| Check | Status | Notes |
|-------|--------|-------|
| Data models match API contracts | Pass | No schema changes. |
| API contracts match UI/UX section | Pass | Existing UI refetches on scope changes and API now scopes rows. |
| Risks cover all write operations | Pass | No writes added. |
| Commands defined for all mutations | Pass | N/A, read-only change. |
| Cache strategy covers all read APIs | Pass | No route cache introduced. |

### Non-Compliant Items

None.

### Verdict

Fully compliant: Approved — ready for implementation.

## Changelog

### 2026-05-19
- Initial specification.
