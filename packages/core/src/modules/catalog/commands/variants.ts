import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { buildChanges, requireId, parseWithCustomFields, setCustomFieldsIfAny } from '@open-mercato/shared/lib/commands/helpers'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { loadCustomFieldSnapshot, buildCustomFieldResetMap } from '@open-mercato/shared/lib/commands/customFieldSnapshots'
import { E } from '@open-mercato/core/generated/entities.ids.generated'
import { CatalogProductVariant, CatalogProductPrice } from '../data/entities'
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
  defaultMediaId: string | null
  defaultMediaUrl: string | null
  weightValue: string | null
  weightUnit: string | null
  dimensions: Record<string, unknown> | null
  metadata: Record<string, unknown> | null
  optionValues: Record<string, string> | null
  customFieldsetCode: string | null
  createdAt: string
  updatedAt: string
  custom: Record<string, unknown> | null
}

type VariantUndoPayload = {
  before?: VariantSnapshot | null
  after?: VariantSnapshot | null
}

const VARIANT_CHANGE_KEYS = [
  'name',
  'sku',
  'barcode',
  'statusEntryId',
  'isDefault',
  'isActive',
  'defaultMediaId',
  'defaultMediaUrl',
  'weightValue',
  'weightUnit',
  'dimensions',
  'optionValues',
  'customFieldsetCode',
  'metadata',
] as const satisfies readonly string[]

async function loadVariantSnapshot(
  em: EntityManager,
  id: string
): Promise<VariantSnapshot | null> {
  const record = await em.findOne(CatalogProductVariant, { id, deletedAt: null })
  if (!record) return null
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
    defaultMediaId: record.defaultMediaId ?? null,
    defaultMediaUrl: record.defaultMediaUrl ?? null,
    weightValue: record.weightValue ?? null,
    weightUnit: record.weightUnit ?? null,
    dimensions: record.dimensions ? cloneJson(record.dimensions) : null,
    metadata: record.metadata ? cloneJson(record.metadata) : null,
    optionValues: record.optionValues ? cloneJson(record.optionValues) : null,
    customFieldsetCode: record.customFieldsetCode ?? null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    custom: Object.keys(custom).length ? custom : null,
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
  record.defaultMediaId = snapshot.defaultMediaId ?? null
  record.defaultMediaUrl = snapshot.defaultMediaUrl ?? null
  record.weightValue = snapshot.weightValue ?? null
  record.weightUnit = snapshot.weightUnit ?? null
  record.dimensions = snapshot.dimensions ? cloneJson(snapshot.dimensions) : null
  record.metadata = snapshot.metadata ? cloneJson(snapshot.metadata) : null
  record.optionValues = snapshot.optionValues ? cloneJson(snapshot.optionValues) : null
  record.customFieldsetCode = snapshot.customFieldsetCode ?? null
  record.createdAt = new Date(snapshot.createdAt)
  record.updatedAt = new Date(snapshot.updatedAt)
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

const createVariantCommand: CommandHandler<VariantCreateInput, { variantId: string }> = {
  id: 'catalog.variants.create',
  async execute(rawInput, ctx) {
    const { parsed, custom } = parseWithCustomFields(variantCreateSchema, rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const product = await requireProduct(em, parsed.productId)
    ensureTenantScope(ctx, product.tenantId)
    ensureOrganizationScope(ctx, product.organizationId)

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
      defaultMediaId: parsed.defaultMediaId ?? null,
      defaultMediaUrl: parsed.defaultMediaUrl ?? null,
      weightValue: toNumericString(parsed.weightValue),
      weightUnit: parsed.weightUnit ?? null,
      dimensions: parsed.dimensions ? cloneJson(parsed.dimensions) : null,
      metadata: metadataSplit.metadata,
      optionValues: resolvedOptionValues ? cloneJson(resolvedOptionValues) : null,
      customFieldsetCode: parsed.customFieldsetCode ?? null,
      createdAt: now,
      updatedAt: now,
    })
    em.persist(record)
    await em.flush()
    await em.flush()
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
    return { variantId: record.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager)
    return loadVariantSnapshot(em, result.variantId)
  },
  buildLog: async ({ result, ctx }) => {
    const em = (ctx.container.resolve('em') as EntityManager)
    const after = await loadVariantSnapshot(em, result.variantId)
    if (!after) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('catalog.audit.variants.create', 'Create product variant'),
      resourceKind: 'catalog.variant',
      resourceId: result.variantId,
      tenantId: after.tenantId,
      organizationId: after.organizationId,
      snapshotAfter: after,
      payload: {
        undo: {
          after,
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

const updateVariantCommand: CommandHandler<VariantUpdateInput, { variantId: string }> = {
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

    if (parsed.name !== undefined) record.name = parsed.name ?? null
    if (parsed.sku !== undefined) record.sku = parsed.sku ?? null
    if (parsed.barcode !== undefined) record.barcode = parsed.barcode ?? null
    if (parsed.statusEntryId !== undefined) record.statusEntryId = parsed.statusEntryId ?? null
    if (parsed.isDefault !== undefined) record.isDefault = parsed.isDefault
    if (parsed.isActive !== undefined) record.isActive = parsed.isActive
    if (parsed.defaultMediaId !== undefined) record.defaultMediaId = parsed.defaultMediaId ?? null
    if (parsed.defaultMediaUrl !== undefined) record.defaultMediaUrl = parsed.defaultMediaUrl ?? null
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
    if (parsed.customFieldsetCode !== undefined) {
      record.customFieldsetCode = parsed.customFieldsetCode ?? null
    }

    await em.flush()
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
    return { variantId: record.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager)
    return loadVariantSnapshot(em, result.variantId)
  },
  buildLog: async ({ result, ctx, snapshots }) => {
    const before = snapshots.before as VariantSnapshot | undefined
    const em = (ctx.container.resolve('em') as EntityManager)
    const after = await loadVariantSnapshot(em, result.variantId)
    if (!before || !after) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('catalog.audit.variants.update', 'Update product variant'),
      resourceKind: 'catalog.variant',
      resourceId: before.id,
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
    const snapshot = await loadVariantSnapshot(em, id)
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
    const snapshot = await loadVariantSnapshot(baseEm, id)

    const priceCount = await em.count(CatalogProductPrice, { variant: record })
    if (priceCount > 0) {
      throw new CrudHttpError(400, { error: 'Remove variant prices before deleting the variant.' })
    }
    em.remove(record)
    await em.flush()
    if (snapshot?.custom && Object.keys(snapshot.custom).length) {
      const resetValues = buildCustomFieldResetMap(snapshot.custom, undefined)
      if (Object.keys(resetValues).length) {
        await setCustomFieldsIfAny({
          dataEngine: ctx.container.resolve('dataEngine'),
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
