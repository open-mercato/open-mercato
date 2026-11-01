import { LockMode } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { ensureOrganizationScope } from '@open-mercato/shared/lib/commands/scope'
import type { CrudIndexerConfig, CrudEventsConfig } from '@open-mercato/shared/lib/crud/types'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { E } from '#generated/entities.ids.generated'
import {
  Asn,
  InventoryBalance,
  InventoryMovement,
  InventoryReservation,
  ProductInventoryProfile,
  PutawayTask,
  ReceivingLine,
  Warehouse,
  WarehouseZone,
} from '../data/entities'

export function ensureTenantScope(ctx: CommandRuntimeContext, tenantId: string): void {
  const currentTenant = ctx.auth?.tenantId ?? null
  if (currentTenant && currentTenant !== tenantId) {
    throw new CrudHttpError(403, { error: 'Forbidden' })
  }
}

// Scope + transaction/numeric helpers shared by every `wms` inventory command
// (reserve/release/allocate/adjust/receive/move/cycleCount) AND by
// `lib/wmsReservationService.ts` (A1 extraction). Living here — a neutral file
// with no dependency on `commands/inventory-actions.ts` or the service — keeps
// that pair's import graph acyclic: both import from `./shared`, neither
// imports the other's module for these.
export type Scope = { tenantId: string; organizationId: string }

export function resolveScope(
  ctx: CommandRuntimeContext,
  fallback?: { tenantId?: string | null; organizationId?: string | null },
): Scope {
  const tenantId = fallback?.tenantId ?? ctx.auth?.tenantId ?? null
  const organizationId = fallback?.organizationId ?? ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
  if (!tenantId || !organizationId) {
    throw new CrudHttpError(400, { error: 'Tenant and organization scope are required.' })
  }
  return { tenantId, organizationId }
}

// Preserves the pre-A1 behaviour exactly: a caller that already forked its own
// `EntityManager` (every command here via `resolveEm`) gets a fresh top-level
// transaction on that fork. A caller that instead hands in an EntityManager
// already inside a transaction (the composable path the A1 extraction exists
// for — `availability`'s future reserve/release/commit, Phase 2) has
// `em.transactional()` join that ambient transaction instead of opening a
// second one, which is the actual MikroORM contract this helper relies on.
export async function runInTransaction<TResult>(
  em: EntityManager,
  operation: (trx: EntityManager) => Promise<TResult>,
): Promise<TResult> {
  const transactionalEm = em as EntityManager & {
    transactional?: (callback: (trx: EntityManager) => Promise<TResult>) => Promise<TResult>
  }
  if (typeof transactionalEm.transactional === 'function') {
    return transactionalEm.transactional((trx) => operation(trx))
  }
  return operation(em)
}

export function toNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return 0
}

export function setNumeric(target: { [key: string]: unknown }, key: string, value: number): void {
  target[key] = toNumericString(value)
}

export function getAvailableQuantity(balance: InventoryBalance): number {
  return toNumber(balance.quantityOnHand) - toNumber(balance.quantityReserved) - toNumber(balance.quantityAllocated)
}

export function isUniqueConstraintError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const code = (error as { code?: string }).code
  if (code === '23505') return true
  const name = (error as { name?: string }).name
  return name === 'UniqueConstraintViolationException'
}

export async function findExactBalanceForUpdate(
  em: EntityManager,
  scope: Scope,
  input: {
    warehouseId: string
    locationId: string
    catalogVariantId: string
    lotId?: string
    serialNumber?: string
  },
): Promise<InventoryBalance | null> {
  return findOneWithDecryption(
    em,
    InventoryBalance,
    {
      warehouse: input.warehouseId,
      location: input.locationId,
      catalogVariantId: input.catalogVariantId,
      lot: input.lotId ?? null,
      serialNumber: input.serialNumber ?? null,
      deletedAt: null,
    },
    { lockMode: LockMode.PESSIMISTIC_WRITE },
    scope,
  )
}

export async function requireWarehouse(
  em: EntityManager,
  ctx: CommandRuntimeContext,
  warehouseId: string,
  scope?: Scope,
): Promise<Warehouse> {
  const resolvedScope = scope ?? resolveScope(ctx)
  const warehouse = await findOneWithDecryption(
    em,
    Warehouse,
    { id: warehouseId, deletedAt: null },
    undefined,
    resolvedScope,
  )
  if (!warehouse) throw new CrudHttpError(404, { error: 'Warehouse not found.' })
  ensureTenantScope(ctx, warehouse.tenantId)
  ensureOrganizationScope(ctx, warehouse.organizationId)
  return warehouse
}

export async function loadProfileForVariant(
  em: EntityManager,
  ctx: CommandRuntimeContext,
  catalogVariantId: string,
  scope?: Scope,
): Promise<ProductInventoryProfile | null> {
  const resolvedScope = scope ?? resolveScope(ctx)
  const profile = await findOneWithDecryption(
    em,
    ProductInventoryProfile,
    { catalogVariantId, deletedAt: null },
    undefined,
    resolvedScope,
  )
  if (!profile) return null
  ensureTenantScope(ctx, profile.tenantId)
  ensureOrganizationScope(ctx, profile.organizationId)
  return profile
}

