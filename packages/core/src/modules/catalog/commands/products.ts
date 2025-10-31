import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { buildChanges, requireId, parseWithCustomFields, setCustomFieldsIfAny } from '@open-mercato/shared/lib/commands/helpers'
import type { EntityManager } from '@mikro-orm/postgresql'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { loadCustomFieldSnapshot, buildCustomFieldResetMap } from '@open-mercato/shared/lib/commands/customFieldSnapshots'
import { E } from '@open-mercato/core/generated/entities.ids.generated'
import {
  CatalogProduct,
  CatalogProductOption,
  CatalogProductVariant,
} from '../data/entities'
import {
  productCreateSchema,
  productUpdateSchema,
  type ProductCreateInput,
  type ProductUpdateInput,
} from '../data/validators'
import {
  cloneJson,
  ensureOrganizationScope,
  ensureSameScope,
  ensureTenantScope,
  extractUndoPayload,
} from './shared'

type ProductSnapshot = {
  id: string
  organizationId: string
  tenantId: string
  name: string
  description: string | null
  code: string | null
  statusEntryId: string | null
  primaryCurrencyCode: string | null
  defaultUnit: string | null
  channelIds: string[] | null
  metadata: Record<string, unknown> | null
  isConfigurable: boolean
  isActive: boolean
  createdAt: string
  updatedAt: string
  custom: Record<string, unknown> | null
}

type ProductUndoPayload = {
  before?: ProductSnapshot | null
  after?: ProductSnapshot | null
}

const PRODUCT_CHANGE_KEYS = [
  'name',
  'description',
  'code',
  'statusEntryId',
  'primaryCurrencyCode',
  'defaultUnit',
  'metadata',
  'isConfigurable',
  'isActive',
] as const satisfies readonly string[]

function dedupeIds(ids: string[] | null | undefined): string[] | null {
  if (!ids || !ids.length) return null
  return Array.from(new Set(ids))
}

async function loadProductSnapshot(
  em: EntityManager,
  id: string
): Promise<ProductSnapshot | null> {
  const record = await em.findOne(CatalogProduct, { id, deletedAt: null })
  if (!record) return null
  const custom = await loadCustomFieldSnapshot(em, {
    entityId: E.catalog.catalog_product,
    recordId: record.id,
    tenantId: record.tenantId,
    organizationId: record.organizationId,
  })
  return {
    id: record.id,
    organizationId: record.organizationId,
    tenantId: record.tenantId,
    name: record.name,
    description: record.description ?? null,
    code: record.code ?? null,
    statusEntryId: record.statusEntryId ?? null,
    primaryCurrencyCode: record.primaryCurrencyCode ?? null,
    defaultUnit: record.defaultUnit ?? null,
    channelIds: record.channelIds ? [...record.channelIds] : null,
    metadata: record.metadata ? cloneJson(record.metadata) : null,
    isConfigurable: record.isConfigurable,
    isActive: record.isActive,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    custom: Object.keys(custom).length ? custom : null,
  }
}

