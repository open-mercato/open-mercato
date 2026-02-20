import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { CrudEventsConfig, CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import { emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { E } from '#generated/entities.ids.generated'
import { z } from 'zod'
import {
  InventoryBalance,
  InventoryMovement,
  InventoryReservation,
} from '../data/entities'
import {
  inventoryAdjustSchema,
  reservationCreateSchema,
  inventoryReleaseBaseSchema,
  inventoryAllocateBaseSchema,
  inventoryMoveSchema,
  cycleCountSchema,
} from '../data/validators'
import {
  resolveStrategy,
  getOrderedBalances,
  computeAvailable,
  type StrategyContext,
} from '../lib/strategy'

const scopeSchema = z.object({ tenant_id: z.string().uuid(), organization_id: z.string().uuid() })

const balanceCrudEvents: CrudEventsConfig<InventoryBalance> = {
  module: 'wms',
  entity: 'inventory_balance',
  persistent: true,
  buildPayload: (ctx) => ({
    id: ctx.identifiers.id,
    tenantId: ctx.identifiers.tenantId,
    organizationId: ctx.identifiers.organizationId,
  }),
}

const balanceIndexer: CrudIndexerConfig<InventoryBalance> = {
  entityType: (E as { wms?: { inventory_balance: string } }).wms?.inventory_balance ?? 'wms:inventory_balance',
}

const movementCrudEvents: CrudEventsConfig<InventoryMovement> = {
  module: 'wms',
  entity: 'inventory_movement',
  persistent: true,
  buildPayload: (ctx) => ({
    id: ctx.identifiers.id,
    tenantId: ctx.identifiers.tenantId,
    organizationId: ctx.identifiers.organizationId,
  }),
}

const movementIndexer: CrudIndexerConfig<InventoryMovement> = {
  entityType: (E as { wms?: { inventory_movement: string } }).wms?.inventory_movement ?? 'wms:inventory_movement',
}

function getPerformedBy(ctx: { auth: { userId?: string } | null }): string | null {
  return ctx.auth?.userId ?? null
}

// ─── ADJUST ──────────────────────────────────────────────────────────

type AdjustInput = z.infer<typeof inventoryAdjustSchema> & z.infer<typeof scopeSchema>

registerCommand({
  id: 'wms.inventory.adjust',
  execute: async (raw, ctx) => {
    const parsed = inventoryAdjustSchema.merge(scopeSchema).parse(raw) as AdjustInput
    const em = ctx.container.resolve<EntityManager>('em').fork()
    const dataEngine = ctx.container.resolve<DataEngine>('dataEngine')

    let balance = await em.findOne(InventoryBalance, {
      warehouseId: parsed.warehouse_id,
      locationId: parsed.location_id,
      catalogVariantId: parsed.catalog_variant_id,
      lotId: parsed.lot_id ?? null,
      tenantId: parsed.tenant_id,
      organizationId: parsed.organization_id,
      deletedAt: null,
    })

    if (!balance) {
      balance = em.create(InventoryBalance, {
        tenantId: parsed.tenant_id,
        organizationId: parsed.organization_id,
        warehouseId: parsed.warehouse_id,
        locationId: parsed.location_id,
        catalogVariantId: parsed.catalog_variant_id,
        lotId: parsed.lot_id ?? null,
        quantityOnHand: 0,
        quantityReserved: 0,
        quantityAllocated: 0,
      })
    }

    balance.quantityOnHand += parsed.quantity_delta
    if (balance.quantityOnHand < 0) {
      throw new Error(`Adjustment would result in negative on-hand quantity (${balance.quantityOnHand})`)
    }

    const movement = em.create(InventoryMovement, {
      tenantId: parsed.tenant_id,
      organizationId: parsed.organization_id,
      warehouseId: parsed.warehouse_id,
      locationFromId: parsed.quantity_delta < 0 ? parsed.location_id : null,
      locationToId: parsed.quantity_delta >= 0 ? parsed.location_id : null,
      catalogVariantId: parsed.catalog_variant_id,
      lotId: parsed.lot_id ?? null,
      quantity: parsed.quantity_delta,
      type: 'adjust',
      referenceType: 'manual',
      performedBy: getPerformedBy(ctx),
      reason: parsed.reason,
    })

    await em.flush()

    await emitCrudSideEffects({
      dataEngine,
      action: 'updated',
      entity: balance,
      identifiers: { id: balance.id, tenantId: balance.tenantId, organizationId: balance.organizationId },
      events: balanceCrudEvents,
      indexer: balanceIndexer,
    })
    await emitCrudSideEffects({
      dataEngine,
      action: 'created',
      entity: movement,
      identifiers: { id: movement.id, tenantId: movement.tenantId, organizationId: movement.organizationId },
      events: movementCrudEvents,
      indexer: movementIndexer,
    })

    return {
      balance_id: balance.id,
      movement_id: movement.id,
      quantity_on_hand: balance.quantityOnHand,
    }
  },
} as CommandHandler<AdjustInput, { balance_id: string; movement_id: string; quantity_on_hand: number }>)

// ─── RESERVE ─────────────────────────────────────────────────────────

type ReserveInput = z.infer<typeof reservationCreateSchema> & z.infer<typeof scopeSchema>

registerCommand({
  id: 'wms.inventory.reserve',
  execute: async (raw, ctx) => {
    const parsed = reservationCreateSchema.merge(scopeSchema).parse(raw) as ReserveInput
    const em = ctx.container.resolve<EntityManager>('em').fork()
    const dataEngine = ctx.container.resolve<DataEngine>('dataEngine')

    const strategyCtx: StrategyContext = {
      em,
      warehouseId: parsed.warehouse_id,
      catalogVariantId: parsed.catalog_variant_id,
      tenantId: parsed.tenant_id,
      organizationId: parsed.organization_id,
    }

    const strategy = await resolveStrategy(strategyCtx)
    const balances = await getOrderedBalances(strategyCtx, strategy)

    let remaining = parsed.quantity
    const updatedBalances: InventoryBalance[] = []

    for (const balance of balances) {
      if (remaining <= 0) break
      const available = computeAvailable(balance)
      if (available <= 0) continue

      const toReserve = Math.min(available, remaining)
      balance.quantityReserved += toReserve
      remaining -= toReserve
      updatedBalances.push(balance)
    }

    if (remaining > 0) {
      throw new Error(`Insufficient available inventory. Short by ${remaining} units.`)
    }

    const reservation = em.create(InventoryReservation, {
      tenantId: parsed.tenant_id,
      organizationId: parsed.organization_id,
      warehouseId: parsed.warehouse_id,
      catalogVariantId: parsed.catalog_variant_id,
      lotId: parsed.lot_id ?? null,
      quantity: parsed.quantity,
      sourceType: parsed.source_type,
      sourceId: parsed.source_id,
      expiresAt: parsed.expires_at ?? null,
      status: 'active',
    })

    await em.flush()

    for (const balance of updatedBalances) {
      await emitCrudSideEffects({
        dataEngine,
        action: 'updated',
        entity: balance,
        identifiers: { id: balance.id, tenantId: balance.tenantId, organizationId: balance.organizationId },
        events: balanceCrudEvents,
        indexer: balanceIndexer,
      })
    }

    return { reservation_id: reservation.id }
  },
} as CommandHandler<ReserveInput, { reservation_id: string }>)

// ─── RELEASE ─────────────────────────────────────────────────────────

type ReleaseInput = z.infer<typeof inventoryReleaseBaseSchema> & z.infer<typeof scopeSchema>

registerCommand({
  id: 'wms.inventory.release',
  execute: async (raw, ctx) => {
    const parsed = inventoryReleaseBaseSchema.merge(scopeSchema).parse(raw) as ReleaseInput
    const em = ctx.container.resolve<EntityManager>('em').fork()
    const dataEngine = ctx.container.resolve<DataEngine>('dataEngine')

    let reservation: InventoryReservation | null = null
    if (parsed.reservation_id) {
      reservation = await em.findOne(InventoryReservation, {
        id: parsed.reservation_id,
        tenantId: parsed.tenant_id,
        organizationId: parsed.organization_id,
        status: 'active',
        deletedAt: null,
      })
    } else if (parsed.warehouse_id && parsed.catalog_variant_id) {
      const where: Record<string, unknown> = {
        warehouseId: parsed.warehouse_id,
        catalogVariantId: parsed.catalog_variant_id,
        tenantId: parsed.tenant_id,
        organizationId: parsed.organization_id,
        status: 'active',
        deletedAt: null,
      }
      if (parsed.source_type) where.sourceType = parsed.source_type
      if (parsed.source_id) where.sourceId = parsed.source_id
      reservation = await em.findOne(InventoryReservation, where)
    }

    if (!reservation) {
      throw new Error('Active reservation not found')
    }

    const balances = await em.find(InventoryBalance, {
      warehouseId: reservation.warehouseId,
      catalogVariantId: reservation.catalogVariantId,
      tenantId: parsed.tenant_id,
      organizationId: parsed.organization_id,
      deletedAt: null,
    })

    let toRelease = reservation.quantity
    const updatedBalances: InventoryBalance[] = []

    for (const balance of balances) {
      if (toRelease <= 0) break
      const releaseFromThis = Math.min(balance.quantityReserved, toRelease)
      if (releaseFromThis > 0) {
        balance.quantityReserved -= releaseFromThis
        toRelease -= releaseFromThis
        updatedBalances.push(balance)
      }
    }

    reservation.status = 'released'
    await em.flush()

    for (const balance of updatedBalances) {
      await emitCrudSideEffects({
        dataEngine,
        action: 'updated',
        entity: balance,
        identifiers: { id: balance.id, tenantId: balance.tenantId, organizationId: balance.organizationId },
        events: balanceCrudEvents,
        indexer: balanceIndexer,
      })
    }

    return { reservation_id: reservation.id, status: 'released' }
  },
} as CommandHandler<ReleaseInput, { reservation_id: string; status: string }>)

// ─── ALLOCATE ────────────────────────────────────────────────────────

type AllocateInput = z.infer<typeof inventoryAllocateBaseSchema> & z.infer<typeof scopeSchema>

registerCommand({
  id: 'wms.inventory.allocate',
  execute: async (raw, ctx) => {
    const parsed = inventoryAllocateBaseSchema.merge(scopeSchema).parse(raw) as AllocateInput
    const em = ctx.container.resolve<EntityManager>('em').fork()
    const dataEngine = ctx.container.resolve<DataEngine>('dataEngine')

    let reservation: InventoryReservation | null = null
    if (parsed.reservation_id) {
      reservation = await em.findOne(InventoryReservation, {
        id: parsed.reservation_id,
        tenantId: parsed.tenant_id,
        organizationId: parsed.organization_id,
        status: 'active',
        deletedAt: null,
      })
    } else if (parsed.warehouse_id && parsed.catalog_variant_id) {
      const where: Record<string, unknown> = {
        warehouseId: parsed.warehouse_id,
        catalogVariantId: parsed.catalog_variant_id,
        tenantId: parsed.tenant_id,
        organizationId: parsed.organization_id,
        status: 'active',
        deletedAt: null,
      }
      if (parsed.source_type) where.sourceType = parsed.source_type
      if (parsed.source_id) where.sourceId = parsed.source_id
      reservation = await em.findOne(InventoryReservation, where)
    }

    if (!reservation) {
      throw new Error('Active reservation not found')
    }

    const balances = await em.find(InventoryBalance, {
      warehouseId: reservation.warehouseId,
      catalogVariantId: reservation.catalogVariantId,
      tenantId: parsed.tenant_id,
      organizationId: parsed.organization_id,
      deletedAt: null,
    })

    let toAllocate = reservation.quantity
    const updatedBalances: InventoryBalance[] = []

    for (const balance of balances) {
      if (toAllocate <= 0) break
      const allocFromReserved = Math.min(balance.quantityReserved, toAllocate)
      if (allocFromReserved > 0) {
        balance.quantityReserved -= allocFromReserved
        balance.quantityAllocated += allocFromReserved
        toAllocate -= allocFromReserved
        updatedBalances.push(balance)
      }
    }

    reservation.status = 'fulfilled'

    const movement = em.create(InventoryMovement, {
      tenantId: parsed.tenant_id,
      organizationId: parsed.organization_id,
      warehouseId: reservation.warehouseId,
      catalogVariantId: reservation.catalogVariantId,
      lotId: reservation.lotId ?? null,
      quantity: reservation.quantity,
      type: 'pick',
      referenceType: reservation.sourceType,
      referenceId: reservation.sourceId,
      performedBy: getPerformedBy(ctx),
      reason: `Allocated from reservation ${reservation.id}`,
    })

    await em.flush()

    for (const balance of updatedBalances) {
      await emitCrudSideEffects({
        dataEngine,
        action: 'updated',
        entity: balance,
        identifiers: { id: balance.id, tenantId: balance.tenantId, organizationId: balance.organizationId },
        events: balanceCrudEvents,
        indexer: balanceIndexer,
      })
    }
    await emitCrudSideEffects({
      dataEngine,
      action: 'created',
      entity: movement,
      identifiers: { id: movement.id, tenantId: movement.tenantId, organizationId: movement.organizationId },
      events: movementCrudEvents,
      indexer: movementIndexer,
    })

    return { reservation_id: reservation.id, movement_id: movement.id, status: 'fulfilled' }
  },
} as CommandHandler<AllocateInput, { reservation_id: string; movement_id: string; status: string }>)

// ─── MOVE ────────────────────────────────────────────────────────────

type MoveInput = z.infer<typeof inventoryMoveSchema> & z.infer<typeof scopeSchema>

registerCommand({
  id: 'wms.inventory.move',
  execute: async (raw, ctx) => {
    const parsed = inventoryMoveSchema.merge(scopeSchema).parse(raw) as MoveInput
    const em = ctx.container.resolve<EntityManager>('em').fork()
    const dataEngine = ctx.container.resolve<DataEngine>('dataEngine')

    const sourceBalance = await em.findOne(InventoryBalance, {
      warehouseId: parsed.warehouse_id,
      locationId: parsed.location_from_id,
      catalogVariantId: parsed.catalog_variant_id,
      lotId: parsed.lot_id ?? null,
      tenantId: parsed.tenant_id,
      organizationId: parsed.organization_id,
      deletedAt: null,
    })

    if (!sourceBalance) {
      throw new Error('Source balance not found at the specified location')
    }

    const available = computeAvailable(sourceBalance)
    if (available < parsed.quantity) {
      throw new Error(`Insufficient available quantity at source. Available: ${available}, requested: ${parsed.quantity}`)
    }

    sourceBalance.quantityOnHand -= parsed.quantity

    let destBalance = await em.findOne(InventoryBalance, {
      warehouseId: parsed.warehouse_id,
      locationId: parsed.location_to_id,
      catalogVariantId: parsed.catalog_variant_id,
      lotId: parsed.lot_id ?? null,
      tenantId: parsed.tenant_id,
      organizationId: parsed.organization_id,
      deletedAt: null,
    })

    if (!destBalance) {
      destBalance = em.create(InventoryBalance, {
        tenantId: parsed.tenant_id,
        organizationId: parsed.organization_id,
        warehouseId: parsed.warehouse_id,
        locationId: parsed.location_to_id,
        catalogVariantId: parsed.catalog_variant_id,
        lotId: parsed.lot_id ?? null,
        serialNumber: parsed.serial_number ?? null,
        quantityOnHand: 0,
        quantityReserved: 0,
        quantityAllocated: 0,
      })
    }

    destBalance.quantityOnHand += parsed.quantity

    const movement = em.create(InventoryMovement, {
      tenantId: parsed.tenant_id,
      organizationId: parsed.organization_id,
      warehouseId: parsed.warehouse_id,
      locationFromId: parsed.location_from_id,
      locationToId: parsed.location_to_id,
      catalogVariantId: parsed.catalog_variant_id,
      lotId: parsed.lot_id ?? null,
      serialNumber: parsed.serial_number ?? null,
      quantity: parsed.quantity,
      type: 'transfer',
      referenceType: 'manual',
      performedBy: getPerformedBy(ctx),
      reason: parsed.reason ?? null,
    })

    await em.flush()

    await emitCrudSideEffects({
      dataEngine,
      action: 'updated',
      entity: sourceBalance,
      identifiers: { id: sourceBalance.id, tenantId: sourceBalance.tenantId, organizationId: sourceBalance.organizationId },
      events: balanceCrudEvents,
      indexer: balanceIndexer,
    })
    await emitCrudSideEffects({
      dataEngine,
      action: 'updated',
      entity: destBalance,
      identifiers: { id: destBalance.id, tenantId: destBalance.tenantId, organizationId: destBalance.organizationId },
      events: balanceCrudEvents,
      indexer: balanceIndexer,
    })
    await emitCrudSideEffects({
      dataEngine,
      action: 'created',
      entity: movement,
      identifiers: { id: movement.id, tenantId: movement.tenantId, organizationId: movement.organizationId },
      events: movementCrudEvents,
      indexer: movementIndexer,
    })

    return {
      movement_id: movement.id,
      source_balance_id: sourceBalance.id,
      dest_balance_id: destBalance.id,
    }
  },
} as CommandHandler<MoveInput, { movement_id: string; source_balance_id: string; dest_balance_id: string }>)

// ─── CYCLE COUNT ─────────────────────────────────────────────────────

type CycleCountInput = z.infer<typeof cycleCountSchema> & z.infer<typeof scopeSchema>

registerCommand({
  id: 'wms.inventory.cycle_count',
  execute: async (raw, ctx) => {
    const parsed = cycleCountSchema.merge(scopeSchema).parse(raw) as CycleCountInput
    const em = ctx.container.resolve<EntityManager>('em').fork()
    const dataEngine = ctx.container.resolve<DataEngine>('dataEngine')

    let balance = await em.findOne(InventoryBalance, {
      warehouseId: parsed.warehouse_id,
      locationId: parsed.location_id,
      catalogVariantId: parsed.catalog_variant_id,
      lotId: parsed.lot_id ?? null,
      tenantId: parsed.tenant_id,
      organizationId: parsed.organization_id,
      deletedAt: null,
    })

    const previousOnHand = balance?.quantityOnHand ?? 0
    const delta = parsed.counted_quantity - previousOnHand

    if (!balance) {
      balance = em.create(InventoryBalance, {
        tenantId: parsed.tenant_id,
        organizationId: parsed.organization_id,
        warehouseId: parsed.warehouse_id,
        locationId: parsed.location_id,
        catalogVariantId: parsed.catalog_variant_id,
        lotId: parsed.lot_id ?? null,
        serialNumber: parsed.serial_number ?? null,
        quantityOnHand: parsed.counted_quantity,
        quantityReserved: 0,
        quantityAllocated: 0,
      })
    } else {
      balance.quantityOnHand = parsed.counted_quantity
    }

    const movement = em.create(InventoryMovement, {
      tenantId: parsed.tenant_id,
      organizationId: parsed.organization_id,
      warehouseId: parsed.warehouse_id,
      locationFromId: delta < 0 ? parsed.location_id : null,
      locationToId: delta >= 0 ? parsed.location_id : null,
      catalogVariantId: parsed.catalog_variant_id,
      lotId: parsed.lot_id ?? null,
      serialNumber: parsed.serial_number ?? null,
      quantity: delta,
      type: 'cycle_count',
      referenceType: 'manual',
      performedBy: getPerformedBy(ctx),
      reason: parsed.reason,
    })

    await em.flush()

    await emitCrudSideEffects({
      dataEngine,
      action: 'updated',
      entity: balance,
      identifiers: { id: balance.id, tenantId: balance.tenantId, organizationId: balance.organizationId },
      events: balanceCrudEvents,
      indexer: balanceIndexer,
    })
    await emitCrudSideEffects({
      dataEngine,
      action: 'created',
      entity: movement,
      identifiers: { id: movement.id, tenantId: movement.tenantId, organizationId: movement.organizationId },
      events: movementCrudEvents,
      indexer: movementIndexer,
    })

    return {
      balance_id: balance.id,
      movement_id: movement.id,
      previous_on_hand: previousOnHand,
      counted_quantity: parsed.counted_quantity,
      delta,
    }
  },
} as CommandHandler<CycleCountInput, { balance_id: string; movement_id: string; previous_on_hand: number; counted_quantity: number; delta: number }>)
