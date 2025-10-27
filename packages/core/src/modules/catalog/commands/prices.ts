import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { buildChanges, requireId, parseWithCustomFields, setCustomFieldsIfAny } from '@open-mercato/shared/lib/commands/helpers'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CatalogProductPrice, CatalogProductVariant } from '../data/entities'
import { loadCustomFieldSnapshot, buildCustomFieldResetMap } from '@open-mercato/shared/lib/commands/customFieldSnapshots'
import { E } from '@open-mercato/core/generated/entities.ids.generated'
import {
  priceCreateSchema,
  priceUpdateSchema,
  type PriceCreateInput,
  type PriceUpdateInput,
} from '../data/validators'
import {
  cloneJson,
  ensureOrganizationScope,
  ensureTenantScope,
  extractUndoPayload,
  requireVariant,
  requireProduct,
  toNumericString,
} from './shared'

type PriceSnapshot = {
  id: string
  variantId: string
  organizationId: string
  tenantId: string
  currencyCode: string
  kind: string
  minQuantity: number
  maxQuantity: number | null
  unitPriceNet: string | null
  unitPriceGross: string | null
  taxRate: string | null
  metadata: Record<string, unknown> | null
  startsAt: string | null
  endsAt: string | null
  custom: Record<string, unknown> | null
}

type PriceUndoPayload = {
  before?: PriceSnapshot | null
  after?: PriceSnapshot | null
}

async function loadPriceSnapshot(em: EntityManager, id: string): Promise<PriceSnapshot | null> {
  const record = await em.findOne(CatalogProductPrice, { id })
  if (!record) return null
  const variantId =
    typeof record.variant === 'string' ? record.variant : record.variant.id
  const custom = await loadCustomFieldSnapshot(em, {
    entityId: E.catalog.catalog_product_price,
    recordId: record.id,
    tenantId: record.tenantId,
    organizationId: record.organizationId,
  })
  return {
    id: record.id,
    variantId,
    organizationId: record.organizationId,
    tenantId: record.tenantId,
    currencyCode: record.currencyCode,
    kind: record.kind,
    minQuantity: record.minQuantity,
    maxQuantity: record.maxQuantity ?? null,
    unitPriceNet: record.unitPriceNet ?? null,
    unitPriceGross: record.unitPriceGross ?? null,
    taxRate: record.taxRate ?? null,
    metadata: record.metadata ? cloneJson(record.metadata) : null,
    startsAt: record.startsAt ? record.startsAt.toISOString() : null,
    endsAt: record.endsAt ? record.endsAt.toISOString() : null,
    custom: Object.keys(custom).length ? custom : null,
  }
}

function applyPriceSnapshot(record: CatalogProductPrice, snapshot: PriceSnapshot): void {
  record.organizationId = snapshot.organizationId
  record.tenantId = snapshot.tenantId
  record.currencyCode = snapshot.currencyCode
  record.kind = snapshot.kind as 'list' | 'sale' | 'tier' | 'custom'
  record.minQuantity = snapshot.minQuantity
  record.maxQuantity = snapshot.maxQuantity ?? null
  record.unitPriceNet = snapshot.unitPriceNet ?? null
  record.unitPriceGross = snapshot.unitPriceGross ?? null
  record.taxRate = snapshot.taxRate ?? null
  record.metadata = snapshot.metadata ? cloneJson(snapshot.metadata) : null
  record.startsAt = snapshot.startsAt ? new Date(snapshot.startsAt) : null
  record.endsAt = snapshot.endsAt ? new Date(snapshot.endsAt) : null
}

