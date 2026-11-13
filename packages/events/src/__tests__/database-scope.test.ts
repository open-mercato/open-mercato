const mockEnqueue = jest.fn(async () => undefined)
jest.mock('@open-mercato/queue', () => ({ createQueue: () => ({ enqueue: mockEnqueue }) }))
jest.mock('../bridge', () => ({ publishCrossProcessEvent: jest.fn(), registerCrossProcessEventListener: jest.fn() }))
import { AsyncLocalStorage } from 'node:async_hooks'
import { registerDatabaseRuntimeAdapter, runWithDatabaseExecutionContext, type DatabaseExecutionContext } from '@open-mercato/shared/lib/db/runtime'
import { createEventBus } from '../bus'

const storage = new AsyncLocalStorage<DatabaseExecutionContext>()
const tenantId = '22222222-2222-4222-8222-222222222222'
const key = Symbol.for('@open-mercato/shared.databaseRuntime.v1')
beforeEach(() => {
  mockEnqueue.mockClear()
  delete (globalThis as Record<symbol, unknown>)[key]
  registerDatabaseRuntimeAdapter({ id: 'test', version: '1', configurationKey: '1',
    configurePool: () => ({ ready: async () => undefined, dispose: () => undefined }),
    currentContext: () => storage.getStore(), run: (context, callback) => storage.run(context, callback),
  })
})
afterEach(() => { delete (globalThis as Record<symbol, unknown>)[key] })

test('persists canonical invocation identity even for a server-only event with no options tenant', async () => {
  const bus = createEventBus({ resolve: (() => undefined) as never, queueStrategy: 'local' })
  await runWithDatabaseExecutionContext({ kind: 'tenant', source: 'api', tenantId }, () => bus.emit('extension.record.created', { tenantId: 'ignored-payload' }, { persistent: true }))
  expect(mockEnqueue).toHaveBeenCalledWith(expect.objectContaining({ options: expect.objectContaining({ tenantId }) }))
})

test('rejects conflicting explicit options before delivery or enqueue', async () => {
  const bus = createEventBus({ resolve: (() => undefined) as never, queueStrategy: 'local' })
  const subscriber = jest.fn()
  bus.on('extension.record.created', subscriber)
  await expect(runWithDatabaseExecutionContext({ kind: 'tenant', source: 'api', tenantId }, () => bus.emit('extension.record.created', {}, { tenantId: '11111111-1111-4111-8111-111111111111', persistent: true }))).rejects.toThrow('conflicts')
  expect(subscriber).not.toHaveBeenCalled()
  expect(mockEnqueue).not.toHaveBeenCalled()
})
