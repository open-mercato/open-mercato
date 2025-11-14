import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { buildChanges, requireId, parseWithCustomFields, setCustomFieldsIfAny } from '@open-mercato/shared/lib/commands/helpers'
import type { EntityManager } from '@mikro-orm/postgresql'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { loadCustomFieldSnapshot, buildCustomFieldResetMap } from '@open-mercato/shared/lib/commands/customFieldSnapshots'
import { E } from '@open-mercato/core/generated/entities.ids.generated'
import {
  CatalogOffer,
  CatalogProduct,
  CatalogProductOption,
  CatalogProductVariant,
  CatalogProductRelation,
  CatalogAttributeSchemaTemplate,
} from '../data/entities'
import {
  productCreateSchema,
  productUpdateSchema,
  type OfferInput,
  type ProductCreateInput,
  type ProductUpdateInput,
} from '../data/validators'
import type {
  CatalogAttributeSchema,
  CatalogAttributeSchemaSource,
  CatalogOfferLocalizedContent,
  CatalogProductType,
} from '../data/types'
import {
  cloneJson,
  ensureOrganizationScope,
  ensureSameScope,
  ensureTenantScope,
  extractUndoPayload,
  requireAttributeSchemaTemplate,
  requireProduct,
} from './shared'
import { resolveAttributeSchema } from '../lib/attributeSchemas'

