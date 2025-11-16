import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { buildChanges, requireId, parseWithCustomFields, setCustomFieldsIfAny } from '@open-mercato/shared/lib/commands/helpers'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { loadCustomFieldSnapshot, buildCustomFieldResetMap } from '@open-mercato/shared/lib/commands/customFieldSnapshots'
import { E } from '@open-mercato/core/generated/entities.ids.generated'
import {
  CatalogProduct,
  CatalogProductOption,
  CatalogProductOptionValue,
  CatalogProductVariant,
  CatalogVariantOptionValue,
  CatalogProductPrice,
} from '../data/entities'
import {
  variantCreateSchema,
  variantUpdateSchema,
  type VariantCreateInput,
  type VariantUpdateInput,
} from '../data/validators'
import {
  cloneJson,
  ensureOrganizationScope,
  ensureSameScope,
  ensureTenantScope,
  extractUndoPayload,
  requireOption,
  requireOptionValue,
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
  weightValue: string | null
  weightUnit: string | null
  dimensions: Record<string, unknown> | null
  metadata: Record<string, unknown> | null
  customFieldsetCode: string | null
  optionValueIds: string[]
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
  'weightValue',
  'weightUnit',
  'dimensions',
  'customFieldsetCode',
  'metadata',
] as const satisfies readonly string[]

type VariantOptionConfiguration =
  | {
      optionId: string
      optionValueIds: string[]
    }[]
  | undefined
  | null

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
  const variantOptionValues = await em.find(
    CatalogVariantOptionValue,
    { variant: record },
    { populate: ['optionValue'] }
  )
  const optionValueIds = variantOptionValues.map((link) =>
    typeof link.optionValue === 'string' ? link.optionValue : link.optionValue.id
  )
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
    dimensions: record.dimensions ? cloneJson(record.dimensions) : null,
    metadata: record.metadata ? cloneJson(record.metadata) : null,
    customFieldsetCode: record.customFieldsetCode ?? null,
    optionValueIds,
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
  record.weightValue = snapshot.weightValue ?? null
  record.weightUnit = snapshot.weightUnit ?? null
  record.dimensions = snapshot.dimensions ? cloneJson(snapshot.dimensions) : null
  record.metadata = snapshot.metadata ? cloneJson(snapshot.metadata) : null
  record.customFieldsetCode = snapshot.customFieldsetCode ?? null
  record.createdAt = new Date(snapshot.createdAt)
  record.updatedAt = new Date(snapshot.updatedAt)
}

async function syncVariantOptionValues(
  em: EntityManager,
  variant: CatalogProductVariant,
  configuration: VariantOptionConfiguration
): Promise<void> {
  if (configuration === undefined) return
  await em.nativeDelete(CatalogVariantOptionValue, { variant: variant.id })
  if (!configuration || configuration.length === 0) return

  const grouped = new Map<string, Set<string>>()
  for (const entry of configuration) {
    if (!entry || !entry.optionId) continue
    const set = grouped.get(entry.optionId) ?? new Set<string>()
    for (const valueId of entry.optionValueIds ?? []) {
      if (valueId) set.add(valueId)
    }
    if (set.size) grouped.set(entry.optionId, set)
  }
  if (!grouped.size) return

  const productId = typeof variant.product === 'string' ? variant.product : variant.product.id

  for (const [optionId, valueIds] of grouped.entries()) {
    const option = await requireOption(
      em,
      optionId,
      'Catalog option not found for variant configuration'
    )
    const optionProductId =
      typeof option.product === 'string' ? option.product : option.product.id
    if (optionProductId !== productId) {
      throw new CrudHttpError(400, { error: 'Option does not belong to the same product.' })
    }
    ensureSameScope(option, variant.organizationId, variant.tenantId)
    if (!valueIds.size) continue
    const values = await em.find(CatalogProductOptionValue, {
      id: { $in: Array.from(valueIds) },
      option,
    })
    if (values.length !== valueIds.size) {
      throw new CrudHttpError(400, { error: 'One or more option values not found for configuration.' })
    }
    for (const value of values) {
      ensureSameScope(value, variant.organizationId, variant.tenantId)
      const link = em.create(CatalogVariantOptionValue, {
        variant,
        optionValue: value,
        organizationId: variant.organizationId,
        tenantId: variant.tenantId,
      })
      em.persist(link)
    }
  }
}

