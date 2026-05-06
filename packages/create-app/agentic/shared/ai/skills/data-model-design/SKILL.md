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
8. [Sensitive Data and Encryption Maps](#8-sensitive-data-and-encryption-maps)
9. [Anti-Patterns](#9-anti-patterns)

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
# 1. Modify src/modules/<module_id>/data/entities.ts
# 2. Probe/generate migration
yarn db:generate

# 3. Review the generated migration or use it as the baseline for scoped manual SQL
# Check src/modules/<module_id>/migrations/Migration_YYYYMMDD_HHMMSS.ts

# 4. Update src/modules/<module_id>/migrations/.snapshot-open-mercato.json
# 5. Apply migration only after explicit user confirmation
yarn db:migrate
```

### Migration Best Practices

1. **Review every migration** — auto-generated doesn't mean correct
2. **Check for unintended changes** — sometimes generators pick up unrelated diffs
3. **Do not commit unrelated generated migrations** — delete them from the diff
4. **Scoped manual SQL is allowed** when generator churn is unrelated, but the migration and `.snapshot-open-mercato.json` must still describe the same post-change schema
5. **Update `.snapshot-open-mercato.json`** — it is the baseline that prevents duplicate future migrations
6. **New columns should have defaults** — prevents breaking existing rows
7. **Never rename columns** — add new column, migrate data, remove old column (across releases)
8. **Never drop tables** — soft delete or archive first

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
yarn db:generate   # Probes/creates ALTER TABLE ADD COLUMN migration
yarn db:migrate    # Applies it only after explicit user confirmation
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

## 8. Sensitive Data and Encryption Maps

When the developer asks for "we need this column encrypted", "store this securely", "this is PII", "GDPR", or "encryption at rest" — and whenever you are designing a column that will hold names, addresses, contact information, free-text notes about people, integration credentials, secrets, or any data subject to a data-processing agreement — use the framework's **encryption-maps mechanism**. Do NOT hand-roll AES, raw `crypto.subtle`, custom KMS calls, or "TODO encrypt later" stubs.

The mechanism gives you:

- Per-tenant Data Encryption Keys (DEKs) resolved through the configured KMS (Vault by default, env-fallback in dev).
- Declarative, per-entity, per-field encryption with optional deterministic-hash sibling columns for equality lookups (for example login by email).
- Boot-time auto-application: every enabled module's `defaultEncryptionMaps` is collected during `auth:setup` and applied when `TENANT_DATA_ENCRYPTION=yes`.
- A `findWithDecryption` / `findOneWithDecryption` read API that transparently decrypts on read.

### When encryption is mandatory

| Field example | Encrypt? |
|---|---|
| First name, last name, preferred name | Yes |
| Email, phone | Yes — usually with a `hashField` for lookups |
| Postal address (line 1/2, city, region, postal code, country) | Yes |
| Free-text comments / notes / activity bodies that mention people | Yes |
| Integration secrets, API keys, OAuth tokens, webhook signing keys | Yes |
| Document numbers (tax IDs, national IDs) | Yes |
| Status enums, counters, timestamps, FKs, currency codes | No |
| Public catalog metadata (product titles for a public storefront) | Usually no |

If you are unsure, default to encrypting and confirm with the user — re-introducing encryption later requires a backfill, but turning it off later is a single map edit.

### Declare the map in `<module>/encryption.ts`

```typescript
import type { ModuleEncryptionMap } from '@open-mercato/shared/modules/encryption'

export const defaultEncryptionMaps: ModuleEncryptionMap[] = [
  {
    entityId: '<module_id>:<entity>',  // matches the entity's table id (colon-separated)
    fields: [
      { field: 'first_name' },
      { field: 'last_name' },
      { field: 'phone' },
      // Sibling deterministic hash for equality lookups (e.g. login by email).
      // Add a matching `<field>_hash varchar` column to the entity.
      { field: 'email', hashField: 'email_hash' },
    ],
  },
]

export default defaultEncryptionMaps
```

### Read with decryption — never raw `em.find`

```typescript
import { findWithDecryption, findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'

// Signature: (em, entityName, where, options?, scope?). MikroORM FindOptions go in slot 4
// (pass `undefined` if you have none), the decryption scope `{ tenantId, organizationId }` in slot 5.
const records = await findWithDecryption(em, '<Entity>', filter, undefined, { tenantId, organizationId })
const single  = await findOneWithDecryption(em, '<Entity>', { id }, undefined, { tenantId, organizationId })
```

Calling `em.find` on an encrypted column returns ciphertext, breaks search, and silently leaks bug surface. The `findWithDecryption` family is the one entry point.

### Apply maps to existing tenants

```bash
yarn mercato entities seed-encryption --tenant <tenantId> [--organization <orgId>]
```

New tenants pick up the maps automatically during `auth:setup`. Toggling the **Encrypted** flag on a custom field via the admin UI also only applies to data written **after** the change — backfill historical plaintext rows by running `yarn mercato entities rotate-encryption-key --tenant <tenantId> --org <organizationId>` (without `--old-key` it skips already-encrypted fields and just encrypts plaintext). Use `yarn mercato entities decrypt-database` to roll back. For full UI flows and CLI options see <https://docs.open-mercato.dev/user-guide/encryption>.

### Vector search caveat

The `vector` module stores raw embeddings unencrypted in the vector store (e.g. pgvector). Even though the source text is decrypted only transiently to compute embeddings, treat the embeddings as sensitive: avoid embedding raw high-sensitivity text and rely on disk-level / managed-database encryption-at-rest for the vector column.

### Environment switches

- `TENANT_DATA_ENCRYPTION=yes|no` (default `yes`) — set to `no` to run the hooks as no-op (validation still applies).
- `TENANT_DATA_ENCRYPTION_DEBUG=yes` — log map evaluation, KMS calls, cache hits.
- `VAULT_ADDR` / `VAULT_TOKEN` / `VAULT_KV_PATH` — HashiCorp Vault KMS configuration.
- `TENANT_DATA_ENCRYPTION_FALLBACK_KEY` — local/dev fallback key when Vault is unavailable. In dev, `AUTH_SECRET` / `NEXTAUTH_SECRET` is used as a last resort; production falls back to noop KMS.

---

## 9. Anti-Patterns

| Anti-Pattern | Problem | Correct Pattern |
|-------------|---------|-----------------|
| `@ManyToOne` across modules | Tight coupling, breaks module isolation | Store FK as `uuid` column, use enrichers |
| Storing computed values | Stale data, maintenance burden | Compute on read via enrichers or queries |
| Using `any` for JSONB fields | No type safety | Define a Zod schema, use `z.infer` |
| Blindly committing all generated migrations | Captures unrelated snapshot drift | Keep only scoped SQL and update the matching snapshot |
| Manual migration SQL without snapshot update | Future `yarn db:generate` recreates the same migration | Update `.snapshot-open-mercato.json` in the same change |
| Renaming columns | Breaks existing data/queries | Add new column, migrate data, drop old |
| Missing `organization_id` | Cross-tenant data leaks | Always include and index |
| Using `varchar` without `length` | Defaults vary by DB | Always specify `length` |
| Storing arrays as comma-separated strings | Can't query, no integrity | Use `jsonb` arrays or junction tables |
| UUID FK without index | Slow joins | Always `@Index()` on FK columns |
| Nullable required fields | Data integrity issues | Use `!` assertion for required, `null` for optional |
| Hand-rolled AES / `crypto.subtle` / custom KMS for sensitive columns | Per-tenant key isolation, hash lookups, key rotation, and admin UI all break | Declare `<module>/encryption.ts` with `defaultEncryptionMaps`; let the framework manage DEKs and Vault |
| Reading encrypted columns with raw `em.find` / `em.findOne` | Returns ciphertext, breaks search, silent data corruption | Use `findWithDecryption` / `findOneWithDecryption` with `{ tenantId, organizationId }` |
| Storing PII as plaintext "for now" / TODO comments | GDPR violation, leaks at rest, expensive backfill later | Encrypt from day one; toggling later only protects new writes |
| Encrypting an `email` column without a `hashField` | Login / equality lookups stop working | Declare a sibling `hashField` (e.g. `email_hash`) in the encryption map and add the matching `varchar` column |

---

## Rules

- **MUST** include `organization_id` and `tenant_id` on all tenant-scoped entities
- **MUST** include standard columns (`id`, `created_at`, `updated_at`, `deleted_at`, `is_active`)
- **MUST** use UUID v4 for primary keys
- **MUST** index all FK columns and `organization_id` / `tenant_id`
- **MUST** create or keep a scoped migration after entity changes and update `.snapshot-open-mercato.json`
- **MUST** review generated migration before applying
- **MUST NOT** commit unrelated migrations emitted by `yarn db:generate`
- **MUST NOT** run `yarn db:migrate` without explicit user confirmation
- **MUST** use `nullable: true` with `= null` default for optional fields
- **MUST** specify `length` on all `varchar` columns
- **MUST NOT** use ORM relationship decorators across module boundaries
- **MUST NOT** rename or drop columns in a single release
- **MUST** declare encrypted columns in `<module>/encryption.ts` exporting `defaultEncryptionMaps: ModuleEncryptionMap[]`, and read them via `findWithDecryption` / `findOneWithDecryption` from `@open-mercato/shared/lib/encryption/find` — see section 8
- **MUST NOT** hand-roll AES / KMS calls or store sensitive columns as plaintext "for now" — use the encryption-maps mechanism in section 8
- Use `jsonb` for flexible/nested data, proper columns for queryable/sortable data
- Use junction tables for many-to-many relationships
- Derive TypeScript types from Zod schemas, never duplicate type definitions
