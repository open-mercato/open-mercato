import type { CrudCtx } from '@open-mercato/shared/lib/crud/factory'
import { canonicalizeResourceTag, invalidateCrudCache } from '@open-mercato/shared/lib/crud/cache'
import type { EcommerceStore, EcommerceStoreChannelBinding, EcommerceStoreDomainBinding } from '../data/entities'
import { emitEcommerceEvent, type EcommerceEventId } from '../events'

export const ECOMMERCE_EVENTS_MODULE = 'ecommerce'
export const STORE_EVENT_ENTITY = 'store'
export const STORE_DOMAIN_BINDING_EVENT_ENTITY = 'store_domain_binding'
export const STORE_CHANNEL_BINDING_EVENT_ENTITY = 'store_channel_binding'

export type StoreEventPayload = { id: string; tenantId: string; organizationId: string }
export type StoreDomainBindingEventPayload = StoreEventPayload & { storeId: string; domainMappingId: string }
export type StoreChannelBindingEventPayload = StoreEventPayload & { storeId: string; salesChannelId: string }

export function buildStoreEventPayload(store: EcommerceStore): StoreEventPayload {
  return { id: store.id, tenantId: store.tenantId, organizationId: store.organizationId }
}

export function buildStoreDomainBindingEventPayload(binding: EcommerceStoreDomainBinding): StoreDomainBindingEventPayload {
  return {
    id: binding.id,
    storeId: binding.storeId,
    domainMappingId: binding.domainMappingId,
    tenantId: binding.tenantId,
    organizationId: binding.organizationId,
  }
}

export function buildStoreChannelBindingEventPayload(
  binding: EcommerceStoreChannelBinding,
): StoreChannelBindingEventPayload {
  return {
    id: binding.id,
    storeId: binding.storeId,
    salesChannelId: binding.salesChannelId,
    tenantId: binding.tenantId,
    organizationId: binding.organizationId,
  }
}

export function resourceKindFor(entity: string): string {
  const raw = `${ECOMMERCE_EVENTS_MODULE}.${entity}`
  return canonicalizeResourceTag(raw) ?? raw
}

type ScopedRow = { id: string; tenantId: string; organizationId: string }

async function announceUpdatedRows<TRow extends ScopedRow>(
  container: CrudCtx['container'],
  entity: string,
  eventId: EcommerceEventId,
  rows: TRow[],
  buildPayload: (row: TRow) => StoreEventPayload,
): Promise<void> {
  const resourceKind = resourceKindFor(entity)
  for (const row of rows) {
    await invalidateCrudCache(
      container,
      resourceKind,
      { id: row.id, tenantId: row.tenantId, organizationId: row.organizationId },
      row.tenantId,
      'updated',
    )
    await emitEcommerceEvent(eventId, buildPayload(row), {
      persistent: true,
      tenantId: row.tenantId,
      organizationId: row.organizationId,
    })
  }
}

export function announceStoresUpdated(container: CrudCtx['container'], stores: EcommerceStore[]): Promise<void> {
  return announceUpdatedRows(container, STORE_EVENT_ENTITY, 'ecommerce.store.updated', stores, buildStoreEventPayload)
}

export function announceStoreDomainBindingsUpdated(
  container: CrudCtx['container'],
  bindings: EcommerceStoreDomainBinding[],
): Promise<void> {
  return announceUpdatedRows(container, STORE_DOMAIN_BINDING_EVENT_ENTITY, 'ecommerce.store_domain_binding.updated', bindings, buildStoreDomainBindingEventPayload)
}

export function announceStoreChannelBindingsUpdated(
  container: CrudCtx['container'],
  bindings: EcommerceStoreChannelBinding[],
): Promise<void> {
  return announceUpdatedRows(container, STORE_CHANNEL_BINDING_EVENT_ENTITY, 'ecommerce.store_channel_binding.updated', bindings, buildStoreChannelBindingEventPayload)
}
