import { OptionalProps } from '@mikro-orm/core'
import { Entity, Enum, Index, ManyToOne, PrimaryKey, Property } from '@mikro-orm/decorators/legacy'

export const ORDER_STATUSES = ['draft', 'confirmed', 'assigned', 'in_transit', 'delivered', 'completed', 'invoiced', 'cancelled'] as const
export type OrderStatus = (typeof ORDER_STATUSES)[number]

export const TRUCK_TYPES = ['flatbed', 'curtain_side', 'refrigerated', 'tanker', 'tipper', 'lowbed', 'other'] as const
export type TruckType = (typeof TRUCK_TYPES)[number]

export const CARGO_UNITS = ['trip', 'ton', 'kg', 'm3', 'pallet', 'container', 'other'] as const
export type CargoUnit = (typeof CARGO_UNITS)[number]

export const CONTRACT_STATUSES = ['draft', 'active', 'suspended', 'terminated'] as const
export type ContractStatus = (typeof CONTRACT_STATUSES)[number]

export const BILLING_CYCLES = ['monthly', 'biweekly', 'weekly', 'per_abstract', 'on_demand'] as const
export type BillingCycle = (typeof BILLING_CYCLES)[number]

export const RATE_BASES = ['per_trip', 'per_ton', 'per_km', 'per_hour', 'per_day', 'round_trip', 'flat_monthly'] as const
export type RateBasis = (typeof RATE_BASES)[number]

// How a rate line pays the driver: a flat figure per unit of work, a share of
// the line's net, or nothing (the driver is on a salary the payroll module
// owns). The value's meaning follows the type — an amount, or a percentage.
export const DRIVER_INCENTIVE_TYPES = ['none', 'per_trip', 'per_km', 'per_hour', 'percentage_of_rate', 'fixed_monthly'] as const
export type DriverIncentiveType = (typeof DRIVER_INCENTIVE_TYPES)[number]

export const TRIP_SOURCES = ['contract', 'spot'] as const
export type TripSource = (typeof TRIP_SOURCES)[number]

export const TRIP_EXECUTION_STATUSES = ['planned', 'dispatched', 'in_transit', 'delivered', 'cancelled'] as const
export type TripExecutionStatus = (typeof TRIP_EXECUTION_STATUSES)[number]

export const TRIP_BILLING_STATUSES = ['unbilled', 'in_abstract', 'billed', 'excluded'] as const
export type TripBillingStatus = (typeof TRIP_BILLING_STATUSES)[number]

export const CHARGE_KINDS = ['waiting', 'toll', 'border', 'loading', 'unloading', 'other'] as const
export type ChargeKind = (typeof CHARGE_KINDS)[number]

export const ABSTRACT_STATUSES = ['draft', 'submitted', 'disputed', 'approved', 'invoiced', 'cancelled'] as const
export type AbstractStatus = (typeof ABSTRACT_STATUSES)[number]

export const ABSTRACT_APPROVAL_MODES = ['customer_portal', 'customer_offline', 'staff_internal'] as const
export type AbstractApprovalMode = (typeof ABSTRACT_APPROVAL_MODES)[number]

export const ABSTRACT_LINE_DISPUTE_STATUSES = ['none', 'disputed', 'resolved'] as const
export type AbstractLineDisputeStatus = (typeof ABSTRACT_LINE_DISPUTE_STATUSES)[number]

export const ABSTRACT_LINE_RESOLUTIONS = ['accepted_as_disputed', 'rejected_dispute', 'adjusted', 'removed'] as const
export type AbstractLineResolution = (typeof ABSTRACT_LINE_RESOLUTIONS)[number]

export const PAYMENT_METHODS = ['bank_transfer', 'cheque', 'cash', 'adjustment'] as const
export type FreightPaymentMethod = (typeof PAYMENT_METHODS)[number]

export const PAYMENT_STATUSES = ['recorded', 'voided'] as const
export type FreightPaymentStatus = (typeof PAYMENT_STATUSES)[number]

export const DOCUMENT_SEQUENCE_KINDS = ['order', 'contract', 'trip', 'abstract'] as const
export type DocumentSequenceKind = (typeof DOCUMENT_SEQUENCE_KINDS)[number]

