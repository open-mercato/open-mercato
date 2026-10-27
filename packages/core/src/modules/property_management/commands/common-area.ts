import { randomUUID } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { extractUndoPayload } from '@open-mercato/shared/lib/commands/undo'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CommonArea, type CommonAreaKind } from '../data/entities'
import {
  commonAreaCreateSchema,
  commonAreaUpdateSchema,
  type CommonAreaCreateInput,
  type CommonAreaUpdateInput,
} from '../data/validators'
import { checkPlacement, toRect } from '../lib/geometry'
import type { Scope } from '../lib/productUse'
import {
  assertCtxBuildingAccess,
  buildCrudLog,
  commonAreaCrudEvents,
  commonAreaCrudIndexer,
  conflict,
  emitSideEffects,
  ensureScope,
  loadFloor,
  loadFloorGeometry,
  lockBuilding,
  lockFloor,
  metres,
  notFound,
  requireId,
  resolveEm,
  scopeOf,
  throwPlacementIssues,
} from './shared'

export const COMMON_AREA_RESOURCE_KIND = 'property_management.common_area'

export type CommonAreaSnapshot = {
  id: string
  tenantId: string
  organizationId: string
  buildingId: string
  floorId: string
  name: string
  kind: CommonAreaKind
  x: string
  y: string
  width: string
  depth: string
}

type CommonAreaUndoPayload = { before?: CommonAreaSnapshot | null; after?: CommonAreaSnapshot | null }

function snapshotArea(area: CommonArea): CommonAreaSnapshot {
  return {
    id: area.id,
    tenantId: area.tenantId,
    organizationId: area.organizationId,
    buildingId: area.buildingId,
    floorId: area.floorId,
    name: area.name,
    kind: area.kind,
    x: area.x,
    y: area.y,
    width: area.width,
    depth: area.depth,
  }
}

async function loadAreaSnapshot(ctx: CommandRuntimeContext, id: string): Promise<CommonAreaSnapshot | null> {
  const em = resolveEm(ctx)
  const area = await findOneWithDecryption(em, CommonArea, { id }, undefined, {
    tenantId: ctx.auth?.tenantId ?? null,
    organizationId: ctx.selectedOrganizationId ?? null,
  })
  return area ? snapshotArea(area) : null
}

async function loadArea(em: EntityManager, ctx: CommandRuntimeContext, scope: Scope, id: string): Promise<CommonArea> {
  const area = await findOneWithDecryption(em, CommonArea, { id, ...scope, deletedAt: null }, undefined, scope)
  if (!area) return notFound('property_management.errors.commonAreaNotFound', 'Common area not found.')
  await assertCtxBuildingAccess(ctx, scope, area.buildingId)
  return area
}

async function assertBuildingWritable(em: EntityManager, scope: Scope, buildingId: string): Promise<void> {
  const building = await lockBuilding(em, scope, buildingId)
  if (building.status === 'archived') {
    await conflict('property_management.errors.buildingArchived', 'An archived building cannot be changed.')
  }
}

