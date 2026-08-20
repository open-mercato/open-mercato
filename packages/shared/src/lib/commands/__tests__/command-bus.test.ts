import { createContainer, asValue, InjectionMode } from 'awilix'
import {
  commandRegistry,
  registerCommand,
  registerCommandLoaders,
  CommandBus,
  isCommandInterceptorError,
} from '@open-mercato/shared/lib/commands'
import { registerCommandInterceptors } from '@open-mercato/shared/lib/commands/command-interceptor-store'
import type { CommandInterceptor } from '@open-mercato/shared/lib/commands/command-interceptor'

describe('CommandBus', () => {
  afterEach(() => {
    commandRegistry.clear()
    registerCommandInterceptors([])
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

  it('never persists secret-bearing redo input and disables undo for that execution', async () => {
    const logMock = jest.fn(async (payload: Record<string, unknown>) => payload)
    registerCommand({
      id: 'test.credential.update',
      execute: jest.fn(async () => ({ id: 'credential-1' })),
      buildLog: jest.fn(() => ({
        actionLabel: 'Update credential',
        resourceKind: 'test.credential',
        resourceId: 'credential-1',
        payload: {
          undo: { before: { passwordHash: 'stored-verifier' } },
        },
        snapshotBefore: { password: 'snapshot-secret', passwordHash: 'stored-verifier' },
        context: { accessToken: 'context-secret', source: 'test' },
      })),
      undo: jest.fn(async () => {}),
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

    await bus.execute('test.credential.update', {
      input: { currentPassword: 'CurrentPass1!', newPassword: 'NewPass2!' },
      ctx,
    })

    const persisted = logMock.mock.calls[0][0]
    expect(persisted.undoToken).toBeUndefined()
    expect(persisted.commandPayload).toEqual({
      undo: { before: { passwordHash: 'stored-verifier' } },
      __redoUnavailable: 'sensitive-data-redacted',
    })
    expect(persisted.snapshotBefore).toEqual({
      password: '[REDACTED]',
      passwordHash: 'stored-verifier',
    })
    expect(persisted.context).toEqual({ accessToken: '[REDACTED]', source: 'test' })
    expect(JSON.stringify(persisted)).not.toContain('CurrentPass1!')
    expect(JSON.stringify(persisted)).not.toContain('NewPass2!')
    expect(JSON.stringify(persisted)).not.toContain('snapshot-secret')
    expect(JSON.stringify(persisted)).not.toContain('context-secret')
  })

  it('retains undo and redo input for a non-sensitive command', async () => {
    const logMock = jest.fn(async (payload: Record<string, unknown>) => payload)
    registerCommand({
      id: 'test.profile.update',
      execute: jest.fn(async () => ({ id: 'profile-1' })),
      buildLog: jest.fn(() => ({
        actionLabel: 'Update profile',
        resourceKind: 'test.profile',
        resourceId: 'profile-1',
      })),
      undo: jest.fn(async () => {}),
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

    await bus.execute('test.profile.update', {
      input: { id: 'profile-1', displayName: 'Updated' },
      ctx,
    })

    const persisted = logMock.mock.calls[0][0]
    expect(persisted.undoToken).toEqual(expect.any(String))
    expect(persisted.commandPayload).toEqual({
      __redoInput: { id: 'profile-1', displayName: 'Updated' },
      value: null,
    })
  })

  it('honors an explicit sensitiveInput signal for opaque credential fields', async () => {
    const logMock = jest.fn(async (payload: Record<string, unknown>) => payload)
    registerCommand({
      id: 'test.opaque-secret.rotate',
      execute: jest.fn(async () => ({ ok: true })),
      buildLog: jest.fn(() => ({
        sensitiveInput: true,
        actionLabel: 'Rotate opaque secret',
        resourceKind: 'test.credential',
      })),
      undo: jest.fn(async () => {}),
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

    await bus.execute('test.opaque-secret.rotate', {
      input: { value: 'opaque-secret-value' },
      ctx,
    })

    const persisted = logMock.mock.calls[0][0]
    expect(persisted.undoToken).toBeUndefined()
    expect(persisted.commandPayload).toEqual({
      __redoUnavailable: 'sensitive-data-redacted',
    })
    expect(JSON.stringify(persisted)).not.toContain('opaque-secret-value')
  })

  describe('interceptor rejections', () => {
    const blockingInterceptor = (result: Record<string, unknown>): CommandInterceptor => ({
      id: 'test.block',
      targetCommand: 'test.*',
      beforeExecute: async () => result,
    })

    const runBlockedCommand = async (interceptor: CommandInterceptor) => {
      const execute = jest.fn(async () => ({ ok: true }))
      registerCommand({ id: 'test.command.blocked', execute })
      registerCommandInterceptors([{ moduleId: 'test', interceptors: [interceptor] }])

      const container = createContainer({ injectionMode: InjectionMode.CLASSIC })
      const bus = new CommandBus()
      const ctx = {
        container,
        auth: { sub: 'user-4', tenantId: 'tenant-4', orgId: null },
        organizationScope: null,
        selectedOrganizationId: null,
        organizationIds: null,
      }

      const error = await bus.execute('test.command.blocked', { input: {}, ctx }).catch((e: unknown) => e)
      return { error, execute }
    }

    it('forwards the interceptor status and derived body onto the thrown error', async () => {
      const { error, execute } = await runBlockedCommand(
        blockingInterceptor({ ok: false, message: 'Missing required fields: VAT id', status: 422 }),
      )

      expect(isCommandInterceptorError(error)).toBe(true)
      expect((error as { status?: number }).status).toBe(422)
      expect((error as { body?: Record<string, unknown> }).body).toEqual({
        error: 'Missing required fields: VAT id',
      })
      expect(execute).not.toHaveBeenCalled()
    })

    it('forwards an explicit interceptor body verbatim', async () => {
      const body = { error: 'Blocked', missingFields: ['vatId'] }
      const { error } = await runBlockedCommand(
        blockingInterceptor({ ok: false, message: 'Blocked', status: 409, body }),
      )

      expect((error as { status?: number }).status).toBe(409)
      expect((error as { body?: Record<string, unknown> }).body).toEqual(body)
    })

    it('leaves status and body undefined when the interceptor supplies no status', async () => {
      const { error } = await runBlockedCommand(blockingInterceptor({ ok: false, message: 'Blocked' }))

      expect(isCommandInterceptorError(error)).toBe(true)
      expect((error as Error).message).toBe('Blocked')
      expect((error as { status?: number }).status).toBeUndefined()
      expect((error as { body?: unknown }).body).toBeUndefined()
    })
  })
})
