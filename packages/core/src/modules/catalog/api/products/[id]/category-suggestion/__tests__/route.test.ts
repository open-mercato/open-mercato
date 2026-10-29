export {}

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const productId = '33333333-3333-4333-8333-333333333333'

const getStatusMock = jest.fn()
const buildProductState = jest.fn()
const walkCategoryTree = jest.fn()
const persistCategorySuggestion = jest.fn()
const emitCatalogEvent = jest.fn().mockResolvedValue(undefined)
const decideMock = jest.fn()
const emFindMock = jest.fn().mockResolvedValue([])

let authValue: Record<string, unknown> | null = { tenantId, orgId: organizationId, sub: 'user-1' }
let decisionServiceAvailable = true

const container = {
  resolve: jest.fn((name: string) => {
    if (name === 'catalogCategorizationService') return { getStatus: getStatusMock }
    if (name === 'em') return { fork: () => ({ find: emFindMock }) }
    if (name === 'decisionModelService') {
      if (!decisionServiceAvailable) throw new Error('not installed')
      return { getAvailability: () => ({ available: true, provider: 'openrouter', model: 'jev' }), decide: decideMock }
    }
    throw new Error(`Unexpected resolve: ${name}`)
  }),
}

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => container),
}))
jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(async () => authValue),
}))
jest.mock('../../../../../lib/aiCategorization/productState', () => ({ buildProductState }))
jest.mock('../../../../../lib/aiCategorization/treeWalk', () => ({
  walkCategoryTree,
  CATEGORIZATION_PROMPT_VERSION: 'test-version',
}))
jest.mock('../../../../../lib/aiCategorization/suggestionPersistence', () => ({ persistCategorySuggestion }))
jest.mock('../../../../../events', () => ({ emitCatalogEvent }))

import { POST } from '../route'

function makeRequest() {
  return new Request(`http://localhost/api/catalog/products/${productId}/category-suggestion`, { method: 'POST' })
}

describe('catalog product category-suggestion route', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    authValue = { tenantId, orgId: organizationId, sub: 'user-1' }
    decisionServiceAvailable = true
    getStatusMock.mockResolvedValue({ available: true, enabled: true, effective: true, settings: {} })
    buildProductState.mockResolvedValue({ title: 'Widget' })
    emFindMock.mockResolvedValue([])
  })

  it('rejects unauthenticated requests', async () => {
    authValue = null
    const response = await POST(makeRequest(), { params: { id: productId } })
    expect(response.status).toBe(401)
  })

  it('returns 409 when AI categorization is not effective', async () => {
    getStatusMock.mockResolvedValue({ available: false, reason: 'not_configured', enabled: false, effective: false, settings: {} })
    const response = await POST(makeRequest(), { params: { id: productId } })
    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ code: 'ai_categorization_unavailable', reason: 'not_configured' })
  })

  it('returns 404 when the product cannot be found', async () => {
    buildProductState.mockResolvedValue(null)
    const response = await POST(makeRequest(), { params: { id: productId } })
    expect(response.status).toBe(404)
  })

  it('returns a 200 error outcome when the decision model service cannot be resolved', async () => {
    decisionServiceAvailable = false
    const response = await POST(makeRequest(), { params: { id: productId } })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ outcome: 'error', code: 'unavailable' })
    expect(walkCategoryTree).not.toHaveBeenCalled()
  })

  it('returns a 200 error outcome when the tree walk fails', async () => {
    walkCategoryTree.mockResolvedValue({ outcome: 'error', code: 'timeout' })
    const response = await POST(makeRequest(), { params: { id: productId } })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ outcome: 'error', code: 'timeout' })
    expect(persistCategorySuggestion).not.toHaveBeenCalled()
  })

  it('persists and returns 201 with the serialized suggestion on a successful suggestion', async () => {
    walkCategoryTree.mockResolvedValue({
      outcome: 'suggested',
      categoryId: 'cat-1',
      categoryPathIds: ['cat-1'],
      confidence: 0.9,
      levels: [],
    })
    persistCategorySuggestion.mockResolvedValue({
      id: 'suggestion-1',
      product: productId,
      organizationId,
      tenantId,
      outcome: 'suggested',
      categoryId: 'cat-1',
      categoryPathIds: ['cat-1'],
      confidence: '0.9000',
      levels: [],
      status: 'pending',
      trigger: 'manual',
      provider: 'openrouter',
      model: 'jev',
      promptVersion: 'test-version',
      costUsd: null,
      durationMs: 5,
      requestedByUserId: 'user-1',
      reviewedByUserId: null,
      reviewedAt: null,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    })
    const response = await POST(makeRequest(), { params: { id: productId } })
    expect(response.status).toBe(201)
    const body = await response.json() as { suggestion: { id: string; status: string } }
    expect(body.suggestion.id).toBe('suggestion-1')
    expect(body.suggestion.status).toBe('pending')
    expect(emitCatalogEvent).toHaveBeenCalledWith(
      'catalog.category_suggestion.created',
      expect.objectContaining({ id: 'suggestion-1', productId, categoryId: 'cat-1' }),
      { tenantId, organizationId },
    )
  })

  it('persists a no_match outcome with a null category', async () => {
    walkCategoryTree.mockResolvedValue({ outcome: 'no_match' })
    persistCategorySuggestion.mockResolvedValue({
      id: 'suggestion-2',
      product: productId,
      organizationId,
      tenantId,
      outcome: 'no_match',
      categoryId: null,
      categoryPathIds: [],
      confidence: null,
      levels: [],
      status: 'pending',
      trigger: 'manual',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    })
    const response = await POST(makeRequest(), { params: { id: productId } })
    expect(response.status).toBe(201)
    expect(persistCategorySuggestion).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      outcome: 'no_match',
      categoryId: null,
      categoryPathIds: [],
      confidence: null,
    }))
  })
})
