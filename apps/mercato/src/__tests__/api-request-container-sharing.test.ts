import { NextRequest } from 'next/server'
import type { ApiRouteManifestEntry, HttpMethod } from '@open-mercato/shared/modules/registry'
import { getRequestScopeStats, type RequestScopeStats } from '@open-mercato/shared/lib/di/request-scope'

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

const seenDuringHandler: Array<RequestScopeStats | null> = []
const seenAfterResponse: Array<RequestScopeStats | null> = []
let afterResponseRecorded: Promise<void> = Promise.resolve()

const recordingHandler = async () => {
  seenDuringHandler.push(getRequestScopeStats())
  afterResponseRecorded = new Promise<void>((resolve) => {
    setImmediate(() => {
      seenAfterResponse.push(getRequestScopeStats())
      resolve()
    })
  })
  return new Response('ok', { status: 200 })
}

const throwingHandler = async () => {
  seenDuringHandler.push(getRequestScopeStats())
  throw new Error('[internal] boom')
}

function getMockedApiRoutes(): ApiRouteManifestEntry[] {
  const publicMeta = { metadata: { GET: { requireAuth: false } } }
  return [
    { moduleId: 'scope', kind: 'route-file', path: '/scope/record', methods: ['GET'], load: async () => ({ GET: recordingHandler, ...publicMeta }) },
    { moduleId: 'scope', kind: 'route-file', path: '/scope/boom', methods: ['GET'], load: async () => ({ GET: throwingHandler, ...publicMeta }) },
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
registerModules([{ id: 'scope' }] as never)

import { GET } from '@/app/api/[...slug]/route'

const ORIGINAL_MEMO = process.env.OM_REQUEST_CONTAINER_MEMO

function callRoute(name: 'record' | 'boom') {
  return GET(new NextRequest(`http://localhost/api/scope/${name}`, { method: 'GET' }), {
    params: Promise.resolve({ slug: ['scope', name] }),
  })
}

beforeEach(() => {
  seenDuringHandler.length = 0
  seenAfterResponse.length = 0
})

afterAll(() => {
  if (ORIGINAL_MEMO === undefined) delete process.env.OM_REQUEST_CONTAINER_MEMO
  else process.env.OM_REQUEST_CONTAINER_MEMO = ORIGINAL_MEMO
})

describe('API dispatcher request container sharing', () => {
  it('runs the handler in a request scope that does not share containers by default', async () => {
    delete process.env.OM_REQUEST_CONTAINER_MEMO
    const response = await callRoute('record')
    await afterResponseRecorded

    expect(response.status).toBe(200)
    expect(seenDuringHandler).toEqual([expect.objectContaining({ shareContainer: false })])
    expect(seenAfterResponse).toEqual([expect.objectContaining({ shareContainer: false })])
  })

  it('shares the container during the handler when OM_REQUEST_CONTAINER_MEMO is on, and stops once the response settles', async () => {
    process.env.OM_REQUEST_CONTAINER_MEMO = 'on'
    const response = await callRoute('record')
    await afterResponseRecorded

    expect(response.status).toBe(200)
    expect(seenDuringHandler).toEqual([expect.objectContaining({ shareContainer: true })])
    expect(seenAfterResponse).toEqual([expect.objectContaining({ shareContainer: false })])
    expect(getRequestScopeStats()).toBeNull()
  })

  it('opens a scope for a handler that throws and leaves none behind', async () => {
    process.env.OM_REQUEST_CONTAINER_MEMO = 'on'
    await expect(callRoute('boom')).rejects.toThrow('boom')

    expect(seenDuringHandler).toEqual([expect.objectContaining({ shareContainer: true })])
    expect(getRequestScopeStats()).toBeNull()
  })
})
