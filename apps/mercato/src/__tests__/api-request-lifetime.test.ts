import { asFunction, asValue } from 'awilix'
import { NextRequest } from 'next/server'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import type { ApiRouteManifestEntry } from '@open-mercato/shared/modules/registry'
import { defineProcessDiRegistrar } from '@open-mercato/shared/lib/di/process-registrar'
import { createRequestContainer, invalidateProcessContainer, registerAppDiRegistrar, registerDiRegistrars } from '@open-mercato/shared/lib/di/container'
import { getRequestScopeContainer } from '@open-mercato/shared/lib/di/request-scope'

jest.mock('@/bootstrap-api', () => ({ bootstrap: jest.fn() }))
jest.mock('@open-mercato/shared/lib/db/mikro', () => ({ getOrm: async () => ({ em: { fork: () => ({}) } }) }))
jest.mock('@open-mercato/shared/lib/query/engine', () => ({ BasicQueryEngine: class {} }))
jest.mock('@open-mercato/shared/lib/data/engine', () => ({ DefaultDataEngine: class {} }))
jest.mock('@open-mercato/shared/lib/commands', () => ({ commandRegistry: {}, CommandBus: class {} }))
jest.mock('@open-mercato/shared/modules/overrides', () => ({ ...jest.requireActual('@open-mercato/shared/modules/overrides'), composeDiOverrides: () => ({}) }))
jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  resolveAuthFromRequestDetailed: async () => ({ auth: { sub: 'staff', tenantId: 'tenant' }, status: 'authenticated' }),
}))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({ resolveTranslations: async () => ({ t: (_key: string, fallback: string) => fallback }) }))
jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveFeatureCheckContext: async () => ({ organizationId: 'org', scope: { tenantId: 'tenant' } }),
}))
jest.mock('@open-mercato/core/bootstrap', () => ({
  bootstrapProcessRoot: async (root: AppContainer) => {
    root.register({ eventBus: asValue({ emit: async () => {} }) })
    return () => {}
  },
  finalizeProcessRoot: async () => {},
  getCachedRateLimiterService: () => null,
}))
jest.mock('@open-mercato/shared/modules/events', () => ({ getGlobalEventBus: () => null }))
jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({ getTelemetryRuntime: () => undefined }))
jest.mock('@/.mercato/generated/api-route-shards.generated', () => ({ apiRouteFacades: [] }), { virtual: true })

const mockHandler = jest.fn<Promise<Response>, []>()
const mockRbac = { userHasAllFeatures: jest.fn(async () => true), loadAcl: async () => ({ features: [], organizations: [] }) }
jest.mock('@open-mercato/shared/modules/registry', () => ({
  ...jest.requireActual('@open-mercato/shared/modules/registry'),
  findApiRouteManifestMatch: () => ({
    route: {
      moduleId: 'probe', kind: 'route-file', path: '/probe', methods: ['GET'],
      load: async () => ({ GET: mockHandler, metadata: { GET: { requireAuth: true, requireFeatures: ['probe.read'] } } }),
    } satisfies ApiRouteManifestEntry,
    params: {},
  }),
}))

import { GET } from '@/app/api/[...slug]/route'

const originalFlag = process.env.OM_PROCESS_CONTAINER_ROOT
const mockRootDispose = jest.fn()
let ownedScopes: AppContainer[] = []

beforeEach(() => {
  process.env.OM_PROCESS_CONTAINER_ROOT = 'on'
  invalidateProcessContainer()
  mockRootDispose.mockClear()
  mockRbac.userHasAllFeatures.mockResolvedValue(true)
  ownedScopes = []
  registerDiRegistrars([defineProcessDiRegistrar((root) => {
    root.register({
      generationResource: asFunction(() => ({})).singleton().disposer(mockRootDispose),
      rbacService: asValue(mockRbac),
    })
    root.resolve('generationResource')
  })])
  registerAppDiRegistrar(defineProcessDiRegistrar(() => {}))
  mockHandler.mockImplementation(async () => {
    const caller = await createRequestContainer()
    ownedScopes.push(caller, caller.createScope())
    return new Response('ok', { status: 201, headers: { 'set-cookie': 'probe=present; Path=/', 'x-probe': 'retained' } })
  })
})

afterEach(async () => {
  invalidateProcessContainer()
  await new Promise((resolve) => setImmediate(resolve))
})
afterAll(() => {
  if (originalFlag === undefined) delete process.env.OM_PROCESS_CONTAINER_ROOT
  else process.env.OM_PROCESS_CONTAINER_ROOT = originalFlag
})

function request() {
  return GET(new NextRequest('http://localhost/api/probe'), { params: Promise.resolve({ slug: ['probe'] }) })
}

it('owns lifecycle, authorization and nested handler scopes through response consumption', async () => {
  const response = await request()
  invalidateProcessContainer()
  expect(mockRootDispose).not.toHaveBeenCalled()
  expect(mockRbac.userHasAllFeatures).toHaveBeenCalledTimes(1)
  expect(response.status).toBe(201)
  expect(response.headers.get('set-cookie')).toBe('probe=present; Path=/')
  expect(response.headers.get('x-probe')).toBe('retained')
  expect(await response.text()).toBe('ok')
  expect(mockRootDispose).toHaveBeenCalledTimes(1)
  await Promise.all(ownedScopes.map((scope) => scope.dispose()))
  expect(mockRootDispose).toHaveBeenCalledTimes(1)
})

it('releases acquired authorization scopes when authorization denies the request', async () => {
  mockRbac.userHasAllFeatures.mockResolvedValueOnce(false)
  const response = await request()
  expect(response.status).toBe(403)
  invalidateProcessContainer()
  await response.text()
  expect(mockRootDispose).toHaveBeenCalledTimes(1)
})

it('releases all acquired scopes when a handler throws', async () => {
  const failure = new Error('[internal] handler failed')
  mockHandler.mockImplementationOnce(async () => {
    await createRequestContainer()
    invalidateProcessContainer()
    throw failure
  })
  await expect(request()).rejects.toBe(failure)
  expect(mockRootDispose).toHaveBeenCalledTimes(1)
})

it.each(['cancel', 'error'] as const)('keeps stream event context and releases scopes on %s', async (ending) => {
  let source!: ReadableStreamDefaultController<Uint8Array>
  let emittingScope: AppContainer | undefined
  const cancelled = jest.fn()
  mockHandler.mockImplementationOnce(async () => {
    emittingScope = await createRequestContainer()
    return new Response(new ReadableStream<Uint8Array>({
      start: (controller) => { source = controller },
      pull: async () => {
        expect(getRequestScopeContainer()?.resolve('generationResource')).toBe(emittingScope!.resolve('generationResource'))
        await createRequestContainer()
      },
      cancel: cancelled,
    }, { highWaterMark: 0 }))
  })
  const response = await request()
  invalidateProcessContainer()
  const reader = response.body!.getReader()
  const reading = reader.read()
  await new Promise((resolve) => setImmediate(resolve))
  expect(mockRootDispose).not.toHaveBeenCalled()
  if (ending === 'cancel') {
    await reader.cancel('client disconnected')
    await reading
    expect(cancelled).toHaveBeenCalledWith('client disconnected')
  } else {
    const failure = new Error('[internal] stream failed')
    source.error(failure)
    await expect(reading).rejects.toBe(failure)
  }
  expect(mockRootDispose).toHaveBeenCalledTimes(1)
})
