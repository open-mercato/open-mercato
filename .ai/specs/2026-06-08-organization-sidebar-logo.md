# Organization Sidebar Logo

## TLDR

Add organization-level sidebar branding so administrators can set a logo for the currently selected organization. The backend sidebar keeps the default Open Mercato logo when no organization logo is configured, and automatically switches to the organization logo when `organizations.logo_url` is present.

## Overview

Open Mercato already resolves backend chrome from the authenticated tenant and selected organization. This spec adds a small branding contract to that existing chrome payload so each organization can provide its own sidebar logo without adding a global theme module or fork-specific configuration.

The feature is OSS-scoped and intentionally organization-scoped. It supports multi-organization deployments while preserving the existing Open Mercato default logo for tenants that never configure branding.

## Problem Statement

Administrators currently cannot configure the backend sidebar logo through Open Mercato. Forks can replace static assets, but that approach is not suitable for upstream because it is deployment-specific, hard to manage per organization, and cannot be changed from the admin UI.

The missing behavior affects two paths:

- administrators need a reachable settings page for the selected organization logo,
- backend chrome needs to expose the selected organization logo to `AppShell` without breaking existing consumers of `/api/auth/admin/nav`.

## Proposed Solution

Store the logo URL on `Organization` as a nullable `logoUrl`/`logo_url` field. Add a dedicated branding endpoint for the currently selected organization, then extend backend chrome with an optional `brand` payload. The app shell prefers `brand.logo.src` when present and otherwise keeps the existing static logo prop.

The settings page lets an administrator either upload an image through `/api/attachments` or paste a valid image URL. Both flows save the final URL through `/api/directory/organization-branding`, so audit, command execution, cache invalidation, and future extension points remain centralized. Uploaded files persist the original attachment file URL, not a square thumbnail URL, so wide or tall organization marks keep their source aspect ratio.

## Scope

- Add nullable `logo_url` to `organizations`.
- Add `/api/directory/organization-branding` for reading/updating the selected organization logo.
- Add a settings page at `/backend/directory/branding`.
- Extend `/api/auth/admin/nav` with optional `brand` data consumed by `AppShell`.
- Support two admin UX paths: upload an image through the existing attachments API, or paste an external image URL.

## Architecture

The logo is owned by `Organization`, not by a global module config. Sidebar chrome is already scoped by tenant and organization through `/api/auth/admin/nav`, so the brand data belongs in the same backend chrome payload:

```ts
type BackendChromePayload = {
  brand?: {
    name?: string
    logo?: { src: string; alt?: string } | null
  } | null
}
```

`AppShell` prefers `payload.brand.logo` over the static `logo` prop. If no custom organization logo exists, the current Open Mercato logo behavior is unchanged. Custom organization logos render with contained object fit rather than the default rounded icon treatment so uploaded wordmarks are not cropped.

The settings page uploads files via `/api/attachments` using `entityId=directory.organization` and `recordId=<organizationId>`, then stores the returned original file URL through `/api/directory/organization-branding`. External URLs are validated and stored directly.

The branding endpoint resolves organization scope with the same directory scope utilities used elsewhere. It rejects ambiguous "all organizations" scope because a branding write needs a concrete target organization. Writes execute `directory.organizations.update` through the command bus so the standard directory command behavior remains the single write path.

Cache invalidation is scoped to the selected organization and tenant:

- `nav:sidebar:organization:<organizationId>`
- `nav:sidebar:tenant:<tenantId>`

This keeps sidebar refreshes targeted while still clearing tenant-wide fallback caches.

## Data Models

### Organization

Additive field:

```ts
logoUrl?: string | null
```

Database column:

```sql
organizations.logo_url text null
```

Validation uses `organizationUpdateSchema.shape.logoUrl`. Accepted values are:

- `null` or empty input, which restores the default Open Mercato logo,
- external `http`/`https` image URLs,
- internal `/api/attachments/...` image/file URLs produced by the existing attachments API.

### Backend Chrome

Additive field:

```ts
brand?: {
  name?: string
  logo?: {
    src: string
    alt?: string
  } | null
} | null
```

No existing `BackendChromePayload` fields are removed or narrowed.

## API Contracts

`GET /api/directory/organization-branding`

- Requires `directory.organizations.view`.
- Requires a concrete selected organization.
- Returns `{ organizationId, organizationName, tenantId, logoUrl }`.

`PUT /api/directory/organization-branding`

- Requires `directory.organizations.manage`.
- Validates `logoUrl` as an external URL, internal attachment image/file URL, or `null`.
- Updates the organization through `directory.organizations.update` so audit, undo, indexing, and events remain consistent.

`GET /api/auth/admin/nav`

- Remains available to authenticated backend users.
- Returns the existing navigation payload plus optional `brand`.
- Uses the selected organization from query parameters, cookies, or authenticated fallback scope.
- Returns `brand: null` when the selected organization has no `logoUrl`.

`GET /api/directory/organizations`

- Existing organization list/option/manage responses include additive `logoUrl`.

`POST /api/attachments`

