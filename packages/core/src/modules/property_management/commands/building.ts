import { randomUUID } from 'node:crypto'
import { LockMode } from '@mikro-orm/core'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { extractUndoPayload } from '@open-mercato/shared/lib/commands/undo'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { forbidden } from '@open-mercato/shared/lib/crud/errors'
import { enforceCommandOptimisticLockWithGuards } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { E } from '#generated/entities.ids.generated'
import { Building, CommonArea, Floor, Space, Unit } from '../data/entities'
import {
  buildingCreateSchema,
  buildingIdSchema,
  buildingUpdateSchema,
  type BuildingCreateInput,
  type BuildingIdInput,
  type BuildingUpdateInput,
  type OpeningHoursEntry,
} from '../data/validators'
import { canManageAllBuildings } from '../lib/buildingAccess'
import { applyFloorLayout, revertFloorLayout, type LayoutChangeSnapshot } from '../lib/floorLayout'
import { assertManagerUsers, filterOrganizationUsers, loadManagerIds, replaceManagers } from '../lib/managers'
import { findBuildingUnitsEverUsed, findUnitBlockerList, usageBlockerConflictBody } from '../lib/usageGuards'
import {
  findBookingsOutsideHours,
  sameOpeningHours,
  type BookingOutsideHours,
  loadBuildingOpening,
  loadOpeningHours,
  replaceOpeningHours,
  serializeWeeklyHours,
} from '../lib/openingHours'
import { emitPropertyManagementEvent } from '../events'
import { lockProductUse, type Scope } from '../lib/productUse'
import {
  assertCtxBuildingAccess,
  buildCrudLog,
  buildingCrudEvents,
  buildingCrudIndexer,
  buildingUpdatedEvents,
  commonAreaCrudEvents,
  commonAreaCrudIndexer,
  conflict,
  emitLayoutChangeSideEffects,
  emitSideEffects,
  ensureScope,
  floorCrudEvents,
  floorCrudIndexer,
  isoOrNull,
  loadBuilding,
  loadCustomFields,
  lockBuilding,
  lockWritableBuilding,
  persistentEventOptions,
  renamedFloorIds,
  requireId,
  resolveEm,
  restoreCustomFields,
  restoredProductUnavailable,
  scopeOf,
  spaceCrudEvents,
  spaceCrudIndexer,
  unitCrudEvents,
  unitCrudIndexer,
  writeCustomFields,
  type CustomFieldValues,
} from './shared'

const logger = createLogger('property_management')

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
  openingHours?: OpeningHoursEntry[]
  managerUserIds: string[]
  custom?: CustomFieldValues
}

const BUILDING_ENTITY_ID = E.property_management.building

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

type SnapshotScopeInput = { tenantId?: string | null; organizationId?: string | null } | null | undefined

async function snapshotBuilding(ctx: CommandRuntimeContext, id: string, input?: SnapshotScopeInput): Promise<BuildingSnapshot | null> {
  const em = resolveEm(ctx)
  const lookupScope = {
    tenantId: input?.tenantId ?? ctx.auth?.tenantId ?? null,
    organizationId: input?.organizationId ?? ctx.selectedOrganizationId ?? null,
  }
  const building = await findOneWithDecryption(em, Building, { id, ...lookupScope }, undefined, lookupScope)
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
    openingHours: serializeWeeklyHours((await loadOpeningHours(em, scope, [building.id])).get(building.id) ?? new Map()),
    managerUserIds: await loadManagerIds(em, scope, building.id),
    custom: await loadCustomFields(em, BUILDING_ENTITY_ID, building),
  }
}

