import { randomUUID } from 'node:crypto'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { extractUndoPayload } from '@open-mercato/shared/lib/commands/undo'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { enforceCommandOptimisticLockWithGuards } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { Building, CommonArea, Floor, Space, Unit } from '../data/entities'
import {
  buildingCreateSchema,
  buildingIdSchema,
  buildingUpdateSchema,
  type BuildingCreateInput,
  type BuildingIdInput,
  type BuildingUpdateInput,
} from '../data/validators'
import { canManageAllBuildings } from '../lib/buildingAccess'
import { applyFloorLayout, revertFloorLayout, type LayoutChangeSnapshot } from '../lib/floorLayout'
import { assertManagerUsers, loadManagerIds, replaceManagers } from '../lib/managers'
import { findUnitBlockers, findUnitsEverUsed } from '../lib/usageGuards'
import { emitPropertyManagementEvent } from '../events'
import type { Scope } from '../lib/productUse'
import {
  buildCrudLog,
  buildingCrudEvents,
  buildingCrudIndexer,
  commonAreaCrudIndexer,
  conflict,
  emitSideEffects,
  ensureScope,
  floorCrudEvents,
  floorCrudIndexer,
  isoOrNull,
  loadBuilding,
  lockBuilding,
  requireId,
  resolveEm,
  scopeOf,
  spaceCrudIndexer,
  unitCrudIndexer,
} from './shared'

export const BUILDING_RESOURCE_KIND = 'property_management.building'

export type BuildingSnapshot = {
  id: string
  tenantId: string
  organizationId: string
  name: string
  address: string
  status: 'active' | 'archived'
  archivedAt: string | null
  openingHoursEnabled: boolean
  managerUserIds: string[]
}

type BuildingUndoPayload = {
  before?: BuildingSnapshot | null
  after?: BuildingSnapshot | null
  layout?: LayoutChangeSnapshot | null
  deleted?: DeletedBuildingTree | null
}

type DeletedBuildingTree = {
  floorIds: string[]
  spaceIds: string[]
  unitIds: string[]
  commonAreaIds: string[]
}

async function defaultSpaceName(): Promise<string> {
  const { translate } = await resolveTranslations()
  return translate('property_management.spaces.defaultName', 'Whole floor')
}

async function snapshotBuilding(ctx: CommandRuntimeContext, id: string): Promise<BuildingSnapshot | null> {
  const em = resolveEm(ctx)
  const building = await findOneWithDecryption(em, Building, { id }, undefined, {
    tenantId: ctx.auth?.tenantId ?? null,
    organizationId: ctx.selectedOrganizationId ?? null,
  })
  if (!building) return null
  const scope = scopeOf(building)
  return {
    id: building.id,
    tenantId: building.tenantId,
    organizationId: building.organizationId,
    name: building.name,
    address: building.address,
    status: building.status,
    archivedAt: isoOrNull(building.archivedAt),
    openingHoursEnabled: building.openingHoursEnabled,
    managerUserIds: await loadManagerIds(em, scope, building.id),
  }
}

async function resolveManagerAssignment(
  ctx: CommandRuntimeContext,
  scope: Scope,
  requested: string[] | undefined,
  mode: 'create' | 'update',
): Promise<string[] | undefined> {
  const manageAll = await canManageAllBuildings({ container: ctx.container, auth: ctx.auth, ...scope })
  if (manageAll || !ctx.auth) return requested
  if (mode === 'update') return undefined
  const actor = typeof ctx.auth.userId === 'string' && ctx.auth.userId ? ctx.auth.userId : ctx.auth.sub
  return actor && !actor.startsWith('api_key:') ? [actor] : []
}

async function emitLayoutSideEffects(
  ctx: CommandRuntimeContext,
  floors: { created: Floor[]; updated: Floor[]; removed: Floor[] },
): Promise<void> {
  for (const floor of floors.created) await emitSideEffects(ctx, 'created', floor, { indexer: floorCrudIndexer, events: floorCrudEvents })
  for (const floor of floors.updated) await emitSideEffects(ctx, 'updated', floor, { indexer: floorCrudIndexer, events: floorCrudEvents })
  for (const floor of floors.removed) await emitSideEffects(ctx, 'deleted', floor, { indexer: floorCrudIndexer, events: floorCrudEvents })
}

