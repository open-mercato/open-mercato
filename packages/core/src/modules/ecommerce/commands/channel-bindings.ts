import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { CrudEventsConfig, CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import type { EntityManager } from '@mikro-orm/postgresql'
import { EcommerceStoreChannelBinding } from '../data/entities'
import { storeChannelBindingCreateSchema, storeChannelBindingUpdateSchema, type StoreChannelBindingCreateInput, type StoreChannelBindingUpdateInput } from '../data/validators'
import { ensureTenantScope, ensureOrganizationScope, extractUndoPayload, requireStoreChannelBinding } from './shared'
import { requireId } from '@open-mercato/shared/lib/commands/helpers'
import { E } from '#generated/entities.ids.generated'

type StoreChannelBindingSnapshot = {
  id: string
  organizationId: string
  tenantId: string
  storeId: string
  salesChannelId: string
  priceKindId: string | null
  catalogScope: Record<string, unknown> | null
  isDefault: boolean
}

type StoreChannelBindingUndoPayload = {
  before?: StoreChannelBindingSnapshot | null
  after?: StoreChannelBindingSnapshot | null
}

function serializeBindingSnapshot(binding: EcommerceStoreChannelBinding): StoreChannelBindingSnapshot {
  return {
    id: binding.id,
    organizationId: binding.organizationId,
    tenantId: binding.tenantId,
    storeId: binding.storeId,
    salesChannelId: binding.salesChannelId,
    priceKindId: binding.priceKindId ?? null,
    catalogScope: binding.catalogScope ?? null,
    isDefault: binding.isDefault,
  }
}

const bindingCrudIndexer: CrudIndexerConfig<EcommerceStoreChannelBinding> = {
  entityType: (E as Record<string, Record<string, string>>).ecommerce?.ecommerce_store_channel_binding ?? 'ecommerce:ecommerce_store_channel_binding',
}

const bindingCrudEvents: CrudEventsConfig = {
  module: 'ecommerce',
  entity: 'store_channel_binding',
  persistent: true,
  buildPayload: (ctx) => ({
    id: ctx.identifiers.id,
    organizationId: ctx.identifiers.organizationId,
    tenantId: ctx.identifiers.tenantId,
  }),
}

const createStoreChannelBindingCommand: CommandHandler<StoreChannelBindingCreateInput, { id: string }> = {
  id: 'ecommerce.store_channel_bindings.create',
  async execute(rawInput, ctx) {
    const parsed = storeChannelBindingCreateSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const binding = em.create(EcommerceStoreChannelBinding, {
      organizationId: parsed.organizationId,
      tenantId: parsed.tenantId,
      storeId: parsed.storeId,
      salesChannelId: parsed.salesChannelId,
      priceKindId: parsed.priceKindId ?? null,
      catalogScope: parsed.catalogScope ?? null,
      isDefault: parsed.isDefault,
    })
    await em.flush()

    const de = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine: de,
      action: 'created',
      entity: binding,
      identifiers: { id: binding.id, tenantId: binding.tenantId, organizationId: binding.organizationId },
      indexer: bindingCrudIndexer,
      events: bindingCrudEvents,
    })

    return { id: binding.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = ctx.container.resolve('em') as EntityManager
    const binding = await em.findOne(EcommerceStoreChannelBinding, { id: result.id })
    return binding ? serializeBindingSnapshot(binding) : null
  },
  buildLog: async ({ result, snapshots }) => {
    const snapshot = snapshots.after as StoreChannelBindingSnapshot | undefined
    return {
      actionLabel: 'Create store channel binding',
      resourceKind: 'ecommerce.store_channel_binding',
      resourceId: result.id,
      tenantId: snapshot?.tenantId ?? null,
      organizationId: snapshot?.organizationId ?? null,
      snapshotAfter: snapshot ?? null,
      payload: { undo: { after: snapshot } satisfies StoreChannelBindingUndoPayload },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<StoreChannelBindingUndoPayload>(logEntry)
    const entityId = logEntry?.resourceId ?? payload?.after?.id ?? null
    if (!entityId) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const binding = await em.findOne(EcommerceStoreChannelBinding, { id: entityId })
    if (!binding) return
    await em.remove(binding).flush()
  },
}

const updateStoreChannelBindingCommand: CommandHandler<StoreChannelBindingUpdateInput, { id: string }> = {
  id: 'ecommerce.store_channel_bindings.update',
  async prepare(input, ctx) {
    const id = requireId(input, 'Store channel binding id is required')
    const em = ctx.container.resolve('em') as EntityManager
    const binding = await em.findOne(EcommerceStoreChannelBinding, { id, deletedAt: null })
    return binding ? { before: serializeBindingSnapshot(binding) } : {}
  },
  async execute(rawInput, ctx) {
    const parsed = storeChannelBindingUpdateSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const binding = await requireStoreChannelBinding(em, parsed.id)
    ensureTenantScope(ctx, binding.tenantId)
    ensureOrganizationScope(ctx, binding.organizationId)

    if (parsed.salesChannelId !== undefined) binding.salesChannelId = parsed.salesChannelId
    if (parsed.priceKindId !== undefined) binding.priceKindId = parsed.priceKindId ?? null
    if (parsed.catalogScope !== undefined) binding.catalogScope = parsed.catalogScope ?? null
    if (parsed.isDefault !== undefined) binding.isDefault = parsed.isDefault
    await em.flush()

    const de = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine: de,
      action: 'updated',
      entity: binding,
      identifiers: { id: binding.id, tenantId: binding.tenantId, organizationId: binding.organizationId },
      indexer: bindingCrudIndexer,
      events: bindingCrudEvents,
    })

    return { id: binding.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = ctx.container.resolve('em') as EntityManager
    const binding = await em.findOne(EcommerceStoreChannelBinding, { id: result.id })
    return binding ? serializeBindingSnapshot(binding) : null
  },
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as StoreChannelBindingSnapshot | undefined
    const after = snapshots.after as StoreChannelBindingSnapshot | undefined
    if (!before) return null
    return {
      actionLabel: 'Update store channel binding',
      resourceKind: 'ecommerce.store_channel_binding',
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      snapshotAfter: after ?? null,
      payload: { undo: { before, after: after ?? null } satisfies StoreChannelBindingUndoPayload },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<StoreChannelBindingUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    let binding = await em.findOne(EcommerceStoreChannelBinding, { id: before.id })
    if (!binding) {
      binding = em.create(EcommerceStoreChannelBinding, {
        id: before.id,
        organizationId: before.organizationId,
        tenantId: before.tenantId,
        storeId: before.storeId,
        salesChannelId: before.salesChannelId,
        priceKindId: before.priceKindId,
        catalogScope: before.catalogScope,
        isDefault: before.isDefault,
      })
    } else {
      binding.salesChannelId = before.salesChannelId
      binding.priceKindId = before.priceKindId
      binding.catalogScope = before.catalogScope
      binding.isDefault = before.isDefault
      binding.deletedAt = null
    }
    await em.flush()
  },
}

