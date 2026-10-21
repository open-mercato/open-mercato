import type { EntityManager } from '@mikro-orm/postgresql'
import {
  HrEmployee,
  HrLeaveAccrual,
  HrLeaveEntitlement,
  HrLeaveRequest,
  type LeaveType,
} from '../data/entities'
import { raiseHrError } from './errors'
import type { HrScope } from './hrService'

const DAY_MS = 86_400_000
const DAY_SCALE = 100

export function toUtcDate(value: Date | string): Date {
  if (value instanceof Date) return value
  const dateOnly = value.slice(0, 10)
  return new Date(`${dateOnly}T00:00:00.000Z`)
}

export function formatDays(value: number): string {
  return (Math.round(value * DAY_SCALE) / DAY_SCALE).toFixed(2)
}

export function monthlyAccrualDays(entitledDays: number): number {
  return Math.round((entitledDays / 12) * DAY_SCALE) / DAY_SCALE
}

export function inclusiveDayCount(start: Date | string, end: Date | string): number {
  const from = toUtcDate(start).getTime()
  const to = toUtcDate(end).getTime()
  if (to < from) return 0
  return Math.floor((to - from) / DAY_MS) + 1
}

export type LeaveEntitlementPeriod = {
  periodStart: Date | string
  periodEnd: Date | string
}

export type LeaveBalanceRequest = {
  id?: string
  status: string
  startDate: Date | string
  endDate: Date | string
  totalDays: number
}

export type LeaveBalanceInput = {
  entitlements: Array<LeaveEntitlementPeriod & {
    entitledDays: string | number
    carryOverDays: string | number
  }>
  accruals: Array<{ entitlementId?: string | null; days: string | number }>
  requests: LeaveBalanceRequest[]
  excludeRequestId?: string
}

export type LeaveBalance = {
  periodStart: string
  periodEnd: string
  entitledDays: number
  carryOverDays: number
  accruedDays: number
  usedDays: number
  pendingDays: number
  availableDays: number
}

function roundDays(value: number): number {
  return Math.round(value * DAY_SCALE) / DAY_SCALE
}

/**
 * Balance = entitlement + carry-over + accrued − approved − pending.
 *
 * Only entitlement and accrual amounts are stored; usage is always summed from the
 * leave requests themselves, so a cancelled or rejected request releases its days
 * without a second write.
 */
export function computeLeaveBalance(input: LeaveBalanceInput): LeaveBalance | null {
  if (input.entitlements.length === 0) return null

  let entitledDays = 0
  let carryOverDays = 0
  for (const entitlement of input.entitlements) {
    entitledDays += Number(entitlement.entitledDays)
    carryOverDays += Number(entitlement.carryOverDays)
  }

  let accruedDays = 0
  for (const accrual of input.accruals) accruedDays += Number(accrual.days)

  let usedDays = 0
  let pendingDays = 0
  for (const request of input.requests) {
    if (input.excludeRequestId && request.id === input.excludeRequestId) continue
    if (request.status === 'approved') usedDays += Number(request.totalDays)
    else if (request.status === 'pending') pendingDays += Number(request.totalDays)
  }

  const starts = input.entitlements.map((row) => toUtcDate(row.periodStart).getTime())
  const ends = input.entitlements.map((row) => toUtcDate(row.periodEnd).getTime())
  const periodStart = new Date(Math.min(...starts)).toISOString().slice(0, 10)
  const periodEnd = new Date(Math.max(...ends)).toISOString().slice(0, 10)

  return {
    periodStart,
    periodEnd,
    entitledDays: roundDays(entitledDays),
    carryOverDays: roundDays(carryOverDays),
    accruedDays: roundDays(accruedDays),
    usedDays: roundDays(usedDays),
    pendingDays: roundDays(pendingDays),
    availableDays: roundDays(entitledDays + carryOverDays + accruedDays - usedDays - pendingDays),
  }
}

export async function readLeaveBalance(
  em: EntityManager,
  scope: HrScope,
  input: {
    employeeId: string
    leaveType: LeaveType
    startDate: Date | string
    endDate: Date | string
    excludeRequestId?: string
  },
): Promise<LeaveBalance | null> {
  const scoped = { tenantId: scope.tenantId, organizationId: scope.organizationId }
  const start = toUtcDate(input.startDate)
  const end = toUtcDate(input.endDate)

  const entitlements = await em.find(HrLeaveEntitlement, {
    ...scoped,
    deletedAt: null,
    employeeId: input.employeeId,
    leaveType: input.leaveType,
    periodStart: { $lte: end },
    periodEnd: { $gte: start },
  })
  if (entitlements.length === 0) return null

  const entitlementIds = entitlements.map((row) => row.id)
  const periodsStart = entitlements.reduce(
    (earliest, row) => (toUtcDate(row.periodStart) < earliest ? toUtcDate(row.periodStart) : earliest),
    toUtcDate(entitlements[0].periodStart),
  )
  const periodsEnd = entitlements.reduce(
    (latest, row) => (toUtcDate(row.periodEnd) > latest ? toUtcDate(row.periodEnd) : latest),
    toUtcDate(entitlements[0].periodEnd),
  )

  const [accruals, requests] = await Promise.all([
    em.find(HrLeaveAccrual, {
      ...scoped,
      entitlementId: { $in: entitlementIds },
    }),
    em.find(HrLeaveRequest, {
      ...scoped,
      deletedAt: null,
      employeeId: input.employeeId,
      leaveType: input.leaveType,
      status: { $in: ['pending', 'approved'] },
      startDate: { $lte: periodsEnd },
      endDate: { $gte: periodsStart },
    }),
  ])

  return computeLeaveBalance({
    entitlements,
    accruals,
    requests: requests.map((request) => ({
      id: request.id,
      status: request.status,
      startDate: request.startDate,
      endDate: request.endDate,
      totalDays: request.totalDays,
    })),
    excludeRequestId: input.excludeRequestId,
  })
}

