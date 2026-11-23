import { createContainer, asValue, InjectionMode } from 'awilix'
import { commandRegistry, registerCommand, CommandBus } from '@open-mercato/shared/lib/commands'
import { buildTrustedCommandContext } from '@open-mercato/shared/lib/commands/trusted-context'
import { ensureOrganizationScope, ensureTenantScope } from '@open-mercato/shared/lib/commands/scope'
import { registerCommandInterceptors } from '@open-mercato/shared/lib/commands/command-interceptor-store'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands/types'

type ScopedInput = { tenantId: string; organizationId: string }

const COMMAND_ID = 'test.trusted-context.scoped'

function registerScopedCommand() {
  const execute = jest.fn(async (input: ScopedInput, ctx: CommandRuntimeContext) => {
    ensureTenantScope(ctx, input.tenantId)
    ensureOrganizationScope(ctx, input.organizationId)
    return { ok: true }
  })
  registerCommand<ScopedInput, { ok: boolean }>({
    id: COMMAND_ID,
    execute,
    buildLog: () => ({ actionLabel: 'Trusted scoped', resourceKind: 'test', resourceId: 'record-1' }),
  })
  return execute
}

function createRuntime() {
  const logMock = jest.fn(async () => ({ id: 'log-entry' }))
  const container = createContainer({ injectionMode: InjectionMode.CLASSIC })
  container.register({ actionLogService: asValue({ log: logMock }) })
  return { container, logMock, bus: new CommandBus() }
}

describe('buildTrustedCommandContext through the command bus', () => {
  afterEach(() => {
    commandRegistry.clear()
    registerCommandInterceptors([])
  })

  it('records the trusted-context marker and reason for an authorized system execution', async () => {
    const execute = registerScopedCommand()
    const { container, logMock, bus } = createRuntime()
    const { ctx, auditMetadata } = buildTrustedCommandContext({
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      actorType: 'system',
      reason: 'checkout.recovery.relock',
    })

    const { result } = await bus.execute(COMMAND_ID, {
      input: { tenantId: 'tenant-1', organizationId: 'org-1' },
      ctx: { ...ctx, container },
      metadata: auditMetadata,
    })

    expect(result).toEqual({ ok: true })
    expect(execute.mock.calls[0][1].systemActor).toBe(true)
    expect(execute.mock.calls[0][1].organizationScope?.tenantId).toBe('tenant-1')
    expect(logMock).toHaveBeenCalledTimes(1)
    expect(logMock).toHaveBeenCalledWith(
      expect.objectContaining({
        commandId: COMMAND_ID,
        tenantId: 'tenant-1',
        organizationId: 'org-1',
        actorUserId: undefined,
        context: expect.objectContaining({
          systemActor: 'system:trusted-context',
          reason: 'checkout.recovery.relock',
        }),
      }),
    )
  })

  it('attributes a user execution to the actor without a systemActor flag', async () => {
    const execute = registerScopedCommand()
    const { container, logMock, bus } = createRuntime()
    const { ctx, auditMetadata } = buildTrustedCommandContext({
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      actorType: 'user',
      actorId: 'user-42',
      reason: 'cart.proposal.re_author',
    })

    await bus.execute(COMMAND_ID, {
      input: { tenantId: 'tenant-1', organizationId: 'org-1' },
      ctx: { ...ctx, container },
      metadata: auditMetadata,
    })

    const executedCtx = execute.mock.calls[0][1]
    expect(executedCtx.systemActor).toBeUndefined()
    expect(executedCtx.auth?.sub).toBe('user-42')
    expect(logMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        organizationId: 'org-1',
        actorUserId: 'user-42',
        context: expect.objectContaining({
          systemActor: 'system:trusted-context',
          reason: 'cart.proposal.re_author',
        }),
      }),
    )
  })

  it.each([
    ['another organization', { tenantId: 'tenant-1', organizationId: 'org-2' }],
    ['another tenant', { tenantId: 'tenant-2', organizationId: 'org-1' }],
  ])('denies a user context targeting %s and writes no audit entry', async (_label, input) => {
    registerScopedCommand()
    const { container, logMock, bus } = createRuntime()
    const { ctx, auditMetadata } = buildTrustedCommandContext({
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      actorType: 'user',
      actorId: 'user-42',
      reason: 'cart.proposal.re_author',
    })

    await expect(
      bus.execute(COMMAND_ID, { input, ctx: { ...ctx, container }, metadata: auditMetadata }),
    ).rejects.toMatchObject({ status: 403 })
    expect(logMock).not.toHaveBeenCalled()
  })

  it.each([
    ['another organization', { tenantId: 'tenant-1', organizationId: 'org-2' }],
    ['another tenant', { tenantId: 'tenant-2', organizationId: 'org-1' }],
  ])('denies a system context targeting %s and writes no audit entry', async (_label, input) => {
    const execute = registerScopedCommand()
    const { container, logMock, bus } = createRuntime()
    const { ctx, auditMetadata } = buildTrustedCommandContext({
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      actorType: 'system',
      reason: 'checkout.recovery.relock',
    })

    await expect(
      bus.execute(COMMAND_ID, { input, ctx: { ...ctx, container }, metadata: auditMetadata }),
    ).rejects.toMatchObject({ status: 403 })
    expect(execute).toHaveBeenCalledTimes(1)
    expect(logMock).not.toHaveBeenCalled()
  })
})
