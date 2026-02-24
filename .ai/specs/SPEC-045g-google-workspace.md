# SPEC-045g — Google Workspace Integration: Spreadsheet Product Import

**Parent**: [SPEC-045 — Integration Marketplace](./SPEC-045-2026-02-24-integration-marketplace.md)
**Depends on**: [SPEC-045a — Foundation](./SPEC-045a-foundation.md) (§8 OAuth, §2 Credentials), [SPEC-045b — Data Sync Hub](./SPEC-045b-data-sync-hub.md) (DataSyncAdapter)

| Field | Value |
|-------|-------|
| **Status** | Draft |
| **Author** | Piotr Karwatka |
| **Created** | 2026-02-24 |
| **Category** | `data_sync` |
| **Hub** | `data_sync` |

---

## TLDR

Build a Google Workspace integration bundle (`sync_google_workspace`) that lets an admin connect their Google account via OAuth 2.0, pick a Google Spreadsheet, configure field mapping between spreadsheet columns and Open Mercato product fields, and import products — with support for scheduled background sync. This spec covers the full end-to-end flow: Google Cloud project setup, OAuth consent, spreadsheet selection, column mapping, import execution, and background scheduled sync.

The same OAuth infrastructure supports future Microsoft 365 (Excel Online via Microsoft Graph) and GitHub integrations — they only need different `OAuthConfig` parameters and adapter implementations. The credential types, token lifecycle, and admin UX are identical across all OAuth providers.

---

## 1. Problem Statement

Many merchants manage product catalogs in Google Sheets — especially during initial setup, bulk updates, or when working with suppliers who share data via spreadsheets. Currently, to import products from a Google Sheet, the admin must:

1. Export as CSV from Google Sheets
2. Download the file
3. Upload it to Open Mercato's CSV import

This is manual, error-prone, and cannot run in the background. A direct Google Sheets integration eliminates these steps and enables automated, scheduled product sync.

---

## 2. Design Principles

| # | Principle | Rationale |
|---|-----------|-----------|
| 1 | **Admin brings their own Google Cloud project** | No shared platform OAuth app — each tenant controls their own API quotas, consent screen branding, and token revocation |
| 2 | **Reuses SPEC-045a OAuth infrastructure** | OAuth flow, token storage, background refresh — all from the foundation layer |
| 3 | **Reuses SPEC-045b DataSyncAdapter** | Streaming, resumable, queue-based import with progress tracking |
| 4 | **Column mapping is configurable** | Admin maps spreadsheet columns to product fields via the data sync mapping UI |
| 5 | **Provider-agnostic OAuth pattern** | Same admin UX works for Google, Microsoft, GitHub — only the `OAuthConfig` differs |
| 6 | **Background sync after one-time setup** | Once connected and configured, the integration runs on schedule without admin intervention |

---

## 3. Prerequisites — Google Cloud Project Setup

Before using this integration, the admin must create a Google Cloud project and configure OAuth consent. This is a one-time setup per organization.

### 3.1 Step-by-Step Google Cloud Configuration

The integration detail page (`/backend/integrations/sync_google_workspace`) includes a "Setup Guide" tab with these instructions:

#### Step 1: Create a Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Click **Select a project** → **New Project**
3. Name it (e.g., "Open Mercato Integration") → **Create**

#### Step 2: Enable Required APIs

1. Go to **APIs & Services** → **Library**
2. Search for and enable:
   - **Google Sheets API** — read spreadsheet data
   - **Google Drive API** — list and select spreadsheets

#### Step 3: Configure OAuth Consent Screen

1. Go to **APIs & Services** → **OAuth consent screen**
2. Select **External** user type → **Create**
3. Fill in:
   - App name: your company name
   - User support email: your admin email
   - Developer contact: your admin email
4. Click **Save and Continue**
5. Add scopes:
   - `https://www.googleapis.com/auth/spreadsheets.readonly`
   - `https://www.googleapis.com/auth/drive.readonly`
6. Click **Save and Continue**
7. Add test users (your Google account email) → **Save**
8. **Note**: For production, submit the app for Google verification

#### Step 4: Create OAuth Credentials

1. Go to **APIs & Services** → **Credentials**
2. Click **Create Credentials** → **OAuth client ID**
3. Application type: **Web application**
4. Name: "Open Mercato"
5. Authorized redirect URIs: add your Open Mercato callback URL:
   ```
   https://your-domain.com/api/integrations/oauth/callback
   ```
6. Click **Create**
7. Copy the **Client ID** and **Client Secret**

#### Step 5: Enter Credentials in Open Mercato

1. Go to **Integrations** → **Google Workspace** → **Credentials** tab
2. Paste the **Client ID** and **Client Secret**
3. Click **Save**
4. Click **Connect** on the Google Account field
5. Complete the Google consent flow
6. You should see "Connected" status

### 3.2 Local Development with Tunnels (ngrok / Cloudflare Tunnel / localtunnel)

Google OAuth requires HTTPS redirect URIs — `localhost` does not work. During local development, use a tunnel to expose your local Open Mercato instance to the internet.

#### Option A: ngrok (Recommended for Development)

