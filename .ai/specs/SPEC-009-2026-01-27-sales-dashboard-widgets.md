# SPEC-009: Sales Dashboard Widgets

**Date:** 2026-01-27
**Status:** Draft
**Module:** `sales`
**Type:** Feature Specification

## Overview

This specification defines two new dashboard widgets for the sales module:

1. **New Orders Widget** - Displays recently created sales orders with a selectable date period
2. **New Quotes Widget** - Displays recently created sales quotes with a selectable date period

Both widgets provide quick visibility into recent sales activity and support configurable time windows (e.g., last 24 hours, last 7 days, last 30 days, custom range) for tracking new orders and quotes.

### Goals

- Provide sales team visibility into recent order and quote activity
- Support flexible date period selection for filtering
- Maintain consistency with existing dashboard widget patterns
- Enable quick navigation to full order/quote details
- Support multi-tenant and organization scoping

### Non-Goals

- Detailed order/quote editing (use full CRUD pages)
- Advanced analytics or aggregations (future dashboard widgets)
- Real-time updates (uses manual refresh pattern)

---

## Architecture

### Widget Structure

Each widget follows the established dashboard widget pattern:

```
packages/core/src/modules/sales/widgets/dashboard/
├── new-orders/
│   ├── widget.ts                 # Widget module export
│   ├── widget.client.tsx         # React component
│   └── config.ts                 # Settings type & hydration
└── new-quotes/
    ├── widget.ts                 # Widget module export
    ├── widget.client.tsx         # React component
    └── config.ts                 # Settings type & hydration
```

### Widget Registration

Widgets are auto-discovered and registered via:
- Generator scans: `packages/core/src/modules/sales/widgets/dashboard/*/widget.ts`
- Generated registry: `apps/mercato/.mercato/generated/dashboard-widgets.generated.ts`
- Module ID: `sales`
- Widget keys: `sales:new-orders:widget`, `sales:new-quotes:widget`

### Component Architecture

```
┌─────────────────────────────────────────┐
│   Dashboard (Host Page)                 │
│                                         │
│  ┌───────────────────────────────────┐ │
│  │  New Orders Widget                │ │
│  │  ┌─────────────────────────────┐  │ │
│  │  │ Settings UI (mode=settings) │  │ │
│  │  │ - Date Period Selector      │  │ │
│  │  │ - Page Size Selector        │  │ │
│  │  └─────────────────────────────┘  │ │
│  │  ┌─────────────────────────────┐  │ │
│  │  │ View UI (mode=view)         │  │ │
│  │  │ - Loading Spinner           │  │ │
│  │  │ - Error Display             │  │ │
│  │  │ - Order List                │  │ │
│  │  │   - Order Number            │  │ │
│  │  │   - Customer Name           │  │ │
│  │  │   - Status Badge            │  │ │
│  │  │   - Total Amount            │  │ │
│  │  │   - Created Date (relative) │  │ │
│  │  └─────────────────────────────┘  │ │
│  └───────────────────────────────────┘ │
│                                         │
│  ┌───────────────────────────────────┐ │
│  │  New Quotes Widget                │ │
│  │  (Similar structure)               │ │
│  └───────────────────────────────────┘ │
└─────────────────────────────────────────┘
         │                    │
         ↓                    ↓
    API Endpoint         API Endpoint
    /api/sales/          /api/sales/
    dashboard/           dashboard/
    widgets/             widgets/
    new-orders           new-quotes
```

---

## Data Models

### Existing Sales Entities

Both widgets leverage existing sales entities (no schema changes required):

#### SalesOrder
**Table:** `sales_orders`
**File:** `packages/core/src/modules/sales/data/entities.ts`

**Key Fields:**
```typescript
{
  id: string                    // UUID
  orderNumber: string           // Unique order number (per tenant)
  status: string | null         // Order status
  fulfillmentStatus: string | null
  paymentStatus: string | null
  customerEntityId: string | null  // Link to customer entity
  customerSnapshot: object      // Snapshot of customer data
  createdAt: Date              // Order creation timestamp
  updatedAt: Date
  deletedAt: Date | null       // Soft delete
  netAmount: string            // Decimal as string
  grossAmount: string          // Decimal as string
  currency: string | null
  // ... other fields
}
```

#### SalesQuote
**Table:** `sales_quotes`
**File:** `packages/core/src/modules/sales/data/entities.ts`

**Key Fields:**
```typescript
{
  id: string                    // UUID
  quoteNumber: string           // Unique quote number (per tenant)
  status: string | null         // Quote status
  customerEntityId: string | null
  validFrom: Date | null        // Quote validity period start
  validUntil: Date | null       // Quote validity period end
  placedAt: Date | null
  createdAt: Date              // Quote creation timestamp
  updatedAt: Date
  deletedAt: Date | null       // Soft delete
  convertedOrderId: string | null  // Reference to converted order
  netAmount: string            // Decimal as string
  grossAmount: string          // Decimal as string
  currency: string | null
  // ... other fields
}
```

### Widget Settings Types

#### New Orders Widget Settings
**File:** `packages/core/src/modules/sales/widgets/dashboard/new-orders/config.ts`

