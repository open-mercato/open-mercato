import { OptionalProps } from '@mikro-orm/core'
import { Entity, Index, PrimaryKey, Property } from '@mikro-orm/decorators/legacy'

@Entity({ tableName: 'eudr_product_mappings' })
@Index({
  name: 'idx_eudr_mappings_org_product_commodity_unique',
  expression: 'create unique index "idx_eudr_mappings_org_product_commodity_unique" on "eudr_product_mappings" ("organization_id", "product_id", "commodity") where deleted_at is null',
})
export class EudrProductMapping {
  [OptionalProps]?: 'isInScope' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'product_id', type: 'uuid' })
  productId!: string

  @Property({ name: 'product_snapshot', type: 'json', nullable: true })
  productSnapshot?: { name?: string | null; sku?: string | null } | null

  @Property({ name: 'commodity', type: 'text' })
  commodity!: string

  @Property({ name: 'hs_code', type: 'text', nullable: true })
  hsCode?: string | null

  @Property({ name: 'is_in_scope', type: 'boolean', default: true })
  isInScope: boolean = true

  @Property({ name: 'notes', type: 'text', nullable: true })
  notes?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'eudr_evidence_submissions' })
@Index({ name: 'idx_eudr_submissions_statement', properties: ['statementId'] })
@Index({ name: 'idx_eudr_submissions_supplier', properties: ['supplierEntityId'] })
export class EudrEvidenceSubmission {
  [OptionalProps]?: 'attachmentIds' | 'status' | 'completenessScore' | 'missingFields' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'supplier_entity_id', type: 'uuid' })
  supplierEntityId!: string

  @Property({ name: 'supplier_snapshot', type: 'json', nullable: true })
  supplierSnapshot?: { displayName?: string | null } | null

  @Property({ name: 'commodity', type: 'text' })
  commodity!: string

  @Property({ name: 'product_mapping_id', type: 'uuid', nullable: true })
  productMappingId?: string | null

  @Property({ name: 'statement_id', type: 'uuid', nullable: true })
  statementId?: string | null

  @Property({ name: 'origin_country', type: 'text', nullable: true })
  originCountry?: string | null

  @Property({ name: 'geolocation', type: 'json', nullable: true })
  geolocation?: Record<string, unknown> | null

  @Property({ name: 'quantity_kg', type: 'numeric', precision: 14, scale: 3, nullable: true })
  quantityKg?: string | null

  @Property({ name: 'batch_number', type: 'text', nullable: true })
  batchNumber?: string | null

  @Property({ name: 'harvest_from', type: Date, nullable: true })
  harvestFrom?: Date | null

  @Property({ name: 'harvest_to', type: Date, nullable: true })
  harvestTo?: Date | null

  @Property({ name: 'producer_name', type: 'text', nullable: true })
  producerName?: string | null

  @Property({ name: 'attachment_ids', type: 'json', default: [] })
  attachmentIds: string[] = []

  @Property({ name: 'status', type: 'text', default: 'draft' })
  status: string = 'draft'

  @Property({ name: 'completeness_score', type: 'integer', default: 0 })
  completenessScore: number = 0

  @Property({ name: 'missing_fields', type: 'json', default: [] })
  missingFields: string[] = []

  @Property({ name: 'notes', type: 'text', nullable: true })
  notes?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'eudr_due_diligence_statements' })
export class EudrDueDiligenceStatement {
  [OptionalProps]?: 'status' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'title', type: 'text' })
  title!: string

  @Property({ name: 'commodity', type: 'text' })
  commodity!: string

  @Property({ name: 'reference_number', type: 'text', nullable: true })
  referenceNumber?: string | null

  @Property({ name: 'verification_number', type: 'text', nullable: true })
  verificationNumber?: string | null

  @Property({ name: 'status', type: 'text', default: 'draft' })
  status: string = 'draft'

  @Property({ name: 'quantity_kg', type: 'numeric', precision: 14, scale: 3, nullable: true })
  quantityKg?: string | null

  @Property({ name: 'order_id', type: 'uuid', nullable: true })
  orderId?: string | null

  @Property({ name: 'notes', type: 'text', nullable: true })
  notes?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}
