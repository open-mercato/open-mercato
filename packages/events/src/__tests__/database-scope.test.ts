const mockEnqueue = jest.fn(async () => undefined)
jest.mock('@open-mercato/queue', () => ({ createQueue: () => ({ enqueue: mockEnqueue }) }))
jest.mock('../bridge', () => ({ publishCrossProcessEvent: jest.fn(), registerCrossProcessEventListener: jest.fn() }))
import { AsyncLocalStorage } from 'node:async_hooks'
import { registerDatabaseExecutionContextResolver, registerDatabaseRuntimeAdapter, runWithDatabaseExecutionContext, type DatabaseExecutionContext } from '@open-mercato/shared/lib/db/runtime'
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

for (const explicitTenant of [undefined, '11111111-1111-4111-8111-111111111111']) {
  test(`resolves deferred request identity before event side effects: ${explicitTenant ?? 'omitted'}`, async () => {
    const invocation = { token: Symbol('request'), isActive: () => true }
    registerDatabaseExecutionContextResolver('request', async () => ({ status: 'resolved', context: { kind: 'tenant', source: 'page', tenantId }, invocation }))
    const bus = createEventBus({ resolve: (() => undefined) as never, queueStrategy: 'local' })
    const subscriber = jest.fn()
    bus.on('extension.record.created', subscriber)
    const emitted = bus.emit('extension.record.created', {}, { persistent: true, tenantId: explicitTenant })
    if (explicitTenant) {
      await expect(emitted).rejects.toThrow('conflicts')
      expect(subscriber).not.toHaveBeenCalled()
      expect(mockEnqueue).not.toHaveBeenCalled()
    } else {
      await emitted
      expect(mockEnqueue).toHaveBeenCalledWith(expect.objectContaining({ options: expect.objectContaining({ tenantId }) }))
    }
  })
}

test('rejects expired and unavailable deferred requests before event delivery or enqueue', async () => {
  let unavailable = false
  registerDatabaseExecutionContextResolver('request', async () => unavailable
    ? { status: 'unavailable', error: new Error('[internal] request unavailable') }
    : { status: 'resolved', context: { kind: 'tenant', source: 'page', tenantId }, invocation: { token: Symbol('request'), isActive: () => false } })
  const bus = createEventBus({ resolve: (() => undefined) as never, queueStrategy: 'local' })
  const subscriber = jest.fn()
  bus.on('extension.record.created', subscriber)
  await expect(bus.emit('extension.record.created', {}, { persistent: true })).rejects.toThrow('completed')
  unavailable = true
  await expect(bus.emit('extension.record.created', {}, { persistent: true })).rejects.toThrow('unavailable')
  expect(subscriber).not.toHaveBeenCalled()
  expect(mockEnqueue).not.toHaveBeenCalled()
})

for (const phase of ['tap', 'subscriber']) {
  test(`does not deliver or enqueue after the request expires during an awaited ${phase}`, async () => {
    let active = true
    registerDatabaseExecutionContextResolver('request', async () => ({ status: 'resolved', context: { kind: 'tenant', source: 'page', tenantId }, invocation: { token: Symbol.for('request'), isActive: () => active } }))
    const bus = createEventBus({ resolve: (() => undefined) as never, queueStrategy: 'local' })
    const expire = async () => { await Promise.resolve(); active = false }
    const { registerGlobalEventTap } = await import('../bus')
    const removeTap = phase === 'tap' ? registerGlobalEventTap(expire) : () => undefined
    if (phase === 'subscriber') bus.on('extension.record.created', expire)
    const laterSubscriber = jest.fn()
    bus.on('extension.record.created', laterSubscriber)
    try {
      await expect(bus.emit('extension.record.created', {}, { persistent: true })).rejects.toThrow('completed')
      expect(laterSubscriber).not.toHaveBeenCalled()
      expect(mockEnqueue).not.toHaveBeenCalled()
    } finally { removeTap() }
  })
}


test('delivers an accepted coalesced tail in a fresh bounded invocation after its request expires', async () => {
  delete (globalThis as Record<symbol, unknown>)[key]
  const frames = new AsyncLocalStorage<{ context: DatabaseExecutionContext; active: boolean }>()
  const run = async (context: DatabaseExecutionContext, callback: () => unknown) => {
    const frame = { context, active: true }
    return frames.run(frame, async () => {
      try { return await callback() } finally { frame.active = false }
    })
  }
  const currentContext = () => {
    const frame = frames.getStore()
    if (frame && !frame.active) throw new Error('[internal] Database invocation has completed')
    return frame?.context
  }
  registerDatabaseRuntimeAdapter({ id: 'test', version: '1', configurationKey: 'coalesced',
    configurePool: () => ({ ready: async () => undefined, dispose: () => undefined }),
    currentContext,
    run: run as never,
    runFresh: run as never,
  })
  const { createModuleEvents } = await import('@open-mercato/shared/modules/events')
  const { flushPendingBroadcasts, resetBroadcastCoalescerForTests } = await import('../broadcast-coalescer')
  const { registerGlobalEventTap } = await import('../bus')
  createModuleEvents({ moduleId: 'scope_test', events: [{ id: 'scope_test.record.changed', label: 'Changed', clientBroadcast: true, broadcastCoalescing: true }] })
  const interval = process.env.OM_BROADCAST_COALESCE_INTERVAL_MS
  process.env.OM_BROADCAST_COALESCE_INTERVAL_MS = '60000'
  let requestActive = true
  registerDatabaseExecutionContextResolver('request', async () => ({ status: 'resolved', context: { kind: 'tenant', source: 'page', tenantId }, invocation: { token: Symbol.for('coalesced-request'), isActive: () => requestActive } }))
  const delivered: Array<{ sequence: unknown; tenantId: string | null | undefined }> = []
  const removeTap = registerGlobalEventTap((_event, payload) => {
    delivered.push({ sequence: (payload as { sequence: number }).sequence, tenantId: currentContext()?.tenantId })
  })
  try {
    const bus = createEventBus({ resolve: (() => undefined) as never, queueStrategy: 'local' })
    await bus.emit('scope_test.record.changed', { sequence: 1 })
    await bus.emit('scope_test.record.changed', { sequence: 2 })
    expect(delivered).toEqual([{ sequence: 1, tenantId }])
    requestActive = false
    await flushPendingBroadcasts()
    expect(delivered).toEqual([{ sequence: 1, tenantId }, { sequence: 2, tenantId }])
    expect(currentContext()).toBeUndefined()
    await expect(bus.emit('scope_test.record.changed', { sequence: 3 })).rejects.toThrow('completed')
  } finally {
    removeTap()
    resetBroadcastCoalescerForTests()
    if (interval === undefined) delete process.env.OM_BROADCAST_COALESCE_INTERVAL_MS
    else process.env.OM_BROADCAST_COALESCE_INTERVAL_MS = interval
  }
})