const createCommonAreaCommand: CommandHandler<CommonAreaCreateInput, { commonAreaId: string }> = {
  id: 'property_management.common_area.create',
  async execute(rawInput, ctx) {
    const parsed = commonAreaCreateSchema.parse(rawInput ?? {})
    const scope = { tenantId: parsed.tenantId, organizationId: parsed.organizationId }
    ensureScope(ctx, scope)
    const em = resolveEm(ctx)
    const current = await loadFloor(em, ctx, scope, parsed.floorId)
    const area = await em.fork().transactional(async (trx) => {
      await assertBuildingWritable(trx, scope, current.buildingId)
      const floor = await lockFloor(trx, scope, parsed.floorId)
      const geometry = await loadFloorGeometry(trx, scope, floor)
      const rect = { x: parsed.x, y: parsed.y, width: parsed.width, depth: parsed.depth }
      const issues = checkPlacement({ kind: 'common_area', rect }, geometry)
      if (issues.length) await throwPlacementIssues(issues)
      const record = trx.create(CommonArea, {
        id: randomUUID(),
        ...scope,
        buildingId: floor.buildingId,
        floorId: floor.id,
        name: parsed.name,
        kind: parsed.kind,
        x: metres(rect.x),
        y: metres(rect.y),
        width: metres(rect.width),
        depth: metres(rect.depth),
      })
      trx.persist(record)
      return record
    })
    await emitSideEffects(ctx, 'created', area, { indexer: commonAreaCrudIndexer, events: commonAreaCrudEvents })
    return { commonAreaId: area.id }
  },
  captureAfter: async (_input, result, ctx) => loadAreaSnapshot(ctx, result.commonAreaId),
  buildLog: async ({ input, result, ctx, snapshots }) => {
    const base = await buildCrudLog(ctx, input, result?.commonAreaId ?? null, 'property_management.audit.commonArea.create', 'Create common area', COMMON_AREA_RESOURCE_KIND)
    const after = snapshots?.after as CommonAreaSnapshot | undefined
    return { ...base, snapshotAfter: after, payload: { undo: { after } satisfies CommonAreaUndoPayload } }
  },
  undo: async ({ logEntry, ctx }) => {
    const after = extractUndoPayload<CommonAreaUndoPayload>(logEntry)?.after
    if (!after) return
    const scope = scopeOf(after)
    ensureScope(ctx, scope)
    const em = resolveEm(ctx)
    const area = await findOneWithDecryption(em, CommonArea, { id: after.id, ...scope }, undefined, scope)
    if (!area) return
    area.deletedAt = new Date()
    await em.flush()
    await emitSideEffects(ctx, 'deleted', area, { indexer: commonAreaCrudIndexer, events: commonAreaCrudEvents }, 'undo')
  },
}

const updateCommonAreaCommand: CommandHandler<CommonAreaUpdateInput, { commonAreaId: string }> = {
  id: 'property_management.common_area.update',
  prepare: async (input, ctx) => {
    const before = await loadAreaSnapshot(ctx, requireId(input?.id))
    return before ? { before } : {}
  },
  async execute(rawInput, ctx) {
    const parsed = commonAreaUpdateSchema.parse(rawInput ?? {})
    const scope = { tenantId: parsed.tenantId, organizationId: parsed.organizationId }
    ensureScope(ctx, scope)
    const em = resolveEm(ctx)
    const current = await loadArea(em, ctx, scope, parsed.id)
    const area = await em.fork().transactional(async (trx) => {
      await assertBuildingWritable(trx, scope, current.buildingId)
      const floor = await lockFloor(trx, scope, current.floorId)
      const geometry = await loadFloorGeometry(trx, scope, floor)
      const record = geometry.commonAreaRecords.find((item) => item.id === current.id)
      if (!record) return notFound('property_management.errors.commonAreaNotFound', 'Common area not found.')
      const existing = toRect(record)
      const rect = {
        x: parsed.x ?? existing.x,
        y: parsed.y ?? existing.y,
        width: parsed.width ?? existing.width,
        depth: parsed.depth ?? existing.depth,
      }
      const issues = checkPlacement({ kind: 'common_area', rect, selfId: record.id }, geometry)
      if (issues.length) await throwPlacementIssues(issues)
      if (parsed.name !== undefined) record.name = parsed.name
      if (parsed.kind !== undefined) record.kind = parsed.kind
      record.x = metres(rect.x)
      record.y = metres(rect.y)
      record.width = metres(rect.width)
      record.depth = metres(rect.depth)
      record.updatedAt = new Date()
      return record
    })
    await emitSideEffects(ctx, 'updated', area, { indexer: commonAreaCrudIndexer, events: commonAreaCrudEvents })
    return { commonAreaId: area.id }
  },
  captureAfter: async (_input, result, ctx) => loadAreaSnapshot(ctx, result.commonAreaId),
  buildLog: async ({ input, result, ctx, snapshots }) => {
    const base = await buildCrudLog(ctx, input, result?.commonAreaId ?? null, 'property_management.audit.commonArea.update', 'Update common area', COMMON_AREA_RESOURCE_KIND)
    const before = snapshots?.before as CommonAreaSnapshot | undefined
    const after = snapshots?.after as CommonAreaSnapshot | undefined
    return { ...base, snapshotBefore: before, snapshotAfter: after, payload: { undo: { before, after } satisfies CommonAreaUndoPayload } }
  },
  undo: async ({ logEntry, ctx }) => {
    const before = extractUndoPayload<CommonAreaUndoPayload>(logEntry)?.before
    if (!before) return
    const scope = scopeOf(before)
    ensureScope(ctx, scope)
    const em = resolveEm(ctx)
    const area = await em.fork().transactional(async (trx) => {
      const floor = await lockFloor(trx, scope, before.floorId)
      const geometry = await loadFloorGeometry(trx, scope, floor)
      const issues = checkPlacement({ kind: 'common_area', rect: toRect(before), selfId: before.id }, geometry)
      if (issues.length) await throwPlacementIssues(issues)
      const record = geometry.commonAreaRecords.find((item) => item.id === before.id)
      if (!record) return null
      record.name = before.name
      record.kind = before.kind
      record.x = before.x
      record.y = before.y
      record.width = before.width
      record.depth = before.depth
      return record
    })
    if (area) await emitSideEffects(ctx, 'updated', area, { indexer: commonAreaCrudIndexer, events: commonAreaCrudEvents }, 'undo')
  },
}

