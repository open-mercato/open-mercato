import { randomUUID } from 'node:crypto'
import { LockMode } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { CrudHttpError, isUniqueViolation } from '@open-mercato/shared/lib/crud/errors'
import {
  enforceCommandOptimisticLockWithGuards,
  enforceRecordGoneIsConflict,
} from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { extractUndoPayload } from '@open-mercato/shared/lib/commands/undo'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CatalogProduct } from '@open-mercato/core/modules/catalog/data/entities'
import { ProductUse, Unit, UnitProductPeriod, type BillingUnit, type ProductUseKind } from '../data/entities'
import { productUseSetSchema, type ProductUseSetInput } from '../data/validators'
import { findActiveLeases, findUpcomingBookingList, usageBlockerConflictBody, usageBlockerListOf } from '../lib/usageGuards'
import { lockProductUse, type Scope } from '../lib/productUse'
import { canManageAllBuildings } from '../lib/buildingAccess'
import { buildCrudLog, conflict, emitSideEffects, ensureScope, productUseCrudIndexer, resolveEm, unprocessable } from './shared'

export const PRODUCT_USE_RESOURCE_KIND = 'property_management.product_use'

const RACE_CONSTRAINTS = [
  'property_management_unit_product_periods_open_unique',
  'property_management_product_uses_product_unique',
] as const

export type ProductUseState = { use: ProductUseKind; billingUnit: BillingUnit } | null

export type ProductPeriodSwitch = { closedPeriodId: string; openedPeriodId: string }

type ProductUseUndoPayload = {
  scope?: Scope
  catalogProductId?: string
  before?: ProductUseState
  after?: ProductUseState
  periodSwitches?: ProductPeriodSwitch[]
}

export async function loadProductUseRecord(
  em: EntityManager,
  scope: Scope,
  catalogProductId: string,
  options: { refresh?: boolean } = {},
): Promise<ProductUse | null> {
  return findOneWithDecryption(em, ProductUse, { ...scope, catalogProductId }, options.refresh ? { refresh: true } : undefined, scope)
}

function sameState(left: ProductUseState, right: ProductUseState): boolean {
  if (!left || !right) return left === right
  return left.use === right.use && left.billingUnit === right.billingUnit
}

function changesUse(current: ProductUseState, next: ProductUseState): boolean {
  return Boolean(current) && !sameState(current, next)
}

async function findLiveProductUnits(em: EntityManager, scope: Scope, catalogProductId: string): Promise<Unit[]> {
  return findWithDecryption(em, Unit, { ...scope, catalogProductId, deletedAt: null }, undefined, scope)
}

async function lockProductUnits(em: EntityManager, scope: Scope, catalogProductId: string): Promise<Unit[]> {
  return findWithDecryption(
    em,
    Unit,
    { ...scope, catalogProductId },
    { lockMode: LockMode.PESSIMISTIC_WRITE, orderBy: { id: 'asc' }, refresh: true },
    scope,
  )
}

async function assertUnitsAllowChange(em: EntityManager, scope: Scope, units: readonly Unit[], current: ProductUseState, next: ProductUseState): Promise<void> {
  if (!current || !units.length) return
  const unitIds = units.map((unit) => unit.id)
  if (!next) {
    await conflict('property_management.errors.productUseInUse', 'Units still use this product, so it must stay leasable or bookable.', {
      code: 'product_use_in_use',
      units: units.map((unit) => unit.name),
    })
  }
  const blockers = current.use === 'leasable'
    ? usageBlockerListOf(await findActiveLeases(em, scope, unitIds))
    : await findUpcomingBookingList(em, scope, unitIds)
  if (!blockers.total) return
  if (next?.use === current.use) {
    await conflict('property_management.errors.productBillingUnitStrands', 'Upcoming bookings use the current billing unit, so it cannot change until they are over.', {
      code: 'product_billing_unit_strands',
      ...usageBlockerConflictBody(blockers),
    })
  }
  await conflict('property_management.errors.productUseStrands', 'Changing the use would strand leases or upcoming bookings.', {
    code: 'product_use_strands',
    ...usageBlockerConflictBody(blockers),
  })
}

export async function assertProductUseChangeAllowed(
  em: EntityManager,
  scope: Scope,
  catalogProductId: string,
  current: ProductUseState,
  next: ProductUseState,
): Promise<void> {
  if (!changesUse(current, next)) return
  const units = await findLiveProductUnits(em, scope, catalogProductId)
  await assertUnitsAllowChange(em, scope, units, current, next)
}

type ProductUseChange = { action: 'created' | 'updated' | 'deleted'; record: ProductUse } | null

function applyState(em: EntityManager, scope: Scope, catalogProductId: string, record: ProductUse | null, next: ProductUseState): ProductUseChange {
  if (!next) {
    if (!record) return null
    em.remove(record)
    return { action: 'deleted', record }
  }
  if (record) {
    record.use = next.use
    record.billingUnit = next.billingUnit
    return { action: 'updated', record }
  }
  const created = em.create(ProductUse, { id: randomUUID(), ...scope, catalogProductId, use: next.use, billingUnit: next.billingUnit })
  em.persist(created)
  return { action: 'created', record: created }
}

