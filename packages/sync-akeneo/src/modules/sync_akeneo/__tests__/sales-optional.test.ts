/** @jest-environment node */

const tenantId = '11111111-1111-4111-8111-111111111111'
const orgId = '22222222-2222-4222-8222-222222222222'

let mockSalesChannelsAvailable = true
let mockCredentials: Record<string, unknown> | null = null

const mockFindWithDecryption = jest.fn()
const mockFindOneWithDecryption = jest.fn()
const mockCollectDiscoveryData = jest.fn()

const mockEm = {
  getMetadata: () => ({
    has: (entity: unknown) => mockSalesChannelsAvailable || entity !== SalesChannel,
  }),
  create: jest.fn((_entity: unknown, data: Record<string, unknown>) => ({ ...data })),
  persist: jest.fn(() => ({ flush: async () => undefined })),
  flush: jest.fn(async () => undefined),
}

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => mockFindWithDecryption(...args),
  findOneWithDecryption: (...args: unknown[]) => mockFindOneWithDecryption(...args),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: async () => ({ tenantId, orgId, sub: null }),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => ({
    resolve: (token: string) => {
      if (token === 'em') return mockEm
      if (token === 'integrationCredentialsService') return { resolve: async () => mockCredentials }
      return undefined
    },
  }),
}))

jest.mock('../lib/client', () => ({
  ...jest.requireActual('../lib/client'),
  createAkeneoClient: () => ({ collectDiscoveryData: mockCollectDiscoveryData }),
}))

import type { EntityManager } from '@mikro-orm/postgresql'
import type { CredentialsService } from '@open-mercato/core/modules/integrations/lib/credentials-service'
import type { IntegrationStateService } from '@open-mercato/core/modules/integrations/lib/state-service'
import { SalesChannel } from '@open-mercato/core/modules/sales/data/entities'
import { CatalogPriceKind } from '@open-mercato/core/modules/catalog/data/entities'
import { SyncMapping } from '@open-mercato/core/modules/data_sync/data/entities'
import { GET } from '../api/discovery/route'
import { applyAkeneoEnvPreset } from '../lib/preset'
import { metadata } from '../index'

const DISCOVERY = {
  locales: [{ code: 'en_US', label: 'English', enabled: true }],
  channels: [{ code: 'ecommerce', label: 'Ecommerce', locales: ['en_US'] }],
  attributes: [
    { code: 'name', type: 'pim_catalog_text', label: 'Name', localizable: true, scopable: false },
    { code: 'price', type: 'pim_catalog_price_collection', label: 'Price', localizable: false, scopable: true },
  ],
  families: [{ code: 'clothing', label: 'Clothing', attributeCount: 2 }],
  familyVariants: [],
  version: '7.0',
}

const PRESET_ENV = {
  OM_INTEGRATION_AKENEO_API_URL: 'https://example.akeneo.com',
  OM_INTEGRATION_AKENEO_CLIENT_ID: 'client-id',
  OM_INTEGRATION_AKENEO_CLIENT_SECRET: 'client-secret',
  OM_INTEGRATION_AKENEO_USERNAME: 'api-user',
  OM_INTEGRATION_AKENEO_PASSWORD: 'api-pass',
  OM_INTEGRATION_AKENEO_PRODUCT_CHANNEL: 'ecommerce',
} as NodeJS.ProcessEnv

function salesChannelLookups(): unknown[][] {
  return [...mockFindWithDecryption.mock.calls, ...mockFindOneWithDecryption.mock.calls]
    .filter(([, entity]) => entity === SalesChannel)
}

