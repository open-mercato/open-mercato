import { randomUUID } from 'node:crypto'
import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { extractUndoPayload } from '@open-mercato/shared/lib/commands/undo'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { enforceCommandOptimisticLockWithGuards } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { E } from '#generated/entities.ids.generated'
import { Booking, Unit, UnitProductPeriod } from '../data/entities'
import {
  unitCreateSchema,
  unitProductChangeSchema,
  unitUpdateSchema,
  type UnitCreateInput,
  type UnitProductChangeInput,
  type UnitUpdateInput,
} from '../data/validators'
import { checkPlacement, toRect } from '../lib/geometry'
import {
  lockProductUse,
  resolvePriceSnapshot,
  resolveUnitProduct,
  type PriceContext,
  type PriceSnapshot,
  type ResolvedUnitProduct,
  type Scope,
} from '../lib/productUse'
import {
  findActiveLeases,
  findUnitBlockerList,
  findUpcomingBookingList,
  HOLDING_BOOKING_STATUSES,
  USAGE_BLOCKER_LIST_LIMIT,
  usageBlockerConflictBody,
  usageBlockerListOf,
} from '../lib/usageGuards'
import { loadUnavailabilities, mergeWindows } from '../lib/availabilityResolver'
import { conflictError } from '../lib/errors'
import { lockUnitRow } from '../lib/leaseRecords'
import { loadSettings } from '../lib/settings'
import { localNow, normalizeWallClock, toStoredWallClock } from '../lib/wallClock'
import { emitPropertyManagementEvent } from '../events'
import {
  assertCtxBuildingAccess,
  buildCrudLog,
  conflict,
  emitSideEffects,
  enforceRecordVersion,
  ensureScope,
  isoOrNull,
  loadCustomFields,
  loadFloor,
  loadFloorGeometry,
  lockBuilding,
  lockFloor,
  metres,
  notFound,
  persistentEventOptions,
  requireId,
  resolveEm,
  restoreCustomFields,
  restoredProductUnavailable,
  scopeOf,
  throwPlacementIssues,
  unitCrudEvents,
  unitCrudIndexer,
  unprocessable,
  writeCustomFields,
  type CustomFieldValues,
} from './shared'

export const UNIT_RESOURCE_KIND = 'property_management.unit'

const logger = createLogger('property_management')

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
  custom?: CustomFieldValues
}

const UNIT_ENTITY_ID = E.property_management.unit

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

type ScopeInput = { tenantId?: string | null; organizationId?: string | null } | null | undefined