const deleteStoreChannelBindingCommand: CommandHandler<{ body?: Record<string, unknown>; query?: Record<string, unknown> }, { id: string }> = {
  id: 'ecommerce.store_channel_bindings.delete',
  async prepare(input, ctx) {
    const id = requireId(input, 'Store channel binding id is required')
    const em = ctx.container.resolve('em') as EntityManager
    const binding = await em.findOne(EcommerceStoreChannelBinding, { id, deletedAt: null })
    return binding ? { before: serializeBindingSnapshot(binding) } : {}
  },
  async execute(input, ctx) {
    const id = requireId(input, 'Store channel binding id is required')
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const binding = await requireStoreChannelBinding(em, id)
    ensureTenantScope(ctx, binding.tenantId)
    ensureOrganizationScope(ctx, binding.organizationId)
    binding.deletedAt = new Date()
    await em.flush()

    const de = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine: de,
      action: 'deleted',
      entity: binding,
      identifiers: { id: binding.id, tenantId: binding.tenantId, organizationId: binding.organizationId },
      indexer: bindingCrudIndexer,
      events: bindingCrudEvents,
    })

    return { id: binding.id }
  },
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as StoreChannelBindingSnapshot | undefined
    if (!before) return null
    return {
      actionLabel: 'Delete store channel binding',
      resourceKind: 'ecommerce.store_channel_binding',
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      payload: { undo: { before } satisfies StoreChannelBindingUndoPayload },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<StoreChannelBindingUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const binding = await em.findOne(EcommerceStoreChannelBinding, { id: before.id })
    if (binding) {
      binding.deletedAt = null
      await em.flush()
    }
  },
}

registerCommand(createStoreChannelBindingCommand)
registerCommand(updateStoreChannelBindingCommand)
registerCommand(deleteStoreChannelBindingCommand)
