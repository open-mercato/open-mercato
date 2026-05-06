// =============================================================================
// WMS Configuration Commands — Undo Policy
// =============================================================================
//
// All warehouse / zone / location / inventory-profile / lot CRUD commands in
// this file follow the standard Open Mercato undoable pattern: each handler
// declares `prepare` (snapshot before), `captureAfter` (snapshot after) and
// `undo` (restore from snapshot) so the generic command-bus undo flow works
// out of the box, mirroring `catalog/commands/categories.ts`.
//
// Undo semantics per kind:
//   - create — undo soft-deletes the created record (`deletedAt = now`).
//   - update — undo restores all scalar/FK fields from the `before` snapshot;
//     re-creates the record with the original id if it was hard-deleted.
//   - delete — undo clears `deletedAt` and restores all fields from snapshot.
//
// Notes for downstream consistency:
//   - Inventory balances / reservations / movements reference these records
//     by FK. Undo does NOT replay those ledger rows; if a warehouse / zone /
//     location was deleted while ledger rows still pointed at it, undoing the
//     delete simply makes those references resolvable again. Live ledger state
//     itself is not rewound — that is the responsibility of the inventory
//     mutation commands' counter-actions documented in `inventory-actions.ts`.
//   - Cascading children (zones inside a warehouse, child locations inside a
//     parent location) are NOT auto-undone; each affected record needs its own
//     undo entry. The audit log preserves enough data per-entity for that.
// =============================================================================
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { extractUndoPayload } from '@open-mercato/shared/lib/commands/undo'
import type { JsonValue } from '@open-mercato/shared/lib/json'
import {
  InventoryLot,
  type InventoryLotStatus,
  ProductInventoryProfile,
  type InventoryStrategy,
  Warehouse,
  WarehouseLocation,
  type WarehouseLocationType,
  WarehouseZone,
} from '../data/entities'
import {
  inventoryLotCreateSchema,
  inventoryLotUpdateSchema,
  productInventoryProfileCreateSchema,
  productInventoryProfileUpdateSchema,
  warehouseCreateSchema,
  warehouseLocationCreateSchema,
  warehouseLocationUpdateSchema,
  warehouseUpdateSchema,
  warehouseZoneCreateSchema,
  warehouseZoneUpdateSchema,
  type InventoryLotCreateInput,
  type InventoryLotUpdateInput,
  type ProductInventoryProfileCreateInput,
  type ProductInventoryProfileUpdateInput,
  type WarehouseCreateInput,
  type WarehouseLocationCreateInput,
  type WarehouseLocationUpdateInput,
  type WarehouseUpdateInput,
  type WarehouseZoneCreateInput,
  type WarehouseZoneUpdateInput,
} from '../data/validators'
import {
  ensureOrganizationScope,
  ensureTenantScope,
  normalizeOptionalString,
  requireId,
  toNumericString,
} from './shared'
import { emitWmsEvent } from '../events'

function resolveScope(ctx: CommandRuntimeContext, fallback?: { tenantId?: string | null; organizationId?: string | null }) {
  return {
    tenantId: fallback?.tenantId ?? ctx.auth?.tenantId ?? null,
    organizationId: fallback?.organizationId ?? ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null,
  }
}

function resolveEm(ctx: CommandRuntimeContext): EntityManager {
  return (ctx.container.resolve('em') as EntityManager).fork()
}

function toJsonValue(value: Record<string, unknown> | null | undefined): JsonValue | null | undefined {
  if (value === undefined) return undefined
  return (value ?? null) as JsonValue | null
}

async function buildCrudLog(
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

async function loadWarehouse(em: EntityManager, ctx: CommandRuntimeContext, id: string) {
  const warehouse = await findOneWithDecryption(em, Warehouse, { id, deletedAt: null }, undefined, resolveScope(ctx))
  if (!warehouse) throw new CrudHttpError(404, { error: 'Warehouse not found.' })
  ensureTenantScope(ctx, warehouse.tenantId)
  ensureOrganizationScope(ctx, warehouse.organizationId)
  return warehouse
}

async function loadZone(em: EntityManager, ctx: CommandRuntimeContext, id: string) {
  const zone = await findOneWithDecryption(em, WarehouseZone, { id, deletedAt: null }, undefined, resolveScope(ctx))
  if (!zone) throw new CrudHttpError(404, { error: 'Warehouse zone not found.' })
  ensureTenantScope(ctx, zone.tenantId)
  ensureOrganizationScope(ctx, zone.organizationId)
  return zone
}

async function loadLocation(em: EntityManager, ctx: CommandRuntimeContext, id: string) {
  const location = await findOneWithDecryption(em, WarehouseLocation, { id, deletedAt: null }, undefined, resolveScope(ctx))
  if (!location) throw new CrudHttpError(404, { error: 'Warehouse location not found.' })
  ensureTenantScope(ctx, location.tenantId)
  ensureOrganizationScope(ctx, location.organizationId)
  return location
}

async function loadProfile(em: EntityManager, ctx: CommandRuntimeContext, id: string) {
  const profile = await findOneWithDecryption(em, ProductInventoryProfile, { id, deletedAt: null }, undefined, resolveScope(ctx))
  if (!profile) throw new CrudHttpError(404, { error: 'Inventory profile not found.' })
  ensureTenantScope(ctx, profile.tenantId)
  ensureOrganizationScope(ctx, profile.organizationId)
  return profile
}

async function loadLot(em: EntityManager, ctx: CommandRuntimeContext, id: string) {
  const lot = await findOneWithDecryption(em, InventoryLot, { id, deletedAt: null }, undefined, resolveScope(ctx))
  if (!lot) throw new CrudHttpError(404, { error: 'Inventory lot not found.' })
  ensureTenantScope(ctx, lot.tenantId)
  ensureOrganizationScope(ctx, lot.organizationId)
  return lot
}

// ---------------------------------------------------------------------------
// Snapshot types — used by `prepare` / `captureAfter` / `undo` to round-trip
// the full record through the audit log payload.
// ---------------------------------------------------------------------------

type WarehouseSnapshot = {
  id: string
  organizationId: string
  tenantId: string
  name: string
  code: string
  isActive: boolean
  addressLine1: string | null
  city: string | null
  postalCode: string | null
  country: string | null
  timezone: string | null
  metadata: JsonValue | null
  createdAt: string
  updatedAt: string
}

type WarehouseUndoPayload = { before?: WarehouseSnapshot | null; after?: WarehouseSnapshot | null }

type WarehouseZoneSnapshot = {
  id: string
  organizationId: string
  tenantId: string
  warehouseId: string
  code: string
  name: string
  priority: number
  metadata: JsonValue | null
  createdAt: string
  updatedAt: string
}

type WarehouseZoneUndoPayload = { before?: WarehouseZoneSnapshot | null; after?: WarehouseZoneSnapshot | null }

type WarehouseLocationSnapshot = {
  id: string
  organizationId: string
  tenantId: string
  warehouseId: string
  parentId: string | null
  code: string
  type: WarehouseLocationType
  isActive: boolean
  capacityUnits: string | null
  capacityWeight: string | null
  constraints: JsonValue | null
  metadata: JsonValue | null
  createdAt: string
  updatedAt: string
}

type WarehouseLocationUndoPayload = {
  before?: WarehouseLocationSnapshot | null
  after?: WarehouseLocationSnapshot | null
}

type ProductInventoryProfileSnapshot = {
  id: string
  organizationId: string
  tenantId: string
  catalogProductId: string
  catalogVariantId: string | null
  defaultUom: string
  trackLot: boolean
  trackSerial: boolean
  trackExpiration: boolean
  defaultStrategy: InventoryStrategy
  reorderPoint: string
  safetyStock: string
  metadata: JsonValue | null
  createdAt: string
  updatedAt: string
}

type ProductInventoryProfileUndoPayload = {
  before?: ProductInventoryProfileSnapshot | null
  after?: ProductInventoryProfileSnapshot | null
}

type InventoryLotSnapshot = {
  id: string
  organizationId: string
  tenantId: string
  catalogVariantId: string
  sku: string
  lotNumber: string
  batchNumber: string | null
  manufacturedAt: string | null
  bestBeforeAt: string | null
  expiresAt: string | null
  status: InventoryLotStatus
  metadata: JsonValue | null
  createdAt: string
  updatedAt: string
}

type InventoryLotUndoPayload = { before?: InventoryLotSnapshot | null; after?: InventoryLotSnapshot | null }

function isoOrNull(value: Date | string | null | undefined): string | null {
  if (!value) return null
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'string') return value
  return null
}

