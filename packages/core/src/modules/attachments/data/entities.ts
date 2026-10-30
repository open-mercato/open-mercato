import { BigIntType, OptionalProps } from '@mikro-orm/core'
import { Entity, Index, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy'
import { resolveDefaultAttachmentOcrEnabled } from '../lib/ocrConfig'
import type {
  DocumentSectionKind,
  DocumentSectionSource,
  DocumentStructureEngineName,
  ExtractionSkipReason,
  ExtractionStatus,
} from '../lib/documentStructure/types'

@Entity({ tableName: 'attachment_partitions' })
@Unique({ name: 'attachment_partitions_code_unique', properties: ['code'] })
export class AttachmentPartition {
  [OptionalProps]?: 'createdAt' | 'updatedAt' | 'extractDocumentStructure' | 'indexDocumentSections'

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

  @Property({ name: 'is_public', type: 'boolean', default: false })
  isPublic: boolean = false

  @Property({ name: 'requires_ocr', type: 'boolean', default: resolveDefaultAttachmentOcrEnabled() })
  requiresOcr: boolean = resolveDefaultAttachmentOcrEnabled()

  @Property({ name: 'ocr_model', type: 'text', nullable: true })
  ocrModel?: string | null

  @Property({ name: 'extract_document_structure', type: 'boolean', default: false })
  extractDocumentStructure: boolean = false

  @Property({ name: 'index_document_sections', type: 'boolean', default: false })
  indexDocumentSections: boolean = false

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

@Entity({ tableName: 'attachment_document_extractions' })
@Index({ name: 'attachment_document_extractions_scope_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'attachment_document_extractions_attachment_idx', properties: ['attachmentId', 'createdAt'] })
@Index({
  name: 'attachment_document_extractions_live_unique',
  expression:
    `create unique index "attachment_document_extractions_live_unique" on "attachment_document_extractions" ("attachment_id", "content_sha256", "engine_version") where deleted_at is null`,
})
export class AttachmentDocumentExtraction {
  [OptionalProps]?: 'createdAt' | 'updatedAt' | 'status'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid', nullable: true })
  tenantId?: string | null

  @Property({ name: 'organization_id', type: 'uuid', nullable: true })
  organizationId?: string | null

  @Property({ name: 'attachment_id', type: 'uuid' })
  attachmentId!: string

  @Property({ name: 'partition_code', type: 'text' })
  partitionCode!: string

  @Property({ name: 'content_sha256', type: 'varchar', length: 64 })
  contentSha256!: string

  @Property({ type: 'varchar', length: 32 })
  engine!: DocumentStructureEngineName

  @Property({ name: 'engine_version', type: 'int' })
  engineVersion!: number

  @Property({ type: 'varchar', length: 20, default: 'pending' })
  status: ExtractionStatus = 'pending'

  @Property({ name: 'skip_reason', type: 'varchar', length: 40, nullable: true })
  skipReason?: ExtractionSkipReason | null

  @Property({ name: 'page_count', type: 'int', nullable: true })
  pageCount?: number | null

  @Property({ name: 'section_count', type: 'int', nullable: true })
  sectionCount?: number | null

  @Property({ name: 'char_count', type: 'int', nullable: true })
  charCount?: number | null

  @Property({ name: 'ocr_page_count', type: 'int', nullable: true })
  ocrPageCount?: number | null

  @Property({ name: 'normalized_text', type: 'text', nullable: true })
  normalizedText?: string | null

  @Property({ name: 'failure_reason', type: 'text', nullable: true })
  failureReason?: string | null

  @Property({ type: 'json', nullable: true })
  stats?: Record<string, unknown> | null

  @Property({ name: 'requested_by_user_id', type: 'uuid', nullable: true })
  requestedByUserId?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'completed_at', type: Date, nullable: true })
  completedAt?: Date | null

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'attachment_document_sections' })
@Index({ name: 'attachment_document_sections_extraction_ordinal_idx', properties: ['extractionId', 'ordinal'] })
@Index({ name: 'attachment_document_sections_number_label_idx', properties: ['attachmentId', 'numberLabel'] })
@Index({ name: 'attachment_document_sections_anchor_key_idx', properties: ['attachmentId', 'anchorKey'] })
@Index({ name: 'attachment_document_sections_scope_idx', properties: ['tenantId', 'organizationId'] })
export class AttachmentDocumentSection {
  [OptionalProps]?: 'createdAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid', nullable: true })
  tenantId?: string | null

  @Property({ name: 'organization_id', type: 'uuid', nullable: true })
  organizationId?: string | null

  @Property({ name: 'extraction_id', type: 'uuid' })
  extractionId!: string

  @Property({ name: 'attachment_id', type: 'uuid' })
  attachmentId!: string

  @Property({ name: 'parent_id', type: 'uuid', nullable: true })
  parentId?: string | null

  @Property({ type: 'int' })
  ordinal!: number

  @Property({ type: 'smallint' })
  depth!: number

  @Property({ type: 'varchar', length: 20 })
  kind!: DocumentSectionKind

  @Property({ name: 'number_label', type: 'varchar', length: 64, nullable: true })
  numberLabel?: string | null

  @Property({ type: 'text', nullable: true })
  heading?: string | null

  @Property({ name: 'heading_path', type: 'json' })
  headingPath!: string[]

  @Property({ type: 'text' })
  text!: string

  @Property({ name: 'page_start', type: 'int', nullable: true })
  pageStart?: number | null

  @Property({ name: 'page_end', type: 'int', nullable: true })
  pageEnd?: number | null

  @Property({ name: 'char_start', type: 'int' })
  charStart!: number

  @Property({ name: 'char_end', type: 'int' })
  charEnd!: number

  @Property({ name: 'anchor_key', type: 'varchar', length: 32 })
  anchorKey!: string

  @Property({ name: 'text_sha256', type: 'varchar', length: 64 })
  textSha256!: string

  @Property({ name: 'token_estimate', type: 'int' })
  tokenEstimate!: number

  @Property({ type: 'varchar', length: 16 })
  source!: DocumentSectionSource

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()
}
