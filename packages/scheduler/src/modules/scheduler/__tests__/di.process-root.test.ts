import { asValue, createContainer } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { asScopedService, getProcessDiRegistrar, runCallerSetups, runProcessActivations } from '@open-mercato/shared/lib/di/process-registrar'
import { getRequestScopeContainer, runWithRequestScopeContainer } from '@open-mercato/shared/lib/di/request-scope'

const mockSyncAll = jest.fn<Promise<void>, []>()
const mockCreateContainer = jest.fn<Promise<AppContainer>, []>()
const mockReportError = jest.fn()
const mockLogger = { info: jest.fn(), error: jest.fn(), warn: jest.fn() }
const mockSchedulers: { em: () => unknown; syncAll: typeof mockSyncAll; destroy: jest.Mock }[] = []

jest.mock('@open-mercato/shared/lib/di/container', () => ({ createRequestContainer: mockCreateContainer }))
jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({ getTelemetryRuntime: () => ({ reportError: mockReportError }) }))
jest.mock('@open-mercato/shared/lib/logger', () => ({ createLogger: () => ({
  child() { return this },
  info: (...args: unknown[]) => mockLogger.info(...args),
  error: (...args: unknown[]) => mockLogger.error(...args),
  warn: (...args: unknown[]) => mockLogger.warn(...args),
}) }))
jest.mock('../services/bullmqSchedulerService.js', () => ({
  BullMQSchedulerService: jest.fn().mockImplementation((em: () => unknown) => {
    const service = { em, syncAll: mockSyncAll, destroy: jest.fn(async () => undefined) }
    mockSchedulers.push(service)
    return service
  }),
}))
jest.mock('../services/localSchedulerService.js', () => ({
  LocalSchedulerService: jest.fn().mockImplementation((em, queueFactory, rbacService) => ({
    em, queueFactory, rbacService, stop: jest.fn(async () => undefined),
  })),
}))
jest.mock('../services/schedulerService.js', () => ({
  SchedulerService: jest.fn().mockImplementation((em, bullmqService) => ({ em, bullmqService })),
}))
jest.mock('../lib/scheduledJobSubscriber.js', () => ({
  ScheduledJobSubscriber: jest.fn().mockImplementation(() => ({ setContainer: jest.fn() })),
}))

let register: typeof import('../di')['register']
const originalStrategy = process.env.QUEUE_STRATEGY
const nextTurn = () => new Promise<void>((resolve) => setImmediate(resolve))

beforeEach(() => {
  jest.clearAllMocks()
  mockCreateContainer.mockReset()
  mockSyncAll.mockReset().mockResolvedValue(undefined)
  mockSchedulers.length = 0
  jest.isolateModules(() => { register = require('../di').register })
})

afterEach(() => {
  if (originalStrategy === undefined) delete process.env.QUEUE_STRATEGY
  else process.env.QUEUE_STRATEGY = originalStrategy
})

function createAsyncRoot() {
  process.env.QUEUE_STRATEGY = 'async'
  const root = createContainer()
  root.register({ em: asScopedService(() => ({
    clear: jest.fn(),
    getEventManager: () => ({ registerSubscriber: jest.fn() }),
  })) })
  getProcessDiRegistrar(register)!(root)
  return root
}

it('registers local services without eager scope resolution and binds them to each caller', async () => {
  process.env.QUEUE_STRATEGY = 'local'
  const root = createContainer()
  const rootResolve = jest.spyOn(root, 'resolve')
  await getProcessDiRegistrar(register)!(root)
  expect(rootResolve).not.toHaveBeenCalled()
  const callers = [root.createScope(), root.createScope()]
  for (const [index, caller] of callers.entries()) {
    const em = { label: index }
    const rbac = { label: index }
    caller.register({ em: asValue(em), rbacService: asValue(rbac) })
    const local = caller.resolve<{ em: () => unknown; rbacService: unknown }>('localSchedulerService')
    expect(local.em()).toBe(em)
    expect(local.rbacService).toBe(rbac)
    expect(caller.resolve<{ em: () => unknown }>('schedulerService').em()).toBe(em)
  }
  expect(callers[0].resolve('localSchedulerService')).not.toBe(callers[1].resolve('localSchedulerService'))
})

