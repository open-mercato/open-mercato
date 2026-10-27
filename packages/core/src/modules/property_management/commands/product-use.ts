import { randomUUID } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { extractUndoPayload } from '@open-mercato/shared/lib/commands/undo'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CatalogProduct } from '@open-mercato/core/modules/catalog/data/entities'
import { ProductUse, Unit, type BillingUnit, type ProductUseKind } from '../data/entities'
import { productUseSetSchema, type ProductUseSetInput } from '../data/validators'
import { findActiveLeases, findUpcomingBookings } from '../lib/usageGuards'
import type { Scope } from '../lib/productUse'
import { buildCrudLog, conflict, ensureScope, resolveEm, unprocessable } from './shared'

export const PRODUCT_USE_RESOURCE_KIND = 'property_management.product_use'

export type ProductUseState = { use: ProductUseKind; billingUnit: BillingUnit } | null

type ProductUseUndoPayload = {
  scope?: Scope
  catalogProductId?: string
  before?: ProductUseState
}

export async function loadProductUseRecord(em: EntityManager, scope: Scope, catalogProductId: string): Promise<ProductUse | null> {
  return findOneWithDecryption(em, ProductUse, { ...scope, catalogProductId }, undefined, scope)
}

export async function assertProductUseChangeAllowed(
  em: EntityManager,
  scope: Scope,
  catalogProductId: string,
  current: ProductUseState,
  next: ProductUseState,
): Promise<void> {
  if (!current) return
  if (next && next.use === current.use) return
  const units = await findWithDecryption(em, Unit, { ...scope, catalogProductId, deletedAt: null }, undefined, scope)
  if (!units.length) return
  const unitIds = units.map((unit) => unit.id)
  if (!next) {
    await conflict('property_management.errors.productUseInUse', 'Units still use this product, so it must stay leasable or bookable.', {
      code: 'product_use_in_use',
      units: units.map((unit) => unit.name),
    })
  }
  const blockers = current.use === 'leasable'
    ? await findActiveLeases(em, scope, unitIds)
    : await findUpcomingBookings(em, scope, unitIds)
  if (blockers.length) {
    await conflict('property_management.errors.productUseStrands', 'Changing the use would strand leases or upcoming bookings.', {
      code: 'product_use_strands',
      blockers,
    })
  }
}

async function applyState(em: EntityManager, scope: Scope, catalogProductId: string, next: ProductUseState): Promise<void> {
  const record = await loadProductUseRecord(em, scope, catalogProductId)
  if (!next) {
    if (record) em.remove(record)
    await em.flush()
    return
  }
  if (record) {
    record.use = next.use
    record.billingUnit = next.billingUnit
  } else {
    em.persist(em.create(ProductUse, { id: randomUUID(), ...scope, catalogProductId, use: next.use, billingUnit: next.billingUnit }))
  }
  await em.flush()
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

const setProductUseCommand: CommandHandler<ProductUseSetInput, { catalogProductId: string; before: ProductUseState }> = {
  id: 'property_management.product_use.set',
  async execute(rawInput, ctx: CommandRuntimeContext) {
    const parsed = productUseSetSchema.parse(rawInput ?? {})
    const scope = { tenantId: parsed.tenantId, organizationId: parsed.organizationId }
    ensureScope(ctx, scope)
    const em = resolveEm(ctx)
    await ensureProduct(em, scope, parsed.catalogProductId)
    const next: ProductUseState = parsed.use && parsed.billingUnit ? { use: parsed.use, billingUnit: parsed.billingUnit } : null
    const before = await em.fork().transactional(async (trx) => {
      const current = toProductUseState(await loadProductUseRecord(trx, scope, parsed.catalogProductId))
      await assertProductUseChangeAllowed(trx, scope, parsed.catalogProductId, current, next)
      await applyState(trx, scope, parsed.catalogProductId, next)
      return current
    })
    return { catalogProductId: parsed.catalogProductId, before }
  },
  buildLog: async ({ input, result, ctx }) => {
    const base = await buildCrudLog(ctx, input, result?.catalogProductId ?? null, 'property_management.audit.productUse.set', 'Set product use', PRODUCT_USE_RESOURCE_KIND)
    const scope = input ? { tenantId: input.tenantId, organizationId: input.organizationId } : undefined
    return {
      ...base,
      payload: { undo: { scope, catalogProductId: result?.catalogProductId, before: result?.before ?? null } satisfies ProductUseUndoPayload },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<ProductUseUndoPayload>(logEntry)
    if (!payload?.scope || !payload.catalogProductId) return
    const scope = payload.scope
    const catalogProductId = payload.catalogProductId
    ensureScope(ctx, scope)
    const em = resolveEm(ctx)
    await em.fork().transactional(async (trx) => {
      const current = toProductUseState(await loadProductUseRecord(trx, scope, catalogProductId))
      await assertProductUseChangeAllowed(trx, scope, catalogProductId, current, payload.before ?? null)
      await applyState(trx, scope, catalogProductId, payload.before ?? null)
    })
  },
}

registerCommand(setProductUseCommand)
