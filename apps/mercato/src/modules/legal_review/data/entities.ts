import { Entity, Index, PrimaryKey, Property } from '@mikro-orm/decorators/legacy'

/**
 * A legal review request for one document (an NDA in the example flow).
 *
 * `documentId` is a plain foreign-key id into the Documents module — there is
 * deliberately no ORM relation across modules.
 */
@Entity({ tableName: 'legal_review_matters' })
@Index({ name: 'legal_review_matters_scope_idx', properties: ['tenantId', 'organizationId', 'deletedAt'] })
@Index({ name: 'legal_review_matters_document_idx', properties: ['tenantId', 'organizationId', 'documentId'] })
export class LegalMatter {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'document_id', type: 'uuid' })
  documentId!: string

  @Property({ type: 'text' })
  reference!: string

  @Property({ type: 'text' })
  counterparty!: string

  @Property({ type: 'text', nullable: true })
  purpose?: string | null

  @Property({ type: 'text', nullable: true })
  jurisdiction?: string | null

  @Property({ name: 'agreement_type', type: 'text', default: 'mutual_nda' })
  agreementType: string = 'mutual_nda'

  @Property({ type: 'text', default: 'counterparty' })
  paper: string = 'counterparty'

  @Property({ name: 'requested_by_user_id', type: 'uuid', nullable: true })
  requestedByUserId?: string | null

  @Property({ name: 'assignee_user_id', type: 'uuid', nullable: true })
  assigneeUserId?: string | null

  @Property({ type: 'text', default: 'requested' })
  stage: string = 'requested'

  @Property({ name: 'due_at', type: Date, nullable: true })
  dueAt?: Date | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}