const createPriceCommand: CommandHandler<PriceCreateInput, { priceId: string }> = {
  id: 'catalog.prices.create',
  async execute(rawInput, ctx) {
    const { parsed, custom } = parseWithCustomFields(priceCreateSchema, rawInput)
    const em = ctx.container.resolve<EntityManager>('em').fork()
    const variant = await requireVariant(em, parsed.variantId)
    const product =
      typeof variant.product === 'string'
        ? await requireProduct(em, variant.product)
        : variant.product
    ensureTenantScope(ctx, product.tenantId)
    ensureOrganizationScope(ctx, product.organizationId)

    const record = em.create(CatalogProductPrice, {
      organizationId: variant.organizationId,
      tenantId: variant.tenantId,
      variant,
      currencyCode: parsed.currencyCode,
      kind: parsed.kind ?? 'list',
      minQuantity: parsed.minQuantity ?? 1,
      maxQuantity: parsed.maxQuantity ?? null,
      unitPriceNet: toNumericString(parsed.unitPriceNet),
      unitPriceGross: toNumericString(parsed.unitPriceGross),
      taxRate: toNumericString(parsed.taxRate),
      metadata: parsed.metadata ? cloneJson(parsed.metadata) : null,
      startsAt: parsed.startsAt ?? null,
      endsAt: parsed.endsAt ?? null,
    })
    em.persist(record)
    await em.flush()
    await setCustomFieldsIfAny({
      dataEngine: ctx.container.resolve('dataEngine'),
      entityId: E.catalog.catalog_product_price,
      recordId: record.id,
      organizationId: record.organizationId,
      tenantId: record.tenantId,
      values: custom,
    })
    return { priceId: record.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = ctx.container.resolve<EntityManager>('em')
    return loadPriceSnapshot(em, result.priceId)
  },
  buildLog: async ({ result, snapshots }) => {
    const after = snapshots.after as PriceSnapshot | undefined
    if (!after) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('catalog.audit.prices.create', 'Create product price'),
      resourceKind: 'catalog.price',
      resourceId: result.priceId,
      tenantId: after.tenantId,
      organizationId: after.organizationId,
      snapshotAfter: after,
      payload: {
        undo: {
          after,
        } satisfies PriceUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<PriceUndoPayload>(logEntry)
    const after = payload?.after
    if (!after) return
    const em = ctx.container.resolve<EntityManager>('em').fork()
    const record = await em.findOne(CatalogProductPrice, { id: after.id })
    if (!record) return
    ensureTenantScope(ctx, record.tenantId)
    ensureOrganizationScope(ctx, record.organizationId)
    em.remove(record)
    await em.flush()
    const resetValues = buildCustomFieldResetMap(undefined, after.custom ?? undefined)
    if (Object.keys(resetValues).length) {
      await setCustomFieldsIfAny({
        dataEngine: ctx.container.resolve('dataEngine'),
        entityId: E.catalog.catalog_product_price,
        recordId: after.id,
        organizationId: after.organizationId,
        tenantId: after.tenantId,
        values: resetValues,
      })
    }
  },
}

const updatePriceCommand: CommandHandler<PriceUpdateInput, { priceId: string }> = {
  id: 'catalog.prices.update',
  async prepare(input, ctx) {
    const id = requireId(input, 'Price id is required')
    const em = ctx.container.resolve<EntityManager>('em')
    const snapshot = await loadPriceSnapshot(em, id)
    if (snapshot) {
      ensureTenantScope(ctx, snapshot.tenantId)
      ensureOrganizationScope(ctx, snapshot.organizationId)
    }
    return snapshot ? { before: snapshot } : {}
  },
  async execute(rawInput, ctx) {
    const { parsed, custom } = parseWithCustomFields(priceUpdateSchema, rawInput)
    const em = ctx.container.resolve<EntityManager>('em').fork()
    const record = await em.findOne(CatalogProductPrice, { id: parsed.id })
    if (!record) throw new CrudHttpError(404, { error: 'Catalog price not found' })
    const variant = record.variant as CatalogProductVariant | string
    const variantEntity =
      typeof variant === 'string' ? await requireVariant(em, variant) : variant
    const product =
      typeof variantEntity.product === 'string'
        ? await requireProduct(em, variantEntity.product)
        : variantEntity.product
    ensureTenantScope(ctx, product.tenantId)
    ensureOrganizationScope(ctx, product.organizationId)

    if (parsed.currencyCode !== undefined) record.currencyCode = parsed.currencyCode
    if (parsed.kind !== undefined) record.kind = parsed.kind
    if (parsed.minQuantity !== undefined) record.minQuantity = parsed.minQuantity ?? 1
    if (parsed.maxQuantity !== undefined) record.maxQuantity = parsed.maxQuantity ?? null
    if (Object.prototype.hasOwnProperty.call(parsed, 'unitPriceNet')) {
      record.unitPriceNet = toNumericString(parsed.unitPriceNet)
    }
    if (Object.prototype.hasOwnProperty.call(parsed, 'unitPriceGross')) {
      record.unitPriceGross = toNumericString(parsed.unitPriceGross)
    }
    if (Object.prototype.hasOwnProperty.call(parsed, 'taxRate')) {
      record.taxRate = toNumericString(parsed.taxRate)
    }
    if (parsed.metadata !== undefined) {
      record.metadata = parsed.metadata ? cloneJson(parsed.metadata) : null
    }
    if (Object.prototype.hasOwnProperty.call(parsed, 'startsAt')) {
      record.startsAt = parsed.startsAt ?? null
    }
    if (Object.prototype.hasOwnProperty.call(parsed, 'endsAt')) {
      record.endsAt = parsed.endsAt ?? null
    }
    await em.flush()
    if (custom && Object.keys(custom).length) {
      await setCustomFieldsIfAny({
        dataEngine: ctx.container.resolve('dataEngine'),
        entityId: E.catalog.catalog_product_price,
        recordId: record.id,
        organizationId: record.organizationId,
        tenantId: record.tenantId,
        values: custom,
      })
    }
    return { priceId: record.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = ctx.container.resolve<EntityManager>('em')
    return loadPriceSnapshot(em, result.priceId)
  },
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as PriceSnapshot | undefined
    const after = snapshots.after as PriceSnapshot | undefined
    if (!before || !after) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('catalog.audit.prices.update', 'Update product price'),
      resourceKind: 'catalog.price',
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      snapshotAfter: after,
      changes: buildChanges(before as Record<string, unknown>, after as Record<string, unknown>),
      payload: {
        undo: {
          before,
          after,
        } satisfies PriceUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<PriceUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const after = payload?.after
    const em = ctx.container.resolve<EntityManager>('em').fork()
    let record = await em.findOne(CatalogProductPrice, { id: before.id })
    if (!record) {
      const variant = await requireVariant(em, before.variantId)
      record = em.create(CatalogProductPrice, {
        id: before.id,
        variant,
        organizationId: before.organizationId,
        tenantId: before.tenantId,
      })
      em.persist(record)
    }
    ensureTenantScope(ctx, before.tenantId)
    ensureOrganizationScope(ctx, before.organizationId)
    applyPriceSnapshot(record, before)
    await em.flush()
    const resetValues = buildCustomFieldResetMap(
      before.custom ?? undefined,
      after?.custom ?? undefined
    )
    if (Object.keys(resetValues).length) {
      await setCustomFieldsIfAny({
        dataEngine: ctx.container.resolve('dataEngine'),
        entityId: E.catalog.catalog_product_price,
        recordId: before.id,
        organizationId: before.organizationId,
        tenantId: before.tenantId,
        values: resetValues,
      })
    }
  },
}

const deletePriceCommand: CommandHandler<
  { body?: Record<string, unknown>; query?: Record<string, unknown> },
  { priceId: string }
> = {
  id: 'catalog.prices.delete',
  async prepare(input, ctx) {
    const id = requireId(input, 'Price id is required')
    const em = ctx.container.resolve<EntityManager>('em')
    const snapshot = await loadPriceSnapshot(em, id)
    if (snapshot) {
      ensureTenantScope(ctx, snapshot.tenantId)
      ensureOrganizationScope(ctx, snapshot.organizationId)
    }
    return snapshot ? { before: snapshot } : {}
  },
  async execute(input, ctx) {
    const id = requireId(input, 'Price id is required')
    const em = ctx.container.resolve<EntityManager>('em').fork()
    const record = await em.findOne(CatalogProductPrice, { id })
    if (!record) throw new CrudHttpError(404, { error: 'Catalog price not found' })
    const variant = record.variant as CatalogProductVariant | string
    const variantEntity =
      typeof variant === 'string' ? await requireVariant(em, variant) : variant
    const product =
      typeof variantEntity.product === 'string'
        ? await requireProduct(em, variantEntity.product)
        : variantEntity.product
    ensureTenantScope(ctx, product.tenantId)
    ensureOrganizationScope(ctx, product.organizationId)

    const baseEm = ctx.container.resolve<EntityManager>('em')
    const snapshot = await loadPriceSnapshot(baseEm, id)

    em.remove(record)
    await em.flush()
    if (snapshot?.custom && Object.keys(snapshot.custom).length) {
      const resetValues = buildCustomFieldResetMap(snapshot.custom, null)
      if (Object.keys(resetValues).length) {
        await setCustomFieldsIfAny({
          dataEngine: ctx.container.resolve('dataEngine'),
          entityId: E.catalog.catalog_product_price,
          recordId: id,
          organizationId: snapshot.organizationId,
          tenantId: snapshot.tenantId,
          values: resetValues,
        })
      }
    }
    return { priceId: id }
  },
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as PriceSnapshot | undefined
    if (!before) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('catalog.audit.prices.delete', 'Delete product price'),
      resourceKind: 'catalog.price',
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
    const em = ctx.container.resolve<EntityManager>('em').fork()
    let record = await em.findOne(CatalogProductPrice, { id: before.id })
    if (!record) {
      const variant = await requireVariant(em, before.variantId)
      record = em.create(CatalogProductPrice, {
        id: before.id,
        variant,
        organizationId: before.organizationId,
        tenantId: before.tenantId,
      })
      em.persist(record)
    }
    ensureTenantScope(ctx, before.tenantId)
    ensureOrganizationScope(ctx, before.organizationId)
    applyPriceSnapshot(record, before)
    await em.flush()
    if (before.custom && Object.keys(before.custom).length) {
      await setCustomFieldsIfAny({
        dataEngine: ctx.container.resolve('dataEngine'),
        entityId: E.catalog.catalog_product_price,
        recordId: before.id,
        organizationId: before.organizationId,
        tenantId: before.tenantId,
        values: before.custom,
      })
    }
  },
}

registerCommand(createPriceCommand)
registerCommand(updatePriceCommand)
registerCommand(deletePriceCommand)
