import type { AwilixContainer } from 'awilix'
import { buildAiCategorizeCommandContext } from '../bulkCategorize'
import { createProductSuggester } from '../suggestProduct'

const executeMock = jest.fn()
const userHasAllFeaturesMock = jest.fn()

const suggestionRow = {
  id: 'suggestion-1',
  product: 'product-1',
  organizationId: 'org-1',
  tenantId: 'tenant-1',
  outcome: 'suggested',
  categoryId: 'cat-1',
  categoryPathIds: ['cat-1'],
  confidence: '0.9000',
  levels: [],
  status: 'pending',
  trigger: 'bulk',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
}

jest.mock('../productState', () => ({ buildProductState: jest.fn().mockResolvedValue({ title: 'Widget' }) }))
jest.mock('../treeWalk', () => ({
  walkCategoryTree: jest.fn().mockResolvedValue({
    outcome: 'suggested',
    categoryId: 'cat-1',
    categoryPathIds: ['cat-1'],
    confidence: 0.9,
    levels: [],
  }),
  CATEGORIZATION_PROMPT_VERSION: 'test-version',
}))
jest.mock('../suggestionPersistence', () => ({ persistCategorySuggestion: jest.fn(async () => suggestionRow) }))
jest.mock('../../../events', () => ({ emitCatalogEvent: jest.fn().mockResolvedValue(undefined) }))

function buildContainer() {
  const em = { fork: () => ({ find: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) }) }
  return {
    resolve: jest.fn((name: string) => {
      if (name === 'em') return em
      if (name === 'decisionModelService') return { getAvailability: () => ({ provider: 'p', model: 'm' }) }
      if (name === 'catalogCategorizationService') {
        return { getStatus: jest.fn().mockResolvedValue({ settings: { applyMode: 'auto_apply', autoApplyThreshold: 0.5 } }) }
      }
      if (name === 'rbacService') return { userHasAllFeatures: userHasAllFeaturesMock }
      if (name === 'commandBus') return { execute: executeMock }
      throw new Error(`Unexpected resolve: ${name}`)
    }),
  } as unknown as AwilixContainer
}

const scope = { tenantId: 'tenant-1', organizationId: 'org-1', userId: 'user-queued' }

function buildBulkSuggester() {
  const container = buildContainer()
  const commandContext = buildAiCategorizeCommandContext(scope, container)
  return createProductSuggester({ container, scope, commandContext, trigger: 'bulk' })
}

describe('bulk suggester auto-apply permission', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    executeMock.mockResolvedValue({ result: {}, logEntry: null })
  })

  it('applies when the queued job initiator holds catalog.products.manage', async () => {
    userHasAllFeaturesMock.mockResolvedValue(true)
    await expect(buildBulkSuggester()('product-1')).resolves.toEqual({ outcome: 'suggested' })
    expect(userHasAllFeaturesMock).toHaveBeenCalledWith('user-queued', ['catalog.products.manage'], {
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    })
    expect(executeMock).toHaveBeenCalledTimes(1)
  })

  it('leaves the suggestion pending for an initiator limited to view and AI use', async () => {
    userHasAllFeaturesMock.mockResolvedValue(false)
    await expect(buildBulkSuggester()('product-1')).resolves.toEqual({ outcome: 'suggested' })
    expect(executeMock).not.toHaveBeenCalled()
  })

  it('stops applying once the permission is revoked between enqueue and processing', async () => {
    const suggester = buildBulkSuggester()
    userHasAllFeaturesMock.mockResolvedValueOnce(true).mockResolvedValueOnce(false)
    await suggester('product-1')
    await suggester('product-2')
    expect(executeMock).toHaveBeenCalledTimes(1)
    expect(userHasAllFeaturesMock).toHaveBeenCalledTimes(2)
  })

  it('never applies for the on_create trigger and does not even check permissions', async () => {
    const container = buildContainer()
    const commandContext = buildAiCategorizeCommandContext(scope, container)
    const suggester = createProductSuggester({ container, scope, commandContext, trigger: 'on_create' })
    await suggester('product-1')
    expect(userHasAllFeaturesMock).not.toHaveBeenCalled()
    expect(executeMock).not.toHaveBeenCalled()
  })
})
