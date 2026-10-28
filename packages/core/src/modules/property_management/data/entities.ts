import { OptionalProps } from '@mikro-orm/core'
import { Entity, Index, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy'

export type BuildingStatus = 'active' | 'archived'
export type CommonAreaKind = 'corridor' | 'kitchen' | 'toilets' | 'lobby' | 'stairs_lifts' | 'storage' | 'other'
export type ProductUseKind = 'leasable' | 'bookable'
export type BillingUnit = 'month' | 'hour' | 'day'

type ScopedOptionalProps = 'createdAt' | 'updatedAt' | 'deletedAt'

@Entity({ tableName: 'property_management_buildings' })
@Index({ name: 'property_management_buildings_org_status_idx', properties: ['organizationId', 'status'] })
@Index({ name: 'property_management_buildings_scope_idx', properties: ['organizationId', 'tenantId'] })
export class Building {
  [OptionalProps]?: ScopedOptionalProps | 'status' | 'archivedAt' | 'openingHoursEnabled'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ type: 'text' })
  name!: string

  @Property({ type: 'text' })
  address!: string

  @Property({ type: 'text', default: 'active' })
  status: BuildingStatus = 'active'

  @Property({ name: 'archived_at', type: Date, nullable: true })
  archivedAt?: Date | null

  @Property({ name: 'opening_hours_enabled', type: 'boolean', default: false })
  openingHoursEnabled: boolean = false

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'property_management_building_managers' })
@Unique({ name: 'property_management_building_managers_unique', properties: ['buildingId', 'userId'] })
@Index({ name: 'property_management_building_managers_user_idx', properties: ['organizationId', 'userId'] })
export class BuildingManager {
  [OptionalProps]?: 'createdAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'building_id', type: 'uuid' })
  buildingId!: string

  @Property({ name: 'user_id', type: 'uuid' })
  userId!: string

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()
}

