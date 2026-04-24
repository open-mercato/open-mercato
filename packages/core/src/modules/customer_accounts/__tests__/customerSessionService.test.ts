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
    const localEm = {
      find: findMock,
      nativeUpdate: nativeUpdateMock,
      persist: persistMock,
      flush: flushMock,
      create: createMock,
    } as any
    return { localEm, findMock, persistMock, flushMock, createMock }
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
})