```typescript
export type SalesNewOrdersSettings = {
  pageSize: number              // Number of orders to display (1-20)
  datePeriod: DatePeriodOption  // Date filter preset
  customFrom?: string           // Custom date range start (ISO 8601)
  customTo?: string             // Custom date range end (ISO 8601)
}

export type DatePeriodOption =
  | 'last24h'    // Last 24 hours
  | 'last7d'     // Last 7 days
  | 'last30d'    // Last 30 days
  | 'custom'     // Custom date range

export const DEFAULT_SETTINGS: SalesNewOrdersSettings = {
  pageSize: 5,
  datePeriod: 'last24h',
}

export function hydrateSalesNewOrdersSettings(
  raw: unknown
): SalesNewOrdersSettings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_SETTINGS }
  const input = raw as Partial<SalesNewOrdersSettings>

  // Validate pageSize
  const parsedPageSize = Number(input.pageSize)
  const pageSize =
    Number.isFinite(parsedPageSize) && parsedPageSize >= 1 && parsedPageSize <= 20
      ? Math.floor(parsedPageSize)
      : DEFAULT_SETTINGS.pageSize

  // Validate datePeriod
  const validPeriods: DatePeriodOption[] = ['last24h', 'last7d', 'last30d', 'custom']
  const datePeriod = validPeriods.includes(input.datePeriod as any)
    ? (input.datePeriod as DatePeriodOption)
    : DEFAULT_SETTINGS.datePeriod

  // Validate custom dates (if datePeriod is 'custom')
  let customFrom: string | undefined
  let customTo: string | undefined
  if (datePeriod === 'custom') {
    if (typeof input.customFrom === 'string' && !Number.isNaN(new Date(input.customFrom).getTime())) {
      customFrom = input.customFrom
    }
    if (typeof input.customTo === 'string' && !Number.isNaN(new Date(input.customTo).getTime())) {
      customTo = input.customTo
    }
  }

  return {
    pageSize,
    datePeriod,
    customFrom,
    customTo,
  }
}
```

#### New Quotes Widget Settings
**File:** `packages/core/src/modules/sales/widgets/dashboard/new-quotes/config.ts`

```typescript
export type SalesNewQuotesSettings = {
  pageSize: number              // Number of quotes to display (1-20)
  datePeriod: DatePeriodOption  // Date filter preset
  customFrom?: string           // Custom date range start (ISO 8601)
  customTo?: string             // Custom date range end (ISO 8601)
}

// Same DatePeriodOption type as above

export const DEFAULT_SETTINGS: SalesNewQuotesSettings = {
  pageSize: 5,
  datePeriod: 'last24h',
}

// Similar hydration function
export function hydrateSalesNewQuotesSettings(
  raw: unknown
): SalesNewQuotesSettings {
  // Same validation logic as orders widget
}
```

### API Response Types

#### New Orders Widget Response
```typescript
type NewOrdersWidgetResponse = {
  items: OrderItem[]
  total: number
  dateRange: {
    from: string      // ISO 8601
    to: string        // ISO 8601
  }
}

type OrderItem = {
  id: string
  orderNumber: string
  status: string | null
  fulfillmentStatus: string | null
  paymentStatus: string | null
  customerName: string | null       // Extracted from customerSnapshot or entity
  customerEntityId: string | null
  netAmount: string
  grossAmount: string
  currency: string | null
  createdAt: string                 // ISO 8601
}
```

#### New Quotes Widget Response
```typescript
type NewQuotesWidgetResponse = {
  items: QuoteItem[]
  total: number
  dateRange: {
    from: string      // ISO 8601
    to: string        // ISO 8601
  }
}

type QuoteItem = {
  id: string
  quoteNumber: string
  status: string | null
  customerName: string | null       // Extracted from customerSnapshot or entity
  customerEntityId: string | null
  validFrom: string | null          // ISO 8601
  validUntil: string | null         // ISO 8601
  netAmount: string
  grossAmount: string
  currency: string | null
  createdAt: string                 // ISO 8601
  convertedOrderId: string | null
}
```

---

## API Contracts

### New Orders Widget API

**Endpoint:** `GET /api/sales/dashboard/widgets/new-orders`
**File:** `packages/core/src/modules/sales/api/dashboard/widgets/new-orders/route.ts`

#### Request Query Parameters

```typescript
const querySchema = z.object({
  limit: z.coerce.number().min(1).max(20).default(5),
  datePeriod: z.enum(['last24h', 'last7d', 'last30d', 'custom']).default('last24h'),
  customFrom: z.string().optional(),   // ISO 8601 date string
  customTo: z.string().optional(),     // ISO 8601 date string
  tenantId: z.string().uuid().optional(),
  organizationId: z.string().uuid().optional(),
})
```

#### Response Schema

