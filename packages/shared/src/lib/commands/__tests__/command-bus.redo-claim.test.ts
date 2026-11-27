import { asValue, createContainer, InjectionMode } from 'awilix'
import { CommandBus, commandRegistry, registerCommand } from '@open-mercato/shared/lib/commands'

const COMMAND_ID = 'test.command.redo-claim'

type SourceState = { executionState: string }

function buildCasService(source: SourceState) {
  let logCount = 0
  return {
    log: jest.fn(async () => ({ id: `log-${++logCount}` })),
    claimForRedo: jest.fn(async () => {
      await Promise.resolve()
      if (source.executionState !== 'undone') return false
      source.executionState = 'redone'
      return true
    }),
    releaseRedoClaim: jest.fn(async () => {
      if (source.executionState !== 'redone') return false
      source.executionState = 'undone'
      return true
    }),
  }
}

function buildCtx(service: Record<string, unknown>) {
  const container = createContainer({ injectionMode: InjectionMode.CLASSIC })
  container.register({ actionLogService: asValue(service) })
  return {
    container,
    auth: { sub: 'user-1', tenantId: 'tenant-1', orgId: null },
    organizationScope: null,
    selectedOrganizationId: null,
    organizationIds: null,
  }
}

const sourceLog = { id: 'source-log', commandId: COMMAND_ID }

describe('CommandBus.execute redo source claim (non-atomic replay)', () => {
  afterEach(() => {
    commandRegistry.clear()
  })

  it('lets only one of two concurrent redos of the same source log run the command', async () => {
    const execute = jest.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5))
      return { ok: true }
    })
    registerCommand({ id: COMMAND_ID, execute, undo: jest.fn(async () => undefined) })
    const source = { executionState: 'undone' }
    const service = buildCasService(source)
    const ctx = buildCtx(service)
    const bus = new CommandBus()

    const outcomes = await Promise.allSettled([
      bus.execute(COMMAND_ID, { input: {}, ctx, redoLogEntry: sourceLog }),
      bus.execute(COMMAND_ID, { input: {}, ctx, redoLogEntry: sourceLog }),
    ])

    const fulfilled = outcomes.filter((outcome) => outcome.status === 'fulfilled')
    const rejected = outcomes.filter((outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected')
    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect(String(rejected[0].reason)).toContain('Redo source already consumed')
    expect((fulfilled[0] as PromiseFulfilledResult<{ replaySourceFinalized?: boolean }>).value.replaySourceFinalized).toBe(true)
    expect(execute).toHaveBeenCalledTimes(1)
    expect(service.log).toHaveBeenCalledTimes(1)
    expect(service.claimForRedo).toHaveBeenCalledWith('source-log')
    expect(service.releaseRedoClaim).not.toHaveBeenCalled()
    expect(source.executionState).toBe('redone')
  })

  it('releases the claim when the command fails so the redo can be retried', async () => {
    const execute = jest
      .fn<Promise<{ ok: boolean }>, []>()
      .mockRejectedValueOnce(new Error('handler boom'))
      .mockResolvedValueOnce({ ok: true })
    registerCommand({ id: COMMAND_ID, execute, undo: jest.fn(async () => undefined) })
    const source = { executionState: 'undone' }
    const service = buildCasService(source)
    const ctx = buildCtx(service)
    const bus = new CommandBus()

    await expect(
      bus.execute(COMMAND_ID, { input: {}, ctx, redoLogEntry: sourceLog }),
    ).rejects.toThrow('handler boom')
    expect(service.releaseRedoClaim).toHaveBeenCalledWith('source-log')
    expect(source.executionState).toBe('undone')

    const retry = await bus.execute(COMMAND_ID, { input: {}, ctx, redoLogEntry: sourceLog })
    expect(retry.result).toEqual({ ok: true })
    expect(source.executionState).toBe('redone')
  })

  it('keeps the original command error when releasing the claim fails', async () => {
    registerCommand({
      id: COMMAND_ID,
      execute: jest.fn(async () => {
        throw new Error('handler boom')
      }),
      undo: jest.fn(async () => undefined),
    })
    const source = { executionState: 'undone' }
    const service = {
      ...buildCasService(source),
      releaseRedoClaim: jest.fn(async () => {
        throw new Error('release boom')
      }),
    }
    const ctx = buildCtx(service)

    await expect(
      new CommandBus().execute(COMMAND_ID, { input: {}, ctx, redoLogEntry: sourceLog }),
    ).rejects.toThrow('handler boom')
    expect(service.releaseRedoClaim).toHaveBeenCalledTimes(1)
  })

  it('claims and releases on the caller transaction when ctx carries a transactional EntityManager', async () => {
    registerCommand({
      id: COMMAND_ID,
      execute: jest.fn(async () => {
        throw new Error('handler boom')
      }),
      undo: jest.fn(async () => undefined),
    })
    const source = { executionState: 'undone' }
    const service = buildCasService(source)
    const transactionalEm = { id: 'caller-transaction' }
    const ctx = { ...buildCtx(service), transactionalEm: transactionalEm as never }

    await expect(
      new CommandBus().execute(COMMAND_ID, { input: {}, ctx, redoLogEntry: sourceLog }),
    ).rejects.toThrow('handler boom')
    expect(service.claimForRedo).toHaveBeenCalledWith('source-log', transactionalEm)
    expect(service.releaseRedoClaim).toHaveBeenCalledWith('source-log', transactionalEm)
  })

  it('replays without a claim when the action log service cannot claim redo sources', async () => {
    const execute = jest.fn(async () => ({ ok: true }))
    registerCommand({ id: COMMAND_ID, execute, undo: jest.fn(async () => undefined) })
    const service = { log: jest.fn(async () => ({ id: 'new-log' })) }
    const ctx = buildCtx(service)

    const outcome = await new CommandBus().execute(COMMAND_ID, { input: {}, ctx, redoLogEntry: sourceLog })

    expect(execute).toHaveBeenCalledTimes(1)
    expect(outcome.replaySourceFinalized).toBe(false)
  })

  it('does not claim anything for a plain execute', async () => {
    registerCommand({ id: COMMAND_ID, execute: jest.fn(async () => ({ ok: true })) })
    const source = { executionState: 'undone' }
    const service = buildCasService(source)

    await new CommandBus().execute(COMMAND_ID, { input: {}, ctx: buildCtx(service) })

    expect(service.claimForRedo).not.toHaveBeenCalled()
    expect(source.executionState).toBe('undone')
  })
})
