# SPEC-010: Dashboard Widget Feature-Based Visibility

**Created:** 2026-01-27
**Module:** `dashboards`
**Status:** Implemented

> **Note:** This specification documents an **existing, fully implemented feature**. It serves as a reference guide for developers creating new dashboard widgets. All functionality described here is already operational in the codebase. Use this spec to understand how to configure feature-based visibility when building new widgets.

## Overview

Dashboard widgets support feature-based access control, automatically hiding widgets from users who don't have the required permissions. This ensures that users only see widgets relevant to their role and capabilities, maintaining a clean and secure user experience.

### Purpose

- **Permission-based visibility**: Only show widgets to users with appropriate features
- **Role-based access control**: Leverage existing RBAC system for widget access
- **Seamless integration**: Automatic filtering without additional UI logic
- **Security enforcement**: Prevent unauthorized access to sensitive data

### Key Features

- Widgets declare required features in metadata
- Automatic filtering based on user's feature set
- Super admin bypass (see all widgets)
- Works with both role-based and user-specific ACLs
- No client-side permission checks needed

---

## Architecture

### Permission Flow

```
┌──────────────────────────────────────────────────────────────┐
│ User Dashboard Request                                        │
└──────────────────────────────────────────────────────────────┘
                             ↓
┌──────────────────────────────────────────────────────────────┐
│ 1. Load User ACL (rbacService)                               │
│    - Fetch role features                                      │
│    - Fetch user-specific features                             │
│    - Check super admin status                                 │
└──────────────────────────────────────────────────────────────┘
                             ↓
┌──────────────────────────────────────────────────────────────┐
│ 2. Load Base Widget Set                                      │
│    - Role widgets (if user has role assignments)             │
│    - User widgets (if configured)                             │
│    - Organization defaults (fallback)                         │
└──────────────────────────────────────────────────────────────┘
                             ↓
┌──────────────────────────────────────────────────────────────┐
│ 3. Filter Widgets by Features                                │
│    - Skip if user is super admin                             │
│    - Check widget.metadata.features                           │
│    - Verify user has ALL required features                    │
└──────────────────────────────────────────────────────────────┘
                             ↓
┌──────────────────────────────────────────────────────────────┐
│ 4. Return Filtered Widget List                               │
└──────────────────────────────────────────────────────────────┘
```

### Core Components

| Component | Path | Responsibility |
|-----------|------|----------------|
| **Widget Type** | `packages/shared/src/modules/dashboard/widgets.ts` | Defines `DashboardWidgetMetadata.features` |
| **Access Filter** | `packages/core/src/modules/dashboards/lib/access.ts` | Implements feature-based filtering |
| **Layout API** | `packages/core/src/modules/dashboards/api/layout/route.ts` | Applies filtering when serving widgets |
| **Catalog API** | `packages/core/src/modules/dashboards/api/widgets/catalog.ts` | Returns widget metadata with features |

---

## Data Models

### Widget Metadata

```typescript
type DashboardWidgetMetadata = {
  id: string
  title: string
  description?: string
  features?: string[]        // Required features (ALL must match)
  defaultSize?: DashboardWidgetSize
  defaultEnabled?: boolean
  tags?: string[]
  category?: string
  icon?: string
  supportsRefresh?: boolean
}
```

### Access Context

```typescript
type AccessContext = {
  tenantId: string | null
  organizationId: string | null
  features: string[]         // User's granted features
  isSuperAdmin: boolean      // Bypass all checks
}
```

### Filter Logic

