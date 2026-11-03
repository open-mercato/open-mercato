import { Entity, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy';

@Entity({ tableName: 'example_items' })
export class ExampleItem {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ type: 'text' })
  title!: string

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

// Demo Todo entity used by the example module's backend page
@Entity({ tableName: 'todos' })
export class Todo {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ type: 'text' })
  title!: string

  /**
   * Free-text notes. Declared in `encryption.ts`, so the stored column holds
   * ciphertext whenever tenant data encryption is on (the default).
   *
   * Consequences that shape the rest of the module — see `search.ts` and
   * `api/todos/route.ts`:
   * - never sorted on, never exported to CSV, never filtered with `$ilike`
   * - selected only for single-record reads, so grid pages skip the per-row decrypt
   * - reachable by text search only through the hashed `search_tokens` index
   */
  @Property({ type: 'text', nullable: true })
  notes?: string | null

  @Property({ name: 'tenant_id', type: 'uuid', nullable: true })
  tenantId?: string | null

  @Property({ name: 'organization_id', type: 'uuid', nullable: true })
  organizationId?: string | null

  @Property({ name: 'is_done', type: 'boolean', default: false })
  isDone: boolean = false

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

/**
 * Durable transactional outbox for the Todo bulk-complete operation.
 *
 * The row is the unit of idempotency, the unit of publication, and the unit of
 * execution, which is why all three concerns live on one table:
 *
 * - `(tenant_id, organization_id, user_id, idempotency_key)` is unique, so a
 *   double-clicked bulk action creates one logical operation and one progress job.
 * - `published_at` / `publish_attempts` make queue publication an at-least-once
 *   outbox: a crash between commit and enqueue leaves the row unpublished for the
 *   scheduler dispatcher to pick up, and a crash after enqueue but before marking
 *   published can produce a second physical message.
 * - `lease_owner` / `lease_expires_at` / `next_item_index` make a duplicate
 *   physical message harmless: exactly one holder of an unexpired lease advances
 *   the checkpoint, and a crashed holder is recovered after the lease expires.
 *
 * `progress_job_id` is a plain uuid on purpose — the progress module owns that
 * row and cross-module ORM relations are banned.
 *
 * Exempt from the editable-entity `updated_at` optimistic-lock rule as a
 * background-job row: no user form edits it.
 */
@Entity({ tableName: 'example_todo_bulk_operations' })
@Unique({ properties: ['tenantId', 'organizationId', 'userId', 'idempotencyKey'] })
export class ExampleTodoBulkOperation {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'user_id', type: 'uuid' })
  userId!: string

  @Property({ name: 'idempotency_key', type: 'text' })
  idempotencyKey!: string

  @Property({ name: 'todo_ids', type: 'json' })
  todoIds: string[] = []

  @Property({ name: 'progress_job_id', type: 'uuid' })
  progressJobId!: string

  /** `pending` | `running` | `completed` | `failed` | `cancelled`. */
  @Property({ type: 'text', default: 'pending' })
  status: string = 'pending'

  @Property({ name: 'published_at', type: Date, nullable: true })
  publishedAt?: Date | null

  @Property({ name: 'publish_attempts', type: 'integer', default: 0 })
  publishAttempts: number = 0

  @Property({ name: 'last_publish_attempt_at', type: Date, nullable: true })
  lastPublishAttemptAt?: Date | null

  @Property({ name: 'lease_owner', type: 'text', nullable: true })
  leaseOwner?: string | null

  @Property({ name: 'lease_expires_at', type: Date, nullable: true })
  leaseExpiresAt?: Date | null

  @Property({ name: 'next_item_index', type: 'integer', default: 0 })
  nextItemIndex: number = 0

  @Property({ name: 'succeeded_count', type: 'integer', default: 0 })
  succeededCount: number = 0

  @Property({ name: 'failed_count', type: 'integer', default: 0 })
  failedCount: number = 0

  /** Bounded `[{ id, code }]` result codes; never raw error text. */
  @Property({ name: 'failed_items', type: 'json', nullable: true })
  failedItems?: { id: string; code: string }[] | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}

@Entity({ tableName: 'example_customer_priorities' })
export class ExampleCustomerPriority {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'customer_id', type: 'uuid' })
  customerId!: string

  /** Customer priority level. Valid values: 'low' | 'normal' | 'high' | 'critical'. */
  @Property({ type: 'text', default: 'normal' })
  priority: 'low' | 'normal' | 'high' | 'critical' = 'normal'

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}
