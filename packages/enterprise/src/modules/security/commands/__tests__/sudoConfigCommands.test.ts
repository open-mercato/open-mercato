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
