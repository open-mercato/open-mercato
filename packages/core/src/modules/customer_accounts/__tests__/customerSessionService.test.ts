import type { EntityManager } from '@mikro-orm/postgresql'
jest.mock('@open-mercato/shared/lib/auth/jwt', () => ({
  signJwt: jest.fn(() => 'mock-jwt'),
  signAudienceJwt: jest.fn(() => 'mock-jwt'),
}))

jest.mock('@open-mercato/core/modules/customer_accounts/lib/tokenGenerator', () => ({
  generateSecureToken: jest.fn(() => 'mock-token'),
  hashToken: jest.fn(() => 'mock-hash'),
}))

const nativeUpdateMock = jest.fn()

const em = {
  nativeUpdate: nativeUpdateMock,
} as any

describe('CustomerSessionService.revokeAllUserSessions', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('soft-deletes sessions and stamps sessionsRevokedAt on the user', async () => {
    const { CustomerSessionService } = await import('../services/customerSessionService')
    const { CustomerUser, CustomerUserSession } = await import('../data/entities')
    const service = new CustomerSessionService(em)
    const userId = '11111111-1111-4111-8111-111111111111'

    await service.revokeAllUserSessions(userId)

    expect(nativeUpdateMock).toHaveBeenCalledTimes(2)

    // First call: soft-delete sessions
    const [sessionEntity, sessionFilter, sessionUpdate] = nativeUpdateMock.mock.calls[0]
    expect(sessionEntity).toBe(CustomerUserSession)
    expect(sessionFilter).toEqual({ user: userId, deletedAt: null })
    expect(sessionUpdate.deletedAt).toBeInstanceOf(Date)

    // Second call: stamp sessionsRevokedAt on user
    const [userEntity, userFilter, userUpdate] = nativeUpdateMock.mock.calls[1]
    expect(userEntity).toBe(CustomerUser)
    expect(userFilter).toEqual({ id: userId })
    expect(userUpdate.sessionsRevokedAt).toBeInstanceOf(Date)

    // Both timestamps should use the same instant
    expect(sessionUpdate.deletedAt.getTime()).toBe(userUpdate.sessionsRevokedAt.getTime())
  })
})

