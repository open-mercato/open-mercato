import type { AwilixContainer } from 'awilix'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import {
  buildAiCategorizeCommandContext,
  categorizeProductsWithProgress,
  resolveAiCategorizeConcurrency,
} from '../bulkCategorize'
import type { ProductSuggester, ProductSuggestionOutcome } from '../suggestProduct'

const scope = { tenantId: 'tenant-1', organizationId: 'org-1', userId: 'user-1' }

function buildContainer(options: { effective?: boolean | boolean[]; cancelled?: boolean[] } = {}) {
  const progressService = {
    startJob: jest.fn().mockResolvedValue(undefined),
    updateProgress: jest.fn().mockResolvedValue(undefined),
    completeJob: jest.fn().mockResolvedValue(undefined),
    failJob: jest.fn().mockResolvedValue(undefined),
    markCancelled: jest.fn().mockResolvedValue(undefined),
    isCancellationRequested: jest.fn(),
  }
  const cancelled = [...(options.cancelled ?? [])]
  progressService.isCancellationRequested.mockImplementation(async () => cancelled.shift() ?? false)
  const effectiveQueue = Array.isArray(options.effective) ? [...options.effective] : null
  const getStatus = jest.fn(async () => ({
    effective: effectiveQueue ? (effectiveQueue.length > 1 ? effectiveQueue.shift()! : effectiveQueue[0]) : (options.effective ?? true),
  }))
  const container = {
    resolve: jest.fn((name: string) => {
      if (name === 'progressService') return progressService
      if (name === 'catalogCategorizationService') return { getStatus }
      return undefined
    }),
  } as unknown as AwilixContainer
  return { container, progressService, getStatus }
}

function scripted(outcomes: Array<ProductSuggestionOutcome | Error>): jest.MockedFunction<ProductSuggester> {
  const queue = [...outcomes]
  return jest.fn(async () => {
    const next = queue.shift() ?? { outcome: 'suggested' as const }
    if (next instanceof Error) throw next
    return next
  })
}

const noSleep = jest.fn().mockResolvedValue(undefined)

