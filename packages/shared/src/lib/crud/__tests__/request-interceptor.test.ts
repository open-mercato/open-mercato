import type { ApiInterceptor, InterceptorContext, InterceptorRequest } from '../api-interceptor'
import { getApiInterceptorsForRoute, registerApiInterceptors } from '../interceptor-registry'
import { runApiInterceptorsBefore, runApiInterceptorsAfter } from '../interceptor-runner'
import { runInOwnedRequestScope, trackRequestScopeDisposal } from '../../di/request-scope'

const request: InterceptorRequest = { method: 'GET', url: 'http://localhost/api/sales/orders', headers: {} }
const context: InterceptorContext = {
  userId: 'staff-1', tenantId: 'tenant-1', organizationId: 'org-1',
  em: {} as InterceptorContext['em'],
  container: {} as InterceptorContext['container'],
  userFeatures: ['sales.*'],
  auth: { sub: 'staff-1', tenantId: 'tenant-1', orgId: 'org-1' },
}
const args = { routePath: 'sales/orders', method: 'GET' as const, request, context }

function register(interceptors: ApiInterceptor[]) {
  registerApiInterceptors([{ moduleId: 'example', interceptors }])
}

function admission(overrides: Partial<ApiInterceptor> = {}): ApiInterceptor {
  return {
    id: 'example.admission', targetRoute: '*', scope: 'request', methods: ['GET'],
    before: async () => ({ ok: false, statusCode: 403, message: 'test enrollment required' }),
    ...overrides,
  }
}

describe('request-scoped API admission', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    registerApiInterceptors([])
  })
  afterEach(() => {
    registerApiInterceptors([])
    jest.clearAllTimers()
    jest.useRealTimers()
  })

  test('keeps default route hooks isolated from request admission in both directions', async () => {
    const routeBefore = jest.fn(async () => ({ ok: true, query: { narrowed: true } }))
    const routeAfter = jest.fn(async () => ({ merge: { enriched: true } }))
    const requestBefore = jest.fn(admission().before)
    register([
      { id: 'example.route', targetRoute: 'sales/*', methods: ['GET'], before: routeBefore, after: routeAfter },
      admission({ before: requestBefore, after: async () => ({ replace: { unwanted: true } }) }),
    ])
    expect(getApiInterceptorsForRoute('sales/orders', 'GET').map((entry) => entry.interceptor.id)).toEqual(['example.route'])
    expect(getApiInterceptorsForRoute('sales/orders', 'GET', 'request').map((entry) => entry.interceptor.id)).toEqual(['example.admission'])
    expect(await runApiInterceptorsBefore(args)).toMatchObject({ ok: true, request: { query: { narrowed: true } } })
    expect(routeBefore).toHaveBeenCalledTimes(1)
    expect(requestBefore).not.toHaveBeenCalled()
    expect(await runApiInterceptorsBefore({ ...args, scope: 'request' })).toMatchObject({ ok: false, statusCode: 403 })
    expect(routeBefore).toHaveBeenCalledTimes(1)
    expect(requestBefore).toHaveBeenCalledTimes(1)
    expect(jest.getTimerCount()).toBe(0)
    expect(await runApiInterceptorsAfter({ ...args, response: { statusCode: 200, body: { ok: true }, headers: {} } }))
      .toMatchObject({ body: { ok: true, enriched: true } })
    expect(routeAfter).toHaveBeenCalledTimes(1)
  })

  test.each(['body', 'query', 'headers'] as const)('fails closed on a request-scoped %s rewrite', async (field) => {
    register([admission({ before: async () => ({ ok: true, [field]: { injected: true } }) })])
    expect(await runApiInterceptorsBefore({ ...args, scope: 'request' })).toMatchObject({ ok: false, statusCode: 500 })
  })

  test('preserves wildcard feature policy for scoped admission', async () => {
    const before = jest.fn(async () => ({ ok: false, statusCode: 403 }))
    register([admission({ features: ['sales.orders.manage'], before })])
    expect(await runApiInterceptorsBefore({ ...args, scope: 'request' })).toMatchObject({ ok: false, statusCode: 403 })
    expect(before).toHaveBeenCalledTimes(1)
  })

  test('fails closed on thrown admission errors', async () => {
    register([admission({ before: async () => { throw new Error('test admission unavailable') } })])
    expect(await runApiInterceptorsBefore({ ...args, scope: 'request' })).toMatchObject({ ok: false, statusCode: 500 })
  })

  test('fails closed when admission times out', async () => {
    register([admission({ timeoutMs: 20, before: () => new Promise(() => {}) })])
    const result = runApiInterceptorsBefore({ ...args, scope: 'request' })
    await jest.advanceTimersByTimeAsync(21)
    expect(await result).toMatchObject({ ok: false, statusCode: 504 })
  })

  test('keeps request resources owned while a timed-out admission hook settles', async () => {
    const dispose = jest.fn(async () => {})
    let finishHook: () => void = () => {}
    const hook = new Promise<{ ok: true }>((resolve) => {
      finishHook = () => resolve({ ok: true })
    })
    register([admission({ timeoutMs: 20, before: () => hook })])

    const pendingResponse = runInOwnedRequestScope(async () => {
      trackRequestScopeDisposal({ dispose })
      const result = await runApiInterceptorsBefore({ ...args, scope: 'request' })
      return Response.json(result, { status: result.ok ? 200 : result.statusCode })
    })
    await jest.advanceTimersByTimeAsync(21)
    const response = await pendingResponse
    expect(response.status).toBe(504)

    const body = response.json()
    await jest.advanceTimersByTimeAsync(0)
    expect(dispose).not.toHaveBeenCalled()
    finishHook()
    await body
    expect(dispose).toHaveBeenCalledTimes(1)
  })
})
