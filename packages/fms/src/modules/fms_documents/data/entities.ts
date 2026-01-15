import { Entity, Index, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core'

export enum DocumentCategory {
  OFFER = 'offer',
  INVOICE = 'invoice',
  CUSTOMS = 'customs',
  BILL_OF_LADING = 'bill_of_lading',
  OTHER = 'other',
}

@Entity({ tableName: 'fms_documents' })
@Index({ name: 'fms_documents_scope_idx', properties: ['organizationId', 'tenantId'] })
@Index({ name: 'fms_documents_category_idx', properties: ['category'] })
@Index({ name: 'fms_documents_attachment_idx', properties: ['attachmentId'] })
@Index({
  name: 'fms_documents_related_entity_idx',
  properties: ['relatedEntityId', 'relatedEntityType'],
})
export class FmsDocument {
  [OptionalProps]?: 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ type: 'text' })
  name!: string

  @Property({ type: 'text', default: 'other' })
  category: DocumentCategory = DocumentCategory.OTHER

  @Property({ type: 'text', nullable: true })
  description?: string | null

  @Property({ name: 'attachment_id', type: 'uuid' })
  attachmentId!: string

  @Property({ name: 'related_entity_id', type: 'uuid', nullable: true })
  relatedEntityId?: string | null

  @Property({ name: 'related_entity_type', type: 'text', nullable: true })
  relatedEntityType?: string | null

  @Property({ name: 'extracted_data', type: 'jsonb', nullable: true })
  extractedData?: Record<string, any> | null

  @Property({ name: 'processed_at', type: 'timestamptz', nullable: true })
  processedAt?: Date | null

  @Property({ name: 'created_at', type: 'timestamptz', onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy?: string | null

  @Property({ name: 'updated_at', type: 'timestamptz', onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'updated_by', type: 'uuid', nullable: true })
  updatedBy?: string | null

  @Property({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt?: Date | null
}
