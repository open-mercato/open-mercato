# FMS Module - Agent Guidelines

This document describes how to configure search indexing for entities in the FMS module.

## Search Architecture Overview

The search system has two layers that must be kept in sync:

```
┌─────────────────────┐     ┌─────────────────────┐     ┌─────────────────────┐
│   Source Tables     │     │   entity_indexes    │     │    Meilisearch      │
│   (PostgreSQL)      │     │   (PostgreSQL)      │     │    (External)       │
├─────────────────────┤     ├─────────────────────┤     ├─────────────────────┤
│ fms_locations       │     │ Denormalized docs   │     │ Full-text search    │
│ fms_quotes          │ ──► │ + custom fields     │ ──► │ Typo-tolerant       │
│ contractors         │     │ + token search      │     │ Fast ranking        │
└─────────────────────┘     └─────────────────────┘     └─────────────────────┘
        CRUD ops               indexer config            search.ts config
```

## Step 1: Configure Indexer in CRUD Routes

Every CRUD route that should be searchable **MUST** have an `indexer` config in `makeCrudRoute`:

```typescript
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { E } from '@open-mercato/fms/generated/entities.ids.generated'

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: FmsLocation,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: E.fms_locations.fms_location },  // ← REQUIRED for search
  list: { ... },
  create: { ... },
  update: { ... },
  del: { ... },
})
```

### What the indexer does

When a CRUD operation (create/update/delete) occurs:

1. `makeCrudRoute` emits `query_index.upsert_one` event
2. Subscriber populates `entity_indexes` table with denormalized document
3. Subscriber emits `search.index_record` event
4. Search indexer updates Meilisearch

### For custom handlers (not using makeCrudRoute)

If you have custom POST/PUT/DELETE handlers, manually emit the event:

```typescript
export async function POST(req: Request) {
  // ... save to database ...

  // Trigger indexing
  const eventBus = container.resolve('eventBus')
  await eventBus.emitEvent('query_index.upsert_one', {
    entityType: 'fms_locations:fms_location',
    recordId: record.id,
    organizationId: record.organizationId,
    tenantId: record.tenantId,
  })

  return NextResponse.json({ id: record.id })
}
```

## Step 2: Create search.ts Configuration

Every module with searchable entities **MUST** provide a `search.ts` file at `src/modules/<module>/search.ts`.

### File Structure

```typescript
import type {
  SearchModuleConfig,
  SearchBuildContext,
  SearchResultPresenter,
  SearchIndexSource,
} from '@open-mercato/shared/modules/search'

// Helper functions
function pickString(...candidates: Array<unknown>): string | null {
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue
    const trimmed = candidate.trim()
    if (trimmed.length > 0) return trimmed
  }
  return null
}

function formatSubtitle(...parts: Array<unknown>): string | undefined {
  const text = parts
    .map((part) => (part === null || part === undefined ? '' : String(part)))
    .map((part) => part.trim())
    .filter(Boolean)
  if (text.length === 0) return undefined
  return text.join(' · ')
}

export const searchConfig: SearchModuleConfig = {
  entities: [
    {
      entityId: 'fms_locations:fms_location',  // Must match E.fms_locations.fms_location
      enabled: true,
      priority: 8,  // Higher = appears first in mixed results

      // Build searchable content for vector/fulltext indexing
      buildSource: async (ctx: SearchBuildContext): Promise<SearchIndexSource | null> => {
        const record = ctx.record
        const lines: string[] = []

        // Add searchable text
        if (record.name) lines.push(`Name: ${record.name}`)
        if (record.code) lines.push(`Code: ${record.code}`)
        if (record.city) lines.push(`City: ${record.city}`)

        if (!lines.length) return null

        return {
          text: lines,
          presenter: {
            title: pickString(record.name, record.code) ?? 'Location',
            subtitle: formatSubtitle(record.code, record.city, record.country),
            icon: 'map-pin',
            badge: 'Location',
          },
        }
      },

      // Format result for display in Cmd+K search
      formatResult: async (ctx: SearchBuildContext): Promise<SearchResultPresenter | null> => {
        return {
          title: pickString(ctx.record.name, ctx.record.code) ?? 'Location',
          subtitle: formatSubtitle(ctx.record.code, ctx.record.city),
          icon: 'map-pin',
          badge: 'Location',
        }
      },

      // URL when result is clicked
      resolveUrl: async (ctx: SearchBuildContext): Promise<string | null> => {
        const id = ctx.record.id as string | undefined
        if (!id) return null
        return `/backend/fms-locations?id=${encodeURIComponent(id)}`
      },

      // Control which fields are indexed
      fieldPolicy: {
        searchable: ['code', 'name', 'locode', 'city', 'country'],  // Full-text searchable
        hashOnly: [],      // Exact match only (sensitive data like tax_id)
        excluded: ['lat', 'lng'],  // Never indexed
      },
    },
  ],
}

export default searchConfig
export const config = searchConfig  // Alternative export name
```

