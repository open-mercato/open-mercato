import { asFunction, asValue } from 'awilix'
import type { AppContainer } from '../container'
import { asScopedService, defineProcessDiRegistrar, registerCallerSetup, registerProcessActivation } from '../process-registrar'

let forkCount = 0
const mockOrm = { em: { fork: jest.fn(() => ({ forkNumber: ++forkCount })) } }
const mockOverrides: Record<string, unknown> = {}
const mockActivate = jest.fn()
const mockReportError = jest.fn()
const mockFinalizeProcessRoot = jest.fn(async (_container: AppContainer) => {})
const mockBootstrap = jest.fn(async (container: AppContainer) => {
  container.register({ eventBus: asValue({ emit: jest.fn() }) })
})
const mockProcessBootstrap = jest.fn(async (container: AppContainer) => {
  container.register({
    eventBus: asScopedService((caller) => ({ resolve: caller.resolve.bind(caller), emit: jest.fn() })),
  })
  return mockActivate
})

jest.mock('../../telemetry/runtime', () => ({ getTelemetryRuntime: () => ({ reportError: mockReportError }) }))

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
  finalizeProcessRoot: (container: AppContainer) => mockFinalizeProcessRoot(container),
}), { virtual: true })
jest.mock('@open-mercato/shared/modules/overrides', () => ({
  composeDiOverrides: () => mockOverrides,
  applyDiOverridesToContainer: (container: { register: (registrations: Record<string, unknown>) => void }) => {
    container.register(Object.fromEntries(Object.entries(mockOverrides).map(([key, value]) => [key, asValue(value)])))
  },
}))
jest.mock('@open-mercato/core/modules/query_index/lib/engine', () => ({ HybridQueryEngine: class {} }))
jest.mock('@open-mercato/shared/lib/indexers/error-log', () => ({ recordIndexerError: jest.fn() }))

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
  registerAppDiRegistrar(defineProcessDiRegistrar(() => {}))
  forkCount = 0
  jest.clearAllMocks()
})

