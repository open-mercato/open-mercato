import { AuthService } from '@open-mercato/core/modules/auth/services/authService'
import { Session } from '@open-mercato/core/modules/auth/data/entities'
import { hashAuthToken } from '@open-mercato/core/modules/auth/lib/tokenHash'

const mockFindOneWithDecryption = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => mockFindOneWithDecryption(...args),
  findWithDecryption: jest.fn().mockResolvedValue([]),
}))

function makeEm() {
  const calls: any[] = []
  const em: any = {
    persistAndFlush: jest.fn(async (e: any) => calls.push(['persistAndFlush', e])),
    create: jest.fn((_cls: any, data: any) => ({ ...data, id: 'generated-id' })),
    findOne: jest.fn(async () => null),
    nativeDelete: jest.fn(async () => 1),
    nativeUpdate: jest.fn(async () => 1),
    flush: jest.fn(async () => undefined),
    find: jest.fn(async () => []),
  }
  mockFindOneWithDecryption.mockImplementation(async (passedEm: any, _cls: any, filter: any) => {
    return passedEm.findOne?.(_cls, filter)
  })
  return { em, calls }
}

describe('AuthService', () => {
  it('verifyPassword returns false when no hash', async () => {
    const { em } = makeEm()
    const svc = new AuthService(em)
    // @ts-expect-error partial
    const ok = await svc.verifyPassword({ passwordHash: null }, 'x')
    expect(ok).toBe(false)
  })

  it('createSession persists hashed token and returns raw token', async () => {
    const { em } = makeEm()
    const svc = new AuthService(em)
    // @ts-expect-error partial
    const result = await svc.createSession({ id: 1 }, new Date(Date.now() + 1000))
    expect(typeof result.token).toBe('string')
    expect(result.token.length).toBeGreaterThan(0)

    const persisted = (em.persistAndFlush as jest.Mock).mock.calls[0][0]
    expect(persisted.token).toBe(hashAuthToken(result.token))
    expect(persisted.token).not.toBe(result.token)
  })

  it('deleteSessionByToken tries hashed token first then falls back to raw', async () => {
    const { em } = makeEm()
    em.nativeDelete.mockResolvedValueOnce(1)
    const svc = new AuthService(em)
    await svc.deleteSessionByToken('raw-token-value')
    expect(em.nativeDelete).toHaveBeenCalledTimes(1)
    expect((em.nativeDelete as jest.Mock).mock.calls[0][1]).toEqual({ token: hashAuthToken('raw-token-value') })
  })

  it('deleteSessionByToken falls back to raw token when hashed lookup deletes nothing', async () => {
    const { em } = makeEm()
    em.nativeDelete.mockResolvedValueOnce(0).mockResolvedValueOnce(1)
    const svc = new AuthService(em)
    await svc.deleteSessionByToken('raw-token-value')
    expect(em.nativeDelete).toHaveBeenCalledTimes(2)
    expect((em.nativeDelete as jest.Mock).mock.calls[0][1]).toEqual({ token: hashAuthToken('raw-token-value') })
    expect((em.nativeDelete as jest.Mock).mock.calls[1][1]).toEqual({ token: 'raw-token-value' })
  })

  it('refreshFromSessionToken looks up by hashed token first', async () => {
    const { em } = makeEm()
    em.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(null)
    const svc = new AuthService(em)
    await svc.refreshFromSessionToken('raw-token-value')
    const findCall = (em.findOne as jest.Mock).mock.calls[0]
    expect(findCall[1]).toEqual({ token: hashAuthToken('raw-token-value') })
  })

  it('refreshFromSessionToken falls back to raw token for legacy sessions', async () => {
    const { em } = makeEm()
    const legacySession = { token: 'raw-token-value', expiresAt: new Date(Date.now() + 60000), user: { id: 'u1' } }
    const user = { id: 'u1', tenantId: 't1', organizationId: 'o1' }
    em.findOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(legacySession)
      .mockResolvedValueOnce(user)
    em.find.mockResolvedValueOnce([])
    const svc = new AuthService(em)
    const result = await svc.refreshFromSessionToken('raw-token-value')
    expect(result).not.toBeNull()
    expect((em.findOne as jest.Mock).mock.calls[1][1]).toEqual({ token: 'raw-token-value' })
  })

  it('requestPasswordReset persists hashed token and returns raw token', async () => {
    const { em } = makeEm()
    em.findOne.mockResolvedValueOnce({ id: 'user-1', email: 'user@example.com' })
    const svc = new AuthService(em)
    const result = await svc.requestPasswordReset('user@example.com')
    expect(result).not.toBeNull()
    const rawToken = result!.token
    expect(typeof rawToken).toBe('string')
    expect(rawToken.length).toBeGreaterThan(0)

    const persisted = (em.persistAndFlush as jest.Mock).mock.calls[0][0]
    expect(persisted.token).toBe(hashAuthToken(rawToken))
    expect(persisted.token).not.toBe(rawToken)
  })

  it('confirmPasswordReset looks up by hashed token first', async () => {
    const { em } = makeEm()
    em.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(null)
    const svc = new AuthService(em)
    const result = await svc.confirmPasswordReset('raw-token-value', 'NewPass1!')
    expect(result).toBeNull()
    const findCall = (em.findOne as jest.Mock).mock.calls[0]
    expect(findCall[1]).toEqual({ token: hashAuthToken('raw-token-value') })
  })

  it('confirmPasswordReset falls back to raw token for legacy resets', async () => {
    const { em } = makeEm()
    em.findOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ token: 'raw-token-value', expiresAt: new Date(Date.now() + 60000), usedAt: null, user: { id: 'u1' } })
      .mockResolvedValueOnce(null)
    const svc = new AuthService(em)
    const result = await svc.confirmPasswordReset('raw-token-value', 'NewPass1!')
    expect(result).toBeNull()
    expect((em.findOne as jest.Mock).mock.calls[1][1]).toEqual({ token: 'raw-token-value' })
  })

  it('deleteSessionById invokes nativeDelete with the id filter', async () => {
    const { em } = makeEm()
    const svc = new AuthService(em)
    await svc.deleteSessionById('session-1')
    expect(em.nativeDelete).toHaveBeenCalledWith(Session, { id: 'session-1' })
  })

  it('findActiveSessionById returns the session when not soft-deleted and not expired', async () => {
    const { em } = makeEm()
    em.findOne.mockResolvedValueOnce({
      id: 'session-1',
      deletedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    })
    const svc = new AuthService(em)
    await expect(svc.findActiveSessionById('session-1')).resolves.toMatchObject({ id: 'session-1' })
    expect(em.findOne).toHaveBeenCalledWith(Session, { id: 'session-1', deletedAt: null })
  })

  it('findActiveSessionById returns null when session row is missing', async () => {
    const { em } = makeEm()
    em.findOne.mockResolvedValueOnce(null)
    const svc = new AuthService(em)
    await expect(svc.findActiveSessionById('session-1')).resolves.toBeNull()
  })

  it('findActiveSessionById returns null when session row exists but has already expired', async () => {
    const { em } = makeEm()
    em.findOne.mockResolvedValueOnce({
      id: 'session-1',
      deletedAt: null,
      expiresAt: new Date(Date.now() - 1_000),
    })
    const svc = new AuthService(em)
    await expect(svc.findActiveSessionById('session-1')).resolves.toBeNull()
  })

  // -------------------------------------------------------------------------
  // Regression: password reset token replay prevention (issue #1414)
  // -------------------------------------------------------------------------

  it('confirmPasswordReset uses atomic nativeUpdate to prevent concurrent token replay', async () => {
    const { em } = makeEm()
    const resetRow = {
      id: 'reset-1',
      token: hashAuthToken('raw-token-value'),
      expiresAt: new Date(Date.now() + 60000),
      usedAt: null,
      user: { id: 'u1' },
    }
    em.findOne.mockResolvedValueOnce(resetRow)
    em.nativeUpdate.mockResolvedValueOnce(1)
    mockFindOneWithDecryption.mockResolvedValueOnce({ id: 'u1', passwordHash: 'old-hash', deletedAt: null })

    const svc = new AuthService(em)
    const result = await svc.confirmPasswordReset('raw-token-value', 'NewSecurePass1!')

    expect(result).not.toBeNull()
    expect(em.nativeUpdate).toHaveBeenCalledTimes(1)
    const [_entity, filter, update] = em.nativeUpdate.mock.calls[0]
    expect(filter).toMatchObject({ id: 'reset-1', usedAt: null })
    expect(update).toMatchObject({ usedAt: expect.any(Date) })
  })

  it('confirmPasswordReset returns null when nativeUpdate affects 0 rows (token already consumed)', async () => {
    const { em } = makeEm()
    const resetRow = {
      id: 'reset-1',
      token: hashAuthToken('raw-token-value'),
      expiresAt: new Date(Date.now() + 60000),
      usedAt: null,
      user: { id: 'u1' },
    }
    em.findOne.mockResolvedValueOnce(resetRow)
    em.nativeUpdate.mockResolvedValueOnce(0)

    const svc = new AuthService(em)
    const result = await svc.confirmPasswordReset('raw-token-value', 'NewSecurePass1!')

    expect(result).toBeNull()
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('confirmPasswordReset does not set usedAt via ORM — only via nativeUpdate', async () => {
    const { em } = makeEm()
    const resetRow = {
      id: 'reset-1',
      token: hashAuthToken('raw-token-value'),
      expiresAt: new Date(Date.now() + 60000),
      usedAt: null,
      user: { id: 'u1' },
    }
    em.findOne.mockResolvedValueOnce(resetRow)
    em.nativeUpdate.mockResolvedValueOnce(1)
    mockFindOneWithDecryption.mockResolvedValueOnce({ id: 'u1', passwordHash: 'old-hash', deletedAt: null })

    const svc = new AuthService(em)
    await svc.confirmPasswordReset('raw-token-value', 'NewSecurePass1!')

    expect(resetRow.usedAt).toBeNull()
  })
})