describe('CustomerSessionService.createSession — concurrent session cap', () => {
  const userId = '22222222-2222-4222-8222-222222222222'
  const user = {
    id: userId,
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    email: 'u@example.com',
    displayName: 'U',
    customerEntityId: null,
    personEntityId: null,
  } as any

  const buildService = (existingIds: string[]) => {
    const findMock = jest.fn(async () => existingIds.map((id) => ({ id })))
    const flushMock = jest.fn(async () => {})
    const persistMock = jest.fn().mockReturnValue({ flush: flushMock })
    const createMock = jest.fn((_entity: any, data: any) => ({ id: 'new-session', ...data }))
    const executeMock = jest.fn(async () => [{ locked: true }])
    const getReferenceMock = jest.fn((_entity: unknown, id: string) => ({ id }))
    const mockEm = {
      find: findMock,
      nativeUpdate: nativeUpdateMock,
      persist: persistMock,
      flush: flushMock,
      create: createMock,
      execute: executeMock,
      getReference: getReferenceMock,
      transactional: jest.fn(async (work: (tx: unknown) => Promise<unknown>): Promise<unknown> => work(mockEm)),
      fork: jest.fn((): unknown => mockEm),
    }
    const localEm = mockEm as unknown as EntityManager
    return {
      localEm,
      findMock,
      persistMock,
      flushMock,
      createMock,
      executeMock,
      getReferenceMock,
      transactionalMock: mockEm.transactional,
    }
  }

  const originalCap = process.env.MAX_CUSTOMER_SESSIONS_PER_USER

  beforeEach(() => {
    jest.clearAllMocks()
    delete process.env.MAX_CUSTOMER_SESSIONS_PER_USER
  })

  afterAll(() => {
    if (originalCap === undefined) delete process.env.MAX_CUSTOMER_SESSIONS_PER_USER
    else process.env.MAX_CUSTOMER_SESSIONS_PER_USER = originalCap
  })

  it('does not revoke when the user has fewer than the default cap of 5', async () => {
    const { CustomerSessionService } = await import('../services/customerSessionService')
    const { CustomerUserSession } = await import('../data/entities')
    const { localEm, findMock, persistMock, flushMock } = buildService(['s1', 's2', 's3', 's4'])

    const service = new CustomerSessionService(localEm)
    await service.createSession(user, ['portal.view'])

    expect(findMock).toHaveBeenCalledTimes(1)
    const [findEntity, findFilter] = findMock.mock.calls[0]
    expect(findEntity).toBe(CustomerUserSession)
    expect(findFilter).toMatchObject({ user: userId, deletedAt: null })
    expect(nativeUpdateMock).not.toHaveBeenCalled()
    expect(persistMock).toHaveBeenCalledTimes(1)
    expect(flushMock).toHaveBeenCalledTimes(1)
  })

  it('revokes the oldest session when issuing the 6th concurrent session under the default cap', async () => {
    const { CustomerSessionService } = await import('../services/customerSessionService')
    const { CustomerUserSession } = await import('../data/entities')
    const { localEm, persistMock, flushMock } = buildService(['s1', 's2', 's3', 's4', 's5'])

    const service = new CustomerSessionService(localEm)
    await service.createSession(user, ['portal.view'])

    expect(nativeUpdateMock).toHaveBeenCalledTimes(1)
    const [entity, filter, update] = nativeUpdateMock.mock.calls[0]
    expect(entity).toBe(CustomerUserSession)
    expect(filter).toEqual({ id: { $in: ['s1'] } })
    expect(update.deletedAt).toBeInstanceOf(Date)
    expect(persistMock).toHaveBeenCalledTimes(1)
    expect(flushMock).toHaveBeenCalledTimes(1)
  })

  it('revokes all overflow sessions so at most cap sessions remain after create', async () => {
    const { CustomerSessionService } = await import('../services/customerSessionService')
    const { localEm } = buildService(['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8'])

    const service = new CustomerSessionService(localEm)
    await service.createSession(user, ['portal.view'])

    const [, filter] = nativeUpdateMock.mock.calls[0]
    // 8 existing + 1 new = 9; must leave 5 active → revoke the 4 oldest
    expect(filter).toEqual({ id: { $in: ['s1', 's2', 's3', 's4'] } })
  })

  it('honors MAX_CUSTOMER_SESSIONS_PER_USER override', async () => {
    process.env.MAX_CUSTOMER_SESSIONS_PER_USER = '2'
    const { CustomerSessionService } = await import('../services/customerSessionService')
    const { localEm } = buildService(['s1', 's2'])

    const service = new CustomerSessionService(localEm)
    await service.createSession(user, ['portal.view'])

    // cap=2 → existing 2 + new = 3; must leave 2 → revoke 1 oldest
    const [, filter] = nativeUpdateMock.mock.calls[0]
    expect(filter).toEqual({ id: { $in: ['s1'] } })
  })

  it('falls back to the default cap when the env value is invalid', async () => {
    process.env.MAX_CUSTOMER_SESSIONS_PER_USER = '-3'
    const { CustomerSessionService } = await import('../services/customerSessionService')
    const { localEm } = buildService(['s1', 's2', 's3', 's4'])

    const service = new CustomerSessionService(localEm)
    await service.createSession(user, ['portal.view'])

    // default cap=5; existing 4 + new = 5 → no revoke
    expect(nativeUpdateMock).not.toHaveBeenCalled()
  })

  it('takes a per-user advisory lock in the transaction before counting and inserting', async () => {
    const { CustomerSessionService } = await import('../services/customerSessionService')
    const { CustomerUser } = await import('../data/entities')
    const { localEm, findMock, persistMock, createMock, executeMock, getReferenceMock, transactionalMock } =
      buildService(['s1'])

    const service = new CustomerSessionService(localEm)
    await service.createSession(user, ['portal.view'])

    expect(transactionalMock).toHaveBeenCalledTimes(1)
    expect(executeMock).toHaveBeenCalledTimes(1)
    const [, lockParams] = executeMock.mock.calls[0] as unknown as [string, unknown[]]
    expect(lockParams).toEqual([`customer_accounts:session_cap:${userId}`])
    expect(executeMock.mock.invocationCallOrder[0]).toBeLessThan(findMock.mock.invocationCallOrder[0])
    expect(findMock.mock.invocationCallOrder[0]).toBeLessThan(persistMock.mock.invocationCallOrder[0])
    expect(getReferenceMock).toHaveBeenCalledWith(CustomerUser, userId)
    expect(createMock.mock.calls[0][1].user).toEqual({ id: userId })
  })

  const buildRaceEm = (options: { existingIds?: string[]; failInsert?: boolean } = {}) => {
    let rows: { id: string; userId: string; deletedAt: Date | null }[] = (options.existingIds ?? []).map((id) => ({
      id,
      userId,
      deletedAt: null,
    }))
    let created = 0
    const heldKeys = new Set<string>()
    const lockAttempts: { key: string; locked: boolean }[] = []

    const buildTx = (holding: string[]) => {
      const tx = {
        find: jest.fn(async (_entity: unknown, filter: { user: string }) => {
          const snapshot = rows
            .filter((row) => row.deletedAt === null && row.userId === filter.user)
            .map((row) => ({ id: row.id }))
          await new Promise((resolve) => setTimeout(resolve, 10))
          return snapshot
        }),
        nativeUpdate: jest.fn(async (_entity: unknown, filter: { id?: { $in?: string[] } }) => {
          const ids = filter.id?.$in ?? []
          rows = rows.map((row) => (ids.includes(row.id) ? { ...row, deletedAt: new Date() } : row))
          return ids.length
        }),
        getReference: jest.fn((_entity: unknown, id: string) => ({ id })),
        create: jest.fn((_entity: unknown, data: { user: { id: string } }) => {
          created += 1
          return { id: `new-${created}`, ...data }
        }),
        persist: jest.fn((entity: { id: string; user: { id: string } }) => ({
          flush: jest.fn(async () => {
            if (options.failInsert) throw new Error('insert failed')
            rows.push({ id: entity.id, userId: entity.user.id, deletedAt: null })
          }),
        })),
        execute: jest.fn(async (_sql: string, params: string[]) => {
          const key = params[0]
          const locked = !heldKeys.has(key)
          lockAttempts.push({ key, locked })
          if (locked) {
            heldKeys.add(key)
            holding.push(key)
          }
          return [{ locked }]
        }),
      }
      return tx
    }

    const raceEm = {
      ...buildTx([]),
      fork: jest.fn(() => ({
        transactional: jest.fn(async (work: (tx: unknown) => Promise<unknown>) => {
          const holding: string[] = []
          const committed = rows.map((row) => ({ ...row }))
          try {
            return await work(buildTx(holding))
          } catch (error) {
            rows = committed
            throw error
          } finally {
            for (const key of holding) heldKeys.delete(key)
          }
        }),
      })),
    }
    return {
      raceEm: raceEm as unknown as EntityManager,
      liveRows: () => rows.filter((row) => row.deletedAt === null),
      lockAttempts,
    }
  }

  it('keeps at most the cap of live sessions when two logins for the same user race', async () => {
    process.env.MAX_CUSTOMER_SESSIONS_PER_USER = '1'
    const { CustomerSessionService } = await import('../services/customerSessionService')
    const { raceEm, liveRows } = buildRaceEm()

    const service = new CustomerSessionService(raceEm)
    await Promise.all([
      service.createSession(user, ['portal.view']),
      service.createSession(user, ['portal.view']),
    ])

    expect(liveRows()).toHaveLength(1)
  })

  it('rolls back the revoke of the oldest session when the new session cannot be inserted', async () => {
    process.env.MAX_CUSTOMER_SESSIONS_PER_USER = '1'
    const { CustomerSessionService } = await import('../services/customerSessionService')
    const { raceEm, liveRows } = buildRaceEm({ existingIds: ['oldest'], failInsert: true })

    const service = new CustomerSessionService(raceEm)
    await expect(service.createSession(user, ['portal.view'])).rejects.toThrow('insert failed')

    expect(liveRows().map((row) => row.id)).toEqual(['oldest'])
  })

  it('uses a separate lock key per user so logins of different users never contend', async () => {
    process.env.MAX_CUSTOMER_SESSIONS_PER_USER = '1'
    const { CustomerSessionService } = await import('../services/customerSessionService')
    const { raceEm, liveRows, lockAttempts } = buildRaceEm()
    const otherUser = { ...user, id: '66666666-6666-4666-8666-666666666666' }

    const service = new CustomerSessionService(raceEm)
    await Promise.all([
      service.createSession(user, ['portal.view']),
      service.createSession(otherUser, ['portal.view']),
    ])

    expect(lockAttempts).toHaveLength(2)
    expect(lockAttempts.every((attempt) => attempt.locked)).toBe(true)
    expect(liveRows()).toHaveLength(2)
  })
})

