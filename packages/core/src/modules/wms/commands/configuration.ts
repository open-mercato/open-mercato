import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { JsonValue } from '@open-mercato/shared/lib/json'
import {
  InventoryLot,
  ProductInventoryProfile,
  Warehouse,
  WarehouseLocation,
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
  buildLog: async ({ input, result, ctx }) =>
    buildCrudLog(ctx, input, result?.warehouseId ?? null, 'wms.audit.warehouse.create', 'Create warehouse', 'wms.warehouse'),
}

const updateWarehouseCommand: CommandHandler<WarehouseUpdateInput, { warehouseId: string }> = {
  id: 'wms.warehouses.update',
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
  buildLog: async ({ input, result, ctx }) =>
    buildCrudLog(ctx, input, result?.warehouseId ?? null, 'wms.audit.warehouse.update', 'Update warehouse', 'wms.warehouse'),
}

const deleteWarehouseCommand: CommandHandler<{ id?: string }, { warehouseId: string }> = {
  id: 'wms.warehouses.delete',
  async execute(input, ctx) {
    const warehouseId = requireId(input?.id, 'Warehouse')
    const em = resolveEm(ctx)
    const warehouse = await loadWarehouse(em, ctx, warehouseId)
    warehouse.deletedAt = new Date()
    await em.flush()
    return { warehouseId: warehouse.id }
  },
  buildLog: async ({ input, result, ctx }) =>
    buildCrudLog(ctx, input, result?.warehouseId ?? null, 'wms.audit.warehouse.delete', 'Delete warehouse', 'wms.warehouse'),
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
  buildLog: async ({ input, result, ctx }) =>
    buildCrudLog(ctx, input, result?.zoneId ?? null, 'wms.audit.zone.create', 'Create warehouse zone', 'wms.zone'),
}

const updateWarehouseZoneCommand: CommandHandler<WarehouseZoneUpdateInput, { zoneId: string }> = {
  id: 'wms.zones.update',
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
  buildLog: async ({ input, result, ctx }) =>
    buildCrudLog(ctx, input, result?.zoneId ?? null, 'wms.audit.zone.update', 'Update warehouse zone', 'wms.zone'),
}

const deleteWarehouseZoneCommand: CommandHandler<{ id?: string }, { zoneId: string }> = {
  id: 'wms.zones.delete',
  async execute(input, ctx) {
    const zoneId = requireId(input?.id, 'Zone')
    const em = resolveEm(ctx)
    const zone = await loadZone(em, ctx, zoneId)
    zone.deletedAt = new Date()
    await em.flush()
    return { zoneId: zone.id }
  },
  buildLog: async ({ input, result, ctx }) =>
    buildCrudLog(ctx, input, result?.zoneId ?? null, 'wms.audit.zone.delete', 'Delete warehouse zone', 'wms.zone'),
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
  buildLog: async ({ input, result, ctx }) =>
    buildCrudLog(ctx, input, result?.locationId ?? null, 'wms.audit.location.create', 'Create warehouse location', 'wms.location'),
}

const updateWarehouseLocationCommand: CommandHandler<WarehouseLocationUpdateInput, { locationId: string }> = {
  id: 'wms.locations.update',
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
  buildLog: async ({ input, result, ctx }) =>
    buildCrudLog(ctx, input, result?.locationId ?? null, 'wms.audit.location.update', 'Update warehouse location', 'wms.location'),
}

const deleteWarehouseLocationCommand: CommandHandler<{ id?: string }, { locationId: string }> = {
  id: 'wms.locations.delete',
  async execute(input, ctx) {
    const locationId = requireId(input?.id, 'Location')
    const em = resolveEm(ctx)
    const location = await loadLocation(em, ctx, locationId)
    location.deletedAt = new Date()
    await em.flush()
    return { locationId: location.id }
  },
  buildLog: async ({ input, result, ctx }) =>
    buildCrudLog(ctx, input, result?.locationId ?? null, 'wms.audit.location.delete', 'Delete warehouse location', 'wms.location'),
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
  buildLog: async ({ input, result, ctx }) =>
    buildCrudLog(ctx, input, result?.profileId ?? null, 'wms.audit.inventoryProfile.create', 'Create inventory profile', 'wms.inventoryProfile'),
}

const updateProductInventoryProfileCommand: CommandHandler<ProductInventoryProfileUpdateInput, { profileId: string }> = {
  id: 'wms.inventoryProfiles.update',
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
  buildLog: async ({ input, result, ctx }) =>
    buildCrudLog(ctx, input, result?.profileId ?? null, 'wms.audit.inventoryProfile.update', 'Update inventory profile', 'wms.inventoryProfile'),
}

const deleteProductInventoryProfileCommand: CommandHandler<{ id?: string }, { profileId: string }> = {
  id: 'wms.inventoryProfiles.delete',
  async execute(input, ctx) {
    const profileId = requireId(input?.id, 'Inventory profile')
    const em = resolveEm(ctx)
    const profile = await loadProfile(em, ctx, profileId)
    profile.deletedAt = new Date()
    await em.flush()
    return { profileId: profile.id }
  },
  buildLog: async ({ input, result, ctx }) =>
    buildCrudLog(ctx, input, result?.profileId ?? null, 'wms.audit.inventoryProfile.delete', 'Delete inventory profile', 'wms.inventoryProfile'),
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
  buildLog: async ({ input, result, ctx }) =>
    buildCrudLog(ctx, input, result?.lotId ?? null, 'wms.audit.lot.create', 'Create inventory lot', 'wms.inventoryLot'),
}

const updateInventoryLotCommand: CommandHandler<InventoryLotUpdateInput, { lotId: string }> = {
  id: 'wms.lots.update',
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
  buildLog: async ({ input, result, ctx }) =>
    buildCrudLog(ctx, input, result?.lotId ?? null, 'wms.audit.lot.update', 'Update inventory lot', 'wms.inventoryLot'),
}

const deleteInventoryLotCommand: CommandHandler<{ id?: string }, { lotId: string }> = {
  id: 'wms.lots.delete',
  async execute(input, ctx) {
    const lotId = requireId(input?.id, 'Inventory lot')
    const em = resolveEm(ctx)
    const lot = await loadLot(em, ctx, lotId)
    lot.deletedAt = new Date()
    await em.flush()
    return { lotId: lot.id }
  },
  buildLog: async ({ input, result, ctx }) =>
    buildCrudLog(ctx, input, result?.lotId ?? null, 'wms.audit.lot.delete', 'Delete inventory lot', 'wms.inventoryLot'),
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
