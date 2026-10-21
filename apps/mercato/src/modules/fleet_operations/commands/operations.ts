import { randomUUID } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import { registerCommand, type CommandHandler, type CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { enforceCommandOptimisticLockWithGuards } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import type { CrudEventsConfig, CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { z } from 'zod'
import {
  FleetFuelLog,
  FleetInsurancePolicy,
  FleetMaintenanceSchedule,
  FleetTrafficViolation,
  FleetWorkOrder,
  FleetWorkOrderLabor,
  FleetWorkOrderPart,
} from '../data/entities'
import {
  completeWorkOrderSchema,
  createFuelLogSchema,
  createInsurancePolicySchema,
  createMaintenanceScheduleSchema,
  createTrafficViolationSchema,
  createWorkOrderLaborSchema,
  createWorkOrderPartSchema,
  createWorkOrderSchema,
  updateFuelLogSchema,
  updateInsurancePolicySchema,
  updateMaintenanceScheduleSchema,
  updateTrafficViolationSchema,
  updateWorkOrderLaborSchema,
  updateWorkOrderPartSchema,
  updateWorkOrderSchema,
} from '../data/validators'
import { computeNextMaintenanceDue, computeWorkOrderTotals } from '../lib/operationsService'
import { emitFleetOperationsEvent } from '../events'
import { registerCrudCommands } from './crud'

export const WORK_ORDER_COMPLETE_COMMAND_ID = 'fleet_operations.work_orders.complete'

type Scope = { tenantId: string; organizationId: string }

function makeEvents<TEntity extends object>(entity: string): CrudEventsConfig<TEntity> {
  return {
    module: 'fleet_operations',
    entity,
    persistent: true,
    buildPayload: ({ identifiers }) => ({
      id: identifiers.id,
      organizationId: identifiers.organizationId,
      tenantId: identifiers.tenantId,
    }),
  }
}

function makeIndexer<TEntity extends object>(entityType: string): CrudIndexerConfig<TEntity> {
  return { entityType }
}

function toDate(value: unknown): Date {
  return value instanceof Date ? value : new Date(String(value))
}

function optionalDate(value: unknown): Date | undefined {
  if (value === undefined || value === null || value === '') return undefined
  return toDate(value)
}

function money(value: unknown, fallback = '0'): string {
  if (value === undefined || value === null || value === '') return fallback
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed.toFixed(4) : fallback
}

function optionalMoney(value: unknown): string | undefined {
  return value === undefined || value === null || value === '' ? undefined : money(value)
}

function patched(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([key]) => key !== 'id'))
}

function requireScope(ctx: CommandRuntimeContext): Scope {
  const tenantId = ctx.auth?.tenantId ?? null
  const organizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
  if (!tenantId || !organizationId) {
    throw new CrudHttpError(400, { error: '[internal] Tenant and organization context are required.' })
  }
  return { tenantId, organizationId }
}

