/** @jest-environment node */
import type { EntityManager } from '@mikro-orm/postgresql'
import { Session, User } from '@open-mercato/core/modules/auth/data/entities'
import { Tenant } from '@open-mercato/core/modules/directory/data/entities'
import { AuthService } from '@open-mercato/core/modules/auth/services/authService'
import { hashAuthToken } from '@open-mercato/core/modules/auth/lib/tokenHash'
import { POST } from '../logout'

const mockFindOneWithDecryption = jest.fn()
const mockEmitAuthEvent = jest.fn().mockResolvedValue(undefined)
const mockFindSession = jest.fn()
const mockDeleteSession = jest.fn().mockResolvedValue(1)
const mockEntityManager = { findOne: mockFindSession, nativeDelete: mockDeleteSession }

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => ({
    resolve: () => new AuthService(mockEntityManager as unknown as EntityManager),
  }),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => mockFindOneWithDecryption(...args),
  findWithDecryption: async () => [],
}))

jest.mock('@open-mercato/core/modules/auth/events', () => ({
  emitAuthEvent: (...args: unknown[]) => mockEmitAuthEvent(...args),
}))

describe('refresh-only logout with AuthService', () => {
  const userId = '11111111-1111-4111-8111-111111111111'
  const tenantId = '22222222-2222-4222-8222-222222222222'
  const organizationId = '33333333-3333-4333-8333-333333333333'
  const sessionId = '44444444-4444-4444-8444-444444444444'
  const refreshToken = 'refresh-only-logout-test-token'
  const user = { id: userId, tenantId, organizationId }

  beforeEach(() => {
    jest.clearAllMocks()
    mockFindSession.mockResolvedValue({
      id: sessionId,
      user: { id: userId },
      expiresAt: new Date(Date.now() + 60_000),
    })
    mockFindOneWithDecryption.mockImplementation(async (_em: unknown, entity: unknown) => {
      if (entity === User) return user
      if (entity === Tenant) return { id: tenantId }
      return null
    })
  })

  async function logout() {
    return POST(new Request('http://localhost/api/auth/logout', {
      method: 'POST',
      headers: {
        cookie: `session_token=${refreshToken}; om_selected_org=untrusted-org; om_selected_tenant=untrusted-tenant`,
      },
    }))
  }

  it('identifies the hashed session and emits its canonical scope after revocation', async () => {
    const response = await logout()

    expect(response.status).toBe(303)
    expect(mockFindSession).toHaveBeenCalledWith(Session, { token: hashAuthToken(refreshToken) })
    expect(mockFindOneWithDecryption).toHaveBeenCalledWith(mockEntityManager, User, { id: userId, deletedAt: null })
    expect(mockEmitAuthEvent).toHaveBeenCalledWith('auth.logout', {
      id: userId,
      tenantId,
      organizationId,
      sessionId,
      sessionRevoked: true,
      at: expect.any(String),
    }, { persistent: true })
    expect(mockDeleteSession).toHaveBeenCalledTimes(1)
    expect(mockDeleteSession).toHaveBeenCalledWith(Session, { token: hashAuthToken(refreshToken) })
    expect(mockFindSession.mock.invocationCallOrder[0]).toBeLessThan(mockDeleteSession.mock.invocationCallOrder[0])
  })

  it('emits once when two requests inspect the same session before deletion', async () => {
    mockDeleteSession.mockResolvedValueOnce(1).mockResolvedValueOnce(0)

    const responses = await Promise.all([logout(), logout()])

    expect(responses.map((response) => response.status)).toEqual([303, 303])
    expect(mockFindSession).toHaveBeenCalledTimes(2)
    expect(mockDeleteSession).toHaveBeenCalledTimes(2)
    expect(mockEmitAuthEvent).toHaveBeenCalledTimes(1)
  })

  it.each(['missing', 'expired', 'deleted', 'deleted-user', 'inactive-tenant'])('revokes without an event for a %s session identity', async (state) => {
    if (state === 'missing') mockFindSession.mockResolvedValueOnce(null)
    if (state === 'expired') mockFindSession.mockResolvedValueOnce({
      id: sessionId, user: { id: userId }, expiresAt: new Date(Date.now() - 60_000),
    })
    if (state === 'deleted') mockFindSession.mockResolvedValueOnce({
      id: sessionId, user: { id: userId }, expiresAt: new Date(Date.now() + 60_000), deletedAt: new Date(),
    })
    if (state === 'deleted-user') mockFindOneWithDecryption.mockResolvedValueOnce(null)
    if (state === 'inactive-tenant') mockFindOneWithDecryption.mockImplementation(async (_em: unknown, entity: unknown) => (
      entity === User ? user : null
    ))

    const response = await logout()

    expect(response.status).toBe(303)
    expect(mockDeleteSession).toHaveBeenCalledWith(Session, { token: hashAuthToken(refreshToken) })
    expect(mockEmitAuthEvent).not.toHaveBeenCalled()
    expect(response.headers.get('set-cookie')).toContain('session_token=;')
  })
})
