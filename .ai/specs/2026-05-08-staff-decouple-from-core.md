# Staff Decouple from Core (Spec)

## TLDR

**Key Points:**
- Remove every `import { ... } from '@open-mercato/core/modules/staff/...'` in non-staff core modules so `packages/core` builds without `staff`. Two coupling sites on `upstream/develop`: [`customers/api/assignable-staff/route.ts`](../../packages/core/src/modules/customers/api/assignable-staff/route.ts) and [`planner/api/access.ts`](../../packages/core/src/modules/planner/api/access.ts).
- Approach: relocate the staff-owned logic into the `staff` module; expose a narrow Awilix-DI service (`availabilityAccessResolver`) for the planner consumer; ship a staff-owned route for the customers consumer with a `308 Permanent Redirect` from the legacy URL. RBAC features on the new staff route are **preserved customer-driven** — identical to the legacy route — so the redirect is invisible to clients and no ACL seeding changes.
- Staff stays at `packages/core/src/modules/staff/` after this spec — the physical extraction to `@open-mercato/staff` in [official-modules](https://github.com/open-mercato/official-modules) is a separate downstream spec.

**Scope:**
- Move [`customers/api/assignable-staff/route.ts`](../../packages/core/src/modules/customers/api/assignable-staff/route.ts) handler logic into a new staff route at `staff/api/team-members/assignable/route.ts`. Legacy URL keeps responding with `308` for ≥1 minor version.
- Move [`planner/api/access.ts`](../../packages/core/src/modules/planner/api/access.ts) staff-member lookup into `staff/lib/availabilityAccess.ts`. Planner consumes via Awilix DI with `allowUnregistered: true` (fail-soft when staff is absent).
- Add a minimal `packages/core/src/modules/staff/AGENTS.md` declaring `availabilityAccessResolver` as a public DI contract surface; future contributors MUST follow the `BACKWARD_COMPATIBILITY.md` deprecation protocol before removing or renaming it.
- `RELEASE_NOTES.md` deprecation entry for `GET /api/customers/assignable-staff`.

**Out of Scope:**
- Dashboards/widgets coupling that only appears once PR [#1111](https://github.com/open-mercato/open-mercato/pull/1111) merges — covered by a follow-up spec written after #1111 lands.
- String nav references (`'staff.nav.group'` in `auth/api/admin/nav.ts`, `apps/mercato/src/app/(backend)/backend/layout.tsx`, and the `create-app/template` equivalent) and test fixtures referencing `staff.*` features — deferred to the Phase 3 (delete-staff-from-core) spec because they do not break TypeScript compilation when staff is absent.
- Physical extraction of staff to `@open-mercato/staff` (Phase 2, separate spec in the [official-modules](https://github.com/open-mercato/official-modules) repo).
- ACL feature ID changes — `staff.my_availability.*` stay as-is; only the constants' usage moves.

**Concerns:**
- DI resolver fail-soft semantics MUST be explicit: when `staff` is absent, planner availability writes return `403` with a dedicated error code (`staff_module_not_loaded`) and a one-line warn log — never silently denied.
- The customers consumer UI MUST be migrated off the legacy URL inside this PR; the redirect exists to protect external/uncatalogued consumers, not in-tree code.
- Tenant-scoping arguments (`tenantId`, `organizationId`) MUST be byte-copied into the moved code paths; review MUST diff the scope arguments line-by-line to prevent cross-tenant leakage during the relocate.

---

## Overview

The core team [decided in PR #1111 comments](https://github.com/open-mercato/open-mercato/pull/1111) to extract `staff` from `@open-mercato/core` into `@open-mercato/staff` published from [open-mercato/official-modules](https://github.com/open-mercato/official-modules). Reasons cited: (1) staff is business-case oriented and not essential to the platform core; (2) publishing it under `official-modules` increases visibility for the original authoring agency.

This spec is **Phase 1** of a three-phase migration:
- **Phase 1 (this spec)** — decouple core modules from `staff` so staff can be removed without leaving dangling imports. Staff stays at `packages/core/src/modules/staff/`.
- **Phase 2 (separate spec, in the `official-modules` repo)** — create `@open-mercato/staff`; copy code; verify in sandbox.
- **Phase 3 (separate spec, in this repo)** — delete `packages/core/src/modules/staff/`; wire the app to consume `@open-mercato/staff` from npm; clean up out-of-scope string references and test fixtures.

> **Market Reference**: Module decoupling via DI service registration with fail-soft consumers follows the same architectural shape as the implemented [decouple-module-setup spec](./implemented/SPEC-013-2026-01-27-decouple-module-setup.md), which decoupled `setup-app.ts` from optional modules using the `setup.ts` convention plus `try/catch` dynamic imports. Medusa's plugin model and Saleor's app-extension model use a similar "modules register narrow contracts; core consumes via DI" pattern. We adopt the DI-resolver convention from that prior work, plus the redirect-with-deprecation pattern from `BACKWARD_COMPATIBILITY.md` surface #7.

---

## Problem Statement

### Coupling Site 1 — `customers/api/assignable-staff/route.ts`

[Source — line 9 on `upstream/develop`](../../packages/core/src/modules/customers/api/assignable-staff/route.ts):

```ts
import { StaffTeam, StaffTeamMember } from '@open-mercato/core/modules/staff/data/entities'
```

The route lists active staff team members linked to auth users so customer-side flows (e.g., assigning an account manager to a deal) can populate an "assignable staff" picker. It calls `findWithDecryption(em, StaffTeamMember, ...)` and `findWithDecryption(em, StaffTeam, ...)` directly. Authoring history: introduced as part of CRM customer-roles work. The data is conceptually staff-owned — the route lives under `customers/api/` only because that is where its consumer UI was originally built.

The legacy route's RBAC layering:
- Page-level guard (Next.js `metadata.GET.requireFeatures`): `customers.roles.view`
- Handler-level extra check inside `canAccessAssignableStaff`: `customers.roles.manage` OR `customers.activities.manage`

**Why it blocks staff extraction**: removing `staff` from core leaves the import dangling and breaks the build of any app that does not install `@open-mercato/staff`.

### Coupling Site 2 — `planner/api/access.ts`

[Source — line 7](../../packages/core/src/modules/planner/api/access.ts):

```ts
import { StaffTeamMember } from '@open-mercato/core/modules/staff/data/entities'
```

Plus references to two staff-owned ACL features at lines 27–28:

```ts
const SELF_MANAGE_FEATURE = 'staff.my_availability.manage'
const SELF_UNAVAILABILITY_FEATURE = 'staff.my_availability.unavailability'
```

The function `resolveAvailabilityWriteAccess` (≈90 lines) discovers the `StaffTeamMember` row for the authenticated user so planner availability routes can enforce self-scope ("only edit your own availability"). The companion `assertAvailabilityWriteAccess` in the same file calls it directly and is consumed by every planner availability write route. `MANAGE_AVAILABILITY_FEATURE = 'planner.manage_availability'` stays planner-owned — only the two `staff.my_availability.*` constants and the entity import are staff-owned. Authored in commit `4b28faf312` (2026-01-22) as part of the original Resources & Planning feature.

**Why it blocks staff extraction**: same as Site 1 — direct entity import; same compile-time failure mode if staff is missing.

### Pre-existing Module Metadata (acknowledged but not modified in this spec)

`packages/core/src/modules/staff/index.ts` line 12 declares `requires: ['planner', 'resources']` — staff hard-depends on planner today via the module registry. This spec **does not** change that declaration. The dependency direction stays asymmetric:

- `staff/index.ts` declares `requires: ['planner', ...]` — staff will not load if planner is missing.
- `planner/api/access.ts` will soft-resolve `availabilityAccessResolver` from staff via DI with `allowUnregistered: true` — planner gracefully degrades if staff is missing.

This is intentional for Phase 1: removing the `requires: ['planner', ...]` declaration is a Phase 2/3 concern (it becomes a peer-dependency declaration in the future `@open-mercato/staff` npm package, which then must be reconciled with the runtime fact that the planner-side staff lookup now lives inside staff). Phase 1.C Step 1 verifies the `requires` line still matches reality after the refactor.

### Out-of-Scope String References (Phase 3 cleanup)

These do not break TypeScript compilation when staff is absent and are deferred:

| Location | Type |
|----------|------|
| `packages/core/src/modules/auth/api/admin/nav.ts` line 257 | string `'staff.nav.group'` |
| `apps/mercato/src/app/(backend)/backend/layout.tsx` line 239 | same string |
| `packages/create-app/template/src/app/(backend)/backend/layout.tsx` line 239 | same string |
| `packages/core/src/__tests__/module-decoupling.test.ts` | test fixture features `staff.*` |
| `packages/core/src/modules/auth/__tests__/cli-setup-acl.test.ts` | same |
| `packages/core/src/modules/planner/__integration__/TC-PLAN-003.spec.ts` line 10 | imports staff fixture helper from `packages/core/src/helpers/integration/staffFixtures.ts` (re-exported via `packages/core/src/modules/core/__integration__/helpers/staffFixtures.ts`; test-only) |

---

## Proposed Solution

### Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Decouple direction | Move logic into `staff`, not the other way | Once staff is external, core MUST NOT depend on it. Staff is allowed to depend on core (`@open-mercato/core` becomes its peer dep). |
| Cross-module data access | Awilix DI-registered narrow services + module-owned routes | Domain logic ("look up staff member by user") belongs in staff. Consumers either call staff routes or resolve a DI service that staff registers. |
| Generic helper in `@open-mercato/shared`? | Rejected | `packages/shared/AGENTS.md` MUST rule: shared MUST NOT add domain-specific logic. `resolveStaffMemberByUserId` is staff domain. |
| Backward compatibility for `/api/customers/assignable-staff` | `308 Permanent Redirect` to new staff URL; kept ≥1 minor version | URL stability per `BACKWARD_COMPATIBILITY.md` surface #7. |
| Planner refactor strategy | Extract `resolveAvailabilityWriteAccess` into staff; planner keeps a thin wrapper that consumes via DI | Smallest blast radius; preserves all planner URLs and the public function signature so internal callers (`assertAvailabilityWriteAccess` and every availability write route) do not change. |
| New staff route RBAC | Preserve customer-driven features identically (`customers.roles.view` page guard + `customers.roles.manage` OR `customers.activities.manage` handler check) | Q1 = Option A. Redirect is invisible to clients; zero ACL changes; no `staff/setup.ts` role-feature seeding required; smallest migration risk. |
| DI resolver fail-soft behavior | Return null/undefined when staff is absent; consumer logs warn and responds with `403 staff_module_not_loaded` | Predictable error; on-call detection via standard error logging. |
| Public DI key documentation | Add a minimal `staff/AGENTS.md` listing `availabilityAccessResolver` as a public contract surface | Future contributors must apply the `BACKWARD_COMPATIBILITY.md` deprecation protocol before renaming or removing it. |

### Alternatives Considered

| Alternative | Why Rejected |
|-------------|--------------|
| Lazy `import()` of staff entities in core | Hides the coupling; build-time type checking still requires staff present. |
| Generic `staff_member` table or interface in `@open-mercato/shared` | Domain leak into shared. Defeats modularity. Violates `packages/shared/AGENTS.md` MUST rule "shared MUST NOT add domain-specific logic." |
| Event-based RPC (planner asks staff via sync event) | Sync events are not the established pattern in this codebase. Adds latency + complexity for negligible gain. |
| Move all "self availability" routes from planner into staff | Larger blast radius — touches planner URLs (BC surface #7), affects multiple route files, harder to review. |
| Switch the new staff route's RBAC to a staff-driven feature (Option B from skeleton) | Adds a new feature ID + `staff/setup.ts` role-feature seeding + role updates for any in-tree role expecting access; risks regressions on customer flows that currently rely on `customers.roles.manage`. Q1 = Option A keeps the change zero-ACL. |
| Leave coupling in place; ship staff as a fork inside `official-modules` | Defeats the "modules MUST use UMES extension points" rule of `official-modules`. Staff would not be installable as a true npm package. |

---

## User Stories / Use Cases

| Actor | Action | Outcome |
|-------|--------|---------|
| **Downstream app developer** consuming `/api/customers/assignable-staff` | Calls the legacy URL | Receives `308` redirect to `/api/staff/team-members/assignable`; HTTP client follows; response shape identical to before |
| **Module developer** preparing `@open-mercato/staff` for `official-modules` | Greps `packages/core/src/modules/` for `from '@open-mercato/core/modules/staff'` excluding the staff folder itself | Returns zero matches |
| **Non-admin staff user** opening "My Availability" in the planner | UI calls planner availability routes | Routes resolve `availabilityAccessResolver` via DI, get the user's staff member id, enforce self-scope; behavior identical to pre-refactor |
| **App maintainer** disabling staff in `apps/mercato/src/modules.ts` to test module isolation | Boots the app | App boot does not crash; planner availability writes return `403 staff_module_not_loaded`; customers UI's assignable-staff picker shows an empty list; no other module affected |
| **On-call engineer** investigating a `403` regression on availability edits after this lands | Greps logs for `staff_module_not_loaded` | Sees the dedicated error code and immediately knows whether the regression is caused by staff being unregistered (deployment/config issue) vs an ACL issue |
| **Reviewer** auditing the PR | Runs the decouple grep proof from Phase 1.C | Sees zero matches outside the staff folder, confirming the decouple is complete |

---

## Architecture

### Module-File Changes

| File | Action | Module |
|------|--------|--------|
| `packages/core/src/modules/staff/api/team-members/assignable/route.ts` | **NEW** — handler moved from customers; preserves Zod schema, RBAC, response shape, OpenAPI doc | staff |
| `packages/core/src/modules/staff/lib/availabilityAccess.ts` | **NEW** — `resolveAvailabilityWriteAccess` and the two `SELF_*` feature constants moved from planner | staff |
| `packages/core/src/modules/staff/di.ts` | **NEW** — register `availabilityAccessResolver` (asValue). The file does not exist on `upstream/develop`; staff currently has no `di.ts`. The new file MUST follow the same shape as `customers/di.ts` / `planner/di.ts`: `export function register(container: AppContainer)` typed via `import type { AppContainer } from '@open-mercato/shared/lib/di/container'`. After creation, run `yarn generate` to verify the auto-discovery picks it up; if the generated module index does not include the new registrar, update the relevant generator plugin or the bootstrap wiring under `apps/mercato/src/bootstrap.ts`. | staff |
| `packages/core/src/modules/staff/AGENTS.md` | **NEW** — minimal guide; documents `availabilityAccessResolver` as a public DI contract surface | staff |
| `packages/core/src/modules/customers/api/assignable-staff/route.ts` | **MODIFY** — replace handler body with `308` redirect; delete staff entity imports; keep page guard `customers.roles.view`; mark `openApi.deprecated: true` | customers |
| `packages/core/src/modules/customers/api/assignable-staff/__tests__/route.test.ts` | **MODIFY** — assert legacy URL returns `308` with the `Location` header pointing at the new URL and the original query string preserved | customers |
| `packages/core/src/modules/planner/api/access.ts` | **MODIFY** — delete `StaffTeamMember` and `findOneWithDecryption` imports; delete the two `SELF_*` constants; replace `resolveAvailabilityWriteAccess` body with a thin DI wrapper that calls `availabilityAccessResolver` (returns fail-soft `403 staff_module_not_loaded` shape when unregistered) | planner |
| `packages/core/src/modules/staff/__integration__/TC-STAFF-NNN-assignable.spec.ts` | **NEW** — integration test for the new staff route (smoke list, search, RBAC denied without features, paging) | staff |
| `packages/core/src/modules/planner/__integration__/TC-PLAN-NNN-availability-fail-soft.spec.ts` | **NEW** — integration test asserting `availabilityAccessResolver` unregistered yields `403 staff_module_not_loaded` from planner availability writes | planner |
| `RELEASE_NOTES.md` | **MODIFY** — add Deprecations entry for `GET /api/customers/assignable-staff` | repo root |

No new modules. No `requires` field changes in any `ModuleInfo`. Staff remains optional.

### DI Service Contract — `availabilityAccessResolver`

Staff registers in a **new** `packages/core/src/modules/staff/di.ts` (the file does not exist on `upstream/develop` — staff has never had a DI registrar before this spec):

```ts
import { asValue } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { resolveAvailabilityWriteAccess } from './lib/availabilityAccess'

export function register(container: AppContainer) {
  container.register({
    availabilityAccessResolver: asValue({ resolveAvailabilityWriteAccess }),
  })
}
```

Pattern matches the existing `customers/di.ts` and `planner/di.ts`. Type alias `AppContainer` (an `AwilixContainer` re-export) comes from `@open-mercato/shared/lib/di/container`.

Planner consumes via [`packages/core/src/modules/planner/api/access.ts`](../../packages/core/src/modules/planner/api/access.ts) using **`allowUnregistered: true`** (returns `undefined` instead of throwing). The fail-soft branch returns the same `AvailabilityWriteAccess` shape with an additive sentinel field `unregistered: true` so the existing `assertAvailabilityWriteAccess` chokepoint can distinguish "module not loaded" from "ACL denied":

```ts
type AvailabilityAccessResolver = {
  resolveAvailabilityWriteAccess(ctx: AvailabilityAccessContext): Promise<AvailabilityWriteAccess>
}

export type AvailabilityWriteAccess = {
  canManageAll: boolean
  canManageSelf: boolean
  canManageUnavailability: boolean
  memberId: string | null
  tenantId: string | null
  organizationId: string | null
  unregistered?: boolean // additive; only true when staff DI is absent (BC surface #2 — optional field is non-breaking)
}

export async function resolveAvailabilityWriteAccess(ctx: AvailabilityAccessContext): Promise<AvailabilityWriteAccess> {
  const resolver = ctx.container.resolve<AvailabilityAccessResolver | undefined>(
    'availabilityAccessResolver',
    { allowUnregistered: true },
  )
  if (!resolver) {
    console.warn('[planner] staff_module_not_loaded — availabilityAccessResolver unregistered; denying availability write access')
    return {
      canManageAll: false,
      canManageSelf: false,
      canManageUnavailability: false,
      memberId: null,
      tenantId: ctx.auth?.tenantId ?? null,
      organizationId: ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null,
      unregistered: true,
    }
  }
  return resolver.resolveAvailabilityWriteAccess(ctx)
}
```

The wrapper keeps the public function signature identical so `assertAvailabilityWriteAccess` and every internal planner caller compile unchanged.

`assertAvailabilityWriteAccess` is the only chokepoint that planner write routes use (verified by reading `planner/api/access.ts` on `upstream/develop`). Its body is updated at exactly one branch: when the resolved `access.unregistered === true`, throw `CrudHttpError(403, { error: 'staff_module_not_loaded' })` instead of the generic `buildForbiddenError(translate)` path. All other `assertAvailabilityWriteAccess` branches remain byte-identical. No other route handler needs to change.

The `unregistered?: boolean` field is **additive** to `AvailabilityWriteAccess` and therefore non-breaking under `BACKWARD_COMPATIBILITY.md` surface #2 (type definitions — optional field additions are allowed).

### New Staff Route — `/api/staff/team-members/assignable`

Auto-discovered via the existing convention `api/<METHOD>/<path>.ts → /api/<path>` documented in `packages/core/AGENTS.md`. Mirrors the existing customers handler byte-for-byte except for module-internal imports (entities resolved relative to the staff module path):

- Same Zod query schema (`page`, `pageSize` ≤ 100, `search`).
- Same item schema (`AssignableStaff` shape with `displayName`, `email`, `teamName`, etc.).
- Same RBAC features: page guard `customers.roles.view`; handler check `customers.roles.manage` OR `customers.activities.manage`.
- Same i18n keys (`customers.errors.organization_required`, `customers.assignableStaff.forbidden`) — keys are global, staff resolves them via `resolveTranslations()` without owning the namespace.
- Same response: `{ items: AssignableStaff[]; total: number; page: number; pageSize: number }`.
- Same encryption: `findWithDecryption(em, StaffTeamMember, ...)` and `findWithDecryption(em, StaffTeam, ...)` with full `{ tenantId, organizationId }` scope. Note: `StaffTeam` and `StaffTeamMember` are NOT in `staff/encryption.ts` `defaultEncryptionMaps` (only `staff:staff_leave_request` is). `findWithDecryption` is preserved as a forward-compatibility wrapper but performs no decryption today on these entities. No encryption map changes in this spec; if PII fields on `StaffTeamMember` (e.g., `displayName`, `description`) need encryption, that's a separate spec.
- New OpenAPI tag: `Staff` (per module ownership).

**Why staff and not customers?** Per [`packages/core/src/modules/customers/AGENTS.md`](../../packages/core/src/modules/customers/AGENTS.md): "Customers is the reference CRUD module for customer entities (people, companies, deals)." The data returned is staff team members, not customer entities. Architectural ownership belongs in staff. RBAC stays customer-driven (Q1 = A) because the access policy is "who within customers can pick an assignable staff member" — a customer-side concern.

### Customers Redirect — `/api/customers/assignable-staff`

[`packages/core/src/modules/customers/api/assignable-staff/route.ts`](../../packages/core/src/modules/customers/api/assignable-staff/route.ts) becomes:

```ts
import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['customers.roles.view'] },
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const newUrl = new URL('/api/staff/team-members/assignable', url.origin)
  newUrl.search = url.search
  return NextResponse.redirect(newUrl, 308)
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Customers',
  deprecated: true,
  summary: 'Assignable staff candidates (DEPRECATED — redirects to /api/staff/team-members/assignable)',
  // ...preserved description, queryParams, responses
}
```

`308 Permanent Redirect` (not `301`) preserves the HTTP method across redirect chains — the standards-conforming choice for a permanent move even on `GET`-only routes. The query string is preserved verbatim.

### Staff `AGENTS.md` (New)

A minimal guide at `packages/core/src/modules/staff/AGENTS.md` that:
- States staff is optional and may be extracted to `@open-mercato/staff` in a future release.
- Lists `availabilityAccessResolver` (DI key, contract shape) as a public surface — MUST follow `BACKWARD_COMPATIBILITY.md` surface #9 deprecation protocol before rename/removal.
- Notes that `StaffTeam`, `StaffTeamMember` entities are NOT public; consumers MUST go through staff routes or DI services.

### Commands & Events

No new commands. No new events. No event ID changes.

---

## Data Models

No data model changes. No migrations. No new tables, columns, or indexes.

---

## API Contracts

### New Route — `GET /api/staff/team-members/assignable`

Identical to existing `/api/customers/assignable-staff` to preserve consumer compatibility.

| Field | Detail |
|-------|--------|
| Auth | `requireAuth: true` |
| Page-level features | `customers.roles.view` (page guard, identical to legacy route) |
| Handler-level features (any-of) | `customers.roles.manage` OR `customers.activities.manage` |
| Query schema | `{ page: number(min 1, default 1), pageSize: number(min 1, max 100, default 24), search: string? }` (zod, identical to current customers schema) |
| Response | `{ items: AssignableStaff[]; total: number; page: number; pageSize: number }` (item schema identical to legacy) |
| Errors | `400 organization_required`, `401 unauthorized`, `403 forbidden`, `500 load_failed` |
| OpenAPI tag | `Staff` |
| `pageSize` cap | 100 (preserved from legacy) |
| Tenant scoping | All queries filtered by `{ tenantId, organizationId }` (preserved byte-for-byte) |
| Encryption | Uses `findWithDecryption(em, StaffTeamMember, ...)` and `findWithDecryption(em, StaffTeam, ...)` (preserved) |
| i18n | Reuses existing `customers.errors.*` and `customers.assignableStaff.*` keys via `resolveTranslations()` — no new keys |

### Modified Route — `GET /api/customers/assignable-staff`

| Field | Detail |
|-------|--------|
| Behavior | Returns `308 Permanent Redirect` to `/api/staff/team-members/assignable` preserving query string |
| Deprecation | `openApi.deprecated: true` set; summary marked `(DEPRECATED — ...)` |
| Lifespan | Stays for ≥1 minor version — removable no earlier than the 0.6.0 release (assuming this redirect ships in 0.5.x). The Phase 3 spec re-confirms the target release at scheduling time. Removal scheduled with the Phase 3 spec. |
| Auth | Page guard unchanged — `customers.roles.view` (the redirect itself is gated; the new URL re-enforces handler-level checks) |

### Unchanged Routes

All planner availability routes keep their URL, request schema, and response shape. Internal handler swap is invisible to clients.

---

## Internationalization (i18n)

No new i18n keys. The redirect path returns no body. The new staff route reuses the existing `customers.errors.*` and `customers.assignableStaff.*` keys via `resolveTranslations()` to keep error message UX identical for clients following the redirect or calling the new URL directly.

The planner fail-soft branch logs `[planner] staff_module_not_loaded` (English-only operational log, not user-facing). The error response body uses `{ error: 'staff_module_not_loaded' }` as a stable error code — clients render this via existing `planner.availability.errors.unauthorized` translation key OR via a new optional `planner.availability.errors.staff_module_not_loaded` key (fallback to the existing unauthorized message if absent — non-breaking).

---

## UI / UX

No new UI. Customer-side UI consumers of `/api/customers/assignable-staff` MUST be inventoried during Phase 1.A Step 2 and updated in-tree to call `/api/staff/team-members/assignable` directly. The redirect is a safety net for external/uncatalogued consumers, not the preferred path for in-tree code.

---

## Configuration

None. No new env vars. No new feature toggles.

---

## Migration & Backward Compatibility

### Contract Surfaces Affected

Per [`BACKWARD_COMPATIBILITY.md`](../../BACKWARD_COMPATIBILITY.md):

| # | Surface | Rule | Compliance |
|---|---------|------|------------|
| 3 | Function signatures | STABLE | ✅ — `resolveAvailabilityWriteAccess` exported signature unchanged when planner thin wrapper replaces the body |
| 4 | Import paths | STABLE — moved modules MUST re-export from old path | ✅ — `planner/api/access.ts` keeps the same export name (`resolveAvailabilityWriteAccess`); internal planner callers do not change. Staff entities now consumed via DI, not direct import. |
| 7 | API route URLs | STABLE — cannot rename/remove without migration | ✅ — `/api/customers/assignable-staff` retained as `308` redirect for ≥1 minor version |
| 9 | DI service names | STABLE — cannot rename registration keys | ✅ — new key `availabilityAccessResolver`; no existing keys removed; documented in new `staff/AGENTS.md` as a public contract |
| 10 | ACL feature IDs | FROZEN | ✅ — no feature IDs change. `staff.my_availability.*` still exists in `staff/acl.ts`; just stops being referenced as constants by planner code |

### Compatibility Rules

1. `/api/customers/assignable-staff` MUST keep returning the same status family (2xx after redirect-follow) and JSON shape during the redirect window.
2. Planner availability route URLs and JSON contracts MUST NOT change. Internal handler swap is invisible to clients.
3. No new `requires` declarations are added to non-staff modules' `index.ts` `ModuleInfo`. Staff remains optional. The DI resolver pattern is the contract.
4. `RELEASE_NOTES.md` MUST list the customers redirect as a deprecation in the next minor release (Phase 1.C Step 2).
5. `availabilityAccessResolver` MUST be documented in `staff/AGENTS.md` as a public DI surface so future contributors apply the deprecation protocol before changing it.

### Rollout Strategy

- Single PR (this spec) merges to `develop`. No runtime feature flag — DI resolver pattern is invisible to clients.
- `RELEASE_NOTES.md` deprecation entry added in the same PR.
- Phase 3 (delete staff from core) only proceeds AFTER `@open-mercato/staff` is published in `official-modules` AND verified in sandbox.

### Sequencing with PR #1111 (Timesheets)

Both this spec's PR and the in-review PR #1111 (timesheets) target `upstream/develop`. PR #1111 introduces a third staff coupling site in dashboards. Sequencing matters:

- **If PR #1111 merges first**: re-run the Phase 1.C Step 1 grep on the rebased branch. The dashboards file will appear as a new match. Action: do NOT expand this spec's scope to cover dashboards — instead, document the new match in the PR description as "expected; covered by follow-up dashboards-decouple spec opening immediately after this PR merges". The `grep -vE '__tests__|__integration__'` filter does not exclude the dashboards production file, so the grep reviewer must visually confirm the match maps to the documented out-of-scope file.
- **If this spec's PR merges first**: PR #1111 must rebase. The timesheets author SHOULD adopt the new DI-resolver pattern instead of re-introducing inline `StaffTeamMember` imports in dashboards. Coordinate via PR #1111 review comments at rebase time.
- **If both PRs are reviewed concurrently**: this spec's PR is the smaller and more reviewable change. Land it first when both are approved.

---

## Implementation Plan

Single PR off `upstream/develop`. Branch name: `feat/staff-decouple-from-core`. Phases delineate logical batches; each phase ends with a passing verification gate. Commits within a phase MAY be squashed at merge — the "phase boundary" is the testable unit, not the commit boundary.

### Phase 1.A — Move customers/assignable-staff to staff

**Step 1**: Create `packages/core/src/modules/staff/api/team-members/assignable/route.ts` with handler logic byte-copied from current customers route. Resolve `findWithDecryption`, `RbacService` type, `User`, `StaffTeam`, `StaffTeamMember` imports relative to the staff module path. Same Zod schema, same response shape, same OpenAPI doc, same RBAC features (`customers.roles.view` page guard + `customers.roles.manage`/`customers.activities.manage` handler check), same `pageSize` cap of 100. OpenAPI tag set to `Staff`.

**Step 2**: Inventory all in-tree consumers of `/api/customers/assignable-staff`:

```bash
grep -rn 'customers/assignable-staff' packages/ apps/ \
  | grep -v node_modules | grep -v dist | grep -v '\.mercato/generated'
```

Known callsites at the time of spec writing (re-run the grep on the rebased branch to refresh):
- **Production**: `packages/core/src/modules/customers/components/detail/assignableStaff.ts:39` — UI fetcher. MUST be updated to `/api/staff/team-members/assignable`.
- **Tests**: `packages/core/src/modules/customers/api/assignable-staff/__tests__/route.test.ts` (lines 81, 117), `packages/core/src/modules/customers/components/detail/__tests__/AssignRoleDialog.test.tsx:171`, `packages/core/src/modules/customers/__integration__/TC-CRM-038.spec.ts:50`.

Split the matches into two groups in the PR description:
- **Production callsites** (UI components, fetchers, server-side handlers, etc.) — update to call `/api/staff/team-members/assignable` directly. The redirect is a safety net for external consumers, not in-tree code.
- **Test callsites** (`__tests__/`, `__integration__/`, `.spec.ts`) — leave on the legacy URL only when the test deliberately asserts redirect behavior. Otherwise update to the new URL.

Document both lists separately so the reviewer can verify the distinction.

**Step 3**: Replace [`packages/core/src/modules/customers/api/assignable-staff/route.ts`](../../packages/core/src/modules/customers/api/assignable-staff/route.ts) handler body with the `308` redirect (see Architecture section). Mark `openApi.deprecated: true`. Keep page guard `requireFeatures: ['customers.roles.view']`.

**Step 4**: Add `TC-STAFF-NNN-assignable.spec.ts` integration test against the new route — smoke list, paging, search, RBAC-denied without `customers.roles.manage`/`customers.activities.manage`, identical response shape.

**Step 5**: Update `customers/api/assignable-staff/__tests__/route.test.ts` (or replace) to assert the legacy URL returns `308` with `Location` pointing at `/api/staff/team-members/assignable` and the original query string preserved verbatim. Add a follow-the-redirect assertion confirming the resulting body matches the legacy expectation.

**Verification gate (Step 6)**:

```bash
yarn lint && yarn build:packages && yarn test:integration --grep "assignable"
```

Plus manual smoke: open Customers → Person/Deal → assignable-staff drawer; confirm list renders unchanged.

### Phase 1.B — Move planner staff lookup to staff (DI resolver)

**Step 1**: Create `packages/core/src/modules/staff/lib/availabilityAccess.ts` exporting `resolveAvailabilityWriteAccess` (logic byte-copied from current planner version) plus the two `SELF_*` feature constants. Imports `StaffTeamMember`, `findOneWithDecryption`, `RbacService` type relative to staff module. Exports `AvailabilityAccessContext` and `AvailabilityWriteAccess` types — the latter extended with a new optional `unregistered?: boolean` field per the Architecture section (additive, BC-safe under surface #2).

**Step 2**: **Create** `packages/core/src/modules/staff/di.ts` (file does not exist on `upstream/develop`). Export `register(container: AppContainer)` that calls `container.register({ availabilityAccessResolver: asValue({ resolveAvailabilityWriteAccess }) })`. Type alias from `@open-mercato/shared/lib/di/container`. Before writing the planner wrapper, **verify the installed Awilix version supports `{ allowUnregistered: true }`** (the option exists since Awilix 4.x). Check the resolved version at the root `package.json` and `packages/core/package.json`; if the version is below 4.0, the planner wrapper MUST fall back to a `try/catch` around `container.resolve('availabilityAccessResolver')` returning `undefined` on `AwilixResolutionError`. Run `yarn generate` after creating `di.ts`; the existing `di.generated.ts` aggregator auto-discovers module `di.ts` files (verified at `apps/mercato/src/bootstrap.ts` import of `diRegistrars`), so no bootstrap edit is expected. Add an explicit smoke test in `staff/__integration__/` that asserts `container.hasRegistration('availabilityAccessResolver') === true` when staff is enabled.

**Step 3**: Modify [`packages/core/src/modules/planner/api/access.ts`](../../packages/core/src/modules/planner/api/access.ts):
- Delete `import { StaffTeamMember } from '@open-mercato/core/modules/staff/data/entities'`.
- Delete `import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'` (no longer used after the function moves).
- Delete the two `staff.my_availability.*` constants — they were referenced only by `resolveAvailabilityWriteAccess` which now lives in staff.
- Add `unregistered?: boolean` to the local `AvailabilityWriteAccess` type (mirrors the shape exported from staff).
- Replace `resolveAvailabilityWriteAccess`'s body with the thin DI wrapper from the Architecture section using `container.resolve(..., { allowUnregistered: true })`. The wrapper sets `unregistered: true` on the returned shape when the resolver is absent.
- Update `assertAvailabilityWriteAccess` at exactly one branch: when `access.unregistered === true`, throw `CrudHttpError(403, { error: 'staff_module_not_loaded' })`. All other branches remain byte-identical. `MANAGE_AVAILABILITY_FEATURE = 'planner.manage_availability'` (verified at `planner/acl.ts:3`) remains unchanged.
- No other planner route handler is touched — they all call into `assertAvailabilityWriteAccess`.

**Step 4**: Add `TC-PLAN-NNN-availability-fail-soft.spec.ts`. Test mechanism: a **unit test against the wrapper function in isolation**, NOT a full integration boot. Pass a mock container `{ resolve: <T>(name: string, opts?: ResolveOptions) => name === 'availabilityAccessResolver' && opts?.allowUnregistered ? undefined : throw new Error('unexpected resolve') }`. Assert: (a) returned access shape has `unregistered: true` and all booleans false; (b) calling `assertAvailabilityWriteAccess` against the returned shape throws `CrudHttpError(403, { error: 'staff_module_not_loaded' })`; (c) console.warn was called with the expected log line. Rationale: the existing test infrastructure boots the full app container with all modules registered; there is no documented "test container with module X excluded" mechanism today, and adding one is out of scope. A unit test on the wrapper is sufficient to lock the fail-soft contract.

**Verification gate (Step 5)**:

```bash
yarn lint && yarn build:packages && yarn test:integration --grep "TC-PLAN"
```

Plus manual smoke: as a non-admin staff user, open My Availability — edit own (allowed), attempt to edit another member (denied). Re-disable `staff` in `apps/mercato/src/modules.ts`, rebuild, repeat — expect `403 staff_module_not_loaded`. Re-enable.

### Phase 1.C — Final decouple verification + deprecation note + staff AGENTS.md

**Step 1**: Run the decouple proof against production source files (test files are excluded — fixtures referencing staff are deferred to Phase 3 cleanup per the Out-of-Scope section):

```bash
grep -rn "@open-mercato/core/modules/staff" packages/core/src/modules/ \
  | grep -v "/staff/" \
  | grep -vE '__tests__|__integration__'
```

MUST return zero matches. Also re-verify that `staff/index.ts` line 12 still declares `requires: ['planner', 'resources']` — the spec does not change that declaration, but the file MUST still be intact after the refactor (sanity check).

**Step 2**: Add `RELEASE_NOTES.md` entry under "Deprecations" for the next minor release:

> `GET /api/customers/assignable-staff` is deprecated. Migrate clients to `GET /api/staff/team-members/assignable`. The legacy URL returns `308 Permanent Redirect` and will be removed in a future major release.

**Step 3**: Create `packages/core/src/modules/staff/AGENTS.md` listing:
- Module status (optional; planned extraction to `@open-mercato/staff`).
- Public DI contract surfaces — `availabilityAccessResolver` with the `AvailabilityAccessContext` and `AvailabilityWriteAccess` shapes; deprecation protocol reference.
- Internal-only entities (`StaffTeam`, `StaffTeamMember`) — consumers MUST go through staff routes or DI services.

**Step 4**: Open PR against `upstream/develop` with a description that includes (a) the consumer inventory from Phase 1.A Step 2, (b) the decouple grep proof from Phase 1.C Step 1, (c) link to this spec, (d) link to Piotr's approval comment on PR #1111: <https://github.com/open-mercato/open-mercato/pull/1111#issuecomment-4354394013> (2026-04-30).

### Testing Strategy

| Test | Type | Asserts |
|------|------|---------|
| `TC-STAFF-NNN-assignable.spec.ts` | Integration | New `/api/staff/team-members/assignable` returns same items as legacy URL did; paging, search, RBAC denied without features |
| Updated `customers/api/assignable-staff/__tests__/route.test.ts` | Integration | Old URL returns `308`; `Location` header points at new URL with query string preserved; following redirect yields same body |
| `TC-PLAN-NNN-availability-fail-soft.spec.ts` | Integration | When `availabilityAccessResolver` is unregistered, planner availability writes return `403 staff_module_not_loaded` with the dedicated log line |
| `TC-PLAN-003` (existing) | Integration | Continues to pass — uses `staffFixtures` test helper (Phase 3 cleanup target, not this spec) |
| `module-decoupling.test.ts` (existing) | Unit | Continues to pass with staff registered |

---

## Risks & Impact Review

### Data Integrity Failures

No write operations are added or modified. Existing read paths preserve `findWithDecryption`/`findOneWithDecryption` semantics with byte-copied scope arguments. No data integrity risk introduced.

### Cascading Failures & Side Effects

#### Risk: PR #1111 merges with inline staff filter still in dashboards

- **Scenario**: PR #1111 lands in parallel with this spec's PR. The dashboards inline staff filter remains in the codebase. A follow-up dashboards-decouple spec then becomes necessary post-merge.
- **Severity**: Low
- **Affected area**: Dashboards self-scope filtering for timesheets widgets
- **Mitigation**: This spec is explicit that Phase 1 covers only customers + planner. The dashboards site is documented as out-of-scope. A separate spec is opened once PR #1111 lands.
- **Residual risk**: None — explicit scoping prevents accidental concurrent work.

#### Risk: `RELEASE_NOTES.md` deprecation entry missed

- **Scenario**: PR merges without the deprecation note. Downstream consumers don't notice the redirect until the route is removed in a future major.
- **Severity**: Medium
- **Affected area**: Downstream apps, `docs.openmercato.com`
- **Mitigation**: Phase 1.C Step 2 makes the entry mandatory. PR template's "Did you update RELEASE_NOTES?" checkbox catches the omission.
- **Residual risk**: Low — depends on PR review discipline.

### Tenant & Data Isolation Risks

#### Risk: Refactor accidentally widens tenant scope

- **Scenario**: When moving the `findWithDecryption` calls from customers to staff, or the `findOneWithDecryption` call from planner to staff, the developer drops the `organizationId` argument or changes the scope object shape.
- **Severity**: High (cross-tenant data leakage)
- **Affected area**: Both new staff routes and the moved `availabilityAccessResolver`
- **Mitigation**: (a) byte-copy approach reduces drift; (b) both Phase 1.A and Phase 1.B verification gates require the existing integration tests (which assert correct tenant scoping) to pass; (c) code review MUST diff scope arguments line-by-line; (d) PR description includes a checklist confirming the diff.
- **Residual risk**: Low if reviewer follows checklist.

### Migration & Deployment Risks

#### Risk: External app consumers hard-code `/api/customers/assignable-staff`

- **Scenario**: A downstream consumer's HTTP client doesn't follow redirects, or strips query string on redirect.
- **Severity**: Medium
- **Affected area**: External apps using the customer assignable-staff endpoint
- **Mitigation**: `308` (not `307`) is the correct status for permanent moves; preserves method and body. Standard HTTP clients (fetch, axios, requests, curl) follow `308` correctly. Document the redirect in `RELEASE_NOTES.md`.
- **Residual risk**: Low — edge case for non-conformant clients.

#### Risk: DI resolver registers after the first availability request lands

- **Scenario**: A race condition during boot where a planner route handles a request before staff's `register(container)` has run.
- **Severity**: Low
- **Affected area**: First few seconds of app boot
- **Mitigation**: Module registration in `apps/mercato/src/bootstrap.ts` happens synchronously before the HTTP server accepts traffic. The race is impossible by construction. The new fail-soft test is a structural guard — if registration order ever changes, the test surfaces it as a false `staff_module_not_loaded`.
- **Residual risk**: None.

### Operational Risks

#### Risk: On-call cannot detect a regression caused by staff being unregistered

- **Scenario**: A deployment misconfiguration causes staff to not register. Planner self-availability routes start returning `403`. On-call sees the `403` count rise but cannot tell if it's an ACL bug or a module-load issue.
- **Severity**: Medium
- **Affected area**: Planner availability flows, observability
- **Mitigation**: The fail-soft branch logs `[planner] staff_module_not_loaded — availabilityAccessResolver unregistered`. The `403` response body includes `error: 'staff_module_not_loaded'` (distinct from generic ACL `403`). On-call can grep logs and dashboards for the dedicated string.
- **Residual risk**: Low if on-call playbooks reference the new error code.

#### Risk: Performance regression from extra DI indirection

- **Scenario**: Every planner availability request now makes a `container.resolve` call where it used to do a direct function call.
- **Severity**: Low
- **Affected area**: Planner self-availability endpoints
- **Mitigation**: Awilix `resolve` for `asValue` registrations is `O(1)` map lookup. Same SQL underneath. Benchmark before/after if `OM_PROFILE=planner.*` shows >5% delta on the affected routes.
- **Residual risk**: Negligible.

#### Risk: Customer UI consumers continue to use legacy URL forever

- **Scenario**: Phase 1.A Step 2 (consumer inventory) misses one site. The redirect masks the missed update, and the consumer never migrates. When Phase 3 removes the legacy URL, the consumer breaks.
- **Severity**: Low
- **Affected area**: In-tree customer UI flows
- **Mitigation**: Phase 1.A Step 2 grep MUST be exhaustive across `packages/` and `apps/`. PR description includes the full consumer list. Phase 3 spec re-runs the grep and refuses to remove the route until zero matches remain.
- **Residual risk**: Low.

### Anti-Pattern Checks

| Check | Result |
|-------|--------|
| Restating obvious platform boilerplate as feature scope | Not present — spec scoped to the unique decouple work |
| Mixing MVP build plan with speculative future phases | Not present — Phase 2 and Phase 3 are explicitly out-of-scope |
| Skipping undoability for state changes | Not applicable — no mutations introduced |
| Cross-module ORM links | Not present — uses DI resolver instead of `@ManyToOne` |
| Plural command/event naming | Not applicable — no new commands or events |
| Domain logic added to `@open-mercato/shared` | Explicitly rejected in Alternatives |

---

## Final Compliance Report — 2026-05-08

### AGENTS.md Files Reviewed

- `AGENTS.md` (root)
- `packages/core/AGENTS.md`
- `packages/shared/AGENTS.md`
- `packages/core/src/modules/customers/AGENTS.md`
- `.ai/specs/AGENTS.md`
- `BACKWARD_COMPATIBILITY.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| root `AGENTS.md` | NO direct ORM relationships between modules — use FK IDs, fetch separately | Compliant | DI resolver replaces direct entity import |
| root `AGENTS.md` | Always filter by `organization_id` for tenant-scoped entities | Compliant | Existing scope arguments preserved byte-for-byte |
| root `AGENTS.md` | Use DI (Awilix) to inject services; avoid `new`-ing directly | Compliant | New `availabilityAccessResolver` registered via DI |
| root `AGENTS.md` | Modules must remain isomorphic and independent | Compliant | This spec restores that property by removing cross-module imports |
| root `AGENTS.md` | Validate all inputs with zod | Compliant | Existing zod schema preserved on the moved route |
| root `AGENTS.md` | API routes MUST export `openApi` | Compliant | New staff route includes `openApi`; deprecated customers route keeps `openApi` with `deprecated: true` |
| root `AGENTS.md` | Write operations: implement via Command pattern | N/A | No mutations introduced |
| root `AGENTS.md` | Generated files: never edit manually | Compliant | No generated files modified |
| `packages/core/AGENTS.md` | Auto-discovery: `api/<METHOD>/<path>.ts → /api/<path>` | Compliant | New route lives at `staff/api/team-members/assignable/route.ts` |
| `packages/core/AGENTS.md` | Encryption: use `findWithDecryption`/`findOneWithDecryption` instead of raw `em.find` | Compliant | Preserved byte-for-byte from source files |
| `packages/core/AGENTS.md` | Always supply `tenantId` and `organizationId` to decryption helpers | Compliant | Preserved |
| `packages/shared/AGENTS.md` | MUST NOT add domain-specific logic to `@open-mercato/shared` | Compliant | All moved logic lives in `staff/lib/` and `staff/api/`; nothing added to shared |
| `packages/shared/AGENTS.md` | MUST use precise types — no `any` | Compliant | DI resolver typed with explicit interface |
| `packages/core/src/modules/customers/AGENTS.md` | Customers is the reference CRUD module — copy patterns from here | Compliant | New staff route follows the same shape as customers `findWithDecryption + scope + paged response` pattern |
| `BACKWARD_COMPATIBILITY.md` surface #4 | Import paths STABLE — moved modules must re-export from old path | Compliant | `planner/api/access.ts` keeps wrapper export of `resolveAvailabilityWriteAccess` |
| `BACKWARD_COMPATIBILITY.md` surface #7 | API route URLs STABLE | Compliant | `/api/customers/assignable-staff` returns `308` redirect for ≥1 minor version |
| `BACKWARD_COMPATIBILITY.md` surface #9 | DI service names STABLE | Compliant | New key `availabilityAccessResolver`; documented in new `staff/AGENTS.md` |
| `BACKWARD_COMPATIBILITY.md` Deprecation Protocol | Document in `RELEASE_NOTES.md` | Compliant — required as Phase 1.C Step 2 |
| `BACKWARD_COMPATIBILITY.md` Deprecation Protocol | Spec MUST include "Migration & Backward Compatibility" section | Compliant — section present |
| `.ai/specs/AGENTS.md` | Filename `{date}-{title}.md` no `SPEC-*` prefix | Compliant — `2026-05-08-staff-decouple-from-core.md` |
| `.ai/specs/AGENTS.md` | Required sections present | Compliant — TLDR, Overview, Problem, Solution, Architecture, Data Models, API Contracts, Risks, Final Compliance, Changelog |

### Internal Consistency Check

| Check | Status | Notes |
|-------|--------|-------|
| Data models match API contracts | Pass | No new data models; API contracts mirror existing customer route |
| API contracts match UI/UX section | Pass | No UI changes; consumer inventory step ensures coverage |
| Risks cover all write operations | Pass | No write operations introduced |
| Commands defined for all mutations | Pass | No mutations |
| Cache strategy covers all read APIs | Pass | No new caching introduced; redirect path is uncached by design |
| Tenant isolation explicit on every read path | Pass | Scope arguments byte-copied from sources |
| Implementation Plan steps each result in working app | Pass | Each phase has its own verification gate |
| All risks have mitigation + residual | Pass | 7 risks — all four template categories addressed |
| All cross-module references use DI or moved routes | Pass | No direct imports remain after Phase 1.B |

### Non-Compliant Items

None.

### Verdict

**Fully compliant — Approved for implementation.**

---

## References

- PR [#1111](https://github.com/open-mercato/open-mercato/pull/1111) — adds the dashboards coupling site (out of scope; follow-up spec).
- [SPEC-013 (decouple-module-setup)](./implemented/SPEC-013-2026-01-27-decouple-module-setup.md) — architectural precedent for module decoupling via DI / `setup.ts` conventions.
- [SPEC-069 (core-timesheets)](./SPEC-069-2026-02-23-core-timesheets.md) — original timesheets spec; explains why the dashboards inline filter exists in PR #1111.
- [`packages/shared/src/lib/crud/api-interceptor.ts`](../../packages/shared/src/lib/crud/api-interceptor.ts) — `ApiInterceptor` type (informational).
- [`packages/shared/src/lib/crud/custom-route-interceptor.ts`](../../packages/shared/src/lib/crud/custom-route-interceptor.ts) — confirmed `before` hooks not supported on custom POST routes today (relevant to follow-up dashboards spec, not this one).
- [`BACKWARD_COMPATIBILITY.md`](../../BACKWARD_COMPATIBILITY.md) — contract surface taxonomy and deprecation protocol.
- [official-modules](https://github.com/open-mercato/official-modules) — destination repo for Phase 2.

---

## Changelog

### 2026-05-08

- Spec created via the `/spec-writing` skill workflow on `feat/spec-069-timesheets-phase-1` (PR target branch will be a fresh `feat/staff-decouple-from-core` off `upstream/develop`).
- Re-verified the coupling sites against `upstream/develop` HEAD: only the two known sites (`customers/api/assignable-staff/route.ts`, `planner/api/access.ts`). No new coupling has crept in since the prior draft on 2026-04-29. The 2026-04-29 working draft has been deleted (Q2 = Option A) — its research informed this spec but is now fully superseded.
- Open Questions resolved: Q1 = Option A (preserve customer-driven RBAC: page guard `customers.roles.view`, handler check `customers.roles.manage`/`customers.activities.manage`); Q2 = Option A (delete prior untracked draft).
- Decisions inherited from the prior draft and re-confirmed: scope = customers + planner only; planner refactor = DI resolver with `allowUnregistered: true`; legacy URL BC = 308 redirect for ≥1 minor version.
- Added new in-scope item not in the prior draft: a minimal `packages/core/src/modules/staff/AGENTS.md` declaring `availabilityAccessResolver` as a public DI contract surface so future contributors apply the deprecation protocol before changing it.
- Pre-implementation context: Piotr (pkarw) requested the decouple PR in a comment on PR #1111 dated 2026-04-30 (<https://github.com/open-mercato/open-mercato/pull/1111#issuecomment-4354394013>): *"can you guys propose the other PR with decouple fix to the core? I'd rather like to decouple first and not to keep the same module in official modules and the core at the same time please"*. The PR for this spec lands in parallel with the in-review timesheets PR #1111.
- Architectural Review pass (2026-05-08, post-skeleton refinement) applied:
  - **C1**: `staff/di.ts` action corrected from MODIFY → CREATE; the file does not exist on `upstream/develop`. Added bootstrap-wiring sub-step and a smoke test asserting `container.hasRegistration('availabilityAccessResolver')`.
  - **H1**: Documented pre-existing `staff/index.ts` `requires: ['planner', 'resources']` declaration as untouched in Phase 1; flagged as a Phase 2/3 concern. Added re-verification to Phase 1.C Step 1.
  - **H2**: Committed to a single fail-soft semantics — added `unregistered?: boolean` optional sentinel field to `AvailabilityWriteAccess` (additive, BC surface #2); `assertAvailabilityWriteAccess` checks for it and throws the dedicated error code at exactly one branch.
  - **H3**: Specified the test mechanism explicitly — unit test against the wrapper function with a mock container, NOT a full integration boot (no documented "test container with module excluded" pattern exists in this codebase today).
  - **H4**: Synced DI code samples to use `AppContainer` from `@open-mercato/shared/lib/di/container` instead of `AwilixContainer` directly, matching `customers/di.ts` and `planner/di.ts` style.
  - **M1**: Made the encryption-maps relationship explicit — `StaffTeam` and `StaffTeamMember` are not in `staff/encryption.ts` so `findWithDecryption` is a no-op on these entities today.
  - **M2**: Replaced "three sequential commits" framing with "phase boundaries are testable units; commits within a phase MAY be squashed".
  - **M3**: Phase 1.A Step 2 now distinguishes production callsites (must update) from test callsites (leave only when asserting redirect).
  - **M4**: Phase 1.C Step 1 grep excludes `__tests__|__integration__` so test fixtures (Phase 3 cleanup) don't trip the proof.
  - **M5**: Added "Sequencing with PR #1111" subsection covering all three merge orderings.
  - **M6**: Verified `planner.manage_availability` exists at `planner/acl.ts:3` and added the explicit line reference.
  - **M7**: Replaced unanchored "≥0.5.x" lifespan with "removable no earlier than 0.6.0".

### 2026-05-14

- Pre-implementation analysis applied (see `.ai/specs/analysis/ANALYSIS-2026-05-08-staff-decouple-from-core.md`). Three doc fixes landed in this revision:
  - **Test fixture path corrected** in the Out-of-Scope String References table: the staff fixture helper lives at `packages/core/src/helpers/integration/staffFixtures.ts` (with a re-export shim under `packages/core/src/modules/core/__integration__/helpers/staffFixtures.ts`), not the path quoted in the prior draft.
  - **Awilix version verification step** added to Phase 1.B Step 2. The spec relies on `container.resolve(..., { allowUnregistered: true })` (the first in-tree use of that option); the new step pins the contract to Awilix ≥4.x and provides a `try/catch` fallback contract for older versions.
  - **Phase 1.A Step 2 inventory pre-populated** with the four already-known callsites of `/api/customers/assignable-staff` (one production UI fetcher + three test files), so the implementer doesn't have to re-discover them. The bash grep stays as the authoritative source — the listed sites are a head-start, not a replacement.
- Implementation completed in a single session against `upstream/develop`. Awilix `12.0.5` is installed (well above the 4.x floor), so `allowUnregistered: true` is used directly without the spec's documented `try/catch` fallback.
- **Deprecation note placement deviation**: the spec's Phase 1.C Step 2 said "add `RELEASE_NOTES.md` entry under Deprecations". This repository does not have a `RELEASE_NOTES.md`; the equivalent file is [`UPGRADE_NOTES.md`](../../UPGRADE_NOTES.md) (downstream-facing breaking-change ledger). The deprecation entry was added there under a fresh `0.6.0 → 0.7.0 (unreleased)` section, alongside the existing `0.5.0 → 0.5.1 (unreleased)` window. `CHANGELOG.md` will pick up the entry at release time via the `auto-update-changelog` skill.
- **`openApi.deprecated` field placement**: the spec's Architecture section (line 260) and Module-File Changes table (line 154) referenced `deprecated: true` as a top-level `OpenApiRouteDoc` field. The actual `OpenApiRouteDoc` shape in `packages/shared/src/lib/openapi/types.ts` only carries `deprecated?: boolean` on the per-method `OpenApiMethodDoc` (line 40). The redirect route therefore declares `methods.GET.deprecated: true` instead of a top-level `deprecated: true`. The OpenAPI generator already wires the method-level `deprecated` into the bundle, so the user-facing effect is identical.
- **Final verification gate** (run from `upstream/develop` HEAD, Node 24.14.0, Awilix 12.0.5): `yarn generate` ✅, `yarn build:packages` ✅ (18/18 packages), `yarn typecheck` ✅ (18/18 packages), `yarn lint` ✅ (0 errors), full core jest suite ✅ (446/446 suites, 3736/3736 tests). Integration tests (`TC-STAFF-005`) not executed in this session — recommended to run before opening the PR.

## Implementation Status

| Phase | Status | Date | Notes |
|-------|--------|------|-------|
| Phase 1.A — Move assignable-staff route + 308 redirect | Done | 2026-05-14 | New staff route at `packages/core/src/modules/staff/api/team-members/assignable/route.ts`; legacy customers route returns `308`; UI fetcher migrated; 4 callsite tests updated; new `TC-STAFF-005` integration test added |
| Phase 1.B — Move planner staff lookup to staff DI resolver | Done | 2026-05-14 | `staff/lib/availabilityAccess.ts` + `staff/di.ts` created; `planner/api/access.ts` reduced to a thin DI wrapper with `allowUnregistered: true`; `unregistered?` sentinel field on `AvailabilityWriteAccess`; `assertAvailabilityWriteAccess` throws `403 staff_module_not_loaded` on the unregistered branch |
| Phase 1.C — Decouple proof + UPGRADE_NOTES.md + staff AGENTS.md | Done | 2026-05-14 | `grep` proof returns zero matches outside `/staff/` for production code; `staff/index.ts` still declares `requires: ['planner', 'resources']`; deprecation entry landed in `UPGRADE_NOTES.md` (spec deviation noted in changelog); new `staff/AGENTS.md` documents `availabilityAccessResolver` as a public DI contract surface and entity classes as internal-only |

### Detailed Step Progress

- [x] Phase 1.A Step 1 — Create staff route (byte-copy of customers handler, shared OpenAPI helper, OpenAPI tag = `Staff`)
- [x] Phase 1.A Step 2 — Inventory + migrate in-tree consumers (UI fetcher at `customers/components/detail/assignableStaff.ts`, `AssignRoleDialog.test.tsx`, `TC-CRM-038.spec.ts`)
- [x] Phase 1.A Step 3 — Replace customers handler body with `308` redirect, mark `openApi.deprecated: true`
- [x] Phase 1.A Step 4 — Add `TC-STAFF-005-assignable.spec.ts` integration test (paging metadata + 308 redirect assertion via raw `request.fetch({ maxRedirects: 0 })`)
- [x] Phase 1.A Step 5 — Update legacy route unit test to assert `308` + `Location` header + query-string preservation
- [x] Phase 1.A Step 6 — Verification gate (jest passes for `assignable` + `AssignRoleDialog` — 11 tests)
- [x] Phase 1.B Step 1 — Create `staff/lib/availabilityAccess.ts` with relocated function + constants + `unregistered?` field on `AvailabilityWriteAccess`
- [x] Phase 1.B Step 2 — Create `staff/di.ts` registering `availabilityAccessResolver` (Awilix 12.0.5 verified; no fallback needed)
- [x] Phase 1.B Step 3 — Modify `planner/api/access.ts` to consume via DI with `allowUnregistered: true`; one-branch update to `assertAvailabilityWriteAccess` for the unregistered case
- [x] Phase 1.B Step 4 — Add `availabilityAccess.test.ts` (wrapper unit tests + assertAvailabilityWriteAccess branches) and `staff/__tests__/di.test.ts` (DI smoke test asserting `hasRegistration` works + `allowUnregistered` returns undefined on a bare container)
- [x] Phase 1.B Step 5 — Verification gate (jest passes for `planner` — 17 tests, including the new 7 for availabilityAccess)
- [x] Phase 1.C Step 1 — Decouple grep returns zero matches outside `/staff/` in production code; `staff/index.ts` requires line intact
- [x] Phase 1.C Step 2 — Deprecation entry added to `UPGRADE_NOTES.md` (RELEASE_NOTES.md does not exist in this repo)
- [x] Phase 1.C Step 3 — Create `packages/core/src/modules/staff/AGENTS.md` documenting public surfaces and deprecation protocol
