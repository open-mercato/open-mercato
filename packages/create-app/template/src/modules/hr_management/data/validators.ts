import { z } from 'zod'
import {
  IDENTITY_TYPES,
  EMPLOYMENT_TYPES,
  EMPLOYEE_STATUSES,
  ATTENDANCE_STATUSES,
  LEAVE_TYPES,
  LEAVE_REQUEST_STATUSES,
  EMPLOYEE_DOCUMENT_TYPES,
  APPROVAL_APPROVER_TYPES,
  APPROVAL_REQUEST_STATUSES,
  APPROVAL_ACTIONS,
} from './entities'

const dateInput = z.string().min(1).or(z.date())
const dateTimeInput = z.string().datetime().or(z.date())

export const createDepartmentSchema = z.object({
  name: z.string().min(1),
  code: z.string().trim().min(1).optional().nullable(),
  description: z.string().trim().min(1).optional().nullable(),
  parentDepartmentId: z.string().uuid().optional().nullable(),
  managerEmployeeId: z.string().uuid().optional().nullable(),
  isActive: z.boolean().optional(),
})

export const updateDepartmentSchema = createDepartmentSchema.partial().extend({
  id: z.string().uuid(),
})

export type CreateDepartmentInput = z.infer<typeof createDepartmentSchema>
export type UpdateDepartmentInput = z.infer<typeof updateDepartmentSchema>

export const createEmployeeSchema = z.object({
  employeeNumber: z.string().min(1),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  identityType: z.enum(IDENTITY_TYPES).optional(),
  nationalId: z.string().min(1),
  nationalIdExpiry: dateInput.optional().nullable(),
  departmentId: z.string().uuid().optional().nullable(),
  jobTitle: z.string().min(1),
  employmentType: z.enum(EMPLOYMENT_TYPES).optional(),
  status: z.enum(EMPLOYEE_STATUSES).optional(),
  hireDate: dateInput,
  terminationDate: dateInput.optional().nullable(),
  email: z.string().email().optional().nullable(),
  phone: z.string().trim().min(1).optional().nullable(),
  userId: z.string().uuid().optional().nullable(),
})

export const updateEmployeeSchema = createEmployeeSchema.partial().extend({
  id: z.string().uuid(),
})

export type CreateEmployeeInput = z.infer<typeof createEmployeeSchema>
export type UpdateEmployeeInput = z.infer<typeof updateEmployeeSchema>

export const createDriverProfileSchema = z.object({
  employeeId: z.string().uuid(),
  licenseNumber: z.string().min(1),
  licenseType: z.string().trim().min(1).optional().nullable(),
  licenseExpiry: dateInput,
  medicalCheckExpiry: dateInput.optional().nullable(),
  yearsOfExperience: z.coerce.number().int().min(0).optional().nullable(),
  notes: z.string().trim().min(1).optional().nullable(),
})

export const updateDriverProfileSchema = createDriverProfileSchema.partial().extend({
  id: z.string().uuid(),
})

export type CreateDriverProfileInput = z.infer<typeof createDriverProfileSchema>
export type UpdateDriverProfileInput = z.infer<typeof updateDriverProfileSchema>

export const createAttendanceRecordSchema = z.object({
  employeeId: z.string().uuid(),
  date: dateInput,
  checkInAt: dateTimeInput.optional().nullable(),
  checkOutAt: dateTimeInput.optional().nullable(),
  status: z.enum(ATTENDANCE_STATUSES).optional(),
  workedMinutes: z.coerce.number().int().min(0).optional().nullable(),
  notes: z.string().trim().min(1).optional().nullable(),
})

export const updateAttendanceRecordSchema = createAttendanceRecordSchema.partial().extend({
  id: z.string().uuid(),
})

export type CreateAttendanceRecordInput = z.infer<typeof createAttendanceRecordSchema>
export type UpdateAttendanceRecordInput = z.infer<typeof updateAttendanceRecordSchema>

export const createLeaveRequestSchema = z
  .object({
    employeeId: z.string().uuid(),
    leaveType: z.enum(LEAVE_TYPES),
    startDate: dateInput,
    endDate: dateInput,
    totalDays: z.coerce.number().int().min(1),
    reason: z.string().trim().min(1).optional().nullable(),
    status: z.enum(LEAVE_REQUEST_STATUSES).optional(),
  })
  .refine((data) => new Date(data.endDate) >= new Date(data.startDate), {
    message: 'endDate must be on or after startDate',
    path: ['endDate'],
  })

