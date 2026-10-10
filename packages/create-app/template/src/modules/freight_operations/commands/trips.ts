import { LockMode } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { registerCommand, type CommandHandler, type CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { enforceCommandOptimisticLockWithGuards } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { ModuleConfigService } from '@open-mercato/core/modules/configs/lib/module-config-service'
import { FreightContract, FreightContractRoute, FreightOrder, FreightTrip, FreightTripCharge } from '../data/entities'
import {
  createTripSchema,
  setTripChargesSchema,
  tripActionSchema,
  tripDeliverSchema,
  updateTripSchema,
  type SetTripChargesInput,
} from '../data/validators'
import { registerCrudCommands, resolveScope, type CrudCommandConfig } from './crud'
import { FREIGHT_TRIP_ENTITY_ID, freightTripEvents, freightTripIndexer } from './entities'
import { raiseFreightError } from '../lib/errors'
import { readFreightSettings, type FreightScope } from '../lib/freightSettings'
import { allocateDocumentNumber } from '../lib/documentNumber'
import { assertFreightAssignmentAvailable } from '../lib/assignment'
import { computeChargeAmount, computeTripPricing } from '../lib/tripPricing'
import { amountToString } from '../lib/money'
import { emitFreightEvent } from '../events'

const ONE_DAY_MS = 24 * 60 * 60 * 1000

function compact(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined))
}