const createBuildingCommand: CommandHandler<BuildingCreateInput, { buildingId: string }> = {
  id: 'property_management.building.create',
  async execute(rawInput, ctx) {
    const parsed = buildingCreateSchema.parse(rawInput ?? {})
    const scope = { tenantId: parsed.tenantId, organizationId: parsed.organizationId }
    ensureScope(ctx, scope)
    const em = resolveEm(ctx)
    const managerIds = await resolveManagerAssignment(ctx, scope, parsed.managerUserIds, 'create')
    const validManagers = managerIds ? await assertManagerUsers(em, scope, managerIds) : []
    const spaceName = await defaultSpaceName()
    const { building, createdFloors } = await em.fork().transactional(async (trx) => {
      const record = trx.create(Building, {
        id: randomUUID(),
        ...scope,
        name: parsed.name,
        address: parsed.address,
      })
      trx.persist(record)
      await trx.flush()
      await replaceManagers(trx, scope, record.id, validManagers)
      await trx.flush()
      const layout = await applyFloorLayout(trx, scope, record, parsed.layout, spaceName)
      return { building: record, createdFloors: layout.createdFloors }
    })
    await emitSideEffects(ctx, 'created', building, { indexer: buildingCrudIndexer, events: buildingCrudEvents })
    await emitLayoutSideEffects(ctx, { created: createdFloors, updated: [], removed: [] })
    return { buildingId: building.id }
  },
  captureAfter: async (_input, result, ctx) => snapshotBuilding(ctx, result.buildingId),
  buildLog: async ({ input, result, ctx, snapshots }) => {
    const base = await buildCrudLog(ctx, input, result?.buildingId ?? null, 'property_management.audit.building.create', 'Create building', BUILDING_RESOURCE_KIND)
    const after = snapshots?.after as BuildingSnapshot | undefined
    return { ...base, snapshotAfter: after, payload: { undo: { after } satisfies BuildingUndoPayload } }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<BuildingUndoPayload>(logEntry)
    const after = payload?.after
    if (!after) return
    const scope = scopeOf(after)
    ensureScope(ctx, scope)
    const em = resolveEm(ctx)
    await softDeleteBuildingTree(ctx, scope, after.id, em)
  },
}

async function collectBuildingTree(em: ReturnType<typeof resolveEm>, scope: Scope, buildingId: string) {
  const [floors, spaces, units, commonAreas] = await Promise.all([
    findWithDecryption(em, Floor, { ...scope, buildingId, deletedAt: null }, undefined, scope),
    findWithDecryption(em, Space, { ...scope, buildingId, deletedAt: null }, undefined, scope),
    findWithDecryption(em, Unit, { ...scope, buildingId, deletedAt: null }, undefined, scope),
    findWithDecryption(em, CommonArea, { ...scope, buildingId, deletedAt: null }, undefined, scope),
  ])
  return { floors, spaces, units, commonAreas }
}

async function softDeleteBuildingTree(
  ctx: CommandRuntimeContext,
  scope: Scope,
  buildingId: string,
  em: ReturnType<typeof resolveEm>,
): Promise<DeletedBuildingTree> {
  const result = await em.fork().transactional(async (trx) => {
    const building = await lockBuilding(trx, scope, buildingId)
    const tree = await collectBuildingTree(trx, scope, buildingId)
    const now = new Date()
    building.deletedAt = now
    for (const record of [...tree.floors, ...tree.spaces, ...tree.units, ...tree.commonAreas]) record.deletedAt = now
    return { building, tree }
  })
  await emitSideEffects(ctx, 'deleted', result.building, { indexer: buildingCrudIndexer, events: buildingCrudEvents })
  for (const floor of result.tree.floors) await emitSideEffects(ctx, 'deleted', floor, { indexer: floorCrudIndexer })
  for (const space of result.tree.spaces) await emitSideEffects(ctx, 'deleted', space, { indexer: spaceCrudIndexer })
  for (const unit of result.tree.units) await emitSideEffects(ctx, 'deleted', unit, { indexer: unitCrudIndexer })
  for (const area of result.tree.commonAreas) await emitSideEffects(ctx, 'deleted', area, { indexer: commonAreaCrudIndexer })
  return {
    floorIds: result.tree.floors.map((record) => record.id),
    spaceIds: result.tree.spaces.map((record) => record.id),
    unitIds: result.tree.units.map((record) => record.id),
    commonAreaIds: result.tree.commonAreas.map((record) => record.id),
  }
}

