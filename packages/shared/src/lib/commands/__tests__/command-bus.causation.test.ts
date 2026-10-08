import { asValue, createContainer, InjectionMode, type AwilixContainer } from 'awilix'
import { CommandBus, commandRegistry, registerCommand } from '@open-mercato/shared/lib/commands'
import { registerCommandInterceptors } from '@open-mercato/shared/lib/commands/command-interceptor-store'
import type { CommandInterceptor } from '@open-mercato/shared/lib/commands/command-interceptor'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { getTransactionLifetime } from '@open-mercato/shared/lib/commands/transaction-lifetime'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands/types'
import {
  createCausationEnvelope,
  getAmbientCausation,
  runWithCausation,
} from '@open-mercato/shared/lib/causation/server'
import type { CausationEnvelope } from '@open-mercato/shared/lib/causation/types'

const TENANT_ID = '10000000-0000-4000-8000-000000000001'
const ORG_ID = '10000000-0000-4000-8000-000000000002'
const USER_ID = '10000000-0000-4000-8000-000000000003'
const ORIGINAL_ACTOR_ID = '10000000-0000-4000-8000-000000000004'
const CORRELATION_ID = '11111111-1111-4111-8111-111111111111'
const LOG_ID = '22222222-2222-4222-8222-222222222222'
const FOLLOW_UP_LOG_ID = '33333333-3333-4333-8333-333333333333'
const SOURCE_LOG_ID = '44444444-4444-4444-8444-444444444444'
const KEY_ID = '55555555-5555-4555-8555-555555555555'
const WORKFLOW_INSTANCE_ID = '66666666-6666-4666-8666-666666666666'
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const SPOOFED_CAUSATION: CausationEnvelope = {
  correlationId: CORRELATION_ID,
  frames: [{ kind: 'workflow', id: WORKFLOW_INSTANCE_ID }],
}

type RecordedLogCall = {
  payload: Record<string, unknown>
  argumentCount: number
  causation: CausationEnvelope | null | undefined
  ambient: CausationEnvelope | null
}

function createLogRecorder(logIds: string[] = [LOG_ID]) {
  const calls: RecordedLogCall[] = []
  const log = jest.fn(async (...args: unknown[]) => {
    const payload = args[0] as Record<string, unknown>
    calls.push({
      payload,
      argumentCount: args.length,
      causation: args[2] as CausationEnvelope | null | undefined,
      ambient: getAmbientCausation(),
    })
    return { id: logIds[calls.length - 1] ?? `log-${calls.length}`, ...payload }
  })
  return { log, calls }
}

function buildContext(container: AwilixContainer, overrides: Partial<CommandRuntimeContext> = {}): CommandRuntimeContext {
  return {
    container,
    auth: { sub: USER_ID, tenantId: TENANT_ID, orgId: ORG_ID },
    organizationScope: null,
    selectedOrganizationId: ORG_ID,
    organizationIds: [ORG_ID],
    ...overrides,
  }
}

function registerInterceptor(interceptor: CommandInterceptor) {
  registerCommandInterceptors([{ moduleId: 'test', interceptors: [interceptor] }])
}

function buildTransactionalEm() {
  let inTransaction = false
  return {
    isInTransaction: () => inTransaction,
    begin: jest.fn(async () => {
      inTransaction = true
    }),
    commit: jest.fn(async () => {
      inTransaction = false
    }),
    rollback: jest.fn(async () => {
      inTransaction = false
    }),
    flush: jest.fn(async () => undefined),
    getUnitOfWork: () => ({
      computeChangeSets: () => undefined,
      getChangeSets: () => [],
    }),
  }
}

