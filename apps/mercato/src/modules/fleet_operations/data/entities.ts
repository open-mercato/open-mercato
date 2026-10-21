import { OptionalProps } from '@mikro-orm/core'
import { Entity, Index, PrimaryKey, Property } from '@mikro-orm/decorators/legacy'

export const WORK_ORDER_STATUSES = ['draft', 'open', 'in_progress', 'completed', 'cancelled'] as const
export type WorkOrderStatus = (typeof WORK_ORDER_STATUSES)[number]

export const WORK_ORDER_TYPES = ['preventive', 'corrective', 'inspection', 'other'] as const
export type WorkOrderType = (typeof WORK_ORDER_TYPES)[number]

export const WORK_ORDER_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const
export type WorkOrderPriority = (typeof WORK_ORDER_PRIORITIES)[number]

export const MAINTENANCE_INTERVAL_TYPES = ['odometer', 'date', 'both'] as const
export type MaintenanceIntervalType = (typeof MAINTENANCE_INTERVAL_TYPES)[number]

export const FUEL_TYPES = ['diesel', 'petrol_91', 'petrol_95', 'other'] as const
export type FuelType = (typeof FUEL_TYPES)[number]

export const INSURANCE_COVERAGE_TYPES = ['comprehensive', 'third_party', 'other'] as const
export type InsuranceCoverageType = (typeof INSURANCE_COVERAGE_TYPES)[number]

export const INSURANCE_POLICY_STATUSES = ['active', 'expired', 'cancelled'] as const
export type InsurancePolicyStatus = (typeof INSURANCE_POLICY_STATUSES)[number]

export const VIOLATION_STATUSES = ['open', 'paid', 'appealed', 'cancelled'] as const
export type ViolationStatus = (typeof VIOLATION_STATUSES)[number]

