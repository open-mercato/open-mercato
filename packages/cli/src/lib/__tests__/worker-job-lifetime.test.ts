import { asFunction } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import type { ModuleWorker } from '@open-mercato/shared/modules/registry'
import { defineProcessDiRegistrar } from '@open-mercato/shared/lib/di/process-registrar'

const mockClear = jest.fn()
const mockOrm = { em: { fork: jest.fn(() => ({ clear: mockClear })) } }
const mockDispose = jest.fn()

jest.mock('@open-mercato/shared/lib/db/mikro', () => ({ getOrm: async () => mockOrm }))
jest.mock('@mikro-orm/core', () => ({ RequestContext: { getEntityManager: () => null } }))
jest.mock('@open-mercato/shared/lib/query/engine', () => ({ BasicQueryEngine: class {} }))
jest.mock('@open-mercato/shared/lib/data/engine', () => ({ DefaultDataEngine: class {} }))
jest.mock('@open-mercato/shared/lib/commands', () => ({ commandRegistry: {}, CommandBus: class {} }))
jest.mock('@open-mercato/core/bootstrap', () => ({
  bootstrap: async () => {},
  bootstrapProcessRoot: async () => () => {},
  finalizeProcessRoot: async () => {},
}), { virtual: true })
jest.mock('@open-mercato/shared/modules/overrides', () => ({
  composeDiOverrides: () => ({}),
  applyDiOverridesToContainer: () => {},
}))
jest.mock('@open-mercato/core/modules/query_index/lib/engine', () => ({ HybridQueryEngine: class {} }), { virtual: true })
jest.mock('@open-mercato/shared/lib/indexers/error-log', () => ({ recordIndexerError: jest.fn() }))
jest.mock('@open-mercato/shared/lib/encryption/subscriber', () => ({ registerTenantEncryptionSubscriber: jest.fn() }))

import {
  createRequestContainer,
  initializeProcessContainer,
  invalidateProcessContainer,
  registerAppDiRegistrar,
  registerDiRegistrars,
  resetBootstrapCache,
} from '@open-mercato/shared/lib/di/container'
import { getRequestScopeContainer, runInRequestScope } from '@open-mercato/shared/lib/di/request-scope'
import { createPerJobWorkerHandler } from '../worker-job-handler'

const originalEnvironment = {
  OM_PROCESS_CONTAINER_ROOT: process.env.OM_PROCESS_CONTAINER_ROOT,
  OM_BOOTSTRAP_CACHE: process.env.OM_BOOTSTRAP_CACHE,
  OM_CACHE_SINGLETON: process.env.OM_CACHE_SINGLETON,
  SEARCH_DISABLE_SINGLETON_CACHE: process.env.SEARCH_DISABLE_SINGLETON_CACHE,
}
let root: AppContainer | null
const context = { jobId: 'job', attemptNumber: 1, queueName: 'test' }
function worker(handler: ModuleWorker['handler']): ModuleWorker {
  return { id: 'test:worker', queue: 'test', concurrency: 1, handler }
}

beforeEach(() => {
  process.env.OM_PROCESS_CONTAINER_ROOT = 'on'
  process.env.OM_BOOTSTRAP_CACHE = 'off'
  process.env.OM_CACHE_SINGLETON = 'on'
  process.env.SEARCH_DISABLE_SINGLETON_CACHE = 'off'
  jest.clearAllMocks()
  resetBootstrapCache()
  registerAppDiRegistrar(defineProcessDiRegistrar(() => {}))
  registerDiRegistrars([defineProcessDiRegistrar((container) => {
    container.register({ generationResource: asFunction(() => ({})).singleton().disposer(mockDispose) })
    container.resolve('generationResource')
  })])
  root = null
})

afterEach(async () => {
  invalidateProcessContainer()
  await root?.dispose()
  registerDiRegistrars([])
  registerAppDiRegistrar(defineProcessDiRegistrar(() => {}))
  resetBootstrapCache()
  for (const [key, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

it.each([false, true])('releases job, helper and nested scopes after completion (failure: %s)', async (fails) => {
  root = await initializeProcessContainer()
  const failure = new Error('job failed')
  const clearCountsAtDisposal: number[] = []
  const callerDispose = jest.fn(() => { clearCountsAtDisposal.push(mockClear.mock.calls.length) })
  const nestedDispose = jest.fn()
  let jobContainer: AppContainer | undefined
  const handler = createPerJobWorkerHandler([worker(async () => {
    jobContainer = getRequestScopeContainer() as AppContainer
    jobContainer.register({ local: asFunction(() => ({})).scoped().disposer(callerDispose) })
    jobContainer.resolve('local')
    const helper = await createRequestContainer()
    const nested = helper.createScope()
    nested.register({ local: asFunction(() => ({})).scoped().disposer(nestedDispose) })
    nested.resolve('local')
    expect(getRequestScopeContainer()).toBe(jobContainer)
    if (fails) throw failure
  })], createRequestContainer)

  if (fails) await expect(handler({ id: 'job' }, context)).rejects.toBe(failure)
  else await expect(handler({ id: 'job' }, context)).resolves.toBeUndefined()
  expect(mockClear).toHaveBeenCalledTimes(1)
  expect(callerDispose).toHaveBeenCalledTimes(1)
  expect(clearCountsAtDisposal).toEqual([1])
  expect(nestedDispose).toHaveBeenCalledTimes(1)
  expect(mockDispose).not.toHaveBeenCalled()
  invalidateProcessContainer()
  await root?.dispose()
  await jobContainer?.dispose()
  expect(mockDispose).toHaveBeenCalledTimes(1)
  expect(callerDispose).toHaveBeenCalledTimes(1)
})

it('preserves independently owned background scopes after the job finishes', async () => {
  root = await initializeProcessContainer()
  let background: AppContainer | undefined
  const handler = createPerJobWorkerHandler([worker(async () => {
    background = await runInRequestScope(createRequestContainer)
  })], createRequestContainer)

  await handler({ id: 'job' }, context)
  invalidateProcessContainer()
  expect(mockDispose).not.toHaveBeenCalled()
  expect(background?.resolve('generationResource')).toBeDefined()
  await background?.dispose()
  await root?.dispose()
  expect(mockDispose).toHaveBeenCalledTimes(1)
})

it('does not treat a worker response value as an HTTP stream lifetime', async () => {
  root = await initializeProcessContainer()
  const response = new Response('unused job result')
  const handler = createPerJobWorkerHandler([worker(() => response)], createRequestContainer)

  await expect(handler({ id: 'job' }, context)).resolves.toBeUndefined()
  expect(response.bodyUsed).toBe(false)
  invalidateProcessContainer()
  await root?.dispose()
  expect(mockDispose).toHaveBeenCalledTimes(1)
})
