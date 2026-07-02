import { NextRequest } from 'next/server'
import type { ApiRouteManifestEntry, HttpMethod } from '@open-mercato/shared/modules/registry'

// Telemetry is mocked so we can assert the dispatcher's wiring (reportError on
// 5xx + recordHttpDuration on every completed request) without a real backend.
// The semconv histogram shape recordHttpDuration emits is covered by the
// telemetry package's own nextjs tests; here we only verify the dispatcher
// calls it with the right method/route/status.
jest.mock('@open-mercato/telemetry', () => ({
  reportError: jest.fn(),
}))

jest.mock('@open-mercato/telemetry/nextjs', () => ({
  recordHttpDuration: jest.fn(),
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

// Three public routes: a 200, a 5xx (throws), and a returned 4xx.
const okHandler = async () => new Response('ok', { status: 200 })
const throwingHandler = async () => {
  throw new Error('boom')
}
const badRequestHandler = async () => new Response('bad', { status: 400 })

function getMockedApiRoutes(): ApiRouteManifestEntry[] {
  const publicMeta = { metadata: { GET: { requireAuth: false } } }
  return [
    { moduleId: 'tele', kind: 'route-file', path: '/tele/ok', methods: ['GET'], load: async () => ({ GET: okHandler, ...publicMeta }) },
    { moduleId: 'tele', kind: 'route-file', path: '/tele/boom', methods: ['GET'], load: async () => ({ GET: throwingHandler, ...publicMeta }) },
    { moduleId: 'tele', kind: 'route-file', path: '/tele/bad', methods: ['GET'], load: async () => ({ GET: badRequestHandler, ...publicMeta }) },
  ]
}

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

// resolveTranslations() runs early in the dispatcher and needs registered modules.
import { registerModules } from '@open-mercato/shared/lib/i18n/server'
registerModules([{ id: 'tele' }] as never)

import { reportError } from '@open-mercato/telemetry'
import { recordHttpDuration } from '@open-mercato/telemetry/nextjs'
import { GET } from '@/app/api/[...slug]/route'

const reportErrorMock = reportError as jest.MockedFunction<typeof reportError>
const recordHttpDurationMock = recordHttpDuration as jest.MockedFunction<typeof recordHttpDuration>

function request(path: string): NextRequest {
  return new NextRequest(`http://localhost/api${path}`, { method: 'GET' })
}

beforeEach(() => {
  reportErrorMock.mockClear()
  recordHttpDurationMock.mockClear()
})

describe('API dispatcher telemetry wiring', () => {
  it('reports a 5xx exception and emits a 500 duration metric, then re-throws', async () => {
    await expect(GET(request('/tele/boom'), { params: Promise.resolve({ slug: ['tele', 'boom'] }) })).rejects.toThrow('boom')

    expect(reportErrorMock).toHaveBeenCalledTimes(1)
    const [error, ctx] = reportErrorMock.mock.calls[0]
    expect((error as Error).message).toBe('boom')
    expect(ctx?.attributes).toMatchObject({
      'http.request.method': 'GET',
      'http.route': '/tele/boom',
      'http.response.status_code': 500,
    })

    expect(recordHttpDurationMock).toHaveBeenCalledTimes(1)
    const [method, route, status, startedAt] = recordHttpDurationMock.mock.calls[0]
    expect(method).toBe('GET')
    expect(route).toBe('/tele/boom')
    expect(status).toBe(500)
    expect(typeof startedAt).toBe('number')
  })

  it('does NOT report on a successful response, and emits the response status', async () => {
    const res = await GET(request('/tele/ok'), { params: Promise.resolve({ slug: ['tele', 'ok'] }) })
    expect(res.status).toBe(200)
    expect(reportErrorMock).not.toHaveBeenCalled()

    expect(recordHttpDurationMock).toHaveBeenCalledTimes(1)
    expect(recordHttpDurationMock).toHaveBeenCalledWith('GET', '/tele/ok', 200, expect.any(Number))
  })

  it('does NOT report a returned 4xx (only unhandled throws are 5xx)', async () => {
    const res = await GET(request('/tele/bad'), { params: Promise.resolve({ slug: ['tele', 'bad'] }) })
    expect(res.status).toBe(400)
    expect(reportErrorMock).not.toHaveBeenCalled()

    expect(recordHttpDurationMock).toHaveBeenCalledTimes(1)
    expect(recordHttpDurationMock).toHaveBeenCalledWith('GET', '/tele/bad', 400, expect.any(Number))
  })
})