describe('CustomerSessionService.hasActiveSessionForUser', () => {
  const userId = '33333333-3333-4333-8333-333333333333'
  const tenantId = '44444444-4444-4444-8444-444444444444'
  const organizationId = '55555555-5555-4555-8555-555555555555'

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('scopes the lookup to live sessions owned by that customer identity', async () => {
    const { CustomerSessionService } = await import('../services/customerSessionService')
    const { CustomerUserSession } = await import('../data/entities')
    const findOneMock = jest.fn(async () => ({ id: 'live-session' }))
    const service = new CustomerSessionService({ findOne: findOneMock } as any)

    await expect(
      service.hasActiveSessionForUser({ userId, tenantId, organizationId }),
    ).resolves.toBe(true)

    const [entity, filter] = findOneMock.mock.calls[0] as unknown as [unknown, any]
    expect(entity).toBe(CustomerUserSession)
    expect(filter.user).toEqual({ id: userId, tenantId, organizationId })
    expect(filter.deletedAt).toBeNull()
    expect(filter.expiresAt.$gt).toBeInstanceOf(Date)
  })

  it('reports no active session once every session row is revoked', async () => {
    const { CustomerSessionService } = await import('../services/customerSessionService')
    const findOneMock = jest.fn(async () => null)
    const service = new CustomerSessionService({ findOne: findOneMock } as any)

    await expect(
      service.hasActiveSessionForUser({ userId, tenantId, organizationId }),
    ).resolves.toBe(false)
  })
})
