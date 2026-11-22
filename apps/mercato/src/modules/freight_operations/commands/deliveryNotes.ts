import { LockMode } from '@mikro-orm/core'
import type { EntityData, EntityManager } from '@mikro-orm/postgresql'
import { registerCommand, type CommandHandler, type CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { enforceCommandOptimisticLockWithGuards } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { ModuleConfigService } from '@open-mercato/core/modules/configs/lib/module-config-service'
import { FreightDeliveryNote, FreightOrder, FreightTrip, type CargoUnit } from '../data/entities'
import {
  cancelDeliveryNoteSchema,
  createDeliveryNoteSchema,
  deliverDeliveryNoteSchema,
  deliveryNoteActionSchema,
  recordExternalWaybillSchema,
  updateDeliveryNoteSchema,
  type CancelDeliveryNoteInput,
  type DeliverDeliveryNoteInput,
  type RecordExternalWaybillInput,
} from '../data/validators'
import { registerCrudCommands, resolveScope, type CrudCommandConfig } from './crud'
import { FREIGHT_DELIVERY_NOTE_ENTITY_ID, freightDeliveryNoteEvents, freightDeliveryNoteIndexer } from './entities'
import { raiseFreightError } from '../lib/errors'
import { readFreightSettings, type FreightScope } from '../lib/freightSettings'
import { allocateDocumentNumber } from '../lib/documentNumber'
import { resolveDeliveryNoteSource } from '../lib/deliveryNoteSource'
import {
  canCancelDeliveryNote,
  canTransitionDeliveryNote,
  isDeliveryNoteDeletable,
  isDeliveryNoteEditable,
} from '../lib/deliveryNote'
import { findTransportDriver, findTransportVehicle } from '../lib/transportReference'
import { readSaudiVatSettings } from '../../saudi_localization/lib/vat-settings'
import { emitFreightEvent } from '../events'

function compact(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined))
}

function optionalString(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const trimmed = String(value).trim()
  return trimmed.length > 0 ? trimmed : null
}