@Entity({ tableName: 'freight_orders' })
@Index({ name: 'freight_orders_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'freight_orders_status_idx', properties: ['organizationId', 'status'] })
@Index({ name: 'freight_orders_customer_idx', properties: ['organizationId', 'customerId'] })
@Index({ name: 'freight_orders_requested_pickup_idx', properties: ['organizationId', 'requestedPickupAt'] })
@Index({
  name: 'freight_orders_number_unique_idx',
  expression:
    'create unique index "freight_orders_number_unique_idx" on "freight_orders" ("organization_id", "tenant_id", "order_number") where deleted_at is null',
})
export class FreightOrder {
  [OptionalProps]?: 'status' | 'currencyCode' | 'vatRate' | 'cargoHazardous' | 'cargoRefrigerated' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'order_number', type: 'text' })
  orderNumber!: string

  @Enum({ items: [...ORDER_STATUSES], type: 'text', name: 'status', default: 'draft' })
  status: OrderStatus = 'draft'

  @Property({ name: 'customer_id', type: 'uuid' })
  customerId!: string

  @Property({ name: 'customer_snapshot', type: 'jsonb' })
  customerSnapshot: Record<string, unknown> = {}

  @Property({ name: 'cargo_description', type: 'text' })
  cargoDescription!: string

  @Property({ name: 'cargo_weight_kg', type: 'numeric', precision: 18, scale: 3, nullable: true })
  cargoWeightKg?: string | null

  @Property({ name: 'cargo_volume_m3', type: 'numeric', precision: 18, scale: 3, nullable: true })
  cargoVolumeM3?: string | null

  @Property({ name: 'cargo_quantity', type: 'numeric', precision: 18, scale: 3, nullable: true })
  cargoQuantity?: string | null

  @Enum({ items: [...CARGO_UNITS], type: 'text', name: 'cargo_unit', nullable: true })
  cargoUnit?: CargoUnit | null

  @Property({ name: 'cargo_hazardous', type: 'boolean', default: false })
  cargoHazardous: boolean = false

  @Property({ name: 'cargo_refrigerated', type: 'boolean', default: false })
  cargoRefrigerated: boolean = false

  @Property({ name: 'temperature_min_c', type: 'numeric', precision: 5, scale: 1, nullable: true })
  temperatureMinC?: string | null

  @Property({ name: 'temperature_max_c', type: 'numeric', precision: 5, scale: 1, nullable: true })
  temperatureMaxC?: string | null

  @Property({ name: 'pickup_location', type: 'text' })
  pickupLocation!: string

  @Property({ name: 'dropoff_location', type: 'text' })
  dropoffLocation!: string

  @Property({ name: 'pickup_address_snapshot', type: 'jsonb', nullable: true })
  pickupAddressSnapshot?: Record<string, unknown> | null

  @Property({ name: 'dropoff_address_snapshot', type: 'jsonb', nullable: true })
  dropoffAddressSnapshot?: Record<string, unknown> | null

  @Property({ name: 'requested_pickup_at', type: Date, nullable: true })
  requestedPickupAt?: Date | null

  @Property({ name: 'requested_delivery_at', type: Date, nullable: true })
  requestedDeliveryAt?: Date | null

  @Enum({ items: [...TRUCK_TYPES], type: 'text', name: 'truck_type_required', default: 'other' })
  truckTypeRequired: TruckType = 'other'

  @Property({ name: 'vehicle_id', type: 'uuid', nullable: true })
  vehicleId?: string | null

  @Property({ name: 'driver_id', type: 'uuid', nullable: true })
  driverId?: string | null

  @Property({ name: 'vehicle_snapshot', type: 'jsonb', nullable: true })
  vehicleSnapshot?: Record<string, unknown> | null

  @Property({ name: 'driver_snapshot', type: 'jsonb', nullable: true })
  driverSnapshot?: Record<string, unknown> | null

  @Property({ name: 'transport_trip_id', type: 'uuid', nullable: true })
  transportTripId?: string | null

  @Property({ name: 'assigned_at', type: Date, nullable: true })
  assignedAt?: Date | null

  @Property({ name: 'dispatched_at', type: Date, nullable: true })
  dispatchedAt?: Date | null

  @Property({ name: 'delivered_at', type: Date, nullable: true })
  deliveredAt?: Date | null

  @Property({ name: 'completed_at', type: Date, nullable: true })
  completedAt?: Date | null

  @Property({ name: 'pod_document_id', type: 'uuid', nullable: true })
  podDocumentId?: string | null

  @Property({ name: 'pod_reference', type: 'text', nullable: true })
  podReference?: string | null

  @Property({ name: 'pod_received_by_name', type: 'text', nullable: true })
  podReceivedByName?: string | null

  @Property({ name: 'pod_received_at', type: Date, nullable: true })
  podReceivedAt?: Date | null

  @Property({ name: 'agreed_amount_net', type: 'numeric', precision: 18, scale: 4, default: '0' })
  agreedAmountNet: string = '0'

  @Property({ name: 'adjustment_amount_net', type: 'numeric', precision: 18, scale: 4, nullable: true })
  adjustmentAmountNet?: string | null

  @Property({ name: 'adjustment_note', type: 'text', nullable: true })
  adjustmentNote?: string | null

  @Property({ name: 'currency_code', type: 'text', default: 'SAR' })
  currencyCode: string = 'SAR'

  @Property({ name: 'vat_rate', type: 'numeric', precision: 5, scale: 2, default: '15' })
  vatRate: string = '15'

  @Property({ name: 'sales_order_id', type: 'uuid', nullable: true })
  salesOrderId?: string | null

  @Property({ name: 'sales_invoice_id', type: 'uuid', nullable: true })
  salesInvoiceId?: string | null

  @Property({ name: 'invoiced_at', type: Date, nullable: true })
  invoicedAt?: Date | null

  @Property({ name: 'cancellation_reason', type: 'text', nullable: true })
  cancellationReason?: string | null

  @Property({ name: 'notes', type: 'text', nullable: true })
  notes?: string | null

  @Property({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date(), nullable: true })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'freight_contracts' })
