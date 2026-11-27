import { hasAllFeatures } from '@open-mercato/shared/security/features'

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const orderId = '44444444-4444-4444-8444-444444444444'
const userId = '33333333-3333-4333-8333-333333333333'
let auth: { tenantId?: string; orgId?: string; sub?: string } | null
let features: string[]
const count = jest.fn()
const find = jest.fn()
const userHasAllFeatures = jest.fn(async (_userId: string, required: string[]) => hasAllFeatures(features, required))
const container = { resolve: (name: string) => {
  if (name === 'em') return { count }
  if (name === 'rbacService') return { userHasAllFeatures }
  throw new Error(`[internal] Unexpected service ${name}`)
} }

jest.mock('@open-mercato/shared/lib/auth/server', () => ({ getAuthFromRequest: jest.fn(async () => auth) }))
jest.mock('@open-mercato/shared/lib/di/container', () => ({ createRequestContainer: jest.fn(async () => container) }))
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => find(...args),
}))

import { GET } from '../route'

function request(query = `orderId=${orderId}`) {
  return new Request(`http://localhost/api/shipping-carriers/shipments?${query}`)
}

describe('carrier shipment summaries', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    auth = { tenantId, orgId: organizationId, sub: userId }
    features = ['shipping_carriers.view']
    count.mockResolvedValue(0)
    find.mockResolvedValue([])
  })

  it.each([null, {}, { tenantId }, { tenantId, sub: userId }])('requires tenant, organization and user scope: %s', async (value) => {
    auth = value
    expect((await GET(request())).status).toBe(401)
    expect(count).not.toHaveBeenCalled()
  })

  it.each([['shipping_carriers.view'], ['shipping_carriers.manage'], ['shipping_carriers.*'], ['*']])('accepts read or management grants: %s', async (...grants) => {
    features = grants
    expect((await GET(request())).status).toBe(200)
    expect(userHasAllFeatures).toHaveBeenCalledWith(userId, expect.any(Array), { tenantId, organizationId })
  })

  it('denies unrelated permissions without reading records', async () => {
    features = ['sales.orders.view']
    expect((await GET(request())).status).toBe(403)
    expect(count).not.toHaveBeenCalled()
    expect(find).not.toHaveBeenCalled()
  })

  it.each(['', 'orderId=invalid', `orderId=${orderId}&page=0`, `orderId=${orderId}&pageSize=101`, `orderId=${orderId}&page=1&page=2`, `orderId=${orderId}&orderId=${orderId}`])('rejects invalid or ambiguous queries: %s', async (query) => {
    expect((await GET(request(query))).status).toBe(400)
    expect(find).not.toHaveBeenCalled()
  })

  it('uses trusted scope, excludes deleted rows and preserves stable pagination', async () => {
    count.mockResolvedValue(23)
    const response = await GET(request(`orderId=${orderId}&page=2&pageSize=10&tenantId=foreign&organizationId=foreign`))
    expect(response.status).toBe(200)
    const filter = { tenantId, organizationId, orderId, deletedAt: null }
    expect(count).toHaveBeenCalledWith(expect.any(Function), filter)
    expect(find).toHaveBeenCalledWith(
      expect.any(Object), expect.any(Function), filter,
      expect.objectContaining({ limit: 10, offset: 10, orderBy: { createdAt: 'DESC', id: 'DESC' } }),
      { tenantId, organizationId },
    )
    expect(await response.json()).toEqual({ items: [], total: 23, page: 2, pageSize: 10, totalPages: 3 })
  })

  it('returns only summary fields and record versions, including cancelled history', async () => {
    count.mockResolvedValue(1)
    find.mockResolvedValue([{
      id: orderId, orderId, providerKey: 'mock_carrier', carrierShipmentId: 'provider-reference', trackingNumber: 'TRACK-123',
      unifiedStatus: 'cancelled', createdAt: new Date('2026-11-01T10:00:00Z'), updatedAt: new Date('2026-11-01T11:00:00Z'),
      labelData: 'private-label-bytes', labelUrl: 'https://private.example/label', trackingEvents: [{ location: 'private' }],
    }])
    const response = await GET(request())
    expect(await response.json()).toEqual({
      items: [{ id: orderId, orderId, providerKey: 'mock_carrier', carrierShipmentId: 'provider-reference', trackingNumber: 'TRACK-123',
        status: 'cancelled', createdAt: '2026-11-01T10:00:00.000Z', updatedAt: '2026-11-01T11:00:00.000Z' }],
      total: 1, page: 1, pageSize: 20, totalPages: 1,
    })
  })
})