function toDate(value: unknown): Date | null {
  if (value === null || value === undefined || value === '') return null
  if (value instanceof Date) return value
  const parsed = new Date(`${String(value)}T00:00:00.000Z`)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function entityManager(ctx: CommandRuntimeContext): EntityManager {
  return (ctx.container.resolve('em') as EntityManager).fork()
}

async function loadSettings(ctx: CommandRuntimeContext, scope: FreightScope) {
  const configService = ctx.container.resolve('moduleConfigService') as ModuleConfigService
  return readFreightSettings(configService, scope)
}

async function findTripForUpdate(
  ctx: CommandRuntimeContext,
  em: EntityManager,
  scope: FreightScope,
  id: string,
): Promise<FreightTrip> {
  const trip = await em.findOne(
    FreightTrip,
    { id, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null },
    { lockMode: LockMode.PESSIMISTIC_WRITE },
  )
  if (!trip) return raiseFreightError(404, 'trip_not_found', 'Freight trip not found.')
  await enforceCommandOptimisticLockWithGuards(ctx.container, {
    resourceKind: FREIGHT_TRIP_ENTITY_ID,
    resourceId: trip.id,
    current: trip.updatedAt,
    request: ctx.request ?? null,
  })
  return trip
}

async function assertTripEditableOrRaise(trip: FreightTrip): Promise<void> {
  if (trip.billingStatus !== 'unbilled') {
    return raiseFreightError(409, 'trip_locked', 'The trip is part of an abstract and cannot be changed.')
  }
}

async function emitTripUpdate(
  ctx: CommandRuntimeContext,
  trip: FreightTrip,
  scope: FreightScope,
): Promise<void> {
  const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
  await emitCrudSideEffects({
    dataEngine,
    action: 'updated',
    entity: trip,
    identifiers: { id: trip.id, ...scope },
    actorUserId: ctx.auth?.sub ?? null,
    events: freightTripEvents,
    indexer: freightTripIndexer,
  })
}

async function emitTripLifecycle(
  eventId: Parameters<typeof emitFreightEvent>[0],
  trip: FreightTrip,
  scope: FreightScope,
): Promise<void> {
  await emitFreightEvent(eventId, {
    id: trip.id,
    tripNumber: trip.tripNumber,
    customerId: trip.customerId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
  })
}

type TripSnapshotData = {
  customerId: string
  customerSnapshot: Record<string, unknown>
  transportRouteId: string | null
  routeCodeSnapshot: string | null
  origin: string
  destination: string
  rateBasis: FreightTrip['rateBasis']
  unitPriceNet: string
  minimumCharge: string | null
  vatRatePercent: string
  currencyCode: string
}

async function resolveContractTripContext(
  em: EntityManager,
  scope: FreightScope,
  contractId: string,
  contractRouteId: string,
  executionDate: Date,
): Promise<{ contract: FreightContract; rateLine: FreightContractRoute; snapshot: TripSnapshotData }> {
  const contract = await em.findOne(FreightContract, {
    id: contractId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    deletedAt: null,
  })
  if (!contract) return raiseFreightError(404, 'contract_not_found', 'Freight contract not found.')
  if (contract.status !== 'active') {
    return raiseFreightError(409, 'contract_not_active_for_trips', 'Trips can only be recorded against an active contract.')
  }
  if (executionDate.getTime() < contract.validFrom.getTime() || executionDate.getTime() > contract.validTo.getTime()) {
    return raiseFreightError(409, 'trip_outside_contract_window', 'The trip date falls outside the contract validity period.')
  }

  const rateLine = await em.findOne(FreightContractRoute, {
    id: contractRouteId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    contract: contract.id,
    deletedAt: null,
  })
  if (!rateLine) return raiseFreightError(409, 'rate_line_not_found', 'The selected rate line does not belong to this contract.')
  if (!rateLine.isActive) {
    return raiseFreightError(409, 'rate_line_not_effective', 'The selected rate line is not active.')
  }
  if (rateLine.effectiveFrom && executionDate.getTime() < rateLine.effectiveFrom.getTime()) {
    return raiseFreightError(409, 'rate_line_not_effective', 'The selected rate line is not effective on the trip date.')
  }
  if (rateLine.effectiveTo && executionDate.getTime() > rateLine.effectiveTo.getTime()) {
    return raiseFreightError(409, 'rate_line_not_effective', 'The selected rate line is not effective on the trip date.')
  }

  return {
    contract,
    rateLine,
    snapshot: {
      customerId: contract.customerId,
      customerSnapshot: contract.customerSnapshot,
      transportRouteId: rateLine.transportRouteId ?? null,
      routeCodeSnapshot: rateLine.routeCodeSnapshot ?? null,
      origin: rateLine.origin,
      destination: rateLine.destination,
      rateBasis: rateLine.rateBasis,
      unitPriceNet: rateLine.rateAmount,
      minimumCharge: rateLine.minimumCharge ?? null,
      vatRatePercent: rateLine.vatRateOverride ?? contract.vatRate,
      currencyCode: contract.currencyCode,
    },
  }
}

async function resolveSpotTripContext(
  em: EntityManager,
  scope: FreightScope,
  orderId: string,
): Promise<TripSnapshotData> {
  const order = await em.findOne(FreightOrder, {
    id: orderId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    deletedAt: null,
  })
  if (!order) return raiseFreightError(404, 'order_not_found', 'Freight order not found.')
  if (order.status === 'draft' || order.status === 'cancelled' || order.status === 'invoiced') {
    return raiseFreightError(409, 'order_not_trip_ready', 'A trip can only be recorded against a confirmed or executed order.')
  }
  const net =
    Number(order.agreedAmountNet ?? 0) + Number(order.adjustmentAmountNet ?? 0)
  return {
    customerId: order.customerId,
    customerSnapshot: order.customerSnapshot,
    transportRouteId: null,
    routeCodeSnapshot: null,
    origin: order.pickupLocation,
    destination: order.dropoffLocation,
    rateBasis: 'per_trip',
    unitPriceNet: amountToString(net),
    minimumCharge: null,
    vatRatePercent: order.vatRate,
    currencyCode: order.currencyCode,
  }
}

type TripPricingContext = {
  unitPriceNet: string
  minimumCharge: string | null
  vatRatePercent: string
}

function computeTotalsFor(
  trip: TripPricingContext & { quantity: string | number },
  charges: Array<{ quantity?: string | null; unitAmountNet: string; isTaxable?: boolean; billable?: boolean }>,
) {
  return computeTripPricing({
    quantity: trip.quantity,
    unitPriceNet: trip.unitPriceNet,
    minimumCharge: trip.minimumCharge,
    vatRatePercent: trip.vatRatePercent,
    charges: charges.map((charge) => ({
      quantity: charge.quantity ?? '1',
      unitAmountNet: charge.unitAmountNet,
      isTaxable: charge.isTaxable,
      billable: charge.billable,
    })),
  })
}

const tripCrudConfig: CrudCommandConfig<FreightTrip> = {
  entity: FreightTrip,
  entityId: FREIGHT_TRIP_ENTITY_ID,
  resource: 'trips',
  createSchema: createTripSchema,
  updateSchema: updateTripSchema,
  toCreateData: async (input, ctx) => {
    const scope = resolveScope(ctx)
    const em = entityManager(ctx)
    const settings = await loadSettings(ctx, scope)
    const tripNumber = await allocateDocumentNumber(em, scope, 'trip', settings)
    const executionDate = toDate(input.executionDate)
    if (!executionDate) return raiseFreightError(400, 'invalid_execution_date', 'A valid execution date is required.')
    const quantity = (input.quantity as string | undefined) ?? '1'

    const isSpot = input.source === 'spot'
    const snapshot = isSpot
      ? await resolveSpotTripContext(em, scope, String(input.freightOrderId))
      : (await resolveContractTripContext(
          em,
          scope,
          String(input.contractId),
          String(input.contractRouteId),
          executionDate,
        )).snapshot

    if (input.vehicleId && input.driverId) {
      await assertFreightAssignmentAvailable(
        em,
        {
          vehicleId: String(input.vehicleId),
          driverId: String(input.driverId),
          start: executionDate,
          end: new Date(executionDate.getTime() + ONE_DAY_MS),
        },
        scope,
      )
    }

    const totals = computeTotalsFor(
      { unitPriceNet: snapshot.unitPriceNet, minimumCharge: snapshot.minimumCharge, vatRatePercent: snapshot.vatRatePercent, quantity },
      [],
    )

    return {
      tripNumber,
      source: isSpot ? ('spot' as const) : ('contract' as const),
      contractId: isSpot ? null : String(input.contractId),
      contractRouteId: isSpot ? null : String(input.contractRouteId),
      freightOrderId: isSpot ? String(input.freightOrderId) : null,
      customerId: snapshot.customerId,
      customerSnapshot: snapshot.customerSnapshot,
      executionDate,
      transportRouteId: snapshot.transportRouteId,
      routeCodeSnapshot: snapshot.routeCodeSnapshot,
      origin: snapshot.origin,
      destination: snapshot.destination,
      rateBasis: snapshot.rateBasis,
      quantity,
      unitPriceNet: snapshot.unitPriceNet,
      minimumChargeApplied: totals.minimumChargeApplied,
      baseAmountNet: totals.baseAmountNet,
      chargesTotalNet: totals.chargesTotalNet,
      totalNetAmount: totals.totalNetAmount,
      taxRate: snapshot.vatRatePercent,
      taxAmount: totals.taxAmount,
      totalGrossAmount: totals.totalGrossAmount,
      currencyCode: snapshot.currencyCode,
      vehicleId: (input.vehicleId as string | null | undefined) ?? null,
      driverId: (input.driverId as string | null | undefined) ?? null,
      transportTripId: (input.transportTripId as string | null | undefined) ?? null,
      executionStatus: 'planned' as const,
      billingStatus: 'unbilled' as const,
      actualStartAt: input.actualStartAt ? new Date(String(input.actualStartAt)) : null,
      actualEndAt: input.actualEndAt ? new Date(String(input.actualEndAt)) : null,
      waitingMinutes: input.waitingMinutes === undefined || input.waitingMinutes === null ? null : Number(input.waitingMinutes),
      distanceKm: (input.distanceKm as string | null | undefined) ?? null,
      notes: (input.notes as string | null | undefined) ?? null,
    }
  },
  toUpdateData: async (input, current, ctx) => {
    const trip = current as FreightTrip
    const scope = resolveScope(ctx)
    const em = entityManager(ctx)
    const quantity = input.quantity === undefined ? trip.quantity : String(input.quantity)
    // Existing charges stay attached to the trip, so the recomputation has to
    // include them — dropping them here would silently un-bill a trip's extras.
    const charges = await em.find(FreightTripCharge, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      trip: trip.id,
      deletedAt: null,
    })
    const totals = computeTotalsFor(
      {
        unitPriceNet: trip.unitPriceNet,
        minimumCharge: trip.minimumChargeApplied ?? null,
        vatRatePercent: trip.taxRate,
        quantity,
      },
      charges.map((charge) => ({
        quantity: charge.quantity,
        unitAmountNet: charge.unitAmountNet,
        isTaxable: charge.isTaxable,
        billable: charge.billable,
      })),
    )
    return compact({
      executionDate: toDate(input.executionDate),
      quantity,
      vehicleId: input.vehicleId,
      driverId: input.driverId,
      transportTripId: input.transportTripId,
      actualStartAt: input.actualStartAt ? new Date(String(input.actualStartAt)) : undefined,
      actualEndAt: input.actualEndAt ? new Date(String(input.actualEndAt)) : undefined,
      waitingMinutes: input.waitingMinutes,
      distanceKm: input.distanceKm,
      notes: input.notes,
      baseAmountNet: totals.baseAmountNet,
      minimumChargeApplied: totals.minimumChargeApplied,
      totalNetAmount: totals.totalNetAmount,
      taxAmount: totals.taxAmount,
      totalGrossAmount: totals.totalGrossAmount,
    })
  },
  events: freightTripEvents,
  indexer: freightTripIndexer,
  beforeUpdate: async (_input, current) => {
    await assertTripEditableOrRaise(current as FreightTrip)
  },
  beforeDelete: async (current) => {
    await assertTripEditableOrRaise(current as FreightTrip)
  },
}