beforeEach(() => {
  mockSalesChannelsAvailable = true
  mockCredentials = null
  mockFindWithDecryption.mockReset()
  mockFindOneWithDecryption.mockReset()
  mockCollectDiscoveryData.mockReset()
  mockCollectDiscoveryData.mockResolvedValue(DISCOVERY)
  mockFindWithDecryption.mockImplementation(async (_em: unknown, entity: unknown) => {
    if (entity === SalesChannel) {
      if (!mockSalesChannelsAvailable) throw new Error('Metadata for entity SalesChannel not found')
      return [{ code: 'web', name: 'Web' }]
    }
    if (entity === CatalogPriceKind) return [{ code: 'regular', title: 'Regular', displayMode: 'excluding-tax' }]
    return []
  })
  mockFindOneWithDecryption.mockImplementation(async (_em: unknown, entity: unknown) => {
    if (entity === SalesChannel && !mockSalesChannelsAvailable) {
      throw new Error('Metadata for entity SalesChannel not found')
    }
    return null
  })
})

describe('sync_akeneo with the sales module disabled', () => {
  it('no longer requires sales and declares progress explicitly', () => {
    expect(metadata.requires).not.toContain('sales')
    expect(metadata.requires).toEqual(expect.arrayContaining(['integrations', 'data_sync', 'catalog', 'progress']))
  })

  it('discovery returns an empty local channel list and keeps the rest of the payload', async () => {
    mockSalesChannelsAvailable = false
    mockCredentials = { apiUrl: 'https://example.akeneo.com' }

    const res = await GET(new Request('http://localhost/api/sync_akeneo/discovery'))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.localChannels).toEqual([])
    expect(body.priceKinds).toEqual([{ code: 'regular', title: 'Regular', displayMode: 'excluding-tax' }])
    expect(body.locales).toEqual(DISCOVERY.locales)
    expect(body.channels).toEqual(DISCOVERY.channels)
    expect(body.attributes.map((attribute: { code: string }) => attribute.code)).toEqual(['name', 'price'])
    expect(body.families).toEqual(DISCOVERY.families)
    expect(salesChannelLookups()).toEqual([])
  })

  it('discovery without credentials still lists price kinds and no local channels', async () => {
    mockSalesChannelsAvailable = false

    const res = await GET(new Request('http://localhost/api/sync_akeneo/discovery'))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.localChannels).toEqual([])
    expect(body.priceKinds).toHaveLength(1)
  })

  it('discovery still lists local sales channels when sales is enabled', async () => {
    mockCredentials = { apiUrl: 'https://example.akeneo.com' }

    const res = await GET(new Request('http://localhost/api/sync_akeneo/discovery'))

    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.localChannels).toEqual([{ code: 'web', name: 'Web' }])
  })

  it('env preset applies credentials and mappings without channel-bound prices', async () => {
    mockSalesChannelsAvailable = false
    const credentialsService = { save: jest.fn(async () => undefined), resolve: jest.fn(async () => null) }
    const integrationStateService = { upsert: jest.fn(async () => undefined) }

    const result = await applyAkeneoEnvPreset({
      em: mockEm as unknown as EntityManager,
      credentialsService: credentialsService as unknown as CredentialsService,
      integrationStateService: integrationStateService as unknown as IntegrationStateService,
      scope: { organizationId: orgId, tenantId },
      force: true,
      env: PRESET_ENV,
    })

    expect(result).toEqual({ status: 'configured', discoveryApplied: true })
    expect(credentialsService.save).toHaveBeenCalledTimes(1)
    expect(integrationStateService.upsert).toHaveBeenCalledWith('sync_akeneo', { isEnabled: true }, { organizationId: orgId, tenantId })
    const createdMappings = mockEm.create.mock.calls
      .filter(([entity]) => entity === SyncMapping)
      .map(([, data]) => data as { entityType: string; mapping: { settings?: { products?: { priceMappings?: Array<{ localChannelCode: string }> } } } })
    expect(createdMappings.map((entry) => entry.entityType)).toEqual(['products', 'categories', 'attributes'])
    const productsMapping = createdMappings.find((entry) => entry.entityType === 'products')
    expect(productsMapping?.mapping.settings?.products?.priceMappings ?? []).toEqual([])
    expect(salesChannelLookups()).toEqual([])
  })
})
