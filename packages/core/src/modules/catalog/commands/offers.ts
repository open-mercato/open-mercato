import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { buildChanges, requireId, parseWithCustomFields, setCustomFieldsIfAny } from '@open-mercato/shared/lib/commands/helpers'
import type { EntityManager } from '@mikro-orm/postgresql'
import { UniqueConstraintViolationException } from '@mikro-orm/core'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CatalogOffer } from '../data/entities'
import type { CatalogOfferLocalizedContent } from '../data/types'
import {
  offerCreateSchema,
  offerUpdateSchema,
  type OfferCreateInput,
  type OfferUpdateInput,
} from '../data/validators'
import {
  cloneJson,
  ensureOrganizationScope,
  ensureSameScope,
  ensureTenantScope,
  emitCatalogQueryIndexEvent,
  extractUndoPayload,
  requireOffer,
  requireProduct,
} from './shared'
import { loadCustomFieldSnapshot, buildCustomFieldResetMap } from '@open-mercato/shared/lib/commands/customFieldSnapshots'
import { E } from '@open-mercato/core/generated/entities.ids.generated'

type OfferSnapshot = {
  id: string
  productId: string
  organizationId: string
  tenantId: string
  channelId: string
  title: string
  description: string | null
  defaultMediaId: string | null
  defaultMediaUrl: string | null
  localizedContent: Record<string, unknown> | null
  metadata: Record<string, unknown> | null
  isActive: boolean
  createdAt: string
  updatedAt: string
  custom: Record<string, unknown> | null
}

type OfferUndoPayload = {
  before?: OfferSnapshot | null
  after?: OfferSnapshot | null
}

const OFFER_CHANGE_KEYS = [
  'channelId',
  'title',
  'description',
  'defaultMediaId',
  'defaultMediaUrl',
  'localizedContent',
  'metadata',
  'isActive',
] as const satisfies readonly string[]

async function loadOfferSnapshot(em: EntityManager, id: string): Promise<OfferSnapshot | null> {
  const record = await em.findOne(
    CatalogOffer,
    { id },
    { populate: ['product'], strategy: 'select-in' },
  )
  if (!record) return null
  const productId =
    typeof record.product === 'string' ? record.product : record.product?.id ?? null
  if (!productId) return null
  const custom = await loadCustomFieldSnapshot(em, {
    entityId: E.catalog.catalog_offer,
    recordId: record.id,
    tenantId: record.tenantId,
    organizationId: record.organizationId,
  })
  return {
    id: record.id,
    productId,
    organizationId: record.organizationId,
    tenantId: record.tenantId,
    channelId: record.channelId,
    title: record.title,
    description: record.description ?? null,
    defaultMediaId: record.defaultMediaId ?? null,
    defaultMediaUrl: record.defaultMediaUrl ?? null,
    localizedContent: record.localizedContent ? cloneJson(record.localizedContent) : null,
    metadata: record.metadata ? cloneJson(record.metadata) : null,
    isActive: record.isActive,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    custom: Object.keys(custom).length ? custom : null,
  }
}

