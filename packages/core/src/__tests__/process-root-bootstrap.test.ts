import { asValue, createContainer, type AwilixContainer } from 'awilix'
import type { EventBus } from '@open-mercato/events'
import { asScopedService, registerProcessEventSetup } from '@open-mercato/shared/lib/di/process-registrar'
import { getGlobalEventBus, setGlobalEventBus } from '@open-mercato/shared/modules/events'
import { getAllSyncSubscribers } from '@open-mercato/shared/lib/crud/sync-subscriber-store'
import { getModules } from '@open-mercato/shared/lib/modules/registry'
import { runInRequestScope, runWithRequestScopeContainer, getRequestScopeContainer } from '@open-mercato/shared/lib/di/request-scope'
import { bootstrapProcessRoot, finalizeProcessRoot } from '../bootstrap'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'

jest.mock('@open-mercato/shared/lib/di/container', () => ({ createRequestContainer: jest.fn() }))
jest.mock('@open-mercato/events/index', () => jest.requireActual('../../../events/src/index'), { virtual: true })
jest.mock('@open-mercato/cache', () => ({ createCacheService: () => ({ close: jest.fn().mockResolvedValue(undefined) }) }))
jest.mock('@open-mercato/shared/lib/ratelimit/service', () => ({
  RateLimiterService: class {
    initialize() { return Promise.resolve() }
    destroy() { return Promise.resolve() }
  },
}))
jest.mock('@open-mercato/shared/lib/encryption/kms', () => ({
  createKmsService: jest.fn(() => ({ isHealthy: () => true })),
}))
jest.mock('@open-mercato/shared/lib/encryption/tenantDataEncryptionService', () => ({
  TenantDataEncryptionService: class {
    constructor(readonly em: unknown, readonly options: unknown) {}
  },
}))
jest.mock('@open-mercato/shared/lib/encryption/subscriber', () => ({ registerTenantEncryptionSubscriber: jest.fn() }))
jest.mock('@open-mercato/shared/lib/encryption/toggles', () => ({ isTenantDataEncryptionEnabled: () => false }))
jest.mock('@open-mercato/shared/lib/modules/registry', () => ({ getModules: jest.fn(() => []) }))
jest.mock('@open-mercato/shared/modules/search', () => ({ getSearchModuleConfigs: () => [] }))
jest.mock('@open-mercato/search/di', () => ({ registerScopedSearchModule: jest.fn() }), { virtual: true })
jest.mock('@open-mercato/search', () => ({
  registerSearchModule: jest.fn(),
  searchDeleteMetadata: { event: 'search.delete_record', persistent: false },
  createSearchDeleteSubscriber: (indexer: { deleteRecord: (payload: unknown) => Promise<void> }) =>
    (payload: unknown) => indexer.deleteRecord(payload),
}), { virtual: true })

const modulesMock = jest.mocked(getModules)

async function prepareProcessRoot(root: AwilixContainer) {
  const activate = await bootstrapProcessRoot(root)
  await finalizeProcessRoot(root)
  return activate
}

beforeEach(() => {
  modulesMock.mockReturnValue([])
})

it('keeps process infrastructure across generations and encryption bound to the resolving caller', async () => {
  const firstRoot = createContainer()
  const secondRoot = createContainer()
  await prepareProcessRoot(firstRoot)
  await prepareProcessRoot(secondRoot)
  const first = firstRoot.createScope().register({ em: asValue({ id: 'first' }) })
  const second = firstRoot.createScope().register({ em: asValue({ id: 'second' }) })
  expect(first.resolve('tenantEncryptionService')).not.toBe(second.resolve('tenantEncryptionService'))
  expect(first.resolve('tenantEncryptionService').em).toBe(first.resolve('em'))
  expect(second.resolve('tenantEncryptionService').em).toBe(second.resolve('em'))
  expect(firstRoot.resolve('kmsService')).toBe(secondRoot.resolve('kmsService'))
  expect(firstRoot.resolve('cache')).toBe(secondRoot.resolve('cache'))
  expect(firstRoot.resolve('rateLimiterService')).toBe(secondRoot.resolve('rateLimiterService'))
})

it('pins facade delivery and nested ambient execution to its owner after creating a sibling', async () => {
  const root = createContainer()
  const seen: string[] = []
  registerProcessEventSetup(root, (bus) => {
    bus.on('probe.created', async (_payload, context) => {
      await Promise.resolve()
      seen.push(context.resolve<string>('identity'))
      expect(getRequestScopeContainer()?.resolve('identity')).toBe(context.resolve('identity'))
    })
  })
  await prepareProcessRoot(root)
  const first = root.createScope().register({ identity: asValue('first') })
  const second = root.createScope().register({ identity: asValue('second') })
  await runInRequestScope(() => runWithRequestScopeContainer(second, async () => {
    await first.resolve<EventBus>('eventBus').emit('probe.created', {})
    expect(getRequestScopeContainer()).toBe(second)
    await second.resolve<EventBus>('eventBus').emit('probe.created', {})
  }))
  expect(seen).toEqual(['first', 'second'])
})

it('search deletion resolves the emitting caller indexer, never the first scope indexer', async () => {
  const root = createContainer()
  await prepareProcessRoot(root)
  const seen: string[] = []
  root.register({ searchIndexer: asScopedService((caller) => ({
    deleteRecord: async () => { seen.push(caller.resolve('identity')) },
  })) })
  const first = root.createScope().register({ identity: asValue('first') })
  const second = root.createScope().register({ identity: asValue('second') })
  await second.resolve<EventBus>('eventBus').emit('search.delete_record', {})
  await first.resolve<EventBus>('eventBus').emit('search.delete_record', {})
  expect(seen).toEqual(['second', 'first'])
})

