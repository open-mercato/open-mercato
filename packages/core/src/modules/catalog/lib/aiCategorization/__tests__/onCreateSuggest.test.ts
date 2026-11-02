import type { AwilixContainer } from 'awilix'
import {
  CatalogProduct,
  CatalogProductCategoryAssignment,
  CatalogProductCategorySuggestion,
} from '../../../data/entities'
import { decideAutoApply } from '../autoApply'
import {
  enqueueOnCreateSuggestion,
  isOnCreateJobPayload,
  runOnCreateSuggestion,
  type CatalogProductAiCategorizeOnCreateJobPayload,
} from '../onCreateSuggest'
import type { ProductSuggester } from '../suggestProduct'

type GateState = {
  effective?: boolean
  autoSuggestOnCreate?: boolean
  productCount?: number
  assignmentCount?: number
  priorSuggestionCount?: number
  statusError?: Error
}

function buildContainer(state: GateState = {}) {
  const getStatus = jest.fn(async () => {
    if (state.statusError) throw state.statusError
    return {
      effective: state.effective ?? true,
      settings: { enabled: true, applyMode: 'auto_apply', autoApplyThreshold: 0.5, autoSuggestOnCreate: state.autoSuggestOnCreate ?? true },
    }
  })
  const count = jest.fn(async (entity: unknown) => {
    if (entity === CatalogProduct) return state.productCount ?? 1
    if (entity === CatalogProductCategoryAssignment) return state.assignmentCount ?? 0
    if (entity === CatalogProductCategorySuggestion) return state.priorSuggestionCount ?? 0
    return 0
  })
  const em = { fork: () => ({ count }), count }
  const container = {
    resolve: jest.fn((name: string) => {
      if (name === 'catalogCategorizationService') return { getStatus }
      if (name === 'em') return em
      return undefined
    }),
  } as unknown as AwilixContainer
  return { container, count, getStatus }
}

const ids = { productId: 'product-1', tenantId: 'tenant-1', organizationId: 'org-1' }

