# Relationships and Cross-Module References

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

To display related data from another module, use a **Response Enricher** (see `om-system-extension` skill):

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
