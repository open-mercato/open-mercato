import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { buildChanges, requireId, parseWithCustomFields, setCustomFieldsIfAny } from '@open-mercato/shared/lib/commands/helpers'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { loadCustomFieldSnapshot, buildCustomFieldResetMap } from '@open-mercato/shared/lib/commands/customFieldSnapshots'
import { E } from '#generated/entities.ids.generated'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import {
  CatalogProductVariant,
  CatalogProductPrice,
  CatalogProduct,
  CatalogOffer,
  CatalogPriceKind,
} from '../data/entities'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { Attachment } from '@open-mercato/core/modules/attachments/data/entities'
import {
  variantCreateSchema,
  variantUpdateSchema,
  type VariantCreateInput,
  type VariantUpdateInput,
} from '../data/validators'
import {
  cloneJson,
  ensureOrganizationScope,
  ensureTenantScope,
  emitCatalogQueryIndexEvent,
  extractUndoPayload,
  requireProduct,
  toNumericString,
} from './shared'
import { SalesTaxRate } from '@open-mercato/core/modules/sales/data/entities'

type VariantSnapshot = {
  id: string
  productId: string
  organizationId: string
  tenantId: string
  name: string | null
  sku: string | null
  barcode: string | null
  statusEntryId: string | null
  isDefault: boolean
  isActive: boolean
  weightValue: string | null
  weightUnit: string | null
  taxRateId: string | null
  taxRate: string | null
  dimensions: Record<string, unknown> | null
  metadata: Record<string, unknown> | null
  optionValues: Record<string, string> | null
  customFieldsetCode: string | null
  createdAt: string
  updatedAt: string
  custom: Record<string, unknown> | null
  prices?: VariantPriceSnapshot[] | null
}

type VariantUndoPayload = {
  before?: VariantSnapshot | null
  after?: VariantSnapshot | null
  previousDefaultVariantId?: string | null
}

const VARIANT_CHANGE_KEYS = [
  'name',
  'sku',
  'barcode',
  'statusEntryId',
  'isDefault',
  'isActive',
  'weightValue',
  'weightUnit',
  'taxRateId',
  'taxRate',
  'dimensions',
  'optionValues',
  'customFieldsetCode',
  'metadata',
] as const satisfies readonly string[]

async function loadVariantSnapshot(
  em: EntityManager,
  id: string,
  options: { includePrices?: boolean } = {}
): Promise<VariantSnapshot | null> {
  const record = await em.findOne(CatalogProductVariant, { id, deletedAt: null })
  if (!record) return null
  const prices = options.includePrices ? await loadVariantPriceSnapshots(em, record.id) : null
  const custom = await loadCustomFieldSnapshot(em, {
    entityId: E.catalog.catalog_product_variant,
    recordId: record.id,
    tenantId: record.tenantId,
    organizationId: record.organizationId,
  })
  const productId = typeof record.product === 'string' ? record.product : record.product.id
  return {
    id: record.id,
    productId,
    organizationId: record.organizationId,
    tenantId: record.tenantId,
    name: record.name ?? null,
    sku: record.sku ?? null,
    barcode: record.barcode ?? null,
    statusEntryId: record.statusEntryId ?? null,
    isDefault: record.isDefault,
    isActive: record.isActive,
    weightValue: record.weightValue ?? null,
    weightUnit: record.weightUnit ?? null,
    taxRateId: record.taxRateId ?? null,
    taxRate: record.taxRate ?? null,
    dimensions: record.dimensions ? cloneJson(record.dimensions) : null,
    metadata: record.metadata ? cloneJson(record.metadata) : null,
    optionValues: record.optionValues ? cloneJson(record.optionValues) : null,
    customFieldsetCode: record.customFieldsetCode ?? null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    custom: Object.keys(custom).length ? custom : null,
    prices: prices && prices.length ? prices : null,
  }
}

