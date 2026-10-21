import type { EntityManager } from '@mikro-orm/postgresql'
import { registerCommand, type CommandHandler } from '@open-mercato/shared/lib/commands'
import {
  HrLeaveAccrual,
  HrLeaveEntitlement,
  type LeaveType,
} from '../data/entities'
import {
  createLeaveEntitlementSchema,
  runLeaveAccrualSchema,
  updateLeaveEntitlementSchema,
  type RunLeaveAccrualInput,
} from '../data/validators'
import { registerCrudCommands } from './crud'
import { makeEvents, makeIndexer, scopeFrom } from './hr'
import {
  assertLeaveEntitlementWritable,
  formatDays,
  runLeaveAccrual,
  type LeaveAccrualRunResult,
} from '../lib/leaveBalances'
import eventsConfig from '../events'

const emitHrEvent = eventsConfig.emit

export const HR_LEAVE_ENTITLEMENT_ENTITY_ID = 'hr_management:hr_leave_entitlement' as const
export const HR_LEAVE_ACCRUAL_ENTITY_ID = 'hr_management:hr_leave_accrual' as const

const leaveEntitlementEvents = makeEvents<HrLeaveEntitlement>('leave_entitlement')
const leaveEntitlementIndexer = makeIndexer<HrLeaveEntitlement>(HR_LEAVE_ENTITLEMENT_ENTITY_ID)

function toDate(value: string | Date): Date {
  return value instanceof Date ? value : new Date(`${value.slice(0, 10)}T00:00:00.000Z`)
}

function days(value: unknown): string {
  return formatDays(Number(value ?? 0))
}

registerCrudCommands({
  entity: HrLeaveEntitlement,
  entityId: HR_LEAVE_ENTITLEMENT_ENTITY_ID,
  resource: 'leave_entitlements',
  createSchema: createLeaveEntitlementSchema,
  updateSchema: updateLeaveEntitlementSchema,
  toCreateData: (input) => ({
    ...input,
    periodStart: toDate(String(input.periodStart)),
    periodEnd: toDate(String(input.periodEnd)),
    entitledDays: days(input.entitledDays),
    carryOverDays: days(input.carryOverDays),
  }),
  toUpdateData: (input) => {
    const { id: _id, ...patch } = input
    return {
      ...patch,
      ...(patch.periodStart === undefined ? {} : { periodStart: toDate(String(patch.periodStart)) }),
      ...(patch.periodEnd === undefined ? {} : { periodEnd: toDate(String(patch.periodEnd)) }),
      ...(patch.entitledDays === undefined ? {} : { entitledDays: days(patch.entitledDays) }),
      ...(patch.carryOverDays === undefined ? {} : { carryOverDays: days(patch.carryOverDays) }),
    }
  },
  events: leaveEntitlementEvents,
  indexer: leaveEntitlementIndexer,
  beforeCreate: async (input, scope, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    await assertLeaveEntitlementWritable(em, {
      employeeId: String(input.employeeId),
      leaveType: input.leaveType as LeaveType,
      periodStart: input.periodStart as string | Date,
      periodEnd: input.periodEnd as string | Date,
    }, scope)
  },
  beforeUpdate: async (input, current, scope, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const stored = current as HrLeaveEntitlement
    await assertLeaveEntitlementWritable(em, {
      id: stored.id,
      employeeId: typeof input.employeeId === 'string' ? input.employeeId : stored.employeeId,
      leaveType: (typeof input.leaveType === 'string' ? input.leaveType : stored.leaveType) as LeaveType,
      periodStart: (input.periodStart ?? stored.periodStart) as string | Date,
      periodEnd: (input.periodEnd ?? stored.periodEnd) as string | Date,
    }, scope)
  },
})

const runLeaveAccrualCommand: CommandHandler<RunLeaveAccrualInput, LeaveAccrualRunResult> = {
  id: 'hr_management.leave_accruals.run',
  async execute(raw, ctx) {
    const input = runLeaveAccrualSchema.parse(raw)
    const scope = scopeFrom(ctx)
    const actorUserId = ctx.auth?.sub ?? null
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const result = await em.transactional((trx) => runLeaveAccrual(trx, scope, input, actorUserId))

    await emitHrEvent('hr_management.leave_accrual.run', {
      month: input.month,
      employeeId: input.employeeId ?? null,
      leaveType: input.leaveType ?? null,
      created: result.created,
      skipped: result.skipped,
      daysAdded: result.daysAdded,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    })
    return result
  },
  buildLog: ({ input, result, ctx }) => {
    const scope = scopeFrom(ctx)
    return {
      actionLabel: 'Run leave accrual',
      resourceKind: HR_LEAVE_ACCRUAL_ENTITY_ID,
      resourceId: input.month,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      context: { created: result.created, skipped: result.skipped, daysAdded: result.daysAdded },
    }
  },
}

registerCommand(runLeaveAccrualCommand)
