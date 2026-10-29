export {}

const registerCommand = jest.fn()
const emitCrudSideEffects = jest.fn()
const emitCrudUndoSideEffects = jest.fn()
const enforceCommandOptimisticLockWithGuards = jest.fn().mockResolvedValue(undefined)
const findWithDecryption = jest.fn().mockResolvedValue([])
const resolveTranslations = jest.fn().mockResolvedValue({ translate: (_key: string, fallback?: string) => fallback ?? _key })
const emitCatalogEvent = jest.fn().mockResolvedValue(undefined)
const syncCategoryAssignments = jest.fn().mockResolvedValue(undefined)

jest.mock('@open-mercato/shared/lib/commands', () => ({ registerCommand }))
jest.mock('@open-mercato/shared/lib/commands/helpers', () => ({ emitCrudSideEffects, emitCrudUndoSideEffects }))
jest.mock('@open-mercato/shared/lib/crud/optimistic-lock-command', () => ({ enforceCommandOptimisticLockWithGuards }))
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({ findWithDecryption }))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({ resolveTranslations }))
jest.mock('../../events', () => ({ emitCatalogEvent }))
jest.mock('../products', () => ({ syncCategoryAssignments }))

import { acceptCategorySuggestionCommand, rejectCategorySuggestionCommand } from '../categorySuggestions'

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const PRODUCT = '33333333-3333-4333-8333-333333333333'
const SUGGESTION = '44444444-4444-4444-8444-444444444444'
const CATEGORY = '55555555-5555-4555-8555-555555555555'
const USER = '66666666-6666-4666-8666-666666666666'

type FakeRecord = Record<string, unknown>

function buildEm(findOneResults: Array<FakeRecord | null>, opts: { countResult?: number } = {}) {
  let index = 0
  const em = {
    findOne: jest.fn().mockImplementation(async () => findOneResults[index++] ?? null),
    find: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(opts.countResult ?? 0),
    flush: jest.fn().mockResolvedValue(undefined),
  }
  ;(em as unknown as { fork: () => typeof em }).fork = () => em
  return em
}

function buildCtx(em: ReturnType<typeof buildEm>) {
  return {
    container: {
      resolve: jest.fn((name: string) => {
        if (name === 'em') return em
        if (name === 'dataEngine') return { markOrmEntityChange: jest.fn() }
        throw new Error(`Unexpected resolve: ${name}`)
      }),
    },
    auth: { sub: USER, tenantId: TENANT, orgId: ORG },
    organizationScope: null,
    selectedOrganizationId: ORG,
    organizationIds: null,
    request: undefined,
  } as never
}

function buildSuggestion(overrides: FakeRecord = {}): FakeRecord {
  return {
    id: SUGGESTION,
    tenantId: TENANT,
    organizationId: ORG,
    status: 'pending',
    categoryId: CATEGORY,
    confidence: '0.8100',
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    product: { id: PRODUCT, organizationId: ORG, tenantId: TENANT },
    ...overrides,
  }
}

function buildProduct(overrides: FakeRecord = {}): FakeRecord {
  return { id: PRODUCT, organizationId: ORG, tenantId: TENANT, updatedAt: new Date('2026-01-01T00:00:00Z'), ...overrides }
}

function buildCategory(overrides: FakeRecord = {}): FakeRecord {
  return { id: CATEGORY, organizationId: ORG, tenantId: TENANT, deletedAt: null, isActive: true, ...overrides }
}

