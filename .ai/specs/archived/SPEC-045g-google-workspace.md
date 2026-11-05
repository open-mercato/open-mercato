# SPEC-045g — Google Workspace Integration: Google Sheets Product Import

**Parent**: [SPEC-045 — Integration Marketplace](./SPEC-045-2026-02-24-integration-marketplace.md)
**Related**: [SPEC-045a — Foundation](./SPEC-045a-foundation.md), [SPEC-045b — Data Sync Hub](./SPEC-045b-data-sync-hub.md), [SPEC-041 — Universal Module Extension System](./SPEC-041-2026-02-24-universal-module-extension-system.md)

| Field | Value |
|-------|-------|
| **Status** | Draft (rewritten for current architecture) |
| **Author** | Piotr Karwatka |
| **Created** | 2026-02-24 |
| **Last Updated** | 2026-03-24 |
| **Category** | `data_sync` |
| **Hub** | `data_sync` |
| **Package** | `@open-mercato/sync-google-workspace` |
| **Primary Integration IDs** | `sync_google_workspace` bundle, `sync_google_sheets_products` child integration |

---

## TLDR

Build Google Sheets product import as a dedicated provider package, not a core module. The provider reuses the existing `integrations` and `data_sync` foundations, injects its own admin tabs into the integration detail page via UMES, stores Google OAuth tokens in the existing integration credentials record, stores spreadsheet/source configuration in a provider-owned entity, and reuses generic `sync_mappings` and `sync_schedules` for mapping and scheduling.

V1 scope is intentionally narrow:

- one Google Workspace bundle
- one child integration: Google Sheets product import
- admin brings their own Google Cloud OAuth app
- provider-owned OAuth connect/disconnect flow
- spreadsheet selection, sheet selection, header mapping preview
- scheduled import using the existing `data_sync` run infrastructure

Explicitly out of scope for V1:

- generic core-rendered OAuth credential UI
- Google Drive storage integration
- Google Docs generation
- generic spreadsheet import engine in core
- automatic background token refresh worker
- real-time Google change detection

---

## Overview

Many merchants keep their first or primary product catalog in Google Sheets. They need a connector that can turn a selected spreadsheet into a repeatable import source without forcing CSV download/upload loops.

This spec defines a provider package that behaves like existing external connectors such as `sync-akeneo`: the provider owns its remote API client, source configuration, import logic, and custom integration-detail UI, while the platform continues to own the generic marketplace shell, encrypted credentials storage, health/log state, sync-run lifecycle, schedules, and progress UX.

> **Market Reference**: Airbyte- and Fivetran-style source configuration separation is adopted: connection/auth, source selection, mapping, and schedules are treated as distinct concerns. Rejected for V1: a fully generic “OAuth field renderer in core” because the current platform does not support it end-to-end yet, and shipping Google Sheets does not require blocking on that broader platform feature.

---

## Problem Statement

Today, merchants who manage products in Google Sheets must:

1. export a sheet as CSV
2. download the file locally
3. upload the file into a separate import flow
4. repeat the process whenever the source sheet changes

That workflow is manual, error-prone, and not schedulable. It also breaks the integration marketplace model because the source is conceptually an external system, but the import path behaves like a local file upload.

At the same time, the current platform state matters:

- external integrations must be shipped as dedicated workspace packages, not new modules in `packages/core`
- the integrations detail page already supports UMES tabs/panels
- `data_sync` already owns runs, progress, schedules, and mapping persistence
- the current integrations UI does not render `oauth` credential fields end-to-end

The spec therefore must solve the Google Sheets problem without assuming core platform changes that do not exist yet.

---

## Proposed Solution

Create a new provider package:

```text
packages/sync-google-workspace/
```

with module id:

```text
sync_google_workspace
```

The provider exposes:

- a Google Workspace bundle with shared static credentials: `clientId`, `clientSecret`
- a child integration `sync_google_sheets_products` for product import
- custom UMES tabs on the integration detail page:
  - Setup Guide
  - Google Account
  - Spreadsheet Source
- a provider-owned OAuth flow implemented in provider routes, not in the generic credentials form
- a provider-owned source entity for selected spreadsheet and sheet settings
- a provider-owned row-state entity for content-hash delta tracking
- a `DataSyncAdapter` for `products`
- a provider-owned importer that writes catalog data through existing catalog commands

The platform pieces reused unchanged:

- `integrationCredentialsService` for encrypted bundle credential storage and token persistence
- `integrationStateService` for `reauthRequired` and health state
- `integrationLogService` for logs
- `data_sync` runs, progress, retry, cancellation, schedules, mappings, and options APIs
- built-in integration detail tabs for credentials, schedule, health, and logs

### Design Decisions

| Decision | Rationale |
|----------|-----------|
| Provider package, not core module | Required by current integration package model |
| Provider-owned OAuth tab and routes in V1 | Current core integrations UI does not support `oauth` fields end-to-end |
| Bundle credentials store only `clientId` and `clientSecret` in form schema | Keeps built-in credentials tab usable without core changes |
| OAuth tokens stored under bundle credentials record but outside declared form fields | Allows future bundle reuse without exposing unsupported field types |
| Provider-owned `GoogleSheetsSource` entity | Source selection is provider-specific and should not overload generic mapping tables |
| Reuse `sync_mappings` | Mapping persistence already belongs to `data_sync` |
| Reuse `sync_schedules` and built-in schedule tab | Scheduling is already solved generically |
| On-demand token refresh in V1 | Avoids a provider-only background refresh worker while still supporting scheduled syncs |
| Provider-owned importer writes local catalog data inside the adapter/importer | Matches the current `sync-akeneo` pattern and current `data_sync` engine responsibilities |

### Alternatives Considered

| Alternative | Why Rejected |
|-------------|-------------|
| Generic `oauth` credential field rendered by core integrations page | Not fully implemented in the current platform; blocks shipping Google Sheets |
| Store mapping and source config in one provider JSON blob | Duplicates `data_sync` mapping ownership and hurts future generic tooling |
| Add Google connector inside `packages/core/src/modules` | Violates the external integration package model |
| Background refresh worker for tokens in V1 | Extra complexity with little user value over on-demand refresh |

---

