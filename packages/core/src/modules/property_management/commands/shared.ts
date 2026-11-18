import type { EntityManager } from '@mikro-orm/postgresql'
import { LockMode } from '@mikro-orm/core'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { ensureOrganizationScope } from '@open-mercato/shared/lib/commands/scope'
import { emitCrudSideEffects, emitCrudUndoSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import type { CrudEventsConfig, CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import { DefaultDataEngine, type DataEngine } from '@open-mercato/shared/lib/data/engine'
import { normalizeCustomFieldValues } from '@open-mercato/shared/lib/custom-fields/normalize'
import { buildCustomFieldResetMap, loadCustomFieldSnapshot } from '@open-mercato/shared/lib/commands/customFieldSnapshots'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { enforceCommandOptimisticLockWithGuards } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { E } from '#generated/entities.ids.generated'
import { Building, CommonArea, Floor, ProductUse, Space, Unit } from '../data/entities'
import { permittedBuildingIds, assertBuildingPermitted, type PermittedBuildings } from '../lib/buildingAccess'
import { floorRect, toRect, type NamedRect, type PlacementContext, type PlacementIssue, type UnitRect } from '../lib/geometry'
import { describePlacementIssues } from '../lib/placementMessages'
import type { FloorSnapshot, LayoutEntityChanges } from '../lib/floorLayout'
import type { Scope } from '../lib/productUse'

export function ensureTenantScope(ctx: CommandRuntimeContext, tenantId: string): void {
  const currentTenant = ctx.auth?.tenantId ?? null
  if (currentTenant && currentTenant !== tenantId) {
    throw new CrudHttpError(403, { error: 'property_management.errors.forbidden', code: 'tenant_scope_mismatch' })
  }
}

export function ensureScope(ctx: CommandRuntimeContext, scope: Scope): void {
  ensureTenantScope(ctx, scope.tenantId)
  ensureOrganizationScope(ctx, scope.organizationId)
}

export function resolveEm(ctx: CommandRuntimeContext): EntityManager {
  return (ctx.container.resolve('em') as EntityManager).fork()
}

export function scopeOf(record: { tenantId: string; organizationId: string }): Scope {
  return { tenantId: record.tenantId, organizationId: record.organizationId }
}

export function persistentEventOptions(scope: Scope): { persistent: true; tenantId: string; organizationId: string } {
  return { persistent: true, tenantId: scope.tenantId, organizationId: scope.organizationId }
}

export async function resolvePermitted(ctx: CommandRuntimeContext, scope: Scope): Promise<PermittedBuildings> {
  return permittedBuildingIds({
    container: ctx.container,
    auth: ctx.auth,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    system: ctx.systemActor === true,
    request: ctx.request ?? null,
  })
}

export async function assertCtxBuildingAccess(ctx: CommandRuntimeContext, scope: Scope, buildingId: string): Promise<void> {
  const permitted = await resolvePermitted(ctx, scope)
  await assertBuildingPermitted(permitted, buildingId)
}

export async function enforceRecordVersion(
  ctx: CommandRuntimeContext,
  resourceKind: string,
  record: { id: string; updatedAt?: Date | null },
): Promise<void> {
  await enforceCommandOptimisticLockWithGuards(ctx.container, {
    resourceKind,
    resourceId: record.id,
    current: record.updatedAt ?? null,
    request: ctx.request ?? null,
  })
}

export async function notFound(key: string, fallback: string): Promise<never> {
  const { translate } = await resolveTranslations()
  throw new CrudHttpError(404, { error: translate(key, fallback) })
}

export async function conflict(key: string, fallback: string, extra?: Record<string, unknown>): Promise<never> {
  const { translate } = await resolveTranslations()
  throw new CrudHttpError(409, { error: translate(key, fallback), ...(extra ?? {}) })
}

export function restoredProductUnavailable(): Promise<never> {
  return conflict(
    'property_management.errors.unitUndoProductUnavailable',
    'The previous product of this unit can no longer be used (it was deleted, left the unit type or is no longer leasable or bookable), so this change cannot be undone.',
    { code: 'unit_undo_product_unavailable' },
  )
}

export async function unprocessable(key: string, fallback: string, extra?: Record<string, unknown>, params?: Record<string, string | number>): Promise<never> {
  const { translate } = await resolveTranslations()
  throw new CrudHttpError(422, { error: translate(key, fallback, params), ...(extra ?? {}) })
}

export async function throwPlacementIssues(issues: PlacementIssue[], field: string = 'x'): Promise<never> {
  const { translate } = await resolveTranslations()
  const message = describePlacementIssues(issues, (key, fallback, params) => translate(key, fallback, params))
  throw new CrudHttpError(422, { error: message, code: 'placement_invalid', issues, fieldErrors: { [field]: message } })
}

export async function loadBuilding(em: EntityManager, ctx: CommandRuntimeContext, scope: Scope, id: string): Promise<Building> {
  const building = await findOneWithDecryption(em, Building, { id, ...scope, deletedAt: null }, undefined, scope)
  if (!building) return notFound('property_management.errors.buildingNotFound', 'Building not found.')
  await assertCtxBuildingAccess(ctx, scope, building.id)
  return building
}

export async function loadFloor(em: EntityManager, ctx: CommandRuntimeContext, scope: Scope, id: string): Promise<Floor> {
  const floor = await findOneWithDecryption(em, Floor, { id, ...scope, deletedAt: null }, undefined, scope)
  if (!floor) return notFound('property_management.errors.floorNotFound', 'Floor not found.')
  await assertCtxBuildingAccess(ctx, scope, floor.buildingId)
  return floor
}

export async function lockBuilding(em: EntityManager, scope: Scope, id: string): Promise<Building> {
  const building = await findOneWithDecryption(
    em,
    Building,
    { id, ...scope, deletedAt: null },
    { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true },
    scope,
  )
  if (!building) return notFound('property_management.errors.buildingNotFound', 'Building not found.')
  return building
}

export async function lockWritableBuilding(em: EntityManager, scope: Scope, id: string): Promise<Building> {
  const building = await lockBuilding(em, scope, id)
  if (building.status === 'archived') {
    await conflict('property_management.errors.buildingArchived', 'An archived building cannot be changed.')
  }
  return building
}

export async function lockFloors(em: EntityManager, scope: Scope, ids: readonly string[]): Promise<Floor[]> {
  const unique = Array.from(new Set(ids)).sort((left, right) => left.localeCompare(right))
  const floors: Floor[] = []
  for (const id of unique) {
    const floor = await findOneWithDecryption(
      em,
      Floor,
      { id, ...scope, deletedAt: null },
      { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true },
      scope,
    )
    if (!floor) return notFound('property_management.errors.floorNotFound', 'Floor not found.')
    floors.push(floor)
  }
  return floors
}

export async function lockFloor(em: EntityManager, scope: Scope, id: string): Promise<Floor> {
  const [floor] = await lockFloors(em, scope, [id])
  return floor
}

export type FloorGeometry = PlacementContext & {
  spaceRecords: Space[]
  unitRecords: Unit[]
  commonAreaRecords: CommonArea[]
}

export function namedRect(record: { id: string; name: string; x: string; y: string; width: string; depth: string }): NamedRect {
  return { id: record.id, name: record.name, ...toRect(record) }
}

export function unitRect(record: Unit): UnitRect {
  return { ...namedRect(record), spaceId: record.spaceId }
}

export async function loadFloorGeometry(em: EntityManager, scope: Scope, floor: Floor): Promise<FloorGeometry> {
  const [spaceRecords, unitRecords, commonAreaRecords] = await Promise.all([
    findWithDecryption(em, Space, { ...scope, floorId: floor.id, deletedAt: null }, undefined, scope),
    findWithDecryption(em, Unit, { ...scope, floorId: floor.id, deletedAt: null }, undefined, scope),
    findWithDecryption(em, CommonArea, { ...scope, floorId: floor.id, deletedAt: null }, undefined, scope),
  ])
  return {
    floor: floorRect(floor.sizeX, floor.sizeY),
    spaces: spaceRecords.map(namedRect),
    units: unitRecords.map(unitRect),
    commonAreas: commonAreaRecords.map(namedRect),
    spaceRecords,
    unitRecords,
    commonAreaRecords,
  }
}

export function metres(value: number): string {
  return (Math.round(value * 100) / 100).toFixed(2)
}

export const buildingCrudIndexer: CrudIndexerConfig<Building> = { entityType: E.property_management.building }
export const floorCrudIndexer: CrudIndexerConfig<Floor> = { entityType: E.property_management.floor }
export const spaceCrudIndexer: CrudIndexerConfig<Space> = { entityType: E.property_management.space }
export const unitCrudIndexer: CrudIndexerConfig<Unit> = { entityType: E.property_management.unit }
export const commonAreaCrudIndexer: CrudIndexerConfig<CommonArea> = { entityType: E.property_management.common_area }
export const productUseCrudIndexer: CrudIndexerConfig<ProductUse> = { entityType: E.property_management.product_use }

function crudEvents<T>(entity: string, extra: Record<string, unknown> = {}): CrudEventsConfig<T> {
  return {
    module: 'property_management',
    entity,
    persistent: true,
    buildPayload: (emitCtx) => ({
      id: emitCtx.identifiers.id,
      organizationId: emitCtx.identifiers.organizationId,
      tenantId: emitCtx.identifiers.tenantId,
      ...extra,
    }),
  }
}

export const buildingCrudEvents = crudEvents<Building>('building')
export const floorCrudEvents = crudEvents<Floor>('floor')

export function buildingUpdatedEvents(nameChanged: boolean): CrudEventsConfig<Building> {
  return crudEvents<Building>('building', { nameChanged })
}

export function floorUpdatedEvents(nameChanged: boolean): CrudEventsConfig<Floor> {
  return crudEvents<Floor>('floor', { nameChanged })
}

export function renamedFloorIds(before: readonly FloorSnapshot[], updated: readonly Floor[]): Set<string> {
  const previousNames = new Map(before.map((floor) => [floor.id, floor.name]))
  return new Set(updated.filter((floor) => previousNames.has(floor.id) && previousNames.get(floor.id) !== floor.name).map((floor) => floor.id))
}

export type LayoutRenameInfo = { buildingRenamed?: boolean; renamedFloorIds?: ReadonlySet<string> | null }

function floorNameChanged(floor: Floor, renames: LayoutRenameInfo): boolean {
  if (renames.buildingRenamed) return false
  return renames.renamedFloorIds ? renames.renamedFloorIds.has(floor.id) : true
}
export const spaceCrudEvents = crudEvents<Space>('space')
export const unitCrudEvents = crudEvents<Unit>('unit')
export const commonAreaCrudEvents = crudEvents<CommonArea>('common_area')

type SideEffectTarget = { id: string; organizationId: string; tenantId: string }

export async function emitSideEffects<T extends SideEffectTarget>(
  ctx: CommandRuntimeContext,
  action: 'created' | 'updated' | 'deleted',
  entity: T,
  config: { indexer: CrudIndexerConfig<T>; events?: CrudEventsConfig<T> },
  origin: 'write' | 'undo' = 'write',
): Promise<void> {
  const options = {
    dataEngine: ctx.container.resolve('dataEngine') as DataEngine,
    action,
    entity,
    identifiers: { id: entity.id, organizationId: entity.organizationId, tenantId: entity.tenantId },
    indexer: config.indexer,
    events: config.events,
  }
  if (origin === 'undo') {
    await emitCrudUndoSideEffects(options)
    return
  }
  await emitCrudSideEffects(options)
}

export async function emitLayoutChangeSideEffects(
  ctx: CommandRuntimeContext,
  result: LayoutEntityChanges,
  origin: 'write' | 'undo' = 'write',
  renames: LayoutRenameInfo = {},
): Promise<void> {
  const floorConfig = { indexer: floorCrudIndexer, events: floorCrudEvents }
  const spaceConfig = { indexer: spaceCrudIndexer, events: spaceCrudEvents }
  const areaConfig = { indexer: commonAreaCrudIndexer, events: commonAreaCrudEvents }
  for (const floor of result.floors.created) await emitSideEffects(ctx, 'created', floor, floorConfig, origin)
  for (const floor of result.floors.updated) {
    await emitSideEffects(ctx, 'updated', floor, { indexer: floorCrudIndexer, events: floorUpdatedEvents(floorNameChanged(floor, renames)) }, origin)
  }
  for (const floor of result.floors.removed) await emitSideEffects(ctx, 'deleted', floor, floorConfig, origin)
  for (const space of result.spaces.created) await emitSideEffects(ctx, 'created', space, spaceConfig, origin)
  for (const space of result.spaces.updated) await emitSideEffects(ctx, 'updated', space, spaceConfig, origin)
  for (const space of result.spaces.removed) await emitSideEffects(ctx, 'deleted', space, spaceConfig, origin)
  for (const area of result.commonAreas.created) await emitSideEffects(ctx, 'created', area, areaConfig, origin)
  for (const area of result.commonAreas.removed) await emitSideEffects(ctx, 'deleted', area, areaConfig, origin)
}

export type CustomFieldValues = Record<string, unknown>

export function hasCustomFieldValues(values: CustomFieldValues | null | undefined): values is CustomFieldValues {
  return Boolean(values && Object.keys(values).length)
}

export async function writeCustomFields(
  trx: EntityManager,
  ctx: CommandRuntimeContext,
  entityId: string,
  record: SideEffectTarget,
  values: CustomFieldValues | null | undefined,
): Promise<void> {
  if (!hasCustomFieldValues(values)) return
  await new DefaultDataEngine(trx, ctx.container).setCustomFields({
    entityId,
    recordId: record.id,
    tenantId: record.tenantId,
    organizationId: record.organizationId,
    values: normalizeCustomFieldValues(values),
    notify: false,
  })
}

export async function restoreCustomFields(
  trx: EntityManager,
  ctx: CommandRuntimeContext,
  entityId: string,
  record: SideEffectTarget,
  before: CustomFieldValues | null | undefined,
  after: CustomFieldValues | null | undefined,
): Promise<void> {
  if (!before && !after) return
  await writeCustomFields(trx, ctx, entityId, record, buildCustomFieldResetMap(before ?? undefined, after ?? undefined))
}

export async function loadCustomFields(em: EntityManager, entityId: string, record: SideEffectTarget): Promise<CustomFieldValues> {
  return loadCustomFieldSnapshot(em, {
    entityId,
    recordId: record.id,
    tenantId: record.tenantId,
    organizationId: record.organizationId,
  })
}

export async function buildCrudLog(
  ctx: CommandRuntimeContext,
  input: { tenantId?: string | null; organizationId?: string | null; id?: string | null } | undefined,
  resultId: string | null,
  actionKey: string,
  fallbackLabel: string,
  resourceKind: string,
) {
  const { translate } = await resolveTranslations()
  return {
    actionLabel: translate(actionKey, fallbackLabel),
    resourceKind,
    resourceId: resultId ?? input?.id ?? null,
    tenantId: input?.tenantId ?? ctx.auth?.tenantId ?? null,
    organizationId: input?.organizationId ?? ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null,
  }
}

export function requireId(id: string | null | undefined): string {
  if (typeof id === 'string' && id.trim().length > 0) return id.trim()
  throw new CrudHttpError(400, { error: '[internal] Record id is required.' })
}

export function isoOrNull(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null
}
