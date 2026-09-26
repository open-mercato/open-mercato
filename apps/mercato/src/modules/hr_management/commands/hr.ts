import type { CrudEventsConfig, CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import {
  HrApprovalActionLog,
  HrApprovalRequest,
  HrApprovalStepDefinition,
  HrApprovalWorkflow,
  HrAttendanceRecord,
  HrDepartment,
  HrDriverProfile,
  HrEmployee,
  HrEmployeeDocument,
  HrLeaveRequest,
} from '../data/entities'
import {
  createApprovalActionLogSchema,
  createApprovalRequestSchema,
  createApprovalStepDefinitionSchema,
  createApprovalWorkflowSchema,
  createAttendanceRecordSchema,
  createDepartmentSchema,
  createDriverProfileSchema,
  createEmployeeDocumentSchema,
  createEmployeeSchema,
  createLeaveRequestSchema,
  updateApprovalRequestSchema,
  updateApprovalStepDefinitionSchema,
  updateApprovalWorkflowSchema,
  updateAttendanceRecordSchema,
  updateDepartmentSchema,
  updateDriverProfileSchema,
  updateEmployeeDocumentSchema,
  updateEmployeeSchema,
  updateLeaveRequestSchema,
} from '../data/validators'
import { registerCrudCommands } from './crud'
import {
  assertAttendanceRecordable,
  assertEmployeeWritable,
  assertLeaveRequestBookable,
  type HrScope,
} from '../lib/hrService'

export function makeEvents<TEntity extends object>(entity: string): CrudEventsConfig<TEntity> {
  return {
    module: 'hr_management',
    entity,
    persistent: true,
    buildPayload: ({ identifiers }) => ({
      id: identifiers.id,
      organizationId: identifiers.organizationId,
      tenantId: identifiers.tenantId,
    }),
  }
}

export function makeIndexer<TEntity extends object>(entityType: string): CrudIndexerConfig<TEntity> {
  return { entityType }
}

function toDate(value: unknown): Date {
  return value instanceof Date ? value : new Date(String(value))
}

function optionalDate(value: unknown): Date | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const parsed = value instanceof Date ? value : new Date(String(value))
  return Number.isNaN(parsed.getTime()) ? undefined : parsed
}

export function scopeFrom(ctx: CommandRuntimeContext): HrScope {
  const tenantId = ctx.auth?.tenantId
  const organizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId
  if (!tenantId || !organizationId) throw new Error('[internal] HR scope is unavailable')
  return { tenantId, organizationId }
}

export const patched = (input: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(input).filter(([key]) => key !== 'id'))

export const HR_DEPARTMENT_ENTITY_ID = 'hr_management:hr_department' as const
export const HR_EMPLOYEE_ENTITY_ID = 'hr_management:hr_employee' as const
export const HR_DRIVER_PROFILE_ENTITY_ID = 'hr_management:hr_driver_profile' as const
export const HR_ATTENDANCE_ENTITY_ID = 'hr_management:hr_attendance_record' as const
export const HR_LEAVE_REQUEST_ENTITY_ID = 'hr_management:hr_leave_request' as const
export const HR_EMPLOYEE_DOCUMENT_ENTITY_ID = 'hr_management:hr_employee_document' as const
export const HR_APPROVAL_WORKFLOW_ENTITY_ID = 'hr_management:hr_approval_workflow' as const
export const HR_APPROVAL_STEP_ENTITY_ID = 'hr_management:hr_approval_step_definition' as const
export const HR_APPROVAL_REQUEST_ENTITY_ID = 'hr_management:hr_approval_request' as const
export const HR_APPROVAL_ACTION_LOG_ENTITY_ID = 'hr_management:hr_approval_action_log' as const

