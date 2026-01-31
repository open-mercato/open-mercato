# SPEC-008: Product Quality Dashboard Widget

**Created:** 2026-01-27
**Module:** `catalog`
**Status:** Draft

## Overview

The Product Quality Dashboard Widget provides visibility into catalog data completeness by identifying products that are missing critical information such as images or descriptions. This widget helps merchandisers and catalog managers maintain high-quality product listings by surfacing items that need attention.

### Purpose

- **Identify incomplete products**: Surface products missing key data fields (images, descriptions, SKUs, etc.)
- **Track data quality metrics**: Display quality scores and issue counts for each product
- **Enable quick remediation**: Provide direct links to product edit pages for immediate fixes
- **Configurable thresholds**: Allow users to filter by minimum quality score and adjust display limits

### Key Features

- Displays products with quality scores below configurable thresholds
- Shows quality score percentage and issue count per product
- Provides direct navigation to product detail pages
- Supports manual refresh via dashboard refresh button
- Configurable page size (1-20 items)
- Optional minimum quality score filter
- Multi-tenant and organization-scoped data access

---

## Architecture

### Component Structure

```
packages/core/src/modules/catalog/
├── widgets/
│   └── dashboard/
│       └── product-quality/
│           ├── config.ts           # Settings types and defaults
│           ├── widget.ts            # Server-side module export
│           └── widget.client.tsx    # Client-side React component
└── api/
    └── dashboard/
        └── widgets/
            └── product-quality/
                └── route.ts         # API endpoint for widget data
```

### Data Flow

1. **Widget Render** → Client component mounted on dashboard
2. **Data Fetch** → `apiCall()` to `/api/catalog/dashboard/widgets/product-quality`
3. **Auth & Scope** → Server validates permissions and resolves tenant/organization scope
4. **Query Products** → EntityManager queries `catalog_products` with filters
5. **Quality Calculation** → Server computes quality scores based on field completion
6. **Response** → JSON payload with product list and metrics
7. **Display** → Client renders product cards with scores and issue counts

### Permission Model

**Required Features:**
- `dashboards.view` - Access to dashboard functionality
- `catalog.widgets.product-quality` - Specific widget access

**Access Control:**
- Widget data is scoped by `tenantId` (required)
- Organization filtering respects user's allowed organizations
- API route enforces feature-based access control via metadata

---

## Data Models

### Quality Score Calculation

The quality score is a percentage (0-100) representing data completeness across critical fields:

| Field | Weight | Description |
|-------|--------|-------------|
| `title` | 20% | Product name (required) |
| `description` | 20% | Full product description |
| `defaultMediaId` | 20% | Primary product image |
| `sku` | 10% | Stock keeping unit |
| `subtitle` | 10% | Short tagline or subtitle |
| `weight_value` | 10% | Product weight |
| `dimensions` | 5% | Physical dimensions (width/height/depth) |

**Formula:**
```typescript
qualityScore = (fieldsPopulated / totalFields) * 100
```

### Issue Count

Count of missing critical fields:
- Missing `title` (critical)
- Missing `description` (critical)
- Missing `defaultMediaId` (critical - image)
- Missing `sku` (important)

### Widget Settings Type

```typescript
type ProductQualitySettings = {
  pageSize: number        // 1-20, default: 10
  minScore?: number       // 0-100, optional filter
}
```

### API Response Schema

```typescript
type QualityItem = {
  id: string              // Product UUID
  title: string | null    // Product name
  qualityScore: number    // 0-100 percentage
  issueCount: number      // Count of missing fields
  createdAt: string       // ISO timestamp
}

type WidgetResponse = {
  items: QualityItem[]
}
```

---

## API Contracts

### Endpoint

**GET** `/api/catalog/dashboard/widgets/product-quality`

### Query Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `limit` | number | No | 10 | Number of items to return (1-20) |
| `minScore` | number | No | - | Minimum quality score filter (0-100) |

### Request Example

```http
GET /api/catalog/dashboard/widgets/product-quality?limit=15&minScore=70
Authorization: Bearer <session-token>
x-organization-id: <org-uuid>
```