async function resolveManagerAssignment(
  ctx: CommandRuntimeContext,
  scope: Scope,
  requested: string[] | undefined,
  mode: 'create' | 'update',
): Promise<string[] | undefined> {
  if (!ctx.auth) {
    if (ctx.systemActor === true) return requested
    const { translate } = await resolveTranslations()
    throw forbidden(translate('property_management.errors.forbidden', 'You do not have permission to do this.'))
  }
  const manageAll = await canManageAllBuildings({ container: ctx.container, auth: ctx.auth, ...scope, request: ctx.request })
  if (manageAll) return requested
  if (mode === 'update') return undefined
  const actor = typeof ctx.auth.userId === 'string' && ctx.auth.userId ? ctx.auth.userId : ctx.auth.sub
  if (!actor || actor.startsWith('api_key:')) return []
  const [member] = await filterOrganizationUsers(resolveEm(ctx), scope, [actor])
  if (member) return [member]
  const { translate } = await resolveTranslations()
  throw forbidden(translate(
    'property_management.errors.buildingCreateOutsideOrganization',
    'You can only create buildings in your own organization. Ask someone who manages all buildings to create it.',
  ))
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
    const { building, layoutChanges } = await em.fork().transactional(async (trx) => {
      const record = trx.create(Building, {
        id: randomUUID(),
        ...scope,
        name: parsed.name,
        address: parsed.address,
        openingHoursEnabled: parsed.openingHoursEnabled ?? false,
      })
      trx.persist(record)
      await trx.flush()
      if (parsed.openingHours) await replaceOpeningHours(trx, scope, record.id, parsed.openingHours)
      await replaceManagers(trx, scope, record.id, validManagers)
      await trx.flush()
      const layout = await applyFloorLayout(trx, scope, record, parsed.layout, spaceName)
      await writeCustomFields(trx, ctx, BUILDING_ENTITY_ID, record, parsed.customFields)
      return { building: record, layoutChanges: layout.changes }
    })
    await emitSideEffects(ctx, 'created', building, { indexer: buildingCrudIndexer, events: buildingCrudEvents })
    await emitLayoutChangeSideEffects(ctx, layoutChanges)
    return { buildingId: building.id }
  },
  captureAfter: async (input, result, ctx) => snapshotBuilding(ctx, result.buildingId, input),
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
    await assertCtxBuildingAccess(ctx, scope, after.id)
    const em = resolveEm(ctx)
    await softDeleteBuildingTree(ctx, scope, after.id, em, 'undo')
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

async function assertBuildingNeverUsed(em: ReturnType<typeof resolveEm>, scope: Scope, buildingId: string): Promise<void> {
  const used = await findBuildingUnitsEverUsed(em, scope, buildingId)
  if (used.length) {
    await conflict(
      'property_management.errors.buildingUsed',
      'This building has had leases or bookings, so it cannot be deleted. Archive it instead.',
      { code: 'building_used' },
    )
  }
}

type BuildingTree = Awaited<ReturnType<typeof collectBuildingTree>>

async function emitTreeSideEffects(
  ctx: CommandRuntimeContext,
  action: 'created' | 'deleted',
  tree: BuildingTree,
  origin: 'write' | 'undo',
): Promise<void> {
  for (const floor of tree.floors) await emitSideEffects(ctx, action, floor, { indexer: floorCrudIndexer, events: floorCrudEvents }, origin)
  for (const space of tree.spaces) await emitSideEffects(ctx, action, space, { indexer: spaceCrudIndexer, events: spaceCrudEvents }, origin)
  for (const unit of tree.units) await emitSideEffects(ctx, action, unit, { indexer: unitCrudIndexer, events: unitCrudEvents }, origin)
  for (const area of tree.commonAreas) await emitSideEffects(ctx, action, area, { indexer: commonAreaCrudIndexer, events: commonAreaCrudEvents }, origin)
}

