import { NextRequest } from 'next/server'
import type { ApiRouteManifestEntry, HttpMethod } from '@open-mercato/shared/modules/registry'
import { registerRequestGate, unregisterRequestGate } from '@open-mercato/shared/lib/runtime/request-gate'

const mockEmit = jest.fn(async () => {})

jest.mock('@open-mercato/shared/modules/events', () => ({
  getGlobalEventBus: () => ({ emit: mockEmit }),
}))

jest.mock('@/bootstrap-api', () => ({
  bootstrap: jest.fn(),
  isBootstrapped: jest.fn(() => true),
}))

jest.mock('@/bootstrap', () => ({
  bootstrap: jest.fn(),
  isBootstrapped: jest.fn(() => true),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  resolveAuthFromRequestDetailed: jest.fn(async () => ({ auth: null, status: 'unauthenticated' })),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => ({ resolve: () => null }),
}))

const mockHandler = jest.fn(async () => new Response('ok', { status: 200 }))

function getMockedApiRoutes(): ApiRouteManifestEntry[] {
  return [
    {
      moduleId: 'gate',
      kind: 'route-file',
      path: '/gate/ok',
      methods: ['GET', 'POST'],
      load: async () => ({ GET: mockHandler, POST: mockHandler, metadata: { GET: { requireAuth: false }, POST: { requireAuth: false } } }),
    },
  ]
}

jest.mock('@/.mercato/generated/api-route-shards.generated', () => ({ apiRouteFacades: getMockedApiRoutes() }))
jest.mock('@/.mercato/generated/api-routes.generated', () => ({ apiRoutes: getMockedApiRoutes() }))
jest.mock('@/.mercato/generated/backend-routes.generated', () => ({ backendRoutes: [] }))

jest.mock('@open-mercato/shared/modules/registry', () => {
  const actual = jest.requireActual('@open-mercato/shared/modules/registry')
  return {
    ...actual,
    registerBackendRouteManifests: jest.fn(),
    findApiRouteManifestMatch: jest.fn((_routes: ApiRouteManifestEntry[], method: HttpMethod, pathname: string) => {
      const route = getMockedApiRoutes().find((entry) => entry.path === pathname && entry.methods.includes(method))
      return route ? { route, params: {} } : undefined
    }),
  }
})

import { registerModules } from '@open-mercato/shared/lib/i18n/server'
registerModules([{ id: 'gate' }] as never)

import { GET, POST } from '@/app/api/[...slug]/route'

const context = { params: Promise.resolve({ slug: ['gate', 'ok'] }) }

function request(method: string): NextRequest {
  return new NextRequest('http://localhost/api/gate/ok', { method })
}

afterEach(() => {
  unregisterRequestGate('test-gate')
  mockHandler.mockClear()
  mockEmit.mockClear()
})

describe('API dispatcher request gate', () => {
  it('dispatches unchanged when no gate is registered', async () => {
    const response = await GET(request('GET'), context)
    expect(response.status).toBe(200)
    expect(mockHandler).toHaveBeenCalledTimes(1)
  })

  it('short-circuits before route matching and emits requestCompleted with the gate status', async () => {
    const seen: Array<{ surface: string; pathname: string; method: string }> = []
    registerRequestGate({
      id: 'test-gate',
      evaluate: (ctx) => {
        seen.push({ surface: ctx.surface, pathname: ctx.pathname, method: ctx.method })
        return { response: Response.json({ code: 'MAINTENANCE_MODE' }, { status: 503 }) }
      },
    })
    const response = await POST(request('POST'), context)
    expect(response.status).toBe(503)
    expect(mockHandler).not.toHaveBeenCalled()
    expect(seen).toEqual([{ surface: 'api', pathname: '/api/gate/ok', method: 'POST' }])
    const completed = mockEmit.mock.calls.find((call) => (call as unknown[])[0] === 'application.request.completed') as unknown[] | undefined
    expect(completed?.[1]).toMatchObject({ status: 503, pathname: '/gate/ok' })
  })

  it('counts an admitted request in flight until the handler settles', async () => {
    let inflight = 0
    let observedDuringHandler = -1
    mockHandler.mockImplementationOnce(async () => {
      observedDuringHandler = inflight
      return new Response('ok', { status: 200 })
    })
    registerRequestGate({
      id: 'test-gate',
      evaluate: () => null,
      onAdmitted: () => {
        inflight += 1
        return () => { inflight -= 1 }
      },
    })
    const response = await GET(request('GET'), context)
    expect(response.status).toBe(200)
    expect(observedDuringHandler).toBe(1)
    expect(inflight).toBe(0)
  })
})
