import { BigIntType, OptionalProps } from '@mikro-orm/core'
import { Entity, Index, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy'
import { resolveDefaultAttachmentOcrEnabled } from '../lib/ocrConfig'
import type { AttachmentAccessRequirement } from '../lib/access-types'

@Entity({ tableName: 'attachment_partitions' })
@Unique({ name: 'attachment_partitions_code_unique', properties: ['code'] })
export class AttachmentPartition {
  [OptionalProps]?: 'createdAt' | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ type: 'text' })
  code!: string

  @Property({ type: 'text' })
  title!: string

  @Property({ type: 'text', nullable: true })
  description?: string | null

  @Property({ name: 'storage_driver', type: 'text', default: 'local' })
  storageDriver: string = 'local'

  @Property({ name: 'config_json', type: 'json', nullable: true })
  configJson?: Record<string, unknown> | null

  @Property({ name: 'access_resolver_requirements', type: 'jsonb', nullable: true })
  accessResolverRequirements?: AttachmentAccessRequirement[] | null

  /**
   * Primary owner entity ids kept out of the shared attachments library. Written
   * as a union wherever access requirements are written and never pruned, so the
   * exclusion survives disabling the declaring module.
   */
  @Property({ name: 'library_excluded_entities', type: 'jsonb', nullable: true })
  libraryExcludedEntities?: string[] | null

  @Property({ name: 'is_public', type: 'boolean', default: false })
  isPublic: boolean = false

  @Property({ name: 'requires_ocr', type: 'boolean', default: resolveDefaultAttachmentOcrEnabled() })
  requiresOcr: boolean = resolveDefaultAttachmentOcrEnabled()

  @Property({ name: 'ocr_model', type: 'text', nullable: true })
  ocrModel?: string | null

  @Property({ name: 'organization_id', type: 'uuid', nullable: true })
  organizationId?: string | null

  @Property({ name: 'tenant_id', type: 'uuid', nullable: true })
  @Index({ name: 'attachment_partitions_tenant_idx' })
  tenantId?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}

@Entity({ tableName: 'attachments' })
@Index({ name: 'attachments_storage_reference_idx', properties: ['partitionCode', 'storagePath'] })
// Serves `storage_metadata @> '{"assignments":[{"type":…,"id":…}]}'`, the containment probe
// `releaseOwnedScoped` uses to find rows assigned to an owner. `jsonb_path_ops` supports
// exactly `@>` and is the smaller opclass. Built concurrently by its migration.
@Index({
  name: 'attachments_storage_metadata_gin_idx',
  expression: 'create index "attachments_storage_metadata_gin_idx" on "attachments" using gin ("storage_metadata" jsonb_path_ops)',
})
export class Attachment {
  [OptionalProps]?: 'createdAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'entity_id', type: 'text' })
  entityId!: string

  @Property({ name: 'record_id', type: 'text' })
  @Index({ name: 'attachments_entity_record_idx' })
  recordId!: string

  @Property({ name: 'organization_id', type: 'uuid', nullable: true })
  organizationId?: string | null

  @Property({ name: 'tenant_id', type: 'uuid', nullable: true })
  tenantId?: string | null

  @Property({ name: 'partition_code', type: 'text' })
  @Index({ name: 'attachments_partition_code_idx' })
  partitionCode!: string

  @Property({ name: 'file_name', type: 'text' })
  fileName!: string

  @Property({ name: 'mime_type', type: 'text' })
  mimeType!: string

  @Property({ name: 'file_size', type: 'int' })
  fileSize!: number

  @Property({ name: 'storage_driver', type: 'text', default: 'local' })
  storageDriver: string = 'local'

  @Property({ name: 'storage_path', type: 'text' })
  storagePath!: string

  @Property({ name: 'storage_metadata', type: 'jsonb', nullable: true })
  storageMetadata?: Record<string, unknown> | null

  @Property({ name: 'url', type: 'text' })
  url!: string

  @Property({ name: 'content', type: 'text', nullable: true })
  content: string | null = null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()
}

@Entity({ tableName: 'attachment_quota_reservations' })
@Unique({
  name: 'attachment_quota_reservations_scope_path_unique',
  properties: ['tenantId', 'storageDriver', 'storagePath'],
})
@Index({
  name: 'attachment_quota_reservations_tenant_status_idx',
  properties: ['tenantId', 'status'],
})
export class AttachmentQuotaReservation {
  [OptionalProps]?: 'actualBytes' | 'createdAt' | 'status' | 'updatedAt' | 'uploadTokenHash'

  @PrimaryKey({ type: 'uuid' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  /** Backed by a `bigint` column; hydrate as `number` (safe under Number.MAX_SAFE_INTEGER for attachment byte counts) instead of MikroORM's default JS `bigint`. */
  @Property({ name: 'reserved_bytes', type: new BigIntType('number') })
  reservedBytes!: number

  /** Backed by a `bigint` column; hydrate as `number`, not MikroORM's default JS `bigint`. */
  @Property({ name: 'actual_bytes', type: new BigIntType('number'), nullable: true })
  actualBytes?: number | null

  @Property({ type: 'text', default: 'reserved' })
  status: 'reserved' | 'storing' | 'stored' | 'recovering' | 'committed' = 'reserved'

  @Property({ type: 'text' })
  source!: string

  @Property({ name: 'storage_driver', type: 'text' })
  storageDriver!: string

  @Property({ name: 'partition_code', type: 'text', nullable: true })
  partitionCode?: string | null

  @Property({ name: 'storage_path', type: 'text' })
  storagePath!: string

  @Property({ name: 'lease_token', type: 'uuid' })
  leaseToken!: string

  @Property({ name: 'upload_token_hash', type: 'text', nullable: true })
  uploadTokenHash?: string | null

  @Property({ name: 'expires_at', type: Date, nullable: true })
  @Index({ name: 'attachment_quota_reservations_expires_idx' })
  expiresAt?: Date | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}
