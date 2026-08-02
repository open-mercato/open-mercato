import { OptionalProps } from '@mikro-orm/core'
import { Check, Entity, Index, ManyToOne, PrimaryKey, Property } from '@mikro-orm/decorators/legacy'
import type { ReferenceTaskLinkTargetKind, ReferenceTaskStatus } from './types'

@Entity({ tableName: 'reference_module_tasks' })
@Index({ name: 'reference_module_tasks_scope_deleted_idx', properties: ['tenantId', 'organizationId', 'deletedAt'] })
@Index({ name: 'reference_module_tasks_scope_status_idx', properties: ['tenantId', 'organizationId', 'status'] })
@Index({ name: 'reference_module_tasks_scope_due_idx', properties: ['tenantId', 'organizationId', 'dueAt'] })
@Check({ name: 'reference_module_tasks_status_check', expression: `"status" in ('todo', 'in_progress', 'done')` })
@Check({ name: 'reference_module_tasks_priority_check', expression: '"priority" between 0 and 5' })
export class ReferenceTask {
  [OptionalProps]?: 'status' | 'priority' | 'isActive' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ type: 'text' })
  title!: string

  @Property({ type: 'text', nullable: true })
  description?: string | null

  @Property({ type: 'text', default: 'todo' })
  status: ReferenceTaskStatus = 'todo'

  @Property({ type: 'smallint', default: 0 })
  priority: number = 0

  @Property({ name: 'due_at', type: Date, nullable: true })
  dueAt?: Date | null

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'reference_module_task_links' })
@Index({ name: 'reference_module_task_links_scope_task_idx', properties: ['tenantId', 'organizationId', 'task'] })
@Index({ name: 'reference_module_task_links_scope_target_idx', properties: ['tenantId', 'organizationId', 'targetKind', 'targetId'] })
@Index({
  name: 'reference_module_task_links_active_unique',
  expression: 'create unique index "reference_module_task_links_active_unique" on "reference_module_task_links" ("tenant_id", "organization_id", "task_id", "target_kind", "target_id") where "deleted_at" is null',
})
@Check({
  name: 'reference_module_task_links_target_kind_check',
  expression: `"target_kind" in ('customer', 'catalog_product', 'sales_document')`,
})
export class ReferenceTaskLink {
  [OptionalProps]?: 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @ManyToOne(() => ReferenceTask, { fieldName: 'task_id', deleteRule: 'cascade', updateRule: 'cascade' })
  task!: ReferenceTask

  @Property({ name: 'target_kind', type: 'text' })
  targetKind!: ReferenceTaskLinkTargetKind

  @Property({ name: 'target_id', type: 'uuid' })
  targetId!: string

  @Property({ name: 'target_label_snapshot', type: 'text', nullable: true })
  targetLabelSnapshot?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'reference_module_task_undo_snapshots' })
@Index({ name: 'reference_module_task_undo_scope_task_idx', properties: ['tenantId', 'organizationId', 'task'] })
@Index({ name: 'reference_module_task_undo_expiry_idx', properties: ['expiresAt', 'consumedAt'] })
export class ReferenceTaskUndoSnapshot {
  [OptionalProps]?: 'createdAt' | 'consumedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @ManyToOne(() => ReferenceTask, { fieldName: 'task_id', deleteRule: 'cascade', updateRule: 'cascade' })
  task!: ReferenceTask

  @Property({ name: 'command_id', type: 'uuid' })
  commandId!: string

  @Property({ name: 'command_type', type: 'text' })
  commandType!: string

  @Property({ type: 'text' })
  payload!: string

  @Property({ name: 'expected_version', type: Date })
  expectedVersion!: Date

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'expires_at', type: Date })
  expiresAt!: Date

  @Property({ name: 'consumed_at', type: Date, nullable: true })
  consumedAt?: Date | null
}