export const maintenanceScheduleEvents = makeEvents<FleetMaintenanceSchedule>('maintenance_schedule')
export const maintenanceScheduleIndexer = makeIndexer<FleetMaintenanceSchedule>('fleet_operations:fleet_maintenance_schedule')
registerCrudCommands({
  entity: FleetMaintenanceSchedule,
  entityId: 'fleet_operations:fleet_maintenance_schedule',
  resource: 'maintenance_schedules',
  createSchema: createMaintenanceScheduleSchema,
  updateSchema: updateMaintenanceScheduleSchema,
  events: maintenanceScheduleEvents,
  indexer: maintenanceScheduleIndexer,
  toCreateData: (input) => ({
    vehicleId: input.vehicleId,
    name: input.name,
    description: input.description ?? null,
    intervalType: input.intervalType ?? 'odometer',
    intervalOdometer: input.intervalOdometer ?? null,
    intervalDays: input.intervalDays ?? null,
    lastServiceOdometer: input.lastServiceOdometer ?? null,
    lastServiceAt: optionalDate(input.lastServiceAt) ?? null,
    nextDueOdometer: input.nextDueOdometer ?? null,
    nextDueAt: optionalDate(input.nextDueAt) ?? null,
    isActive: input.isActive ?? true,
  }) as never,
  toUpdateData: (input) => ({
    ...(input.vehicleId !== undefined ? { vehicleId: input.vehicleId } : {}),
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.description !== undefined ? { description: input.description } : {}),
    ...(input.intervalType !== undefined ? { intervalType: input.intervalType } : {}),
    ...(input.intervalOdometer !== undefined ? { intervalOdometer: input.intervalOdometer } : {}),
    ...(input.intervalDays !== undefined ? { intervalDays: input.intervalDays } : {}),
    ...(input.lastServiceOdometer !== undefined ? { lastServiceOdometer: input.lastServiceOdometer } : {}),
    ...(input.lastServiceAt !== undefined ? { lastServiceAt: optionalDate(input.lastServiceAt) ?? null } : {}),
    ...(input.nextDueOdometer !== undefined ? { nextDueOdometer: input.nextDueOdometer } : {}),
    ...(input.nextDueAt !== undefined ? { nextDueAt: optionalDate(input.nextDueAt) ?? null } : {}),
    ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
  }) as never,
})

export const workOrderEvents = makeEvents<FleetWorkOrder>('work_order')
export const workOrderIndexer = makeIndexer<FleetWorkOrder>('fleet_operations:fleet_work_order')
registerCrudCommands({
  entity: FleetWorkOrder,
  entityId: 'fleet_operations:fleet_work_order',
  resource: 'work_orders',
  createSchema: createWorkOrderSchema,
  updateSchema: updateWorkOrderSchema,
  events: workOrderEvents,
  indexer: workOrderIndexer,
  beforeCreate: async (input) => {
    if (!input.workOrderNumber) {
      input.workOrderNumber = `WO-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${randomUUID().slice(0, 6).toUpperCase()}`
    }
  },
  beforeUpdate: async (input) => {
    if (input.status === 'completed') {
      throw new CrudHttpError(400, { error: 'Use the complete action to close a work order.' })
    }
  },
  toCreateData: (input) => ({
    vehicleId: input.vehicleId,
    scheduleId: input.scheduleId ?? null,
    workOrderNumber: input.workOrderNumber,
    title: input.title,
    description: input.description ?? null,
    status: input.status ?? 'draft',
    priority: input.priority ?? 'normal',
    type: input.type ?? 'corrective',
    odometer: input.odometer ?? null,
    vendorName: input.vendorName ?? null,
    openedAt: optionalDate(input.openedAt) ?? new Date(),
    startedAt: optionalDate(input.startedAt) ?? null,
    completedAt: null,
    downtimeMinutes: input.downtimeMinutes ?? null,
    laborCost: money(input.laborCost),
    partsCost: money(input.partsCost),
    totalCost: money(input.totalCost),
    currencyCode: String(input.currencyCode ?? 'SAR').toUpperCase(),
    notes: input.notes ?? null,
  }) as never,
  toUpdateData: (input) => ({
    ...(input.vehicleId !== undefined ? { vehicleId: input.vehicleId } : {}),
    ...(input.scheduleId !== undefined ? { scheduleId: input.scheduleId } : {}),
    ...(input.workOrderNumber !== undefined ? { workOrderNumber: input.workOrderNumber } : {}),
    ...(input.title !== undefined ? { title: input.title } : {}),
    ...(input.description !== undefined ? { description: input.description } : {}),
    ...(input.status !== undefined ? { status: input.status } : {}),
    ...(input.priority !== undefined ? { priority: input.priority } : {}),
    ...(input.type !== undefined ? { type: input.type } : {}),
    ...(input.odometer !== undefined ? { odometer: input.odometer } : {}),
    ...(input.vendorName !== undefined ? { vendorName: input.vendorName } : {}),
    ...(input.openedAt !== undefined ? { openedAt: optionalDate(input.openedAt) ?? null } : {}),
    ...(input.startedAt !== undefined ? { startedAt: optionalDate(input.startedAt) ?? null } : {}),
    ...(input.completedAt !== undefined ? { completedAt: optionalDate(input.completedAt) ?? null } : {}),
    ...(input.downtimeMinutes !== undefined ? { downtimeMinutes: input.downtimeMinutes } : {}),
    ...(input.laborCost !== undefined ? { laborCost: optionalMoney(input.laborCost) } : {}),
    ...(input.partsCost !== undefined ? { partsCost: optionalMoney(input.partsCost) } : {}),
    ...(input.totalCost !== undefined ? { totalCost: optionalMoney(input.totalCost) } : {}),
    ...(input.currencyCode !== undefined ? { currencyCode: String(input.currencyCode).toUpperCase() } : {}),
    ...(input.notes !== undefined ? { notes: input.notes } : {}),
  }) as never,
})

