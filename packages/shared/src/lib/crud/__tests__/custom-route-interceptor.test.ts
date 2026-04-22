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

  test('propagates timeout failures from interceptor runner', async () => {
    registerApiInterceptors([
      {
        moduleId: 'example',
        interceptors: [
          {
            id: 'example.auth.login.timeout',
            targetRoute: 'auth/login',
            methods: ['POST'],
            timeoutMs: 5,
            async after() {
              await new Promise((resolve) => setTimeout(resolve, 20))
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
