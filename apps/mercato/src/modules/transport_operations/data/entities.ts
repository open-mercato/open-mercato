import { OptionalProps } from '@mikro-orm/core'
import { Entity, Enum, Index, PrimaryKey, Property } from '@mikro-orm/decorators/legacy'

export const VEHICLE_STATUSES = ['active', 'maintenance', 'out_of_service'] as const
export type VehicleStatus = (typeof VEHICLE_STATUSES)[number]

export const DRIVER_STATUSES = ['available', 'on_trip', 'on_leave', 'suspended'] as const
export type DriverStatus = (typeof DRIVER_STATUSES)[number]

export const TRIP_SCHEDULE_STATUSES = ['scheduled', 'in_progress', 'completed', 'cancelled'] as const
export type TripScheduleStatus = (typeof TRIP_SCHEDULE_STATUSES)[number]

@Entity({ tableName: 'transport_vehicles' })
@Index({ name: 'transport_vehicles_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'transport_vehicles_status_idx', properties: ['organizationId', 'status'] })
// The `expression` form, not `options: { unique: true, where }`: the latter
// compiles to a **plain** index under this MikroORM version, so the constraint
// the name promises was not there and duplicate plates were accepted. A unique
// index with a partial predicate has to be written as SQL.
@Index({
  name: 'transport_vehicles_plate_unique_idx',
  expression:
    'create unique index "transport_vehicles_plate_unique_idx" on "transport_vehicles" ("organization_id", "tenant_id", "plate_number") where deleted_at is null',
})
@Index({
  name: 'transport_vehicles_vin_unique_idx',
  expression:
    'create unique index "transport_vehicles_vin_unique_idx" on "transport_vehicles" ("organization_id", "tenant_id", "vin") where deleted_at is null',
})
export class TransportVehicle {
  [OptionalProps]?: 'status' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'plate_number', type: 'text' })
  plateNumber!: string

  @Property({ type: 'text' })
  vin!: string

  @Property({ type: 'text' })
  make!: string

  @Property({ type: 'text' })
  model!: string

  @Property({ type: 'integer' })
  year!: number

  @Property({ type: 'integer' })
  capacity!: number

  @Enum({ items: [...VEHICLE_STATUSES], type: 'text', name: 'status', default: 'active' })
  status: VehicleStatus = 'active'

  @Property({ name: 'telematics_device_id', type: 'text', nullable: true })
  telematicsDeviceId?: string | null

  @Property({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'transport_drivers' })
@Index({ name: 'transport_drivers_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'transport_drivers_status_idx', properties: ['organizationId', 'status'] })
@Index({ name: 'transport_drivers_national_id_unique_idx', properties: ['organizationId', 'tenantId', 'nationalId'], options: { unique: true, where: 'deleted_at IS NULL' } })
@Index({ name: 'transport_drivers_license_unique_idx', properties: ['organizationId', 'tenantId', 'licenseNumber'], options: { unique: true, where: 'deleted_at IS NULL' } })
export class TransportDriver {
  [OptionalProps]?: 'status' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'employee_id', type: 'uuid', nullable: true })
  employeeId?: string | null

  @Property({ name: 'full_name', type: 'text' })
  fullName!: string

  @Property({ name: 'national_id', type: 'text' })
  nationalId!: string

  @Property({ name: 'license_number', type: 'text' })
  licenseNumber!: string

  @Property({ name: 'license_expiry', type: 'date' })
  licenseExpiry!: Date

  @Property({ type: 'text' })
  phone!: string

  @Enum({ items: [...DRIVER_STATUSES], type: 'text', name: 'status', default: 'available' })
  status: DriverStatus = 'available'

  @Property({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'transport_routes' })
@Index({ name: 'transport_routes_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'transport_routes_code_unique_idx', properties: ['organizationId', 'tenantId', 'code'], options: { unique: true, where: 'deleted_at IS NULL' } })
export class TransportRoute {
  [OptionalProps]?: 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ type: 'text' })
  code!: string

  @Property({ type: 'text' })
  name!: string

  @Property({ name: 'start_location', type: 'text' })
  startLocation!: string

  @Property({ name: 'end_location', type: 'text' })
  endLocation!: string

  @Property({ name: 'estimated_duration_minutes', type: 'integer' })
  estimatedDurationMinutes!: number

  @Property({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'transport_trip_schedules' })
@Index({ name: 'transport_trip_schedules_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'transport_trip_schedules_status_idx', properties: ['organizationId', 'status'] })
@Index({ name: 'transport_trip_schedules_route_idx', properties: ['organizationId', 'routeId'] })
@Index({ name: 'transport_trip_schedules_vehicle_idx', properties: ['organizationId', 'vehicleId'] })
@Index({ name: 'transport_trip_schedules_driver_idx', properties: ['organizationId', 'driverId'] })
@Index({ name: 'transport_trip_schedules_start_idx', properties: ['organizationId', 'scheduledStartTime'] })
export class TransportTripSchedule {
  [OptionalProps]?: 'status' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'route_id', type: 'uuid' })
  routeId!: string

  @Property({ name: 'vehicle_id', type: 'uuid' })
  vehicleId!: string

  @Property({ name: 'driver_id', type: 'uuid' })
  driverId!: string

  @Property({ name: 'scheduled_start_time', type: Date })
  scheduledStartTime!: Date

  @Property({ name: 'scheduled_end_time', type: Date })
  scheduledEndTime!: Date

  @Property({ name: 'actual_start_time', type: Date, nullable: true })
  actualStartTime?: Date | null

  @Property({ name: 'actual_end_time', type: Date, nullable: true })
  actualEndTime?: Date | null

  @Enum({ items: [...TRIP_SCHEDULE_STATUSES], type: 'text', name: 'status', default: 'scheduled' })
  status: TripScheduleStatus = 'scheduled'

  @Property({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}