@Index({ name: 'freight_contracts_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'freight_contracts_status_idx', properties: ['organizationId', 'status'] })
@Index({ name: 'freight_contracts_customer_idx', properties: ['organizationId', 'customerId'] })
@Index({
  name: 'freight_contracts_number_unique_idx',
  expression:
    'create unique index "freight_contracts_number_unique_idx" on "freight_contracts" ("organization_id", "tenant_id", "contract_number") where deleted_at is null',
})
export class FreightContract {
  [OptionalProps]?: 'status' | 'billingCycle' | 'paymentTermsDays' | 'currencyCode' | 'vatRate' | 'requiresCustomerApproval' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'contract_number', type: 'text' })
  contractNumber!: string

  @Enum({ items: [...CONTRACT_STATUSES], type: 'text', name: 'status', default: 'draft' })
  status: ContractStatus = 'draft'

  @Property({ name: 'customer_id', type: 'uuid' })
  customerId!: string

  @Property({ name: 'customer_snapshot', type: 'jsonb' })
  customerSnapshot: Record<string, unknown> = {}

  @Property({ type: 'text' })
  title!: string

  @Property({ name: 'valid_from', type: 'date' })
  validFrom!: Date

  @Property({ name: 'valid_to', type: 'date' })
  validTo!: Date

  @Enum({ items: [...BILLING_CYCLES], type: 'text', name: 'billing_cycle', default: 'monthly' })
  billingCycle: BillingCycle = 'monthly'

  @Property({ name: 'payment_terms_days', type: 'integer', default: 30 })
  paymentTermsDays: number = 30

  @Property({ name: 'currency_code', type: 'text', default: 'SAR' })
  currencyCode: string = 'SAR'

  @Property({ name: 'vat_rate', type: 'numeric', precision: 5, scale: 2, default: '15' })
  vatRate: string = '15'

  @Property({ name: 'requires_customer_approval', type: 'boolean', default: true })
  requiresCustomerApproval: boolean = true

  @Property({ name: 'sales_channel_id', type: 'uuid', nullable: true })
  salesChannelId?: string | null

  @Property({ name: 'signed_at', type: Date, nullable: true })
  signedAt?: Date | null

  @Property({ name: 'notes', type: 'text', nullable: true })
  notes?: string | null

  @Property({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date(), nullable: true })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'freight_contract_routes' })
