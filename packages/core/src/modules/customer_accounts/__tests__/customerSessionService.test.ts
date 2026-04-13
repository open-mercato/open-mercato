jest.mock('@open-mercato/shared/lib/auth/jwt', () => ({
  signJwt: jest.fn(() => 'mock-jwt'),
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