```typescript
const orderItemSchema = z.object({
  id: z.string().uuid(),
  orderNumber: z.string(),
  status: z.string().nullable(),
  fulfillmentStatus: z.string().nullable(),
  paymentStatus: z.string().nullable(),
  customerName: z.string().nullable(),
  customerEntityId: z.string().uuid().nullable(),
  netAmount: z.string(),
  grossAmount: z.string(),
  currency: z.string().nullable(),
  createdAt: z.string(),  // ISO 8601
})

const responseSchema = z.object({
  items: z.array(orderItemSchema),
  total: z.number(),
  dateRange: z.object({
    from: z.string(),
    to: z.string(),
  }),
})
```

#### Authorization

```typescript
export const metadata = {
  GET: {
    requireAuth: true,
    requireFeatures: ['dashboards.view', 'sales.widgets.new-orders'],
  },
}
```

#### Implementation Logic

```typescript
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const query = querySchema.parse(Object.fromEntries(searchParams))

  const container = await getRequestContainer()
  const em = container.resolve<EntityManager>('em')
  const authContext = container.resolve<AuthContext>('authContext')

  // Resolve scope
  const tenantId = query.tenantId ?? authContext.tenantId
  const organizationId = query.organizationId ?? authContext.organizationId

  if (!tenantId) {
    return NextResponse.json({ error: 'Missing tenant' }, { status: 400 })
  }

  // Calculate date range
  const { from, to } = resolveDateRange(query.datePeriod, query.customFrom, query.customTo)

  // Build filters
  const filters: any = {
    tenant_id: tenantId,
    deleted_at: null,
  }

  if (organizationId) {
    filters.organization_id = organizationId
  }

  // Add date range filter
  filters.created_at = {
    $gte: from,
    $lte: to,
  }

  // Fetch orders
  const [items, total] = await em.findAndCount(
    'SalesOrder',
    filters,
    {
      orderBy: { created_at: 'DESC' },
      limit: query.limit,
    }
  )

  // Transform to response format
  const responseItems = items.map((order) => ({
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    fulfillmentStatus: order.fulfillmentStatus,
    paymentStatus: order.paymentStatus,
    customerName: extractCustomerName(order.customerSnapshot),
    customerEntityId: order.customerEntityId,
    netAmount: order.netAmount,
    grossAmount: order.grossAmount,
    currency: order.currency,
    createdAt: order.createdAt.toISOString(),
  }))

  return NextResponse.json({
    items: responseItems,
    total,
    dateRange: {
      from: from.toISOString(),
      to: to.toISOString(),
    },
  })
}
```

#### Helper: Date Range Resolver

```typescript
function resolveDateRange(
  period: DatePeriodOption,
  customFrom?: string,
  customTo?: string
): { from: Date; to: Date } {
  const now = new Date()
  const to = now

  switch (period) {
    case 'last24h':
      const from24h = new Date(now.getTime() - 24 * 60 * 60 * 1000)
      return { from: from24h, to }

    case 'last7d':
      const from7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
      return { from: from7d, to }

    case 'last30d':
      const from30d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
      return { from: from30d, to }

    case 'custom':
      const fromDate = customFrom ? new Date(customFrom) : new Date(0)
      const toDate = customTo ? new Date(customTo) : now
      return { from: fromDate, to: toDate }

    default:
      const fromDefault = new Date(now.getTime() - 24 * 60 * 60 * 1000)
      return { from: fromDefault, to }
  }
}
```

#### Helper: Customer Name Extractor

```typescript
function extractCustomerName(snapshot: any): string | null {
  if (!snapshot || typeof snapshot !== 'object') return null

  // Try common name fields
  return (
    snapshot.display_name ??
    snapshot.displayName ??
    snapshot.name ??
    snapshot.company_name ??
    snapshot.companyName ??
    snapshot.full_name ??
    snapshot.fullName ??
    null
  )
}
```

#### OpenAPI Documentation

```typescript
export const openApi: OpenApiRouteDoc = {
  tag: 'Sales',
  summary: 'New orders dashboard widget',
  description: 'Fetches recently created sales orders for the dashboard widget with configurable date period.',
  methods: {
    GET: {
      query: querySchema,
      responses: [
        {
          status: 200,
          description: 'List of recent orders',
          schema: responseSchema,
        },
      ],
      errors: [
        { status: 400, description: 'Invalid query parameters or missing tenant' },
        { status: 401, description: 'Unauthorized' },
        { status: 403, description: 'Forbidden - missing required features' },
      ],
    },
  },
}
```

---

### New Quotes Widget API

**Endpoint:** `GET /api/sales/dashboard/widgets/new-quotes`
**File:** `packages/core/src/modules/sales/api/dashboard/widgets/new-quotes/route.ts`

#### Request Query Parameters

```typescript
const querySchema = z.object({
  limit: z.coerce.number().min(1).max(20).default(5),
  datePeriod: z.enum(['last24h', 'last7d', 'last30d', 'custom']).default('last24h'),
  customFrom: z.string().optional(),   // ISO 8601 date string
  customTo: z.string().optional(),     // ISO 8601 date string
  tenantId: z.string().uuid().optional(),
  organizationId: z.string().uuid().optional(),
})
```

#### Response Schema

