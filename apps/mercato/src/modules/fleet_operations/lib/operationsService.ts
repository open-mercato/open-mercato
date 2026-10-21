import { multiplyDecimalStrings, roundDecimalHalfUp, sumDecimalStrings } from '../../financial/lib/money'

export type WorkOrderPartCost = { quantity: string | number; unitCost: string | number }
export type WorkOrderLaborCost = { hours: string | number; rate: string | number }

export function computeWorkOrderTotals(
  parts: WorkOrderPartCost[],
  labor: WorkOrderLaborCost[],
): { partsCost: string; laborCost: string; totalCost: string } {
  const partsCost = roundDecimalHalfUp(
    sumDecimalStrings(parts.map((part) => multiplyDecimalStrings(part.quantity, part.unitCost, 6))),
    2,
  )
  const laborCost = roundDecimalHalfUp(
    sumDecimalStrings(labor.map((entry) => multiplyDecimalStrings(entry.hours, entry.rate, 6))),
    2,
  )
  return {
    partsCost,
    laborCost,
    totalCost: roundDecimalHalfUp(sumDecimalStrings([partsCost, laborCost]), 2),
  }
}

export type MaintenanceScheduleLike = {
  intervalType: 'odometer' | 'date' | 'both'
  intervalOdometer?: number | null
  intervalDays?: number | null
}

export function computeNextMaintenanceDue(input: {
  schedule: MaintenanceScheduleLike
  completedAt: Date
  odometer?: number | null
}): { nextDueAt: Date | null; nextDueOdometer: number | null } {
  const { schedule, completedAt, odometer } = input
  const nextDueAt = schedule.intervalDays && schedule.intervalDays > 0
    ? new Date(completedAt.getTime() + schedule.intervalDays * 24 * 60 * 60 * 1000)
    : null
  const nextDueOdometer = schedule.intervalOdometer && schedule.intervalOdometer > 0
    && typeof odometer === 'number' && Number.isFinite(odometer)
    ? odometer + schedule.intervalOdometer
    : null
  return {
    nextDueAt: schedule.intervalType === 'odometer' ? null : nextDueAt,
    nextDueOdometer: schedule.intervalType === 'date' ? null : nextDueOdometer,
  }
}

export type FuelLogLike = {
  odometer?: number | null
  liters: string | number
  totalCost: string | number
  fullTank?: boolean
}

export function computeFuelEfficiency(logs: FuelLogLike[]): {
  totalLiters: string
  totalCost: string
  distanceKm: number
  kmPerLiter: number | null
} {
  const sorted = logs
    .filter((log) => typeof log.odometer === 'number' && Number.isFinite(log.odometer))
    .sort((left, right) => (left.odometer as number) - (right.odometer as number))
  const first = sorted[0]?.odometer
  const last = sorted[sorted.length - 1]?.odometer
  const distanceKm = typeof first === 'number' && typeof last === 'number'
    ? Math.max(0, last - first)
    : 0
  const totalLiters = roundDecimalHalfUp(sumDecimalStrings(logs.map((log) => log.liters)), 3)
  const totalCost = roundDecimalHalfUp(sumDecimalStrings(logs.map((log) => log.totalCost)), 2)
  const litersValue = Number(totalLiters)
  return {
    totalLiters,
    totalCost,
    distanceKm,
    kmPerLiter: distanceKm > 0 && litersValue > 0
      ? Math.round((distanceKm / litersValue) * 100) / 100
      : null,
  }
}

export type ExpiringPolicyLike = {
  endDate: Date | string
  status: string
}

export function daysUntil(value: Date | string, now = new Date()): number {
  const date = value instanceof Date ? value : new Date(value)
  return Math.ceil((date.getTime() - now.getTime()) / (24 * 60 * 60 * 1000))
}

export function isPolicyExpiringSoon(policy: ExpiringPolicyLike, now = new Date(), windowDays = 30): boolean {
  if (policy.status !== 'active') return false
  const remaining = daysUntil(policy.endDate, now)
  return remaining >= 0 && remaining <= windowDays
}

export type OperationsSummary = {
  openWorkOrders: number
  overdueSchedules: number
  expiringPolicies: number
  openViolations: number
  fuelCost30d: string
  maintenanceCost30d: string
}

export function summarizeOperations(input: {
  workOrders: Array<{ status: string; totalCost: string | number; completedAt?: Date | string | null }>
  schedules: Array<{ isActive: boolean; nextDueAt?: Date | string | null; nextDueOdometer?: number | null; currentOdometer?: number | null }>
  policies: ExpiringPolicyLike[]
  violations: Array<{ status: string }>
  fuelLogs: Array<{ loggedAt: Date | string; totalCost: string | number }>
  now?: Date
}): OperationsSummary {
  const now = input.now ?? new Date()
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
  const wasRecent = (value: Date | string | null | undefined): value is Date | string => {
    if (!value) return false
    const date = value instanceof Date ? value : new Date(value)
    return date.getTime() >= thirtyDaysAgo.getTime()
  }
  const overdueSchedules = input.schedules.filter((schedule) => {
    if (!schedule.isActive) return false
    const dueAt = schedule.nextDueAt ? new Date(schedule.nextDueAt).getTime() : null
    const dateOverdue = dueAt !== null && dueAt < now.getTime()
    const odometerOverdue = typeof schedule.nextDueOdometer === 'number'
      && typeof schedule.currentOdometer === 'number'
      && schedule.currentOdometer >= schedule.nextDueOdometer
    return dateOverdue || odometerOverdue
  }).length
  return {
    openWorkOrders: input.workOrders.filter((order) => order.status === 'open' || order.status === 'in_progress').length,
    overdueSchedules,
    expiringPolicies: input.policies.filter((policy) => isPolicyExpiringSoon(policy, now)).length,
    openViolations: input.violations.filter((violation) => violation.status === 'open' || violation.status === 'appealed').length,
    fuelCost30d: roundDecimalHalfUp(
      sumDecimalStrings(input.fuelLogs.filter((log) => wasRecent(log.loggedAt)).map((log) => log.totalCost)),
      2,
    ),
    maintenanceCost30d: roundDecimalHalfUp(
      sumDecimalStrings(input.workOrders
        .filter((order) => order.status === 'completed' && wasRecent(order.completedAt))
        .map((order) => order.totalCost)),
      2,
    ),
  }
}