type ActiveUse = NonNullable<ProductUseState>

type PeriodPlan = { close: UnitProductPeriod; reopen: UnitProductPeriod | null }

function hasState(period: UnitProductPeriod, state: ActiveUse): boolean {
  return period.use === state.use && period.billingUnit === state.billingUnit
}

function sameInstant(left: Date | string | null | undefined, right: Date | string | null | undefined): boolean {
  if (!left || !right) return false
  return new Date(left).getTime() === new Date(right).getTime()
}

async function latestClosedPeriods(em: EntityManager, scope: Scope, reverting: readonly UnitProductPeriod[]): Promise<Map<string, UnitProductPeriod>> {
  const latest = new Map<string, UnitProductPeriod>()
  if (!reverting.length) return latest
  const since = new Date(Math.min(...reverting.map((period) => new Date(period.validFrom).getTime())))
  const closed = await findWithDecryption(
    em,
    UnitProductPeriod,
    { ...scope, unitId: { $in: reverting.map((period) => period.unitId) }, validTo: { $gte: since } },
    { orderBy: { validTo: 'desc' }, refresh: true },
    scope,
  )
  for (const period of closed) {
    if (sameInstant(period.validTo, period.validFrom)) continue
    if (!latest.has(period.unitId)) latest.set(period.unitId, period)
  }
  return latest
}

async function planPeriodSwitches(
  em: EntityManager,
  scope: Scope,
  catalogProductId: string,
  next: ActiveUse,
  revert: readonly ProductPeriodSwitch[],
): Promise<PeriodPlan[]> {
  const open = await findWithDecryption(em, UnitProductPeriod, { ...scope, catalogProductId, validTo: null }, { refresh: true }, scope)
  const stale = open.filter((period) => !hasState(period, next))
  if (!stale.length) return []
  const predecessors = new Map(revert.map((entry) => [entry.openedPeriodId, entry.closedPeriodId]))
  const reverting = stale.filter((period) => predecessors.has(period.id))
  const latest = await latestClosedPeriods(em, scope, reverting)
  return stale.map((period) => {
    const candidate = latest.get(period.unitId)
    const reopen = candidate
      && candidate.id === predecessors.get(period.id)
      && candidate.catalogProductId === catalogProductId
      && hasState(candidate, next)
      && sameInstant(candidate.validTo, period.validFrom)
      ? candidate
      : null
    return { close: period, reopen }
  })
}

function openSuccessors(em: EntityManager, scope: Scope, plans: readonly PeriodPlan[], next: ActiveUse, now: Date): ProductPeriodSwitch[] {
  return plans.map((plan) => {
    if (plan.reopen) {
      plan.reopen.validTo = null
      return { closedPeriodId: plan.close.id, openedPeriodId: plan.reopen.id }
    }
    const opened = em.create(UnitProductPeriod, {
      id: randomUUID(),
      ...scope,
      unitId: plan.close.unitId,
      catalogProductId: plan.close.catalogProductId,
      productName: plan.close.productName,
      use: next.use,
      billingUnit: next.billingUnit,
      priceAmount: null,
      currencyCode: null,
      priceKindId: null,
      validFrom: now,
      validTo: null,
    })
    em.persist(opened)
    return { closedPeriodId: plan.close.id, openedPeriodId: opened.id }
  })
}

function productUseUndoStale(): Promise<never> {
  return conflict(
    'property_management.errors.productUseUndoStale',
    'The product use changed again since, so this change cannot be undone.',
    { code: 'product_use_undo_stale' },
  )
}

type TransitionOptions = {
  revert?: readonly ProductPeriodSwitch[]
  expected?: ProductUseState
  assertVersion?: (record: ProductUse | null) => Promise<void>
}

export async function transitionProductUse(
  em: EntityManager,
  scope: Scope,
  catalogProductId: string,
  next: ProductUseState,
  options: TransitionOptions = {},
): Promise<{ before: ProductUseState; change: ProductUseChange; periodSwitches: ProductPeriodSwitch[] }> {
  const revert = options.revert ?? []
  const record = await lockProductUse(em, scope, catalogProductId, 'update')
  if (options.assertVersion) await options.assertVersion(record)
  const before = toProductUseState(record)
  if (options.expected !== undefined && !sameState(before, options.expected)) return productUseUndoStale()
  if (sameState(before, next)) return { before, change: applyState(em, scope, catalogProductId, record, next), periodSwitches: [] }
  const units = await lockProductUnits(em, scope, catalogProductId)
  const liveUnits = units.filter((unit) => !unit.deletedAt)
  await assertUnitsAllowChange(em, scope, liveUnits, before, next)
  const plans = next ? await planPeriodSwitches(em, scope, catalogProductId, next, revert) : []
  const now = new Date()
  for (const plan of plans) plan.close.validTo = plan.reopen ? plan.close.validFrom : now
  if (plans.length) await em.flush()
  const periodSwitches = next ? openSuccessors(em, scope, plans, next, now) : []
  const change = applyState(em, scope, catalogProductId, record, next)
  await em.flush()
  return { before, change, periodSwitches }
}

