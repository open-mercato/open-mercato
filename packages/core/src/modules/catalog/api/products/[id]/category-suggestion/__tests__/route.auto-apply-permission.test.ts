export {}

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const productId = '33333333-3333-4333-8333-333333333333'

const executeMock = jest.fn()
const userHasAllFeaturesMock = jest.fn()
const emCountMock = jest.fn().mockResolvedValue(0)

const suggestionRow = {
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
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
}

const container = {
  resolve: jest.fn((name: string) => {
    if (name === 'catalogCategorizationService') {
      return {
        getStatus: jest.fn().mockResolvedValue({
          effective: true,
          settings: { applyMode: 'auto_apply', autoApplyThreshold: 0.85 },
        }),
      }
    }
    if (name === 'em') {
      return { fork: () => ({ find: jest.fn().mockResolvedValue([]), findOne: jest.fn().mockResolvedValue(suggestionRow), count: emCountMock }) }
    }
    if (name === 'decisionModelService') return { getAvailability: () => ({ provider: 'p', model: 'm' }) }
    if (name === 'rbacService') return { userHasAllFeatures: userHasAllFeaturesMock }
    if (name === 'commandBus') return { execute: executeMock }
    throw new Error(`Unexpected resolve: ${name}`)
  }),
}

jest.mock('@open-mercato/shared/lib/di/container', () => ({ createRequestContainer: jest.fn(async () => container) }))
jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(async () => ({ tenantId, orgId: organizationId, sub: 'user-ai-only' })),
}))
jest.mock('../../../../../lib/aiCategorization/productState', () => ({ buildProductState: jest.fn().mockResolvedValue({ title: 'Widget' }) }))
jest.mock('../../../../../lib/aiCategorization/treeWalk', () => ({
  walkCategoryTree: jest.fn().mockResolvedValue({
    outcome: 'suggested',
    categoryId: 'cat-1',
    categoryPathIds: ['cat-1'],
    confidence: 0.9,
    levels: [],
  }),
  CATEGORIZATION_PROMPT_VERSION: 'test-version',
}))
jest.mock('../../../../../lib/aiCategorization/suggestionPersistence', () => ({
  persistCategorySuggestion: jest.fn().mockResolvedValue(suggestionRow),
}))
jest.mock('../../../../../events', () => ({ emitCatalogEvent: jest.fn().mockResolvedValue(undefined) }))

import { POST } from '../route'

function makeRequest() {
  return new Request(`http://localhost/api/catalog/products/${productId}/category-suggestion`, { method: 'POST' })
}

describe('catalog product category-suggestion route auto-apply permission', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    emCountMock.mockResolvedValue(0)
    executeMock.mockResolvedValue({ result: { product: { id: productId, categoryIds: ['cat-1'], updatedAt: 'x' } }, logEntry: null })
  })

  it('keeps the suggestion pending and does not run the accept command for a view plus AI-use principal', async () => {
    userHasAllFeaturesMock.mockResolvedValue(false)
    const response = await POST(makeRequest(), { params: { id: productId } })
    expect(response.status).toBe(201)
    const body = (await response.json()) as { suggestion: { status: string }; product?: unknown }
    expect(body.suggestion.status).toBe('pending')
    expect(body.product).toBeUndefined()
    expect(userHasAllFeaturesMock).toHaveBeenCalledWith('user-ai-only', ['catalog.products.manage'], { tenantId, organizationId })
    expect(executeMock).not.toHaveBeenCalled()
  })

  it('applies through the accept command for a principal holding catalog.products.manage', async () => {
    userHasAllFeaturesMock.mockResolvedValue(true)
    const response = await POST(makeRequest(), { params: { id: productId } })
    expect(response.status).toBe(201)
    expect(executeMock).toHaveBeenCalledWith('catalog.category_suggestions.accept', expect.objectContaining({
      input: { id: 'suggestion-1', autoApplied: true },
    }))
  })
})