it('returns the first caller while reconciliation owns an independent pending background scope', async () => {
  const root = createAsyncRoot()
  const caller = root.createScope()
  const registerSubscriber = jest.fn()
  const callerEm = { getEventManager: () => ({ registerSubscriber }) }
  caller.register({ em: asValue(callerEm) })
  let release!: () => void
  const background = root.createScope()
  mockSyncAll.mockImplementation(() => {
    expect(getRequestScopeContainer()).toBe(background)
    return new Promise<void>((resolve) => { release = resolve })
  })
  const backgroundEm = background.resolve<{ clear: jest.Mock }>('em')
  mockCreateContainer.mockImplementation(async () => {
    expect(getRequestScopeContainer()).toBeNull()
    await runCallerSetups(root, background)
    return background
  })
  const dispose = jest.spyOn(background, 'dispose')
  runWithRequestScopeContainer(caller, () => runProcessActivations(root))
  await nextTurn()
  expect(mockSyncAll).toHaveBeenCalledTimes(1)
  await runCallerSetups(root, caller)
  expect(registerSubscriber).toHaveBeenCalledTimes(1)
  expect(registerSubscriber.mock.calls[0][0].setContainer).toHaveBeenCalledWith(caller)
  expect(mockSchedulers[0].em()).toBe(backgroundEm)
  expect(backgroundEm).not.toBe(callerEm)
  expect(dispose).not.toHaveBeenCalled()
  runProcessActivations(root)
  await runCallerSetups(root, root.createScope())
  expect(mockCreateContainer).toHaveBeenCalledTimes(1)
  release()
  await nextTurn()
  expect(backgroundEm.clear).toHaveBeenCalledTimes(1)
  expect(dispose).toHaveBeenCalledTimes(1)
  expect(mockSchedulers[0].destroy).toHaveBeenCalledTimes(1)
  expect(mockReportError).not.toHaveBeenCalled()
})

it('does not launch reconciliation for a discarded root generation', async () => {
  createAsyncRoot()
  await nextTurn()
  expect(mockCreateContainer).not.toHaveBeenCalled()
  const root = createAsyncRoot()
  const background = root.createScope()
  mockCreateContainer.mockResolvedValue(background)
  runProcessActivations(root)
  await nextTurn()
  expect(mockCreateContainer).toHaveBeenCalledTimes(1)
  expect(mockSyncAll).toHaveBeenCalledTimes(1)
  expect(mockSchedulers[0].destroy).toHaveBeenCalledTimes(1)
})

it.each(['sync', 'clear', 'dispose'] as const)('observes %s failure and disposes the owned background scope', async (failure) => {
  const root = createAsyncRoot()
  const background = root.createScope()
  const em = background.resolve<{ clear: jest.Mock }>('em')
  const error = new Error(`test ${failure} failure`)
  if (failure === 'sync') mockSyncAll.mockRejectedValue(error)
  if (failure === 'clear') em.clear.mockImplementation(() => { throw error })
  const dispose = jest.spyOn(background, 'dispose')
  if (failure === 'dispose') dispose.mockRejectedValue(error)
  mockCreateContainer.mockResolvedValue(background)
  runProcessActivations(root)
  await nextTurn()
  expect(em.clear).toHaveBeenCalledTimes(1)
  expect(dispose).toHaveBeenCalledTimes(1)
  if (failure !== 'dispose') expect(mockSchedulers[0].destroy).toHaveBeenCalledTimes(1)
  expect(mockReportError).toHaveBeenCalledWith(error, { module: 'scheduler', code: 'scheduler.cold_start_failed' })
  expect(mockLogger.error).toHaveBeenCalledWith('BullMQ cold start sync failed', { err: error })
})

it('observes background scope construction failure without an unhandled rejection', async () => {
  const root = createAsyncRoot()
  const error = new Error('test scope construction failure')
  mockCreateContainer.mockRejectedValue(error)
  runProcessActivations(root)
  await nextTurn()
  expect(mockSyncAll).not.toHaveBeenCalled()
  expect(mockReportError).toHaveBeenCalledWith(error, { module: 'scheduler', code: 'scheduler.cold_start_failed' })
})