@Entity({ tableName: 'fleet_maintenance_schedules' })
@Index({ name: 'fleet_maintenance_schedules_scope_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'fleet_maintenance_schedules_vehicle_idx', properties: ['organizationId', 'vehicleId'] })
@Index({ name: 'fleet_maintenance_schedules_due_idx', properties: ['organizationId', 'isActive', 'nextDueAt'] })
export class FleetMaintenanceSchedule {
  [OptionalProps]?: 'isActive' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'vehicle_id', type: 'uuid' })
  vehicleId!: string

  @Property({ type: 'text' })
  name!: string

  @Property({ type: 'text', nullable: true })
  description?: string | null

  @Property({ name: 'interval_type', type: 'text', default: 'odometer' })
  intervalType: MaintenanceIntervalType = 'odometer'

  @Property({ name: 'interval_odometer', type: 'integer', nullable: true })
  intervalOdometer?: number | null

  @Property({ name: 'interval_days', type: 'integer', nullable: true })
  intervalDays?: number | null

  @Property({ name: 'last_service_odometer', type: 'integer', nullable: true })
  lastServiceOdometer?: number | null

  @Property({ name: 'last_service_at', type: Date, nullable: true })
  lastServiceAt?: Date | null

  @Property({ name: 'next_due_odometer', type: 'integer', nullable: true })
  nextDueOdometer?: number | null

  @Property({ name: 'next_due_at', type: Date, nullable: true })
  nextDueAt?: Date | null

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

  @Property({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'fleet_work_orders' })
@Index({ name: 'fleet_work_orders_scope_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'fleet_work_orders_vehicle_idx', properties: ['organizationId', 'vehicleId'] })
@Index({ name: 'fleet_work_orders_status_idx', properties: ['organizationId', 'status', 'openedAt'] })
@Index({
  name: 'fleet_work_orders_number_unique_idx',
  expression:
    'create unique index "fleet_work_orders_number_unique_idx" on "fleet_work_orders" ("organization_id", "tenant_id", "work_order_number") where deleted_at is null',
})
export class FleetWorkOrder {
  [OptionalProps]?: 'status' | 'priority' | 'type' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'vehicle_id', type: 'uuid' })
  vehicleId!: string

  @Property({ name: 'schedule_id', type: 'uuid', nullable: true })
  scheduleId?: string | null

  @Property({ name: 'work_order_number', type: 'text' })
  workOrderNumber!: string

  @Property({ type: 'text' })
  title!: string

  @Property({ type: 'text', nullable: true })
  description?: string | null

  @Property({ type: 'text', default: 'draft' })
  status: WorkOrderStatus = 'draft'

  @Property({ type: 'text', default: 'normal' })
  priority: WorkOrderPriority = 'normal'

  @Property({ type: 'text', default: 'corrective' })
  type: WorkOrderType = 'corrective'

  @Property({ name: 'odometer', type: 'integer', nullable: true })
  odometer?: number | null

  @Property({ name: 'vendor_name', type: 'text', nullable: true })
  vendorName?: string | null

  @Property({ name: 'opened_at', type: Date, nullable: true })
  openedAt?: Date | null

  @Property({ name: 'started_at', type: Date, nullable: true })
  startedAt?: Date | null

  @Property({ name: 'completed_at', type: Date, nullable: true })
  completedAt?: Date | null

  @Property({ name: 'downtime_minutes', type: 'integer', nullable: true })
  downtimeMinutes?: number | null

  @Property({ name: 'labor_cost', type: 'numeric', precision: 18, scale: 4, default: '0' })
  laborCost: string = '0'

  @Property({ name: 'parts_cost', type: 'numeric', precision: 18, scale: 4, default: '0' })
  partsCost: string = '0'

  @Property({ name: 'total_cost', type: 'numeric', precision: 18, scale: 4, default: '0' })
  totalCost: string = '0'

  @Property({ name: 'currency_code', type: 'text', default: 'SAR' })
  currencyCode: string = 'SAR'

  @Property({ type: 'text', nullable: true })
  notes?: string | null

  @Property({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'fleet_work_order_parts' })
@Index({ name: 'fleet_work_order_parts_scope_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'fleet_work_order_parts_order_idx', properties: ['organizationId', 'workOrderId'] })
export class FleetWorkOrderPart {
  [OptionalProps]?: 'quantity' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'work_order_id', type: 'uuid' })
  workOrderId!: string

  @Property({ type: 'text' })
  description!: string

  @Property({ name: 'part_number', type: 'text', nullable: true })
  partNumber?: string | null

  @Property({ type: 'numeric', precision: 18, scale: 4, default: '1' })
  quantity: string = '1'

  @Property({ name: 'unit_cost', type: 'numeric', precision: 18, scale: 4, default: '0' })
  unitCost: string = '0'

  @Property({ name: 'total_cost', type: 'numeric', precision: 18, scale: 4, default: '0' })
  totalCost: string = '0'

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'fleet_work_order_labor' })
@Index({ name: 'fleet_work_order_labor_scope_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'fleet_work_order_labor_order_idx', properties: ['organizationId', 'workOrderId'] })
export class FleetWorkOrderLabor {
  [OptionalProps]?: 'hours' | 'rate' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'work_order_id', type: 'uuid' })
  workOrderId!: string

  @Property({ type: 'text' })
  description!: string

  @Property({ type: 'numeric', precision: 10, scale: 2, default: '0' })
  hours: string = '0'

  @Property({ type: 'numeric', precision: 18, scale: 4, default: '0' })
  rate: string = '0'

  @Property({ name: 'total_cost', type: 'numeric', precision: 18, scale: 4, default: '0' })
  totalCost: string = '0'

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'fleet_fuel_logs' })
@Index({ name: 'fleet_fuel_logs_scope_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'fleet_fuel_logs_vehicle_idx', properties: ['organizationId', 'vehicleId', 'loggedAt'] })
export class FleetFuelLog {
  [OptionalProps]?: 'fullTank' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'vehicle_id', type: 'uuid' })
  vehicleId!: string

  @Property({ name: 'logged_at', type: Date })
  loggedAt!: Date

  @Property({ name: 'odometer', type: 'integer', nullable: true })
  odometer?: number | null

  @Property({ type: 'numeric', precision: 12, scale: 3, default: '0' })
  liters: string = '0'

  @Property({ name: 'unit_price', type: 'numeric', precision: 12, scale: 4, default: '0' })
  unitPrice: string = '0'

  @Property({ name: 'total_cost', type: 'numeric', precision: 18, scale: 4, default: '0' })
  totalCost: string = '0'

  @Property({ name: 'fuel_type', type: 'text', default: 'diesel' })
  fuelType: FuelType = 'diesel'

  @Property({ name: 'station_name', type: 'text', nullable: true })
  stationName?: string | null

  @Property({ name: 'full_tank', type: 'boolean', default: true })
  fullTank: boolean = true

  @Property({ name: 'driver_employee_id', type: 'uuid', nullable: true })
  driverEmployeeId?: string | null

  @Property({ type: 'text', nullable: true })
  notes?: string | null

  @Property({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'fleet_insurance_policies' })
@Index({ name: 'fleet_insurance_policies_scope_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'fleet_insurance_policies_vehicle_idx', properties: ['organizationId', 'vehicleId'] })
@Index({ name: 'fleet_insurance_policies_expiry_idx', properties: ['organizationId', 'endDate', 'status'] })
export class FleetInsurancePolicy {
  [OptionalProps]?: 'status' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'vehicle_id', type: 'uuid' })
  vehicleId!: string

  @Property({ name: 'policy_number', type: 'text' })
  policyNumber!: string

  @Property({ name: 'insurer_name', type: 'text' })
  insurerName!: string

  @Property({ name: 'coverage_type', type: 'text', default: 'comprehensive' })
  coverageType: InsuranceCoverageType = 'comprehensive'

  @Property({ name: 'start_date', type: Date })
  startDate!: Date

  @Property({ name: 'end_date', type: Date })
  endDate!: Date

  @Property({ name: 'premium_amount', type: 'numeric', precision: 18, scale: 4, default: '0' })
  premiumAmount: string = '0'

  @Property({ name: 'currency_code', type: 'text', default: 'SAR' })
  currencyCode: string = 'SAR'

  @Property({ type: 'text', default: 'active' })
  status: InsurancePolicyStatus = 'active'

  @Property({ type: 'text', nullable: true })
  notes?: string | null

  @Property({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'fleet_traffic_violations' })
@Index({ name: 'fleet_traffic_violations_scope_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'fleet_traffic_violations_vehicle_idx', properties: ['organizationId', 'vehicleId', 'occurredAt'] })
@Index({ name: 'fleet_traffic_violations_status_idx', properties: ['organizationId', 'status', 'occurredAt'] })
export class FleetTrafficViolation {
  [OptionalProps]?: 'status' | 'payrollDeductionRequested' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'vehicle_id', type: 'uuid' })
  vehicleId!: string

  @Property({ name: 'driver_employee_id', type: 'uuid', nullable: true })
  driverEmployeeId?: string | null

  @Property({ name: 'violation_number', type: 'text' })
  violationNumber!: string

  @Property({ name: 'occurred_at', type: Date })
  occurredAt!: Date

  @Property({ type: 'text', nullable: true })
  location?: string | null

  @Property({ type: 'text', nullable: true })
  description?: string | null

  @Property({ name: 'fine_amount', type: 'numeric', precision: 18, scale: 4, default: '0' })
  fineAmount: string = '0'

  @Property({ name: 'currency_code', type: 'text', default: 'SAR' })
  currencyCode: string = 'SAR'

  @Property({ type: 'text', default: 'open' })
  status: ViolationStatus = 'open'

  @Property({ name: 'paid_at', type: Date, nullable: true })
  paidAt?: Date | null

  @Property({ name: 'payroll_deduction_requested', type: 'boolean', default: false })
  payrollDeductionRequested: boolean = false

  @Property({ type: 'text', nullable: true })
  notes?: string | null

  @Property({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}