```typescript
const quoteItemSchema = z.object({
  id: z.string().uuid(),
  quoteNumber: z.string(),
  status: z.string().nullable(),
  customerName: z.string().nullable(),
  customerEntityId: z.string().uuid().nullable(),
  validFrom: z.string().nullable(),
  validUntil: z.string().nullable(),
  netAmount: z.string(),
  grossAmount: z.string(),
  currency: z.string().nullable(),
  createdAt: z.string(),  // ISO 8601
  convertedOrderId: z.string().uuid().nullable(),
})

const responseSchema = z.object({
  items: z.array(quoteItemSchema),
  total: z.number(),
  dateRange: z.object({
    from: z.string(),
    to: z.string(),
  }),
})
```

#### Authorization

```typescript
export const metadata = {
  GET: {
    requireAuth: true,
    requireFeatures: ['dashboards.view', 'sales.widgets.new-quotes'],
  },
}
```

#### Implementation Logic

Similar to New Orders widget, but:
- Query `SalesQuote` entity instead of `SalesOrder`
- Include `validFrom`, `validUntil`, and `convertedOrderId` in response
- Use same date range resolution and customer name extraction helpers

#### OpenAPI Documentation

```typescript
export const openApi: OpenApiRouteDoc = {
  tag: 'Sales',
  summary: 'New quotes dashboard widget',
  description: 'Fetches recently created sales quotes for the dashboard widget with configurable date period.',
  methods: {
    GET: {
      query: querySchema,
      responses: [
        {
          status: 200,
          description: 'List of recent quotes',
          schema: responseSchema,
        },
      ],
      errors: [
        { status: 400, description: 'Invalid query parameters or missing tenant' },
        { status: 401, description: 'Unauthorized' },
        { status: 403, description: 'Forbidden - missing required features' },
      ],
    },
  },
}
```

---

## UI/UX

### New Orders Widget

**File:** `packages/core/src/modules/sales/widgets/dashboard/new-orders/widget.client.tsx`

#### Component Structure

```typescript
"use client"

import * as React from 'react'
import type { DashboardWidgetComponentProps } from '@open-mercato/shared/modules/dashboard/widgets'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { formatCurrency } from '@open-mercato/shared/lib/format/currency'
import { formatRelativeDate } from '@open-mercato/shared/lib/format/date'
import type { SalesNewOrdersSettings, DatePeriodOption } from './config'
import { DEFAULT_SETTINGS, hydrateSalesNewOrdersSettings } from './config'

const SalesNewOrdersWidget: React.FC<DashboardWidgetComponentProps<SalesNewOrdersSettings>> = ({
  mode,
  settings = DEFAULT_SETTINGS,
  onSettingsChange,
  refreshToken,
  onRefreshStateChange,
}) => {
  const t = useT()
  const hydrated = React.useMemo(() => hydrateSalesNewOrdersSettings(settings), [settings])

  const [data, setData] = React.useState<any[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [locale, setLocale] = React.useState<string | undefined>(undefined)

  // Detect browser locale
  React.useEffect(() => {
    if (typeof navigator !== 'undefined') {
      setLocale(navigator.language)
    }
  }, [])

  // Fetch data
  const refresh = React.useCallback(async () => {
    onRefreshStateChange?.(true)
    setLoading(true)
    setError(null)

    try {
      const params = new URLSearchParams({
        limit: hydrated.pageSize.toString(),
        datePeriod: hydrated.datePeriod,
      })

      if (hydrated.datePeriod === 'custom') {
        if (hydrated.customFrom) params.set('customFrom', hydrated.customFrom)
        if (hydrated.customTo) params.set('customTo', hydrated.customTo)
      }

      const call = await apiCall<any>(`/api/sales/dashboard/widgets/new-orders?${params}`)

      if (!call.ok) {
        throw new Error('Failed to fetch orders')
      }

      setData(call.result?.items ?? [])
    } catch (err) {
      setError(t('sales.widgets.newOrders.error', 'Failed to load orders'))
    } finally {
      setLoading(false)
      onRefreshStateChange?.(false)
    }
  }, [hydrated, onRefreshStateChange, t])

  React.useEffect(() => {
    refresh()
  }, [refresh, refreshToken])

  // Settings mode
  if (mode === 'settings') {
    return (
      <div className="space-y-4 text-sm">
        {/* Page Size */}
        <div className="space-y-1.5">
          <label htmlFor="new-orders-page-size" className="text-xs font-semibold uppercase text-muted-foreground">
            {t('sales.widgets.newOrders.settings.pageSize', 'Number of Orders')}
          </label>
          <input
            id="new-orders-page-size"
            type="number"
            min="1"
            max="20"
            value={hydrated.pageSize}
            onChange={(e) => {
              const value = Math.max(1, Math.min(20, parseInt(e.target.value, 10) || 1))
              onSettingsChange({ ...hydrated, pageSize: value })
            }}
            className="w-24 rounded-md border px-2 py-1 text-sm"
          />
        </div>

        {/* Date Period */}
        <div className="space-y-1.5">
          <label htmlFor="new-orders-date-period" className="text-xs font-semibold uppercase text-muted-foreground">
            {t('sales.widgets.newOrders.settings.datePeriod', 'Date Period')}
          </label>
          <select
            id="new-orders-date-period"
            value={hydrated.datePeriod}
            onChange={(e) => {
              onSettingsChange({ ...hydrated, datePeriod: e.target.value as DatePeriodOption })
            }}
            className="w-full rounded-md border px-2 py-1 text-sm"
          >
            <option value="last24h">{t('sales.widgets.newOrders.settings.last24h', 'Last 24 hours')}</option>
            <option value="last7d">{t('sales.widgets.newOrders.settings.last7d', 'Last 7 days')}</option>
            <option value="last30d">{t('sales.widgets.newOrders.settings.last30d', 'Last 30 days')}</option>
            <option value="custom">{t('sales.widgets.newOrders.settings.custom', 'Custom range')}</option>
          </select>
        </div>

        {/* Custom Date Range (only show if datePeriod is 'custom') */}
        {hydrated.datePeriod === 'custom' && (
          <>
            <div className="space-y-1.5">
              <label htmlFor="new-orders-custom-from" className="text-xs font-semibold uppercase text-muted-foreground">
                {t('sales.widgets.newOrders.settings.customFrom', 'From')}
              </label>
              <input
                id="new-orders-custom-from"
                type="date"
                value={hydrated.customFrom ?? ''}
                onChange={(e) => {
                  onSettingsChange({ ...hydrated, customFrom: e.target.value })
                }}
                className="w-full rounded-md border px-2 py-1 text-sm"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="new-orders-custom-to" className="text-xs font-semibold uppercase text-muted-foreground">
                {t('sales.widgets.newOrders.settings.customTo', 'To')}
              </label>
              <input
                id="new-orders-custom-to"
                type="date"
                value={hydrated.customTo ?? ''}
                onChange={(e) => {
                  onSettingsChange({ ...hydrated, customTo: e.target.value })
                }}
                className="w-full rounded-md border px-2 py-1 text-sm"
              />
            </div>
          </>
        )}
      </div>
    )
  }

  // View mode - loading state
  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Spinner className="h-6 w-6" />
      </div>
    )
  }

  // View mode - error state
  if (error) {
    return <p className="text-sm text-destructive">{error}</p>
  }

  // View mode - empty state
  if (data.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {t('sales.widgets.newOrders.empty', 'No orders found in this period')}
      </p>
    )
  }

  // View mode - data list
  return (
    <ul className="space-y-3">
      {data.map((order) => (
        <li key={order.id} className="flex items-start justify-between gap-2 text-sm">
          <div className="flex-1 space-y-0.5">
            <div className="flex items-center gap-2">
              <a
                href={`/backend/sales/orders/${order.id}`}
                className="font-medium text-foreground hover:underline"
              >
                {order.orderNumber}
              </a>
              {order.status && (
                <Badge variant="outline" className="text-xs">
                  {order.status}
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {order.customerName ?? t('sales.widgets.newOrders.noCustomer', 'No customer')}
            </p>
            <p className="text-xs text-muted-foreground">
              {formatRelativeDate(order.createdAt, locale)}
            </p>
          </div>
          <div className="text-right">
            <p className="font-semibold">
              {formatCurrency(parseFloat(order.grossAmount), order.currency ?? 'USD')}
            </p>
          </div>
        </li>
      ))}
    </ul>
  )
}

export default SalesNewOrdersWidget
```