afterAll(() => {
  for (const [key, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  registerDiRegistrars([])
  registerAppDiRegistrar(defineProcessDiRegistrar(() => {}))
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
    registrarExecutions: baseline.registrarExecutions + 2,
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
  const firstNested = first.createScope().createScope()
  const secondNested = second.createScope()
  firstNested.register({ nestedLocal: asFunction(() => ({ marker: 'first' })).singleton() })
  secondNested.register({ nestedLocal: asFunction(() => ({ marker: 'second' })).singleton() })
  expect(firstNested.resolve('nestedLocal')).toEqual({ marker: 'first' })
  expect(secondNested.resolve('nestedLocal')).toEqual({ marker: 'second' })
  expect(firstNested.resolve('em')).toBe(first.resolve('em'))
  expect(secondNested.resolve('em')).toBe(second.resolve('em'))
})

it('owns caller singletons across nested scopes and disposes them only with their owner', async () => {
  const [first, second] = await Promise.all([createRequestContainer(), createRequestContainer()])
  const disposeFirst = jest.fn()
  const disposeSecond = jest.fn()
  const disposeOverride = jest.fn()
  first.register({ local: asFunction(() => ({ marker: 'first' })).singleton().disposer(disposeFirst) })
  second.register({ local: asFunction(() => ({ marker: 'second' })).singleton().disposer(disposeSecond) })
  const nested = first.createScope()
  const symbolKey = Symbol('caller-local')
  first.register(symbolKey, asFunction(() => ({ marker: 'symbol' })).singleton())
  expect(nested.resolve(symbolKey)).toBe(first.resolve(symbolKey))
  second.register({ [symbolKey]: asFunction(() => ({ marker: 'other-symbol' })).singleton() })
  expect(second.resolve(symbolKey)).not.toBe(first.resolve(symbolKey))
  const inherited = nested.resolve('local')
  expect(first.resolve('local')).toBe(inherited)
  expect(nested.createScope().resolve('local')).toBe(inherited)
  expect(second.createScope().resolve('local')).toBe(second.resolve('local'))
  expect(second.resolve('local')).not.toBe(inherited)
  const overridden = first.createScope()
  overridden.register({ local: asFunction(() => ({ marker: 'override' })).singleton().disposer(disposeOverride) })
  expect(overridden.createScope().resolve('local')).toBe(overridden.resolve('local'))
  expect(overridden.resolve('local')).not.toBe(inherited)
  await nested.dispose()
  expect(disposeFirst).not.toHaveBeenCalled()
  await overridden.dispose()
  expect(disposeOverride).toHaveBeenCalledTimes(1)
  expect(disposeFirst).not.toHaveBeenCalled()
  await first.dispose()
  await first.dispose()
  expect(disposeFirst).toHaveBeenCalledTimes(1)
  expect(disposeFirst).toHaveBeenCalledWith(inherited)
  expect(disposeSecond).not.toHaveBeenCalled()
  await second.dispose()
  expect(disposeSecond).toHaveBeenCalledTimes(1)
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
  let releaseMiddle: () => void = () => {}
  const middleBlocked = new Promise<void>((resolve) => { releaseMiddle = resolve })
  registerAppDiRegistrar(defineProcessDiRegistrar(async () => middleBlocked))
  const middle = initializeProcessContainer()
  await new Promise((resolve) => setImmediate(resolve))
  registerAppDiRegistrar(defineProcessDiRegistrar(() => {}))
  const current = await initializeProcessContainer()
  releaseMiddle()
  release()
  expect(await pending).toBe(current)
  expect(await middle).toBe(current)
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

it('keeps a retired generation alive for a response stream until its owner cancels it', async () => {
  const disposed = jest.fn()
  registerDiRegistrars([defineProcessDiRegistrar((root) => {
    root.register({
      streamService: asScopedService((caller) => ({ auth: () => caller.resolve<string>('auth') })).disposer(disposed),
    })
  })])
  const caller = await createRequestContainer()
  caller.register('auth', asValue('original-caller'))
  const service = caller.resolve<{ auth: () => string }>('streamService')
  const response = new Response(new ReadableStream({
    pull(controller) { controller.enqueue(new TextEncoder().encode(service.auth())) },
    cancel: () => caller.dispose(),
  }))
  invalidateProcessContainer()
  const replacement = await createRequestContainer()
  replacement.register('auth', asValue('replacement-caller'))
  const reader = response.body!.getReader()
  expect(new TextDecoder().decode((await reader.read()).value)).toBe('original-caller')
  expect(disposed).not.toHaveBeenCalled()
  await reader.cancel()
  expect(disposed).toHaveBeenCalledTimes(1)
  expect(replacement.resolve('auth')).toBe('replacement-caller')
  await replacement.dispose()
  expect(disposed).toHaveBeenCalledTimes(1)
})


it('reports actual repeated registrar work on the disabled path', async () => {
  process.env.OM_PROCESS_CONTAINER_ROOT = 'off'
  registerDiRegistrars([defineProcessDiRegistrar(() => {})])
  const before = getProcessContainerStats()
  const callers = await Promise.all([createRequestContainer(), createRequestContainer()])
  expect(getProcessContainerStats().registrarExecutions - before.registrarExecutions).toBe(4)
  for (const caller of callers) await caller.dispose()
})


it('falls back for a module custom bus and preserves its real query-index CRUD bridge', async () => {
  const { register: registerQueryIndex } = await import('@open-mercato/core/modules/query_index/di')
  const subscriptions = new Map<string, (payload: unknown, context: unknown) => Promise<void>>()
  const customBus = {
    on: jest.fn((name: string, handler: (payload: unknown, context: unknown) => Promise<void>) => {
      subscriptions.set(name, handler)
    }),
    emitEvent: jest.fn(async () => {}),
  }
  const builder = {
    select: jest.fn(() => builder),
    distinct: jest.fn(() => builder),
    where: jest.fn(() => builder),
    execute: jest.fn(async () => [{ entity_id: 'customers:customer_person' }]),
    executeTakeFirst: jest.fn(async () => ({ id: 'custom-field' })),
  }
  const fork = mockOrm.em.fork.mockImplementation(() => ({
    forkNumber: ++forkCount,
    getKysely: () => ({ selectFrom: () => builder }),
  }))
  const activate = jest.fn()
  const customRegistrar = defineProcessDiRegistrar((root) => {
    root.register({ eventBus: asValue(customBus) })
    registerProcessActivation(root, activate)
  })
  registerDiRegistrars([customRegistrar, registerQueryIndex])
  try {
    const caller = await createRequestContainer()
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(getProcessContainerStats().compatibilityReason).toContain('custom event buses')
    expect(mockProcessBootstrap).not.toHaveBeenCalled()
    expect(activate).not.toHaveBeenCalled()
    expect(caller.resolve('eventBus')).toBe(customBus)
    const created = subscriptions.get('customers.customer_person.created')
    expect(created).toBeDefined()
    await created!({ id: 'person', tenantId: 'tenant', organizationId: 'org' }, {
      resolve: caller.resolve.bind(caller),
    })
    expect(customBus.emitEvent).toHaveBeenCalledWith('query_index.upsert_one', {
      entityType: 'customers:customer_person', recordId: 'person', tenantId: 'tenant', organizationId: 'org',
    })
    const initializations = getProcessContainerStats().rootInitializations
    await createRequestContainer()
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(getProcessContainerStats().rootInitializations).toBe(initializations)
    registerDiRegistrars([])
    expect(await initializeProcessContainer()).not.toBeNull()
    expect(getProcessContainerStats().compatibilityReason).toBeNull()
    expect(mockProcessBootstrap).toHaveBeenCalledTimes(1)
  } finally {
    fork.mockImplementation(() => ({ forkNumber: ++forkCount }))
  }
})

it('falls back when the app replaces the generation bus without publishing that generation', async () => {
  const customBus = { emit: jest.fn() }
  const activate = jest.fn()
  registerAppDiRegistrar(defineProcessDiRegistrar((root) => {
    root.register({ eventBus: asValue(customBus) })
    registerProcessActivation(root, activate)
  }))
  const caller = await createRequestContainer()
  expect(caller.resolve('eventBus')).toBe(customBus)
  expect(getProcessContainerStats().compatibilityReason).toContain('custom event buses')
  expect(mockActivate).not.toHaveBeenCalled()
  expect(activate).not.toHaveBeenCalled()
  expect(mockFinalizeProcessRoot).not.toHaveBeenCalled()
})


it.each([false, true])('disposes a failed caller and preserves its setup error when cleanup rejects: %s', async (cleanupRejects) => {
  const setupError = new Error('[internal] caller setup failed')
  const dispose = jest.fn(async () => {
    if (cleanupRejects) throw new Error('[internal] caller cleanup failed')
  })
  if (cleanupRejects) mockReportError.mockImplementationOnce(() => { throw new Error('[internal] telemetry unavailable') })
  let failSetup = true
  registerDiRegistrars([defineProcessDiRegistrar((root) => {
    root.register({ ownedResource: asScopedService(() => ({})).disposer(dispose) })
    registerCallerSetup(root, (caller) => {
      caller.resolve('ownedResource')
      if (failSetup) throw setupError
    })
  })])
  await expect(createRequestContainer()).rejects.toBe(setupError)
  expect(dispose).toHaveBeenCalledTimes(1)
  if (cleanupRejects) {
    expect(mockReportError).toHaveBeenCalledWith(expect.any(Error), {
      module: 'shared', code: 'shared.caller_initialization_cleanup_failed',
    })
  } else expect(mockReportError).not.toHaveBeenCalled()
  failSetup = false
  const caller = await createRequestContainer()
  expect(mockProcessBootstrap).toHaveBeenCalledTimes(1)
  expect(mockActivate).toHaveBeenCalledTimes(1)
  expect(dispose).toHaveBeenCalledTimes(1)
  if (cleanupRejects) await expect(caller.dispose()).rejects.toThrow('caller cleanup failed')
  else await caller.dispose()
  expect(dispose).toHaveBeenCalledTimes(2)
})

it('finalizes event setup after the app registrar and rejects unpublished generations on failure', async () => {
  const setupError = new Error('[internal] event setup failed')
  registerAppDiRegistrar(defineProcessDiRegistrar((root) => {
    root.register({ appDefinition: asValue('registered') })
  }))
  mockFinalizeProcessRoot.mockImplementationOnce(async (root) => {
    expect(root.resolve('appDefinition')).toBe('registered')
    throw setupError
  })
  await expect(createRequestContainer()).rejects.toBe(setupError)
  expect(mockActivate).not.toHaveBeenCalled()
  const caller = await createRequestContainer()
  expect(mockFinalizeProcessRoot).toHaveBeenCalledTimes(2)
  expect(mockActivate).toHaveBeenCalledTimes(1)
  await caller.dispose()
})


it.each(['registration', 'activation'] as const)('preserves the root %s failure when generation cleanup rejects and retries', async (phase) => {
  const initializationError = new Error(`[internal] ${phase} failed`)
  const cleanupError = new Error('[internal] root cleanup failed')
  const dispose = jest.fn(async () => { throw cleanupError })
  let failRegistration = phase === 'registration'
  registerDiRegistrars([defineProcessDiRegistrar((root) => {
    root.register({ generationState: asFunction(() => ({})).singleton().disposer(dispose) })
    root.resolve('generationState')
    if (failRegistration) throw initializationError
  })])
  if (phase === 'activation') mockActivate.mockImplementationOnce(() => { throw initializationError })
  await expect(initializeProcessContainer()).rejects.toBe(initializationError)
  expect(dispose).toHaveBeenCalledTimes(1)
  expect(mockReportError).toHaveBeenCalledWith(cleanupError, {
    module: 'shared', code: 'shared.root_initialization_cleanup_failed',
  })
  failRegistration = false
  await expect(initializeProcessContainer()).resolves.toBeDefined()
  expect(dispose).toHaveBeenCalledTimes(1)
  expect(mockProcessBootstrap).toHaveBeenCalledTimes(phase === 'registration' ? 1 : 2)
})

function registerRetirementProbe(dispose: () => Promise<void> | void) {
  registerDiRegistrars([defineProcessDiRegistrar((root) => {
    root.register({ generationResource: asFunction(() => ({})).singleton().disposer(dispose) })
    root.resolve('generationResource')
  })])
}

it('retires a published generation only after every caller releases it, exactly once', async () => {
  const dispose = jest.fn()
  registerRetirementProbe(dispose)
  const first = await createRequestContainer()
  const second = await createRequestContainer()
  invalidateProcessContainer()
  invalidateProcessContainer()
  expect(dispose).not.toHaveBeenCalled()
  const replacement = await createRequestContainer()
  await first.dispose()
  expect(dispose).not.toHaveBeenCalled()
  await Promise.all([second.dispose(), second.dispose()])
  expect(dispose).toHaveBeenCalledTimes(1)
  await first.dispose()
  expect(dispose).toHaveBeenCalledTimes(1)
  await replacement.dispose()
  expect(dispose).toHaveBeenCalledTimes(1)
})

it('disposes an unused published generation on invalidation and rebuilds after explicit root disposal', async () => {
  const dispose = jest.fn()
  registerRetirementProbe(dispose)
  const first = await initializeProcessContainer()
  invalidateProcessContainer()
  await first!.dispose()
  expect(dispose).toHaveBeenCalledTimes(1)
  const second = await initializeProcessContainer()
  await second!.dispose()
  expect(dispose).toHaveBeenCalledTimes(2)
  const caller = await createRequestContainer()
  expect(mockProcessBootstrap).toHaveBeenCalledTimes(3)
  await caller.dispose()
})

it('counts direct background scopes and nested descendants independently of their parents', async () => {
  const dispose = jest.fn()
  registerRetirementProbe(dispose)
  const root = await initializeProcessContainer()
  const background = root!.createScope()
  const caller = await createRequestContainer()
  const nested = caller.createScope()
  invalidateProcessContainer()
  await caller.dispose()
  const grandchild = nested.createScope()
  await nested.dispose()
  await background.dispose()
  expect(dispose).not.toHaveBeenCalled()
  await grandchild.dispose()
  expect(dispose).toHaveBeenCalledTimes(1)
})

it('retains a generation until all caller disposers settle even when another disposer rejects', async () => {
  const rootDispose = jest.fn()
  registerRetirementProbe(rootDispose)
  const caller = await createRequestContainer()
  const failure = new Error('[internal] scoped disposal failed')
  let release!: () => void
  const blocked = new Promise<void>((resolve) => { release = resolve })
  const generationResource = caller.resolve('generationResource')
  caller.register({
    fails: asFunction(() => ({})).scoped().disposer(() => { throw failure }),
    slow: asFunction(() => ({})).scoped().disposer(async () => {
      await blocked
      expect(caller.resolve('generationResource')).toBe(generationResource)
      expect(rootDispose).not.toHaveBeenCalled()
    }),
  })
  caller.resolve('fails')
  caller.resolve('slow')
  invalidateProcessContainer()
  const disposing = caller.dispose()
  const rejected = expect(disposing).rejects.toBe(failure)
  await new Promise((resolve) => setImmediate(resolve))
  expect(rootDispose).not.toHaveBeenCalled()
  expect(caller.dispose()).toBe(disposing)
  release()
  await rejected
  expect(rootDispose).toHaveBeenCalledTimes(1)
})

it('releases failed caller setup while preserving its error when retired root disposal rejects', async () => {
  const rootFailure = new Error('[internal] root disposal failed')
  const setupFailure = new Error('[internal] setup failed')
  const dispose = jest.fn(async () => { throw rootFailure })
  registerDiRegistrars([defineProcessDiRegistrar((root) => {
    root.register({ generationResource: asFunction(() => ({})).singleton().disposer(dispose) })
    root.resolve('generationResource')
    registerCallerSetup(root, () => {
      invalidateProcessContainer()
      throw setupFailure
    })
  })])
  await expect(createRequestContainer()).rejects.toBe(setupFailure)
  expect(dispose).toHaveBeenCalledTimes(1)
  expect(mockReportError).toHaveBeenCalledWith(rootFailure, {
    module: 'shared', code: 'shared.root_retirement_cleanup_failed',
  })
})

it('observes unused retired root cleanup rejection even when the telemetry sink throws', async () => {
  const failure = new Error('[internal] root cleanup failed')
  const dispose = jest.fn(async () => { throw failure })
  registerRetirementProbe(dispose)
  const root = await initializeProcessContainer()
  mockReportError.mockImplementationOnce(() => { throw new Error('[internal] telemetry failed') })
  expect(() => invalidateProcessContainer()).not.toThrow()
  await root!.dispose()
  await root!.dispose()
  expect(dispose).toHaveBeenCalledTimes(1)
  expect(mockReportError).toHaveBeenCalledWith(failure, {
    module: 'shared', code: 'shared.root_retirement_cleanup_failed',
  })
})

it('retries acquisition when invalidation retires the root across the initialization await', async () => {
  const dispose = jest.fn()
  registerRetirementProbe(dispose)
  const oldRoot = await initializeProcessContainer()
  const oldResource = oldRoot!.resolve('generationResource')
  const pending = createRequestContainer()
  queueMicrotask(invalidateProcessContainer)
  const caller = await pending
  expect(mockProcessBootstrap).toHaveBeenCalledTimes(2)
  expect(caller.resolve('generationResource')).not.toBe(oldResource)
  expect(dispose).toHaveBeenCalledTimes(1)
  await caller.dispose()
})

it('rejects failed activation promptly while its background scope retains the unpublished generation', async () => {
  const dispose = jest.fn()
  const failure = new Error('[internal] activation failed with background work')
  let background: AppContainer | undefined
  let failActivation = true
  registerDiRegistrars([defineProcessDiRegistrar((root) => {
    root.register({ generationResource: asFunction(() => ({})).singleton().disposer(dispose) })
    root.resolve('generationResource')
    registerProcessActivation(root, () => {
      if (!failActivation) return
      background = root.createScope()
      throw failure
    })
  })])
  await expect(initializeProcessContainer()).rejects.toBe(failure)
  expect(background).toBeDefined()
  expect(dispose).not.toHaveBeenCalled()
  failActivation = false
  const caller = await createRequestContainer()
  expect(dispose).not.toHaveBeenCalled()
  await background!.dispose()
  expect(dispose).toHaveBeenCalledTimes(1)
  await caller.dispose()
})

it.each(['invalidate', 'dispose'] as const)('does not publish a generation retired during activation via %s', async (action) => {
  const dispose = jest.fn()
  let retireFirst = true
  registerDiRegistrars([defineProcessDiRegistrar((root) => {
    root.register({ generationResource: asFunction(() => ({})).singleton().disposer(dispose) })
    root.resolve('generationResource')
    registerProcessActivation(root, () => {
      if (!retireFirst) return
      retireFirst = false
      if (action === 'invalidate') invalidateProcessContainer()
      else void root.dispose()
    })
  })])
  const caller = await createRequestContainer()
  expect(mockProcessBootstrap).toHaveBeenCalledTimes(2)
  expect(mockActivate).toHaveBeenCalledTimes(1)
  expect(dispose).toHaveBeenCalledTimes(1)
  await caller.dispose()
})

it('rebuilds if the final bootstrap activation disposes its unpublished root', async () => {
  const dispose = jest.fn()
  let firstRoot: AppContainer | undefined
  registerDiRegistrars([defineProcessDiRegistrar((root) => {
    firstRoot ??= root
    root.register({ generationResource: asFunction(() => ({})).singleton().disposer(dispose) })
    root.resolve('generationResource')
  })])
  mockActivate.mockImplementationOnce(() => { void firstRoot!.dispose() })
  const caller = await createRequestContainer()
  expect(mockProcessBootstrap).toHaveBeenCalledTimes(2)
  expect(dispose).toHaveBeenCalledTimes(1)
  await caller.dispose()
})