async function softDeleteBuildingTree(
  ctx: CommandRuntimeContext,
  scope: Scope,
  buildingId: string,
  em: ReturnType<typeof resolveEm>,
  origin: 'write' | 'undo' = 'write',
): Promise<DeletedBuildingTree> {
  const result = await em.fork().transactional(async (trx) => {
    const building = origin === 'undo' ? await lockWritableBuilding(trx, scope, buildingId) : await lockBuilding(trx, scope, buildingId)
    if (origin === 'write') await enforceBuildingVersion(ctx, building)
    await assertBuildingNeverUsed(trx, scope, buildingId)
    const tree = await collectBuildingTree(trx, scope, buildingId)
    const now = new Date()
    building.deletedAt = now
    for (const record of [...tree.floors, ...tree.spaces, ...tree.units, ...tree.commonAreas]) record.deletedAt = now
    return { building, tree }
  })
  await emitSideEffects(ctx, 'deleted', result.building, { indexer: buildingCrudIndexer, events: buildingCrudEvents }, origin)
  await emitTreeSideEffects(ctx, 'deleted', result.tree, origin)
  return {
    floorIds: result.tree.floors.map((record) => record.id),
    spaceIds: result.tree.spaces.map((record) => record.id),
    unitIds: result.tree.units.map((record) => record.id),
    commonAreaIds: result.tree.commonAreas.map((record) => record.id),
  }
}

async function enforceBuildingVersion(ctx: CommandRuntimeContext, building: Building): Promise<void> {
  await enforceCommandOptimisticLockWithGuards(ctx.container, {
    resourceKind: BUILDING_RESOURCE_KIND,
    resourceId: building.id,
    current: building.updatedAt,
    request: ctx.request ?? null,
  })
}

async function assertRevivedUnitProductsUsable(em: ReturnType<typeof resolveEm>, scope: Scope, units: readonly Unit[]): Promise<void> {
  const productIds = Array.from(new Set(units.map((unit) => unit.catalogProductId))).sort((left, right) => left.localeCompare(right))
  for (const productId of productIds) {
    if (!(await lockProductUse(em, scope, productId, 'share'))) await restoredProductUnavailable()
  }
}

function stillDeleted<T extends { deletedAt?: Date | null }>(items: readonly T[]): T[] {
  return items.filter((item) => Boolean(item.deletedAt))
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false
  const set = new Set(left)
  return right.every((id) => set.has(id))
}

async function managersChanged(
  em: ReturnType<typeof resolveEm>,
  scope: Scope,
  before: BuildingSnapshot,
  after: BuildingSnapshot | null | undefined,
): Promise<boolean> {
  const previous = Array.isArray(before.managerUserIds) ? before.managerUserIds : []
  if (after && Array.isArray(after.managerUserIds)) return !sameIds(previous, after.managerUserIds)
  return !sameIds(previous, await loadManagerIds(em, scope, before.id))
}

export type BuildingUpdateResult = {
  buildingId: string
  layout: LayoutChangeSnapshot | null
  bookingsOutsideHours: BookingOutsideHours[]
  bookingsOutsideHoursTotal: number
}