export const hrDepartmentEvents = makeEvents<HrDepartment>('department')
export const hrDepartmentIndexer = makeIndexer<HrDepartment>(HR_DEPARTMENT_ENTITY_ID)
export const hrEmployeeEvents = makeEvents<HrEmployee>('employee')
export const hrEmployeeIndexer = makeIndexer<HrEmployee>(HR_EMPLOYEE_ENTITY_ID)
export const hrDriverProfileEvents = makeEvents<HrDriverProfile>('driver_profile')
export const hrDriverProfileIndexer = makeIndexer<HrDriverProfile>(HR_DRIVER_PROFILE_ENTITY_ID)
export const hrAttendanceEvents = makeEvents<HrAttendanceRecord>('attendance_record')
export const hrAttendanceIndexer = makeIndexer<HrAttendanceRecord>(HR_ATTENDANCE_ENTITY_ID)
export const hrLeaveRequestEvents = makeEvents<HrLeaveRequest>('leave_request')
export const hrLeaveRequestIndexer = makeIndexer<HrLeaveRequest>(HR_LEAVE_REQUEST_ENTITY_ID)
export const hrEmployeeDocumentEvents = makeEvents<HrEmployeeDocument>('employee_document')
export const hrEmployeeDocumentIndexer = makeIndexer<HrEmployeeDocument>(HR_EMPLOYEE_DOCUMENT_ENTITY_ID)
export const hrApprovalWorkflowEvents = makeEvents<HrApprovalWorkflow>('approval_workflow')
export const hrApprovalWorkflowIndexer = makeIndexer<HrApprovalWorkflow>(HR_APPROVAL_WORKFLOW_ENTITY_ID)
export const hrApprovalStepEvents = makeEvents<HrApprovalStepDefinition>('approval_step_definition')
export const hrApprovalStepIndexer = makeIndexer<HrApprovalStepDefinition>(HR_APPROVAL_STEP_ENTITY_ID)

registerCrudCommands({
  entity: HrDepartment,
  entityId: HR_DEPARTMENT_ENTITY_ID,
  resource: 'departments',
  createSchema: createDepartmentSchema,
  updateSchema: updateDepartmentSchema,
  toCreateData: (input) => input,
  toUpdateData: patched,
  events: hrDepartmentEvents,
  indexer: hrDepartmentIndexer,
})

registerCrudCommands({
  entity: HrEmployee,
  entityId: HR_EMPLOYEE_ENTITY_ID,
  resource: 'employees',
  createSchema: createEmployeeSchema,
  updateSchema: updateEmployeeSchema,
  toCreateData: (input) => ({
    ...input,
    hireDate: toDate(input.hireDate),
    ...(optionalDate(input.nationalIdExpiry) ? { nationalIdExpiry: optionalDate(input.nationalIdExpiry) } : {}),
    ...(optionalDate(input.terminationDate) ? { terminationDate: optionalDate(input.terminationDate) } : {}),
  }),
  toUpdateData: (input) => {
    const { nationalIdExpiry, hireDate, terminationDate, ...patch } = patched(input)
    return {
      ...patch,
      ...(nationalIdExpiry === undefined ? {} : { nationalIdExpiry: optionalDate(nationalIdExpiry) ?? null }),
      ...(hireDate === undefined ? {} : { hireDate: toDate(hireDate) }),
      ...(terminationDate === undefined ? {} : { terminationDate: optionalDate(terminationDate) ?? null }),
    }
  },
  events: hrEmployeeEvents,
  indexer: hrEmployeeIndexer,
  beforeCreate: async (input, scope, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    await assertEmployeeWritable(em, {
      departmentId: typeof input.departmentId === 'string' ? input.departmentId : null,
      hireDate: typeof input.hireDate === 'string' ? input.hireDate : undefined,
      terminationDate: typeof input.terminationDate === 'string' ? input.terminationDate : null,
    }, scope)
  },
})

registerCrudCommands({
  entity: HrDriverProfile,
  entityId: HR_DRIVER_PROFILE_ENTITY_ID,
  resource: 'driver_profiles',
  createSchema: createDriverProfileSchema,
  updateSchema: updateDriverProfileSchema,
  toCreateData: (input) => ({
    ...input,
    licenseExpiry: toDate(input.licenseExpiry),
    ...(optionalDate(input.medicalCheckExpiry) ? { medicalCheckExpiry: optionalDate(input.medicalCheckExpiry) } : {}),
  }),
  toUpdateData: (input) => {
    const { licenseExpiry, medicalCheckExpiry, ...patch } = patched(input)
    return {
      ...patch,
      ...(licenseExpiry === undefined ? {} : { licenseExpiry: toDate(licenseExpiry) }),
      ...(medicalCheckExpiry === undefined ? {} : { medicalCheckExpiry: optionalDate(medicalCheckExpiry) ?? null }),
    }
  },
  events: hrDriverProfileEvents,
  indexer: hrDriverProfileIndexer,
})