function applyVariantSnapshot(record: CatalogProductVariant, snapshot: VariantSnapshot): void {
  record.organizationId = snapshot.organizationId
  record.tenantId = snapshot.tenantId
  record.name = snapshot.name ?? null
  record.sku = snapshot.sku ?? null
  record.barcode = snapshot.barcode ?? null
  record.statusEntryId = snapshot.statusEntryId ?? null
  record.isDefault = snapshot.isDefault
  record.isActive = snapshot.isActive
  record.weightValue = snapshot.weightValue ?? null
  record.weightUnit = snapshot.weightUnit ?? null
  record.taxRateId = snapshot.taxRateId ?? null
  record.taxRate = snapshot.taxRate ?? null
  record.dimensions = snapshot.dimensions ? cloneJson(snapshot.dimensions) : null
  record.metadata = snapshot.metadata ? cloneJson(snapshot.metadata) : null
  record.optionValues = snapshot.optionValues ? cloneJson(snapshot.optionValues) : null
  record.customFieldsetCode = snapshot.customFieldsetCode ?? null
  record.createdAt = new Date(snapshot.createdAt)
  record.updatedAt = new Date(snapshot.updatedAt)
}

async function resolveVariantTaxRate(
  em: EntityManager,
  product: CatalogProduct,
  taxRateIdInput: string | null | undefined,
  taxRateInput: number | string | null | undefined
): Promise<{ taxRateId: string | null; taxRate: string | null }> {
  const organizationId = product.organizationId
  const tenantId = product.tenantId
  const normalizedRate =
    taxRateInput === null || taxRateInput === undefined
      ? null
      : (() => {
          const numeric = typeof taxRateInput === 'string' ? Number(taxRateInput) : taxRateInput
          return Number.isFinite(numeric) ? toNumericString(numeric) : null
        })()
  if (taxRateIdInput === null) {
    return { taxRateId: product.taxRateId ?? null, taxRate: product.taxRate ?? null }
  }
  if (!taxRateIdInput) {
    return { taxRateId: product.taxRateId ?? null, taxRate: product.taxRate ?? normalizedRate }
  }
  const record = await em.findOne(SalesTaxRate, {
    id: taxRateIdInput,
    organizationId,
    tenantId,
    deletedAt: null,
  })
  if (!record) {
    throw new CrudHttpError(400, { error: 'Tax class not found' })
  }
  return { taxRateId: taxRateIdInput, taxRate: record.rate ?? normalizedRate }
}

type VariantPriceSnapshot = {
  id: string
  variantId: string | null
  productId: string | null
  offerId: string | null
  organizationId: string
  tenantId: string
  priceKindId: string
  priceKindCode: string
  currencyCode: string
  kind: string
  minQuantity: number
  maxQuantity: number | null
  unitPriceNet: string | null
  unitPriceGross: string | null
  taxRate: string | null
  taxAmount: string | null
  channelId: string | null
  userId: string | null
  userGroupId: string | null
  customerId: string | null
  customerGroupId: string | null
  metadata: Record<string, unknown> | null
  startsAt: string | null
  endsAt: string | null
  createdAt: string
  updatedAt: string
  custom: Record<string, unknown> | null
}

async function loadVariantPriceSnapshots(
  em: EntityManager,
  variantId: string
): Promise<VariantPriceSnapshot[]> {
  const prices = await findWithDecryption(
    em,
    CatalogProductPrice,
    { variant: variantId },
    { populate: ['priceKind', 'product', 'offer'] },
    { tenantId: null, organizationId: null },
  )
  const snapshots: VariantPriceSnapshot[] = []
  for (const price of prices) {
    const variantRef = price.variant
    const variantIdValue =
      typeof variantRef === 'string'
        ? variantRef
        : variantRef
          ? variantRef.id
          : null
    const productRef = price.product
      ? price.product
      : typeof price.variant === 'object' && price.variant
        ? price.variant.product
        : null
    const productId =
      typeof productRef === 'string'
        ? productRef
        : productRef
          ? productRef.id
          : null
    const priceKindRef = price.priceKind
    const priceKindId =
      typeof priceKindRef === 'string'
        ? priceKindRef
        : priceKindRef
          ? priceKindRef.id
          : null
    if (!priceKindId) {
      throw new CrudHttpError(400, { error: 'Price is missing price kind metadata.' })
    }
    const priceKindCode =
      typeof priceKindRef === 'object' && priceKindRef ? priceKindRef.code : price.kind
    const custom = await loadCustomFieldSnapshot(em, {
      entityId: E.catalog.catalog_product_price,
      recordId: price.id,
      tenantId: price.tenantId,
      organizationId: price.organizationId,
    })
    snapshots.push({
      id: price.id,
      variantId: variantIdValue,
      productId,
      offerId: typeof price.offer === 'string' ? price.offer : price.offer ? price.offer.id : null,
      organizationId: price.organizationId,
      tenantId: price.tenantId,
      priceKindId,
      priceKindCode,
      currencyCode: price.currencyCode,
      kind: price.kind,
      minQuantity: price.minQuantity,
      maxQuantity: price.maxQuantity ?? null,
      unitPriceNet: price.unitPriceNet ?? null,
      unitPriceGross: price.unitPriceGross ?? null,
      taxRate: price.taxRate ?? null,
      taxAmount: price.taxAmount ?? null,
      channelId: price.channelId ?? null,
      userId: price.userId ?? null,
      userGroupId: price.userGroupId ?? null,
      customerId: price.customerId ?? null,
      customerGroupId: price.customerGroupId ?? null,
      metadata: price.metadata ? cloneJson(price.metadata) : null,
      startsAt: price.startsAt ? price.startsAt.toISOString() : null,
      endsAt: price.endsAt ? price.endsAt.toISOString() : null,
      createdAt: price.createdAt.toISOString(),
      updatedAt: price.updatedAt.toISOString(),
      custom: Object.keys(custom).length ? custom : null,
    })
  }
  return snapshots
}