@Index({ name: 'freight_contract_routes_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'freight_contract_routes_contract_idx', properties: ['organizationId', 'contract'] })
@Index({
  name: 'freight_contract_routes_line_unique_idx',
  expression:
    'create unique index "freight_contract_routes_line_unique_idx" on "freight_contract_routes" ("contract_id", "line_number") where deleted_at is null',
})
export class FreightContractRoute {
  [OptionalProps]?: 'rateBasis' | 'isActive' | 'position' | 'includesTolls' | 'includesWaiting' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @ManyToOne(() => FreightContract, { fieldName: 'contract_id' })
  contract!: FreightContract

  @Property({ name: 'line_number', type: 'integer' })
  lineNumber!: number

  @Property({ name: 'transport_route_id', type: 'uuid', nullable: true })
  transportRouteId?: string | null

  @Property({ name: 'route_code_snapshot', type: 'text', nullable: true })
  routeCodeSnapshot?: string | null

  @Property({ type: 'text' })
  origin!: string

  @Property({ type: 'text' })
  destination!: string

  @Enum({ items: [...RATE_BASES], type: 'text', name: 'rate_basis', default: 'per_trip' })
  rateBasis: RateBasis = 'per_trip'

  @Property({ name: 'rate_amount', type: 'numeric', precision: 18, scale: 4, default: '0' })
  rateAmount: string = '0'

  @Property({ name: 'minimum_charge', type: 'numeric', precision: 18, scale: 4, nullable: true })
  minimumCharge?: string | null

  @Property({ name: 'currency_code', type: 'text' })
  currencyCode!: string

  @Property({ name: 'includes_tolls', type: 'boolean', default: false })
  includesTolls: boolean = false

  @Property({ name: 'includes_waiting', type: 'boolean', default: false })
  includesWaiting: boolean = false

  @Property({ name: 'free_waiting_minutes', type: 'integer', nullable: true })
  freeWaitingMinutes?: number | null

  @Property({ name: 'waiting_rate_per_hour', type: 'numeric', precision: 18, scale: 4, nullable: true })
  waitingRatePerHour?: string | null

  // The equipment the rate is quoted for. `vehicleTypeId` points at the fleet
  // module's vehicle type when it ships one; `equipmentType` is the free-text
  // fallback so a rate survives that module being absent.
  @Property({ name: 'vehicle_type_id', type: 'uuid', nullable: true })
  vehicleTypeId?: string | null

  @Property({ name: 'equipment_type', type: 'text', nullable: true })
  equipmentType?: string | null

  @Enum({ items: [...DRIVER_INCENTIVE_TYPES], type: 'text', name: 'driver_incentive_type', default: 'none' })
  driverIncentiveType: DriverIncentiveType = 'none'

  @Property({ name: 'driver_incentive_value', type: 'numeric', precision: 18, scale: 4, nullable: true })
  driverIncentiveValue?: string | null

  @Property({ name: 'vat_rate_override', type: 'numeric', precision: 5, scale: 2, nullable: true })
  vatRateOverride?: string | null

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

  @Property({ name: 'effective_from', type: 'date', nullable: true })
  effectiveFrom?: Date | null

  @Property({ name: 'effective_to', type: 'date', nullable: true })
  effectiveTo?: Date | null

  @Property({ type: 'integer', default: 0 })
  position: number = 0

  @Property({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date(), nullable: true })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'freight_trips' })
@Index({ name: 'freight_trips_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'freight_trips_customer_billing_idx', properties: ['organizationId', 'customerId', 'billingStatus'] })
@Index({ name: 'freight_trips_contract_date_idx', properties: ['organizationId', 'contractId', 'executionDate'] })
@Index({ name: 'freight_trips_execution_status_idx', properties: ['organizationId', 'executionStatus'] })
@Index({ name: 'freight_trips_active_abstract_idx', properties: ['organizationId', 'activeAbstractId'] })
@Index({
  name: 'freight_trips_number_unique_idx',
  expression:
    'create unique index "freight_trips_number_unique_idx" on "freight_trips" ("organization_id", "tenant_id", "trip_number") where deleted_at is null',
})
export class FreightTrip {
  [OptionalProps]?: 'source' | 'quantity' | 'chargesTotalNet' | 'totalNetAmount' | 'taxAmount' | 'totalGrossAmount' | 'currencyCode' | 'executionStatus' | 'billingStatus' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'trip_number', type: 'text' })
  tripNumber!: string

  @Enum({ items: [...TRIP_SOURCES], type: 'text', name: 'source', default: 'contract' })
  source: TripSource = 'contract'

  @Property({ name: 'contract_id', type: 'uuid', nullable: true })
  contractId?: string | null

  @Property({ name: 'contract_route_id', type: 'uuid', nullable: true })
  contractRouteId?: string | null

  @Property({ name: 'freight_order_id', type: 'uuid', nullable: true })
  freightOrderId?: string | null

  @Property({ name: 'customer_id', type: 'uuid' })
  customerId!: string

  @Property({ name: 'customer_snapshot', type: 'jsonb' })
  customerSnapshot: Record<string, unknown> = {}

  @Property({ name: 'execution_date', type: 'date' })
  executionDate!: Date

  @Property({ name: 'transport_route_id', type: 'uuid', nullable: true })
  transportRouteId?: string | null

  @Property({ name: 'route_code_snapshot', type: 'text', nullable: true })
  routeCodeSnapshot?: string | null

  @Property({ type: 'text' })
  origin!: string

  @Property({ type: 'text' })
  destination!: string

  @Enum({ items: [...RATE_BASES], type: 'text', name: 'rate_basis', default: 'per_trip' })
  rateBasis: RateBasis = 'per_trip'

  @Property({ type: 'numeric', precision: 18, scale: 4, default: '1' })
  quantity: string = '1'

  @Property({ name: 'unit_price_net', type: 'numeric', precision: 18, scale: 4, default: '0' })
  unitPriceNet: string = '0'

  @Property({ name: 'minimum_charge_applied', type: 'numeric', precision: 18, scale: 4, nullable: true })
  minimumChargeApplied?: string | null

  @Property({ name: 'base_amount_net', type: 'numeric', precision: 18, scale: 4, default: '0' })
  baseAmountNet: string = '0'

  @Property({ name: 'charges_total_net', type: 'numeric', precision: 18, scale: 4, default: '0' })
  chargesTotalNet: string = '0'

  @Property({ name: 'total_net_amount', type: 'numeric', precision: 18, scale: 4, default: '0' })
  totalNetAmount: string = '0'

  @Property({ name: 'tax_rate', type: 'numeric', precision: 5, scale: 2, default: '15' })
  taxRate: string = '15'

  @Property({ name: 'tax_amount', type: 'numeric', precision: 18, scale: 4, default: '0' })
  taxAmount: string = '0'

  @Property({ name: 'total_gross_amount', type: 'numeric', precision: 18, scale: 4, default: '0' })
  totalGrossAmount: string = '0'

  @Property({ name: 'currency_code', type: 'text', default: 'SAR' })
  currencyCode: string = 'SAR'

  @Property({ name: 'vehicle_id', type: 'uuid', nullable: true })
  vehicleId?: string | null

  @Property({ name: 'driver_id', type: 'uuid', nullable: true })
  driverId?: string | null

  @Property({ name: 'vehicle_snapshot', type: 'jsonb', nullable: true })
  vehicleSnapshot?: Record<string, unknown> | null

  @Property({ name: 'driver_snapshot', type: 'jsonb', nullable: true })
  driverSnapshot?: Record<string, unknown> | null

  @Property({ name: 'transport_trip_id', type: 'uuid', nullable: true })
  transportTripId?: string | null

  @Enum({ items: [...TRIP_EXECUTION_STATUSES], type: 'text', name: 'execution_status', default: 'planned' })
  executionStatus: TripExecutionStatus = 'planned'

  @Enum({ items: [...TRIP_BILLING_STATUSES], type: 'text', name: 'billing_status', default: 'unbilled' })
  billingStatus: TripBillingStatus = 'unbilled'

  @Property({ name: 'active_abstract_id', type: 'uuid', nullable: true })
  activeAbstractId?: string | null

  @Property({ name: 'actual_start_at', type: Date, nullable: true })
  actualStartAt?: Date | null

  @Property({ name: 'actual_end_at', type: Date, nullable: true })
  actualEndAt?: Date | null

  @Property({ name: 'waiting_minutes', type: 'integer', nullable: true })
  waitingMinutes?: number | null

  @Property({ name: 'distance_km', type: 'numeric', precision: 18, scale: 2, nullable: true })
  distanceKm?: string | null

  @Property({ name: 'pod_document_id', type: 'uuid', nullable: true })
  podDocumentId?: string | null

  @Property({ name: 'pod_reference', type: 'text', nullable: true })
  podReference?: string | null

  @Property({ name: 'pod_received_at', type: Date, nullable: true })
  podReceivedAt?: Date | null

  @Property({ name: 'pod_received_by_name', type: 'text', nullable: true })
  podReceivedByName?: string | null

  @Property({ name: 'notes', type: 'text', nullable: true })
  notes?: string | null

  @Property({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date(), nullable: true })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'freight_trip_charges' })
