import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import type { EnricherContext, ResponseEnricher } from '@open-mercato/shared/lib/crud/response-enricher'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { SalesChannel } from '@open-mercato/core/modules/sales/data/entities'
import { E } from '#generated/entities.ids.generated'
import { EcommerceStoreChannelBinding, EcommerceStoreDomainBinding } from './entities'

type StoreRecord = Record<string, unknown> & { id: string }

export type StoreListPrimaryDomain = {
  hostname: string
  pathPrefix: string | null
}

export type StoreListDefaultChannel = {
  id: string
  name: string
}

export type StoreListBindingSummary = {
  primaryDomain: StoreListPrimaryDomain | null
  defaultChannel: StoreListDefaultChannel | null
}

type StoreListEnrichment = {
  _ecommerce: StoreListBindingSummary
}

type DomainMappingReader = {
  findByOrganization(
    organizationId: string,
    scope?: { tenantId?: string },
  ): Promise<Array<{ id: string; hostname: string; organizationId: string; tenantId: string }>>
}

type ContainerLike = { resolve(name: string): unknown }

const EMPTY_SUMMARY: StoreListBindingSummary = { primaryDomain: null, defaultChannel: null }

function hasRecordId(record: Record<string, unknown>): record is StoreRecord {
  return typeof record.id === 'string' && record.id.length > 0
}

function resolveDomainMappingReader(container: unknown): DomainMappingReader | null {
  try {
    const service = (container as ContainerLike).resolve('domainMappingService') as DomainMappingReader | null | undefined
    return service && typeof service.findByOrganization === 'function' ? service : null
  } catch {
    return null
  }
}

async function loadPrimaryDomains(
  em: EntityManager,
  storeIds: string[],
  context: EnricherContext,
): Promise<Map<string, StoreListPrimaryDomain>> {
  const result = new Map<string, StoreListPrimaryDomain>()
  const bindings = await em.find(EcommerceStoreDomainBinding, {
    storeId: { $in: storeIds },
    tenantId: context.tenantId,
    organizationId: context.organizationId,
    isPrimary: true,
    deletedAt: null,
  } as FilterQuery<EcommerceStoreDomainBinding>)
  if (!bindings.length) return result
  const reader = resolveDomainMappingReader(context.container)
  if (!reader) return result
  const mappings = await reader.findByOrganization(context.organizationId, { tenantId: context.tenantId })
  const hostnameById = new Map<string, string>()
  for (const mapping of mappings) {
    if (mapping.tenantId === context.tenantId && mapping.organizationId === context.organizationId) {
      hostnameById.set(mapping.id, mapping.hostname)
    }
  }
  for (const binding of bindings) {
    const hostname = hostnameById.get(binding.domainMappingId)
    if (hostname) result.set(binding.storeId, { hostname, pathPrefix: binding.pathPrefix ?? null })
  }
  return result
}

async function loadDefaultChannels(
  em: EntityManager,
  storeIds: string[],
  context: EnricherContext,
): Promise<Map<string, StoreListDefaultChannel>> {
  const result = new Map<string, StoreListDefaultChannel>()
  const bindings = await em.find(EcommerceStoreChannelBinding, {
    storeId: { $in: storeIds },
    tenantId: context.tenantId,
    organizationId: context.organizationId,
    isDefault: true,
    deletedAt: null,
  } as FilterQuery<EcommerceStoreChannelBinding>)
  if (!bindings.length) return result
  const channelIds = Array.from(new Set(bindings.map((binding) => binding.salesChannelId)))
  const channels = await findWithDecryption(
    em,
    SalesChannel,
    {
      id: { $in: channelIds },
      tenantId: context.tenantId,
      organizationId: context.organizationId,
      deletedAt: null,
    } as FilterQuery<SalesChannel>,
    undefined,
    { tenantId: context.tenantId, organizationId: context.organizationId },
  )
  const nameById = new Map<string, string>()
  for (const channel of channels) nameById.set(channel.id, channel.name)
  for (const binding of bindings) {
    const name = nameById.get(binding.salesChannelId)
    if (name !== undefined) result.set(binding.storeId, { id: binding.salesChannelId, name })
  }
  return result
}

async function enrichStoreList(
  records: StoreRecord[],
  context: EnricherContext,
): Promise<Array<StoreRecord & StoreListEnrichment>> {
  const storeIds = Array.from(new Set(records.filter(hasRecordId).map((record) => record.id)))
  if (!storeIds.length) return records.map((record) => ({ ...record, _ecommerce: EMPTY_SUMMARY }))
  const em = context.em as EntityManager
  const [domains, channels] = await Promise.all([
    loadPrimaryDomains(em, storeIds, context),
    loadDefaultChannels(em, storeIds, context),
  ])
  return records.map((record) => ({
    ...record,
    _ecommerce: {
      primaryDomain: domains.get(record.id) ?? null,
      defaultChannel: channels.get(record.id) ?? null,
    },
  }))
}

export const storeBindingSummaryEnricher: ResponseEnricher<StoreRecord, StoreListEnrichment> = {
  id: 'ecommerce.store-binding-summary',
  targetEntity: E.ecommerce.ecommerce_store,
  features: ['ecommerce.stores.view'],
  priority: 10,
  timeout: 2000,
  critical: false,
  cacheableOnListHit: false,
  fallback: { _ecommerce: EMPTY_SUMMARY },

  async enrichOne(record, context) {
    const enriched = await this.enrichMany!([record], context)
    return enriched[0]
  },

  async enrichMany(records, context) {
    return enrichStoreList(records, context)
  },
}

export const enrichers: ResponseEnricher[] = [storeBindingSummaryEnricher]
