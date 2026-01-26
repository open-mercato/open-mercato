import { Entity, PrimaryKey, Property, Index } from '@mikro-orm/core'

@Entity({ tableName: 'scheduled_jobs' })
@Index({ name: 'scheduled_jobs_org_tenant_idx', properties: ['organizationId', 'tenantId'] })
@Index({ name: 'scheduled_jobs_next_run_idx', properties: ['nextRunAt'] })
@Index({ name: 'scheduled_jobs_scope_idx', properties: ['scopeType', 'isEnabled'] })
export class ScheduledJob {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid', nullable: true })
  organizationId?: string | null

  @Property({ name: 'tenant_id', type: 'uuid', nullable: true })
  tenantId?: string | null

  @Property({ name: 'scope_type', type: 'text', default: 'tenant' })
  scopeType!: 'system' | 'organization' | 'tenant'

  @Property({ type: 'text' })
  name!: string

  @Property({ type: 'text', nullable: true })
  description?: string | null

  @Property({ name: 'schedule_type', type: 'text' })
  scheduleType!: 'cron' | 'interval'

  @Property({ name: 'schedule_value', type: 'text' })
  scheduleValue!: string

  @Property({ type: 'text', default: 'UTC' })
  timezone!: string

  @Property({ name: 'target_type', type: 'text' })
  targetType!: 'queue' | 'command'

  @Property({ name: 'target_queue', type: 'text', nullable: true })
  targetQueue?: string | null

  @Property({ name: 'target_command', type: 'text', nullable: true })
  targetCommand?: string | null

  @Property({ name: 'target_payload', type: 'jsonb', nullable: true })
  targetPayload?: Record<string, unknown> | null

  @Property({ name: 'require_feature', type: 'text', nullable: true })
  requireFeature?: string | null

  @Property({ name: 'is_enabled', type: 'boolean', default: true })
  isEnabled!: boolean

  @Property({ name: 'last_run_at', type: Date, nullable: true })
  lastRunAt?: Date | null

  @Property({ name: 'next_run_at', type: Date, nullable: true })
  nextRunAt?: Date | null

  @Property({ name: 'source_type', type: 'text', default: 'user' })
  sourceType!: 'user' | 'module'

  @Property({ name: 'source_module', type: 'text', nullable: true })
  sourceModule?: string | null

  @Property({ name: 'created_at', type: Date, defaultRaw: 'now()' })
  createdAt!: Date

  @Property({ name: 'updated_at', type: Date, defaultRaw: 'now()', onUpdate: () => new Date() })
  updatedAt!: Date

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null

  @Property({ name: 'created_by_user_id', type: 'uuid', nullable: true })
  createdByUserId?: string | null

  @Property({ name: 'updated_by_user_id', type: 'uuid', nullable: true })
  updatedByUserId?: string | null
}
