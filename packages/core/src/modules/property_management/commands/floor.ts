import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { extractUndoPayload } from '@open-mercato/shared/lib/commands/undo'
import { enforceCommandOptimisticLockWithGuards } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { Space } from '../data/entities'
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
  assertCtxBuildingAccess,
  buildCrudLog,
  buildingCrudIndexer,
  conflict,
  emitLayoutChangeSideEffects,
  emitSideEffects,
  enforceRecordVersion,
  ensureScope,
  floorCrudIndexer,
  floorUpdatedEvents,
  loadBuilding,
  loadFloor,
  lockFloor,
  lockWritableBuilding,
  renamedFloorIds,
  resolveEm,
  spaceCrudEvents,
  spaceCrudIndexer,
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
    if (current.status === 'archived') {
      await conflict('property_management.errors.buildingArchived', 'An archived building cannot be changed.')
    }
    const { translate } = await resolveTranslations()
    const spaceName = translate('property_management.spaces.defaultName', 'Whole floor')
    const outcome = await em.fork().transactional(async (trx) => {
      const building = await lockWritableBuilding(trx, scope, parsed.buildingId)
      await enforceCommandOptimisticLockWithGuards(ctx.container, {
        resourceKind: BUILDING_RESOURCE_KIND,
        resourceId: building.id,
        current: building.updatedAt,
        request: ctx.request ?? null,
      })
      const layout = await applyFloorLayout(trx, scope, building, parsed.layout, spaceName)
      building.updatedAt = new Date()
      return { building, layout }
    })
    await emitSideEffects(ctx, 'updated', outcome.building, { indexer: buildingCrudIndexer })
    await emitLayoutChangeSideEffects(ctx, outcome.layout.changes, 'write', {
      renamedFloorIds: renamedFloorIds(outcome.layout.snapshot.updatedFloors, outcome.layout.changes.floors.updated),
    })
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
    const layout = payload.layout
    await assertCtxBuildingAccess(ctx, scope, layout.buildingId)
    const em = resolveEm(ctx)
    const outcome = await em.fork().transactional(async (trx) => {
      const record = await lockWritableBuilding(trx, scope, layout.buildingId)
      const reverted = await revertFloorLayout(trx, scope, layout)
      record.updatedAt = new Date()
      return { record, reverted }
    })
    await emitSideEffects(ctx, 'updated', outcome.record, { indexer: buildingCrudIndexer }, 'undo')
    await emitLayoutChangeSideEffects(ctx, outcome.reverted, 'undo')
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
      const building = await lockWritableBuilding(trx, scope, current.buildingId)
      const floor = await lockFloor(trx, scope, parsed.id)
      await enforceRecordVersion(ctx, FLOOR_RESOURCE_KIND, floor)
      const before = snapshotFloor(floor)
      const layout = emptyLayoutSnapshot(building.id)
      const sizeX = parsed.sizeX ?? Number(floor.sizeX)
      const sizeY = parsed.sizeY ?? Number(floor.sizeY)
      const resizedSpaces: Space[] = []
      await resizeFloor(trx, scope, floor, sizeX, sizeY, layout, resizedSpaces)
      if (parsed.name !== undefined) floor.name = parsed.name
      const changedAt = new Date()
      floor.updatedAt = changedAt
      building.updatedAt = changedAt
      layout.updatedFloors.push(before)
      return { building, floor, before, layout, resizedSpaces }
    })
    await emitSideEffects(ctx, 'updated', outcome.building, { indexer: buildingCrudIndexer })
    const nameChanged = outcome.floor.name !== outcome.before.name
    await emitSideEffects(ctx, 'updated', outcome.floor, { indexer: floorCrudIndexer, events: floorUpdatedEvents(nameChanged) })
    for (const space of outcome.resizedSpaces) await emitSideEffects(ctx, 'updated', space, { indexer: spaceCrudIndexer, events: spaceCrudEvents })
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
    const layout = payload.layout
    await assertCtxBuildingAccess(ctx, scope, layout.buildingId)
    const em = resolveEm(ctx)
    const outcome = await em.fork().transactional(async (trx) => {
      const building = await lockWritableBuilding(trx, scope, layout.buildingId)
      const reverted = await revertFloorLayout(trx, scope, layout)
      building.updatedAt = new Date()
      return { building, reverted }
    })
    await emitSideEffects(ctx, 'updated', outcome.building, { indexer: buildingCrudIndexer }, 'undo')
    await emitLayoutChangeSideEffects(ctx, outcome.reverted, 'undo')
  },
}

registerCommand(layoutReplaceCommand)
registerCommand(updateFloorCommand)
