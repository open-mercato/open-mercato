import { asFunction, asValue } from 'awilix'
import type { AppContainer } from '../container'
import { asScopedService, defineProcessDiRegistrar, registerCallerSetup } from '../process-registrar'

let forkCount = 0
const mockOrm = { em: { fork: jest.fn(() => ({ forkNumber: ++forkCount })) } }
const mockOverrides: Record<string, unknown> = {}
const mockActivate = jest.fn()
const mockBootstrap = jest.fn(async (container: AppContainer) => {
  container.register({ eventBus: asValue({ emit: jest.fn() }) })
})
const mockProcessBootstrap = jest.fn(async (container: AppContainer) => {
  container.register({
    eventBus: asScopedService((caller) => ({ resolve: caller.resolve.bind(caller), emit: jest.fn() })),
  })
  return mockActivate
})

jest.mock('@open-mercato/shared/lib/db/mikro', () => ({ getOrm: jest.fn(async () => mockOrm) }))
jest.mock('@mikro-orm/core', () => ({ RequestContext: { getEntityManager: () => null } }))
jest.mock('@open-mercato/shared/lib/query/engine', () => ({
  BasicQueryEngine: class { constructor(readonly em: unknown) {} },
}))
jest.mock('@open-mercato/shared/lib/data/engine', () => ({
  DefaultDataEngine: class { constructor(readonly em: unknown, readonly container: unknown) {} },
}))
jest.mock('@open-mercato/shared/lib/commands', () => ({ commandRegistry: {}, CommandBus: class {} }))
jest.mock('@open-mercato/core/bootstrap', () => ({
  bootstrap: (container: AppContainer) => mockBootstrap(container),
  bootstrapProcessRoot: (container: AppContainer) => mockProcessBootstrap(container),
}), { virtual: true })
jest.mock('@open-mercato/shared/modules/overrides', () => ({
  composeDiOverrides: () => mockOverrides,
  applyDiOverridesToContainer: (container: { register: (registrations: Record<string, unknown>) => void }) => {
    container.register(Object.fromEntries(Object.entries(mockOverrides).map(([key, value]) => [key, asValue(value)])))
  },
}))
jest.mock('@open-mercato/shared/lib/encryption/subscriber', () => ({ registerTenantEncryptionSubscriber: jest.fn() }))

import {
  createRequestContainer,
  getProcessContainerStats,
  initializeProcessContainer,
  invalidateProcessContainer,
  registerAppDiRegistrar,
  registerDiRegistrars,
  resetBootstrapCache,
} from '../container'
import { runInRequestScope, runWithRequestScopeContainer, getRequestScopeContainer } from '../request-scope'

const originalEnvironment = {
  OM_PROCESS_CONTAINER_ROOT: process.env.OM_PROCESS_CONTAINER_ROOT,
  OM_BOOTSTRAP_CACHE: process.env.OM_BOOTSTRAP_CACHE,
  OM_CACHE_SINGLETON: process.env.OM_CACHE_SINGLETON,
  SEARCH_DISABLE_SINGLETON_CACHE: process.env.SEARCH_DISABLE_SINGLETON_CACHE,
}

beforeEach(() => {
  process.env.OM_PROCESS_CONTAINER_ROOT = 'on'
  process.env.OM_BOOTSTRAP_CACHE = 'off'
  process.env.OM_CACHE_SINGLETON = 'on'
  process.env.SEARCH_DISABLE_SINGLETON_CACHE = 'off'
  for (const key of Object.keys(mockOverrides)) delete mockOverrides[key]
  resetBootstrapCache()
  registerDiRegistrars([])
  registerAppDiRegistrar(null)
  forkCount = 0
  jest.clearAllMocks()
})

