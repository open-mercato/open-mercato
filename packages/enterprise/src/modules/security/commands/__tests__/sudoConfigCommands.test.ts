import { asValue, createContainer, InjectionMode } from 'awilix'
import { CommandBus } from '@open-mercato/shared/lib/commands/command-bus'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { LockMode } from '@mikro-orm/postgresql'
import { emitSecurityEvent } from '../../events'
import { SudoChallengeService } from '../../services/SudoChallengeService'
import { captureSudoConfigSnapshot } from '../sudoConfig.shared'

jest.mock('../../events', () => ({ emitSecurityEvent: jest.fn() }))
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (em: EntityManager, ...[entity, where, options]: Parameters<EntityManager['findOne']>) => em.findOne(entity, where, options),
}))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (key: string, fallback?: string) => fallback ?? key,
  }),
}))

import type { EntityManager } from '@mikro-orm/postgresql'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { ChallengeMethod, SudoChallengeConfig } from '../../data/entities'
import '../createSudoConfig'
import '../updateSudoConfig'
import '../deleteSudoConfig'

type ConfigRecord = SudoChallengeConfig & {
  id: string
}

function buildRecord(overrides?: Partial<ConfigRecord>): ConfigRecord {
  return {
    id: 'config-1',
    tenantId: null,
    organizationId: null,
    label: null,
    targetIdentifier: 'security.sudo.manage',
    isEnabled: true,
    isDeveloperDefault: false,
    ttlSeconds: 300,
    challengeMethod: ChallengeMethod.AUTO,
    configuredBy: 'user-1',
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  } as ConfigRecord
}

function createContext(records: ConfigRecord[]) {
  const em = {
    findOne: jest.fn(async (_entity: unknown, query: Record<string, unknown>) => {
      return records.find((record) => {
        if (query.id !== undefined && record.id !== query.id) return false
        if (query.deletedAt !== undefined && record.deletedAt !== query.deletedAt) return false
        return true
      }) ?? null
    }),
    create: jest.fn((_entity: unknown, data: Record<string, unknown>) => data),
    persist: jest.fn((record: ConfigRecord) => records.push(record)),
    flush: jest.fn().mockResolvedValue(undefined),
  }

  return {
    container: {
      resolve: (name: string) => {
        if (name === 'em') return em as unknown as EntityManager
        throw new Error(`Unexpected dependency: ${name}`)
      },
    },
    em,
  }
}

describe('sudo config commands undo', () => {
  test('create undo soft-deletes the created sudo config', async () => {
    const handler = commandRegistry.get('security.sudo.config.create')
    expect(handler?.undo).toBeTruthy()

    const record = buildRecord()
    const { container } = createContext([record])

    await handler!.undo?.({
      input: undefined,
      logEntry: {
        commandPayload: {
          undo: {
            after: { id: record.id },
          },
        },
      },
      ctx: { container } as never,
    })

    expect(record.deletedAt).toBeInstanceOf(Date)
  })

  test('update undo restores the previous sudo config snapshot', async () => {
    const handler = commandRegistry.get('security.sudo.config.update')
    expect(handler?.undo).toBeTruthy()

    const record = buildRecord({
      targetIdentifier: 'changed.target',
      ttlSeconds: 900,
      challengeMethod: ChallengeMethod.PASSWORD,
    })
    const { container } = createContext([record])

    await handler!.undo?.({
      input: undefined,
      logEntry: {
        commandPayload: {
          undo: {
            before: {
              id: record.id,
              tenantId: null,
              organizationId: null,
              label: null,
              targetIdentifier: 'security.sudo.manage',
              isEnabled: true,
              isDeveloperDefault: false,
              ttlSeconds: 300,
              challengeMethod: ChallengeMethod.AUTO,
              configuredBy: 'user-1',
              deletedAt: null,
            },
          },
        },
      },
      ctx: { container } as never,
    })

    expect(record.targetIdentifier).toBe('security.sudo.manage')
    expect(record.ttlSeconds).toBe(300)
    expect(record.challengeMethod).toBe(ChallengeMethod.AUTO)
  })

  test('delete undo recreates or undeletes the sudo config', async () => {
    const handler = commandRegistry.get('security.sudo.config.delete')
    expect(handler?.undo).toBeTruthy()

    const record = buildRecord({ deletedAt: new Date() })
    const { container } = createContext([record])

    await handler!.undo?.({
      input: undefined,
      logEntry: {
        commandPayload: {
          undo: {
            before: {
              id: record.id,
              tenantId: null,
              organizationId: null,
              label: null,
              targetIdentifier: 'security.sudo.manage',
              isEnabled: true,
              isDeveloperDefault: false,
              ttlSeconds: 300,
              challengeMethod: ChallengeMethod.AUTO,
              configuredBy: 'user-1',
              deletedAt: null,
            },
          },
        },
      },
      ctx: { container } as never,
    })

    expect(record.deletedAt).toBeNull()
  })
})

