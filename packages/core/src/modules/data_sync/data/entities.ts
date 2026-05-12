import { OptionalProps } from '@mikro-orm/core'
import { Entity, Index, PrimaryKey, Property } from '@mikro-orm/decorators/legacy'

@Entity({ tableName: 'sync_runs' })
@Index({ properties: ['integrationId', 'entityType', 'status', 'organizationId', 'tenantId'] })
export class SyncRun {
  [OptionalProps]?: 'status' | 'cursor' | 'initialCursor' | 'createdCount' | 'updatedCount' | 'skippedCount' | 'failedCount' | 'batchesCompleted' | 'lastError' | 'progressJobId' | 'jobId' | 'triggeredBy' | 'createdAt' | 'updatedAt' | 'deletedAt'
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'integration_id', type: 'text' })
  integrationId!: string

  @Property({ name: 'entity_type', type: 'text' })
  entityType!: string

  @Property({ name: 'direction', type: 'text' })
  direction!: 'import' | 'export'

  @Property({ name: 'status', type: 'text' })
  status!: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'paused'

  @Property({ name: 'cursor', type: 'text', nullable: true })
  cursor?: string | null

  @Property({ name: 'initial_cursor', type: 'text', nullable: true })
  initialCursor?: string | null

  @Property({ name: 'created_count', type: 'int', default: 0 })
  createdCount: number = 0

  @Property({ name: 'updated_count', type: 'int', default: 0 })
  updatedCount: number = 0

  @Property({ name: 'skipped_count', type: 'int', default: 0 })
  skippedCount: number = 0

  @Property({ name: 'failed_count', type: 'int', default: 0 })
  failedCount: number = 0

  @Property({ name: 'batches_completed', type: 'int', default: 0 })
  batchesCompleted: number = 0

  @Property({ name: 'last_error', type: 'text', nullable: true })
  lastError?: string | null

  @Property({ name: 'progress_job_id', type: 'uuid', nullable: true })
  progressJobId?: string | null

  @Property({ name: 'job_id', type: 'text', nullable: true })
  jobId?: string | null

  @Property({ name: 'triggered_by', type: 'text', nullable: true })
  triggeredBy?: string | null

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'sync_cursors' })
@Index({ properties: ['integrationId', 'entityType', 'direction', 'organizationId', 'tenantId'], options: { unique: true } })
export class SyncCursor {
  [OptionalProps]?: 'cursor' | 'updatedAt'
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'integration_id', type: 'text' })
  integrationId!: string

  @Property({ name: 'entity_type', type: 'text' })
  entityType!: string

  @Property({ name: 'direction', type: 'text' })
  direction!: 'import' | 'export'

  @Property({ name: 'cursor', type: 'text', nullable: true })
  cursor?: string | null

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}

@Entity({ tableName: 'sync_mappings' })
@Index({ properties: ['integrationId', 'entityType', 'organizationId', 'tenantId'], options: { unique: true } })
export class SyncMapping {
  [OptionalProps]?: 'createdAt' | 'updatedAt'
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'integration_id', type: 'text' })
  integrationId!: string

  @Property({ name: 'entity_type', type: 'text' })
  entityType!: string

  @Property({ name: 'mapping', type: 'json' })
  mapping!: Record<string, unknown>

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}

@Entity({ tableName: 'sync_schedules' })
@Index({ properties: ['integrationId', 'entityType', 'direction', 'organizationId', 'tenantId'] })
export class SyncSchedule {
  [OptionalProps]?: 'timezone' | 'fullSync' | 'isEnabled' | 'scheduledJobId' | 'lastRunAt' | 'createdAt' | 'updatedAt' | 'deletedAt'
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'integration_id', type: 'text' })
  integrationId!: string

  @Property({ name: 'entity_type', type: 'text' })
  entityType!: string

  @Property({ name: 'direction', type: 'text' })
  direction!: 'import' | 'export'

  @Property({ name: 'schedule_type', type: 'text' })
  scheduleType!: 'cron' | 'interval'

  @Property({ name: 'schedule_value', type: 'text' })
  scheduleValue!: string

  @Property({ name: 'timezone', type: 'text', default: 'UTC' })
  timezone: string = 'UTC'

  @Property({ name: 'full_sync', type: 'boolean', default: false })
  fullSync: boolean = false

  @Property({ name: 'is_enabled', type: 'boolean', default: true })
  isEnabled: boolean = true

  @Property({ name: 'scheduled_job_id', type: 'uuid', nullable: true })
  scheduledJobId?: string | null

  @Property({ name: 'last_run_at', type: Date, nullable: true })
  lastRunAt?: Date | null

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}
