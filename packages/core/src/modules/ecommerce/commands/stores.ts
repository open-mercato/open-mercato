import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { CrudEventsConfig, CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import type { EntityManager } from '@mikro-orm/postgresql'
import { EcommerceStore } from '../data/entities'
import { storeCreateSchema, storeUpdateSchema, type StoreCreateInput, type StoreUpdateInput } from '../data/validators'
import { ensureTenantScope, ensureOrganizationScope, extractUndoPayload, requireStore } from './shared'
import { requireId } from '@open-mercato/shared/lib/commands/helpers'
import { E } from '#generated/entities.ids.generated'

type StoreSnapshot = {
  id: string
  organizationId: string
  tenantId: string
  code: string
  name: string
  slug: string
  status: string
  defaultLocale: string
  supportedLocales: string[]
  defaultCurrencyCode: string
  isPrimary: boolean
  settings: Record<string, unknown> | null
}

type StoreUndoPayload = {
  before?: StoreSnapshot | null
  after?: StoreSnapshot | null
}

function serializeStoreSnapshot(store: EcommerceStore): StoreSnapshot {
  return {
    id: store.id,
    organizationId: store.organizationId,
    tenantId: store.tenantId,
    code: store.code,
    name: store.name,
    slug: store.slug,
    status: store.status,
    defaultLocale: store.defaultLocale,
    supportedLocales: store.supportedLocales,
    defaultCurrencyCode: store.defaultCurrencyCode,
    isPrimary: store.isPrimary,
    settings: store.settings ?? null,
  }
}

const storeCrudIndexer: CrudIndexerConfig<EcommerceStore> = {
  entityType: (E as Record<string, Record<string, string>>).ecommerce?.ecommerce_store ?? 'ecommerce:ecommerce_store',
}

const storeCrudEvents: CrudEventsConfig = {
  module: 'ecommerce',
  entity: 'store',
  persistent: true,
  buildPayload: (ctx) => ({
    id: ctx.identifiers.id,
    organizationId: ctx.identifiers.organizationId,
    tenantId: ctx.identifiers.tenantId,
  }),
}

const createStoreCommand: CommandHandler<StoreCreateInput, { id: string }> = {
  id: 'ecommerce.stores.create',
  async execute(rawInput, ctx) {
    const parsed = storeCreateSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const store = em.create(EcommerceStore, {
      organizationId: parsed.organizationId,
      tenantId: parsed.tenantId,
      code: parsed.code,
      name: parsed.name,
      slug: parsed.slug,
      status: parsed.status,
      defaultLocale: parsed.defaultLocale,
      supportedLocales: parsed.supportedLocales,
      defaultCurrencyCode: parsed.defaultCurrencyCode,
      isPrimary: parsed.isPrimary,
      settings: parsed.settings ?? null,
    })
    await em.flush()

    const de = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine: de,
      action: 'created',
      entity: store,
      identifiers: { id: store.id, tenantId: store.tenantId, organizationId: store.organizationId },
      indexer: storeCrudIndexer,
      events: storeCrudEvents,
    })

    return { id: store.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = ctx.container.resolve('em') as EntityManager
    const store = await em.findOne(EcommerceStore, { id: result.id })
    return store ? serializeStoreSnapshot(store) : null
  },
  buildLog: async ({ result, snapshots }) => {
    const snapshot = snapshots.after as StoreSnapshot | undefined
    return {
      actionLabel: 'Create store',
      resourceKind: 'ecommerce.store',
      resourceId: result.id,
      tenantId: snapshot?.tenantId ?? null,
      organizationId: snapshot?.organizationId ?? null,
      snapshotAfter: snapshot ?? null,
      payload: { undo: { after: snapshot } satisfies StoreUndoPayload },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<StoreUndoPayload>(logEntry)
    const entityId = logEntry?.resourceId ?? payload?.after?.id ?? null
    if (!entityId) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const store = await em.findOne(EcommerceStore, { id: entityId })
    if (!store) return
    await em.remove(store).flush()
  },
}

const updateStoreCommand: CommandHandler<StoreUpdateInput, { id: string }> = {
  id: 'ecommerce.stores.update',
  async prepare(input, ctx) {
    const id = requireId(input, 'Store id is required')
    const em = ctx.container.resolve('em') as EntityManager
    const store = await em.findOne(EcommerceStore, { id, deletedAt: null })
    return store ? { before: serializeStoreSnapshot(store) } : {}
  },
  async execute(rawInput, ctx) {
    const parsed = storeUpdateSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const store = await requireStore(em, parsed.id)
    ensureTenantScope(ctx, store.tenantId)
    ensureOrganizationScope(ctx, store.organizationId)

    if (parsed.code !== undefined) store.code = parsed.code
    if (parsed.name !== undefined) store.name = parsed.name
    if (parsed.slug !== undefined) store.slug = parsed.slug
    if (parsed.status !== undefined) store.status = parsed.status
    if (parsed.defaultLocale !== undefined) store.defaultLocale = parsed.defaultLocale
    if (parsed.supportedLocales !== undefined) store.supportedLocales = parsed.supportedLocales
    if (parsed.defaultCurrencyCode !== undefined) store.defaultCurrencyCode = parsed.defaultCurrencyCode
    if (parsed.isPrimary !== undefined) store.isPrimary = parsed.isPrimary
    if (parsed.settings !== undefined) store.settings = parsed.settings ?? null
    await em.flush()

    const de = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine: de,
      action: 'updated',
      entity: store,
      identifiers: { id: store.id, tenantId: store.tenantId, organizationId: store.organizationId },
      indexer: storeCrudIndexer,
      events: storeCrudEvents,
    })

    return { id: store.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = ctx.container.resolve('em') as EntityManager
    const store = await em.findOne(EcommerceStore, { id: result.id })
    return store ? serializeStoreSnapshot(store) : null
  },
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as StoreSnapshot | undefined
    const after = snapshots.after as StoreSnapshot | undefined
    if (!before) return null
    return {
      actionLabel: 'Update store',
      resourceKind: 'ecommerce.store',
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      snapshotAfter: after ?? null,
      payload: { undo: { before, after: after ?? null } satisfies StoreUndoPayload },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<StoreUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    let store = await em.findOne(EcommerceStore, { id: before.id })
    if (!store) {
      store = em.create(EcommerceStore, {
        id: before.id,
        organizationId: before.organizationId,
        tenantId: before.tenantId,
        code: before.code,
        name: before.name,
        slug: before.slug,
        status: before.status as EcommerceStore['status'],
        defaultLocale: before.defaultLocale,
        supportedLocales: before.supportedLocales,
        defaultCurrencyCode: before.defaultCurrencyCode,
        isPrimary: before.isPrimary,
        settings: before.settings,
      })
    } else {
      store.code = before.code
      store.name = before.name
      store.slug = before.slug
      store.status = before.status as EcommerceStore['status']
      store.defaultLocale = before.defaultLocale
      store.supportedLocales = before.supportedLocales
      store.defaultCurrencyCode = before.defaultCurrencyCode
      store.isPrimary = before.isPrimary
      store.settings = before.settings
      store.deletedAt = null
    }
    await em.flush()
  },
}