describe('sudo config commands through the command bus', () => {
  const configId = '11111111-1111-4111-8111-111111111111'
  const tenantId = '22222222-2222-4222-8222-222222222222'
  const commands = [
    {
      commandId: 'security.sudo.config.create',
      serviceMethod: 'createConfig',
      input: { targetIdentifier: 'security.admin.mfa.reset', isEnabled: false },
    },
    {
      commandId: 'security.sudo.config.update',
      serviceMethod: 'writeConfig',
      input: { id: configId, data: { isEnabled: false } },
    },
    {
      commandId: 'security.sudo.config.delete',
      serviceMethod: 'writeConfig',
      input: { id: configId },
    },
  ] as const

  function buildBusContext(commandId: string, input: unknown) {
    const record = buildRecord({ id: configId, tenantId, targetIdentifier: 'security.admin.mfa.reset' })
    const em = createContext([record]).em
    const tx = { ...em, findOne: jest.fn(em.findOne), flush: jest.fn().mockResolvedValue(undefined) }
    const entityManager = {
      ...em,
      fork: () => entityManager,
      transactional: jest.fn(async (callback: (manager: EntityManager) => Promise<unknown>) => callback(tx as unknown as EntityManager)),
    }
    const historicalLog = {
      id: 'historical-log',
      commandId,
      actorUserId: 'user-1',
      tenantId,
      organizationId: null,
      undoToken: 'historical-undo-token',
      executionState: 'done',
      commandPayload: {
        __redoInput: input,
        undo: {
          before: { ...captureSudoConfigSnapshot(record), isEnabled: false },
          after: captureSudoConfigSnapshot(record),
        },
      },
    }
    const logs = {
      log: jest.fn(async (payload: Record<string, unknown>) => ({ id: 'new-log', ...payload })),
      findByUndoToken: jest.fn(async () => historicalLog),
      claimForUndo: jest.fn(async () => true),
      markUndone: jest.fn(),
      claimForRedo: jest.fn(async () => true),
    }
    const service = new SudoChallengeService(entityManager as unknown as EntityManager, {} as never, {} as never, {} as never)
    jest.spyOn(service, 'createConfig').mockResolvedValue(record)
    jest.spyOn(service, 'writeConfig')
    const container = createContainer({ injectionMode: InjectionMode.CLASSIC })
    container.register({
      em: asValue(entityManager),
      actionLogService: asValue(logs),
      sudoChallengeService: asValue(service),
    })
    const ctx: CommandRuntimeContext = {
      container,
      auth: { sub: 'user-1', tenantId, orgId: null },
      request: new Request('http://localhost/api/audit_logs/audit-logs/actions/redo'),
      organizationScope: null,
      selectedOrganizationId: null,
      organizationIds: null,
    }
    return { ctx, em, tx, entityManager, record, logs, service, historicalLog }
  }

  test.each(commands)('$commandId still executes and audits without minting an undo token', async ({ commandId, serviceMethod, input }) => {
    const { ctx, logs, service } = buildBusContext(commandId, input)

    const outcome = await new CommandBus().execute(commandId, { input, ctx, skipCacheInvalidation: true })

    expect(service[serviceMethod]).toHaveBeenCalledTimes(1)
    expect(logs.log).toHaveBeenCalledTimes(1)
    expect(logs.log.mock.calls[0][0]).toMatchObject({ commandId, resourceKind: 'security.sudo_config', resourceId: configId })
    expect(logs.log.mock.calls[0][0].undoToken).toBeUndefined()
    expect(outcome.undoToken ?? null).toBeNull()
  })

  const writeCommands = commands.filter(({ serviceMethod }) => serviceMethod === 'writeConfig')

  test.each(writeCommands)('$commandId rejects stale state before a write, event or audit', async ({ commandId, input }) => {
    const { ctx, record, logs, tx } = buildBusContext(commandId, input)
    const before = captureSudoConfigSnapshot(record)
    const expectedUpdatedAt = new Date(record.updatedAt.getTime() - 1000).toISOString()
    jest.mocked(emitSecurityEvent).mockClear()

    await expect(new CommandBus().execute(commandId, {
      input: { ...input, expectedUpdatedAt }, ctx, skipCacheInvalidation: true,
    })).rejects.toMatchObject({
      status: 409,
      body: { error: 'record_modified', code: 'optimistic_lock_conflict', expectedUpdatedAt, currentUpdatedAt: record.updatedAt.toISOString() },
    })
    expect(tx.findOne).toHaveBeenCalledWith(SudoChallengeConfig, expect.objectContaining({ id: configId, tenantId }), {
      lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true,
    })
    expect(tx.flush).not.toHaveBeenCalled()
    expect(emitSecurityEvent).not.toHaveBeenCalled()
    expect(logs.log).not.toHaveBeenCalled()
    expect(captureSudoConfigSnapshot(record)).toEqual(before)
  })

  test.each([
    [undefined, true],
    ['all', true],
    ['on', false],
    ['off', false],
    ['catalog.product', false],
    ['security.sudo_config', true],
  ])('applies the shared optimistic-lock mode %s', async (mode, conflicts) => {
    const previousMode = process.env.OM_OPTIMISTIC_LOCK
    if (mode === undefined) delete process.env.OM_OPTIMISTIC_LOCK
    else process.env.OM_OPTIMISTIC_LOCK = mode
    try {
      const command = commands[1]
      const { ctx, record, tx } = buildBusContext(command.commandId, command.input)
      const expectedUpdatedAt = new Date(record.updatedAt.getTime() - 1000).toISOString()
      const write = new CommandBus().execute(command.commandId, {
        input: { ...command.input, expectedUpdatedAt }, ctx, skipCacheInvalidation: true,
      })
      if (conflicts) {
        await expect(write).rejects.toMatchObject({ status: 409 })
        expect(tx.flush).not.toHaveBeenCalled()
      } else {
        await expect(write).resolves.toMatchObject({ result: { ok: true } })
        expect(tx.flush).toHaveBeenCalledTimes(1)
      }
    } finally {
      if (previousMode === undefined) delete process.env.OM_OPTIMISTIC_LOCK
      else process.env.OM_OPTIMISTIC_LOCK = previousMode
    }
  })

  test.each(writeCommands)('$commandId reports a disappearance only after initial authorization', async ({ commandId, input }) => {
    const { ctx, record, em, tx } = buildBusContext(commandId, input)
    const expectedUpdatedAt = record.updatedAt.toISOString()
    tx.findOne.mockResolvedValueOnce(null)
    await expect(new CommandBus().execute(commandId, {
      input: { ...input, expectedUpdatedAt }, ctx, skipCacheInvalidation: true,
    })).rejects.toMatchObject({ status: 409, body: { expectedUpdatedAt, currentUpdatedAt: expectedUpdatedAt } })
    const lockedReads = tx.findOne.mock.calls.length
    em.findOne.mockResolvedValueOnce(null)
    await expect(new CommandBus().execute(commandId, {
      input: { ...input, expectedUpdatedAt }, ctx, skipCacheInvalidation: true,
    })).rejects.toMatchObject({ status: 404 })
    expect(tx.findOne).toHaveBeenCalledTimes(lockedReads)
    expect(tx.flush).not.toHaveBeenCalled()
  })

  test.each(writeCommands)('$commandId emits no event or audit on transaction failure', async ({ commandId, input }) => {
    const { ctx, logs, tx, entityManager } = buildBusContext(commandId, input)
    jest.mocked(emitSecurityEvent).mockClear()
    entityManager.transactional.mockImplementationOnce(async (callback) => {
      await callback(tx as unknown as EntityManager)
      throw new Error('[internal] commit failed')
    })
    await expect(new CommandBus().execute(commandId, { input, ctx, skipCacheInvalidation: true })).rejects.toThrow('commit failed')
    expect(tx.flush).toHaveBeenCalledTimes(1)
    expect(emitSecurityEvent).not.toHaveBeenCalled()
    expect(logs.log).not.toHaveBeenCalled()
  })

  test.each(writeCommands)('$commandId returns only public fields after committing and audits the locked predecessor', async ({ commandId, input }) => {
    const { ctx, record, logs, entityManager, tx } = buildBusContext(commandId, input)
    const expectedUpdatedAt = record.updatedAt.toISOString()
    const predecessor = { ...captureSudoConfigSnapshot(record), label: 'current predecessor' }
    const order: string[] = []
    const enforce = jest.fn(async () => {
      expect(tx.findOne).toHaveBeenCalledTimes(1)
      expect(tx.flush).not.toHaveBeenCalled()
      order.push('guard')
    })
    ctx.container.register({ commandOptimisticLockGuardService: asValue({ enforce }) })
    entityManager.transactional.mockImplementationOnce(async (callback) => {
      record.label = predecessor.label
      const result = await callback(tx as unknown as EntityManager)
      order.push('commit')
      return result
    })
    jest.mocked(emitSecurityEvent).mockImplementationOnce(async () => { order.push('event') })
    const actual = await new CommandBus().execute(commandId, {
      input: { ...input, expectedUpdatedAt }, ctx, skipCacheInvalidation: true,
    })
    const expected = commandId.endsWith('.update') ? { ok: true, updatedAt: record.updatedAt.toISOString() } : { ok: true }
    expect({ ...actual.result as object }).toEqual(expected)
    expect(JSON.parse(JSON.stringify(actual.result))).toEqual(expected)
    expect(Object.keys(actual.result as object)).toEqual(Object.keys(expected))
    expect(enforce).toHaveBeenCalledTimes(1)
    expect(enforce).toHaveBeenCalledWith(expect.objectContaining({
      resourceKind: 'security.sudo_config', resourceId: configId, current: new Date(expectedUpdatedAt), expected: expectedUpdatedAt,
    }))
    expect(order).toEqual(['guard', 'commit', 'event'])
    expect(logs.log.mock.calls[0][0]).toMatchObject({ commandPayload: { undo: { before: predecessor } } })
    expect(tx.flush).toHaveBeenCalledTimes(1)
  })

  test.each(commands)('$commandId refuses historical undo before claiming or mutating', async ({ commandId, input }) => {
    const { ctx, em, record, logs, service, historicalLog } = buildBusContext(commandId, input)
    const originalRecord = { ...record }

    await expect(new CommandBus().undo(historicalLog.undoToken, ctx)).rejects.toThrow(`Command ${commandId} is not undoable`)

    expect(logs.findByUndoToken).toHaveBeenCalledWith(historicalLog.undoToken)
    expect(logs.claimForUndo).not.toHaveBeenCalled()
    expect(logs.markUndone).not.toHaveBeenCalled()
    expect(logs.log).not.toHaveBeenCalled()
    expect(em.findOne).not.toHaveBeenCalled()
    expect(em.create).not.toHaveBeenCalled()
    expect(em.persist).not.toHaveBeenCalled()
    expect(em.flush).not.toHaveBeenCalled()
    expect(service.createConfig).not.toHaveBeenCalled()
    expect(service.writeConfig).not.toHaveBeenCalled()
    expect(record).toEqual(originalRecord)
    expect(historicalLog.executionState).toBe('done')
  })

  test.each(commands)('$commandId refuses historical redo before snapshots, claims or mutations', async ({ commandId, input }) => {
    const { ctx, em, record, logs, service, historicalLog } = buildBusContext(commandId, input)
    historicalLog.executionState = 'undone'
    const originalRecord = { ...record }

    await expect(new CommandBus().execute(commandId, {
      input,
      ctx,
      redoLogEntry: historicalLog,
      skipCacheInvalidation: true,
    })).rejects.toThrow('[internal] Sudo configuration commands do not support replay')

    expect(logs.claimForRedo).not.toHaveBeenCalled()
    expect(logs.log).not.toHaveBeenCalled()
    expect(em.findOne).not.toHaveBeenCalled()
    expect(em.create).not.toHaveBeenCalled()
    expect(em.persist).not.toHaveBeenCalled()
    expect(em.flush).not.toHaveBeenCalled()
    expect(service.createConfig).not.toHaveBeenCalled()
    expect(service.writeConfig).not.toHaveBeenCalled()
    expect(record).toEqual(originalRecord)
    expect(historicalLog.executionState).toBe('undone')
  })
})
