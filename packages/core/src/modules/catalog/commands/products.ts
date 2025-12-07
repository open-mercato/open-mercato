import { randomUUID } from 'node:crypto'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import {
  buildChanges,
  requireId,
  parseWithCustomFields,
  setCustomFieldsIfAny,
  emitCrudSideEffects,
  emitCrudUndoSideEffects,
} from '@open-mercato/shared/lib/commands/helpers'
import type { EntityManager } from '@mikro-orm/postgresql'
import { UniqueConstraintViolationException } from '@mikro-orm/core'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { CrudEventAction, CrudEventsConfig, CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { loadCustomFieldSnapshot, buildCustomFieldResetMap } from '@open-mercato/shared/lib/commands/customFieldSnapshots'
import { E } from '@open-mercato/core/generated/entities.ids.generated'
import { slugifyTagLabel } from '@open-mercato/shared/lib/utils'
import {
  CatalogOffer,
  CatalogProduct,
  CatalogProductVariant,
  CatalogProductPrice,
  CatalogOptionSchemaTemplate,
  CatalogProductCategory,
  CatalogProductCategoryAssignment,
  CatalogProductTag,
  CatalogProductTagAssignment,
} from '../data/entities'
import { SalesTaxRate } from '@open-mercato/core/modules/sales/data/entities'
import {
  productCreateSchema,
  productUpdateSchema,
  type OfferInput,
  type ProductCreateInput,
  type ProductUpdateInput,
} from '../data/validators'
import type {
  CatalogOfferLocalizedContent,
  CatalogProductOptionSchema,
  CatalogProductType,
} from '../data/types'
import {
  cloneJson,
  ensureOrganizationScope,
  ensureSameScope,
  ensureTenantScope,
  extractUndoPayload,
  requireOptionSchemaTemplate,
  resolveOptionSchemaCode,
  emitCatalogQueryIndexEvent,
  randomSuffix,
  toNumericString,
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
  taxRateId: string | null
  taxRate: string | null
  productType: CatalogProductType
  statusEntryId: string | null
  primaryCurrencyCode: string | null
  defaultUnit: string | null
  defaultMediaId: string | null
  defaultMediaUrl: string | null
  weightValue: string | null
  weightUnit: string | null
  dimensions: Record<string, unknown> | null
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

const productCrudEvents: CrudEventsConfig<CatalogProduct> = {
  module: 'catalog',
  entity: 'product',
  persistent: true,
  buildPayload: (ctx) => ({
    id: ctx.identifiers.id,
    tenantId: ctx.identifiers.tenantId,
    organizationId: ctx.identifiers.organizationId,
    productType: ctx.entity.productType,
    statusEntryId: ctx.entity.statusEntryId ?? null,
    isActive: ctx.entity.isActive,
  }),
}

const productCrudIndexer: CrudIndexerConfig<CatalogProduct> = {
  entityType: E.catalog.catalog_product,
  buildUpsertPayload: (ctx) => ({
    entityType: E.catalog.catalog_product,
    recordId: ctx.identifiers.id,
    tenantId: ctx.identifiers.tenantId,
    organizationId: ctx.identifiers.organizationId,
  }),
  buildDeletePayload: (ctx) => ({
    entityType: E.catalog.catalog_product,
    recordId: ctx.identifiers.id,
    tenantId: ctx.identifiers.tenantId,
    organizationId: ctx.identifiers.organizationId,
  }),
}

function buildProductCrudIdentifiers(product: CatalogProduct) {
  return {
    id: product.id,
    organizationId: product.organizationId,
    tenantId: product.tenantId,
  }
}

async function emitProductCrudChange(opts: {
  dataEngine: DataEngine
  action: CrudEventAction
  product: CatalogProduct
}) {
  const { dataEngine, action, product } = opts
  await emitCrudSideEffects({
    dataEngine,
    action,
    entity: product,
    identifiers: buildProductCrudIdentifiers(product),
    events: productCrudEvents,
    indexer: productCrudIndexer,
  })
}

async function emitProductCrudUndoChange(opts: {
  dataEngine: DataEngine
  action: CrudEventAction
  product: CatalogProduct
}) {
  const { dataEngine, action, product } = opts
  await emitCrudUndoSideEffects({
    dataEngine,
    action,
    entity: product,
    identifiers: buildProductCrudIdentifiers(product),
    events: productCrudEvents,
    indexer: productCrudIndexer,
  })
}

type OfferSnapshot = {
  id: string
  channelId: string
  title: string
  description: string | null
  defaultMediaId: string | null
  defaultMediaUrl: string | null
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
  'taxRateId',
  'taxRate',
  'productType',
  'statusEntryId',
  'primaryCurrencyCode',
  'defaultUnit',
  'defaultMediaId',
  'defaultMediaUrl',
  'weightValue',
  'weightUnit',
  'dimensions',
  'optionSchemaId',
  'customFieldsetCode',
  'metadata',
  'isConfigurable',
  'isActive',
] as const satisfies readonly string[]

async function resolveScopedTaxRate(
  em: EntityManager,
  taxRateId: string | null | undefined,
  taxRateInput: number | string | null | undefined,
  organizationId: string,
  tenantId: string
): Promise<{ taxRateId: string | null; taxRate: string | null }> {
  const normalizedRate =
    taxRateInput === null || taxRateInput === undefined
      ? null
      : (() => {
          const numeric = typeof taxRateInput === 'string' ? Number(taxRateInput) : taxRateInput
          return Number.isFinite(numeric) ? toNumericString(numeric) : null
        })()
  if (!taxRateId) {
    return { taxRateId: null, taxRate: normalizedRate }
  }
  const record = await em.findOne(SalesTaxRate, {
    id: taxRateId,
    organizationId,
    tenantId,
    deletedAt: null,
  })
  if (!record) {
    throw new CrudHttpError(400, { error: 'Tax class not found' })
  }
  return { taxRateId, taxRate: record.rate ?? normalizedRate }
}

function slugifyCode(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function normalizeCatalogOptionSchema(
  input?: CatalogProductOptionSchema | null
): CatalogProductOptionSchema | null {
  if (!input || !Array.isArray(input.options) || !input.options.length) return null
  const options = input.options
    .map((option) => {
      if (!option) return null
      const label =
        typeof option.label === 'string' && option.label.trim().length ? option.label.trim() : null
      const codeSource =
        typeof option.code === 'string' && option.code.trim().length ? option.code.trim() : label
      const code = slugifyCode(codeSource ?? '')
      if (!label && !code) return null
      const choices = Array.isArray(option.choices)
        ? option.choices
            .map((choice) => {
              if (!choice) return null
              const choiceLabel =
                typeof choice.label === 'string' && choice.label.trim().length ? choice.label.trim() : null
              const choiceCodeSource =
                typeof choice.code === 'string' && choice.code.trim().length
                  ? choice.code.trim()
                  : choiceLabel
              const choiceCode = slugifyCode(choiceCodeSource ?? '')
              if (!choiceLabel && !choiceCode) return null
              return {
                code: choiceCode || `choice-${randomSuffix()}`,
                label: choiceLabel ?? (choiceCode || `Choice ${randomSuffix()}`),
              }
            })
            .filter(
              (entry): entry is { code: string; label: string } =>
                !!entry && entry.code.trim().length > 0 && entry.label.trim().length > 0
            )
        : []
      return {
        code: code || `option-${randomSuffix()}`,
        label: label ?? (code || `Option ${randomSuffix()}`),
        description:
          typeof option.description === 'string' && option.description.trim().length
            ? option.description.trim()
            : null,
        inputType:
          option.inputType === 'text' ||
          option.inputType === 'textarea' ||
          option.inputType === 'number'
            ? option.inputType
            : 'select',
        isRequired: option.isRequired ?? false,
        isMultiple: option.isMultiple ?? false,
        choices,
      }
    })
    .filter((entry) => !!entry && entry.code.trim().length > 0) as Array<
    CatalogProductOptionSchema['options'][number]
  >
  if (!options.length) return null
  return {
    version: typeof input.version === 'number' && input.version > 0 ? input.version : 1,
    name: typeof input.name === 'string' && input.name.trim().length ? input.name.trim() : undefined,
    description:
      typeof input.description === 'string' && input.description.trim().length
        ? input.description.trim()
        : undefined,
    options,
  }
}

function convertLegacyOptionSchema(raw: unknown): CatalogProductOptionSchema | null {
  if (!Array.isArray(raw)) return null
  const options = raw
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null
      const source = entry as Record<string, unknown>
      const title =
        typeof source['title'] === 'string' && (source['title'] as string).trim().length
          ? (source['title'] as string).trim()
          : null
      if (!title) return null
      const values = Array.isArray(source['values'])
        ? (source['values'] as unknown[])
            .map((value: any) => {
              if (!value || typeof value !== 'object') return null
              const label =
                typeof value.label === 'string' && value.label.trim().length ? value.label.trim() : null
              if (!label) return null
              return { code: slugifyCode(label), label }
            })
            .filter((choice): choice is { code: string; label: string } => !!choice)
        : []
      return {
        code: slugifyCode(title),
        label: title,
        inputType: 'select' as const,
        choices: values,
      }
    })
    .filter((option) => !!option) as CatalogProductOptionSchema['options']
  if (!options.length) return null
  return {
    version: 1,
    options,
  }
}

function extractOptionSchemaInput(source: {
  metadata?: Record<string, unknown> | null | undefined
  optionSchema?: CatalogProductOptionSchema | null | undefined
}): { schema: CatalogProductOptionSchema | null; metadata: Record<string, unknown> | null } {
  const metadata =
    source.metadata && typeof source.metadata === 'object'
      ? { ...(source.metadata as Record<string, unknown>) }
      : null
  let schema = normalizeCatalogOptionSchema(source.optionSchema)
  if (!schema && metadata) {
    const legacy = convertLegacyOptionSchema(
      (metadata as Record<string, unknown>)['optionSchema'] ??
        (metadata as Record<string, unknown>)['option_schema']
    )
    schema = normalizeCatalogOptionSchema(legacy)
  }
  if (metadata) {
    delete (metadata as Record<string, unknown>)['optionSchema']
    delete (metadata as Record<string, unknown>)['option_schema']
    delete (metadata as Record<string, unknown>)['dimensions']
    delete (metadata as Record<string, unknown>)['weight']
  }
  return {
    schema,
    metadata: metadata && Object.keys(metadata).length ? metadata : null,
  }
}

function parseNumeric(value: unknown): number | null {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric) || numeric < 0) return null
  return numeric
}

