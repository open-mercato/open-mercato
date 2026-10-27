import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { extractUndoPayload } from '@open-mercato/shared/lib/commands/undo'
import { enforceCommandOptimisticLockWithGuards } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import {
  floorLayoutReplaceSchema,
  floorUpdateSchema,
  type FloorLayoutReplaceInput,
  type FloorUpdateInput,
} from '../data/validators'
import {
  applyFloorLayout,
  emptyLayoutSnapshot,
  resizeFloor,
  revertFloorLayout,
  snapshotFloor,
  type LayoutChangeSnapshot,
} from '../lib/floorLayout'
import {
  buildCrudLog,
  buildingCrudIndexer,
  conflict,
  emitSideEffects,
  ensureScope,
  floorCrudEvents,
  floorCrudIndexer,
  loadBuilding,
  loadFloor,
  lockBuilding,
  lockFloor,
  resolveEm,
} from './shared'
import { BUILDING_RESOURCE_KIND } from './building'

export const FLOOR_RESOURCE_KIND = 'property_management.floor'

type LayoutUndoPayload = { layout?: LayoutChangeSnapshot | null; scope?: { tenantId: string; organizationId: string } }

const layoutReplaceCommand: CommandHandler<FloorLayoutReplaceInput, { buildingId: string; layout: LayoutChangeSnapshot }> = {
  id: 'property_management.floor.layout_replace',
  async execute(rawInput, ctx) {
    const parsed = floorLayoutReplaceSchema.parse(rawInput ?? {})
    const scope = { tenantId: parsed.tenantId, organizationId: parsed.organizationId }
    ensureScope(ctx, scope)
    const em = resolveEm(ctx)
    const current = await loadBuilding(em, ctx, scope, parsed.buildingId)
    await enforceCommandOptimisticLockWithGuards(ctx.container, {
      resourceKind: BUILDING_RESOURCE_KIND,
      resourceId: current.id,
      current: current.updatedAt,
      request: ctx.request ?? null,
    })
    if (current.status === 'archived') {
      await conflict('property_management.errors.buildingArchived', 'An archived building cannot be changed.')
    }
    const { translate } = await resolveTranslations()
    const spaceName = translate('property_management.spaces.defaultName', 'Whole floor')
    const outcome = await em.fork().transactional(async (trx) => {
      const building = await lockBuilding(trx, scope, parsed.buildingId)
      const layout = await applyFloorLayout(trx, scope, building, parsed.layout, spaceName)
      building.updatedAt = new Date()
      return { building, layout }
    })
    await emitSideEffects(ctx, 'updated', outcome.building, { indexer: buildingCrudIndexer })
    for (const floor of outcome.layout.createdFloors) await emitSideEffects(ctx, 'created', floor, { indexer: floorCrudIndexer, events: floorCrudEvents })
    for (const floor of outcome.layout.updatedFloors) await emitSideEffects(ctx, 'updated', floor, { indexer: floorCrudIndexer, events: floorCrudEvents })
    for (const floor of outcome.layout.removedFloors) await emitSideEffects(ctx, 'deleted', floor, { indexer: floorCrudIndexer, events: floorCrudEvents })
    return { buildingId: outcome.building.id, layout: outcome.layout.snapshot }
  },
  buildLog: async ({ input, result, ctx }) => {
    const base = await buildCrudLog(ctx, input, result?.buildingId ?? null, 'property_management.audit.floor.layoutReplace', 'Change floor layout', BUILDING_RESOURCE_KIND)
    const scope = input ? { tenantId: input.tenantId, organizationId: input.organizationId } : undefined
    return { ...base, payload: { undo: { layout: result?.layout ?? null, scope } satisfies LayoutUndoPayload } }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<LayoutUndoPayload>(logEntry)
    if (!payload?.layout || !payload.scope) return
    const scope = payload.scope
    ensureScope(ctx, scope)
    const em = resolveEm(ctx)
    const layout = payload.layout
    const building = await em.fork().transactional(async (trx) => {
      const record = await lockBuilding(trx, scope, layout.buildingId)
      await revertFloorLayout(trx, scope, layout)
      record.updatedAt = new Date()
      return record
    })
    await emitSideEffects(ctx, 'updated', building, { indexer: buildingCrudIndexer }, 'undo')
  },
}

type FloorUndoPayload = {
  before?: ReturnType<typeof snapshotFloor> | null
  layout?: LayoutChangeSnapshot | null
  scope?: { tenantId: string; organizationId: string }
}

const updateFloorCommand: CommandHandler<FloorUpdateInput, { floorId: string; layout: LayoutChangeSnapshot; before: ReturnType<typeof snapshotFloor> }> = {
  id: 'property_management.floor.update',
  async execute(rawInput, ctx) {
    const parsed = floorUpdateSchema.parse(rawInput ?? {})
    const scope = { tenantId: parsed.tenantId, organizationId: parsed.organizationId }
    ensureScope(ctx, scope)
    const em = resolveEm(ctx)
    const current = await loadFloor(em, ctx, scope, parsed.id)
    const outcome = await em.fork().transactional(async (trx) => {
      const building = await lockBuilding(trx, scope, current.buildingId)
      if (building.status === 'archived') {
        await conflict('property_management.errors.buildingArchived', 'An archived building cannot be changed.')
      }
      const floor = await lockFloor(trx, scope, parsed.id)
      const before = snapshotFloor(floor)
      const layout = emptyLayoutSnapshot(building.id)
      const sizeX = parsed.sizeX ?? Number(floor.sizeX)
      const sizeY = parsed.sizeY ?? Number(floor.sizeY)
      await resizeFloor(trx, scope, floor, sizeX, sizeY, layout)
      if (parsed.name !== undefined) floor.name = parsed.name
      floor.updatedAt = new Date()
      layout.updatedFloors.push(before)
      return { floor, before, layout }
    })
    await emitSideEffects(ctx, 'updated', outcome.floor, { indexer: floorCrudIndexer, events: floorCrudEvents })
    return { floorId: outcome.floor.id, layout: outcome.layout, before: outcome.before }
  },
  buildLog: async ({ input, result, ctx }) => {
    const base = await buildCrudLog(ctx, input, result?.floorId ?? null, 'property_management.audit.floor.update', 'Update floor', FLOOR_RESOURCE_KIND)
    const scope = input ? { tenantId: input.tenantId, organizationId: input.organizationId } : undefined
    return {
      ...base,
      snapshotBefore: result?.before,
      payload: { undo: { before: result?.before ?? null, layout: result?.layout ?? null, scope } satisfies FloorUndoPayload },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<FloorUndoPayload>(logEntry)
    if (!payload?.layout || !payload.scope) return
    const scope = payload.scope
    ensureScope(ctx, scope)
    const em = resolveEm(ctx)
    const layout = payload.layout
    await em.fork().transactional(async (trx) => {
      await lockBuilding(trx, scope, layout.buildingId)
      await revertFloorLayout(trx, scope, layout)
    })
    const floorId = payload.before?.id
    if (!floorId) return
    const floor = await loadFloor(em, ctx, scope, floorId).catch(() => null)
    if (floor) await emitSideEffects(ctx, 'updated', floor, { indexer: floorCrudIndexer, events: floorCrudEvents }, 'undo')
  },
}

registerCommand(layoutReplaceCommand)
registerCommand(updateFloorCommand)