export function toProductUseState(record: ProductUse | null): ProductUseState {
  return record ? { use: record.use, billingUnit: record.billingUnit } : null
}

async function ensureProduct(em: EntityManager, scope: Scope, catalogProductId: string): Promise<void> {
  const product = await findOneWithDecryption(em, CatalogProduct, { id: catalogProductId, ...scope, deletedAt: null }, undefined, scope)
  if (!product) {
    await unprocessable('property_management.errors.productNotFound', 'The product is not a catalog product of this organization.', {
      fieldErrors: { catalogProductId: 'property_management.errors.productNotFound' },
    })
  }
}

async function runTransition<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work()
  } catch (err) {
    if (RACE_CONSTRAINTS.some((constraint) => isUniqueViolation(err, constraint))) {
      await conflict('property_management.errors.productUseChanged', 'The product use changed meanwhile. Reload and try again.', {
        code: 'product_use_changed',
      })
    }
    throw err
  }
}

async function assertProductUseVersion(ctx: CommandRuntimeContext, catalogProductId: string, record: ProductUse | null): Promise<void> {
  const request = ctx.request ?? null
  if (!record) {
    enforceRecordGoneIsConflict({ resourceKind: PRODUCT_USE_RESOURCE_KIND, resourceId: catalogProductId, request })
    return
  }
  await enforceCommandOptimisticLockWithGuards(ctx.container, {
    resourceKind: PRODUCT_USE_RESOURCE_KIND,
    resourceId: record.id,
    current: record.updatedAt,
    request,
  })
}

export async function productUseForbiddenError(): Promise<CrudHttpError> {
  const { translate } = await resolveTranslations()
  return new CrudHttpError(403, {
    error: translate('property_management.errors.productUseForbidden', 'Only users who manage every building can change how a product is used.'),
    code: 'product_use_forbidden',
  })
}

async function assertManagesAllBuildings(ctx: CommandRuntimeContext, scope: Scope): Promise<void> {
  if (!ctx.auth) {
    if (ctx.systemActor === true) return
    throw await productUseForbiddenError()
  }
  const allowed = await canManageAllBuildings({ container: ctx.container, auth: ctx.auth, tenantId: scope.tenantId, organizationId: scope.organizationId, request: ctx.request })
  if (!allowed) throw await productUseForbiddenError()
}

type ProductUseSetResult = { catalogProductId: string; before: ProductUseState; after: ProductUseState; periodSwitches: ProductPeriodSwitch[] }

const setProductUseCommand: CommandHandler<ProductUseSetInput, ProductUseSetResult> = {
  id: 'property_management.product_use.set',
  async execute(rawInput, ctx: CommandRuntimeContext) {
    const parsed = productUseSetSchema.parse(rawInput ?? {})
    const scope = { tenantId: parsed.tenantId, organizationId: parsed.organizationId }
    ensureScope(ctx, scope)
    await assertManagesAllBuildings(ctx, scope)
    const em = resolveEm(ctx)
    await ensureProduct(em, scope, parsed.catalogProductId)
    const next: ProductUseState = parsed.use && parsed.billingUnit ? { use: parsed.use, billingUnit: parsed.billingUnit } : null
    const { before, change, periodSwitches } = await runTransition(() =>
      em.fork().transactional((trx) => transitionProductUse(trx, scope, parsed.catalogProductId, next, {
        assertVersion: (record) => assertProductUseVersion(ctx, parsed.catalogProductId, record),
      })),
    )
    if (change) await emitSideEffects(ctx, change.action, change.record, { indexer: productUseCrudIndexer })
    return { catalogProductId: parsed.catalogProductId, before, after: next, periodSwitches }
  },
  buildLog: async ({ input, result, ctx }) => {
    const base = await buildCrudLog(ctx, input, result?.catalogProductId ?? null, 'property_management.audit.productUse.set', 'Set product use', PRODUCT_USE_RESOURCE_KIND)
    const scope = input ? { tenantId: input.tenantId, organizationId: input.organizationId } : undefined
    const undo: ProductUseUndoPayload = {
      scope,
      catalogProductId: result?.catalogProductId,
      before: result?.before ?? null,
      ...(result ? { after: result.after } : {}),
      periodSwitches: result?.periodSwitches ?? [],
    }
    return { ...base, payload: { undo } }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<ProductUseUndoPayload>(logEntry)
    if (!payload?.scope || !payload.catalogProductId) return
    const scope = payload.scope
    const catalogProductId = payload.catalogProductId
    ensureScope(ctx, scope)
    await assertManagesAllBuildings(ctx, scope)
    const em = resolveEm(ctx)
    const revert = Array.isArray(payload.periodSwitches) ? payload.periodSwitches : []
    const { change } = await runTransition(() =>
      em.fork().transactional((trx) => transitionProductUse(trx, scope, catalogProductId, payload.before ?? null, { revert, expected: payload.after })),
    )
    if (change) await emitSideEffects(ctx, change.action, change.record, { indexer: productUseCrudIndexer }, 'undo')
  },
}

registerCommand(setProductUseCommand)
