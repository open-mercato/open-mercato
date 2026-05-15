import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import {
  emitCrudSideEffects,
  emitCrudUndoSideEffects,
  buildChanges,
  requireId,
} from '@open-mercato/shared/lib/commands/helpers'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { EntityManager } from '@mikro-orm/postgresql'
import { ensureOrganizationScope, ensureTenantScope } from '@open-mercato/shared/lib/commands/scope'
import { extractUndoPayload } from '@open-mercato/shared/lib/commands/undo'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { CrudEventsConfig } from '@open-mercato/shared/lib/crud/types'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { Currency } from '@open-mercato/core/modules/currencies/data/entities'
import { MaterialPrice, MaterialSupplierLink } from '../data/entities'
import {
  createMaterialPriceSchema,
  updateMaterialPriceSchema,
  checkPriceValidityRange,
  type CreateMaterialPriceInput,
  type UpdateMaterialPriceInput,
} from '../data/validators'

/**
 * MaterialPrice commands (Phase 1 Step 8).
 *
 * Domain invariants enforced here:
 * 1. Parent MaterialSupplierLink must exist in same org/tenant scope (404 / 403).
 * 2. currency_id must reference a Currency in same org/tenant scope. Currencies are not
 *    encrypted, so plain em.findOne is fine here (cf. encryption note in
 *    .ai/lessons.md — only applies to entities with encrypted columns).
 * 3. Validity range: valid_from <= valid_to enforced by zod refiner AND DB check constraint.
 *    Phase 1 does NOT enforce non-overlapping windows for the same supplier link — leaves
 *    that as a UX concern (procurement chooses one price per moment via valid_from sort).
 * 4. Price amount must be > 0 (zod + DB check).
 * 5. base_currency_amount and base_currency_at are subscriber-managed only. The schemas omit
 *    them so direct mutation strict-fails at the validator layer; the FX subscriber (Step 9)
 *    is the only writer.
 */

const priceCrudEvents: CrudEventsConfig = {
  module: 'materials',
  entity: 'price',
  persistent: true,
  buildPayload: (ctx) => {
    const entity = ctx.entity as MaterialPrice | undefined
    return {
      id: ctx.identifiers.id,
      organizationId: ctx.identifiers.organizationId,
      tenantId: ctx.identifiers.tenantId,
      materialSupplierLinkId: entity?.materialSupplierLinkId ?? null,
      // Step 9 FX subscriber filters by currency and source amount; surface them upfront.
      amount: entity?.priceAmount ?? null,
      currencyId: entity?.currencyId ?? null,
      validFrom: entity?.validFrom ?? null,
      validTo: entity?.validTo ?? null,
    }
  },
}

type PriceSnapshot = {
  id: string
  organizationId: string
  tenantId: string
  materialSupplierLinkId: string
  priceAmount: string
  currencyId: string
  baseCurrencyAmount: string | null
  baseCurrencyAt: Date | null
  validFrom: Date | null
  validTo: Date | null
  isActive: boolean
  deletedAt: Date | null
}

type PriceUndoPayload = {
  before?: PriceSnapshot | null
  after?: PriceSnapshot | null
}

async function loadPriceSnapshot(em: EntityManager, id: string): Promise<PriceSnapshot | null> {
  const price = await em.findOne(MaterialPrice, { id })
  if (!price) return null
  return {
    id: price.id,
    organizationId: price.organizationId,
    tenantId: price.tenantId,
    materialSupplierLinkId: price.materialSupplierLinkId,
    priceAmount: price.priceAmount,
    currencyId: price.currencyId,
    baseCurrencyAmount: price.baseCurrencyAmount ?? null,
    baseCurrencyAt: price.baseCurrencyAt ?? null,
    validFrom: price.validFrom ?? null,
    validTo: price.validTo ?? null,
    isActive: price.isActive,
    deletedAt: price.deletedAt ?? null,
  }
}

async function ensureSupplierLinkInScope(
  em: EntityManager,
  supplierLinkId: string,
  organizationId: string,
  tenantId: string,
): Promise<MaterialSupplierLink> {
  const link = await em.findOne(MaterialSupplierLink, { id: supplierLinkId, deletedAt: null })
  const { translate } = await resolveTranslations()
  if (!link) {
    throw new CrudHttpError(404, {
      error: translate('materials.supplier_link.errors.not_found', 'Supplier link not found'),
    })
  }
  if (link.organizationId !== organizationId || link.tenantId !== tenantId) {
    throw new CrudHttpError(403, {
      error: translate('materials.errors.cross_org_forbidden', 'Supplier link belongs to a different organization'),
    })
  }
  return link
}

