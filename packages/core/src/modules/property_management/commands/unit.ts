import { randomUUID } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { extractUndoPayload } from '@open-mercato/shared/lib/commands/undo'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { Unit, UnitProductPeriod } from '../data/entities'
import {
  unitCreateSchema,
  unitProductChangeSchema,
  unitUpdateSchema,
  type UnitCreateInput,
  type UnitProductChangeInput,
  type UnitUpdateInput,
} from '../data/validators'
import { checkPlacement, toRect } from '../lib/geometry'
import { resolvePriceSnapshot, resolveUnitProduct, type PriceSnapshot, type ResolvedUnitProduct, type Scope } from '../lib/productUse'
import { findActiveLeases, findUnitBlockers, findUpcomingBookings } from '../lib/usageGuards'
import { emitPropertyManagementEvent } from '../events'
import {
  assertCtxBuildingAccess,
  buildCrudLog,
  conflict,
  emitSideEffects,
  ensureScope,
  isoOrNull,
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
  unitCrudEvents,
  unitCrudIndexer,
  unprocessable,
} from './shared'

export const UNIT_RESOURCE_KIND = 'property_management.unit'

export type UnitSnapshot = {
  id: string
  tenantId: string
  organizationId: string
  buildingId: string
  floorId: string
  spaceId: string
  name: string
  catalogCategoryId: string
  catalogProductId: string
  x: string
  y: string
  width: string
  depth: string
}

type ProductPeriodChange = { closedPeriodId: string | null; openedPeriodId: string }

type UnitUndoPayload = {
  before?: UnitSnapshot | null
  after?: UnitSnapshot | null
  productChange?: ProductPeriodChange | null
}

function snapshotUnit(unit: Unit): UnitSnapshot {
  return {
    id: unit.id,
    tenantId: unit.tenantId,
    organizationId: unit.organizationId,
    buildingId: unit.buildingId,
    floorId: unit.floorId,
    spaceId: unit.spaceId,
    name: unit.name,
    catalogCategoryId: unit.catalogCategoryId,
    catalogProductId: unit.catalogProductId,
    x: unit.x,
    y: unit.y,
    width: unit.width,
    depth: unit.depth,
  }
}

async function loadUnitSnapshot(ctx: CommandRuntimeContext, id: string): Promise<UnitSnapshot | null> {
  const em = resolveEm(ctx)
  const unit = await findOneWithDecryption(em, Unit, { id }, undefined, {
    tenantId: ctx.auth?.tenantId ?? null,
    organizationId: ctx.selectedOrganizationId ?? null,
  })
  return unit ? snapshotUnit(unit) : null
}

async function loadUnit(em: EntityManager, ctx: CommandRuntimeContext, scope: Scope, id: string): Promise<Unit> {
  const unit = await findOneWithDecryption(em, Unit, { id, ...scope, deletedAt: null }, undefined, scope)
  if (!unit) return notFound('property_management.errors.unitNotFound', 'Unit not found.')
  await assertCtxBuildingAccess(ctx, scope, unit.buildingId)
  return unit
}

async function assertBuildingWritable(em: EntityManager, scope: Scope, buildingId: string): Promise<void> {
  const building = await lockBuilding(em, scope, buildingId)
  if (building.status === 'archived') {
    await conflict('property_management.errors.buildingArchived', 'An archived building cannot be changed.')
  }
}

export async function assertProductChangeAllowed(em: EntityManager, scope: Scope, unitId: string, next: ResolvedUnitProduct): Promise<void> {
  const leases = await findActiveLeases(em, scope, [unitId])
  if (leases.length) {
    await conflict('property_management.errors.unitProductLocked', 'The product is locked while the unit has an active lease.', {
      code: 'unit_product_locked',
      blockers: leases,
    })
  }
  if (next.use === 'leasable') {
    const bookings = await findUpcomingBookings(em, scope, [unitId])
    if (bookings.length) {
      await conflict('property_management.errors.unitHasUpcomingBookings', 'The unit has upcoming bookings, so it cannot become leasable.', {
        code: 'unit_has_upcoming_bookings',
        blockers: bookings,
      })
    }
  }
}

function openPeriod(
  em: EntityManager,
  scope: Scope,
  unitId: string,
  product: ResolvedUnitProduct,
  price: PriceSnapshot,
  validFrom: Date,
): UnitProductPeriod {
  const period = em.create(UnitProductPeriod, {
    id: randomUUID(),
    ...scope,
    unitId,
    catalogProductId: product.catalogProductId,
    productName: product.productName,
    use: product.use,
    billingUnit: product.billingUnit,
    priceAmount: price.priceAmount,
    currencyCode: price.currencyCode,
    priceKindId: price.priceKindId,
    validFrom,
    validTo: null,
  })
  em.persist(period)
  return period
}

