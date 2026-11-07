export {}

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const suggestionId = '33333333-3333-4333-8333-333333333333'
const productId = '44444444-4444-4444-8444-444444444444'

const getStatusMock = jest.fn()
const executeMock = jest.fn()
const findOneMock = jest.fn()

let authValue: Record<string, unknown> | null = { tenantId, orgId: organizationId, sub: 'user-1' }

const container = {
  resolve: jest.fn((name: string) => {
    if (name === 'catalogCategorizationService') return { getStatus: getStatusMock }
    if (name === 'commandBus') return { execute: executeMock }
    if (name === 'em') return { fork: () => ({ findOne: findOneMock }) }
    throw new Error(`Unexpected resolve: ${name}`)
  }),
}

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => container),
}))
jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(async () => authValue),
}))

import { POST } from '../route'

function makeRequest() {
  return new Request(`http://localhost/api/catalog/category-suggestions/${suggestionId}/reject`, { method: 'POST' })
}

describe('catalog category-suggestions reject route', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    authValue = { tenantId, orgId: organizationId, sub: 'user-1' }
    getStatusMock.mockResolvedValue({ available: true, enabled: true, effective: true, settings: {} })
    executeMock.mockResolvedValue({ result: { suggestionId } })
    findOneMock.mockResolvedValue({
      id: suggestionId,
      product: productId,
      organizationId,
      tenantId,
      outcome: 'suggested',
      categoryId: 'cat-1',
      categoryPathIds: ['cat-1'],
      confidence: '0.9000',
      levels: [],
      status: 'rejected',
      trigger: 'manual',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    })
  })

  it('rejects unauthenticated requests', async () => {
    authValue = null
    const response = await POST(makeRequest(), { params: { id: suggestionId } })
    expect(response.status).toBe(401)
  })

  it('returns 409 when AI categorization is not effective', async () => {
    getStatusMock.mockResolvedValue({ available: false, reason: 'model_missing', enabled: true, effective: false, settings: {} })
    const response = await POST(makeRequest(), { params: { id: suggestionId } })
    expect(response.status).toBe(409)
    expect(executeMock).not.toHaveBeenCalled()
  })

  it('dispatches the reject command and returns the serialized suggestion', async () => {
    const response = await POST(makeRequest(), { params: { id: suggestionId } })
    expect(response.status).toBe(200)
    expect(executeMock).toHaveBeenCalledWith('catalog.category_suggestions.reject', expect.objectContaining({
      input: { id: suggestionId },
    }))
    const body = await response.json() as { suggestion: { status: string } }
    expect(body.suggestion.status).toBe('rejected')
  })
})