@Entity({ tableName: 'property_management_floors' })
@Index({ name: 'property_management_floors_building_idx', properties: ['organizationId', 'buildingId'] })
@Index({
  name: 'property_management_floors_number_unique',
  expression:
    'create unique index "property_management_floors_number_unique" on "property_management_floors" ("building_id", "number") where "deleted_at" is null',
})
export class Floor {
  [OptionalProps]?: ScopedOptionalProps

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'building_id', type: 'uuid' })
  buildingId!: string

  @Property({ type: 'int' })
  number!: number

  @Property({ type: 'text' })
  name!: string

  @Property({ name: 'size_x', type: 'numeric', precision: 7, scale: 2 })
  sizeX!: string

  @Property({ name: 'size_y', type: 'numeric', precision: 7, scale: 2 })
  sizeY!: string

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'property_management_spaces' })
@Index({ name: 'property_management_spaces_floor_idx', properties: ['organizationId', 'floorId'] })
@Index({ name: 'property_management_spaces_building_idx', properties: ['organizationId', 'buildingId'] })
export class Space {
  [OptionalProps]?: ScopedOptionalProps | 'purpose' | 'isDefault'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'building_id', type: 'uuid' })
  buildingId!: string

  @Property({ name: 'floor_id', type: 'uuid' })
  floorId!: string

  @Property({ type: 'text' })
  name!: string

  @Property({ type: 'text', nullable: true })
  purpose?: string | null

  @Property({ type: 'numeric', precision: 7, scale: 2 })
  x!: string

  @Property({ type: 'numeric', precision: 7, scale: 2 })
  y!: string

  @Property({ type: 'numeric', precision: 7, scale: 2 })
  width!: string

  @Property({ type: 'numeric', precision: 7, scale: 2 })
  depth!: string

  @Property({ name: 'is_default', type: 'boolean', default: false })
  isDefault: boolean = false

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'property_management_units' })
@Index({ name: 'property_management_units_floor_idx', properties: ['organizationId', 'floorId'] })
@Index({ name: 'property_management_units_space_idx', properties: ['organizationId', 'spaceId'] })
@Index({ name: 'property_management_units_product_idx', properties: ['organizationId', 'catalogProductId'] })
@Index({ name: 'property_management_units_building_idx', properties: ['organizationId', 'buildingId'] })
export class Unit {
  [OptionalProps]?: ScopedOptionalProps

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'building_id', type: 'uuid' })
  buildingId!: string

  @Property({ name: 'floor_id', type: 'uuid' })
  floorId!: string

  @Property({ name: 'space_id', type: 'uuid' })
  spaceId!: string

  @Property({ type: 'text' })
  name!: string

  @Property({ name: 'catalog_category_id', type: 'uuid' })
  catalogCategoryId!: string

  @Property({ name: 'catalog_product_id', type: 'uuid' })
  catalogProductId!: string

  @Property({ type: 'numeric', precision: 7, scale: 2 })
  x!: string

  @Property({ type: 'numeric', precision: 7, scale: 2 })
  y!: string

  @Property({ type: 'numeric', precision: 7, scale: 2 })
  width!: string

  @Property({ type: 'numeric', precision: 7, scale: 2 })
  depth!: string

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'property_management_unit_product_periods' })
@Index({ name: 'property_management_unit_product_periods_unit_idx', properties: ['organizationId', 'unitId', 'validFrom'] })
@Index({
  name: 'property_management_unit_product_periods_open_unique',
  expression:
    'create unique index "property_management_unit_product_periods_open_unique" on "property_management_unit_product_periods" ("unit_id") where "valid_to" is null',
})
export class UnitProductPeriod {
  [OptionalProps]?: 'createdAt' | 'validTo' | 'priceAmount' | 'currencyCode' | 'priceKindId'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'unit_id', type: 'uuid' })
  unitId!: string

  @Property({ name: 'catalog_product_id', type: 'uuid' })
  catalogProductId!: string

  @Property({ name: 'product_name', type: 'text' })
  productName!: string

  @Property({ type: 'text' })
  use!: ProductUseKind

  @Property({ name: 'billing_unit', type: 'text' })
  billingUnit!: BillingUnit

  @Property({ name: 'price_amount', type: 'numeric', precision: 16, scale: 4, nullable: true })
  priceAmount?: string | null

  @Property({ name: 'currency_code', type: 'text', nullable: true })
  currencyCode?: string | null

  @Property({ name: 'price_kind_id', type: 'uuid', nullable: true })
  priceKindId?: string | null

  @Property({ name: 'valid_from', type: Date })
  validFrom!: Date

  @Property({ name: 'valid_to', type: Date, nullable: true })
  validTo?: Date | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()
}

@Entity({ tableName: 'property_management_common_areas' })
@Index({ name: 'property_management_common_areas_floor_idx', properties: ['organizationId', 'floorId'] })
@Index({ name: 'property_management_common_areas_building_idx', properties: ['organizationId', 'buildingId'] })
export class CommonArea {
  [OptionalProps]?: ScopedOptionalProps

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'building_id', type: 'uuid' })
  buildingId!: string

  @Property({ name: 'floor_id', type: 'uuid' })
  floorId!: string

  @Property({ type: 'text' })
  name!: string

  @Property({ type: 'text' })
  kind!: CommonAreaKind

  @Property({ type: 'numeric', precision: 7, scale: 2 })
  x!: string

  @Property({ type: 'numeric', precision: 7, scale: 2 })
  y!: string

  @Property({ type: 'numeric', precision: 7, scale: 2 })
  width!: string

  @Property({ type: 'numeric', precision: 7, scale: 2 })
  depth!: string

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'property_management_product_uses' })
@Unique({ name: 'property_management_product_uses_product_unique', properties: ['organizationId', 'catalogProductId'] })
export class ProductUse {
  [OptionalProps]?: 'createdAt' | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'catalog_product_id', type: 'uuid' })
  catalogProductId!: string

  @Property({ type: 'text' })
  use!: ProductUseKind

  @Property({ name: 'billing_unit', type: 'text' })
  billingUnit!: BillingUnit

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}

