# Response Enrichers

**Purpose**: Add computed fields to another module's API response. Fields are namespaced under `_<yourModule>` to avoid collisions.

**File**: `src/modules/<your-module>/data/enrichers.ts`

## Template

```typescript
import type { ResponseEnricher, EnricherContext } from '@open-mercato/shared/lib/crud/response-enricher'

const enricher: ResponseEnricher = {
  id: '<your-module>.<enricher-name>',
  targetEntity: '<target-module>.<entity>',  // e.g., 'customers.person'
  priority: 50,
  timeout: 2000,
  fallback: { _<your-module>: {} },

  async enrichOne(record, context: EnricherContext) {
    const em = context.em as EntityManager
    // Fetch your data for this single record
    const data = await em.findOne(YourEntity, {
      foreignId: record.id,
      organizationId: context.organizationId,
    })
    return {
      ...record,
      _<your-module>: {
        fieldName: data?.value ?? null,
      },
    }
  },

  // REQUIRED for list endpoints — prevents N+1 queries
  async enrichMany(records, context: EnricherContext) {
    const em = context.em as EntityManager
    const ids = records.map(r => r.id)
    // Single batch query for ALL records
    const items = await em.find(YourEntity, {
      foreignId: { $in: ids },
      organizationId: context.organizationId,
    })
    const byForeignId = new Map(items.map(i => [i.foreignId, i]))
    return records.map(r => ({
      ...r,
      _<your-module>: {
        fieldName: byForeignId.get(r.id)?.value ?? null,
      },
    }))
  },
}

export const enrichers = [enricher]
```

## Rules

- **MUST** implement `enrichMany` — without it, list endpoints cause N+1 queries
- **MUST** namespace all added fields under `_<your-module>` prefix
- **MUST NOT** modify existing fields — enrichers are additive-only
- **MUST** use batch queries (`$in`) in `enrichMany`, never per-record lookups
- Set `critical: false` (default) so enricher failures don't break the target API
- Set `timeout` to prevent slow external calls from blocking responses
- Set `fallback` to provide safe defaults when enricher times out

## Context Available

```typescript
interface EnricherContext {
  organizationId: string    // Current tenant org
  tenantId: string          // Current tenant
  userId: string            // Authenticated user
  em: EntityManager         // Read-only database access
  container: AwilixContainer // DI container
  requestedFields?: string[] // Sparse fieldset request
  userFeatures?: string[]   // User's ACL features
}
```
