import { Entity, Index, PrimaryKey, Property, Unique } from '@mikro-orm/core'

@Entity({ tableName: 'example_customer_interaction_mappings' })
@Unique({
  name: 'example_customer_interaction_mappings_interaction_unique',
  properties: ['organizationId', 'tenantId', 'interactionId'],
})
@Unique({
  name: 'example_customer_interaction_mappings_todo_unique',
  properties: ['organizationId', 'tenantId', 'todoId'],
})
@Index({
  name: 'example_customer_interaction_mappings_status_idx',
  properties: ['organizationId', 'tenantId', 'syncStatus', 'updatedAt'],
})
export class ExampleCustomerInteractionMapping {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'interaction_id', type: 'uuid' })
  interactionId!: string

  @Property({ name: 'todo_id', type: 'uuid' })
  todoId!: string

  @Property({ name: 'sync_status', type: 'text', default: 'pending' })
  syncStatus: 'pending' | 'synced' | 'error' = 'pending'

  @Property({ name: 'last_synced_at', type: Date, nullable: true })
  lastSyncedAt?: Date | null

  @Property({ name: 'last_error', type: 'text', nullable: true })
  lastError?: string | null

  @Property({ name: 'source_updated_at', type: Date, nullable: true })
  sourceUpdatedAt?: Date | null

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}
