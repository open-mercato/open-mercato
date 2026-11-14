import { AsyncLocalStorage } from 'node:async_hooks'
import type { DatabaseExecutionContext } from '@open-mercato/shared/lib/db/runtime'

const storage = new AsyncLocalStorage<{ context: DatabaseExecutionContext; active: boolean }>()
const scopes: NonNullable<ReturnType<typeof storage.getStore>>[] = []
const tenantId = '11111111-1111-4111-8111-111111111111'
const scheduleId = '22222222-2222-4222-8222-222222222222'
const job = { id: scheduleId, name: 'test', scopeType: 'tenant', tenantId, organizationId: null, scheduleType: 'interval', scheduleValue: '1h', targetType: 'queue', targetQueue: 'target' }
const findOne = jest.fn()
const enqueue = jest.fn()
const close = jest.fn()
const dispose = jest.fn()
const createContainer = jest.fn()
const ormClear = jest.fn()
const syncQuery = jest.fn()
const redisClose = jest.fn()

jest.mock('@open-mercato/shared/lib/db/runtime', () => ({
  isDatabaseRuntimeEnabled: () => true,
  runWithFreshDatabaseExecutionContext: (context: DatabaseExecutionContext, callback: () => Promise<unknown>) => {
    const scope = { context, active: true }; scopes.push(scope)
    return storage.run(scope, async () => { try { return await callback() } finally { scope.active = false } })
  },
}))
jest.mock('@open-mercato/shared/lib/di/container', () => ({ createRequestContainer: () => createContainer() }))
jest.mock('@open-mercato/shared/lib/db/mikro', () => ({ getOrm: async () => {
  expect(storage.getStore()?.context.kind).toBe('maintenance')
  const em = { fork: () => em, find: syncQuery, clear: ormClear }
  return { em }
} }))
jest.mock('@open-mercato/queue', () => ({ createQueue: () => ({ enqueue, close }) }), { virtual: true })
jest.mock('bullmq', () => ({ Queue: class {
  getRepeatableJobs = async () => []
  close = redisClose
} }))
jest.mock('@open-mercato/shared/lib/redis/connection', () => ({ getRedisUrlOrThrow: () => 'redis://localhost:6379', parseRedisUrl: () => ({}) }))
jest.mock('../data/entities', () => ({ ScheduledJob: class {} }))
jest.mock('@open-mercato/shared/lib/commands', () => ({ CommandBus: class {} }))

import commands from '../cli'

beforeEach(() => {
  jest.clearAllMocks(); scopes.length = 0
  process.env.QUEUE_STRATEGY = 'async'
  findOne.mockResolvedValue(job)
  syncQuery.mockResolvedValue([])
  close.mockResolvedValue(undefined)
  enqueue.mockImplementation(async () => {
    expect(storage.getStore()?.context).toMatchObject({ kind: 'tenant', tenantId })
    expect(storage.getStore()?.active).toBe(true)
    return 'job'
  })
  createContainer.mockImplementation(async () => {
    expect(storage.getStore()?.context.kind).toBe('maintenance')
    expect(storage.getStore()?.active).toBe(true)
    return { resolve: () => ({ findOne }), dispose: async () => {
      expect(storage.getStore()?.context.kind).toBe('maintenance')
      expect(storage.getStore()?.active).toBe(true)
      await dispose()
    } }
  })
})
const previousStrategy = process.env.QUEUE_STRATEGY
let output: jest.SpyInstance
beforeEach(() => { output = jest.spyOn(process.stdout, 'write').mockReturnValue(true) })
afterEach(() => { output.mockRestore(); if (previousStrategy === undefined) delete process.env.QUEUE_STRATEGY; else process.env.QUEUE_STRATEGY = previousStrategy })

test('manual run discovers persisted scope in maintenance and dispatches under a fresh tenant invocation', async () => {
  await commands.find((command) => command.command === 'run')!.run([scheduleId])
  expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ scheduleId, tenantId }))
  expect(scopes.map((scope) => scope.context.kind)).toEqual(['maintenance', 'tenant'])
  expect(scopes.every((scope) => !scope.active)).toBe(true)
  expect(close).toHaveBeenCalledTimes(1)
  expect(dispose).toHaveBeenCalledTimes(1)
})

test('manual run rejects invalid persisted tenant before queue dispatch and releases discovery container', async () => {
  findOne.mockResolvedValue({ ...job, tenantId: 'forged' })
  await expect(commands.find((command) => command.command === 'run')!.run([scheduleId])).rejects.toThrow()
  expect(enqueue).not.toHaveBeenCalled()
  expect(dispose).toHaveBeenCalledTimes(1)
  expect(scopes.every((scope) => !scope.active)).toBe(true)
})

test('async startup sync owns finite maintenance ORM and closes Redis without constructing a process container', async () => {
  await commands.find((command) => command.command === 'start')!.run([])
  expect(createContainer).not.toHaveBeenCalled()
  expect(scopes.map((scope) => scope.context.kind)).toEqual(['maintenance'])
  expect(scopes[0].active).toBe(false)
  expect(ormClear).toHaveBeenCalledTimes(1)
  expect(redisClose).toHaveBeenCalledTimes(1)
})
