import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { buildChanges, requireId, parseWithCustomFields, setCustomFieldsIfAny } from '@open-mercato/shared/lib/commands/helpers'
import type { EntityManager } from '@mikro-orm/postgresql'
import { UniqueConstraintViolationException } from '@mikro-orm/core'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { loadCustomFieldSnapshot, buildCustomFieldResetMap } from '@open-mercato/shared/lib/commands/customFieldSnapshots'
import { E } from '@open-mercato/core/generated/entities.ids.generated'
import {
  CatalogOffer,
  CatalogProduct,
  CatalogProductOption,
  CatalogProductVariant,
  CatalogOptionSchemaTemplate,
} from '../data/entities'
import {
  productCreateSchema,
  productUpdateSchema,
  type OfferInput,
  type ProductCreateInput,
  type ProductUpdateInput,
} from '../data/validators'
import type {
  CatalogOfferLocalizedContent,
  CatalogProductType,
} from '../data/types'
import {
  cloneJson,
  ensureOrganizationScope,
  ensureSameScope,
  ensureTenantScope,
  extractUndoPayload,
  requireOptionSchemaTemplate,
} from './shared'

type ProductSnapshot = {
  id: string
  organizationId: string
  tenantId: string
  title: string
  subtitle: string | null
  description: string | null
  sku: string | null
  handle: string | null
  productType: CatalogProductType
  statusEntryId: string | null
  primaryCurrencyCode: string | null
  defaultUnit: string | null
  defaultAttachmentId: string | null
  optionSchemaId: string | null
  customFieldsetCode: string | null
  metadata: Record<string, unknown> | null
  isConfigurable: boolean
  isActive: boolean
  createdAt: string
  updatedAt: string
  offers: OfferSnapshot[]
  custom: Record<string, unknown> | null
}

type ProductUndoPayload = {
  before?: ProductSnapshot | null
  after?: ProductSnapshot | null
}

type OfferSnapshot = {
  id: string
  channelId: string
  title: string
  description: string | null
  localizedContent: CatalogOfferLocalizedContent | null
  metadata: Record<string, unknown> | null
  isActive: boolean
}

const PRODUCT_CHANGE_KEYS = [
  'title',
  'subtitle',
  'description',
  'sku',
  'handle',
  'productType',
  'statusEntryId',
  'primaryCurrencyCode',
  'defaultUnit',
  'defaultAttachmentId',
  'optionSchemaId',
  'customFieldsetCode',
  'metadata',
  'isConfigurable',
  'isActive',
] as const satisfies readonly string[]

function cloneOfferContent(value: CatalogOfferLocalizedContent | null | undefined): CatalogOfferLocalizedContent | null {
  return value ? cloneJson(value) : null
}

function serializeOffer(record: CatalogOffer): OfferSnapshot {
  return {
    id: record.id,
    channelId: record.channelId,
    title: record.title,
    description: record.description ?? null,
    localizedContent: cloneOfferContent(record.localizedContent ?? null),
    metadata: record.metadata ? cloneJson(record.metadata) : null,
    isActive: record.isActive,
  }
}

async function loadOfferSnapshots(em: EntityManager, productId: string): Promise<OfferSnapshot[]> {
  const offerRecords = await em.find(
    CatalogOffer,
    { product: productId },
    { orderBy: { createdAt: 'asc' } }
  )
  return offerRecords.map((offer) => serializeOffer(offer))
}

async function restoreOffersFromSnapshot(
  em: EntityManager,
  product: CatalogProduct,
  snapshot: OfferSnapshot[] | null | undefined
): Promise<void> {
  const existing = await em.find(CatalogOffer, { product })
  const keepIds = new Set<string>()
  const list = Array.isArray(snapshot) ? snapshot : []
  for (const offer of existing) {
    if (!list.some((snap) => snap.id === offer.id)) {
      em.remove(offer)
    } else {
      keepIds.add(offer.id)
    }
  }
  for (const snap of list) {
    let target = existing.find((entry) => entry.id === snap.id)
    if (!target) {
      target = em.create(CatalogOffer, {
        id: snap.id,
        product,
        organizationId: product.organizationId,
        tenantId: product.tenantId,
        channelId: snap.channelId,
        title: snap.title,
        isActive: snap.isActive,
      })
      em.persist(target)
    }
    target.channelId = snap.channelId
    target.title = snap.title
    target.description = snap.description ?? null
    target.localizedContent = cloneOfferContent(snap.localizedContent)
    target.metadata = snap.metadata ? cloneJson(snap.metadata) : null
    target.isActive = snap.isActive
    keepIds.add(target.id)
  }
  const toRemove = existing.filter((offer) => !keepIds.has(offer.id))
  if (toRemove.length) {
    for (const offer of toRemove) {
      em.remove(offer)
    }
  }
}

