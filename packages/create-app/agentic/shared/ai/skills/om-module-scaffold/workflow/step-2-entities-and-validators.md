# Step 2 — Create Entity & Validators

## 3. Create Entity

**File**: `src/modules/<module_id>/data/entities.ts`

### Template

```typescript
import { Entity, Index, PrimaryKey, Property } from '@mikro-orm/decorators/legacy'
import { v4 } from 'uuid'

@Entity({ tableName: '<entities>' })  // plural, snake_case
export class <Entity> {
  @PrimaryKey({ type: 'uuid' })
  id: string = v4()

  @Index()
  @Property({ type: 'uuid' })
  organization_id!: string

  @Index()
  @Property({ type: 'uuid' })
  tenant_id!: string

  // --- Domain fields ---

  @Property({ type: 'varchar', length: 255 })
  name!: string

  // Add domain-specific fields here
  // Use appropriate types: varchar, text, int, float, boolean, uuid, jsonb, date

  // --- Standard columns ---

  @Property({ type: 'boolean', default: true })
  is_active: boolean = true

  @Property({ type: 'timestamptz' })
  created_at: Date = new Date()

  @Property({ type: 'timestamptz', onUpdate: () => new Date() })
  updated_at: Date = new Date()

  @Property({ type: 'timestamptz', nullable: true })
  deleted_at: Date | null = null
}
```

### Entity Rules

- Table name: **plural, snake_case** — matches module ID
- PK: always `uuid` with `v4()` default
- MUST include `organization_id` + `tenant_id` with `@Index()`
- MUST include `created_at`, `updated_at`, `deleted_at`, `is_active`. The `updated_at` column is what OSS **optimistic locking** (default ON) compares — keep it on every user-editable entity, and make your CRUD GET/list responses return `updatedAt` so the UI can send the expected version.
- Entity decorators MUST come from `@mikro-orm/decorators/legacy`
- Cross-module references: store FK as `uuid` field (e.g., `customer_id`) — never use ORM `@ManyToOne`
- Use `@Property({ type: 'jsonb' })` for flexible/nested data
- Use `@Property({ type: 'varchar', length: N })` for bounded strings
- Use `@Property({ type: 'text' })` for unbounded text

---

## 4. Create Validators

**File**: `src/modules/<module_id>/data/validators.ts`

### Template

```typescript
import { z } from 'zod'

export const list<Entity>Schema = z.object({
  search: z.string().optional(),
  id: z.string().uuid().optional(),
})

export const create<Entity>Schema = z.object({
  name: z.string().min(1).max(255),
  // Add domain fields matching entity
})

export const update<Entity>Schema = create<Entity>Schema.partial().extend({
  id: z.string().uuid(),
})

export type List<Entity>Query = z.infer<typeof list<Entity>Schema>
export type Create<Entity>Input = z.infer<typeof create<Entity>Schema>
export type Update<Entity>Input = z.infer<typeof update<Entity>Schema>
```

### Rules

- Derive TypeScript types from zod via `z.infer<typeof schema>` — never duplicate
- Create schema has all required fields; update schema is `.partial()` with required `id`
- Never include `organization_id`, `tenant_id`, `created_at`, `updated_at` — these are system-managed