async function loadUnitSnapshot(ctx: CommandRuntimeContext, id: string, input?: ScopeInput): Promise<UnitSnapshot | null> {
  const em = resolveEm(ctx)
  const scope = {
    tenantId: input?.tenantId ?? ctx.auth?.tenantId ?? null,
    organizationId: input?.organizationId ?? ctx.selectedOrganizationId ?? null,
  }
  const unit = await findOneWithDecryption(em, Unit, { id, ...scope }, undefined, scope)
  return unit ? { ...snapshotUnit(unit), custom: await loadCustomFields(em, UNIT_ENTITY_ID, unit) } : null
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

type UnitProductUse = Pick<ResolvedUnitProduct, 'use' | 'billingUnit'>

const NO_PRICE: PriceSnapshot = { priceAmount: null, currencyCode: null, priceKindId: null }

async function billingPriceContext(em: EntityManager, scope: Scope): Promise<PriceContext> {
  const settings = await loadSettings(em, scope)
  return { channelId: settings.billingChannelId }
}

type ConfirmedProduct = { product: ResolvedUnitProduct; price: PriceSnapshot }

function productUseMissing(): Promise<never> {
  return unprocessable('property_management.errors.productUseMissing', 'The product is not marked as leasable or bookable in the catalog.', {
    fieldErrors: { catalogProductId: 'property_management.errors.productUseMissing' },
  })
}

async function lockCurrentProductUse(
  em: EntityManager,
  scope: Scope,
  product: ResolvedUnitProduct,
  price: PriceSnapshot,
  onMissing: () => Promise<never>,
): Promise<ConfirmedProduct> {
  const current = await lockProductUse(em, scope, product.catalogProductId, 'share')
  if (!current) return onMissing()
  if (current.use === product.use && current.billingUnit === product.billingUnit) return { product, price }
  return { product: { ...product, use: current.use, billingUnit: current.billingUnit }, price: NO_PRICE }
}

export async function assertProductChangeAllowed(em: EntityManager, scope: Scope, unitId: string, next: UnitProductUse): Promise<void> {
  const leases = await findActiveLeases(em, scope, [unitId])
  if (leases.length) {
    await conflict('property_management.errors.unitProductLocked', 'The product is locked while the unit has an active lease.', {
      code: 'unit_product_locked',
      ...usageBlockerConflictBody(usageBlockerListOf(leases)),
    })
  }
  if (next.use === 'leasable') {
    const bookings = await findUpcomingBookingList(em, scope, [unitId])
    if (bookings.total) {
      await conflict('property_management.errors.unitHasUpcomingBookings', 'The unit has upcoming bookings, so it cannot become leasable.', {
        code: 'unit_has_upcoming_bookings',
        ...usageBlockerConflictBody(bookings),
      })
    }
    return
  }
  const current = await findOneWithDecryption(em, UnitProductPeriod, { ...scope, unitId, validTo: null }, { refresh: true }, scope)
  if (current?.use !== 'bookable' || current.billingUnit === next.billingUnit) return
  const bookings = await findUpcomingBookingList(em, scope, [unitId])
  if (bookings.total) {
    await conflict('property_management.errors.productBillingUnitStrands', 'Upcoming bookings use the current billing unit, so it cannot change until they are over.', {
      code: 'product_billing_unit_strands',
      ...usageBlockerConflictBody(bookings),
    })
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

function unitUndoStale(): Promise<never> {
  return conflict(
    'property_management.errors.unitUndoStale',
    'The product of this unit changed again since, so this change cannot be undone.',
    { code: 'unit_undo_stale' },
  )
}

async function loadOpenPeriod(em: EntityManager, scope: Scope, unitId: string): Promise<UnitProductPeriod | null> {
  return findOneWithDecryption(em, UnitProductPeriod, { ...scope, unitId, validTo: null }, { refresh: true }, scope)
}

function isCollapsed(period: UnitProductPeriod): boolean {
  if (!period.validTo) return false
  return new Date(period.validTo).getTime() === new Date(period.validFrom).getTime()
}

async function loadLatestClosedPeriod(em: EntityManager, scope: Scope, unitId: string): Promise<UnitProductPeriod | null> {
  const closed = await findWithDecryption(
    em,
    UnitProductPeriod,
    { ...scope, unitId, validTo: { $ne: null } },
    { orderBy: { validTo: 'desc' }, refresh: true },
    scope,
  )
  return closed.find((period) => !isCollapsed(period)) ?? null
}

async function revertProductPeriod(
  em: EntityManager,
  scope: Scope,
  unitId: string,
  change: ProductPeriodChange,
  restored: ResolvedUnitProduct,
): Promise<void> {
  const opened = await findOneWithDecryption(em, UnitProductPeriod, { ...scope, id: change.openedPeriodId }, { refresh: true }, scope)
  const current = await loadOpenPeriod(em, scope, unitId)
  if (current && (!opened || current.catalogProductId !== opened.catalogProductId)) return unitUndoStale()
  const closed = change.closedPeriodId
    ? await findOneWithDecryption(em, UnitProductPeriod, { ...scope, id: change.closedPeriodId }, { refresh: true }, scope)
    : null
  if (closed && closed.catalogProductId !== restored.catalogProductId) return unitUndoStale()
  const latest = change.closedPeriodId ? await loadLatestClosedPeriod(em, scope, unitId) : null
  const predecessor = latest
    && latest.id === change.closedPeriodId
    && latest.catalogProductId === restored.catalogProductId
    && latest.use === restored.use
    && latest.billingUnit === restored.billingUnit
    ? latest
    : null
  const now = new Date()
  if (current) {
    current.validTo = predecessor ? current.validFrom : now
    await em.flush()
  }
  if (predecessor) predecessor.validTo = null
  else openPeriod(em, scope, unitId, restored, NO_PRICE, now)
  await em.flush()
}

async function resolveRestoredProduct(em: EntityManager, scope: Scope, before: UnitSnapshot): Promise<ResolvedUnitProduct> {
  try {
    return await resolveUnitProduct(em, scope, { catalogCategoryId: before.catalogCategoryId, catalogProductId: before.catalogProductId })
  } catch (err) {
    if (err instanceof CrudHttpError && err.status === 422) return restoredProductUnavailable()
    throw err
  }
}

async function findLiveUnit(em: EntityManager, scope: Scope, unitId: string): Promise<Unit | null> {
  return findOneWithDecryption(em, Unit, { id: unitId, ...scope, deletedAt: null }, { refresh: true }, scope)
}

async function lockRestoredUnit(em: EntityManager, scope: Scope, unitId: string, restored: ResolvedUnitProduct): Promise<ResolvedUnitProduct> {
  const confirmed = await lockCurrentProductUse(em, scope, restored, NO_PRICE, restoredProductUnavailable)
  await lockUnitRow(em, scope, unitId)
  await assertProductChangeAllowed(em, scope, unitId, confirmed.product)
  return confirmed.product
}

function categoryOnlyChangeStillCurrent(record: Unit, before: UnitSnapshot, after: UnitSnapshot | null | undefined): boolean {
  if (!after || after.catalogProductId !== before.catalogProductId) return false
  return record.catalogProductId === after.catalogProductId && record.catalogCategoryId === after.catalogCategoryId
}

async function emitProductChanged(unit: Unit, change: ProductPeriodChange): Promise<void> {
  await emitPropertyManagementEvent('property_management.unit.product_changed', {
    id: unit.id,
    unitId: unit.id,
    catalogProductId: unit.catalogProductId,
    periodId: change.openedPeriodId,
    tenantId: unit.tenantId,
    organizationId: unit.organizationId,
  }, persistentEventOptions(scopeOf(unit))).catch((err: unknown) => {
    logger.error('Unit product change event failed', { unitId: unit.id, err })
    getTelemetryRuntime()?.reportError(err, { module: 'property_management', code: 'property_management.unit_product_changed_event_failed' })
  })
}

export async function assertMoveDestinationAvailable(
  em: EntityManager,
  scope: Scope,
  unit: Unit,
  destination: { floorId: string; spaceId: string },
): Promise<void> {
  const subjectIds = [
    ...(destination.spaceId !== unit.spaceId ? [destination.spaceId] : []),
    ...(destination.floorId !== unit.floorId ? [destination.floorId] : []),
  ]
  if (!subjectIds.length) return
  const now = localNow()
  const windows = await loadUnavailabilities(em, scope, subjectIds, { start: now, end: null }, { buildingIds: [unit.buildingId] })
  if (!windows.length) return
  const spans = mergeWindows(windows)
  const overlapsAnySpan = spans.some((span) => span.start === null && span.end === null)
    ? {}
    : {
        $or: spans.map((span) => ({
          ...(span.start !== null ? { endsAt: { $gt: toStoredWallClock(span.start) } } : {}),
          ...(span.end !== null ? { startsAt: { $lt: toStoredWallClock(span.end) } } : {}),
        })),
      }
  const where: FilterQuery<Booking> = {
    ...scope,
    unitId: unit.id,
    status: { $in: [...HOLDING_BOOKING_STATUSES] },
    endsAt: { $gt: toStoredWallClock(now) },
    deletedAt: null,
    ...overlapsAnySpan,
  }
  const affected = await findWithDecryption(
    em,
    Booking,
    where,
    { fields: ['id', 'productName', 'startsAt', 'endsAt'], orderBy: { startsAt: 'asc', id: 'asc' }, limit: USAGE_BLOCKER_LIST_LIMIT },
    scope,
  )
  if (!affected.length) return
  const bookingCount = affected.length < USAGE_BLOCKER_LIST_LIMIT ? affected.length : Math.max(await em.count(Booking, where), affected.length)
  const labels = affected.map((booking) => `${booking.productName} · ${normalizeWallClock(booking.startsAt)}`)
  throw await conflictError(
    'property_management.errors.unitMoveDestinationUnavailable',
    'The destination is unavailable while bookings of this unit fall in it: {bookings}. Cancel them or end the closure first.',
    {
      code: 'unit_move_destination_unavailable',
      bookings: affected.map((booking, index) => ({
        id: booking.id,
        label: labels[index],
        startsAt: normalizeWallClock(booking.startsAt),
        endsAt: normalizeWallClock(booking.endsAt),
      })),
      bookingCount,
      fieldErrors: { spaceId: 'property_management.errors.unitMoveDestinationUnavailableShort' },
    },
    { bookings: labels.join(', ') },
  )
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
    const price = await resolvePriceSnapshot(em, ctx.container, scope, product.catalogProductId, await billingPriceContext(em, scope))
    const unit = await em.fork().transactional(async (trx) => {
      await assertBuildingWritable(trx, scope, current.buildingId)
      const floor = await lockFloor(trx, scope, parsed.floorId)
      const confirmed = await lockCurrentProductUse(trx, scope, product, price, productUseMissing)
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
      openPeriod(trx, scope, record.id, confirmed.product, confirmed.price, new Date())
      await trx.flush()
      await writeCustomFields(trx, ctx, UNIT_ENTITY_ID, record, parsed.customFields)
      return record
    })
    await emitSideEffects(ctx, 'created', unit, { indexer: unitCrudIndexer, events: unitCrudEvents })
    return { unitId: unit.id }
  },
  captureAfter: async (input, result, ctx) => loadUnitSnapshot(ctx, result.unitId, input),
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
    await assertCtxBuildingAccess(ctx, scope, after.buildingId)
    const em = resolveEm(ctx)
    const unit = await em.fork().transactional(async (trx) => {
      await assertBuildingWritable(trx, scope, after.buildingId)
      await lockFloor(trx, scope, after.floorId)
      const record = await lockUnitRow(trx, scope, after.id, { includeDeleted: true })
      if (record.deletedAt) return null
      const blockers = await findUnitBlockerList(trx, scope, [record.id])
      if (blockers.total) {
        await conflict('property_management.errors.unitInUse', 'A unit with a lease or bookings cannot be deleted.', { code: 'unit_in_use', ...usageBlockerConflictBody(blockers) })
      }
      record.deletedAt = new Date()
      await trx.flush()
      return record
    })
    if (unit) await emitSideEffects(ctx, 'deleted', unit, { indexer: unitCrudIndexer, events: unitCrudEvents }, 'undo')
  },
}

type RequestedProductChange = { catalogCategoryId?: string; catalogProductId?: string }

function requestedProductChange(input: RequestedProductChange, current: Unit): RequestedProductChange {
  return {
    catalogCategoryId: input.catalogCategoryId !== undefined && input.catalogCategoryId !== current.catalogCategoryId ? input.catalogCategoryId : undefined,
    catalogProductId: input.catalogProductId !== undefined && input.catalogProductId !== current.catalogProductId ? input.catalogProductId : undefined,
  }
}

async function lockedUpdateTarget(
  em: EntityManager,
  scope: Scope,
  requested: RequestedProductChange,
  locked: Unit,
  resolved: ResolvedUnitProduct | null,
): Promise<ResolvedUnitProduct | null> {
  if (!resolved) return null
  const catalogCategoryId = requested.catalogCategoryId ?? locked.catalogCategoryId
  const catalogProductId = requested.catalogProductId ?? locked.catalogProductId
  if (catalogCategoryId === locked.catalogCategoryId && catalogProductId === locked.catalogProductId) return null
  if (catalogCategoryId === resolved.catalogCategoryId && catalogProductId === resolved.catalogProductId) return resolved
  return resolveUnitProduct(em, scope, { catalogCategoryId, catalogProductId })
}

const updateUnitCommand: CommandHandler<UnitUpdateInput, { unitId: string; productChange: ProductPeriodChange | null }> = {
  id: 'property_management.unit.update',
  prepare: async (input, ctx) => {
    const before = await loadUnitSnapshot(ctx, requireId(input?.id), input)
    return before ? { before } : {}
  },
  async execute(rawInput, ctx) {
    const parsed = unitUpdateSchema.parse(rawInput ?? {})
    const scope = { tenantId: parsed.tenantId, organizationId: parsed.organizationId }
    ensureScope(ctx, scope)
    const em = resolveEm(ctx)
    const current = await loadUnit(em, ctx, scope, parsed.id)
    if (parsed.floorId !== undefined && parsed.floorId !== current.floorId) {
      await unprocessable('property_management.errors.unitFloorMoveUnsupported', 'Moving a unit to another floor is not supported yet.', {
        code: 'unit_floor_move_unsupported',
        fieldErrors: { floorId: 'property_management.errors.unitFloorMoveUnsupported' },
      })
    }
    const requested = requestedProductChange(parsed, current)
    const product = requested.catalogCategoryId !== undefined || requested.catalogProductId !== undefined
      ? await resolveUnitProduct(em, scope, {
          catalogCategoryId: requested.catalogCategoryId ?? current.catalogCategoryId,
          catalogProductId: requested.catalogProductId ?? current.catalogProductId,
        })
      : null
    const price = product && requested.catalogProductId !== undefined
      ? await resolvePriceSnapshot(em, ctx.container, scope, product.catalogProductId, await billingPriceContext(em, scope))
      : null
    const outcome = await em.fork().transactional(async (trx) => {
      await assertBuildingWritable(trx, scope, current.buildingId)
      const floor = await lockFloor(trx, scope, current.floorId)
      const geometry = await loadFloorGeometry(trx, scope, floor)
      const record = geometry.unitRecords.find((item) => item.id === current.id)
      if (!record) return notFound('property_management.errors.unitNotFound', 'Unit not found.')
      await enforceRecordVersion(ctx, UNIT_RESOURCE_KIND, record)
      const spaceId = parsed.spaceId ?? record.spaceId
      if (!geometry.spaceRecords.some((space) => space.id === spaceId)) {
        await unprocessable('property_management.errors.spaceNotOnFloor', 'The space is not on this floor.', {
          fieldErrors: { spaceId: 'property_management.errors.spaceNotOnFloor' },
        })
      }
      const target = await lockedUpdateTarget(trx, scope, requested, record, product)
      const switching = target && target.catalogProductId !== record.catalogProductId
        ? await lockCurrentProductUse(trx, scope, target, price ?? NO_PRICE, productUseMissing)
        : null
      if (switching) {
        await lockUnitRow(trx, scope, record.id)
        await assertProductChangeAllowed(trx, scope, record.id, switching.product)
      }
      await assertMoveDestinationAvailable(trx, scope, record, { floorId: record.floorId, spaceId })
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
      if (switching) {
        productChange = await switchProductPeriod(trx, scope, record.id, switching.product, switching.price)
      }
      if (parsed.name !== undefined) record.name = parsed.name
      record.spaceId = spaceId
      record.x = metres(rect.x)
      record.y = metres(rect.y)
      record.width = metres(rect.width)
      record.depth = metres(rect.depth)
      if (target) {
        record.catalogCategoryId = target.catalogCategoryId
        record.catalogProductId = target.catalogProductId
      }
      record.updatedAt = new Date()
      await trx.flush()
      await writeCustomFields(trx, ctx, UNIT_ENTITY_ID, record, parsed.customFields)
      return { unit: record, productChange }
    })
    await emitSideEffects(ctx, 'updated', outcome.unit, { indexer: unitCrudIndexer, events: unitCrudEvents })
    if (outcome.productChange) await emitProductChanged(outcome.unit, outcome.productChange)
    return { unitId: outcome.unit.id, productChange: outcome.productChange }
  },
  captureAfter: async (input, result, ctx) => loadUnitSnapshot(ctx, result.unitId, input),
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
    await assertCtxBuildingAccess(ctx, scope, before.buildingId)
    const em = resolveEm(ctx)
    const productChange = payload?.productChange ?? null
    const restored = productChange ? await resolveRestoredProduct(em, scope, before) : null
    const unit = await em.fork().transactional(async (trx) => {
      await assertBuildingWritable(trx, scope, before.buildingId)
      const floor = await lockFloor(trx, scope, before.floorId)
      if (!(await findLiveUnit(trx, scope, before.id))) return null
      const geometry = await loadFloorGeometry(trx, scope, floor)
      const issues = checkPlacement({ kind: 'unit', rect: toRect(before), selfId: before.id, spaceId: before.spaceId }, geometry)
      if (issues.length) await throwPlacementIssues(issues)
      const live = geometry.unitRecords.find((item) => item.id === before.id)
      if (live) await assertMoveDestinationAvailable(trx, scope, live, { floorId: live.floorId, spaceId: before.spaceId })
      if (productChange && restored) {
        const current = await lockRestoredUnit(trx, scope, before.id, restored)
        await revertProductPeriod(trx, scope, before.id, productChange, current)
      }
      const record = await findLiveUnit(trx, scope, before.id)
      if (!record) return null
      record.name = before.name
      record.spaceId = before.spaceId
      if (productChange || categoryOnlyChangeStillCurrent(record, before, payload?.after)) {
        record.catalogCategoryId = before.catalogCategoryId
        record.catalogProductId = before.catalogProductId
      }
      record.x = before.x
      record.y = before.y
      record.width = before.width
      record.depth = before.depth
      record.updatedAt = new Date()
      await trx.flush()
      await restoreCustomFields(trx, ctx, UNIT_ENTITY_ID, record, before.custom, payload?.after?.custom)
      return record
    })
    if (unit) await emitSideEffects(ctx, 'updated', unit, { indexer: unitCrudIndexer, events: unitCrudEvents }, 'undo')
  },
}

