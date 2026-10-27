# Current Organization on the Backend Chrome Payload

## TL;DR

Add a resolved `currentOrganization: { id, name } | null` to `BackendChromePayload` so backend UI can
label "you are viewing: &lt;organization&gt;" without a second network round trip. The resolver already
loads the organization row to build `brand`, so the name is free at that point. Additive optional field
plus one convenience hook; `brand` semantics are untouched.

## Overview

- **Touched code**: `packages/shared/src/modules/navigation/backendChrome.ts`,
  `packages/core/src/modules/auth/lib/backendChrome.tsx`,
  `packages/ui/src/backend/BackendChromeProvider.tsx`
- **Not touched**: the `brand` field and its `logoUrl` condition, the organization-switcher API, the
  nav payload route, ACL, persistence

## Problem Statement

Showing which organization the operator is currently viewing is an ordinary backend-chrome need. Three
partial sources exist and none answers it:

1. **`getCurrentOrganizationScope()`** (`packages/shared/src/lib/frontend/organizationEvents.ts:16`)
   returns `OrganizationScopeChangedDetail` — `{ organizationId, tenantId }` (`:3-6`). Ids only, no name.
2. **`BackendChromePayload.brand`** carries a name, but only when the organization has a `logoUrl`:
   ```ts
   if (organization?.logoUrl) {
     brand = { name: organization.name, logo: { … } }
   }
   ```
   `brand` is a *branding* channel. An organization with no logo yields `brand: null`, so it cannot be
   relied on to identify the current organization.
3. **`GET /api/directory/organization-switcher`** returns `selectedId` plus a **tree** of
   `{ id, name, children }`. A caller wanting a display name must fetch it and recursively search that
   tree for the selected id.

So every downstream app that wants to name the current organization pays for an extra request and
reimplements the same recursive lookup. That is duplicated work for information the server already had
in hand.

## Proposed Solution

Resolve it server-side in `resolveBackendChromePayload`, where the organization row is already loaded,
and expose it as an additive optional payload field.

- `BackendChromePayload.currentOrganization?: BackendChromeCurrentOrganization | null`
- populated whenever a single organization is in scope, **independent of `logoUrl`**
- `brand` keeps its exact current behaviour, including the `logoUrl` condition

## Architecture

### Source of truth

`packages/core/src/modules/auth/lib/backendChrome.tsx` already computes `brandOrganizationId` and,
when it is set together with a scoped tenant, loads the `Organization` row through
`findOneWithDecryption`. The same row now also populates `currentOrganization`. No additional query,
no new dependency.

### Behavioural rules

Populated **only from the concrete selection** (`scope.selectedId`), never from the resolver's
`organizationId`. That distinction is the whole correctness argument:
`resolveFeatureCheckContext` falls back to `auth.orgId` when nothing concrete is selected
(`modules/directory/utils/organizationScope.ts:556-559`), so a payload built from the resolved id
names the caller's own organization while they are viewing *all* organizations. Branding legitimately
uses that fallback and is unchanged; scope reporting must not.

- `null` under an all-organizations selection — the resolver still returns an organization id there,
  so the field is gated on `scope.selectedId` matching the loaded row
- `null` when no organization is in scope
- `null` when the row cannot be found
- `null` when the lookup throws — the existing fail-soft posture is preserved, because a failed
  organization lookup must never take down the nav payload
- `name` is the decrypted organization name, as `brand` already uses

### Client access

`useCurrentOrganization()` in `packages/ui/src/backend/BackendChromeProvider.tsx` reads the payload the
provider already holds. It performs **no** request of its own — a hook that re-fetched would defeat the
purpose. Returns `null` outside a provider and before the payload arrives, so consumers must treat
`null` as "unknown", not as "no organization".

## Data Model

No database or entity change. `organizations.name` and `organizations.logo_url` already exist.

## API Contracts

### `BackendChromePayload`

```ts
export type BackendChromeCurrentOrganization = {
  id: string
  name: string
}

export type BackendChromePayload = {
  // … existing fields unchanged
  brand?: BackendChromeBrand | null
  currentOrganization?: BackendChromeCurrentOrganization | null
}
```

Optional and additive. Existing consumers that ignore the field are unaffected.

`adminNavResponseSchema` in `modules/auth/api/admin/nav.ts` declares the same field, so the generated
OpenAPI surface and generated clients can discover it — a payload type alone would leave the documented
contract inconsistent with the runtime one.

### Response caching

`GET /api/auth/admin/nav` caches under a key built from the resolved scope. Two properties are required:

- the namespace uses `v6:<module-surface-fingerprint>`, so entries from earlier payload versions are
  not replayed and module or backend-route surface changes invalidate the cached chrome payload
- the **resolved selection** joins the key. The resolved organization cannot distinguish "all
  organizations" from "my own organization" — both resolve to `auth.orgId` — and the production
  request omits the `orgId` query parameter, so using the raw query selection would still collide when
  the `om_selected_org` cookie changes. The resolver's `scope.selectedId` keeps those payloads separate.

### Relationship to `brand`

| Situation | `brand` | `currentOrganization` |
|---|---|---|
| Organization in scope, logo set | populated | populated |
| Organization in scope, no logo | `null` | **populated** |
| All-organizations selection | `null` | `null` |
| Lookup fails | `null` | `null` |

The middle row is the gap this spec closes.

## Phases

### Phase 1: payload field
Add the exported type and the optional field, populate it in the resolver alongside `brand`.

### Phase 2: client convenience
Add `useCurrentOrganization()` reading from the existing provider context.

### Phase 3: coverage
Tests over the resolver asserting each behavioural rule above, with the no-logo case as the regression
oracle.

