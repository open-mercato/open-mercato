import { createContainer, asValue, InjectionMode } from 'awilix'
import {
  commandRegistry,
  registerCommand,
  registerCommandLoaders,
  CommandBus,
  isCommandInterceptorError,
} from '@open-mercato/shared/lib/commands'
import { registerCommandInterceptors } from '@open-mercato/shared/lib/commands/command-interceptor-store'
import type { CommandInterceptor, CommandInterceptorContext } from '@open-mercato/shared/lib/commands/command-interceptor'

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

  it('defers marked before snapshots until after the transactional write guard', async () => {
    const calls: string[] = []
    const transactionalEm = { id: 'transaction-em' }
    const buildLogMock = jest.fn(() => ({
      actionLabel: 'Transaction snapshot',
      resourceKind: 'test',
      resourceId: 'transactional',
    }))
    const prepare = Object.assign(
      jest.fn(async (_input, ctx) => {
        calls.push('prepare')
        expect(ctx.transactionalEm).toBe(transactionalEm)
        return { before: { state: 'locked-before' } }
      }),
      {
        [Symbol.for('open-mercato.commands.prepare-snapshot-after-transaction-guard')]: true as const,
      },
    )

    registerCommand({
      id: 'test.command.transactional-snapshot',
      prepare,
      execute: jest.fn(async (_input, ctx) => {
        calls.push('execute')
        await ctx.beforeTransactionalWrite?.(transactionalEm as never)
        calls.push('mutate')
        return { ok: true }
      }),
      buildLog: buildLogMock,
    })

    const logMock = jest.fn(async () => ({ id: 'transaction-log' }))
    const container = createContainer({ injectionMode: InjectionMode.CLASSIC })
    container.register({ actionLogService: asValue({ log: logMock }) })
    const bus = new CommandBus()
    const ctx = {
      container,
      auth: { sub: 'user-transaction', tenantId: 'tenant-transaction', orgId: null },
      organizationScope: null,
      selectedOrganizationId: null,
      organizationIds: null,
      beforeTransactionalWrite: jest.fn(async () => {
        calls.push('lock')
      }),
    }

    await bus.execute('test.command.transactional-snapshot', { input: {}, ctx })

    expect(calls).toEqual(['execute', 'lock', 'prepare', 'mutate'])
    expect(prepare).toHaveBeenCalledTimes(1)
    expect(buildLogMock).toHaveBeenCalledWith(expect.objectContaining({
      snapshots: { before: { state: 'locked-before' }, after: undefined },
    }))
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
    it('passes the original request to beforeExecute for preflight version checks', async () => {
      registerCommand({ id: 'test.request-context', execute: jest.fn(async () => ({ ok: true })) })
      const beforeExecute = jest.fn(async (_input: unknown, context: { request?: Request | null }) => {
        expect(context.request?.headers.get('x-om-ext-optimistic-lock-expected-updated-at')).toBe('2026-09-29T11:00:00.000Z')
        return { ok: false, status: 422 }
      })
      registerCommandInterceptors([{ moduleId: 'test', interceptors: [{
        id: 'test.request-context-interceptor', targetCommand: 'test.request-context', beforeExecute,
      }] }])
      const request = new Request('http://localhost/test', { headers: { 'x-om-ext-optimistic-lock-expected-updated-at': '2026-09-29T11:00:00.000Z' } })
      const container = createContainer({ injectionMode: InjectionMode.CLASSIC })
      const bus = new CommandBus()
      await expect(bus.execute('test.request-context', { input: {}, ctx: {
        container,
        auth: { sub: 'user-1', tenantId: 'tenant-1', orgId: null },
        organizationScope: null,
        selectedOrganizationId: null,
        organizationIds: null,
        request,
      } })).rejects.toMatchObject({ status: 422 })
      expect(beforeExecute).toHaveBeenCalledTimes(1)
    })

    it('passes request and organization scope to both execution lifecycle hooks', async () => {
      registerCommand({ id: 'test.lifecycle-context', execute: async () => ({ ok: true }) })
      const request = new Request('http://localhost/test')
      const organizationScope = { selectedId: 'parent', filterIds: ['parent', 'child'], allowedIds: ['parent', 'child'], tenantId: 'tenant-1' }
      const beforeExecute = jest.fn(async (_input: unknown, context: CommandInterceptorContext) => {
        expect(context.request).toBe(request)
        expect(context.organizationScope).toBe(organizationScope)
        return { ok: true }
      })
      const afterExecute = jest.fn(async (_input: unknown, _result: unknown, context: CommandInterceptorContext) => {
        expect(context.request).toBe(request)
        expect(context.organizationScope).toBe(organizationScope)
      })
      registerCommandInterceptors([{ moduleId: 'test', interceptors: [{
        id: 'test.lifecycle-context-interceptor', targetCommand: 'test.lifecycle-context', beforeExecute, afterExecute,
      }] }])
      await new CommandBus().execute('test.lifecycle-context', { input: {}, ctx: {
        container: createContainer({ injectionMode: InjectionMode.CLASSIC }),
        auth: { sub: 'user-1', tenantId: 'tenant-1', orgId: 'parent' },
        organizationScope, selectedOrganizationId: 'parent', organizationIds: ['parent', 'child'], request,
      } })
      expect(beforeExecute).toHaveBeenCalledTimes(1)
      expect(afterExecute).toHaveBeenCalledTimes(1)
    })

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