registerCrudCommands(tripCrudConfig)

const setTripChargesCommand: CommandHandler<SetTripChargesInput, { tripId: string }> = {
  id: 'freight_operations.trips.set_charges',
  async execute(rawInput, ctx) {
    const input = setTripChargesSchema.parse(rawInput)
    const scope = resolveScope(ctx)
    const em = entityManager(ctx)
    const trip = await em.transactional(async (tx) => {
      const locked = await findTripForUpdate(ctx, tx, scope, input.id)
      await assertTripEditableOrRaise(locked)

      const existing = await tx.find(FreightTripCharge, {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        trip: locked.id,
        deletedAt: null,
      })
      const now = new Date()
      for (const row of existing) {
        row.deletedAt = now
        row.updatedAt = now
        tx.persist(row)
      }

      const created: FreightTripCharge[] = input.charges.map((charge) => tx.create(FreightTripCharge, {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        trip: locked,
        kind: charge.kind,
        description: charge.description ?? null,
        quantity: charge.quantity === undefined ? '1' : String(charge.quantity),
        unitAmountNet: String(charge.unitAmountNet),
        amountNet: amountToString(computeChargeAmount({
          quantity: charge.quantity === undefined ? '1' : String(charge.quantity),
          unitAmountNet: String(charge.unitAmountNet),
        })),
        isTaxable: charge.isTaxable === undefined ? true : charge.isTaxable,
        billable: charge.billable === undefined ? true : charge.billable,
        position: charge.position ?? 0,
        createdAt: now,
        updatedAt: now,
      }))

      const totals = computeTotalsFor(
        {
          unitPriceNet: locked.unitPriceNet,
          minimumCharge: locked.minimumChargeApplied ?? null,
          vatRatePercent: locked.taxRate,
          quantity: locked.quantity,
        },
        created.map((charge) => ({
          quantity: charge.quantity,
          unitAmountNet: charge.unitAmountNet,
          isTaxable: charge.isTaxable,
          billable: charge.billable,
        })),
      )
      locked.chargesTotalNet = totals.chargesTotalNet
      locked.totalNetAmount = totals.totalNetAmount
      locked.taxAmount = totals.taxAmount
      locked.totalGrossAmount = totals.totalGrossAmount
      locked.updatedAt = now
      tx.persist(locked)
      await tx.flush()
      return locked
    })

    await emitTripUpdate(ctx, trip, scope)
    await emitFreightEvent('freight_operations.trip.updated', {
      id: trip.id,
      tripNumber: trip.tripNumber,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    })
    return { tripId: trip.id }
  },
  buildLog: ({ input, ctx }) => {
    const scope = resolveScope(ctx)
    return {
      actionLabel: 'Set freight trip charges',
      resourceKind: FREIGHT_TRIP_ENTITY_ID,
      resourceId: input.id,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    }
  },
}