const updateBuildingCommand: CommandHandler<BuildingUpdateInput, BuildingUpdateResult> = {
  id: 'property_management.building.update',
  prepare: async (input, ctx) => {
    const before = await snapshotBuilding(ctx, requireId(input?.id), input)
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
      const building = await lockWritableBuilding(trx, scope, parsed.id)
      await enforceBuildingVersion(ctx, building)
      const previousName = building.name
      let layout: Awaited<ReturnType<typeof applyFloorLayout>> | null = null
      if (parsed.layout) {
        layout = await applyFloorLayout(trx, scope, building, parsed.layout, spaceName)
      }
      if (validManagers) {
        await replaceManagers(trx, scope, building.id, validManagers)
        await trx.flush()
      }
      const previousHours = serializeWeeklyHours((await loadOpeningHours(trx, scope, [building.id])).get(building.id) ?? new Map())
      const weeklyChanged = parsed.openingHours !== undefined && !sameOpeningHours(previousHours, parsed.openingHours)
      const enabledChanged = parsed.openingHoursEnabled !== undefined && parsed.openingHoursEnabled !== building.openingHoursEnabled
      if (parsed.openingHours && weeklyChanged) await replaceOpeningHours(trx, scope, building.id, parsed.openingHours)
      if (parsed.name !== undefined) building.name = parsed.name
      if (parsed.address !== undefined) building.address = parsed.address
      if (parsed.openingHoursEnabled !== undefined) building.openingHoursEnabled = parsed.openingHoursEnabled
      building.updatedAt = new Date()
      await trx.flush()
      await writeCustomFields(trx, ctx, BUILDING_ENTITY_ID, building, parsed.customFields)
      return { building, layout, hoursChanged: weeklyChanged || enabledChanged, nameChanged: building.name !== previousName }
    })
    const outsideHours = outcome.hoursChanged
      ? await findBookingsOutsideHours(em.fork(), scope, outcome.building.id, await loadBuildingOpening(em.fork(), scope, outcome.building))
      : { bookings: [], total: 0 }
    await emitSideEffects(ctx, 'updated', outcome.building, { indexer: buildingCrudIndexer, events: buildingUpdatedEvents(outcome.nameChanged) })
    if (outcome.layout) {
      await emitLayoutChangeSideEffects(ctx, outcome.layout.changes, 'write', {
        buildingRenamed: outcome.nameChanged,
        renamedFloorIds: renamedFloorIds(outcome.layout.snapshot.updatedFloors, outcome.layout.changes.floors.updated),
      })
    }
    return {
      buildingId: outcome.building.id,
      layout: outcome.layout?.snapshot ?? null,
      bookingsOutsideHours: outsideHours.bookings,
      bookingsOutsideHoursTotal: outsideHours.total,
    }
  },
  captureAfter: async (input, result, ctx) => snapshotBuilding(ctx, result.buildingId, input),
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
    await assertCtxBuildingAccess(ctx, scope, before.id)
    const em = resolveEm(ctx)
    const after = payload?.after ?? null
    const restoresManagers = await canManageAllBuildings({ container: ctx.container, auth: ctx.auth, ...scope, request: ctx.request })
    const restoredManagers = restoresManagers
      ? await filterOrganizationUsers(em, scope, Array.isArray(before.managerUserIds) ? before.managerUserIds : [])
      : null
    const outcome = await em.fork().transactional(async (trx) => {
      const record = await lockWritableBuilding(trx, scope, before.id)
      const previousName = record.name
      const layout = payload?.layout ? await revertFloorLayout(trx, scope, payload.layout) : null
      if (restoredManagers && await managersChanged(trx, scope, before, after)) {
        await replaceManagers(trx, scope, record.id, restoredManagers)
        await trx.flush()
      }
      if (before.openingHours && (!after?.openingHours || !sameOpeningHours(before.openingHours, after.openingHours))) {
        await replaceOpeningHours(trx, scope, record.id, before.openingHours)
      }
      if (!after || after.name !== before.name) record.name = before.name
      if (!after || after.address !== before.address) record.address = before.address
      if (!after || after.openingHoursEnabled !== before.openingHoursEnabled) record.openingHoursEnabled = before.openingHoursEnabled
      record.updatedAt = new Date()
      await trx.flush()
      await restoreCustomFields(trx, ctx, BUILDING_ENTITY_ID, record, before.custom, after?.custom)
      return { record, layout, nameChanged: record.name !== previousName }
    })
    await emitSideEffects(ctx, 'updated', outcome.record, { indexer: buildingCrudIndexer, events: buildingUpdatedEvents(outcome.nameChanged) }, 'undo')
    if (outcome.layout) await emitLayoutChangeSideEffects(ctx, outcome.layout, 'undo', { buildingRenamed: outcome.nameChanged })
  },
}

