import type { EnricherContext } from '@open-mercato/shared/lib/crud/response-enricher'
import { EcommerceStoreChannelBinding, EcommerceStoreDomainBinding } from '../entities'
import { enrichers, storeBindingSummaryEnricher, storeDomainBindingMappingEnricher } from '../enrichers'

const findWithDecryptionMock = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => findWithDecryptionMock(...args),
}))

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const MAPPING_ID = '33333333-3333-4333-8333-333333333333'
const CHANNEL_ID = '44444444-4444-4444-8444-444444444444'

type FindCall = { entity: unknown; where: Record<string, unknown> }

function createContext(options: { domainService?: unknown } = {}) {
  const findCalls: FindCall[] = []
  const em = {
    find: jest.fn(async (entity: unknown, where: Record<string, unknown>) => {
      findCalls.push({ entity, where })
      if (entity === EcommerceStoreDomainBinding) {
        return [
          { storeId: 'store-1', domainMappingId: MAPPING_ID, pathPrefix: '/shop' },
          { storeId: 'store-2', domainMappingId: 'dangling-mapping', pathPrefix: null },
        ]
      }
      if (entity === EcommerceStoreChannelBinding) {
        return [{ storeId: 'store-1', salesChannelId: CHANNEL_ID }]
      }
      return []
    }),
  }
  const findByOrganization = jest.fn(async () => [
    { id: MAPPING_ID, hostname: 'shop.example.com', organizationId: ORG_ID, tenantId: TENANT_ID },
    { id: 'foreign-mapping', hostname: 'other.example.com', organizationId: 'other-org', tenantId: TENANT_ID },
  ])
  const domainService = options.domainService === undefined ? { findByOrganization } : options.domainService
  const container = {
    resolve: (name: string) => {
      if (name === 'domainMappingService' && domainService) return domainService
      throw new Error(`not registered: ${name}`)
    },
  }
  const context: EnricherContext = {
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    userId: 'user-1',
    em,
    container,
  }
  return { context, em, findCalls, findByOrganization }
}

describe('ecommerce.store-binding-summary enricher', () => {
  beforeEach(() => {
    findWithDecryptionMock.mockReset().mockResolvedValue([{ id: CHANNEL_ID, name: 'Web channel' }])
  })

  it('is registered for the store entity behind the stores.view feature and never cached across list hits', () => {
    expect(enrichers).toContain(storeBindingSummaryEnricher)
    expect(storeBindingSummaryEnricher.features).toEqual(['ecommerce.stores.view'])
    expect(storeBindingSummaryEnricher.cacheableOnListHit).toBe(false)
    expect(storeBindingSummaryEnricher.fallback).toEqual({ _ecommerce: { primaryDomain: null, defaultChannel: null } })
  })

  it('adds the primary domain and default channel in one batch for all stores on the page', async () => {
    const { context, em, findCalls, findByOrganization } = createContext()
    const records = [{ id: 'store-1' }, { id: 'store-2' }, { id: 'store-3' }]
    const enriched = await storeBindingSummaryEnricher.enrichMany!(records, context)

    expect(enriched).toEqual([
      {
        id: 'store-1',
        _ecommerce: {
          primaryDomain: { hostname: 'shop.example.com', pathPrefix: '/shop' },
          defaultChannel: { id: CHANNEL_ID, name: 'Web channel' },
        },
      },
      { id: 'store-2', _ecommerce: { primaryDomain: null, defaultChannel: null } },
      { id: 'store-3', _ecommerce: { primaryDomain: null, defaultChannel: null } },
    ])
    expect(em.find).toHaveBeenCalledTimes(2)
    expect(findByOrganization).toHaveBeenCalledTimes(1)
    expect(findWithDecryptionMock).toHaveBeenCalledTimes(1)
    for (const call of findCalls) {
      expect(call.where).toMatchObject({
        storeId: { $in: ['store-1', 'store-2', 'store-3'] },
        tenantId: TENANT_ID,
        organizationId: ORG_ID,
        deletedAt: null,
      })
    }
    expect(findCalls.find((call) => call.entity === EcommerceStoreDomainBinding)?.where).toMatchObject({ isPrimary: true })
    expect(findCalls.find((call) => call.entity === EcommerceStoreChannelBinding)?.where).toMatchObject({ isDefault: true })
    expect(findWithDecryptionMock.mock.calls[0][2]).toMatchObject({
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      deletedAt: null,
    })
  })

  it('never exposes a domain mapping that belongs to another organization', async () => {
    const { context } = createContext()
    const findByOrganization = jest.fn(async () => [
      { id: MAPPING_ID, hostname: 'leaked.example.com', organizationId: 'other-org', tenantId: TENANT_ID },
    ])
    const scoped = { ...context, container: { resolve: () => ({ findByOrganization }) } }
    const [enriched] = await storeBindingSummaryEnricher.enrichMany!([{ id: 'store-1' }], scoped)
    expect(enriched._ecommerce.primaryDomain).toBeNull()
  })

  it('degrades to no primary domain when the domain mapping service is not registered', async () => {
    const { context } = createContext({ domainService: null })
    const [enriched] = await storeBindingSummaryEnricher.enrichMany!([{ id: 'store-1' }], context)
    expect(enriched._ecommerce.primaryDomain).toBeNull()
    expect(enriched._ecommerce.defaultChannel).toEqual({ id: CHANNEL_ID, name: 'Web channel' })
  })

  it('enriches a single record through the batch path', async () => {
    const { context } = createContext()
    const enriched = await storeBindingSummaryEnricher.enrichOne!({ id: 'store-1' }, context)
    expect(enriched._ecommerce.primaryDomain?.hostname).toBe('shop.example.com')
  })

  it('does not query when the page has no records', async () => {
    const { context, em } = createContext()
    expect(await storeBindingSummaryEnricher.enrichMany!([], context)).toEqual([])
    expect(em.find).not.toHaveBeenCalled()
  })
})