export const workOrderPartEvents = makeEvents<FleetWorkOrderPart>('work_order_part')
export const workOrderPartIndexer = makeIndexer<FleetWorkOrderPart>('fleet_operations:fleet_work_order_part')
registerCrudCommands({
  entity: FleetWorkOrderPart,
  entityId: 'fleet_operations:fleet_work_order_part',
  resource: 'work_order_parts',
  createSchema: createWorkOrderPartSchema,
  updateSchema: updateWorkOrderPartSchema,
  events: workOrderPartEvents,
  indexer: workOrderPartIndexer,
  beforeUpdate: async (input, current) => {
    const row = current as unknown as { quantity: string; unitCost: string }
    if (input.quantity === undefined) input.quantity = row.quantity
    if (input.unitCost === undefined) input.unitCost = row.unitCost
  },
  toCreateData: (input) => {
    const quantity = money(input.quantity, '1')
    const unitCost = money(input.unitCost)
    return {
      workOrderId: input.workOrderId,
      description: input.description,
      partNumber: input.partNumber ?? null,
      quantity,
      unitCost,
      totalCost: computeWorkOrderTotals([{ quantity, unitCost }], []).partsCost,
    } as never
  },
  toUpdateData: (input) => {
    const data: Record<string, unknown> = {}
    if (input.workOrderId !== undefined) data.workOrderId = input.workOrderId
    if (input.description !== undefined) data.description = input.description
    if (input.partNumber !== undefined) data.partNumber = input.partNumber
    if (input.quantity !== undefined) data.quantity = money(input.quantity, '1')
    if (input.unitCost !== undefined) data.unitCost = money(input.unitCost)
    if (input.quantity !== undefined || input.unitCost !== undefined) {
      const quantity = money(input.quantity ?? (data.quantity as string) ?? '1', '1')
      const unitCost = money(input.unitCost ?? (data.unitCost as string) ?? '0')
      data.totalCost = computeWorkOrderTotals([{ quantity, unitCost }], []).partsCost
    }
    return data as never
  },
})

export const workOrderLaborEvents = makeEvents<FleetWorkOrderLabor>('work_order_labor')
export const workOrderLaborIndexer = makeIndexer<FleetWorkOrderLabor>('fleet_operations:fleet_work_order_labor')
registerCrudCommands({
  entity: FleetWorkOrderLabor,
  entityId: 'fleet_operations:fleet_work_order_labor',
  resource: 'work_order_labor',
  createSchema: createWorkOrderLaborSchema,
  updateSchema: updateWorkOrderLaborSchema,
  events: workOrderLaborEvents,
  indexer: workOrderLaborIndexer,
  beforeUpdate: async (input, current) => {
    const row = current as unknown as { hours: string; rate: string }
    if (input.hours === undefined) input.hours = row.hours
    if (input.rate === undefined) input.rate = row.rate
  },
  toCreateData: (input) => {
    const hours = money(input.hours)
    const rate = money(input.rate)
    return {
      workOrderId: input.workOrderId,
      description: input.description,
      hours,
      rate,
      totalCost: computeWorkOrderTotals([], [{ hours, rate }]).laborCost,
    } as never
  },
  toUpdateData: (input) => {
    const data: Record<string, unknown> = {}
    if (input.workOrderId !== undefined) data.workOrderId = input.workOrderId
    if (input.description !== undefined) data.description = input.description
    if (input.hours !== undefined) data.hours = money(input.hours)
    if (input.rate !== undefined) data.rate = money(input.rate)
    if (input.hours !== undefined || input.rate !== undefined) {
      const hours = money(input.hours ?? (data.hours as string) ?? '0')
      const rate = money(input.rate ?? (data.rate as string) ?? '0')
      data.totalCost = computeWorkOrderTotals([], [{ hours, rate }]).laborCost
    }
    return data as never
  },
})