type ProductSnapshot = {
  id: string
  organizationId: string
  tenantId: string
  name: string
  description: string | null
  code: string | null
  productType: CatalogProductType
  statusEntryId: string | null
  primaryCurrencyCode: string | null
  defaultUnit: string | null
  metadata: Record<string, unknown> | null
  attributeSchemaId: string | null
  attributeSchemaOverride: CatalogAttributeSchema | null
  attributeSchemaSource: CatalogAttributeSchemaSource | null
  attributeSchema: CatalogAttributeSchema | null
  attributeValues: Record<string, unknown> | null
  isConfigurable: boolean
  isActive: boolean
  createdAt: string
  updatedAt: string
  offers: OfferSnapshot[]
  relations: ProductRelationSnapshot[]
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

type ProductRelationSnapshot = {
  id: string
  childProductId: string
  relationType: 'bundle' | 'grouped'
  isRequired: boolean
  minQuantity: number | null
  maxQuantity: number | null
  position: number
  metadata: Record<string, unknown> | null
}

type ProductRelationInput = NonNullable<ProductCreateInput['subproducts']>[number]

const PRODUCT_CHANGE_KEYS = [
  'name',
  'description',
  'code',
  'productType',
  'statusEntryId',
  'primaryCurrencyCode',
  'defaultUnit',
  'attributeSchemaId',
  'attributeSchema',
  'attributeValues',
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

async function loadRelationSnapshots(
  em: EntityManager,
  productId: string
): Promise<ProductRelationSnapshot[]> {
  const records = await em.find(
    CatalogProductRelation,
    { parent: productId },
    { orderBy: { position: 'asc', createdAt: 'asc' } }
  )
  return records.map((relation) => ({
    id: relation.id,
    childProductId:
      typeof relation.child === 'string' ? relation.child : relation.child.id,
    relationType: relation.relationType,
    isRequired: relation.isRequired,
    minQuantity: relation.minQuantity ?? null,
    maxQuantity: relation.maxQuantity ?? null,
    position: relation.position,
    metadata: relation.metadata ? cloneJson(relation.metadata) : null,
  }))
}

async function restoreRelationsFromSnapshot(
  em: EntityManager,
  product: CatalogProduct,
  snapshot: ProductRelationSnapshot[] | null | undefined
): Promise<void> {
  const existing = await em.find(CatalogProductRelation, { parent: product })
  const keepIds = new Set<string>()
  const list = Array.isArray(snapshot) ? snapshot : []
  for (const entry of list) {
    if (!entry.childProductId) continue
    const child = await em.findOne(CatalogProduct, {
      id: entry.childProductId,
      deletedAt: null,
    })
    if (!child) continue
    ensureSameScope(child, product.organizationId, product.tenantId)
    let relation = existing.find((item) => item.id === entry.id)
    if (!relation) {
      relation = em.create(CatalogProductRelation, {
        id: entry.id,
        parent: product,
        child,
        organizationId: product.organizationId,
        tenantId: product.tenantId,
        relationType: entry.relationType,
      })
      em.persist(relation)
      existing.push(relation)
    } else {
      relation.child = child
    }
    relation.relationType = entry.relationType
    relation.isRequired = entry.isRequired
    relation.minQuantity = entry.minQuantity
    relation.maxQuantity = entry.maxQuantity
    relation.position = entry.position
    relation.metadata = entry.metadata ? cloneJson(entry.metadata) : null
    keepIds.add(relation.id)
  }
  const toRemove = existing.filter((relation) => !keepIds.has(relation.id))
  for (const relation of toRemove) {
    em.remove(relation)
  }
}

async function syncProductRelations(
  em: EntityManager,
  product: CatalogProduct,
  inputs: ProductRelationInput[] | undefined
): Promise<void> {
  if (inputs === undefined) return
  const normalized = Array.isArray(inputs) ? inputs : []
  const existing = await em.find(CatalogProductRelation, { parent: product })
  const keyed = new Map<string, CatalogProductRelation>()
  for (const relation of existing) {
    const childId = typeof relation.child === 'string' ? relation.child : relation.child.id
    const key = `${childId}:${relation.relationType}`
    keyed.set(key, relation)
  }
  const keepIds = new Set<string>()
  for (let index = 0; index < normalized.length; index++) {
    const input = normalized[index]
    if (!input || !input.childProductId) continue
    if (input.childProductId === product.id) continue
    const relationType =
      input.relationType ?? (product.productType === 'bundle' ? 'bundle' : 'grouped')
    const key = `${input.childProductId}:${relationType}`
    let relation = keyed.get(key)
    if (!relation) {
      const child = await requireProduct(em, input.childProductId, 'Subproduct not found')
      ensureSameScope(child, product.organizationId, product.tenantId)
      relation = em.create(CatalogProductRelation, {
        parent: product,
        child,
        organizationId: product.organizationId,
        tenantId: product.tenantId,
        relationType,
      })
      em.persist(relation)
      existing.push(relation)
      keyed.set(key, relation)
    }
    relation.relationType = relationType
    relation.isRequired = input.isRequired ?? false
    relation.minQuantity =
      input.minQuantity !== undefined && input.minQuantity !== null
        ? Number(input.minQuantity)
        : null
    relation.maxQuantity =
      input.maxQuantity !== undefined && input.maxQuantity !== null
        ? Number(input.maxQuantity)
        : null
    relation.position =
      input.position !== undefined && input.position !== null
        ? Number(input.position)
        : index
    relation.metadata = input.metadata ? cloneJson(input.metadata) : null
    keepIds.add(relation.id)
  }
  const toRemove = existing.filter((relation) => !keepIds.has(relation.id))
  for (const relation of toRemove) {
    em.remove(relation)
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
      title: input.title?.trim().length ? input.title.trim() : product.name,
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
        title: input.title || product.name,
      })
      em.persist(target)
      existing.push(target)
      channelMap.set(input.channelId, target)
    }
    target.channelId = input.channelId
    target.title = input.title || product.name
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
    { populate: ['attributeSchemaTemplate'] }
  )
  if (!record) return null
  const offers = await loadOfferSnapshots(em, record.id)
  const relations = await loadRelationSnapshots(em, record.id)
  const custom = await loadCustomFieldSnapshot(em, {
    entityId: E.catalog.catalog_product,
    recordId: record.id,
    tenantId: record.tenantId,
    organizationId: record.organizationId,
  })
  const schemaTemplate = record.attributeSchemaTemplate
  const templateId =
    typeof schemaTemplate === 'string'
      ? schemaTemplate
      : schemaTemplate?.id ?? null
  const templateSource =
    schemaTemplate && typeof schemaTemplate !== 'string'
      ? {
          id: schemaTemplate.id,
          name: schemaTemplate.name,
          code: schemaTemplate.code,
          description: schemaTemplate.description ?? null,
          schema: schemaTemplate.schema ? cloneJson(schemaTemplate.schema) : null,
        }
      : null
  const override = record.attributeSchema ? cloneJson(record.attributeSchema) : null
  const resolvedSchema = resolveAttributeSchema(templateSource?.schema ?? null, override)
  return {
    id: record.id,
    organizationId: record.organizationId,
    tenantId: record.tenantId,
    name: record.name,
    description: record.description ?? null,
    code: record.code ?? null,
    productType: record.productType,
    statusEntryId: record.statusEntryId ?? null,
    primaryCurrencyCode: record.primaryCurrencyCode ?? null,
    defaultUnit: record.defaultUnit ?? null,
    metadata: record.metadata ? cloneJson(record.metadata) : null,
    attributeSchemaId: templateId,
    attributeSchemaOverride: override,
    attributeSchemaSource: templateSource,
    attributeSchema: resolvedSchema,
    attributeValues: record.attributeValues ? cloneJson(record.attributeValues) : null,
    isConfigurable: record.isConfigurable,
    isActive: record.isActive,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    offers,
    relations,
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
  record.name = snapshot.name
  record.description = snapshot.description ?? null
  record.code = snapshot.code ?? null
  record.productType = snapshot.productType
  record.statusEntryId = snapshot.statusEntryId ?? null
  record.primaryCurrencyCode = snapshot.primaryCurrencyCode ?? null
  record.defaultUnit = snapshot.defaultUnit ?? null
  record.metadata = snapshot.metadata ? cloneJson(snapshot.metadata) : null
  record.attributeSchema =
    snapshot.attributeSchemaOverride ? cloneJson(snapshot.attributeSchemaOverride) : null
  record.attributeSchemaTemplate = snapshot.attributeSchemaId
    ? em.getReference(CatalogAttributeSchemaTemplate, snapshot.attributeSchemaId)
    : null
  record.attributeValues = snapshot.attributeValues ? cloneJson(snapshot.attributeValues) : null
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
    let schemaTemplate: CatalogAttributeSchemaTemplate | null = null
    if (parsed.attributeSchemaId) {
      schemaTemplate = await requireAttributeSchemaTemplate(
        em,
        parsed.attributeSchemaId,
        'Attribute schema not found'
      )
      ensureSameScope(schemaTemplate, parsed.organizationId, parsed.tenantId)
    }
    const record = em.create(CatalogProduct, {
      organizationId: parsed.organizationId,
      tenantId: parsed.tenantId,
      name: parsed.name,
      description: parsed.description ?? null,
      code: parsed.code ?? null,
      productType: parsed.productType ?? 'simple',
      statusEntryId: parsed.statusEntryId ?? null,
      primaryCurrencyCode: parsed.primaryCurrencyCode ?? null,
      defaultUnit: parsed.defaultUnit ?? null,
      metadata: parsed.metadata ? cloneJson(parsed.metadata) : null,
      attributeSchema: parsed.attributeSchema ? cloneJson(parsed.attributeSchema) : null,
      attributeSchemaTemplate: schemaTemplate,
      attributeValues: parsed.attributeValues ? cloneJson(parsed.attributeValues) : null,
      isConfigurable: parsed.isConfigurable ?? false,
      isActive: parsed.isActive ?? true,
      createdAt: now,
      updatedAt: now,
    })
    em.persist(record)
    await em.flush()
    await syncProductRelations(em, record, parsed.subproducts)
    await syncProductRelations(em, record, parsed.subproducts)
    await syncOffers(em, record, parsed.offers)
    await em.flush()
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

    if (parsed.name !== undefined) record.name = parsed.name
    if (parsed.description !== undefined) record.description = parsed.description ?? null
    if (parsed.code !== undefined) record.code = parsed.code ?? null
    if (parsed.productType !== undefined) record.productType = parsed.productType
    if (parsed.statusEntryId !== undefined) record.statusEntryId = parsed.statusEntryId ?? null
    if (parsed.primaryCurrencyCode !== undefined) {
      record.primaryCurrencyCode = parsed.primaryCurrencyCode ?? null
    }
    if (parsed.defaultUnit !== undefined) record.defaultUnit = parsed.defaultUnit ?? null
    if (parsed.metadata !== undefined) {
      record.metadata = parsed.metadata ? cloneJson(parsed.metadata) : null
    }
    if (parsed.attributeSchemaId !== undefined) {
      if (!parsed.attributeSchemaId) {
        record.attributeSchemaTemplate = null
      } else {
        const template = await requireAttributeSchemaTemplate(
          em,
          parsed.attributeSchemaId,
          'Attribute schema not found'
        )
        ensureSameScope(template, organizationId, tenantId)
        record.attributeSchemaTemplate = template
      }
    }
    if (parsed.attributeSchema !== undefined) {
      record.attributeSchema = parsed.attributeSchema ? cloneJson(parsed.attributeSchema) : null
    }
    if (parsed.attributeValues !== undefined) {
      record.attributeValues = parsed.attributeValues ? cloneJson(parsed.attributeValues) : null
    }
    if (parsed.isConfigurable !== undefined) record.isConfigurable = parsed.isConfigurable
    if (parsed.isActive !== undefined) record.isActive = parsed.isActive
    await syncOffers(em, record, parsed.offers)
    await em.flush()
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
        name: before.name,
        description: before.description ?? null,
        code: before.code ?? null,
        statusEntryId: before.statusEntryId ?? null,
        primaryCurrencyCode: before.primaryCurrencyCode ?? null,
        defaultUnit: before.defaultUnit ?? null,
        metadata: before.metadata ? cloneJson(before.metadata) : null,
        attributeSchema: before.attributeSchemaOverride
          ? cloneJson(before.attributeSchemaOverride)
          : null,
        attributeSchemaTemplate: before.attributeSchemaId
          ? em.getReference(CatalogAttributeSchemaTemplate, before.attributeSchemaId)
          : null,
        attributeValues: before.attributeValues ? cloneJson(before.attributeValues) : null,
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
    await restoreRelationsFromSnapshot(em, record, before.relations)
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
        name: before.name,
        description: before.description ?? null,
        code: before.code ?? null,
        statusEntryId: before.statusEntryId ?? null,
        primaryCurrencyCode: before.primaryCurrencyCode ?? null,
        defaultUnit: before.defaultUnit ?? null,
        metadata: before.metadata ? cloneJson(before.metadata) : null,
        attributeSchema: before.attributeSchemaOverride
          ? cloneJson(before.attributeSchemaOverride)
          : null,
        attributeSchemaTemplate: before.attributeSchemaId
          ? em.getReference(CatalogAttributeSchemaTemplate, before.attributeSchemaId)
          : null,
        attributeValues: before.attributeValues ? cloneJson(before.attributeValues) : null,
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
    await restoreRelationsFromSnapshot(em, record, before.relations)
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