### Entity Config Fields

| Field | Required | Description |
|-------|----------|-------------|
| `entityId` | Yes | Must match `E.<module>.<entity>` from generated IDs |
| `enabled` | No | Default `true` |
| `priority` | No | Higher values appear first (default: 0) |
| `buildSource` | For vector/fulltext | Generates searchable text and presenter |
| `formatResult` | For token search | Formats result at search time |
| `resolveUrl` | Recommended | URL when result is clicked |
| `fieldPolicy` | For fulltext | Controls which fields are indexed |

### Field Policy

```typescript
fieldPolicy: {
  searchable: ['name', 'description'],  // Indexed with typo tolerance
  hashOnly: ['email', 'tax_id'],        // Hashed for exact match only
  excluded: ['password', 'secret'],     // Never indexed
}
```

## Step 3: Reindexing

### When is reindexing needed?

1. **New search.ts config** - After adding/modifying search configuration
2. **Existing data** - Records created before indexer was configured
3. **Schema changes** - After adding new searchable fields

### Reindex Process (Two Steps)

**Step 1: Populate `entity_indexes` table**

```bash
# Reindex specific entity
yarn mercato reindex --entity fms_locations:fms_location --tenant <tenant-id> --force

# Reindex all entities for a tenant
yarn mercato reindex --tenant <tenant-id> --force
```

**Step 2: Populate Meilisearch**

```bash
# Via CLI
yarn mercato search reindex --tenant <tenant-id>

# Or via UI: Admin → Search → Full-Text Search → "Full Reindex" button
```

### Why two steps?

The search reindex worker reads from `entity_indexes`, not from source tables. If `entity_indexes` is empty, the search reindex will find nothing to index.

```
Source Table → (Step 1) → entity_indexes → (Step 2) → Meilisearch
```

### Verify indexing

```sql
-- Check entity_indexes population
SELECT entity_type, COUNT(*)
FROM entity_indexes
WHERE entity_type LIKE 'fms%'
GROUP BY entity_type;

-- Check specific entity
SELECT entity_id, doc
FROM entity_indexes
WHERE entity_type = 'fms_locations:fms_location'
LIMIT 5;
```

## Auto-Discovery

The search configuration is auto-discovered by generators:

1. Generator scans for `search.ts` files in module directories
2. Generates `generated/search.generated.ts` with all configs
3. Bootstrap loads configs via `registerSearchModule()`

Run `yarn modules:prepare` after adding new `search.ts` files.

## Event Flow Summary

```
┌────────────────────────────────────────────────────────────────────────────┐
│  CRUD Operation (POST /api/fms-locations/ports)                            │
└────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────────┐
│  makeCrudRoute with indexer: { entityType: E.fms_locations.fms_location }  │
└────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────────┐
│  eventBus.emitEvent('query_index.upsert_one', { entityType, recordId })    │
└────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────────┐
│  Subscriber: upsertIndexRow() → entity_indexes table populated             │
└────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────────┐
│  eventBus.emitEvent('search.index_record') → Meilisearch updated           │
│  (uses search.ts config: buildSource, fieldPolicy, formatResult)           │
└────────────────────────────────────────────────────────────────────────────┘
```

## Checklist for New Searchable Entities

- [ ] Add `indexer: { entityType: E.<module>.<entity> }` to makeCrudRoute
- [ ] Create or update `search.ts` with entity config
- [ ] Run `yarn modules:prepare` to regenerate search registry
- [ ] Run `yarn mercato reindex --entity <entity> --tenant <id> --force`
- [ ] Run `yarn mercato search reindex --tenant <id>` or use UI "Full Reindex"
- [ ] Verify in Cmd+K search that records appear

## Existing FMS Search Configurations

| Entity | File | Priority |
|--------|------|----------|
| `fms_locations:fms_location` | `fms_locations/search.ts` | 8 |
| `fms_products:fms_charge_code` | `fms_products/search.ts` | 7 |
| `fms_quotes:fms_quote` | `fms_quotes/search.ts` | 10 |
| `fms_quotes:fms_offer` | `fms_quotes/search.ts` | 9 |
| `contractors:contractor` | `contractors/search.ts` | 9 |
