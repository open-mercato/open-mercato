---
name: data-model-design
description: Design entities, relationships, and manage the migration lifecycle. Use when planning a data model, designing entities, choosing relationship patterns, adding cross-module references, or managing database migrations. Triggers on "design entity", "data model", "add entity", "database schema", "migration", "relationship", "many-to-many", "junction table", "foreign key", "jsonb", "add column".
---

# Data Model Design

Design entities, relationships, and manage the migration lifecycle following Open Mercato conventions.

## Table of Contents

1. [Design Workflow](#1-design-workflow)
2. [Entity Design](#2-entity-design)
3. [Field Types](#3-field-types)
4. [Relationship Patterns](#4-relationship-patterns)
5. [Cross-Module References](#5-cross-module-references)
6. [Migration Lifecycle](#6-migration-lifecycle)
7. [Advanced Patterns](#7-advanced-patterns)
8. [Anti-Patterns](#8-anti-patterns)

---

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

```typescript
import { Entity, Property, PrimaryKey, Index, Enum } from '@mikro-orm/core'
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

---

## 4. Relationship Patterns

### One-to-Many (Same Module)

Parent entity has many children. Use `@ManyToOne` / `@OneToMany` decorators **only within the same module**.

```typescript
// Parent: Category
@Entity({ tableName: 'categories' })
export class Category {
  @PrimaryKey({ type: 'uuid' })
  id: string = v4()

  @Property({ type: 'varchar', length: 255 })
  name!: string

  @OneToMany(() => Product, product => product.category)
  products = new Collection<Product>(this)
  // ...standard columns
}

// Child: Product
@Entity({ tableName: 'products' })
export class Product {
  @PrimaryKey({ type: 'uuid' })
  id: string = v4()

  @ManyToOne(() => Category)
  category!: Category
  // ...standard columns
}
```

### Many-to-Many (Same Module)

Use a junction (pivot) table.

```typescript
// Junction table entity
@Entity({ tableName: 'product_tags' })
export class ProductTag {
  @PrimaryKey({ type: 'uuid' })
  id: string = v4()

  @Index()
  @Property({ type: 'uuid' })
  product_id!: string

  @Index()
  @Property({ type: 'uuid' })
  tag_id!: string

  @Index()
  @Property({ type: 'uuid' })
  organization_id!: string

  @Index()
  @Property({ type: 'uuid' })
  tenant_id!: string

  @Property({ type: 'timestamptz' })
  created_at: Date = new Date()
}
```

**Junction table rules**:
- Always include `organization_id` and `tenant_id`
- Index both FK columns
- Include `created_at` for audit trail
- Add extra columns if the relationship has attributes (e.g., `quantity`, `sort_order`)

### One-to-One (Same Module)

```typescript
@Entity({ tableName: 'user_profiles' })
export class UserProfile {
  @PrimaryKey({ type: 'uuid' })
  id: string = v4()

  @Index({ unique: true })
  @Property({ type: 'uuid' })
  user_id!: string  // FK to User entity

  // Profile-specific fields
  @Property({ type: 'text', nullable: true })
  bio: string | null = null
  // ...standard columns
}
```

### Self-Referencing (Tree/Hierarchy)

```typescript
@Entity({ tableName: 'categories' })
export class Category {
  @PrimaryKey({ type: 'uuid' })
  id: string = v4()

  @Property({ type: 'uuid', nullable: true })
  parent_id: string | null = null  // Self-reference

  @Property({ type: 'varchar', length: 255 })
  name!: string

  // Optional: materialized path for efficient tree queries
  @Property({ type: 'text', default: '' })
  path: string = ''  // e.g., '/root-id/parent-id/this-id'

  @Property({ type: 'int', default: 0 })
  depth: number = 0
  // ...standard columns
}
```

---

## 5. Cross-Module References

**Critical rule**: NO ORM relationships (`@ManyToOne`, `@OneToMany`) between entities in different modules.

### Pattern: FK ID Only

```typescript
@Entity({ tableName: 'tickets' })
export class Ticket {
  // Reference to customer in another module — just a UUID column
  @Index()
  @Property({ type: 'uuid' })
  customer_id!: string  // FK to customers.person — NO @ManyToOne

  // Reference to assigned user in auth module
  @Index()
  @Property({ type: 'uuid', nullable: true })
  assigned_to: string | null = null  // FK to auth.user
}
```

### Fetching Related Data

To display related data from another module, use a **Response Enricher** (see `system-extension` skill):

```typescript
// data/enrichers.ts
const enricher: ResponseEnricher = {
  id: 'tickets.customer-name',
  targetEntity: 'tickets.ticket',
  async enrichMany(records, context) {
    const customerIds = [...new Set(records.map(r => r.customer_id).filter(Boolean))]
    // Fetch customer names via API or direct query
    const customers = await em.find(Person, { id: { $in: customerIds } })
    const nameMap = new Map(customers.map(c => [c.id, c.name]))
    return records.map(r => ({
      ...r,
      _tickets: { customerName: nameMap.get(r.customer_id) ?? null },
    }))
  },
}
```

### Why No ORM Relations Across Modules?

1. **Module isolation** — modules must be independently deployable and ejectable
2. **Circular dependencies** — ORM relations create tight coupling between modules
3. **Schema ownership** — each module owns its entities; cross-module ORM relations blur ownership
4. **Extension system** — UMES enrichers provide the same capability without coupling

---

## 6. Migration Lifecycle

### Creating a Migration

```bash
# 1. Modify or create entity files
# 2. Generate migration
yarn db:generate

# 3. Review the generated migration
# Check src/modules/<module_id>/migrations/Migration_YYYYMMDD_HHMMSS.ts

# 4. Apply migration (confirm with user first)
yarn db:migrate
```

### Migration Best Practices

1. **Review every migration** — auto-generated doesn't mean correct
2. **Check for unintended changes** — sometimes generators pick up unrelated diffs
3. **New columns should have defaults** — prevents breaking existing rows
4. **Never rename columns** — add new column, migrate data, remove old column (across releases)
5. **Never drop tables** — soft delete or archive first

### Adding a Column to Existing Entity

```typescript
// Add to entity with a default value
@Property({ type: 'varchar', length: 100, default: '' })
new_field: string = ''

// Or nullable for optional fields
@Property({ type: 'varchar', length: 100, nullable: true })
new_field: string | null = null
```

Then:
```bash
yarn db:generate   # Creates ALTER TABLE ADD COLUMN migration
yarn db:migrate    # Applies it
```

### Removing a Column

Don't remove columns in a single step. Instead:

1. Stop writing to the column (remove from validators and forms)
2. Make the column nullable if it isn't already
3. In a later release, drop the column via migration

---

## 7. Advanced Patterns

### Polymorphic References

When an entity can reference different types:

```typescript
@Entity({ tableName: 'comments' })
export class Comment {
  @PrimaryKey({ type: 'uuid' })
  id: string = v4()

  // Polymorphic reference
  @Index()
  @Property({ type: 'varchar', length: 100 })
  target_type!: string  // 'tickets.ticket', 'orders.order', etc.

  @Index()
  @Property({ type: 'uuid' })
  target_id!: string  // UUID of the referenced entity

  @Property({ type: 'text' })
  body!: string
  // ...standard columns
}
```

### Ordered Collections

When items have a user-defined order:

```typescript
@Entity({ tableName: 'checklist_items' })
export class ChecklistItem {
  @PrimaryKey({ type: 'uuid' })
  id: string = v4()

  @Index()
  @Property({ type: 'uuid' })
  checklist_id!: string

  @Property({ type: 'int' })
  sort_order!: number  // 0, 1, 2, 3...

  @Property({ type: 'varchar', length: 255 })
  title!: string
  // ...standard columns
}
```

### Soft Delete Pattern

All entities already include `deleted_at`. To implement soft delete:

```typescript
// In API handlers or commands:
entity.deleted_at = new Date()
entity.is_active = false
await em.flush()

// In queries — filter out deleted records:
const items = await em.find(Entity, {
  organization_id: orgId,
  deleted_at: null,  // Exclude soft-deleted
})
```

### Audit/History Table

For tracking changes to an entity:

```typescript
@Entity({ tableName: 'ticket_history' })
export class TicketHistory {
  @PrimaryKey({ type: 'uuid' })
  id: string = v4()

  @Index()
  @Property({ type: 'uuid' })
  ticket_id!: string

  @Property({ type: 'uuid' })
  changed_by!: string  // User who made the change

  @Property({ type: 'varchar', length: 50 })
  action!: string  // 'created', 'updated', 'status_changed'

  @Property({ type: 'jsonb', nullable: true })
  previous_values: Record<string, unknown> | null = null

  @Property({ type: 'jsonb', nullable: true })
  new_values: Record<string, unknown> | null = null

  @Index()
  @Property({ type: 'uuid' })
  organization_id!: string

  @Index()
  @Property({ type: 'uuid' })
  tenant_id!: string

  @Property({ type: 'timestamptz' })
  created_at: Date = new Date()
}
```

---

## 8. Anti-Patterns

| Anti-Pattern | Problem | Correct Pattern |
|-------------|---------|-----------------|
| `@ManyToOne` across modules | Tight coupling, breaks module isolation | Store FK as `uuid` column, use enrichers |
| Storing computed values | Stale data, maintenance burden | Compute on read via enrichers or queries |
| Using `any` for JSONB fields | No type safety | Define a Zod schema, use `z.infer` |
| Manual migration SQL | Fragile, version-dependent | Use `yarn db:generate` |
| Renaming columns | Breaks existing data/queries | Add new column, migrate data, drop old |
| Missing `organization_id` | Cross-tenant data leaks | Always include and index |
| Using `varchar` without `length` | Defaults vary by DB | Always specify `length` |
| Storing arrays as comma-separated strings | Can't query, no integrity | Use `jsonb` arrays or junction tables |
| UUID FK without index | Slow joins | Always `@Index()` on FK columns |
| Nullable required fields | Data integrity issues | Use `!` assertion for required, `null` for optional |

---

## Rules

- **MUST** include `organization_id` and `tenant_id` on all tenant-scoped entities
- **MUST** include standard columns (`id`, `created_at`, `updated_at`, `deleted_at`, `is_active`)
- **MUST** use UUID v4 for primary keys
- **MUST** index all FK columns and `organization_id` / `tenant_id`
- **MUST** run `yarn db:generate` after entity changes, never hand-write migrations
- **MUST** review generated migration before applying
- **MUST** use `nullable: true` with `= null` default for optional fields
- **MUST** specify `length` on all `varchar` columns
- **MUST NOT** use ORM relationship decorators across module boundaries
- **MUST NOT** rename or drop columns in a single release
- **MUST NOT** store sensitive data without encryption (use `findWithDecryption`)
- Use `jsonb` for flexible/nested data, proper columns for queryable/sortable data
- Use junction tables for many-to-many relationships
- Derive TypeScript types from Zod schemas, never duplicate type definitions
