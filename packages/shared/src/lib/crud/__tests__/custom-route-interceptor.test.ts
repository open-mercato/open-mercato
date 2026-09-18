import { registerApiInterceptors } from '@open-mercato/shared/lib/crud/interceptor-registry'
import { runCustomRouteAfterInterceptors } from '@open-mercato/shared/lib/crud/custom-route-interceptor'
import type { InterceptorContext } from '@open-mercato/shared/lib/crud/api-interceptor'

function buildArgs() {
  return {
    routePath: 'auth/login',
    method: 'POST' as const,
    request: {
      method: 'POST' as const,
      url: 'http://localhost/api/auth/login',
      headers: {},
      body: { email: 'user@example.com' },
    },
    response: {
      statusCode: 200,
      body: { ok: true, token: 'token-1', redirect: '/backend' },
      headers: { 'x-test': '1' },
    },
    context: {
      em: {} as InterceptorContext['em'],
      container: { resolve: jest.fn() } as unknown as InterceptorContext['container'],
    },
  }
}

describe('runCustomRouteAfterInterceptors', () => {
  beforeEach(() => {
    registerApiInterceptors([])
    jest.clearAllMocks()
  })

  test('returns unchanged response when no interceptor matches', async () => {
    const result = await runCustomRouteAfterInterceptors(buildArgs())

    expect(result).toEqual({
      ok: true,
      statusCode: 200,
      body: { ok: true, token: 'token-1', redirect: '/backend' },
      headers: { 'x-test': '1' },
    })
  })

  test('supports merge result from matching after interceptor', async () => {
    registerApiInterceptors([
      {
        moduleId: 'example',
        interceptors: [
          {
            id: 'example.auth.login.merge',
            targetRoute: 'auth/login',
            methods: ['POST'],
            async after() {
              return { merge: { mfa_required: true } }
            },
          },
        ],
      },
    ])

    const result = await runCustomRouteAfterInterceptors(buildArgs())
    expect(result.ok).toBe(true)
    expect(result.body).toEqual({
      ok: true,
      token: 'token-1',
      redirect: '/backend',
      mfa_required: true,
    })
  })

  test('supports replace result from matching after interceptor', async () => {
    registerApiInterceptors([
      {
        moduleId: 'example',
        interceptors: [
          {
            id: 'example.auth.login.replace',
            targetRoute: 'auth/login',
            methods: ['POST'],
            async after() {
              return { replace: { ok: true, mfa_required: true, challenge_id: 'c-1', token: 'pending' } }
            },
          },
        ],
      },
    ])

    const result = await runCustomRouteAfterInterceptors(buildArgs())
    expect(result.ok).toBe(true)
    expect(result.body).toEqual({
      ok: true,
      mfa_required: true,
      challenge_id: 'c-1',
      token: 'pending',
    })
  })

  test('applies headers returned by a matching after interceptor', async () => {
    registerApiInterceptors([
      {
        moduleId: 'example',
        interceptors: [
          {
            id: 'example.auth.login.headers',
            targetRoute: 'auth/login',
            methods: ['POST'],
            async after() {
              return { merge: { mfa_required: true }, headers: { 'set-cookie': 'om_example=1; Path=/' } }
            },
          },
        ],
      },
    ])

    const result = await runCustomRouteAfterInterceptors(buildArgs())

    expect(result.ok).toBe(true)
    // Seeded headers survive alongside the ones the interceptor added.
    expect(result.headers).toEqual({ 'x-test': '1', 'set-cookie': 'om_example=1; Path=/' })
    expect(result.body).toMatchObject({ mfa_required: true })
  })

  test('lets the last interceptor to run win a header collision, as the body merge does', async () => {
    // Interceptors run in descending priority, so the priority-1 entry runs last.
    registerApiInterceptors([
      {
        moduleId: 'example',
        interceptors: [
          {
            id: 'example.auth.login.headers.runs-last',
            targetRoute: 'auth/login',
            methods: ['POST'],
            priority: 1,
            async after() {
              return { headers: { 'x-test': 'runs-last' } }
            },
          },
          {
            id: 'example.auth.login.headers.runs-first',
            targetRoute: 'auth/login',
            methods: ['POST'],
            priority: 2,
            async after() {
              return { headers: { 'x-test': 'runs-first' } }
            },
          },
        ],
      },
    ])

    const result = await runCustomRouteAfterInterceptors(buildArgs())

    expect(result.headers['x-test']).toBe('runs-last')
  })

  test('propagates timeout failures from interceptor runner', async () => {
    registerApiInterceptors([
      {
        moduleId: 'example',
        interceptors: [
          {
            id: 'example.auth.login.timeout',
            targetRoute: 'auth/login',
            methods: ['POST'],
            timeoutMs: 10,
            async after() {
              await new Promise((resolve) => setTimeout(resolve, 500))
              return {}
            },
          },
        ],
      },
    ])

    const result = await runCustomRouteAfterInterceptors(buildArgs())
    expect(result.ok).toBe(false)
    expect(result.statusCode).toBe(504)
  })

  test('supports unauthenticated execution context defaults', async () => {
    const capturedContexts: Array<{ userId: string; organizationId: string; tenantId: string; userFeatures?: string[] }> = []
    registerApiInterceptors([
      {
        moduleId: 'example',
        interceptors: [
          {
            id: 'example.auth.login.capture-context',
            targetRoute: 'auth/login',
            methods: ['POST'],
            async after(_request, _response, context) {
              capturedContexts.push({
                userId: context.userId,
                organizationId: context.organizationId,
                tenantId: context.tenantId,
                userFeatures: context.userFeatures,
              })
              return {}
            },
          },
        ],
      },
    ])

    const result = await runCustomRouteAfterInterceptors(buildArgs())
    expect(result.ok).toBe(true)
    expect(capturedContexts).toEqual([
      {
        userId: '',
        organizationId: '',
        tenantId: '',
        userFeatures: [],
      },
    ])
  })

  // Header names are case-insensitive. Keying the merge on the exact string let
  // `{ 'X-Foo': 'a' }` and `{ 'x-foo': 'b' }` survive as two object keys, and `new Headers(obj)`
  // then APPENDS them into `x-foo: a, b` — a concatenation where the contract promises last-wins.
  test('resolves a header collision that differs only in case, as last-wins', async () => {
    registerApiInterceptors([
      {
        moduleId: 'example',
        interceptors: [
          {
            id: 'example.auth.login.header.upper',
            targetRoute: 'auth/login',
            methods: ['POST'],
            priority: 2,
            async after() {
              return { headers: { 'X-Foo': 'first' } }
            },
          },
          {
            id: 'example.auth.login.header.lower',
            targetRoute: 'auth/login',
            methods: ['POST'],
            priority: 1,
            async after() {
              return { headers: { 'x-foo': 'second' } }
            },
          },
        ],
      },
    ])

    const result = await runCustomRouteAfterInterceptors(buildArgs())
    expect(result.ok).toBe(true)
    expect(result.headers).toEqual({ 'x-test': '1', 'x-foo': 'second' })
    expect(new Headers(result.headers).get('x-foo')).toBe('second')
  })

  test('lower-cases a header name the route itself seeded', async () => {
    const args = buildArgs()
    args.response.headers = { 'X-Test': '1' }

    const result = await runCustomRouteAfterInterceptors(args)
    expect(result.headers).toEqual({ 'x-test': '1' })
  })

  // An invalid header does not throw here — it throws later, inside `new Headers()` at whichever
  // call site builds the response, where the route's own catch turns it into a generic 500 with
  // no interceptor id. Every other interceptor failure in this runner is attributed; this one is
  // now attributed too.
  test.each([
    ['an invalid header name', { 'x foo': 'v' }],
    ['a value carrying CRLF', { 'x-foo': 'a\r\nx-injected: 1' }],
  ])('fails with the runner\'s attributed error on %s', async (_label, headers) => {
    registerApiInterceptors([
      {
        moduleId: 'example',
        interceptors: [
          {
            id: 'example.auth.login.header.invalid',
            targetRoute: 'auth/login',
            methods: ['POST'],
            async after() {
              return { headers: headers as Record<string, string> }
            },
          },
        ],
      },
    ])

    const result = await runCustomRouteAfterInterceptors(buildArgs())
    expect(result.ok).toBe(false)
    expect(result.statusCode).toBe(500)
    expect(result.body.error).toBe('Internal interceptor error')
    expect(result.body.interceptorId).toBe('example.auth.login.header.invalid')
    // The bad header never reaches the response; the seeded ones survive for the failure path.
    expect(result.headers).toEqual({ 'x-test': '1' })
  })

  test('propagates interceptor exceptions as failed responses', async () => {
    registerApiInterceptors([
      {
        moduleId: 'example',
        interceptors: [
          {
            id: 'example.auth.login.throw',
            targetRoute: 'auth/login',
            methods: ['POST'],
            async after() {
              throw new Error('boom')
            },
          },
        ],
      },
    ])

    const result = await runCustomRouteAfterInterceptors(buildArgs())
    expect(result.ok).toBe(false)
    expect(result.statusCode).toBe(500)
    expect(result.body.error).toBe('Internal interceptor error')
  })
})
