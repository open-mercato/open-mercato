import { LockMode } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { registerCommand, type CommandHandler, type CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { enforceCommandOptimisticLockWithGuards } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { ModuleConfigService } from '@open-mercato/core/modules/configs/lib/module-config-service'
import {
  FreightContract,
  FreightTrip,
  FreightTripAbstract,
  FreightTripAbstractLine,
  FreightTripCharge,
  type AbstractStatus,
} from '../data/entities'
import {
  abstractActionSchema,
  abstractCancelSchema,
  abstractFinalizeSchema,
  abstractInvoiceSchema,
  abstractOfflineApprovalSchema,
  abstractResolveSchema,
  abstractRespondSchema,
  generateAbstractSchema,
  type AbstractResolveInput,
  type AbstractRespondInput,
  type GenerateAbstractInput,
} from '../data/validators'
import { resolveScope } from './crud'
import { FREIGHT_ABSTRACT_ENTITY_ID, freightAbstractEvents, freightAbstractIndexer, freightTripEvents, freightTripIndexer } from './entities'
import { raiseFreightError } from '../lib/errors'
import { readFreightSettings, type FreightScope } from '../lib/freightSettings'
import { allocateDocumentNumber } from '../lib/documentNumber'
import { buildInvoiceDraft } from '../lib/invoiceDraft'
import { hasOpenDisputes, isAbstractActionAllowed, resolveLineAmounts, sumBillableLines } from '../lib/abstractState'
import { createFreightSalesInvoice, deleteSalesInvoiceQuietly, deleteSalesOrderQuietly } from '../lib/salesBridge'
import { emitFreightEvent } from '../events'

const ONE_DAY_MS = 24 * 60 * 60 * 1000

/**
 * The trip-abstract engine.
 *
 * Generation snapshots each executed trip into a line and parks the trip in
 * `in_abstract`, so the same trip can never be billed twice (a partial unique
 * index over live billable lines is the database-level backstop). From there the
 * abstract only moves through the states `lib/abstractState.ts` allows, and every
 * action that changes what is billed — a resolution that un-bills a line, an
 * invoice, a cancellation — releases or locks the trips in the same transaction,
 * so the board and the abstract can never disagree about a trip's billing state.
 */

function entityManager(ctx: CommandRuntimeContext): EntityManager {
  return (ctx.container.resolve('em') as EntityManager).fork()
}

function toDate(value: unknown): Date | null {
  if (value === null || value === undefined || value === '') return null
  if (value instanceof Date) return value
  const parsed = new Date(`${String(value)}T00:00:00.000Z`)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function toDateOnlyString(value: Date | null | undefined): string {
  if (!value) return ''
  return value.toISOString().slice(0, 10)
}

async function loadSettings(ctx: CommandRuntimeContext, scope: FreightScope) {
  const configService = ctx.container.resolve('moduleConfigService') as ModuleConfigService
  return readFreightSettings(configService, scope)
}

async function findAbstractForUpdate(
  ctx: CommandRuntimeContext,
  em: EntityManager,
  scope: FreightScope,
  id: string,
): Promise<FreightTripAbstract> {
  const abstract = await em.findOne(
    FreightTripAbstract,
    { id, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null },
    { lockMode: LockMode.PESSIMISTIC_WRITE },
  )
  if (!abstract) return raiseFreightError(404, 'abstract_not_found', 'Trip abstract not found.')
  await enforceCommandOptimisticLockWithGuards(ctx.container, {
    resourceKind: FREIGHT_ABSTRACT_ENTITY_ID,
    resourceId: abstract.id,
    current: abstract.updatedAt,
    request: ctx.request ?? null,
  })
  return abstract
}

async function loadAbstractLines(
  em: EntityManager,
  scope: FreightScope,
  abstractId: string,
): Promise<FreightTripAbstractLine[]> {
  return em.find(
    FreightTripAbstractLine,
    { tenantId: scope.tenantId, organizationId: scope.organizationId, abstract: abstractId, deletedAt: null },
    { orderBy: { lineNumber: 'asc' } },
  )
}

function applyTotals(abstract: FreightTripAbstract, lines: readonly FreightTripAbstractLine[], now: Date): void {
  const totals = sumBillableLines(lines)
  abstract.tripCount = totals.tripCount
  abstract.subtotalNetAmount = totals.subtotalNetAmount
  abstract.taxTotalAmount = totals.taxTotalAmount
  abstract.grandTotalGrossAmount = totals.grandTotalGrossAmount
  abstract.updatedAt = now
}

async function emitAbstractCreated(
  ctx: CommandRuntimeContext,
  abstract: FreightTripAbstract,
  scope: FreightScope,
): Promise<void> {
  const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
  await emitCrudSideEffects({
    dataEngine,
    action: 'created',
    entity: abstract,
    identifiers: { id: abstract.id, ...scope },
    actorUserId: ctx.auth?.sub ?? null,
    events: freightAbstractEvents,
    indexer: freightAbstractIndexer,
  })
}

async function emitAbstractUpdate(
  ctx: CommandRuntimeContext,
  abstract: FreightTripAbstract,
  scope: FreightScope,
): Promise<void> {
  const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
  await emitCrudSideEffects({
    dataEngine,
    action: 'updated',
    entity: abstract,
    identifiers: { id: abstract.id, ...scope },
    actorUserId: ctx.auth?.sub ?? null,
    events: freightAbstractEvents,
    indexer: freightAbstractIndexer,
  })
}

async function emitAbstractLifecycle(
  eventId: Parameters<typeof emitFreightEvent>[0],
  abstract: FreightTripAbstract,
  scope: FreightScope,
  extra: Record<string, unknown> = {},
): Promise<void> {
  await emitFreightEvent(eventId, {
    id: abstract.id,
    abstractNumber: abstract.abstractNumber,
    contractId: abstract.contractId,
    customerId: abstract.customerId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    ...extra,
  })
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

async function releaseTrip(tx: EntityManager, trip: FreightTrip, now: Date): Promise<void> {
  trip.billingStatus = 'unbilled'
  trip.activeAbstractId = null
  trip.updatedAt = now
  await tx.persist(trip)
}

const generateAbstractCommand: CommandHandler<GenerateAbstractInput, { abstractId: string }> = {
  id: 'freight_operations.abstracts.generate',
  async execute(rawInput, ctx) {
    const input = generateAbstractSchema.parse(rawInput)
    const scope = resolveScope(ctx)
    const settings = await loadSettings(ctx, scope)
    const em = entityManager(ctx)
    const periodFrom = toDate(input.periodFrom)
    const periodTo = toDate(input.periodTo)
    if (!periodFrom || !periodTo) {
      return raiseFreightError(400, 'invalid_abstract_period', 'The abstract period is not a valid date range.')
    }

    const generated = await em.transactional(async (tx) => {
      const contract = await tx.findOne(FreightContract, {
        id: input.contractId,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        deletedAt: null,
      })
      if (!contract) return raiseFreightError(404, 'contract_not_found', 'Freight contract not found.')
      if (contract.status === 'draft') {
        return raiseFreightError(409, 'contract_not_abstractable', 'A draft contract has no executed trips to abstract.')
      }

      const trips = await tx.find(
        FreightTrip,
        {
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          deletedAt: null,
          contractId: contract.id,
          executionStatus: 'delivered',
          billingStatus: 'unbilled',
          executionDate: { $gte: periodFrom, $lte: periodTo },
        },
        { orderBy: { executionDate: 'asc', tripNumber: 'asc' }, lockMode: LockMode.PESSIMISTIC_WRITE },
      )
      if (trips.length === 0) {
        return raiseFreightError(409, 'no_billable_trips', 'No delivered, unbilled trips fall inside this period.')
      }

      // Every read happens before the first mutation: the trip charges are
      // loaded in one query here, because a query issued between a mutation and
      // its flush can drop the pending change sets (SPEC-018).
      const tripCharges = await tx.find(
        FreightTripCharge,
        {
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          trip: { $in: trips.map((trip) => trip.id) },
          deletedAt: null,
        },
        { orderBy: { position: 'asc' }, populate: ['trip'] },
      )
      const chargesByTrip = new Map<string, FreightTripCharge[]>()
      for (const charge of tripCharges) {
        const key = charge.trip.id
        const list = chargesByTrip.get(key) ?? []
        list.push(charge)
        chargesByTrip.set(key, list)
      }

      const now = new Date()
      const abstractNumber = await allocateDocumentNumber(tx, scope, 'abstract', settings)
      const abstract = tx.create(FreightTripAbstract, {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        abstractNumber,
        contractId: contract.id,
        customerId: contract.customerId,
        customerSnapshot: contract.customerSnapshot,
        periodFrom,
        periodTo,
        billingCycleSnapshot: contract.billingCycle,
        currencyCode: contract.currencyCode,
        vatRate: contract.vatRate,
        status: 'draft' as AbstractStatus,
        requiresCustomerApproval: contract.requiresCustomerApproval,
        approvalMode: null,
        notes: null,
        createdBy: ctx.auth?.sub ?? null,
        createdAt: now,
        updatedAt: now,
      })
      await tx.persist(abstract).flush()

      const lines: FreightTripAbstractLine[] = []
      let lineNumber = 0
      for (const trip of trips) {
        const charges = chargesByTrip.get(trip.id) ?? []
        lineNumber += 1
        lines.push(tx.create(FreightTripAbstractLine, {
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          abstract,
          tripId: trip.id,
          lineNumber,
          executionDate: trip.executionDate,
          routeCodeSnapshot: trip.routeCodeSnapshot ?? null,
          origin: trip.origin,
          destination: trip.destination,
          rateBasis: trip.rateBasis,
          quantity: trip.quantity,
          unitPriceNet: trip.unitPriceNet,
          baseAmountNet: trip.baseAmountNet,
          chargesTotalNet: trip.chargesTotalNet,
          chargesSummary: charges.map((charge) => ({
            kind: charge.kind,
            description: charge.description ?? null,
            quantity: charge.quantity,
            unitAmountNet: charge.unitAmountNet,
            amountNet: charge.amountNet,
            isTaxable: charge.isTaxable,
            billable: charge.billable,
          })),
          totalNetAmount: trip.totalNetAmount,
          taxRate: trip.taxRate,
          taxAmount: trip.taxAmount,
          totalGrossAmount: trip.totalGrossAmount,
          currencyCode: trip.currencyCode,
          description: charges.length > 0 ? `${trip.origin} → ${trip.destination}` : null,
          isBillable: true,
          disputeStatus: 'none',
          createdAt: now,
          updatedAt: now,
        }))
        trip.billingStatus = 'in_abstract'
        trip.activeAbstractId = abstract.id
        trip.updatedAt = now
        tx.persist(trip)
      }
      applyTotals(abstract, lines, now)
      await tx.persist(lines).flush()
      return { abstract, trips }
    })

    await emitAbstractCreated(ctx, generated.abstract, scope)
    await emitAbstractLifecycle('freight_operations.trip_abstract.generated', generated.abstract, scope, {
      tripCount: generated.trips.length,
    })
    for (const trip of generated.trips) {
      await emitTripUpdate(ctx, trip, scope)
    }
    return { abstractId: generated.abstract.id }
  },
  buildLog: ({ result, ctx }) => {
    const scope = resolveScope(ctx)
    return {
      actionLabel: 'Generate freight trip abstract',
      resourceKind: FREIGHT_ABSTRACT_ENTITY_ID,
      resourceId: result.abstractId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    }
  },
}

const submitAbstractCommand: CommandHandler<{ id: string }, { abstractId: string }> = {
  id: 'freight_operations.abstracts.submit',
  async execute(rawInput, ctx) {
    const input = abstractActionSchema.parse(rawInput)
    const scope = resolveScope(ctx)
    const em = entityManager(ctx)
    const abstract = await em.transactional(async (tx) => {
      const locked = await findAbstractForUpdate(ctx, tx, scope, input.id)
      if (!isAbstractActionAllowed(locked.status, 'submit')) {
        return raiseFreightError(409, 'abstract_status_invalid', 'The abstract is not in a state that allows this action.')
      }
      if (!locked.requiresCustomerApproval) {
        return raiseFreightError(409, 'abstract_approval_not_required', 'This contract waives customer approval — finalize the abstract internally instead.')
      }
      const lines = await loadAbstractLines(tx, scope, locked.id)
      if (sumBillableLines(lines).tripCount === 0) {
        return raiseFreightError(409, 'abstract_empty', 'An abstract without billable trips cannot be submitted.')
      }
      const now = new Date()
      locked.status = 'submitted'
      locked.submittedAt = now
      locked.submittedBy = ctx.auth?.sub ?? null
      locked.updatedAt = now
      await tx.persist(locked).flush()
      return locked
    })

    await emitAbstractUpdate(ctx, abstract, scope)
    await emitAbstractLifecycle('freight_operations.trip_abstract.submitted', abstract, scope)
    return { abstractId: abstract.id }
  },
  buildLog: ({ input, ctx }) => {
    const scope = resolveScope(ctx)
    return {
      actionLabel: 'Submit freight trip abstract',
      resourceKind: FREIGHT_ABSTRACT_ENTITY_ID,
      resourceId: input.id,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    }
  },
}

/**
 * The response is recorded with an explicit origin: the staff route relays an
 * acceptance or dispute the customer gave outside the portal (`staff`), and the
 * future portal route calls the same command with `customer_portal`. The value
 * comes from the route's own payload mapping, never from the request body.
 */
type RespondAbstractInput = AbstractRespondInput & { origin?: 'customer_portal' | 'staff' }

const respondAbstractCommand: CommandHandler<RespondAbstractInput, { abstractId: string; status: AbstractStatus }> = {
  id: 'freight_operations.abstracts.respond',
  async execute(rawInput, ctx) {
    const input = abstractRespondSchema.parse(rawInput)
    const origin = (rawInput as { origin?: unknown } | null)?.origin === 'customer_portal' ? 'customer_portal' : 'staff'
    const scope = resolveScope(ctx)
    const em = entityManager(ctx)

    const disputedLines = input.disputedLines ?? []
    const acceptedLineIds = input.acceptedLineIds ?? []
    if (disputedLines.length === 0 && acceptedLineIds.length === 0) {
      return raiseFreightError(400, 'abstract_response_empty', 'A response must accept or dispute at least one line.')
    }

    const abstract = await em.transactional(async (tx) => {
      const locked = await findAbstractForUpdate(ctx, tx, scope, input.id)
      if (!isAbstractActionAllowed(locked.status, 'respond')) {
        return raiseFreightError(409, 'abstract_status_invalid', 'The abstract is not in a state that allows this action.')
      }
      const lines = await loadAbstractLines(tx, scope, locked.id)
      const byId = new Map(lines.map((line) => [line.id, line]))
      const now = new Date()

      for (const lineId of acceptedLineIds) {
        if (!byId.has(lineId)) return raiseFreightError(400, 'abstract_line_not_found', 'The abstract does not carry that line.')
      }
      for (const entry of disputedLines) {
        const line = byId.get(entry.lineId)
        if (!line) return raiseFreightError(400, 'abstract_line_not_found', 'The abstract does not carry that line.')
        if (!line.isBillable) {
          return raiseFreightError(409, 'abstract_line_not_billable', 'A line that was removed from billing cannot be disputed.')
        }
        line.disputeStatus = 'disputed'
        line.disputeNote = entry.note
        line.disputedAt = now
        line.disputedByUserId = ctx.auth?.sub ?? null
        line.disputeOrigin = origin
        line.updatedAt = now
        await tx.persist(line)
      }
      await tx.flush()

      if (disputedLines.length > 0) {
        locked.status = 'disputed'
        locked.disputedAt = now
        locked.disputedByUserId = ctx.auth?.sub ?? null
      } else {
        locked.status = 'approved'
        locked.approvalMode = origin === 'customer_portal' ? 'customer_portal' : 'customer_offline'
        locked.customerApprovedAt = now
        locked.customerApprovedByUserId = ctx.auth?.sub ?? null
      }
      locked.updatedAt = now
      await tx.persist(locked).flush()
      return locked
    })

    await emitAbstractUpdate(ctx, abstract, scope)
    await emitAbstractLifecycle('freight_operations.trip_abstract.responded', abstract, scope, {
      origin,
      disputedLineCount: disputedLines.length,
    })
    await emitAbstractLifecycle(
      abstract.status === 'disputed' ? 'freight_operations.trip_abstract.disputed' : 'freight_operations.trip_abstract.approved',
      abstract,
      scope,
    )
    return { abstractId: abstract.id, status: abstract.status }
  },
  buildLog: ({ input, ctx }) => {
    const scope = resolveScope(ctx)
    return {
      actionLabel: 'Record freight abstract customer response',
      resourceKind: FREIGHT_ABSTRACT_ENTITY_ID,
      resourceId: input.id,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    }
  },
}

const resolveAbstractCommand: CommandHandler<AbstractResolveInput, { abstractId: string; status: AbstractStatus }> = {
  id: 'freight_operations.abstracts.resolve',
  async execute(rawInput, ctx) {
    const input = abstractResolveSchema.parse(rawInput)
    const scope = resolveScope(ctx)
    const em = entityManager(ctx)

    const resolved = await em.transactional(async (tx) => {
      const locked = await findAbstractForUpdate(ctx, tx, scope, input.id)
      if (!isAbstractActionAllowed(locked.status, 'resolve')) {
        return raiseFreightError(409, 'abstract_status_invalid', 'The abstract is not in a state that allows this action.')
      }
      const lines = await loadAbstractLines(tx, scope, locked.id)
      const byId = new Map(lines.map((line) => [line.id, line]))
      const now = new Date()

      // The trips are locked before anything is mutated, so no query can land
      // between a mutation and its flush (SPEC-018).
      const tripIds = [...new Set(lines.map((line) => line.tripId))]
      const trips = tripIds.length === 0
        ? []
        : await tx.find(
            FreightTrip,
            { id: { $in: tripIds }, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null },
            { lockMode: LockMode.PESSIMISTIC_WRITE },
          )
      const tripById = new Map(trips.map((trip) => [trip.id, trip]))
      const released: FreightTrip[] = []

      for (const resolution of input.resolutions) {
        const line = byId.get(resolution.lineId)
        if (!line) return raiseFreightError(400, 'abstract_line_not_found', 'The abstract does not carry that line.')
        if (line.disputeStatus !== 'disputed') {
          return raiseFreightError(409, 'abstract_line_not_disputed', 'Only a line the customer disputed can be resolved.')
        }
        if (resolution.resolution === 'adjusted' && resolution.adjustedAmountNet === null) {
          return raiseFreightError(400, 'abstract_adjustment_required', 'An adjusted resolution needs the agreed amount.')
        }
        const outcome = resolveLineAmounts({
          resolution: resolution.resolution,
          isBillable: line.isBillable,
          totalNetAmount: line.totalNetAmount,
          taxAmount: line.taxAmount,
          totalGrossAmount: line.totalGrossAmount,
          taxRate: line.taxRate,
          adjustedAmountNet: resolution.adjustedAmountNet ?? null,
        })
        line.isBillable = outcome.isBillable
        line.totalNetAmount = outcome.totalNetAmount
        line.taxAmount = outcome.taxAmount
        line.totalGrossAmount = outcome.totalGrossAmount
        line.adjustedAmountNet = outcome.adjustedAmountNet
        line.disputeStatus = 'resolved'
        line.resolution = resolution.resolution
        line.resolutionNote = resolution.resolutionNote
        line.resolvedAt = now
        line.resolvedBy = ctx.auth?.sub ?? null
        line.updatedAt = now
        tx.persist(line)

        if (!outcome.isBillable) {
          const trip = tripById.get(line.tripId)
          if (trip && trip.activeAbstractId === locked.id) {
            await releaseTrip(tx, trip, now)
            released.push(trip)
          }
        }
      }

      applyTotals(locked, lines, now)
      const settled = !hasOpenDisputes(lines)
      if (settled) {
        locked.status = 'approved'
        locked.resolvedAt = now
        locked.resolvedBy = ctx.auth?.sub ?? null
      }
      await tx.persist(locked).flush()
      return { abstract: locked, released, settled }
    })

    await emitAbstractUpdate(ctx, resolved.abstract, scope)
    await emitAbstractLifecycle('freight_operations.trip_abstract.resolved', resolved.abstract, scope, {
      resolvedLineCount: input.resolutions.length,
    })
    if (resolved.settled) {
      await emitAbstractLifecycle('freight_operations.trip_abstract.approved', resolved.abstract, scope, {
        approvalMode: resolved.abstract.approvalMode ?? 'customer_portal',
      })
    }
    for (const trip of resolved.released) {
      await emitTripUpdate(ctx, trip, scope)
    }
    return { abstractId: resolved.abstract.id, status: resolved.abstract.status }
  },
  buildLog: ({ input, ctx }) => {
    const scope = resolveScope(ctx)
    return {
      actionLabel: 'Resolve freight abstract disputes',
      resourceKind: FREIGHT_ABSTRACT_ENTITY_ID,
      resourceId: input.id,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    }
  },
}

const finalizeAbstractCommand: CommandHandler<{ id: string; note: string }, { abstractId: string }> = {
  id: 'freight_operations.abstracts.finalize',
  async execute(rawInput, ctx) {
    const input = abstractFinalizeSchema.parse(rawInput)
    const scope = resolveScope(ctx)
    const em = entityManager(ctx)
    const abstract = await em.transactional(async (tx) => {
      const locked = await findAbstractForUpdate(ctx, tx, scope, input.id)
      if (!isAbstractActionAllowed(locked.status, 'finalize')) {
        return raiseFreightError(409, 'abstract_status_invalid', 'The abstract is not in a state that allows this action.')
      }
      if (locked.requiresCustomerApproval) {
        return raiseFreightError(409, 'abstract_customer_approval_required', 'This contract requires the customer to approve the abstract — submit it, or record an offline approval.')
      }
      const lines = await loadAbstractLines(tx, scope, locked.id)
      if (sumBillableLines(lines).tripCount === 0) {
        return raiseFreightError(409, 'abstract_empty', 'An abstract without billable trips cannot be finalized.')
      }
      const now = new Date()
      locked.status = 'approved'
      locked.approvalMode = 'staff_internal'
      locked.staffFinalizedAt = now
      locked.staffFinalizedBy = ctx.auth?.sub ?? null
      locked.staffFinalizeNote = input.note
      locked.updatedAt = now
      await tx.persist(locked).flush()
      return locked
    })

    await emitAbstractUpdate(ctx, abstract, scope)
    await emitAbstractLifecycle('freight_operations.trip_abstract.finalized', abstract, scope)
    await emitAbstractLifecycle('freight_operations.trip_abstract.approved', abstract, scope, { approvalMode: 'staff_internal' })
    return { abstractId: abstract.id }
  },
  buildLog: ({ input, ctx }) => {
    const scope = resolveScope(ctx)
    return {
      actionLabel: 'Finalize freight trip abstract internally',
      resourceKind: FREIGHT_ABSTRACT_ENTITY_ID,
      resourceId: input.id,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    }
  },
}

const recordOfflineApprovalCommand: CommandHandler<{ id: string; reference?: string | null; note: string }, { abstractId: string }> = {
  id: 'freight_operations.abstracts.record_offline_approval',
  async execute(rawInput, ctx) {
    const input = abstractOfflineApprovalSchema.parse(rawInput)
    const scope = resolveScope(ctx)
    const em = entityManager(ctx)
    const abstract = await em.transactional(async (tx) => {
      const locked = await findAbstractForUpdate(ctx, tx, scope, input.id)
      if (!isAbstractActionAllowed(locked.status, 'record_offline_approval')) {
        return raiseFreightError(409, 'abstract_status_invalid', 'The abstract is not in a state that allows this action.')
      }
      const lines = await loadAbstractLines(tx, scope, locked.id)
      if (sumBillableLines(lines).tripCount === 0) {
        return raiseFreightError(409, 'abstract_empty', 'An abstract without billable trips cannot be approved.')
      }
      const now = new Date()
      locked.status = 'approved'
      locked.approvalMode = 'customer_offline'
      locked.offlineApprovedAt = now
      locked.offlineApprovedBy = ctx.auth?.sub ?? null
      locked.offlineApprovalReference = input.reference ?? null
      locked.offlineApprovalNote = input.note
      locked.updatedAt = now
      await tx.persist(locked).flush()
      return locked
    })

    await emitAbstractUpdate(ctx, abstract, scope)
    await emitAbstractLifecycle('freight_operations.trip_abstract.offline_approved', abstract, scope)
    await emitAbstractLifecycle('freight_operations.trip_abstract.approved', abstract, scope, { approvalMode: 'customer_offline' })
    return { abstractId: abstract.id }
  },
  buildLog: ({ input, ctx }) => {
    const scope = resolveScope(ctx)
    return {
      actionLabel: 'Record offline customer approval of a freight abstract',
      resourceKind: FREIGHT_ABSTRACT_ENTITY_ID,
      resourceId: input.id,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    }
  },
}

export type InvoiceAbstractResult = {
  abstractId: string
  salesOrderId: string
  salesInvoiceId: string
  salesInvoiceNumber: string | null
}

const invoiceAbstractCommand: CommandHandler<{ id: string }, InvoiceAbstractResult> = {
  id: 'freight_operations.abstracts.invoice',
  async execute(rawInput, ctx) {
    const input = abstractInvoiceSchema.parse(rawInput)
    const scope = resolveScope(ctx)
    const settings = await loadSettings(ctx, scope)
    const em = entityManager(ctx)

    const abstract = await em.findOne(FreightTripAbstract, {
      id: input.id,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    })
    if (!abstract) return raiseFreightError(404, 'abstract_not_found', 'Trip abstract not found.')
    if (abstract.status !== 'approved') {
      return raiseFreightError(409, 'abstract_not_approved', 'Only an approved abstract can be invoiced.')
    }
    if (abstract.salesOrderId || abstract.salesInvoiceId) {
      return raiseFreightError(409, 'abstract_already_invoiced', 'This abstract already has a sales invoice.')
    }
    const lines = await loadAbstractLines(em, scope, abstract.id)
    const billable = lines.filter((line) => line.isBillable)
    if (billable.length === 0) {
      return raiseFreightError(409, 'abstract_nothing_to_invoice', 'Every line of this abstract was removed from billing.')
    }

    const contract = await em.findOne(FreightContract, {
      id: abstract.contractId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    })
    const { translate } = await resolveTranslations()
    const lineNameTemplate = translate(
      'freight_operations.invoice.line.abstractName',
      'Freight trips {abstractNumber} · {origin} → {destination}',
    )
    const draft = buildInvoiceDraft(
      billable.map((line) => ({
        name: lineNameTemplate
          .replaceAll('{abstractNumber}', abstract.abstractNumber)
          .replaceAll('{origin}', line.origin)
          .replaceAll('{destination}', line.destination),
        description: `${toDateOnlyString(line.executionDate)} · ${line.origin} → ${line.destination}`,
        netAmount: line.totalNetAmount,
        taxRatePercent: line.taxRate,
        metadata: { freight: { abstractId: abstract.id, abstractLineId: line.id, tripId: line.tripId } },
      })),
      abstract.vatRate,
    )
    const paymentTermsDays = contract?.paymentTermsDays ?? settings.defaultPaymentTermsDays
    const dueAt = new Date(Date.now() + paymentTermsDays * ONE_DAY_MS)

    const bridgeResult = await createFreightSalesInvoice(ctx, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      customerEntityId: abstract.customerId,
      currencyCode: abstract.currencyCode,
      externalReference: abstract.abstractNumber,
      metadata: {
        freight: {
          abstractId: abstract.id,
          abstractNumber: abstract.abstractNumber,
          contractId: abstract.contractId,
        },
      },
      dueAt,
      channelId: contract?.salesChannelId ?? settings.salesChannelId,
      draft,
    })

    let trips: FreightTrip[] = []
    try {
      trips = await em.transactional(async (tx) => {
        const locked = await findAbstractForUpdate(ctx, tx, scope, abstract.id)
        if (locked.status !== 'approved' || locked.salesOrderId || locked.salesInvoiceId) {
          return raiseFreightError(409, 'abstract_already_invoiced', 'This abstract already has a sales invoice.')
        }
        const billed = await tx.find(
          FreightTrip,
          {
            tenantId: scope.tenantId,
            organizationId: scope.organizationId,
            deletedAt: null,
            activeAbstractId: locked.id,
          },
          { lockMode: LockMode.PESSIMISTIC_WRITE },
        )
        const now = new Date()
        locked.salesOrderId = bridgeResult.salesOrderId
        locked.salesInvoiceId = bridgeResult.salesInvoiceId
        locked.salesInvoiceNumber = bridgeResult.salesInvoiceNumber
        locked.invoiceIssuedAt = now
        locked.dueDate = dueAt
        locked.paidTotalAmount = '0'
        locked.outstandingAmount = locked.grandTotalGrossAmount
        locked.invoiceLinesMap = billable.map((line) => ({
          lineId: line.id,
          tripId: line.tripId,
          lineNumber: line.lineNumber,
          totalNetAmount: line.totalNetAmount,
          taxAmount: line.taxAmount,
          totalGrossAmount: line.totalGrossAmount,
        }))
        locked.status = 'invoiced'
        locked.updatedAt = now
        for (const trip of billed) {
          trip.billingStatus = 'billed'
          trip.updatedAt = now
          tx.persist(trip)
        }
        await tx.persist(locked).flush()
        abstract.salesOrderId = locked.salesOrderId
        abstract.salesInvoiceId = locked.salesInvoiceId
        abstract.status = locked.status
        abstract.updatedAt = locked.updatedAt
        return billed
      })
    } catch (err) {
      await deleteSalesInvoiceQuietly(ctx, scope, bridgeResult.salesInvoiceId)
      await deleteSalesOrderQuietly(ctx, bridgeResult.salesOrderId)
      throw err
    }

    await emitAbstractUpdate(ctx, abstract, scope)
    await emitAbstractLifecycle('freight_operations.trip_abstract.invoiced', abstract, scope, {
      salesOrderId: bridgeResult.salesOrderId,
      salesInvoiceId: bridgeResult.salesInvoiceId,
      salesInvoiceNumber: bridgeResult.salesInvoiceNumber,
    })
    for (const trip of trips) {
      await emitTripUpdate(ctx, trip, scope)
      await emitFreightEvent('freight_operations.trip.billed', {
        id: trip.id,
        tripNumber: trip.tripNumber,
        abstractId: abstract.id,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      })
    }
    return {
      abstractId: abstract.id,
      salesOrderId: bridgeResult.salesOrderId,
      salesInvoiceId: bridgeResult.salesInvoiceId,
      salesInvoiceNumber: bridgeResult.salesInvoiceNumber,
    }
  },
  buildLog: ({ input, ctx }) => {
    const scope = resolveScope(ctx)
    return {
      actionLabel: 'Invoice freight trip abstract',
      resourceKind: FREIGHT_ABSTRACT_ENTITY_ID,
      resourceId: input.id,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    }
  },
}

const cancelAbstractCommand: CommandHandler<{ id: string; reason?: string | null }, { abstractId: string }> = {
  id: 'freight_operations.abstracts.cancel',
  async execute(rawInput, ctx) {
    const input = abstractCancelSchema.parse(rawInput)
    const scope = resolveScope(ctx)
    const em = entityManager(ctx)
    const cancelled = await em.transactional(async (tx) => {
      const locked = await findAbstractForUpdate(ctx, tx, scope, input.id)
      if (!isAbstractActionAllowed(locked.status, 'cancel')) {
        return raiseFreightError(409, 'abstract_status_invalid', 'The abstract is not in a state that allows this action.')
      }
      const now = new Date()
      const lines = await loadAbstractLines(tx, scope, locked.id)
      const attached = await tx.find(
        FreightTrip,
        {
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          deletedAt: null,
          activeAbstractId: locked.id,
        },
        { lockMode: LockMode.PESSIMISTIC_WRITE },
      )

      for (const line of lines) {
        if (line.isBillable) {
          line.isBillable = false
          line.updatedAt = now
          tx.persist(line)
        }
      }
      for (const trip of attached) {
        await releaseTrip(tx, trip, now)
      }

      // The lines stay on the abstract as the record of what was cancelled, so
      // the un-billing has to show in the totals: nothing is billable any more,
      // and the trips are free to appear on a later abstract.
      applyTotals(locked, lines, now)
      locked.status = 'cancelled'
      locked.cancelledAt = now
      locked.cancelledBy = ctx.auth?.sub ?? null
      locked.cancellationReason = input.reason ?? null
      await tx.persist(locked).flush()
      return { abstract: locked, trips: attached }
    })

    await emitAbstractUpdate(ctx, cancelled.abstract, scope)
    await emitAbstractLifecycle('freight_operations.trip_abstract.cancelled', cancelled.abstract, scope, {
      reason: input.reason ?? null,
    })
    for (const trip of cancelled.trips) {
      await emitTripUpdate(ctx, trip, scope)
    }
    return { abstractId: cancelled.abstract.id }
  },
  buildLog: ({ input, ctx }) => {
    const scope = resolveScope(ctx)
    return {
      actionLabel: 'Cancel freight trip abstract',
      resourceKind: FREIGHT_ABSTRACT_ENTITY_ID,
      resourceId: input.id,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    }
  },
}

registerCommand(generateAbstractCommand)
registerCommand(submitAbstractCommand)
registerCommand(respondAbstractCommand)
registerCommand(resolveAbstractCommand)
registerCommand(finalizeAbstractCommand)
registerCommand(recordOfflineApprovalCommand)
registerCommand(invoiceAbstractCommand)
registerCommand(cancelAbstractCommand)
