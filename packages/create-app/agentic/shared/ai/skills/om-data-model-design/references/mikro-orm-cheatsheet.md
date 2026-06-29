# MikroORM Entity Cheatsheet

## Property Decorators

```typescript
// String
@Property({ type: 'varchar', length: 255 })
name!: string

// Text (unlimited)
@Property({ type: 'text' })
description!: string

// Integer
@Property({ type: 'int' })
count!: number

// Decimal (money)
@Property({ type: 'decimal', precision: 10, scale: 2 })
amount!: string  // Note: decimals are strings in MikroORM

// Boolean
@Property({ type: 'boolean', default: false })
is_published: boolean = false

// UUID
@Property({ type: 'uuid' })
reference_id!: string

// Date only
@Property({ type: 'date' })
birth_date!: Date

// Date + time with timezone
@Property({ type: 'timestamptz' })
created_at: Date = new Date()

// Auto-update timestamp
@Property({ type: 'timestamptz', onUpdate: () => new Date() })
updated_at: Date = new Date()

// Nullable
@Property({ type: 'varchar', length: 255, nullable: true })
optional_field: string | null = null

// JSONB
@Property({ type: 'jsonb', nullable: true })
metadata: Record<string, unknown> | null = null

// JSONB with default
@Property({ type: 'jsonb', default: '[]' })
tags: string[] = []

// Enum
@Enum({ items: () => StatusEnum })
status: StatusEnum = StatusEnum.DRAFT
```

## Index Decorators

```typescript
// Simple index
@Index()
@Property({ type: 'uuid' })
organization_id!: string

// Unique index
@Index({ unique: true })
@Property({ type: 'varchar', length: 255 })
email!: string

// Composite unique (on entity level)
@Entity({ tableName: 'product_tags' })
@Unique({ properties: ['product_id', 'tag_id'] })
export class ProductTag { ... }
```

## Common Queries

```typescript
// Find all (with tenant filter)
const items = await em.find(Entity, {
  organization_id: orgId,
  deleted_at: null,
})

// Find one by ID
const item = await em.findOne(Entity, {
  id: itemId,
  organization_id: orgId,
})

// Find with conditions
const items = await em.find(Entity, {
  organization_id: orgId,
  status: StatusEnum.ACTIVE,
  created_at: { $gte: startDate },
})

// Find with IN clause (batch lookup)
const items = await em.find(Entity, {
  id: { $in: idArray },
  organization_id: orgId,
})

// Count
const count = await em.count(Entity, {
  organization_id: orgId,
  deleted_at: null,
})

// Pagination
const items = await em.find(Entity, {
  organization_id: orgId,
}, {
  limit: pageSize,
  offset: (page - 1) * pageSize,
  orderBy: { created_at: 'DESC' },
})
```

## Zod Validator Patterns

```typescript
import { z } from 'zod'

// Create schema
export const createEntitySchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  amount: z.number().positive(),
  status: z.enum(['draft', 'active', 'archived']),
  tags: z.array(z.string()).default([]),
  metadata: z.record(z.unknown()).optional(),
  referenceId: z.string().uuid().optional(),
})

// Update schema (partial + required id)
export const updateEntitySchema = createEntitySchema.partial().extend({
  id: z.string().uuid(),
})

// Derive types
export type CreateEntityInput = z.infer<typeof createEntitySchema>
export type UpdateEntityInput = z.infer<typeof updateEntitySchema>
```