export type LeaveEntitlementInput = {
  id?: string
  employeeId: string
  leaveType: LeaveType
  periodStart: Date | string
  periodEnd: Date | string
}

export async function assertLeaveEntitlementWritable(
  em: EntityManager,
  input: LeaveEntitlementInput,
  scope: HrScope,
): Promise<void> {
  const scoped = { tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null }
  const employee = await em.findOne(HrEmployee, { ...scoped, id: input.employeeId })
  if (!employee) return raiseHrError(400, 'employee_not_found', 'The selected employee does not exist.')

  const start = toUtcDate(input.periodStart)
  const end = toUtcDate(input.periodEnd)
  if (end < start) {
    return raiseHrError(400, 'invalid_entitlement_range', 'The entitlement end date cannot be earlier than its start date.')
  }

  const overlapping = await em.findOne(HrLeaveEntitlement, {
    ...scoped,
    ...(input.id ? { id: { $ne: input.id } } : {}),
    employeeId: input.employeeId,
    leaveType: input.leaveType,
    periodStart: { $lte: end },
    periodEnd: { $gte: start },
  })
  if (overlapping) {
    return raiseHrError(409, 'leave_entitlement_overlap', 'This employee already has an entitlement for that leave type in that period.')
  }
}

export type LeaveAccrualRunInput = {
  month: string
  employeeId?: string
  leaveType?: LeaveType
}

export type LeaveAccrualRunResult = {
  created: number
  skipped: number
  daysAdded: string
}

function monthBounds(month: string): { start: Date; end: Date } {
  const [year, monthNumber] = month.split('-').map(Number)
  return {
    start: new Date(Date.UTC(year, monthNumber - 1, 1)),
    end: new Date(Date.UTC(year, monthNumber, 0)),
  }
}

function accrualKey(employeeId: string, leaveType: string, month: string): string {
  return `${employeeId}|${leaveType}|${month}`
}

export async function runLeaveAccrual(
  em: EntityManager,
  scope: HrScope,
  input: LeaveAccrualRunInput,
  actorUserId: string | null,
): Promise<LeaveAccrualRunResult> {
  const scoped = { tenantId: scope.tenantId, organizationId: scope.organizationId }
  const { start, end } = monthBounds(input.month)

  const entitlements = await em.find(HrLeaveEntitlement, {
    ...scoped,
    deletedAt: null,
    ...(input.employeeId ? { employeeId: input.employeeId } : {}),
    ...(input.leaveType ? { leaveType: input.leaveType } : {}),
    periodStart: { $lte: end },
    periodEnd: { $gte: start },
  })
  if (entitlements.length === 0) return { created: 0, skipped: 0, daysAdded: '0.00' }

  const employeeIds = [...new Set(entitlements.map((row) => row.employeeId))]
  const employees = await em.find(HrEmployee, {
    ...scoped,
    deletedAt: null,
    id: { $in: employeeIds },
    status: { $in: ['active', 'on_leave'] },
  })
  const activeEmployeeIds = new Set(employees.map((row) => row.id))

  const existing = await em.find(HrLeaveAccrual, {
    ...scoped,
    employeeId: { $in: employeeIds },
    accrualMonth: start,
  })
  const existingKeys = new Set(existing.map((row) => accrualKey(row.employeeId, row.leaveType, input.month)))

  let created = 0
  let skipped = 0
  let daysAdded = 0
  for (const entitlement of entitlements) {
    if (!activeEmployeeIds.has(entitlement.employeeId)) {
      skipped += 1
      continue
    }
    const key = accrualKey(entitlement.employeeId, entitlement.leaveType, input.month)
    if (existingKeys.has(key)) {
      skipped += 1
      continue
    }
    const days = monthlyAccrualDays(Number(entitlement.entitledDays))
    if (days <= 0) {
      skipped += 1
      continue
    }
    em.create(HrLeaveAccrual, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      employeeId: entitlement.employeeId,
      leaveType: entitlement.leaveType,
      accrualMonth: start,
      days: formatDays(days),
      entitlementId: entitlement.id,
      source: 'monthly',
      createdBy: actorUserId,
      createdAt: new Date(),
    })
    existingKeys.add(key)
    created += 1
    daysAdded += days
  }

  await em.flush()
  return { created, skipped, daysAdded: formatDays(daysAdded) }
}