async function restoreVariantPricesFromSnapshots(
  em: EntityManager,
  variant: CatalogProductVariant,
  snapshots: VariantPriceSnapshot[],
  dataEngine: DataEngine
): Promise<void> {
  if (!snapshots.length) return
  const productRef =
    typeof variant.product === 'string'
      ? await requireProduct(em, variant.product)
      : variant.product
  for (const snapshot of snapshots) {
    const product =
      snapshot.productId && snapshot.productId !== productRef.id
        ? em.getReference(CatalogProduct, snapshot.productId)
        : productRef
    const offer = snapshot.offerId ? em.getReference(CatalogOffer, snapshot.offerId) : null
    const priceKind = em.getReference(CatalogPriceKind, snapshot.priceKindId)
    let record = await em.findOne(CatalogProductPrice, { id: snapshot.id })
    if (!record) {
      record = em.create(CatalogProductPrice, {
        id: snapshot.id,
        variant,
        product,
        offer,
        organizationId: snapshot.organizationId,
        tenantId: snapshot.tenantId,
        currencyCode: snapshot.currencyCode,
        priceKind,
        kind: snapshot.priceKindCode || snapshot.kind,
        minQuantity: snapshot.minQuantity,
        maxQuantity: snapshot.maxQuantity ?? null,
        unitPriceNet: snapshot.unitPriceNet ?? null,
        unitPriceGross: snapshot.unitPriceGross ?? null,
        taxRate: snapshot.taxRate ?? null,
        taxAmount: snapshot.taxAmount ?? null,
        channelId: snapshot.channelId ?? null,
        userId: snapshot.userId ?? null,
        userGroupId: snapshot.userGroupId ?? null,
        customerId: snapshot.customerId ?? null,
        customerGroupId: snapshot.customerGroupId ?? null,
        metadata: snapshot.metadata ? cloneJson(snapshot.metadata) : null,
        startsAt: snapshot.startsAt ? new Date(snapshot.startsAt) : null,
        endsAt: snapshot.endsAt ? new Date(snapshot.endsAt) : null,
        createdAt: new Date(snapshot.createdAt),
        updatedAt: new Date(snapshot.updatedAt),
      })
      em.persist(record)
    } else {
      record.variant = variant
      record.product = product
      record.offer = offer
      record.priceKind = priceKind
      record.organizationId = snapshot.organizationId
      record.tenantId = snapshot.tenantId
      record.currencyCode = snapshot.currencyCode
      record.kind = snapshot.priceKindCode || snapshot.kind
      record.minQuantity = snapshot.minQuantity
      record.maxQuantity = snapshot.maxQuantity ?? null
      record.unitPriceNet = snapshot.unitPriceNet ?? null
      record.unitPriceGross = snapshot.unitPriceGross ?? null
      record.taxRate = snapshot.taxRate ?? null
      record.taxAmount = snapshot.taxAmount ?? null
      record.channelId = snapshot.channelId ?? null
      record.userId = snapshot.userId ?? null
      record.userGroupId = snapshot.userGroupId ?? null
      record.customerId = snapshot.customerId ?? null
      record.customerGroupId = snapshot.customerGroupId ?? null
      record.metadata = snapshot.metadata ? cloneJson(snapshot.metadata) : null
      record.startsAt = snapshot.startsAt ? new Date(snapshot.startsAt) : null
      record.endsAt = snapshot.endsAt ? new Date(snapshot.endsAt) : null
      record.createdAt = new Date(snapshot.createdAt)
      record.updatedAt = new Date(snapshot.updatedAt)
    }
  }
  await em.flush()
  for (const snapshot of snapshots) {
    if (!snapshot.custom || !Object.keys(snapshot.custom).length) continue
    await setCustomFieldsIfAny({
      dataEngine,
      entityId: E.catalog.catalog_product_price,
      recordId: snapshot.id,
      organizationId: snapshot.organizationId,
      tenantId: snapshot.tenantId,
      values: snapshot.custom,
    })
  }
}

