import { Entity, Index, PrimaryKey, Property } from '@mikro-orm/decorators/legacy'
import type { ActionLogProjectionType, ActionLogSourceKey } from '@open-mercato/core/modules/audit_logs/lib/projections'

export type ActionLogExecutionState = 'done' | 'undoing' | 'undone' | 'failed' | 'redone'

@Entity({ tableName: 'action_logs' })
@Index({ name: 'action_logs_tenant_idx', properties: ['tenantId', 'createdAt'] })
@Index({ name: 'action_logs_actor_idx', properties: ['actorUserId', 'createdAt'] })
@Index({ name: 'action_logs_obo_idx', properties: ['onBehalfOfUserId'] })
@Index({ name: 'action_logs_resource_idx', properties: ['tenantId', 'resourceKind', 'resourceId', 'createdAt'] })
@Index({ name: 'action_logs_parent_resource_idx', properties: ['tenantId', 'parentResourceKind', 'parentResourceId', 'createdAt'] })
@Index({ name: 'action_logs_action_type_idx', properties: ['tenantId', 'organizationId', 'actionType', 'createdAt'] })
@Index({ name: 'action_logs_source_key_idx', properties: ['tenantId', 'organizationId', 'sourceKey', 'createdAt'] })
@Index({ name: 'action_logs_primary_changed_field_idx', properties: ['tenantId', 'organizationId', 'primaryChangedField', 'createdAt'] })
@Index({ name: 'action_logs_changed_fields_idx', properties: ['changedFields'], type: 'gin' })
@Index({ name: 'action_logs_related_resource_idx', properties: ['tenantId', 'relatedResourceKind', 'relatedResourceId', 'createdAt'] })
export class ActionLog {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid', nullable: true })
  tenantId: string | null = null

  @Property({ name: 'organization_id', type: 'uuid', nullable: true })
  organizationId: string | null = null

  @Property({ name: 'actor_user_id', type: 'uuid', nullable: true })
  actorUserId: string | null = null

  /**
   * The human (or system) principal an agent acted on behalf of. Null for direct
   * human/system/api actions; set to the invoking human's `auth.User` id when the
   * actor (`actorUserId`) is an agent principal running under `runAs` with
   * `sourceKey = 'agent'`. FK id → `auth.User` (no cross-module ORM relation).
   * Additive, nullable, indexed (`action_logs_obo_idx`); existing rows default null
   * so no existing audit reader breaks (Agent Identity & On-Behalf-Of, Wave 4 P2).
   */
  @Property({ name: 'on_behalf_of_user_id', type: 'uuid', nullable: true })
  onBehalfOfUserId: string | null = null

  @Property({ name: 'command_id', type: 'text' })
  commandId!: string

  @Property({ name: 'action_label', type: 'text', nullable: true })
  actionLabel: string | null = null

  @Property({ name: 'action_type', type: 'text', nullable: true })
  actionType: ActionLogProjectionType | null = null

  @Property({ name: 'resource_kind', type: 'text', nullable: true })
  resourceKind: string | null = null

  @Property({ name: 'resource_id', type: 'text', nullable: true })
  resourceId: string | null = null

  @Property({ name: 'parent_resource_kind', type: 'text', nullable: true })
  parentResourceKind: string | null = null

  @Property({ name: 'parent_resource_id', type: 'text', nullable: true })
  parentResourceId: string | null = null

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

  @Property({ name: 'changed_fields', type: 'text[]', nullable: true })
  changedFields: string[] | null = null

  @Property({ name: 'primary_changed_field', type: 'text', nullable: true })
  primaryChangedField: string | null = null

  @Property({ name: 'context_json', type: 'jsonb', nullable: true })
  contextJson: Record<string, unknown> | null = null

  @Property({ name: 'source_key', type: 'text', nullable: true })
  sourceKey: ActionLogSourceKey | null = null

  @Property({ name: 'related_resource_kind', type: 'text', nullable: true })
  relatedResourceKind: string | null = null

  @Property({ name: 'related_resource_id', type: 'text', nullable: true })
  relatedResourceId: string | null = null

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
@Index({ name: 'access_logs_created_at_idx', properties: ['createdAt'] })
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
