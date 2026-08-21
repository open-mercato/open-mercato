import { OptionalProps } from '@mikro-orm/core'
import { Entity, Index, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy'
import type { PrivacyRetentionAction, PrivacySubjectAction } from '@open-mercato/shared/lib/privacy'

export type PrivacyOperationType = 'retention' | PrivacySubjectAction
export type PrivacyOperationStatus = 'running' | 'completed' | 'partial' | 'failed' | 'blocked'

@Entity({ tableName: 'privacy_retention_policies' })
@Unique({ name: 'privacy_retention_policies_scope_class_unique', properties: ['tenantId', 'organizationId', 'dataClassId'] })
@Index({ name: 'privacy_retention_policies_scope_active_idx', properties: ['tenantId', 'organizationId', 'isActive'] })
export class PrivacyRetentionPolicy {
  [OptionalProps]?: 'isActive' | 'createdAt' | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'data_class_id', type: 'text' })
  dataClassId!: string

  @Property({ name: 'retention_days', type: 'int' })
  retentionDays!: number

  @Property({ type: 'text' })
  action!: PrivacyRetentionAction

  @Property({ name: 'batch_size', type: 'int' })
  batchSize!: number

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

  @Property({ name: 'created_by', type: 'uuid' })
  createdBy!: string

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}

@Entity({ tableName: 'privacy_legal_holds' })
@Index({ name: 'privacy_legal_holds_scope_active_idx', properties: ['tenantId', 'organizationId', 'releasedAt', 'expiresAt'] })
@Index({ name: 'privacy_legal_holds_subject_idx', properties: ['tenantId', 'organizationId', 'subjectKind', 'subjectId'] })
export class PrivacyLegalHold {
  [OptionalProps]?: 'dataClassId' | 'subjectKind' | 'subjectId' | 'expiresAt' | 'releasedAt' | 'releasedBy' | 'createdAt' | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'data_class_id', type: 'text', nullable: true })
  dataClassId: string | null = null

  @Property({ name: 'subject_kind', type: 'text', nullable: true })
  subjectKind: string | null = null

  @Property({ name: 'subject_id', type: 'text', nullable: true })
  subjectId: string | null = null

  @Property({ type: 'text' })
  reason!: string

  @Property({ name: 'expires_at', type: Date, nullable: true })
  expiresAt: Date | null = null

  @Property({ name: 'released_at', type: Date, nullable: true })
  releasedAt: Date | null = null

  @Property({ name: 'created_by', type: 'uuid' })
  createdBy!: string

  @Property({ name: 'released_by', type: 'uuid', nullable: true })
  releasedBy: string | null = null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}

@Entity({ tableName: 'privacy_operations' })
@Index({ name: 'privacy_operations_scope_created_idx', properties: ['tenantId', 'organizationId', 'createdAt'] })
@Index({ name: 'privacy_operations_subject_idx', properties: ['tenantId', 'organizationId', 'subjectKind', 'subjectId'] })
export class PrivacyOperation {
  [OptionalProps]?: 'dataClassId' | 'subjectKind' | 'subjectId' | 'completedAt' | 'reportJson' | 'createdAt' | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ type: 'text' })
  type!: PrivacyOperationType

  @Property({ type: 'text' })
  status!: PrivacyOperationStatus

  @Property({ name: 'data_class_id', type: 'text', nullable: true })
  dataClassId: string | null = null

  @Property({ name: 'subject_kind', type: 'text', nullable: true })
  subjectKind: string | null = null

  @Property({ name: 'subject_id', type: 'text', nullable: true })
  subjectId: string | null = null

  @Property({ name: 'dry_run', type: 'boolean' })
  dryRun!: boolean

  @Property({ name: 'report_json', type: 'jsonb', nullable: true })
  reportJson: Record<string, unknown> | null = null

  @Property({ name: 'requested_by', type: 'uuid' })
  requestedBy!: string

  @Property({ name: 'completed_at', type: Date, nullable: true })
  completedAt: Date | null = null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}
