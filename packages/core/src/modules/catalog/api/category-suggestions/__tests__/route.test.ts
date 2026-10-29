export {}

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'

let authValue: Record<string, unknown> | null = { tenantId, orgId: organizationId, sub: 'user-1' }
const findMock = jest.fn().mockResolvedValue([])
const countMock = jest.fn().mockResolvedValue(0)

const container = {
  resolve: jest.fn((name: string) => {
    if (name === 'em') return { fork: () => ({ find: findMock, count: countMock }) }
    throw new Error(`Unexpected resolve: ${name}`)
  }),
}

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => container),
}))
jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(async () => authValue),
}))

import { GET } from '../route'

function suggestionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'suggestion-1',
    product: 'product-1',
    organizationId,
    tenantId,
    outcome: 'suggested',
    categoryId: 'cat-1',
    categoryPathIds: ['cat-1'],
    confidence: '0.9000',
    levels: [],
    status: 'pending',
    trigger: 'manual',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  }
}

describe('catalog category-suggestions list route', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    authValue = { tenantId, orgId: organizationId, sub: 'user-1' }
    findMock.mockResolvedValue([])
    countMock.mockResolvedValue(0)
  })

  it('rejects unauthenticated requests', async () => {
    authValue = null
    const response = await GET(new Request('http://localhost/api/catalog/category-suggestions'))
    expect(response.status).toBe(401)
  })

  it('rejects a pageSize above 100', async () => {
    const response = await GET(new Request('http://localhost/api/catalog/category-suggestions?pageSize=500'))
    expect(response.status).toBe(400)
  })

  it('honors a pageSize at the 100 cap', async () => {
    findMock.mockImplementation(async (_entity: unknown, _where: unknown, options: { limit: number }) => {
      expect(options.limit).toBe(100)
      return []
    })
    const response = await GET(new Request('http://localhost/api/catalog/category-suggestions?pageSize=100'))
    expect(response.status).toBe(200)
  })

  it('computes categoryLive true for a live, active category and false otherwise', async () => {
    // find() is called twice: once for the suggestions page, once for the
    // batch category-liveness lookup — distinguish by call order.
    findMock
      .mockResolvedValueOnce([suggestionRow({ id: 's-1', categoryId: 'cat-live' }), suggestionRow({ id: 's-2', categoryId: 'cat-dead' })])
      .mockResolvedValueOnce([{ id: 'cat-live' }])
    const response = await GET(new Request('http://localhost/api/catalog/category-suggestions'))
    const body = await response.json() as { items: Array<{ id: string; categoryLive: boolean }> }
    expect(body.items.find((i) => i.id === 's-1')?.categoryLive).toBe(true)
    expect(body.items.find((i) => i.id === 's-2')?.categoryLive).toBe(false)
  })

  it('filters out suggestions of soft-deleted products via the product.deletedAt where clause', async () => {
    await GET(new Request('http://localhost/api/catalog/category-suggestions'))
    expect(findMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ product: { deletedAt: null } }),
      expect.anything(),
    )
  })

  it('applies the status filter', async () => {
    await GET(new Request('http://localhost/api/catalog/category-suggestions?status=rejected'))
    expect(findMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: 'rejected' }),
      expect.anything(),
    )
  })
})