export async function switchProductPeriod(
  em: EntityManager,
  scope: Scope,
  unitId: string,
  product: ResolvedUnitProduct,
  price: PriceSnapshot,
): Promise<ProductPeriodChange> {
  const current = await findOneWithDecryption(em, UnitProductPeriod, { ...scope, unitId, validTo: null }, undefined, scope)
  const now = new Date()
  if (current) {
    current.validTo = now
    await em.flush()
  }
  const period = openPeriod(em, scope, unitId, product, price, now)
  await em.flush()
  return { closedPeriodId: current?.id ?? null, openedPeriodId: period.id }
}

async function revertProductPeriod(em: EntityManager, scope: Scope, change: ProductPeriodChange): Promise<void> {
  const opened = await findOneWithDecryption(em, UnitProductPeriod, { ...scope, id: change.openedPeriodId }, undefined, scope)
  const closed = change.closedPeriodId
    ? await findOneWithDecryption(em, UnitProductPeriod, { ...scope, id: change.closedPeriodId }, undefined, scope)
    : null
  if (opened && !opened.validTo) {
    opened.validTo = new Date()
    await em.flush()
  }
  if (closed) {
    closed.validTo = null
    await em.flush()
  }
}

function emitProductChanged(unit: Unit, change: ProductPeriodChange): void {
  void emitPropertyManagementEvent('property_management.unit.product_changed', {
    id: unit.id,
    unitId: unit.id,
    catalogProductId: unit.catalogProductId,
    periodId: change.openedPeriodId,
    tenantId: unit.tenantId,
    organizationId: unit.organizationId,
  }, { persistent: true }).catch(() => undefined)
}

function rectOf(input: { x: number; y: number; width: number; depth: number }) {
  return { x: input.x, y: input.y, width: input.width, depth: input.depth }
}

const createUnitCommand: CommandHandler<UnitCreateInput, { unitId: string }> = {
  id: 'property_management.unit.create',
  async execute(rawInput, ctx) {
    const parsed = unitCreateSchema.parse(rawInput ?? {})
    const scope = { tenantId: parsed.tenantId, organizationId: parsed.organizationId }
    ensureScope(ctx, scope)
    const em = resolveEm(ctx)
    const current = await loadFloor(em, ctx, scope, parsed.floorId)
    const product = await resolveUnitProduct(em, scope, parsed)
    const price = await resolvePriceSnapshot(em, ctx.container, scope, product.catalogProductId)
    const unit = await em.fork().transactional(async (trx) => {
      await assertBuildingWritable(trx, scope, current.buildingId)
      const floor = await lockFloor(trx, scope, parsed.floorId)
      const geometry = await loadFloorGeometry(trx, scope, floor)
      if (!geometry.spaceRecords.some((space) => space.id === parsed.spaceId)) {
        await unprocessable('property_management.errors.spaceNotOnFloor', 'The space is not on this floor.', {
          fieldErrors: { spaceId: 'property_management.errors.spaceNotOnFloor' },
        })
      }
      const rect = rectOf(parsed)
      const issues = checkPlacement({ kind: 'unit', rect, spaceId: parsed.spaceId }, geometry)
      if (issues.length) await throwPlacementIssues(issues)
      const record = trx.create(Unit, {
        id: randomUUID(),
        ...scope,
        buildingId: floor.buildingId,
        floorId: floor.id,
        spaceId: parsed.spaceId,
        name: parsed.name,
        catalogCategoryId: product.catalogCategoryId,
        catalogProductId: product.catalogProductId,
        x: metres(rect.x),
        y: metres(rect.y),
        width: metres(rect.width),
        depth: metres(rect.depth),
      })
      trx.persist(record)
      await trx.flush()
      openPeriod(trx, scope, record.id, product, price, new Date())
      return record
    })
    await emitSideEffects(ctx, 'created', unit, { indexer: unitCrudIndexer, events: unitCrudEvents })
    return { unitId: unit.id }
  },
  captureAfter: async (_input, result, ctx) => loadUnitSnapshot(ctx, result.unitId),
  buildLog: async ({ input, result, ctx, snapshots }) => {
    const base = await buildCrudLog(ctx, input, result?.unitId ?? null, 'property_management.audit.unit.create', 'Create unit', UNIT_RESOURCE_KIND)
    const after = snapshots?.after as UnitSnapshot | undefined
    return { ...base, snapshotAfter: after, payload: { undo: { after } satisfies UnitUndoPayload } }
  },
  undo: async ({ logEntry, ctx }) => {
    const after = extractUndoPayload<UnitUndoPayload>(logEntry)?.after
    if (!after) return
    const scope = scopeOf(after)
    ensureScope(ctx, scope)
    const em = resolveEm(ctx)
    const blockers = await findUnitBlockers(em, scope, [after.id])
    if (blockers.length) {
      await conflict('property_management.errors.unitInUse', 'A unit with a lease or bookings cannot be deleted.', { code: 'unit_in_use', blockers })
    }
    const unit = await findOneWithDecryption(em, Unit, { id: after.id, ...scope }, undefined, scope)
    if (!unit) return
    unit.deletedAt = new Date()
    await em.flush()
    await emitSideEffects(ctx, 'deleted', unit, { indexer: unitCrudIndexer, events: unitCrudEvents }, 'undo')
  },
}

