import { Entity, Index, PrimaryKey, Property } from '@mikro-orm/core'

export type ActionLogExecutionState = 'done' | 'undone' | 'failed'

@Entity({ tableName: 'action_logs' })
@Index({ name: 'action_logs_tenant_idx', properties: ['tenantId', 'createdAt'] })
@Index({ name: 'action_logs_actor_idx', properties: ['actorUserId', 'createdAt'] })
export class ActionLog {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid', nullable: true })
  tenantId: string | null = null

  @Property({ name: 'organization_id', type: 'uuid', nullable: true })
  organizationId: string | null = null

  @Property({ name: 'actor_user_id', type: 'uuid', nullable: true })
  actorUserId: string | null = null

  @Property({ name: 'command_id', type: 'text' })
  commandId!: string

  @Property({ name: 'action_label', type: 'text', nullable: true })
  actionLabel: string | null = null

  @Property({ name: 'resource_kind', type: 'text', nullable: true })
  resourceKind: string | null = null

  @Property({ name: 'resource_id', type: 'text', nullable: true })
  resourceId: string | null = null

  @Property({ name: 'execution_state', type: 'text', default: 'done' })
  executionState: ActionLogExecutionState = 'done'

  @Property({ name: 'undo_token', type: 'text', nullable: true })
  undoToken: string | null = null

  @Property({ name: 'command_payload', type: 'jsonb', nullable: true })
  commandPayload: unknown | null = null

  @Property({ name: 'snapshot_before', type: 'jsonb', nullable: true })
  snapshotBefore: unknown | null = null

  @Property({ name: 'snapshot_after', type: 'jsonb', nullable: true })
  snapshotAfter: unknown | null = null

  @Property({ name: 'changes_json', type: 'jsonb', nullable: true })
  changesJson: Record<string, unknown> | null = null

  @Property({ name: 'context_json', type: 'jsonb', nullable: true })
  contextJson: Record<string, unknown> | null = null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt: Date | null = null
}

@Entity({ tableName: 'access_logs' })
@Index({ name: 'access_logs_tenant_idx', properties: ['tenantId', 'createdAt'] })
@Index({ name: 'access_logs_actor_idx', properties: ['actorUserId', 'createdAt'] })
export class AccessLog {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid', nullable: true })
  tenantId: string | null = null

  @Property({ name: 'organization_id', type: 'uuid', nullable: true })
  organizationId: string | null = null

  @Property({ name: 'actor_user_id', type: 'uuid', nullable: true })
  actorUserId: string | null = null

  @Property({ name: 'resource_kind', type: 'text' })
  resourceKind!: string

  @Property({ name: 'resource_id', type: 'text' })
  resourceId!: string

  @Property({ name: 'access_type', type: 'text' })
  accessType!: string

  @Property({ name: 'fields_json', type: 'jsonb', nullable: true })
  fieldsJson: string[] | null = null

  @Property({ name: 'context_json', type: 'jsonb', nullable: true })
  contextJson: Record<string, unknown> | null = null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt: Date | null = null
}