const createOfferCommand: CommandHandler<OfferCreateInput, { offerId: string }> = {
  id: 'catalog.offers.create',
  async execute(rawInput, ctx) {
    const { parsed, custom } = parseWithCustomFields(offerCreateSchema, rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const product = await requireProduct(em, parsed.productId)
    if (
      product.organizationId !== parsed.organizationId ||
      product.tenantId !== parsed.tenantId
    ) {
      throw new CrudHttpError(403, { error: 'Cross-tenant relation forbidden' })
    }
    const conflict = await em.findOne(CatalogOffer, {
      product,
      channelId: parsed.channelId,
      deletedAt: null,
    })
    if (conflict) {
      throw new CrudHttpError(400, {
        error: 'This product already has an offer in this channel.',
        details: { offerId: conflict.id },
      })
    }
    const now = new Date()
    const record = em.create(CatalogOffer, {
      product,
      organizationId: product.organizationId,
      tenantId: product.tenantId,
      channelId: parsed.channelId,
      title: parsed.title?.trim().length ? parsed.title.trim() : product.title,
      description:
        parsed.description && parsed.description.trim().length
          ? parsed.description.trim()
          : product.description ?? null,
      defaultMediaId: parsed.defaultMediaId ?? null,
      defaultMediaUrl: parsed.defaultMediaUrl ?? null,
      localizedContent: parsed.localizedContent ? cloneJson(parsed.localizedContent) : null,
      metadata: parsed.metadata ? cloneJson(parsed.metadata) : null,
      isActive: parsed.isActive !== false,
      createdAt: now,
      updatedAt: now,
    })
    em.persist(record)
    try {
      await em.flush()
    } catch (err) {
      handleUniqueOfferError(err)
    }
    await setCustomFieldsIfAny({
      dataEngine: ctx.container.resolve('dataEngine'),
      entityId: E.catalog.catalog_offer,
      recordId: record.id,
      organizationId: record.organizationId,
      tenantId: record.tenantId,
      values: custom,
    })
    await emitCatalogQueryIndexEvent(ctx, {
      entityType: E.catalog.catalog_offer,
      recordId: record.id,
      organizationId: record.organizationId,
      tenantId: record.tenantId,
      action: 'created',
    })
    return { offerId: record.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = ctx.container.resolve('em') as EntityManager
    return loadOfferSnapshot(em, result.offerId)
  },
  buildLog: async ({ result, ctx }) => {
    const em = ctx.container.resolve('em') as EntityManager
    const after = await loadOfferSnapshot(em, result.offerId)
    if (!after) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('catalog.audit.offers.create', 'Create catalog offer'),
      resourceKind: 'catalog.offer',
      resourceId: after.id,
      tenantId: after.tenantId,
      organizationId: after.organizationId,
      snapshotAfter: after,
      payload: {
        undo: { after } satisfies OfferUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<OfferUndoPayload>(logEntry)
    const after = payload?.after
    if (!after) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(CatalogOffer, { id: after.id })
    if (!record) return
    ensureTenantScope(ctx, record.tenantId)
    ensureOrganizationScope(ctx, record.organizationId)
    em.remove(record)
    await em.flush()
    const resetValues = buildCustomFieldResetMap(undefined, after.custom ?? undefined)
    if (Object.keys(resetValues).length) {
      await setCustomFieldsIfAny({
        dataEngine: ctx.container.resolve('dataEngine'),
        entityId: E.catalog.catalog_offer,
        recordId: after.id,
        organizationId: after.organizationId,
        tenantId: after.tenantId,
        values: resetValues,
      })
    }
  },
}

const updateOfferCommand: CommandHandler<OfferUpdateInput, { offerId: string }> = {
  id: 'catalog.offers.update',
  async prepare(input, ctx) {
    const id = requireId(input, 'Offer id is required.')
    const em = ctx.container.resolve('em') as EntityManager
    const snapshot = await loadOfferSnapshot(em, id)
    if (snapshot) {
      ensureTenantScope(ctx, snapshot.tenantId)
      ensureOrganizationScope(ctx, snapshot.organizationId)
    }
    return snapshot ? { before: snapshot } : {}
  },
  async execute(rawInput, ctx) {
    const { parsed, custom } = parseWithCustomFields(offerUpdateSchema, rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(CatalogOffer, { id: parsed.id, deletedAt: null })
    if (!record) throw new CrudHttpError(404, { error: 'Catalog offer not found' })
    await em.populate(record, ['product'])
    ensureTenantScope(ctx, record.tenantId)
    ensureOrganizationScope(ctx, record.organizationId)
    let productEntity =
      typeof record.product === 'string'
        ? await requireProduct(em, record.product)
        : record.product
    if (parsed.productId && parsed.productId !== record.product.id) {
      const nextProduct = await requireProduct(em, parsed.productId)
      ensureSameScope(nextProduct, record.organizationId, record.tenantId)
      productEntity = nextProduct
    }
    const nextChannelId = parsed.channelId ?? record.channelId
    const conflict = await em.findOne(CatalogOffer, {
      product: typeof productEntity === 'string' ? productEntity : productEntity.id,
      channelId: nextChannelId,
      deletedAt: null,
      id: { $ne: record.id },
    })
    if (conflict) {
      throw new CrudHttpError(400, {
        error: 'This product already has an offer in this channel.',
        details: { offerId: conflict.id },
      })
    }
    record.product = productEntity
    record.channelId = nextChannelId
    if (parsed.title !== undefined) {
      record.title =
        parsed.title && parsed.title.trim().length ? parsed.title.trim() : productEntity.title
    }
    if (parsed.description !== undefined) {
      record.description =
        parsed.description && parsed.description.trim().length
          ? parsed.description.trim()
          : productEntity.description ?? null
    }
    if (parsed.defaultMediaId !== undefined) {
      record.defaultMediaId = parsed.defaultMediaId ?? null
    }
    if (parsed.defaultMediaUrl !== undefined) {
      record.defaultMediaUrl = parsed.defaultMediaUrl ?? null
    }
    if (parsed.localizedContent !== undefined) {
      record.localizedContent = parsed.localizedContent ? cloneJson(parsed.localizedContent) : null
    }
    if (parsed.metadata !== undefined) {
      record.metadata = parsed.metadata ? cloneJson(parsed.metadata) : null
    }
    if (parsed.isActive !== undefined) {
      record.isActive = parsed.isActive
    }
    try {
      await em.flush()
    } catch (err) {
      handleUniqueOfferError(err)
    }
    await setCustomFieldsIfAny({
      dataEngine: ctx.container.resolve('dataEngine'),
      entityId: E.catalog.catalog_offer,
      recordId: record.id,
      organizationId: record.organizationId,
      tenantId: record.tenantId,
      values: custom,
    })
    await emitCatalogQueryIndexEvent(ctx, {
      entityType: E.catalog.catalog_offer,
      recordId: record.id,
      organizationId: record.organizationId,
      tenantId: record.tenantId,
      action: 'updated',
    })
    return { offerId: record.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = ctx.container.resolve('em') as EntityManager
    return loadOfferSnapshot(em, result.offerId)
  },
  buildLog: async ({ result, ctx, snapshots }) => {
    const before = snapshots.before as OfferSnapshot | undefined
    const em = ctx.container.resolve('em') as EntityManager
    const after = await loadOfferSnapshot(em, result.offerId)
    if (!before || !after) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('catalog.audit.offers.update', 'Update catalog offer'),
      resourceKind: 'catalog.offer',
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      snapshotAfter: after,
      changes: buildChanges(
        before as Record<string, unknown>,
        after as Record<string, unknown>,
        OFFER_CHANGE_KEYS,
      ),
      payload: {
        undo: { before, after } satisfies OfferUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<OfferUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await requireOffer(em, before.id).catch(() => null)
    if (!record) {
      const product = await requireProduct(em, before.productId)
      ensureSameScope(product, before.organizationId, before.tenantId)
      const restored = em.create(CatalogOffer, {
        id: before.id,
        product,
        organizationId: before.organizationId,
        tenantId: before.tenantId,
        channelId: before.channelId,
        title: before.title,
        description: before.description ?? null,
        defaultMediaId: before.defaultMediaId ?? null,
        defaultMediaUrl: before.defaultMediaUrl ?? null,
        localizedContent: before.localizedContent ? cloneJson(before.localizedContent) : null,
        metadata: before.metadata ? cloneJson(before.metadata) : null,
        isActive: before.isActive,
        createdAt: new Date(before.createdAt),
        updatedAt: new Date(before.updatedAt),
      })
      em.persist(restored)
    } else {
      ensureTenantScope(ctx, record.tenantId)
      ensureOrganizationScope(ctx, record.organizationId)
      record.channelId = before.channelId
      record.title = before.title
      record.description = before.description ?? null
      record.defaultMediaId = before.defaultMediaId ?? null
      record.defaultMediaUrl = before.defaultMediaUrl ?? null
      const localizedContent = before.localizedContent
        ? (cloneJson(before.localizedContent) as CatalogOfferLocalizedContent)
        : null
      record.localizedContent = localizedContent
      record.metadata = before.metadata ? cloneJson(before.metadata) : null
      record.isActive = before.isActive
      record.updatedAt = new Date(before.updatedAt)
    }
    await em.flush()
    const resetValues = buildCustomFieldResetMap(before.custom ?? undefined, payload?.after?.custom ?? undefined)
    if (Object.keys(resetValues).length) {
      await setCustomFieldsIfAny({
        dataEngine: ctx.container.resolve('dataEngine'),
        entityId: E.catalog.catalog_offer,
        recordId: before.id,
        organizationId: before.organizationId,
        tenantId: before.tenantId,
        values: resetValues,
      })
    }
  },
}

const deleteOfferCommand: CommandHandler<{ id?: string }, { offerId: string }> = {
  id: 'catalog.offers.delete',
  async prepare(input, ctx) {
    const id = requireId(input, 'Offer id is required.')
    const em = ctx.container.resolve('em') as EntityManager
    const snapshot = await loadOfferSnapshot(em, id)
    if (snapshot) {
      ensureTenantScope(ctx, snapshot.tenantId)
      ensureOrganizationScope(ctx, snapshot.organizationId)
    }
    return snapshot ? { before: snapshot } : {}
  },
  async execute(input, ctx) {
    const parsed = { id: requireId(input, 'Offer id is required.') }
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await requireOffer(em, parsed.id)
    ensureTenantScope(ctx, record.tenantId)
    ensureOrganizationScope(ctx, record.organizationId)
    const baseEm = ctx.container.resolve('em') as EntityManager
    const snapshot = await loadOfferSnapshot(baseEm, parsed.id)
    em.remove(record)
    await em.flush()
    await emitCatalogQueryIndexEvent(ctx, {
      entityType: E.catalog.catalog_offer,
      recordId: parsed.id,
      organizationId: record.organizationId,
      tenantId: record.tenantId,
      action: 'deleted',
    })
    if (snapshot?.custom && Object.keys(snapshot.custom).length) {
      const resetValues = buildCustomFieldResetMap(snapshot.custom, undefined)
      if (Object.keys(resetValues).length) {
        await setCustomFieldsIfAny({
          dataEngine: ctx.container.resolve('dataEngine'),
          entityId: E.catalog.catalog_offer,
          recordId: parsed.id,
          organizationId: snapshot.organizationId,
          tenantId: snapshot.tenantId,
          values: resetValues,
        })
      }
    }
    return { offerId: parsed.id }
  },
  buildLog: async ({ snapshots, ctx }) => {
    const before = snapshots.before as OfferSnapshot | undefined
    if (!before) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('catalog.audit.offers.delete', 'Delete catalog offer'),
      resourceKind: 'catalog.offer',
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      payload: {
        undo: { before } satisfies OfferUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<OfferUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const existing = await em.findOne(CatalogOffer, { id: before.id })
    if (existing) return
    const product = await requireProduct(em, before.productId)
    ensureSameScope(product, before.organizationId, before.tenantId)
    const restored = em.create(CatalogOffer, {
      id: before.id,
      product,
      organizationId: before.organizationId,
      tenantId: before.tenantId,
      channelId: before.channelId,
      title: before.title,
      description: before.description ?? null,
      defaultMediaId: before.defaultMediaId ?? null,
      defaultMediaUrl: before.defaultMediaUrl ?? null,
      localizedContent: before.localizedContent ? cloneJson(before.localizedContent) : null,
      metadata: before.metadata ? cloneJson(before.metadata) : null,
      isActive: before.isActive,
      createdAt: new Date(before.createdAt),
      updatedAt: new Date(before.updatedAt),
    })
    em.persist(restored)
    await em.flush()
    if (before.custom && Object.keys(before.custom).length) {
      await setCustomFieldsIfAny({
        dataEngine: ctx.container.resolve('dataEngine'),
        entityId: E.catalog.catalog_offer,
        recordId: before.id,
        organizationId: before.organizationId,
        tenantId: before.tenantId,
        values: before.custom,
      })
    }
  },
}

registerCommand(createOfferCommand)
registerCommand(updateOfferCommand)
registerCommand(deleteOfferCommand)

function handleUniqueOfferError(err: unknown): never {
  if (err instanceof UniqueConstraintViolationException) {
    throw new CrudHttpError(400, { error: 'This product already has an offer in this channel.' })
  }
  throw err
}
