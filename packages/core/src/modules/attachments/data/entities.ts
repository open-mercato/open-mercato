import { Entity, PrimaryKey, Property, Index } from '@mikro-orm/core'

@Entity({ tableName: 'attachments' })
export class Attachment {
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

  @Property({ name: 'file_name', type: 'text' })
  fileName!: string

  @Property({ name: 'mime_type', type: 'text' })
  mimeType!: string

  @Property({ name: 'file_size', type: 'int' })
  fileSize!: number

  @Property({ name: 'url', type: 'text' })
  url!: string

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()
}