#### Visual Design

**Card Header:**
- Title: "New Orders" (from widget metadata)
- Refresh button (if `supportsRefresh: true`)
- Settings gear icon

**Settings Panel:**
```
┌─────────────────────────────────┐
│ NUMBER OF ORDERS                │
│ [  5  ]                         │
│                                 │
│ DATE PERIOD                     │
│ [Last 24 hours  ▼]              │
│                                 │
│ (If "Custom range" selected)    │
│ FROM                            │
│ [2026-01-20]                    │
│                                 │
│ TO                              │
│ [2026-01-27]                    │
└─────────────────────────────────┘
```

**View Panel:**
```
┌─────────────────────────────────┐
│ SO-00123 [Pending]              │
│ Acme Corp                       │
│ 2 hours ago                     │
│                      $1,234.56  │
├─────────────────────────────────┤
│ SO-00122 [Confirmed]            │
│ TechStart Inc                   │
│ 5 hours ago                     │
│                        $987.00  │
├─────────────────────────────────┤
│ SO-00121 [Shipped]              │
│ Global Traders                  │
│ 1 day ago                       │
│                      $5,432.10  │
└─────────────────────────────────┘
```

**Interactive States:**
- **Loading:** Centered spinner
- **Error:** Red error message
- **Empty:** Gray "No orders found" message
- **Hover:** Order number underlines on hover
- **Click:** Navigate to order detail page

---

### New Quotes Widget

**File:** `packages/core/src/modules/sales/widgets/dashboard/new-quotes/widget.client.tsx`

#### Component Structure

Similar to New Orders widget with the following differences:

1. **API Endpoint:** `/api/sales/dashboard/widgets/new-quotes`
2. **Translation Keys:** `sales.widgets.newQuotes.*`
3. **Navigation:** `/backend/sales/quotes/${quote.id}`
4. **Data Fields:**
   - Display `quoteNumber` instead of `orderNumber`
   - Show validity period if `validFrom`/`validUntil` exist
   - Indicate converted quotes with a badge or icon

