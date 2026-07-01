import { NextRequest } from 'next/server'
import type { ApiRouteManifestEntry, HttpMethod } from '@open-mercato/shared/modules/registry'

// Telemetry is mocked so we can assert the dispatcher's wiring (reportError on
// 5xx + the http.server.request.duration metric) without a real backend.
jest.mock('@open-mercato/telemetry', () => ({
  reportError: jest.fn(),
  histogram: jest.fn(),
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

import { reportError, histogram } from '@open-mercato/telemetry'
import { GET } from '@/app/api/[...slug]/route'

const reportErrorMock = reportError as jest.MockedFunction<typeof reportError>
const histogramMock = histogram as jest.MockedFunction<typeof histogram>

function request(path: string): NextRequest {
  return new NextRequest(`http://localhost/api${path}`, { method: 'GET' })
}

function durationCalls() {
  return histogramMock.mock.calls.filter((call) => call[0] === 'http.server.request.duration')
}

beforeEach(() => {
  reportErrorMock.mockClear()
  histogramMock.mockClear()
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

    const [name, value, attrs, unit] = durationCalls()[0]
    expect(name).toBe('http.server.request.duration')
    expect(typeof value).toBe('number')
    expect(attrs).toMatchObject({
      'http.request.method': 'GET',
      'http.route': '/tele/boom',
      'http.response.status_code': 500,
      'error.type': '500',
    })
    expect(unit).toBe('s')
  })

  it('does NOT report on a successful response, and emits the response status', async () => {
    const res = await GET(request('/tele/ok'), { params: Promise.resolve({ slug: ['tele', 'ok'] }) })
    expect(res.status).toBe(200)
    expect(reportErrorMock).not.toHaveBeenCalled()

    const attrs = durationCalls()[0]?.[2]
    expect(attrs).toMatchObject({ 'http.route': '/tele/ok', 'http.response.status_code': 200 })
    // A 2xx must not be labeled with error.type (semconv).
    expect(attrs?.['error.type']).toBeUndefined()
  })

  it('does NOT report a returned 4xx (only unhandled throws are 5xx)', async () => {
    const res = await GET(request('/tele/bad'), { params: Promise.resolve({ slug: ['tele', 'bad'] }) })
    expect(res.status).toBe(400)
    expect(reportErrorMock).not.toHaveBeenCalled()

    const attrs = durationCalls()[0]?.[2]
    expect(attrs).toMatchObject({ 'http.route': '/tele/bad', 'http.response.status_code': 400 })
    expect(attrs?.['error.type']).toBeUndefined()
  })
})
