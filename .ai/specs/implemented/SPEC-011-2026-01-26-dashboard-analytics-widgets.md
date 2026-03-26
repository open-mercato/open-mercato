# Dashboard Analytics Widgets

## Overview

The Dashboard Analytics Widgets module provides reusable, configurable widgets for displaying aggregated business data on dashboards. It features an extensible analytics registry that allows any module to contribute analytics configurations without modifying the core dashboards module.

## Architecture

### Analytics Registry Pattern

The module follows an auto-discovery pattern similar to `search.ts` for extensibility:

1. **Module Analytics Configs**: Each module can define analytics configurations in `analytics.ts`
2. **Generator Discovery**: The CLI generator scans for `analytics.ts` files and generates `analytics.generated.ts`
3. **Runtime Registry**: Configurations are registered at startup via the global registry
4. **DI Integration**: The `analyticsRegistry` service is available via dependency injection

### Components Location

| Component | Location | Description |
|-----------|----------|-------------|
| Chart Components | `@open-mercato/ui/backend/charts` | BarChart, LineChart, PieChart, KpiCard, TopNTable |
| Date Range Components | `@open-mercato/ui/backend/date-range` | DateRangeSelect, InlineDateRangeSelect, date utilities |
| Analytics Types | `@open-mercato/shared/modules/analytics` | Shared types and global registry |
| Registry Service | `packages/core/src/modules/dashboards/services/analyticsRegistry.ts` | Runtime registry implementation |
| Widget Data Service | `packages/core/src/modules/dashboards/services/widgetDataService.ts` | Query execution with caching |

## Data Models

### Analytics Entity Configuration

```typescript
type AnalyticsEntityConfig = {
  entityId: string
  requiredFeatures?: string[]
  entityConfig: AnalyticsEntityTypeConfig
  fieldMappings: Record<string, AnalyticsFieldMapping>
  labelResolvers?: Record<string, AnalyticsLabelResolverConfig>
}

type AnalyticsEntityTypeConfig = {
  tableName: string
  schema?: string
  dateField: string
  defaultScopeFields: string[]
}

type AnalyticsFieldMapping = {
  dbColumn: string
  type: 'numeric' | 'text' | 'timestamp' | 'uuid' | 'jsonb'
}

type AnalyticsLabelResolverConfig = {
  table: string
  idColumn: string
  labelColumn: string
}
```

### Module Configuration

```typescript
// src/modules/<module>/analytics.ts
import type { AnalyticsModuleConfig } from '@open-mercato/shared/modules/analytics'

export const analyticsConfig: AnalyticsModuleConfig = {
  entities: [
    {
      entityId: 'module:entity',
      requiredFeatures: ['module.entity.view'],
      entityConfig: {
        tableName: 'entity_table',
        dateField: 'created_at',
        defaultScopeFields: ['tenant_id', 'organization_id'],
      },
      fieldMappings: {
        id: { dbColumn: 'id', type: 'uuid' },
        name: { dbColumn: 'name', type: 'string' },
        // ...
      },
    },
  ],
}

export default analyticsConfig
```

## API Contracts

### Widget Data Endpoint

**POST** `/api/dashboards/widgets/data`

```typescript
// Request
type WidgetDataRequest = {
  entityType: string  // e.g., 'sales:orders', 'customers:deals'
  metric: {
    field: string
    aggregate: 'count' | 'sum' | 'avg' | 'min' | 'max'
  }
  groupBy?: {
    field: string
    granularity?: 'day' | 'week' | 'month' | 'quarter' | 'year'
    limit?: number
    resolveLabels?: boolean
  }
  filters?: Array<{
    field: string
    operator: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'not_in' | 'is_null' | 'is_not_null'
    value?: unknown
  }>
  dateRange?: {
    field: string
    preset: DateRangePreset
  }
  comparison?: {
    type: 'previous_period' | 'previous_year'
  }
}

// Response
type WidgetDataResponse = {
  value: number | null
  data: Array<{
    groupKey: unknown
    groupLabel?: string
    value: number | null
  }>
  comparison?: {
    value: number | null
    change: number
    direction: 'up' | 'down' | 'unchanged'
  }
  metadata: {
    fetchedAt: string
    recordCount: number
  }
}
```

## Caching

Widget data responses are cached with 2-minute TTL. The cache system automatically falls back to in-memory storage if Redis is not configured.

Cache tags for invalidation:
- `widget-data` - All widget data
- `widget-data:${entityType}` - Specific entity type (e.g., `widget-data:sales:orders`)

