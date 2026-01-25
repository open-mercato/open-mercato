import { Entity, Index, PrimaryKey, Property, Unique } from '@mikro-orm/core'

export type IncomingShipmentStatus = 'draft' | 'registered'

@Entity({ tableName: 'records_incoming_shipments' })
@Index({
  name: 'records_incoming_shipments_scope_idx',
  properties: ['organizationId', 'tenantId'],
})
@Index({
  name: 'records_incoming_shipments_org_unit_idx',
  properties: ['organizationId', 'tenantId', 'receivingOrgUnitId'],
})
@Unique({
  name: 'records_incoming_shipments_rpw_unique',
  properties: ['organizationId', 'tenantId', 'rpwNumber'],
})
export class RecordsIncomingShipment {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'receiving_org_unit_id', type: 'uuid' })
  receivingOrgUnitId!: string

  @Property({ name: 'receiving_org_unit_symbol', type: 'text' })
  receivingOrgUnitSymbol!: string

  @Property({ type: 'text' })
  subject!: string

  @Property({ name: 'sender_id', type: 'uuid', nullable: true })
  senderId?: string | null

  @Property({ name: 'sender_display_name', type: 'text', nullable: true })
  senderDisplayName?: string | null

  @Property({ name: 'sender_anonymous', type: 'boolean', default: false })
  senderAnonymous: boolean = false

  @Property({ name: 'delivery_method', type: 'text' })
  deliveryMethod!: string

  @Property({ type: 'text', default: 'draft' })
  status: IncomingShipmentStatus = 'draft'

  @Property({ name: 'received_at', type: 'timestamptz', nullable: true })
  receivedAt?: Date | null

  @Property({ name: 'rpw_number', type: 'text', nullable: true })
  rpwNumber?: string | null

  @Property({ name: 'rpw_sequence', type: 'integer', nullable: true })
  rpwSequence?: number | null

  @Property({ name: 'attachment_ids', type: 'jsonb', default: [], nullable: false })
  attachmentIds: string[] = []

  @Property({ name: 'posted_at', type: 'timestamptz', nullable: true })
  postedAt?: Date | null

  @Property({ name: 'sender_reference', type: 'text', nullable: true })
  senderReference?: string | null

  @Property({ type: 'text', nullable: true })
  remarks?: string | null

  @Property({ name: 'document_date', type: 'timestamptz', nullable: true })
  documentDate?: Date | null

  @Property({ name: 'no_document_date', type: 'boolean', default: false })
  noDocumentDate: boolean = false

  @Property({ name: 'document_sign', type: 'text', nullable: true })
  documentSign?: string | null

  @Property({ name: 'no_document_sign', type: 'boolean', default: false })
  noDocumentSign: boolean = false

  @Property({ name: 'access_level', type: 'text', default: 'public' })
  accessLevel: string = 'public'

  @Property({ name: 'has_chronological_registration', type: 'boolean', default: false })
  hasChronologicalRegistration: boolean = false

  @Property({ name: 'mapping_coverage', type: 'text', default: 'none' })
  mappingCoverage: string = 'none'

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'records_rpw_sequences' })
@Index({
  name: 'records_rpw_sequences_scope_idx',
  properties: ['organizationId', 'tenantId'],
})
@Unique({
  name: 'records_rpw_sequences_scope_unique',
  properties: ['organizationId', 'tenantId', 'receivingOrgUnitId', 'year'],
})
export class RecordsRpwSequence {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'receiving_org_unit_id', type: 'uuid' })
  receivingOrgUnitId!: string

  @Property({ type: 'integer' })
  year!: number

  @Property({ name: 'current_value', type: 'integer', default: 0 })
  currentValue: number = 0

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}

@Entity({ tableName: 'records_jrwa_classes' })
@Index({
  name: 'records_jrwa_classes_scope_idx',
  properties: ['organizationId', 'tenantId'],
})
@Index({
  name: 'records_jrwa_classes_tree_idx',
  properties: ['organizationId', 'tenantId', 'version', 'parentId'],
})
@Unique({
  name: 'records_jrwa_classes_parent_code_unique',
  properties: ['organizationId', 'tenantId', 'version', 'parentId', 'code'],
})
export class RecordsJrwaClass {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ type: 'text' })
  code!: string

  @Property({ type: 'text' })
  name!: string

  @Property({ name: 'parent_id', type: 'uuid', nullable: true })
  parentId?: string | null

  @Property({ name: 'retention_years', type: 'integer', nullable: true })
  retentionYears?: number | null

  @Property({ name: 'retention_category', type: 'text', nullable: true })
  retentionCategory?: string | null

  @Property({ type: 'integer', default: 1 })
  version: number = 1

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}
