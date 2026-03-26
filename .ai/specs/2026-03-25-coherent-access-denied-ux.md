# Coherent Access Denied UX

| Field | Value |
|-------|-------|
| Status | Draft |
| Scope | OSS |
| Owner | UI / Auth / RBAC |
| Related Issues | [#1032](https://github.com/open-mercato/open-mercato/issues/1032), [#1031](https://github.com/open-mercato/open-mercato/issues/1031) |
| Related PRs | [#1065](https://github.com/open-mercato/open-mercato/pull/1065) (partial fix — employee wildcard permissions) |
| Related Guides | `packages/ui/AGENTS.md`, `packages/core/src/modules/auth/AGENTS.md`, `packages/core/AGENTS.md` |
| Related Specs | `2026-03-23-unified-record-not-found-ui-state.md` (sibling pattern for not-found states) |

## TLDR

Access denied behavior is inconsistent: some pages log the user out, some show empty data tables, some show Access Denied. This spec standardizes all three layers of access denial (page guard, API fetch, and component-level) into a coherent, predictable experience where the user is **never logged out** due to insufficient permissions, always sees a clear explanation, and is offered actionable recovery options.

## Overview

Issue [#1032](https://github.com/open-mercato/open-mercato/issues/1032) documents three classes of broken behavior when an Employee role user accesses restricted Settings sections:

1. **Logout instead of Access Denied** — Translations page causes logout
2. **Empty data table** — Scheduled Jobs shows an empty table with no error
3. **Correct Access Denied page** — some sections work correctly

The root causes span multiple layers:

| Layer | Problem | Impact |
|-------|---------|--------|
| Client fetch / query stack | Treats HTTP 403 as "re-authenticate" — redirects to `/login` | User is logged out |
| Page metadata | Some settings pages lack an explicit access guard (`requireFeatures` or `requireRoles`) | Page loads, API fails with 403 |
| Settings navigation | Built-in settings items lose access metadata during nav transforms | Navigation cannot stay coherent with page guards |
| DataTable / component level | No distinction between "empty data" and "access denied" | User sees empty table, thinks there's no data |

PR [#1065](https://github.com/open-mercato/open-mercato/pull/1065) partially addressed issue [#1031](https://github.com/open-mercato/open-mercato/issues/1031) by replacing employee wildcard permissions (`sales.*`, `catalog.*`, `customers.*`) with explicit feature lists, preventing `*.settings.manage` inheritance. This was necessary but not sufficient — the underlying UX bugs remain.

## Problem Statement

### Root Cause 1: 403 redirect behavior is implemented in multiple client layers

**Files:** `packages/ui/src/backend/utils/api.ts`, `packages/ui/src/theme/QueryProvider.tsx`

When an API returns HTTP 403, `apiFetch`:
1. Reads `requiredRoles`/`requiredFeatures` from the response body
2. If ACL hints are present, calls `redirectToForbiddenLogin()` (line 168–169)
3. `redirectToForbiddenLogin()` flashes "Insufficient permissions. Redirecting to login…" and navigates to `/login?requireFeature=...` (line 88–91)
4. This destroys the user's session — they are effectively logged out

Separately, `QueryProvider` still treats `ForbiddenError` and generic `status === 403` as a redirect signal. Fixing `apiFetch` alone is not sufficient; the full redirect pipeline must be updated.

**The fundamental error:** 403 means "you ARE authenticated but NOT authorized." The correct response is to surface a recoverable error state, not redirect to login. Only 401 (Unauthorized) should trigger session refresh.

### Root Cause 2: Some settings pages lack an explicit access guard

`/backend/config/translations` is the concrete bug report, but it is not the only page that needs review. The settings-page inventory relevant to this spec is:

| Page | Current Guard | Intended Guard |
|------|---------------|----------------|
| Translations | `requireAuth: true` | `requireFeatures: ['translations.manage_locales']` |
| API documentation | `requireAuth: true` | `requireRoles: ['superadmin']` until a dedicated `api_docs` ACL exists |
| Feature Toggles > Global | `requireAuth: true`, `requireRoles: ['superadmin']` | already explicit, keep as-is |
| Feature Toggles > Overrides | `requireAuth: true`, `requireRoles: ['superadmin']` | already explicit, keep as-is |

The underlying issue is not "missing `requireFeatures`" specifically. The issue is "missing explicit access guard." For settings pages, the guard may be `requireFeatures` or `requireRoles`.

### Root Cause 3: Settings navigation loses auth metadata and mixes filtering sources

Built-in settings items are already filtered once during server-side nav construction. The bug is that access metadata is later dropped when settings sections are derived from those entries, so the settings navigation no longer carries `requireFeatures` / `requireRoles` through its internal types and helpers.

This creates two problems:

1. The settings nav pipeline cannot reason about access rules consistently because built-in item metadata is lost during conversion
2. Introducing a second, client-side `/api/auth/feature-check` pass would be unsafe because that endpoint is not selected-organization aware, while page guards are

### Root Cause 4: No in-page "access denied" state for data components

When a page passes its page-level guard but an API call within the page returns 403 (because the API has stricter or different permission requirements), there is no standard pattern for showing "access denied" inside the page. The typical `useQuery` + `raiseCrudError` pattern either:
- Throws an unhandled error (breaking the page)
- Falls through to empty data (showing an empty DataTable with no explanation)

The issue is not in `DataTable` or `CrudForm` alone. The 403 is usually produced in host-level React Query hooks and page components, which currently have no shared helper for converting 403 errors into a dedicated access-denied state.

## Proposed Solution

Five phases, ordered by severity and user impact. The implementation is shared-first: fix the redirect stack, make page guards explicit, preserve access metadata in navigation, then migrate host pages to a standardized in-page forbidden state.

### Phase A: Remove 403 redirect side-effects across the full client stack

**Goal:** HTTP 403 never redirects or logs out the user. The user stays on the current page and receives a typed `ForbiddenError`.

**Changes to `packages/ui/src/backend/utils/api.ts`:**

1. Remove the `redirectToForbiddenLogin()` side effect from the 403 branch
2. Keep `ForbiddenError` as the typed 403 error
3. Keep the debug `console.warn`
4. Keep parsing `x-om-forbidden-redirect` for one minor version as a deprecated no-op bridge
5. Keep exporting `redirectToForbiddenLogin()` and `setAuthRedirectConfig()` for one minor version as deprecated compatibility bridges; both become no-op helpers after this change, not removed symbols

**Changes to `packages/ui/src/theme/QueryProvider.tsx`:**

1. Stop redirecting on `ForbiddenError`
2. Stop redirecting on generic `status === 403`
3. Keep 401 handling unchanged

**After this change:**
- 401 → `redirectToSessionRefresh()` (unchanged — correct behavior)
- 403 → `throw ForbiddenError(msg)` (no redirect, no logout, no query-cache redirect)

**Follow-up cleanup (same PR if low-cost, otherwise immediately after):**

- Remove unnecessary `x-om-forbidden-redirect: 0` headers from callers such as global search
- Remove direct `nativeFetch` 403 workarounds that only existed to bypass redirect-on-403 behavior

### Phase B: Add explicit access guards to all settings pages

**Goal:** Every non-`navHidden` settings page (`pageContext: 'settings'`) declares an explicit access guard so the server-side page router blocks access before the page renders.

**Inventory for this spec:**

| Page | Path | Current Guard | Required Guard |
|------|------|---------------|----------------|
| Translations | `/backend/config/translations` | `requireAuth: true` | + `requireFeatures: ['translations.manage_locales']` |
| API documentation | `/backend/docs` | `requireAuth: true` | + `requireRoles: ['superadmin']` |
| Feature toggles: Global | `/backend/feature-toggles/global` | `requireRoles: ['superadmin']` | keep existing explicit guard |
| Feature toggles: Overrides | `/backend/feature-toggles/overrides` | `requireRoles: ['superadmin']` | keep existing explicit guard |

The settings root (`/backend/settings`, `navHidden: true`) is a redirect page — it does not need `requireFeatures` since it immediately redirects to `/backend/config/system-status` which already has its own guard.

**Validation rule (CI-enforceable):** Every `page.meta.ts` with `pageContext: 'settings'` MUST declare at least one explicit access guard unless `navHidden: true`:

- `requireFeatures: [...]` with a non-empty array, or
- `requireRoles: [...]` with a non-empty array

This preserves legitimate role-only settings pages.

### Phase C: Make settings navigation reuse the same access model as page guards

**Goal:** Built-in settings navigation never exposes broader access than page guards, without introducing a second ACL source.

**Key decision:** This spec does **not** add a new client-side built-in settings filter based on `/api/auth/feature-check`. That endpoint is not selected-organization aware, while backend page guards are. The built-in settings navigation should continue to rely on the server-side nav build performed in backend layout.

**Implementation approach:**

1. Extend `AdminNavItem` to preserve `requireFeatures` and `requireRoles`
2. Copy those fields through `buildSettingsSections()`
3. Copy those fields through `convertToSectionNavGroups()`
4. Preserve them in `SectionNavItem`
5. Continue using the already-filtered server-side settings entries as the source of truth for built-in items
6. Keep injected menu item filtering in `useInjectedMenuItems()` unchanged for injected entries only

**Why preserve metadata if built-ins are already server-filtered?**

- It keeps the settings nav type model truthful
- It prevents future client-side wrappers from silently losing access rules
- It gives tests and later refactors access to the original guard metadata

### Phase D: Standardized in-page forbidden state for host queries

**Goal:** When a page loads successfully (user passed page-level guards) but an inner data query returns 403, the host page shows a dedicated access-denied state instead of an empty table or a broken page.

#### D1: Shared forbidden-error detection helper

Add a shared helper in `packages/ui/src/backend/utils/`:

```typescript
export function isForbiddenError(error: unknown): boolean
```

The helper returns `true` for:

- `error instanceof ForbiddenError`
- generic thrown errors with `status === 403`
- objects produced by `raiseCrudError(...)` that carry `status: 403`

This makes host pages independent from the exact thrown error class.

#### D2: DataTable remains presentational but gains an explicit forbidden state

Add additive props to `DataTable`:

```typescript
accessDenied?: boolean
accessDeniedMessage?: string
accessDeniedAction?: React.ReactNode
```

When `accessDenied` is true, `DataTable` renders `AccessDeniedMessage` instead of its empty state or generic error row.

#### D3: CrudForm remains presentational but gains an explicit forbidden state

Add additive props to `CrudForm`:

```typescript
accessDenied?: boolean
accessDeniedMessage?: string
accessDeniedAction?: React.ReactNode
```

`CrudForm` does not own record-fetching today. The host page or shared hook computes `accessDenied` and passes it in. When true, `CrudForm` renders `AccessDeniedMessage` instead of form fields and footer actions.

#### D4: Standard host-page pattern

```typescript
const query = useQuery(...)
const accessDenied = isForbiddenError(query.error)

if (isFormPage) {
  return (
    <CrudForm
      isLoading={query.isLoading}
      accessDenied={accessDenied}
      accessDeniedMessage={t('auth.accessDenied.dataMessage', 'You do not have permission to view this record.')}
      {...rest}
    />
  )
}

return (
  <DataTable
    isLoading={query.isLoading}
    accessDenied={accessDenied}
    error={accessDenied ? null : resolvedError}
    {...rest}
  />
)
```

#### D5: Initial migration inventory for this spec

The first migration wave covers the flows already exposed by the bug report and current shared examples:

- settings pages that fetch restricted data after render
- list pages that currently use `useQuery` + `raiseCrudError(...)` and pass results into `DataTable`
- record edit/detail pages that fetch with shared hooks and render `CrudForm`

This is intentionally shared-first. The spec does not require migrating every backend page in one PR, but the issue-reproducing pages must move in the initial implementation.

### Phase E: Enhanced `AccessDeniedMessage` with recovery actions

**Goal:** The Access Denied page/component offers actionable recovery options.

**Current state:** `AccessDeniedMessage` shows a shield icon, title, description, and a "Go to Dashboard" link.

**Enhanced version:**

```typescript
<AccessDeniedMessage
  label={t('auth.accessDenied.title', 'Access Denied')}
  description={t('auth.accessDenied.message', 'You do not have permission to view this page. Please contact your administrator.')}
  action={
    <div className="flex flex-col gap-2">
      <Link href="/backend">
        {t('auth.accessDenied.dashboard', 'Go to Dashboard')}
      </Link>
      <Link href="/login?redirect={currentPath}">
        {t('auth.accessDenied.switchUser', 'Sign in as a different user')}
      </Link>
    </div>
  }
/>
```

**Changes:**

1. Add "Sign in as a different user" link alongside "Go to Dashboard" in the page-level `renderAccessDenied()` function (`apps/mercato/src/app/(backend)/backend/[...slug]/page.tsx`)
2. The "Sign in as a different user" link navigates to `/login?redirect=<currentPath>` — this preserves the redirect so after re-login the user lands back on the intended page
3. This link is **not an automatic logout** — the user explicitly chooses to switch accounts
4. For component-level `AccessDeniedMessage` (DataTable/CrudForm 403), only show the message and description — no "Sign in as different user" link (the user is already authenticated; the issue is permission, not identity)
5. Mirror the same backend catch-all change in `packages/create-app/template/src/app/(backend)/backend/[...slug]/page.tsx` to keep scaffolded apps aligned with monorepo behavior
6. Add locale keys for `auth.accessDenied.switchUser` in all shipped auth locale files

## Architecture

### Affected Files

| File | Phase | Change |
|------|-------|--------|
| `packages/ui/src/backend/utils/api.ts` | A | Remove 403 redirect side effect, keep deprecated compatibility exports, keep `ForbiddenError` |
| `packages/ui/src/theme/QueryProvider.tsx` | A | Stop redirecting on 403 in query and mutation caches |
| `packages/core/src/modules/translations/backend/config/translations/page.meta.ts` | B | Add explicit `requireFeatures` |
| `packages/core/src/modules/api_docs/backend/docs/page.meta.ts` | B | Add explicit `requireRoles` |
| `packages/ui/src/backend/utils/nav.ts` | C | Preserve `requireFeatures` / `requireRoles` through settings nav transforms |
| `packages/ui/src/backend/section-page/types.ts` | C | Carry explicit access metadata in section nav item types |
| `packages/ui/src/backend/DataTable.tsx` | D | Add presentational access-denied state props |
| `packages/ui/src/backend/CrudForm.tsx` | D | Add presentational access-denied state props |
| `packages/ui/src/backend/utils/accessDenied.ts` (new) | D | Shared forbidden-error detection helper |
| Host pages and shared hooks using `useQuery` + `raiseCrudError(...)` | D | Convert 403s into explicit `accessDenied` state for DataTable / CrudForm |
| `apps/mercato/src/app/(backend)/backend/[...slug]/page.tsx` | E | Add "Sign in as different user" link to `renderAccessDenied()` |
| `packages/create-app/template/src/app/(backend)/backend/[...slug]/page.tsx` | E | Keep scaffolded app backend access-denied UX in sync |
| `packages/core/src/modules/auth/i18n/*.json` | E | Add `auth.accessDenied.switchUser` |

### Decision: No automatic logout on 403

The user explicitly requested: "we should not automatically log out the user." This is also the correct HTTP semantic:
- **401 Unauthorized** = no valid session → redirect to login (session refresh)
- **403 Forbidden** = valid session, insufficient permissions → show error, keep session

### Decision: Keep built-in settings navigation server-scoped

Built-in settings navigation continues to be derived from the server-side nav build in backend layout. This avoids introducing a second ACL source that is not selected-organization aware.

### Decision: "Sign in as different user" is opt-in navigation, not auto-redirect

The link to `/login?redirect=...` is a voluntary action. The user sees the Access Denied page first and can choose to:
1. Go to Dashboard (navigate away)
2. Sign in as a different user (explicit re-login)
3. Contact their administrator (described in the message text)

### Decision: DataTable and CrudForm stay presentational

This spec does not move record/list fetching into `DataTable` or `CrudForm`. Forbidden-state detection stays in host queries and shared hooks. The shared components only receive additive props for rendering the resulting state.

### Decision: Page guards remain the security boundary

Settings navigation is a UX affordance. The security boundary remains the server-side page guard. Phase C is about coherence, not authorization enforcement.

## Data Models

No database schema changes required. This spec only affects client-side UI behavior, page metadata declarations, and HTTP status code handling.

## API Contracts

### Existing contracts (unchanged)

- `POST /api/auth/feature-check` — batch feature check, returns `{ ok, granted, userId }`
- `GET /api/auth/profile` — returns user roles
- API route 403 response shape: `{ error: 'Forbidden', requiredFeatures?: string[], requiredRoles?: string[] }`

### New client-side contracts

| Contract | Type | Details |
|----------|------|---------|
| `isForbiddenError(error)` | Helper function | Returns `true` for 403-shaped errors from `ForbiddenError` or `raiseCrudError(...)` |
| `DataTable.accessDenied` | Prop (boolean) | When true, renders `AccessDeniedMessage` instead of empty/error state |
| `DataTable.accessDeniedMessage` | Prop (string, optional) | Custom message for the access denied state |
| `DataTable.accessDeniedAction` | Prop (`ReactNode`, optional) | Optional action slot for forbidden state |
| `CrudForm.accessDenied` | Prop (boolean) | When true, renders `AccessDeniedMessage` instead of form content |
| `CrudForm.accessDeniedMessage` | Prop (string, optional) | Custom message for the forbidden state |
| `CrudForm.accessDeniedAction` | Prop (`ReactNode`, optional) | Optional action slot for forbidden state |
| `ForbiddenError` | Error class | Existing typed 403 error; now the only shared 403 runtime path in `apiFetch` |
| `redirectToForbiddenLogin()` | Deprecated compatibility helper | Retained as exported no-op bridge for at least one minor version |

## Migration & Backward Compatibility

### Phase A impact

**Intentional behavioral change:** Code that previously observed an automatic 403 → login redirect will no longer see that redirect. This is the bug fix.

**Compatibility bridge:** `redirectToForbiddenLogin()` is not removed in this phase. It remains exported as a deprecated no-op helper for at least one minor version so existing imports continue to build.

**`setAuthRedirectConfig()` bridge:** This helper also remains exported as a deprecated no-op for the same bridge period because it only configured forbidden-login redirect behavior.

**`x-om-forbidden-redirect` header:** Currently used to opt-out of 403 redirect. After this change, it becomes a deprecated no-op bridge for at least one minor version. Existing callers continue working, but the header no longer changes behavior.

**`ForbiddenError` throw:** Preserved. Callers that catch `ForbiddenError` continue working.

### Phase B impact

**Explicit restriction where pages were under-guarded.** Adding `requireFeatures` / `requireRoles` to page metadata may block users who previously reached those pages accidentally. This is the intended fix.

### Phase C impact

**Type-only additive change.** Settings nav items gain preserved `requireFeatures` / `requireRoles` metadata. No existing item IDs or URLs change.

### Phase D impact

**New optional props on DataTable and CrudForm.** Existing consumers are unaffected because the props default to `undefined` / `false`.

### Phase E impact

**Additive.** New link added to existing backend page-level `renderAccessDenied()` output. No route paths change.

### BC Contract Surfaces Affected

| # | Surface | Classification | Impact |
|---|---------|---------------|--------|
| 2 | Type definitions (`AdminNavItem`, settings nav item types, `DataTableProps`, `CrudFormProps`) | STABLE | Additive only: new optional fields / props |
| 3 | Function signatures (`apiFetch`, deprecated redirect helpers) | STABLE | Behavioral fix plus deprecated bridge; no required params removed |
| 4 | Import paths | STABLE | Existing import path for `redirectToForbiddenLogin()` remains valid during bridge period |
| 7 | API route URLs | STABLE | No changes to API responses |

## Risks & Impact Review

| Risk | Severity | Area | Mitigation | Residual |
|------|----------|------|------------|----------|
| Phase A updates `apiFetch` but misses QueryProvider | High | Auth / UI | Change both `apiFetch` and `QueryProvider` in the same phase; add unit tests for both layers | Low |
| Removing `redirectToForbiddenLogin()` would break public imports | High | Backward compatibility | Keep the helper as a deprecated exported bridge for at least one minor version | Low |
| Built-in settings nav is re-filtered client-side using `/api/auth/feature-check` | High | RBAC scope | Do not add that second ACL source in this spec; keep built-ins server-scoped | None |
| Role-only settings pages get forced into `requireFeatures` | Medium | Auth | Validation rule allows either `requireFeatures` or `requireRoles` | Low |
| Existing employees lose access to Translations page after Phase B | Low | UX | This is the intended fix. Admins can grant `translations.manage_locales` to employees who need it. | None |
| DataTable / CrudForm forbidden props are ignored by existing consumers | None | UI | Props are additive and default to false | None |

## Phasing

| Phase | Priority | Scope | Effort |
|-------|----------|-------|--------|
| **A** | Critical | Remove 403 redirect side-effects from `apiFetch` and `QueryProvider`; keep deprecated bridges | Small |
| **B** | Critical | Add explicit access guards to all affected settings pages and codify the validation rule | Small |
| **C** | High | Preserve access metadata through settings nav transforms and keep built-ins server-scoped | Small |
| **D** | High | Add shared forbidden-state helper plus DataTable / CrudForm rendering props; migrate issue paths | Medium |
| **E** | Medium | Enhance backend page-level access denied UX and sync create-app template | Small |

Phases A and B should ship together as they fix the most visible user-facing bugs. Phases C–E can follow incrementally.

## Implementation Plan

### Phase A

1. Update `apiFetch` 403 handling to throw `ForbiddenError` without redirect side effects
2. Keep `redirectToForbiddenLogin()` and `setAuthRedirectConfig()` exported as deprecated no-op bridges
3. Update `QueryProvider` to ignore `ForbiddenError` / `status === 403`
4. Update unit tests in `packages/ui/src/backend/utils/__tests__/api.test.ts`
5. Add unit coverage for `QueryProvider` 401 vs 403 behavior

### Phase B

1. Add `requireFeatures: ['translations.manage_locales']` to the translations settings page
2. Add `requireRoles: ['superadmin']` to the API docs settings page
3. Verify role-only feature toggle settings pages stay unchanged and continue to satisfy the rule
4. Add a test or lint-style assertion that every non-`navHidden` settings page has either `requireFeatures` or `requireRoles`

### Phase C

1. Extend nav item types to preserve `requireFeatures` / `requireRoles`
2. Copy those fields through settings nav conversion helpers
3. Add nav helper tests that guard metadata survives conversion
4. Keep built-in settings filtering sourced from backend layout rather than adding a new client feature-check pass

### Phase D

1. Add `isForbiddenError(error)` helper and tests
2. Add additive `accessDenied*` props to `DataTable`
3. Add additive `accessDenied*` props to `CrudForm`
4. Migrate the pages involved in the reported bug and any shared example pages needed to prove the pattern
5. Add regression tests for list and form flows that now render access-denied states instead of empty/broken UIs

### Phase E

1. Add the "Sign in as a different user" link to the backend catch-all `renderAccessDenied()`
2. Mirror the same change in the create-app template backend catch-all
3. Add `auth.accessDenied.switchUser` locale keys
4. Add integration coverage for the page-level access denied action set

## Integration Test Coverage

### Phase A tests

| Test ID | Description | Path |
|---------|-------------|------|
| TC-ACL-001 | Employee accessing restricted API receives 403 but stays logged in (no redirect to `/login`) | `packages/core/src/modules/auth/__integration__/` |
| TC-ACL-002 | Employee accessing restricted settings page sees Access Denied message instead of logout | `packages/core/src/modules/auth/__integration__/` |

### Phase B tests

| Test ID | Description | Path |
|---------|-------------|------|
| TC-ACL-003 | Employee accessing `/backend/config/translations` sees Access Denied because the page guard blocks before inner API calls | `packages/core/src/modules/translations/__integration__/` |
| TC-ACL-004 | Employee does not see superadmin-only settings pages such as feature toggles and API docs | `packages/core/src/modules/auth/__integration__/` |

### Phase C tests

| Test ID | Description | Path |
|---------|-------------|------|
| TC-ACL-005 | Settings navigation preserves explicit access metadata while building sections from discovered routes | `packages/ui/src/backend/__tests__/` |

### Phase D tests

| Test ID | Description | Path |
|---------|-------------|------|
| TC-ACL-006 | Page with `DataTable` where an inner API returns 403 shows access denied state instead of empty table | `packages/ui/src/__integration__/` |
| TC-ACL-007 | Page with `CrudForm` backed by a restricted query shows access denied state instead of broken form | `packages/ui/src/__integration__/` |

### Phase E tests

| Test ID | Description | Path |
|---------|-------------|------|
| TC-ACL-008 | Backend Access Denied page shows both "Go to Dashboard" and "Sign in as different user" links | `packages/core/src/modules/auth/__integration__/` |

## Final Compliance Report

- [ ] No new `any` types introduced
- [ ] No direct ORM relationships between modules
- [ ] All inputs validated with Zod where applicable
- [ ] i18n: all user-facing strings use locale keys
- [ ] RBAC: declarative guards used for page metadata
- [ ] Backward compatibility: deprecated bridges preserved for 403 redirect helpers and headers
- [ ] Settings page validation rule allows either `requireFeatures` or `requireRoles`
- [ ] Built-in settings nav remains server-scoped; no selected-org-inaccurate client ACL pass introduced
- [ ] DataTable/CrudForm changes are optional props (no breaking changes)
- [ ] `apiFetch` and `QueryProvider` both stop redirecting on 403
- [ ] `apps/mercato` and `packages/create-app/template` backend catch-all pages stay aligned

## Changelog

| Date | Change |
|------|--------|
| 2026-03-25 | Initial draft — root cause analysis and five-phase solution |
| 2026-03-25 | Revised draft after pre-implementation analysis — added BC bridges, full settings guard inventory, server-scoped nav model, explicit in-page forbidden-state contract, and template parity requirements |
