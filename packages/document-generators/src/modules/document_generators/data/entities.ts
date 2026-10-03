import { Entity, Index, PrimaryKey, Property } from '@mikro-orm/decorators/legacy'

@Entity({ tableName: 'document_generators_generated_documents' })
@Index({
  name: 'document_generators_generated_documents_resource_idx',
  properties: ['organizationId', 'resourceKind', 'resourceId'],
})
@Index({
  name: 'document_generators_generated_documents_scope_generated_at_idx',
  expression:
    'create index "document_generators_generated_documents_scope_generated_at_idx" on "document_generators_generated_documents" ("tenant_id", "organization_id", "generated_at" desc)',
})
export class GeneratedDocument {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'resource_kind', type: 'text' })
  resourceKind!: string

  @Property({ name: 'resource_id', type: 'text' })
  resourceId!: string

  @Property({ name: 'resource_label', type: 'text' })
  resourceLabel!: string

  @Property({ name: 'template_id', type: 'text' })
  templateId!: string

  @Property({ name: 'template_label', type: 'text' })
  templateLabel!: string

  @Property({ name: 'format', type: 'text', default: 'pdf' })
  format: string = 'pdf'

  @Property({ name: 'mime_type', type: 'text', default: 'application/pdf' })
  mimeType: string = 'application/pdf'

  @Property({ name: 'generated_by', type: 'uuid' })
  generatedBy!: string

  @Property({ name: 'generated_at', type: Date })
  generatedAt!: Date

  @Property({ name: 'attachment_id', type: 'uuid', nullable: true })
  attachmentId?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}
