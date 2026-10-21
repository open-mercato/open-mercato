import { OptionalProps } from '@mikro-orm/core'
import { Entity, Enum, ManyToOne, PrimaryKey, Property } from '@mikro-orm/decorators/legacy'

/**
 * School transport subscriptions and the daily run.
 *
 * A *plan* is the priced product (a direction, a duration, an account type); a
 * *subscription* is one student riding it. Account type decides who is billed:
 * a B2C parent pays per child, a B2B school receives one consolidated invoice —
 * which is why the paying party and the school are separate references on the
 * subscription, and the same shape can bill either.
 *
 * Attendance is per leg and per day: the morning pickup and the afternoon
 * drop-off are two different events a parent cares about separately, and a
 * "notified" absence (the parent told us) must stay distinguishable from an
 * unexcused one.
 */

export const SUBSCRIPTION_ACCOUNT_TYPES = ['b2c', 'b2b'] as const
export type SubscriptionAccountType = (typeof SUBSCRIPTION_ACCOUNT_TYPES)[number]

export const SUBSCRIPTION_DURATIONS = ['monthly', 'quarterly', 'annual', 'custom_b2b_contract'] as const
export type SubscriptionDuration = (typeof SUBSCRIPTION_DURATIONS)[number]

export const SUBSCRIPTION_DIRECTIONS = ['two_way', 'one_way_pickup', 'one_way_drop'] as const
export type SubscriptionDirection = (typeof SUBSCRIPTION_DIRECTIONS)[number]

export const SUBSCRIPTION_STATUSES = ['draft', 'active', 'suspended', 'ended'] as const
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number]

export const ATTENDANCE_LEGS = ['pickup', 'dropoff'] as const
export type AttendanceLeg = (typeof ATTENDANCE_LEGS)[number]

export const ATTENDANCE_STATUSES = ['boarded', 'alighted', 'absent_notified', 'absent_unnotified'] as const
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number]

@Entity({ tableName: 'subscription_plans' })
export class SubscriptionPlan {
  [OptionalProps]?: 'accountType' | 'duration' | 'currencyCode' | 'taxRate' | 'isActive' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ type: 'text' })
  name!: string

  @Property({ type: 'text', nullable: true })
  code?: string | null

  @Enum({ items: [...SUBSCRIPTION_ACCOUNT_TYPES], type: 'text', name: 'account_type', default: 'b2c' })
  accountType: SubscriptionAccountType = 'b2c'

  @Enum({ items: [...SUBSCRIPTION_DURATIONS], type: 'text', default: 'monthly' })
  duration: SubscriptionDuration = 'monthly'

  @Property({ name: 'price_two_way', type: 'numeric', precision: 18, scale: 4, default: '0' })
  priceTwoWay: string = '0'

  @Property({ name: 'price_one_way', type: 'numeric', precision: 18, scale: 4, default: '0' })
  priceOneWay: string = '0'

  @Property({ name: 'currency_code', type: 'text', default: 'SAR' })
  currencyCode: string = 'SAR'

  @Property({ name: 'tax_rate', type: 'numeric', precision: 5, scale: 2, default: '15' })
  taxRate: string = '15'

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

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