registerCrudCommands({
  entity: HrAttendanceRecord,
  entityId: HR_ATTENDANCE_ENTITY_ID,
  resource: 'attendance',
  createSchema: createAttendanceRecordSchema,
  updateSchema: updateAttendanceRecordSchema,
  toCreateData: (input) => ({
    ...input,
    date: toDate(input.date),
    ...(optionalDate(input.checkInAt) ? { checkInAt: optionalDate(input.checkInAt) } : {}),
    ...(optionalDate(input.checkOutAt) ? { checkOutAt: optionalDate(input.checkOutAt) } : {}),
  }),
  toUpdateData: (input) => {
    const { date, checkInAt, checkOutAt, ...patch } = patched(input)
    return {
      ...patch,
      ...(date === undefined ? {} : { date: toDate(date) }),
      ...(checkInAt === undefined ? {} : { checkInAt: optionalDate(checkInAt) ?? null }),
      ...(checkOutAt === undefined ? {} : { checkOutAt: optionalDate(checkOutAt) ?? null }),
    }
  },
  events: hrAttendanceEvents,
  indexer: hrAttendanceIndexer,
  beforeCreate: async (input, scope, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    await assertAttendanceRecordable(em, {
      employeeId: String(input.employeeId),
      date: input.date instanceof Date ? input.date : String(input.date),
    }, scope)
  },
})

registerCrudCommands({
  entity: HrLeaveRequest,
  entityId: HR_LEAVE_REQUEST_ENTITY_ID,
  resource: 'leave_requests',
  createSchema: createLeaveRequestSchema,
  updateSchema: updateLeaveRequestSchema,
  toCreateData: (input) => ({
    ...input,
    startDate: toDate(input.startDate),
    endDate: toDate(input.endDate),
    status: 'pending' as const,
  }),
  toUpdateData: (input) => {
    const { startDate, endDate, decidedAt, ...patch } = patched(input)
    return {
      ...patch,
      ...(startDate === undefined ? {} : { startDate: toDate(startDate) }),
      ...(endDate === undefined ? {} : { endDate: toDate(endDate) }),
      ...(decidedAt === undefined ? {} : { decidedAt: optionalDate(decidedAt) ?? null }),
    }
  },
  events: hrLeaveRequestEvents,
  indexer: hrLeaveRequestIndexer,
  beforeCreate: async (input, scope, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    await assertLeaveRequestBookable(em, {
      employeeId: String(input.employeeId),
      startDate: input.startDate instanceof Date ? input.startDate : String(input.startDate),
      endDate: input.endDate instanceof Date ? input.endDate : String(input.endDate),
    }, scope)
  },
})

registerCrudCommands({
  entity: HrEmployeeDocument,
  entityId: HR_EMPLOYEE_DOCUMENT_ENTITY_ID,
  resource: 'employee_documents',
  createSchema: createEmployeeDocumentSchema,
  updateSchema: updateEmployeeDocumentSchema,
  toCreateData: (input) => ({
    ...input,
    ...(optionalDate(input.issueDate) ? { issueDate: optionalDate(input.issueDate) } : {}),
    ...(optionalDate(input.expiryDate) ? { expiryDate: optionalDate(input.expiryDate) } : {}),
  }),
  toUpdateData: (input) => {
    const { issueDate, expiryDate, ...patch } = patched(input)
    return {
      ...patch,
      ...(issueDate === undefined ? {} : { issueDate: optionalDate(issueDate) ?? null }),
      ...(expiryDate === undefined ? {} : { expiryDate: optionalDate(expiryDate) ?? null }),
    }
  },
  events: hrEmployeeDocumentEvents,
  indexer: hrEmployeeDocumentIndexer,
})

registerCrudCommands({
  entity: HrApprovalWorkflow,
  entityId: HR_APPROVAL_WORKFLOW_ENTITY_ID,
  resource: 'approval_workflows',
  createSchema: createApprovalWorkflowSchema,
  updateSchema: updateApprovalWorkflowSchema,
  toCreateData: (input) => input,
  toUpdateData: patched,
  events: hrApprovalWorkflowEvents,
  indexer: hrApprovalWorkflowIndexer,
})

registerCrudCommands({
  entity: HrApprovalStepDefinition,
  entityId: HR_APPROVAL_STEP_ENTITY_ID,
  resource: 'approval_steps',
  createSchema: createApprovalStepDefinitionSchema,
  updateSchema: updateApprovalStepDefinitionSchema,
  toCreateData: (input) => input,
  toUpdateData: patched,
  events: hrApprovalStepEvents,
  indexer: hrApprovalStepIndexer,
})