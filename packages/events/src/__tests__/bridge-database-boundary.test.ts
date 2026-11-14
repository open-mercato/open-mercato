import { EventEmitter } from 'node:events'
const tenantA = '11111111-1111-4111-8111-111111111111'
const tenantB = '22222222-2222-4222-8222-222222222222'
const query = jest.fn(async () => undefined)
const client = Object.assign(new EventEmitter(), {
  connect: jest.fn(async () => undefined), query,
  end: jest.fn(async () => undefined),
})
const context = jest.fn()
const runFresh = jest.fn(async (_context: unknown, callback: () => unknown) => callback())
const lifecycle = { ready: jest.fn(async () => undefined), dispose: jest.fn() }
const configure = jest.fn(() => lifecycle)

jest.mock('pg', () => ({ Client: jest.fn(() => client), Pool: jest.fn(() => ({ query, end: async () => undefined })) }))
jest.mock('@open-mercato/shared/lib/db/ssl', () => ({ getSslConfig: () => null }))
jest.mock('@open-mercato/shared/lib/db/runtime', () => ({
  isDatabaseRuntimeEnabled: () => true,
  resolveCurrentDatabaseExecutionContext: (...args: unknown[]) => context(...args),
  runWithFreshDatabaseExecutionContext: (...args: unknown[]) => runFresh(...args),
  configureDatabaseTransport: (...args: unknown[]) => configure(...args),
}))

import { publishCrossProcessEvent, registerCrossProcessEventListener } from '../bridge'
const originalUrl = process.env.DATABASE_URL
beforeAll(() => { process.env.DATABASE_URL = 'postgres://unused.invalid/fixture' })
afterAll(() => { if (originalUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = originalUrl })
beforeEach(() => { jest.clearAllMocks(); context.mockResolvedValue({ kind: 'tenant', tenantId: tenantA }) })

it('requires live canonical tenant authority before publishing', async () => {
  await expect(publishCrossProcessEvent('fixture.updated', {}, { tenantId: tenantB })).rejects.toThrow('canonical tenant')
  context.mockRejectedValue(new Error('invocation completed'))
  await expect(publishCrossProcessEvent('fixture.updated', {}, { tenantId: tenantA })).rejects.toThrow('invocation completed')
  expect(query).not.toHaveBeenCalled()
})

it('publishes through a declared transport after readiness', async () => {
  await publishCrossProcessEvent('fixture.updated', {}, { tenantId: tenantA })
  expect(configure).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ kind: 'pool', mode: 'publish' }))
  expect(lifecycle.ready).toHaveBeenCalled()
  expect(query).toHaveBeenCalledWith('SELECT pg_notify($1, $2)', expect.any(Array))
})

it('creates fresh tenant invocations for accepted cross-process callbacks and closes transport', async () => {
  const listener = jest.fn()
  const unsubscribe = registerCrossProcessEventListener(listener)
  await new Promise((resolve) => setImmediate(resolve))
  try {
    client.emit('notification', { channel: 'om_event_bridge', payload: JSON.stringify({ event: 'fixture.updated', payload: {}, options: { tenantId: tenantB } }) })
    await new Promise((resolve) => setImmediate(resolve))
    expect(runFresh).toHaveBeenCalledWith({ kind: 'tenant', tenantId: tenantB, source: 'event', operation: 'fixture.updated' }, expect.any(Function))
    expect(listener).toHaveBeenCalledTimes(1)
  } finally { unsubscribe(); await new Promise((resolve) => setImmediate(resolve)) }
  expect(client.end).toHaveBeenCalledTimes(1)
  expect(lifecycle.dispose).toHaveBeenCalledTimes(1)
})
