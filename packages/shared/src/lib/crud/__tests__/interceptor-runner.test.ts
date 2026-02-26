import type {
  InterceptorContext,
  InterceptorRequest,
  InterceptorResponse,
  InterceptorRegistryEntry,
} from '../api-interceptor'
import { runInterceptorsBefore, runInterceptorsAfter } from '../interceptor-runner'
import { getInterceptorsForRoute } from '../interceptor-registry'

jest.mock('../interceptor-registry', () => ({
  getInterceptorsForRoute: jest.fn(),
}))

jest.useFakeTimers()

const mockedGetInterceptorsForRoute = getInterceptorsForRoute as jest.MockedFunction<
  typeof getInterceptorsForRoute
>

const baseContext: InterceptorContext = {
  userId: 'user-1',
  organizationId: 'org-1',
  tenantId: 'tenant-1',
  em: {},
  container: {},
}

const baseRequest: InterceptorRequest = {
  method: 'POST',
  url: '/api/example/todos',
  body: { title: 'Test' },
  query: {},
  headers: { 'content-type': 'application/json' },
}

const baseResponse: InterceptorResponse = {
  statusCode: 200,
  body: { id: '1', title: 'Test' },
  headers: { 'content-type': 'application/json' },
}

function makeEntry(
  overrides: {
    id?: string
    before?: InterceptorRegistryEntry['interceptor']['before']
    after?: InterceptorRegistryEntry['interceptor']['after']
    priority?: number
    features?: string[]
    timeoutMs?: number
  } = {},
): InterceptorRegistryEntry {
  return {
    moduleId: 'test-module',
    interceptor: {
      id: overrides.id ?? 'test.interceptor',
      targetRoute: 'example/todos',
      methods: ['POST'],
      priority: overrides.priority ?? 0,
      features: overrides.features,
      timeoutMs: overrides.timeoutMs,
      before: overrides.before,
      after: overrides.after,
    },
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  jest.spyOn(console, 'warn').mockImplementation(() => {})
  jest.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  jest.runOnlyPendingTimers()
  jest.restoreAllMocks()
})

describe('runInterceptorsBefore', () => {
  it('returns ok: true when no interceptors match', async () => {
    mockedGetInterceptorsForRoute.mockReturnValue([])

    const result = await runInterceptorsBefore('example/todos', baseRequest, baseContext)

    expect(result).toEqual({ ok: true })
  })

  it('rejects when interceptor returns ok: false', async () => {
    mockedGetInterceptorsForRoute.mockReturnValue([
      makeEntry({
        id: 'reject-hook',
        before: async () => ({
          ok: false,
          message: 'Validation failed',
          statusCode: 422,
        }),
      }),
    ])

    const resultPromise = runInterceptorsBefore('example/todos', baseRequest, baseContext)
    jest.advanceTimersByTime(10000)
    const result = await resultPromise

    expect(result.ok).toBe(false)
    expect(result.message).toBe('Validation failed')
    expect(result.statusCode).toBe(422)
  })

  it('passes modified body to next interceptor in chain', async () => {
    const secondBeforeSpy = jest.fn(async (req: InterceptorRequest) => ({
      ok: true as const,
      body: { ...req.body, addedBySecond: true },
    }))

    mockedGetInterceptorsForRoute.mockReturnValue([
      makeEntry({
        id: 'first',
        priority: 100,
        before: async () => ({
          ok: true,
          body: { title: 'Modified by first' },
        }),
      }),
      makeEntry({
        id: 'second',
        priority: 50,
        before: secondBeforeSpy,
      }),
    ])

    const resultPromise = runInterceptorsBefore('example/todos', baseRequest, baseContext)
    jest.advanceTimersByTime(10000)
    const result = await resultPromise

    expect(result.ok).toBe(true)
    expect(secondBeforeSpy).toHaveBeenCalledWith(
      expect.objectContaining({ body: { title: 'Modified by first' } }),
      expect.anything(),
    )
    expect(result.body).toEqual({ title: 'Modified by first', addedBySecond: true })
  })

  it('accumulates metadata across interceptors', async () => {
    mockedGetInterceptorsForRoute.mockReturnValue([
      makeEntry({
        id: 'meta-a',
        priority: 100,
        before: async () => ({
          ok: true,
          metadata: { fromA: 'value-a' },
        }),
      }),
      makeEntry({
        id: 'meta-b',
        priority: 50,
        before: async () => ({
          ok: true,
          metadata: { fromB: 'value-b' },
        }),
      }),
    ])

    const resultPromise = runInterceptorsBefore('example/todos', baseRequest, baseContext)
    jest.advanceTimersByTime(10000)
    const result = await resultPromise

    expect(result.ok).toBe(true)
    expect(result.metadata).toEqual(
      expect.objectContaining({ fromA: 'value-a', fromB: 'value-b' }),
    )
  })

  it('returns 504 on timeout', async () => {
    mockedGetInterceptorsForRoute.mockReturnValue([
      makeEntry({
        id: 'slow-hook',
        timeoutMs: 50,
        before: () => new Promise((resolve) => setTimeout(() => resolve({ ok: true }), 200)),
      }),
    ])

    const resultPromise = runInterceptorsBefore('example/todos', baseRequest, baseContext)
    jest.advanceTimersByTime(100)
    const result = await resultPromise

    expect(result.ok).toBe(false)
    expect(result.statusCode).toBe(504)
  })

  it('returns 500 on crash (non-timeout error)', async () => {
    mockedGetInterceptorsForRoute.mockReturnValue([
      makeEntry({
        id: 'crashing-hook',
        before: async () => {
          throw new Error('Unexpected failure')
        },
      }),
    ])

    const resultPromise = runInterceptorsBefore('example/todos', baseRequest, baseContext)
    jest.advanceTimersByTime(10000)
    const result = await resultPromise

    expect(result.ok).toBe(false)
    expect(result.statusCode).toBe(500)
  })

  it('short-circuits on first rejection', async () => {
    const thirdBeforeSpy = jest.fn(async () => ({ ok: true as const }))

    mockedGetInterceptorsForRoute.mockReturnValue([
      makeEntry({
        id: 'pass',
        priority: 100,
        before: async () => ({ ok: true }),
      }),
      makeEntry({
        id: 'reject',
        priority: 50,
        before: async () => ({ ok: false, message: 'Blocked', statusCode: 403 }),
      }),
      makeEntry({
        id: 'never-reached',
        priority: 10,
        before: thirdBeforeSpy,
      }),
    ])

    const resultPromise = runInterceptorsBefore('example/todos', baseRequest, baseContext)
    jest.advanceTimersByTime(10000)
    const result = await resultPromise

    expect(result.ok).toBe(false)
    expect(result.message).toBe('Blocked')
    expect(thirdBeforeSpy).not.toHaveBeenCalled()
  })

  it('skips interceptors when user lacks required features', async () => {
    const gatedBeforeSpy = jest.fn(async () => ({
      ok: true as const,
      body: { gated: true },
    }))

    mockedGetInterceptorsForRoute.mockReturnValue([
      makeEntry({
        id: 'gated-hook',
        features: ['premium.export'],
        before: gatedBeforeSpy,
      }),
    ])

    const contextWithoutFeatures: InterceptorContext = {
      ...baseContext,
      userFeatures: ['basic.view'],
    }

    const result = await runInterceptorsBefore(
      'example/todos',
      baseRequest,
      contextWithoutFeatures,
    )

    expect(result).toEqual({ ok: true })
    expect(gatedBeforeSpy).not.toHaveBeenCalled()
  })
})