#### Visual Design Differences

**View Panel:**
```
┌─────────────────────────────────┐
│ QT-00045 [Draft]                │
│ Acme Corp                       │
│ Valid until: 2026-02-15         │
│ 2 hours ago                     │
│                      $1,234.56  │
├─────────────────────────────────┤
│ QT-00044 [Sent] ✓ Converted     │
│ TechStart Inc                   │
│ Valid until: 2026-02-10         │
│ 5 hours ago                     │
│                        $987.00  │
├─────────────────────────────────┤
│ QT-00043 [Expired]              │
│ Global Traders                  │
│ Valid until: 2026-01-25         │
│ 1 day ago                       │
│                      $5,432.10  │
└─────────────────────────────────┘
```

**Additional Elements:**
- **Validity Period:** Display "Valid until: {date}" if `validUntil` exists
- **Converted Badge:** Show checkmark or "Converted" badge if `convertedOrderId` is not null
- **Expired Visual:** Use muted colors or strikethrough if quote is expired

---

### Widget Module Exports

#### New Orders Widget Module
**File:** `packages/core/src/modules/sales/widgets/dashboard/new-orders/widget.ts`

```typescript
import type { DashboardWidgetModule } from '@open-mercato/shared/modules/dashboard/widgets'
import SalesNewOrdersWidget from './widget.client'
import { DEFAULT_SETTINGS, hydrateSalesNewOrdersSettings, type SalesNewOrdersSettings } from './config'

const widget: DashboardWidgetModule<SalesNewOrdersSettings> = {
  metadata: {
    id: 'sales.dashboard.newOrders',
    title: 'New Orders',
    description: 'Displays recently created sales orders',
    features: ['dashboards.view', 'sales.widgets.new-orders'],
    defaultSize: 'md',
    defaultEnabled: true,
    defaultSettings: DEFAULT_SETTINGS,
    tags: ['sales', 'orders'],
    category: 'sales',
    icon: 'lucide:shopping-cart',
    supportsRefresh: true,
  },
  Widget: SalesNewOrdersWidget,
  hydrateSettings: hydrateSalesNewOrdersSettings,
  dehydrateSettings: (settings) => ({
    pageSize: settings.pageSize,
    datePeriod: settings.datePeriod,
    customFrom: settings.customFrom,
    customTo: settings.customTo,
  }),
}

export default widget
```

#### New Quotes Widget Module
**File:** `packages/core/src/modules/sales/widgets/dashboard/new-quotes/widget.ts`

```typescript
import type { DashboardWidgetModule } from '@open-mercato/shared/modules/dashboard/widgets'
import SalesNewQuotesWidget from './widget.client'
import { DEFAULT_SETTINGS, hydrateSalesNewQuotesSettings, type SalesNewQuotesSettings } from './config'

const widget: DashboardWidgetModule<SalesNewQuotesSettings> = {
  metadata: {
    id: 'sales.dashboard.newQuotes',
    title: 'New Quotes',
    description: 'Displays recently created sales quotes',
    features: ['dashboards.view', 'sales.widgets.new-quotes'],
    defaultSize: 'md',
    defaultEnabled: true,
    defaultSettings: DEFAULT_SETTINGS,
    tags: ['sales', 'quotes'],
    category: 'sales',
    icon: 'lucide:file-text',
    supportsRefresh: true,
  },
  Widget: SalesNewQuotesWidget,
  hydrateSettings: hydrateSalesNewQuotesSettings,
  dehydrateSettings: (settings) => ({
    pageSize: settings.pageSize,
    datePeriod: settings.datePeriod,
    customFrom: settings.customFrom,
    customTo: settings.customTo,
  }),
}

export default widget
```

---

## Configuration

### Access Control Features

Both widgets require the following features to be added to the sales module ACL:

**File:** `packages/core/src/modules/sales/acl.ts`

```typescript
export const features = [
  // ... existing features
  'sales.widgets.new-orders',
  'sales.widgets.new-quotes',
]
```

### Role Assignment

Default admin roles should be granted these features during `mercato init`:

**File:** `packages/core/src/modules/auth/cli.ts` (seeding logic)

```typescript
const salesWidgetFeatures = [
  'sales.widgets.new-orders',
  'sales.widgets.new-quotes',
]

// Add to admin role ACL
```

### Environment Variables

No new environment variables are required. Widgets use existing infrastructure:
- `DATABASE_URL` - Database connection
- Multi-tenant scope from auth context

### Generator Discovery

Widgets are automatically discovered during module generation:
```bash
npm run modules:prepare
```

**Discovery pattern:**
- Scan: `packages/core/src/modules/sales/widgets/dashboard/*/widget.ts`
- Generate: `apps/mercato/.mercato/generated/dashboard-widgets.generated.ts`
- Entry format: `{ moduleId: 'sales', key: 'sales:new-orders:widget', source: 'package', loader: ... }`

---

## Internationalization

### Translation Keys