function dateOrNull(value: string | Date | null | undefined): Date | null {
  if (!value) return null
  if (value instanceof Date) return value
  if (typeof value === 'string') return new Date(value)
  return null
}

function snapshotWarehouse(record: Warehouse): WarehouseSnapshot {
  return {
    id: record.id,
    organizationId: record.organizationId,
    tenantId: record.tenantId,
    name: record.name,
    code: record.code,
    isActive: !!record.isActive,
    addressLine1: record.addressLine1 ?? null,
    city: record.city ?? null,
    postalCode: record.postalCode ?? null,
    country: record.country ?? null,
    timezone: record.timezone ?? null,
    metadata: (record.metadata ?? null) as JsonValue | null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  }
}

async function loadWarehouseSnapshot(
  em: EntityManager,
  ctx: CommandRuntimeContext,
  id: string,
): Promise<WarehouseSnapshot | null> {
  const record = await findOneWithDecryption(em, Warehouse, { id }, undefined, resolveScope(ctx))
  return record ? snapshotWarehouse(record) : null
}

function snapshotWarehouseZone(record: WarehouseZone): WarehouseZoneSnapshot {
  const warehouseId = typeof record.warehouse === 'string' ? record.warehouse : record.warehouse.id
  return {
    id: record.id,
    organizationId: record.organizationId,
    tenantId: record.tenantId,
    warehouseId,
    code: record.code,
    name: record.name,
    priority: record.priority ?? 0,
    metadata: (record.metadata ?? null) as JsonValue | null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  }
}

async function loadWarehouseZoneSnapshot(
  em: EntityManager,
  ctx: CommandRuntimeContext,
  id: string,
): Promise<WarehouseZoneSnapshot | null> {
  const record = await findOneWithDecryption(em, WarehouseZone, { id }, undefined, resolveScope(ctx))
  return record ? snapshotWarehouseZone(record) : null
}

function snapshotWarehouseLocation(record: WarehouseLocation): WarehouseLocationSnapshot {
  const warehouseId = typeof record.warehouse === 'string' ? record.warehouse : record.warehouse.id
  let parentId: string | null = null
  if (record.parent) {
    parentId = typeof record.parent === 'string' ? record.parent : record.parent.id
  }
  return {
    id: record.id,
    organizationId: record.organizationId,
    tenantId: record.tenantId,
    warehouseId,
    parentId,
    code: record.code,
    type: record.type,
    isActive: !!record.isActive,
    capacityUnits: record.capacityUnits ?? null,
    capacityWeight: record.capacityWeight ?? null,
    constraints: (record.constraints ?? null) as JsonValue | null,
    metadata: (record.metadata ?? null) as JsonValue | null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  }
}

async function loadWarehouseLocationSnapshot(
  em: EntityManager,
  ctx: CommandRuntimeContext,
  id: string,
): Promise<WarehouseLocationSnapshot | null> {
  const record = await findOneWithDecryption(em, WarehouseLocation, { id }, undefined, resolveScope(ctx))
  return record ? snapshotWarehouseLocation(record) : null
}

function snapshotInventoryProfile(record: ProductInventoryProfile): ProductInventoryProfileSnapshot {
  return {
    id: record.id,
    organizationId: record.organizationId,
    tenantId: record.tenantId,
    catalogProductId: record.catalogProductId,
    catalogVariantId: record.catalogVariantId ?? null,
    defaultUom: record.defaultUom,
    trackLot: !!record.trackLot,
    trackSerial: !!record.trackSerial,
    trackExpiration: !!record.trackExpiration,
    defaultStrategy: record.defaultStrategy,
    reorderPoint: record.reorderPoint,
    safetyStock: record.safetyStock,
    metadata: (record.metadata ?? null) as JsonValue | null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  }
}

async function loadInventoryProfileSnapshot(
  em: EntityManager,
  ctx: CommandRuntimeContext,
  id: string,
): Promise<ProductInventoryProfileSnapshot | null> {
  const record = await findOneWithDecryption(em, ProductInventoryProfile, { id }, undefined, resolveScope(ctx))
  return record ? snapshotInventoryProfile(record) : null
}

function snapshotInventoryLot(record: InventoryLot): InventoryLotSnapshot {
  return {
    id: record.id,
    organizationId: record.organizationId,
    tenantId: record.tenantId,
    catalogVariantId: record.catalogVariantId,
    sku: record.sku,
    lotNumber: record.lotNumber,
    batchNumber: record.batchNumber ?? null,
    manufacturedAt: isoOrNull(record.manufacturedAt ?? null),
    bestBeforeAt: isoOrNull(record.bestBeforeAt ?? null),
    expiresAt: isoOrNull(record.expiresAt ?? null),
    status: record.status,
    metadata: (record.metadata ?? null) as JsonValue | null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  }
}

async function loadInventoryLotSnapshot(
  em: EntityManager,
  ctx: CommandRuntimeContext,
  id: string,
): Promise<InventoryLotSnapshot | null> {
  const record = await findOneWithDecryption(em, InventoryLot, { id }, undefined, resolveScope(ctx))
  return record ? snapshotInventoryLot(record) : null
}

async function ensureWarehouseCodeUnique(
  em: EntityManager,
  tenantId: string,
  organizationId: string,
  code: string,
  excludeId?: string,
) {
  const existing = await findOneWithDecryption(
    em,
    Warehouse,
    { tenantId, organizationId, code, deletedAt: null },
    undefined,
    { tenantId, organizationId }
  )
  if (existing && existing.id !== excludeId) {
    throw new CrudHttpError(409, { error: 'Warehouse code already exists in this organization.' })
  }
}

async function ensureZoneCodeUnique(
  em: EntityManager,
  warehouseId: string,
  tenantId: string,
  organizationId: string,
  code: string,
  excludeId?: string,
) {
  const existing = await findOneWithDecryption(
    em,
    WarehouseZone,
    { warehouse: warehouseId, tenantId, organizationId, code, deletedAt: null },
    undefined,
    { tenantId, organizationId }
  )
  if (existing && existing.id !== excludeId) {
    throw new CrudHttpError(409, { error: 'Zone code already exists in this warehouse.' })
  }
}