@Entity({ tableName: 'student_subscriptions' })
export class StudentSubscription {
  [OptionalProps]?: 'status' | 'direction' | 'accountType' | 'duration' | 'currencyCode' | 'taxRate' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'subscription_number', type: 'text' })
  subscriptionNumber!: string

  @Enum({ items: [...SUBSCRIPTION_STATUSES], type: 'text', default: 'draft' })
  status: SubscriptionStatus = 'draft'

  @Enum({ items: [...SUBSCRIPTION_ACCOUNT_TYPES], type: 'text', name: 'account_type', default: 'b2c' })
  accountType: SubscriptionAccountType = 'b2c'

  @Enum({ items: [...SUBSCRIPTION_DIRECTIONS], type: 'text', default: 'two_way' })
  direction: SubscriptionDirection = 'two_way'

  @Enum({ items: [...SUBSCRIPTION_DURATIONS], type: 'text', default: 'monthly' })
  duration: SubscriptionDuration = 'monthly'

  @ManyToOne(() => SubscriptionPlan, { fieldName: 'plan_id', nullable: true })
  plan?: SubscriptionPlan | null

  @Property({ name: 'plan_snapshot', type: 'jsonb', nullable: true })
  planSnapshot?: Record<string, unknown> | null

  // The paying party: the parent for B2C, the school for B2B.
  @Property({ name: 'customer_id', type: 'uuid' })
  customerId!: string

  @Property({ name: 'customer_snapshot', type: 'jsonb' })
  customerSnapshot!: Record<string, unknown>

  // The school, when it differs from the payer (B2C children are linked to their
  // school for reporting even though the parent pays).
  @Property({ name: 'school_customer_id', type: 'uuid', nullable: true })
  schoolCustomerId?: string | null

  @Property({ name: 'school_snapshot', type: 'jsonb', nullable: true })
  schoolSnapshot?: Record<string, unknown> | null

  @Property({ name: 'student_name', type: 'text' })
  studentName!: string

  @Property({ name: 'student_grade', type: 'text', nullable: true })
  studentGrade?: string | null

  @Property({ name: 'guardian_name', type: 'text', nullable: true })
  guardianName?: string | null

  @Property({ name: 'guardian_phone', type: 'text', nullable: true })
  guardianPhone?: string | null

  @Property({ name: 'pickup_point', type: 'text', nullable: true })
  pickupPoint?: string | null

  @Property({ name: 'dropoff_point', type: 'text', nullable: true })
  dropoffPoint?: string | null

  @Property({ name: 'transport_route_id', type: 'uuid', nullable: true })
  transportRouteId?: string | null

  @Property({ name: 'route_snapshot', type: 'jsonb', nullable: true })
  routeSnapshot?: Record<string, unknown> | null

  @Property({ name: 'vehicle_id', type: 'uuid', nullable: true })
  vehicleId?: string | null

  @Property({ name: 'vehicle_snapshot', type: 'jsonb', nullable: true })
  vehicleSnapshot?: Record<string, unknown> | null

  @Property({ name: 'driver_id', type: 'uuid', nullable: true })
  driverId?: string | null

  @Property({ name: 'driver_snapshot', type: 'jsonb', nullable: true })
  driverSnapshot?: Record<string, unknown> | null

  @Property({ name: 'start_date', type: 'date', nullable: true })
  startDate?: Date | null

  @Property({ name: 'end_date', type: 'date', nullable: true })
  endDate?: Date | null

  @Property({ name: 'period_price', type: 'numeric', precision: 18, scale: 4, default: '0' })
  periodPrice: string = '0'

  @Property({ name: 'currency_code', type: 'text', default: 'SAR' })
  currencyCode: string = 'SAR'

  @Property({ name: 'sales_order_id', type: 'uuid', nullable: true })
  salesOrderId?: string | null

  @Property({ name: 'sales_invoice_id', type: 'uuid', nullable: true })
  salesInvoiceId?: string | null

  @Property({ name: 'last_invoiced_period_from', type: 'date', nullable: true })
  lastInvoicedPeriodFrom?: Date | null

  @Property({ name: 'last_invoiced_period_to', type: 'date', nullable: true })
  lastInvoicedPeriodTo?: Date | null

  @Property({ name: 'tax_rate', type: 'numeric', precision: 5, scale: 2, default: '15' })
  taxRate: string = '15'

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

@Entity({ tableName: 'student_trip_attendance' })
export class StudentTripAttendance {
  [OptionalProps]?: 'status' | 'leg' | 'recordedAt' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @ManyToOne(() => StudentSubscription, { fieldName: 'subscription_id' })
  subscription!: StudentSubscription

  @Property({ name: 'trip_date', type: 'date' })
  tripDate!: Date

  @Enum({ items: [...ATTENDANCE_LEGS], type: 'text' })
  leg: AttendanceLeg = 'pickup'

  @Enum({ items: [...ATTENDANCE_STATUSES], type: 'text', default: 'absent_unnotified' })
  status: AttendanceStatus = 'absent_unnotified'

  @Property({ name: 'recorded_at', type: Date, onCreate: () => new Date() })
  recordedAt: Date = new Date()

  @Property({ name: 'recorded_by', type: 'uuid', nullable: true })
  recordedBy?: string | null

  // Who reported it: `staff` on the run, `parent` for a pre-trip absence.
  @Enum({ items: ['staff', 'parent'] as const, type: 'text', default: 'staff' })
  origin: 'staff' | 'parent' = 'staff'

  @Property({ name: 'vehicle_id', type: 'uuid', nullable: true })
  vehicleId?: string | null

  @Property({ name: 'driver_id', type: 'uuid', nullable: true })
  driverId?: string | null

  @Property({ type: 'text', nullable: true })
  notes?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date(), nullable: true })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'student_subscription_sequences' })
export class StudentSubscriptionSequence {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'current_value', type: 'integer', default: 0 })
  currentValue: number = 0

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date(), nullable: true })
  updatedAt: Date = new Date()
}