async function keepLockedCategory(
  em: EntityManager,
  scope: Scope,
  requestedCategoryId: string | undefined,
  locked: Unit,
  product: ResolvedUnitProduct,
): Promise<ResolvedUnitProduct> {
  if (requestedCategoryId !== undefined || locked.catalogCategoryId === product.catalogCategoryId) return product
  const resolved = await resolveUnitProduct(em, scope, { catalogCategoryId: locked.catalogCategoryId, catalogProductId: product.catalogProductId })
  return { ...product, catalogCategoryId: resolved.catalogCategoryId }
}

const productChangeCommand: CommandHandler<UnitProductChangeInput, { unitId: string; productChange: ProductPeriodChange | null }> = {
  id: 'property_management.unit.product_change',
  prepare: async (input, ctx) => {
    const before = await loadUnitSnapshot(ctx, requireId(input?.id), input)
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
    const price = await resolvePriceSnapshot(em, ctx.container, scope, product.catalogProductId, await billingPriceContext(em, scope))
    const outcome = await em.fork().transactional(async (trx) => {
      await assertBuildingWritable(trx, scope, current.buildingId)
      await lockFloor(trx, scope, current.floorId)
      const record = await findOneWithDecryption(trx, Unit, { id: current.id, ...scope, deletedAt: null }, undefined, scope)
      if (!record) return notFound('property_management.errors.unitNotFound', 'Unit not found.')
      const confirmed = await lockCurrentProductUse(trx, scope, product, price, productUseMissing)
      const locked = await lockUnitRow(trx, scope, record.id)
      await enforceCommandOptimisticLockWithGuards(ctx.container, {
        resourceKind: UNIT_RESOURCE_KIND,
        resourceId: locked.id,
        current: locked.updatedAt,
        request: ctx.request ?? null,
      })
      const target = await keepLockedCategory(trx, scope, parsed.catalogCategoryId, locked, confirmed.product)
      if (locked.catalogProductId === target.catalogProductId && locked.catalogCategoryId === target.catalogCategoryId) {
        return { unit: locked, productChange: null }
      }
      await assertProductChangeAllowed(trx, scope, locked.id, target)
      const productChange = await switchProductPeriod(trx, scope, locked.id, target, confirmed.price)
      locked.catalogCategoryId = target.catalogCategoryId
      locked.catalogProductId = target.catalogProductId
      locked.updatedAt = new Date()
      return { unit: locked, productChange }
    })
    if (outcome.productChange) {
      await emitSideEffects(ctx, 'updated', outcome.unit, { indexer: unitCrudIndexer, events: unitCrudEvents })
      await emitProductChanged(outcome.unit, outcome.productChange)
    }
    return { unitId: outcome.unit.id, productChange: outcome.productChange }
  },
  captureAfter: async (input, result, ctx) => loadUnitSnapshot(ctx, result.unitId, input),
  buildLog: async ({ input, result, ctx, snapshots }) => {
    if (result && result.productChange === null) return { skipLog: true }
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
    await assertCtxBuildingAccess(ctx, scope, before.buildingId)
    const em = resolveEm(ctx)
    const change = payload.productChange
    const restored = await resolveRestoredProduct(em, scope, before)
    const unit = await em.fork().transactional(async (trx) => {
      await assertBuildingWritable(trx, scope, before.buildingId)
      await lockFloor(trx, scope, before.floorId)
      if (!(await findLiveUnit(trx, scope, before.id))) return null
      const current = await lockRestoredUnit(trx, scope, before.id, restored)
      await revertProductPeriod(trx, scope, before.id, change, current)
      const record = await findLiveUnit(trx, scope, before.id)
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
    const before = await loadUnitSnapshot(ctx, requireId(input?.id), input)
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
      const record = await findOneWithDecryption(trx, Unit, { id: current.id, ...scope, deletedAt: null }, undefined, scope)
      if (!record) return notFound('property_management.errors.unitNotFound', 'Unit not found.')
      await enforceRecordVersion(ctx, UNIT_RESOURCE_KIND, record)
      const blockers = await findUnitBlockerList(trx, scope, [current.id])
      if (blockers.total) {
        await conflict('property_management.errors.unitInUse', 'A unit with a lease or bookings cannot be deleted.', { code: 'unit_in_use', ...usageBlockerConflictBody(blockers) })
      }
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
    await assertCtxBuildingAccess(ctx, scope, before.buildingId)
    const em = resolveEm(ctx)
    const unit = await em.fork().transactional(async (trx) => {
      await assertBuildingWritable(trx, scope, before.buildingId)
      const floor = await lockFloor(trx, scope, before.floorId)
      const geometry = await loadFloorGeometry(trx, scope, floor)
      const issues = checkPlacement({ kind: 'unit', rect: toRect(before), selfId: before.id, spaceId: before.spaceId }, geometry)
      if (issues.length) await throwPlacementIssues(issues)
      const record = await findOneWithDecryption(trx, Unit, { id: before.id, ...scope }, { refresh: true }, scope)
      if (!record) return null
      const productUse = await lockProductUse(trx, scope, record.catalogProductId, 'share')
      if (!productUse) return restoredProductUnavailable()
      const locked = await lockUnitRow(trx, scope, record.id, { includeDeleted: true })
      locked.deletedAt = null
      return locked
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