- Existing endpoint used by the branding page for uploaded logo files.
- Branding page sends `entityId=directory.organization`, `recordId=<organizationId>`, and `tags=["organization-logo"]`.

## UI/UX

Add `/backend/directory/branding` under Directory settings. The page shows the selected organization, a logo preview, a file picker, a URL input, a save action, and a reset action. It dispatches `om:refresh-sidebar` after a successful save so the current shell refreshes its chrome payload.

The page uses existing backend primitives (`Page`, `PageHeader`, `PageBody`, `Input`, `Button`, `LoadingMessage`, `ErrorMessage`), `useT` translations, `apiCallOrThrow`/`readApiResultOrThrow`, and `useGuardedMutation`.

## Integration Coverage

Executable integration coverage:

- `packages/core/src/modules/directory/__integration__/TC-DIR-013-organization-sidebar-branding.spec.ts`
  - creates an organization fixture,
  - writes `logoUrl` through `PUT /api/directory/organization-branding` with `om_selected_org`,
  - reads it back through `GET /api/directory/organization-branding`,
  - verifies `GET /api/auth/admin/nav` exposes `brand.logo.src` for the selected organization,
  - deletes the organization fixture in cleanup.

Unit/API and UI smoke coverage:

- `packages/core/src/modules/directory/api/organization-branding/__tests__/route.test.ts`
  - selected organization read,
  - ambiguous scope rejection,
  - command-bus write and sidebar cache invalidation,
  - malformed logo URL rejection.
- `packages/core/src/modules/directory/backend/directory/branding/__tests__/page.test.tsx`
  - current branding render,
  - pasted URL save,
  - reset to default,
  - upload flow through `/api/attachments` before branding save,
  - uploaded SVG/PNG/JPEG/WebP logos persist original attachment file URLs instead of square thumbnails,
  - file picker cancel keeps the pending selected-file preview.
- `packages/ui/src/backend/__tests__/AppShell.test.tsx`
  - sidebar logo fallback and custom brand rendering,
  - internal attachment file/image URLs and external URLs render unoptimized with aspect-ratio-preserving containment.

Manual CRM validation on `https://crm.they.dev` covered pasted URL save, invalid URL rejection, sidebar refresh behavior, and reset to default. Upload automation was inconclusive in the browser session, so the upload path is covered by the UI unit smoke test and should be rechecked manually after the final CRM deploy is healthy.

## Migration & Backward Compatibility

- Database schema: additive nullable column `organizations.logo_url`.
- Public API: additive `brand` field in `/api/auth/admin/nav`.
- Organization CRUD serialization: additive `logoUrl` field.
- No route removals, import path changes, event ID changes, ACL changes, or widget spot changes.
- No enterprise-only scope and no fork-only deployment paths.

## Risks & Impact Review

| Risk | Severity | Affected area | Mitigation | Residual risk |
| --- | --- | --- | --- | --- |
| External logo URL fails to load because the remote host blocks image requests | Low | Sidebar visual branding | Prefer uploaded attachments; preview URL before save; keep default logo fallback when no URL is configured | A saved external URL can still become unavailable later |
| Ambiguous organization scope updates the wrong organization | High | Directory organization data | Reject requests without a concrete selected organization | Superadmin must select one organization before editing branding |
| Cached sidebar payload keeps an old logo after save | Medium | Backend chrome | Invalidate tenant and organization sidebar tags; dispatch `om:refresh-sidebar` after UI save | Browser may show stale chrome until refresh if an external cache layer ignores tags |
| Additive nav payload breaks consumers that assume an exact object shape | Low | `/api/auth/admin/nav` clients | Field is optional and nullable; existing fields are unchanged | Consumers with overly strict custom validators may need to allow unknown fields |
| Uploaded file automation misses a real attachment regression | Medium | Branding page upload UX | Unit smoke covers FormData upload call; manual CRM upload should be repeated after final deploy health is restored | Final deployed upload UX still needs a healthy CRM deploy confirmation |
| Uploaded wordmark is cropped because a square thumbnail URL is stored or rendered like an icon | Medium | Sidebar visual branding | Store the original attachment file URL and render custom logos with object containment while keeping the default icon behavior unchanged | Very small sidebars still constrain available width, but the image itself is not cropped |

## Final Compliance Report

- Branch type: upstream candidate on `contrib/thom-9-company-logo-sidebar`.
- Base: `origin/upstream-baseline` / `upstream/develop`.
- Fork-only paths: none in this PR.
- Contract compatibility: additive database, API, and shared type changes only.
- Tests: unit/API, UI smoke, package build, and executable directory integration coverage.
- Open item: repeat browser upload validation on `crm.they.dev` once the deployment path is healthy; this is not a schema/API blocker.

## Changelog

- 2026-06-08: Created spec for organization-level sidebar logo branding.
- 2026-06-08: Updated implementation coverage, API contracts, risk review, and final compliance report after PR audit.
- 2026-06-23: Clarified uploaded logo aspect-ratio preservation, original attachment URL persistence, and additional SVG/PNG/JPEG/WebP coverage.
