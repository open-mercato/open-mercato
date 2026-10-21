import { OptionalProps } from '@mikro-orm/core'
import { Entity, Enum, Index, PrimaryKey, Property } from '@mikro-orm/decorators/legacy'

export const IDENTITY_TYPES = ['national_id', 'iqama'] as const
export type IdentityType = (typeof IDENTITY_TYPES)[number]

export const EMPLOYMENT_TYPES = ['full_time', 'part_time', 'contract', 'temporary'] as const
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number]

export const EMPLOYEE_STATUSES = ['active', 'on_leave', 'suspended', 'terminated'] as const
export type EmployeeStatus = (typeof EMPLOYEE_STATUSES)[number]

export const ATTENDANCE_STATUSES = ['present', 'absent', 'late', 'on_leave', 'holiday'] as const
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number]

export const LEAVE_TYPES = ['annual', 'sick', 'unpaid', 'emergency', 'maternity', 'other'] as const
export type LeaveType = (typeof LEAVE_TYPES)[number]

export const LEAVE_REQUEST_STATUSES = ['pending', 'approved', 'rejected', 'cancelled'] as const
export type LeaveRequestStatus = (typeof LEAVE_REQUEST_STATUSES)[number]

export const LEAVE_ACCRUAL_SOURCES = ['monthly', 'manual'] as const
export type LeaveAccrualSource = (typeof LEAVE_ACCRUAL_SOURCES)[number]

export const EMPLOYEE_DOCUMENT_TYPES = [
  'national_id',
  'iqama',
  'passport',
  'driving_license',
  'medical_certificate',
  'contract',
  'certificate',
  'other',
] as const
export type EmployeeDocumentType = (typeof EMPLOYEE_DOCUMENT_TYPES)[number]

export const APPROVAL_APPROVER_TYPES = ['role', 'user', 'manager'] as const
export type ApprovalApproverType = (typeof APPROVAL_APPROVER_TYPES)[number]

export const APPROVAL_REQUEST_STATUSES = ['pending', 'approved', 'rejected', 'cancelled'] as const
export type ApprovalRequestStatus = (typeof APPROVAL_REQUEST_STATUSES)[number]

export const APPROVAL_ACTIONS = ['approved', 'rejected', 'commented', 'reassigned', 'cancelled'] as const
export type ApprovalAction = (typeof APPROVAL_ACTIONS)[number]