async function ensureLocationCodeUnique(
  em: EntityManager,
  warehouseId: string,
  tenantId: string,
  organizationId: string,
  code: string,
  excludeId?: string,
) {
  const existing = await findOneWithDecryption(
    em,
    WarehouseLocation,
    { warehouse: warehouseId, tenantId, organizationId, code, deletedAt: null },
    undefined,
    { tenantId, organizationId }
  )
  if (existing && existing.id !== excludeId) {
    throw new CrudHttpError(409, { error: 'Location code already exists in this warehouse.' })
  }
}

async function ensureProfileUniqueness(
  em: EntityManager,
  input: {
    tenantId: string
    organizationId: string
    catalogProductId: string
    catalogVariantId?: string | null
  },
  excludeId?: string,
) {
  const where = input.catalogVariantId
    ? {
        tenantId: input.tenantId,
        organizationId: input.organizationId,
        catalogVariantId: input.catalogVariantId,
        deletedAt: null,
      }
    : {
        tenantId: input.tenantId,
        organizationId: input.organizationId,
        catalogProductId: input.catalogProductId,
        catalogVariantId: null,
        deletedAt: null,
      }
  const existing = await findOneWithDecryption(
    em,
    ProductInventoryProfile,
    where,
    undefined,
    { tenantId: input.tenantId, organizationId: input.organizationId }
  )
  if (existing && existing.id !== excludeId) {
    throw new CrudHttpError(409, { error: 'Inventory profile already exists for this product scope.' })
  }
}

async function ensureLotUniqueness(
  em: EntityManager,
  input: { tenantId: string; organizationId: string; catalogVariantId: string; lotNumber: string },
  excludeId?: string,
) {
  const existing = await findOneWithDecryption(
    em,
    InventoryLot,
    {
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      catalogVariantId: input.catalogVariantId,
      lotNumber: input.lotNumber,
      deletedAt: null,
    },
    undefined,
    { tenantId: input.tenantId, organizationId: input.organizationId }
  )
  if (existing && existing.id !== excludeId) {
    throw new CrudHttpError(409, { error: 'Lot number already exists for this variant.' })
  }
}

async function resolveParentLocation(
  em: EntityManager,
  ctx: CommandRuntimeContext,
  warehouseId: string,
  parentId: string | null | undefined,
) {
  if (!parentId) return null
  const parent = await loadLocation(em, ctx, parentId)
  const parentWarehouseId = typeof parent.warehouse === 'string' ? parent.warehouse : parent.warehouse.id
  if (parentWarehouseId !== warehouseId) {
    throw new CrudHttpError(422, { error: 'Parent location must belong to the same warehouse.' })
  }
  return parent
}

const createWarehouseCommand: CommandHandler<WarehouseCreateInput, { warehouseId: string }> = {
  id: 'wms.warehouses.create',
  async execute(rawInput, ctx) {
    const parsed = warehouseCreateSchema.parse(rawInput ?? {})
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)
    const em = resolveEm(ctx)
    await ensureWarehouseCodeUnique(em, parsed.tenantId, parsed.organizationId, parsed.code)
    const warehouse = em.create(Warehouse, {
      organizationId: parsed.organizationId,
      tenantId: parsed.tenantId,
      name: parsed.name,
      code: parsed.code,
      isActive: parsed.isActive ?? true,
      addressLine1: normalizeOptionalString(parsed.addressLine1),
      city: normalizeOptionalString(parsed.city),
      postalCode: normalizeOptionalString(parsed.postalCode),
      country: normalizeOptionalString(parsed.country),
      timezone: normalizeOptionalString(parsed.timezone),
      metadata: toJsonValue(parsed.metadata),
    })
    await em.persist(warehouse).flush()
    void emitWmsEvent('wms.warehouse.created', {
      id: warehouse.id,
      warehouseId: warehouse.id,
      tenantId: warehouse.tenantId,
      organizationId: warehouse.organizationId,
    }).catch(() => undefined)
    return { warehouseId: warehouse.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = resolveEm(ctx)
    return loadWarehouseSnapshot(em, ctx, result.warehouseId)
  },
  buildLog: async ({ input, result, ctx, snapshots }) => {
    const base = await buildCrudLog(ctx, input, result?.warehouseId ?? null, 'wms.audit.warehouse.create', 'Create warehouse', 'wms.warehouse')
    const after = snapshots?.after as WarehouseSnapshot | undefined
    return { ...base, snapshotAfter: after, payload: { undo: { after } satisfies WarehouseUndoPayload } }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<WarehouseUndoPayload>(logEntry)
    const after = payload?.after
    if (!after) return
    const em = resolveEm(ctx)
    const record = await em.findOne(Warehouse, { id: after.id })
    if (!record) return
    ensureTenantScope(ctx, record.tenantId)
    ensureOrganizationScope(ctx, record.organizationId)
    record.deletedAt = new Date()
    await em.flush()
  },
}

