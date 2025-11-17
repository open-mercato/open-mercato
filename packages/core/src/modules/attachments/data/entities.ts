import { Entity, Index, OptionalProps, PrimaryKey, Property, Unique } from '@mikro-orm/core'

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

  @Property({ name: 'is_public', type: 'boolean', default: false })
  isPublic: boolean = false

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}

@Entity({ tableName: 'attachments' })
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

  @Property({ name: 'storage_metadata', type: 'json', nullable: true })
  storageMetadata?: Record<string, unknown> | null

  @Property({ name: 'url', type: 'text' })
  url!: string

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()
}