describe('enqueueOnCreateSuggestion', () => {
  it('enqueues a suggestion-only job without any user when effective and the switch is on', async () => {
    const { container } = buildContainer()
    const enqueue = jest.fn().mockResolvedValue(undefined)
    const result = await enqueueOnCreateSuggestion({ container, ...ids, enqueue })
    expect(result).toEqual({ proceed: true })
    expect(enqueue).toHaveBeenCalledWith({
      trigger: 'on_create',
      productId: 'product-1',
      scope: { organizationId: 'org-1', tenantId: 'tenant-1' },
    })
  })

  it('does nothing when the feature is not effective', async () => {
    const { container } = buildContainer({ effective: false })
    const enqueue = jest.fn()
    expect(await enqueueOnCreateSuggestion({ container, ...ids, enqueue })).toEqual({ proceed: false, reason: 'feature_off' })
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('does nothing when autoSuggestOnCreate is off', async () => {
    const { container } = buildContainer({ autoSuggestOnCreate: false })
    const enqueue = jest.fn()
    expect(await enqueueOnCreateSuggestion({ container, ...ids, enqueue })).toEqual({ proceed: false, reason: 'feature_off' })
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('skips a product that already has categories', async () => {
    const { container } = buildContainer({ assignmentCount: 2 })
    const enqueue = jest.fn()
    expect(await enqueueOnCreateSuggestion({ container, ...ids, enqueue })).toEqual({ proceed: false, reason: 'already_categorized' })
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('skips a product deleted before the subscriber ran', async () => {
    const { container } = buildContainer({ productCount: 0 })
    const enqueue = jest.fn()
    expect(await enqueueOnCreateSuggestion({ container, ...ids, enqueue })).toEqual({ proceed: false, reason: 'product_not_found' })
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('skips a redelivered event once an on_create suggestion exists', async () => {
    const { container } = buildContainer({ priorSuggestionCount: 1 })
    const enqueue = jest.fn()
    expect(await enqueueOnCreateSuggestion({ container, ...ids, enqueue })).toEqual({ proceed: false, reason: 'already_suggested' })
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('swallows queue failures', async () => {
    const { container } = buildContainer()
    const enqueue = jest.fn().mockRejectedValue(new Error('queue down'))
    await expect(enqueueOnCreateSuggestion({ container, ...ids, enqueue })).resolves.toEqual({
      proceed: false,
      reason: 'enqueue_failed',
    })
  })

  it('swallows lookup failures', async () => {
    const { container } = buildContainer({ statusError: new Error('config down') })
    const enqueue = jest.fn()
    await expect(enqueueOnCreateSuggestion({ container, ...ids, enqueue })).resolves.toEqual({
      proceed: false,
      reason: 'enqueue_failed',
    })
    expect(enqueue).not.toHaveBeenCalled()
  })
})

describe('runOnCreateSuggestion', () => {
  const payload: CatalogProductAiCategorizeOnCreateJobPayload = {
    trigger: 'on_create',
    productId: 'product-1',
    scope: { organizationId: 'org-1', tenantId: 'tenant-1' },
  }

  it('runs the suggester when the gate still passes', async () => {
    const { container } = buildContainer()
    const suggester: jest.MockedFunction<ProductSuggester> = jest.fn(async () => ({ outcome: 'suggested' as const }))
    const result = await runOnCreateSuggestion({ container, payload, suggester })
    expect(result).toEqual({ proceed: true, outcome: 'suggested' })
    expect(suggester).toHaveBeenCalledWith('product-1')
  })

  it('re-checks the gate and skips when the feature was switched off meanwhile', async () => {
    const { container } = buildContainer({ autoSuggestOnCreate: false })
    const suggester: jest.MockedFunction<ProductSuggester> = jest.fn()
    expect(await runOnCreateSuggestion({ container, payload, suggester })).toEqual({ proceed: false, reason: 'feature_off' })
    expect(suggester).not.toHaveBeenCalled()
  })

  it('skips a product deleted or categorized while the job waited', async () => {
    const deleted = buildContainer({ productCount: 0 })
    const categorized = buildContainer({ assignmentCount: 1 })
    const suggester: jest.MockedFunction<ProductSuggester> = jest.fn()
    expect(await runOnCreateSuggestion({ container: deleted.container, payload, suggester })).toEqual({
      proceed: false,
      reason: 'product_not_found',
    })
    expect(await runOnCreateSuggestion({ container: categorized.container, payload, suggester })).toEqual({
      proceed: false,
      reason: 'already_categorized',
    })
    expect(suggester).not.toHaveBeenCalled()
  })

  it('does not throw when the suggester fails', async () => {
    const { container } = buildContainer()
    const suggester: jest.MockedFunction<ProductSuggester> = jest.fn().mockRejectedValue(new Error('boom'))
    await expect(runOnCreateSuggestion({ container, payload, suggester })).resolves.toEqual({
      proceed: true,
      outcome: 'internal_error',
    })
  })

  it('reports provider error codes without throwing', async () => {
    const { container } = buildContainer()
    const suggester: jest.MockedFunction<ProductSuggester> = jest.fn(async () => ({ outcome: 'error' as const, code: 'rate_limited' }))
    expect(await runOnCreateSuggestion({ container, payload, suggester })).toEqual({ proceed: true, outcome: 'rate_limited' })
  })
})

describe('on_create trigger', () => {
  it('is recognised as a job payload discriminator', () => {
    expect(isOnCreateJobPayload({ trigger: 'on_create', productId: 'p', scope: {} })).toBe(true)
    expect(isOnCreateJobPayload({ progressJobId: 'j', ids: [], scope: {} })).toBe(false)
    expect(isOnCreateJobPayload(null)).toBe(false)
  })

  it('never auto-applies, even in auto_apply mode with a confident suggestion', () => {
    expect(
      decideAutoApply({
        settings: { applyMode: 'auto_apply', autoApplyThreshold: 0.5 },
        trigger: 'on_create',
        suggestion: { outcome: 'suggested', categoryId: 'category-1', confidence: '1.0000', status: 'pending' },
      }),
    ).toEqual({ apply: false, reason: 'trigger_not_user_started' })
  })
})