**File:** `packages/core/src/modules/sales/i18n/en.json`

```json
{
  "sales": {
    "widgets": {
      "newOrders": {
        "error": "Failed to load orders",
        "empty": "No orders found in this period",
        "noCustomer": "No customer",
        "settings": {
          "pageSize": "Number of Orders",
          "datePeriod": "Date Period",
          "last24h": "Last 24 hours",
          "last7d": "Last 7 days",
          "last30d": "Last 30 days",
          "custom": "Custom range",
          "customFrom": "From",
          "customTo": "To"
        }
      },
      "newQuotes": {
        "error": "Failed to load quotes",
        "empty": "No quotes found in this period",
        "noCustomer": "No customer",
        "validUntil": "Valid until: {date}",
        "converted": "Converted",
        "settings": {
          "pageSize": "Number of Quotes",
          "datePeriod": "Date Period",
          "last24h": "Last 24 hours",
          "last7d": "Last 7 days",
          "last30d": "Last 30 days",
          "custom": "Custom range",
          "customFrom": "From",
          "customTo": "To"
        }
      }
    }
  }
}
```

**Additional locale files** should mirror the same structure for all supported languages.

---

## Testing Strategy

### Unit Tests

#### Widget Settings Hydration
**File:** `packages/core/src/modules/sales/widgets/dashboard/new-orders/__tests__/config.test.ts`

```typescript
import { describe, it, expect } from 'vitest'
import { hydrateSalesNewOrdersSettings, DEFAULT_SETTINGS } from '../config'

describe('hydrateSalesNewOrdersSettings', () => {
  it('should return default settings for null input', () => {
    expect(hydrateSalesNewOrdersSettings(null)).toEqual(DEFAULT_SETTINGS)
  })

  it('should validate and clamp pageSize', () => {
    expect(hydrateSalesNewOrdersSettings({ pageSize: 0 })).toHaveProperty('pageSize', DEFAULT_SETTINGS.pageSize)
    expect(hydrateSalesNewOrdersSettings({ pageSize: 25 })).toHaveProperty('pageSize', 20)
    expect(hydrateSalesNewOrdersSettings({ pageSize: 10 })).toHaveProperty('pageSize', 10)
  })

  it('should validate datePeriod', () => {
    expect(hydrateSalesNewOrdersSettings({ datePeriod: 'invalid' })).toHaveProperty('datePeriod', DEFAULT_SETTINGS.datePeriod)
    expect(hydrateSalesNewOrdersSettings({ datePeriod: 'last7d' })).toHaveProperty('datePeriod', 'last7d')
  })

  it('should include custom dates only when datePeriod is custom', () => {
    const result = hydrateSalesNewOrdersSettings({
      datePeriod: 'custom',
      customFrom: '2026-01-20T00:00:00Z',
      customTo: '2026-01-27T23:59:59Z',
    })
    expect(result.customFrom).toBe('2026-01-20T00:00:00Z')
    expect(result.customTo).toBe('2026-01-27T23:59:59Z')
  })
})
```

#### Date Range Resolution
**File:** `packages/core/src/modules/sales/api/dashboard/widgets/__tests__/dateRange.test.ts`

```typescript
import { describe, it, expect } from 'vitest'
import { resolveDateRange } from '../helpers'

describe('resolveDateRange', () => {
  it('should resolve last24h', () => {
    const { from, to } = resolveDateRange('last24h')
    const diff = to.getTime() - from.getTime()
    expect(diff).toBeCloseTo(24 * 60 * 60 * 1000, -2)
  })

  it('should resolve last7d', () => {
    const { from, to } = resolveDateRange('last7d')
    const diff = to.getTime() - from.getTime()
    expect(diff).toBeCloseTo(7 * 24 * 60 * 60 * 1000, -2)
  })

  it('should resolve custom range', () => {
    const customFrom = '2026-01-20T00:00:00Z'
    const customTo = '2026-01-27T23:59:59Z'
    const { from, to } = resolveDateRange('custom', customFrom, customTo)
    expect(from.toISOString()).toBe(customFrom)
    expect(to.toISOString()).toBe(customTo)
  })
})
```

### Integration Tests

#### API Endpoint Tests
**File:** `packages/core/src/modules/sales/api/dashboard/widgets/new-orders/__tests__/route.test.ts`

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { bootstrapTest } from '@open-mercato/shared/lib/testing/bootstrap'
import { GET } from '../route'