@Index({ name: 'freight_trip_charges_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'freight_trip_charges_trip_idx', properties: ['organizationId', 'trip'] })
export class FreightTripCharge {
  [OptionalProps]?: 'kind' | 'quantity' | 'isTaxable' | 'billable' | 'position' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @ManyToOne(() => FreightTrip, { fieldName: 'trip_id' })
  trip!: FreightTrip

  @Enum({ items: [...CHARGE_KINDS], type: 'text', name: 'kind', default: 'other' })
  kind: ChargeKind = 'other'

  @Property({ type: 'text', nullable: true })
  description?: string | null

  @Property({ type: 'numeric', precision: 18, scale: 3, default: '1' })
  quantity: string = '1'

  @Property({ name: 'unit_amount_net', type: 'numeric', precision: 18, scale: 4, default: '0' })
  unitAmountNet: string = '0'

  @Property({ name: 'amount_net', type: 'numeric', precision: 18, scale: 4, default: '0' })
  amountNet: string = '0'

  @Property({ name: 'is_taxable', type: 'boolean', default: true })
  isTaxable: boolean = true

  @Property({ type: 'boolean', default: true })
  billable: boolean = true

  @Property({ type: 'integer', default: 0 })
  position: number = 0

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date(), nullable: true })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'freight_trip_abstracts' })
@Index({ name: 'freight_trip_abstracts_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'freight_trip_abstracts_status_idx', properties: ['organizationId', 'status'] })
@Index({ name: 'freight_trip_abstracts_contract_idx', properties: ['organizationId', 'contractId', 'periodFrom'] })
@Index({ name: 'freight_trip_abstracts_customer_idx', properties: ['organizationId', 'customerId'] })
@Index({
  name: 'freight_trip_abstracts_number_unique_idx',
  expression:
    'create unique index "freight_trip_abstracts_number_unique_idx" on "freight_trip_abstracts" ("organization_id", "tenant_id", "abstract_number") where deleted_at is null',
})
export class FreightTripAbstract {
  [OptionalProps]?: 'status' | 'requiresCustomerApproval' | 'tripCount' | 'subtotalNetAmount' | 'taxTotalAmount' | 'grandTotalGrossAmount' | 'paidTotalAmount' | 'outstandingAmount' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'abstract_number', type: 'text' })
  abstractNumber!: string

  @Property({ name: 'contract_id', type: 'uuid' })
  contractId!: string

  @Property({ name: 'customer_id', type: 'uuid' })
  customerId!: string

  @Property({ name: 'customer_snapshot', type: 'jsonb' })
  customerSnapshot: Record<string, unknown> = {}

  @Property({ name: 'period_from', type: 'date' })
  periodFrom!: Date

  @Property({ name: 'period_to', type: 'date' })
  periodTo!: Date

  @Property({ name: 'billing_cycle_snapshot', type: 'text', nullable: true })
  billingCycleSnapshot?: string | null

  @Property({ name: 'currency_code', type: 'text', default: 'SAR' })
  currencyCode: string = 'SAR'

  @Property({ name: 'vat_rate', type: 'numeric', precision: 5, scale: 2, default: '15' })
  vatRate: string = '15'

  @Enum({ items: [...ABSTRACT_STATUSES], type: 'text', name: 'status', default: 'draft' })
  status: AbstractStatus = 'draft'

  @Property({ name: 'requires_customer_approval', type: 'boolean', default: true })
  requiresCustomerApproval: boolean = true

  @Enum({ items: [...ABSTRACT_APPROVAL_MODES], type: 'text', name: 'approval_mode', nullable: true })
  approvalMode?: AbstractApprovalMode | null

  @Property({ name: 'trip_count', type: 'integer', default: 0 })
  tripCount: number = 0

  @Property({ name: 'subtotal_net_amount', type: 'numeric', precision: 18, scale: 4, default: '0' })
  subtotalNetAmount: string = '0'

  @Property({ name: 'tax_total_amount', type: 'numeric', precision: 18, scale: 4, default: '0' })
  taxTotalAmount: string = '0'

  @Property({ name: 'grand_total_gross_amount', type: 'numeric', precision: 18, scale: 4, default: '0' })
  grandTotalGrossAmount: string = '0'

  @Property({ name: 'submitted_at', type: Date, nullable: true })
  submittedAt?: Date | null

  @Property({ name: 'submitted_by', type: 'uuid', nullable: true })
  submittedBy?: string | null

  @Property({ name: 'customer_approved_at', type: Date, nullable: true })
  customerApprovedAt?: Date | null

  @Property({ name: 'customer_approved_by_user_id', type: 'uuid', nullable: true })
  customerApprovedByUserId?: string | null

  @Property({ name: 'offline_approved_at', type: Date, nullable: true })
  offlineApprovedAt?: Date | null

  @Property({ name: 'offline_approved_by', type: 'uuid', nullable: true })
  offlineApprovedBy?: string | null

  @Property({ name: 'offline_approval_reference', type: 'text', nullable: true })
  offlineApprovalReference?: string | null

  @Property({ name: 'offline_approval_note', type: 'text', nullable: true })
  offlineApprovalNote?: string | null

  @Property({ name: 'staff_finalized_at', type: Date, nullable: true })
  staffFinalizedAt?: Date | null

  @Property({ name: 'staff_finalized_by', type: 'uuid', nullable: true })
  staffFinalizedBy?: string | null

  @Property({ name: 'staff_finalize_note', type: 'text', nullable: true })
  staffFinalizeNote?: string | null

  @Property({ name: 'disputed_at', type: Date, nullable: true })
  disputedAt?: Date | null

  @Property({ name: 'disputed_by_user_id', type: 'uuid', nullable: true })
  disputedByUserId?: string | null

  @Property({ name: 'resolved_at', type: Date, nullable: true })
  resolvedAt?: Date | null

  @Property({ name: 'resolved_by', type: 'uuid', nullable: true })
  resolvedBy?: string | null

  @Property({ name: 'cancelled_at', type: Date, nullable: true })
  cancelledAt?: Date | null

  @Property({ name: 'cancelled_by', type: 'uuid', nullable: true })
  cancelledBy?: string | null

  @Property({ name: 'cancellation_reason', type: 'text', nullable: true })
  cancellationReason?: string | null

  @Property({ name: 'sales_order_id', type: 'uuid', nullable: true })
  salesOrderId?: string | null

  @Property({ name: 'sales_invoice_id', type: 'uuid', nullable: true })
  salesInvoiceId?: string | null

  @Property({ name: 'sales_invoice_number', type: 'text', nullable: true })
  salesInvoiceNumber?: string | null

  @Property({ name: 'invoice_issued_at', type: Date, nullable: true })
  invoiceIssuedAt?: Date | null

  @Property({ name: 'due_date', type: Date, nullable: true })
  dueDate?: Date | null

  @Property({ name: 'paid_total_amount', type: 'numeric', precision: 18, scale: 4, default: '0' })
  paidTotalAmount: string = '0'

  @Property({ name: 'outstanding_amount', type: 'numeric', precision: 18, scale: 4, default: '0' })
  outstandingAmount: string = '0'

  @Property({ name: 'invoice_lines_map', type: 'jsonb', nullable: true })
  invoiceLinesMap?: Record<string, unknown>[] | null

  @Property({ name: 'notes', type: 'text', nullable: true })
  notes?: string | null

  @Property({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date(), nullable: true })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'freight_trip_abstract_lines' })
