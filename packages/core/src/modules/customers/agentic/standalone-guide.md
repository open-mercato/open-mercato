# Customers Module — Reference CRUD Patterns

This is the **reference CRUD module**. When building new modules in your standalone app, follow these patterns.

## CRUD API Pattern

Use `makeCrudRoute` with `indexer: { entityType }` for query index coverage:

```typescript
// src/modules/<your_module>/api/get/<entities>.ts
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/make-crud-route'
import { YourEntity } from '../../entities/YourEntity'

const handler = makeCrudRoute({
  entity: YourEntity,
  entityId: 'your_module.your_entity',
  operations: ['list', 'detail'],
  indexer: { entityType: 'your_module.your_entity' },
})

export default handler
export const openApi = { summary: 'List and retrieve entities', tags: ['Your Module'] }
```

Key points:
- Always set `indexer: { entityType }` — keeps custom entities indexed
- Wire custom field helpers for create/update if your module supports custom fields
- Export `openApi` on every API route file

## Undoable Commands Pattern

All write operations should use the Command pattern with undo support:

```typescript
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { extractUndoPayload } from '@open-mercato/shared/lib/commands/undo'

registerCommand('your_module.entity.create', {
  async execute(payload, ctx) {
    // 1. Create entity
    // 2. Capture snapshot for undo: extractUndoPayload(entity)
    // 3. Side effects: emitCrudSideEffects({ indexer: { entityType, cacheAliases } })
  },
  async undo(payload, ctx) {
    // 1. Restore from snapshot
    // 2. Side effects: emitCrudUndoSideEffects({ indexer: { entityType, cacheAliases } })
  },
})
```

Key points:
- Include `indexer: { entityType, cacheAliases }` in both `emitCrudSideEffects` and `emitCrudUndoSideEffects`
- Capture custom field snapshots in `before`/`after` payloads (`snapshot.custom`)
- Restore custom fields via `buildCustomFieldResetMap(before.custom, after.custom)` in undo

## Custom Field Integration

```typescript
import { collectCustomFieldValues } from '@open-mercato/ui/backend/utils/customFieldValues'
```

- Pass `{ transform }` to normalize values (e.g., `normalizeCustomFieldSubmitValue`)
- Works for both `cf_` and `cf:` prefixed keys
- Pass `entityIds` to form helpers so correct custom-field sets are loaded
- If your module ships default custom fields, declare them in `ce.ts` via `entities[].fields`

## Search Configuration

Declare in `search.ts` with all three strategies:

```typescript
import type { SearchModuleConfig } from '@open-mercato/shared/modules/search'

export const searchConfig: SearchModuleConfig = {
  entities: {
    'your_module.your_entity': {
      fields: ['name', 'description'],  // Fulltext indexing
      // fieldPolicy for sensitive field handling
      // buildSource for vector embeddings
      // formatResult for search result display
    },
  },
}
```

Key points:
- Use `fieldPolicy.excluded` for sensitive fields (passwords, tokens)
- Use `fieldPolicy.hashOnly` for PII needing exact-match only (email, phone)
- Always define `formatResult` for human-friendly search results

## Backend Page Structure

Follow this pattern for each page type:

| Page | Pattern | Key Features |
|------|---------|-------------|
| **List** | `DataTable` | Filters, search, export, row actions, pagination |
| **Create** | `CrudForm` mode=create | Fields, groups, custom fields, back link |
| **Detail/Edit** | `CrudForm` mode=edit or tabbed layout | Entity data, related entities, activities |

## Module Files Checklist

When scaffolding a new CRUD module, ensure all these files are present:

| File | Purpose |
|------|---------|
| `index.ts` | Module metadata |
| `acl.ts` | Feature-based permissions |
| `setup.ts` | Tenant init, default role features |
| `di.ts` | Awilix DI registrations |
| `events.ts` | Typed event declarations |
| `data/entities.ts` | MikroORM entity classes |
| `data/validators.ts` | Zod validation schemas |
| `search.ts` | Search indexing configuration |
| `ce.ts` | Custom entities / custom field sets |

Optional:
- `translations.ts` — translatable fields per entity
- `notifications.ts` — notification type definitions
- `cli.ts` — module CLI commands

## Entity Update Safety

When mutating entities across multiple phases that include queries:

```typescript
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'

await withAtomicFlush(em, [
  () => { record.name = 'New'; record.status = 'active' },
  () => syncEntityTags(em, record, tags),
], { transaction: true })

// Side effects AFTER the atomic flush
await emitCrudSideEffects({ ... })
```

Never run `em.find`/`em.findOne` between scalar mutations and `em.flush()` without `withAtomicFlush` — changes will be silently lost.
