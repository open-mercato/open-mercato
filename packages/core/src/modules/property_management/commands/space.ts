import { randomUUID } from 'node:crypto'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { extractUndoPayload } from '@open-mercato/shared/lib/commands/undo'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { Space, Unit } from '../data/entities'
import { spaceCreateSchema, spaceUpdateSchema, type SpaceCreateInput, type SpaceUpdateInput } from '../data/validators'
import { checkPlacement, toRect } from '../lib/geometry'
import {
  assertCtxBuildingAccess,
  buildCrudLog,
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
  spaceCrudEvents,
  spaceCrudIndexer,
  throwPlacementIssues,
} from './shared'
import type { Scope } from '../lib/productUse'

export const SPACE_RESOURCE_KIND = 'property_management.space'

export type SpaceSnapshot = {
  id: string
  tenantId: string
  organizationId: string
  buildingId: string
  floorId: string
  name: string
  purpose: string | null
  x: string
  y: string
  width: string
  depth: string
  isDefault: boolean
}

type SpaceUndoPayload = { before?: SpaceSnapshot | null; after?: SpaceSnapshot | null }

function snapshotSpace(space: Space): SpaceSnapshot {
  return {
    id: space.id,
    tenantId: space.tenantId,
    organizationId: space.organizationId,
    buildingId: space.buildingId,
    floorId: space.floorId,
    name: space.name,
    purpose: space.purpose ?? null,
    x: space.x,
    y: space.y,
    width: space.width,
    depth: space.depth,
    isDefault: space.isDefault,
  }
}

async function loadSpaceSnapshot(ctx: CommandRuntimeContext, id: string): Promise<SpaceSnapshot | null> {
  const em = resolveEm(ctx)
  const space = await findOneWithDecryption(em, Space, { id }, undefined, {
    tenantId: ctx.auth?.tenantId ?? null,
    organizationId: ctx.selectedOrganizationId ?? null,
  })
  return space ? snapshotSpace(space) : null
}

async function loadSpace(em: ReturnType<typeof resolveEm>, ctx: CommandRuntimeContext, scope: Scope, id: string): Promise<Space> {
  const space = await findOneWithDecryption(em, Space, { id, ...scope, deletedAt: null }, undefined, scope)
  if (!space) return notFound('property_management.errors.spaceNotFound', 'Space not found.')
  await assertCtxBuildingAccess(ctx, scope, space.buildingId)
  return space
}

async function assertBuildingWritable(em: ReturnType<typeof resolveEm>, scope: Scope, buildingId: string): Promise<void> {
  const building = await lockBuilding(em, scope, buildingId)
  if (building.status === 'archived') {
    await conflict('property_management.errors.buildingArchived', 'An archived building cannot be changed.')
  }
}

