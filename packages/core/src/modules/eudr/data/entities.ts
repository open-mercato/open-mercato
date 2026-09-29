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

  @Property({ name: 'species_scientific_name', type: 'text', nullable: true })
  speciesScientificName?: string | null

  @Property({ name: 'species_common_name', type: 'text', nullable: true })
  speciesCommonName?: string | null

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

@Entity({ tableName: 'eudr_plots' })
@Index({ name: 'idx_eudr_plots_supplier', properties: ['supplierEntityId'] })
export class EudrPlot {
  [OptionalProps]?: 'plotType' | 'validationWarnings' | 'isActive' | 'createdAt' | 'updatedAt' | 'deletedAt'

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

  @Property({ name: 'name', type: 'text' })
  name!: string

  @Property({ name: 'external_id', type: 'text', nullable: true })
  externalId?: string | null

  @Property({ name: 'description', type: 'text', nullable: true })
  description?: string | null

  @Property({ name: 'origin_country', type: 'text' })
  originCountry!: string

  @Property({ name: 'plot_type', type: 'text', default: 'point' })
  plotType: string = 'point'

  @Property({ name: 'geometry', type: 'json' })
  geometry!: Record<string, unknown>

  @Property({ name: 'area_ha', type: 'numeric', precision: 12, scale: 4, nullable: true })
  areaHa?: string | null

  @Property({ name: 'validation_warnings', type: 'json', default: [] })
  validationWarnings: string[] = []

  @Property({ name: 'producer_name', type: 'text', nullable: true })
  producerName?: string | null

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

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
  [OptionalProps]?: 'attachmentIds' | 'plotIds' | 'status' | 'completenessScore' | 'missingFields' | 'createdAt' | 'updatedAt' | 'deletedAt'

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

  @Property({ name: 'plot_ids', type: 'json', default: [] })
  plotIds: string[] = []

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
@Index({
  name: 'eudr_dds_tenant_org_submitted_idx',
  expression: 'create index "eudr_dds_tenant_org_submitted_idx" on "eudr_due_diligence_statements" ("tenant_id", "organization_id", "submitted_at") where "deleted_at" is null',
})
export class EudrDueDiligenceStatement {
  [OptionalProps]?: 'status' | 'referencedStatements' | 'createdAt' | 'updatedAt' | 'deletedAt'

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

  @Property({ name: 'activity_type', type: 'text', nullable: true })
  activityType?: string | null

  @Property({ name: 'actor_role', type: 'text', nullable: true })
  actorRole?: string | null

  @Property({ name: 'referenced_statements', type: 'json', default: [] })
  referencedStatements: Array<{ referenceNumber: string; verificationNumber?: string | null }> = []

  @Property({ name: 'quantity_kg', type: 'numeric', precision: 14, scale: 3, nullable: true })
  quantityKg?: string | null

  @Property({ name: 'supplementary_unit', type: 'text', nullable: true })
  supplementaryUnit?: string | null

  @Property({ name: 'supplementary_quantity', type: 'numeric', precision: 14, scale: 3, nullable: true })
  supplementaryQuantity?: string | null

  @Property({ name: 'order_id', type: 'uuid', nullable: true })
  orderId?: string | null

  @Property({ name: 'submitted_at', type: Date, nullable: true })
  submittedAt?: Date | null

  @Property({ name: 'reference_issued_at', type: Date, nullable: true })
  referenceIssuedAt?: Date | null

  @Property({ name: 'order_snapshot', type: 'json', nullable: true })
  orderSnapshot?: { orderNumber?: string | null } | null

  @Property({ name: 'notes', type: 'text', nullable: true })
  notes?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'eudr_risk_assessments' })
@Index({ name: 'idx_eudr_risk_assessments_statement', properties: ['statementId'] })
export class EudrRiskAssessment {
  [OptionalProps]?: 'countryRisks' | 'overallTier' | 'criteria' | 'conclusion' | 'isSimplified' | 'assessedAt' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'statement_id', type: 'uuid' })
  statementId!: string

  @Property({ name: 'country_risks', type: 'json', default: [] })
  countryRisks: Array<{ country: string; tier: string }> = []

  @Property({ name: 'overall_tier', type: 'text', default: 'unknown' })
  overallTier: string = 'unknown'

  @Property({ name: 'criteria', type: 'json', defaultRaw: "'{}'" })
  criteria: Record<string, { answer: string; note?: string | null }> = {}

  @Property({ name: 'conclusion', type: 'text', default: 'non_negligible' })
  conclusion: string = 'non_negligible'

  @Property({ name: 'is_simplified', type: 'boolean', default: false })
  isSimplified: boolean = false

  @Property({ name: 'assessed_at', type: Date, onCreate: () => new Date() })
  assessedAt: Date = new Date()

  @Property({ name: 'assessed_by_name', type: 'text', nullable: true })
  assessedByName?: string | null

  @Property({ name: 'review_due_at', type: Date, nullable: true })
  reviewDueAt?: Date | null

  @Property({ name: 'notes', type: 'text', nullable: true })
  notes?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'eudr_mitigation_actions' })
@Index({ name: 'idx_eudr_mitigation_actions_risk_assessment', properties: ['riskAssessmentId'] })
export class EudrMitigationAction {
  [OptionalProps]?: 'actionType' | 'status' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'risk_assessment_id', type: 'uuid' })
  riskAssessmentId!: string

  @Property({ name: 'action_type', type: 'text', default: 'other' })
  actionType: string = 'other'

  @Property({ name: 'title', type: 'text' })
  title!: string

  @Property({ name: 'description', type: 'text', nullable: true })
  description?: string | null

  @Property({ name: 'status', type: 'text', default: 'planned' })
  status: string = 'planned'

  @Property({ name: 'due_date', type: Date, nullable: true })
  dueDate?: Date | null

  @Property({ name: 'completed_at', type: Date, nullable: true })
  completedAt?: Date | null

  @Property({ name: 'notes', type: 'text', nullable: true })
  notes?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}