type MetadataSplitResult = {
  metadata: Record<string, unknown> | null
  optionValues: Record<string, string> | null
  hadOptionValues: boolean
}

function splitOptionValuesFromMetadata(
  metadata?: Record<string, unknown> | null
): MetadataSplitResult {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return {
      metadata: metadata ? cloneJson(metadata) : null,
      optionValues: null,
      hadOptionValues: false,
    }
  }
  const { optionValues, ...rest } = metadata as Record<string, unknown> & {
    optionValues?: unknown
  }
  const normalizedMetadata = Object.keys(rest).length ? cloneJson(rest) : null
  return {
    metadata: normalizedMetadata,
    optionValues: normalizeOptionValues(optionValues),
    hadOptionValues: optionValues !== undefined,
  }
}

function normalizeOptionValues(input: unknown): Record<string, string> | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const normalized: Record<string, string> = {}
  for (const [rawKey, rawValue] of Object.entries(input)) {
    if (typeof rawValue !== 'string') continue
    const key = rawKey.trim()
    const value = rawValue.trim()
    if (!key || !value) continue
    normalized[key] = value
  }
  return Object.keys(normalized).length ? normalized : null
}

function resolveProductId(record: CatalogProductVariant): string {
  return typeof record.product === 'string' ? record.product : record.product.id
}

async function enforceSingleDefaultVariant(
  em: EntityManager,
  variant: CatalogProductVariant
): Promise<string | null> {
  if (!variant.isDefault) return null
  const productId = resolveProductId(variant)
  const existingDefault = await em.findOne(
    CatalogProductVariant,
    { product: productId, isDefault: true, deletedAt: null, id: { $ne: variant.id } },
    { fields: ['id', 'isDefault'] }
  )
  if (existingDefault) {
    existingDefault.isDefault = false
    return existingDefault.id
  }
  return null
}

async function aggregateVariantMediaToProduct(
  em: EntityManager,
  variant: CatalogProductVariant
): Promise<void> {
  const productId = resolveProductId(variant)
  const buildKey = (
    attachment: Pick<Attachment, 'fileName' | 'fileSize' | 'storageDriver' | 'partitionCode' | 'storagePath'>
  ) =>
    [
      attachment.fileName?.trim() ?? '',
      attachment.fileSize ?? '',
      attachment.storageDriver ?? '',
      attachment.partitionCode ?? '',
    ].join('|')
  const attachments = await em.find(
    Attachment,
    {
      entityId: E.catalog.catalog_product_variant,
      recordId: variant.id,
      organizationId: variant.organizationId ?? undefined,
      tenantId: variant.tenantId ?? undefined,
    },
    {
      fields: [
        'id',
        'partitionCode',
        'fileName',
        'mimeType',
        'fileSize',
        'storageDriver',
        'storagePath',
        'storageMetadata',
        'url',
        'organizationId',
        'tenantId',
        'fileSize',
        'storageDriver',
        'partitionCode',
      ],
    }
  )
  if (!attachments.length) return
  const existing = await em.find(
    Attachment,
    {
      entityId: E.catalog.catalog_product,
      recordId: productId,
      organizationId: variant.organizationId ?? undefined,
      tenantId: variant.tenantId ?? undefined,
    },
    {
      fields: ['storagePath', 'fileName', 'fileSize', 'storageDriver', 'partitionCode'],
    }
  )
  const existingKeys = new Set(existing.map((item) => buildKey(item)))
  let created = 0
  for (const source of attachments) {
    const key = buildKey(source)
    if (existingKeys.has(key)) continue
    const clone = em.create(Attachment, {
      entityId: E.catalog.catalog_product,
      recordId: productId,
      organizationId: source.organizationId ?? variant.organizationId ?? null,
      tenantId: source.tenantId ?? variant.tenantId ?? null,
      partitionCode: source.partitionCode,
      fileName: source.fileName,
      mimeType: source.mimeType,
      fileSize: source.fileSize,
      storageDriver: source.storageDriver,
      storagePath: source.storagePath,
      storageMetadata: source.storageMetadata ? cloneJson(source.storageMetadata) : null,
      url: source.url,
    })
    em.persist(clone)
    existingKeys.add(key)
    created += 1
  }
  if (created > 0) {
    await em.flush()
  }
}