const createSpaceCommand: CommandHandler<SpaceCreateInput, { spaceId: string }> = {
  id: 'property_management.space.create',
  async execute(rawInput, ctx) {
    const parsed = spaceCreateSchema.parse(rawInput ?? {})
    const scope = { tenantId: parsed.tenantId, organizationId: parsed.organizationId }
    ensureScope(ctx, scope)
    const em = resolveEm(ctx)
    const current = await loadFloor(em, ctx, scope, parsed.floorId)
    const space = await em.fork().transactional(async (trx) => {
      await assertBuildingWritable(trx, scope, current.buildingId)
      const floor = await lockFloor(trx, scope, parsed.floorId)
      const geometry = await loadFloorGeometry(trx, scope, floor)
      const rect = { x: parsed.x, y: parsed.y, width: parsed.width, depth: parsed.depth }
      const issues = checkPlacement({ kind: 'space', rect }, geometry)
      if (issues.length) await throwPlacementIssues(issues)
      const record = trx.create(Space, {
        id: randomUUID(),
        ...scope,
        buildingId: floor.buildingId,
        floorId: floor.id,
        name: parsed.name,
        purpose: parsed.purpose ?? null,
        x: metres(parsed.x),
        y: metres(parsed.y),
        width: metres(parsed.width),
        depth: metres(parsed.depth),
        isDefault: false,
      })
      trx.persist(record)
      return record
    })
    await emitSideEffects(ctx, 'created', space, { indexer: spaceCrudIndexer, events: spaceCrudEvents })
    return { spaceId: space.id }
  },
  captureAfter: async (_input, result, ctx) => loadSpaceSnapshot(ctx, result.spaceId),
  buildLog: async ({ input, result, ctx, snapshots }) => {
    const base = await buildCrudLog(ctx, input, result?.spaceId ?? null, 'property_management.audit.space.create', 'Create space', SPACE_RESOURCE_KIND)
    const after = snapshots?.after as SpaceSnapshot | undefined
    return { ...base, snapshotAfter: after, payload: { undo: { after } satisfies SpaceUndoPayload } }
  },
  undo: async ({ logEntry, ctx }) => {
    const after = extractUndoPayload<SpaceUndoPayload>(logEntry)?.after
    if (!after) return
    const scope = scopeOf(after)
    ensureScope(ctx, scope)
    const em = resolveEm(ctx)
    const space = await em.fork().transactional(async (trx) => {
      await lockFloor(trx, scope, after.floorId)
      const units = await findWithDecryption(trx, Unit, { ...scope, spaceId: after.id, deletedAt: null }, undefined, scope)
      if (units.length) {
        await conflict('property_management.errors.spaceHasUnits', 'This space still has units. Move or delete them first.', {
          code: 'space_has_units',
          units: units.map((unit) => unit.name),
        })
      }
      const record = await findOneWithDecryption(trx, Space, { id: after.id, ...scope }, undefined, scope)
      if (record) record.deletedAt = new Date()
      return record
    })
    if (space) await emitSideEffects(ctx, 'deleted', space, { indexer: spaceCrudIndexer, events: spaceCrudEvents }, 'undo')
  },
}

const updateSpaceCommand: CommandHandler<SpaceUpdateInput, { spaceId: string }> = {
  id: 'property_management.space.update',
  prepare: async (input, ctx) => {
    const before = await loadSpaceSnapshot(ctx, requireId(input?.id))
    return before ? { before } : {}
  },
  async execute(rawInput, ctx) {
    const parsed = spaceUpdateSchema.parse(rawInput ?? {})
    const scope = { tenantId: parsed.tenantId, organizationId: parsed.organizationId }
    ensureScope(ctx, scope)
    const em = resolveEm(ctx)
    const current = await loadSpace(em, ctx, scope, parsed.id)
    const space = await em.fork().transactional(async (trx) => {
      await assertBuildingWritable(trx, scope, current.buildingId)
      const floor = await lockFloor(trx, scope, current.floorId)
      const geometry = await loadFloorGeometry(trx, scope, floor)
      const record = geometry.spaceRecords.find((item) => item.id === parsed.id)
      if (!record) return notFound('property_management.errors.spaceNotFound', 'Space not found.')
      const existing = toRect(record)
      const rect = {
        x: parsed.x ?? existing.x,
        y: parsed.y ?? existing.y,
        width: parsed.width ?? existing.width,
        depth: parsed.depth ?? existing.depth,
      }
      const issues = checkPlacement({ kind: 'space', rect, selfId: record.id }, geometry)
      if (issues.length) await throwPlacementIssues(issues)
      if (parsed.name !== undefined) record.name = parsed.name
      if (parsed.purpose !== undefined) record.purpose = parsed.purpose ?? null
      record.x = metres(rect.x)
      record.y = metres(rect.y)
      record.width = metres(rect.width)
      record.depth = metres(rect.depth)
      record.updatedAt = new Date()
      return record
    })
    await emitSideEffects(ctx, 'updated', space, { indexer: spaceCrudIndexer, events: spaceCrudEvents })
    return { spaceId: space.id }
  },
  captureAfter: async (_input, result, ctx) => loadSpaceSnapshot(ctx, result.spaceId),
  buildLog: async ({ input, result, ctx, snapshots }) => {
    const base = await buildCrudLog(ctx, input, result?.spaceId ?? null, 'property_management.audit.space.update', 'Update space', SPACE_RESOURCE_KIND)
    const before = snapshots?.before as SpaceSnapshot | undefined
    const after = snapshots?.after as SpaceSnapshot | undefined
    return { ...base, snapshotBefore: before, snapshotAfter: after, payload: { undo: { before, after } satisfies SpaceUndoPayload } }
  },
  undo: async ({ logEntry, ctx }) => {
    const before = extractUndoPayload<SpaceUndoPayload>(logEntry)?.before
    if (!before) return
    const scope = scopeOf(before)
    ensureScope(ctx, scope)
    const em = resolveEm(ctx)
    const space = await em.fork().transactional(async (trx) => {
      const floor = await lockFloor(trx, scope, before.floorId)
      const geometry = await loadFloorGeometry(trx, scope, floor)
      const issues = checkPlacement({ kind: 'space', rect: toRect(before), selfId: before.id }, geometry)
      if (issues.length) await throwPlacementIssues(issues)
      const record = geometry.spaceRecords.find((item) => item.id === before.id)
      if (!record) return null
      record.name = before.name
      record.purpose = before.purpose
      record.x = before.x
      record.y = before.y
      record.width = before.width
      record.depth = before.depth
      return record
    })
    if (space) await emitSideEffects(ctx, 'updated', space, { indexer: spaceCrudIndexer, events: spaceCrudEvents }, 'undo')
  },
}

