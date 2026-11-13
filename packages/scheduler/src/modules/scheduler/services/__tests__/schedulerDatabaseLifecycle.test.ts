import { AsyncLocalStorage } from 'node:async_hooks'
import type { DatabaseExecutionContext } from '@open-mercato/shared/lib/db/runtime'

const storage = new AsyncLocalStorage<{ context: DatabaseExecutionContext; active: boolean; token: symbol }>()
const scopes: NonNullable<ReturnType<typeof storage.getStore>>[] = []
const discovered = jest.fn()
const maintenanceClear = jest.fn()
const runtimeClear = jest.fn()
const dispose = jest.fn()
const runtimeFind = jest.fn()
const runtimeFlush = jest.fn()
const enqueue = jest.fn()
const queue = { enqueue }
const containers: object[] = []
const lockScopes: string[] = []
const tenantIds = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222']
const schedules = tenantIds.map((tenantId, index) => ({
  id: `33333333-3333-4333-8333-33333333333${index}`,
  name: 'scoped', scopeType: 'tenant', tenantId, organizationId: null,
  targetType: 'queue', targetQueue: 'target', targetPayload: {},
  sourceType: 'module', sourceModule: 'owner',
  scheduleType: 'interval', scheduleValue: '1h', timezone: 'UTC', isEnabled: true,
}))

function currentTenant(): string {
  const invocation = storage.getStore()
  expect(invocation?.active).toBe(true)
  expect(invocation?.context.kind).toBe('tenant')
  if (invocation?.context.kind !== 'tenant') throw new Error('tenant required')
  return invocation.context.tenantId
}

jest.mock('@open-mercato/shared/lib/db/runtime', () => ({
  isDatabaseRuntimeEnabled: () => true,
  runWithFreshDatabaseExecutionContext: (context: DatabaseExecutionContext, callback: () => Promise<unknown>) => {
    const scope = { context, active: true, token: Symbol() }
    scopes.push(scope)
    return storage.run(scope, async () => { try { return await callback() } finally { scope.active = false } })
  },
}))
jest.mock('@open-mercato/shared/lib/db/declarations', () => ({ resolveOwnedDatabaseJobContext: jest.fn() }))
jest.mock('@open-mercato/shared/lib/db/mikro', () => ({ getOrm: async () => {
  expect(storage.getStore()?.context.kind).toBe('maintenance')
  expect(storage.getStore()?.active).toBe(true)
  const em = { fork: () => em, find: discovered, clear: maintenanceClear }
  return { em }
} }))
jest.mock('@open-mercato/shared/lib/di/container', () => ({ createRequestContainer: async () => {
  const tenantId = currentTenant()
  const em = { fork: () => em, findOne: runtimeFind, flush: runtimeFlush, clear: runtimeClear }
  const service = new LocalSchedulerService(() => {
    expect(currentTenant()).toBe(tenantId)
    return em as never
  }, () => queue as never, { tenantHasFeature: jest.fn(), userHasAllFeatures: jest.fn() })
  const container = {
    resolve: (name: string) => name === 'em' ? em : service,
    dispose: async () => { expect(currentTenant()).toBe(tenantId); await dispose() },
  }
  containers.push(container)
  return container
} }))
jest.mock('../../data/entities', () => ({ ScheduledJob: class {} }))
jest.mock('../../lib/localLockStrategy', () => ({ LocalLockStrategy: class {
  async runWithLock(_key: string, callback: () => Promise<unknown>, resolveEm: () => unknown) {
    lockScopes.push(currentTenant())
    resolveEm()
    return { acquired: true, result: await callback() }
  }
} }))
jest.mock('../../lib/safeQueueTargets', () => ({
  canDispatchScheduleQueueTarget: () => true, getSchedulerQueueRequiredFeatures: () => [],
  sanitizeSchedulerTargetPayload: () => ({}), validateSchedulerTargetPayload: () => null,
}))
jest.mock('../../events', () => ({ emitSchedulerEvent: jest.fn() }))
jest.mock('@open-mercato/shared/lib/commands', () => ({ CommandBus: class {} }))

import { LocalSchedulerService } from '../localSchedulerService'
import { BullMQSchedulerService } from '../bullmqSchedulerService'