const deleteBuildingCommand: CommandHandler<BuildingIdInput, { buildingId: string; deleted: DeletedBuildingTree }> = {
  id: 'property_management.building.delete',
  prepare: async (input, ctx) => {
    const before = await snapshotBuilding(ctx, requireId(input?.id), input)
    return before ? { before } : {}
  },
  async execute(rawInput, ctx) {
    const parsed = buildingIdSchema.parse(rawInput ?? {})
    const scope = { tenantId: parsed.tenantId, organizationId: parsed.organizationId }
    ensureScope(ctx, scope)
    const em = resolveEm(ctx)
    const building = await loadBuilding(em, ctx, scope, parsed.id)
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
    await assertCtxBuildingAccess(ctx, scope, before.id)
    const em = resolveEm(ctx)
    const deleted = payload?.deleted
    const outcome = await em.fork().transactional(async (trx) => {
      const record = await findOneWithDecryption(
        trx,
        Building,
        { id: before.id, ...scope },
        { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true },
        scope,
      )
      if (!record) return null
      if (!record.deletedAt) return { record, tree: null }
      const [floors, spaces, units, commonAreas] = deleted
        ? await Promise.all([
            deleted.floorIds.length ? findWithDecryption(trx, Floor, { ...scope, id: { $in: deleted.floorIds } }, undefined, scope) : Promise.resolve([]),
            deleted.spaceIds.length ? findWithDecryption(trx, Space, { ...scope, id: { $in: deleted.spaceIds } }, undefined, scope) : Promise.resolve([]),
            deleted.unitIds.length ? findWithDecryption(trx, Unit, { ...scope, id: { $in: deleted.unitIds } }, undefined, scope) : Promise.resolve([]),
            deleted.commonAreaIds.length ? findWithDecryption(trx, CommonArea, { ...scope, id: { $in: deleted.commonAreaIds } }, undefined, scope) : Promise.resolve([]),
          ])
        : [[], [], [], []]
      const tree: BuildingTree = {
        floors: stillDeleted(floors),
        spaces: stillDeleted(spaces),
        units: stillDeleted(units),
        commonAreas: stillDeleted(commonAreas),
      }
      await assertRevivedUnitProductsUsable(trx, scope, tree.units)
      record.deletedAt = null
      for (const item of [...tree.floors, ...tree.spaces, ...tree.units, ...tree.commonAreas]) item.deletedAt = null
      return { record, tree }
    })
    if (!outcome?.tree) return
    await emitSideEffects(ctx, 'created', outcome.record, { indexer: buildingCrudIndexer, events: buildingCrudEvents }, 'undo')
    await emitTreeSideEffects(ctx, 'created', outcome.tree, 'undo')
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
    if (current.status === 'archived') {
      await conflict('property_management.errors.buildingArchived', 'An archived building cannot be changed.')
    }
    const building = await em.fork().transactional(async (trx) => {
      const record = await lockWritableBuilding(trx, scope, parsed.id)
      await enforceBuildingVersion(ctx, record)
      const units = await findWithDecryption(trx, Unit, { ...scope, buildingId: record.id, deletedAt: null }, { fields: ['id'] }, scope)
      const blockers = await findUnitBlockerList(trx, scope, units.map((unit) => unit.id))
      if (blockers.total) {
        await conflict(
          'property_management.errors.buildingArchiveBlocked',
          'This building still has active leases or upcoming bookings.',
          { code: 'building_archive_blocked', ...usageBlockerConflictBody(blockers) },
        )
      }
      record.status = 'archived'
      record.archivedAt = new Date()
      return record
    })
    await emitSideEffects(ctx, 'updated', building, { indexer: buildingCrudIndexer })
    await emitPropertyManagementEvent('property_management.building.archived', {
      id: building.id,
      tenantId: building.tenantId,
      organizationId: building.organizationId,
    }, persistentEventOptions(scopeOf(building))).catch((err: unknown) => {
      logger.error('Building archived event failed', { buildingId: building.id, err })
      getTelemetryRuntime()?.reportError(err, { module: 'property_management', code: 'property_management.building_archived_event_failed' })
    })
    return { buildingId: building.id }
  },
  buildLog: async ({ input, result, ctx }) =>
    buildCrudLog(ctx, input, result?.buildingId ?? null, 'property_management.audit.building.archive', 'Archive building', BUILDING_RESOURCE_KIND),
}

registerCommand(createBuildingCommand)
registerCommand(updateBuildingCommand)
registerCommand(deleteBuildingCommand)
registerCommand(archiveBuildingCommand)