it('publishes only on activation and clears deleted synchronous subscribers', async () => {
  const original = { emit: jest.fn().mockResolvedValue(undefined) }
  setGlobalEventBus(original)
  modulesMock.mockReturnValue([{ id: 'probe', subscribers: [{ id: 'probe.changed', event: 'probe.changed', sync: true, handler: () => {} }] }])
  const activateFirst = await prepareProcessRoot(createContainer())
  expect(getGlobalEventBus()).toBe(original)
  activateFirst()
  expect(getAllSyncSubscribers()).toHaveLength(1)
  modulesMock.mockReturnValue([])
  const activateEmpty = await prepareProcessRoot(createContainer())
  expect(getAllSyncSubscribers()).toHaveLength(1)
  activateEmpty()
  expect(getAllSyncSubscribers()).toEqual([])
})

it('a failed setup cannot publish a partial generation', async () => {
  const original = { emit: jest.fn().mockResolvedValue(undefined) }
  setGlobalEventBus(original)
  const root = createContainer()
  registerProcessEventSetup(root, () => { throw new Error('setup failed') })
  await expect(prepareProcessRoot(root)).rejects.toThrow('setup failed')
  expect(getGlobalEventBus()).toBe(original)
})


it('unscoped global emission owns and disposes an isolated caller', async () => {
  const root = createContainer()
  const seen: string[] = []
  registerProcessEventSetup(root, (bus) => {
    bus.on('probe.created', (_payload, context) => { seen.push(context.resolve('identity')) })
  })
  const activate = await prepareProcessRoot(root)
  const caller = root.createScope().register({ identity: asValue('isolated') })
  const dispose = jest.spyOn(caller, 'dispose')
  jest.mocked(createRequestContainer).mockResolvedValue(caller)
  activate()
  await getGlobalEventBus()!.emit('probe.created', {})
  expect(seen).toEqual(['isolated'])
  expect(dispose).toHaveBeenCalledTimes(1)
  expect(getRequestScopeContainer()).toBeNull()
})

it('an explicit queued-job resolver preserves the active job context', async () => {
  const root = createContainer()
  const seen: string[] = []
  registerProcessEventSetup(root, (bus) => {
    bus.on('probe.created', (_payload, context) => {
      seen.push(context.resolve('identity'))
      expect(getRequestScopeContainer()?.resolve('identity')).toBe('job')
    }, { persistent: true })
  })
  await prepareProcessRoot(root)
  const first = root.createScope().register({ identity: asValue('first') })
  const job = root.createScope().register({ identity: asValue('job') })
  await runWithRequestScopeContainer(job, () => first.resolve<EventBus>('eventBus')
    .dispatchQueued!('probe.created', {}, undefined, job.resolve.bind(job)))
  expect(seen).toEqual(['job'])
})


it('includes late app event hooks once and delivers them with each caller context', async () => {
  const root = createContainer()
  const seen: string[] = []
  const moduleSetup = jest.fn((bus: EventBus) => {
    bus.on('late.created', (_payload, context) => { seen.push(`module:${context.resolve('identity')}`) })
  })
  const appSetup = jest.fn((bus: EventBus) => {
    bus.on('late.created', (_payload, context) => { seen.push(`app:${context.resolve('identity')}`) })
  })
  registerProcessEventSetup(root, moduleSetup)
  await bootstrapProcessRoot(root)
  registerProcessEventSetup(root, appSetup)
  expect(moduleSetup).not.toHaveBeenCalled()
  expect(appSetup).not.toHaveBeenCalled()
  await finalizeProcessRoot(root)
  await finalizeProcessRoot(root)
  const first = root.createScope().register({ identity: asValue('first') })
  const second = root.createScope().register({ identity: asValue('second') })
  await first.resolve<EventBus>('eventBus').emit('late.created', {})
  await second.resolve<EventBus>('eventBus').emit('late.created', {})
  expect(moduleSetup).toHaveBeenCalledTimes(1)
  expect(appSetup).toHaveBeenCalledTimes(1)
  expect(seen).toEqual(['module:first', 'app:first', 'module:second', 'app:second'])
  await Promise.all([first.dispose(), second.dispose(), root.dispose()])
})

it('keeps hooks from an obsolete generation out of the replacement bus', async () => {
  const obsolete = createContainer()
  const current = createContainer()
  const seen: string[] = []
  let release!: () => void
  const blocked = new Promise<void>((resolve) => { release = resolve })
  await bootstrapProcessRoot(obsolete)
  registerProcessEventSetup(obsolete, async (bus) => {
    await blocked
    bus.on('generation.created', () => { seen.push('obsolete') })
  })
  const finishing = finalizeProcessRoot(obsolete)
  await bootstrapProcessRoot(current)
  registerProcessEventSetup(current, (bus) => {
    bus.on('generation.created', () => { seen.push('current') })
  })
  await finalizeProcessRoot(current)
  release()
  await finishing
  const caller = current.createScope()
  await caller.resolve<EventBus>('eventBus').emit('generation.created', {})
  expect(seen).toEqual(['current'])
  await Promise.all([caller.dispose(), current.dispose(), obsolete.dispose()])
})