registerCommand(setTripChargesCommand)

type TripTransition = {
  action: string
  event: Parameters<typeof emitFreightEvent>[0]
  from: Array<FreightTrip['executionStatus']>
  apply: (trip: FreightTrip, now: Date) => void
  guard?: (ctx: CommandRuntimeContext, em: EntityManager, scope: FreightScope, trip: FreightTrip) => Promise<void>
}

const TRIP_TRANSITIONS: TripTransition[] = [
  {
    action: 'dispatch',
    event: 'freight_operations.trip.dispatched',
    from: ['planned'],
    apply: (trip) => {
      trip.executionStatus = 'dispatched'
    },
  },
  {
    action: 'start',
    event: 'freight_operations.trip.started',
    from: ['planned', 'dispatched'],
    apply: (trip, now) => {
      trip.executionStatus = 'in_transit'
      trip.actualStartAt = trip.actualStartAt ?? now
    },
  },
  {
    action: 'deliver',
    event: 'freight_operations.trip.delivered',
    from: ['dispatched', 'in_transit'],
    apply: (trip, now) => {
      trip.executionStatus = 'delivered'
      trip.actualEndAt = trip.actualEndAt ?? now
    },
    guard: async (ctx, _em, scope, trip) => {
      const settings = await loadSettings(ctx, scope)
      if (!settings.requirePodForBilling) return
      if (!trip.podDocumentId && !trip.podReference) {
        return raiseFreightError(409, 'pod_required', 'A proof of delivery is required before delivery can be recorded.')
      }
    },
  },
  {
    action: 'cancel',
    event: 'freight_operations.trip.cancelled',
    from: ['planned', 'dispatched', 'in_transit', 'delivered'],
    apply: (trip) => {
      trip.executionStatus = 'cancelled'
    },
    guard: async (_ctx, _em, _scope, trip) => {
      if (trip.billingStatus !== 'unbilled') {
        return raiseFreightError(409, 'trip_locked', 'The trip is part of an abstract and cannot be changed.')
      }
    },
  },
]

