import { OptionalProps } from '@mikro-orm/core'
import { Entity, Index, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy'

export type DataQualitySeverity = 'info' | 'warning' | 'error' | 'critical'
export type DataQualityScanStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
export type DataQualityFindingStatus = 'open' | 'resolved' | 'ignored'

@Entity({ tableName: 'data_quality_checks' })
@Unique({ name: 'data_quality_checks_code_unique', properties: ['tenantId', 'organizationId', 'code'] })
@Index({
  name: 'data_quality_checks_target_enabled_idx',
  properties: ['tenantId', 'organizationId', 'targetEntityType', 'enabled'],
})
@Index({ name: 'data_quality_checks_severity_idx', properties: ['tenantId', 'organizationId', 'severity'] })
export class DataQualityCheck {
  [OptionalProps]?: 'weight' | 'enabled' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'code', type: 'varchar', length: 100 })
  code!: string

  @Property({ name: 'name', type: 'varchar', length: 200 })
  name!: string

  @Property({ name: 'description', type: 'text', nullable: true })
  description?: string | null

  @Property({ name: 'target_entity_type', type: 'varchar', length: 100 })
  targetEntityType!: string

  @Property({ name: 'failure_expression', type: 'jsonb' })
  failureExpression!: Record<string, unknown>

  @Property({ name: 'severity', type: 'text' })
  severity!: DataQualitySeverity

  @Property({ name: 'weight', type: 'integer', default: 1 })
  weight: number = 1

  @Property({ name: 'enabled', type: 'boolean', default: true })
  enabled: boolean = true

  @Property({ name: 'created_by', type: 'varchar', length: 50, nullable: true })
  createdBy?: string | null

  @Property({ name: 'updated_by', type: 'varchar', length: 50, nullable: true })
  updatedBy?: string | null

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

@Entity({ tableName: 'data_quality_suites' })
@Unique({ name: 'data_quality_suites_code_unique', properties: ['tenantId', 'organizationId', 'code'] })
@Index({ name: 'data_quality_suites_enabled_idx', properties: ['tenantId', 'organizationId', 'enabled'] })
export class DataQualitySuite {
  [OptionalProps]?: 'enabled' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'code', type: 'varchar', length: 100 })
  code!: string

  @Property({ name: 'name', type: 'varchar', length: 200 })
  name!: string

  @Property({ name: 'description', type: 'text', nullable: true })
  description?: string | null

  @Property({ name: 'enabled', type: 'boolean', default: true })
  enabled: boolean = true

  @Property({ name: 'created_by', type: 'varchar', length: 50, nullable: true })
  createdBy?: string | null

  @Property({ name: 'updated_by', type: 'varchar', length: 50, nullable: true })
  updatedBy?: string | null

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

@Entity({ tableName: 'data_quality_suite_checks' })
@Unique({
  name: 'data_quality_suite_checks_unique',
  properties: ['tenantId', 'organizationId', 'suiteId', 'checkId'],
})
@Index({
  name: 'data_quality_suite_checks_seq_idx',
  properties: ['tenantId', 'organizationId', 'suiteId', 'sequence'],
})
export class DataQualitySuiteCheck {
  [OptionalProps]?: 'sequence' | 'enabled' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'suite_id', type: 'uuid' })
  suiteId!: string

  @Property({ name: 'check_id', type: 'uuid' })
  checkId!: string

  @Property({ name: 'sequence', type: 'integer', default: 0 })
  sequence: number = 0

  @Property({ name: 'enabled', type: 'boolean', default: true })
  enabled: boolean = true

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