const deleteSpaceCommand: CommandHandler<{ id?: string; tenantId?: string; organizationId?: string }, { spaceId: string }> = {
  id: 'property_management.space.delete',
  prepare: async (input, ctx) => {
    const before = await loadSpaceSnapshot(ctx, requireId(input?.id))
    return before ? { before } : {}
  },
  async execute(input, ctx) {
    const id = requireId(input?.id)
    const em = resolveEm(ctx)
    const scope = {
      tenantId: input?.tenantId ?? ctx.auth?.tenantId ?? '',
      organizationId: input?.organizationId ?? ctx.selectedOrganizationId ?? '',
    }
    ensureScope(ctx, scope)
    const current = await loadSpace(em, ctx, scope, id)
    const space = await em.fork().transactional(async (trx) => {
      await assertBuildingWritable(trx, scope, current.buildingId)
      await lockFloor(trx, scope, current.floorId)
      const units = await findWithDecryption(trx, Unit, { ...scope, spaceId: current.id, deletedAt: null }, undefined, scope)
      if (units.length) {
        await conflict('property_management.errors.spaceHasUnits', 'This space still has units. Move or delete them first.', {
          code: 'space_has_units',
          units: units.map((unit) => unit.name),
        })
      }
      const record = await findOneWithDecryption(trx, Space, { id: current.id, ...scope, deletedAt: null }, undefined, scope)
      if (!record) return notFound('property_management.errors.spaceNotFound', 'Space not found.')
      record.deletedAt = new Date()
      return record
    })
    await emitSideEffects(ctx, 'deleted', space, { indexer: spaceCrudIndexer, events: spaceCrudEvents })
    return { spaceId: space.id }
  },
  buildLog: async ({ input, result, ctx, snapshots }) => {
    const base = await buildCrudLog(ctx, input, result?.spaceId ?? null, 'property_management.audit.space.delete', 'Delete space', SPACE_RESOURCE_KIND)
    const before = snapshots?.before as SpaceSnapshot | undefined
    return { ...base, snapshotBefore: before, payload: { undo: { before } satisfies SpaceUndoPayload } }
  },
  undo: async ({ logEntry, ctx }) => {
    const before = extractUndoPayload<SpaceUndoPayload>(logEntry)?.before
    if (!before) return
    const scope = scopeOf(before)
    ensureScope(ctx, scope)
    const em = resolveEm(ctx)
    const space = await em.fork().transactional(async (trx) => {
      const floor = await lockFloor(trx, scope, before.floorId)
      const geometry = await loadFloorGeometry(trx, scope, floor)
      const issues = checkPlacement({ kind: 'space', rect: toRect(before), selfId: before.id }, geometry)
      if (issues.length) await throwPlacementIssues(issues)
      const record = await findOneWithDecryption(trx, Space, { id: before.id, ...scope }, undefined, scope)
      if (record) record.deletedAt = null
      return record
    })
    if (space) await emitSideEffects(ctx, 'created', space, { indexer: spaceCrudIndexer, events: spaceCrudEvents }, 'undo')
  },
}

registerCommand(createSpaceCommand)
registerCommand(updateSpaceCommand)
registerCommand(deleteSpaceCommand)