async function syncOffers(
  em: EntityManager,
  product: CatalogProduct,
  inputs: OfferInput[] | undefined
): Promise<void> {
  if (!inputs) return
  const normalized = inputs
    .map((input) => ({
      ...input,
      title: input.title?.trim().length ? input.title.trim() : product.title,
      description:
        input.description != null && input.description.trim().length
          ? input.description.trim()
          : product.description ?? null,
      localizedContent: cloneOfferContent(input.localizedContent ?? null),
      metadata: input.metadata ? cloneJson(input.metadata) : null,
      isActive: input.isActive !== false,
    }))
  const existing = await em.find(CatalogOffer, { product })
  const claimed = new Set<string>()
  const channelMap = new Map<string, CatalogOffer>()
  for (const offer of existing) {
    channelMap.set(offer.channelId, offer)
  }
  const updates: CatalogOffer[] = []
  for (const input of normalized) {
    if (!input.channelId) continue
    let target: CatalogOffer | undefined
    if (input.id) {
      target = existing.find((item) => item.id === input.id)
    }
    if (!target) {
      const existingByChannel = channelMap.get(input.channelId)
      if (existingByChannel && !claimed.has(existingByChannel.id)) {
        target = existingByChannel
      }
    }
    if (!target) {
      target = em.create(CatalogOffer, {
        product,
        organizationId: product.organizationId,
        tenantId: product.tenantId,
        channelId: input.channelId,
        title: input.title || product.title,
        isActive: input.isActive !== false,
      })
      em.persist(target)
      existing.push(target)
      channelMap.set(input.channelId, target)
    }
    target.channelId = input.channelId
    target.title = input.title || product.title
    target.description = input.description ?? null
    target.localizedContent = cloneOfferContent(input.localizedContent)
    target.metadata = input.metadata ? cloneJson(input.metadata) : null
    target.isActive = input.isActive !== false
    claimed.add(target.id)
    updates.push(target)
  }
  const toRemove = existing.filter((offer) => !claimed.has(offer.id))
  for (const offer of toRemove) {
    em.remove(offer)
  }
}

async function loadProductSnapshot(
  em: EntityManager,
  id: string
): Promise<ProductSnapshot | null> {
  const record = await em.findOne(
    CatalogProduct,
    { id, deletedAt: null },
    { populate: ['optionSchemaTemplate'] }
  )
  if (!record) return null
  const offers = await loadOfferSnapshots(em, record.id)
  const custom = await loadCustomFieldSnapshot(em, {
    entityId: E.catalog.catalog_product,
    recordId: record.id,
    tenantId: record.tenantId,
    organizationId: record.organizationId,
  })
  const optionSchemaTemplate = record.optionSchemaTemplate
  const optionTemplateId =
    typeof optionSchemaTemplate === 'string'
      ? optionSchemaTemplate
      : optionSchemaTemplate?.id ?? null
  return {
    id: record.id,
    organizationId: record.organizationId,
    tenantId: record.tenantId,
    title: record.title,
    subtitle: record.subtitle ?? null,
    description: record.description ?? null,
    sku: record.sku ?? null,
    handle: record.handle ?? null,
    productType: record.productType,
    statusEntryId: record.statusEntryId ?? null,
    primaryCurrencyCode: record.primaryCurrencyCode ?? null,
    defaultUnit: record.defaultUnit ?? null,
    defaultAttachmentId: record.defaultAttachmentId ?? null,
    customFieldsetCode: record.customFieldsetCode ?? null,
    metadata: record.metadata ? cloneJson(record.metadata) : null,
    isConfigurable: record.isConfigurable,
    isActive: record.isActive,
    optionSchemaId: optionTemplateId,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    offers,
    custom: Object.keys(custom).length ? custom : null,
  }
}