const updateWarehouseCommand: CommandHandler<WarehouseUpdateInput, { warehouseId: string }> = {
  id: 'wms.warehouses.update',
  prepare: async (input, ctx) => {
    const id = requireId(input?.id, 'Warehouse')
    const em = resolveEm(ctx)
    const before = await loadWarehouseSnapshot(em, ctx, id)
    return before ? { before } : {}
  },
  async execute(rawInput, ctx) {
    const parsed = warehouseUpdateSchema.parse(rawInput ?? {})
    const em = resolveEm(ctx)
    const warehouse = await loadWarehouse(em, ctx, parsed.id)
    if (parsed.code !== undefined && parsed.code !== warehouse.code) {
      await ensureWarehouseCodeUnique(em, warehouse.tenantId, warehouse.organizationId, parsed.code, warehouse.id)
      warehouse.code = parsed.code
    }
    if (parsed.name !== undefined) warehouse.name = parsed.name
    if (parsed.isActive !== undefined) warehouse.isActive = parsed.isActive
    if (parsed.addressLine1 !== undefined) warehouse.addressLine1 = normalizeOptionalString(parsed.addressLine1)
    if (parsed.city !== undefined) warehouse.city = normalizeOptionalString(parsed.city)
    if (parsed.postalCode !== undefined) warehouse.postalCode = normalizeOptionalString(parsed.postalCode)
    if (parsed.country !== undefined) warehouse.country = normalizeOptionalString(parsed.country)
    if (parsed.timezone !== undefined) warehouse.timezone = normalizeOptionalString(parsed.timezone)
    if (parsed.metadata !== undefined) warehouse.metadata = toJsonValue(parsed.metadata)
    await em.flush()
    void emitWmsEvent('wms.warehouse.updated', {
      id: warehouse.id,
      warehouseId: warehouse.id,
      tenantId: warehouse.tenantId,
      organizationId: warehouse.organizationId,
    }).catch(() => undefined)
    return { warehouseId: warehouse.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = resolveEm(ctx)
    return loadWarehouseSnapshot(em, ctx, result.warehouseId)
  },
  buildLog: async ({ input, result, ctx, snapshots }) => {
    const base = await buildCrudLog(ctx, input, result?.warehouseId ?? null, 'wms.audit.warehouse.update', 'Update warehouse', 'wms.warehouse')
    const before = snapshots?.before as WarehouseSnapshot | undefined
    const after = snapshots?.after as WarehouseSnapshot | undefined
    return { ...base, snapshotBefore: before, snapshotAfter: after, payload: { undo: { before, after } satisfies WarehouseUndoPayload } }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<WarehouseUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = resolveEm(ctx)
    let record = await em.findOne(Warehouse, { id: before.id })
    if (!record) {
      record = em.create(Warehouse, {
        id: before.id,
        organizationId: before.organizationId,
        tenantId: before.tenantId,
        name: before.name,
        code: before.code,
        isActive: before.isActive,
        addressLine1: before.addressLine1,
        city: before.city,
        postalCode: before.postalCode,
        country: before.country,
        timezone: before.timezone,
        metadata: before.metadata,
      })
      em.persist(record)
    } else {
      ensureTenantScope(ctx, before.tenantId)
      ensureOrganizationScope(ctx, before.organizationId)
      record.name = before.name
      record.code = before.code
      record.isActive = before.isActive
      record.addressLine1 = before.addressLine1
      record.city = before.city
      record.postalCode = before.postalCode
      record.country = before.country
      record.timezone = before.timezone
      record.metadata = before.metadata
      record.deletedAt = null
    }
    await em.flush()
  },
}

const deleteWarehouseCommand: CommandHandler<{ id?: string }, { warehouseId: string }> = {
  id: 'wms.warehouses.delete',
  prepare: async (input, ctx) => {
    const id = requireId(input?.id, 'Warehouse')
    const em = resolveEm(ctx)
    const before = await loadWarehouseSnapshot(em, ctx, id)
    return before ? { before } : {}
  },
  async execute(input, ctx) {
    const warehouseId = requireId(input?.id, 'Warehouse')
    const em = resolveEm(ctx)
    const warehouse = await loadWarehouse(em, ctx, warehouseId)
    warehouse.deletedAt = new Date()
    await em.flush()
    return { warehouseId: warehouse.id }
  },
  buildLog: async ({ input, result, ctx, snapshots }) => {
    const base = await buildCrudLog(ctx, input, result?.warehouseId ?? null, 'wms.audit.warehouse.delete', 'Delete warehouse', 'wms.warehouse')
    const before = snapshots?.before as WarehouseSnapshot | undefined
    return { ...base, snapshotBefore: before, payload: { undo: { before } satisfies WarehouseUndoPayload } }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<WarehouseUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = resolveEm(ctx)
    let record = await em.findOne(Warehouse, { id: before.id })
    if (!record) {
      record = em.create(Warehouse, {
        id: before.id,
        organizationId: before.organizationId,
        tenantId: before.tenantId,
        name: before.name,
        code: before.code,
        isActive: before.isActive,
        addressLine1: before.addressLine1,
        city: before.city,
        postalCode: before.postalCode,
        country: before.country,
        timezone: before.timezone,
        metadata: before.metadata,
      })
      em.persist(record)
    } else {
      ensureTenantScope(ctx, before.tenantId)
      ensureOrganizationScope(ctx, before.organizationId)
      record.deletedAt = null
      record.name = before.name
      record.code = before.code
      record.isActive = before.isActive
      record.addressLine1 = before.addressLine1
      record.city = before.city
      record.postalCode = before.postalCode
      record.country = before.country
      record.timezone = before.timezone
      record.metadata = before.metadata
    }
    await em.flush()
  },
}

async function restoreZoneFromSnapshot(em: EntityManager, before: WarehouseZoneSnapshot): Promise<void> {
  const warehouseRef = await em.findOne(Warehouse, { id: before.warehouseId })
  if (!warehouseRef) {
    throw new CrudHttpError(409, { error: 'Cannot undo zone: parent warehouse no longer exists.' })
  }
  let record = await em.findOne(WarehouseZone, { id: before.id })
  if (!record) {
    record = em.create(WarehouseZone, {
      id: before.id,
      organizationId: before.organizationId,
      tenantId: before.tenantId,
      warehouse: warehouseRef,
      code: before.code,
      name: before.name,
      priority: before.priority,
      metadata: before.metadata,
    })
    em.persist(record)
  } else {
    record.warehouse = warehouseRef
    record.code = before.code
    record.name = before.name
    record.priority = before.priority
    record.metadata = before.metadata
    record.deletedAt = null
  }
}

const createWarehouseZoneCommand: CommandHandler<WarehouseZoneCreateInput, { zoneId: string }> = {
  id: 'wms.zones.create',
  async execute(rawInput, ctx) {
    const parsed = warehouseZoneCreateSchema.parse(rawInput ?? {})
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)
    const em = resolveEm(ctx)
    const warehouse = await loadWarehouse(em, ctx, parsed.warehouseId)
    await ensureZoneCodeUnique(em, warehouse.id, warehouse.tenantId, warehouse.organizationId, parsed.code)
    const zone = em.create(WarehouseZone, {
      organizationId: parsed.organizationId,
      tenantId: parsed.tenantId,
      warehouse,
      code: parsed.code,
      name: parsed.name,
      priority: parsed.priority ?? 0,
      metadata: toJsonValue(parsed.metadata),
    })
    await em.persist(zone).flush()
    void emitWmsEvent('wms.zone.created', {
      id: zone.id,
      zoneId: zone.id,
      warehouseId: typeof zone.warehouse === 'string' ? zone.warehouse : zone.warehouse.id,
      tenantId: zone.tenantId,
      organizationId: zone.organizationId,
    }).catch(() => undefined)
    return { zoneId: zone.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = resolveEm(ctx)
    return loadWarehouseZoneSnapshot(em, ctx, result.zoneId)
  },
  buildLog: async ({ input, result, ctx, snapshots }) => {
    const base = await buildCrudLog(ctx, input, result?.zoneId ?? null, 'wms.audit.zone.create', 'Create warehouse zone', 'wms.zone')
    const after = snapshots?.after as WarehouseZoneSnapshot | undefined
    return { ...base, snapshotAfter: after, payload: { undo: { after } satisfies WarehouseZoneUndoPayload } }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<WarehouseZoneUndoPayload>(logEntry)
    const after = payload?.after
    if (!after) return
    const em = resolveEm(ctx)
    const record = await em.findOne(WarehouseZone, { id: after.id })
    if (!record) return
    ensureTenantScope(ctx, record.tenantId)
    ensureOrganizationScope(ctx, record.organizationId)
    record.deletedAt = new Date()
    await em.flush()
  },
}

const updateWarehouseZoneCommand: CommandHandler<WarehouseZoneUpdateInput, { zoneId: string }> = {
  id: 'wms.zones.update',
  prepare: async (input, ctx) => {
    const id = requireId(input?.id, 'Zone')
    const em = resolveEm(ctx)
    const before = await loadWarehouseZoneSnapshot(em, ctx, id)
    return before ? { before } : {}
  },
  async execute(rawInput, ctx) {
    const parsed = warehouseZoneUpdateSchema.parse(rawInput ?? {})
    const em = resolveEm(ctx)
    const zone = await loadZone(em, ctx, parsed.id)
    if (parsed.warehouseId !== undefined) {
      const warehouse = await loadWarehouse(em, ctx, parsed.warehouseId)
      zone.warehouse = warehouse
    }
    const warehouseId = typeof zone.warehouse === 'string' ? zone.warehouse : zone.warehouse.id
    if (parsed.code !== undefined && parsed.code !== zone.code) {
      await ensureZoneCodeUnique(em, warehouseId, zone.tenantId, zone.organizationId, parsed.code, zone.id)
      zone.code = parsed.code
    }
    if (parsed.name !== undefined) zone.name = parsed.name
    if (parsed.priority !== undefined) zone.priority = parsed.priority
    if (parsed.metadata !== undefined) zone.metadata = toJsonValue(parsed.metadata)
    await em.flush()
    void emitWmsEvent('wms.zone.updated', {
      id: zone.id,
      zoneId: zone.id,
      warehouseId: typeof zone.warehouse === 'string' ? zone.warehouse : zone.warehouse.id,
      tenantId: zone.tenantId,
      organizationId: zone.organizationId,
    }).catch(() => undefined)
    return { zoneId: zone.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = resolveEm(ctx)
    return loadWarehouseZoneSnapshot(em, ctx, result.zoneId)
  },
  buildLog: async ({ input, result, ctx, snapshots }) => {
    const base = await buildCrudLog(ctx, input, result?.zoneId ?? null, 'wms.audit.zone.update', 'Update warehouse zone', 'wms.zone')
    const before = snapshots?.before as WarehouseZoneSnapshot | undefined
    const after = snapshots?.after as WarehouseZoneSnapshot | undefined
    return { ...base, snapshotBefore: before, snapshotAfter: after, payload: { undo: { before, after } satisfies WarehouseZoneUndoPayload } }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<WarehouseZoneUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = resolveEm(ctx)
    ensureTenantScope(ctx, before.tenantId)
    ensureOrganizationScope(ctx, before.organizationId)
    await restoreZoneFromSnapshot(em, before)
    await em.flush()
  },
}

const deleteWarehouseZoneCommand: CommandHandler<{ id?: string }, { zoneId: string }> = {
  id: 'wms.zones.delete',
  prepare: async (input, ctx) => {
    const id = requireId(input?.id, 'Zone')
    const em = resolveEm(ctx)
    const before = await loadWarehouseZoneSnapshot(em, ctx, id)
    return before ? { before } : {}
  },
  async execute(input, ctx) {
    const zoneId = requireId(input?.id, 'Zone')
    const em = resolveEm(ctx)
    const zone = await loadZone(em, ctx, zoneId)
    zone.deletedAt = new Date()
    await em.flush()
    return { zoneId: zone.id }
  },
  buildLog: async ({ input, result, ctx, snapshots }) => {
    const base = await buildCrudLog(ctx, input, result?.zoneId ?? null, 'wms.audit.zone.delete', 'Delete warehouse zone', 'wms.zone')
    const before = snapshots?.before as WarehouseZoneSnapshot | undefined
    return { ...base, snapshotBefore: before, payload: { undo: { before } satisfies WarehouseZoneUndoPayload } }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<WarehouseZoneUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = resolveEm(ctx)
    ensureTenantScope(ctx, before.tenantId)
    ensureOrganizationScope(ctx, before.organizationId)
    await restoreZoneFromSnapshot(em, before)
    await em.flush()
  },
}

async function restoreLocationFromSnapshot(em: EntityManager, before: WarehouseLocationSnapshot): Promise<void> {
  const warehouseRef = await em.findOne(Warehouse, { id: before.warehouseId })
  if (!warehouseRef) {
    throw new CrudHttpError(409, { error: 'Cannot undo location: parent warehouse no longer exists.' })
  }
  let parentRef: WarehouseLocation | null = null
  if (before.parentId) {
    parentRef = await em.findOne(WarehouseLocation, { id: before.parentId })
    // Parent may have been deleted independently — fall back to root level
    // rather than blocking the undo (the audit log still records the original
    // parent id for manual reconciliation).
  }
  let record = await em.findOne(WarehouseLocation, { id: before.id })
  if (!record) {
    record = em.create(WarehouseLocation, {
      id: before.id,
      organizationId: before.organizationId,
      tenantId: before.tenantId,
      warehouse: warehouseRef,
      parent: parentRef,
      code: before.code,
      type: before.type,
      isActive: before.isActive,
      capacityUnits: before.capacityUnits,
      capacityWeight: before.capacityWeight,
      constraints: before.constraints,
      metadata: before.metadata,
    })
    em.persist(record)
  } else {
    record.warehouse = warehouseRef
    record.parent = parentRef
    record.code = before.code
    record.type = before.type
    record.isActive = before.isActive
    record.capacityUnits = before.capacityUnits
    record.capacityWeight = before.capacityWeight
    record.constraints = before.constraints
    record.metadata = before.metadata
    record.deletedAt = null
  }
}

const createWarehouseLocationCommand: CommandHandler<WarehouseLocationCreateInput, { locationId: string }> = {
  id: 'wms.locations.create',
  async execute(rawInput, ctx) {
    const parsed = warehouseLocationCreateSchema.parse(rawInput ?? {})
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)
    const em = resolveEm(ctx)
    const warehouse = await loadWarehouse(em, ctx, parsed.warehouseId)
    await ensureLocationCodeUnique(em, warehouse.id, warehouse.tenantId, warehouse.organizationId, parsed.code)
    const parent = await resolveParentLocation(em, ctx, warehouse.id, parsed.parentId ?? null)
    const location = em.create(WarehouseLocation, {
      organizationId: parsed.organizationId,
      tenantId: parsed.tenantId,
      warehouse,
      code: parsed.code,
      type: parsed.type,
      parent,
      isActive: parsed.isActive ?? true,
      capacityUnits: parsed.capacityUnits !== undefined ? toNumericString(parsed.capacityUnits) : null,
      capacityWeight: parsed.capacityWeight !== undefined ? toNumericString(parsed.capacityWeight) : null,
      constraints: toJsonValue(parsed.constraints),
      metadata: toJsonValue(parsed.metadata),
    })
    await em.persist(location).flush()
    void emitWmsEvent('wms.location.created', {
      id: location.id,
      locationId: location.id,
      warehouseId: typeof location.warehouse === 'string' ? location.warehouse : location.warehouse.id,
      tenantId: location.tenantId,
      organizationId: location.organizationId,
    }).catch(() => undefined)
    return { locationId: location.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = resolveEm(ctx)
    return loadWarehouseLocationSnapshot(em, ctx, result.locationId)
  },
  buildLog: async ({ input, result, ctx, snapshots }) => {
    const base = await buildCrudLog(ctx, input, result?.locationId ?? null, 'wms.audit.location.create', 'Create warehouse location', 'wms.location')
    const after = snapshots?.after as WarehouseLocationSnapshot | undefined
    return { ...base, snapshotAfter: after, payload: { undo: { after } satisfies WarehouseLocationUndoPayload } }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<WarehouseLocationUndoPayload>(logEntry)
    const after = payload?.after
    if (!after) return
    const em = resolveEm(ctx)
    const record = await em.findOne(WarehouseLocation, { id: after.id })
    if (!record) return
    ensureTenantScope(ctx, record.tenantId)
    ensureOrganizationScope(ctx, record.organizationId)
    record.deletedAt = new Date()
    await em.flush()
  },
}

const updateWarehouseLocationCommand: CommandHandler<WarehouseLocationUpdateInput, { locationId: string }> = {
  id: 'wms.locations.update',
  prepare: async (input, ctx) => {
    const id = requireId(input?.id, 'Location')
    const em = resolveEm(ctx)
    const before = await loadWarehouseLocationSnapshot(em, ctx, id)
    return before ? { before } : {}
  },
  async execute(rawInput, ctx) {
    const parsed = warehouseLocationUpdateSchema.parse(rawInput ?? {})
    const em = resolveEm(ctx)
    const location = await loadLocation(em, ctx, parsed.id)
    if (parsed.warehouseId !== undefined) {
      const warehouse = await loadWarehouse(em, ctx, parsed.warehouseId)
      location.warehouse = warehouse
    }
    const warehouseId = typeof location.warehouse === 'string' ? location.warehouse : location.warehouse.id
    if (parsed.parentId !== undefined) {
      location.parent = await resolveParentLocation(em, ctx, warehouseId, parsed.parentId)
    }
    if (parsed.code !== undefined && parsed.code !== location.code) {
      await ensureLocationCodeUnique(em, warehouseId, location.tenantId, location.organizationId, parsed.code, location.id)
      location.code = parsed.code
    }
    if (parsed.type !== undefined) location.type = parsed.type
    if (parsed.isActive !== undefined) location.isActive = parsed.isActive
    if (parsed.capacityUnits !== undefined) location.capacityUnits = toNumericString(parsed.capacityUnits)
    if (parsed.capacityWeight !== undefined) location.capacityWeight = toNumericString(parsed.capacityWeight)
    if (parsed.constraints !== undefined) location.constraints = toJsonValue(parsed.constraints)
    if (parsed.metadata !== undefined) location.metadata = toJsonValue(parsed.metadata)
    await em.flush()
    void emitWmsEvent('wms.location.updated', {
      id: location.id,
      locationId: location.id,
      warehouseId: typeof location.warehouse === 'string' ? location.warehouse : location.warehouse.id,
      tenantId: location.tenantId,
      organizationId: location.organizationId,
    }).catch(() => undefined)
    return { locationId: location.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = resolveEm(ctx)
    return loadWarehouseLocationSnapshot(em, ctx, result.locationId)
  },
  buildLog: async ({ input, result, ctx, snapshots }) => {
    const base = await buildCrudLog(ctx, input, result?.locationId ?? null, 'wms.audit.location.update', 'Update warehouse location', 'wms.location')
    const before = snapshots?.before as WarehouseLocationSnapshot | undefined
    const after = snapshots?.after as WarehouseLocationSnapshot | undefined
    return { ...base, snapshotBefore: before, snapshotAfter: after, payload: { undo: { before, after } satisfies WarehouseLocationUndoPayload } }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<WarehouseLocationUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = resolveEm(ctx)
    ensureTenantScope(ctx, before.tenantId)
    ensureOrganizationScope(ctx, before.organizationId)
    await restoreLocationFromSnapshot(em, before)
    await em.flush()
  },
}

const deleteWarehouseLocationCommand: CommandHandler<{ id?: string }, { locationId: string }> = {
  id: 'wms.locations.delete',
  prepare: async (input, ctx) => {
    const id = requireId(input?.id, 'Location')
    const em = resolveEm(ctx)
    const before = await loadWarehouseLocationSnapshot(em, ctx, id)
    return before ? { before } : {}
  },
  async execute(input, ctx) {
    const locationId = requireId(input?.id, 'Location')
    const em = resolveEm(ctx)
    const location = await loadLocation(em, ctx, locationId)
    location.deletedAt = new Date()
    await em.flush()
    return { locationId: location.id }
  },
  buildLog: async ({ input, result, ctx, snapshots }) => {
    const base = await buildCrudLog(ctx, input, result?.locationId ?? null, 'wms.audit.location.delete', 'Delete warehouse location', 'wms.location')
    const before = snapshots?.before as WarehouseLocationSnapshot | undefined
    return { ...base, snapshotBefore: before, payload: { undo: { before } satisfies WarehouseLocationUndoPayload } }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<WarehouseLocationUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = resolveEm(ctx)
    ensureTenantScope(ctx, before.tenantId)
    ensureOrganizationScope(ctx, before.organizationId)
    await restoreLocationFromSnapshot(em, before)
    await em.flush()
  },
}

function restoreInventoryProfileFromSnapshot(em: EntityManager, before: ProductInventoryProfileSnapshot, record: ProductInventoryProfile): void {
  record.catalogProductId = before.catalogProductId
  record.catalogVariantId = before.catalogVariantId
  record.defaultUom = before.defaultUom
  record.trackLot = before.trackLot
  record.trackSerial = before.trackSerial
  record.trackExpiration = before.trackExpiration
  record.defaultStrategy = before.defaultStrategy
  record.reorderPoint = before.reorderPoint
  record.safetyStock = before.safetyStock
  record.metadata = before.metadata
  record.deletedAt = null
}

const createProductInventoryProfileCommand: CommandHandler<ProductInventoryProfileCreateInput, { profileId: string }> = {
  id: 'wms.inventoryProfiles.create',
  async execute(rawInput, ctx) {
    const parsed = productInventoryProfileCreateSchema.parse(rawInput ?? {})
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)
    const em = resolveEm(ctx)
    await ensureProfileUniqueness(em, parsed)
    const profile = em.create(ProductInventoryProfile, {
      organizationId: parsed.organizationId,
      tenantId: parsed.tenantId,
      catalogProductId: parsed.catalogProductId,
      catalogVariantId: parsed.catalogVariantId ?? null,
      defaultUom: parsed.defaultUom,
      trackLot: parsed.trackLot ?? false,
      trackSerial: parsed.trackSerial ?? false,
      trackExpiration: parsed.trackExpiration ?? false,
      defaultStrategy: parsed.defaultStrategy,
      reorderPoint: toNumericString(parsed.reorderPoint),
      safetyStock: toNumericString(parsed.safetyStock),
      metadata: toJsonValue(parsed.metadata),
    })
    await em.persist(profile).flush()
    void emitWmsEvent('wms.inventory_profile.created', {
      id: profile.id,
      profileId: profile.id,
      catalogProductId: profile.catalogProductId,
      catalogVariantId: profile.catalogVariantId ?? null,
      tenantId: profile.tenantId,
      organizationId: profile.organizationId,
    }).catch(() => undefined)
    return { profileId: profile.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = resolveEm(ctx)
    return loadInventoryProfileSnapshot(em, ctx, result.profileId)
  },
  buildLog: async ({ input, result, ctx, snapshots }) => {
    const base = await buildCrudLog(ctx, input, result?.profileId ?? null, 'wms.audit.inventoryProfile.create', 'Create inventory profile', 'wms.inventoryProfile')
    const after = snapshots?.after as ProductInventoryProfileSnapshot | undefined
    return { ...base, snapshotAfter: after, payload: { undo: { after } satisfies ProductInventoryProfileUndoPayload } }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<ProductInventoryProfileUndoPayload>(logEntry)
    const after = payload?.after
    if (!after) return
    const em = resolveEm(ctx)
    const record = await em.findOne(ProductInventoryProfile, { id: after.id })
    if (!record) return
    ensureTenantScope(ctx, record.tenantId)
    ensureOrganizationScope(ctx, record.organizationId)
    record.deletedAt = new Date()
    await em.flush()
  },
}

const updateProductInventoryProfileCommand: CommandHandler<ProductInventoryProfileUpdateInput, { profileId: string }> = {
  id: 'wms.inventoryProfiles.update',
  prepare: async (input, ctx) => {
    const id = requireId(input?.id, 'Inventory profile')
    const em = resolveEm(ctx)
    const before = await loadInventoryProfileSnapshot(em, ctx, id)
    return before ? { before } : {}
  },
  async execute(rawInput, ctx) {
    const parsed = productInventoryProfileUpdateSchema.parse(rawInput ?? {})
    const em = resolveEm(ctx)
    const profile = await loadProfile(em, ctx, parsed.id)
    const next = {
      tenantId: profile.tenantId,
      organizationId: profile.organizationId,
      catalogProductId: parsed.catalogProductId ?? profile.catalogProductId,
      catalogVariantId: parsed.catalogVariantId !== undefined ? parsed.catalogVariantId ?? null : profile.catalogVariantId ?? null,
    }
    if (
      parsed.catalogProductId !== undefined ||
      parsed.catalogVariantId !== undefined
    ) {
      await ensureProfileUniqueness(em, next, profile.id)
    }
    if (parsed.catalogProductId !== undefined) profile.catalogProductId = parsed.catalogProductId
    if (parsed.catalogVariantId !== undefined) profile.catalogVariantId = parsed.catalogVariantId ?? null
    if (parsed.defaultUom !== undefined) profile.defaultUom = parsed.defaultUom
    if (parsed.trackLot !== undefined) profile.trackLot = parsed.trackLot
    if (parsed.trackSerial !== undefined) profile.trackSerial = parsed.trackSerial
    if (parsed.trackExpiration !== undefined) profile.trackExpiration = parsed.trackExpiration
    if (parsed.defaultStrategy !== undefined) profile.defaultStrategy = parsed.defaultStrategy
    if (parsed.reorderPoint !== undefined) profile.reorderPoint = toNumericString(parsed.reorderPoint)
    if (parsed.safetyStock !== undefined) profile.safetyStock = toNumericString(parsed.safetyStock)
    if (parsed.metadata !== undefined) profile.metadata = toJsonValue(parsed.metadata)
    await em.flush()
    void emitWmsEvent('wms.inventory_profile.updated', {
      id: profile.id,
      profileId: profile.id,
      catalogProductId: profile.catalogProductId,
      catalogVariantId: profile.catalogVariantId ?? null,
      tenantId: profile.tenantId,
      organizationId: profile.organizationId,
    }).catch(() => undefined)
    return { profileId: profile.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = resolveEm(ctx)
    return loadInventoryProfileSnapshot(em, ctx, result.profileId)
  },
  buildLog: async ({ input, result, ctx, snapshots }) => {
    const base = await buildCrudLog(ctx, input, result?.profileId ?? null, 'wms.audit.inventoryProfile.update', 'Update inventory profile', 'wms.inventoryProfile')
    const before = snapshots?.before as ProductInventoryProfileSnapshot | undefined
    const after = snapshots?.after as ProductInventoryProfileSnapshot | undefined
    return { ...base, snapshotBefore: before, snapshotAfter: after, payload: { undo: { before, after } satisfies ProductInventoryProfileUndoPayload } }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<ProductInventoryProfileUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = resolveEm(ctx)
    let record = await em.findOne(ProductInventoryProfile, { id: before.id })
    if (!record) {
      record = em.create(ProductInventoryProfile, {
        id: before.id,
        organizationId: before.organizationId,
        tenantId: before.tenantId,
        catalogProductId: before.catalogProductId,
        catalogVariantId: before.catalogVariantId,
        defaultUom: before.defaultUom,
        trackLot: before.trackLot,
        trackSerial: before.trackSerial,
        trackExpiration: before.trackExpiration,
        defaultStrategy: before.defaultStrategy,
        reorderPoint: before.reorderPoint,
        safetyStock: before.safetyStock,
        metadata: before.metadata,
      })
      em.persist(record)
    } else {
      ensureTenantScope(ctx, before.tenantId)
      ensureOrganizationScope(ctx, before.organizationId)
      restoreInventoryProfileFromSnapshot(em, before, record)
    }
    await em.flush()
  },
}

const deleteProductInventoryProfileCommand: CommandHandler<{ id?: string }, { profileId: string }> = {
  id: 'wms.inventoryProfiles.delete',
  prepare: async (input, ctx) => {
    const id = requireId(input?.id, 'Inventory profile')
    const em = resolveEm(ctx)
    const before = await loadInventoryProfileSnapshot(em, ctx, id)
    return before ? { before } : {}
  },
  async execute(input, ctx) {
    const profileId = requireId(input?.id, 'Inventory profile')
    const em = resolveEm(ctx)
    const profile = await loadProfile(em, ctx, profileId)
    profile.deletedAt = new Date()
    await em.flush()
    return { profileId: profile.id }
  },
  buildLog: async ({ input, result, ctx, snapshots }) => {
    const base = await buildCrudLog(ctx, input, result?.profileId ?? null, 'wms.audit.inventoryProfile.delete', 'Delete inventory profile', 'wms.inventoryProfile')
    const before = snapshots?.before as ProductInventoryProfileSnapshot | undefined
    return { ...base, snapshotBefore: before, payload: { undo: { before } satisfies ProductInventoryProfileUndoPayload } }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<ProductInventoryProfileUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = resolveEm(ctx)
    let record = await em.findOne(ProductInventoryProfile, { id: before.id })
    if (!record) {
      record = em.create(ProductInventoryProfile, {
        id: before.id,
        organizationId: before.organizationId,
        tenantId: before.tenantId,
        catalogProductId: before.catalogProductId,
        catalogVariantId: before.catalogVariantId,
        defaultUom: before.defaultUom,
        trackLot: before.trackLot,
        trackSerial: before.trackSerial,
        trackExpiration: before.trackExpiration,
        defaultStrategy: before.defaultStrategy,
        reorderPoint: before.reorderPoint,
        safetyStock: before.safetyStock,
        metadata: before.metadata,
      })
      em.persist(record)
    } else {
      ensureTenantScope(ctx, before.tenantId)
      ensureOrganizationScope(ctx, before.organizationId)
      restoreInventoryProfileFromSnapshot(em, before, record)
    }
    await em.flush()
  },
}

function restoreInventoryLotFromSnapshot(_em: EntityManager, before: InventoryLotSnapshot, record: InventoryLot): void {
  record.catalogVariantId = before.catalogVariantId
  record.sku = before.sku
  record.lotNumber = before.lotNumber
  record.batchNumber = before.batchNumber
  record.manufacturedAt = dateOrNull(before.manufacturedAt)
  record.bestBeforeAt = dateOrNull(before.bestBeforeAt)
  record.expiresAt = dateOrNull(before.expiresAt)
  record.status = before.status
  record.metadata = before.metadata
  record.deletedAt = null
}

const createInventoryLotCommand: CommandHandler<InventoryLotCreateInput, { lotId: string }> = {
  id: 'wms.lots.create',
  async execute(rawInput, ctx) {
    const parsed = inventoryLotCreateSchema.parse(rawInput ?? {})
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)
    const em = resolveEm(ctx)
    await ensureLotUniqueness(em, parsed)
    const lot = em.create(InventoryLot, {
      organizationId: parsed.organizationId,
      tenantId: parsed.tenantId,
      catalogVariantId: parsed.catalogVariantId,
      sku: parsed.sku,
      lotNumber: parsed.lotNumber,
      batchNumber: normalizeOptionalString(parsed.batchNumber),
      manufacturedAt: parsed.manufacturedAt ?? null,
      bestBeforeAt: parsed.bestBeforeAt ?? null,
      expiresAt: parsed.expiresAt ?? null,
      status: parsed.status ?? 'available',
      metadata: toJsonValue(parsed.metadata),
    })
    await em.persist(lot).flush()
    return { lotId: lot.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = resolveEm(ctx)
    return loadInventoryLotSnapshot(em, ctx, result.lotId)
  },
  buildLog: async ({ input, result, ctx, snapshots }) => {
    const base = await buildCrudLog(ctx, input, result?.lotId ?? null, 'wms.audit.lot.create', 'Create inventory lot', 'wms.inventoryLot')
    const after = snapshots?.after as InventoryLotSnapshot | undefined
    return { ...base, snapshotAfter: after, payload: { undo: { after } satisfies InventoryLotUndoPayload } }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<InventoryLotUndoPayload>(logEntry)
    const after = payload?.after
    if (!after) return
    const em = resolveEm(ctx)
    const record = await em.findOne(InventoryLot, { id: after.id })
    if (!record) return
    ensureTenantScope(ctx, record.tenantId)
    ensureOrganizationScope(ctx, record.organizationId)
    record.deletedAt = new Date()
    await em.flush()
  },
}

const updateInventoryLotCommand: CommandHandler<InventoryLotUpdateInput, { lotId: string }> = {
  id: 'wms.lots.update',
  prepare: async (input, ctx) => {
    const id = requireId(input?.id, 'Inventory lot')
    const em = resolveEm(ctx)
    const before = await loadInventoryLotSnapshot(em, ctx, id)
    return before ? { before } : {}
  },
  async execute(rawInput, ctx) {
    const parsed = inventoryLotUpdateSchema.parse(rawInput ?? {})
    const em = resolveEm(ctx)
    const lot = await loadLot(em, ctx, parsed.id)
    const nextVariantId = parsed.catalogVariantId ?? lot.catalogVariantId
    const nextLotNumber = parsed.lotNumber ?? lot.lotNumber
    if (
      parsed.catalogVariantId !== undefined ||
      parsed.lotNumber !== undefined
    ) {
      await ensureLotUniqueness(
        em,
        {
          tenantId: lot.tenantId,
          organizationId: lot.organizationId,
          catalogVariantId: nextVariantId,
          lotNumber: nextLotNumber,
        },
        lot.id,
      )
    }
    if (parsed.catalogVariantId !== undefined) lot.catalogVariantId = parsed.catalogVariantId
    if (parsed.sku !== undefined) lot.sku = parsed.sku
    if (parsed.lotNumber !== undefined) lot.lotNumber = parsed.lotNumber
    if (parsed.batchNumber !== undefined) lot.batchNumber = normalizeOptionalString(parsed.batchNumber)
    if (parsed.manufacturedAt !== undefined) lot.manufacturedAt = parsed.manufacturedAt ?? null
    if (parsed.bestBeforeAt !== undefined) lot.bestBeforeAt = parsed.bestBeforeAt ?? null
    if (parsed.expiresAt !== undefined) lot.expiresAt = parsed.expiresAt ?? null
    if (parsed.status !== undefined) lot.status = parsed.status
    if (parsed.metadata !== undefined) lot.metadata = toJsonValue(parsed.metadata)
    await em.flush()
    return { lotId: lot.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = resolveEm(ctx)
    return loadInventoryLotSnapshot(em, ctx, result.lotId)
  },
  buildLog: async ({ input, result, ctx, snapshots }) => {
    const base = await buildCrudLog(ctx, input, result?.lotId ?? null, 'wms.audit.lot.update', 'Update inventory lot', 'wms.inventoryLot')
    const before = snapshots?.before as InventoryLotSnapshot | undefined
    const after = snapshots?.after as InventoryLotSnapshot | undefined
    return { ...base, snapshotBefore: before, snapshotAfter: after, payload: { undo: { before, after } satisfies InventoryLotUndoPayload } }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<InventoryLotUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = resolveEm(ctx)
    let record = await em.findOne(InventoryLot, { id: before.id })
    if (!record) {
      record = em.create(InventoryLot, {
        id: before.id,
        organizationId: before.organizationId,
        tenantId: before.tenantId,
        catalogVariantId: before.catalogVariantId,
        sku: before.sku,
        lotNumber: before.lotNumber,
        batchNumber: before.batchNumber,
        manufacturedAt: dateOrNull(before.manufacturedAt),
        bestBeforeAt: dateOrNull(before.bestBeforeAt),
        expiresAt: dateOrNull(before.expiresAt),
        status: before.status,
        metadata: before.metadata,
      })
      em.persist(record)
    } else {
      ensureTenantScope(ctx, before.tenantId)
      ensureOrganizationScope(ctx, before.organizationId)
      restoreInventoryLotFromSnapshot(em, before, record)
    }
    await em.flush()
  },
}

const deleteInventoryLotCommand: CommandHandler<{ id?: string }, { lotId: string }> = {
  id: 'wms.lots.delete',
  prepare: async (input, ctx) => {
    const id = requireId(input?.id, 'Inventory lot')
    const em = resolveEm(ctx)
    const before = await loadInventoryLotSnapshot(em, ctx, id)
    return before ? { before } : {}
  },
  async execute(input, ctx) {
    const lotId = requireId(input?.id, 'Inventory lot')
    const em = resolveEm(ctx)
    const lot = await loadLot(em, ctx, lotId)
    lot.deletedAt = new Date()
    await em.flush()
    return { lotId: lot.id }
  },
  buildLog: async ({ input, result, ctx, snapshots }) => {
    const base = await buildCrudLog(ctx, input, result?.lotId ?? null, 'wms.audit.lot.delete', 'Delete inventory lot', 'wms.inventoryLot')
    const before = snapshots?.before as InventoryLotSnapshot | undefined
    return { ...base, snapshotBefore: before, payload: { undo: { before } satisfies InventoryLotUndoPayload } }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<InventoryLotUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = resolveEm(ctx)
    let record = await em.findOne(InventoryLot, { id: before.id })
    if (!record) {
      record = em.create(InventoryLot, {
        id: before.id,
        organizationId: before.organizationId,
        tenantId: before.tenantId,
        catalogVariantId: before.catalogVariantId,
        sku: before.sku,
        lotNumber: before.lotNumber,
        batchNumber: before.batchNumber,
        manufacturedAt: dateOrNull(before.manufacturedAt),
        bestBeforeAt: dateOrNull(before.bestBeforeAt),
        expiresAt: dateOrNull(before.expiresAt),
        status: before.status,
        metadata: before.metadata,
      })
      em.persist(record)
    } else {
      ensureTenantScope(ctx, before.tenantId)
      ensureOrganizationScope(ctx, before.organizationId)
      restoreInventoryLotFromSnapshot(em, before, record)
    }
    await em.flush()
  },
}

registerCommand(createWarehouseCommand)
registerCommand(updateWarehouseCommand)
registerCommand(deleteWarehouseCommand)
registerCommand(createWarehouseZoneCommand)
registerCommand(updateWarehouseZoneCommand)
registerCommand(deleteWarehouseZoneCommand)
registerCommand(createWarehouseLocationCommand)
registerCommand(updateWarehouseLocationCommand)
registerCommand(deleteWarehouseLocationCommand)
registerCommand(createProductInventoryProfileCommand)
registerCommand(updateProductInventoryProfileCommand)
registerCommand(deleteProductInventoryProfileCommand)
registerCommand(createInventoryLotCommand)
registerCommand(updateInventoryLotCommand)
registerCommand(deleteInventoryLotCommand)