async function restoreVariantOptionValues(
  em: EntityManager,
  variant: CatalogProductVariant,
  optionValueIds: string[]
): Promise<void> {
  await em.nativeDelete(CatalogVariantOptionValue, { variant: variant.id })
  if (!optionValueIds.length) return
  const values = await em.find(CatalogProductOptionValue, { id: { $in: optionValueIds } })
  if (values.length !== optionValueIds.length) {
    throw new CrudHttpError(400, { error: 'Unable to restore variant configuration.' })
  }
  const productId = typeof variant.product === 'string' ? variant.product : variant.product.id
  for (const value of values) {
    const option = value.option as CatalogProductOption | string
    const optionId = typeof option === 'string' ? option : option.id
    const optionEntity =
      typeof option === 'string'
        ? await em.findOne(CatalogProductOption, { id: optionId })
        : option
    if (!optionEntity) continue
    const optionProductId =
      typeof optionEntity.product === 'string'
        ? optionEntity.product
        : optionEntity.product.id
    if (optionProductId !== productId) continue
    const link = em.create(CatalogVariantOptionValue, {
      variant,
      optionValue: value,
      organizationId: variant.organizationId,
      tenantId: variant.tenantId,
    })
    em.persist(link)
  }
}

const createVariantCommand: CommandHandler<VariantCreateInput, { variantId: string }> = {
  id: 'catalog.variants.create',
  async execute(rawInput, ctx) {
    const { parsed, custom } = parseWithCustomFields(variantCreateSchema, rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const product = await requireProduct(em, parsed.productId)
    ensureTenantScope(ctx, product.tenantId)
    ensureOrganizationScope(ctx, product.organizationId)

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
      dimensions: parsed.dimensions ? cloneJson(parsed.dimensions) : null,
      metadata: parsed.metadata ? cloneJson(parsed.metadata) : null,
      customFieldsetCode: parsed.customFieldsetCode ?? null,
      createdAt: now,
      updatedAt: now,
    })
    em.persist(record)
    await em.flush()
    await syncVariantOptionValues(em, record, parsed.optionConfiguration)
    await em.flush()
    await setCustomFieldsIfAny({
      dataEngine: ctx.container.resolve('dataEngine'),
      entityId: E.catalog.catalog_product_variant,
      recordId: record.id,
      organizationId: record.organizationId,
      tenantId: record.tenantId,
      values: custom,
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
    await em.nativeDelete(CatalogVariantOptionValue, { variant: record.id })
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
    const product = record.product as CatalogProduct | string
    const productEntity =
      typeof product === 'string' ? await requireProduct(em, product) : product
    ensureTenantScope(ctx, productEntity.tenantId)
    ensureOrganizationScope(ctx, productEntity.organizationId)

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
    if (parsed.metadata !== undefined) {
      record.metadata = parsed.metadata ? cloneJson(parsed.metadata) : null
    }
    if (parsed.customFieldsetCode !== undefined) {
      record.customFieldsetCode = parsed.customFieldsetCode ?? null
    }

    if (parsed.optionConfiguration !== undefined) {
      await syncVariantOptionValues(em, record, parsed.optionConfiguration)
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
        customFieldsetCode: before.customFieldsetCode ?? null,
        createdAt: new Date(before.createdAt),
        updatedAt: new Date(before.updatedAt),
      })
      em.persist(record)
    }
    ensureTenantScope(ctx, before.tenantId)
    ensureOrganizationScope(ctx, before.organizationId)
    applyVariantSnapshot(record, before)
    await restoreVariantOptionValues(em, record, before.optionValueIds)
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
    const product = record.product as CatalogProduct | string
    const productEntity =
      typeof product === 'string' ? await requireProduct(em, product) : product
    ensureTenantScope(ctx, productEntity.tenantId)
    ensureOrganizationScope(ctx, productEntity.organizationId)

    const baseEm = (ctx.container.resolve('em') as EntityManager)
    const snapshot = await loadVariantSnapshot(baseEm, id)

    const priceCount = await em.count(CatalogProductPrice, { variant: record })
    if (priceCount > 0) {
      throw new CrudHttpError(400, { error: 'Remove variant prices before deleting the variant.' })
    }
    await em.nativeDelete(CatalogVariantOptionValue, { variant: record.id })
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
    await restoreVariantOptionValues(em, record, before.optionValueIds)
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
