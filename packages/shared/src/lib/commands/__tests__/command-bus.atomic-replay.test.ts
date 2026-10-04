import { asValue, createContainer, InjectionMode } from 'awilix'
import { CommandBus, registerCommand, unregisterCommand } from '@open-mercato/shared/lib/commands'
import { registerCommandInterceptors } from '@open-mercato/shared/lib/commands/command-interceptor-store'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import {
  getTransactionLifetime,
  onTransactionLifetimeComplete,
} from '@open-mercato/shared/lib/commands/transaction-lifetime'
import type { CommandExecuteResult } from '@open-mercato/shared/lib/commands/types'

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
    unregisterCommand('auth.test.feature-race')
    unregisterCommand('auth.test.ambient-undo')
    unregisterCommand('auth.test.ambient-redo')
    registerCommandInterceptors([])
  })

  it('fails closed before an atomic replay joins an ambient transaction without its owner lifetime', async () => {
    const state: ReplayState = { domain: 'after', source: 'done', logs: 1 }
    const em = buildTransactionalEm(state)
    await em.begin()
    const service = {
      findByUndoToken: jest.fn(async () => ({
        id: 'source-log',
        commandId: 'auth.test.ambient-undo',
        commandPayload: {},
      })),
      claimForUndo: jest.fn(async () => true),
      markUndone: jest.fn(async () => undefined),
    }
    const undo = jest.fn(async () => {
      state.domain = 'before'
    })
    registerCommand({
      id: 'auth.test.ambient-undo',
      atomicReplay: true,
      execute: jest.fn(),
      undo,
    })
    const container = createContainer({ injectionMode: InjectionMode.CLASSIC })
    container.register({
      em: asValue(em),
      actionLogService: asValue(service),
      dataEngine: asValue({ flushOrmEntityChanges: jest.fn(async () => undefined) }),
    })

    await expect(new CommandBus().undo('undo-token', {
      container,
      auth: null,
      transactionalEm: em as never,
    } as never)).rejects.toThrow('Ambient atomic replay requires its outer transaction lifetime owner')

    expect(service.claimForUndo).not.toHaveBeenCalled()
    expect(service.markUndone).not.toHaveBeenCalled()
    expect(undo).not.toHaveBeenCalled()
    await em.rollback()
  })

  it('defers ambient undo completion effects until the true outer commit', async () => {
    const state: ReplayState = { domain: 'after', source: 'done', logs: 1 }
    const em = buildTransactionalEm(state)
    const afterUndo = jest.fn(async () => undefined)
    const flushOrmEntityChanges = jest.fn(async () => undefined)
    let replayLeaseHeld = false
    registerCommandInterceptors([{
      moduleId: 'auth',
      interceptors: [{
        id: 'auth.test.ambient-undo-interceptor',
        targetCommand: 'auth.test.ambient-undo',
        afterUndo,
      }],
    }])
    const service = {
      findByUndoToken: jest.fn(async () => ({
        id: 'source-log',
        commandId: 'auth.test.ambient-undo',
        commandPayload: {},
      })),
      claimForUndo: jest.fn(async () => {
        state.source = 'undoing'
        return true
      }),
      markUndone: jest.fn(async () => {
        state.source = 'undone'
        state.logs += 1
      }),
    }
    registerCommand({
      id: 'auth.test.ambient-undo',
      atomicReplay: true,
      execute: jest.fn(),
      stabilizeReplay: jest.fn(async ({ ctx }) => {
        expect(ctx.transactionLifetime).toBe(getTransactionLifetime(em as never))
        replayLeaseHeld = true
        onTransactionLifetimeComplete(em as never, () => {
          replayLeaseHeld = false
        })
      }),
      undo: jest.fn(async () => {
        state.domain = 'before'
      }),
    })
    const container = createContainer({ injectionMode: InjectionMode.CLASSIC })
    container.register({
      em: asValue(em),
      actionLogService: asValue(service),
      dataEngine: asValue({ flushOrmEntityChanges }),
    })

    await withAtomicFlush(em as never, [async () => {
      const transactionLifetime = getTransactionLifetime(em as never)
      expect(transactionLifetime).not.toBeNull()
      await new CommandBus().undo('undo-token', {
        container,
        auth: null,
        transactionalEm: em as never,
        transactionLifetime: transactionLifetime!,
      } as never)

      expect(state).toEqual({ domain: 'before', source: 'undone', logs: 2 })
      expect(replayLeaseHeld).toBe(true)
      expect(afterUndo).not.toHaveBeenCalled()
      expect(flushOrmEntityChanges).not.toHaveBeenCalled()
    }], { transaction: true })

    expect(replayLeaseHeld).toBe(false)
    expect(afterUndo).toHaveBeenCalledTimes(1)
    expect(flushOrmEntityChanges).toHaveBeenCalledTimes(1)
    expect(em.commit.mock.invocationCallOrder[0]).toBeLessThan(afterUndo.mock.invocationCallOrder[0])
    expect(state).toEqual({ domain: 'before', source: 'undone', logs: 2 })
  })

  it('releases the ambient undo lease and suppresses completion effects on outer rollback', async () => {
    const state: ReplayState = { domain: 'after', source: 'done', logs: 1 }
    const em = buildTransactionalEm(state)
    const afterUndo = jest.fn(async () => undefined)
    const flushOrmEntityChanges = jest.fn(async () => undefined)
    const rollbackError = new Error('outer undo rollback')
    let replayLeaseHeld = false
    registerCommandInterceptors([{
      moduleId: 'auth',
      interceptors: [{
        id: 'auth.test.ambient-undo-interceptor',
        targetCommand: 'auth.test.ambient-undo',
        afterUndo,
      }],
    }])
    const service = {
      findByUndoToken: jest.fn(async () => ({
        id: 'source-log',
        commandId: 'auth.test.ambient-undo',
        commandPayload: {},
      })),
      claimForUndo: jest.fn(async () => {
        state.source = 'undoing'
        return true
      }),
      markUndone: jest.fn(async () => {
        state.source = 'undone'
        state.logs += 1
      }),
    }
    registerCommand({
      id: 'auth.test.ambient-undo',
      atomicReplay: true,
      execute: jest.fn(),
      stabilizeReplay: jest.fn(async () => {
        replayLeaseHeld = true
        onTransactionLifetimeComplete(em as never, () => {
          replayLeaseHeld = false
        })
      }),
      undo: jest.fn(async () => {
        state.domain = 'before'
      }),
    })
    const container = createContainer({ injectionMode: InjectionMode.CLASSIC })
    container.register({
      em: asValue(em),
      actionLogService: asValue(service),
      dataEngine: asValue({ flushOrmEntityChanges }),
    })

    await expect(withAtomicFlush(em as never, [async () => {
      const transactionLifetime = getTransactionLifetime(em as never)
      await new CommandBus().undo('undo-token', {
        container,
        auth: null,
        transactionalEm: em as never,
        transactionLifetime: transactionLifetime!,
      } as never)
      expect(replayLeaseHeld).toBe(true)
      throw rollbackError
    }], { transaction: true })).rejects.toBe(rollbackError)

    expect(replayLeaseHeld).toBe(false)
    expect(afterUndo).not.toHaveBeenCalled()
    expect(flushOrmEntityChanges).not.toHaveBeenCalled()
    expect(state).toEqual({ domain: 'after', source: 'done', logs: 1 })
  })

  it('reports ambient redo finalization and runs effects only after the outer commit', async () => {
    const state: ReplayState = { domain: 'before', source: 'undone', logs: 1 }
    const em = buildTransactionalEm(state)
    const afterExecute = jest.fn(async () => ({ modifiedResult: { committed: true } }))
    const flushOrmEntityChanges = jest.fn(async () => undefined)
    let replayLeaseHeld = false
    let executionResult: CommandExecuteResult<{ ok: boolean; committed?: boolean }> | null = null
    registerCommandInterceptors([{
      moduleId: 'auth',
      interceptors: [{
        id: 'auth.test.ambient-redo-interceptor',
        targetCommand: 'auth.test.ambient-redo',
        afterExecute,
      }],
    }])
    const service = {
      claimForRedo: jest.fn(async () => {
        state.source = 'redone'
        return true
      }),
      log: jest.fn(async () => {
        state.logs += 1
        return { id: 'redo-log' }
      }),
    }
    registerCommand({
      id: 'auth.test.ambient-redo',
      atomicReplay: true,
      execute: jest.fn(),
      stabilizeReplay: jest.fn(async () => {
        replayLeaseHeld = true
        onTransactionLifetimeComplete(em as never, () => {
          replayLeaseHeld = false
        })
      }),
      redo: jest.fn(async () => {
        state.domain = 'after'
        return { ok: true }
      }),
      undo: jest.fn(),
      buildLog: () => ({}),
    })
    const container = createContainer({ injectionMode: InjectionMode.CLASSIC })
    container.register({
      em: asValue(em),
      actionLogService: asValue(service),
      dataEngine: asValue({ flushOrmEntityChanges }),
    })

    await withAtomicFlush(em as never, [async () => {
      const transactionLifetime = getTransactionLifetime(em as never)
      executionResult = await new CommandBus().execute('auth.test.ambient-redo', {
        input: {},
        ctx: {
          container,
          auth: null,
          transactionalEm: em as never,
          transactionLifetime: transactionLifetime!,
        } as never,
        redoLogEntry: { id: 'source-log', commandId: 'auth.test.ambient-redo' },
      })

      expect(executionResult.replaySourceFinalized).toBe(false)
      expect(executionResult.result).toEqual({ ok: true })
      expect(replayLeaseHeld).toBe(true)
      expect(afterExecute).not.toHaveBeenCalled()
      expect(flushOrmEntityChanges).not.toHaveBeenCalled()
    }], { transaction: true })

    expect(executionResult!.replaySourceFinalized).toBe(true)
    expect(executionResult!.result).toEqual({ ok: true, committed: true })
    expect(replayLeaseHeld).toBe(false)
    expect(afterExecute).toHaveBeenCalledTimes(1)
    expect(flushOrmEntityChanges).toHaveBeenCalledTimes(1)
    expect(em.commit.mock.invocationCallOrder[0]).toBeLessThan(afterExecute.mock.invocationCallOrder[0])
    expect(state).toEqual({ domain: 'after', source: 'redone', logs: 2 })
  })

  it('keeps ambient redo unfinalized and suppresses effects after outer rollback', async () => {
    const state: ReplayState = { domain: 'before', source: 'undone', logs: 1 }
    const em = buildTransactionalEm(state)
    const afterExecute = jest.fn(async () => ({ modifiedResult: { committed: true } }))
    const flushOrmEntityChanges = jest.fn(async () => undefined)
    const rollbackError = new Error('outer redo rollback')
    let replayLeaseHeld = false
    let executionResult: CommandExecuteResult<{ ok: boolean; committed?: boolean }> | null = null
    registerCommandInterceptors([{
      moduleId: 'auth',
      interceptors: [{
        id: 'auth.test.ambient-redo-interceptor',
        targetCommand: 'auth.test.ambient-redo',
        afterExecute,
      }],
    }])
    const service = {
      claimForRedo: jest.fn(async () => {
        state.source = 'redone'
        return true
      }),
      log: jest.fn(async () => {
        state.logs += 1
        return { id: 'redo-log' }
      }),
    }
    registerCommand({
      id: 'auth.test.ambient-redo',
      atomicReplay: true,
      execute: jest.fn(),
      stabilizeReplay: jest.fn(async () => {
        replayLeaseHeld = true
        onTransactionLifetimeComplete(em as never, () => {
          replayLeaseHeld = false
        })
      }),
      redo: jest.fn(async () => {
        state.domain = 'after'
        return { ok: true }
      }),
      undo: jest.fn(),
      buildLog: () => ({}),
    })
    const container = createContainer({ injectionMode: InjectionMode.CLASSIC })
    container.register({
      em: asValue(em),
      actionLogService: asValue(service),
      dataEngine: asValue({ flushOrmEntityChanges }),
    })

    await expect(withAtomicFlush(em as never, [async () => {
      const transactionLifetime = getTransactionLifetime(em as never)
      executionResult = await new CommandBus().execute('auth.test.ambient-redo', {
        input: {},
        ctx: {
          container,
          auth: null,
          transactionalEm: em as never,
          transactionLifetime: transactionLifetime!,
        } as never,
        redoLogEntry: { id: 'source-log', commandId: 'auth.test.ambient-redo' },
      })
      expect(executionResult.replaySourceFinalized).toBe(false)
      throw rollbackError
    }], { transaction: true })).rejects.toBe(rollbackError)

    expect(executionResult!.replaySourceFinalized).toBe(false)
    expect(executionResult!.result).toEqual({ ok: true })
    expect(replayLeaseHeld).toBe(false)
    expect(afterExecute).not.toHaveBeenCalled()
    expect(flushOrmEntityChanges).not.toHaveBeenCalled()
    expect(state).toEqual({ domain: 'before', source: 'undone', logs: 1 })
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

  it('stabilizes replay authorization before resolving a newly applicable blocking interceptor', async () => {
    const state: ReplayState = { domain: 'after', source: 'done', logs: 1 }
    const em = buildTransactionalEm(state)
    let stabilized = false
    const beforeUndo = jest.fn(async () => ({ ok: false, message: 'blocked after grant' }))
    registerCommandInterceptors([{
      moduleId: 'auth',
      interceptors: [{
        id: 'auth.test.feature-race-interceptor',
        targetCommand: 'auth.test.feature-race',
        features: ['auth.test.newly-granted'],
        beforeUndo,
      }],
    }])
    const service = {
      findByUndoToken: jest.fn(async () => ({
        id: 'feature-race-log',
        commandId: 'auth.test.feature-race',
        commandPayload: {},
      })),
      claimForUndo: jest.fn(async () => true),
      releaseUndoClaim: jest.fn(async () => true),
      markUndone: jest.fn(async () => undefined),
    }
    const undo = jest.fn(async () => {
      state.domain = 'before'
    })
    registerCommand({
      id: 'auth.test.feature-race',
      atomicReplay: true,
      execute: jest.fn(),
      stabilizeReplay: jest.fn(async ({ ctx }) => {
        expect(ctx.transactionalEm).toBe(em)
        expect(em.isInTransaction()).toBe(true)
        stabilized = true
      }),
      undo,
    })
    const getGrantedFeaturesWithEntityManager = jest.fn(async () => {
      expect(stabilized).toBe(true)
      return ['auth.test.newly-granted']
    })
    const container = createContainer({ injectionMode: InjectionMode.CLASSIC })
    container.register({
      em: asValue(em),
      actionLogService: asValue(service),
      rbacService: asValue({ getGrantedFeaturesWithEntityManager }),
      dataEngine: asValue({ flushOrmEntityChanges: jest.fn(async () => undefined) }),
    })

    await expect(new CommandBus().undo('feature-race-token', {
      container,
      auth: { sub: 'actor', tenantId: 'tenant', orgId: null },
      replayTransactionGuard: jest.fn(async () => {
        expect(em.isInTransaction()).toBe(true)
        expect(stabilized).toBe(true)
      }),
    })).rejects.toThrow('blocked after grant')

    expect(beforeUndo).toHaveBeenCalledTimes(1)
    expect(service.claimForUndo).not.toHaveBeenCalled()
    expect(undo).not.toHaveBeenCalled()
    expect(state).toEqual({ domain: 'after', source: 'done', logs: 1 })
    expect(em.rollback).toHaveBeenCalledTimes(1)
  })
})