beforeEach(() => {
  jest.clearAllMocks(); scopes.length = 0; containers.length = 0; lockScopes.length = 0
  discovered.mockResolvedValue(schedules)
  runtimeFind.mockImplementation(async () => schedules.find((schedule) => schedule.tenantId === currentTenant()))
  enqueue.mockImplementation(async (payload: { tenantId: string }) => { expect(payload.tenantId).toBe(currentTenant()); return 'job' })
})

const unavailable = (): never => { throw new Error('startup dependency escaped') }
const controller = () => new LocalSchedulerService(unavailable, unavailable, { tenantHasFeature: unavailable, userHasAllFeatures: unavailable }, { pollIntervalMs: 100000 })

test('local polling separates maintenance discovery from each tenant container, lock and dispatch', async () => {
  const service = controller()
  try { await service.start() } finally { await service.stop() }
  expect(scopes.map((scope) => scope.context.kind)).toEqual(['maintenance', 'tenant', 'tenant'])
  expect(new Set(scopes.map((scope) => scope.token)).size).toBe(3)
  expect(scopes.every((scope) => !scope.active)).toBe(true)
  expect(containers).toHaveLength(2)
  expect(lockScopes).toEqual(tenantIds)
  expect(enqueue).toHaveBeenCalledTimes(2)
  expect(maintenanceClear).toHaveBeenCalledTimes(1)
  expect(runtimeClear).toHaveBeenCalledTimes(2)
  expect(dispose).toHaveBeenCalledTimes(2)
})

test('a changed persisted scope never dispatches with the discovered tenant authority', async () => {
  runtimeFind.mockImplementation(async ({}, where: { id: string }) => {
    const row = schedules.find((schedule) => schedule.id === where.id)!
    return row.id === schedules[0].id ? { ...row, tenantId: tenantIds[1] } : row
  })
  const service = controller()
  try { await service.start() } finally { await service.stop() }
  expect(enqueue).toHaveBeenCalledTimes(1)
  expect(lockScopes).toEqual([tenantIds[1]])
  expect(dispose).toHaveBeenCalledTimes(2)
})

test('shutdown waits for the active scoped execution to release its container', async () => {
  let complete: (() => void) | undefined
  let entered: (() => void) | undefined
  const executing = new Promise<void>((resolve) => { entered = resolve })
  enqueue.mockImplementationOnce(async () => { entered?.(); await new Promise<void>((resolve) => { complete = resolve }); return 'job' })
  const service = controller()
  const starting = service.start()
  await executing
  let stopped = false
  const stopping = service.stop().then(() => { stopped = true })
  await Promise.resolve()
  expect(stopped).toBe(false)
  complete?.()
  await Promise.all([starting, stopping])
  expect(dispose).toHaveBeenCalledTimes(1)
  expect(scopes.every((scope) => !scope.active)).toBe(true)
})

test('BullMQ reconciliation obtains fresh maintenance ORM on every sync without a startup EM', async () => {
  discovered.mockResolvedValue([])
  const service = new BullMQSchedulerService(unavailable)
  const close = jest.fn()
  Object.assign(service, { queue: { getRepeatableJobs: async () => [], add: jest.fn(), close } })
  try { await service.syncAll(); await service.syncAll() } finally { await service.destroy() }
  expect(scopes.map((scope) => scope.context.kind)).toEqual(['maintenance', 'maintenance'])
  expect(scopes[0].token).not.toBe(scopes[1].token)
  expect(scopes.every((scope) => !scope.active)).toBe(true)
  expect(maintenanceClear).toHaveBeenCalledTimes(2)
  expect(close).toHaveBeenCalledTimes(1)
})


test('timer ticks create new finite invocations instead of retaining an expired startup container', async () => {
  jest.useFakeTimers()
  const service = controller()
  try {
    await service.start()
    await jest.advanceTimersByTimeAsync(100000)
    expect(scopes.map((scope) => scope.context.kind)).toEqual(['maintenance', 'tenant', 'tenant', 'maintenance', 'tenant', 'tenant'])
    expect(new Set(scopes.map((scope) => scope.token)).size).toBe(6)
    expect(scopes.every((scope) => !scope.active)).toBe(true)
    expect(dispose).toHaveBeenCalledTimes(4)
  } finally { await service.stop(); jest.useRealTimers() }
})