export type LeaseStatus = 'proposed' | 'pending_order' | 'active' | 'declined' | 'withdrawn' | 'expired' | 'ended'
export type LeaseVersionEvent = 'activated' | 'corrected' | 'extended' | 'rescheduled'
export type LeaseVersionState = 'pending' | 'in_force' | 'reverted'
export type LeaseProposalKind = 'new' | 'extension'
export type LeaseProposalStatus = 'sending' | 'sent' | 'approved' | 'declined' | 'withdrawn' | 'expired'
export type LeaseChangeKind = 'end' | 'delete' | 'correction' | 'reschedule'
export type SalesOperationKind =
  | 'quote'
  | 'quote_status'
  | 'lease_order'
  | 'extension_order'
  | 'booking_order'
  | 'order_status'
  | 'recurrence_cancel'
  | 'recurrence_replace'
export type SalesOperationStatus = 'pending' | 'done' | 'refused' | 'compensating' | 'compensated' | 'failed'
export type SalesOperationTargetType = 'lease' | 'lease_version' | 'lease_proposal' | 'booking'

export type LeasePendingChange = {
  kind: LeaseChangeKind
  changeId: string
  previous: {
    endsOn: string
    startsOn: string
    status: LeaseStatus
    termMonths: number
    currentVersionId: string | null
  }
  operationIds: string[]
}

export type LeaseBillingRefusal = {
  changeId: string
  kind: LeaseChangeKind | 'activation' | 'proposal'
  code: string | null
  message: string | null
  at: string
  restored: { endsOn: string; startsOn: string; status: LeaseStatus } | null
}

@Entity({ tableName: 'property_management_leases' })
@Index({ name: 'property_management_leases_unit_status_idx', properties: ['organizationId', 'unitId', 'status'] })
@Index({ name: 'property_management_leases_building_idx', properties: ['organizationId', 'buildingId'] })
@Index({ name: 'property_management_leases_company_idx', properties: ['organizationId', 'customerCompanyId'] })
@Unique({ name: 'property_management_leases_reference_unique', properties: ['organizationId', 'reference'] })
export class Lease {
  [OptionalProps]?:
    | ScopedOptionalProps
    | 'primaryContactPersonId'
    | 'currentVersionId'
    | 'holdToken'
    | 'salesOrderId'
    | 'pendingChange'
    | 'billingAttention'
    | 'lastBillingRefusal'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ type: 'text' })
  reference!: string

  @Property({ name: 'building_id', type: 'uuid' })
  buildingId!: string

  @Property({ name: 'unit_id', type: 'uuid' })
  unitId!: string

  @Property({ name: 'customer_company_id', type: 'uuid' })
  customerCompanyId!: string

  @Property({ name: 'primary_contact_person_id', type: 'uuid', nullable: true })
  primaryContactPersonId?: string | null

  @Property({ type: 'text' })
  status!: LeaseStatus

  @Property({ name: 'starts_on', type: 'date' })
  startsOn!: string

  @Property({ name: 'term_months', type: 'int' })
  termMonths!: number

  @Property({ name: 'ends_on', type: 'date' })
  endsOn!: string

  @Property({ name: 'current_version_id', type: 'uuid', nullable: true })
  currentVersionId?: string | null

  @Property({ name: 'hold_token', type: 'uuid', nullable: true })
  holdToken?: string | null

  @Property({ name: 'sales_order_id', type: 'uuid', nullable: true })
  salesOrderId?: string | null

  @Property({ name: 'pending_change', type: 'jsonb', nullable: true })
  pendingChange?: LeasePendingChange | null

  @Property({ name: 'billing_attention', type: 'boolean', default: false })
  billingAttention: boolean = false

  @Property({ name: 'last_billing_refusal', type: 'jsonb', nullable: true })
  lastBillingRefusal?: LeaseBillingRefusal | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'property_management_lease_versions' })