describe('ecommerce.store-domain-binding-mapping enricher', () => {
  const mappingRecords = [
    {
      id: MAPPING_ID,
      hostname: 'shop.example.com',
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      status: 'tls_failed',
      lastDnsCheckAt: new Date('2026-10-04T08:00:00.000Z'),
      dnsFailureReason: null,
      tlsFailureReason: 'Certificate request rejected',
    },
    { id: 'foreign-mapping', hostname: 'other.example.com', organizationId: 'other-org', tenantId: TENANT_ID, status: 'active' },
  ]

  it('is registered for the domain binding entity behind the stores.view feature', () => {
    expect(enrichers).toContain(storeDomainBindingMappingEnricher)
    expect(storeDomainBindingMappingEnricher.features).toEqual(['ecommerce.stores.view'])
    expect(storeDomainBindingMappingEnricher.cacheableOnListHit).toBe(false)
    expect(storeDomainBindingMappingEnricher.fallback).toEqual({ _domainMapping: { state: 'unavailable' } })
  })

  it('adds the mapping status for every binding with one service read and marks a missing or foreign mapping removed', async () => {
    const findByOrganization = jest.fn(async () => mappingRecords)
    const { context } = createContext({ domainService: { findByOrganization } })
    const records = [
      { id: 'binding-1', domainMappingId: MAPPING_ID },
      { id: 'binding-2', domainMappingId: 'dangling-mapping' },
      { id: 'binding-3', domainMappingId: 'foreign-mapping' },
    ]
    const enriched = await storeDomainBindingMappingEnricher.enrichMany!(records, context)

    expect(findByOrganization).toHaveBeenCalledTimes(1)
    expect(findByOrganization).toHaveBeenCalledWith(ORG_ID, { tenantId: TENANT_ID })
    expect(enriched[0]._domainMapping).toEqual({
      state: 'found',
      hostname: 'shop.example.com',
      status: 'tls_failed',
      lastDnsCheckAt: '2026-10-04T08:00:00.000Z',
      dnsFailureReason: null,
      tlsFailureReason: 'Certificate request rejected',
    })
    expect(enriched[1]._domainMapping).toEqual({ state: 'removed' })
    expect(enriched[2]._domainMapping).toEqual({ state: 'removed' })
  })

  it('reports unavailable rather than removed when the domain mapping service cannot be resolved', async () => {
    const { context } = createContext({ domainService: null })
    const enriched = await storeDomainBindingMappingEnricher.enrichMany!(
      [{ id: 'binding-1', domainMappingId: MAPPING_ID }],
      context,
    )
    expect(enriched[0]._domainMapping).toEqual({ state: 'unavailable' })
  })

  it('enriches a single record through enrichOne', async () => {
    const { context } = createContext({ domainService: { findByOrganization: async () => mappingRecords } })
    const enriched = await storeDomainBindingMappingEnricher.enrichOne!({ id: 'binding-1', domainMappingId: MAPPING_ID }, context)
    expect(enriched._domainMapping).toMatchObject({ state: 'found', status: 'tls_failed' })
  })
})