export const fuelLogEvents = makeEvents<FleetFuelLog>('fuel_log')
export const fuelLogIndexer = makeIndexer<FleetFuelLog>('fleet_operations:fleet_fuel_log')
registerCrudCommands({
  entity: FleetFuelLog,
  entityId: 'fleet_operations:fleet_fuel_log',
  resource: 'fuel_logs',
  createSchema: createFuelLogSchema,
  updateSchema: updateFuelLogSchema,
  events: fuelLogEvents,
  indexer: fuelLogIndexer,
  toCreateData: (input) => {
    const liters = money(input.liters)
    const unitPrice = money(input.unitPrice)
    return {
      vehicleId: input.vehicleId,
      loggedAt: toDate(input.loggedAt),
      odometer: input.odometer ?? null,
      liters,
      unitPrice,
      totalCost: input.totalCost !== undefined
        ? money(input.totalCost)
        : computeWorkOrderTotals([{ quantity: liters, unitCost: unitPrice }], []).partsCost,
      fuelType: input.fuelType ?? 'diesel',
      stationName: input.stationName ?? null,
      fullTank: input.fullTank ?? true,
      driverEmployeeId: input.driverEmployeeId ?? null,
      notes: input.notes ?? null,
    } as never
  },
  toUpdateData: (input) => ({
    ...(input.vehicleId !== undefined ? { vehicleId: input.vehicleId } : {}),
    ...(input.loggedAt !== undefined ? { loggedAt: toDate(input.loggedAt) } : {}),
    ...(input.odometer !== undefined ? { odometer: input.odometer } : {}),
    ...(input.liters !== undefined ? { liters: money(input.liters) } : {}),
    ...(input.unitPrice !== undefined ? { unitPrice: money(input.unitPrice) } : {}),
    ...(input.totalCost !== undefined ? { totalCost: money(input.totalCost) } : {}),
    ...(input.fuelType !== undefined ? { fuelType: input.fuelType } : {}),
    ...(input.stationName !== undefined ? { stationName: input.stationName } : {}),
    ...(input.fullTank !== undefined ? { fullTank: input.fullTank } : {}),
    ...(input.driverEmployeeId !== undefined ? { driverEmployeeId: input.driverEmployeeId } : {}),
    ...(input.notes !== undefined ? { notes: input.notes } : {}),
  }) as never,
})