### Response Examples

**Success (200 OK):**
```json
{
  "items": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "title": "Sample Product",
      "qualityScore": 65,
      "issueCount": 2,
      "createdAt": "2026-01-27T10:30:00.000Z"
    },
    {
      "id": "660e8400-e29b-41d4-a716-446655440001",
      "title": null,
      "qualityScore": 40,
      "issueCount": 4,
      "createdAt": "2026-01-26T15:45:00.000Z"
    }
  ]
}
```

**Error (400 Bad Request):**
```json
{
  "error": "Invalid query parameters"
}
```

**Error (401 Unauthorized):**
```json
{
  "error": "Unauthorized"
}
```

### OpenAPI Documentation

The route exports an `openApi` object for automatic API documentation generation:

```typescript
export const openApi: OpenApiRouteDoc = {
  tag: 'Catalog',
  summary: 'Product quality widget',
  methods: {
    GET: {
      summary: 'Fetch products with quality metrics',
      query: querySchema,
      responses: [
        { status: 200, schema: z.object({ items: z.array(itemSchema) }) },
      ],
      errors: [
        { status: 400, schema: z.object({ error: z.string() }) },
        { status: 401, schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
```

---

## UI/UX

### Widget Metadata

```typescript
{
  id: 'catalog.dashboard.productQuality',
  title: 'Product Quality Issues',
  description: 'Track products with quality issues and missing data.',
  features: ['dashboards.view', 'catalog.widgets.product-quality'],
  defaultSize: 'md',
  defaultEnabled: true,
  tags: ['catalog'],
  category: 'catalog',
  icon: 'package',
  supportsRefresh: true,
}
```

### View Mode

**Layout:**
- Header: Widget title ("Product Quality Issues")
- Body: List of product cards
- Each card shows:
  - Product title (linked to edit page)
  - Quality score percentage
  - Issue count
  - Created date (implicit in sort order)

**States:**
- **Loading**: Centered spinner with "Loading..." message
- **Empty**: "No products to display" message
- **Error**: Red error message with retry hint
- **Loaded**: List of product cards

**Product Card Example:**
```
┌─────────────────────────────────────┐
│ Sample Product                   → │
│ Quality: 65% • 2 issues            │
└─────────────────────────────────────┘
```

### Settings Mode

**Configurable Parameters:**
1. **Items to display** (number input, 1-20)
2. **Minimum score** (number input, 0-100, optional)

**Layout:**
```
Items to display
[10] (number input)

Minimum score
[70] (number input, optional)
```

### Interactions

- **Click product title**: Navigate to `/backend/catalog/products/:id` for editing
- **Refresh button**: Triggers data reload via `refreshToken` increment
- **Settings gear**: Opens settings panel
- **Drag handle**: Allows widget repositioning on dashboard

### Keyboard Shortcuts

The widget respects dashboard-level shortcuts:
- **Escape**: Exit settings mode
- Widget-specific shortcuts: None (follows dashboard conventions)

---

## Configuration

### Feature Flags

**Module ACL** (`packages/core/src/modules/catalog/acl.ts`):
```typescript
export const features = [
  // ... existing features
  'catalog.widgets.product-quality',
]
```

### Default Settings

```typescript
export const DEFAULT_SETTINGS: ProductQualitySettings = {
  pageSize: 10,
  minScore: 70,
}
```

### Environment Variables

No additional environment variables required. Uses existing database and auth configuration.

### Role Permissions

Add to default admin role seeding (`packages/core/src/modules/auth/cli.ts`):
```typescript
features: [
  // ... existing features
  'catalog.widgets.product-quality',
]
```

---

## Implementation Checklist

### Backend
- [ ] Create widget directory: `packages/core/src/modules/catalog/widgets/dashboard/product-quality/`
- [ ] Implement `config.ts` with settings types and hydration
- [ ] Create API route: `packages/core/src/modules/catalog/api/dashboard/widgets/product-quality/route.ts`
- [ ] Implement quality score calculation logic
- [ ] Implement issue counting logic
- [ ] Add OpenAPI documentation to route
- [ ] Add feature to `packages/core/src/modules/catalog/acl.ts`
- [ ] Add scope resolution using `resolveWidgetScope()`