@Index({ name: 'freight_trip_abstract_lines_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'freight_trip_abstract_lines_abstract_idx', properties: ['organizationId', 'abstract'] })
@Index({
  name: 'freight_trip_abstract_lines_trip_live_unique_idx',
  expression:
    'create unique index "freight_trip_abstract_lines_trip_live_unique_idx" on "freight_trip_abstract_lines" ("organization_id", "tenant_id", "trip_id") where is_billable = true and deleted_at is null',
})
export class FreightTripAbstractLine {
  [OptionalProps]?: 'isBillable' | 'disputeStatus' | 'rateBasis' | 'quantity' | 'baseAmountNet' | 'chargesTotalNet' | 'totalNetAmount' | 'taxRate' | 'taxAmount' | 'totalGrossAmount' | 'currencyCode' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @ManyToOne(() => FreightTripAbstract, { fieldName: 'abstract_id' })
  abstract!: FreightTripAbstract

  @Property({ name: 'trip_id', type: 'uuid' })
  tripId!: string

  @Property({ name: 'line_number', type: 'integer' })
  lineNumber!: number

  @Property({ name: 'execution_date', type: 'date' })
  executionDate!: Date

  @Property({ name: 'route_code_snapshot', type: 'text', nullable: true })
  routeCodeSnapshot?: string | null

  @Property({ type: 'text' })
  origin!: string

  @Property({ type: 'text' })
  destination!: string

  @Enum({ items: [...RATE_BASES], type: 'text', name: 'rate_basis', default: 'per_trip' })
  rateBasis: RateBasis = 'per_trip'

  @Property({ type: 'numeric', precision: 18, scale: 4, default: '1' })
  quantity: string = '1'

  @Property({ name: 'unit_price_net', type: 'numeric', precision: 18, scale: 4, default: '0' })
  unitPriceNet: string = '0'

  @Property({ name: 'base_amount_net', type: 'numeric', precision: 18, scale: 4, default: '0' })
  baseAmountNet: string = '0'

  @Property({ name: 'charges_total_net', type: 'numeric', precision: 18, scale: 4, default: '0' })
  chargesTotalNet: string = '0'

  @Property({ name: 'charges_summary', type: 'jsonb', nullable: true })
  chargesSummary?: Record<string, unknown>[] | null

  @Property({ name: 'total_net_amount', type: 'numeric', precision: 18, scale: 4, default: '0' })
  totalNetAmount: string = '0'

  @Property({ name: 'tax_rate', type: 'numeric', precision: 5, scale: 2, default: '15' })
  taxRate: string = '15'

  @Property({ name: 'tax_amount', type: 'numeric', precision: 18, scale: 4, default: '0' })
  taxAmount: string = '0'

  @Property({ name: 'total_gross_amount', type: 'numeric', precision: 18, scale: 4, default: '0' })
  totalGrossAmount: string = '0'

  @Property({ name: 'currency_code', type: 'text', default: 'SAR' })
  currencyCode: string = 'SAR'

  @Property({ type: 'text', nullable: true })
  description?: string | null

  @Property({ name: 'is_billable', type: 'boolean', default: true })
  isBillable: boolean = true

  @Enum({ items: [...ABSTRACT_LINE_DISPUTE_STATUSES], type: 'text', name: 'dispute_status', default: 'none' })
  disputeStatus: AbstractLineDisputeStatus = 'none'

  @Property({ name: 'dispute_note', type: 'text', nullable: true })
  disputeNote?: string | null

  @Property({ name: 'disputed_at', type: Date, nullable: true })
  disputedAt?: Date | null

  @Property({ name: 'disputed_by_user_id', type: 'uuid', nullable: true })
  disputedByUserId?: string | null

  @Enum({ items: ['customer_portal', 'staff'], type: 'text', name: 'dispute_origin', nullable: true })
  disputeOrigin?: 'customer_portal' | 'staff' | null

  @Enum({ items: [...ABSTRACT_LINE_RESOLUTIONS], type: 'text', name: 'resolution', nullable: true })
  resolution?: AbstractLineResolution | null

  @Property({ name: 'resolution_note', type: 'text', nullable: true })
  resolutionNote?: string | null

  @Property({ name: 'resolved_at', type: Date, nullable: true })
  resolvedAt?: Date | null

  @Property({ name: 'resolved_by', type: 'uuid', nullable: true })
  resolvedBy?: string | null

  @Property({ name: 'adjusted_amount_net', type: 'numeric', precision: 18, scale: 4, nullable: true })
  adjustedAmountNet?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date(), nullable: true })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'freight_payments' })