const deleteCommonAreaCommand: CommandHandler<{ id?: string; tenantId?: string; organizationId?: string }, { commonAreaId: string }> = {
  id: 'property_management.common_area.delete',
  prepare: async (input, ctx) => {
    const before = await loadAreaSnapshot(ctx, requireId(input?.id))
    return before ? { before } : {}
  },
  async execute(input, ctx) {
    const id = requireId(input?.id)
    const scope = {
      tenantId: input?.tenantId ?? ctx.auth?.tenantId ?? '',
      organizationId: input?.organizationId ?? ctx.selectedOrganizationId ?? '',
    }
    ensureScope(ctx, scope)
    const em = resolveEm(ctx)
    const current = await loadArea(em, ctx, scope, id)
    const area = await em.fork().transactional(async (trx) => {
      await assertBuildingWritable(trx, scope, current.buildingId)
      await lockFloor(trx, scope, current.floorId)
      const record = await findOneWithDecryption(trx, CommonArea, { id: current.id, ...scope, deletedAt: null }, undefined, scope)
      if (!record) return notFound('property_management.errors.commonAreaNotFound', 'Common area not found.')
      record.deletedAt = new Date()
      return record
    })
    await emitSideEffects(ctx, 'deleted', area, { indexer: commonAreaCrudIndexer, events: commonAreaCrudEvents })
    return { commonAreaId: area.id }
  },
  buildLog: async ({ input, result, ctx, snapshots }) => {
    const base = await buildCrudLog(ctx, input, result?.commonAreaId ?? null, 'property_management.audit.commonArea.delete', 'Delete common area', COMMON_AREA_RESOURCE_KIND)
    const before = snapshots?.before as CommonAreaSnapshot | undefined
    return { ...base, snapshotBefore: before, payload: { undo: { before } satisfies CommonAreaUndoPayload } }
  },
  undo: async ({ logEntry, ctx }) => {
    const before = extractUndoPayload<CommonAreaUndoPayload>(logEntry)?.before
    if (!before) return
    const scope = scopeOf(before)
    ensureScope(ctx, scope)
    const em = resolveEm(ctx)
    const area = await em.fork().transactional(async (trx) => {
      const floor = await lockFloor(trx, scope, before.floorId)
      const geometry = await loadFloorGeometry(trx, scope, floor)
      const issues = checkPlacement({ kind: 'common_area', rect: toRect(before), selfId: before.id }, geometry)
      if (issues.length) await throwPlacementIssues(issues)
      const record = await findOneWithDecryption(trx, CommonArea, { id: before.id, ...scope }, undefined, scope)
      if (record) record.deletedAt = null
      return record
    })
    if (area) await emitSideEffects(ctx, 'created', area, { indexer: commonAreaCrudIndexer, events: commonAreaCrudEvents }, 'undo')
  },
}

registerCommand(createCommonAreaCommand)
registerCommand(updateCommonAreaCommand)
registerCommand(deleteCommonAreaCommand)
