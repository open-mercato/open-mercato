import { asValue, createContainer, InjectionMode } from 'awilix'
import { CommandBus, registerCommand, unregisterCommand } from '@open-mercato/shared/lib/commands'
import { registerCommandInterceptors } from '@open-mercato/shared/lib/commands/command-interceptor-store'

type ReplayState = {
  domain: string
  source: 'done' | 'undoing' | 'undone' | 'redone'
  logs: number
}

function buildTransactionalEm(state: ReplayState) {
  let inTransaction = false
  let saved: ReplayState | null = null
  return {
    isInTransaction: () => inTransaction,
    begin: jest.fn(async () => {
      saved = { ...state }
      inTransaction = true
    }),
    commit: jest.fn(async () => {
      inTransaction = false
      saved = null
    }),
    rollback: jest.fn(async () => {
      if (saved) Object.assign(state, saved)
      inTransaction = false
      saved = null
    }),
    flush: jest.fn(async () => undefined),
    getUnitOfWork: () => ({
      computeChangeSets: () => undefined,
      getChangeSets: () => [],
    }),
  }
}

describe('CommandBus atomic replay', () => {
  afterEach(() => {
    unregisterCommand('auth.test.atomic-undo')
    unregisterCommand('auth.test.atomic-redo')
    registerCommandInterceptors([])
  })

  it('rolls back the undo mutation, source state, and trace log together', async () => {
    const state: ReplayState = { domain: 'after', source: 'done', logs: 1 }
    const em = buildTransactionalEm(state)
    const authorizeReplay = jest.fn(async ({ ctx }) => {
      expect(ctx.transactionalEm).toBe(em)
      expect(em.isInTransaction()).toBe(true)
    })
    const replayTransactionGuard = jest.fn(async ({ transactionalEm }) => {
      expect(transactionalEm).toBe(em)
      expect(em.isInTransaction()).toBe(true)
    })
    const getGrantedFeaturesWithEntityManager = jest.fn(async (operationEm: unknown) => {
      expect(operationEm).toBe(em)
      expect(em.isInTransaction()).toBe(true)
      return ['auth.test.replay']
    })
    const getGrantedFeatures = jest.fn(async () => {
      throw new Error('forking feature path must not run')
    })
    const beforeUndo = jest.fn(async () => {
      expect(em.isInTransaction()).toBe(true)
      return { ok: true }
    })
    registerCommandInterceptors([{
      moduleId: 'auth',
      interceptors: [{
        id: 'auth.test.atomic-interceptor',
        targetCommand: 'auth.test.atomic-undo',
        features: ['auth.test.replay'],
        beforeUndo,
      }],
    }])
    const service = {
      findByUndoToken: jest.fn(async () => ({
        id: 'source-log',
        commandId: 'auth.test.atomic-undo',
        commandPayload: {},
      })),
      claimForUndo: jest.fn(async (_id: string, operationEm: unknown) => {
        expect(operationEm).toBe(em)
        state.source = 'undoing'
        return true
      }),
      markUndone: jest.fn(async (_id: string, _trace: unknown, operationEm: unknown) => {
        expect(operationEm).toBe(em)
        state.source = 'undone'
        state.logs += 1
        throw new Error('finalization failed')
      }),
    }
    registerCommand({
      id: 'auth.test.atomic-undo',
      atomicReplay: true,
      execute: jest.fn(),
      authorizeReplay,
      undo: jest.fn(async ({ ctx }) => {
        expect(ctx.transactionalEm).toBe(em)
        state.domain = 'before'
      }),
    })
    const container = createContainer({ injectionMode: InjectionMode.CLASSIC })
    container.register({
      em: asValue(em),
      actionLogService: asValue(service),
      rbacService: asValue({ getGrantedFeatures, getGrantedFeaturesWithEntityManager }),
      dataEngine: asValue({ flushOrmEntityChanges: jest.fn(async () => undefined) }),
    })

    await expect(new CommandBus().undo('undo-token', {
      container,
      auth: { sub: 'actor', tenantId: 'tenant', orgId: null },
      replayTransactionGuard,
    })).rejects.toThrow('finalization failed')

    expect(state).toEqual({ domain: 'after', source: 'done', logs: 1 })
    expect(authorizeReplay).toHaveBeenCalledTimes(1)
    expect(replayTransactionGuard).toHaveBeenCalledTimes(1)
    expect(getGrantedFeaturesWithEntityManager).toHaveBeenCalledWith(
      em,
      'actor',
      { tenantId: 'tenant', organizationId: null },
    )
    expect(getGrantedFeatures).not.toHaveBeenCalled()
    expect(beforeUndo).toHaveBeenCalledTimes(1)
    expect(em.rollback).toHaveBeenCalledTimes(1)
  })

  it('rolls back redo domain, new log, and source finalization together', async () => {
    const state: ReplayState = { domain: 'before', source: 'undone', logs: 1 }
    const em = buildTransactionalEm(state)
    const authorizeReplay = jest.fn(async ({ ctx }) => {
      expect(ctx.transactionalEm).toBe(em)
      expect(em.isInTransaction()).toBe(true)
    })
    const service = {
      claimForRedo: jest.fn(async (_id: string, operationEm: unknown) => {
        expect(operationEm).toBe(em)
        state.source = 'redone'
        return true
      }),
      log: jest.fn(async (_input: unknown, operationEm: unknown) => {
        expect(operationEm).toBe(em)
        state.logs += 1
        throw new Error('new log failed')
      }),
    }
    registerCommand({
      id: 'auth.test.atomic-redo',
      atomicReplay: true,
      execute: jest.fn(),
      authorizeReplay,
      redo: jest.fn(async ({ ctx }) => {
        expect(ctx.transactionalEm).toBe(em)
        state.domain = 'after'
        return { ok: true }
      }),
      undo: jest.fn(),
      buildLog: () => ({ resourceKind: 'auth.test', resourceId: 'record' }),
    })
    const container = createContainer({ injectionMode: InjectionMode.CLASSIC })
    container.register({
      em: asValue(em),
      actionLogService: asValue(service),
      dataEngine: asValue({ flushOrmEntityChanges: jest.fn(async () => undefined) }),
    })

    await expect(new CommandBus().execute('auth.test.atomic-redo', {
      input: {},
      ctx: {
        container,
        auth: { sub: 'actor', tenantId: 'tenant', orgId: null },
      },
      redoLogEntry: { id: 'source-log', commandId: 'auth.test.atomic-redo' },
    })).rejects.toThrow('new log failed')

    expect(state).toEqual({ domain: 'before', source: 'undone', logs: 1 })
    expect(authorizeReplay).toHaveBeenCalledTimes(1)
    expect(em.rollback).toHaveBeenCalledTimes(1)
  })
})
