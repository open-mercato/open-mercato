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
    unregisterCommand('test.updated.skip')
    unregisterCommand('test.date.mixed')
    unregisterCommand('test.date.equal')
    unregisterCommand('test.null.vs.object')
    unregisterCommand('test.circular.ref')
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

  it('treats Date and equivalent ISO string as equal', async () => {
    const logMock = jest.fn(async (payload: LogRecord) => payload)

    registerCommand({
      id: 'test.date.equal',
      execute: jest.fn(async () => ({ id: 'rec-d1' })),
      prepare: jest.fn(async () => ({
        before: {
          id: 'rec-d1',
          createdAt: new Date('2024-01-01T00:00:00.000Z'),
          name: 'Same',
        },
      })),
      captureAfter: jest.fn(async () => ({
        id: 'rec-d1',
        createdAt: '2024-01-01T00:00:00.000Z',
        name: 'Same',
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

    await bus.execute('test.date.equal', {
      input: {},
      ctx,
      metadata: { resourceKind: 'test.record', resourceId: 'rec-d1' },
    })

    const payload = logMock.mock.calls[0]?.[0] as LogRecord
    expect(payload?.changes).toBeUndefined()
  })

  it('detects change when Date values differ (Date vs string)', async () => {
    const logMock = jest.fn(async (payload: LogRecord) => payload)

    registerCommand({
      id: 'test.date.mixed',
      execute: jest.fn(async () => ({ id: 'rec-d2' })),
      prepare: jest.fn(async () => ({
        before: {
          id: 'rec-d2',
          dueDate: new Date('2024-01-01T00:00:00.000Z'),
        },
      })),
      captureAfter: jest.fn(async () => ({
        id: 'rec-d2',
        dueDate: '2024-06-15T12:00:00.000Z',
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

    await bus.execute('test.date.mixed', {
      input: {},
      ctx,
      metadata: { resourceKind: 'test.record', resourceId: 'rec-d2' },
    })

    const payload = logMock.mock.calls[0]?.[0] as LogRecord
    expect(payload?.changes).toMatchObject({
      dueDate: expect.objectContaining({ from: expect.anything(), to: expect.anything() }),
    })
  })

  it('treats null vs empty object as a change', async () => {
    const logMock = jest.fn(async (payload: LogRecord) => payload)

    registerCommand({
      id: 'test.null.vs.object',
      execute: jest.fn(async () => ({ id: 'rec-n1' })),
      prepare: jest.fn(async () => ({
        before: { id: 'rec-n1', metadata: null },
      })),
      captureAfter: jest.fn(async () => ({
        id: 'rec-n1',
        metadata: {},
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

    await bus.execute('test.null.vs.object', {
      input: {},
      ctx,
      metadata: { resourceKind: 'test.record', resourceId: 'rec-n1' },
    })

    const payload = logMock.mock.calls[0]?.[0] as LogRecord
    expect(payload?.changes).toEqual({
      metadata: { from: null, to: {} },
    })
  })

  it('handles circular references without stack overflow', async () => {
    const logMock = jest.fn(async (payload: LogRecord) => payload)

    const circular: Record<string, unknown> = { id: 'rec-c1', name: 'Before' }
    circular.self = circular

    const circularAfter: Record<string, unknown> = { id: 'rec-c1', name: 'After' }
    circularAfter.self = circularAfter

    registerCommand({
      id: 'test.circular.ref',
      execute: jest.fn(async () => ({ id: 'rec-c1' })),
      prepare: jest.fn(async () => ({ before: circular })),
      captureAfter: jest.fn(async () => circularAfter),
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

    await expect(
      bus.execute('test.circular.ref', {
        input: {},
        ctx,
        metadata: { resourceKind: 'test.record', resourceId: 'rec-c1' },
      }),
    ).resolves.not.toThrow()

    const payload = logMock.mock.calls[0]?.[0] as LogRecord
    expect(payload?.changes).toMatchObject({
      name: { from: 'Before', to: 'After' },
    })
  })

  it('skips updatedAt fields when inferring changes', async () => {
    const logMock = jest.fn(async (payload: LogRecord) => payload)

    registerCommand({
      id: 'test.updated.skip',
      execute: jest.fn(async () => ({ id: 'rec-2' })),
      prepare: jest.fn(async () => ({
        before: { id: 'rec-2', name: 'Old', updatedAt: '2026-02-05T10:00:00.000Z' },
      })),
      captureAfter: jest.fn(async () => ({
        id: 'rec-2',
        name: 'New',
        updatedAt: '2026-02-05T11:00:00.000Z',
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

    await bus.execute('test.updated.skip', {
      input: {},
      ctx,
      metadata: { resourceKind: 'test.record', resourceId: 'rec-2' },
    })

    const payload = logMock.mock.calls[0]?.[0] as LogRecord
    expect(payload?.changes).toEqual({
      name: { from: 'Old', to: 'New' },
    })
  })
})
