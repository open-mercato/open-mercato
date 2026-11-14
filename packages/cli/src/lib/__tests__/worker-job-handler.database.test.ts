import { AsyncLocalStorage } from 'node:async_hooks'
import type { ModuleWorker } from '@open-mercato/shared/modules/registry'
import { registerDatabaseRuntimeAdapter, type DatabaseExecutionContext } from '@open-mercato/shared/lib/db/runtime'
import { registerDatabaseModuleDeclarations } from '@open-mercato/shared/lib/db/declarations'
import { createPerJobWorkerHandler } from '../worker-job-handler'

const storage = new AsyncLocalStorage<DatabaseExecutionContext>()
const binding = jest.fn(async () => true)
const declarationsKey = Symbol.for('@open-mercato/shared.databaseModuleDeclarations.v1')
const runtimeKey = Symbol.for('@open-mercato/shared.databaseRuntime.v1')
const tenantId = '22222222-2222-4222-8222-222222222222'
const otherTenantId = '11111111-1111-4111-8111-111111111111'
const context = { jobId: 'job', attemptNumber: 1, queueName: 'extension' }

beforeEach(() => {
  delete (globalThis as Record<symbol, unknown>)[runtimeKey]
  delete (globalThis as Record<symbol, unknown>)[declarationsKey]
  binding.mockReset().mockResolvedValue(true)
  registerDatabaseModuleDeclarations([{ moduleId: 'fixture', declarations: { bindingValidators: [binding] } }])
  registerDatabaseRuntimeAdapter({
    id: 'test', version: '1', configurationKey: '1',
    configurePool: () => ({ ready: async () => undefined, dispose: () => undefined }),
    run: (scope, callback) => storage.run(scope, callback),
  })
})
afterEach(() => { delete (globalThis as Record<symbol, unknown>)[runtimeKey]; delete (globalThis as Record<symbol, unknown>)[declarationsKey] })

function job(tenant: string) {
  return { id: tenant, createdAt: new Date().toISOString(), payload: { tenantId: tenant } }
}

test('binds each concurrent job before creating its container, through dispatch and cleanup', async () => {
  const seen: string[] = []
  const factory = jest.fn(async () => {
    const owner = storage.getStore()
    expect(owner?.kind).toBe('tenant')
    seen.push(owner!.tenantId!)
    return { resolve: <Result,>() => ({ clear: () => expect(storage.getStore()).toBe(owner) }) as Result }
  })
  const worker: ModuleWorker = { id: 'extension:work', queue: 'extension', concurrency: 2, handler: async (queued) => {
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(storage.getStore()?.tenantId).toBe((queued.payload as { tenantId: string }).tenantId)
  } }
  const handler = createPerJobWorkerHandler([worker], factory)
  await Promise.all([handler(job(tenantId), context), handler(job(otherTenantId), context)])
  expect(seen.sort()).toEqual([tenantId, otherTenantId].sort())
  expect(storage.getStore()).toBeUndefined()
})

test('rejects invalid scope before container creation and preserves worker failure for retry', async () => {
  const clear = jest.fn()
  const factory = jest.fn(async () => ({ resolve: <Result,>() => ({ clear }) as Result }))
  const failure = new Error('[internal] Retry me')
  const handler = createPerJobWorkerHandler([{ id: 'extension:work', queue: 'extension', concurrency: 1, handler: async () => { throw failure } }], factory)
  await expect(handler(job('invalid'), context)).rejects.toThrow('verified tenant UUID')
  expect(factory).not.toHaveBeenCalled()
  await expect(handler(job(tenantId), context)).rejects.toBe(failure)
  await expect(handler(job(tenantId), { ...context, attemptNumber: 2 })).rejects.toBe(failure)
  expect(clear).toHaveBeenCalledTimes(2)
  expect(storage.getStore()).toBeUndefined()
})

test('rejects inactive persisted tenants before creating a container', async () => {
  binding.mockImplementation(async () => { expect(storage.getStore()?.kind).toBe('identity'); return false })
  const factory = jest.fn()
  const handler = createPerJobWorkerHandler([], factory)
  await expect(handler(job(tenantId), context)).rejects.toThrow('persisted active tenant')
  expect(factory).not.toHaveBeenCalled()
})

test('awaits container disposal inside the live invocation after a failed job', async () => {
  const dispose = jest.fn(async () => { await new Promise<void>((resolve) => setImmediate(resolve)); expect(storage.getStore()?.tenantId).toBe(tenantId) })
  const handler = createPerJobWorkerHandler([{ id: 'extension:work', queue: 'extension', handler: async () => { throw new Error('retry') } }], async () => ({ resolve: <Result,>() => ({ clear: () => undefined }) as Result, dispose }))
  await expect(handler(job(tenantId), context)).rejects.toThrow('retry')
  expect(dispose).toHaveBeenCalledTimes(1)
})
