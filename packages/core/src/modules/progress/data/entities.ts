import { Entity, PrimaryKey, Property, Index, OptionalProps } from '@mikro-orm/core'

export type ProgressJobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'

// No deleted_at column: terminal statuses (completed, failed, cancelled) serve as logical soft-delete.
// Old jobs should be purged via scheduled cleanup rather than soft-deleted individually.
@Entity({ tableName: 'progress_jobs' })
@Index({ name: 'progress_jobs_status_tenant_idx', properties: ['status', 'tenantId'] })
@Index({ name: 'progress_jobs_type_tenant_idx', properties: ['jobType', 'tenantId'] })
@Index({ name: 'progress_jobs_parent_idx', properties: ['parentJobId'] })
export class ProgressJob {
  [OptionalProps]?: 'status' | 'progressPercent' | 'processedCount' | 'cancellable' | 'createdAt' | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'job_type', type: 'text' })
  jobType!: string

  @Property({ name: 'name', type: 'text' })
  name!: string

  @Property({ name: 'description', type: 'text', nullable: true })
  description?: string | null

  @Property({ name: 'status', type: 'text' })
  status: ProgressJobStatus = 'pending'

  @Property({ name: 'progress_percent', type: 'smallint' })
  progressPercent: number = 0

  @Property({ name: 'processed_count', type: 'int' })
  processedCount: number = 0

  @Property({ name: 'total_count', type: 'int', nullable: true })
  totalCount?: number | null

  @Property({ name: 'eta_seconds', type: 'int', nullable: true })
  etaSeconds?: number | null

  @Property({ name: 'started_by_user_id', type: 'uuid', nullable: true })
  startedByUserId?: string | null

  @Property({ name: 'started_at', type: Date, nullable: true })
  startedAt?: Date | null

  @Property({ name: 'heartbeat_at', type: Date, nullable: true })
  heartbeatAt?: Date | null

  @Property({ name: 'finished_at', type: Date, nullable: true })
  finishedAt?: Date | null

  @Property({ name: 'result_summary', type: 'json', nullable: true })
  resultSummary?: Record<string, unknown> | null

  @Property({ name: 'error_message', type: 'text', nullable: true })
  errorMessage?: string | null

  @Property({ name: 'error_stack', type: 'text', nullable: true })
  errorStack?: string | null

  @Property({ name: 'meta', type: 'json', nullable: true })
  meta?: Record<string, unknown> | null

  @Property({ name: 'cancellable', type: 'boolean' })
  cancellable: boolean = false

  @Property({ name: 'cancelled_by_user_id', type: 'uuid', nullable: true })
  cancelledByUserId?: string | null

  @Property({ name: 'cancel_requested_at', type: Date, nullable: true })
  cancelRequestedAt?: Date | null

  @Property({ name: 'parent_job_id', type: 'uuid', nullable: true })
  parentJobId?: string | null

  @Property({ name: 'partition_index', type: 'int', nullable: true })
  partitionIndex?: number | null

  @Property({ name: 'partition_count', type: 'int', nullable: true })
  partitionCount?: number | null

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid', nullable: true })
  organizationId?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}
