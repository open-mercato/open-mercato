import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { CrudEventsConfig, CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import type { EntityManager } from '@mikro-orm/postgresql'
import { EcommerceStoreDomain } from '../data/entities'
import { storeDomainCreateSchema, storeDomainUpdateSchema, type StoreDomainCreateInput, type StoreDomainUpdateInput } from '../data/validators'
import { ensureTenantScope, ensureOrganizationScope, extractUndoPayload, requireStoreDomain } from './shared'
import { requireId } from '@open-mercato/shared/lib/commands/helpers'
import { E } from '#generated/entities.ids.generated'

type StoreDomainSnapshot = {
  id: string
  organizationId: string
  tenantId: string
  storeId: string
  host: string
  isPrimary: boolean
  tlsMode: string
  verificationStatus: string
}

type StoreDomainUndoPayload = {
  before?: StoreDomainSnapshot | null
  after?: StoreDomainSnapshot | null
}

function serializeStoreDomainSnapshot(domain: EcommerceStoreDomain): StoreDomainSnapshot {
  return {
    id: domain.id,
    organizationId: domain.organizationId,
    tenantId: domain.tenantId,
    storeId: domain.storeId,
    host: domain.host,
    isPrimary: domain.isPrimary,
    tlsMode: domain.tlsMode,
    verificationStatus: domain.verificationStatus,
  }
}

const storeDomainCrudIndexer: CrudIndexerConfig<EcommerceStoreDomain> = {
  entityType: (E as Record<string, Record<string, string>>).ecommerce?.ecommerce_store_domain ?? 'ecommerce:ecommerce_store_domain',
}

const storeDomainCrudEvents: CrudEventsConfig = {
  module: 'ecommerce',
  entity: 'store_domain',
  persistent: true,
  buildPayload: (ctx) => ({
    id: ctx.identifiers.id,
    organizationId: ctx.identifiers.organizationId,
    tenantId: ctx.identifiers.tenantId,
  }),
}

const createStoreDomainCommand: CommandHandler<StoreDomainCreateInput, { id: string }> = {
  id: 'ecommerce.store_domains.create',
  async execute(rawInput, ctx) {
    const parsed = storeDomainCreateSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const domain = em.create(EcommerceStoreDomain, {
      organizationId: parsed.organizationId,
      tenantId: parsed.tenantId,
      storeId: parsed.storeId,
      host: parsed.host,
      isPrimary: parsed.isPrimary,
      tlsMode: parsed.tlsMode,
      verificationStatus: parsed.verificationStatus,
    })
    await em.flush()

    const de = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine: de,
      action: 'created',
      entity: domain,
      identifiers: { id: domain.id, tenantId: domain.tenantId, organizationId: domain.organizationId },
      indexer: storeDomainCrudIndexer,
      events: storeDomainCrudEvents,
    })

    return { id: domain.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = ctx.container.resolve('em') as EntityManager
    const domain = await em.findOne(EcommerceStoreDomain, { id: result.id })
    return domain ? serializeStoreDomainSnapshot(domain) : null
  },
  buildLog: async ({ result, snapshots }) => {
    const snapshot = snapshots.after as StoreDomainSnapshot | undefined
    return {
      actionLabel: 'Create store domain',
      resourceKind: 'ecommerce.store_domain',
      resourceId: result.id,
      tenantId: snapshot?.tenantId ?? null,
      organizationId: snapshot?.organizationId ?? null,
      snapshotAfter: snapshot ?? null,
      payload: { undo: { after: snapshot } satisfies StoreDomainUndoPayload },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<StoreDomainUndoPayload>(logEntry)
    const entityId = logEntry?.resourceId ?? payload?.after?.id ?? null
    if (!entityId) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const domain = await em.findOne(EcommerceStoreDomain, { id: entityId })
    if (!domain) return
    await em.remove(domain).flush()
  },
}

const updateStoreDomainCommand: CommandHandler<StoreDomainUpdateInput, { id: string }> = {
  id: 'ecommerce.store_domains.update',
  async prepare(input, ctx) {
    const id = requireId(input, 'Store domain id is required')
    const em = ctx.container.resolve('em') as EntityManager
    const domain = await em.findOne(EcommerceStoreDomain, { id, deletedAt: null })
    return domain ? { before: serializeStoreDomainSnapshot(domain) } : {}
  },
  async execute(rawInput, ctx) {
    const parsed = storeDomainUpdateSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const domain = await requireStoreDomain(em, parsed.id)
    ensureTenantScope(ctx, domain.tenantId)
    ensureOrganizationScope(ctx, domain.organizationId)

    if (parsed.host !== undefined) domain.host = parsed.host
    if (parsed.isPrimary !== undefined) domain.isPrimary = parsed.isPrimary
    if (parsed.tlsMode !== undefined) domain.tlsMode = parsed.tlsMode
    if (parsed.verificationStatus !== undefined) domain.verificationStatus = parsed.verificationStatus
    await em.flush()

    const de = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine: de,
      action: 'updated',
      entity: domain,
      identifiers: { id: domain.id, tenantId: domain.tenantId, organizationId: domain.organizationId },
      indexer: storeDomainCrudIndexer,
      events: storeDomainCrudEvents,
    })

    return { id: domain.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = ctx.container.resolve('em') as EntityManager
    const domain = await em.findOne(EcommerceStoreDomain, { id: result.id })
    return domain ? serializeStoreDomainSnapshot(domain) : null
  },
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as StoreDomainSnapshot | undefined
    const after = snapshots.after as StoreDomainSnapshot | undefined
    if (!before) return null
    return {
      actionLabel: 'Update store domain',
      resourceKind: 'ecommerce.store_domain',
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      snapshotAfter: after ?? null,
      payload: { undo: { before, after: after ?? null } satisfies StoreDomainUndoPayload },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<StoreDomainUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    let domain = await em.findOne(EcommerceStoreDomain, { id: before.id })
    if (!domain) {
      domain = em.create(EcommerceStoreDomain, {
        id: before.id,
        organizationId: before.organizationId,
        tenantId: before.tenantId,
        storeId: before.storeId,
        host: before.host,
        isPrimary: before.isPrimary,
        tlsMode: before.tlsMode as EcommerceStoreDomain['tlsMode'],
        verificationStatus: before.verificationStatus as EcommerceStoreDomain['verificationStatus'],
      })
    } else {
      domain.host = before.host
      domain.isPrimary = before.isPrimary
      domain.tlsMode = before.tlsMode as EcommerceStoreDomain['tlsMode']
      domain.verificationStatus = before.verificationStatus as EcommerceStoreDomain['verificationStatus']
      domain.deletedAt = null
    }
    await em.flush()
  },
}