describe('catalog.category_suggestions.accept', () => {
  beforeEach(() => jest.clearAllMocks())

  it('becomes the only category when the product has none', async () => {
    findWithDecryption.mockResolvedValueOnce([])
    const suggestion = buildSuggestion()
    const em = buildEm([suggestion, buildCategory()])
    const result = await acceptCategorySuggestionCommand.execute({ id: SUGGESTION }, buildCtx(em))
    expect(syncCategoryAssignments).toHaveBeenCalledWith(em, expect.objectContaining({ id: PRODUCT }), [CATEGORY])
    expect(result.categoryIdsBefore).toEqual([])
    expect(result.categoryIdsAfter).toEqual([CATEGORY])
  })

  it('appends the category last when the product already has categories', async () => {
    findWithDecryption.mockResolvedValueOnce([
      { position: 0, category: { id: 'existing-1' } },
    ])
    const suggestion = buildSuggestion()
    const em = buildEm([suggestion, buildCategory()])
    const result = await acceptCategorySuggestionCommand.execute({ id: SUGGESTION }, buildCtx(em))
    expect(result.categoryIdsAfter).toEqual(['existing-1', CATEGORY])
  })

  it('puts the category first when makeMain is set', async () => {
    findWithDecryption.mockResolvedValueOnce([
      { position: 0, category: { id: 'existing-1' } },
    ])
    const suggestion = buildSuggestion()
    const em = buildEm([suggestion, buildCategory()])
    const result = await acceptCategorySuggestionCommand.execute({ id: SUGGESTION, makeMain: true }, buildCtx(em))
    expect(result.categoryIdsAfter).toEqual([CATEGORY, 'existing-1'])
  })

  it('returns 422 category_unavailable when the category is soft-deleted', async () => {
    const suggestion = buildSuggestion()
    const em = buildEm([suggestion, null])
    await expect(acceptCategorySuggestionCommand.execute({ id: SUGGESTION }, buildCtx(em)))
      .rejects.toMatchObject({ status: 422, body: { code: 'category_unavailable' } })
  })

  it('returns 409 when the suggestion is not pending', async () => {
    const suggestion = buildSuggestion({ status: 'accepted' })
    const em = buildEm([suggestion])
    await expect(acceptCategorySuggestionCommand.execute({ id: SUGGESTION }, buildCtx(em)))
      .rejects.toMatchObject({ status: 409, body: { code: 'suggestion_not_pending' } })
  })

  it('undo restores exactly before.categoryIds and touches no other product field', async () => {
    const product = buildProduct()
    const em = buildEm([product])
    const logEntry = {
      commandPayload: {
        undo: { suggestionId: SUGGESTION, productId: PRODUCT, before: { categoryIds: ['existing-1'] } },
      },
    }
    await acceptCategorySuggestionCommand.undo!({ input: { id: SUGGESTION }, ctx: buildCtx(em), logEntry })
    expect(syncCategoryAssignments).toHaveBeenCalledWith(em, product, ['existing-1'])
    expect(Object.keys(product)).toEqual(['id', 'organizationId', 'tenantId', 'updatedAt'])
  })
})

describe('catalog.category_suggestions.reject', () => {
  beforeEach(() => jest.clearAllMocks())

  it('rejects a pending suggestion', async () => {
    const suggestion = buildSuggestion()
    const em = buildEm([suggestion])
    const result = await rejectCategorySuggestionCommand.execute({ id: SUGGESTION }, buildCtx(em))
    expect(suggestion.status).toBe('rejected')
    expect(result.suggestionId).toBe(SUGGESTION)
    expect(emitCatalogEvent).toHaveBeenCalledWith(
      'catalog.category_suggestion.rejected',
      expect.objectContaining({ id: SUGGESTION, status: 'rejected' }),
      { tenantId: TENANT, organizationId: ORG },
    )
  })

  it('returns 409 when the suggestion is not pending', async () => {
    const suggestion = buildSuggestion({ status: 'rejected' })
    const em = buildEm([suggestion])
    await expect(rejectCategorySuggestionCommand.execute({ id: SUGGESTION }, buildCtx(em)))
      .rejects.toMatchObject({ status: 409, body: { code: 'suggestion_not_pending' } })
  })
})

describe('undo supersede rule (shared by accept and reject)', () => {
  beforeEach(() => jest.clearAllMocks())

  it('restores pending when no newer pending suggestion exists', async () => {
    const suggestion = buildSuggestion({ status: 'rejected' })
    const em = buildEm([suggestion], { countResult: 0 })
    const logEntry = { commandPayload: { undo: { suggestionId: SUGGESTION, productId: PRODUCT } } }
    await rejectCategorySuggestionCommand.undo!({ input: { id: SUGGESTION }, ctx: buildCtx(em), logEntry })
    expect(suggestion.status).toBe('pending')
  })

  it('sets superseded when a newer pending suggestion already exists', async () => {
    const suggestion = buildSuggestion({ status: 'rejected' })
    const em = buildEm([suggestion], { countResult: 1 })
    const logEntry = { commandPayload: { undo: { suggestionId: SUGGESTION, productId: PRODUCT } } }
    await rejectCategorySuggestionCommand.undo!({ input: { id: SUGGESTION }, ctx: buildCtx(em), logEntry })
    expect(suggestion.status).toBe('superseded')
  })
})
