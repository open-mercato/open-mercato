import { LockMode } from '@mikro-orm/postgresql'
import type { EntityManager } from '@mikro-orm/postgresql'
import { registerCommand, type CommandHandler, type CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { enforceCommandOptimisticLockWithGuards } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import {
  StudentSubscription,
  StudentTripAttendance,
  SubscriptionPlan,
} from '../data/entities'
import {
  createPlanSchema,
  createSubscriptionSchema,
  endSubscriptionSchema,
  recordAttendanceSchema,
  subscriptionActionSchema,
  updatePlanSchema,
  updateSubscriptionSchema,
} from '../data/validators'
import { raiseStudentError } from '../lib/errors'
import { toTripDateString } from '../lib/dates'
import { resolvePeriodPrice } from '../lib/subscriptionPricing'
import { registerCrudCommands, resolveScope } from './crud'
import {
  STUDENT_ATTENDANCE_ENTITY_ID,
  STUDENT_PLAN_ENTITY_ID,
  STUDENT_SUBSCRIPTION_ENTITY_ID,
  studentAttendanceEvents,
  studentAttendanceIndexer,
  studentPlanEvents,
  studentPlanIndexer,
  studentSubscriptionEvents,
  studentSubscriptionIndexer,
} from './entities'
import eventsConfig from '../events'

const emitStudentEvent = eventsConfig.emit

type StudentScope = { tenantId: string; organizationId: string }

const NUMBER_PREFIX = 'SS'
const MAX_SEQUENCE = 1_000_000_000

function entityManager(ctx: CommandRuntimeContext): EntityManager {
  return (ctx.container.resolve('em') as EntityManager).fork()
}

function toDate(value: unknown): Date | null {
  if (value === null || value === undefined || value === '') return null
  const date = new Date(String(value))
  return Number.isNaN(date.getTime()) ? null : date
}

function optionalString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

async function allocateSubscriptionNumber(em: EntityManager, scope: StudentScope): Promise<string> {
  const rows = await em.getConnection().execute<{ current_value: number | string }[]>(
    `
      insert into student_subscription_sequences (id, organization_id, tenant_id, current_value, created_at, updated_at)
      values (gen_random_uuid(), ?, ?, 1, now(), now())
      on conflict (organization_id, tenant_id)
      do update set current_value = student_subscription_sequences.current_value + 1, updated_at = now()
      returning current_value
    `,
    [scope.organizationId, scope.tenantId],
  )
  const parsed = Number(rows?.[0]?.current_value ?? 1)
  const sequence = Number.isFinite(parsed) ? Math.min(Math.max(Math.floor(parsed), 1), MAX_SEQUENCE) : 1
  return `${NUMBER_PREFIX}-${String(sequence).padStart(5, '0')}`
}

async function findSubscriptionForUpdate(
  ctx: CommandRuntimeContext,
  tx: EntityManager,
  scope: StudentScope,
  id: string,
): Promise<StudentSubscription> {
  const subscription = await tx.findOne(
    StudentSubscription,
    { id, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null },
    { lockMode: LockMode.PESSIMISTIC_WRITE },
  )
  if (!subscription) return raiseStudentError(404, 'subscription_not_found', 'Subscription not found.')
  await enforceCommandOptimisticLockWithGuards(ctx.container, {
    resourceKind: STUDENT_SUBSCRIPTION_ENTITY_ID,
    resourceId: subscription.id,
    current: subscription.updatedAt,
    request: ctx.request ?? null,
  })
  return subscription
}

async function emitSubscriptionUpdate(ctx: CommandRuntimeContext, subscription: StudentSubscription, scope: StudentScope): Promise<void> {
  const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
  await emitCrudSideEffects({
    dataEngine,
    action: 'updated',
    entity: subscription,
    identifiers: { id: subscription.id, ...scope },
    actorUserId: ctx.auth?.sub ?? null,
    events: studentSubscriptionEvents,
    indexer: studentSubscriptionIndexer,
  })
}

async function emitAttendanceWrite(ctx: CommandRuntimeContext, attendance: StudentTripAttendance, scope: StudentScope, action: 'created' | 'updated'): Promise<void> {
  const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
  await emitCrudSideEffects({
    dataEngine,
    action,
    entity: attendance,
    identifiers: { id: attendance.id, ...scope },
    actorUserId: ctx.auth?.sub ?? null,
    events: studentAttendanceEvents,
    indexer: studentAttendanceIndexer,
  })
}

// ── Plans ────────────────────────────────────────────────────────────────────

const planCrudConfig = {
  entity: SubscriptionPlan,
  entityId: STUDENT_PLAN_ENTITY_ID,
  resource: 'plans',
  createSchema: createPlanSchema,
  updateSchema: updatePlanSchema,
  toCreateData: (input: Record<string, unknown>) => ({
    name: String(input.name),
    code: optionalString(input.code),
    accountType: input.accountType ?? 'b2c',
    duration: input.duration ?? 'monthly',
    priceTwoWay: input.priceTwoWay === undefined ? '0' : String(input.priceTwoWay),
    priceOneWay: input.priceOneWay === undefined ? '0' : String(input.priceOneWay),
    currencyCode: typeof input.currencyCode === 'string' ? input.currencyCode : 'SAR',
    taxRate: input.taxRate === undefined ? '15' : String(input.taxRate),
    isActive: input.isActive === undefined ? true : Boolean(input.isActive),
    notes: optionalString(input.notes),
  }),
  toUpdateData: (input: Record<string, unknown>) => ({
    name: input.name === undefined ? undefined : String(input.name),
    code: input.code === undefined ? undefined : optionalString(input.code),
    accountType: input.accountType,
    duration: input.duration,
    priceTwoWay: input.priceTwoWay === undefined ? undefined : String(input.priceTwoWay),
    priceOneWay: input.priceOneWay === undefined ? undefined : String(input.priceOneWay),
    currencyCode: input.currencyCode,
    taxRate: input.taxRate === undefined ? undefined : String(input.taxRate),
    isActive: input.isActive,
    notes: input.notes === undefined ? undefined : optionalString(input.notes),
  }),
  events: studentPlanEvents,
  indexer: studentPlanIndexer,
}

registerCrudCommands(planCrudConfig as never)

// ── Subscriptions ────────────────────────────────────────────────────────────

const subscriptionCrudConfig = {
  entity: StudentSubscription,
  entityId: STUDENT_SUBSCRIPTION_ENTITY_ID,
  resource: 'subscriptions',
  createSchema: createSubscriptionSchema,
  updateSchema: updateSubscriptionSchema,
  toCreateData: async (input: Record<string, unknown>, ctx: CommandRuntimeContext) => {
    const scope = resolveScope(ctx)
    const em = entityManager(ctx)
    const subscriptionNumber = await allocateSubscriptionNumber(em, scope)
    const direction = (input.direction as StudentSubscription['direction']) ?? 'two_way'
    const plan = input.planId ? await em.findOne(SubscriptionPlan, { id: String(input.planId), tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null }) : null
    if (input.planId && !plan) return raiseStudentError(404, 'plan_not_found', 'Subscription plan not found.')
    // An explicit price wins; otherwise the plan's price for the direction is
    // snapshotted onto the subscription.
    const periodPrice = input.periodPrice !== undefined && input.periodPrice !== null
      ? String(input.periodPrice)
      : plan
        ? resolvePeriodPrice(direction, plan)
        : '0'
    return {
      subscriptionNumber,
      status: 'draft',
      studentName: String(input.studentName),
      studentGrade: optionalString(input.studentGrade),
      guardianName: optionalString(input.guardianName),
      guardianPhone: optionalString(input.guardianPhone),
      accountType: input.accountType ?? 'b2c',
      direction,
      duration: input.duration ?? plan?.duration ?? 'monthly',
      plan,
      planSnapshot: plan ? { id: plan.id, name: plan.name, code: plan.code ?? null, duration: plan.duration } : null,
      customerId: String(input.customerId),
      customerSnapshot: input.customerSnapshot as Record<string, unknown>,
      schoolCustomerId: (input.schoolCustomerId as string | null | undefined) ?? null,
      schoolSnapshot: (input.schoolSnapshot as Record<string, unknown> | null | undefined) ?? null,
      pickupPoint: optionalString(input.pickupPoint),
      dropoffPoint: optionalString(input.dropoffPoint),
      transportRouteId: (input.transportRouteId as string | null | undefined) ?? null,
      vehicleId: (input.vehicleId as string | null | undefined) ?? null,
      driverId: (input.driverId as string | null | undefined) ?? null,
      startDate: toDate(input.startDate),
      endDate: toDate(input.endDate),
      periodPrice,
      currencyCode: typeof input.currencyCode === 'string' ? input.currencyCode : plan?.currencyCode ?? 'SAR',
      taxRate: input.taxRate === undefined ? (plan?.taxRate ?? '15') : String(input.taxRate),
      notes: optionalString(input.notes),
    } as never
  },
  toUpdateData: async (input: Record<string, unknown>, current: StudentSubscription, ctx: CommandRuntimeContext) => {
    const scope = resolveScope(ctx)
    const em = entityManager(ctx)
    const direction = (input.direction as StudentSubscription['direction']) ?? current.direction
    const planId = input.planId === undefined
      ? (current.plan ? (typeof current.plan === 'string' ? current.plan : current.plan.id) : null)
      : input.planId
    const plan = planId
      ? await em.findOne(SubscriptionPlan, { id: String(planId), tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null })
      : null
    if (planId && !plan) return raiseStudentError(404, 'plan_not_found', 'Subscription plan not found.')
    const periodPrice = input.periodPrice === undefined
      ? (plan ? resolvePeriodPrice(direction, plan) : current.periodPrice)
      : String(input.periodPrice)
    return {
      studentName: input.studentName === undefined ? undefined : String(input.studentName),
      studentGrade: input.studentGrade === undefined ? undefined : optionalString(input.studentGrade),
      guardianName: input.guardianName === undefined ? undefined : optionalString(input.guardianName),
      guardianPhone: input.guardianPhone === undefined ? undefined : optionalString(input.guardianPhone),
      accountType: input.accountType,
      direction: input.direction,
      duration: input.duration,
      plan,
      planSnapshot: plan ? { id: plan.id, name: plan.name, code: plan.code ?? null, duration: plan.duration } : current.planSnapshot ?? null,
      customerId: input.customerId === undefined ? undefined : String(input.customerId),
      customerSnapshot: input.customerSnapshot,
      schoolCustomerId: input.schoolCustomerId,
      schoolSnapshot: input.schoolSnapshot,
      pickupPoint: input.pickupPoint === undefined ? undefined : optionalString(input.pickupPoint),
      dropoffPoint: input.dropoffPoint === undefined ? undefined : optionalString(input.dropoffPoint),
      transportRouteId: input.transportRouteId,
      vehicleId: input.vehicleId,
      driverId: input.driverId,
      startDate: input.startDate === undefined ? undefined : toDate(input.startDate),
      endDate: input.endDate === undefined ? undefined : toDate(input.endDate),
      periodPrice,
      currencyCode: input.currencyCode,
      taxRate: input.taxRate === undefined ? undefined : String(input.taxRate),
      notes: input.notes === undefined ? undefined : optionalString(input.notes),
    } as never
  },
  events: studentSubscriptionEvents,
  indexer: studentSubscriptionIndexer,
  beforeDelete: async (current: StudentSubscription, _scope: StudentScope, ctx: CommandRuntimeContext) => {
    if (current.status !== 'draft') {
      return raiseStudentError(409, 'subscription_not_deletable', 'Only a draft subscription can be deleted.')
    }
    const em = entityManager(ctx)
    const scope = resolveScope(ctx)
    const attendance = await em.count(StudentTripAttendance, {
      subscription: current.id,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    })
    if (attendance > 0) {
      return raiseStudentError(409, 'subscription_has_attendance', 'A subscription with recorded attendance cannot be deleted — end it instead.')
    }
  },
}

registerCrudCommands(subscriptionCrudConfig as never)

type SubscriptionTransition = {
  action: 'activate' | 'suspend'
  event: Parameters<typeof emitStudentEvent>[0]
  from: Array<StudentSubscription['status']>
  to: StudentSubscription['status']
}

const SUBSCRIPTION_TRANSITIONS: SubscriptionTransition[] = [
  { action: 'activate', event: 'student_transport.subscription.activated', from: ['draft', 'suspended'], to: 'active' },
  { action: 'suspend', event: 'student_transport.subscription.suspended', from: ['active'], to: 'suspended' },
]

for (const transition of SUBSCRIPTION_TRANSITIONS) {
  const command: CommandHandler<Record<string, unknown>, { subscriptionId: string }> = {
    id: `student_transport.subscriptions.${transition.action}`,
    async execute(rawInput, ctx) {
      const input = subscriptionActionSchema.parse(rawInput)
      const scope = resolveScope(ctx)
      const em = entityManager(ctx)
      const subscription = await em.transactional(async (tx) => {
        const locked = await findSubscriptionForUpdate(ctx, tx, scope, input.id)
        if (!transition.from.includes(locked.status)) {
          return raiseStudentError(409, 'subscription_status_invalid', 'The subscription is not in a state that allows this action.')
        }
        const now = new Date()
        locked.status = transition.to
        locked.updatedAt = now
        await tx.persist(locked).flush()
        return locked
      })
      await emitSubscriptionUpdate(ctx, subscription, scope)
      await emitStudentEvent(transition.event, {
        id: subscription.id,
        subscriptionNumber: subscription.subscriptionNumber,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      })
      return { subscriptionId: subscription.id }
    },
    buildLog: ({ input, ctx }) => {
      const scope = resolveScope(ctx)
      return {
        actionLabel: `${transition.action} student subscription`,
        resourceKind: STUDENT_SUBSCRIPTION_ENTITY_ID,
        resourceId: String(input.id ?? ''),
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      }
    },
  }
  registerCommand(command)
}

const endSubscriptionCommand: CommandHandler<Record<string, unknown>, { subscriptionId: string }> = {
  id: 'student_transport.subscriptions.end',
  async execute(rawInput, ctx) {
    const input = endSubscriptionSchema.parse(rawInput)
    const scope = resolveScope(ctx)
    const em = entityManager(ctx)
    const subscription = await em.transactional(async (tx) => {
      const locked = await findSubscriptionForUpdate(ctx, tx, scope, input.id)
      if (locked.status === 'ended') {
        return raiseStudentError(409, 'subscription_status_invalid', 'The subscription is already ended.')
      }
      const now = new Date()
      locked.status = 'ended'
      locked.endDate = locked.endDate ?? now
      if (optionalString(input.reason)) {
        locked.notes = [locked.notes, optionalString(input.reason)].filter(Boolean).join('\n')
      }
      locked.updatedAt = now
      await tx.persist(locked).flush()
      return locked
    })
    await emitSubscriptionUpdate(ctx, subscription, scope)
    await emitStudentEvent('student_transport.subscription.ended', {
      id: subscription.id,
      subscriptionNumber: subscription.subscriptionNumber,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    })
    return { subscriptionId: subscription.id }
  },
  buildLog: ({ input, ctx }) => {
    const scope = resolveScope(ctx)
    return {
      actionLabel: 'End student subscription',
      resourceKind: STUDENT_SUBSCRIPTION_ENTITY_ID,
      resourceId: String(input.id ?? ''),
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    }
  },
}

registerCommand(endSubscriptionCommand)

// ── Attendance ───────────────────────────────────────────────────────────────

/**
 * Records (or corrects) one leg of one day for one child.
 *
 * The board is worked in real time, so the same slot is written twice — the
 * driver marks boarded, the app corrects it to absent — and the row is upserted
 * per (subscription, date, leg) rather than appended: the unique index enforces
 * that shape at the database level.
 */
const recordAttendanceCommand: CommandHandler<Record<string, unknown>, { attendanceId: string }> = {
  id: 'student_transport.attendance.record',
  async execute(rawInput, ctx) {
    const input = recordAttendanceSchema.parse(rawInput)
    const scope = resolveScope(ctx)
    const em = entityManager(ctx)
    const tripDate = new Date(`${toTripDateString(input.tripDate)}T00:00:00.000Z`)

    const result = await em.transactional(async (tx) => {
      const subscription = await tx.findOne(
        StudentSubscription,
        { id: input.subscriptionId, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null },
        { lockMode: LockMode.PESSIMISTIC_WRITE },
      )
      if (!subscription) return raiseStudentError(404, 'subscription_not_found', 'Subscription not found.')
      if (subscription.status === 'ended') {
        return raiseStudentError(409, 'subscription_ended', 'An ended subscription takes no attendance.')
      }
      const now = new Date()
      const existing = await tx.findOne(StudentTripAttendance, {
        subscription: subscription.id,
        tripDate,
        leg: input.leg,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        deletedAt: null,
      })
      if (existing) {
        existing.status = input.status
        existing.origin = input.origin ?? 'staff'
        existing.notes = input.notes === undefined ? existing.notes ?? null : optionalString(input.notes)
        existing.vehicleId = input.vehicleId ?? subscription.vehicleId ?? existing.vehicleId ?? null
        existing.driverId = input.driverId ?? subscription.driverId ?? existing.driverId ?? null
        existing.recordedAt = now
        existing.recordedBy = ctx.auth?.sub ?? null
        existing.updatedAt = now
        await tx.persist(existing).flush()
        return { attendance: existing, action: 'updated' as const }
      }
      const created = tx.create(StudentTripAttendance, {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        subscription,
        tripDate,
        leg: input.leg,
        status: input.status,
        origin: input.origin ?? 'staff',
        notes: optionalString(input.notes),
        vehicleId: input.vehicleId ?? subscription.vehicleId ?? null,
        driverId: input.driverId ?? subscription.driverId ?? null,
        recordedAt: now,
        recordedBy: ctx.auth?.sub ?? null,
        createdAt: now,
        updatedAt: now,
      })
      await tx.persist(created).flush()
      return { attendance: created, action: 'created' as const }
    })

    await emitAttendanceWrite(ctx, result.attendance, scope, result.action)
    if (input.status === 'absent_notified' && result.action === 'created') {
      await emitStudentEvent('student_transport.attendance.absence_reported', {
        id: result.attendance.id,
        subscriptionId: input.subscriptionId,
        tripDate: toTripDateString(input.tripDate),
        leg: input.leg,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      })
    }
    return { attendanceId: result.attendance.id }
  },
  buildLog: ({ input, ctx }) => {
    const scope = resolveScope(ctx)
    return {
      actionLabel: 'Record student attendance',
      resourceKind: STUDENT_ATTENDANCE_ENTITY_ID,
      resourceId: String(input.subscriptionId ?? ''),
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    }
  },
}

registerCommand(recordAttendanceCommand)
