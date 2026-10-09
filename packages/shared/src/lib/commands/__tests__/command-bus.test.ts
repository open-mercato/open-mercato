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

  it('authorizes undo before claiming the log or running mutations', async () => {
    const authorizeReplay = jest.fn(async () => {
      throw new Error('replay denied')
    })
    const undo = jest.fn(async () => undefined)
    const claimForUndo = jest.fn(async () => true)
    const markUndone = jest.fn(async () => undefined)
    registerCommand({
      id: 'test.command.undo-guarded',
      execute: jest.fn(),
      authorizeReplay,
      undo,
    })

    const logEntry = {
      id: 'log-guarded',
      commandId: 'test.command.undo-guarded',
      commandPayload: { __redoInput: { id: 'record-1' } },
    }
    const container = createContainer({ injectionMode: InjectionMode.CLASSIC })
    container.register({
      actionLogService: asValue({
        findByUndoToken: jest.fn(async () => logEntry),
        claimForUndo,
        markUndone,
      }),
    })
    const ctx = {
      container,
      auth: { sub: 'user-1', tenantId: 'tenant-1', orgId: null },
      organizationScope: null,
      selectedOrganizationId: null,
      organizationIds: null,
    }

    await expect(new CommandBus().undo('undo-token', ctx)).rejects.toThrow('replay denied')

    expect(authorizeReplay).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'undo', logEntry })
    )
    expect(claimForUndo).not.toHaveBeenCalled()
    expect(undo).not.toHaveBeenCalled()
    expect(markUndone).not.toHaveBeenCalled()
  })

  it('authorizes redo before snapshots, mutations, or log writes', async () => {
    const authorizeReplay = jest.fn(async () => {
      throw new Error('redo denied')
    })
    const prepare = jest.fn(async () => ({ before: { value: 'before' } }))
    const execute = jest.fn(async () => ({ ok: true }))
    const undo = jest.fn(async () => undefined)
    const log = jest.fn(async () => ({ id: 'unexpected-log' }))
    registerCommand({
      id: 'test.command.redo-guarded',
      prepare,
      execute,
      authorizeReplay,
      undo,
    })

    const container = createContainer({ injectionMode: InjectionMode.CLASSIC })
    container.register({ actionLogService: asValue({ log }) })
    const ctx = {
      container,
      auth: { sub: 'user-1', tenantId: 'tenant-1', orgId: null },
      organizationScope: null,
      selectedOrganizationId: null,
      organizationIds: null,
    }

    await expect(
      new CommandBus().execute('test.command.redo-guarded', {
        input: { id: 'record-1' },
        ctx,
        redoLogEntry: { id: 'source-log', commandId: 'test.command.redo-guarded' },
      })
    ).rejects.toThrow('redo denied')

    expect(authorizeReplay).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'redo' })
    )
    expect(prepare).not.toHaveBeenCalled()
    expect(execute).not.toHaveBeenCalled()
    expect(log).not.toHaveBeenCalled()
  })

  it.each([
    ['auth.users.create', 'Password-bearing user create'],
    ['auth.users.update', 'Password-bearing user update'],
  ])('persists %s as audit-only without credentials, hashes, payload, or undo token', async (commandId, actionLabel) => {
    const log = jest.fn(async (entry: Record<string, unknown>) => ({ id: 'log-sensitive', ...entry }))
    registerCommand({
      id: commandId,
      execute: jest.fn(async () => ({ ok: true })),
      undo: jest.fn(async () => undefined),
      buildLog: jest.fn(() => ({
        replayable: false,
        actionLabel,
        resourceKind: 'auth.user',
        resourceId: 'user-1',
        snapshotAfter: { email: 'person@example.com' },
        payload: {
          undo: {
            after: {
              passwordHash: '$2b$10$persisted-hash-must-not-survive',
            },
          },
        },
      })),
    })

    const container = createContainer({ injectionMode: InjectionMode.CLASSIC })
    container.register({ actionLogService: asValue({ log }) })
    const ctx = {
      container,
      auth: { sub: 'user-1', tenantId: 'tenant-1', orgId: null },
      organizationScope: null,
      selectedOrganizationId: null,
      organizationIds: null,
    }

    await new CommandBus().execute(commandId, {
      input: { password: 'plain-text-secret' },
      ctx,
    })

    const persisted = log.mock.calls[0]?.[0]
    expect(persisted.undoToken).toBeUndefined()
    expect(persisted.commandPayload).toBeUndefined()
    const persistedJson = JSON.stringify(persisted)
    expect(persistedJson).not.toContain('plain-text-secret')
    expect(persistedJson).not.toContain('persisted-hash-must-not-survive')
    expect(persistedJson).not.toContain('passwordHash')
  })

  it('persists a redacted redoInput without dropping the undo token', async () => {
    // A credential-bearing create must keep the secret out of `action_logs`
    // WITHOUT losing undo: undoing a create only deletes the row, so suppressing
    // the whole entry (`replayable: false`) would remove a safe affordance.
    const log = jest.fn(async (entry: Record<string, unknown>) => ({ id: 'log-redacted', ...entry }))
    registerCommand({
      id: 'test.command.redacted-input',
      execute: jest.fn(async () => ({ ok: true })),
      undo: jest.fn(async () => undefined),
      buildLog: jest.fn(() => ({
        redoInput: { email: 'person@example.com' },
        actionLabel: 'Create user',
        resourceKind: 'auth.user',
        resourceId: 'user-1',
        payload: { undo: { after: { id: 'user-1', email: 'person@example.com' } } },
      })),
    })

    const container = createContainer({ injectionMode: InjectionMode.CLASSIC })
    container.register({ actionLogService: asValue({ log }) })

    await new CommandBus().execute('test.command.redacted-input', {
      input: { email: 'person@example.com', password: 'plain-text-secret' },
      ctx: {
        container,
        auth: { sub: 'user-1', tenantId: 'tenant-1', orgId: null },
        organizationScope: null,
        selectedOrganizationId: null,
        organizationIds: null,
      },
    })

    const persisted = log.mock.calls[0]?.[0] as Record<string, unknown>
    const commandPayload = persisted.commandPayload as Record<string, unknown>
    expect(typeof persisted.undoToken).toBe('string')
    expect(commandPayload.__redoInput).toEqual({ email: 'person@example.com' })
    expect(JSON.stringify(persisted)).not.toContain('plain-text-secret')
  })

  it('records the system actor marker when a trusted command has no auth actor', async () => {
    const logMock = jest.fn(async () => ({ id: 'system-log-entry' }))
    registerCommand({
      id: 'test.system-command',
      execute: jest.fn(async () => ({ ok: true })),
      buildLog: jest.fn(() => ({ actionLabel: 'System test', resourceKind: 'test', resourceId: 'system-123' })),
    })

    const container = createContainer({ injectionMode: InjectionMode.CLASSIC })
    container.register({ actionLogService: asValue({ log: logMock }) })

    const bus = new CommandBus()
    const ctx = {
      container,
      auth: null,
      organizationScope: null,
      selectedOrganizationId: null,
      organizationIds: null,
      systemActor: true,
    }

    await bus.execute('test.system-command', { input: {}, ctx })

    expect(logMock).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: undefined,
        context: { systemActor: 'system:command' },
      })
    )
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

  it('merges command interceptor beforeExecute returned metadata.logContext into logged context with correct precedence', async () => {
    const logMock = jest.fn(async () => ({ id: 'log-entry' }))
    registerCommand({
      id: 'test.command.interceptor-context',
      execute: jest.fn(async () => ({ ok: true })),
      buildLog: jest.fn(() => ({
        actionLabel: 'Test',
        resourceKind: 'test',
        resourceId: '123',
        context: {
          original: 'buildlog-original-value',
          interceptorOverridden: 'buildlog-takes-precedence',
        },
      })),
    })

    registerCommandInterceptors([
      {
        moduleId: 'test-module',
        interceptors: [
          {
            id: 'test-interceptor-priority-2',
            targetCommand: 'test.command.*',
            priority: 60, // runs second
            beforeExecute: async () => ({
              ok: true,
              metadata: {
                logContext: {
                  ip: '127.0.0.1',
                  requestId: 'req-second',
                  interceptorOverlap: 'second-wins',
                },
              },
            }),
          },
          {
            id: 'test-interceptor-priority-1',
            targetCommand: 'test.command.*',
            priority: 40, // runs first
            beforeExecute: async () => ({
              ok: true,
              metadata: {
                logContext: {
                  requestId: 'req-first',
                  interceptorOverlap: 'first-loss',
                  baseOverridden: 'interceptor-wins-over-base',
                  interceptorOverridden: 'interceptor-loss-to-buildlog',
                },
              },
            }),
          },
        ],
      },
    ])

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

    await bus.execute('test.command.interceptor-context', {
      input: {},
      ctx,
      metadata: {
        context: {
          original: 'base-original-value', // will be overridden by buildLog
          baseOverridden: 'base-original-to-be-overridden',
          untouched: 'base-untouched',
        },
      },
    })

    expect(logMock).toHaveBeenCalledWith(
      expect.objectContaining({
        context: {
          untouched: 'base-untouched',
          baseOverridden: 'interceptor-wins-over-base',
          requestId: 'req-second',
          interceptorOverlap: 'second-wins',
          ip: '127.0.0.1',
          original: 'buildlog-original-value',
          interceptorOverridden: 'buildlog-takes-precedence',
        },
      })
    )
  })

  it('does not promote a generic interceptor metadata.context key into the logged context', async () => {
    const logMock = jest.fn(async () => ({ id: 'log-entry' }))
    registerCommand({
      id: 'test.command.private-metadata',
      execute: jest.fn(async () => ({ ok: true })),
      buildLog: jest.fn(() => ({
        actionLabel: 'Test',
        resourceKind: 'test',
        resourceId: '123',
      })),
    })

    registerCommandInterceptors([
      {
        moduleId: 'test-module',
        interceptors: [
          {
            id: 'test-interceptor-private-metadata',
            targetCommand: 'test.command.*',
            beforeExecute: async () => ({
              ok: true,
              // `context` here is the interceptor's own after-hook state, not audit input.
              metadata: { context: { internalHandle: 'must-stay-private' } },
            }),
          },
        ],
      },
    ])

    const container = createContainer({ injectionMode: InjectionMode.CLASSIC })
    container.register({ actionLogService: asValue({ log: logMock }) })

    await new CommandBus().execute('test.command.private-metadata', {
      input: {},
      ctx: {
        container,
        auth: { sub: 'user-1', tenantId: 'tenant-1', orgId: null },
        organizationScope: null,
        selectedOrganizationId: null,
        organizationIds: null,
      },
      metadata: { context: { untouched: 'base-untouched' } },
    })

    expect(logMock).toHaveBeenCalledWith(
      expect.objectContaining({ context: { untouched: 'base-untouched' } })
    )
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
