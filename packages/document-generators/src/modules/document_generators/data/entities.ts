import { OptionalProps } from '@mikro-orm/core'
import { Entity, Index, PrimaryKey, Property } from '@mikro-orm/decorators/legacy'

/**
 * History record for a generated document.
 *
 * Written best-effort by `POST /api/document-generators/generate` after every successful
 * render. Resource identity and its human label are derived from normalized
 * server-side data by the loaded template. Format-agnostic
 * by design — `format`/`mime_type` let the
 * same table hold non-PDF outputs (e.g. `.docx`, `.md`) in the future without a
 * schema change. `attachment_id` is populated in Phase 6 (attachment storage).
 */
@Entity({ tableName: 'document_generators_generated_documents' })
@Index({ name: 'document_generators_generated_documents_org_idx', properties: ['organizationId'] })
@Index({ name: 'document_generators_generated_documents_resource_idx', properties: ['organizationId', 'resourceKind', 'resourceId'] })
export class GeneratedDocument {
  [OptionalProps]?: 'format' | 'mimeType' | 'attachmentId' | 'generatedAt' | 'createdAt' | 'updatedAt'

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

  // User id of the generator (cross-module reference — string id only, no relation).
  @Property({ name: 'generated_by', type: 'uuid' })
  generatedBy!: string

  @Property({ name: 'generated_at', type: Date, onCreate: () => new Date() })
  generatedAt: Date = new Date()

  // Populated in Phase 6 once the rendered file is stored in the attachments module.
  @Property({ name: 'attachment_id', type: 'uuid', nullable: true })
  attachmentId?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}
