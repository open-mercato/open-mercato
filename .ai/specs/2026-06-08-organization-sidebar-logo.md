# Organization Sidebar Logo

## TLDR

Add organization-level sidebar branding so administrators can set a logo for the currently selected organization. The backend sidebar keeps the default Open Mercato logo when no organization logo is configured, and automatically switches to the organization logo when `organizations.logo_url` is present.

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

`AppShell` prefers `payload.brand.logo` over the static `logo` prop. If no custom organization logo exists, the current Open Mercato logo behavior is unchanged.

The settings page uploads files via `/api/attachments` using `entityId=directory.organization` and `recordId=<organizationId>`, then stores the returned image URL through `/api/directory/organization-branding`. External URLs are validated and stored directly.

## API Contracts

`GET /api/directory/organization-branding`

- Requires `directory.organizations.view`.
- Requires a concrete selected organization.
- Returns `{ organizationId, organizationName, tenantId, logoUrl }`.

`PUT /api/directory/organization-branding`

- Requires `directory.organizations.manage`.
- Validates `logoUrl` as an external URL, internal attachment image/file URL, or `null`.
- Updates the organization through `directory.organizations.update` so audit, undo, indexing, and events remain consistent.

## Migration & Backward Compatibility

- Database schema: additive nullable column `organizations.logo_url`.
- Public API: additive `brand` field in `/api/auth/admin/nav`.
- Organization CRUD serialization: additive `logoUrl` field.
- No route removals, import path changes, event ID changes, ACL changes, or widget spot changes.

## Test Coverage

- Unit/API coverage for the branding endpoint:
  - returns the selected organization branding,
  - rejects missing concrete organization scope,
  - updates through the command bus and invalidates sidebar cache tags,
  - rejects malformed logo URLs.
- UI smoke coverage for the settings page:
  - renders current organization data,
  - saves a pasted URL,
  - resets to the default logo.

## Risks

- External logo URLs can fail at runtime if the remote host blocks image loading. The page previews the URL before save and uploaded attachment URLs are preferred for stable in-app assets.
- Superadmin “All organizations” scope is intentionally rejected because it is ambiguous which organization should receive the logo.