@Index({ name: 'property_management_lease_versions_lease_idx', properties: ['organizationId', 'leaseId', 'versionNo'] })
@Unique({ name: 'property_management_lease_versions_number_unique', properties: ['leaseId', 'versionNo'] })
export class LeaseVersion {
  [OptionalProps]?: 'createdAt' | 'updatedAt' | 'salesOrderId' | 'salesOrderLineId' | 'holdToken' | 'currencyCode'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'lease_id', type: 'uuid' })
  leaseId!: string

  @Property({ name: 'version_no', type: 'int' })
  versionNo!: number

  @Property({ type: 'text' })
  event!: LeaseVersionEvent

  @Property({ type: 'text' })
  state!: LeaseVersionState

  @Property({ name: 'catalog_product_id', type: 'uuid' })
  catalogProductId!: string

  @Property({ name: 'product_name', type: 'text' })
  productName!: string

  @Property({ name: 'monthly_rate', type: 'numeric', precision: 16, scale: 4 })
  monthlyRate!: string

  @Property({ name: 'currency_code', type: 'text', nullable: true })
  currencyCode?: string | null

  @Property({ name: 'starts_on', type: 'date' })
  startsOn!: string

  @Property({ name: 'ends_on', type: 'date' })
  endsOn!: string

  @Property({ name: 'months', type: 'int' })
  months!: number

  @Property({ name: 'sales_order_id', type: 'uuid', nullable: true })
  salesOrderId?: string | null

  @Property({ name: 'sales_order_line_id', type: 'uuid', nullable: true })
  salesOrderLineId?: string | null

  @Property({ name: 'hold_token', type: 'uuid', nullable: true })
  holdToken?: string | null

  @Property({ name: 'effective_from', type: 'date' })
  effectiveFrom!: string

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}

@Entity({ tableName: 'property_management_lease_proposals' })
@Index({ name: 'property_management_lease_proposals_lease_idx', properties: ['organizationId', 'leaseId'] })
@Index({ name: 'property_management_lease_proposals_status_idx', properties: ['organizationId', 'status', 'respondBy'] })
@Index({
  name: 'property_management_lease_proposals_open_unique',
  expression:
    `create unique index "property_management_lease_proposals_open_unique" on "property_management_lease_proposals" ("lease_id") where "status" in ('sending', 'sent', 'declined')`,
})
export class LeaseProposal {
  [OptionalProps]?:
    | 'createdAt'
    | 'updatedAt'
    | 'salesQuoteId'
    | 'salesOrderId'
    | 'message'
    | 'answeredAt'
    | 'answeredByCustomerUserId'
    | 'remindedAt'
    | 'holdToken'
    | 'currencyCode'
    | 'versionId'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'lease_id', type: 'uuid' })
  leaseId!: string

  @Property({ name: 'version_id', type: 'uuid', nullable: true })
  versionId?: string | null

  @Property({ type: 'text' })
  kind!: LeaseProposalKind

  @Property({ name: 'sales_quote_id', type: 'uuid', nullable: true })
  salesQuoteId?: string | null

  @Property({ name: 'sales_order_id', type: 'uuid', nullable: true })
  salesOrderId?: string | null

  @Property({ name: 'starts_on', type: 'date' })
  startsOn!: string

  @Property({ name: 'ends_on', type: 'date' })
  endsOn!: string

  @Property({ name: 'months', type: 'int' })
  months!: number

  @Property({ name: 'monthly_rate', type: 'numeric', precision: 16, scale: 4 })
  monthlyRate!: string

  @Property({ name: 'currency_code', type: 'text', nullable: true })
  currencyCode?: string | null

  @Property({ type: 'text', nullable: true })
  message?: string | null

  @Property({ name: 'expires_in_days', type: 'int' })
  expiresInDays!: number

  @Property({ name: 'respond_by', type: 'date' })
  respondBy!: string

  @Property({ type: 'text' })
  status!: LeaseProposalStatus

  @Property({ name: 'hold_token', type: 'uuid', nullable: true })
  holdToken?: string | null

  @Property({ name: 'answered_at', type: Date, nullable: true })
  answeredAt?: Date | null

  @Property({ name: 'answered_by_customer_user_id', type: 'uuid', nullable: true })
  answeredByCustomerUserId?: string | null

  @Property({ name: 'reminded_at', type: Date, nullable: true })
  remindedAt?: Date | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}