## Available Widgets

| Widget | Entity Type | Chart Type | Description |
|--------|-------------|------------|-------------|
| Revenue KPI | sales:orders | KpiCard | Total revenue with comparison |
| Orders KPI | sales:orders | KpiCard | Order count with comparison |
| AOV KPI | sales:orders | KpiCard | Average order value |
| New Customers KPI | customers:entities | KpiCard | New customer count |
| Revenue Trend | sales:orders | LineChart | Revenue over time |
| Orders by Status | sales:orders | PieChart | Order distribution by status |
| Pipeline Summary | customers:deals | BarChart | Deal value by pipeline stage |
| Sales by Region | sales:orders | BarChart | Revenue by shipping region |
| Top Products | sales:order_lines | BarChart | Best-selling products |
| Top Customers | sales:orders | TopNTable | Highest-revenue customers |

## Adding New Analytics

### Step 1: Create Module Analytics Config

Create `analytics.ts` in your module:

```typescript
// packages/core/src/modules/my_module/analytics.ts
import type { AnalyticsModuleConfig } from '@open-mercato/shared/modules/analytics'

export const analyticsConfig: AnalyticsModuleConfig = {
  entities: [
    {
      entityId: 'my_module:items',
      requiredFeatures: ['my_module.items.view'],
      entityConfig: {
        tableName: 'my_module_items',
        dateField: 'created_at',
        defaultScopeFields: ['tenant_id', 'organization_id'],
      },
      fieldMappings: {
        id: { dbColumn: 'id', type: 'uuid' },
        amount: { dbColumn: 'amount', type: 'numeric' },
        status: { dbColumn: 'status', type: 'text' },
        createdAt: { dbColumn: 'created_at', type: 'timestamp' },
      },
    },
  ],
}

export default analyticsConfig
```

### Step 2: Regenerate Registry

```bash
npm run modules:prepare
```

### Step 3: Create Widget Component

Use the shared chart components from `@open-mercato/ui/backend/charts`:

```typescript
import { KpiCard } from '@open-mercato/ui/backend/charts'
import { DateRangeSelect, type DateRangePreset } from '@open-mercato/ui/backend/date-range'
```

## Chart Components API

### KpiCard

```typescript
<KpiCard
  value={12500}
  trend={{ value: 15.3, direction: 'up' }}
  comparisonLabel="vs last month"
  loading={false}
  error={null}
  formatValue={(v) => `$${v.toLocaleString()}`}
/>
```

### BarChart

```typescript
<BarChart
  data={[{ name: 'Product A', Revenue: 5000 }]}
  index="name"
  categories={['Revenue']}
  categoryLabels={{ Revenue: 'Revenue' }}
  layout="horizontal"  // or 'vertical'
  valueFormatter={(v) => `$${v}`}
  colors={['blue']}
/>
```

### LineChart

```typescript
<LineChart
  data={[{ date: 'Jan', Revenue: 5000 }]}
  index="date"
  categories={['Revenue']}
  showArea={true}
  valueFormatter={(v) => `$${v}`}
  colors={['blue']}
/>
```

### PieChart

```typescript
<PieChart
  data={[{ name: 'Pending', value: 30 }]}
  variant="donut"  // or 'pie'
  colors={['blue', 'green']}
/>
```

## Date Range Utilities

```typescript
import {
  resolveDateRange,
  getPreviousPeriod,
  calculatePercentageChange,
  determineChangeDirection,
  isValidDateRangePreset,
  getComparisonLabelKey,
  type DateRangePreset,
} from '@open-mercato/ui/backend/date-range'

// Resolve date range from preset
const { start, end } = resolveDateRange('this_month', new Date())

// Get previous period for comparison
const previous = getPreviousPeriod({ start, end }, 'this_month')

// Calculate percentage change
const change = calculatePercentageChange(current, previous)
const direction = determineChangeDirection(current, previous)
```

## Changelog

### 2026-01-26
- Refactored entity configuration to extensible registry pattern (analytics.ts)
- Moved chart components to `@open-mercato/ui/backend/charts`
- Moved date range components to `@open-mercato/ui/backend/date-range`
- Added 2-minute cache layer to widget data endpoint
- Added `AnalyticsRegistry` service with DI integration
- Created module analytics configs for sales, customers, and catalog
- Updated generator to discover analytics.ts files
- Addresses PR #408 code review feedback

### 2026-01-20
- Initial dashboard analytics widgets implementation
- 10 widget types: KPI cards, charts, and tables
- Widget data aggregation API with date range support