### Frontend
- [ ] Create `widget.client.tsx` with React component
- [ ] Implement settings UI (pageSize, minScore inputs)
- [ ] Implement view UI (product list with scores)
- [ ] Handle loading/error/empty states
- [ ] Add navigation links to product detail pages
- [ ] Create `widget.ts` module export with metadata

### I18n
- [ ] Add translation keys to `packages/core/src/modules/catalog/i18n/en.json`:
  - `catalog.widgets.productQuality.title`
  - `catalog.widgets.productQuality.description`
  - `catalog.widgets.productQuality.empty`
  - `catalog.widgets.productQuality.error`
  - `catalog.widgets.productQuality.untitled`
  - `catalog.widgets.productQuality.settings.pageSize`
  - `catalog.widgets.productQuality.settings.minScore`

### Testing
- [ ] Test widget with various quality scores
- [ ] Test minScore filter behavior
- [ ] Test organization scoping
- [ ] Test refresh functionality
- [ ] Test settings persistence
- [ ] Verify permissions enforcement
- [ ] Test empty state and error handling

### Documentation
- [ ] Update `.ai/specs/README.md` with new spec entry
- [ ] Document quality score formula for merchandisers
- [ ] Add widget to catalog module documentation

---

## Migration & Deployment

### Database Changes

**None required** - uses existing `catalog_products` table.

### Upgrade Path

1. Run `npm run modules:prepare` to regenerate widget registry
2. Deploy backend API route
3. Deploy frontend widget component
4. Restart application
5. Widget automatically appears in dashboard widget picker
6. Users with `dashboards.view` + `catalog.widgets.product-quality` can add widget to their dashboards

### Rollback Plan

1. Remove widget files from codebase
2. Run `npm run modules:prepare` to regenerate registry
3. Redeploy application
4. Widget removed from picker (existing instances show error state)

---

## Future Enhancements

### Potential Extensions

1. **Custom Quality Scoring**: Allow admins to configure field weights per tenant
2. **Bulk Actions**: Add "Fix All" button to open bulk editor
3. **Quality Trends**: Show quality score trends over time (sparklines)
4. **Category Filtering**: Filter by product category or collection
5. **Export**: Download quality report as CSV/Excel
6. **Notifications**: Alert when quality drops below threshold
7. **AI Suggestions**: Use AI to suggest missing descriptions
8. **Image Analysis**: Validate image quality (resolution, aspect ratio)

### Related Modules

- **Attachments Module**: Could integrate to show media upload status
- **Workflows Module**: Could trigger approval workflows for low-quality products
- **Audit Logs**: Track quality improvements over time
- **Business Rules**: Auto-flag products below quality thresholds

---

## References

### Related Specs
- [SPEC-001: UI Reusable Components](.ai/specs/SPEC-001-2026-01-21-ui-reusable-components.md) - Dashboard widget patterns

### Code References
- Dashboard widget types: [packages/shared/src/modules/dashboard/widgets.ts](../../packages/shared/src/modules/dashboard/widgets.ts)
- Example widget: [packages/core/src/modules/customers/widgets/dashboard/new-customers/](../../packages/core/src/modules/customers/widgets/dashboard/new-customers/)
- Product entities: [packages/core/src/modules/catalog/data/entities.ts](../../packages/core/src/modules/catalog/data/entities.ts)
- Scope utilities: [packages/core/src/modules/customers/api/dashboard/widgets/utils.ts](../../packages/core/src/modules/customers/api/dashboard/widgets/utils.ts)

### External Documentation
- Dashboard System: `packages/core/src/modules/dashboards/README.md` (if exists)
- Catalog Module: `packages/core/src/modules/catalog/README.md` (if exists)

---

## Changelog

### 2026-01-27
- Initial specification created
- Defined quality score calculation formula
- Documented API contracts and UI/UX design
- Outlined implementation checklist