afterAll(() => {
  for (const [key, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  registerDiRegistrars([])
  registerAppDiRegistrar(null)
  resetBootstrapCache()
})

it('initializes one root for concurrent callers while preserving isolated services, engines and auth', async () => {
  const registrar = jest.fn((container: AppContainer) => container.register({
    service: asScopedService((caller) => ({ caller, auth: () => caller.resolve('auth') })),
  }))
  registerDiRegistrars([defineProcessDiRegistrar(registrar)])
  const baseline = getProcessContainerStats()
  const callers = await Promise.all(Array.from({ length: 20 }, () => createRequestContainer()))
  expect(registrar).toHaveBeenCalledTimes(1)
  expect(mockProcessBootstrap).toHaveBeenCalledTimes(1)
  expect(mockActivate).toHaveBeenCalledTimes(1)
  expect(new Set(callers.map((caller) => caller.resolve('em'))).size).toBe(20)
  for (const [index, caller] of callers.entries()) {
    caller.register({ auth: asValue({ orgId: `org-${index}` }) })
    expect(caller.resolve('service').caller).toBe(caller)
    expect(caller.resolve('service').auth()).toEqual({ orgId: `org-${index}` })
    expect(caller.resolve('queryEngine').em).toBe(caller.resolve('em'))
    expect(caller.resolve('dataEngine').em).toBe(caller.resolve('em'))
    expect(caller.resolve('eventBus').resolve('auth')).toEqual({ orgId: `org-${index}` })
  }
  expect(getProcessContainerStats()).toMatchObject({
    rootInitializations: baseline.rootInitializations + 1,
    registrarExecutions: baseline.registrarExecutions + 1,
    callerScopes: baseline.callerScopes + 20,
  })
})

it('never resolves scoped dependencies on the root, including through a singleton', async () => {
  registerDiRegistrars([defineProcessDiRegistrar((container) => {
    container.register({ unsafe: asFunction(({ em }) => ({ em })).proxy().singleton() })
  })])
  const root = await initializeProcessContainer()
  expect(() => root?.resolve('em')).toThrow('cannot be resolved from the process DI root')
  const caller = await createRequestContainer()
  expect(() => caller.resolve('unsafe')).toThrow('cannot be resolved from the process DI root')
})

it('preserves caller-local singleton registration overrides', async () => {
  const [first, second] = await Promise.all([createRequestContainer(), createRequestContainer()])
  first.register({ local: asFunction(() => ({ marker: 'first' })).singleton() })
  second.register({ local: asFunction(() => ({ marker: 'second' })).singleton() })
  expect(first.resolve('local')).toEqual({ marker: 'first' })
  expect(second.resolve('local')).toEqual({ marker: 'second' })
  expect(first.resolve('local')).not.toBe(second.resolve('local'))
})

it('uses the entire legacy builder for an unaudited module and preserves ordering', async () => {
  const first = jest.fn((container: AppContainer) => container.register({ order: asValue('first') }))
  const last = jest.fn((container: AppContainer) => {
    expect(container.resolve('order')).toBe('first')
    container.register({ order: asValue('last') })
  })
  registerDiRegistrars([first, defineProcessDiRegistrar(last)])
  const callers = await Promise.all([createRequestContainer(), createRequestContainer()])
  expect(first).toHaveBeenCalledTimes(2)
  expect(last).toHaveBeenCalledTimes(2)
  expect(mockProcessBootstrap).not.toHaveBeenCalled()
  expect(callers.map((caller) => caller.resolve('order'))).toEqual(['last', 'last'])
  expect(getProcessContainerStats().compatibilityReason).toContain('module registrar')
})

it('keeps unaudited app hooks and module overrides on the legacy path', async () => {
  const app = jest.fn(async (container: AppContainer) => container.register({ marker: asValue('app') }))
  registerAppDiRegistrar(app)
  mockOverrides.marker = 'override'
  const caller = await createRequestContainer()
  expect(caller.resolve('marker')).toBe('override')
  expect(app).toHaveBeenCalledTimes(1)
  expect(mockProcessBootstrap).not.toHaveBeenCalled()
})

it('invalidates on override changes and recovers the optimized path after removal', async () => {
  const firstRoot = await initializeProcessContainer()
  mockOverrides.marker = 'legacy'
  expect(await initializeProcessContainer()).toBeNull()
  delete mockOverrides.marker
  const nextRoot = await initializeProcessContainer()
  expect(nextRoot).not.toBe(firstRoot)
  expect(mockProcessBootstrap).toHaveBeenCalledTimes(2)
})

it('retries a failed root without publishing partial services', async () => {
  const registrar = jest.fn(() => {})
  registrar.mockImplementationOnce(() => { throw new Error('[internal] initialization failed') })
  registerDiRegistrars([defineProcessDiRegistrar(registrar)])
  await expect(createRequestContainer()).rejects.toThrow('initialization failed')
  expect(mockActivate).not.toHaveBeenCalled()
  await expect(createRequestContainer()).resolves.toBeDefined()
  expect(registrar).toHaveBeenCalledTimes(2)
  expect(mockActivate).toHaveBeenCalledTimes(1)
})

it('does not publish an obsolete initialization and retains existing callers across invalidation', async () => {
  let release: () => void = () => {}
  const blocked = new Promise<void>((resolve) => { release = resolve })
  registerAppDiRegistrar(defineProcessDiRegistrar(async () => blocked))
  const pending = initializeProcessContainer()
  await new Promise((resolve) => setImmediate(resolve))
  registerAppDiRegistrar(null)
  const current = await initializeProcessContainer()
  release()
  expect(await pending).toBe(current)
  expect(mockActivate).toHaveBeenCalledTimes(1)
  const oldCaller = await createRequestContainer()
  const oldEm = oldCaller.resolve('em')
  invalidateProcessContainer()
  const newCaller = await createRequestContainer()
  expect(oldCaller.resolve('em')).toBe(oldEm)
  expect(newCaller.resolve('em')).not.toBe(oldEm)
})

it('runs scope setup against the fully registered caller with exact execution ownership', async () => {
  const observed: AppContainer[] = []
  registerDiRegistrars([defineProcessDiRegistrar((root) => {
    registerCallerSetup(root, async (caller) => {
      await Promise.resolve()
      expect(getRequestScopeContainer()).toBe(caller)
      observed.push(caller)
    })
  })])
  await runInRequestScope(async () => {
    const first = await createRequestContainer()
    const second = await createRequestContainer()
    expect(observed).toEqual([first, second])
    await runWithRequestScopeContainer(first, async () => {
      await Promise.resolve()
      await createRequestContainer()
      expect(getRequestScopeContainer()).toBe(first)
    })
    expect(getRequestScopeContainer()).toBe(second)
  })
})

it('keeps the legacy path for explicit process infrastructure opt-outs', async () => {
  process.env.OM_CACHE_SINGLETON = 'off'
  expect(await initializeProcessContainer()).toBeNull()
  process.env.OM_CACHE_SINGLETON = 'on'
  process.env.SEARCH_DISABLE_SINGLETON_CACHE = '1'
  expect(await initializeProcessContainer()).toBeNull()
  expect(mockProcessBootstrap).not.toHaveBeenCalled()
})

it('preserves separate process and legacy registrar functions without probing', async () => {
  const legacy = jest.fn(() => {})
  const processRegistrar = jest.fn(() => {})
  registerDiRegistrars([defineProcessDiRegistrar(processRegistrar, { legacy })])
  await createRequestContainer()
  expect(processRegistrar).toHaveBeenCalledTimes(1)
  expect(legacy).not.toHaveBeenCalled()
  process.env.OM_PROCESS_CONTAINER_ROOT = 'off'
  await createRequestContainer()
  expect(legacy).toHaveBeenCalledTimes(1)
})


it('does not replay the unsafe old bootstrap cache in process-root compatibility mode', async () => {
  process.env.OM_BOOTSTRAP_CACHE = 'on'
  registerDiRegistrars([() => {}])
  await createRequestContainer()
  await createRequestContainer()
  expect(mockBootstrap).toHaveBeenCalledTimes(2)
  expect(mockProcessBootstrap).not.toHaveBeenCalled()
})

it('cleans unpublished generation-owned instances when activation fails and retries', async () => {
  const dispose = jest.fn()
  registerDiRegistrars([defineProcessDiRegistrar((root) => {
    root.register({ generationState: asFunction(() => ({})).singleton().disposer(dispose) })
    root.resolve('generationState')
  })])
  mockActivate.mockImplementationOnce(() => { throw new Error('[internal] activation failed') })
  await expect(initializeProcessContainer()).rejects.toThrow('activation failed')
  expect(dispose).toHaveBeenCalledTimes(1)
  await expect(initializeProcessContainer()).resolves.toBeDefined()
  expect(dispose).toHaveBeenCalledTimes(1)
})
