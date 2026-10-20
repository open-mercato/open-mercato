import { NextRequest } from 'next/server'
import type { ApiRouteManifestEntry, HttpMethod } from '@open-mercato/shared/modules/registry'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import { getAmbientCausation, type CausationEnvelope } from '@open-mercato/shared/lib/causation/server'

const mockResolveAuth = jest.fn<Promise<{ auth: AuthContext; status: string }>, [Request]>()
const capturedEnvelopes: Array<CausationEnvelope | null> = []

jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: () => null,
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
  resolveAuthFromRequestDetailed: (request: Request) => mockResolveAuth(request),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => ({ resolve: () => null }),
}))

const captureHandler = async () => {
  capturedEnvelopes.push(getAmbientCausation())
  return new Response('ok', { status: 200 })
}

function getMockedApiRoutes(): ApiRouteManifestEntry[] {
  const publicMeta = { metadata: { GET: { requireAuth: false } } }
  return [
    { moduleId: 'cause', kind: 'route-file', path: '/cause/capture', methods: ['GET'], load: async () => ({ GET: captureHandler, ...publicMeta }) },
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
registerModules([{ id: 'cause' }] as never)

import { GET } from '@/app/api/[...slug]/route'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const HEADER_REQUEST_ID = '11111111-2222-4333-8444-555555555555'
const ORIGIN_CORRELATION_ID = '5b8f0a3e-2c1d-4e6f-9a7b-1c2d3e4f5a6b'
const SOURCE_LOG_ID = '9f8e7d6c-5b4a-4c3d-8e2f-1a0b9c8d7e6f'

async function dispatch(auth: AuthContext): Promise<CausationEnvelope | null> {
  mockResolveAuth.mockResolvedValueOnce({ auth, status: auth ? 'authenticated' : 'missing' })
  const request = new NextRequest('http://localhost/api/cause/capture', {
    method: 'GET',
    headers: { 'x-request-id': HEADER_REQUEST_ID },
  })
  const response = await GET(request, { params: Promise.resolve({ slug: ['cause', 'capture'] }) })
  expect(response.status).toBe(200)
  return capturedEnvelopes[capturedEnvelopes.length - 1] ?? null
}

beforeEach(() => {
  capturedEnvelopes.length = 0
  mockResolveAuth.mockReset()
})

describe('API dispatcher causation entry frame', () => {
  it('seeds a user entry frame for an interactive session', async () => {
    const envelope = await dispatch({ sub: 'user-1', tenantId: 'tenant-1', orgId: 'org-1' })

    expect(envelope?.frames).toEqual([{ kind: 'user' }])
    expect(envelope?.correlationId).toMatch(UUID_PATTERN)
    expect(envelope?.correlationId).not.toBe(HEADER_REQUEST_ID)
  })

  it('seeds an api_key entry frame for a regular API key', async () => {
    const envelope = await dispatch({
      sub: 'api_key:key-1',
      tenantId: 'tenant-1',
      orgId: null,
      isApiKey: true,
      keyId: 'key-1',
    })

    expect(envelope?.frames).toEqual([{ kind: 'api_key', id: 'key-1' }])
    expect(envelope?.correlationId).toMatch(UUID_PATTERN)
    expect(envelope?.correlationId).not.toBe(HEADER_REQUEST_ID)
  })

  it('continues the origin envelope carried by a loopback API key', async () => {
    const envelope = await dispatch({
      sub: 'api_key:key-loopback',
      tenantId: 'tenant-1',
      orgId: 'org-1',
      isApiKey: true,
      keyId: 'key-loopback',
      originCausation: {
        correlationId: ORIGIN_CORRELATION_ID,
        causedByLogId: SOURCE_LOG_ID,
        frames: [
          { kind: 'user' },
          { kind: 'business_rule', id: 'rule-1', ref: 'run-1' },
        ],
      },
    })

    expect(envelope).toEqual({
      correlationId: ORIGIN_CORRELATION_ID,
      causedByLogId: SOURCE_LOG_ID,
      frames: [
        { kind: 'user' },
        { kind: 'business_rule', id: 'rule-1', ref: 'run-1', meta: { viaKeyId: 'key-loopback' } },
      ],
    })
  })

  it('falls back to the api_key frame when the stored origin is unusable', async () => {
    const envelope = await dispatch({
      sub: 'api_key:key-broken',
      tenantId: 'tenant-1',
      orgId: null,
      isApiKey: true,
      keyId: 'key-broken',
      originCausation: { frames: 'garbage' } as unknown as CausationEnvelope,
    })

    expect(envelope?.frames).toEqual([{ kind: 'api_key', id: 'key-broken' }])
    expect(envelope?.correlationId).not.toBe(HEADER_REQUEST_ID)
  })

  it('ignores an origin envelope on a non API-key principal', async () => {
    const envelope = await dispatch({
      sub: 'user-2',
      tenantId: 'tenant-1',
      orgId: null,
      originCausation: {
        correlationId: ORIGIN_CORRELATION_ID,
        frames: [{ kind: 'workflow', id: 'instance-1' }],
      },
    })

    expect(envelope?.frames).toEqual([{ kind: 'user' }])
    expect(envelope?.correlationId).not.toBe(ORIGIN_CORRELATION_ID)
  })

  it('seeds an unknown entry frame for an unauthenticated request', async () => {
    const envelope = await dispatch(null)

    expect(envelope?.frames).toEqual([{ kind: 'unknown' }])
    expect(envelope?.correlationId).toMatch(UUID_PATTERN)
  })

  it('creates a fresh correlation per request and leaves no ambient causation behind', async () => {
    const first = await dispatch({ sub: 'user-1', tenantId: 'tenant-1', orgId: null })
    const second = await dispatch({ sub: 'user-1', tenantId: 'tenant-1', orgId: null })

    expect(first?.correlationId).not.toBe(second?.correlationId)
    expect(getAmbientCausation()).toBeNull()
  })
})