@Entity({ tableName: 'data_quality_scan_runs' })
@Index({ name: 'data_quality_scan_runs_status_idx', properties: ['tenantId', 'organizationId', 'status', 'createdAt'] })
@Index({ name: 'data_quality_scan_runs_suite_idx', properties: ['tenantId', 'organizationId', 'suiteId', 'createdAt'] })
@Index({
  name: 'data_quality_scan_runs_target_idx',
  properties: ['tenantId', 'organizationId', 'targetEntityType', 'createdAt'],
})
export class DataQualityScanRun {
  [OptionalProps]?:
    | 'totalCount'
    | 'scannedCount'
    | 'failedCount'
    | 'findingCount'
    | 'openFindingCount'
    | 'createdAt'
    | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'suite_id', type: 'uuid', nullable: true })
  suiteId?: string | null

  @Property({ name: 'target_entity_type', type: 'varchar', length: 100, nullable: true })
  targetEntityType?: string | null

  @Property({ name: 'status', type: 'text' })
  status!: DataQualityScanStatus

  @Property({ name: 'progress_job_id', type: 'uuid', nullable: true })
  progressJobId?: string | null

  @Property({ name: 'criteria_json', type: 'jsonb', nullable: true })
  criteriaJson?: Record<string, unknown> | null

  @Property({ name: 'total_count', type: 'integer', default: 0 })
  totalCount: number = 0

  @Property({ name: 'scanned_count', type: 'integer', default: 0 })
  scannedCount: number = 0

  @Property({ name: 'failed_count', type: 'integer', default: 0 })
  failedCount: number = 0

  @Property({ name: 'finding_count', type: 'integer', default: 0 })
  findingCount: number = 0

  @Property({ name: 'open_finding_count', type: 'integer', default: 0 })
  openFindingCount: number = 0

  @Property({ name: 'score', type: 'real', nullable: true })
  score?: number | null

  @Property({ name: 'error_message', type: 'text', nullable: true })
  errorMessage?: string | null

  @Property({ name: 'requested_by', type: 'varchar', length: 50, nullable: true })
  requestedBy?: string | null

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'started_at', type: Date, nullable: true })
  startedAt?: Date | null

  @Property({ name: 'finished_at', type: Date, nullable: true })
  finishedAt?: Date | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}

@Entity({ tableName: 'data_quality_findings' })
@Unique({ name: 'data_quality_findings_fingerprint_unique', properties: ['tenantId', 'organizationId', 'fingerprint'] })
@Index({
  name: 'data_quality_findings_status_severity_idx',
  properties: ['tenantId', 'organizationId', 'status', 'severity'],
})
@Index({
  name: 'data_quality_findings_target_record_idx',
  properties: ['tenantId', 'organizationId', 'targetEntityType', 'targetRecordId'],
})
@Index({ name: 'data_quality_findings_check_status_idx', properties: ['tenantId', 'organizationId', 'checkId', 'status'] })
export class DataQualityFinding {
  [OptionalProps]?: 'scanRunId' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'check_id', type: 'uuid' })
  checkId!: string

  @Property({ name: 'scan_run_id', type: 'uuid', nullable: true })
  scanRunId?: string | null

  @Property({ name: 'target_entity_type', type: 'varchar', length: 100 })
  targetEntityType!: string

  @Property({ name: 'target_record_id', type: 'varchar', length: 100 })
  targetRecordId!: string

  @Property({ name: 'fingerprint', type: 'varchar', length: 128 })
  fingerprint!: string

  @Property({ name: 'status', type: 'text' })
  status!: DataQualityFindingStatus

  @Property({ name: 'severity', type: 'text' })
  severity!: DataQualitySeverity

  @Property({ name: 'message', type: 'varchar', length: 500 })
  message!: string

  @Property({ name: 'details_json', type: 'jsonb', nullable: true })
  detailsJson?: Record<string, unknown> | null

  @Property({ name: 'first_seen_at', type: Date })
  firstSeenAt!: Date

  @Property({ name: 'last_seen_at', type: Date })
  lastSeenAt!: Date

  @Property({ name: 'resolved_at', type: Date, nullable: true })
  resolvedAt?: Date | null

  @Property({ name: 'ignored_at', type: Date, nullable: true })
  ignoredAt?: Date | null

  @Property({ name: 'resolved_by', type: 'varchar', length: 50, nullable: true })
  resolvedBy?: string | null

  @Property({ name: 'ignored_by', type: 'varchar', length: 50, nullable: true })
  ignoredBy?: string | null

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
