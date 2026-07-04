# Entities and Fields

## 1. Design Workflow

When the developer describes data requirements:

1. **Clarify entities** — What are the distinct "things" being stored?
2. **Clarify fields** — What data does each entity hold?
3. **Clarify relationships** — How do entities relate? (1:1, 1:N, N:M, cross-module?)
4. **Choose patterns** — Select the right pattern for each relationship
5. **Generate** — Create entity files, validators, and migrations
6. **Verify** — Check migration output, test queries

---

## 2. Entity Design

### Standard Entity Template

Define entities in `src/modules/<module_id>/data/entities.ts`. Standalone apps keep the module's entity classes together there unless the file becomes large enough that a split is justified.

```typescript
import { Entity, Enum, Index, PrimaryKey, Property } from '@mikro-orm/decorators/legacy'
import { v4 } from 'uuid'

@Entity({ tableName: '<entities>' })
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
  // (see Field Types section)

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

### Required Columns (Every Tenant-Scoped Entity)

| Column | Type | Purpose | Indexed |
|--------|------|---------|---------|
| `id` | `uuid` | Primary key (v4 auto-generated) | PK |
| `organization_id` | `uuid` | Tenant organization scope | Yes |
| `tenant_id` | `uuid` | Tenant scope | Yes |
| `is_active` | `boolean` | Soft active/inactive flag | No |
| `created_at` | `timestamptz` | Creation timestamp | No |
| `updated_at` | `timestamptz` | Last update (auto) | No |
| `deleted_at` | `timestamptz?` | Soft delete timestamp | No |

---

## 3. Field Types

### Type Selection Guide

| Data | MikroORM Type | PostgreSQL Type | Decorator |
|------|--------------|-----------------|-----------|
| Short text (name, title) | `varchar` | `varchar(255)` | `@Property({ type: 'varchar', length: 255 })` |
| Long text (description, notes) | `text` | `text` | `@Property({ type: 'text' })` |
| Integer | `int` | `integer` | `@Property({ type: 'int' })` |
| Decimal (money, quantity) | `decimal` | `numeric(precision,scale)` | `@Property({ type: 'decimal', precision: 10, scale: 2 })` |
| Boolean | `boolean` | `boolean` | `@Property({ type: 'boolean', default: false })` |
| UUID reference | `uuid` | `uuid` | `@Property({ type: 'uuid' })` |
| Date only | `date` | `date` | `@Property({ type: 'date' })` |
| Date + time | `timestamptz` | `timestamptz` | `@Property({ type: 'timestamptz' })` |
| Enum | `varchar` | `varchar` | `@Enum({ items: () => MyEnum })` |
| Flexible JSON | `jsonb` | `jsonb` | `@Property({ type: 'jsonb', nullable: true })` |
| Array of strings | `jsonb` | `jsonb` | `@Property({ type: 'jsonb', default: '[]' })` |
| Email | `varchar` | `varchar(320)` | `@Property({ type: 'varchar', length: 320 })` |
| URL | `text` | `text` | `@Property({ type: 'text' })` |
| Phone | `varchar` | `varchar(50)` | `@Property({ type: 'varchar', length: 50 })` |

### When to Use JSONB

Use `jsonb` when:
- Schema is flexible/user-defined (custom field values, metadata, tags)
- Data is read as a whole, not queried by individual fields
- Nesting is natural (address objects, configuration maps)

Avoid `jsonb` when:
- You need to query, filter, or sort by individual fields — use proper columns
- Data has a fixed, well-known schema — use columns for type safety
- You need referential integrity — FKs can't point into JSONB

### Enum Pattern

```typescript
export enum OrderStatus {
  DRAFT = 'draft',
  PENDING = 'pending',
  CONFIRMED = 'confirmed',
  SHIPPED = 'shipped',
  DELIVERED = 'delivered',
  CANCELLED = 'cancelled',
}

@Enum({ items: () => OrderStatus })
status: OrderStatus = OrderStatus.DRAFT
```

### Nullable Fields

```typescript
// Optional field — nullable
@Property({ type: 'varchar', length: 255, nullable: true })
notes: string | null = null

// Required field — not nullable (default)
@Property({ type: 'varchar', length: 255 })
name!: string  // Use ! for required fields set during creation
```