describe('runInterceptorsAfter', () => {
  it('returns empty object when no interceptors match', async () => {
    mockedGetInterceptorsForRoute.mockReturnValue([])

    const result = await runInterceptorsAfter(
      'example/todos',
      baseRequest,
      baseResponse,
      baseContext,
    )

    expect(result).toEqual({})
  })

  it('merges results with merge mode', async () => {
    mockedGetInterceptorsForRoute.mockReturnValue([
      makeEntry({
        id: 'merge-hook',
        after: async () => ({
          merge: { extraField: 'extra-value', score: 42 },
        }),
      }),
    ])

    const resultPromise = runInterceptorsAfter(
      'example/todos',
      baseRequest,
      baseResponse,
      baseContext,
    )
    jest.advanceTimersByTime(10000)
    const result = await resultPromise

    expect(result.merge).toEqual(
      expect.objectContaining({
        id: '1',
        title: 'Test',
        extraField: 'extra-value',
        score: 42,
      }),
    )
    expect(result.replace).toBeUndefined()
  })

  it('replaces results with replace mode', async () => {
    mockedGetInterceptorsForRoute.mockReturnValue([
      makeEntry({
        id: 'replace-hook',
        after: async () => ({
          replace: { completely: 'new-body' },
        }),
      }),
    ])

    const resultPromise = runInterceptorsAfter(
      'example/todos',
      baseRequest,
      baseResponse,
      baseContext,
    )
    jest.advanceTimersByTime(10000)
    const result = await resultPromise

    expect(result.replace).toEqual({ completely: 'new-body' })
    expect(result.merge).toBeUndefined()
  })

  it('tracks replace vs merge semantics correctly across multiple interceptors', async () => {
    mockedGetInterceptorsForRoute.mockReturnValue([
      makeEntry({
        id: 'merge-first',
        priority: 100,
        after: async () => ({
          merge: { addedByMerge: true },
        }),
      }),
      makeEntry({
        id: 'replace-second',
        priority: 50,
        after: async () => ({
          replace: { replacedAll: true },
        }),
      }),
    ])

    const resultPromise = runInterceptorsAfter(
      'example/todos',
      baseRequest,
      baseResponse,
      baseContext,
    )
    jest.advanceTimersByTime(10000)
    const result = await resultPromise

    expect(result.replace).toEqual({ replacedAll: true })
    expect(result.merge).toBeUndefined()
  })

  it('returns error result on interceptor crash', async () => {
    mockedGetInterceptorsForRoute.mockReturnValue([
      makeEntry({
        id: 'crash-after',
        after: async () => {
          throw new Error('After hook exploded')
        },
      }),
    ])

    const resultPromise = runInterceptorsAfter(
      'example/todos',
      baseRequest,
      baseResponse,
      baseContext,
    )
    jest.advanceTimersByTime(10000)
    const result = await resultPromise

    expect(result.replace).toBeDefined()
    expect(result.replace).toEqual(
      expect.objectContaining({
        error: 'Interceptor crash-after failed',
        _interceptorId: 'crash-after',
      }),
    )
  })
})
