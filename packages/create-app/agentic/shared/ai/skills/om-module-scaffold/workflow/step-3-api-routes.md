# Step 3 — Create API Routes

## 5. Create API Routes

Use `makeCrudRoute` for standard CRUD. All HTTP methods live in a single `route.ts` file.

**File**: `src/modules/<module_id>/api/<entities>/route.ts`

```typescript
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { <Entity> } from '../../data/entities'
import {
  list<Entity>Schema,
  create<Entity>Schema,
  update<Entity>Schema,
} from '../../data/validators'

export const metadata = {
  GET:    { requireAuth: true, requireFeatures: ['<module_id>.<entity>.view'] },
  POST:   { requireAuth: true, requireFeatures: ['<module_id>.<entity>.manage'] },
  PUT:    { requireAuth: true, requireFeatures: ['<module_id>.<entity>.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['<module_id>.<entity>.manage'] },
}

const crud = makeCrudRoute({
  metadata,
  orm: {
    entity: <Entity>,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
  },
  indexer: { entityType: '<module_id>.<entity>' },
  list: {
    schema: list<Entity>Schema,
    entityId: '<module_id>.<entity>',
    fields: ['id', 'name', 'organization_id', 'tenant_id', 'created_at', 'updated_at'],
  },
  create: { schema: create<Entity>Schema },
  update: { schema: update<Entity>Schema },
  del: {},
})

export const { GET, POST, PUT, DELETE } = crud

export const openApi = {
  summary: '<Entity> CRUD',
  tags: ['<Module Name>'],
}
```

### Rules

- All HTTP methods MUST live in a single `api/<entities>/route.ts` file
- MUST export `metadata` — missing it silently breaks route-level auth guards
- MUST export `openApi` for documentation generation
- MUST use `makeCrudRoute` with `indexer: { entityType }` for query engine coverage
- Use `orm`, `list`, `create`, `update`, `del` keys — `entity`/`entityId`/`operations`/`schema` at root level are not valid
