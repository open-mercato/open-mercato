import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { ensureOrganizationScope } from '@open-mercato/shared/lib/commands/scope'
import type { CrudIndexerConfig, CrudEventsConfig } from '@open-mercato/shared/lib/crud/types'
import { E } from '#generated/entities.ids.generated'
import {
  InventoryBalance,
  InventoryMovement,
  InventoryReservation,
} from '../data/entities'

export function ensureTenantScope(ctx: CommandRuntimeContext, tenantId: string): void {
  const currentTenant = ctx.auth?.tenantId ?? null
  if (currentTenant && currentTenant !== tenantId) {
    throw new CrudHttpError(403, { error: 'Forbidden' })
  }
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

// Cache alias resource kinds used to extend command-level cache invalidation
// when a single mutation impacts multiple list resources.
export const WMS_INVENTORY_BALANCE_RESOURCE = 'wms.inventoryBalance'
export const WMS_INVENTORY_RESERVATION_RESOURCE = 'wms.inventoryReservation'
export const WMS_INVENTORY_MOVEMENT_RESOURCE = 'wms.inventoryMovement'

export { ensureOrganizationScope }