export const insurancePolicyEvents = makeEvents<FleetInsurancePolicy>('insurance_policy')
export const insurancePolicyIndexer = makeIndexer<FleetInsurancePolicy>('fleet_operations:fleet_insurance_policy')
registerCrudCommands({
  entity: FleetInsurancePolicy,
  entityId: 'fleet_operations:fleet_insurance_policy',
  resource: 'insurance_policies',
  createSchema: createInsurancePolicySchema,
  updateSchema: updateInsurancePolicySchema,
  events: insurancePolicyEvents,
  indexer: insurancePolicyIndexer,
  afterCreate: async (entity) => {
    const policy = entity as FleetInsurancePolicy
    await emitFleetOperationsEvent('fleet_operations.insurance_policy.recorded', {
      id: policy.id,
      tenantId: policy.tenantId,
      organizationId: policy.organizationId,
      vehicleId: policy.vehicleId,
      premiumAmount: policy.premiumAmount,
      currencyCode: policy.currencyCode,
      startDate: policy.startDate instanceof Date ? policy.startDate.toISOString() : policy.startDate,
      endDate: policy.endDate instanceof Date ? policy.endDate.toISOString() : policy.endDate,
    }).catch(() => undefined)
  },
  toCreateData: (input) => ({
    vehicleId: input.vehicleId,
    policyNumber: input.policyNumber,
    insurerName: input.insurerName,
    coverageType: input.coverageType ?? 'comprehensive',
    startDate: toDate(input.startDate),
    endDate: toDate(input.endDate),
    premiumAmount: money(input.premiumAmount),
    currencyCode: String(input.currencyCode ?? 'SAR').toUpperCase(),
    status: input.status ?? 'active',
    notes: input.notes ?? null,
  }) as never,
  toUpdateData: (input) => ({
    ...(input.vehicleId !== undefined ? { vehicleId: input.vehicleId } : {}),
    ...(input.policyNumber !== undefined ? { policyNumber: input.policyNumber } : {}),
    ...(input.insurerName !== undefined ? { insurerName: input.insurerName } : {}),
    ...(input.coverageType !== undefined ? { coverageType: input.coverageType } : {}),
    ...(input.startDate !== undefined ? { startDate: toDate(input.startDate) } : {}),
    ...(input.endDate !== undefined ? { endDate: toDate(input.endDate) } : {}),
    ...(input.premiumAmount !== undefined ? { premiumAmount: money(input.premiumAmount) } : {}),
    ...(input.currencyCode !== undefined ? { currencyCode: String(input.currencyCode).toUpperCase() } : {}),
    ...(input.status !== undefined ? { status: input.status } : {}),
    ...(input.notes !== undefined ? { notes: input.notes } : {}),
  }) as never,
})

export const trafficViolationEvents = makeEvents<FleetTrafficViolation>('traffic_violation')
export const trafficViolationIndexer = makeIndexer<FleetTrafficViolation>('fleet_operations:fleet_traffic_violation')
registerCrudCommands({
  entity: FleetTrafficViolation,
  entityId: 'fleet_operations:fleet_traffic_violation',
  resource: 'traffic_violations',
  createSchema: createTrafficViolationSchema,
  updateSchema: updateTrafficViolationSchema,
  events: trafficViolationEvents,
  indexer: trafficViolationIndexer,
  toCreateData: (input) => ({
    vehicleId: input.vehicleId,
    driverEmployeeId: input.driverEmployeeId ?? null,
    violationNumber: input.violationNumber,
    occurredAt: toDate(input.occurredAt),
    location: input.location ?? null,
    description: input.description ?? null,
    fineAmount: money(input.fineAmount),
    currencyCode: String(input.currencyCode ?? 'SAR').toUpperCase(),
    status: input.status ?? 'open',
    paidAt: optionalDate(input.paidAt) ?? null,
    payrollDeductionRequested: input.payrollDeductionRequested ?? false,
    notes: input.notes ?? null,
  }) as never,
  toUpdateData: (input) => ({
    ...(input.vehicleId !== undefined ? { vehicleId: input.vehicleId } : {}),
    ...(input.driverEmployeeId !== undefined ? { driverEmployeeId: input.driverEmployeeId } : {}),
    ...(input.violationNumber !== undefined ? { violationNumber: input.violationNumber } : {}),
    ...(input.occurredAt !== undefined ? { occurredAt: toDate(input.occurredAt) } : {}),
    ...(input.location !== undefined ? { location: input.location } : {}),
    ...(input.description !== undefined ? { description: input.description } : {}),
    ...(input.fineAmount !== undefined ? { fineAmount: money(input.fineAmount) } : {}),
    ...(input.currencyCode !== undefined ? { currencyCode: String(input.currencyCode).toUpperCase() } : {}),
    ...(input.status !== undefined ? { status: input.status } : {}),
    ...(input.paidAt !== undefined ? { paidAt: optionalDate(input.paidAt) ?? null } : {}),
    ...(input.payrollDeductionRequested !== undefined ? { payrollDeductionRequested: input.payrollDeductionRequested } : {}),
    ...(input.notes !== undefined ? { notes: input.notes } : {}),
  }) as never,
})

