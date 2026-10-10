import type { EntityName } from '@mikro-orm/core'
import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import type { CrudCtx } from '@open-mercato/shared/lib/crud/factory'
import type { CrudEventsConfig, CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { buildScopedWhere } from '@open-mercato/shared/lib/api/crud'
import { invalidateCrudCache } from '@open-mercato/shared/lib/crud/cache'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { E } from '#generated/entities.ids.generated'
import { EcommerceStore, EcommerceStoreChannelBinding, EcommerceStoreDomainBinding } from '../data/entities'
import {
  buildStoreChannelBindingEventPayload,
  buildStoreDomainBindingEventPayload,
  ECOMMERCE_EVENTS_MODULE,
  resourceKindFor,
  STORE_CHANNEL_BINDING_EVENT_ENTITY,
  STORE_DOMAIN_BINDING_EVENT_ENTITY,
} from './crudEvents'

export type StoreBindingCascade = {
  domainBindings: EcommerceStoreDomainBinding[]
  channelBindings: EcommerceStoreChannelBinding[]
}

export const domainBindingEvents: CrudEventsConfig<EcommerceStoreDomainBinding> = {
  module: ECOMMERCE_EVENTS_MODULE,
  entity: STORE_DOMAIN_BINDING_EVENT_ENTITY,
  persistent: true,
  buildPayload: (emitCtx) => buildStoreDomainBindingEventPayload(emitCtx.entity),
}

const channelBindingEvents: CrudEventsConfig<EcommerceStoreChannelBinding> = {
  module: ECOMMERCE_EVENTS_MODULE,
  entity: STORE_CHANNEL_BINDING_EVENT_ENTITY,
  persistent: true,
  buildPayload: (emitCtx) => buildStoreChannelBindingEventPayload(emitCtx.entity),
}

export const domainBindingIndexer: CrudIndexerConfig<EcommerceStoreDomainBinding> = {
  entityType: E.ecommerce.ecommerce_store_domain_binding,
}

const channelBindingIndexer: CrudIndexerConfig<EcommerceStoreChannelBinding> = {
  entityType: E.ecommerce.ecommerce_store_channel_binding,
}

type StoreBinding = EcommerceStoreDomainBinding | EcommerceStoreChannelBinding

async function softDeleteLiveBindings<TBinding extends StoreBinding>(
  em: EntityManager,
  entity: EntityName<TBinding>,
  where: Record<string, unknown>,
  decryptionScope: { tenantId: string; organizationId: string },
  now: Date,
): Promise<TBinding[]> {
  const rows = await findWithDecryption(em, entity, where as FilterQuery<TBinding>, undefined, decryptionScope)
  if (!rows.length) return rows
  await em.nativeUpdate(
    entity,
    { id: { $in: rows.map((row) => row.id) }, deletedAt: null } as FilterQuery<TBinding>,
    { deletedAt: now } as Partial<TBinding>,
  )
  for (const row of rows) row.deletedAt = now
  return rows
}

export async function cascadeStoreBindingDelete(
  em: EntityManager,
  storeId: string,
  ctx: CrudCtx,
  now: Date = new Date(),
): Promise<StoreBindingCascade> {
  const tenantId = ctx.auth?.tenantId ?? null
  const organizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
  if (!tenantId || !organizationId) return { domainBindings: [], channelBindings: [] }
  const where = buildScopedWhere(
    { storeId },
    {
      organizationId,
      organizationIds: ctx.organizationIds ?? undefined,
      tenantId,
      orgField: 'organizationId',
      tenantField: 'tenantId',
      softDeleteField: 'deletedAt',
    },
  )
  const decryptionScope = { tenantId, organizationId }
  try {
    return await em.transactional(async (tem) => ({
      domainBindings: await softDeleteLiveBindings(tem, EcommerceStoreDomainBinding, where, decryptionScope, now),
      channelBindings: await softDeleteLiveBindings(tem, EcommerceStoreChannelBinding, where, decryptionScope, now),
    }))
  } catch (err) {
    await em.nativeUpdate(EcommerceStore, { id: storeId, tenantId, deletedAt: { $ne: null } }, { deletedAt: null })
    throw err
  }
}

type ScopedRow = { id: string; tenantId: string; organizationId: string }

function identifiersOf(row: ScopedRow) {
  return { id: row.id, tenantId: row.tenantId, organizationId: row.organizationId }
}

export async function announceStoreBindingCascade(
  container: CrudCtx['container'],
  cascade: StoreBindingCascade,
): Promise<void> {
  if (!cascade.domainBindings.length && !cascade.channelBindings.length) return
  const dataEngine = container.resolve('dataEngine') as DataEngine
  for (const binding of cascade.domainBindings) {
    dataEngine.markOrmEntityChange({
      action: 'deleted',
      entity: binding,
      identifiers: identifiersOf(binding),
      events: domainBindingEvents,
      indexer: domainBindingIndexer,
    })
  }
  for (const binding of cascade.channelBindings) {
    dataEngine.markOrmEntityChange({
      action: 'deleted',
      entity: binding,
      identifiers: identifiersOf(binding),
      events: channelBindingEvents,
      indexer: channelBindingIndexer,
    })
  }
  await dataEngine.flushOrmEntityChanges()
  const domainResourceKind = resourceKindFor(STORE_DOMAIN_BINDING_EVENT_ENTITY)
  for (const binding of cascade.domainBindings) {
    await invalidateCrudCache(container, domainResourceKind, identifiersOf(binding), binding.tenantId, 'deleted')
  }
  const channelResourceKind = resourceKindFor(STORE_CHANNEL_BINDING_EVENT_ENTITY)
  for (const binding of cascade.channelBindings) {
    await invalidateCrudCache(container, channelResourceKind, identifiersOf(binding), binding.tenantId, 'deleted')
  }
}
