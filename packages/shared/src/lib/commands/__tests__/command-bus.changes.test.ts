import { createContainer, asValue, InjectionMode } from 'awilix'
import { CommandBus, registerCommand, unregisterCommand } from '@open-mercato/shared/lib/commands'

type LogRecord = {
  changes?: Record<string, unknown> | null
  resourceKind?: string | null
  resourceId?: string | null
}

describe('CommandBus change inference', () => {
  afterEach(() => {
    unregisterCommand('test.custom.update')
    unregisterCommand('test.log.override')
  })

  it('flattens custom field diffs into cf_ changes', async () => {
    const logMock = jest.fn(async (payload: LogRecord) => payload)

    registerCommand({
      id: 'test.custom.update',
      execute: jest.fn(async () => ({ id: 'rec-1' })),
      prepare: jest.fn(async () => ({
        before: { id: 'rec-1', custom: { priority: 1, tags: ['a'] } },
      })),
      captureAfter: jest.fn(async () => ({
        id: 'rec-1',
        custom: { priority: 2, tags: ['a', 'b'] },
      })),
    })

    const container = createContainer({ injectionMode: InjectionMode.CLASSIC })
    container.register({
      actionLogService: asValue({ log: logMock }),
      dataEngine: asValue({ flushOrmEntityChanges: jest.fn() }),
    })

    const bus = new CommandBus()
    const ctx = {
      container,
      auth: { sub: 'user-1', tenantId: 'tenant-1', orgId: 'org-1' },
      organizationScope: null,
      selectedOrganizationId: 'org-1',
      organizationIds: null,
    }

    await bus.execute('test.custom.update', {
      input: {},
      ctx,
      metadata: { resourceKind: 'test.record', resourceId: 'rec-1' },
    })

    expect(logMock).toHaveBeenCalled()
    const payload = logMock.mock.calls[0]?.[0] as LogRecord
    expect(payload?.changes).toEqual({
      cf_priority: { from: 1, to: 2 },
      cf_tags: { from: ['a'], to: ['a', 'b'] },
    })
  })

  it('prefers buildLog metadata over base metadata', async () => {
    const logMock = jest.fn(async (payload: LogRecord) => payload)

    registerCommand({
      id: 'test.log.override',
      execute: jest.fn(async () => ({ id: 'rec-1' })),
      buildLog: jest.fn(async () => ({
        resourceKind: 'test.person',
        resourceId: 'rec-1',
        actionLabel: 'Update person',
      })),
    })

    const container = createContainer({ injectionMode: InjectionMode.CLASSIC })
    container.register({
      actionLogService: asValue({ log: logMock }),
      dataEngine: asValue({ flushOrmEntityChanges: jest.fn() }),
    })

    const bus = new CommandBus()
    const ctx = {
      container,
      auth: { sub: 'user-1', tenantId: 'tenant-1', orgId: 'org-1' },
      organizationScope: null,
      selectedOrganizationId: 'org-1',
      organizationIds: null,
    }

    await bus.execute('test.log.override', {
      input: {},
      ctx,
      metadata: { resourceKind: 'test.people', resourceId: 'rec-1' },
    })

    const payload = logMock.mock.calls[0]?.[0] as LogRecord
    expect(payload?.resourceKind).toBe('test.person')
    expect(payload?.resourceId).toBe('rec-1')
  })
})