@Index({ name: 'freight_payments_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'freight_payments_order_idx', properties: ['organizationId', 'orderId'] })
@Index({ name: 'freight_payments_abstract_idx', properties: ['organizationId', 'abstractId'] })
@Index({ name: 'freight_payments_customer_idx', properties: ['organizationId', 'customerId'] })
export class FreightPayment {
  [OptionalProps]?: 'method' | 'status' | 'currencyCode' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'order_id', type: 'uuid', nullable: true })
  orderId?: string | null

  @Property({ name: 'abstract_id', type: 'uuid', nullable: true })
  abstractId?: string | null

  @Property({ name: 'customer_id', type: 'uuid' })
  customerId!: string

  @Property({ name: 'currency_code', type: 'text', default: 'SAR' })
  currencyCode: string = 'SAR'

  @Property({ type: 'numeric', precision: 18, scale: 4 })
  amount!: string

  @Enum({ items: [...PAYMENT_METHODS], type: 'text', name: 'method', default: 'bank_transfer' })
  method: FreightPaymentMethod = 'bank_transfer'

  @Property({ type: 'text', nullable: true })
  reference?: string | null

  @Property({ name: 'received_at', type: 'date' })
  receivedAt!: Date

  @Enum({ items: [...PAYMENT_STATUSES], type: 'text', name: 'status', default: 'recorded' })
  status: FreightPaymentStatus = 'recorded'

  @Property({ name: 'sales_payment_id', type: 'uuid', nullable: true })
  salesPaymentId?: string | null

  @Property({ name: 'invoice_synced_at', type: Date, nullable: true })
  invoiceSyncedAt?: Date | null

  @Property({ name: 'voided_at', type: Date, nullable: true })
  voidedAt?: Date | null

  @Property({ name: 'voided_by', type: 'uuid', nullable: true })
  voidedBy?: string | null

  @Property({ name: 'void_reason', type: 'text', nullable: true })
  voidReason?: string | null

  @Property({ type: 'text', nullable: true })
  notes?: string | null

  @Property({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date(), nullable: true })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'freight_document_sequences' })
@Index({
  name: 'freight_document_sequences_kind_unique_idx',
  expression:
    'create unique index "freight_document_sequences_kind_unique_idx" on "freight_document_sequences" ("organization_id", "tenant_id", "kind")',
})
export class FreightDocumentSequence {
  [OptionalProps]?: 'currentValue' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Enum({ items: [...DOCUMENT_SEQUENCE_KINDS], type: 'text', name: 'kind' })
  kind!: DocumentSequenceKind

  @Property({ name: 'current_value', type: 'integer', default: 0 })
  currentValue: number = 0

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date(), nullable: true })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

export const FREIGHT_ENTITIES = [
  FreightOrder,
  FreightContract,
  FreightContractRoute,
  FreightTrip,
  FreightTripCharge,
  FreightTripAbstract,
  FreightTripAbstractLine,
  FreightPayment,
  FreightDocumentSequence,
] as const