function normalizeDimensionsInput(raw: unknown): {
  width?: number
  height?: number
  depth?: number
  unit?: string
} | null {
  if (!raw || typeof raw !== 'object') return null
  const source = raw as Record<string, unknown>
  const clean: Record<string, unknown> = {}
  const width = parseNumeric(source.width)
  const height = parseNumeric(source.height)
  const depth = parseNumeric(source.depth)
  const unit = typeof source.unit === 'string' && source.unit.trim().length ? source.unit.trim() : null
  if (width !== null) clean.width = width
  if (height !== null) clean.height = height
  if (depth !== null) clean.depth = depth
  if (unit) clean.unit = unit
  return Object.keys(clean).length ? (clean as { width?: number; height?: number; depth?: number; unit?: string }) : null
}

function normalizeWeightInput(raw: unknown): { value?: number; unit?: string } | null {
  if (!raw || typeof raw !== 'object') return null
  const source = raw as Record<string, unknown>
  const value = parseNumeric(source.value)
  const unit = typeof source.unit === 'string' && source.unit.trim().length ? source.unit.trim() : null
  if (value === null && !unit) return null
  const clean: { value?: number; unit?: string } = {}
  if (value !== null) clean.value = value
  if (unit) clean.unit = unit
  return clean
}

function extractMeasurementsFromMetadata(metadata: Record<string, unknown> | null | undefined): {
  metadata: Record<string, unknown> | null
  dimensions: { width?: number; height?: number; depth?: number; unit?: string } | null
  weightValue: number | null
  weightUnit: string | null
} {
  if (!metadata || typeof metadata !== 'object') {
    return { metadata: null, dimensions: null, weightValue: null, weightUnit: null }
  }
  const clone = { ...(metadata as Record<string, unknown>) }
  const dimensions = normalizeDimensionsInput(clone.dimensions)
  const weight = normalizeWeightInput(clone.weight)
  delete clone.dimensions
  delete clone.weight
  const cleanedMetadata = Object.keys(clone).length ? clone : null
  return {
    metadata: cleanedMetadata,
    dimensions,
    weightValue: weight?.value ?? null,
    weightUnit: weight?.unit ?? null,
  }
}

