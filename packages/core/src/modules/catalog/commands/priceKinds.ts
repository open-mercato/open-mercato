import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { buildChanges, requireId } from '@open-mercato/shared/lib/commands/helpers'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CatalogPriceKind, CatalogProductPrice } from '../data/entities'
import {
  priceKindCreateSchema,
  priceKindUpdateSchema,
  type PriceKindCreateInput,
  type PriceKindUpdateInput,
} from '../data/validators'
import { ensureTenantScope, extractUndoPayload } from './shared'
import type { CatalogPriceDisplayMode } from '../data/types'

type PriceKindSnapshot = {
  id: string
  organizationId: string | null
  tenantId: string
  code: string
  title: string
  displayMode: string
  currencyCode: string | null
  isPromotion: boolean
  isActive: boolean
  createdAt: string
  updatedAt: string
}

type PriceKindUndoPayload = {
  before?: PriceKindSnapshot | null
  after?: PriceKindSnapshot | null
}

const PRICE_KIND_CHANGE_KEYS = [
  'code',
  'title',
  'displayMode',
  'currencyCode',
  'isPromotion',
  'isActive',
] as const satisfies readonly string[]

async function loadPriceKindSnapshot(em: EntityManager, id: string): Promise<PriceKindSnapshot | null> {
  const record = await em.findOne(CatalogPriceKind, { id })
  if (!record) return null
  return {
    id: record.id,
    organizationId: record.organizationId ?? null,
    tenantId: record.tenantId,
    code: record.code,
    title: record.title,
    displayMode: record.displayMode,
    currencyCode: record.currencyCode ?? null,
    isPromotion: record.isPromotion,
    isActive: record.isActive,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  }
}