## User Stories / Use Cases

- **Admin** wants to enter Google OAuth client credentials once so that the tenant can use its own Google Cloud project.
- **Admin** wants to connect a Google account so that Open Mercato can read spreadsheets available to that account.
- **Admin** wants to pick one spreadsheet and one sheet tab so that the connector imports the correct source.
- **Admin** wants to preview inferred mappings and first rows so that they can validate the source before running sync.
- **Admin** wants scheduled imports so that catalog changes in Google Sheets can flow into Open Mercato without manual CSV uploads.
- **Operator** wants failures and re-auth problems visible in logs and integration health so that support and maintenance are straightforward.

---

## Scope

### In Scope

- Google Workspace bundle and Google Sheets products child integration
- BYO Google Cloud OAuth app setup guide
- static bundle credentials: `clientId`, `clientSecret`
- provider-owned Google account connect/disconnect flow
- encrypted storage of Google token set in the existing integration credentials record
- spreadsheet listing, sheet metadata, header inspection, preview
- source settings: spreadsheet, sheet name, header row, data start row
- mapping persistence through `data_sync` mapping APIs
- schedules through `data_sync` schedule APIs and built-in schedule tab
- import of products through provider-owned importer and catalog commands
- content-hash delta detection using a provider-owned row-state entity
- tenant-scoped health checks and logs

### Out of Scope

- Microsoft 365 and GitHub provider implementations
- Google Drive storage provider
- Google Docs generation
- write-back to Google Sheets
- real-time Google file-change detection
- generic core OAuth renderer
- generic spreadsheet import framework in `data_sync`
- background token refresh worker

---

## Architecture

### Package Placement

The implementation MUST live in a dedicated workspace package:

```text
packages/sync-google-workspace/
```

with source rooted at:

```text
packages/sync-google-workspace/src/modules/sync_google_workspace/
```

and enabled by the app from `apps/mercato/src/modules.ts`.

### Module Structure

```text
packages/sync-google-workspace/
├── package.json
└── src/modules/sync_google_workspace/
    ├── index.ts
    ├── integration.ts
    ├── di.ts
    ├── setup.ts
    ├── cli.ts
    ├── data/
    │   ├── entities.ts
    │   └── validators.ts
    ├── lib/
    │   ├── google-client.ts
    │   ├── oauth-session.ts
    │   ├── oauth.ts
    │   ├── importer.ts
    │   ├── adapter.ts
    │   ├── source-service.ts
    │   ├── row-state-service.ts
    │   ├── preview.ts
    │   ├── health.ts
    │   └── preset.ts
    ├── api/
    │   ├── account/route.ts
    │   ├── oauth/start/route.ts
    │   ├── oauth/callback/route.ts
    │   ├── oauth/disconnect/route.ts
    │   ├── source/route.ts
    │   ├── preview/route.ts
    │   └── spreadsheets/
    │       ├── route.ts
    │       └── [spreadsheetId]/route.ts
    ├── widgets/
    │   ├── injection-table.ts
    │   └── injection/
    │       ├── setup-guide/
    │       │   ├── widget.ts
    │       │   └── widget.client.tsx
    │       ├── google-account/
    │       │   ├── widget.ts
    │       │   └── widget.client.tsx
    │       └── spreadsheet-source/
    │           ├── widget.ts
    │           └── widget.client.tsx
    ├── i18n/
    │   ├── en.json
    │   └── pl.json
    └── __integration__/
        ├── TC-GWS-001.spec.ts
        ├── TC-GWS-002.spec.ts
        └── ...
```

### Integration Definition

The provider exports one bundle and one child integration.

```typescript
import { buildIntegrationDetailWidgetSpotId, type IntegrationBundle, type IntegrationDefinition } from '@open-mercato/shared/modules/integrations/types'

export const googleWorkspaceDetailWidgetSpotId = buildIntegrationDetailWidgetSpotId('sync_google_sheets_products')

export const bundle: IntegrationBundle = {
  id: 'sync_google_workspace',
  title: 'Google Workspace',
  description: 'Google Workspace integrations for spreadsheets and future Google services.',
  icon: 'google-workspace',
  package: '@open-mercato/sync-google-workspace',
  version: '1.0.0',
  author: 'Open Mercato Team',
  credentials: {
    fields: [
      { key: 'clientId', label: 'OAuth Client ID', type: 'text', required: true },
      { key: 'clientSecret', label: 'OAuth Client Secret', type: 'secret', required: true },
    ],
  },
  healthCheck: { service: 'googleWorkspaceHealthCheck' },
}

export const integrations: IntegrationDefinition[] = [
  {
    id: 'sync_google_sheets_products',
    title: 'Google Sheets — Products',
    description: 'Import products from Google Sheets with preview, mapping, and scheduled sync.',
    category: 'data_sync',
    hub: 'data_sync',
    providerKey: 'google_workspace_products',
    bundleId: 'sync_google_workspace',
    package: '@open-mercato/sync-google-workspace',
    version: '1.0.0',
    tags: ['google', 'sheets', 'products', 'import'],
    detailPage: {
      widgetSpotId: googleWorkspaceDetailWidgetSpotId,
    },
  },
]
```

Notes:

- the built-in credentials tab remains usable because the declared schema uses only supported field types
- OAuth tokens are still stored in the bundle credentials record under an internal key such as `oauthTokens`
- future Google child integrations may reuse the same bundle token set

### Integration Detail Page UX

The integration detail page for `sync_google_sheets_products` uses:

- built-in `credentials` tab for `clientId` and `clientSecret`
- built-in `data-sync-schedule` tab for schedules
- built-in `health` tab
- built-in `logs` tab
- UMES-injected `Setup Guide` tab
- UMES-injected `Google Account` tab
- UMES-injected `Spreadsheet Source` tab

This keeps the spec aligned with the current integrations detail page extension model rather than introducing a provider-owned standalone backend page.

### OAuth Model

V1 uses provider-owned OAuth routes and widgets.

Flow:

1. Admin saves `clientId` and `clientSecret` in the built-in credentials tab.
2. Admin opens the injected `Google Account` tab and clicks `Connect`.
3. Provider route creates signed state + PKCE verifier and stores the OAuth session in cache with a short TTL.
4. Provider route returns an authorization URL.
5. Browser redirects to Google.
6. Google redirects back to provider callback route.
7. Provider validates state and exchanges code for tokens.
8. Provider stores the token set under bundle credentials, key `oauthTokens`.
9. Provider clears `reauthRequired` in integration state.
10. Provider redirects back to the integration detail page with a success indicator.

The provider does not depend on the generic `oauth` credential field renderer.

### OAuth Scopes

V1 requests these scopes during the OAuth consent flow:

| Scope | Purpose |
| ------- | --------- |
| `https://www.googleapis.com/auth/spreadsheets.readonly` | Read spreadsheet content for import |
| `https://www.googleapis.com/auth/drive.readonly` | List spreadsheets available to the user, read file metadata |
| `https://www.googleapis.com/auth/userinfo.email` | Display the connected account email in the Google Account tab |

The `drive.readonly` scope grants read access to all files in the user's Google Drive (including Docs, Slides, etc.), but V1 only uses it for listing and reading spreadsheets. This scope is reusable by future child integrations (see below).

### Google Account Identity

When OAuth tokens are obtained, the provider MUST also fetch the user's profile from the Google `userinfo` endpoint to store and display:

- `email` — e.g., `piotr.karwatka@gmail.com`
- `name` — display name (optional, for future use)

This data is persisted alongside `oauthTokens` in bundle credentials under key `oauthProfile`:

```typescript
type GoogleOAuthProfile = {
  email: string
  name?: string
  picture?: string
}
```

The Google Account tab shows this profile info so the admin knows exactly which Google account is connected.

### Future: Google Drive and Docs Access (V2+)

The Google Workspace bundle is designed as an umbrella for multiple child integrations sharing the same OAuth token set. After V1 ships Google Sheets product import, the following child integrations can be added **without changing the bundle, credentials, or OAuth flow**:

| Child Integration | Description | Required Scope Changes |
| --- | --- | --- |
| `google_drive_files` | Browse and attach Google Drive files as product/entity attachments. Admin sees their own files (e.g., `piotr.karwatka@gmail.com`'s Drive). | None — `drive.readonly` already granted |
| `google_docs_viewer` | Preview Google Docs linked to records without downloading. | None — `drive.readonly` already granted |
| `google_sheets_customers` | Import customers from a different sheet. | None — reuses same scopes |
| `google_sheets_orders` | Import orders from a sheet. | None — reuses same scopes |

Each future child integration would:

1. Add a new `IntegrationDefinition` in `integration.ts` with its own `id` and `detailPage.widgetSpotId`
2. Add its own UMES-injected tabs
3. Reuse the existing bundle credentials and OAuth tokens
4. Require no core platform changes

> **Key point**: when an admin connects as `piotr.karwatka@gmail.com`, the `drive.readonly` scope already lets the provider read all files visible to that account. V1 only reads spreadsheets, but V2 can expose a Drive file browser showing the user's docs, folders, and files — all within the same bundle and token set.

### Source Configuration Model

The provider owns source selection because it is Google-specific:

- selected spreadsheet
- selected sheet tab
- header row
- data start row

The provider does not own mapping persistence or schedules:

- field mapping remains in `sync_mappings`
- schedules remain in `sync_schedules`

### Data Sync Execution Model

The current `data_sync` engine is orchestration-focused. It does not perform generic entity persistence itself. The Google provider follows the existing provider pattern:

1. `data_sync` starts a run and resolves credentials and mapping.
2. Google adapter reads rows from Sheets in batches.
3. Provider importer resolves product create/update/skip decisions.
4. Provider importer writes local catalog state through existing catalog commands.
5. Adapter yields `ImportItem[]` that reflect actual outcomes.
6. `data_sync` updates counters, cursor, progress, and logs.

This mirrors the existing `sync-akeneo` approach and avoids inventing a generic entity writer in core.

### Matching and External Identity

For V1:

- supported match strategies:
  - `sku`
  - `externalId`
- unsupported in V1:
  - title-only matching
  - fuzzy matching

The provider constructs a stable external id for row-state tracking from the selected match field, not from row number. Example:

```text
sku:WDG-001
```

This allows row reordering in the sheet without breaking delta detection.

### Token Refresh Strategy

V1 uses on-demand token refresh:

- before any Google API call, the client checks token expiry
- if expiry is near and a refresh token exists, it refreshes synchronously
- on `invalid_grant` or missing refresh token, the provider sets `reauthRequired = true`

V1 does not add a separate background refresh worker.

---

## Data Models

### GoogleSheetsSource

Provider-owned source configuration for one child integration.

```typescript
@Entity({ tableName: 'google_sheets_sources' })
@Index({ properties: ['integrationId', 'organizationId', 'tenantId'], options: { unique: true } })
export class GoogleSheetsSource {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'integration_id', type: 'text' })
  integrationId!: string

  @Property({ name: 'spreadsheet_id', type: 'text' })
  spreadsheetId!: string

  @Property({ name: 'spreadsheet_name', type: 'text' })
  spreadsheetName!: string

  @Property({ name: 'sheet_name', type: 'text' })
  sheetName!: string

  @Property({ name: 'header_row', type: 'int', default: 1 })
  headerRow: number = 1

  @Property({ name: 'data_start_row', type: 'int', default: 2 })
  dataStartRow: number = 2

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}
```

### GoogleSheetsRowState

Provider-owned delta state for row content hashing.

```typescript
@Entity({ tableName: 'google_sheets_row_states' })
@Index({ properties: ['integrationId', 'externalId', 'organizationId', 'tenantId'], options: { unique: true } })
export class GoogleSheetsRowState {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'integration_id', type: 'text' })
  integrationId!: string

  @Property({ name: 'external_id', type: 'text' })
  externalId!: string

  @Property({ name: 'last_hash', type: 'text' })
  lastHash!: string

  @Property({ name: 'last_row_number', type: 'int', nullable: true })
  lastRowNumber?: number | null

  @Property({ name: 'last_seen_at', type: Date, nullable: true })
  lastSeenAt?: Date | null

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}
```

### Stored Credential Shape

Bundle credentials record:

```typescript
type GoogleWorkspaceCredentials = {
  clientId?: string
  clientSecret?: string
  oauthTokens?: {
    accessToken: string
    refreshToken?: string
    expiresAt?: string
    tokenType: 'Bearer'
    scope?: string
    idToken?: string
    rawResponse?: Record<string, unknown>
  }
  oauthProfile?: {
    email: string
    name?: string
    picture?: string
  }
}
```

`oauthTokens` is persisted through `integrationCredentialsService.saveField('sync_google_workspace', 'oauthTokens', tokenSet, scope)`.

`oauthProfile` is persisted through `integrationCredentialsService.saveField('sync_google_workspace', 'oauthProfile', profile, scope)` during the OAuth callback, after fetching `https://www.googleapis.com/oauth2/v2/userinfo`.

### Validation

Provider routes MUST define Zod schemas for:

- OAuth start input
- spreadsheet list/detail query params
- source save payload
- preview request payload
- account disconnect payload if needed

All provider-owned entity queries MUST filter by both `organizationId` and `tenantId`.

---

## API Contracts

All provider routes MUST export `openApi` and `metadata`.

### 1. Get OAuth Account State

- `GET /api/sync_google_workspace/account?integrationId=sync_google_sheets_products`
- Guards: `requireAuth`, `requireFeatures: ['integrations.view']`

Response:

```json
{
  "provider": "google",
  "connected": true,
  "email": "admin@company.com",
  "grantedScopes": [
    "https://www.googleapis.com/auth/spreadsheets.readonly",
    "https://www.googleapis.com/auth/drive.readonly",
    "https://www.googleapis.com/auth/userinfo.email"
  ],
  "expiresAt": "2026-03-24T12:00:00.000Z",
  "reauthRequired": false
}
```

### 2. Start OAuth Flow

- `POST /api/sync_google_workspace/oauth/start`
- Guards: `requireAuth`, `requireFeatures: ['integrations.credentials.manage']`

Request:

```json
{
  "integrationId": "sync_google_sheets_products"
}
```

Response:

```json
{
  "authorizationUrl": "https://accounts.google.com/o/oauth2/v2/auth?..."
}
```

Notes:

- the route resolves bundle credentials for `clientId` and `clientSecret`
- it creates signed state + PKCE verifier
- it stores a short-lived OAuth session in cache

### 3. OAuth Callback

- `GET /api/sync_google_workspace/oauth/callback?code=...&state=...`
- No normal auth guard; authorization is by signed state + cached session

Behavior:

- validate state
- exchange code
- store token set under bundle credentials
- clear `reauthRequired`
- write integration log entry
- redirect to `/backend/integrations/sync_google_sheets_products?tab=google-account&oauth=success`

Error redirect:

```text
/backend/integrations/sync_google_sheets_products?tab=google-account&oauth=error
```

### 4. Disconnect OAuth Account

- `POST /api/sync_google_workspace/oauth/disconnect`
- Guards: `requireAuth`, `requireFeatures: ['integrations.credentials.manage']`

Request:

```json
{
  "integrationId": "sync_google_sheets_products"
}
```

Response:

```json
{
  "ok": true
}
```

Behavior:

- remove `oauthTokens` from bundle credentials
- set `reauthRequired = false`
- keep `clientId` and `clientSecret`

### 5. List Spreadsheets

- `GET /api/sync_google_workspace/spreadsheets?integrationId=sync_google_sheets_products&search=catalog&pageToken=abc`
- Guards: `requireAuth`, `requireFeatures: ['data_sync.configure']`

Response:

```json
{
  "items": [
    {
      "id": "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms",
      "name": "Product Catalog 2026",
      "modifiedTime": "2026-02-24T10:00:00Z",
      "owner": "admin@company.com",
      "sheetCount": 3
    }
  ],
  "nextPageToken": "def"
}
```

### 6. Get Spreadsheet Details

- `GET /api/sync_google_workspace/spreadsheets/:spreadsheetId?integrationId=sync_google_sheets_products`
- Guards: `requireAuth`, `requireFeatures: ['data_sync.configure']`

Response:

```json
{
  "id": "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms",
  "name": "Product Catalog 2026",
  "sheets": [
    { "name": "Products", "rowCount": 1234, "columnCount": 10 },
    { "name": "Categories", "rowCount": 45, "columnCount": 3 }
  ],
  "headers": ["Product Name", "SKU", "Price"],
  "autoMapping": [
    { "externalField": "Product Name", "localField": "title" },
    { "externalField": "SKU", "localField": "sku" },
    { "externalField": "Price", "localField": "basePrice", "transform": "toFloat" }
  ]
}
```

### 7. Get Source Configuration

- `GET /api/sync_google_workspace/source?integrationId=sync_google_sheets_products`
- Guards: `requireAuth`, `requireFeatures: ['data_sync.configure']`

Response:

```json
{
  "source": {
    "spreadsheetId": "1BxiMVs0XRA...",
    "spreadsheetName": "Product Catalog 2026",
    "sheetName": "Products",
    "headerRow": 1,
    "dataStartRow": 2,
    "updatedAt": "2026-03-24T10:00:00.000Z"
  }
}
```

### 8. Save Source Configuration

- `PUT /api/sync_google_workspace/source`
- Guards: `requireAuth`, `requireFeatures: ['data_sync.configure']`

Request:

```json
{
  "integrationId": "sync_google_sheets_products",
  "spreadsheetId": "1BxiMVs0XRA...",
  "spreadsheetName": "Product Catalog 2026",
  "sheetName": "Products",
  "headerRow": 1,
  "dataStartRow": 2,
  "updatedAt": "2026-03-24T10:00:00.000Z"
}
```

Response:

```json
{
  "ok": true,
  "source": {
    "spreadsheetId": "1BxiMVs0XRA...",
    "spreadsheetName": "Product Catalog 2026",
    "sheetName": "Products",
    "headerRow": 1,
    "dataStartRow": 2,
    "updatedAt": "2026-03-24T10:05:00.000Z"
  }
}
```

Notes:

- provider uses optimistic concurrency through `updatedAt`
- mapping and schedule are not saved here

### 9. Preview Import

- `POST /api/sync_google_workspace/preview`
- Guards: `requireAuth`, `requireFeatures: ['data_sync.configure']`

Request:

```json
{
  "integrationId": "sync_google_sheets_products",
  "rows": 5
}
```

Response:

```json
{
  "items": [
    {
      "externalId": "sku:WDG-001",
      "title": "Widget Pro",
      "sku": "WDG-001",
      "basePrice": 29.99,
      "action": "create"
    },
    {
      "externalId": "sku:GDG-002",
      "title": "Gadget Mini",
      "sku": "GDG-002",
      "basePrice": 14.5,
      "action": "update"
    }
  ],
  "mappedColumns": 9,
  "unmappedColumns": 1,
  "warnings": []
}
```

### 10. Trigger Run

Manual runs use the existing data-sync route:

- `POST /api/data_sync/run`

Request:

```json
{
  "integrationId": "sync_google_sheets_products",
  "entityType": "products",
  "direction": "import",
  "fullSync": false,
  "batchSize": 100
}
```

The provider does not add a separate run endpoint.

---

## UI/UX

### Detail Tab Layout

```text
┌─────────────────────────────────────────────────────────────────────────────────┐
│  Google Sheets — Products                                          [Enabled ●]  │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│  [Setup Guide] [Credentials] [Google Account] [Source] [Schedule] [Health] [Logs]│
│  ──────────────────────────────────────────────────────────────────────────────  │
│                                                                                 │
│                         << tab content area >>                                  │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Setup Guide Tab

```text
┌─────────────────────────────────────────────────────────────────────────────────┐
│  Setup Guide                                                                    │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│  1. Create a Google Cloud project                                               │
│     Go to console.cloud.google.com and create a new project                     │
│     or use an existing one.                                                     │
│                                                                                 │
│  2. Enable required APIs                                                        │
│     ┌─────────────────────────────────────────────────┐                         │
│     │  ☑ Google Sheets API                            │                         │
│     │  ☑ Google Drive API                             │                         │
│     └─────────────────────────────────────────────────┘                         │
│                                                                                 │
│  3. Configure OAuth consent screen                                              │
│     Set the app to "Internal" or "External" depending                           │
│     on your organization. Add the scopes listed below.                          │
│                                                                                 │
│  4. Create OAuth client credentials                                             │
│     Type: Web application                                                       │
│                                                                                 │
│     Authorized redirect URI:                                                    │
│     ┌──────────────────────────────────────────────────────────────┬──────────┐  │
│     │  https://your-domain.com/api/sync_google_workspace/         │  [ Copy] │  │
│     │  oauth/callback                                             │          │  │
│     └──────────────────────────────────────────────────────────────┴──────────┘  │
│                                                                                 │
│     ⚠ For local development, use a tunnel like ngrok or cloudflared             │
│       and update the redirect URI accordingly.                                  │
│                                                                                 │
│  5. Required scopes                                                             │
│     • https://www.googleapis.com/auth/spreadsheets.readonly                     │
│     • https://www.googleapis.com/auth/drive.readonly                            │
│     • https://www.googleapis.com/auth/userinfo.email                            │
│                                                                                 │
│  6. Enter Client ID and Client Secret in the Credentials tab                    │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

Shows:

- Google Cloud project setup steps
- required APIs
- required scopes (including `userinfo.email` for account display)
- callback URL copy box with auto-detected current host
- local development tunnel guidance

This tab is static/informational and injected via UMES.

### Google Account Tab

#### State: Disconnected (no OAuth tokens)

```text
┌─────────────────────────────────────────────────────────────────────────────────┐
│  Google Account                                                                 │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│  ┌───────────────────────────────────────────────────────────────────────┐       │
│  │                                                                       │      │
│  │   ○  No Google account connected                                      │      │
│  │                                                                       │      │
│  │   Connect a Google account to allow Open Mercato to read              │      │
│  │   your spreadsheets. You will be redirected to Google to              │      │
│  │   authorize access.                                                   │      │
│  │                                                                       │      │
│  │   [ Connect Google Account ]                                          │      │
│  │                                                                       │      │
│  └───────────────────────────────────────────────────────────────────────┘       │
│                                                                                 │
│  ⓘ Make sure Client ID and Client Secret are saved in the Credentials tab       │
│    before connecting.                                                           │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

#### State: Connected

```text
┌─────────────────────────────────────────────────────────────────────────────────┐
│  Google Account                                                                 │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│  ┌───────────────────────────────────────────────────────────────────────┐       │
│  │                                                                       │      │
│  │   ● Connected                                                         │      │
│  │                                                                       │      │
│  │   📧  piotr.karwatka@gmail.com                                        │      │
│  │                                                                       │      │
│  │   Scopes granted:                                                     │      │
│  │     • Spreadsheets (read-only)                                        │      │
│  │     • Drive (read-only)                                               │      │
│  │     • User info (email)                                               │      │
│  │                                                                       │      │
│  │   Token expires: 2026-03-24 14:00 UTC                                 │      │
│  │                                                                       │      │
│  │   [ Reconnect ]                     [ Disconnect ]                    │      │
│  │                                                                       │      │
│  └───────────────────────────────────────────────────────────────────────┘       │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

#### State: Re-authentication Required

```text
┌─────────────────────────────────────────────────────────────────────────────────┐
│  Google Account                                                                 │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│  ┌───────────────────────────────────────────────────────────────────────┐       │
│  │                                                                       │      │
│  │   ⚠ Re-authentication required                                        │      │
│  │                                                                       │      │
│  │   📧  piotr.karwatka@gmail.com                                        │      │
│  │                                                                       │      │
│  │   The connection to Google has expired or been revoked.               │      │
│  │   Scheduled imports are paused until you reconnect.                   │      │
│  │                                                                       │      │
│  │   [ Reconnect Now ]                  [ Disconnect ]                   │      │
│  │                                                                       │      │
│  └───────────────────────────────────────────────────────────────────────┘       │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

All buttons MUST use shared `Button`/`IconButton` primitives.

### Spreadsheet Source Tab

#### State: No source selected

```text
┌─────────────────────────────────────────────────────────────────────────────────┐
│  Spreadsheet Source                                                             │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│  Search spreadsheets  [ catalog________________ ] [🔍]                          │
│                                                                                 │
│  ┌──────────────────────────────────────────────────────┬──────────┬──────────┐  │
│  │  Name                                                │  Sheets  │ Modified │  │
│  ├──────────────────────────────────────────────────────┼──────────┼──────────┤  │
│  │  📗 Product Catalog 2026                             │    3     │ Mar 24   │  │
│  │  📗 Inventory Sheet                                  │    1     │ Mar 20   │  │
│  │  📗 Spring Collection                                │    2     │ Mar 15   │  │
│  └──────────────────────────────────────────────────────┴──────────┴──────────┘  │
│                                                                                 │
│  [< Prev]                                                        [Next >]       │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

#### State: Spreadsheet selected — sheet and header configuration

```text
┌─────────────────────────────────────────────────────────────────────────────────┐
│  Spreadsheet Source                                                             │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│  Selected: 📗 Product Catalog 2026                           [ Change ]         │
│                                                                                 │
│  Sheet tab:       [ Products          ▾ ]                                       │
│  Header row:      [ 1                   ]                                       │
│  Data start row:  [ 2                   ]                                       │
│                                                                                 │
│  ── Detected Headers ──────────────────────────────────────────────────────────  │
│                                                                                 │
│  ┌─────────────────┬──────────────────┬──────────────┐                          │
│  │  Sheet Column    │  Maps To         │  Transform   │                         │
│  ├─────────────────┼──────────────────┼──────────────┤                          │
│  │  Product Name    │  title       ✓   │  —           │                         │
│  │  SKU             │  sku         ✓   │  trim        │                         │
│  │  Price           │  basePrice   ✓   │  toFloat     │                         │
│  │  Description     │  description ✓   │  —           │                         │
│  │  Weight          │  weight      ✓   │  toFloat     │                         │
│  │  Active          │  isActive    ✓   │  toBool      │                         │
│  │  Notes           │  ⚠ unmapped      │  —           │                         │
│  └─────────────────┴──────────────────┴──────────────┘                          │
│                                                                                 │
│  9 of 10 columns mapped · 1 unmapped                                            │
│                                                                                 │
│  ── Preview (first 5 rows) ──────────────────────────────────────────────────── │
│                                                                                 │
│  ┌──────────┬─────────────┬───────┬─────────┬────────┐                          │
│  │  SKU     │  Title       │ Price │ Action  │ Delta  │                         │
│  ├──────────┼─────────────┼───────┼─────────┼────────┤                          │
│  │  WDG-001 │  Widget Pro  │ 29.99 │ create  │  new   │                         │
│  │  GDG-002 │  Gadget Mini │ 14.50 │ update  │  changed│                        │
│  │  CBL-003 │  Cable XL    │  9.99 │ skip    │  same  │                         │
│  └──────────┴─────────────┴───────┴─────────┴────────┘                          │
│                                                                                 │
│                                          [ Save Source ]  [ Run Import Now ]    │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

#### State: Google account not connected (disabled)

```text
┌─────────────────────────────────────────────────────────────────────────────────┐
│  Spreadsheet Source                                                             │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│  ┌───────────────────────────────────────────────────────────────────────┐       │
│  │                                                                       │      │
│  │   ⚠ Connect a Google account first                                    │      │
│  │                                                                       │      │
│  │   Go to the Google Account tab to connect your Google account         │      │
│  │   before selecting a spreadsheet source.                              │      │
│  │                                                                       │      │
│  └───────────────────────────────────────────────────────────────────────┘       │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

The actual field mapping editor remains the generic `data_sync` mapping flow.

### User-Facing Constraints in V1

- V1 product mapping supports a documented subset only
- unsupported columns are previewed as unmapped, not silently discarded
- if no Google account is connected, spreadsheet and preview screens are disabled with clear guidance

---

## Product Import Rules

V1 product import supports:

- product title
- product description
- product SKU
- product barcode
- base price
- active flag
- weight value and weight unit

V1 may optionally support:

- simple category assignment by category name
- one primary image URL if attachment import is implemented safely

V1 does not support:

- multi-variant spreadsheet modeling
- complex offer/channel pricing matrices
- inventory synchronization into a stock subsystem not defined in this provider
- rich media galleries

### Mapping Rules

- `title` is required for create
- `sku` is required when match strategy is `sku`
- `externalId` match strategy requires a mapped external-id column
- transforms supported in V1:
  - `toInt`
  - `toFloat`
  - `toBool`
  - `trim`
- unknown transform names are validation errors

### Catalog Persistence Rules

The importer MUST write through existing catalog commands, not raw cross-module helpers for side effects.

V1 command usage:

- create product: `catalog.products.create`
- update product: `catalog.products.update`
- create variant if needed for SKU-centric storage: `catalog.variants.create`
- update variant if needed: `catalog.variants.update`

The exact command graph may be simplified if the provider chooses a stable product-plus-default-variant model, but the spec MUST keep writes command-based and reversible where the target command already supports undo.

---

## Internationalization (i18n)

The provider MUST define locale keys for:

- setup guide copy
- account state labels
- connect/reconnect/disconnect actions
- source selection labels
- preview warnings and errors
- health-check messages
- log-facing summary messages where surfaced to the UI

No user-facing strings may be hard-coded in widgets or route-generated UI payloads.

---

## Migration & Compatibility

This spec is additive.

Additive changes only:

- new package `@open-mercato/sync-google-workspace`
- new provider-owned entities
- new provider-owned API routes
- new integration IDs
- new bundle ID
- new widget spot usage through existing integration detail extension surface

This spec does not rename or remove:

- existing integration routes
- existing `data_sync` routes
- existing event IDs
- existing detail-page spot IDs
- existing DI service names

Legacy compatibility note:

- the spec intentionally does not depend on the generic `oauth` credential field renderer from earlier foundation drafts
- if generic OAuth support is added later, the provider MAY adopt it behind a compatibility bridge, but V1 MUST NOT block on that future work

---

## Phasing

### Phase 1: Provider Foundation

Deliver:

- package scaffold
- integration definition
- bundle credentials for client ID/secret
- provider-owned entities
- DI wiring
- setup guide tab

### Phase 2: OAuth and Account UX

Deliver:

- provider-owned OAuth start/callback/disconnect routes
- OAuth session storage with PKCE
- Google account tab
- token persistence into bundle credentials
- reconnect handling through `reauthRequired`

### Phase 3: Source Selection and Preview

Deliver:

- spreadsheets list/detail routes
- source entity CRUD
- spreadsheet source tab
- preview route
- header auto-detection and transform inference

### Phase 4: Data Sync Import

Deliver:

- `DataSyncAdapter`
- provider importer
- row-state delta tracking
- manual run via existing `data_sync` API
- schedule reuse via existing `data_sync` schedule UI/API

### Phase 5: Hardening

Deliver:

- health check
- provider logs
- retry/reauth failure paths
- integration and unit tests
- docs for BYO Google Cloud setup

---

## Implementation Plan

### Phase 1: Package and Integration Registration

1. Create `packages/sync-google-workspace/`.
2. Add package build/test config and module exports.
3. Create `integration.ts` with bundle and child integration definitions.
4. Register detail-page widget spot via `detailPage.widgetSpotId`.
5. Add the package to `apps/mercato/src/modules.ts`.

### Phase 2: Provider Data Model and Services

1. Create `GoogleSheetsSource`.
2. Create `GoogleSheetsRowState`.
3. Add Zod schemas for source save, preview, spreadsheet queries, and OAuth start.
4. Implement source and row-state services through DI.
5. Generate migrations with `yarn db:generate`.

### Phase 3: OAuth Flow

1. Implement cache-backed OAuth session helper with TTL and PKCE verifier.
2. Implement Google auth URL builder.
3. Implement callback token exchange and credential persistence.
4. Implement account disconnect.
5. Inject Google Account widget tab.

### Phase 4: Source Selection and Preview

1. Implement Google client list/read helpers.
2. Implement spreadsheet list/detail routes.
3. Implement source get/save route.
4. Implement preview route.
5. Inject Setup Guide and Spreadsheet Source tabs.

### Phase 5: Adapter and Importer

1. Implement provider mapping inference.
2. Implement provider importer using catalog commands.
3. Implement `DataSyncAdapter` with `supportedEntities = ['products']`.
4. Implement row hash delta detection.
5. Register adapter in DI.

### Phase 6: Health, Logs, and Tests

1. Implement health check service.
2. Add provider-specific log messages.
3. Add integration coverage for routes and runs.
4. Add unit tests for OAuth/session/preview/hash logic.
5. Document setup and local tunnel workflow.

### File Manifest

| File | Action | Purpose |
|------|--------|---------|
| `packages/sync-google-workspace/package.json` | Create | Workspace package manifest |
| `packages/sync-google-workspace/src/modules/sync_google_workspace/integration.ts` | Create | Bundle + integration definitions |
| `packages/sync-google-workspace/src/modules/sync_google_workspace/data/entities.ts` | Create | Provider-owned source and row-state entities |
| `packages/sync-google-workspace/src/modules/sync_google_workspace/api/oauth/start/route.ts` | Create | OAuth start |
| `packages/sync-google-workspace/src/modules/sync_google_workspace/api/oauth/callback/route.ts` | Create | OAuth callback |
| `packages/sync-google-workspace/src/modules/sync_google_workspace/api/source/route.ts` | Create | Source CRUD |
| `packages/sync-google-workspace/src/modules/sync_google_workspace/api/preview/route.ts` | Create | Preview |
| `packages/sync-google-workspace/src/modules/sync_google_workspace/lib/adapter.ts` | Create | Data sync adapter |
| `packages/sync-google-workspace/src/modules/sync_google_workspace/lib/importer.ts` | Create | Catalog write orchestration |
| `packages/sync-google-workspace/src/modules/sync_google_workspace/widgets/injection-table.ts` | Create | Detail tab registration |

### Testing Strategy

- unit tests:
  - auth URL construction
  - PKCE/state validation
  - token refresh behavior
  - header inference
  - row hash comparison
- integration tests:
  - OAuth happy path with stubbed Google responses
  - OAuth denial/state mismatch
  - spreadsheet list/detail
  - source save/load
  - preview
  - manual run
  - scheduled run
  - cross-tenant isolation

---

## Risks & Impact Review

#### Google OAuth App Misconfiguration
- **Scenario**: Admin saves wrong client credentials or configures a callback URL that does not match the current host/tunnel.
- **Severity**: High
- **Affected area**: OAuth connect flow, spreadsheet access, scheduled imports
- **Mitigation**: Setup Guide tab includes exact callback URL copy UI; OAuth start validates presence of client credentials before redirect; callback failures are logged with actionable messages.
- **Residual risk**: Google-side propagation delays and operator error can still temporarily block connection.

#### Refresh Token Revoked or Missing
- **Scenario**: Google returns `invalid_grant`, or the granted token set does not include a usable refresh token.
- **Severity**: High
- **Affected area**: Scheduled syncs, manual spreadsheet listing, preview
- **Mitigation**: On-demand refresh marks `reauthRequired = true`, health check returns `unhealthy`, Google Account tab shows reconnect state, logs capture the failure.
- **Residual risk**: Scheduled sync remains blocked until an admin reconnects.

#### Spreadsheet Structure Drift
- **Scenario**: Admin renames headers, removes columns, or changes the selected sheet contents after mapping was configured.
- **Severity**: High
- **Affected area**: Preview accuracy, import correctness
- **Mitigation**: Preview and sync re-read current headers each time; missing mapped headers produce warnings or validation errors; unknown headers are treated as unmapped.
- **Residual risk**: A header may be renamed to another valid field-like name and still require manual review.

#### Product Shape Too Complex for V1
- **Scenario**: Merchant expects variants, channel pricing, inventory, categories, and media to import from a single flat sheet.
- **Severity**: High
- **Affected area**: Scope control, implementation timeline, support burden
- **Mitigation**: V1 scope is explicit and narrow; unsupported mappings are surfaced clearly in preview; complex product modeling is deferred.
- **Residual risk**: Some merchants will need manual follow-up workflows for unsupported data.

#### Cross-Tenant Credential or Source Leakage
- **Scenario**: Provider queries credentials, source config, or row-state records without both tenant and organization scope.
- **Severity**: Critical
- **Affected area**: Security and tenant isolation
- **Mitigation**: Every provider service and route explicitly scopes by `organizationId` and `tenantId`; integration tests cover two-tenant isolation.
- **Residual risk**: Residual risk is low if review and tests catch missing scope filters.

#### Duplicate Scheduling Ownership
- **Scenario**: Provider accidentally stores schedule values in source config while `data_sync` also stores schedules.
- **Severity**: Medium
- **Affected area**: Admin UX, scheduler correctness
- **Mitigation**: Source entity deliberately excludes schedule fields; built-in `data-sync-schedule` tab remains the only schedule editor.
- **Residual risk**: None if implementation follows this spec.

#### Delta State False Positives or False Negatives
- **Scenario**: Match key changes, or row hashing uses the wrong normalized data, causing unnecessary updates or missed updates.
- **Severity**: Medium
- **Affected area**: Import efficiency and correctness
- **Mitigation**: External id is derived from the selected stable match field; hashing uses normalized mapped source data; tests cover unchanged and changed rows.
- **Residual risk**: Match-strategy changes may require a one-time full sync reset.

#### Google API Rate Limiting
- **Scenario**: Large spreadsheets or repeated previews hit Google read quotas.
- **Severity**: Medium
- **Affected area**: Spreadsheet browsing, sync throughput
- **Mitigation**: Batch reads, page-size caps, retry/backoff in Google client, no unnecessary metadata fan-out.
- **Residual risk**: Extremely large sheets may still import slowly at quota boundaries.

#### OAuth Session Replay or Expiry Issues
- **Scenario**: Callback uses expired or replayed state.
- **Severity**: High
- **Affected area**: OAuth security
- **Mitigation**: Short TTL cache entry, one-time state consumption, PKCE verifier binding, signed state payload.
- **Residual risk**: Low if state invalidation is implemented correctly.

---

## Final Compliance Report — 2026-03-24

### AGENTS.md Files Reviewed
- `AGENTS.md` (root)
- `.ai/specs/AGENTS.md`
- `packages/core/AGENTS.md`
- `packages/core/src/modules/integrations/AGENTS.md`
- `packages/core/src/modules/data_sync/AGENTS.md`
- `packages/core/src/modules/catalog/AGENTS.md`
- `packages/ui/AGENTS.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| root AGENTS.md | External integration providers must be dedicated workspace packages | Compliant | Provider lives in `packages/sync-google-workspace/` |
| root AGENTS.md | No direct ORM relationships between modules | Compliant | Provider uses IDs and catalog commands, not cross-module ORM links |
| root AGENTS.md | Always scope tenant data by `organization_id` and `tenant_id` | Compliant | Explicit in provider entities, routes, and risks |
| root AGENTS.md | API routes must use Zod validation | Compliant | Provider validators are part of the plan |
| root AGENTS.md | API routes must export `openApi` | Compliant | Explicit for every provider route |
| `.ai/specs/AGENTS.md` | Keep specs implementation-accurate | Compliant | Rewritten to current package/UI/data-sync contracts |
| `packages/core/AGENTS.md` | Integration provider env presets belong in provider package setup | Compliant | `preset.ts` and `setup.ts` are provider-owned |
| `packages/core/src/modules/integrations/AGENTS.md` | Providers may extend detail page through UMES widget spot | Compliant | Uses `detailPage.widgetSpotId` and injected tabs |
| `packages/core/src/modules/integrations/AGENTS.md` | Do not add provider-specific logic to core integrations module | Compliant | OAuth and source flows stay in provider package |
| `packages/core/src/modules/data_sync/AGENTS.md` | Use queue system and existing data sync lifecycle | Compliant | Manual and scheduled runs use existing `data_sync` APIs and workers |
| `packages/core/src/modules/data_sync/AGENTS.md` | Persist mapping and schedules through normal sync services | Compliant | Mapping and schedules stay in generic `data_sync` storage |
| `packages/core/src/modules/catalog/AGENTS.md` | Do not reimplement pricing logic ad hoc | Compliant | Import writes through existing catalog commands |
| `packages/ui/AGENTS.md` | Use shared button/form/dialog primitives | Compliant | Explicit in injected tab UX section |

### Internal Consistency Check

| Check | Status | Notes |
|-------|--------|-------|
| Data models match API contracts | Pass | Source and row-state entities align with provider routes |
| API contracts match UI/UX section | Pass | Tabs map directly to provider routes and built-in tabs |
| Risks cover all write operations | Pass | Covers OAuth persistence, source save, scheduled sync, delta state |
| Commands defined for all mutations | Pass | Product writes use catalog commands; config writes are provider service writes |
| Cache/session strategy covers OAuth flow | Pass | Short-lived cached session defined for state + PKCE |

### Non-Compliant Items

None.

### Verdict

- **Fully compliant**: Approved — ready for implementation

## Changelog

### 2026-03-24 (v3)

- Added ASCII UI mockups for all tab states: Setup Guide, Google Account (disconnected/connected/reauth), Spreadsheet Source (no source/selected/disabled).
- Added OAuth Scopes section with explicit scope table.
- Added Google Account Identity section: `userinfo.email` scope, `oauthProfile` credential key, profile fetch during callback.
- Added Future: Google Drive and Docs Access (V2+) section describing how the bundle supports future child integrations (`google_drive_files`, `google_docs_viewer`, `google_sheets_customers`, `google_sheets_orders`) with zero core changes.
- Updated `GoogleWorkspaceCredentials` type to include `oauthProfile` field.
- Updated account state API response to include `userinfo.email` scope.

### 2026-03-24
- Rewrote the spec to the current architecture: dedicated provider package, provider-owned OAuth/account flow, provider-owned source config, reuse of `data_sync` mappings and schedules, and provider-owned row-state delta tracking.

### 2026-02-24
- Initial draft — Google Workspace integration with Sheets product import, OAuth setup guide, column mapping, scheduled sync.

### Review — 2026-03-24
- **Reviewer**: Agent
- **Security**: Passed
- **Performance**: Passed
- **Cache**: Passed
- **Commands**: Passed
- **Risks**: Passed
- **Verdict**: Approved