function ensureSchemaName(name?: string | null, fallback?: string | null): string {
  if (name && name.trim().length) return name.trim()
  if (fallback && fallback.trim().length) return fallback.trim()
  return 'Product option schema'
}

async function assignOptionSchemaTemplate(
  em: EntityManager,
  product: CatalogProduct,
  schema: CatalogProductOptionSchema,
  preferredName?: string | null
): Promise<CatalogOptionSchemaTemplate> {
  const resolvedName = ensureSchemaName(schema.name, preferredName ?? product.title)
  const templateCode = resolveOptionSchemaCode({
    name: schema.name ?? resolvedName,
    fallback: `${resolvedName}-${product.id}`,
    uniqueHint: product.id?.slice(0, 8),
  })
  let template = product.optionSchemaTemplate ?? null
  if (!template) {
    template = await em.findOne(CatalogOptionSchemaTemplate, {
      organizationId: product.organizationId,
      tenantId: product.tenantId,
      code: templateCode,
      deletedAt: null,
    })
  }
  if (!template) {
    template = em.create(CatalogOptionSchemaTemplate, {
      organizationId: product.organizationId,
      tenantId: product.tenantId,
      name: resolvedName,
      code: templateCode,
      description: schema.description ?? null,
      schema: cloneJson(schema),
      metadata: { source: 'product' },
      isActive: true,
    })
    em.persist(template)
  } else {
    template.code = templateCode
    template.name = resolvedName
    template.description = schema.description ?? template.description ?? null
    template.schema = cloneJson(schema)
  }
  product.optionSchemaTemplate = template
  return template
}