export const updateLeaveRequestSchema = z.object({
  id: z.string().uuid(),
  employeeId: z.string().uuid().optional(),
  leaveType: z.enum(LEAVE_TYPES).optional(),
  startDate: dateInput.optional(),
  endDate: dateInput.optional(),
  totalDays: z.coerce.number().int().min(1).optional(),
  reason: z.string().trim().min(1).optional().nullable(),
  status: z.enum(LEAVE_REQUEST_STATUSES).optional(),
  approvalRequestId: z.string().uuid().optional().nullable(),
  decidedByUserId: z.string().uuid().optional().nullable(),
  decidedAt: dateTimeInput.optional().nullable(),
  decisionComment: z.string().trim().min(1).optional().nullable(),
})

export type CreateLeaveRequestInput = z.infer<typeof createLeaveRequestSchema>
export type UpdateLeaveRequestInput = z.infer<typeof updateLeaveRequestSchema>

export const createEmployeeDocumentSchema = z.object({
  employeeId: z.string().uuid(),
  documentType: z.enum(EMPLOYEE_DOCUMENT_TYPES),
  documentNumber: z.string().trim().min(1).optional().nullable(),
  issueDate: dateInput.optional().nullable(),
  expiryDate: dateInput.optional().nullable(),
  fileAttachmentId: z.string().uuid().optional().nullable(),
  notes: z.string().trim().min(1).optional().nullable(),
})

export const updateEmployeeDocumentSchema = createEmployeeDocumentSchema.partial().extend({
  id: z.string().uuid(),
})

export type CreateEmployeeDocumentInput = z.infer<typeof createEmployeeDocumentSchema>
export type UpdateEmployeeDocumentInput = z.infer<typeof updateEmployeeDocumentSchema>

export const createApprovalWorkflowSchema = z.object({
  name: z.string().min(1),
  code: z.string().min(1),
  entityType: z.string().min(1),
  description: z.string().trim().min(1).optional().nullable(),
  isActive: z.boolean().optional(),
})

export const updateApprovalWorkflowSchema = createApprovalWorkflowSchema.partial().extend({
  id: z.string().uuid(),
})

export type CreateApprovalWorkflowInput = z.infer<typeof createApprovalWorkflowSchema>
export type UpdateApprovalWorkflowInput = z.infer<typeof updateApprovalWorkflowSchema>

export const createApprovalStepDefinitionSchema = z.object({
  workflowId: z.string().uuid(),
  stepOrder: z.coerce.number().int().min(1),
  name: z.string().min(1),
  approverType: z.enum(APPROVAL_APPROVER_TYPES),
  approverRoleId: z.string().uuid().optional().nullable(),
  approverUserId: z.string().uuid().optional().nullable(),
  requiredApprovals: z.coerce.number().int().min(1).optional(),
  isFinal: z.boolean().optional(),
})

export const updateApprovalStepDefinitionSchema = createApprovalStepDefinitionSchema.partial().extend({
  id: z.string().uuid(),
})

export type CreateApprovalStepDefinitionInput = z.infer<typeof createApprovalStepDefinitionSchema>
export type UpdateApprovalStepDefinitionInput = z.infer<typeof updateApprovalStepDefinitionSchema>

export const createApprovalRequestSchema = z.object({
  workflowId: z.string().uuid(),
  entityType: z.string().min(1),
  entityId: z.string().uuid(),
  status: z.enum(APPROVAL_REQUEST_STATUSES).optional(),
  currentStepOrder: z.coerce.number().int().min(1).optional(),
  requestedByUserId: z.string().uuid().optional().nullable(),
  summary: z.string().trim().min(1).optional().nullable(),
  payload: z.record(z.string(), z.unknown()).optional().nullable(),
})

export const updateApprovalRequestSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(APPROVAL_REQUEST_STATUSES).optional(),
  currentStepOrder: z.coerce.number().int().min(1).optional(),
  decidedAt: dateTimeInput.optional().nullable(),
  summary: z.string().trim().min(1).optional().nullable(),
  payload: z.record(z.string(), z.unknown()).optional().nullable(),
})

export type CreateApprovalRequestInput = z.infer<typeof createApprovalRequestSchema>
export type UpdateApprovalRequestInput = z.infer<typeof updateApprovalRequestSchema>

export const createApprovalActionLogSchema = z.object({
  approvalRequestId: z.string().uuid(),
  stepOrder: z.coerce.number().int().min(1),
  action: z.enum(APPROVAL_ACTIONS),
  actorUserId: z.string().uuid().optional().nullable(),
  comment: z.string().trim().min(1).optional().nullable(),
})

export type CreateApprovalActionLogInput = z.infer<typeof createApprovalActionLogSchema>