const deleteStoreDomainCommand: CommandHandler<{ body?: Record<string, unknown>; query?: Record<string, unknown> }, { id: string }> = {
  id: 'ecommerce.store_domains.delete',
  async prepare(input, ctx) {
    const id = requireId(input, 'Store domain id is required')
    const em = ctx.container.resolve('em') as EntityManager
    const domain = await em.findOne(EcommerceStoreDomain, { id, deletedAt: null })
    return domain ? { before: serializeStoreDomainSnapshot(domain) } : {}
  },
  async execute(input, ctx) {
    const id = requireId(input, 'Store domain id is required')
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const domain = await requireStoreDomain(em, id)
    ensureTenantScope(ctx, domain.tenantId)
    ensureOrganizationScope(ctx, domain.organizationId)
    domain.deletedAt = new Date()
    await em.flush()

    const de = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine: de,
      action: 'deleted',
      entity: domain,
      identifiers: { id: domain.id, tenantId: domain.tenantId, organizationId: domain.organizationId },
      indexer: storeDomainCrudIndexer,
      events: storeDomainCrudEvents,
    })

    return { id: domain.id }
  },
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as StoreDomainSnapshot | undefined
    if (!before) return null
    return {
      actionLabel: 'Delete store domain',
      resourceKind: 'ecommerce.store_domain',
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      payload: { undo: { before } satisfies StoreDomainUndoPayload },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<StoreDomainUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const domain = await em.findOne(EcommerceStoreDomain, { id: before.id })
    if (domain) {
      domain.deletedAt = null
      await em.flush()
    }
  },
}

registerCommand(createStoreDomainCommand)
registerCommand(updateStoreDomainCommand)
registerCommand(deleteStoreDomainCommand)
