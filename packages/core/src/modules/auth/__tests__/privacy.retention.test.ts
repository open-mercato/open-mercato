import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { PrivacyRetentionInput } from '@open-mercato/shared/lib/privacy'
import { User } from '../data/entities'
import { AuthUsersPrivacyHandler, buildAuthUserRetentionFilter } from '../privacy'

const mockFindAndCountWithDecryption = jest.fn()
const mockFindOneWithDecryption = jest.fn()
const mockFindWithDecryption = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findAndCountWithDecryption: (...args: unknown[]) => mockFindAndCountWithDecryption(...args),
  findOneWithDecryption: (...args: unknown[]) => mockFindOneWithDecryption(...args),
  findWithDecryption: (...args: unknown[]) => mockFindWithDecryption(...args),
}))

const now = new Date('2026-08-24T12:00:00.000Z')
const scope = { tenantId: 'tenant-1', organizationId: 'organization-1' }
const commandContext = { container: {} } as CommandRuntimeContext

function retentionInput(overrides: Partial<PrivacyRetentionInput> = {}): PrivacyRetentionInput {
  return {
    scope,
    retentionDays: 365,
    action: 'delete',
    batchSize: 25,
    dryRun: false,
    excludedSubjects: [{ kind: 'auth:user', id: 'held-user' }],
    actorId: 'actor-user',
    commandContext,
    now,
    ...overrides,
  }
}

describe('AuthUsersPrivacyHandler retention', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('targets stale users and excludes the actor and legal-held users', () => {
    expect(buildAuthUserRetentionFilter(retentionInput())).toEqual({
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
      createdAt: { $lt: new Date('2025-08-24T12:00:00.000Z') },
      id: { $nin: ['held-user', 'actor-user'] },
      $and: [
        { $or: [{ updatedAt: null }, { updatedAt: { $lt: new Date('2025-08-24T12:00:00.000Z') } }] },
        { $or: [{ lastLoginAt: null }, { lastLoginAt: { $lt: new Date('2025-08-24T12:00:00.000Z') } }] },
      ],
    })
  })

  it('deletes a bounded batch through the existing auth command', async () => {
    const users = [
      { id: 'user-1' } as User,
      { id: 'user-2' } as User,
    ]
    mockFindAndCountWithDecryption.mockResolvedValueOnce([users, 3])
    mockFindOneWithDecryption
      .mockResolvedValueOnce(users[0])
      .mockResolvedValueOnce(users[1])
    const execute = jest.fn(async () => ({ result: null, logEntry: null }))
    const handler = new AuthUsersPrivacyHandler(
      {} as EntityManager,
      { execute } as unknown as CommandBus,
    )

    const result = await handler.runRetention(retentionInput({ batchSize: 2 }))

    expect(result).toEqual({ matched: 2, affected: 2, hasMore: true })
    expect(execute).toHaveBeenCalledTimes(2)
    expect(execute).toHaveBeenNthCalledWith(1, 'auth.users.delete', expect.objectContaining({
      input: { body: { id: 'user-1' } },
      metadata: { skipLog: true },
    }))
  })

  it('resolves an email through lookup hashes without querying by plaintext email', async () => {
    mockFindWithDecryption.mockResolvedValueOnce([{ id: 'user-1' } as User])
    const handler = new AuthUsersPrivacyHandler(
      {} as EntityManager,
      { execute: jest.fn() } as unknown as CommandBus,
    )

    const result = await handler.resolveSubjects({
      scope,
      identifier: { kind: 'email', value: 'person@example.com' },
      actorId: 'actor-user',
    })

    expect(result.subjects).toEqual([{ kind: 'auth:user', id: 'user-1' }])
    const where = mockFindWithDecryption.mock.calls[0]?.[2]
    expect(JSON.stringify(where)).not.toContain('person@example.com')
    expect(where).toEqual(expect.objectContaining({
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      emailHash: { $in: expect.any(Array) },
    }))
  })
})