function applyProductSnapshot(
  em: EntityManager,
  record: CatalogProduct,
  snapshot: ProductSnapshot
): void {
  record.organizationId = snapshot.organizationId
  record.tenantId = snapshot.tenantId
  record.title = snapshot.title
  record.subtitle = snapshot.subtitle ?? null
  record.description = snapshot.description ?? null
  record.sku = snapshot.sku ?? null
  record.handle = snapshot.handle ?? null
  record.productType = snapshot.productType
  record.statusEntryId = snapshot.statusEntryId ?? null
  record.primaryCurrencyCode = snapshot.primaryCurrencyCode ?? null
  record.defaultUnit = snapshot.defaultUnit ?? null
  record.defaultAttachmentId = snapshot.defaultAttachmentId ?? null
  record.metadata = snapshot.metadata ? cloneJson(snapshot.metadata) : null
  record.customFieldsetCode = snapshot.customFieldsetCode ?? null
  record.optionSchemaTemplate = snapshot.optionSchemaId
    ? em.getReference(CatalogOptionSchemaTemplate, snapshot.optionSchemaId)
    : null
  record.isConfigurable = snapshot.isConfigurable
  record.isActive = snapshot.isActive
  record.createdAt = new Date(snapshot.createdAt)
  record.updatedAt = new Date(snapshot.updatedAt)
}