describe('CommandBus causation', () => {
  const previousCausationFlag = process.env.OM_CAUSATION

  afterEach(() => {
    commandRegistry.clear()
    registerCommandInterceptors([])
    if (previousCausationFlag === undefined) delete process.env.OM_CAUSATION
    else process.env.OM_CAUSATION = previousCausationFlag
  })

  it('resolves an auth-derived envelope, runs the command inside it and hands it to the log service', async () => {
    let ambientInPrepare: CausationEnvelope | null = null
    let ambientInExecute: CausationEnvelope | null = null
    let ambientInBuildLog: CausationEnvelope | null = null
    registerCommand({
      id: 'test.causation.basic',
      prepare: async () => {
        ambientInPrepare = getAmbientCausation()
        return { before: { name: 'old' } }
      },
      execute: async () => {
        ambientInExecute = getAmbientCausation()
        return { ok: true }
      },
      buildLog: () => {
        ambientInBuildLog = getAmbientCausation()
        return { resourceKind: 'test', resourceId: 'record-1' }
      },
    })
    const { log, calls } = createLogRecorder()
    const container = createContainer({ injectionMode: InjectionMode.CLASSIC })
    container.register({ actionLogService: asValue({ log }) })

    await new CommandBus().execute('test.causation.basic', { input: {}, ctx: buildContext(container) })

    expect(calls).toHaveLength(1)
    const envelope = calls[0].causation
    expect(envelope?.frames).toEqual([{ kind: 'user' }])
    expect(envelope?.correlationId).toMatch(UUID_PATTERN)
    expect(calls[0].argumentCount).toBe(3)
    expect(ambientInPrepare).toEqual(envelope)
    expect(ambientInExecute).toEqual(envelope)
    expect(ambientInBuildLog).toEqual(envelope)
    expect(calls[0].ambient).toEqual(envelope)
    expect(getAmbientCausation()).toBeNull()
  })

  it('inherits the ambient envelope and its correlation id', async () => {
    registerCommand({
      id: 'test.causation.ambient',
      execute: async () => ({ ok: true }),
      buildLog: () => ({ resourceKind: 'test', resourceId: 'record-1' }),
    })
    const { log, calls } = createLogRecorder()
    const container = createContainer({ injectionMode: InjectionMode.CLASSIC })
    container.register({ actionLogService: asValue({ log }) })
    const ambient = createCausationEnvelope([{ kind: 'workflow', id: WORKFLOW_INSTANCE_ID }], {
      correlationId: CORRELATION_ID,
    })

    await runWithCausation(ambient, () =>
      new CommandBus().execute('test.causation.ambient', { input: {}, ctx: buildContext(container) }),
    )

    expect(calls[0].causation).toEqual({
      correlationId: CORRELATION_ID,
      frames: [{ kind: 'workflow', id: WORKFLOW_INSTANCE_ID }],
    })
  })

  it('prefers an explicit ctx.causation over the ambient envelope', async () => {
    registerCommand({
      id: 'test.causation.explicit',
      execute: async () => ({ ok: true }),
      buildLog: () => ({ resourceKind: 'test', resourceId: 'record-1' }),
    })
    const { log, calls } = createLogRecorder()
    const container = createContainer({ injectionMode: InjectionMode.CLASSIC })
    container.register({ actionLogService: asValue({ log }) })
    const explicit = createCausationEnvelope([{ kind: 'schedule', id: 'schedule-1' }], { correlationId: CORRELATION_ID })
    const ambient = createCausationEnvelope([{ kind: 'user' }])

    await runWithCausation(ambient, () =>
      new CommandBus().execute('test.causation.explicit', {
        input: {},
        ctx: buildContext(container, { causation: explicit }),
      }),
    )

    expect(calls[0].causation).toEqual(explicit)
  })

  it('derives an api_key cause with the key id from API-key auth', async () => {
    registerCommand({
      id: 'test.causation.api-key',
      execute: async () => ({ ok: true }),
      buildLog: () => ({ resourceKind: 'test', resourceId: 'record-1' }),
    })
    const { log, calls } = createLogRecorder()
    const container = createContainer({ injectionMode: InjectionMode.CLASSIC })
    container.register({ actionLogService: asValue({ log }) })

    await new CommandBus().execute('test.causation.api-key', {
      input: {},
      ctx: buildContext(container, {
        auth: { sub: `api_key:${KEY_ID}`, tenantId: TENANT_ID, orgId: ORG_ID, isApiKey: true, keyId: KEY_ID },
      }),
    })

    expect(calls[0].causation?.frames).toEqual([{ kind: 'api_key', id: KEY_ID }])
  })

  it('lets nested commands executed inside execute inherit the parent envelope', async () => {
    registerCommand({
      id: 'test.causation.inner',
      execute: async () => ({ ok: true }),
      buildLog: () => ({ resourceKind: 'test', resourceId: 'inner-1' }),
    })
    registerCommand({
      id: 'test.causation.outer',
      execute: async (_input: unknown, ctx: CommandRuntimeContext) => {
        await new CommandBus().execute('test.causation.inner', { input: {}, ctx })
        return { ok: true }
      },
      buildLog: () => ({ resourceKind: 'test', resourceId: 'outer-1' }),
    })
    const { log, calls } = createLogRecorder([FOLLOW_UP_LOG_ID, LOG_ID])
    const container = createContainer({ injectionMode: InjectionMode.CLASSIC })
    container.register({ actionLogService: asValue({ log }) })

    await new CommandBus().execute('test.causation.outer', { input: {}, ctx: buildContext(container) })

    expect(calls).toHaveLength(2)
    expect(calls[0].payload.resourceId).toBe('inner-1')
    expect(calls[1].payload.resourceId).toBe('outer-1')
    expect(calls[0].causation).toEqual(calls[1].causation)
  })

  describe.each([
    ['caller metadata.context', 'metadata'],
    ['interceptor logContext', 'interceptor'],
    ['buildLog().context', 'buildLog'],
  ] as const)('spoofed causation in %s', (_label, channel) => {
    it('is stripped from the persisted context and never reaches the cause argument', async () => {
      registerCommand({
        id: 'test.causation.spoof',
        execute: async () => ({ ok: true }),
        buildLog: () => ({
          resourceKind: 'test',
          resourceId: 'record-1',
          context: channel === 'buildLog' ? { causation: SPOOFED_CAUSATION, fromBuildLog: true } : { fromBuildLog: true },
        }),
      })
      if (channel === 'interceptor') {
        registerInterceptor({
          id: 'test.causation.spoof-interceptor',
          targetCommand: 'test.causation.*',
          beforeExecute: async () => ({
            ok: true,
            metadata: { logContext: { causation: SPOOFED_CAUSATION, fromInterceptor: true } },
          }),
        })
      }
      const { log, calls } = createLogRecorder()
      const container = createContainer({ injectionMode: InjectionMode.CLASSIC })
      container.register({ actionLogService: asValue({ log }) })

      await new CommandBus().execute('test.causation.spoof', {
        input: {},
        ctx: buildContext(container),
        metadata: {
          context: channel === 'metadata' ? { causation: SPOOFED_CAUSATION, fromCaller: true } : { fromCaller: true },
        },
      })

      const context = calls[0].payload.context as Record<string, unknown>
      expect(context).not.toHaveProperty('causation')
      expect(context).toEqual(expect.objectContaining({ fromCaller: true, fromBuildLog: true }))
      if (channel === 'interceptor') expect(context.fromInterceptor).toBe(true)
      expect(calls[0].causation?.frames).toEqual([{ kind: 'user' }])
      expect(calls[0].causation?.correlationId).not.toBe(CORRELATION_ID)
    })
  })

  it('runs after-interceptors and side effects with causedByLogId so follow-up writes link to the log', async () => {
    const observed: { afterExecute?: CausationEnvelope | null; sideEffects?: CausationEnvelope | null } = {}
    let followUpExecuted = false
    registerCommand({
      id: 'test.causation.parent',
      execute: async () => ({ ok: true }),
      buildLog: () => ({ resourceKind: 'test', resourceId: 'parent-1' }),
    })
    registerCommand({
      id: 'test.causation.follow-up',
      execute: async () => ({ ok: true }),
      buildLog: () => ({ resourceKind: 'test', resourceId: 'follow-up-1' }),
    })
    registerInterceptor({
      id: 'test.causation.after-interceptor',
      targetCommand: 'test.causation.parent',
      afterExecute: async () => {
        observed.afterExecute = getAmbientCausation()
      },
    })
    const { log, calls } = createLogRecorder([LOG_ID, FOLLOW_UP_LOG_ID])
    const container = createContainer({ injectionMode: InjectionMode.CLASSIC })
    const ctx = buildContext(container)
    container.register({
      actionLogService: asValue({ log }),
      dataEngine: asValue({
        flushOrmEntityChanges: jest.fn(async () => {
          if (followUpExecuted) return
          followUpExecuted = true
          observed.sideEffects = getAmbientCausation()
          await new CommandBus().execute('test.causation.follow-up', { input: {}, ctx })
        }),
      }),
    })

    await new CommandBus().execute('test.causation.parent', { input: {}, ctx })

    const parentEnvelope = calls[0].causation
    expect(parentEnvelope?.causedByLogId).toBeUndefined()
    expect(observed.afterExecute).toEqual({ ...parentEnvelope, causedByLogId: LOG_ID })
    expect(observed.sideEffects).toEqual({ ...parentEnvelope, causedByLogId: LOG_ID })
    expect(calls[1].payload.resourceId).toBe('follow-up-1')
    expect(calls[1].causation).toEqual({ ...parentEnvelope, causedByLogId: LOG_ID })
    expect(getAmbientCausation()).toBeNull()
  })

  it('appends a redo frame pointing at the source log for redo executions', async () => {
    registerCommand({
      id: 'test.causation.redo',
      execute: jest.fn(),
      redo: async () => ({ ok: true }),
      undo: jest.fn(),
      buildLog: () => ({ resourceKind: 'test', resourceId: 'record-1' }),
    })
    const { log, calls } = createLogRecorder()
    const container = createContainer({ injectionMode: InjectionMode.CLASSIC })
    container.register({ actionLogService: asValue({ log }) })

    await new CommandBus().execute('test.causation.redo', {
      input: {},
      ctx: buildContext(container),
      metadata: { context: { historyAction: 'redo', sourceLogId: SOURCE_LOG_ID, causation: SPOOFED_CAUSATION } },
      redoLogEntry: { id: SOURCE_LOG_ID, commandId: 'test.causation.redo' },
    })

    expect(calls[0].causation?.frames).toEqual([{ kind: 'user' }, { kind: 'redo', id: SOURCE_LOG_ID }])
    expect(calls[0].payload.context).toEqual({ historyAction: 'redo', sourceLogId: SOURCE_LOG_ID })
    expect(calls[0].payload.actorUserId).toBe(USER_ID)
  })

  it('stamps an atomic redo with the redo frame and runs its post-commit effects with causedByLogId', async () => {
    const em = buildTransactionalEm()
    let afterExecuteAmbient: CausationEnvelope | null = null
    registerInterceptor({
      id: 'test.causation.atomic-redo-interceptor',
      targetCommand: 'test.causation.atomic-redo',
      afterExecute: async () => {
        afterExecuteAmbient = getAmbientCausation()
      },
    })
    registerCommand({
      id: 'test.causation.atomic-redo',
      atomicReplay: true,
      execute: jest.fn(),
      redo: async () => ({ ok: true }),
      undo: jest.fn(),
      buildLog: () => ({ resourceKind: 'test', resourceId: 'record-1' }),
    })
    const { log, calls } = createLogRecorder()
    const container = createContainer({ injectionMode: InjectionMode.CLASSIC })
    container.register({
      em: asValue(em),
      actionLogService: asValue({ log, claimForRedo: jest.fn(async () => true) }),
      dataEngine: asValue({ flushOrmEntityChanges: jest.fn(async () => undefined) }),
    })

    await new CommandBus().execute('test.causation.atomic-redo', {
      input: {},
      ctx: buildContext(container),
      redoLogEntry: { id: SOURCE_LOG_ID, commandId: 'test.causation.atomic-redo' },
    })

    expect(log.mock.calls[0][1]).toBe(em)
    expect(calls[0].causation?.frames).toEqual([{ kind: 'user' }, { kind: 'redo', id: SOURCE_LOG_ID }])
    expect(afterExecuteAmbient).toEqual({ ...calls[0].causation, causedByLogId: LOG_ID })
  })

  it('captures the envelope for post-commit effects deferred to an ambient transaction owner', async () => {
    const em = buildTransactionalEm()
    let afterExecuteAmbient: CausationEnvelope | null = null
    let sideEffectsAmbient: CausationEnvelope | null = null
    const afterExecute = jest.fn(async () => {
      afterExecuteAmbient = getAmbientCausation()
    })
    registerInterceptor({
      id: 'test.causation.deferred-redo-interceptor',
      targetCommand: 'test.causation.deferred-redo',
      afterExecute,
    })
    registerCommand({
      id: 'test.causation.deferred-redo',
      atomicReplay: true,
      execute: jest.fn(),
      redo: async () => ({ ok: true }),
      undo: jest.fn(),
      buildLog: () => ({ resourceKind: 'test', resourceId: 'record-1' }),
    })
    const { log, calls } = createLogRecorder()
    const container = createContainer({ injectionMode: InjectionMode.CLASSIC })
    container.register({
      em: asValue(em),
      actionLogService: asValue({ log, claimForRedo: jest.fn(async () => true) }),
      dataEngine: asValue({
        flushOrmEntityChanges: jest.fn(async () => {
          sideEffectsAmbient = getAmbientCausation()
        }),
      }),
    })
    const ownerEnvelope = createCausationEnvelope([{ kind: 'system', ref: 'owner' }], { correlationId: CORRELATION_ID })

    await runWithCausation(ownerEnvelope, () =>
      withAtomicFlush(em as never, [async () => {
        const transactionLifetime = getTransactionLifetime(em as never)
        await new CommandBus().execute('test.causation.deferred-redo', {
          input: {},
          ctx: buildContext(container, {
            transactionalEm: em as never,
            transactionLifetime: transactionLifetime!,
          }),
          redoLogEntry: { id: SOURCE_LOG_ID, commandId: 'test.causation.deferred-redo' },
        })
        expect(afterExecute).not.toHaveBeenCalled()
      }], { transaction: true }),
    )

    const expectedEnvelope = {
      correlationId: CORRELATION_ID,
      frames: [{ kind: 'system', ref: 'owner' }, { kind: 'redo', id: SOURCE_LOG_ID }],
    }
    expect(calls[0].causation).toEqual(expectedEnvelope)
    expect(em.commit.mock.invocationCallOrder[0]).toBeLessThan(afterExecute.mock.invocationCallOrder[0])
    expect(afterExecuteAmbient).toEqual({ ...expectedEnvelope, causedByLogId: LOG_ID })
    expect(sideEffectsAmbient).toEqual({ ...expectedEnvelope, causedByLogId: LOG_ID })
  })

  describe('undo', () => {
    function registerUndoFixture(options: { atomicReplay?: boolean } = {}) {
      const observed: {
        handler?: CausationEnvelope | null
        markUndone?: CausationEnvelope | null
        afterUndo?: CausationEnvelope | null
      } = {}
      registerCommand({
        id: 'test.causation.undoable',
        atomicReplay: options.atomicReplay,
        execute: jest.fn(),
        undo: async () => {
          observed.handler = getAmbientCausation()
        },
      })
      registerInterceptor({
        id: 'test.causation.undo-interceptor',
        targetCommand: 'test.causation.undoable',
        afterUndo: async () => {
          observed.afterUndo = getAmbientCausation()
        },
      })
      const markUndone = jest.fn(async (..._args: unknown[]) => {
        observed.markUndone = getAmbientCausation()
        return null
      })
      const service = {
        findByUndoToken: jest.fn(async () => ({
          id: SOURCE_LOG_ID,
          commandId: 'test.causation.undoable',
          actionLabel: 'Update record',
          actorUserId: ORIGINAL_ACTOR_ID,
          tenantId: TENANT_ID,
          organizationId: ORG_ID,
          resourceKind: 'test',
          resourceId: 'record-1',
          parentResourceKind: null,
          parentResourceId: null,
          relatedResourceKind: null,
          relatedResourceId: null,
          commandPayload: {},
          snapshotBefore: { name: 'before' },
          snapshotAfter: { name: 'after' },
          changesJson: { name: { from: 'before', to: 'after' } },
          contextJson: { causation: SPOOFED_CAUSATION, inherited: 'kept' },
        })),
        claimForUndo: jest.fn(async () => true),
        releaseUndoClaim: jest.fn(async () => true),
        markUndone,
      }
      return { observed, service, markUndone }
    }

    it('stamps the trace row with an undo frame and keeps the actor, leaving inherited causation to the log service', async () => {
      const { observed, service, markUndone } = registerUndoFixture()
      const container = createContainer({ injectionMode: InjectionMode.CLASSIC })
      container.register({
        actionLogService: asValue(service),
        dataEngine: asValue({ flushOrmEntityChanges: jest.fn(async () => undefined) }),
      })

      await new CommandBus().undo('undo-token', buildContext(container))

      expect(markUndone).toHaveBeenCalledTimes(1)
      expect(markUndone.mock.calls[0]).toHaveLength(2)
      expect(markUndone.mock.calls[0][0]).toBe(SOURCE_LOG_ID)
      expect(markUndone.mock.calls[0][1]).toEqual(expect.objectContaining({
        actorUserId: USER_ID,
        context: {
          causation: SPOOFED_CAUSATION,
          inherited: 'kept',
          historyAction: 'undo',
          sourceLogId: SOURCE_LOG_ID,
          sourceCommandId: 'test.causation.undoable',
        },
      }))
      expect(observed.markUndone?.frames).toEqual([{ kind: 'user' }, { kind: 'undo', id: SOURCE_LOG_ID }])
      expect(observed.markUndone?.correlationId).not.toBe(CORRELATION_ID)
      expect(observed.handler).toEqual(observed.markUndone)
      expect(observed.afterUndo).toEqual(observed.markUndone)
      expect(getAmbientCausation()).toBeNull()
    })

    it('runs a deferred atomic undo completion inside the captured undo envelope', async () => {
      const { observed, service } = registerUndoFixture({ atomicReplay: true })
      const em = buildTransactionalEm()
      const container = createContainer({ injectionMode: InjectionMode.CLASSIC })
      container.register({
        em: asValue(em),
        actionLogService: asValue(service),
        dataEngine: asValue({ flushOrmEntityChanges: jest.fn(async () => undefined) }),
      })
      const ownerEnvelope = createCausationEnvelope([{ kind: 'system', ref: 'owner' }], { correlationId: CORRELATION_ID })

      await runWithCausation(ownerEnvelope, () =>
        withAtomicFlush(em as never, [async () => {
          const transactionLifetime = getTransactionLifetime(em as never)
          await new CommandBus().undo('undo-token', buildContext(container, {
            transactionalEm: em as never,
            transactionLifetime: transactionLifetime!,
          }))
          expect(observed.afterUndo).toBeUndefined()
        }], { transaction: true }),
      )

      const expectedEnvelope = {
        correlationId: CORRELATION_ID,
        frames: [{ kind: 'system', ref: 'owner' }, { kind: 'undo', id: SOURCE_LOG_ID }],
      }
      expect(observed.markUndone).toEqual(expectedEnvelope)
      expect(observed.afterUndo).toEqual(expectedEnvelope)
    })
  })

  describe('kill switch (OM_CAUSATION=off)', () => {
    it('keeps the legacy execute path: no envelope argument, no ambient scope, context passed through', async () => {
      process.env.OM_CAUSATION = 'off'
      let ambientInExecute: CausationEnvelope | null | undefined
      let afterExecuteAmbient: CausationEnvelope | null | undefined
      registerCommand({
        id: 'test.causation.disabled',
        execute: async () => {
          ambientInExecute = getAmbientCausation()
          return { ok: true }
        },
        buildLog: () => ({ resourceKind: 'test', resourceId: 'record-1' }),
      })
      registerInterceptor({
        id: 'test.causation.disabled-interceptor',
        targetCommand: 'test.causation.disabled',
        afterExecute: async () => {
          afterExecuteAmbient = getAmbientCausation()
        },
      })
      const { log, calls } = createLogRecorder()
      const container = createContainer({ injectionMode: InjectionMode.CLASSIC })
      container.register({ actionLogService: asValue({ log }) })

      await new CommandBus().execute('test.causation.disabled', {
        input: {},
        ctx: buildContext(container),
        metadata: { context: { causation: SPOOFED_CAUSATION, fromCaller: true } },
      })

      expect(calls[0].argumentCount).toBe(1)
      expect(calls[0].ambient).toBeNull()
      expect(calls[0].payload.context).toEqual({ causation: SPOOFED_CAUSATION, fromCaller: true })
      expect(ambientInExecute).toBeNull()
      expect(afterExecuteAmbient).toBeNull()
    })

    it('keeps the legacy two-argument log call for a transactional context', async () => {
      process.env.OM_CAUSATION = 'off'
      registerCommand({
        id: 'test.causation.disabled-transactional',
        execute: async () => ({ ok: true }),
        buildLog: () => ({ resourceKind: 'test', resourceId: 'record-1' }),
      })
      const { log } = createLogRecorder()
      const transactionalEm = {}
      const container = createContainer({ injectionMode: InjectionMode.CLASSIC })
      container.register({ actionLogService: asValue({ log }) })

      await new CommandBus().execute('test.causation.disabled-transactional', {
        input: {},
        ctx: buildContext(container, { transactionalEm: transactionalEm as never }),
      })

      expect(log.mock.calls[0]).toHaveLength(2)
      expect(log.mock.calls[0][1]).toBe(transactionalEm)
    })

    it('keeps the legacy undo trace: inherited context copied and no undo scope', async () => {
      process.env.OM_CAUSATION = 'off'
      let markUndoneAmbient: CausationEnvelope | null | undefined
      registerCommand({
        id: 'test.causation.disabled-undo',
        execute: jest.fn(),
        undo: jest.fn(async () => undefined),
      })
      const markUndone = jest.fn(async (..._args: unknown[]) => {
        markUndoneAmbient = getAmbientCausation()
        return null
      })
      const container = createContainer({ injectionMode: InjectionMode.CLASSIC })
      container.register({
        actionLogService: asValue({
          findByUndoToken: jest.fn(async () => ({
            id: SOURCE_LOG_ID,
            commandId: 'test.causation.disabled-undo',
            commandPayload: {},
            contextJson: { causation: SPOOFED_CAUSATION },
          })),
          claimForUndo: jest.fn(async () => true),
          releaseUndoClaim: jest.fn(async () => true),
          markUndone,
        }),
        dataEngine: asValue({ flushOrmEntityChanges: jest.fn(async () => undefined) }),
      })

      await new CommandBus().undo('undo-token', buildContext(container))

      expect(markUndoneAmbient).toBeNull()
      expect(markUndone.mock.calls[0][1]).toEqual(expect.objectContaining({
        context: expect.objectContaining({ causation: SPOOFED_CAUSATION, historyAction: 'undo' }),
      }))
    })
  })
})