describe('GET /api/sales/dashboard/widgets/new-orders', () => {
  beforeEach(async () => {
    await bootstrapTest()
    // Seed test data: create sample orders
  })

  it('should return 401 for unauthenticated requests', async () => {
    const req = new Request('http://localhost/api/sales/dashboard/widgets/new-orders')
    const res = await GET(req)
    expect(res.status).toBe(401)
  })

  it('should return orders for last 24 hours', async () => {
    // Authenticate request
    const req = new Request('http://localhost/api/sales/dashboard/widgets/new-orders?limit=5&datePeriod=last24h')
    const res = await GET(req)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data).toHaveProperty('items')
    expect(data).toHaveProperty('total')
    expect(data).toHaveProperty('dateRange')
  })

  it('should filter by custom date range', async () => {
    const req = new Request('http://localhost/api/sales/dashboard/widgets/new-orders?datePeriod=custom&customFrom=2026-01-20T00:00:00Z&customTo=2026-01-27T23:59:59Z')
    const res = await GET(req)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.items.length).toBeGreaterThanOrEqual(0)
  })

  it('should respect pageSize limit', async () => {
    const req = new Request('http://localhost/api/sales/dashboard/widgets/new-orders?limit=3')
    const res = await GET(req)
    const data = await res.json()
    expect(data.items.length).toBeLessThanOrEqual(3)
  })
})
```

### E2E Tests (Optional)

Using Playwright or similar:
1. Navigate to dashboard
2. Add "New Orders" widget
3. Verify widget displays orders
4. Change date period to "Last 7 days"
5. Verify data updates
6. Click on order number
7. Verify navigation to order detail page

---

## Implementation Checklist

### Phase 1: New Orders Widget

- [ ] Create widget directory structure
  - [ ] `packages/core/src/modules/sales/widgets/dashboard/new-orders/`
- [ ] Implement config module
  - [ ] `config.ts` - Settings type, defaults, hydration
- [ ] Implement widget module
  - [ ] `widget.ts` - Metadata and exports
- [ ] Implement React component
  - [ ] `widget.client.tsx` - Settings and view UI
- [ ] Implement API endpoint
  - [ ] `packages/core/src/modules/sales/api/dashboard/widgets/new-orders/route.ts`
  - [ ] Query schema validation
  - [ ] Date range resolution helper
  - [ ] Customer name extraction helper
  - [ ] OpenAPI documentation
- [ ] Add access control features
  - [ ] Update `packages/core/src/modules/sales/acl.ts`
  - [ ] Update role seeding in `packages/core/src/modules/auth/cli.ts`
- [ ] Add translations
  - [ ] `packages/core/src/modules/sales/i18n/en.json`
  - [ ] Additional locale files
- [ ] Write tests
  - [ ] Unit tests for settings hydration
  - [ ] Unit tests for date range resolution
  - [ ] Integration tests for API endpoint
- [ ] Run generator
  - [ ] `npm run modules:prepare`
- [ ] Manual testing
  - [ ] Add widget to dashboard
  - [ ] Test all date period options
  - [ ] Test settings changes
  - [ ] Test navigation to order details
  - [ ] Test refresh functionality

### Phase 2: New Quotes Widget

- [ ] Create widget directory structure
  - [ ] `packages/core/src/modules/sales/widgets/dashboard/new-quotes/`
- [ ] Implement config module
  - [ ] `config.ts` - Settings type, defaults, hydration
- [ ] Implement widget module
  - [ ] `widget.ts` - Metadata and exports
- [ ] Implement React component
  - [ ] `widget.client.tsx` - Settings and view UI with quote-specific fields
- [ ] Implement API endpoint
  - [ ] `packages/core/src/modules/sales/api/dashboard/widgets/new-quotes/route.ts`
  - [ ] Query schema validation (reuse helpers from orders)
  - [ ] OpenAPI documentation
- [ ] Add access control features
  - [ ] Update `packages/core/src/modules/sales/acl.ts`
  - [ ] Update role seeding
- [ ] Add translations
  - [ ] Update locale files with quote-specific keys
- [ ] Write tests
  - [ ] Unit tests for settings hydration
  - [ ] Integration tests for API endpoint
- [ ] Run generator
  - [ ] `npm run modules:prepare`
- [ ] Manual testing
  - [ ] Add widget to dashboard
  - [ ] Test all date period options
  - [ ] Test validity period display
  - [ ] Test converted quote indicator
  - [ ] Test refresh functionality

### Phase 3: Shared Utilities (Optional Enhancement)

- [ ] Extract shared date range helpers
  - [ ] `packages/core/src/modules/sales/lib/dateRange.ts`
- [ ] Extract shared customer name helper
  - [ ] `packages/core/src/modules/sales/lib/customerSnapshot.ts`
- [ ] Create reusable date period selector component
  - [ ] `packages/ui/src/components/DatePeriodSelector.tsx`

---

## Future Enhancements

### Potential Improvements

1. **Advanced Filtering**
   - Filter by order/quote status
   - Filter by customer
   - Filter by amount range

2. **Aggregations and Metrics**
   - Total order value in date period
   - Average order value
   - Conversion rate (quotes → orders)
   - Charts and visualizations

3. **Real-time Updates**
   - WebSocket integration for live order/quote creation
   - Toast notifications for new orders

4. **Export Functionality**
   - Export widget data to CSV/Excel
   - Email scheduled reports

5. **Customization Options**
   - Color coding by status
   - Configurable display fields
   - Sort order options

6. **Performance Optimization**
   - Pagination for large datasets
   - Client-side caching with SWR or React Query
   - Incremental data loading

---

## Changelog

### 2026-01-27
- Initial specification for New Orders and New Quotes dashboard widgets
- Defined widget structure, API contracts, and UI components
- Established date period selection patterns
- Documented access control and internationalization requirements