const createProductCommand: CommandHandler<ProductCreateInput, { productId: string }> = {
  id: 'catalog.products.create',
  async execute(rawInput, ctx) {
    const { parsed, custom } = parseWithCustomFields(productCreateSchema, rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const now = new Date()
    let optionSchemaTemplate: CatalogOptionSchemaTemplate | null = null
    if (parsed.optionSchemaId) {
      optionSchemaTemplate = await requireOptionSchemaTemplate(
        em,
        parsed.optionSchemaId,
        'Option schema not found'
      )
      ensureSameScope(optionSchemaTemplate, parsed.organizationId, parsed.tenantId)
    }
    const record = em.create(CatalogProduct, {
      organizationId: parsed.organizationId,
      tenantId: parsed.tenantId,
      title: parsed.title,
      subtitle: parsed.subtitle ?? null,
      description: parsed.description ?? null,
      sku: parsed.sku ?? null,
      handle: parsed.handle ?? null,
      productType: parsed.productType ?? 'simple',
      statusEntryId: parsed.statusEntryId ?? null,
      primaryCurrencyCode: parsed.primaryCurrencyCode ?? null,
      defaultUnit: parsed.defaultUnit ?? null,
      defaultAttachmentId: parsed.defaultAttachmentId ?? null,
      metadata: parsed.metadata ? cloneJson(parsed.metadata) : null,
      customFieldsetCode: parsed.customFieldsetCode ?? null,
      optionSchemaTemplate,
      isConfigurable: parsed.isConfigurable ?? false,
      isActive: parsed.isActive ?? true,
      createdAt: now,
      updatedAt: now,
    })
    em.persist(record)
    try {
      await em.flush()
    } catch (error) {
      await rethrowProductUniqueConstraint(error)
    }
    await syncOffers(em, record, parsed.offers)
    try {
      await em.flush()
    } catch (error) {
      await rethrowProductUniqueConstraint(error)
    }
    await setCustomFieldsIfAny({
      dataEngine: ctx.container.resolve('dataEngine'),
      entityId: E.catalog.catalog_product,
      recordId: record.id,
      organizationId: record.organizationId,
      tenantId: record.tenantId,
      values: custom,
    })
    return { productId: record.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager)
    return loadProductSnapshot(em, result.productId)
  },
  buildLog: async ({ result, ctx }) => {
    const em = (ctx.container.resolve('em') as EntityManager)
    const after = await loadProductSnapshot(em, result.productId)
    if (!after) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('catalog.audit.products.create', 'Create catalog product'),
      resourceKind: 'catalog.product',
      resourceId: result.productId,
      tenantId: after.tenantId,
      organizationId: after.organizationId,
      snapshotAfter: after,
      payload: {
        undo: {
          after,
        } satisfies ProductUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<ProductUndoPayload>(logEntry)
    const after = payload?.after
    if (!after) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(CatalogProduct, { id: after.id })
    if (!record) return
    ensureTenantScope(ctx, record.tenantId)
    ensureOrganizationScope(ctx, record.organizationId)
    em.remove(record)
    await em.flush()
    const resetValues = buildCustomFieldResetMap(undefined, after.custom ?? undefined)
    if (Object.keys(resetValues).length) {
      await setCustomFieldsIfAny({
        dataEngine: ctx.container.resolve('dataEngine'),
        entityId: E.catalog.catalog_product,
        recordId: after.id,
        organizationId: after.organizationId,
        tenantId: after.tenantId,
        values: resetValues,
      })
    }
  },
}

const updateProductCommand: CommandHandler<ProductUpdateInput, { productId: string }> = {
  id: 'catalog.products.update',
  async prepare(input, ctx) {
    const id = requireId(input, 'Product id is required')
    const em = (ctx.container.resolve('em') as EntityManager)
    const snapshot = await loadProductSnapshot(em, id)
    if (snapshot) {
      ensureTenantScope(ctx, snapshot.tenantId)
      ensureOrganizationScope(ctx, snapshot.organizationId)
    }
    return snapshot ? { before: snapshot } : {}
  },
  async execute(rawInput, ctx) {
    const { parsed, custom } = parseWithCustomFields(productUpdateSchema, rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(CatalogProduct, { id: parsed.id, deletedAt: null })
    if (!record) throw new CrudHttpError(404, { error: 'Catalog product not found' })
    const organizationId = parsed.organizationId ?? record.organizationId
    const tenantId = parsed.tenantId ?? record.tenantId
    ensureTenantScope(ctx, tenantId)
    ensureOrganizationScope(ctx, organizationId)
    ensureSameScope(record, organizationId, tenantId)
    record.organizationId = organizationId
    record.tenantId = tenantId

    if (parsed.title !== undefined) record.title = parsed.title
    if (parsed.subtitle !== undefined) record.subtitle = parsed.subtitle ?? null
    if (parsed.description !== undefined) record.description = parsed.description ?? null
    if (parsed.sku !== undefined) record.sku = parsed.sku ?? null
    if (parsed.handle !== undefined) record.handle = parsed.handle ?? null
    if (parsed.productType !== undefined) record.productType = parsed.productType
    if (parsed.statusEntryId !== undefined) record.statusEntryId = parsed.statusEntryId ?? null
    if (parsed.primaryCurrencyCode !== undefined) {
      record.primaryCurrencyCode = parsed.primaryCurrencyCode ?? null
    }
    if (parsed.defaultUnit !== undefined) record.defaultUnit = parsed.defaultUnit ?? null
    if (parsed.defaultAttachmentId !== undefined) {
      record.defaultAttachmentId = parsed.defaultAttachmentId ?? null
    }
    if (parsed.metadata !== undefined) {
      record.metadata = parsed.metadata ? cloneJson(parsed.metadata) : null
    }
    if (parsed.optionSchemaId !== undefined) {
      if (!parsed.optionSchemaId) {
        record.optionSchemaTemplate = null
      } else {
        const optionTemplate = await requireOptionSchemaTemplate(
          em,
          parsed.optionSchemaId,
          'Option schema not found'
        )
        ensureSameScope(optionTemplate, organizationId, tenantId)
        record.optionSchemaTemplate = optionTemplate
      }
    }
    if (parsed.customFieldsetCode !== undefined) {
      record.customFieldsetCode = parsed.customFieldsetCode ?? null
    }
    if (parsed.isConfigurable !== undefined) record.isConfigurable = parsed.isConfigurable
    if (parsed.isActive !== undefined) record.isActive = parsed.isActive
    await syncOffers(em, record, parsed.offers)
    try {
      await em.flush()
    } catch (error) {
      await rethrowProductUniqueConstraint(error)
    }
    if (custom && Object.keys(custom).length) {
      await setCustomFieldsIfAny({
        dataEngine: ctx.container.resolve('dataEngine'),
        entityId: E.catalog.catalog_product,
        recordId: record.id,
        organizationId: record.organizationId,
        tenantId: record.tenantId,
        values: custom,
      })
    }
    return { productId: record.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager)
    return loadProductSnapshot(em, result.productId)
  },
  buildLog: async ({ result, ctx, snapshots }) => {
    const before = snapshots.before as ProductSnapshot | undefined
    const em = (ctx.container.resolve('em') as EntityManager)
    const after = await loadProductSnapshot(em, result.productId)
    if (!before || !after) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('catalog.audit.products.update', 'Update catalog product'),
      resourceKind: 'catalog.product',
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      snapshotAfter: after,
      changes: buildChanges(
        before as Record<string, unknown>,
        after as Record<string, unknown>,
        PRODUCT_CHANGE_KEYS
      ),
      payload: {
        undo: {
          before,
          after,
        } satisfies ProductUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<ProductUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    let record = await em.findOne(CatalogProduct, { id: before.id })
    if (!record) {
      record = em.create(CatalogProduct, {
        id: before.id,
        organizationId: before.organizationId,
        tenantId: before.tenantId,
        title: before.title,
        subtitle: before.subtitle ?? null,
        description: before.description ?? null,
        sku: before.sku ?? null,
        handle: before.handle ?? null,
        statusEntryId: before.statusEntryId ?? null,
        primaryCurrencyCode: before.primaryCurrencyCode ?? null,
        defaultUnit: before.defaultUnit ?? null,
        metadata: before.metadata ? cloneJson(before.metadata) : null,
        customFieldsetCode: before.customFieldsetCode ?? null,
        optionSchemaTemplate: before.optionSchemaId
          ? em.getReference(CatalogOptionSchemaTemplate, before.optionSchemaId)
          : null,
        productType: before.productType ?? 'simple',
        isConfigurable: before.isConfigurable,
        isActive: before.isActive,
        createdAt: new Date(before.createdAt),
        updatedAt: new Date(before.updatedAt),
      })
      em.persist(record)
    }
    ensureTenantScope(ctx, before.tenantId)
    ensureOrganizationScope(ctx, before.organizationId)
    applyProductSnapshot(em, record, before)
    await restoreOffersFromSnapshot(em, record, before.offers)
    await em.flush()
    const resetValues = buildCustomFieldResetMap(before.custom ?? undefined, payload?.after?.custom ?? undefined)
    if (Object.keys(resetValues).length) {
      await setCustomFieldsIfAny({
        dataEngine: ctx.container.resolve('dataEngine'),
        entityId: E.catalog.catalog_product,
        recordId: before.id,
        organizationId: before.organizationId,
        tenantId: before.tenantId,
        values: resetValues,
      })
    }
  },
}

const deleteProductCommand: CommandHandler<
  { body?: Record<string, unknown>; query?: Record<string, unknown> },
  { productId: string }
> = {
  id: 'catalog.products.delete',
  async prepare(input, ctx) {
    const id = requireId(input, 'Product id is required')
    const em = (ctx.container.resolve('em') as EntityManager)
    const snapshot = await loadProductSnapshot(em, id)
    if (snapshot) {
      ensureTenantScope(ctx, snapshot.tenantId)
      ensureOrganizationScope(ctx, snapshot.organizationId)
    }
    return snapshot ? { before: snapshot } : {}
  },
  async execute(input, ctx) {
    const id = requireId(input, 'Product id is required')
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(CatalogProduct, { id })
    if (!record) throw new CrudHttpError(404, { error: 'Catalog product not found' })
    const baseEm = (ctx.container.resolve('em') as EntityManager)
    const snapshot = await loadProductSnapshot(baseEm, id)
    ensureTenantScope(ctx, record.tenantId)
    ensureOrganizationScope(ctx, record.organizationId)
    const variantCount = await em.count(CatalogProductVariant, { product: record })
    if (variantCount > 0) {
      throw new CrudHttpError(400, { error: 'Remove product variants before deleting the product.' })
    }
    const optionCount = await em.count(CatalogProductOption, { product: record })
    if (optionCount > 0) {
      throw new CrudHttpError(400, { error: 'Remove product options before deleting the product.' })
    }
    em.remove(record)
    await em.flush()
    if (snapshot?.custom && Object.keys(snapshot.custom).length) {
      const resetValues = buildCustomFieldResetMap(snapshot.custom, undefined)
      if (Object.keys(resetValues).length) {
        await setCustomFieldsIfAny({
          dataEngine: ctx.container.resolve('dataEngine'),
          entityId: E.catalog.catalog_product,
          recordId: id,
          organizationId: record.organizationId,
          tenantId: record.tenantId,
          values: resetValues,
        })
      }
    }
    return { productId: id }
  },
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as ProductSnapshot | undefined
    if (!before) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('catalog.audit.products.delete', 'Delete catalog product'),
      resourceKind: 'catalog.product',
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      payload: {
        undo: {
          before,
        } satisfies ProductUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<ProductUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    let record = await em.findOne(CatalogProduct, { id: before.id })
    if (!record) {
      record = em.create(CatalogProduct, {
        id: before.id,
        organizationId: before.organizationId,
        tenantId: before.tenantId,
        title: before.title,
        subtitle: before.subtitle ?? null,
        description: before.description ?? null,
        sku: before.sku ?? null,
        handle: before.handle ?? null,
        statusEntryId: before.statusEntryId ?? null,
        primaryCurrencyCode: before.primaryCurrencyCode ?? null,
        defaultUnit: before.defaultUnit ?? null,
        metadata: before.metadata ? cloneJson(before.metadata) : null,
        customFieldsetCode: before.customFieldsetCode ?? null,
        optionSchemaTemplate: before.optionSchemaId
          ? em.getReference(CatalogOptionSchemaTemplate, before.optionSchemaId)
          : null,
        productType: before.productType ?? 'simple',
        isConfigurable: before.isConfigurable,
        isActive: before.isActive,
        createdAt: new Date(before.createdAt),
        updatedAt: new Date(before.updatedAt),
      })
      em.persist(record)
    }
    ensureTenantScope(ctx, before.tenantId)
    ensureOrganizationScope(ctx, before.organizationId)
    applyProductSnapshot(em, record, before)
    await restoreOffersFromSnapshot(em, record, before.offers)
    await em.flush()
    if (before.custom && Object.keys(before.custom).length) {
      await setCustomFieldsIfAny({
        dataEngine: ctx.container.resolve('dataEngine'),
        entityId: E.catalog.catalog_product,
        recordId: before.id,
        organizationId: before.organizationId,
        tenantId: before.tenantId,
        values: before.custom,
      })
    }
  },
}

registerCommand(createProductCommand)
registerCommand(updateProductCommand)
registerCommand(deleteProductCommand)

function resolveProductUniqueConstraint(error: unknown): 'handle' | 'sku' | null {
  if (!(error instanceof UniqueConstraintViolationException)) return null
  const constraint = typeof (error as { constraint?: string }).constraint === 'string'
    ? (error as { constraint?: string }).constraint
    : null
  if (constraint === 'catalog_products_handle_scope_unique') return 'handle'
  if (constraint === 'catalog_products_sku_scope_unique') return 'sku'
  const message = typeof (error as { message?: string }).message === 'string'
    ? (error as { message?: string }).message
    : ''
  const normalized = message.toLowerCase()
  if (
    normalized.includes('catalog_products_handle_scope_unique') ||
    normalized.includes(' handle')
  ) {
    return 'handle'
  }
  if (
    normalized.includes('catalog_products_sku_scope_unique') ||
    normalized.includes(' sku')
  ) {
    return 'sku'
  }
  return null
}

async function rethrowProductUniqueConstraint(error: unknown): Promise<never> {
  const target = resolveProductUniqueConstraint(error)
  if (target === 'handle') await throwDuplicateHandleError()
  if (target === 'sku') await throwDuplicateSkuError()
  throw error
}

async function throwDuplicateHandleError(): Promise<never> {
  const { translate } = await resolveTranslations()
  const message = translate('catalog.products.errors.handleExists', 'Handle already in use.')
  throw new CrudHttpError(400, {
    error: message,
    fieldErrors: { handle: message },
    details: [{ path: ['handle'], message, code: 'duplicate', origin: 'validation' }],
  })
}

async function throwDuplicateSkuError(): Promise<never> {
  const { translate } = await resolveTranslations()
  const message = translate('catalog.products.errors.skuExists', 'SKU already in use.')
  throw new CrudHttpError(400, {
    error: message,
    fieldErrors: { sku: message },
    details: [{ path: ['sku'], message, code: 'duplicate', origin: 'validation' }],
  })
}