const updateBuildingCommand: CommandHandler<BuildingUpdateInput, { buildingId: string; layout: LayoutChangeSnapshot | null }> = {
  id: 'property_management.building.update',
  prepare: async (input, ctx) => {
    const before = await snapshotBuilding(ctx, requireId(input?.id))
    return before ? { before } : {}
  },
  async execute(rawInput, ctx) {
    const parsed = buildingUpdateSchema.parse(rawInput ?? {})
    const scope = { tenantId: parsed.tenantId, organizationId: parsed.organizationId }
    ensureScope(ctx, scope)
    const em = resolveEm(ctx)
    const current = await loadBuilding(em, ctx, scope, parsed.id)
    if (current.status === 'archived') {
      await conflict('property_management.errors.buildingArchived', 'An archived building cannot be changed.')
    }
    const managerIds = await resolveManagerAssignment(ctx, scope, parsed.managerUserIds, 'update')
    const validManagers = managerIds ? await assertManagerUsers(em, scope, managerIds) : undefined
    const spaceName = await defaultSpaceName()
    const outcome = await em.fork().transactional(async (trx) => {
      const building = await lockBuilding(trx, scope, parsed.id)
      let layout: Awaited<ReturnType<typeof applyFloorLayout>> | null = null
      if (parsed.layout) {
        layout = await applyFloorLayout(trx, scope, building, parsed.layout, spaceName)
      }
      if (validManagers) {
        await replaceManagers(trx, scope, building.id, validManagers)
        await trx.flush()
      }
      if (parsed.name !== undefined) building.name = parsed.name
      if (parsed.address !== undefined) building.address = parsed.address
      building.updatedAt = new Date()
      return { building, layout }
    })
    await emitSideEffects(ctx, 'updated', outcome.building, { indexer: buildingCrudIndexer, events: buildingCrudEvents })
    if (outcome.layout) {
      await emitLayoutSideEffects(ctx, {
        created: outcome.layout.createdFloors,
        updated: outcome.layout.updatedFloors,
        removed: outcome.layout.removedFloors,
      })
    }
    return { buildingId: outcome.building.id, layout: outcome.layout?.snapshot ?? null }
  },
  captureAfter: async (_input, result, ctx) => snapshotBuilding(ctx, result.buildingId),
  buildLog: async ({ input, result, ctx, snapshots }) => {
    const base = await buildCrudLog(ctx, input, result?.buildingId ?? null, 'property_management.audit.building.update', 'Update building', BUILDING_RESOURCE_KIND)
    const before = snapshots?.before as BuildingSnapshot | undefined
    const after = snapshots?.after as BuildingSnapshot | undefined
    const layout = result?.layout ?? null
    return {
      ...base,
      snapshotBefore: before,
      snapshotAfter: after,
      payload: { undo: { before, after, layout } satisfies BuildingUndoPayload },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<BuildingUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const scope = scopeOf(before)
    ensureScope(ctx, scope)
    const em = resolveEm(ctx)
    const building = await em.fork().transactional(async (trx) => {
      const record = await lockBuilding(trx, scope, before.id)
      if (payload?.layout) await revertFloorLayout(trx, scope, payload.layout)
      await replaceManagers(trx, scope, record.id, before.managerUserIds)
      await trx.flush()
      record.name = before.name
      record.address = before.address
      return record
    })
    await emitSideEffects(ctx, 'updated', building, { indexer: buildingCrudIndexer, events: buildingCrudEvents }, 'undo')
  },
}

const deleteBuildingCommand: CommandHandler<BuildingIdInput, { buildingId: string; deleted: DeletedBuildingTree }> = {
  id: 'property_management.building.delete',
  prepare: async (input, ctx) => {
    const before = await snapshotBuilding(ctx, requireId(input?.id))
    return before ? { before } : {}
  },
  async execute(rawInput, ctx) {
    const parsed = buildingIdSchema.parse(rawInput ?? {})
    const scope = { tenantId: parsed.tenantId, organizationId: parsed.organizationId }
    ensureScope(ctx, scope)
    const em = resolveEm(ctx)
    const building = await loadBuilding(em, ctx, scope, parsed.id)
    await enforceCommandOptimisticLockWithGuards(ctx.container, {
      resourceKind: BUILDING_RESOURCE_KIND,
      resourceId: building.id,
      current: building.updatedAt,
      request: ctx.request ?? null,
    })
    const units = await findWithDecryption(em, Unit, { ...scope, buildingId: building.id }, undefined, scope)
    const used = await findUnitsEverUsed(em, scope, units.map((unit) => unit.id))
    if (used.length) {
      await conflict(
        'property_management.errors.buildingUsed',
        'This building has had leases or bookings, so it cannot be deleted. Archive it instead.',
        { code: 'building_used' },
      )
    }
    const deleted = await softDeleteBuildingTree(ctx, scope, building.id, em)
    return { buildingId: building.id, deleted }
  },
  buildLog: async ({ input, result, ctx, snapshots }) => {
    const base = await buildCrudLog(ctx, input, result?.buildingId ?? null, 'property_management.audit.building.delete', 'Delete building', BUILDING_RESOURCE_KIND)
    const before = snapshots?.before as BuildingSnapshot | undefined
    const deleted = result?.deleted ?? null
    return { ...base, snapshotBefore: before, payload: { undo: { before, deleted } satisfies BuildingUndoPayload } }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<BuildingUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const scope = scopeOf(before)
    ensureScope(ctx, scope)
    const em = resolveEm(ctx)
    const deleted = payload?.deleted
    const building = await em.fork().transactional(async (trx) => {
      const record = await findOneWithDecryption(trx, Building, { id: before.id, ...scope }, undefined, scope)
      if (!record) return null
      const [floors, spaces, units, commonAreas] = deleted
        ? await Promise.all([
            deleted.floorIds.length ? findWithDecryption(trx, Floor, { ...scope, id: { $in: deleted.floorIds } }, undefined, scope) : Promise.resolve([]),
            deleted.spaceIds.length ? findWithDecryption(trx, Space, { ...scope, id: { $in: deleted.spaceIds } }, undefined, scope) : Promise.resolve([]),
            deleted.unitIds.length ? findWithDecryption(trx, Unit, { ...scope, id: { $in: deleted.unitIds } }, undefined, scope) : Promise.resolve([]),
            deleted.commonAreaIds.length ? findWithDecryption(trx, CommonArea, { ...scope, id: { $in: deleted.commonAreaIds } }, undefined, scope) : Promise.resolve([]),
          ])
        : [[], [], [], []]
      record.deletedAt = null
      for (const item of [...floors, ...spaces, ...units, ...commonAreas]) item.deletedAt = null
      return record
    })
    if (building) await emitSideEffects(ctx, 'created', building, { indexer: buildingCrudIndexer, events: buildingCrudEvents }, 'undo')
  },
}

const archiveBuildingCommand: CommandHandler<BuildingIdInput, { buildingId: string }> = {
  id: 'property_management.building.archive',
  async execute(rawInput, ctx) {
    const parsed = buildingIdSchema.parse(rawInput ?? {})
    const scope = { tenantId: parsed.tenantId, organizationId: parsed.organizationId }
    ensureScope(ctx, scope)
    const em = resolveEm(ctx)
    const current = await loadBuilding(em, ctx, scope, parsed.id)
    await enforceCommandOptimisticLockWithGuards(ctx.container, {
      resourceKind: BUILDING_RESOURCE_KIND,
      resourceId: current.id,
      current: current.updatedAt,
      request: ctx.request ?? null,
    })
    if (current.status === 'archived') {
      await conflict('property_management.errors.buildingArchived', 'An archived building cannot be changed.')
    }
    const building = await em.fork().transactional(async (trx) => {
      const record = await lockBuilding(trx, scope, parsed.id)
      const units = await findWithDecryption(trx, Unit, { ...scope, buildingId: record.id, deletedAt: null }, undefined, scope)
      const blockers = await findUnitBlockers(trx, scope, units.map((unit) => unit.id))
      if (blockers.length) {
        await conflict(
          'property_management.errors.buildingArchiveBlocked',
          'This building still has active leases or upcoming bookings.',
          { code: 'building_archive_blocked', blockers },
        )
      }
      record.status = 'archived'
      record.archivedAt = new Date()
      return record
    })
    await emitSideEffects(ctx, 'updated', building, { indexer: buildingCrudIndexer })
    void emitPropertyManagementEvent('property_management.building.archived', {
      id: building.id,
      tenantId: building.tenantId,
      organizationId: building.organizationId,
    }, { persistent: true }).catch(() => undefined)
    return { buildingId: building.id }
  },
  buildLog: async ({ input, result, ctx }) =>
    buildCrudLog(ctx, input, result?.buildingId ?? null, 'property_management.audit.building.archive', 'Archive building', BUILDING_RESOURCE_KIND),
}

registerCommand(createBuildingCommand)
registerCommand(updateBuildingCommand)
registerCommand(deleteBuildingCommand)
registerCommand(archiveBuildingCommand)