const createVariantCommand: CommandHandler<VariantCreateInput, { variantId: string; previousDefaultVariantId?: string | null }> = {
  id: 'catalog.variants.create',
  async execute(rawInput, ctx) {
    const { parsed, custom } = parseWithCustomFields(variantCreateSchema, rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const product = await requireProduct(em, parsed.productId)
    ensureTenantScope(ctx, product.tenantId)
    ensureOrganizationScope(ctx, product.organizationId)
    const { taxRateId, taxRate } = await resolveVariantTaxRate(
      em,
      product,
      parsed.taxRateId ?? null,
      parsed.taxRate
    )

    const metadataSplit = splitOptionValuesFromMetadata(parsed.metadata)
    const resolvedOptionValues =
      parsed.optionValues ?? (metadataSplit.hadOptionValues ? metadataSplit.optionValues : null)

    const now = new Date()
    const record = em.create(CatalogProductVariant, {
      organizationId: product.organizationId,
      tenantId: product.tenantId,
      product,
      name: parsed.name ?? null,
      sku: parsed.sku ?? null,
      barcode: parsed.barcode ?? null,
      statusEntryId: parsed.statusEntryId ?? null,
      isDefault: parsed.isDefault ?? false,
      isActive: parsed.isActive ?? true,
      weightValue: toNumericString(parsed.weightValue),
      weightUnit: parsed.weightUnit ?? null,
      taxRateId,
      taxRate,
      dimensions: parsed.dimensions ? cloneJson(parsed.dimensions) : null,
      metadata: metadataSplit.metadata,
      optionValues: resolvedOptionValues ? cloneJson(resolvedOptionValues) : null,
      customFieldsetCode: parsed.customFieldsetCode ?? null,
      createdAt: now,
      updatedAt: now,
    })
    em.persist(record)
    await em.flush()
    let previousDefaultVariantId: string | null = null
    if (record.isDefault) {
      previousDefaultVariantId = await enforceSingleDefaultVariant(em, record)
      await em.flush()
    }
    await aggregateVariantMediaToProduct(em, record)
    await setCustomFieldsIfAny({
      dataEngine: ctx.container.resolve('dataEngine'),
      entityId: E.catalog.catalog_product_variant,
      recordId: record.id,
      organizationId: record.organizationId,
      tenantId: record.tenantId,
      values: custom,
    })
    await emitCatalogQueryIndexEvent(ctx, {
      entityType: E.catalog.catalog_product_variant,
      recordId: record.id,
      organizationId: record.organizationId,
      tenantId: record.tenantId,
      action: 'created',
    })
    return { variantId: record.id, previousDefaultVariantId }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    return loadVariantSnapshot(em, result.variantId)
  },
  buildLog: async ({ result, snapshots }) => {
    const after = snapshots.after as VariantSnapshot | undefined
    if (!after) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('catalog.audit.variants.create', 'Create product variant'),
      resourceKind: 'catalog.variant',
      resourceId: result.variantId,
      parentResourceKind: 'catalog.product',
      parentResourceId: after.productId ?? null,
      tenantId: after.tenantId,
      organizationId: after.organizationId,
      snapshotAfter: after,
      payload: {
        undo: {
          after,
          previousDefaultVariantId: (result as { previousDefaultVariantId?: string | null })?.previousDefaultVariantId ?? null,
        } satisfies VariantUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<VariantUndoPayload>(logEntry)
    const after = payload?.after
    if (!after) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(CatalogProductVariant, { id: after.id })
    if (!record) return
    ensureTenantScope(ctx, record.tenantId)
    ensureOrganizationScope(ctx, record.organizationId)
    em.remove(record)
    await em.flush()
    if (payload?.previousDefaultVariantId) {
      const previousDefault = await em.findOne(CatalogProductVariant, { id: payload.previousDefaultVariantId })
      if (previousDefault) {
        ensureTenantScope(ctx, previousDefault.tenantId)
        ensureOrganizationScope(ctx, previousDefault.organizationId)
        previousDefault.isDefault = true
        await em.flush()
      }
    }
    const resetValues = buildCustomFieldResetMap(undefined, after.custom ?? undefined)
    if (Object.keys(resetValues).length) {
      await setCustomFieldsIfAny({
        dataEngine: ctx.container.resolve('dataEngine'),
        entityId: E.catalog.catalog_product_variant,
        recordId: after.id,
        organizationId: after.organizationId,
        tenantId: after.tenantId,
        values: resetValues,
      })
    }
  },
}

const updateVariantCommand: CommandHandler<VariantUpdateInput, { variantId: string; previousDefaultVariantId?: string | null }> = {
  id: 'catalog.variants.update',
  async prepare(input, ctx) {
    const id = requireId(input, 'Variant id is required')
    const em = (ctx.container.resolve('em') as EntityManager)
    const snapshot = await loadVariantSnapshot(em, id)
    if (snapshot) {
      ensureTenantScope(ctx, snapshot.tenantId)
      ensureOrganizationScope(ctx, snapshot.organizationId)
    }
    return snapshot ? { before: snapshot } : {}
  },
  async execute(rawInput, ctx) {
    const { parsed, custom } = parseWithCustomFields(variantUpdateSchema, rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(CatalogProductVariant, { id: parsed.id, deletedAt: null })
    if (!record) throw new CrudHttpError(404, { error: 'Catalog variant not found' })
    ensureTenantScope(ctx, record.tenantId)
    ensureOrganizationScope(ctx, record.organizationId)
    const product = await requireProduct(em, record.product.id)

    if (!product) throw new CrudHttpError(400, { error: 'Variant product missing' })

    const taxRateProvided = parsed.taxRateId !== undefined || parsed.taxRate !== undefined
    const resolvedTaxRate = taxRateProvided
      ? await resolveVariantTaxRate(em, product, parsed.taxRateId ?? null, parsed.taxRate)
      : null

    if (parsed.name !== undefined) record.name = parsed.name ?? null
    if (parsed.sku !== undefined) record.sku = parsed.sku ?? null
    if (parsed.barcode !== undefined) record.barcode = parsed.barcode ?? null
    if (parsed.statusEntryId !== undefined) record.statusEntryId = parsed.statusEntryId ?? null
    if (parsed.isDefault !== undefined) record.isDefault = parsed.isDefault
    if (parsed.isActive !== undefined) record.isActive = parsed.isActive
    if (Object.prototype.hasOwnProperty.call(parsed, 'weightValue')) {
      record.weightValue = toNumericString(parsed.weightValue)
    }
    if (parsed.weightUnit !== undefined) record.weightUnit = parsed.weightUnit ?? null
    if (parsed.dimensions !== undefined) {
      record.dimensions = parsed.dimensions ? cloneJson(parsed.dimensions) : null
    }
    let metadataSplit: MetadataSplitResult | null = null
    if (parsed.metadata !== undefined) {
      metadataSplit = splitOptionValuesFromMetadata(parsed.metadata)
      record.metadata = metadataSplit.metadata
    }
    if (parsed.optionValues !== undefined) {
      record.optionValues = parsed.optionValues ? cloneJson(parsed.optionValues) : null
    } else if (metadataSplit?.hadOptionValues) {
      record.optionValues = metadataSplit.optionValues ? cloneJson(metadataSplit.optionValues) : null
    }
    if (taxRateProvided) {
      record.taxRateId = resolvedTaxRate?.taxRateId ?? null
      record.taxRate = resolvedTaxRate?.taxRate ?? null
    }
    if (parsed.customFieldsetCode !== undefined) {
      record.customFieldsetCode = parsed.customFieldsetCode ?? null
    }

    let previousDefaultVariantId: string | null = null
    if (parsed.isDefault === true) {
      previousDefaultVariantId = await enforceSingleDefaultVariant(em, record)
    }
    await em.flush()
    await aggregateVariantMediaToProduct(em, record)
    if (custom && Object.keys(custom).length) {
      await setCustomFieldsIfAny({
        dataEngine: ctx.container.resolve('dataEngine'),
        entityId: E.catalog.catalog_product_variant,
        recordId: record.id,
        organizationId: record.organizationId,
        tenantId: record.tenantId,
        values: custom,
      })
    }
    await emitCatalogQueryIndexEvent(ctx, {
      entityType: E.catalog.catalog_product_variant,
      recordId: record.id,
      organizationId: record.organizationId,
      tenantId: record.tenantId,
      action: 'updated',
    })
    return { variantId: record.id, previousDefaultVariantId }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    return loadVariantSnapshot(em, result.variantId)
  },
  buildLog: async ({ result, snapshots }) => {
    const before = snapshots.before as VariantSnapshot | undefined
    const after = snapshots.after as VariantSnapshot | undefined
    if (!before || !after) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('catalog.audit.variants.update', 'Update product variant'),
      resourceKind: 'catalog.variant',
      resourceId: before.id,
      parentResourceKind: 'catalog.product',
      parentResourceId: before.productId ?? null,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      snapshotAfter: after,
      changes: buildChanges(
        before as Record<string, unknown>,
        after as Record<string, unknown>,
        VARIANT_CHANGE_KEYS
      ),
      payload: {
        undo: {
          before,
          after,
          previousDefaultVariantId:
            (result as { previousDefaultVariantId?: string | null })?.previousDefaultVariantId ?? null,
        } satisfies VariantUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<VariantUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const after = payload?.after
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    let record = await em.findOne(CatalogProductVariant, { id: before.id })
    if (!record) {
      const product = await requireProduct(em, before.productId)
      record = em.create(CatalogProductVariant, {
        id: before.id,
        product,
        organizationId: before.organizationId,
        tenantId: before.tenantId,
        name: before.name ?? null,
        sku: before.sku ?? null,
        barcode: before.barcode ?? null,
        statusEntryId: before.statusEntryId ?? null,
        isDefault: before.isDefault,
        isActive: before.isActive,
        weightValue: before.weightValue ?? null,
        weightUnit: before.weightUnit ?? null,
        dimensions: before.dimensions ? cloneJson(before.dimensions) : null,
        metadata: before.metadata ? cloneJson(before.metadata) : null,
        optionValues: before.optionValues ? cloneJson(before.optionValues) : null,
        customFieldsetCode: before.customFieldsetCode ?? null,
        createdAt: new Date(before.createdAt),
        updatedAt: new Date(before.updatedAt),
      })
      em.persist(record)
    }
    ensureTenantScope(ctx, before.tenantId)
    ensureOrganizationScope(ctx, before.organizationId)
    applyVariantSnapshot(record, before)
    await em.flush()
    const previousDefaultId = payload?.previousDefaultVariantId
    if (previousDefaultId) {
      const previousDefault = await em.findOne(CatalogProductVariant, { id: previousDefaultId })
      if (previousDefault) {
        ensureTenantScope(ctx, previousDefault.tenantId)
        ensureOrganizationScope(ctx, previousDefault.organizationId)
        previousDefault.isDefault = true
        await em.flush()
      }
    }
    const resetValues = buildCustomFieldResetMap(
      before.custom ?? undefined,
      after?.custom ?? undefined
    )
    if (Object.keys(resetValues).length) {
      await setCustomFieldsIfAny({
        dataEngine: ctx.container.resolve('dataEngine'),
        entityId: E.catalog.catalog_product_variant,
        recordId: before.id,
        organizationId: before.organizationId,
        tenantId: before.tenantId,
        values: resetValues,
      })
    }
  },
}

const deleteVariantCommand: CommandHandler<
  { body?: Record<string, unknown>; query?: Record<string, unknown> },
  { variantId: string }
> = {
  id: 'catalog.variants.delete',
  async prepare(input, ctx) {
    const id = requireId(input, 'Variant id is required')
    const em = (ctx.container.resolve('em') as EntityManager)
    const snapshot = await loadVariantSnapshot(em, id, { includePrices: true })
    if (snapshot) {
      ensureTenantScope(ctx, snapshot.tenantId)
      ensureOrganizationScope(ctx, snapshot.organizationId)
    }
    return snapshot ? { before: snapshot } : {}
  },
  async execute(input, ctx) {
    const id = requireId(input, 'Variant id is required')
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(CatalogProductVariant, { id })
    if (!record) throw new CrudHttpError(404, { error: 'Catalog variant not found' })
    ensureTenantScope(ctx, record.tenantId)
    ensureOrganizationScope(ctx, record.organizationId)

    const baseEm = (ctx.container.resolve('em') as EntityManager)
    const snapshot = await loadVariantSnapshot(baseEm, id, { includePrices: true })
    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    const priceSnapshots =
      snapshot?.prices && snapshot.prices.length
        ? snapshot.prices
        : await loadVariantPriceSnapshots(baseEm, id)

    if (priceSnapshots.length) {
      await em.nativeDelete(CatalogProductPrice, { id: { $in: priceSnapshots.map((price) => price.id) } })
    } else {
      await em.nativeDelete(CatalogProductPrice, { variant: record })
    }
    em.remove(record)
    await em.flush()
    for (const priceSnapshot of priceSnapshots) {
      const resetValues = buildCustomFieldResetMap(priceSnapshot.custom ?? undefined, undefined)
      if (!Object.keys(resetValues).length) continue
      await setCustomFieldsIfAny({
        dataEngine,
        entityId: E.catalog.catalog_product_price,
        recordId: priceSnapshot.id,
        organizationId: priceSnapshot.organizationId,
        tenantId: priceSnapshot.tenantId,
        values: resetValues,
      })
    }
    if (snapshot?.custom && Object.keys(snapshot.custom).length) {
      const resetValues = buildCustomFieldResetMap(snapshot.custom, undefined)
      if (Object.keys(resetValues).length) {
        await setCustomFieldsIfAny({
          dataEngine,
          entityId: E.catalog.catalog_product_variant,
          recordId: id,
          organizationId: snapshot.organizationId,
          tenantId: snapshot.tenantId,
          values: resetValues,
        })
      }
    }
    await emitCatalogQueryIndexEvent(ctx, {
      entityType: E.catalog.catalog_product_variant,
      recordId: id,
      organizationId: snapshot?.organizationId ?? record.organizationId,
      tenantId: snapshot?.tenantId ?? record.tenantId,
      action: 'deleted',
    })
    return { variantId: id }
  },
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as VariantSnapshot | undefined
    if (!before) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('catalog.audit.variants.delete', 'Delete product variant'),
      resourceKind: 'catalog.variant',
      resourceId: before.id,
      parentResourceKind: 'catalog.product',
      parentResourceId: before.productId ?? null,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      payload: {
        undo: {
          before,
        } satisfies VariantUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<VariantUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    let record = await em.findOne(CatalogProductVariant, { id: before.id })
    if (!record) {
      const product = await requireProduct(em, before.productId)
      record = em.create(CatalogProductVariant, {
        id: before.id,
        product,
        organizationId: before.organizationId,
        tenantId: before.tenantId,
        name: before.name ?? null,
        sku: before.sku ?? null,
        barcode: before.barcode ?? null,
        statusEntryId: before.statusEntryId ?? null,
        isDefault: before.isDefault,
        isActive: before.isActive,
        weightValue: before.weightValue ?? null,
        weightUnit: before.weightUnit ?? null,
        dimensions: before.dimensions ? cloneJson(before.dimensions) : null,
        metadata: before.metadata ? cloneJson(before.metadata) : null,
        customFieldsetCode: before.customFieldsetCode ?? null,
        createdAt: new Date(before.createdAt),
        updatedAt: new Date(before.updatedAt),
      })
      em.persist(record)
    }
    ensureTenantScope(ctx, before.tenantId)
    ensureOrganizationScope(ctx, before.organizationId)
    applyVariantSnapshot(record, before)
    if (before.prices?.length) {
      const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
      await restoreVariantPricesFromSnapshots(em, record, before.prices, dataEngine)
    }
    await em.flush()
    if (before.custom && Object.keys(before.custom).length) {
      await setCustomFieldsIfAny({
        dataEngine: ctx.container.resolve('dataEngine'),
        entityId: E.catalog.catalog_product_variant,
        recordId: before.id,
        organizationId: before.organizationId,
        tenantId: before.tenantId,
        values: before.custom,
      })
    }
  },
}

registerCommand(createVariantCommand)
registerCommand(updateVariantCommand)
registerCommand(deleteVariantCommand)