function applyProductSnapshot(record: CatalogProduct, snapshot: ProductSnapshot): void {
  record.organizationId = snapshot.organizationId
  record.tenantId = snapshot.tenantId
  record.name = snapshot.name
  record.description = snapshot.description ?? null
  record.code = snapshot.code ?? null
  record.statusEntryId = snapshot.statusEntryId ?? null
  record.primaryCurrencyCode = snapshot.primaryCurrencyCode ?? null
  record.defaultUnit = snapshot.defaultUnit ?? null
  record.channelIds = snapshot.channelIds ? [...snapshot.channelIds] : null
  record.metadata = snapshot.metadata ? cloneJson(snapshot.metadata) : null
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
    const em = ctx.container.resolve<EntityManager>('em').fork()
    const now = new Date()
    const record = em.create(CatalogProduct, {
      organizationId: parsed.organizationId,
      tenantId: parsed.tenantId,
      name: parsed.name,
      description: parsed.description ?? null,
      code: parsed.code ?? null,
      statusEntryId: parsed.statusEntryId ?? null,
      primaryCurrencyCode: parsed.primaryCurrencyCode ?? null,
      defaultUnit: parsed.defaultUnit ?? null,
      channelIds: dedupeIds(parsed.channelIds),
      metadata: parsed.metadata ? cloneJson(parsed.metadata) : null,
      isConfigurable: parsed.isConfigurable ?? false,
      isActive: parsed.isActive ?? true,
      createdAt: now,
      updatedAt: now,
    })
    em.persist(record)
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
    const em = ctx.container.resolve<EntityManager>('em')
    return loadProductSnapshot(em, result.productId)
  },
  buildLog: async ({ result, ctx }) => {
    const em = ctx.container.resolve<EntityManager>('em')
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
    const em = ctx.container.resolve<EntityManager>('em').fork()
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
    const em = ctx.container.resolve<EntityManager>('em')
    const snapshot = await loadProductSnapshot(em, id)
    if (snapshot) {
      ensureTenantScope(ctx, snapshot.tenantId)
      ensureOrganizationScope(ctx, snapshot.organizationId)
    }
    return snapshot ? { before: snapshot } : {}
  },
  async execute(rawInput, ctx) {
    const { parsed, custom } = parseWithCustomFields(productUpdateSchema, rawInput)
    const em = ctx.container.resolve<EntityManager>('em').fork()
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
    if (parsed.statusEntryId !== undefined) record.statusEntryId = parsed.statusEntryId ?? null
    if (parsed.primaryCurrencyCode !== undefined) {
      record.primaryCurrencyCode = parsed.primaryCurrencyCode ?? null
    }
    if (parsed.defaultUnit !== undefined) record.defaultUnit = parsed.defaultUnit ?? null
    if (parsed.channelIds !== undefined) {
      record.channelIds = dedupeIds(parsed.channelIds)
    }
    if (parsed.metadata !== undefined) {
      record.metadata = parsed.metadata ? cloneJson(parsed.metadata) : null
    }
    if (parsed.isConfigurable !== undefined) record.isConfigurable = parsed.isConfigurable
    if (parsed.isActive !== undefined) record.isActive = parsed.isActive
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
    const em = ctx.container.resolve<EntityManager>('em')
    return loadProductSnapshot(em, result.productId)
  },
  buildLog: async ({ result, ctx, snapshots }) => {
    const before = snapshots.before as ProductSnapshot | undefined
    const em = ctx.container.resolve<EntityManager>('em')
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
    const em = ctx.container.resolve<EntityManager>('em').fork()
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
        channelIds: before.channelIds ? [...before.channelIds] : null,
        metadata: before.metadata ? cloneJson(before.metadata) : null,
        isConfigurable: before.isConfigurable,
        isActive: before.isActive,
        createdAt: new Date(before.createdAt),
        updatedAt: new Date(before.updatedAt),
      })
      em.persist(record)
    }
    ensureTenantScope(ctx, before.tenantId)
    ensureOrganizationScope(ctx, before.organizationId)
    applyProductSnapshot(record, before)
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
    const em = ctx.container.resolve<EntityManager>('em')
    const snapshot = await loadProductSnapshot(em, id)
    if (snapshot) {
      ensureTenantScope(ctx, snapshot.tenantId)
      ensureOrganizationScope(ctx, snapshot.organizationId)
    }
    return snapshot ? { before: snapshot } : {}
  },
  async execute(input, ctx) {
    const id = requireId(input, 'Product id is required')
    const em = ctx.container.resolve<EntityManager>('em').fork()
    const record = await em.findOne(CatalogProduct, { id })
    if (!record) throw new CrudHttpError(404, { error: 'Catalog product not found' })
    const baseEm = ctx.container.resolve<EntityManager>('em')
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
    const em = ctx.container.resolve<EntityManager>('em').fork()
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
        channelIds: before.channelIds ? [...before.channelIds] : null,
        metadata: before.metadata ? cloneJson(before.metadata) : null,
        isConfigurable: before.isConfigurable,
        isActive: before.isActive,
        createdAt: new Date(before.createdAt),
        updatedAt: new Date(before.updatedAt),
      })
      em.persist(record)
    }
    ensureTenantScope(ctx, before.tenantId)
    ensureOrganizationScope(ctx, before.organizationId)
    applyProductSnapshot(record, before)
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