async function ensureCurrencyInScope(
  em: EntityManager,
  currencyId: string,
  organizationId: string,
  tenantId: string,
): Promise<void> {
  const currency = await em.findOne(Currency, {
    id: currencyId,
    organizationId,
    tenantId,
    isActive: true,
  })
  if (!currency) {
    const { translate } = await resolveTranslations()
    throw new CrudHttpError(404, {
      error: translate(
        'materials.price.errors.currency_not_found',
        'Currency not found in this organization (or is inactive)',
      ),
    })
  }
}

const PRICE_TRACKED_COLUMNS: ReadonlyArray<keyof PriceSnapshot> = [
  'priceAmount',
  'currencyId',
  'validFrom',
  'validTo',
  'isActive',
] as const

const createPriceCommand: CommandHandler<CreateMaterialPriceInput, { priceId: string }> = {
  id: 'materials.price.create',
  async execute(rawInput, ctx) {
    const parsed = createMaterialPriceSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)

    const rangeError = checkPriceValidityRange(parsed.validFrom ?? null, parsed.validTo ?? null)
    if (rangeError) {
      const { translate } = await resolveTranslations()
      throw new CrudHttpError(422, { error: translate(rangeError, 'validTo must be on or after validFrom') })
    }

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    await ensureSupplierLinkInScope(em, parsed.materialSupplierLinkId, parsed.organizationId, parsed.tenantId)
    await ensureCurrencyInScope(em, parsed.currencyId, parsed.organizationId, parsed.tenantId)

    const price = em.create(MaterialPrice, {
      organizationId: parsed.organizationId,
      tenantId: parsed.tenantId,
      materialSupplierLinkId: parsed.materialSupplierLinkId,
      priceAmount: parsed.priceAmount,
      currencyId: parsed.currencyId,
      validFrom: parsed.validFrom ?? null,
      validTo: parsed.validTo ?? null,
      isActive: parsed.isActive ?? true,
    })
    em.persist(price)
    await em.flush()

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine,
      action: 'created',
      entity: price,
      identifiers: {
        id: price.id,
        organizationId: price.organizationId,
        tenantId: price.tenantId,
      },
      events: priceCrudEvents,
    })

    return { priceId: price.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    return await loadPriceSnapshot(em, result.priceId)
  },
  buildLog: async ({ result, ctx }) => {
    const { translate } = await resolveTranslations()
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const snapshot = await loadPriceSnapshot(em, result.priceId)
    return {
      actionLabel: translate('materials.audit.price.create', 'Add material price'),
      resourceKind: 'materials.price',
      resourceId: result.priceId,
      tenantId: snapshot?.tenantId ?? null,
      organizationId: snapshot?.organizationId ?? null,
      snapshotAfter: snapshot ?? null,
      payload: {
        undo: {
          after: snapshot ?? null,
        } satisfies PriceUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const priceId = logEntry?.resourceId ?? null
    if (!priceId) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const price = await em.findOne(MaterialPrice, { id: priceId })
    if (price) {
      em.remove(price)
      await em.flush()
    }
  },
}

const updatePriceCommand: CommandHandler<UpdateMaterialPriceInput, { priceId: string }> = {
  id: 'materials.price.update',
  async prepare(rawInput, ctx) {
    const parsed = updateMaterialPriceSchema.parse(rawInput)
    const em = ctx.container.resolve('em') as EntityManager
    const snapshot = await loadPriceSnapshot(em, parsed.id)
    return snapshot ? { before: snapshot } : {}
  },
  async execute(rawInput, ctx) {
    const parsed = updateMaterialPriceSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const price = await em.findOne(MaterialPrice, { id: parsed.id })
    if (!price) {
      const { translate } = await resolveTranslations()
      throw new CrudHttpError(404, { error: translate('materials.price.errors.not_found', 'Price not found') })
    }
    ensureTenantScope(ctx, price.tenantId)
    ensureOrganizationScope(ctx, price.organizationId)

    if (parsed.currencyId !== undefined && parsed.currencyId !== price.currencyId) {
      await ensureCurrencyInScope(em, parsed.currencyId, price.organizationId, price.tenantId)
      price.currencyId = parsed.currencyId
      // Currency changed → invalidate FX cache so the subscriber recomputes on the next tick.
      price.baseCurrencyAmount = null
      price.baseCurrencyAt = null
    }
    if (parsed.priceAmount !== undefined) {
      price.priceAmount = parsed.priceAmount
      // Amount changed → also invalidate FX cache.
      price.baseCurrencyAmount = null
      price.baseCurrencyAt = null
    }
    const nextValidFrom = parsed.validFrom !== undefined ? (parsed.validFrom ?? null) : (price.validFrom ?? null)
    const nextValidTo = parsed.validTo !== undefined ? (parsed.validTo ?? null) : (price.validTo ?? null)
    const rangeError = checkPriceValidityRange(nextValidFrom, nextValidTo)
    if (rangeError) {
      const { translate } = await resolveTranslations()
      throw new CrudHttpError(422, { error: translate(rangeError, 'validTo must be on or after validFrom') })
    }
    if (parsed.validFrom !== undefined) price.validFrom = parsed.validFrom ?? null
    if (parsed.validTo !== undefined) price.validTo = parsed.validTo ?? null
    if (parsed.isActive !== undefined) price.isActive = parsed.isActive

    await em.flush()

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine,
      action: 'updated',
      entity: price,
      identifiers: {
        id: price.id,
        organizationId: price.organizationId,
        tenantId: price.tenantId,
      },
      events: priceCrudEvents,
    })

    return { priceId: price.id }
  },
  buildLog: async ({ snapshots, ctx }) => {
    const { translate } = await resolveTranslations()
    const before = snapshots.before as PriceSnapshot | undefined
    if (!before) return null
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const after = await loadPriceSnapshot(em, before.id)
    const changes = after
      ? buildChanges(
          before as unknown as Record<string, unknown>,
          after as unknown as Record<string, unknown>,
          PRICE_TRACKED_COLUMNS as unknown as string[],
        )
      : {}
    return {
      actionLabel: translate('materials.audit.price.update', 'Update material price'),
      resourceKind: 'materials.price',
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      snapshotAfter: after ?? null,
      changes,
      payload: {
        undo: {
          before,
          after: after ?? null,
        } satisfies PriceUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<PriceUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    let price = await em.findOne(MaterialPrice, { id: before.id })
    if (!price) {
      price = em.create(MaterialPrice, {
        id: before.id,
        organizationId: before.organizationId,
        tenantId: before.tenantId,
        materialSupplierLinkId: before.materialSupplierLinkId,
        priceAmount: before.priceAmount,
        currencyId: before.currencyId,
        baseCurrencyAmount: before.baseCurrencyAmount,
        baseCurrencyAt: before.baseCurrencyAt,
        validFrom: before.validFrom,
        validTo: before.validTo,
        isActive: before.isActive,
      })
      em.persist(price)
    } else {
      price.priceAmount = before.priceAmount
      price.currencyId = before.currencyId
      price.baseCurrencyAmount = before.baseCurrencyAmount
      price.baseCurrencyAt = before.baseCurrencyAt
      price.validFrom = before.validFrom
      price.validTo = before.validTo
      price.isActive = before.isActive
      price.deletedAt = before.deletedAt
    }
    await em.flush()

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudUndoSideEffects({
      dataEngine,
      action: 'updated',
      entity: price,
      identifiers: {
        id: price.id,
        organizationId: price.organizationId,
        tenantId: price.tenantId,
      },
      events: priceCrudEvents,
    })
  },
}

const deletePriceCommand: CommandHandler<
  { body?: Record<string, unknown>; query?: Record<string, unknown>; id?: string },
  { priceId: string }
> = {
  id: 'materials.price.delete',
  async prepare(input, ctx) {
    const id = requireId(input, 'Price id required')
    const em = ctx.container.resolve('em') as EntityManager
    const snapshot = await loadPriceSnapshot(em, id)
    return snapshot ? { before: snapshot } : {}
  },
  async execute(input, ctx) {
    const id = requireId(input, 'Price id required')
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const price = await em.findOne(MaterialPrice, { id })
    if (!price) {
      const { translate } = await resolveTranslations()
      throw new CrudHttpError(404, { error: translate('materials.price.errors.not_found', 'Price not found') })
    }
    ensureTenantScope(ctx, price.tenantId)
    ensureOrganizationScope(ctx, price.organizationId)

    price.deletedAt = new Date()
    price.isActive = false
    await em.flush()

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine,
      action: 'deleted',
      entity: price,
      identifiers: {
        id: price.id,
        organizationId: price.organizationId,
        tenantId: price.tenantId,
      },
      events: priceCrudEvents,
    })

    return { priceId: price.id }
  },
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as PriceSnapshot | undefined
    if (!before) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('materials.audit.price.delete', 'Delete material price'),
      resourceKind: 'materials.price',
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      payload: {
        undo: {
          before,
        } satisfies PriceUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<PriceUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const price = await em.findOne(MaterialPrice, { id: before.id })
    if (!price) return
    price.deletedAt = before.deletedAt
    price.isActive = before.isActive
    await em.flush()

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudUndoSideEffects({
      dataEngine,
      action: 'deleted',
      entity: price,
      identifiers: {
        id: price.id,
        organizationId: price.organizationId,
        tenantId: price.tenantId,
      },
      events: priceCrudEvents,
    })
  },
}

registerCommand(createPriceCommand)
registerCommand(updatePriceCommand)
registerCommand(deletePriceCommand)
