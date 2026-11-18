import type { EntityManager } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { E } from '#generated/entities.ids.generated'
import { Lease, Unit } from '../data/entities'
import type { Scope } from './productUse'

export const SEARCH_REINDEX_UPSERT_LIMIT = 500

export type SearchReindexPayload = { id?: unknown; tenantId?: unknown; organizationId?: unknown; nameChanged?: unknown }

export type SearchReindexContext = { resolve: <T = unknown>(name: string) => T }

type EventBusLike = {
  emitEvent: (event: string, payload: unknown, options?: Record<string, unknown>) => Promise<void>
}

export type SearchReindexResult =
  | { mode: 'skipped'; count: 0 }
  | { mode: 'upsert'; count: number }
  | { mode: 'reindex'; count: number }

type DependentTarget = { entity: typeof Lease | typeof Unit; entityType: string; foreignKey: 'unitId' | 'buildingId' | 'floorId' }

const UNIT_LEASES: DependentTarget = { entity: Lease, entityType: E.property_management.lease, foreignKey: 'unitId' }
const BUILDING_UNITS: DependentTarget = { entity: Unit, entityType: E.property_management.unit, foreignKey: 'buildingId' }
const FLOOR_UNITS: DependentTarget = { entity: Unit, entityType: E.property_management.unit, foreignKey: 'floorId' }

function readId(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function parseTarget(payload: SearchReindexPayload | null | undefined): { id: string; scope: Scope } | null {
  const id = readId(payload?.id)
  const tenantId = readId(payload?.tenantId)
  const organizationId = readId(payload?.organizationId)
  if (!id || !tenantId || !organizationId) return null
  return { id, scope: { tenantId, organizationId } }
}

async function loadDependentIds(em: EntityManager, target: DependentTarget, parentId: string, scope: Scope, limit: number): Promise<string[]> {
  const where = { ...scope, [target.foreignKey]: parentId, deletedAt: null }
  const rows: Array<{ id: string }> = target.entity === Lease
    ? await findWithDecryption(em, Lease, where, { fields: ['id'], orderBy: { id: 'asc' }, limit: limit + 1 }, scope)
    : await findWithDecryption(em, Unit, where, { fields: ['id'], orderBy: { id: 'asc' }, limit: limit + 1 }, scope)
  return rows.map((row) => row.id)
}

async function reindexDependents(
  target: DependentTarget,
  payload: SearchReindexPayload | null | undefined,
  ctx: SearchReindexContext,
  limit: number,
): Promise<SearchReindexResult> {
  if (payload?.nameChanged === false) return { mode: 'skipped', count: 0 }
  const parsed = parseTarget(payload)
  if (!parsed) return { mode: 'skipped', count: 0 }
  const em = ctx.resolve<EntityManager>('em').fork()
  const ids = await loadDependentIds(em, target, parsed.id, parsed.scope, limit)
  if (!ids.length) return { mode: 'skipped', count: 0 }
  const bus = ctx.resolve<EventBusLike>('eventBus')
  if (ids.length > limit) {
    await bus.emitEvent(
      'query_index.reindex',
      { entityType: target.entityType, tenantId: parsed.scope.tenantId, organizationId: parsed.scope.organizationId },
      { persistent: true, deliverInline: false },
    )
    return { mode: 'reindex', count: ids.length }
  }
  for (const id of ids) {
    await bus.emitEvent(
      'query_index.upsert_one',
      {
        entityType: target.entityType,
        recordId: id,
        tenantId: parsed.scope.tenantId,
        organizationId: parsed.scope.organizationId,
        crudAction: 'updated',
        coverageBaseDelta: 0,
      },
      { tenantId: parsed.scope.tenantId, organizationId: parsed.scope.organizationId },
    )
  }
  return { mode: 'upsert', count: ids.length }
}

export function reindexUnitLeases(payload: SearchReindexPayload | null | undefined, ctx: SearchReindexContext, limit = SEARCH_REINDEX_UPSERT_LIMIT) {
  return reindexDependents(UNIT_LEASES, payload, ctx, limit)
}

export function reindexBuildingUnits(payload: SearchReindexPayload | null | undefined, ctx: SearchReindexContext, limit = SEARCH_REINDEX_UPSERT_LIMIT) {
  return reindexDependents(BUILDING_UNITS, payload, ctx, limit)
}

export function reindexFloorUnits(payload: SearchReindexPayload | null | undefined, ctx: SearchReindexContext, limit = SEARCH_REINDEX_UPSERT_LIMIT) {
  return reindexDependents(FLOOR_UNITS, payload, ctx, limit)
}