for (const transition of TRIP_TRANSITIONS) {
  const command: CommandHandler<{ id: string }, { tripId: string }> = {
    id: `freight_operations.trips.${transition.action}`,
    async execute(rawInput, ctx) {
      const parsed = transition.action === 'deliver' ? tripDeliverSchema.parse(rawInput) : tripActionSchema.parse(rawInput)
      const scope = resolveScope(ctx)
      const em = entityManager(ctx)
      const trip = await em.transactional(async (tx) => {
        const locked = await findTripForUpdate(ctx, tx, scope, parsed.id)
        if (!transition.from.includes(locked.executionStatus)) {
          return raiseFreightError(409, 'trip_status_invalid', 'The trip is not in a state that allows this action.')
        }
        if (transition.action === 'deliver') {
          const deliverInput = parsed as ReturnType<typeof tripDeliverSchema.parse>
          locked.podDocumentId = deliverInput.podDocumentId ?? locked.podDocumentId ?? null
          locked.podReference = deliverInput.podReference ?? locked.podReference ?? null
          locked.podReceivedByName = deliverInput.podReceivedByName ?? locked.podReceivedByName ?? null
          locked.podReceivedAt = (deliverInput.podReceivedAt ? new Date(String(deliverInput.podReceivedAt)) : null) ?? locked.podReceivedAt ?? new Date()
        }
        if (transition.guard) {
          await transition.guard(ctx, tx, scope, locked)
        }
        const now = new Date()
        transition.apply(locked, now)
        locked.updatedAt = now
        await tx.persist(locked).flush()
        return locked
      })
      await emitTripUpdate(ctx, trip, scope)
      await emitTripLifecycle(transition.event, trip, scope)
      return { tripId: trip.id }
    },
    buildLog: ({ input, ctx }) => {
      const scope = resolveScope(ctx)
      return {
        actionLabel: `${transition.action} freight trip`,
        resourceKind: FREIGHT_TRIP_ENTITY_ID,
        resourceId: input.id,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      }
    },
  }
  registerCommand(command)
}

const excludeTripCommand: CommandHandler<{ id: string }, { tripId: string }> = {
  id: 'freight_operations.trips.exclude',
  async execute(rawInput, ctx) {
    const input = tripActionSchema.parse(rawInput)
    const scope = resolveScope(ctx)
    const em = entityManager(ctx)
    const trip = await em.transactional(async (tx) => {
      const locked = await findTripForUpdate(ctx, tx, scope, input.id)
      if (locked.billingStatus !== 'unbilled') {
        return raiseFreightError(409, 'trip_locked', 'The trip is part of an abstract and cannot be changed.')
      }
      locked.billingStatus = 'excluded'
      locked.updatedAt = new Date()
      await tx.persist(locked).flush()
      return locked
    })
    await emitTripUpdate(ctx, trip, scope)
    await emitTripLifecycle('freight_operations.trip.excluded', trip, scope)
    return { tripId: trip.id }
  },
  buildLog: ({ input, ctx }) => {
    const scope = resolveScope(ctx)
    return {
      actionLabel: 'Exclude freight trip from billing',
      resourceKind: FREIGHT_TRIP_ENTITY_ID,
      resourceId: input.id,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    }
  },
}

registerCommand(excludeTripCommand)