const updateUnitCommand: CommandHandler<UnitUpdateInput, { unitId: string; productChange: ProductPeriodChange | null }> = {
  id: 'property_management.unit.update',
  prepare: async (input, ctx) => {
    const before = await loadUnitSnapshot(ctx, requireId(input?.id))
    return before ? { before } : {}
  },
  async execute(rawInput, ctx) {
    const parsed = unitUpdateSchema.parse(rawInput ?? {})
    const scope = { tenantId: parsed.tenantId, organizationId: parsed.organizationId }
    ensureScope(ctx, scope)
    const em = resolveEm(ctx)
    const current = await loadUnit(em, ctx, scope, parsed.id)
    const nextCategoryId = parsed.catalogCategoryId ?? current.catalogCategoryId
    const nextProductId = parsed.catalogProductId ?? current.catalogProductId
    const productChanged = nextProductId !== current.catalogProductId || nextCategoryId !== current.catalogCategoryId
    const product = productChanged
      ? await resolveUnitProduct(em, scope, { catalogCategoryId: nextCategoryId, catalogProductId: nextProductId })
      : null
    const price = product && nextProductId !== current.catalogProductId
      ? await resolvePriceSnapshot(em, ctx.container, scope, product.catalogProductId)
      : null
    const outcome = await em.fork().transactional(async (trx) => {
      await assertBuildingWritable(trx, scope, current.buildingId)
      const floor = await lockFloor(trx, scope, current.floorId)
      const geometry = await loadFloorGeometry(trx, scope, floor)
      const record = geometry.unitRecords.find((item) => item.id === current.id)
      if (!record) return notFound('property_management.errors.unitNotFound', 'Unit not found.')
      const spaceId = parsed.spaceId ?? record.spaceId
      if (!geometry.spaceRecords.some((space) => space.id === spaceId)) {
        await unprocessable('property_management.errors.spaceNotOnFloor', 'The space is not on this floor.', {
          fieldErrors: { spaceId: 'property_management.errors.spaceNotOnFloor' },
        })
      }
      if (product && nextProductId !== record.catalogProductId) {
        await assertProductChangeAllowed(trx, scope, record.id, product)
      }
      const existing = toRect(record)
      const rect = {
        x: parsed.x ?? existing.x,
        y: parsed.y ?? existing.y,
        width: parsed.width ?? existing.width,
        depth: parsed.depth ?? existing.depth,
      }
      const issues = checkPlacement({ kind: 'unit', rect, selfId: record.id, spaceId }, geometry)
      if (issues.length) await throwPlacementIssues(issues)
      let productChange: ProductPeriodChange | null = null
      if (product && price && nextProductId !== record.catalogProductId) {
        productChange = await switchProductPeriod(trx, scope, record.id, product, price)
      }
      if (parsed.name !== undefined) record.name = parsed.name
      record.spaceId = spaceId
      record.x = metres(rect.x)
      record.y = metres(rect.y)
      record.width = metres(rect.width)
      record.depth = metres(rect.depth)
      if (product) {
        record.catalogCategoryId = product.catalogCategoryId
        record.catalogProductId = product.catalogProductId
      }
      record.updatedAt = new Date()
      return { unit: record, productChange }
    })
    await emitSideEffects(ctx, 'updated', outcome.unit, { indexer: unitCrudIndexer, events: unitCrudEvents })
    if (outcome.productChange) emitProductChanged(outcome.unit, outcome.productChange)
    return { unitId: outcome.unit.id, productChange: outcome.productChange }
  },
  captureAfter: async (_input, result, ctx) => loadUnitSnapshot(ctx, result.unitId),
  buildLog: async ({ input, result, ctx, snapshots }) => {
    const base = await buildCrudLog(ctx, input, result?.unitId ?? null, 'property_management.audit.unit.update', 'Update unit', UNIT_RESOURCE_KIND)
    const before = snapshots?.before as UnitSnapshot | undefined
    const after = snapshots?.after as UnitSnapshot | undefined
    return {
      ...base,
      snapshotBefore: before,
      snapshotAfter: after,
      payload: { undo: { before, after, productChange: result?.productChange ?? null } satisfies UnitUndoPayload },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<UnitUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const scope = scopeOf(before)
    ensureScope(ctx, scope)
    const em = resolveEm(ctx)
    const unit = await em.fork().transactional(async (trx) => {
      const floor = await lockFloor(trx, scope, before.floorId)
      const geometry = await loadFloorGeometry(trx, scope, floor)
      const issues = checkPlacement({ kind: 'unit', rect: toRect(before), selfId: before.id, spaceId: before.spaceId }, geometry)
      if (issues.length) await throwPlacementIssues(issues)
      if (payload?.productChange) await revertProductPeriod(trx, scope, payload.productChange)
      const record = await findOneWithDecryption(trx, Unit, { id: before.id, ...scope }, undefined, scope)
      if (!record) return null
      record.name = before.name
      record.spaceId = before.spaceId
      record.catalogCategoryId = before.catalogCategoryId
      record.catalogProductId = before.catalogProductId
      record.x = before.x
      record.y = before.y
      record.width = before.width
      record.depth = before.depth
      return record
    })
    if (unit) await emitSideEffects(ctx, 'updated', unit, { indexer: unitCrudIndexer, events: unitCrudEvents }, 'undo')
  },
}

const productChangeCommand: CommandHandler<UnitProductChangeInput, { unitId: string; productChange: ProductPeriodChange }> = {
  id: 'property_management.unit.product_change',
  prepare: async (input, ctx) => {
    const before = await loadUnitSnapshot(ctx, requireId(input?.id))
    return before ? { before } : {}
  },
  async execute(rawInput, ctx) {
    const parsed = unitProductChangeSchema.parse(rawInput ?? {})
    const scope = { tenantId: parsed.tenantId, organizationId: parsed.organizationId }
    ensureScope(ctx, scope)
    const em = resolveEm(ctx)
    const current = await loadUnit(em, ctx, scope, parsed.id)
    const product = await resolveUnitProduct(em, scope, {
      catalogCategoryId: parsed.catalogCategoryId ?? current.catalogCategoryId,
      catalogProductId: parsed.catalogProductId,
    })
    const price = await resolvePriceSnapshot(em, ctx.container, scope, product.catalogProductId)
    const outcome = await em.fork().transactional(async (trx) => {
      await lockFloor(trx, scope, current.floorId)
      const record = await findOneWithDecryption(trx, Unit, { id: current.id, ...scope, deletedAt: null }, undefined, scope)
      if (!record) return notFound('property_management.errors.unitNotFound', 'Unit not found.')
      await assertProductChangeAllowed(trx, scope, record.id, product)
      const productChange = await switchProductPeriod(trx, scope, record.id, product, price)
      record.catalogCategoryId = product.catalogCategoryId
      record.catalogProductId = product.catalogProductId
      record.updatedAt = new Date()
      return { unit: record, productChange }
    })
    await emitSideEffects(ctx, 'updated', outcome.unit, { indexer: unitCrudIndexer, events: unitCrudEvents })
    emitProductChanged(outcome.unit, outcome.productChange)
    return { unitId: outcome.unit.id, productChange: outcome.productChange }
  },
  captureAfter: async (_input, result, ctx) => loadUnitSnapshot(ctx, result.unitId),
  buildLog: async ({ input, result, ctx, snapshots }) => {
    const base = await buildCrudLog(ctx, input, result?.unitId ?? null, 'property_management.audit.unit.productChange', 'Change unit product', UNIT_RESOURCE_KIND)
    const before = snapshots?.before as UnitSnapshot | undefined
    const after = snapshots?.after as UnitSnapshot | undefined
    return {
      ...base,
      snapshotBefore: before,
      snapshotAfter: after,
      payload: { undo: { before, after, productChange: result?.productChange ?? null } satisfies UnitUndoPayload },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<UnitUndoPayload>(logEntry)
    const before = payload?.before
    if (!before || !payload?.productChange) return
    const scope = scopeOf(before)
    ensureScope(ctx, scope)
    const em = resolveEm(ctx)
    const change = payload.productChange
    const unit = await em.fork().transactional(async (trx) => {
      await lockFloor(trx, scope, before.floorId)
      const leases = await findActiveLeases(trx, scope, [before.id])
      if (leases.length) {
        await conflict('property_management.errors.unitProductLocked', 'The product is locked while the unit has an active lease.', {
          code: 'unit_product_locked',
          blockers: leases,
        })
      }
      await revertProductPeriod(trx, scope, change)
      const record = await findOneWithDecryption(trx, Unit, { id: before.id, ...scope }, undefined, scope)
      if (!record) return null
      record.catalogCategoryId = before.catalogCategoryId
      record.catalogProductId = before.catalogProductId
      return record
    })
    if (unit) await emitSideEffects(ctx, 'updated', unit, { indexer: unitCrudIndexer, events: unitCrudEvents }, 'undo')
  },
}

const deleteUnitCommand: CommandHandler<{ id?: string; tenantId?: string; organizationId?: string }, { unitId: string }> = {
  id: 'property_management.unit.delete',
  prepare: async (input, ctx) => {
    const before = await loadUnitSnapshot(ctx, requireId(input?.id))
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
    const current = await loadUnit(em, ctx, scope, id)
    const unit = await em.fork().transactional(async (trx) => {
      await assertBuildingWritable(trx, scope, current.buildingId)
      await lockFloor(trx, scope, current.floorId)
      const blockers = await findUnitBlockers(trx, scope, [current.id])
      if (blockers.length) {
        await conflict('property_management.errors.unitInUse', 'A unit with a lease or bookings cannot be deleted.', { code: 'unit_in_use', blockers })
      }
      const record = await findOneWithDecryption(trx, Unit, { id: current.id, ...scope, deletedAt: null }, undefined, scope)
      if (!record) return notFound('property_management.errors.unitNotFound', 'Unit not found.')
      record.deletedAt = new Date()
      return record
    })
    await emitSideEffects(ctx, 'deleted', unit, { indexer: unitCrudIndexer, events: unitCrudEvents })
    return { unitId: unit.id }
  },
  buildLog: async ({ input, result, ctx, snapshots }) => {
    const base = await buildCrudLog(ctx, input, result?.unitId ?? null, 'property_management.audit.unit.delete', 'Delete unit', UNIT_RESOURCE_KIND)
    const before = snapshots?.before as UnitSnapshot | undefined
    return { ...base, snapshotBefore: before, payload: { undo: { before } satisfies UnitUndoPayload } }
  },
  undo: async ({ logEntry, ctx }) => {
    const before = extractUndoPayload<UnitUndoPayload>(logEntry)?.before
    if (!before) return
    const scope = scopeOf(before)
    ensureScope(ctx, scope)
    const em = resolveEm(ctx)
    const unit = await em.fork().transactional(async (trx) => {
      const floor = await lockFloor(trx, scope, before.floorId)
      const geometry = await loadFloorGeometry(trx, scope, floor)
      const issues = checkPlacement({ kind: 'unit', rect: toRect(before), selfId: before.id, spaceId: before.spaceId }, geometry)
      if (issues.length) await throwPlacementIssues(issues)
      const record = await findOneWithDecryption(trx, Unit, { id: before.id, ...scope }, undefined, scope)
      if (record) record.deletedAt = null
      return record
    })
    if (unit) await emitSideEffects(ctx, 'created', unit, { indexer: unitCrudIndexer, events: unitCrudEvents }, 'undo')
  },
}

export function serializeProductPeriod(period: UnitProductPeriod) {
  return {
    id: period.id,
    unitId: period.unitId,
    catalogProductId: period.catalogProductId,
    productName: period.productName,
    use: period.use,
    billingUnit: period.billingUnit,
    priceAmount: period.priceAmount ?? null,
    currencyCode: period.currencyCode ?? null,
    priceKindId: period.priceKindId ?? null,
    validFrom: isoOrNull(period.validFrom),
    validTo: isoOrNull(period.validTo),
  }
}

registerCommand(createUnitCommand)
registerCommand(updateUnitCommand)
registerCommand(productChangeCommand)
registerCommand(deleteUnitCommand)
