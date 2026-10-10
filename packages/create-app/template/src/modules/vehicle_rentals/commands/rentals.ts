import { LockMode } from '@mikro-orm/postgresql'
import type { EntityManager } from '@mikro-orm/postgresql'
import { registerCommand, type CommandHandler, type CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { enforceCommandOptimisticLockWithGuards } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { RentalContract, RentalVehicleCheck } from '../data/entities'
import {
  cancelRentalSchema,
  createRentalContractSchema,
  handoverRentalSchema,
  recordRentalCheckSchema,
  returnRentalSchema,
  updateRentalContractSchema,
} from '../data/validators'
import { raiseRentalError } from '../lib/errors'
import { computeRentalAmounts } from '../lib/rentalPricing'
import {
  findTransportDriver,
  findTransportVehicle,
  hasTransportScheduleOverlap,
} from '../lib/transportReference'
import { registerCrudCommands, resolveScope } from './crud'
import {
  RENTAL_CHECK_ENTITY_ID,
  RENTAL_CONTRACT_ENTITY_ID,
  rentalCheckEvents,
  rentalCheckIndexer,
  rentalContractEvents,
  rentalContractIndexer,
} from './entities'
import eventsConfig from '../events'

const emitRentalEvent = eventsConfig.emit

type RentalScope = { tenantId: string; organizationId: string }

const RENTAL_NUMBER_PREFIX = 'RC'
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

/**
 * Claim the next rental number. The upsert row-locks the counter so two
 * concurrent handovers cannot read the same value; a failed transaction may
 * skip a number, which the numbering rules already accept.
 */
async function allocateRentalNumber(em: EntityManager, scope: RentalScope): Promise<string> {
  const rows = await em.getConnection().execute<{ current_value: number | string }[]>(
    `
      insert into rental_document_sequences (id, organization_id, tenant_id, kind, current_value, created_at, updated_at)
      values (gen_random_uuid(), ?, ?, 'rental', 1, now(), now())
      on conflict (organization_id, tenant_id, kind)
      do update set current_value = rental_document_sequences.current_value + 1, updated_at = now()
      returning current_value
    `,
    [scope.organizationId, scope.tenantId],
  )
  const parsed = Number(rows?.[0]?.current_value ?? 1)
  const sequence = Number.isFinite(parsed) ? Math.min(Math.max(Math.floor(parsed), 1), MAX_SEQUENCE) : 1
  return `${RENTAL_NUMBER_PREFIX}-${String(sequence).padStart(5, '0')}`
}

async function findContractForUpdate(
  ctx: CommandRuntimeContext,
  tx: EntityManager,
  scope: RentalScope,
  id: string,
): Promise<RentalContract> {
  const contract = await tx.findOne(
    RentalContract,
    { id, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null },
    { lockMode: LockMode.PESSIMISTIC_WRITE },
  )
  if (!contract) return raiseRentalError(404, 'rental_not_found', 'Rental contract not found.')
  await enforceCommandOptimisticLockWithGuards(ctx.container, {
    resourceKind: RENTAL_CONTRACT_ENTITY_ID,
    resourceId: contract.id,
    current: contract.updatedAt,
    request: ctx.request ?? null,
  })
  return contract
}

async function emitContractUpdate(ctx: CommandRuntimeContext, contract: RentalContract, scope: RentalScope): Promise<void> {
  const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
  await emitCrudSideEffects({
    dataEngine,
    action: 'updated',
    entity: contract,
    identifiers: { id: contract.id, ...scope },
    actorUserId: ctx.auth?.sub ?? null,
    events: rentalContractEvents,
    indexer: rentalContractIndexer,
  })
}

async function emitCheckCreated(ctx: CommandRuntimeContext, check: RentalVehicleCheck, scope: RentalScope): Promise<void> {
  const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
  await emitCrudSideEffects({
    dataEngine,
    action: 'created',
    entity: check,
    identifiers: { id: check.id, ...scope },
    actorUserId: ctx.auth?.sub ?? null,
    events: rentalCheckEvents,
    indexer: rentalCheckIndexer,
  })
}

const contractCrudConfig = {
  entity: RentalContract,
  entityId: RENTAL_CONTRACT_ENTITY_ID,
  resource: 'contracts',
  createSchema: createRentalContractSchema,
  updateSchema: updateRentalContractSchema,
  toCreateData: async (input: Record<string, unknown>, ctx: CommandRuntimeContext) => {
    const scope = resolveScope(ctx)
    const em = entityManager(ctx)
    const rentalNumber = await allocateRentalNumber(em, scope)
    const amounts = computeRentalAmounts({
      durationType: (input.durationType as RentalContract['durationType']) ?? 'daily',
      startAt: toDate(input.startAt),
      endAt: toDate(input.endAt),
      dailyRate: input.dailyRate as string,
      weeklyRate: input.weeklyRate as string,
      monthlyRate: input.monthlyRate as string,
      includedKm: input.includedKm as number | null,
      extraKmRate: input.extraKmRate as string | null,
      taxRate: input.taxRate as number ?? 15,
    })
    return {
      rentalNumber,
      status: 'draft',
      rentalType: (input.rentalType as RentalContract['rentalType']) ?? 'with_driver',
      clientType: (input.clientType as RentalContract['clientType']) ?? 'b2b',
      durationType: (input.durationType as RentalContract['durationType']) ?? 'daily',
      customerId: String(input.customerId),
      customerSnapshot: input.customerSnapshot as Record<string, unknown>,
      vehicleId: (input.vehicleId as string | null | undefined) ?? null,
      driverId: (input.driverId as string | null | undefined) ?? null,
      startAt: toDate(input.startAt),
      endAt: toDate(input.endAt),
      dailyRate: input.dailyRate === undefined ? '0' : String(input.dailyRate),
      weeklyRate: input.weeklyRate === undefined ? '0' : String(input.weeklyRate),
      monthlyRate: input.monthlyRate === undefined ? '0' : String(input.monthlyRate),
      includedKm: input.includedKm === undefined || input.includedKm === null ? null : Number(input.includedKm),
      extraKmRate: (input.extraKmRate as string | null | undefined) ?? null,
      taxRate: input.taxRate === undefined ? '15' : String(input.taxRate),
      currencyCode: typeof input.currencyCode === 'string' ? input.currencyCode : 'SAR',
      rentalAmountNet: amounts.rentalAmountNet,
      totalNetAmount: amounts.totalNetAmount,
      taxAmount: amounts.taxAmount,
      totalGrossAmount: amounts.totalGrossAmount,
      notes: optionalString(input.notes),
    } as never
  },
  toUpdateData: async (input: Record<string, unknown>, current: RentalContract) => {
    const merged = {
      durationType: (input.durationType as RentalContract['durationType']) ?? current.durationType,
      startAt: input.startAt === undefined ? current.startAt : toDate(input.startAt),
      endAt: input.endAt === undefined ? current.endAt : toDate(input.endAt),
      dailyRate: input.dailyRate === undefined ? current.dailyRate : String(input.dailyRate),
      weeklyRate: input.weeklyRate === undefined ? current.weeklyRate : String(input.weeklyRate),
      monthlyRate: input.monthlyRate === undefined ? current.monthlyRate : String(input.monthlyRate),
      includedKm: input.includedKm === undefined ? current.includedKm ?? null : (input.includedKm === null ? null : Number(input.includedKm)),
      extraKmRate: input.extraKmRate === undefined ? current.extraKmRate ?? null : (input.extraKmRate as string | null),
      taxRate: input.taxRate === undefined ? current.taxRate : String(input.taxRate),
      odoStartKm: current.odoStartKm ?? null,
      odoEndKm: current.odoEndKm ?? null,
    }
    const amounts = computeRentalAmounts(merged)
    return {
      rentalType: input.rentalType,
      clientType: input.clientType,
      durationType: input.durationType,
      customerId: input.customerId === undefined ? undefined : String(input.customerId),
      customerSnapshot: input.customerSnapshot,
      vehicleId: input.vehicleId,
      driverId: input.driverId,
      startAt: merged.startAt,
      endAt: merged.endAt,
      dailyRate: merged.dailyRate,
      weeklyRate: merged.weeklyRate,
      monthlyRate: merged.monthlyRate,
      includedKm: merged.includedKm,
      extraKmRate: merged.extraKmRate,
      taxRate: merged.taxRate,
      currencyCode: input.currencyCode,
      notes: input.notes === undefined ? undefined : optionalString(input.notes),
      rentalAmountNet: amounts.rentalAmountNet,
      extraKmAmountNet: amounts.extraKmAmountNet,
      totalNetAmount: amounts.totalNetAmount,
      taxAmount: amounts.taxAmount,
      totalGrossAmount: amounts.totalGrossAmount,
    } as never
  },
  events: rentalContractEvents,
  indexer: rentalContractIndexer,
  beforeUpdate: async (_input: Record<string, unknown>, current: RentalContract) => {
    if (current.status === 'completed' || current.status === 'cancelled') {
      return raiseRentalError(409, 'rental_not_writable', 'A closed rental cannot be edited.')
    }
  },
  beforeDelete: async (current: RentalContract) => {
    if (current.status !== 'draft') {
      return raiseRentalError(409, 'rental_not_deletable', 'Only a draft rental can be deleted.')
    }
  },
}

registerCrudCommands(contractCrudConfig as never)

const handoverCommand: CommandHandler<Record<string, unknown>, { rentalId: string }> = {
  id: 'vehicle_rentals.contracts.handover',
  async execute(rawInput, ctx) {
    const input = handoverRentalSchema.parse(rawInput)
    const scope = resolveScope(ctx)
    const em = entityManager(ctx)
    const contract = await em.transactional(async (tx) => {
      const locked = await findContractForUpdate(ctx, tx, scope, input.id)
      if (locked.status !== 'draft') {
        return raiseRentalError(409, 'rental_not_draft', 'Only a draft rental can be handed over.')
      }
      if (locked.rentalType === 'with_driver' && !input.driverId && !locked.driverId) {
        return raiseRentalError(409, 'driver_required', 'A rental with a driver must name the driver at handover.')
      }

      const vehicle = await findTransportVehicle(tx, scope, input.vehicleId)
      if (!vehicle.available) {
        return raiseRentalError(409, 'fleet_unavailable', 'The fleet module is not available, so the vehicle cannot be verified.')
      }
      if (!vehicle.vehicle) {
        return raiseRentalError(404, 'vehicle_not_found', 'Vehicle not found.')
      }
      if (vehicle.vehicle.status === 'out_of_service' || vehicle.vehicle.status === 'maintenance') {
        return raiseRentalError(409, 'vehicle_unavailable', 'The vehicle is not in a rentable state.')
      }

      const driverId = input.driverId ?? locked.driverId ?? null
      if (driverId) {
        const driver = await findTransportDriver(tx, scope, driverId)
        if (!driver.available) {
          return raiseRentalError(409, 'fleet_unavailable', 'The fleet module is not available, so the driver cannot be verified.')
        }
        if (!driver.driver) {
          return raiseRentalError(404, 'driver_not_found', 'Driver not found.')
        }
        if (driver.driver.status === 'suspended' || driver.driver.status === 'on_leave') {
          return raiseRentalError(409, 'driver_unavailable', 'The driver is not available.')
        }
        if (driver.driver.licenseExpiry && new Date(driver.driver.licenseExpiry).getTime() < new Date().getTime()) {
          return raiseRentalError(409, 'driver_license_expired', 'The driver licence has expired.')
        }
      }

      const window = overlapWindow(locked, input.actualStartAt)
      const overlapping = await tx.findOne(RentalContract, {
        id: { $ne: locked.id },
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        deletedAt: null,
        status: 'active',
        vehicleId: input.vehicleId,
        startAt: { $lt: window.end },
        endAt: { $gt: window.start },
      })
      if (overlapping) {
        return raiseRentalError(409, 'rental_overlap', 'The vehicle is already rented for an overlapping period.')
      }
      const scheduleOverlap = await hasTransportScheduleOverlap(tx, scope, {
        vehicleId: input.vehicleId,
        driverId: driverId ?? input.vehicleId,
        start: window.start,
        end: window.end,
      })
      if (scheduleOverlap) {
        return raiseRentalError(409, 'fleet_schedule_overlap', 'The fleet board already plans this vehicle for an overlapping period.')
      }

      const now = new Date()
      locked.vehicleId = input.vehicleId
      locked.vehicleSnapshot = {
        id: input.vehicleId,
        plateNumber: vehicle.vehicle.plateNumber,
        make: vehicle.vehicle.make,
        model: vehicle.vehicle.model,
      }
      if (driverId) {
        const driver = await findTransportDriver(tx, scope, driverId)
        locked.driverId = driverId
        locked.driverSnapshot = driver.driver
          ? { id: driverId, fullName: driver.driver.fullName, licenseNumber: driver.driver.licenseNumber }
          : { id: driverId }
      }
      locked.status = 'active'
      locked.odoStartKm = input.odoStartKm
      locked.actualStartAt = input.actualStartAt ? new Date(String(input.actualStartAt)) : now
      locked.handoverAt = now
      locked.updatedAt = now

      tx.create(RentalVehicleCheck, {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        contract: locked,
        kind: 'handover',
        odometerKm: input.odoStartKm,
        fuelLevel: input.fuelLevel ?? null,
        hasDamage: Boolean(input.hasDamage ?? false),
        conditionNotes: optionalString(input.conditionNotes),
        checkedAt: now,
        checkedBy: ctx.auth?.sub ?? null,
        createdAt: now,
        updatedAt: now,
      })
      await tx.persist(locked).flush()
      return locked
    })

    await emitContractUpdate(ctx, contract, scope)
    await emitRentalEvent('vehicle_rentals.rental.handed_over', {
      id: contract.id,
      rentalNumber: contract.rentalNumber,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    })
    return { rentalId: contract.id }
  },
  buildLog: ({ input, ctx }) => {
    const scope = resolveScope(ctx)
    return {
      actionLabel: 'Hand over rental vehicle',
      resourceKind: RENTAL_CONTRACT_ENTITY_ID,
      resourceId: String(input.id ?? ''),
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    }
  },
}

registerCommand(handoverCommand)

/**
 * The return closes the contract: the closing odometer decides the extra
 * kilometres, which decide the extra charge — so the money is recomputed here
 * from the stored rates and written with the reading in one transaction.
 */
const returnCommand: CommandHandler<Record<string, unknown>, { rentalId: string }> = {
  id: 'vehicle_rentals.contracts.return',
  async execute(rawInput, ctx) {
    const input = returnRentalSchema.parse(rawInput)
    const scope = resolveScope(ctx)
    const em = entityManager(ctx)
    const contract = await em.transactional(async (tx) => {
      const locked = await findContractForUpdate(ctx, tx, scope, input.id)
      if (locked.status !== 'active') {
        return raiseRentalError(409, 'rental_not_active', 'Only an active rental can be returned.')
      }
      if (locked.odoStartKm !== null && locked.odoStartKm !== undefined && input.odoEndKm < locked.odoStartKm) {
        return raiseRentalError(409, 'odometer_invalid', 'The closing odometer cannot be below the handover reading.')
      }

      const amounts = computeRentalAmounts({
        durationType: locked.durationType,
        startAt: locked.actualStartAt ?? locked.startAt,
        endAt: input.actualEndAt ? new Date(String(input.actualEndAt)) : new Date(),
        dailyRate: locked.dailyRate,
        weeklyRate: locked.weeklyRate,
        monthlyRate: locked.monthlyRate,
        includedKm: locked.includedKm ?? null,
        extraKmRate: locked.extraKmRate ?? null,
        odoStartKm: locked.odoStartKm ?? null,
        odoEndKm: input.odoEndKm,
        taxRate: locked.taxRate,
      })

      const now = new Date()
      locked.status = 'completed'
      locked.odoEndKm = input.odoEndKm
      locked.usageKm = amounts.usageKm
      locked.extraKm = amounts.extraKm
      locked.rentalAmountNet = amounts.rentalAmountNet
      locked.extraKmAmountNet = amounts.extraKmAmountNet
      locked.totalNetAmount = amounts.totalNetAmount
      locked.taxAmount = amounts.taxAmount
      locked.totalGrossAmount = amounts.totalGrossAmount
      locked.actualEndAt = input.actualEndAt ? new Date(String(input.actualEndAt)) : now
      locked.returnAt = now
      locked.updatedAt = now

      tx.create(RentalVehicleCheck, {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        contract: locked,
        kind: 'return',
        odometerKm: input.odoEndKm,
        fuelLevel: input.fuelLevel ?? null,
        hasDamage: Boolean(input.hasDamage ?? false),
        conditionNotes: optionalString(input.conditionNotes),
        checkedAt: now,
        checkedBy: ctx.auth?.sub ?? null,
        createdAt: now,
        updatedAt: now,
      })
      await tx.persist(locked).flush()
      return locked
    })

    await emitContractUpdate(ctx, contract, scope)
    await emitRentalEvent('vehicle_rentals.rental.returned', {
      id: contract.id,
      rentalNumber: contract.rentalNumber,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      extraKm: contract.extraKm ?? 0,
    })
    return { rentalId: contract.id }
  },
  buildLog: ({ input, ctx }) => {
    const scope = resolveScope(ctx)
    return {
      actionLabel: 'Return rental vehicle',
      resourceKind: RENTAL_CONTRACT_ENTITY_ID,
      resourceId: String(input.id ?? ''),
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    }
  },
}

registerCommand(returnCommand)

const cancelCommand: CommandHandler<Record<string, unknown>, { rentalId: string }> = {
  id: 'vehicle_rentals.contracts.cancel',
  async execute(rawInput, ctx) {
    const input = cancelRentalSchema.parse(rawInput)
    const scope = resolveScope(ctx)
    const em = entityManager(ctx)
    const contract = await em.transactional(async (tx) => {
      const locked = await findContractForUpdate(ctx, tx, scope, input.id)
      if (locked.status !== 'draft' && locked.status !== 'active') {
        return raiseRentalError(409, 'rental_not_cancellable', 'This rental can no longer be cancelled.')
      }
      const now = new Date()
      locked.status = 'cancelled'
      locked.notes = optionalString(input.reason) ?? locked.notes ?? null
      locked.updatedAt = now
      await tx.persist(locked).flush()
      return locked
    })
    await emitContractUpdate(ctx, contract, scope)
    await emitRentalEvent('vehicle_rentals.rental.cancelled', {
      id: contract.id,
      rentalNumber: contract.rentalNumber,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    })
    return { rentalId: contract.id }
  },
  buildLog: ({ input, ctx }) => {
    const scope = resolveScope(ctx)
    return {
      actionLabel: 'Cancel vehicle rental',
      resourceKind: RENTAL_CONTRACT_ENTITY_ID,
      resourceId: String(input.id ?? ''),
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    }
  },
}

registerCommand(cancelCommand)

/**
 * A standalone check document (an inspection during the rental, or a check
 * recorded after the fact). The contract's own handover/return checks are
 * written by those commands; this path never overwrites them.
 */
const recordCheckCommand: CommandHandler<Record<string, unknown>, { checkId: string }> = {
  id: 'vehicle_rentals.checks.record',
  async execute(rawInput, ctx) {
    const input = recordRentalCheckSchema.parse(rawInput)
    const scope = resolveScope(ctx)
    const em = entityManager(ctx)
    const check = await em.transactional(async (tx) => {
      const contract = await tx.findOne(RentalContract, {
        id: input.contractId,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        deletedAt: null,
      })
      if (!contract) return raiseRentalError(404, 'rental_not_found', 'Rental contract not found.')
      const now = new Date()
      const created = tx.create(RentalVehicleCheck, {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        contract,
        kind: input.kind,
        odometerKm: input.odometerKm,
        fuelLevel: input.fuelLevel ?? null,
        hasDamage: Boolean(input.hasDamage ?? false),
        conditionNotes: optionalString(input.conditionNotes),
        checkedAt: input.checkedAt ? new Date(String(input.checkedAt)) : now,
        checkedBy: ctx.auth?.sub ?? null,
        createdAt: now,
        updatedAt: now,
      })
      await tx.persist(created).flush()
      return created
    })
    await emitCheckCreated(ctx, check, scope)
    return { checkId: check.id }
  },
  buildLog: ({ input, ctx }) => {
    const scope = resolveScope(ctx)
    return {
      actionLabel: 'Record rental vehicle check',
      resourceKind: RENTAL_CHECK_ENTITY_ID,
      resourceId: String(input.contractId ?? ''),
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    }
  },
}

registerCommand(recordCheckCommand)

function overlapWindow(contract: RentalContract, actualStartAt: unknown): { start: Date; end: Date } {
  const start = actualStartAt ? new Date(String(actualStartAt)) : (contract.startAt ? new Date(contract.startAt) : new Date())
  const end = contract.endAt ? new Date(contract.endAt) : new Date(start.getTime() + 86_400_000)
  return { start, end: end.getTime() > start.getTime() ? end : new Date(start.getTime() + 86_400_000) }
}
