# Backend First Load Client First Sidebar

## TLDR
Move backend chrome resolution off the critical SSR path. Keep server-side authorization for the active page, but switch the backend sidebar and related chrome to a client-first bootstrap model that hydrates from a single backend chrome payload after first paint. Preserve final behavior, sidebar customization, injection support, and route/module loading semantics.

## Overview
The current backend first load does too much synchronous work in the backend layout. It resolves auth, locale, route metadata, sidebar entries, org-scoped RBAC checks, custom entity sidebar items, role and user sidebar preferences, and mounts multiple client-side chrome features that each perform additional data fetching. This delays first paint even though most of that work is only needed for navigation chrome, not for rendering the requested page content.

This spec reduces first-load latency by splitting concerns:
- The requested backend page remains server-authorized and server-rendered.
- The surrounding navigation shell becomes client-hydrated.
- Sidebar, settings/profile nav, injected menu visibility, and topbar action visibility are loaded from one shared bootstrap payload.
- Sidebar customization remains available and functionally unchanged.

## Problem Statement
Current first-load cost is concentrated in [`apps/mercato/src/app/(backend)/backend/layout.tsx`](/Users/piotrkarwatka/Projects/mercato-development-two/apps/mercato/src/app/(backend)/backend/layout.tsx), which currently:
- builds the full admin nav on the server for every backend request
- resolves org/tenant feature-check scope before nav filtering
- performs RBAC feature checks during nav assembly
- loads custom entities for sidebar display
- loads role-based sidebar defaults and user sidebar preferences
- computes settings/profile navigation on the server

There is also duplicated access work:
- [`apps/mercato/src/app/(backend)/backend/[...slug]/page.tsx`](/Users/piotrkarwatka/Projects/mercato-development-two/apps/mercato/src/app/(backend)/backend/[...slug]/page.tsx) separately resolves page-level `requireFeatures`
- client menu surfaces use [`useInjectedMenuItems`](/Users/piotrkarwatka/Projects/mercato-development-two/packages/ui/src/backend/injection/useInjectedMenuItems.ts), which repeats feature and role fetching per surface

There are currently 5 menu surfaces using independent injected-menu resolution:
- main sidebar
- settings sidebar
- profile sidebar
- topbar actions
- profile dropdown

The result is unnecessary SSR latency plus redundant client bootstrap calls.

## Proposed Solution
Adopt a client-first backend chrome model.

Server responsibilities:
- authenticate the request
- authorize the requested backend page
- resolve locale and lightweight shell props
- render page content immediately
- render a stable sidebar/topbar placeholder

Client responsibilities:
- fetch a single backend chrome bootstrap payload once after hydration
- populate main sidebar, settings/profile nav, profile dropdown, and topbar injected actions from shared data
- lazily initialize non-critical topbar widgets
- keep sidebar customization editing and persistence behavior unchanged

The sidebar remains behaviorally identical after hydration:
- same groups/items
- same route-derived visibility
- same injected menu support
- same sidebar customization result
- same custom entity entries
- same settings/profile navigation result

## Architecture
Introduce a single backend chrome bootstrap data flow.

### 1. Lightweight backend layout
Refactor [`apps/mercato/src/app/(backend)/backend/layout.tsx`](/Users/piotrkarwatka/Projects/mercato-development-two/apps/mercato/src/app/(backend)/backend/layout.tsx) so it no longer:
- calls `buildAdminNav()`
- runs feature-check fallback loops for nav construction
- queries custom entities for sidebar nav
- loads sidebar preferences on initial request
- computes settings/profile sections on the server

It should keep only:
- auth/session context needed by the shell
- locale/dictionary resolution
- path/current title/breadcrumb basics
- product/version/header shell props
- `PageInjectionBoundary`
- page content wrapper

### 2. Single chrome bootstrap endpoint
Reuse and extend [`packages/core/src/modules/auth/api/admin/nav.ts`](/Users/piotrkarwatka/Projects/mercato-development-two/packages/core/src/modules/auth/api/admin/nav.ts) as the single backend chrome payload endpoint.

It must return:
- `groups`
- `settingsSections`
- `settingsPathPrefixes`
- `profileSections`
- `profilePathPrefixes`
- `grantedFeatures`
- `roles`

It continues to apply:
- selected tenant/org scope
- route metadata filtering
- role-based sidebar defaults
- user sidebar preferences
- dynamic custom entity sidebar items

### 3. Shared backend chrome provider
Add a client provider in `packages/ui` that:
- fetches the bootstrap payload once
- caches it for the current route scope
- exposes shared data to `AppShell`, settings/profile section nav, `ProfileDropdown`, and injected menu hooks
- supports explicit refresh on scope changes and `om:refresh-sidebar`

### 4. AppShell becomes provider-driven
Refactor [`packages/ui/src/backend/AppShell.tsx`](/Users/piotrkarwatka/Projects/mercato-development-two/packages/ui/src/backend/AppShell.tsx) so the authoritative sidebar/settings/profile data comes from the shared provider rather than server-passed resolved nav.

Initial render:
- page content is visible
- sidebar/topbar chrome uses placeholders/skeletons
- no nav-blocking SSR work is required

Hydrated render:
- sidebar and section nav appear with final data
- customization mode continues to operate on the hydrated nav snapshot

### 5. Remove per-surface feature/role fetches
Refactor [`packages/ui/src/backend/injection/useInjectedMenuItems.ts`](/Users/piotrkarwatka/Projects/mercato-development-two/packages/ui/src/backend/injection/useInjectedMenuItems.ts) to stop calling:
- `/api/auth/feature-check`
- `/api/auth/profile`

Instead it must:
- consume `grantedFeatures` and `roles` from the shared backend chrome provider
- continue loading widget definitions per surface
- filter injected items locally against the provider-backed features/roles