@Entity({ tableName: 'property_management_lease_reference_counters' })
@Unique({ name: 'property_management_lease_reference_counters_scope_unique', properties: ['organizationId', 'tenantId'] })
export class LeaseReferenceCounter {
  [OptionalProps]?: 'createdAt' | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ type: 'int' })
  year!: number

  @Property({ name: 'last_number', type: 'int' })
  lastNumber!: number

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}

@Entity({ tableName: 'property_management_sales_operations' })
@Unique({ name: 'property_management_sales_operations_subject_unique', properties: ['organizationId', 'subjectKey'] })
@Index({ name: 'property_management_sales_operations_status_idx', properties: ['organizationId', 'status'] })
@Index({ name: 'property_management_sales_operations_change_idx', properties: ['organizationId', 'changeId', 'sequence'] })
@Index({ name: 'property_management_sales_operations_target_idx', properties: ['organizationId', 'targetType', 'targetId'] })
export class SalesOperation {
  [OptionalProps]?:
    | 'createdAt'
    | 'updatedAt'
    | 'changeId'
    | 'sequence'
    | 'allowCredit'
    | 'salesDocumentType'
    | 'salesDocumentId'
    | 'salesDocumentLineId'
    | 'attempts'
    | 'lastError'
    | 'leaseId'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ type: 'text' })
  kind!: SalesOperationKind

  @Property({ name: 'subject_key', type: 'text' })
  subjectKey!: string

  @Property({ name: 'payload_hash', type: 'text' })
  payloadHash!: string

  @Property({ type: 'jsonb' })
  payload!: Record<string, unknown>

  @Property({ name: 'change_id', type: 'uuid', nullable: true })
  changeId?: string | null

  @Property({ type: 'int', default: 1 })
  sequence: number = 1

  @Property({ name: 'target_type', type: 'text' })
  targetType!: SalesOperationTargetType

  @Property({ name: 'target_id', type: 'uuid' })
  targetId!: string

  @Property({ name: 'lease_id', type: 'uuid', nullable: true })
  leaseId?: string | null

  @Property({ type: 'text' })
  status!: SalesOperationStatus

  @Property({ type: 'uuid' })
  token!: string

  @Property({ name: 'allow_credit', type: 'boolean', nullable: true })
  allowCredit?: boolean | null

  @Property({ name: 'sales_document_type', type: 'text', nullable: true })
  salesDocumentType?: 'order' | 'quote' | null

  @Property({ name: 'sales_document_id', type: 'uuid', nullable: true })
  salesDocumentId?: string | null

  @Property({ name: 'sales_document_line_id', type: 'uuid', nullable: true })
  salesDocumentLineId?: string | null

  @Property({ type: 'int', default: 0 })
  attempts: number = 0

  @Property({ name: 'last_error', type: 'jsonb', nullable: true })
  lastError?: { code: string | null; message: string | null; status: number | null } | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}

@Entity({ tableName: 'property_management_settings' })
@Unique({ name: 'property_management_settings_scope_unique', properties: ['organizationId', 'tenantId'] })
export class PropertyManagementSettings {
  [OptionalProps]?:
    | 'createdAt'
    | 'updatedAt'
    | 'billingChannelId'
    | 'cancelledOrderStatusEntryId'
    | 'leaseEndingThresholdDays'
    | 'bookingReminderMinutes'
    | 'proposalExpiryDays'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'billing_channel_id', type: 'uuid', nullable: true })
  billingChannelId?: string | null

  @Property({ name: 'cancelled_order_status_entry_id', type: 'uuid', nullable: true })
  cancelledOrderStatusEntryId?: string | null

  @Property({ name: 'lease_ending_threshold_days', type: 'int', default: 60 })
  leaseEndingThresholdDays: number = 60

  @Property({ name: 'booking_reminder_minutes', type: 'int', default: 60 })
  bookingReminderMinutes: number = 60

  @Property({ name: 'proposal_expiry_days', type: 'int', default: 14 })
  proposalExpiryDays: number = 14

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}