function toDate(value: unknown): Date | null {
  if (value === null || value === undefined || value === '') return null
  if (value instanceof Date) return value
  const parsed = new Date(String(value))
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function entityManager(ctx: CommandRuntimeContext): EntityManager {
  return (ctx.container.resolve('em') as EntityManager).fork()
}

async function loadSettings(ctx: CommandRuntimeContext, scope: FreightScope) {
  const configService = ctx.container.resolve('moduleConfigService') as ModuleConfigService
  return readFreightSettings(configService, scope)
}

async function loadSellerSnapshot(ctx: CommandRuntimeContext, scope: FreightScope) {
  const configService = ctx.container.resolve('moduleConfigService') as ModuleConfigService
  const settings = await readSaudiVatSettings(configService, scope)
  return {
    sellerName: settings.sellerName,
    vatRegistrationNumber: settings.vatRegistrationNumber,
    commercialRegistrationNumber: settings.commercialRegistrationNumber,
  }
}

async function findDeliveryNoteForUpdate(
  ctx: CommandRuntimeContext,
  em: EntityManager,
  scope: FreightScope,
  id: string,
): Promise<FreightDeliveryNote> {
  const note = await em.findOne(
    FreightDeliveryNote,
    { id, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null },
    { lockMode: LockMode.PESSIMISTIC_WRITE },
  )
  if (!note) return raiseFreightError(404, 'delivery_note_not_found', 'Delivery note not found.')
  await enforceCommandOptimisticLockWithGuards(ctx.container, {
    resourceKind: FREIGHT_DELIVERY_NOTE_ENTITY_ID,
    resourceId: note.id,
    current: note.updatedAt,
    request: ctx.request ?? null,
  })
  return note
}

async function emitDeliveryNoteUpdate(
  ctx: CommandRuntimeContext,
  note: FreightDeliveryNote,
  scope: FreightScope,
): Promise<void> {
  const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
  await emitCrudSideEffects({
    dataEngine,
    action: 'updated',
    entity: note,
    identifiers: { id: note.id, ...scope },
    actorUserId: ctx.auth?.sub ?? null,
    events: freightDeliveryNoteEvents,
    indexer: freightDeliveryNoteIndexer,
  })
}

async function emitDeliveryNoteLifecycle(
  eventId: Parameters<typeof emitFreightEvent>[0],
  note: FreightDeliveryNote,
  scope: FreightScope,
  extra: Record<string, unknown> = {},
): Promise<void> {
  await emitFreightEvent(eventId, {
    id: note.id,
    noteNumber: note.noteNumber,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    ...extra,
  })
}

const deliveryNoteCrudConfig: CrudCommandConfig<FreightDeliveryNote> = {
  entity: FreightDeliveryNote,
  entityId: FREIGHT_DELIVERY_NOTE_ENTITY_ID,
  resource: 'delivery_notes',
  createSchema: createDeliveryNoteSchema,
  updateSchema: updateDeliveryNoteSchema,
  toCreateData: async (input, ctx) => {
    const scope = resolveScope(ctx)
    const settings = await loadSettings(ctx, scope)
    const em = entityManager(ctx)
    const source = await resolveDeliveryNoteSource(
      em,
      scope,
      {
        freightOrderId: (input.freightOrderId as string | null | undefined) ?? null,
        freightTripId: (input.freightTripId as string | null | undefined) ?? null,
      },
      {
        cargoDescription: (input.cargoDescription as string | null | undefined) ?? undefined,
        cargoQuantity: (input.cargoQuantity as string | null | undefined) ?? undefined,
        cargoUnit: (input.cargoUnit as CargoUnit | null | undefined) ?? undefined,
        cargoWeightKg: (input.cargoWeightKg as string | null | undefined) ?? undefined,
        cargoVolumeM3: (input.cargoVolumeM3 as string | null | undefined) ?? undefined,
        cargoHazardous: input.cargoHazardous as boolean | undefined,
        cargoRefrigerated: input.cargoRefrigerated as boolean | undefined,
        sealNumber: (input.sealNumber as string | null | undefined) ?? undefined,
      },
    )
    const noteNumber = await allocateDocumentNumber(em, scope, 'delivery_note', settings)
    const customerName =
      typeof source.customerSnapshot.displayName === 'string' ? source.customerSnapshot.displayName : null
    return {
      noteNumber,
      status: 'draft',
      freightOrderId: source.freightOrderId,
      freightTripId: source.freightTripId,
      orderNumberSnapshot: source.orderNumberSnapshot,
      tripNumberSnapshot: source.tripNumberSnapshot,
      customerId: source.customerId,
      customerSnapshot: source.customerSnapshot,
      sellerSnapshot: {},
      consigneeName: optionalString(input.consigneeName) ?? customerName,
      consigneePhone:
        optionalString(input.consigneePhone) ??
        (typeof source.customerSnapshot.primaryPhone === 'string'
          ? source.customerSnapshot.primaryPhone
          : null),
      consigneeAddress: optionalString(input.consigneeAddress),
      origin: source.origin,
      destination: source.destination,
      requestedPickupAt: source.requestedPickupAt,
      requestedDeliveryAt: source.requestedDeliveryAt,
      cargoDescription: source.cargoDescription,
      cargoQuantity: source.cargoQuantity,
      cargoUnit: source.cargoUnit,
      cargoWeightKg: source.cargoWeightKg,
      cargoVolumeM3: source.cargoVolumeM3,
      cargoHazardous: source.cargoHazardous,
      cargoRefrigerated: source.cargoRefrigerated,
      sealNumber: source.sealNumber,
      vehicleId: source.vehicleId,
      driverId: source.driverId,
      vehicleSnapshot: source.vehicleSnapshot,
      driverSnapshot: source.driverSnapshot,
      externalWaybillStatus: 'not_recorded',
      notes: optionalString(input.notes),
    } as EntityData<FreightDeliveryNote>
  },
  toUpdateData: (input) => {
    const patch = compact({
      consigneeName: input.consigneeName,
      consigneePhone: input.consigneePhone,
      consigneeAddress: input.consigneeAddress,
      cargoDescription: input.cargoDescription,
      cargoQuantity: input.cargoQuantity,
      cargoUnit: input.cargoUnit,
      cargoWeightKg: input.cargoWeightKg,
      cargoVolumeM3: input.cargoVolumeM3,
      cargoHazardous: input.cargoHazardous,
      cargoRefrigerated: input.cargoRefrigerated,
      sealNumber: input.sealNumber,
      notes: input.notes,
    })
    return patch as EntityData<FreightDeliveryNote>
  },
  events: freightDeliveryNoteEvents,
  indexer: freightDeliveryNoteIndexer,
  beforeUpdate: async (_input, current, _scope, ctx) => {
    const note = current as FreightDeliveryNote
    if (!isDeliveryNoteEditable(note.status)) {
      return raiseFreightError(409, 'delivery_note_not_editable', 'Only draft delivery notes can be edited.')
    }
    await enforceCommandOptimisticLockWithGuards(ctx.container, {
      resourceKind: FREIGHT_DELIVERY_NOTE_ENTITY_ID,
      resourceId: note.id,
      current: note.updatedAt,
      request: ctx.request ?? null,
    })
  },
  beforeDelete: async (current, _scope, ctx) => {
    const note = current as FreightDeliveryNote
    if (!isDeliveryNoteDeletable(note.status)) {
      return raiseFreightError(409, 'delivery_note_not_deletable', 'Only draft delivery notes can be deleted.')
    }
    await enforceCommandOptimisticLockWithGuards(ctx.container, {
      resourceKind: FREIGHT_DELIVERY_NOTE_ENTITY_ID,
      resourceId: note.id,
      current: note.updatedAt,
      request: ctx.request ?? null,
    })
  },
}

registerCrudCommands(deliveryNoteCrudConfig)

const issueDeliveryNoteCommand: CommandHandler<{ id: string }, { deliveryNoteId: string }> = {
  id: 'freight_operations.delivery_notes.issue',
  async execute(rawInput, ctx) {
    const input = deliveryNoteActionSchema.parse(rawInput)
    const scope = resolveScope(ctx)
    const sellerSnapshot = await loadSellerSnapshot(ctx, scope)
    if (!sellerSnapshot.sellerName.trim()) {
      return raiseFreightError(
        409,
        'seller_not_configured',
        'Configure the Saudi VAT seller identity before issuing a delivery note.',
      )
    }
    const em = entityManager(ctx)
    const note = await em.transactional(async (tx) => {
      const locked = await findDeliveryNoteForUpdate(ctx, tx, scope, input.id)
      if (!canTransitionDeliveryNote(locked.status, 'issued')) {
        return raiseFreightError(409, 'delivery_note_not_draft', 'Only draft delivery notes can be issued.')
      }
      if (locked.freightOrderId) {
        const order = await tx.findOne(FreightOrder, {
          id: locked.freightOrderId,
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          deletedAt: null,
        })
        if (!order || order.status === 'cancelled') {
          return raiseFreightError(409, 'source_order_cancelled', 'The source order is no longer available.')
        }
      }
      if (locked.freightTripId) {
        const trip = await tx.findOne(FreightTrip, {
          id: locked.freightTripId,
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          deletedAt: null,
        })
        if (!trip || trip.executionStatus === 'cancelled') {
          return raiseFreightError(409, 'source_trip_cancelled', 'The source trip is no longer available.')
        }
      }
      if (!locked.vehicleId && !locked.vehicleSnapshot) {
        return raiseFreightError(409, 'vehicle_required', 'Assign a vehicle before issuing the delivery note.')
      }
      if (!locked.driverId && !locked.driverSnapshot) {
        return raiseFreightError(409, 'driver_required', 'Assign a driver before issuing the delivery note.')
      }
      const vehicleLookup = locked.vehicleId
        ? await findTransportVehicle(tx, scope, locked.vehicleId)
        : null
      const driverLookup = locked.driverId
        ? await findTransportDriver(tx, scope, locked.driverId)
        : null
      const vehicleSnapshot =
        vehicleLookup?.vehicle
          ? {
              id: vehicleLookup.vehicle.id,
              plateNumber: vehicleLookup.vehicle.plateNumber,
              make: vehicleLookup.vehicle.make,
              model: vehicleLookup.vehicle.model,
            }
          : locked.vehicleSnapshot ?? null
      const driverSnapshot =
        driverLookup?.driver
          ? {
              id: driverLookup.driver.id,
              fullName: driverLookup.driver.fullName,
              phone: driverLookup.driver.phone,
              licenseNumber: driverLookup.driver.licenseNumber,
            }
          : locked.driverSnapshot ?? null
      if (!vehicleSnapshot) {
        return raiseFreightError(409, 'vehicle_required', 'The assigned vehicle could not be resolved.')
      }
      if (!driverSnapshot) {
        return raiseFreightError(409, 'driver_required', 'The assigned driver could not be resolved.')
      }
      const issuedAt = new Date()
      locked.status = 'issued'
      locked.issuedAt = issuedAt
      locked.sellerSnapshot = sellerSnapshot
      locked.vehicleSnapshot = vehicleSnapshot
      locked.driverSnapshot = driverSnapshot
      locked.updatedAt = issuedAt
      await tx.persist(locked).flush()
      return locked
    })
    await emitDeliveryNoteUpdate(ctx, note, scope)
    await emitDeliveryNoteLifecycle('freight_operations.delivery_note.issued', note, scope)
    return { deliveryNoteId: note.id }
  },
  buildLog: ({ input, ctx }) => {
    const scope = resolveScope(ctx)
    return {
      actionLabel: 'Issue delivery note',
      resourceKind: FREIGHT_DELIVERY_NOTE_ENTITY_ID,
      resourceId: input.id,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    }
  },
}

const deliverDeliveryNoteCommand: CommandHandler<DeliverDeliveryNoteInput, { deliveryNoteId: string }> = {
  id: 'freight_operations.delivery_notes.deliver',
  async execute(rawInput, ctx) {
    const input = deliverDeliveryNoteSchema.parse(rawInput)
    const scope = resolveScope(ctx)
    const em = entityManager(ctx)
    const note = await em.transactional(async (tx) => {
      const locked = await findDeliveryNoteForUpdate(ctx, tx, scope, input.id)
      if (!canTransitionDeliveryNote(locked.status, 'delivered')) {
        return raiseFreightError(409, 'delivery_note_not_issued', 'Only issued delivery notes can be delivered.')
      }
      const deliveredAt = toDate(input.deliveredAt) ?? new Date()
      locked.status = 'delivered'
      locked.deliveredAt = deliveredAt
      locked.receivedByName = optionalString(input.receivedByName)
      locked.receivedByIdNumber = optionalString(input.receivedByIdNumber)
      locked.podDocumentId = optionalString(input.podDocumentId)
      locked.podReference = optionalString(input.podReference)
      locked.popDocumentId = optionalString(input.popDocumentId)
      locked.popReference = optionalString(input.popReference)
      locked.updatedAt = deliveredAt
      await tx.persist(locked).flush()
      return locked
    })
    await emitDeliveryNoteUpdate(ctx, note, scope)
    await emitDeliveryNoteLifecycle('freight_operations.delivery_note.delivered', note, scope)
    return { deliveryNoteId: note.id }
  },
  buildLog: ({ input, ctx }) => {
    const scope = resolveScope(ctx)
    return {
      actionLabel: 'Record delivery note receipt',
      resourceKind: FREIGHT_DELIVERY_NOTE_ENTITY_ID,
      resourceId: input.id,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    }
  },
}

const cancelDeliveryNoteCommand: CommandHandler<CancelDeliveryNoteInput, { deliveryNoteId: string }> = {
  id: 'freight_operations.delivery_notes.cancel',
  async execute(rawInput, ctx) {
    const input = cancelDeliveryNoteSchema.parse(rawInput)
    const scope = resolveScope(ctx)
    const em = entityManager(ctx)
    const note = await em.transactional(async (tx) => {
      const locked = await findDeliveryNoteForUpdate(ctx, tx, scope, input.id)
      if (!canTransitionDeliveryNote(locked.status, 'cancelled')) {
        return raiseFreightError(409, 'delivery_note_not_cancellable', 'This delivery note cannot be cancelled.')
      }
      if (!canCancelDeliveryNote(locked.externalWaybillStatus)) {
        return raiseFreightError(
          409,
          'waybill_active',
          'Cancel the external Bayan Naql waybill before cancelling the delivery note.',
        )
      }
      const cancelledAt = new Date()
      locked.status = 'cancelled'
      locked.cancellationReason = input.reason
      locked.cancelledAt = cancelledAt
      locked.updatedAt = cancelledAt
      await tx.persist(locked).flush()
      return locked
    })
    await emitDeliveryNoteUpdate(ctx, note, scope)
    await emitDeliveryNoteLifecycle('freight_operations.delivery_note.cancelled', note, scope)
    return { deliveryNoteId: note.id }
  },
  buildLog: ({ input, ctx }) => {
    const scope = resolveScope(ctx)
    return {
      actionLabel: 'Cancel delivery note',
      resourceKind: FREIGHT_DELIVERY_NOTE_ENTITY_ID,
      resourceId: input.id,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    }
  },
}

const recordExternalWaybillCommand: CommandHandler<RecordExternalWaybillInput, { deliveryNoteId: string }> = {
  id: 'freight_operations.delivery_notes.record_waybill',
  async execute(rawInput, ctx) {
    const input = recordExternalWaybillSchema.parse(rawInput)
    const scope = resolveScope(ctx)
    const em = entityManager(ctx)
    const note = await em.transactional(async (tx) => {
      const locked = await findDeliveryNoteForUpdate(ctx, tx, scope, input.id)
      if (locked.status === 'cancelled') {
        return raiseFreightError(409, 'delivery_note_cancelled', 'A cancelled delivery note cannot carry a waybill.')
      }
      if (input.status === 'recorded' && locked.status === 'draft') {
        return raiseFreightError(409, 'delivery_note_not_issued', 'Issue the delivery note before recording a waybill.')
      }
      const recordedAt = new Date()
      if (input.status === 'recorded') {
        locked.externalWaybillNumber = optionalString(input.waybillNumber)
        locked.externalWaybillStatus = 'recorded'
        locked.externalWaybillUrl = optionalString(input.url)
        locked.externalWaybillNotes = optionalString(input.notes)
        locked.externalWaybillRecordedAt = recordedAt
        locked.externalWaybillCancelledAt = null
      } else {
        if (locked.externalWaybillStatus !== 'recorded') {
          return raiseFreightError(409, 'waybill_not_recorded', 'There is no recorded waybill to cancel.')
        }
        locked.externalWaybillStatus = 'cancelled'
        locked.externalWaybillCancelledAt = recordedAt
        if (optionalString(input.notes)) {
          locked.externalWaybillNotes = optionalString(input.notes)
        }
      }
      locked.updatedAt = recordedAt
      await tx.persist(locked).flush()
      return locked
    })
    await emitDeliveryNoteUpdate(ctx, note, scope)
    await emitDeliveryNoteLifecycle('freight_operations.delivery_note.waybill_recorded', note, scope, {
      status: note.externalWaybillStatus,
      waybillNumber: note.externalWaybillNumber,
    })
    return { deliveryNoteId: note.id }
  },
  buildLog: ({ input, ctx }) => {
    const scope = resolveScope(ctx)
    return {
      actionLabel: input.status === 'cancelled' ? 'Cancel external waybill' : 'Record external waybill',
      resourceKind: FREIGHT_DELIVERY_NOTE_ENTITY_ID,
      resourceId: input.id,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    }
  },
}

registerCommand(issueDeliveryNoteCommand)
registerCommand(deliverDeliveryNoteCommand)
registerCommand(cancelDeliveryNoteCommand)
registerCommand(recordExternalWaybillCommand)