### 6. Keep page authorization server-side
Do not move page authorization client-side.

[`apps/mercato/src/app/(backend)/backend/[...slug]/page.tsx`](/Users/piotrkarwatka/Projects/mercato-development-two/apps/mercato/src/app/(backend)/backend/[...slug]/page.tsx) must continue to enforce:
- `requireAuth`
- `requireRoles`
- `requireFeatures`

The optimization is for chrome rendering only, not access control.

### 7. Lazy non-critical header chrome
Defer initialization of:
- `GlobalSearchDialog`
- `AiAssistantIntegration`
- `NotificationBellWrapper`
- `MessagesIcon`
- `OrganizationSwitcher`

Use lightweight placeholders where needed. Final behavior remains unchanged after hydration.

### 8. Integration-test-safe hydration contract
Client-first chrome must preserve test stability for existing Playwright coverage.

Requirements:
- keep final sidebar, settings nav, profile nav, profile dropdown, and injected menu item `href` values unchanged
- keep existing stable menu item IDs, widget IDs, and test IDs unchanged wherever they already exist
- expose one deterministic backend chrome readiness marker for tests, for example a shell-level `data-testid` or equivalent ready attribute
- render placeholders in a stable container so hydration does not replace the surrounding shell structure unexpectedly
- avoid speculative SSR nav entries that could reorder or disappear during hydration
- ensure sidebar customization applies to the hydrated final nav snapshot without changing item/group identifiers

Testing guidance:
- integration tests that assert sidebar content should wait for the chrome readiness marker before asserting hydrated nav content
- integration tests must not rely on pre-hydration placeholder ordering
- tests that only verify page authorization or page content should continue to pass without waiting for sidebar hydration

## Data Models
No database schema changes.

New shared response type should be introduced for the bootstrap payload, for example:
- `BackendChromePayload`

It should contain:
- `groups`
- `settingsSections`
- `settingsPathPrefixes`
- `profileSections`
- `profilePathPrefixes`
- `grantedFeatures`
- `roles`

Existing sidebar preference schema remains unchanged.

## API Contracts
Extend `GET /api/auth/admin/nav` response instead of introducing a second bootstrap endpoint.

Contract additions:
- additive-only fields
- no renaming or removal of existing `groups`
- stable group/item IDs preserved
- settings/profile section data included in final response
- granted features and user roles included for injected menu filtering

Do not change:
- `PUT /api/auth/sidebar/preferences`
- `GET /api/auth/sidebar/preferences`

Those APIs must continue to support:
- reorder
- rename
- hide
- apply-to-roles
- reset behavior

## Risks & Impact Review
### Risk: Hydration mismatch between server placeholder and final client nav
Severity: Medium
Affected area: Backend shell UX
Mitigation: render stable placeholders only, not speculative nav content

### Risk: Client-first nav briefly hides available routes until bootstrap resolves
Severity: Medium
Affected area: perceived navigation availability
Mitigation: page content renders immediately; sidebar skeleton is acceptable by product decision

### Risk: Scope changes produce stale nav
Severity: High
Affected area: org/tenant-aware navigation correctness
Mitigation: provider refreshes on organization/tenant change events and `om:refresh-sidebar`

### Risk: injected menu behavior drifts from previous implementation
Severity: High
Affected area: UMES/menu injection contract
Mitigation: preserve existing widget-loading path and stable menu IDs; only centralize features/roles sourcing

### Risk: customization mode breaks for injected items
Severity: High
Affected area: sidebar customization
Mitigation: preserve current item/group IDs and apply customization only after merged hydrated nav snapshot is available

### Risk: duplicated RBAC/scope logic remains in multiple places
Severity: Medium
Affected area: performance and correctness
Mitigation: extract a shared scope-resolution helper used by page guard and nav/bootstrap endpoint

### Risk: existing integration tests become flaky after sidebar hydration moves client-side
Severity: High
Affected area: Playwright coverage for sidebar, settings nav, injected menu surfaces, and profile dropdown
Mitigation: provide a deterministic chrome readiness marker, preserve stable IDs/test IDs/hrefs, and update affected tests to wait for hydration where they assert chrome content

Residual risk:
- first paint improves, but total interactive chrome readiness still depends on one post-hydration bootstrap request

## Test Plan
- unit test `GET /api/auth/admin/nav` for scoped route filtering, custom entities, role defaults, and user preferences
- unit test additive response fields for settings/profile sections, granted features, and roles
- unit test `useInjectedMenuItems` to verify it uses provider data and no longer calls profile/feature-check endpoints
- component test `AppShell` initial placeholder render followed by hydrated final nav
- component test backend chrome readiness marker toggles only after shared payload is applied
- component test sidebar customization after hydration for reorder/rename/hide/reset
- integration test backend page first load: page content visible before nav hydration, final nav unchanged
- integration test existing sidebar-dependent flows remain stable when waiting on the chrome readiness marker before nav assertions
- integration test injected menu visibility across all 5 surfaces
- integration test org/tenant switch triggers bootstrap refresh and nav update
- regression test unauthorized backend pages remain denied server-side before client nav loads

## Final Compliance Report
- contract-surface impact: additive-only API response expansion on existing admin-nav endpoint
- no route URL changes
- no ACL feature ID changes
- no widget/menu surface ID changes
- no existing stable test IDs or hydrated menu `href` targets should be renamed or removed
- no sidebar preference schema changes
- no database migration required
- page authorization remains server-enforced
- menu injection and sidebar customization remain supported

## Changelog
- 2026-04-03: Initial draft for backend first-load optimization via client-first sidebar and shared backend chrome bootstrap
- 2026-04-03: Added integration-test stability requirements for client-hydrated backend chrome
