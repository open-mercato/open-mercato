# Analytics Route Pattern

Guidelines for building analytics API routes in Open Mercato modules.

## Standard Auth/RBAC Boilerplate

Every analytics route should follow this pattern:

```typescript
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'

export async function GET(request: Request) {
  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(request)
  if (!auth?.sub && !auth?.isApiKey) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  const rbac = container.resolve('rbacService') as RbacService
  const hasFeature = await rbac.userHasAllFeatures(auth.sub, ['module.analytics.view'], {
    tenantId: auth.tenantId ?? null,
    organizationId: auth.orgId ?? null,
  })
  if (!hasFeature) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  // Analytics logic here...
}
```

## Leveraging `analyticsConfig`

When building analytics that query domain data, use the module's `analyticsConfig` for field mappings instead of hardcoding SQL column names:

```typescript
// Define field mappings in your module's analytics config
export const analyticsConfig = {
  entityType: 'customers:deal',
  fields: {
    value: { column: 'value_amount', type: 'numeric' },
    stage: { column: 'pipeline_stage', type: 'text' },
    closedAt: { column: 'closed_at', type: 'timestamp' },
    source: { column: 'source', type: 'text' },
  },
}

// Use config-driven field resolution in queries
const valueColumn = analyticsConfig.fields.value.column
```

## Standard Response Shapes

### Funnel

```typescript
{
  stages: Array<{
    id: string
    label: string
    count: number
    value: number
    conversionRate: number  // percentage from previous stage
  }>
  totalEntries: number
  overallConversion: number
}
```

### Forecast

```typescript
{
  periods: Array<{
    label: string           // e.g., "2026-Q1"
    predicted: number
    actual: number | null   // null for future periods
    confidence: { low: number; high: number }
  }>
  model: string             // e.g., "weighted_pipeline"
}
```

### Velocity

```typescript
{
  averageDays: number
  median: number
  byStage: Array<{
    stageId: string
    stageLabel: string
    averageDays: number
    median: number
  }>
  period: { from: string; to: string }
}
```

### Sources

```typescript
{
  sources: Array<{
    id: string
    label: string
    count: number
    value: number
    percentage: number
  }>
  period: { from: string; to: string }
}
```

## Common Utilities

- **Trend calculation**: Use `computeTrend` from `@open-mercato/shared/lib/math/trend`
- **Health scoring**: Use `computeHealthScore` from `@open-mercato/shared/lib/scoring/health-score`
- **Alert evaluation**: Use `evaluateAlerts` from `@open-mercato/shared/lib/scoring/alerts`

## Rules

- Always scope queries by `organization_id` and `tenant_id`
- Use parameterized SQL queries (never interpolate user input)
- Set reasonable defaults for date ranges (e.g., last 12 months)
- Include `period` in response for context
- Export `openApi` for API documentation
- Use `findWithDecryption` when querying encrypted entities
