# Advanced Patterns

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

> **Multi-phase or relation-syncing writes:** the bare `em.flush()` above is fine for a single scalar update. As soon as a write mutates across multiple phases or runs a query (`em.find`/`em.findOne`/sync helper) between a scalar mutation and the flush, switch to `withAtomicFlush(em, phases, { transaction: true })` from `@open-mercato/shared/lib/commands/flush` — MikroORM v7 silently drops the scalar UPDATE otherwise. Never query between scalar mutations and flush; keep side effects + cache invalidation outside the flush (after commit).

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