describe('categorizeProductsWithProgress', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('counts suggested, no_match and completes the job with a summary', async () => {
    const { container, progressService } = buildContainer()
    const suggester = scripted([{ outcome: 'suggested' }, { outcome: 'no_match' }])
    const summary = await categorizeProductsWithProgress({
      container,
      progressJobId: 'job-1',
      ids: ['p1', 'p2'],
      scope,
      deps: { suggester, sleep: noSleep },
    })
    expect(summary).toMatchObject({ processedCount: 2, suggestedCount: 1, noMatchCount: 1, failedCount: 0 })
    expect(progressService.completeJob).toHaveBeenCalledWith('job-1', { resultSummary: summary }, expect.anything())
    expect(progressService.failJob).not.toHaveBeenCalled()
  })

  it.each(['timeout', 'provider_error', 'invalid_response', 'unavailable', 'invalid_request', 'brand_new_code'])(
    'counts a %s error as failed and continues',
    async (code) => {
      const { container, progressService } = buildContainer()
      const suggester = scripted([{ outcome: 'error', code }, { outcome: 'suggested' }])
      const summary = await categorizeProductsWithProgress({
        container,
        progressJobId: 'job-1',
        ids: ['p1', 'p2'],
        scope,
        deps: { suggester, sleep: noSleep },
      })
      expect(summary.failedCount).toBe(1)
      expect(summary.failedItems).toEqual([{ productId: 'p1', code }])
      expect(summary.suggestedCount).toBe(1)
      expect(summary.processedCount).toBe(2)
      expect(progressService.completeJob).toHaveBeenCalled()
    },
  )

  it.each(['insufficient_credits', 'auth'])('fails the job fast on %s and keeps prior progress', async (code) => {
    const { container, progressService } = buildContainer()
    const suggester = scripted([{ outcome: 'suggested' }, { outcome: 'error', code }, { outcome: 'suggested' }])
    const summary = await categorizeProductsWithProgress({
      container,
      progressJobId: 'job-1',
      ids: ['p1', 'p2', 'p3'],
      scope,
      deps: { suggester, sleep: noSleep },
    })
    expect(suggester).toHaveBeenCalledTimes(2)
    expect(summary.suggestedCount).toBe(1)
    expect(summary.stoppedReason).toBe(code)
    expect(progressService.failJob).toHaveBeenCalledWith(
      'job-1',
      expect.objectContaining({ errorMessage: expect.stringContaining(code) }),
      expect.anything(),
    )
    expect(progressService.completeJob).not.toHaveBeenCalled()
  })

  it('retries rate_limited once after 2 s and succeeds', async () => {
    const { container } = buildContainer()
    const sleep = jest.fn().mockResolvedValue(undefined)
    const suggester = scripted([{ outcome: 'error', code: 'rate_limited' }, { outcome: 'suggested' }])
    const summary = await categorizeProductsWithProgress({
      container,
      progressJobId: 'job-1',
      ids: ['p1'],
      scope,
      deps: { suggester, sleep },
    })
    expect(sleep).toHaveBeenCalledWith(2000)
    expect(suggester).toHaveBeenCalledTimes(2)
    expect(summary).toMatchObject({ suggestedCount: 1, failedCount: 0 })
  })

  it('counts a product failed when rate_limited persists after the single retry, and continues', async () => {
    const { container } = buildContainer()
    const suggester = scripted([
      { outcome: 'error', code: 'rate_limited' },
      { outcome: 'error', code: 'rate_limited' },
      { outcome: 'suggested' },
    ])
    const summary = await categorizeProductsWithProgress({
      container,
      progressJobId: 'job-1',
      ids: ['p1', 'p2'],
      scope,
      deps: { suggester, sleep: noSleep },
    })
    expect(suggester).toHaveBeenCalledTimes(3)
    expect(summary).toMatchObject({ failedCount: 1, suggestedCount: 1, processedCount: 2 })
  })

  it('retries payload_too_large once with a minimal state, then reports the error', async () => {
    const { container } = buildContainer()
    const suggester = scripted([
      { outcome: 'error', code: 'payload_too_large' },
      { outcome: 'error', code: 'payload_too_large' },
    ])
    const summary = await categorizeProductsWithProgress({
      container,
      progressJobId: 'job-1',
      ids: ['p1'],
      scope,
      deps: { suggester, sleep: noSleep },
    })
    expect(suggester).toHaveBeenNthCalledWith(1, 'p1', undefined)
    expect(suggester).toHaveBeenNthCalledWith(2, 'p1', { minimalState: true })
    expect(summary.failedItems).toEqual([{ productId: 'p1', code: 'payload_too_large' }])
  })

  it('stops at the next product and completes early when the feature is switched off', async () => {
    const { container, progressService } = buildContainer({ effective: [true, false] })
    const suggester = scripted([{ outcome: 'suggested' }])
    const summary = await categorizeProductsWithProgress({
      container,
      progressJobId: 'job-1',
      ids: ['p1', 'p2', 'p3'],
      scope,
      deps: { suggester, sleep: noSleep },
    })
    expect(suggester).toHaveBeenCalledTimes(1)
    expect(summary).toMatchObject({ processedCount: 1, stoppedReason: 'feature_disabled' })
    expect(progressService.completeJob).toHaveBeenCalledWith('job-1', { resultSummary: summary }, expect.anything())
  })

  it('marks the job cancelled when cancellation is requested', async () => {
    const { container, progressService } = buildContainer({ cancelled: [false, true] })
    const suggester = scripted([{ outcome: 'suggested' }])
    const summary = await categorizeProductsWithProgress({
      container,
      progressJobId: 'job-1',
      ids: ['p1', 'p2'],
      scope,
      deps: { suggester, sleep: noSleep },
    })
    expect(summary.stoppedReason).toBe('cancelled')
    expect(progressService.markCancelled).toHaveBeenCalled()
    expect(progressService.completeJob).not.toHaveBeenCalled()
  })

  it('maps a thrown 409 suggestion_in_progress to a failed product and keeps going', async () => {
    const { container } = buildContainer()
    const suggester = scripted([
      new CrudHttpError(409, { code: 'suggestion_in_progress' }),
      new Error('boom'),
      { outcome: 'suggested' },
    ])
    const summary = await categorizeProductsWithProgress({
      container,
      progressJobId: 'job-1',
      ids: ['p1', 'p2', 'p3'],
      scope,
      deps: { suggester, sleep: noSleep },
    })
    expect(summary.failedItems).toEqual([
      { productId: 'p1', code: 'suggestion_in_progress' },
      { productId: 'p2', code: 'internal_error' },
    ])
    expect(summary.suggestedCount).toBe(1)
  })

  it('requires tenant, organization and user scope for the command context', () => {
    const container = {} as AwilixContainer
    expect(() => buildAiCategorizeCommandContext({ tenantId: 't', organizationId: 'o' }, container)).toThrow(
      /requires tenant, organization and user scope/,
    )
    expect(buildAiCategorizeCommandContext({ tenantId: 't', organizationId: 'o', userId: 'u' }, container).auth).toMatchObject({
      sub: 'u',
      tenantId: 't',
      orgId: 'o',
    })
  })

  it('defaults worker concurrency to 1 and honors a valid override', () => {
    expect(resolveAiCategorizeConcurrency(undefined)).toBe(1)
    expect(resolveAiCategorizeConcurrency('0')).toBe(1)
    expect(resolveAiCategorizeConcurrency('abc')).toBe(1)
    expect(resolveAiCategorizeConcurrency('4')).toBe(4)
  })
})