export function requireId(id: string | null | undefined, label: string): string {
  if (typeof id === 'string' && id.trim().length > 0) return id.trim()
  throw new CrudHttpError(400, { error: `${label} id is required.` })
}

export function normalizeOptionalString(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function toNumericString(value: number | string | null | undefined, fallback = '0'): string {
  if (typeof value === 'string' && value.trim().length > 0) return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return fallback
}

// CRUD indexer configs — used by emitCrudSideEffects to drive query_index updates.
// Cache invalidation cross-aliases (e.g. balance lists invalidated when a reservation mutates)
// are declared in command-level metadata.context.cacheAliases so the command bus picks them up.
export const inventoryBalanceCrudIndexer: CrudIndexerConfig<InventoryBalance> = {
  entityType: E.wms.inventory_balance,
}

export const inventoryReservationCrudIndexer: CrudIndexerConfig<InventoryReservation> = {
  entityType: E.wms.inventory_reservation,
}

export const inventoryMovementCrudIndexer: CrudIndexerConfig<InventoryMovement> = {
  entityType: E.wms.inventory_movement,
}

// Zones are read through the hybrid query engine, which projects `cf:*` out of
// `entity_indexes` rather than joining `custom_field_values`. Without this indexer the
// zone commands write custom field values that no read path can ever see (#5239).
export const warehouseZoneCrudIndexer: CrudIndexerConfig<WarehouseZone> = {
  entityType: E.wms.warehouse_zone,
}

// Warehouse list/search goes through the hybrid query engine. Writing a custom
// field upserts `entity_indexes`; delete must tombstone that row. A leftover
// live index document makes `indexAnyRows` true and hides later warehouses that
// were never indexed (empty combobox on the same integration shard).
export const warehouseCrudIndexer: CrudIndexerConfig<Warehouse> = {
  entityType: E.wms.warehouse,
}

export const inventoryBalanceCrudEvents: CrudEventsConfig<InventoryBalance> = {
  module: 'wms',
  entity: 'inventory_balance',
  persistent: true,
  buildPayload: (ctx) => ({
    id: ctx.identifiers.id,
    organizationId: ctx.identifiers.organizationId,
    tenantId: ctx.identifiers.tenantId,
  }),
}

export const inventoryReservationCrudEvents: CrudEventsConfig<InventoryReservation> = {
  module: 'wms',
  entity: 'inventory_reservation',
  persistent: true,
  buildPayload: (ctx) => ({
    id: ctx.identifiers.id,
    organizationId: ctx.identifiers.organizationId,
    tenantId: ctx.identifiers.tenantId,
  }),
}

export const inventoryMovementCrudEvents: CrudEventsConfig<InventoryMovement> = {
  module: 'wms',
  entity: 'inventory_movement',
  persistent: true,
  buildPayload: (ctx) => ({
    id: ctx.identifiers.id,
    organizationId: ctx.identifiers.organizationId,
    tenantId: ctx.identifiers.tenantId,
  }),
}

export const asnCrudIndexer: CrudIndexerConfig<Asn> = {
  entityType: E.wms.asn,
}

export const receivingLineCrudIndexer: CrudIndexerConfig<ReceivingLine> = {
  entityType: E.wms.receiving_line,
}

export const asnCrudEvents: CrudEventsConfig<Asn> = {
  module: 'wms',
  entity: 'asn',
  persistent: true,
  buildPayload: (ctx) => ({
    id: ctx.identifiers.id,
    organizationId: ctx.identifiers.organizationId,
    tenantId: ctx.identifiers.tenantId,
  }),
}

export const receivingLineCrudEvents: CrudEventsConfig<ReceivingLine> = {
  module: 'wms',
  entity: 'receiving_line',
  persistent: true,
  buildPayload: (ctx) => ({
    id: ctx.identifiers.id,
    organizationId: ctx.identifiers.organizationId,
    tenantId: ctx.identifiers.tenantId,
  }),
}

export const putawayTaskCrudIndexer: CrudIndexerConfig<PutawayTask> = {
  entityType: E.wms.putaway_task,
}

export const putawayTaskCrudEvents: CrudEventsConfig<PutawayTask> = {
  module: 'wms',
  entity: 'putaway_task',
  persistent: true,
  buildPayload: (ctx) => ({
    id: ctx.identifiers.id,
    organizationId: ctx.identifiers.organizationId,
    tenantId: ctx.identifiers.tenantId,
  }),
}

// Cache alias resource kinds used to extend command-level cache invalidation
// when a single mutation impacts multiple list resources.
export const WMS_INVENTORY_BALANCE_RESOURCE = 'wms.inventoryBalance'
export const WMS_INVENTORY_RESERVATION_RESOURCE = 'wms.inventoryReservation'
export const WMS_INVENTORY_MOVEMENT_RESOURCE = 'wms.inventoryMovement'
export const WMS_ASN_RESOURCE = 'wms.asn'
export const WMS_RECEIVING_LINE_RESOURCE = 'wms.receivingLine'
export const WMS_PUTAWAY_TASK_RESOURCE = 'wms.putawayTask'

export { ensureOrganizationScope }