const createPriceKindCommand: CommandHandler<PriceKindCreateInput, { priceKindId: string }> = {
  id: 'catalog.priceKinds.create',
  async execute(input, ctx) {
    const parsed = priceKindCreateSchema.parse(input)
    ensureTenantScope(ctx, parsed.tenantId)

    const em = (ctx.container.resolve('em') as EntityManager).fork({ useContext: true })
    const existing = await em.findOne(CatalogPriceKind, {
      code: parsed.code,
      tenantId: parsed.tenantId,
      deletedAt: null,
    })
    if (existing) {
      throw new CrudHttpError(400, { error: 'Price kind code already exists for this tenant.' })
    }
    const now = new Date()
    const record = em.create(CatalogPriceKind, {
      organizationId: null,
      tenantId: parsed.tenantId,
      code: parsed.code,
      title: parsed.title,
      displayMode: parsed.displayMode ?? 'excluding-tax',
      currencyCode: parsed.currencyCode ? parsed.currencyCode.toUpperCase() : null,
      isPromotion: parsed.isPromotion ?? false,
      isActive: parsed.isActive ?? true,
      createdAt: now,
      updatedAt: now,
    })
    em.persist(record)
    await em.flush()
    return { priceKindId: record.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = ctx.container.resolve('em') as EntityManager
    return loadPriceKindSnapshot(em, result.priceKindId)
  },
  buildLog: async ({ result, ctx }) => {
    const em = ctx.container.resolve('em') as EntityManager
    const after = await loadPriceKindSnapshot(em, result.priceKindId)
    if (!after) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('catalog.audit.priceKinds.create', 'Create catalog price kind'),
      resourceKind: 'catalog.priceKind',
      resourceId: after.id,
      tenantId: after.tenantId,
      organizationId: after.organizationId,
      snapshotAfter: after,
      payload: {
        undo: { after } satisfies PriceKindUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<PriceKindUndoPayload>(logEntry)
    const after = payload?.after
    if (!after) return
    const em = (ctx.container.resolve('em') as EntityManager).fork({ useContext: true })
    const record = await em.findOne(CatalogPriceKind, { id: after.id })
    if (!record) return
    ensureTenantScope(ctx, record.tenantId)
    em.remove(record)
    await em.flush()
  },
}

const updatePriceKindCommand: CommandHandler<PriceKindUpdateInput, { priceKindId: string }> = {
  id: 'catalog.priceKinds.update',
  async prepare(input, ctx) {
    const id = requireId(input, 'Price kind id is required')
    const em = ctx.container.resolve('em') as EntityManager
    const snapshot = await loadPriceKindSnapshot(em, id)
    if (snapshot) {
      ensureTenantScope(ctx, snapshot.tenantId)
    }
    return snapshot ? { before: snapshot } : {}
  },
  async execute(input, ctx) {
    const parsed = priceKindUpdateSchema.parse(input)
    const em = (ctx.container.resolve('em') as EntityManager).fork({ useContext: true })
    const record = await em.findOne(CatalogPriceKind, { id: parsed.id, deletedAt: null })
    if (!record) throw new CrudHttpError(404, { error: 'Catalog price kind not found' })
    ensureTenantScope(ctx, record.tenantId)

    if (parsed.code && parsed.code !== record.code) {
      const conflict = await em.findOne(CatalogPriceKind, {
        code: parsed.code,
        tenantId: record.tenantId,
        deletedAt: null,
      })
      if (conflict) {
        throw new CrudHttpError(400, { error: 'Price kind code already exists.' })
      }
      record.code = parsed.code
    }

    if (parsed.title !== undefined) record.title = parsed.title
    if (parsed.displayMode !== undefined) record.displayMode = parsed.displayMode
    if (parsed.currencyCode !== undefined) {
      record.currencyCode = parsed.currencyCode ? parsed.currencyCode.toUpperCase() : null
    }
    if (parsed.isPromotion !== undefined) record.isPromotion = parsed.isPromotion
    if (parsed.isActive !== undefined) record.isActive = parsed.isActive

    await em.flush()
    return { priceKindId: record.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = ctx.container.resolve('em') as EntityManager
    return loadPriceKindSnapshot(em, result.priceKindId)
  },
  buildLog: async ({ result, ctx, snapshots }) => {
    const before = snapshots.before as PriceKindSnapshot | undefined
    const em = ctx.container.resolve('em') as EntityManager
    const after = await loadPriceKindSnapshot(em, result.priceKindId)
    if (!before || !after) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('catalog.audit.priceKinds.update', 'Update catalog price kind'),
      resourceKind: 'catalog.priceKind',
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      snapshotAfter: after,
      changes: buildChanges(before as Record<string, unknown>, after as Record<string, unknown>, PRICE_KIND_CHANGE_KEYS),
      payload: {
        undo: { before, after } satisfies PriceKindUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<PriceKindUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork({ useContext: true })
    const record = await em.findOne(CatalogPriceKind, { id: before.id })
    if (!record) return
    ensureTenantScope(ctx, before.tenantId)
    record.code = before.code
    record.title = before.title
    record.displayMode = before.displayMode as CatalogPriceKind['displayMode']
    record.currencyCode = before.currencyCode
    record.isPromotion = before.isPromotion
    record.isActive = before.isActive
    record.updatedAt = new Date(before.updatedAt)
    await em.flush()
  },
}

const deletePriceKindCommand: CommandHandler<{ id?: string }, { priceKindId: string }> = {
  id: 'catalog.priceKinds.delete',
  async prepare(input, ctx) {
    const id = requireId(input, 'Price kind id is required')
    const em = ctx.container.resolve('em') as EntityManager
    const snapshot = await loadPriceKindSnapshot(em, id)
    if (snapshot) {
      ensureTenantScope(ctx, snapshot.tenantId)
    }
    return snapshot ? { before: snapshot } : {}
  },
  async execute(input, ctx) {
    const id = requireId(input, 'Price kind id is required')
    const em = (ctx.container.resolve('em') as EntityManager).fork({ useContext: true })
    const record = await em.findOne(CatalogPriceKind, { id, deletedAt: null })
    if (!record) throw new CrudHttpError(404, { error: 'Catalog price kind not found' })
    ensureTenantScope(ctx, record.tenantId)

    const usage = await em.count(CatalogProductPrice, { priceKind: record })
    if (usage > 0) {
      throw new CrudHttpError(400, { error: 'Cannot delete price kind while prices reference it.' })
    }

    record.deletedAt = new Date()
    record.isActive = false
    await em.flush()
    return { priceKindId: record.id }
  },
  buildLog: async ({ result, ctx, snapshots }) => {
    const before = snapshots.before as PriceKindSnapshot | undefined
    if (!before) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('catalog.audit.priceKinds.delete', 'Delete catalog price kind'),
      resourceKind: 'catalog.priceKind',
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      payload: {
        undo: { before } satisfies PriceKindUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<PriceKindUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork({ useContext: true })
    let record = await em.findOne(CatalogPriceKind, { id: before.id })
    const displayMode: CatalogPriceDisplayMode =
      before.displayMode === 'including-tax' ? 'including-tax' : 'excluding-tax'
    if (!record) {
      record = em.create(CatalogPriceKind, {
        id: before.id,
        organizationId: before.organizationId,
        tenantId: before.tenantId,
        code: before.code,
        title: before.title,
        displayMode,
        currencyCode: before.currencyCode,
        isPromotion: before.isPromotion,
        isActive: before.isActive,
        createdAt: new Date(before.createdAt),
        updatedAt: new Date(before.updatedAt),
      })
      em.persist(record)
    } else {
      ensureTenantScope(ctx, before.tenantId)
      record.deletedAt = null
      record.isActive = before.isActive
      record.code = before.code
      record.title = before.title
      record.displayMode = displayMode
      record.currencyCode = before.currencyCode
      record.isPromotion = before.isPromotion
    }
    await em.flush()
  },
}

registerCommand(createPriceKindCommand)
registerCommand(updatePriceKindCommand)
registerCommand(deletePriceKindCommand)
