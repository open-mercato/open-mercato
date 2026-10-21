import { OptionalProps } from '@mikro-orm/core'
import { Entity, Enum, ManyToOne, PrimaryKey, Property } from '@mikro-orm/decorators/legacy'

/**
 * Vehicle rental (bus and fleet hire), with or without a driver.
 *
 * A rental is one contract over one vehicle for one window. Duration is billed
 * per day, week or month; the mileage agreed at handover and return decides the
 * extra kilometres, which is why both readings are recorded as their own check
 * documents rather than as plain fields — the handover is signed by two parties
 * and has to survive as evidence.
 */

export const RENTAL_STATUSES = ['draft', 'active', 'completed', 'cancelled'] as const
export type RentalStatus = (typeof RENTAL_STATUSES)[number]

export const RENTAL_TYPES = ['with_driver', 'without_driver'] as const
export type RentalType = (typeof RENTAL_TYPES)[number]

export const RENTAL_CLIENT_TYPES = ['b2b', 'b2c'] as const
export type RentalClientType = (typeof RENTAL_CLIENT_TYPES)[number]

export const RENTAL_DURATION_TYPES = ['daily', 'weekly', 'monthly'] as const
export type RentalDurationType = (typeof RENTAL_DURATION_TYPES)[number]

// `handover` and `return` are written by their lifecycle commands; `inspection`
// is any check recorded in between (a mid-rental inspection, or one entered
// after the fact). One live check of each kind per rental is the invariant.
export const RENTAL_CHECK_KINDS = ['handover', 'return', 'inspection'] as const
export type RentalCheckKind = (typeof RENTAL_CHECK_KINDS)[number]

export const RENTAL_SEQUENCE_KINDS = ['rental'] as const
export type RentalSequenceKind = (typeof RENTAL_SEQUENCE_KINDS)[number]

@Entity({ tableName: 'rental_contracts' })
export class RentalContract {
  [OptionalProps]?: 'status' | 'rentalType' | 'clientType' | 'durationType' | 'currencyCode' | 'vatRate' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'rental_number', type: 'text' })
  rentalNumber!: string

  @Enum({ items: [...RENTAL_STATUSES], type: 'text', default: 'draft' })
  status: RentalStatus = 'draft'

  @Enum({ items: [...RENTAL_TYPES], type: 'text', name: 'rental_type', default: 'with_driver' })
  rentalType: RentalType = 'with_driver'

  @Enum({ items: [...RENTAL_CLIENT_TYPES], type: 'text', name: 'client_type', default: 'b2b' })
  clientType: RentalClientType = 'b2b'

  @Enum({ items: [...RENTAL_DURATION_TYPES], type: 'text', name: 'duration_type', default: 'daily' })
  durationType: RentalDurationType = 'daily'

  @Property({ name: 'customer_id', type: 'uuid' })
  customerId!: string

  @Property({ name: 'customer_snapshot', type: 'jsonb' })
  customerSnapshot!: Record<string, unknown>

  @Property({ name: 'vehicle_id', type: 'uuid', nullable: true })
  vehicleId?: string | null

  @Property({ name: 'vehicle_snapshot', type: 'jsonb', nullable: true })
  vehicleSnapshot?: Record<string, unknown> | null

  @Property({ name: 'driver_id', type: 'uuid', nullable: true })
  driverId?: string | null

  @Property({ name: 'driver_snapshot', type: 'jsonb', nullable: true })
  driverSnapshot?: Record<string, unknown> | null

  @Property({ name: 'start_at', type: Date, nullable: true })
  startAt?: Date | null

  @Property({ name: 'end_at', type: Date, nullable: true })
  endAt?: Date | null

  @Property({ name: 'actual_start_at', type: Date, nullable: true })
  actualStartAt?: Date | null

  @Property({ name: 'actual_end_at', type: Date, nullable: true })
  actualEndAt?: Date | null

  @Property({ name: 'daily_rate', type: 'numeric', precision: 18, scale: 4, default: '0' })
  dailyRate: string = '0'

  @Property({ name: 'weekly_rate', type: 'numeric', precision: 18, scale: 4, default: '0' })
  weeklyRate: string = '0'

  @Property({ name: 'monthly_rate', type: 'numeric', precision: 18, scale: 4, default: '0' })
  monthlyRate: string = '0'

  @Property({ name: 'included_km', type: 'integer', nullable: true })
  includedKm?: number | null

  @Property({ name: 'extra_km_rate', type: 'numeric', precision: 18, scale: 4, nullable: true })
  extraKmRate?: string | null

  @Property({ name: 'odo_start_km', type: 'integer', nullable: true })
  odoStartKm?: number | null

  @Property({ name: 'odo_end_km', type: 'integer', nullable: true })
  odoEndKm?: number | null

  @Property({ name: 'usage_km', type: 'integer', nullable: true })
  usageKm?: number | null

  @Property({ name: 'extra_km', type: 'integer', nullable: true })
  extraKm?: number | null

  @Property({ name: 'rental_amount_net', type: 'numeric', precision: 18, scale: 4, default: '0' })
  rentalAmountNet: string = '0'

  @Property({ name: 'extra_km_amount_net', type: 'numeric', precision: 18, scale: 4, default: '0' })
  extraKmAmountNet: string = '0'

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

  @Property({ name: 'sales_order_id', type: 'uuid', nullable: true })
  salesOrderId?: string | null

  @Property({ name: 'sales_invoice_id', type: 'uuid', nullable: true })
  salesInvoiceId?: string | null

  @Property({ name: 'handover_at', type: Date, nullable: true })
  handoverAt?: Date | null

  @Property({ name: 'return_at', type: Date, nullable: true })
  returnAt?: Date | null

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

@Entity({ tableName: 'rental_vehicle_checks' })
export class RentalVehicleCheck {
  [OptionalProps]?: 'checkedAt' | 'hasDamage' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @ManyToOne(() => RentalContract, { fieldName: 'contract_id' })
  contract!: RentalContract

  @Enum({ items: [...RENTAL_CHECK_KINDS], type: 'text' })
  kind!: RentalCheckKind

  @Property({ name: 'odometer_km', type: 'integer' })
  odometerKm!: number

  @Property({ name: 'fuel_level', type: 'integer', nullable: true })
  fuelLevel?: number | null

  @Property({ name: 'has_damage', type: 'boolean', default: false })
  hasDamage: boolean = false

  @Property({ name: 'condition_notes', type: 'text', nullable: true })
  conditionNotes?: string | null

  @Property({ name: 'checked_at', type: Date, onCreate: () => new Date() })
  checkedAt: Date = new Date()

  @Property({ name: 'checked_by', type: 'uuid', nullable: true })
  checkedBy?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date(), nullable: true })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'rental_document_sequences' })
export class RentalDocumentSequence {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Enum({ items: [...RENTAL_SEQUENCE_KINDS], type: 'text', default: 'rental' })
  kind: RentalSequenceKind = 'rental'

  @Property({ name: 'current_value', type: 'integer', default: 0 })
  currentValue: number = 0

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date(), nullable: true })
  updatedAt: Date = new Date()
}