function cloneOfferContent(value: CatalogOfferLocalizedContent | null | undefined): CatalogOfferLocalizedContent | null {
  return value ? cloneJson(value) : null
}

function serializeOffer(record: CatalogOffer): OfferSnapshot {
  return {
    id: record.id,
    channelId: record.channelId,
    title: record.title,
    description: record.description ?? null,
    defaultMediaId: record.defaultMediaId ?? null,
    defaultMediaUrl: record.defaultMediaUrl ?? null,
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
    target.defaultMediaId = snap.defaultMediaId ?? null
    target.defaultMediaUrl = snap.defaultMediaUrl ?? null
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
      defaultMediaId:
        typeof input.defaultMediaId === 'string' && input.defaultMediaId.trim().length
          ? input.defaultMediaId.trim()
          : null,
      defaultMediaUrl:
        typeof input.defaultMediaUrl === 'string' && input.defaultMediaUrl.trim().length
          ? input.defaultMediaUrl.trim()
          : null,
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
    target.defaultMediaId = input.defaultMediaId ?? null
    target.defaultMediaUrl = input.defaultMediaUrl ?? null
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

async function syncCategoryAssignments(
  em: EntityManager,
  product: CatalogProduct,
  categoryIds: string[] | undefined
): Promise<void> {
  const normalized = Array.from(
    new Set(
      (Array.isArray(categoryIds) ? categoryIds : [])
        .map((id) => (typeof id === 'string' ? id.trim() : ''))
        .filter((id) => id.length)
    )
  )
  const existing = await em.find(CatalogProductCategoryAssignment, { product })
  if (!normalized.length) {
    if (existing.length) {
      for (const assignment of existing) {
        em.remove(assignment)
      }
    }
    return
  }
  const categories = await em.find(
    CatalogProductCategory,
    {
      id: { $in: normalized },
      organizationId: product.organizationId,
      tenantId: product.tenantId,
    }
  )
  const categoryMap = new Map(categories.map((category) => [category.id, category]))
  const claimed = new Set<string>()
  normalized.forEach((categoryId, index) => {
    const category = categoryMap.get(categoryId)
    if (!category) return
    let assignment = existing.find((item) => {
      const value = typeof item.category === 'string' ? item.category : item.category?.id
      return value === categoryId
    })
    if (!assignment) {
      assignment = em.create(CatalogProductCategoryAssignment, {
        product,
        category,
        organizationId: product.organizationId,
        tenantId: product.tenantId,
        position: index,
      })
      em.persist(assignment)
      existing.push(assignment)
    }
    assignment.position = index
    claimed.add(assignment.id)
  })
  for (const assignment of existing) {
    if (!claimed.has(assignment.id)) {
      em.remove(assignment)
    }
  }
}

async function syncProductTags(
  em: EntityManager,
  product: CatalogProduct,
  tags: string[] | undefined
): Promise<void> {
  const labelMap = new Map<string, string>()
  if (Array.isArray(tags)) {
    tags.forEach((raw) => {
      const label = typeof raw === 'string' ? raw.trim() : ''
      if (!label) return
      const slug = slugifyTagLabel(label)
      if (!labelMap.has(slug)) {
        labelMap.set(slug, label)
      }
    })
  }
  const slugs = Array.from(labelMap.keys())
  const existingAssignments = await em.find(
    CatalogProductTagAssignment,
    { product },
    { populate: ['tag'] }
  )
  if (!slugs.length) {
    if (existingAssignments.length) {
      for (const assignment of existingAssignments) {
        em.remove(assignment)
      }
    }
    return
  }
  const existingTags = await em.find(
    CatalogProductTag,
    {
      organizationId: product.organizationId,
      tenantId: product.tenantId,
      slug: { $in: slugs },
    }
  )
  const tagsBySlug = new Map(existingTags.map((tag) => [tag.slug, tag]))
  for (const slug of slugs) {
    if (tagsBySlug.has(slug)) continue
    const label = labelMap.get(slug) ?? slug
    const tag = em.create(CatalogProductTag, {
      organizationId: product.organizationId,
      tenantId: product.tenantId,
      slug,
      label,
    })
    em.persist(tag)
    tagsBySlug.set(slug, tag)
  }
  const assignmentByTagId = new Map(
    existingAssignments.map((assignment) => [
      typeof assignment.tag === 'string' ? assignment.tag : assignment.tag.id,
      assignment,
    ])
  )
  const keepIds = new Set<string>()
  for (const slug of slugs) {
    const tag = tagsBySlug.get(slug)
    if (!tag) continue
    const tagId = tag.id
    let assignment = assignmentByTagId.get(tagId)
    if (!assignment) {
      assignment = em.create(CatalogProductTagAssignment, {
        product,
        tag,
        organizationId: product.organizationId,
        tenantId: product.tenantId,
      })
      em.persist(assignment)
    }
    keepIds.add(assignment.id)
  }
  for (const assignment of existingAssignments) {
    if (!keepIds.has(assignment.id)) {
      em.remove(assignment)
    }
  }
}

type VariantCleanupSnapshot = {
  id: string
  organizationId: string
  tenantId: string
  custom: Record<string, unknown> | null
}

async function deleteProductVariantsAndRelatedData(opts: {
  em: EntityManager
  product: CatalogProduct
  dataEngine: DataEngine
  ctx: CommandRuntimeContext
}): Promise<void> {
  const { em, product, dataEngine, ctx } = opts
  const variants = await em.find(CatalogProductVariant, { product })
  if (!variants.length) return
  const cleanupEntries: VariantCleanupSnapshot[] = await Promise.all(
    variants.map(async (variant) => {
      const custom = await loadCustomFieldSnapshot(em, {
        entityId: E.catalog.catalog_product_variant,
        recordId: variant.id,
        organizationId: variant.organizationId,
        tenantId: variant.tenantId,
      })
      return {
        id: variant.id,
        organizationId: variant.organizationId,
        tenantId: variant.tenantId,
        custom: Object.keys(custom).length ? custom : null,
      }
    })
  )
  const variantIds = variants.map((variant) => variant.id)
  if (variantIds.length) {
    await em.nativeDelete(CatalogProductPrice, { variant: { $in: variantIds } })
  }
  for (const variant of variants) {
    em.remove(variant)
  }
  await em.flush()
  for (const cleanup of cleanupEntries) {
    if (!cleanup.custom) continue
    const resetValues = buildCustomFieldResetMap(cleanup.custom, undefined)
    if (!Object.keys(resetValues).length) continue
    await setCustomFieldsIfAny({
      dataEngine,
      entityId: E.catalog.catalog_product_variant,
      recordId: cleanup.id,
      organizationId: cleanup.organizationId,
      tenantId: cleanup.tenantId,
      values: resetValues,
    })
  }
  for (const cleanup of cleanupEntries) {
    await emitCatalogQueryIndexEvent(ctx, {
      entityType: E.catalog.catalog_product_variant,
      recordId: cleanup.id,
      organizationId: cleanup.organizationId,
      tenantId: cleanup.tenantId,
      action: 'deleted',
    })
  }
}

function isProductOwnedOptionSchemaTemplate(
  template: CatalogOptionSchemaTemplate | string | null | undefined
): template is CatalogOptionSchemaTemplate {
  if (!template || typeof template === 'string') return false
  const metadata = template.metadata
  if (!metadata || typeof metadata !== 'object') return false
  const source = (metadata as Record<string, unknown>).source
  return source === 'product'
}

async function resolveOptionSchemaTemplateForRemoval(
  em: EntityManager,
  product: CatalogProduct
): Promise<CatalogOptionSchemaTemplate | null> {
  const template = product.optionSchemaTemplate
  if (!isProductOwnedOptionSchemaTemplate(template)) {
    return null
  }
  const otherUsage = await em.count(CatalogProduct, {
    optionSchemaTemplate: template,
    id: { $ne: product.id },
    deletedAt: null,
  })
  if (otherUsage > 0) return null
  return template
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
  const measurements = extractMeasurementsFromMetadata(record.metadata ? cloneJson(record.metadata) : null)
  const dimensions =
    record.dimensions && Object.keys(record.dimensions).length
      ? cloneJson(record.dimensions)
      : measurements.dimensions
        ? cloneJson(measurements.dimensions)
        : null
  const weightValue =
    record.weightValue ??
    (measurements.weightValue !== null ? toNumericString(measurements.weightValue) : null)
  const weightUnit = record.weightUnit ?? measurements.weightUnit ?? null
  const metadata = measurements.metadata ? cloneJson(measurements.metadata) : null
  return {
    id: record.id,
    organizationId: record.organizationId,
    tenantId: record.tenantId,
    title: record.title,
    subtitle: record.subtitle ?? null,
    description: record.description ?? null,
    sku: record.sku ?? null,
    handle: record.handle ?? null,
    taxRateId: record.taxRateId ?? null,
    taxRate: record.taxRate ?? null,
    productType: record.productType,
    statusEntryId: record.statusEntryId ?? null,
    primaryCurrencyCode: record.primaryCurrencyCode ?? null,
    defaultUnit: record.defaultUnit ?? null,
    defaultMediaId: record.defaultMediaId ?? null,
    defaultMediaUrl: record.defaultMediaUrl ?? null,
    weightValue,
    weightUnit,
    dimensions,
    customFieldsetCode: record.customFieldsetCode ?? null,
    metadata,
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
  record.taxRateId = snapshot.taxRateId ?? null
  record.taxRate = snapshot.taxRate ?? null
  record.productType = snapshot.productType
  record.statusEntryId = snapshot.statusEntryId ?? null
  record.primaryCurrencyCode = snapshot.primaryCurrencyCode ?? null
  record.defaultUnit = snapshot.defaultUnit ?? null
  record.defaultMediaId = snapshot.defaultMediaId ?? null
  record.defaultMediaUrl = snapshot.defaultMediaUrl ?? null
  record.weightValue = snapshot.weightValue ?? null
  record.weightUnit = snapshot.weightUnit ?? null
  record.dimensions = snapshot.dimensions ? cloneJson(snapshot.dimensions) : null
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
    const { taxRateId, taxRate } = await resolveScopedTaxRate(
      em,
      parsed.taxRateId ?? null,
      parsed.taxRate,
      parsed.organizationId,
      parsed.tenantId
    )
    const { schema: optionSchemaDefinition, metadata: sanitizedMetadata } = extractOptionSchemaInput(parsed)
    const measurements = extractMeasurementsFromMetadata(sanitizedMetadata)
    const dimensions = normalizeDimensionsInput(parsed.dimensions) ?? measurements.dimensions
    const weightValue =
      parsed.weightValue !== undefined
        ? toNumericString(parsed.weightValue)
        : measurements.weightValue !== null
          ? toNumericString(measurements.weightValue)
          : null
    const weightUnit =
      parsed.weightUnit !== undefined ? parsed.weightUnit ?? null : measurements.weightUnit ?? null
    const metadata = measurements.metadata ? cloneJson(measurements.metadata) : null
    const productId = randomUUID()
    const record = em.create(CatalogProduct, {
      id: productId,
      organizationId: parsed.organizationId,
      tenantId: parsed.tenantId,
      title: parsed.title,
      subtitle: parsed.subtitle ?? null,
      description: parsed.description ?? null,
      sku: parsed.sku ?? null,
      handle: parsed.handle ?? null,
      taxRateId,
      taxRate,
      productType: parsed.productType ?? 'simple',
      statusEntryId: parsed.statusEntryId ?? null,
      primaryCurrencyCode: parsed.primaryCurrencyCode ?? null,
      defaultUnit: parsed.defaultUnit ?? null,
      defaultMediaId: parsed.defaultMediaId ?? null,
      defaultMediaUrl: parsed.defaultMediaUrl ?? null,
      weightValue,
      weightUnit,
      dimensions,
      metadata,
      customFieldsetCode: parsed.customFieldsetCode ?? null,
      isConfigurable: parsed.isConfigurable ?? false,
      isActive: parsed.isActive ?? true,
      createdAt: now,
      updatedAt: now,
    })
    let optionSchemaTemplate: CatalogOptionSchemaTemplate | null = null
    if (parsed.optionSchemaId) {
      optionSchemaTemplate = await requireOptionSchemaTemplate(
        em,
        parsed.optionSchemaId,
        'Option schema not found'
      )
      ensureSameScope(optionSchemaTemplate, parsed.organizationId, parsed.tenantId)
      record.optionSchemaTemplate = optionSchemaTemplate
    } else if (optionSchemaDefinition) {
      optionSchemaTemplate = await assignOptionSchemaTemplate(
        em,
        record,
        optionSchemaDefinition,
        optionSchemaDefinition.name ?? parsed.title
      )
    }
    em.persist(record)
    try {
      await em.flush()
    } catch (error) {
      await rethrowProductUniqueConstraint(error)
    }
    await syncOffers(em, record, parsed.offers)
    await syncCategoryAssignments(em, record, parsed.categoryIds)
    await syncProductTags(em, record, parsed.tags)
    try {
      await em.flush()
    } catch (error) {
      await rethrowProductUniqueConstraint(error)
    }
    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await setCustomFieldsIfAny({
      dataEngine,
      entityId: E.catalog.catalog_product,
      recordId: record.id,
      organizationId: record.organizationId,
      tenantId: record.tenantId,
      values: custom,
    })
    await emitProductCrudChange({
      dataEngine,
      action: 'created',
      product: record,
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
    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    const resetValues = buildCustomFieldResetMap(undefined, after.custom ?? undefined)
    if (Object.keys(resetValues).length) {
      await setCustomFieldsIfAny({
        dataEngine,
        entityId: E.catalog.catalog_product,
        recordId: after.id,
        organizationId: after.organizationId,
        tenantId: after.tenantId,
        values: resetValues,
      })
    }
    await emitProductCrudUndoChange({
      dataEngine,
      action: 'deleted',
      product: record,
    })
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
    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    record.organizationId = organizationId
    record.tenantId = tenantId

    const taxRateProvided = parsed.taxRateId !== undefined || parsed.taxRate !== undefined
    const resolvedTaxRate = taxRateProvided
      ? await resolveScopedTaxRate(em, parsed.taxRateId ?? null, parsed.taxRate, organizationId, tenantId)
      : null

    if (parsed.title !== undefined) record.title = parsed.title
    if (parsed.subtitle !== undefined) record.subtitle = parsed.subtitle ?? null
    if (parsed.description !== undefined) record.description = parsed.description ?? null
    if (parsed.sku !== undefined) record.sku = parsed.sku ?? null
    if (parsed.handle !== undefined) record.handle = parsed.handle ?? null
    if (taxRateProvided) {
      record.taxRateId = resolvedTaxRate?.taxRateId ?? null
      record.taxRate = resolvedTaxRate?.taxRate ?? null
    }
    if (parsed.productType !== undefined) record.productType = parsed.productType
    if (parsed.statusEntryId !== undefined) record.statusEntryId = parsed.statusEntryId ?? null
    if (parsed.primaryCurrencyCode !== undefined) {
      record.primaryCurrencyCode = parsed.primaryCurrencyCode ?? null
    }
    if (parsed.defaultUnit !== undefined) record.defaultUnit = parsed.defaultUnit ?? null
    if (parsed.defaultMediaId !== undefined) {
      record.defaultMediaId = parsed.defaultMediaId ?? null
    }
    if (parsed.defaultMediaUrl !== undefined) {
      record.defaultMediaUrl = parsed.defaultMediaUrl ?? null
    }
    const metadataProvided =
      rawInput && typeof rawInput === 'object' && Object.prototype.hasOwnProperty.call(rawInput, 'metadata')
    const { schema: optionSchemaDefinition, metadata: sanitizedMetadata } = extractOptionSchemaInput(parsed)
    const measurements = extractMeasurementsFromMetadata(sanitizedMetadata)
    const normalizedDimensions =
      parsed.dimensions !== undefined ? normalizeDimensionsInput(parsed.dimensions) : measurements.dimensions
    const weightValueFromInput =
      parsed.weightValue === null
        ? null
        : parsed.weightValue !== undefined
          ? toNumericString(parsed.weightValue)
          : measurements.weightValue !== null
            ? toNumericString(measurements.weightValue)
            : null
    const weightUnitFromInput =
      parsed.weightUnit !== undefined ? parsed.weightUnit ?? null : measurements.weightUnit ?? null
    const weightProvided =
      parsed.weightValue !== undefined ||
      parsed.weightUnit !== undefined ||
      measurements.weightValue !== null ||
      measurements.weightUnit !== null
    if (normalizedDimensions !== null || parsed.dimensions !== undefined) {
      record.dimensions = normalizedDimensions ? cloneJson(normalizedDimensions) : null
    }
    if (weightProvided) {
      record.weightValue = weightValueFromInput
      record.weightUnit = weightUnitFromInput
    }
    if (metadataProvided) {
      record.metadata = measurements.metadata ? cloneJson(measurements.metadata) : null
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
    if (optionSchemaDefinition) {
      await assignOptionSchemaTemplate(
        em,
        record,
        optionSchemaDefinition,
        optionSchemaDefinition.name ?? parsed.title ?? record.title
      )
    }
    if (parsed.customFieldsetCode !== undefined) {
      record.customFieldsetCode = parsed.customFieldsetCode ?? null
    }
    if (parsed.isConfigurable !== undefined) record.isConfigurable = parsed.isConfigurable
    if (parsed.isActive !== undefined) record.isActive = parsed.isActive
    await syncOffers(em, record, parsed.offers)
    await syncCategoryAssignments(em, record, parsed.categoryIds)
    await syncProductTags(em, record, parsed.tags)
    try {
      await em.flush()
    } catch (error) {
      await rethrowProductUniqueConstraint(error)
    }
    if (custom && Object.keys(custom).length) {
      await setCustomFieldsIfAny({
        dataEngine,
        entityId: E.catalog.catalog_product,
        recordId: record.id,
        organizationId: record.organizationId,
        tenantId: record.tenantId,
        values: custom,
      })
    }
    await emitProductCrudChange({
      dataEngine,
      action: 'updated',
      product: record,
    })
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
        taxRateId: before.taxRateId ?? null,
        taxRate: before.taxRate ?? null,
        statusEntryId: before.statusEntryId ?? null,
        primaryCurrencyCode: before.primaryCurrencyCode ?? null,
        defaultUnit: before.defaultUnit ?? null,
        weightValue: before.weightValue ?? null,
        weightUnit: before.weightUnit ?? null,
        dimensions: before.dimensions ? cloneJson(before.dimensions) : null,
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
    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    const resetValues = buildCustomFieldResetMap(before.custom ?? undefined, payload?.after?.custom ?? undefined)
    if (Object.keys(resetValues).length) {
      await setCustomFieldsIfAny({
        dataEngine,
        entityId: E.catalog.catalog_product,
        recordId: before.id,
        organizationId: before.organizationId,
        tenantId: before.tenantId,
        values: resetValues,
      })
    }
    await emitProductCrudUndoChange({
      dataEngine,
      action: 'updated',
      product: record,
    })
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
    const record = await em.findOne(
      CatalogProduct,
      { id },
      { populate: ['optionSchemaTemplate'] }
    )
    if (!record) throw new CrudHttpError(404, { error: 'Catalog product not found' })
    const baseEm = (ctx.container.resolve('em') as EntityManager)
    const snapshot = await loadProductSnapshot(baseEm, id)
    ensureTenantScope(ctx, record.tenantId)
    ensureOrganizationScope(ctx, record.organizationId)
    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await deleteProductVariantsAndRelatedData({ em, product: record, dataEngine, ctx })
    await em.nativeDelete(CatalogProductPrice, { product: record.id })
    const templateToRemove = await resolveOptionSchemaTemplateForRemoval(em, record)
    if (templateToRemove) {
      record.optionSchemaTemplate = null
      em.remove(templateToRemove)
    }
    em.remove(record)
    await em.flush()
    if (snapshot?.custom && Object.keys(snapshot.custom).length) {
      const resetValues = buildCustomFieldResetMap(snapshot.custom, undefined)
      if (Object.keys(resetValues).length) {
        await setCustomFieldsIfAny({
          dataEngine,
          entityId: E.catalog.catalog_product,
          recordId: id,
          organizationId: record.organizationId,
          tenantId: record.tenantId,
          values: resetValues,
        })
      }
    }
    await emitProductCrudChange({
      dataEngine,
      action: 'deleted',
      product: record,
    })
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
        taxRateId: before.taxRateId ?? null,
        taxRate: before.taxRate ?? null,
        statusEntryId: before.statusEntryId ?? null,
        primaryCurrencyCode: before.primaryCurrencyCode ?? null,
        defaultUnit: before.defaultUnit ?? null,
        weightValue: before.weightValue ?? null,
        weightUnit: before.weightUnit ?? null,
        dimensions: before.dimensions ? cloneJson(before.dimensions) : null,
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
    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    if (before.custom && Object.keys(before.custom).length) {
      await setCustomFieldsIfAny({
        dataEngine,
        entityId: E.catalog.catalog_product,
        recordId: before.id,
        organizationId: before.organizationId,
        tenantId: before.tenantId,
        values: before.custom,
      })
    }
    await emitProductCrudUndoChange({
      dataEngine,
      action: 'created',
      product: record,
    })
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
  const normalized = message ? message.toLowerCase() : ''
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