const completeWorkOrderCommand: CommandHandler<
  z.infer<typeof completeWorkOrderSchema>,
  { workOrderId: string; totalCost: string }
> = {
  id: WORK_ORDER_COMPLETE_COMMAND_ID,
  async execute(rawInput, ctx) {
    const input = completeWorkOrderSchema.parse(rawInput)
    const scope = requireScope(ctx)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const order = await em.findOne(FleetWorkOrder, {
      id: input.id,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    })
    if (!order) throw new CrudHttpError(404, { error: 'Work order not found.' })
    await enforceCommandOptimisticLockWithGuards(ctx.container, {
      resourceKind: 'fleet_operations:fleet_work_order',
      resourceId: order.id,
      current: order.updatedAt,
      request: ctx.request ?? null,
    })
    if (order.status === 'completed') {
      return { workOrderId: order.id, totalCost: order.totalCost }
    }
    const parts = await em.find(FleetWorkOrderPart, {
      workOrderId: order.id,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    })
    const labor = await em.find(FleetWorkOrderLabor, {
      workOrderId: order.id,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    })
    const totals = computeWorkOrderTotals(parts, labor)
    const completedAt = input.completedAt ? toDate(input.completedAt) : new Date()
    const odometer = input.odometer ?? order.odometer ?? null
    let schedule: FleetMaintenanceSchedule | null = null
    let nextDue: { nextDueAt: Date | null; nextDueOdometer: number | null } | null = null
    if (order.scheduleId) {
      schedule = await em.findOne(FleetMaintenanceSchedule, {
        id: order.scheduleId,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        deletedAt: null,
      })
      if (schedule) {
        nextDue = computeNextMaintenanceDue({ schedule, completedAt, odometer })
      }
    }
    await withAtomicFlush(em, [
      () => {
        order.status = 'completed'
        order.completedAt = completedAt
        order.odometer = odometer
        order.downtimeMinutes = input.downtimeMinutes ?? order.downtimeMinutes ?? null
        order.partsCost = totals.partsCost
        order.laborCost = totals.laborCost
        order.totalCost = totals.totalCost
        order.notes = input.notes ?? order.notes ?? null
        order.updatedAt = new Date()
      },
      () => {
        if (!schedule || !nextDue) return
        schedule.lastServiceAt = completedAt
        schedule.lastServiceOdometer = odometer
        schedule.nextDueAt = nextDue.nextDueAt
        schedule.nextDueOdometer = nextDue.nextDueOdometer
        schedule.updatedAt = new Date()
      },
    ], { transaction: true, label: WORK_ORDER_COMPLETE_COMMAND_ID })
    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine,
      action: 'updated',
      entity: order,
      identifiers: { id: order.id, organizationId: scope.organizationId, tenantId: scope.tenantId },
      actorUserId: ctx.auth?.sub ?? null,
      events: workOrderEvents,
      indexer: workOrderIndexer,
    })
    await emitFleetOperationsEvent('fleet_operations.work_order.completed', {
      id: order.id,
      tenantId: order.tenantId,
      organizationId: order.organizationId,
      vehicleId: order.vehicleId,
      workOrderNumber: order.workOrderNumber,
      totalCost: order.totalCost,
      currencyCode: order.currencyCode,
      completedAt: completedAt.toISOString(),
    }).catch(() => undefined)
    return { workOrderId: order.id, totalCost: order.totalCost }
  },
  buildLog: ({ input, result, ctx }) => {
    const scope = requireScope(ctx)
    return {
      actionLabel: 'Complete work order',
      resourceKind: 'fleet_operations:fleet_work_order',
      resourceId: result.workOrderId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      payload: { undo: { before: { id: input.id, status: 'open' }, after: { id: result.workOrderId, status: 'completed' } } },
    }
  },
}

registerCommand(completeWorkOrderCommand)

export { completeWorkOrderCommand }