1. Install ngrok: `brew install ngrok` (macOS) or download from [ngrok.com](https://ngrok.com)
2. Sign up for a free ngrok account and authenticate:
   ```bash
   ngrok config add-authtoken YOUR_AUTH_TOKEN
   ```
3. Start your Open Mercato dev server:
   ```bash
   yarn dev
   ```
4. In a separate terminal, start the ngrok tunnel pointing to your dev server port:
   ```bash
   ngrok http 3000
   ```
5. ngrok displays a public URL, e.g.:
   ```
   Forwarding   https://a1b2c3d4.ngrok-free.app → http://localhost:3000
   ```
6. Copy the HTTPS URL and configure it in Google Cloud Console:
   - Go to **APIs & Services** → **Credentials** → click your OAuth Client ID
   - Under **Authorized redirect URIs**, add:
     ```
     https://a1b2c3d4.ngrok-free.app/api/integrations/oauth/callback
     ```
   - Click **Save**
7. **Important**: The free ngrok tier generates a new URL on every restart. When the URL changes:
   - Update the redirect URI in Google Cloud Console
   - Wait ~30 seconds for Google to propagate the change
8. **Tip**: Use ngrok's paid plan for a stable subdomain (`ngrok http --domain=your-name.ngrok-free.app 3000`) to avoid reconfiguring the redirect URI each time

#### Option B: Cloudflare Tunnel (Free, Stable URL)

1. Install cloudflared: `brew install cloudflare/cloudflare/cloudflared`
2. Login to Cloudflare:
   ```bash
   cloudflared tunnel login
   ```
3. Create a named tunnel:
   ```bash
   cloudflared tunnel create open-mercato-dev
   ```
4. Route a subdomain to the tunnel:
   ```bash
   cloudflared tunnel route dns open-mercato-dev dev-mercato.your-domain.com
   ```
5. Start the tunnel:
   ```bash
   cloudflared tunnel run --url http://localhost:3000 open-mercato-dev
   ```
6. Add the redirect URI in Google Cloud Console:
   ```
   https://dev-mercato.your-domain.com/api/integrations/oauth/callback
   ```
7. **Advantage**: The URL is stable — no reconfiguration needed between restarts

#### Option C: localtunnel (Zero Setup)

1. Run directly with npx (no install needed):
   ```bash
   npx localtunnel --port 3000 --subdomain open-mercato-dev
   ```
2. Add the redirect URI in Google Cloud Console:
   ```
   https://open-mercato-dev.loca.lt/api/integrations/oauth/callback
   ```
3. **Note**: localtunnel shows an interstitial page on first visit — click through it

#### Google Cloud Console Configuration for Tunnels

Regardless of which tunnel you use, the Google side configuration is the same:

1. Go to [Google Cloud Console](https://console.cloud.google.com/) → **APIs & Services** → **Credentials**
2. Click your OAuth 2.0 Client ID
3. Under **Authorized redirect URIs**, add your tunnel URL:
   ```
   https://<your-tunnel-url>/api/integrations/oauth/callback
   ```
4. Under **Authorized JavaScript origins** (optional, for client-side flows), add:
   ```
   https://<your-tunnel-url>
   ```
5. Click **Save**
6. **Important**: Google may take up to 5 minutes to propagate redirect URI changes. If you get a "redirect_uri_mismatch" error, wait and retry.

**Multiple redirect URIs**: Google allows multiple redirect URIs on the same OAuth Client ID. You can add both your production URL and your tunnel URL simultaneously:
```
https://your-production-domain.com/api/integrations/oauth/callback
https://a1b2c3d4.ngrok-free.app/api/integrations/oauth/callback
https://dev-mercato.your-domain.com/api/integrations/oauth/callback
```

This way, the same Client ID works for both production and development environments. Remove development URIs before publishing the app for Google verification.

#### Platform Callback URL Resolution

The platform must generate the correct `redirect_uri` matching the incoming request's host. The OAuth start endpoint (`POST /api/integrations/:id/oauth/start`) builds the callback URL from the request's `Host` header:

```typescript
function buildCallbackUrl(req: ApiRequest): string {
  const protocol = req.headers['x-forwarded-proto'] ?? 'https'
  const host = req.headers['x-forwarded-host'] ?? req.headers.host
  return `${protocol}://${host}/api/integrations/oauth/callback`
}
```

This ensures the same code works with any tunnel or production domain — no environment variables needed for the redirect URI.

### 3.3 Setup Guide UI

The integration detail page shows this as a collapsible step-by-step guide:

```
┌─────────────────────────────────────────────────────────────────────┐
│  ← Back to Integrations                                             │
│                                                                     │
│  [Google Icon]  Google Workspace              [Not Connected]       │
│  Import products from Google Sheets                                 │
│                                                                     │
│  [Setup Guide] [Credentials] [Spreadsheets] [Health] [Logs]         │
│                                                                     │
│  ── Setup Guide ────────────────────────────────────────────────── │
│                                                                     │
│  Follow these steps to connect Google Workspace:                    │
│                                                                     │
│  ✅ Step 1: Create a Google Cloud Project                            │
│     Go to console.cloud.google.com and create a new project.       │
│     ▸ Detailed instructions                                        │
│                                                                     │
│  ✅ Step 2: Enable Google Sheets API and Google Drive API            │
│     ▸ Detailed instructions                                        │
│                                                                     │
│  ○ Step 3: Configure OAuth Consent Screen                           │
│     ▸ Detailed instructions                                        │
│                                                                     │
│  ○ Step 4: Create OAuth Client ID                                   │
│     Your redirect URI:                                              │
│     ┌──────────────────────────────────────────────────────────┐    │
│     │ https://your-domain.com/api/integrations/oauth/callback  │    │
│     └──────────────────────────────────────────────────────────┘    │
│     [Copy]                                                          │
│                                                                     │
│  ○ Step 5: Enter Client ID and Secret below, then click Connect    │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 4. Integration Definition

### 4.1 Bundle Declaration

```typescript
// sync_google_workspace/integration.ts

import type { IntegrationDefinition, IntegrationBundle } from '@open-mercato/shared/modules/integrations'

export const bundle: IntegrationBundle = {
  id: 'sync_google_workspace',
  title: 'Google Workspace',
  description: 'Import products from Google Sheets with configurable field mapping and scheduled sync.',
  icon: 'google-workspace',
  package: '@open-mercato/sync-google-workspace',
  version: '1.0.0',
  author: 'Open Mercato Team',
  license: 'MIT',

  credentials: {
    fields: [
      { key: 'clientId', label: 'OAuth Client ID', type: 'text', required: true },
      { key: 'clientSecret', label: 'OAuth Client Secret', type: 'secret', required: true },
      {
        key: 'oauthTokens',
        label: 'Google Account',
        type: 'oauth',
        required: true,
        oauth: {
          provider: 'google',
          authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
          tokenUrl: 'https://oauth2.googleapis.com/token',
          scopes: [
            'https://www.googleapis.com/auth/spreadsheets.readonly',
            'https://www.googleapis.com/auth/drive.readonly',
          ],
          usePkce: true,
          refreshStrategy: 'background',
          refreshBeforeExpiryMinutes: 5,
          authParams: {
            access_type: 'offline',
            prompt: 'consent',
          },
        },
      },
    ],
  },

  healthCheck: { service: 'googleWorkspaceHealthCheck' },
}

export const integrations: IntegrationDefinition[] = [
  {
    id: 'sync_google_sheets_products',
    title: 'Google Sheets — Products',
    description: 'Import products from a Google Spreadsheet with configurable column-to-field mapping.',
    category: 'data_sync',
    hub: 'data_sync',
    providerKey: 'google_sheets_products',
    bundleId: 'sync_google_workspace',
    tags: ['products', 'spreadsheets', 'google', 'import'],
    credentials: { fields: [] },  // Inherits from bundle
  },
]
```

### 4.2 Future Integrations in This Bundle

The bundle is designed to grow. Future integrations within the same bundle:

| ID | Title | Category | Description |
|----|-------|----------|-------------|
| `sync_google_sheets_customers` | Google Sheets — Customers | `data_sync` | Import contacts/customers from a Google Sheet |
| `sync_google_sheets_orders` | Google Sheets — Orders | `data_sync` | Import orders from a Google Sheet |
| `sync_google_drive_assets` | Google Drive — Assets | `storage` | Use Google Drive as a media/asset storage backend |

All share the same OAuth tokens and Google Cloud project.

---

## 5. Module Structure

```
packages/core/src/modules/sync_google_workspace/
├── index.ts                           # Module metadata
├── integration.ts                     # Bundle + integration definitions (§4.1)
├── setup.ts                           # Register adapters, health check
├── di.ts                              # Google API client, health check service
├── lib/
│   ├── google-client.ts               # Google Sheets + Drive API client wrapper
│   ├── adapters/
│   │   └── sheets-products.ts         # DataSyncAdapter for spreadsheet → products
│   ├── spreadsheet-selector.ts        # List spreadsheets, list sheets within a spreadsheet
│   ├── column-detector.ts             # Auto-detect column types from header row
│   └── health.ts                      # HealthCheckable — verifies API access
├── data/
│   ├── entities.ts                    # GoogleSheetsConfig (spreadsheet selection + settings)
│   └── validators.ts                  # Zod schemas
├── api/
│   ├── get/google-workspace/spreadsheets.ts       # List available spreadsheets
│   ├── get/google-workspace/spreadsheets/[id].ts  # List sheets + columns in a spreadsheet
│   ├── get/google-workspace/config.ts             # Get current config (selected spreadsheet + mapping)
│   ├── put/google-workspace/config.ts             # Save config
│   └── post/google-workspace/preview.ts           # Preview first 5 rows with mapping applied
├── backend/
│   └── google-workspace/
│       ├── page.tsx                   # Setup guide + config page
│       └── spreadsheets/page.tsx      # Spreadsheet browser/selector
├── workers/
│   └── scheduled-sync.ts             # Scheduled background import
└── i18n/
    ├── en.ts
    └── pl.ts
```

---

## 6. End-to-End Flow

### 6.1 Complete Setup and First Import

```
PHASE 1: GOOGLE CLOUD SETUP (one-time, in Google Cloud Console)
───────────────────────────────────────────────────────────────
Admin follows the Setup Guide (§3.1) to create a Google Cloud
project, enable APIs, configure OAuth consent, and create
OAuth credentials.

PHASE 2: CONNECT (one-time, in Open Mercato admin)
───────────────────────────────────────────────────
1. Admin enters Client ID + Client Secret → Save
2. Admin clicks "Connect" → Google OAuth consent screen
3. Admin grants spreadsheets.readonly + drive.readonly
4. Redirect back → tokens stored (encrypted, per-tenant)
5. Background worker refreshes tokens before expiry
   → integration works indefinitely without re-auth

PHASE 3: SELECT SPREADSHEET (per data source)
─────────────────────────────────────────────
1. Admin goes to "Spreadsheets" tab
2. Platform calls Google Drive API → lists available spreadsheets
3. Admin selects a spreadsheet (e.g., "Product Catalog 2026")
4. Platform reads the header row → shows column names
5. Admin sees auto-detected column mapping:
   Column A: "Product Name"  →  title
   Column B: "SKU"           →  sku
   Column C: "Price"         →  basePrice
   Column D: "Description"   →  description
   Column E: "Category"      →  categoryName
   Column F: "Image URL"     →  imageUrl
   Column G: "Stock"         →  stockQuantity

PHASE 4: CONFIGURE MAPPING (per data source)
────────────────────────────────────────────
1. Admin reviews auto-detected mapping, adjusts if needed
2. Admin sets import options:
   - Sheet name (if multiple sheets in the workbook)
   - Header row number (default: 1)
   - Start data row (default: 2)
   - Match strategy: by SKU, by external ID, or by title
   - Sync schedule: manual, hourly, daily, weekly
3. Admin clicks "Preview" → sees first 5 rows mapped to products
4. Admin clicks "Save Configuration"

PHASE 5: IMPORT (manual or scheduled)
─────────────────────────────────────
1. Admin clicks "Run Import Now" or waits for schedule
2. DataSyncAdapter reads spreadsheet via Google Sheets API
3. Streams rows in batches of 100
4. Maps each row to a product using configured field mapping
5. Creates/updates products via existing catalog module commands
6. Progress bar shows real-time status
7. Errors logged per-row via integrationLog
8. On completion: notification sent to admin

BACKGROUND OPERATION (after one-time setup)
───────────────────────────────────────────
• OAuth token refresh worker runs every 5 minutes
  → refreshes tokens before expiry → no manual re-auth needed
• Scheduled sync worker runs on configured schedule
  → delta detection via row hash comparison
  → only changed rows are processed
• If Google revokes the refresh token → reauthRequired warning
  → admin clicks "Re-connect" → new consent → back to normal
```

### 6.2 Spreadsheet Selection UI

```
┌─────────────────────────────────────────────────────────────────────┐
│  ← Google Workspace                                                  │
│                                                                     │
│  Select Spreadsheet                                    [Search...]  │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  📊  Product Catalog 2026                                    │   │
│  │  Last modified: Feb 24, 2026 · 3 sheets · 1,234 rows       │   │
│  │                                                    [Select] │   │
│  └──────────────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  📊  Supplier Price List — Acme Corp                         │   │
│  │  Last modified: Feb 20, 2026 · 1 sheet · 567 rows           │   │
│  │                                                    [Select] │   │
│  └──────────────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  📊  Q1 Inventory Update                                     │   │
│  │  Last modified: Jan 15, 2026 · 2 sheets · 89 rows           │   │
│  │                                                    [Select] │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  Showing 3 of 24 spreadsheets              [← Prev] [Next →]       │
└─────────────────────────────────────────────────────────────────────┘
```

### 6.3 Column Mapping UI

```
┌─────────────────────────────────────────────────────────────────────┐
│  ← Google Workspace                                                  │
│                                                                     │
│  Configure Import: Product Catalog 2026                             │
│  Sheet: [Products ▾]    Header Row: [1]    Data Starts Row: [2]    │
│                                                                     │
│  ── Column Mapping ──────────────────────────────────────────────  │
│                                                                     │
│  Spreadsheet Column          Open Mercato Field         Transform   │
│  ─────────────────────────   ────────────────────────   ──────────  │
│  A: "Product Name"         → [title ▾]                  [none ▾]   │
│  B: "SKU"                  → [sku ▾]                    [none ▾]   │
│  C: "Price"                → [basePrice ▾]              [none ▾]   │
│  D: "Description"          → [description ▾]            [none ▾]   │
│  E: "Category"             → [categoryName ▾]           [none ▾]   │
│  F: "Image URL"            → [imageUrl ▾]               [none ▾]   │
│  G: "Stock"                → [stockQuantity ▾]          [toInt ▾]  │
│  H: "Weight (kg)"          → [weight ▾]                 [toFloat▾] │
│  I: "Active"               → [isActive ▾]               [toBool▾]  │
│  J: "Barcode"              → [— skip — ▾]              [none ▾]   │
│                                                                     │
│  Match Strategy: [● SKU  ○ External ID  ○ Title]                   │
│  Schedule: [● Daily at 03:00  ○ Hourly  ○ Weekly  ○ Manual only]  │
│                                                                     │
│  ── Preview (first 5 rows) ──────────────────────────────────────  │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ title          │ sku      │ basePrice │ isActive │ action   │   │
│  │────────────────│──────────│───────────│──────────│──────────│   │
│  │ Widget Pro     │ WDG-001  │ 29.99     │ true     │ create   │   │
│  │ Gadget Mini    │ GDG-002  │ 14.50     │ true     │ update   │   │
│  │ Thingamajig    │ THG-003  │ 49.00     │ false    │ create   │   │
│  │ Doohickey XL   │ DOH-004  │ 89.99     │ true     │ create   │   │
│  │ Sprocket 5000  │ SPR-005  │ 12.00     │ true     │ skip     │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  [Save Configuration]                     [Run Import Now]          │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 7. DataSyncAdapter — Google Sheets Products

### 7.1 Adapter Implementation

```typescript
// sync_google_workspace/lib/adapters/sheets-products.ts

export const googleSheetsProductsAdapter: DataSyncAdapter = {
  providerKey: 'google_sheets_products',
  direction: 'import',
  supportedEntities: ['catalog.product'],

  async *streamImport(input: StreamImportInput): AsyncIterable<ImportBatch> {
    const client = createGoogleSheetsClient(input.credentials)
    const config = input.mapping  // Contains spreadsheetId, sheetName, headerRow, dataStartRow

    // 1. Read header row to resolve column positions
    const headers = await client.getRow(config.spreadsheetId, config.sheetName, config.headerRow)

    // 2. Stream data rows in batches
    let batchIndex = 0
    const startRow = input.cursor
      ? parseInt(input.cursor, 10)
      : config.dataStartRow

    const totalRows = await client.getRowCount(config.spreadsheetId, config.sheetName)

    for (let row = startRow; row <= totalRows; row += input.batchSize) {
      const endRow = Math.min(row + input.batchSize - 1, totalRows)
      const rows = await client.getRows(config.spreadsheetId, config.sheetName, row, endRow)

      const items: ImportItem[] = rows.map((rowData, index) => {
        const mappedData = applyColumnMapping(headers, rowData, input.mapping.fields)
        const matchValue = mappedData[input.mapping.matchField ?? 'sku']

        return {
          externalId: `row-${row + index}`,
          data: mappedData,
          action: determineAction(mappedData, matchValue, input),
          hash: computeRowHash(rowData),
        }
      })

      yield {
        items,
        cursor: String(endRow + 1),
        hasMore: endRow < totalRows,
        totalEstimate: totalRows - config.dataStartRow + 1,
        batchIndex: batchIndex++,
      }
    }
  },

  async getMapping(input: GetMappingInput): Promise<DataMapping> {
    const client = createGoogleSheetsClient(input.credentials)
    const config = await loadGoogleSheetsConfig(input.integrationId, input.scope)

    if (!config?.spreadsheetId) {
      return { entityType: 'catalog.product', fields: [], matchStrategy: 'sku' }
    }

    // Auto-detect mapping from header row
    const headers = await client.getRow(config.spreadsheetId, config.sheetName, config.headerRow)
    const fields = autoDetectFieldMapping(headers)

    return {
      entityType: 'catalog.product',
      fields,
      matchStrategy: 'sku',
      matchField: 'sku',
    }
  },

  async validateConnection(input: ValidateConnectionInput): Promise<ValidationResult> {
    try {
      const client = createGoogleSheetsClient(input.credentials)
      const config = await loadGoogleSheetsConfig(input.integrationId, input.scope)

      if (!config?.spreadsheetId) {
        return { valid: false, message: 'No spreadsheet selected. Go to the Spreadsheets tab to select one.' }
      }

      const rowCount = await client.getRowCount(config.spreadsheetId, config.sheetName)
      return {
        valid: true,
        message: `Connected. Spreadsheet has ${rowCount} rows.`,
      }
    } catch (err) {
      return { valid: false, message: err.message }
    }
  },
}
```

### 7.2 Auto-Detection of Column Mapping

The adapter attempts to match spreadsheet column headers to Open Mercato product fields:

```typescript
// sync_google_workspace/lib/column-detector.ts

const headerToFieldMap: Record<string, string> = {
  // Title / Name
  'product name': 'title', 'name': 'title', 'title': 'title', 'product title': 'title',
  // SKU
  'sku': 'sku', 'product code': 'sku', 'item number': 'sku', 'article number': 'sku',
  // Price
  'price': 'basePrice', 'base price': 'basePrice', 'unit price': 'basePrice', 'cost': 'basePrice',
  // Description
  'description': 'description', 'product description': 'description', 'desc': 'description',
  // Category
  'category': 'categoryName', 'product category': 'categoryName', 'type': 'categoryName',
  // Image
  'image': 'imageUrl', 'image url': 'imageUrl', 'photo': 'imageUrl', 'picture': 'imageUrl',
  // Stock
  'stock': 'stockQuantity', 'quantity': 'stockQuantity', 'qty': 'stockQuantity', 'inventory': 'stockQuantity',
  // Weight
  'weight': 'weight', 'weight (kg)': 'weight', 'weight (g)': 'weight',
  // Active
  'active': 'isActive', 'status': 'isActive', 'published': 'isActive', 'enabled': 'isActive',
  // Barcode
  'barcode': 'barcode', 'ean': 'barcode', 'upc': 'barcode', 'gtin': 'barcode',
}

function autoDetectFieldMapping(headers: string[]): FieldMapping[] {
  return headers
    .map((header, index) => {
      const normalized = header.toLowerCase().trim()
      const localField = headerToFieldMap[normalized]
      if (!localField) return null

      const transform = detectTransform(localField)

      return {
        externalField: `col_${index}`,
        localField,
        transform,
      }
    })
    .filter(Boolean) as FieldMapping[]
}

function detectTransform(localField: string): string | undefined {
  switch (localField) {
    case 'basePrice':
    case 'weight': return 'toFloat'
    case 'stockQuantity': return 'toInt'
    case 'isActive': return 'toBool'
    default: return undefined
  }
}
```

---

## 8. Google API Client

```typescript
// sync_google_workspace/lib/google-client.ts

export function createGoogleSheetsClient(credentials: Record<string, unknown>) {
  const tokenSet = credentials.oauthTokens as OAuthTokenSet

  return {
    /** List spreadsheets accessible to the connected Google account */
    async listSpreadsheets(query?: string, pageToken?: string): Promise<SpreadsheetListResult> {
      // GET https://www.googleapis.com/drive/v3/files
      //   ?q=mimeType='application/vnd.google-apps.spreadsheet'
      //   &fields=files(id,name,modifiedTime,owners)
      //   &pageSize=20
      //   &pageToken=...
      // Authorization: Bearer {accessToken}
    },

    /** Get metadata for a spreadsheet (sheets, row counts) */
    async getSpreadsheetMeta(spreadsheetId: string): Promise<SpreadsheetMeta> {
      // GET https://sheets.googleapis.com/v4/spreadsheets/{spreadsheetId}
      //   ?fields=sheets(properties(sheetId,title,gridProperties(rowCount,columnCount)))
    },

    /** Read a single row (for header detection) */
    async getRow(spreadsheetId: string, sheetName: string, rowNumber: number): Promise<string[]> {
      // GET https://sheets.googleapis.com/v4/spreadsheets/{spreadsheetId}/values/{sheetName}!{rowNumber}:{rowNumber}
    },

    /** Read a range of rows (for batch import) */
    async getRows(spreadsheetId: string, sheetName: string, startRow: number, endRow: number): Promise<string[][]> {
      // GET https://sheets.googleapis.com/v4/spreadsheets/{spreadsheetId}/values/{sheetName}!{startRow}:{endRow}
    },

    /** Get total row count for a sheet */
    async getRowCount(spreadsheetId: string, sheetName: string): Promise<number> {
      // From spreadsheet metadata — gridProperties.rowCount
    },
  }
}
```

All API calls use the OAuth access token from `credentials.oauthTokens.accessToken`. Before each call, the adapter checks token expiry and calls `resolveAccessToken()` if needed (on-demand refresh as fallback to background refresh).

---

## 9. GoogleSheetsConfig Entity

Persists the admin's spreadsheet selection and import settings per-tenant:

```typescript
@Entity({ tableName: 'google_sheets_configs' })
export class GoogleSheetsConfig extends BaseEntity {
  @Property()
  integrationId!: string  // 'sync_google_sheets_products'

  @Property()
  spreadsheetId!: string  // Google Spreadsheet ID

  @Property()
  spreadsheetName!: string  // Human-readable name (for display)

  @Property({ default: 'Sheet1' })
  sheetName!: string  // Tab/sheet name within the spreadsheet

  @Property({ default: 1 })
  headerRow!: number  // Row number containing column headers

  @Property({ default: 2 })
  dataStartRow!: number  // First row of actual data

  @Property({ length: 30, default: 'manual' })
  syncSchedule!: 'manual' | 'hourly' | 'daily' | 'weekly'

  @Property({ nullable: true, length: 5 })
  syncTime?: string  // HH:MM for daily/weekly schedules (e.g., '03:00')

  @Property({ nullable: true })
  lastSyncAt?: Date

  @Property()
  organizationId!: string

  @Property()
  tenantId!: string

  @Unique({ properties: ['integrationId', 'organizationId', 'tenantId'] })
  _unique!: never
}
```

---

## 10. API Contracts

### 10.1 List Available Spreadsheets

```
GET /api/google-workspace/spreadsheets?search=catalog&pageToken=abc

→ 200: {
  items: [
    {
      id: '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms',
      name: 'Product Catalog 2026',
      modifiedTime: '2026-02-24T10:00:00Z',
      owner: 'admin@company.com',
      rowCount: 1234,
      sheetCount: 3,
    },
  ],
  nextPageToken: 'def',
}
```

### 10.2 Get Spreadsheet Details (Sheets + Columns)

```
GET /api/google-workspace/spreadsheets/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms

→ 200: {
  id: '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms',
  name: 'Product Catalog 2026',
  sheets: [
    { name: 'Products', rowCount: 1234, columnCount: 10 },
    { name: 'Categories', rowCount: 45, columnCount: 3 },
    { name: 'Price List', rowCount: 890, columnCount: 5 },
  ],
  headers: ['Product Name', 'SKU', 'Price', 'Description', 'Category', 'Image URL', 'Stock', 'Weight (kg)', 'Active', 'Barcode'],
  autoMapping: [
    { externalField: 'col_0', localField: 'title' },
    { externalField: 'col_1', localField: 'sku' },
    { externalField: 'col_2', localField: 'basePrice', transform: 'toFloat' },
    ...
  ],
}
```

### 10.3 Save Configuration

```
PUT /api/google-workspace/config

{
  "integrationId": "sync_google_sheets_products",
  "spreadsheetId": "1BxiMVs0XRA...",
  "spreadsheetName": "Product Catalog 2026",
  "sheetName": "Products",
  "headerRow": 1,
  "dataStartRow": 2,
  "syncSchedule": "daily",
  "syncTime": "03:00",
  "mapping": {
    "fields": [...],
    "matchStrategy": "sku",
    "matchField": "sku"
  }
}

→ 200: { "saved": true }
```

### 10.4 Preview Import

```
POST /api/google-workspace/preview

{
  "integrationId": "sync_google_sheets_products",
  "rows": 5
}

→ 200: {
  items: [
    { title: 'Widget Pro', sku: 'WDG-001', basePrice: 29.99, isActive: true, action: 'create' },
    { title: 'Gadget Mini', sku: 'GDG-002', basePrice: 14.50, isActive: true, action: 'update' },
    ...
  ],
  totalRows: 1234,
  mappedColumns: 9,
  unmappedColumns: 1,
}
```

---

## 11. Scheduled Background Sync

### 11.1 Scheduled Sync Worker

```typescript
// sync_google_workspace/workers/scheduled-sync.ts

export const metadata: WorkerMeta = {
  queue: 'google-sheets-scheduled-sync',
  id: 'google-sheets-scheduled-sync-worker',
  concurrency: 2,
  schedule: '*/15 * * * *',  // Check every 15 minutes for due syncs
}

export default async function handler(job: Job, ctx: WorkerContext) {
  // 1. Find all GoogleSheetsConfig with schedule != 'manual' that are due
  const dueConfigs = await findDueConfigs(ctx.em)

  for (const config of dueConfigs) {
    const scope = { organizationId: config.organizationId, tenantId: config.tenantId }

    // 2. Check if integration is enabled
    const enabled = await ctx.integrationState.isEnabled(config.integrationId, scope)
    if (!enabled) continue

    // 3. Check if there's no sync already running
    const running = await ctx.syncRunService.findRunning(config.integrationId, scope)
    if (running) continue

    // 4. Enqueue a data sync import job (reuses SPEC-045b infrastructure)
    await ctx.enqueueJob('data-sync-import', {
      integrationId: config.integrationId,
      entityType: 'catalog.product',
      direction: 'import',
      triggeredBy: 'scheduler',
      organizationId: config.organizationId,
      tenantId: config.tenantId,
    })

    // 5. Update lastSyncAt
    config.lastSyncAt = new Date()
    await ctx.em.flush()
  }
}
```

### 11.2 Delta Detection

Since Google Sheets doesn't have a built-in change tracking cursor, the adapter uses **row content hashing**:

1. On first import: compute SHA-256 hash of each row's content, store in `SyncExternalIdMapping.metadata`
2. On subsequent imports: re-compute hash, compare with stored hash
   - Hash unchanged → `action: 'skip'`
   - Hash changed → `action: 'update'`
   - No stored hash → `action: 'create'`

This approach detects changes even when rows are reordered, as long as the match field (SKU) is stable.

---

## 12. Future Provider Examples — Microsoft & GitHub

The OAuth infrastructure built for Google works identically for other providers. Here are the `OAuthConfig` differences:

### 12.1 Microsoft 365 (Excel Online)

```typescript
// Future: sync_microsoft_365/integration.ts
credentials: {
  fields: [
    { key: 'clientId', label: 'Azure App Client ID', type: 'text', required: true },
    { key: 'clientSecret', label: 'Azure App Client Secret', type: 'secret', required: true },
    {
      key: 'oauthTokens',
      label: 'Microsoft Account',
      type: 'oauth',
      required: true,
      oauth: {
        provider: 'microsoft',
        authorizationUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
        tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
        scopes: ['Files.Read.All', 'Sites.Read.All'],
        usePkce: true,
        refreshStrategy: 'background',
        refreshBeforeExpiryMinutes: 5,
        authParams: { response_mode: 'query' },
      },
    },
  ],
}
```

**Setup guide differences**: Admin creates an Azure App Registration instead of a Google Cloud project. Redirect URI goes in Azure Portal → App registrations → Authentication → Redirect URIs.

### 12.2 GitHub (Repository Data)

```typescript
// Future: sync_github/integration.ts
credentials: {
  fields: [
    { key: 'clientId', label: 'GitHub App Client ID', type: 'text', required: true },
    { key: 'clientSecret', label: 'GitHub App Client Secret', type: 'secret', required: true },
    {
      key: 'oauthTokens',
      label: 'GitHub Account',
      type: 'oauth',
      required: true,
      oauth: {
        provider: 'github',
        authorizationUrl: 'https://github.com/login/oauth/authorize',
        tokenUrl: 'https://github.com/login/oauth/access_token',
        scopes: ['repo', 'read:org'],
        usePkce: false,  // GitHub doesn't support PKCE
        refreshStrategy: 'on-demand',  // GitHub tokens don't expire (unless revoked)
      },
    },
    {
      key: 'sshKey',
      label: 'Deploy Key',
      type: 'ssh_keypair',
      ssh: { algorithm: 'ed25519', keyComment: 'open-mercato-deploy' },
    },
  ],
}
```

**Note**: GitHub integration uses both OAuth (for API access) and SSH keys (for Git operations). Both credential types from SPEC-045a §8 and §10 are combined in a single integration.

---

## 13. Health Check

```typescript
// sync_google_workspace/lib/health.ts

export const googleWorkspaceHealthCheck: HealthCheckable = {
  async check(credentials: Record<string, unknown>, scope: TenantScope): Promise<HealthCheckResult> {
    const tokenSet = credentials.oauthTokens as OAuthTokenSet | undefined

    if (!tokenSet?.accessToken) {
      return { status: 'error', message: 'Not connected. Click "Connect" to authorize Google account.' }
    }

    try {
      const client = createGoogleSheetsClient(credentials)
      // Try listing 1 spreadsheet — validates both auth and API access
      await client.listSpreadsheets(undefined, undefined)
      return { status: 'healthy', message: 'Connected to Google Workspace. APIs accessible.' }
    } catch (err) {
      if (err.status === 401) {
        return { status: 'error', message: 'Authentication expired. Click "Re-connect" to re-authorize.' }
      }
      return { status: 'error', message: `API error: ${err.message}` }
    }
  },
}
```

---

## 14. Risks & Impact Review

### Critical Risks

#### Google OAuth Token Revocation
- **Scenario**: Admin revokes access in Google Account settings, or Google revokes for policy violation
- **Mitigation**: Background refresh worker detects 401 response → sets `reauthRequired` → admin sees warning → clicks "Re-connect"
- **Residual risk**: Scheduled syncs fail until re-auth. Operation logs capture all failures.

### High Risks

#### Google API Quota Exhaustion
- **Scenario**: Too many API calls hit Google Sheets API quota (default: 300 requests/minute)
- **Mitigation**: Rate limiter in Google client (from SPEC-045b). Batch reads (100 rows per request). Import worker concurrency = 2.
- **Residual risk**: Very large spreadsheets (100K+ rows) may hit quotas during peak hours.

#### Spreadsheet Structure Change
- **Scenario**: Admin adds/removes columns or renames headers in Google Sheets
- **Mitigation**: Mapping validates against current header row on each sync run. Mismatches logged as warnings, not errors. Admin gets notification to review mapping.
- **Residual risk**: Renamed columns may map to wrong fields until mapping is updated.

### Medium Risks

#### Large Spreadsheet Performance
- **Mitigation**: Streaming in batches of 100 rows. Memory stays constant regardless of spreadsheet size.

#### Multiple Admins Editing Mapping
- **Mitigation**: Standard optimistic concurrency (updated_at check on save).

---

## 15. Integration Test Coverage

| Test | Method | Assert |
|------|--------|--------|
| List spreadsheets with valid OAuth | GET `/api/google-workspace/spreadsheets` | Returns spreadsheet list from Google Drive API |
| List spreadsheets without OAuth | GET (no tokens) | Returns 401 with "not connected" message |
| Get spreadsheet details | GET `.../spreadsheets/:id` | Returns sheets, headers, auto-mapping |
| Save configuration | PUT `/api/google-workspace/config` | GoogleSheetsConfig persisted |
| Preview import | POST `/api/google-workspace/preview` | Returns mapped product preview |
| Run import via DataSyncAdapter | Worker | Products created/updated, progress tracked, errors logged per-row |
| Delta detection (hash-based) | Re-run import with unchanged rows | Unchanged rows skipped |
| Delta detection (hash-based) | Re-run import with changed rows | Changed rows updated |
| Scheduled sync triggers on schedule | Worker | Sync enqueued when schedule is due |
| Scheduled sync skips manual-only | Worker | Config with schedule='manual' not triggered |
| Health check — connected | POST health check | Returns 'healthy' |
| Health check — expired token | POST health check | Returns 'error' with re-connect message |
| Auto-detect column mapping | Adapter getMapping() | Headers correctly mapped to product fields |
| Column mapping — unknown header | Adapter | Unknown columns returned as unmapped |
| Bundle credential fallthrough | Adapter resolves credentials | OAuth tokens resolved from bundle |
| Cross-tenant isolation | Two tenants | Each has own config, own spreadsheet, own tokens |

---

## Changelog

| Date | Change |
|------|--------|
| 2026-02-24 | Initial draft — Google Workspace integration with Sheets product import, OAuth setup guide, column mapping, scheduled sync |