Located in [packages/core/src/modules/dashboards/lib/access.ts:101-108](../../packages/core/src/modules/dashboards/lib/access.ts#L101-L108):

```typescript
const filtered = widgets.filter((widget) => {
  if (!baseSet.has(widget.metadata.id)) return false
  if (ctx.isSuperAdmin) return true
  return userHasAllFeatures(ctx.features, widget.metadata.features ?? [])
})
```

**Logic:**
1. Exclude widgets not in the base set (role/user assignment)
2. Super admins see all widgets
3. Regular users must have **ALL** required features

---

## API Contracts

### Widget Catalog Endpoint

**GET** `/api/dashboards/widgets/catalog`

Returns all available widgets with their feature requirements. Used by admins when configuring role/user widget assignments.

**Response:**
```json
{
  "widgets": [
    {
      "id": "customers.dashboard.newCustomers",
      "title": "New Customers",
      "description": "Track the most recently added customers",
      "features": ["dashboards.view", "customers.widgets.new-customers"],
      "defaultSize": "sm",
      "defaultEnabled": true,
      "tags": ["customers"],
      "category": "customers",
      "icon": "user-plus"
    }
  ]
}
```

### User Dashboard Layout

**GET** `/api/dashboards/layout`

Returns the user's dashboard layout with widgets filtered by their features.

**Response:**
```json
{
  "layout": [
    {
      "id": "layout-uuid-1",
      "widgetId": "customers.dashboard.newCustomers",
      "order": 0,
      "size": "sm",
      "settings": { "pageSize": 10 }
    }
  ],
  "widgets": [
    {
      "id": "customers.dashboard.newCustomers",
      "title": "New Customers",
      "features": ["dashboards.view", "customers.widgets.new-customers"]
      // ... metadata
    }
  ]
}
```

**Note:** Only widgets where the user has ALL required features are included.

---

## Configuration

### Declaring Widget Features

**Step 1: Define features in module ACL**

File: `packages/core/src/modules/<module>/acl.ts`

```typescript
export const features = [
  'module.view',
  'module.widgets.widget-name',  // Widget-specific feature
]
```

**Step 2: Reference in widget metadata**

File: `packages/core/src/modules/<module>/widgets/dashboard/<widget-name>/widget.ts`

```typescript
import type { DashboardWidgetModule } from '@open-mercato/shared/modules/dashboard/widgets'

const widget: DashboardWidgetModule = {
  metadata: {
    id: 'module.dashboard.widgetName',
    title: 'Widget Title',
    features: ['dashboards.view', 'module.widgets.widget-name'],
    // ... other metadata
  },
  Widget: MyWidgetComponent,
}

export default widget
```

### Feature Naming Convention

Follow the pattern: `<module>.widgets.<widget-name>`

**Examples:**
- `customers.widgets.new-customers`
- `customers.widgets.new-deals`
- `catalog.widgets.product-quality`
- `sales.widgets.revenue-overview`

**Common Features:**
- `dashboards.view` - Base dashboard access (typically required by all widgets)
- `dashboards.configure` - Edit dashboard layout
- `dashboards.admin.assign-widgets` - Manage role/user widget assignments

---

## Examples

### Example 1: Customer Module Widgets

**ACL Definition** (`packages/core/src/modules/customers/acl.ts`):
```typescript
export const features = [
  'customers.view',
  'customers.create',
  'customers.edit',
  'customers.widgets.new-customers',
  'customers.widgets.new-deals',
  'customers.widgets.customer-todos',
  'customers.widgets.next-interactions',
]
```

**Widget Configuration** ([packages/core/src/modules/customers/widgets/dashboard/new-customers/widget.ts:10](../../packages/core/src/modules/customers/widgets/dashboard/new-customers/widget.ts#L10)):
```typescript
const widget: DashboardWidgetModule = {
  metadata: {
    id: 'customers.dashboard.newCustomers',
    title: 'New Customers',
    features: ['dashboards.view', 'customers.widgets.new-customers'],
    defaultSize: 'sm',
    defaultEnabled: true,
  },
  Widget: CustomerNewCustomersWidget,
}
```

**Result:**
- Users with only `dashboards.view` will **NOT** see this widget
- Users need **BOTH** features to see it
- Super admins see it regardless

### Example 2: Catalog Quality Widget

**ACL Definition** (`packages/core/src/modules/catalog/acl.ts`):
```typescript
export const features = [
  'catalog.view',
  'catalog.products.create',
  'catalog.products.edit',
  'catalog.widgets.product-quality',
]
```

**Widget Configuration**:
```typescript
const widget: DashboardWidgetModule = {
  metadata: {
    id: 'catalog.dashboard.productQuality',
    title: 'Product Quality Issues',
    features: ['dashboards.view', 'catalog.widgets.product-quality'],
    defaultSize: 'md',
  },
  Widget: ProductQualityWidget,
}
```

**Use Case:**
- Only merchandisers with catalog access see quality metrics
- Sales reps without catalog features won't see the widget
- Prevents exposing internal quality data to unauthorized users

### Example 3: Sales Dashboard

**ACL Definition** (`packages/core/src/modules/sales/acl.ts`):
```typescript
export const features = [
  'sales.view',
  'sales.orders.create',
  'sales.widgets.revenue-overview',
  'sales.widgets.top-products',
]
```

**Widget Configuration**:
```typescript
const widget: DashboardWidgetModule = {
  metadata: {
    id: 'sales.dashboard.revenueOverview',
    title: 'Revenue Overview',
    features: ['dashboards.view', 'sales.widgets.revenue-overview'],
    defaultSize: 'lg',
  },
  Widget: RevenueOverviewWidget,
}
```

**Access Control:**
- Finance team: Has `sales.widgets.revenue-overview` → sees widget
- Customer support: Missing feature → widget hidden
- Super admin: Sees all widgets regardless

---

## Role & Permission Setup

### Assigning Features to Roles

**During Role Creation** (`packages/core/src/modules/auth/cli.ts`):
```typescript
// Admin role includes all widget features
const adminRole = {
  name: 'Admin',
  features: [
    'dashboards.view',
    'dashboards.configure',
    'customers.widgets.new-customers',
    'customers.widgets.new-deals',
    'catalog.widgets.product-quality',
    'sales.widgets.revenue-overview',
    // ... other features
  ],
}
```

**Via Admin UI:**
1. Navigate to Settings → Roles
2. Edit role (e.g., "Sales Manager")
3. Check/uncheck widget features
4. Save role
5. All users with this role inherit the features

### User-Specific Features

**Via API:**
```http
POST /api/auth/users/:userId/acl
{
  "features": ["dashboards.view", "customers.widgets.new-customers"]
}
```

**Result:**
- Overrides role features for this specific user
- Widget visibility updates immediately on next dashboard load

---

## Security Considerations

### Server-Side Enforcement

**Critical:** Widget visibility is enforced **server-side** in the layout API. Client-side filtering is for UX only and should not be relied upon for security.

**Enforcement Points:**
1. [Layout API](../../packages/core/src/modules/dashboards/api/layout/route.ts#L104) - Filters widgets before sending to client
2. [Access Library](../../packages/core/src/modules/dashboards/lib/access.ts#L104) - Validates feature requirements
3. Widget Data APIs - Must check permissions independently (e.g., widget routes should enforce `requireFeatures`)

### Widget Data API Security

**Important:** Widget metadata filtering does NOT secure the widget's data API. Each widget's data endpoint must independently enforce permissions.

**Example** ([packages/core/src/modules/customers/api/dashboard/widgets/new-customers/route.ts](../../packages/core/src/modules/customers/api/dashboard/widgets/new-customers/route.ts)):
```typescript
export const metadata = {
  GET: {
    requireAuth: true,
    requireFeatures: ['dashboards.view', 'customers.widgets.new-customers'],
  },
}
```

**Why Both?**
- **Widget metadata filtering**: Prevents widget from appearing in dashboard UI
- **Data API enforcement**: Prevents direct API calls from bypassing UI filters

### Tenant & Organization Scoping

Widget data must respect multi-tenancy:
```typescript
const scope = {
  userId: auth.sub,
  tenantId: auth.tenantId ?? null,
  organizationId: orgId ?? auth.orgId ?? null,
}
```

**Rules:**
- Always filter by `tenantId` (required)
- Respect `organizationId` when provided
- Never expose cross-tenant data

---

## Testing

### Test Scenarios

#### 1. Feature Filtering
```typescript
// User with only dashboards.view
const user = { features: ['dashboards.view'], isSuperAdmin: false }
const widgets = filterWidgets(allWidgets, user)
// Result: Widgets with ONLY ['dashboards.view'] or [] features
```

#### 2. Super Admin Bypass
```typescript
// Super admin sees everything
const admin = { features: [], isSuperAdmin: true }
const widgets = filterWidgets(allWidgets, admin)
// Result: ALL widgets, regardless of features
```

#### 3. Multiple Features Required
```typescript
// Widget requires 2 features
const widget = { features: ['dashboards.view', 'catalog.widgets.quality'] }
const user1 = { features: ['dashboards.view'], isSuperAdmin: false }
const user2 = { features: ['dashboards.view', 'catalog.widgets.quality'], isSuperAdmin: false }

filterWidgets([widget], user1) // []
filterWidgets([widget], user2) // [widget]
```

#### 4. API Endpoint Security
```bash
# User without feature tries direct API call
curl -H "Authorization: Bearer <token>" \
  /api/customers/dashboard/widgets/new-customers

# Expected: 403 Forbidden
```

### Manual Testing Checklist

- [ ] Create test user with limited features
- [ ] Verify widgets are hidden in dashboard picker
- [ ] Verify widgets are hidden in layout response
- [ ] Verify widget data APIs return 403 for unauthorized users
- [ ] Verify super admin sees all widgets
- [ ] Verify feature changes propagate immediately
- [ ] Test organization scoping with multi-org users

---

## Troubleshooting

### Widget Not Appearing

**Possible Causes:**
1. User missing required feature
   - **Solution:** Check user's role and user-specific ACL
2. Widget not assigned to role/user
   - **Solution:** Configure widget assignment via admin UI
3. Feature typo in widget metadata
   - **Solution:** Verify `features` array matches ACL definition
4. Super admin flag not set
   - **Solution:** Check database `is_super_admin` column

### Permission Errors

**403 Forbidden on Widget Data API:**
- Verify `requireFeatures` in route metadata matches widget metadata
- Check user's feature list via `/api/auth/me`
- Ensure tenant/organization scope is correct

**Widget Visible But Data Fails:**
- Widget metadata filtering passed, but data API rejected request
- Check widget's API route `metadata.GET.requireFeatures`
- May indicate feature mismatch between widget and API

---

## Future Enhancements

### Potential Improvements

1. **Conditional Features**
   - Support `features: { any: [...], all: [...] }` for OR/AND logic
   - Example: Show widget if user has ANY of several features

2. **Dynamic Feature Resolution**
   - Compute required features based on widget settings
   - Example: Category filter requires `catalog.categories.view`

3. **Feature Inheritance**
   - Hierarchical features: `catalog.*` grants all catalog widgets
   - Reduces ACL size for broad roles

4. **Visibility Rules Engine**
   - Business rules for widget visibility beyond simple features
   - Example: Hide sales widgets during fiscal year close

5. **Audit Logging**
   - Track when widgets are shown/hidden due to permission changes
   - Useful for compliance and debugging

6. **Widget Feature Discovery**
   - Admin UI showing which features unlock which widgets
   - Help admins understand permission implications

---

## Related Specs

- [SPEC-001: UI Reusable Components](.ai/specs/SPEC-001-2026-01-21-ui-reusable-components.md) - Dashboard widget patterns
- [SPEC-008: Product Quality Widget](.ai/specs/SPEC-008-2026-01-27-product-quality-widget.md) - Example widget implementation
- [SPEC-009: Sales Dashboard Widgets](.ai/specs/SPEC-009-2026-01-27-sales-dashboard-widgets.md) - More widget examples

---

## References

### Code References

| Component | Path | Description |
|-----------|------|-------------|
| Widget Types | [packages/shared/src/modules/dashboard/widgets.ts](../../packages/shared/src/modules/dashboard/widgets.ts) | `DashboardWidgetMetadata` type definition |
| Access Filter | [packages/core/src/modules/dashboards/lib/access.ts:101-108](../../packages/core/src/modules/dashboards/lib/access.ts#L101-L108) | Core filtering logic |
| Feature Helper | `@open-mercato/shared/security/features` | `hasAllFeatures()` utility |
| Layout API | [packages/core/src/modules/dashboards/api/layout/route.ts:94](../../packages/core/src/modules/dashboards/api/layout/route.ts#L94) | Server-side enforcement |

### Example Implementations

- New Customers Widget: [packages/core/src/modules/customers/widgets/dashboard/new-customers/](../../packages/core/src/modules/customers/widgets/dashboard/new-customers/)
- New Deals Widget: [packages/core/src/modules/customers/widgets/dashboard/new-deals/](../../packages/core/src/modules/customers/widgets/dashboard/new-deals/)

---

## Changelog

### 2026-01-27

- Initial specification documenting existing implementation
- Added reference guide for developers building new widgets
- Documented feature-based filtering implementation with code references
- Added configuration examples from customers, catalog, and sales modules
- Included comprehensive testing scenarios and troubleshooting guide
- Clarified that this is documentation of a fully implemented feature
