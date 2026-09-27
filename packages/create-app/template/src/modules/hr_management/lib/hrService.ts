import type { EntityManager } from '@mikro-orm/postgresql'
import { raiseHrError } from './errors'
import {
  HrAttendanceRecord,
  HrDepartment,
  HrEmployee,
  HrEmployeeDocument,
  HrLeaveRequest,
  HrApprovalRequest,
} from '../data/entities'

export type HrScope = { tenantId: string; organizationId: string }

export type EmployeeInput = {
  id?: string
  departmentId?: string | null
  hireDate?: Date | string
  terminationDate?: Date | string | null
}

export type AttendanceInput = {
  id?: string
  employeeId: string
  date: Date | string
}

export type LeaveInput = {
  id?: string
  employeeId: string
  startDate: Date | string
  endDate: Date | string
}

export type DepartmentInput = {
  id?: string
  parentDepartmentId?: string | null
}

export type HrDashboardSummary = {
  headcount: number
  onLeave: number
  departments: number
  pendingLeaveRequests: number
  pendingApprovals: number
  expiringDocuments: number
}

export const HR_DOCUMENT_EXPIRY_WINDOW_DAYS = 30

const scopedOf = (scope: HrScope) => ({
  tenantId: scope.tenantId,
  organizationId: scope.organizationId,
  deletedAt: null,
})

export async function assertEmployeeWritable(
  em: EntityManager,
  input: EmployeeInput,
  scope: HrScope,
): Promise<void> {
  const scoped = scopedOf(scope)
  if (input.departmentId) {
    const department = await em.findOne(HrDepartment, { ...scoped, id: input.departmentId })
    if (!department) return raiseHrError(400, 'department_not_found', 'The selected department does not exist.')
  }
  const hireDate = input.hireDate ? new Date(input.hireDate) : null
  const terminationDate = input.terminationDate ? new Date(input.terminationDate) : null
  if (hireDate && terminationDate && terminationDate < hireDate) {
    return raiseHrError(409, 'termination_before_hire', 'The termination date cannot be earlier than the hire date.')
  }
}

/**
 * Refuses a department whose parent does not exist, or whose parent would put it inside itself.
 *
 * `parent_department_id` is a plain FK, so the database happily stores a cycle — and a cycle makes
 * the tree unrenderable and every ancestor walk non-terminating. The form filters the picker, but
 * the API is reachable without the form, so the rule lives here where every writer passes.
 */
export async function assertDepartmentWritable(
  em: EntityManager,
  input: DepartmentInput,
  scope: HrScope,
): Promise<void> {
  if (!input.parentDepartmentId) return
  const scoped = scopedOf(scope)

  const parent = await em.findOne(HrDepartment, { ...scoped, id: input.parentDepartmentId })
  if (!parent) {
    return raiseHrError(400, 'parent_department_not_found', 'The selected parent department does not exist.')
  }
  if (!input.id) return

  // Walk up from the chosen parent. The guard is a visited set rather than a depth limit: a cycle
  // stored before this rule existed must terminate the walk, not exhaust it.
  const departments = await em.find(HrDepartment, scoped)
  const parentsById = new Map(departments.map((department) => [department.id, department.parentDepartmentId ?? null]))
  const visited = new Set<string>()
  let cursor: string | null = input.parentDepartmentId
  while (cursor) {
    if (cursor === input.id) {
      return raiseHrError(409, 'department_cycle', 'A department cannot sit under itself or under one of its own departments.')
    }
    if (visited.has(cursor)) break
    visited.add(cursor)
    cursor = parentsById.get(cursor) ?? null
  }
}

export async function assertAttendanceRecordable(
  em: EntityManager,
  input: AttendanceInput,
  scope: HrScope,
): Promise<void> {
  const scoped = scopedOf(scope)
  const employee = await em.findOne(HrEmployee, { ...scoped, id: input.employeeId })
  if (!employee) return raiseHrError(400, 'employee_not_found', 'The selected employee does not exist.')

  const date = new Date(input.date)
  const dayStart = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000)
  const existing = await em.findOne(HrAttendanceRecord, {
    ...scoped,
    ...(input.id ? { id: { $ne: input.id } } : {}),
    employeeId: input.employeeId,
    date: { $gte: dayStart, $lt: dayEnd },
  })
  if (existing) {
    return raiseHrError(409, 'attendance_already_recorded', 'This employee already has an attendance record for that day.')
  }
}

export async function assertLeaveRequestBookable(
  em: EntityManager,
  input: LeaveInput,
  scope: HrScope,
): Promise<void> {
  const scoped = scopedOf(scope)
  const employee = await em.findOne(HrEmployee, { ...scoped, id: input.employeeId })
  if (!employee) return raiseHrError(400, 'employee_not_found', 'The selected employee does not exist.')

  const startDate = new Date(input.startDate)
  const endDate = new Date(input.endDate)
  if (endDate < startDate) {
    return raiseHrError(400, 'invalid_leave_range', 'The leave end date cannot be earlier than its start date.')
  }
  const overlapping = await em.findOne(HrLeaveRequest, {
    ...scoped,
    ...(input.id ? { id: { $ne: input.id } } : {}),
    employeeId: input.employeeId,
    status: { $in: ['pending', 'approved'] },
    startDate: { $lte: endDate },
    endDate: { $gte: startDate },
  })
  if (overlapping) {
    return raiseHrError(409, 'leave_overlap', 'This employee already has leave booked in that period.')
  }
}

export async function getHrDashboardSummary(
  em: EntityManager,
  scope: HrScope,
): Promise<HrDashboardSummary> {
  const base = scopedOf(scope)
  const expiryCutoff = new Date()
  expiryCutoff.setDate(expiryCutoff.getDate() + HR_DOCUMENT_EXPIRY_WINDOW_DAYS)
  const [headcount, onLeave, departments, pendingLeaveRequests, pendingApprovals, expiringDocuments] =
    await Promise.all([
      em.count(HrEmployee, { ...base, status: 'active' }),
      em.count(HrEmployee, { ...base, status: 'on_leave' }),
      em.count(HrDepartment, { ...base, isActive: true }),
      em.count(HrLeaveRequest, { ...base, status: 'pending' }),
      em.count(HrApprovalRequest, { ...base, status: 'pending' }),
      em.count(HrEmployeeDocument, { ...base, expiryDate: { $lte: expiryCutoff, $ne: null } }),
    ])
  return { headcount, onLeave, departments, pendingLeaveRequests, pendingApprovals, expiringDocuments }
}

export type HrService = {
  assertDepartmentWritable(input: DepartmentInput, scope: HrScope): Promise<void>
  assertEmployeeWritable(input: EmployeeInput, scope: HrScope): Promise<void>
  assertAttendanceRecordable(input: AttendanceInput, scope: HrScope): Promise<void>
  assertLeaveRequestBookable(input: LeaveInput, scope: HrScope): Promise<void>
  getDashboardSummary(scope: HrScope): Promise<HrDashboardSummary>
}

export function createHrService(em: EntityManager): HrService {
  return {
    assertDepartmentWritable: (input, scope) => assertDepartmentWritable(em, input, scope),
    assertEmployeeWritable: (input, scope) => assertEmployeeWritable(em, input, scope),
    assertAttendanceRecordable: (input, scope) => assertAttendanceRecordable(em, input, scope),
    assertLeaveRequestBookable: (input, scope) => assertLeaveRequestBookable(em, input, scope),
    getDashboardSummary: (scope) => getHrDashboardSummary(em, scope),
  }
}