const deleteStoreCommand: CommandHandler<{ body?: Record<string, unknown>; query?: Record<string, unknown> }, { id: string }> = {
  id: 'ecommerce.stores.delete',
  async prepare(input, ctx) {
    const id = requireId(input, 'Store id is required')
    const em = ctx.container.resolve('em') as EntityManager
    const store = await em.findOne(EcommerceStore, { id, deletedAt: null })
    return store ? { before: serializeStoreSnapshot(store) } : {}
  },
  async execute(input, ctx) {
    const id = requireId(input, 'Store id is required')
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const store = await requireStore(em, id)
    ensureTenantScope(ctx, store.tenantId)
    ensureOrganizationScope(ctx, store.organizationId)
    store.deletedAt = new Date()
    await em.flush()

    const de = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine: de,
      action: 'deleted',
      entity: store,
      identifiers: { id: store.id, tenantId: store.tenantId, organizationId: store.organizationId },
      indexer: storeCrudIndexer,
      events: storeCrudEvents,
    })

    return { id: store.id }
  },
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as StoreSnapshot | undefined
    if (!before) return null
    return {
      actionLabel: 'Delete store',
      resourceKind: 'ecommerce.store',
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      payload: { undo: { before } satisfies StoreUndoPayload },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<StoreUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const store = await em.findOne(EcommerceStore, { id: before.id })
    if (store) {
      store.deletedAt = null
      await em.flush()
    }
  },
}

registerCommand(createStoreCommand)
registerCommand(updateStoreCommand)
registerCommand(deleteStoreCommand)