@Entity({ tableName: 'hr_departments' })
@Index({ name: 'hr_departments_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'hr_departments_code_unique_idx', properties: ['organizationId', 'tenantId', 'code'], options: { unique: true, where: 'deleted_at IS NULL AND code IS NOT NULL' } })
export class HrDepartment {
  [OptionalProps]?: 'isActive' | 'createdAt' | 'updatedAt' | 'deletedAt'

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

  @Property({ type: 'text', nullable: true })
  description?: string | null

  @Property({ name: 'parent_department_id', type: 'uuid', nullable: true })
  parentDepartmentId?: string | null

  @Property({ name: 'manager_employee_id', type: 'uuid', nullable: true })
  managerEmployeeId?: string | null

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

@Entity({ tableName: 'hr_employees' })
@Index({ name: 'hr_employees_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'hr_employees_status_idx', properties: ['organizationId', 'status'] })
@Index({ name: 'hr_employees_department_idx', properties: ['organizationId', 'departmentId'] })
@Index({ name: 'hr_employees_manager_idx', properties: ['organizationId', 'managerEmployeeId'] })
@Index({ name: 'hr_employees_number_unique_idx', properties: ['organizationId', 'tenantId', 'employeeNumber'], options: { unique: true, where: 'deleted_at IS NULL' } })
@Index({ name: 'hr_employees_national_id_unique_idx', properties: ['organizationId', 'tenantId', 'nationalId'], options: { unique: true, where: 'deleted_at IS NULL' } })
export class HrEmployee {
  [OptionalProps]?: 'identityType' | 'employmentType' | 'status' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'employee_number', type: 'text' })
  employeeNumber!: string

  @Property({ name: 'first_name', type: 'text' })
  firstName!: string

  @Property({ name: 'last_name', type: 'text' })
  lastName!: string

  @Enum({ items: [...IDENTITY_TYPES], type: 'text', name: 'identity_type', default: 'national_id' })
  identityType: IdentityType = 'national_id'

  @Property({ name: 'national_id', type: 'text' })
  nationalId!: string

  @Property({ name: 'national_id_expiry', type: 'date', nullable: true })
  nationalIdExpiry?: Date | null

  @Property({ name: 'department_id', type: 'uuid', nullable: true })
  departmentId?: string | null

  @Property({ name: 'manager_employee_id', type: 'uuid', nullable: true })
  managerEmployeeId?: string | null

  @Property({ name: 'job_title', type: 'text' })
  jobTitle!: string

  @Enum({ items: [...EMPLOYMENT_TYPES], type: 'text', name: 'employment_type', default: 'full_time' })
  employmentType: EmploymentType = 'full_time'

  @Enum({ items: [...EMPLOYEE_STATUSES], type: 'text', name: 'status', default: 'active' })
  status: EmployeeStatus = 'active'

  @Property({ name: 'hire_date', type: 'date' })
  hireDate!: Date

  @Property({ name: 'termination_date', type: 'date', nullable: true })
  terminationDate?: Date | null

  @Property({ type: 'text', nullable: true })
  email?: string | null

  @Property({ type: 'text', nullable: true })
  phone?: string | null

  @Property({ name: 'bank_iban', type: 'text', nullable: true })
  bankIban?: string | null

  @Property({ name: 'user_id', type: 'uuid', nullable: true })
  userId?: string | null

  @Property({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'hr_driver_profiles' })
@Index({ name: 'hr_driver_profiles_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'hr_driver_profiles_employee_unique_idx', properties: ['organizationId', 'tenantId', 'employeeId'], options: { unique: true, where: 'deleted_at IS NULL' } })
@Index({ name: 'hr_driver_profiles_license_expiry_idx', properties: ['organizationId', 'licenseExpiry'] })
export class HrDriverProfile {
  [OptionalProps]?: 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'employee_id', type: 'uuid' })
  employeeId!: string

  @Property({ name: 'license_number', type: 'text' })
  licenseNumber!: string

  @Property({ name: 'license_type', type: 'text', nullable: true })
  licenseType?: string | null

  @Property({ name: 'license_expiry', type: 'date' })
  licenseExpiry!: Date

  @Property({ name: 'medical_check_expiry', type: 'date', nullable: true })
  medicalCheckExpiry?: Date | null

  @Property({ name: 'years_of_experience', type: 'integer', nullable: true })
  yearsOfExperience?: number | null

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

@Entity({ tableName: 'hr_attendance_records' })
@Index({ name: 'hr_attendance_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'hr_attendance_employee_date_unique_idx', properties: ['organizationId', 'tenantId', 'employeeId', 'date'], options: { unique: true, where: 'deleted_at IS NULL' } })
export class HrAttendanceRecord {
  [OptionalProps]?: 'status' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'employee_id', type: 'uuid' })
  employeeId!: string

  @Property({ type: 'date' })
  date!: Date

  @Property({ name: 'check_in_at', type: Date, nullable: true })
  checkInAt?: Date | null

  @Property({ name: 'check_out_at', type: Date, nullable: true })
  checkOutAt?: Date | null

  @Enum({ items: [...ATTENDANCE_STATUSES], type: 'text', name: 'status', default: 'present' })
  status: AttendanceStatus = 'present'

  @Property({ name: 'worked_minutes', type: 'integer', nullable: true })
  workedMinutes?: number | null

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

@Entity({ tableName: 'hr_leave_requests' })
@Index({ name: 'hr_leave_requests_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'hr_leave_requests_employee_idx', properties: ['organizationId', 'employeeId'] })
@Index({ name: 'hr_leave_requests_status_idx', properties: ['organizationId', 'status'] })
export class HrLeaveRequest {
  [OptionalProps]?: 'status' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'employee_id', type: 'uuid' })
  employeeId!: string

  @Enum({ items: [...LEAVE_TYPES], type: 'text', name: 'leave_type' })
  leaveType!: LeaveType

  @Property({ name: 'start_date', type: 'date' })
  startDate!: Date

  @Property({ name: 'end_date', type: 'date' })
  endDate!: Date

  @Property({ name: 'total_days', type: 'integer' })
  totalDays!: number

  @Property({ type: 'text', nullable: true })
  reason?: string | null

  @Enum({ items: [...LEAVE_REQUEST_STATUSES], type: 'text', name: 'status', default: 'pending' })
  status: LeaveRequestStatus = 'pending'

  @Property({ name: 'approval_request_id', type: 'uuid', nullable: true })
  approvalRequestId?: string | null

  @Property({ name: 'decided_by_user_id', type: 'uuid', nullable: true })
  decidedByUserId?: string | null

  @Property({ name: 'decided_at', type: Date, nullable: true })
  decidedAt?: Date | null

  @Property({ name: 'decision_comment', type: 'text', nullable: true })
  decisionComment?: string | null

  @Property({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'hr_leave_entitlements' })
@Index({ name: 'hr_leave_entitlements_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'hr_leave_entitlements_employee_idx', properties: ['organizationId', 'employeeId', 'leaveType', 'periodStart'] })
@Index({
  name: 'hr_leave_entitlements_unique_idx',
  expression: 'create unique index "hr_leave_entitlements_unique_idx" on "hr_leave_entitlements" ("organization_id", "tenant_id", "employee_id", "leave_type", "period_start") where deleted_at is null',
})
export class HrLeaveEntitlement {
  [OptionalProps]?: 'entitledDays' | 'carryOverDays' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'employee_id', type: 'uuid' })
  employeeId!: string

  @Enum({ items: [...LEAVE_TYPES], type: 'text', name: 'leave_type' })
  leaveType!: LeaveType

  @Property({ name: 'period_start', type: 'date' })
  periodStart!: Date

  @Property({ name: 'period_end', type: 'date' })
  periodEnd!: Date

  @Property({ name: 'entitled_days', type: 'numeric', precision: 8, scale: 2, default: '0' })
  entitledDays: string = '0'

  @Property({ name: 'carry_over_days', type: 'numeric', precision: 8, scale: 2, default: '0' })
  carryOverDays: string = '0'

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

@Entity({ tableName: 'hr_leave_accruals' })
@Index({ name: 'hr_leave_accruals_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'hr_leave_accruals_employee_idx', properties: ['organizationId', 'employeeId', 'leaveType', 'accrualMonth'] })
@Index({
  name: 'hr_leave_accruals_unique_idx',
  expression: 'create unique index "hr_leave_accruals_unique_idx" on "hr_leave_accruals" ("organization_id", "tenant_id", "employee_id", "leave_type", "accrual_month")',
})
export class HrLeaveAccrual {
  [OptionalProps]?: 'days' | 'source' | 'createdAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'employee_id', type: 'uuid' })
  employeeId!: string

  @Enum({ items: [...LEAVE_TYPES], type: 'text', name: 'leave_type' })
  leaveType!: LeaveType

  @Property({ name: 'accrual_month', type: 'date' })
  accrualMonth!: Date

  @Property({ type: 'numeric', precision: 8, scale: 2, default: '0' })
  days: string = '0'

  @Property({ name: 'entitlement_id', type: 'uuid', nullable: true })
  entitlementId?: string | null

  @Enum({ items: [...LEAVE_ACCRUAL_SOURCES], type: 'text', default: 'monthly' })
  source: LeaveAccrualSource = 'monthly'

  @Property({ type: 'text', nullable: true })
  note?: string | null

  @Property({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()
}

@Entity({ tableName: 'hr_employee_documents' })
@Index({ name: 'hr_employee_documents_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'hr_employee_documents_employee_idx', properties: ['organizationId', 'employeeId'] })
@Index({ name: 'hr_employee_documents_expiry_idx', properties: ['organizationId', 'expiryDate'] })
@Index({ name: 'hr_employee_documents_type_idx', properties: ['organizationId', 'documentType'] })
export class HrEmployeeDocument {
  [OptionalProps]?: 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'employee_id', type: 'uuid' })
  employeeId!: string

  @Enum({ items: [...EMPLOYEE_DOCUMENT_TYPES], type: 'text', name: 'document_type' })
  documentType!: EmployeeDocumentType

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

@Entity({ tableName: 'hr_approval_workflows' })
@Index({ name: 'hr_approval_workflows_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'hr_approval_workflows_entity_type_idx', properties: ['organizationId', 'entityType'] })
@Index({ name: 'hr_approval_workflows_code_unique_idx', properties: ['organizationId', 'tenantId', 'code'], options: { unique: true, where: 'deleted_at IS NULL' } })
export class HrApprovalWorkflow {
  [OptionalProps]?: 'isActive' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ type: 'text' })
  name!: string

  @Property({ type: 'text' })
  code!: string

  @Property({ name: 'entity_type', type: 'text' })
  entityType!: string

  @Property({ type: 'text', nullable: true })
  description?: string | null

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

@Entity({ tableName: 'hr_approval_step_definitions' })
@Index({ name: 'hr_approval_steps_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'hr_approval_steps_workflow_order_idx', properties: ['organizationId', 'workflowId', 'stepOrder'] })
export class HrApprovalStepDefinition {
  [OptionalProps]?: 'requiredApprovals' | 'isFinal' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'workflow_id', type: 'uuid' })
  workflowId!: string

  @Property({ name: 'step_order', type: 'integer' })
  stepOrder!: number

  @Property({ type: 'text' })
  name!: string

  @Enum({ items: [...APPROVAL_APPROVER_TYPES], type: 'text', name: 'approver_type' })
  approverType!: ApprovalApproverType

  @Property({ name: 'approver_role_id', type: 'uuid', nullable: true })
  approverRoleId?: string | null

  @Property({ name: 'approver_user_id', type: 'uuid', nullable: true })
  approverUserId?: string | null

  @Property({ name: 'required_approvals', type: 'integer', default: 1 })
  requiredApprovals: number = 1

  @Property({ name: 'is_final', type: 'boolean', default: false })
  isFinal: boolean = false

  @Property({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'hr_approval_requests' })
@Index({ name: 'hr_approval_requests_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'hr_approval_requests_status_idx', properties: ['organizationId', 'status'] })
@Index({ name: 'hr_approval_requests_workflow_idx', properties: ['organizationId', 'workflowId'] })
@Index({ name: 'hr_approval_requests_entity_idx', properties: ['organizationId', 'entityType', 'entityId'] })
export class HrApprovalRequest {
  [OptionalProps]?: 'status' | 'currentStepOrder' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'workflow_id', type: 'uuid' })
  workflowId!: string

  @Property({ name: 'entity_type', type: 'text' })
  entityType!: string

  @Property({ name: 'entity_id', type: 'uuid' })
  entityId!: string

  @Enum({ items: [...APPROVAL_REQUEST_STATUSES], type: 'text', name: 'status', default: 'pending' })
  status: ApprovalRequestStatus = 'pending'

  @Property({ name: 'current_step_order', type: 'integer', default: 1 })
  currentStepOrder: number = 1

  @Property({ name: 'requested_by_user_id', type: 'uuid', nullable: true })
  requestedByUserId?: string | null

  @Property({ name: 'decided_at', type: Date, nullable: true })
  decidedAt?: Date | null

  @Property({ type: 'text', nullable: true })
  summary?: string | null

  @Property({ type: 'jsonb', nullable: true })
  payload?: Record<string, unknown> | null

  @Property({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'hr_approval_action_logs' })
@Index({ name: 'hr_approval_action_logs_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'hr_approval_action_logs_request_idx', properties: ['organizationId', 'approvalRequestId', 'createdAt'] })
export class HrApprovalActionLog {
  [OptionalProps]?: 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'approval_request_id', type: 'uuid' })
  approvalRequestId!: string

  @Property({ name: 'step_order', type: 'integer' })
  stepOrder!: number

  @Enum({ items: [...APPROVAL_ACTIONS], type: 'text', name: 'action' })
  action!: ApprovalAction

  @Property({ name: 'actor_user_id', type: 'uuid', nullable: true })
  actorUserId?: string | null

  @Property({ type: 'text', nullable: true })
  comment?: string | null

  @Property({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

export const PAYROLL_RUN_STATUSES = ['draft', 'calculated', 'submitted', 'approved', 'paid', 'closed'] as const
export type PayrollRunStatus = (typeof PAYROLL_RUN_STATUSES)[number]
export const PAYSLIP_STATUSES = ['draft', 'approved', 'paid'] as const
export const PAYSLIP_LINE_KINDS = ['earning', 'deduction'] as const
export const PAYSLIP_LINE_CODES = [
  'basic', 'allowance', 'overtime', 'incentive', 'loan_instalment', 'penalty', 'unpaid_leave', 'absence', 'manual',
] as const
export const LOAN_STATUSES = ['pending', 'approved', 'rejected', 'cancelled', 'settling', 'settled'] as const
export const LOAN_INSTALMENT_STATUSES = ['scheduled', 'deducted', 'skipped', 'written_off'] as const
export const PENALTY_TYPES = ['deduction', 'written_warning', 'suspension_days'] as const
export const INCENTIVE_TYPES = ['bonus', 'commission', 'allowance', 'overtime_pay'] as const

@Entity({ tableName: 'hr_employee_compensations' })
@Index({ name: 'hr_employee_compensations_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'hr_employee_compensations_employee_idx', properties: ['organizationId', 'employeeId', 'effectiveFrom'] })
export class HrEmployeeCompensation {
  [OptionalProps]?: 'housingAllowance' | 'transportAllowance' | 'otherAllowance' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'employee_id', type: 'uuid' })
  employeeId!: string

  @Property({ name: 'effective_from', type: 'date' })
  effectiveFrom!: Date

  @Property({ name: 'basic_salary', type: 'numeric', precision: 18, scale: 4, default: '0' })
  basicSalary: string = '0'

  @Property({ name: 'housing_allowance', type: 'numeric', precision: 18, scale: 4, default: '0' })
  housingAllowance: string = '0'

  @Property({ name: 'transport_allowance', type: 'numeric', precision: 18, scale: 4, default: '0' })
  transportAllowance: string = '0'

  @Property({ name: 'other_allowance', type: 'numeric', precision: 18, scale: 4, default: '0' })
  otherAllowance: string = '0'

  @Property({ name: 'currency_code', type: 'text' })
  currencyCode!: string

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

@Entity({ tableName: 'hr_employee_loans' })
@Index({ name: 'hr_employee_loans_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'hr_employee_loans_employee_idx', properties: ['organizationId', 'employeeId', 'status'] })
export class HrEmployeeLoan {
  [OptionalProps]?: 'status' | 'outstandingAmount' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'employee_id', type: 'uuid' })
  employeeId!: string

  @Property({ name: 'principal_amount', type: 'numeric', precision: 18, scale: 4, default: '0' })
  principalAmount: string = '0'

  @Property({ name: 'currency_code', type: 'text' })
  currencyCode!: string

  @Property({ name: 'instalment_count', type: 'integer', default: 1 })
  instalmentCount: number = 1

  @Property({ name: 'instalment_amount', type: 'numeric', precision: 18, scale: 4, default: '0' })
  instalmentAmount: string = '0'

  @Property({ name: 'first_due_on', type: 'date' })
  firstDueOn!: Date

  @Property({ name: 'outstanding_amount', type: 'numeric', precision: 18, scale: 4, default: '0' })
  outstandingAmount: string = '0'

  @Property({ type: 'text', nullable: true })
  reason?: string | null

  @Enum({ items: [...LOAN_STATUSES], type: 'text', name: 'status', default: 'pending' })
  status: (typeof LOAN_STATUSES)[number] = 'pending'

  @Property({ name: 'approval_request_id', type: 'uuid', nullable: true })
  approvalRequestId?: string | null

  @Property({ name: 'decided_by_user_id', type: 'uuid', nullable: true })
  decidedByUserId?: string | null

  @Property({ name: 'decided_at', type: Date, nullable: true })
  decidedAt?: Date | null

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

@Entity({ tableName: 'hr_loan_instalments' })
@Index({ name: 'hr_loan_instalments_loan_idx', properties: ['loanId', 'sequence'] })
@Index({ name: 'hr_loan_instalments_due_idx', properties: ['organizationId', 'status', 'dueOn'] })
export class HrLoanInstalment {
  [OptionalProps]?: 'status' | 'createdAt' | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'loan_id', type: 'uuid' })
  loanId!: string

  @Property({ type: 'integer' })
  sequence!: number

  @Property({ name: 'due_on', type: 'date' })
  dueOn!: Date

  @Property({ type: 'numeric', precision: 18, scale: 4, default: '0' })
  amount: string = '0'

  @Enum({ items: [...LOAN_INSTALMENT_STATUSES], type: 'text', name: 'status', default: 'scheduled' })
  status: (typeof LOAN_INSTALMENT_STATUSES)[number] = 'scheduled'

  @Property({ name: 'payroll_run_id', type: 'uuid', nullable: true })
  payrollRunId?: string | null

  @Property({ name: 'payslip_id', type: 'uuid', nullable: true })
  payslipId?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}

@Entity({ tableName: 'hr_employee_penalties' })
@Index({ name: 'hr_employee_penalties_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'hr_employee_penalties_employee_idx', properties: ['organizationId', 'employeeId', 'status'] })
export class HrEmployeePenalty {
  [OptionalProps]?: 'status' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'employee_id', type: 'uuid' })
  employeeId!: string

  @Enum({ items: [...PENALTY_TYPES], type: 'text', name: 'penalty_type' })
  penaltyType!: (typeof PENALTY_TYPES)[number]

  @Property({ name: 'incident_on', type: 'date' })
  incidentOn!: Date

  @Property({ type: 'numeric', precision: 18, scale: 4, nullable: true })
  amount?: string | null

  @Property({ name: 'suspended_days', type: 'integer', nullable: true })
  suspendedDays?: number | null

  @Property({ type: 'text' })
  reason!: string

  @Enum({ items: [...LOAN_STATUSES], type: 'text', name: 'status', default: 'pending' })
  status: (typeof LOAN_STATUSES)[number] = 'pending'

  @Property({ name: 'approval_request_id', type: 'uuid', nullable: true })
  approvalRequestId?: string | null

  @Property({ name: 'decided_by_user_id', type: 'uuid', nullable: true })
  decidedByUserId?: string | null

  @Property({ name: 'decided_at', type: Date, nullable: true })
  decidedAt?: Date | null

  @Property({ name: 'payroll_run_id', type: 'uuid', nullable: true })
  payrollRunId?: string | null

  @Property({ name: 'payslip_id', type: 'uuid', nullable: true })
  payslipId?: string | null

  @Property({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'hr_employee_incentives' })
@Index({ name: 'hr_employee_incentives_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'hr_employee_incentives_employee_idx', properties: ['organizationId', 'employeeId', 'status'] })
export class HrEmployeeIncentive {
  [OptionalProps]?: 'status' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'employee_id', type: 'uuid' })
  employeeId!: string

  @Enum({ items: [...INCENTIVE_TYPES], type: 'text', name: 'incentive_type' })
  incentiveType!: (typeof INCENTIVE_TYPES)[number]

  @Property({ type: 'numeric', precision: 18, scale: 4, default: '0' })
  amount: string = '0'

  @Property({ name: 'currency_code', type: 'text' })
  currencyCode!: string

  @Property({ name: 'period_start', type: 'date', nullable: true })
  periodStart?: Date | null

  @Property({ name: 'period_end', type: 'date', nullable: true })
  periodEnd?: Date | null

  @Property({ type: 'text' })
  reason!: string

  @Enum({ items: [...LOAN_STATUSES], type: 'text', name: 'status', default: 'pending' })
  status: (typeof LOAN_STATUSES)[number] = 'pending'

  @Property({ name: 'approval_request_id', type: 'uuid', nullable: true })
  approvalRequestId?: string | null

  @Property({ name: 'decided_by_user_id', type: 'uuid', nullable: true })
  decidedByUserId?: string | null

  @Property({ name: 'decided_at', type: Date, nullable: true })
  decidedAt?: Date | null

  @Property({ name: 'payroll_run_id', type: 'uuid', nullable: true })
  payrollRunId?: string | null

  @Property({ name: 'payslip_id', type: 'uuid', nullable: true })
  payslipId?: string | null

  @Property({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'hr_payroll_runs' })
@Index({ name: 'hr_payroll_runs_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'hr_payroll_runs_period_idx', properties: ['organizationId', 'periodStart', 'periodEnd'] })
export class HrPayrollRun {
  [OptionalProps]?: 'status' | 'grossTotal' | 'deductionTotal' | 'netTotal' | 'employeeCount' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'period_start', type: 'date' })
  periodStart!: Date

  @Property({ name: 'period_end', type: 'date' })
  periodEnd!: Date

  @Property({ name: 'payment_date', type: 'date' })
  paymentDate!: Date

  @Enum({ items: [...PAYROLL_RUN_STATUSES], type: 'text', name: 'status', default: 'draft' })
  status: PayrollRunStatus = 'draft'

  @Property({ name: 'currency_code', type: 'text' })
  currencyCode!: string

  @Property({ name: 'gross_total', type: 'numeric', precision: 18, scale: 4, default: '0' })
  grossTotal: string = '0'

  @Property({ name: 'deduction_total', type: 'numeric', precision: 18, scale: 4, default: '0' })
  deductionTotal: string = '0'

  @Property({ name: 'net_total', type: 'numeric', precision: 18, scale: 4, default: '0' })
  netTotal: string = '0'

  @Property({ name: 'employee_count', type: 'integer', default: 0 })
  employeeCount: number = 0

  @Property({ name: 'calculated_at', type: Date, nullable: true })
  calculatedAt?: Date | null

  @Property({ name: 'approval_request_id', type: 'uuid', nullable: true })
  approvalRequestId?: string | null

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

@Entity({ tableName: 'hr_payslips' })
@Index({ name: 'hr_payslips_run_idx', properties: ['payrollRunId'] })
@Index({ name: 'hr_payslips_employee_idx', properties: ['organizationId', 'employeeId'] })
export class HrPayslip {
  [OptionalProps]?: 'status' | 'grossAmount' | 'deductionAmount' | 'netAmount' | 'createdAt' | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'payroll_run_id', type: 'uuid' })
  payrollRunId!: string

  @Property({ name: 'employee_id', type: 'uuid' })
  employeeId!: string

  @Property({ name: 'gross_amount', type: 'numeric', precision: 18, scale: 4, default: '0' })
  grossAmount: string = '0'

  @Property({ name: 'deduction_amount', type: 'numeric', precision: 18, scale: 4, default: '0' })
  deductionAmount: string = '0'

  @Property({ name: 'net_amount', type: 'numeric', precision: 18, scale: 4, default: '0' })
  netAmount: string = '0'

  @Enum({ items: [...PAYSLIP_STATUSES], type: 'text', name: 'status', default: 'draft' })
  status: (typeof PAYSLIP_STATUSES)[number] = 'draft'

  @Property({ name: 'worked_days', type: 'numeric', precision: 8, scale: 2, default: '0' })
  workedDays: string = '0'

  @Property({ name: 'paid_leave_days', type: 'numeric', precision: 8, scale: 2, default: '0' })
  paidLeaveDays: string = '0'

  @Property({ name: 'unpaid_leave_days', type: 'numeric', precision: 8, scale: 2, default: '0' })
  unpaidLeaveDays: string = '0'

  @Property({ name: 'absence_days', type: 'numeric', precision: 8, scale: 2, default: '0' })
  absenceDays: string = '0'

  @Property({ type: 'text', nullable: true })
  notes?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}

@Entity({ tableName: 'hr_payslip_lines' })
@Index({ name: 'hr_payslip_lines_payslip_idx', properties: ['payslipId', 'sequence'] })
export class HrPayslipLine {
  [OptionalProps]?: 'sequence' | 'createdAt' | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'payslip_id', type: 'uuid' })
  payslipId!: string

  @Enum({ items: [...PAYSLIP_LINE_KINDS], type: 'text', name: 'kind' })
  kind!: (typeof PAYSLIP_LINE_KINDS)[number]

  @Enum({ items: [...PAYSLIP_LINE_CODES], type: 'text', name: 'code' })
  code!: (typeof PAYSLIP_LINE_CODES)[number]

  @Property({ type: 'text' })
  label!: string

  @Property({ type: 'numeric', precision: 18, scale: 4, default: '0' })
  amount: string = '0'

  @Property({ name: 'source_entity_type', type: 'text', nullable: true })
  sourceEntityType?: string | null

  @Property({ name: 'source_entity_id', type: 'uuid', nullable: true })
  sourceEntityId?: string | null

  @Property({ type: 'integer', default: 0 })
  sequence: number = 0

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}
