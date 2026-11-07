const query = jest.fn(async () => undefined)
const poolConfigs: Array<Record<string, unknown>> = []
const clientConfigs: Array<Record<string, unknown>> = []

jest.mock('pg', () => ({
  Pool: jest.fn((config: Record<string, unknown>) => {
    poolConfigs.push(config)
    return { query }
  }),
  Client: jest.fn((config: Record<string, unknown>) => {
    clientConfigs.push(config)
    return { on: jest.fn(), connect: jest.fn(async () => undefined), query, end: jest.fn(async () => undefined) }
  }),
}))

jest.mock('@open-mercato/shared/lib/db/ssl', () => ({
  getSslConfig: jest.fn(() => null),
}))

import { createModuleEvents } from '@open-mercato/shared/modules/events'

createModuleEvents({
  moduleId: 'bridge_session_tz_test',
  events: [{ id: 'bridge_session_tz_test.changed', label: 'Changed', clientBroadcast: true }] as const,
})

type BridgeModule = typeof import('../bridge')

// The bridge caches its pool and listener per module instance, so each case loads a fresh copy.
function loadBridge(): BridgeModule {
  let loaded: BridgeModule | undefined
  jest.isolateModules(() => {
    loaded = require('../bridge') as BridgeModule
  })
  return loaded!
}

describe('cross-process bridge Postgres session time zone', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    process.env = { ...originalEnv, DATABASE_URL: 'postgres://postgres:postgres@localhost:5432/mercato' }
    poolConfigs.length = 0
    clientConfigs.length = 0
    query.mockClear()
  })

  afterAll(() => {
    process.env = originalEnv
  })

  it('opens the publisher pool and the listener client with OM_DB_DEFAULT_TIMEZONE', async () => {
    process.env.OM_DB_DEFAULT_TIMEZONE = 'Europe/Warsaw'
    const bridge = loadBridge()

    await bridge.publishCrossProcessEvent('bridge_session_tz_test.changed', { id: 'a' }, { tenantId: 'tenant-1' })
    const unregister = bridge.registerCrossProcessEventListener(async () => undefined)
    await new Promise((resolve) => setImmediate(resolve))
    unregister()

    expect(poolConfigs).toHaveLength(1)
    expect(poolConfigs[0]).toMatchObject({ options: '-c TimeZone=Europe/Warsaw' })
    expect(clientConfigs).toHaveLength(1)
    expect(clientConfigs[0]).toMatchObject({ options: '-c TimeZone=Europe/Warsaw' })
  })

  it('adds no session options when the variable is unset', async () => {
    delete process.env.OM_DB_DEFAULT_TIMEZONE
    const bridge = loadBridge()

    await bridge.publishCrossProcessEvent('bridge_session_tz_test.changed', { id: 'a' }, { tenantId: 'tenant-1' })
    const unregister = bridge.registerCrossProcessEventListener(async () => undefined)
    await new Promise((resolve) => setImmediate(resolve))
    unregister()

    expect(poolConfigs[0]).not.toHaveProperty('options')
    expect(clientConfigs[0]).not.toHaveProperty('options')
  })
})
