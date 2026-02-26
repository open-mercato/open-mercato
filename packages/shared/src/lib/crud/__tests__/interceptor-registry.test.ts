import {
  registerApiInterceptors,
  getInterceptorsForRoute,
  getApiInterceptors,
} from '../interceptor-registry'
import type { ApiInterceptor } from '../api-interceptor'

const GLOBAL_INTERCEPTORS_KEY = '__openMercatoApiInterceptors__'

function makeInterceptor(overrides: Partial<ApiInterceptor> & { id: string }): ApiInterceptor {
  return {
    targetRoute: '*',
    methods: ['GET'],
    ...overrides,
    before: overrides.before ?? (async () => ({ ok: true })),
  }
}

beforeEach(() => {
  delete (globalThis as Record<string, unknown>)[GLOBAL_INTERCEPTORS_KEY]
  registerApiInterceptors([])
})

describe('registerApiInterceptors', () => {
  it('stores entries and makes them retrievable via getApiInterceptors', () => {
    const interceptorA = makeInterceptor({ id: 'mod-a.hook-1', targetRoute: 'orders' })
    const interceptorB = makeInterceptor({ id: 'mod-b.hook-1', targetRoute: 'products' })

    registerApiInterceptors([
      { moduleId: 'mod-a', interceptors: [interceptorA] },
      { moduleId: 'mod-b', interceptors: [interceptorB] },
    ])

    const all = getApiInterceptors()
    expect(all).toHaveLength(2)
    expect(all.map((e) => e.interceptor.id)).toEqual(
      expect.arrayContaining(['mod-a.hook-1', 'mod-b.hook-1']),
    )
    expect(all[0].moduleId).toBeDefined()
  })
})

describe('getInterceptorsForRoute', () => {
  it('matches exact routes', () => {
    registerApiInterceptors([
      {
        moduleId: 'mod-a',
        interceptors: [
          makeInterceptor({ id: 'exact-match', targetRoute: 'example/todos', methods: ['GET'] }),
          makeInterceptor({ id: 'no-match', targetRoute: 'example/other', methods: ['GET'] }),
        ],
      },
    ])

    const result = getInterceptorsForRoute('example/todos', 'GET')
    expect(result).toHaveLength(1)
    expect(result[0].interceptor.id).toBe('exact-match')
  })

  it('matches wildcard * routes (catch-all)', () => {
    registerApiInterceptors([
      {
        moduleId: 'mod-a',
        interceptors: [
          makeInterceptor({ id: 'catch-all', targetRoute: '*', methods: ['POST'] }),
        ],
      },
    ])

    const result = getInterceptorsForRoute('any/route/here', 'POST')
    expect(result).toHaveLength(1)
    expect(result[0].interceptor.id).toBe('catch-all')
  })

  it('matches prefix wildcard routes (example/*)', () => {
    registerApiInterceptors([
      {
        moduleId: 'mod-a',
        interceptors: [
          makeInterceptor({ id: 'prefix-match', targetRoute: 'example/*', methods: ['GET'] }),
          makeInterceptor({ id: 'other-prefix', targetRoute: 'catalog/*', methods: ['GET'] }),
        ],
      },
    ])

    const todosResult = getInterceptorsForRoute('example/todos', 'GET')
    expect(todosResult).toHaveLength(1)
    expect(todosResult[0].interceptor.id).toBe('prefix-match')

    const tagsResult = getInterceptorsForRoute('example/tags', 'GET')
    expect(tagsResult).toHaveLength(1)
    expect(tagsResult[0].interceptor.id).toBe('prefix-match')

    const noMatchResult = getInterceptorsForRoute('other/path', 'GET')
    expect(noMatchResult).toHaveLength(0)
  })

  it('filters by HTTP method', () => {
    registerApiInterceptors([
      {
        moduleId: 'mod-a',
        interceptors: [
          makeInterceptor({ id: 'get-only', targetRoute: '*', methods: ['GET'] }),
          makeInterceptor({ id: 'post-only', targetRoute: '*', methods: ['POST'] }),
          makeInterceptor({ id: 'multi', targetRoute: '*', methods: ['GET', 'POST'] }),
        ],
      },
    ])

    const getResult = getInterceptorsForRoute('anything', 'GET')
    expect(getResult.map((e) => e.interceptor.id)).toEqual(
      expect.arrayContaining(['get-only', 'multi']),
    )
    expect(getResult.map((e) => e.interceptor.id)).not.toContain('post-only')

    const postResult = getInterceptorsForRoute('anything', 'POST')
    expect(postResult.map((e) => e.interceptor.id)).toEqual(
      expect.arrayContaining(['post-only', 'multi']),
    )
    expect(postResult.map((e) => e.interceptor.id)).not.toContain('get-only')
  })

  it('handles case-insensitive method matching', () => {
    registerApiInterceptors([
      {
        moduleId: 'mod-a',
        interceptors: [
          makeInterceptor({ id: 'get-hook', targetRoute: '*', methods: ['GET'] }),
        ],
      },
    ])

    const result = getInterceptorsForRoute('anything', 'get')
    expect(result).toHaveLength(1)
    expect(result[0].interceptor.id).toBe('get-hook')
  })
})

describe('priority sorting', () => {
  it('returns results sorted by priority (higher first)', () => {
    registerApiInterceptors([
      {
        moduleId: 'mod-a',
        interceptors: [
          makeInterceptor({ id: 'low', targetRoute: '*', methods: ['GET'], priority: 10 }),
          makeInterceptor({ id: 'high', targetRoute: '*', methods: ['GET'], priority: 100 }),
          makeInterceptor({ id: 'medium', targetRoute: '*', methods: ['GET'], priority: 50 }),
          makeInterceptor({ id: 'default', targetRoute: '*', methods: ['GET'] }),
        ],
      },
    ])

    const result = getInterceptorsForRoute('test', 'GET')
    expect(result.map((e) => e.interceptor.id)).toEqual(['high', 'medium', 'low', 'default'])
  })
})

describe('priority collision warning', () => {
  it('logs a warning when interceptors share the same priority on the same route', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})

    registerApiInterceptors([
      {
        moduleId: 'mod-a',
        interceptors: [
          makeInterceptor({ id: 'hook-a', targetRoute: 'orders', methods: ['GET'], priority: 10 }),
          makeInterceptor({ id: 'hook-b', targetRoute: 'orders', methods: ['GET'], priority: 10 }),
        ],
      },
    ])

    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('same priority (10)'),
    )
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('hook-a'),
    )
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('hook-b'),
    )

    warnSpy.mockRestore()
  })

  it('does not warn when interceptors have different priorities', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})

    registerApiInterceptors([
      {
        moduleId: 'mod-a',
        interceptors: [
          makeInterceptor({ id: 'hook-a', targetRoute: 'orders', methods: ['GET'], priority: 10 }),
          makeInterceptor({ id: 'hook-b', targetRoute: 'orders', methods: ['GET'], priority: 20 }),
        ],
      },
    ])

    expect(warnSpy).not.toHaveBeenCalled()

    warnSpy.mockRestore()
  })
})
