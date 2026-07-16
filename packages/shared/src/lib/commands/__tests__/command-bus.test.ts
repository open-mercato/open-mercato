import { createContainer, asValue, InjectionMode } from 'awilix'
import {
  commandRegistry,
  registerCommand,
  registerCommandLoaders,
  CommandBus,
} from '@open-mercato/shared/lib/commands'

describe('CommandBus', () => {
  afterEach(() => {
    commandRegistry.clear()
  })

  it('executes registered command and logs action metadata', async () => {
    const logMock = jest.fn(async () => ({ id: 'log-entry' }))
    registerCommand({
      id: 'test.command',
      execute: jest.fn(async () => ({ ok: true })),
      buildLog: jest.fn(() => ({ actionLabel: 'Test', resourceKind: 'test', resourceId: '123' })),
    })

    const container = createContainer({ injectionMode: InjectionMode.CLASSIC })
    container.register({ actionLogService: asValue({ log: logMock }) })

    const bus = new CommandBus()
    const ctx = {
      container,
      auth: { sub: 'user-1', tenantId: 'tenant-1', orgId: null },
      organizationScope: null,
      selectedOrganizationId: null,
      organizationIds: null,
    }

    const { result, logEntry } = await bus.execute('test.command', { input: {}, ctx })

    expect(result).toEqual({ ok: true })
    expect(logMock).toHaveBeenCalledWith(
      expect.objectContaining({
        commandId: 'test.command',
        tenantId: 'tenant-1',
        actorUserId: 'user-1',
        resourceId: '123',
      })
    )
    expect(logEntry).toEqual({ id: 'log-entry' })
  })

  it('passes captureAfter snapshot to buildLog as snapshots.after', async () => {
    const logMock = jest.fn(async () => ({ id: 'log-entry-2' }))
    const buildLogMock = jest.fn(() => ({
      actionLabel: 'Test with capture',
      resourceKind: 'test',
      resourceId: '456',
    }))

    registerCommand({
      id: 'test.command.with-capture',
      prepare: jest.fn(async () => ({ before: { state: 'before-snapshot' } })),
      execute: jest.fn(async () => ({ id: 'result-123' })),
      captureAfter: jest.fn(async (_input, result) => ({ state: 'after-snapshot', resultId: result.id })),
      buildLog: buildLogMock,
    })

    const container = createContainer({ injectionMode: InjectionMode.CLASSIC })
    container.register({ actionLogService: asValue({ log: logMock }) })

    const bus = new CommandBus()
    const ctx = {
      container,
      auth: { sub: 'user-2', tenantId: 'tenant-2', orgId: null },
      organizationScope: null,
      selectedOrganizationId: null,
      organizationIds: null,
    }

    await bus.execute('test.command.with-capture', { input: { foo: 'bar' }, ctx })

    // Verify buildLog received both before and after snapshots
    expect(buildLogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        snapshots: {
          before: { state: 'before-snapshot' },
          after: { state: 'after-snapshot', resultId: 'result-123' },
        },
      })
    )
  })

  it('loads a command file lazily before execution', async () => {
    const execute = jest.fn(async () => ({ ok: true }))
    registerCommandLoaders([
      {
        moduleId: 'test',
        id: 'test.command.lazy',
        key: 'test:commands:lazy',
        load: async () => {
          registerCommand({
            id: 'test.command.lazy',
            execute,
          })
        },
      },
    ])

    const container = createContainer({ injectionMode: InjectionMode.CLASSIC })
    const bus = new CommandBus()
    const ctx = {
      container,
      auth: { sub: 'user-3', tenantId: 'tenant-3', orgId: null },
      organizationScope: null,
      selectedOrganizationId: null,
      organizationIds: null,
    }

    expect(commandRegistry.get('test.command.lazy')).toBeNull()

    const { result } = await bus.execute('test.command.lazy', { input: {}, ctx })

    expect(result).toEqual({ ok: true })
    expect(execute).toHaveBeenCalledTimes(1)
  })

  // Agent Identity & On-Behalf-Of (Wave 4 P2): when ctx.runAs is set the SAME
  // audit path attributes the write to the agent principal on behalf of the human,
  // sourced 'agent' — not a parallel audit route.
  it('stamps actorUserId=agent + onBehalfOfUserId=human + source=agent when ctx.runAs is set', async () => {
    const logMock = jest.fn(async () => ({ id: 'log-runas' }))
    registerCommand({
      id: 'test.command.runas',
      execute: jest.fn(async () => ({ ok: true })),
      buildLog: jest.fn(() => ({ actionLabel: 'Agent write', resourceKind: 'deal', resourceId: 'deal-9' })),
    })

    const container = createContainer({ injectionMode: InjectionMode.CLASSIC })
    container.register({ actionLogService: asValue({ log: logMock }) })

    const bus = new CommandBus()
    const ctx = {
      container,
      // The invoking human still carries the JWT auth, but runAs overrides the actor.
      auth: { sub: 'human-1', tenantId: 'tenant-1', orgId: 'org-1' },
      organizationScope: null,
      selectedOrganizationId: 'org-1',
      organizationIds: ['org-1'],
      runAs: { actorUserId: 'agent-user-1', onBehalfOfUserId: 'human-1', source: 'agent' as const },
    }

    await bus.execute('test.command.runas', { input: {}, ctx })

    expect(logMock).toHaveBeenCalledWith(
      expect.objectContaining({
        commandId: 'test.command.runas',
        actorUserId: 'agent-user-1',
        onBehalfOfUserId: 'human-1',
        context: expect.objectContaining({ source: 'agent' }),
      })
    )
  })

  it('does not set onBehalfOfUserId for ordinary (non-runAs) human writes — additive default', async () => {
    const logMock = jest.fn(async () => ({ id: 'log-plain' }))
    registerCommand({
      id: 'test.command',
      execute: jest.fn(async () => ({ ok: true })),
      buildLog: jest.fn(() => ({ actionLabel: 'Plain', resourceKind: 'test', resourceId: '7' })),
    })

    const container = createContainer({ injectionMode: InjectionMode.CLASSIC })
    container.register({ actionLogService: asValue({ log: logMock }) })

    const bus = new CommandBus()
    const ctx = {
      container,
      auth: { sub: 'user-1', tenantId: 'tenant-1', orgId: null },
      organizationScope: null,
      selectedOrganizationId: null,
      organizationIds: null,
    }

    await bus.execute('test.command', { input: {}, ctx })

    const payload = logMock.mock.calls[0][0] as Record<string, unknown>
    expect(payload.actorUserId).toBe('user-1')
    expect(payload.onBehalfOfUserId).toBeUndefined()
  })
})