## Integration Coverage

**Route-level coverage** — `modules/auth/__integration__/TC-AUTH-NAV-ORG-001.spec.ts` exercises
`GET /api/auth/admin/nav` through the *real* scope resolver against a real database:

- a concrete selection is named in the payload
- an all-organizations selection reports `null`
- neither scope serves the other's cached payload (concrete → all → concrete ordering)
- both scopes still return a usable payload

This level is not optional for this feature: the defect it guards lives in the resolver that unit
tests mock away, and the first version of the unit test "passed" against the broken behaviour.

**Unit coverage** over `resolveBackendChromePayload` with the container, ORM, nav builder and sidebar
preference seams mocked. The `FeatureCheckContext` fixtures mirror the real `OrganizationScope`
(`selectedId`/`filterIds`/`allowedIds`/`tenantId`) and preserve its asymmetry — no concrete selection
still yields a non-null `organizationId`:

- organization without a logo → `currentOrganization` populated, `brand` still `null`
- all-organizations selection with a non-null fallback organization → `null`, while `brand` still works
- organization with a logo → both populated, `brand` byte-identical to today
- all-organizations selection → `null`, and no organization lookup performed
- lookup rejects → `null`, payload still returned and usable
- row missing → `null`
- the lookup is scoped to the resolved tenant and organization

**Provider coverage** — `packages/ui/src/backend/__tests__/BackendChromeProvider.test.tsx` exercises
the public `useCurrentOrganization()` boundary:

- outside a provider and before the payload arrives → `null`
- a hydrated payload exposes its resolved organization without another request
- an organization-scope change refreshes the payload and updates the hook result

**Cache-key coverage** — `packages/core/src/modules/auth/api/__tests__/admin-nav.test.ts` asserts the
fingerprinted `v6` namespace, rejects reuse of the old `v5` namespace, and verifies that concrete and
all-organizations cookie selections resolve to distinct keys.

## Risks & Impact Review

### Risk 1: readers assume this supersedes `brand`
- Severity: Low
- Impact: someone removes the `logoUrl` condition or starts rendering logos from this field
- Mitigation: both the field's doc comment and the `BACKWARD_COMPATIBILITY.md` entry state that `brand`
  is unchanged and remains the branding channel
- Residual risk: low

### Risk 2: `null` read as "no organization" rather than "unknown"
- Severity: Medium
- Impact: UI renders "no organization" while the payload is still loading
- Mitigation: the hook's doc comment says to treat `null` as unknown; `isLoading`/`isReady` remain
  available on the provider context for consumers that need to distinguish
- Residual risk: low

### Risk 3: extra query cost
- Severity: None
- Impact: none — the row was already loaded under the same condition
- Mitigation: not applicable

### Risk 4: leaking an organization name across tenants
- Severity: High if mishandled
- Impact: showing another tenant's organization name
- Mitigation: reuses the existing lookup unchanged, which filters `{ id, tenant: scopedTenantId,
  deletedAt: null }` and passes the decryption scope; a test asserts the filter
- Residual risk: low

## Final Compliance Report

### Architecture
- [x] No new module boundaries
- [x] No cross-module ORM relations added
- [x] Resolver keeps its single organization lookup

### Data & Security
- [x] No schema change
- [x] Tenant scoping unchanged and asserted by test
- [x] Fail-soft behaviour preserved

### API & UI
- [x] Payload extended additively
- [x] `brand` semantics unchanged
- [x] Client hook adds no request

### Testing
- [x] Regression oracle for the no-logo case
- [x] Null cases covered
- [x] Scoping asserted

## Migration & Backward Compatibility

No migration is required, for applications or for data.

- **`BackendChromePayload.currentOrganization`** is a new **optional** field. Existing consumers are
  unaffected; TypeScript consumers see one additional optional property. Recorded in
  `BACKWARD_COMPATIBILITY.md` §2 alongside the other additive-field entries.
- **`brand` is unchanged** — same field, same `logoUrl` condition, same shape. Nothing that reads `brand`
  today changes behaviour, and this field neither supersedes nor deprecates it.
- **`useCurrentOrganization()`** is a new export from `BackendChromeProvider`. Nothing was renamed or
  removed there, so no bridge or deprecation window is needed.
- **No other contract surface is touched**: no route URL or method, no request schema, no event name or
  payload, no CLI command, no DI key, no ACL feature, and no database change.
- **Forward constraint for future changes**: `null` MUST keep meaning "unknown" — an all-organizations
  selection, no organization in scope, or a failed lookup. Redefining `null` as "no organization" would
  break consumers that render a fallback label while the payload is still loading.

## Changelog

- 2026-07-30: Drafted and implemented. Reported from a downstream app that had to fetch
  `/api/directory/organization-switcher` and walk its tree to name the organization its sidebar account
  block was showing.

- 2026-07-31: Corrected during review. `currentOrganization` now derives from `scope.selectedId`
  rather than the resolver's fallback `organizationId`, which had made it name the caller's own
  organization during an all-organizations view; the nav route response schema declares the field; and
  the response cache key gained the selection plus a version bump so the two scopes cannot share an
  entry. Added `TC-AUTH-NAV-ORG-001` for route-level coverage and rebuilt the unit fixtures to match
  the real `OrganizationScope` shape.

- 2026-08-01: Added provider/hook coverage for unloaded, hydrated, and scope-refresh states; added a
  cache-key regression assertion for the fingerprinted `v6` namespace and resolved selection; made
  the route integration test fail rather than skip when its token lacks the home organization needed
  to exercise the fallback path; and reconciled the selection key with `develop`'s module-surface
  cache invalidation.
