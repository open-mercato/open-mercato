import type { CrudCtx } from '@open-mercato/shared/lib/crud/factory'
import { CatalogOffer } from '../../data/entities'
import { SalesChannel } from '@open-mercato/core/modules/sales/data/entities'

const mockMakeCrudRoute = jest.fn((_config: unknown) => ({ metadata: {}, GET: jest.fn(), POST: jest.fn(), PUT: jest.fn(), DELETE: jest.fn() }))
const mockFindWithDecryption = jest.fn()

jest.mock('@open-mercato/shared/lib/crud/factory', () => ({
  makeCrudRoute: (config: unknown) => mockMakeCrudRoute(config),
}))
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => mockFindWithDecryption(...args),
}))
jest.mock('../../lib/omnibusProductListEnrichment', () => ({
  attachProductListOmnibusBlocks: jest.fn().mockResolvedValue(undefined),
}))

type Product = { id: string; offers?: Array<Record<string, unknown>>; channelIds?: string[]; pricing?: unknown }
type ListConfig = { hooks: { afterList: (payload: { items: Product[] }, ctx: CrudCtx) => Promise<void> } }

describe('catalog product offer channel labels', () => {
  let afterList: ListConfig['hooks']['afterList']

  beforeAll(async () => {
    await import('../products/route')
    afterList = (mockMakeCrudRoute.mock.calls[0][0] as ListConfig).hooks.afterList
  })

  beforeEach(() => {
    mockFindWithDecryption.mockReset()
  })

  async function listProducts(salesEnabled: boolean, channelId = 'channel-1') {
    const has = jest.fn().mockReturnValue(salesEnabled)
    const em = { getMetadata: () => ({ has }) }
    const resolvePriceMany = jest.fn().mockResolvedValue([null])
    mockFindWithDecryption.mockImplementation(async (_em: unknown, entity: unknown) => {
      if (entity === CatalogOffer) return [{ id: 'offer-1', product: 'product-1', channelId, title: 'Offer', isActive: true }]
      if (entity === SalesChannel) {
        if (!salesEnabled) throw new Error('Metadata for entity SalesChannel not found')
        return [{ id: 'channel-1', name: 'Web store', code: 'web' }]
      }
      return []
    })
    const ctx = {
      container: { resolve: (key: string) => key === 'em' ? { fork: () => em } : { resolvePriceMany } },
      auth: { tenantId: 'tenant-1', orgId: 'auth-org' },
      selectedOrganizationId: 'selected-org',
      organizationIds: ['selected-org', 'other-org'],
      query: {},
    } as unknown as CrudCtx
    const payload: { items: Product[] } = { items: [{ id: 'product-1' }] }
    await afterList(payload, ctx)
    return { payload, has, resolvePriceMany }
  }

  it('keeps offers and pricing readable without SalesChannel metadata', async () => {
    const { payload, resolvePriceMany } = await listProducts(false)
    expect(payload.items[0].offers).toEqual([expect.objectContaining({
      id: 'offer-1', channelId: 'channel-1', channelName: null, channelCode: null, title: 'Offer',
    })])
    expect(payload.items[0].channelIds).toEqual(['channel-1'])
    expect(payload.items[0].pricing).toBeNull()
    expect(resolvePriceMany).toHaveBeenCalledTimes(1)
    expect(mockFindWithDecryption.mock.calls.some(([, entity]) => entity === SalesChannel)).toBe(false)
  })

  it('keeps scoped channel labels when sales is enabled', async () => {
    const { payload } = await listProducts(true)
    expect(payload.items[0].offers).toEqual([expect.objectContaining({ channelName: 'Web store', channelCode: 'web' })])
    expect(mockFindWithDecryption).toHaveBeenCalledWith(expect.anything(), SalesChannel, expect.objectContaining({
      id: { $in: ['channel-1'] }, tenantId: 'tenant-1', organizationId: { $in: ['selected-org', 'other-org'] }, deletedAt: null,
    }), { fields: ['id', 'name', 'code'] })
    expect(mockFindWithDecryption).toHaveBeenCalledWith(expect.anything(), CatalogOffer, {
      product: { $in: ['product-1'] }, deletedAt: null, tenantId: 'tenant-1', organizationId: 'selected-org',
    }, { orderBy: { createdAt: 'asc' } }, { tenantId: 'tenant-1', organizationId: 'selected-org' })
  })

  it('does not query channels for offers without a channel identifier', async () => {
    const { payload, has } = await listProducts(false, '')
    expect(payload.items[0].offers).toHaveLength(1)
    expect(payload.items[0].channelIds).toEqual([])
    expect(has).not.toHaveBeenCalled()
    expect(mockFindWithDecryption.mock.calls.some(([, entity]) => entity === SalesChannel)).toBe(false)
  })
})
