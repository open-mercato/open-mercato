import { OptionalProps } from '@mikro-orm/core'
import { Entity, Enum, Index, PrimaryKey, Property } from '@mikro-orm/decorators/legacy'

export const FLEET_VEHICLE_STATUSES = ['active', 'assigned', 'maintenance', 'out_of_service'] as const
export type FleetVehicleStatus = (typeof FLEET_VEHICLE_STATUSES)[number]

export const FLEET_VEHICLE_DOCUMENT_TYPES = ['istimara', 'insurance', 'fahs', 'operating_card', 'other'] as const
export type FleetVehicleDocumentType = (typeof FLEET_VEHICLE_DOCUMENT_TYPES)[number]

export const FLEET_ASSIGNMENT_STATUSES = ['pending_approval', 'active', 'returned', 'rejected', 'cancelled'] as const
export type FleetAssignmentStatus = (typeof FLEET_ASSIGNMENT_STATUSES)[number]

@Entity({ tableName: 'fleet_vehicle_documents' })
@Index({ name: 'fleet_vehicle_documents_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'fleet_vehicle_documents_vehicle_idx', properties: ['organizationId', 'vehicleId'] })
@Index({ name: 'fleet_vehicle_documents_expiry_idx', properties: ['organizationId', 'expiryDate'] })
@Index({ name: 'fleet_vehicle_documents_type_idx', properties: ['organizationId', 'documentType'] })
export class FleetVehicleDocument {
  [OptionalProps]?: 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'vehicle_id', type: 'uuid' })
  vehicleId!: string

  @Enum({ items: [...FLEET_VEHICLE_DOCUMENT_TYPES], type: 'text', name: 'document_type' })
  documentType!: FleetVehicleDocumentType

  @Property({ name: 'document_number', type: 'text', nullable: true })
  documentNumber?: string | null

  @Property({ name: 'issue_date', type: 'date', nullable: true })
  issueDate?: Date | null

  @Property({ name: 'expiry_date', type: 'date', nullable: true })
  expiryDate?: Date | null

  @Property({ name: 'file_attachment_id', type: 'uuid', nullable: true })
  fileAttachmentId?: string | null

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

@Entity({ tableName: 'fleet_vehicle_assignments' })
@Index({ name: 'fleet_vehicle_assignments_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'fleet_vehicle_assignments_vehicle_idx', properties: ['organizationId', 'vehicleId'] })
@Index({ name: 'fleet_vehicle_assignments_employee_idx', properties: ['organizationId', 'employeeId'] })
@Index({ name: 'fleet_vehicle_assignments_status_idx', properties: ['organizationId', 'status'] })
@Index({ name: 'fleet_vehicle_assignments_approval_idx', properties: ['organizationId', 'approvalRequestId'] })
export class FleetVehicleAssignment {
  [OptionalProps]?: 'status' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'vehicle_id', type: 'uuid' })
  vehicleId!: string

  @Property({ name: 'employee_id', type: 'uuid' })
  employeeId!: string

  @Property({ name: 'approval_request_id', type: 'uuid', nullable: true })
  approvalRequestId?: string | null

  @Enum({ items: [...FLEET_ASSIGNMENT_STATUSES], type: 'text', name: 'status', default: 'pending_approval' })
  status: FleetAssignmentStatus = 'pending_approval'

  @Property({ name: 'assigned_at', type: Date, nullable: true })
  assignedAt?: Date | null

  @Property({ name: 'due_return_at', type: Date, nullable: true })
  dueReturnAt?: Date | null

  @Property({ name: 'returned_at', type: Date, nullable: true })
  returnedAt?: Date | null

  @Property({ name: 'handover_odometer', type: 'integer', nullable: true })
  handoverOdometer?: number | null

  @Property({ name: 'return_odometer', type: 'integer', nullable: true })
  returnOdometer?: number | null

  @Property({ name: 'custody_notes', type: 'text', nullable: true })
  custodyNotes?: string | null

  @Property({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'fleet_vehicle_odometer_logs' })
@Index({ name: 'fleet_odometer_logs_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'fleet_odometer_logs_vehicle_idx', properties: ['organizationId', 'vehicleId', 'recordedAt'] })
export class FleetVehicleOdometerLog {
  [OptionalProps]?: 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'vehicle_id', type: 'uuid' })
  vehicleId!: string

  @Property({ type: 'integer' })
  reading!: number

  @Property({ name: 'recorded_at', type: Date, onCreate: () => new Date() })
  recordedAt: Date = new Date()

  @Property({ type: 'text', nullable: true })
  source?: string | null

  @Property({ name: 'assignment_id', type: 'uuid', nullable: true })
  assignmentId?: string | null

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
