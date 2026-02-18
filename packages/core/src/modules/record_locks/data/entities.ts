import { Entity, Index, OptionalProps, PrimaryKey, Property, Unique } from '@mikro-orm/core'

export type RecordLockStatus = 'active' | 'released' | 'expired' | 'force_released'
export type RecordLockStrategy = 'optimistic' | 'pessimistic'
export type RecordLockReleaseReason = 'saved' | 'cancelled' | 'unmount' | 'expired' | 'force' | 'conflict_resolved'

export type RecordLockConflictStatus = 'pending' | 'resolved_accept_incoming' | 'resolved_accept_mine' | 'resolved_merged'
export type RecordLockConflictResolution = 'accept_incoming' | 'accept_mine' | 'merged'

@Entity({ tableName: 'record_locks' })
@Unique({ name: 'record_locks_token_unique', properties: ['token'] })
@Index({ name: 'record_locks_resource_status_idx', properties: ['tenantId', 'resourceKind', 'resourceId', 'status'] })
@Index({ name: 'record_locks_owner_status_idx', properties: ['tenantId', 'lockedByUserId', 'status'] })
@Index({ name: 'record_locks_expiry_status_idx', properties: ['tenantId', 'expiresAt', 'status'] })
export class RecordLock {
  [OptionalProps]?: 'createdAt' | 'updatedAt' | 'deletedAt' | 'releasedAt' | 'releasedByUserId' | 'releaseReason'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'resource_kind', type: 'text' })
  resourceKind!: string

  @Property({ name: 'resource_id', type: 'text' })
  resourceId!: string

  @Property({ name: 'token', type: 'text' })
  token!: string

  @Property({ name: 'strategy', type: 'text' })
  strategy: RecordLockStrategy = 'optimistic'

  @Property({ name: 'status', type: 'text' })
  status: RecordLockStatus = 'active'

  @Property({ name: 'locked_by_user_id', type: 'uuid' })
  lockedByUserId!: string

  @Property({ name: 'base_action_log_id', type: 'uuid', nullable: true })
  baseActionLogId: string | null = null

  @Property({ name: 'locked_at', type: Date })
  lockedAt: Date = new Date()

  @Property({ name: 'last_heartbeat_at', type: Date })
  lastHeartbeatAt: Date = new Date()

  @Property({ name: 'expires_at', type: Date })
  expiresAt: Date = new Date()

  @Property({ name: 'released_at', type: Date, nullable: true })
  releasedAt: Date | null = null

  @Property({ name: 'released_by_user_id', type: 'uuid', nullable: true })
  releasedByUserId: string | null = null

  @Property({ name: 'release_reason', type: 'text', nullable: true })
  releaseReason: string | null = null

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid', nullable: true })
  organizationId: string | null = null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt: Date | null = null
}

@Entity({ tableName: 'record_lock_conflicts' })
@Index({ name: 'record_lock_conflicts_resource_idx', properties: ['tenantId', 'resourceKind', 'resourceId', 'status', 'createdAt'] })
@Index({ name: 'record_lock_conflicts_users_idx', properties: ['tenantId', 'conflictActorUserId', 'incomingActorUserId', 'createdAt'] })
export class RecordLockConflict {
  [OptionalProps]?: 'createdAt' | 'updatedAt' | 'deletedAt' | 'resolution' | 'resolvedByUserId' | 'resolvedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'resource_kind', type: 'text' })
  resourceKind!: string

  @Property({ name: 'resource_id', type: 'text' })
  resourceId!: string

  @Property({ name: 'status', type: 'text' })
  status: RecordLockConflictStatus = 'pending'

  @Property({ name: 'resolution', type: 'text', nullable: true })
  resolution: RecordLockConflictResolution | null = null

  @Property({ name: 'base_action_log_id', type: 'uuid', nullable: true })
  baseActionLogId: string | null = null

  @Property({ name: 'incoming_action_log_id', type: 'uuid', nullable: true })
  incomingActionLogId: string | null = null

  @Property({ name: 'conflict_actor_user_id', type: 'uuid' })
  conflictActorUserId!: string

  @Property({ name: 'incoming_actor_user_id', type: 'uuid', nullable: true })
  incomingActorUserId: string | null = null

  @Property({ name: 'resolved_by_user_id', type: 'uuid', nullable: true })
  resolvedByUserId: string | null = null

  @Property({ name: 'resolved_at', type: Date, nullable: true })
  resolvedAt: Date | null = null

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid', nullable: true })
  organizationId: string | null = null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt: Date | null = null
}
