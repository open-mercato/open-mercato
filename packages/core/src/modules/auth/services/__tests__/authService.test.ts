import { AuthService } from '@open-mercato/core/modules/auth/services/authService'
import { Session, User } from '@open-mercato/core/modules/auth/data/entities'
import { hashAuthToken } from '@open-mercato/core/modules/auth/lib/tokenHash'
import { AuthSessionRejectedError, capturePasswordSessionProof } from '@open-mercato/core/modules/auth/lib/sessionEligibility'
import { LockMode } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'

const mockFindOneWithDecryption = jest.fn()
const mockFindWithDecryption = jest.fn().mockResolvedValue([])

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => mockFindOneWithDecryption(...args),
  findWithDecryption: (...args: unknown[]) => mockFindWithDecryption(...args),
}))

function makeEm() {
  const calls: any[] = []
  const persisted: any[] = []
  const flushFn = jest.fn(async () => undefined)
  const em: any = {
    persist: jest.fn((entity: any) => { persisted.push(entity); calls.push(['persist', entity]); return em }),
    flush: flushFn,
    create: jest.fn((_cls: any, data: any) => ({ ...data, id: 'generated-id' })),
    findOne: jest.fn(async () => null),
    nativeDelete: jest.fn(async () => 1),
    nativeUpdate: jest.fn(async () => 1),
    find: jest.fn(async () => []),
    transactional: jest.fn((callback: (txEm: EntityManager) => unknown) => callback(em)),
  }
  mockFindOneWithDecryption.mockImplementation(async (passedEm: any, _cls: any, filter: any) => {
    return passedEm.findOne?.(_cls, filter)
  })
  return { em, calls, persisted }
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
    const { em, persisted } = makeEm()
    const svc = new AuthService(em)
    // @ts-expect-error partial
    const result = await svc.createSession({ id: 1 }, new Date(Date.now() + 1000))
    expect(typeof result.token).toBe('string')
    expect(result.token.length).toBeGreaterThan(0)

    expect(em.flush).toHaveBeenCalled()
    const row = persisted[0]
    expect(row.token).toBe(hashAuthToken(result.token))
    expect(row.token).not.toBe(result.token)
  })

  it.each([{ email: 'new@example.com' }, { passwordHash: 'new-hash' }])(
    'refuses to issue a password session when locked credentials changed (%j)',
    async (changed) => {
      const { em } = makeEm()
      const user = { id: 'user-1', email: 'old@example.com', passwordHash: 'old-hash' } as User
      em.findOne.mockResolvedValueOnce({ ...user, ...changed })

      await expect(new AuthService(em).createSession(
        user, new Date(Date.now() + 1000), capturePasswordSessionProof(user),
      )).rejects.toBeInstanceOf(AuthSessionRejectedError)

      expect(em.transactional).toHaveBeenCalledTimes(1)
      expect(mockFindOneWithDecryption).toHaveBeenCalledWith(em, User,
        expect.objectContaining({ id: user.id }),
        { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true },
        { tenantId: null, organizationId: null },
      )
      expect(em.persist).not.toHaveBeenCalled()
    },
  )

  it('creates a remembered password session after the locked credential check', async () => {
    const { em } = makeEm()
    const user = { id: 'user-1', email: 'user@example.com', passwordHash: 'stored-hash' } as User
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    em.findOne.mockResolvedValueOnce(user)

    await expect(new AuthService(em).createSession(
      user, expiresAt, capturePasswordSessionProof(user),
    )).resolves.toMatchObject({ session: { expiresAt, user } })
  })

  // -------------------------------------------------------------------------
  // Regression: login 500 — getUserRoles must not throw on an orphaned UserRole
  // whose populated role is null (link to a soft-deleted / re-seeded role).
  // -------------------------------------------------------------------------

  it('getUserRoles skips links whose populated role is null instead of throwing', async () => {
    const { em } = makeEm()
    mockFindWithDecryption.mockResolvedValueOnce([
      { role: null },
      { role: { name: 'admin' } },
      { role: { name: '   ' } },
      { role: { name: 'employee' } },
    ])
    const svc = new AuthService(em)
    // @ts-expect-error partial user fixture is sufficient for this path
    const roles = await svc.getUserRoles({ id: 'u1', tenantId: 't1', organizationId: 'o1' }, 't1')
    expect(roles).toEqual(['admin', 'employee'])
  })

  it('getUserRoles returns an empty list (no throw) when the user has no role links', async () => {
    const { em } = makeEm()
    mockFindWithDecryption.mockResolvedValueOnce([])
    const svc = new AuthService(em)
    // @ts-expect-error partial user fixture is sufficient for this path
    const roles = await svc.getUserRoles({ id: 'u1', tenantId: 't1', organizationId: 'o1' }, 't1')
    expect(roles).toEqual([])
  })

  it('deleteSessionByToken deletes only by the hashed token', async () => {
    const { em } = makeEm()
    em.nativeDelete.mockResolvedValueOnce(1)
    const svc = new AuthService(em)
    await svc.deleteSessionByToken('raw-token-value')
    expect(em.nativeDelete).toHaveBeenCalledTimes(1)
    expect((em.nativeDelete as jest.Mock).mock.calls[0][1]).toEqual({ token: hashAuthToken('raw-token-value') })
  })

  // -------------------------------------------------------------------------
  // Regression: no raw (unhashed) token fallback at rest (issue #2691)
  // The stored token column value must never be accepted as a usable credential.
  // -------------------------------------------------------------------------

  it('deleteSessionByToken never falls back to a raw-token delete when the hashed lookup misses', async () => {
    const { em } = makeEm()
    em.nativeDelete.mockResolvedValueOnce(0)
    const svc = new AuthService(em)
    await svc.deleteSessionByToken('raw-token-value')
    expect(em.nativeDelete).toHaveBeenCalledTimes(1)
    const rawCall = (em.nativeDelete as jest.Mock).mock.calls.find(
      (call) => call[1] && call[1].token === 'raw-token-value',
    )
    expect(rawCall).toBeUndefined()
  })

  it('refreshFromSessionToken looks up by the hashed token only', async () => {
    const { em } = makeEm()
    em.findOne.mockResolvedValueOnce(null)
    const svc = new AuthService(em)
    await svc.refreshFromSessionToken('raw-token-value')
    expect(em.findOne).toHaveBeenCalledTimes(1)
    expect((em.findOne as jest.Mock).mock.calls[0][1]).toEqual({ token: hashAuthToken('raw-token-value') })
  })

  it('refreshFromSessionToken rejects a raw (legacy plaintext) session token', async () => {
    const { em } = makeEm()
    const legacySession = { token: 'raw-token-value', expiresAt: new Date(Date.now() + 60000), user: { id: 'u1' } }
    em.findOne.mockImplementation(async (_cls: any, filter: any) =>
      filter && filter.token === 'raw-token-value' ? legacySession : null,
    )
    const svc = new AuthService(em)
    const result = await svc.refreshFromSessionToken('raw-token-value')
    expect(result).toBeNull()
    expect(em.findOne).toHaveBeenCalledTimes(1)
    expect((em.findOne as jest.Mock).mock.calls[0][1]).toEqual({ token: hashAuthToken('raw-token-value') })
    const rawCall = (em.findOne as jest.Mock).mock.calls.find(
      (call) => call[1] && call[1].token === 'raw-token-value',
    )
    expect(rawCall).toBeUndefined()
  })

  it('requestPasswordReset persists hashed token and returns raw token', async () => {
    const { em, persisted } = makeEm()
    const user = { id: 'user-1', email: 'user@example.com' }
    em.findOne.mockResolvedValueOnce(user).mockResolvedValueOnce(user)
    const svc = new AuthService(em)
    const result = await svc.requestPasswordReset('user@example.com')
    expect(result).not.toBeNull()
    const rawToken = result!.token
    expect(typeof rawToken).toBe('string')
    expect(rawToken.length).toBeGreaterThan(0)

    expect(em.flush).toHaveBeenCalled()
    const row = persisted[0]
    expect(row.token).toBe(hashAuthToken(rawToken))
    expect(row.token).not.toBe(rawToken)
  })

  it('does not issue a reset link when the email changed while acquiring its user lock', async () => {
    const { em } = makeEm()
    const user = { id: 'user-1', email: 'old@example.com' }
    em.findOne.mockResolvedValueOnce(user).mockResolvedValueOnce({ ...user, email: 'new@example.com' })

    await expect(new AuthService(em).requestPasswordReset(user.email)).resolves.toBeNull()
    expect(em.transactional).toHaveBeenCalledTimes(1)
    expect(em.persist).not.toHaveBeenCalled()
  })

  it('confirmPasswordReset looks up by the hashed token only', async () => {
    const { em } = makeEm()
    em.findOne.mockResolvedValueOnce(null)
    const svc = new AuthService(em)
    const result = await svc.confirmPasswordReset('raw-token-value', 'NewPass1!')
    expect(result).toBeNull()
    expect(em.findOne).toHaveBeenCalledTimes(1)
    expect((em.findOne as jest.Mock).mock.calls[0][1]).toEqual({ token: hashAuthToken('raw-token-value') })
  })

  it('confirmPasswordReset rejects a raw (legacy plaintext) reset token', async () => {
    const { em } = makeEm()
    em.findOne.mockImplementation(async (_cls: any, filter: any) =>
      filter && filter.token === 'raw-token-value'
        ? { token: 'raw-token-value', expiresAt: new Date(Date.now() + 60000), usedAt: null, user: { id: 'u1' } }
        : null,
    )
    const svc = new AuthService(em)
    const result = await svc.confirmPasswordReset('raw-token-value', 'NewPass1!')
    expect(result).toBeNull()
    expect(em.findOne).toHaveBeenCalledTimes(1)
    expect((em.findOne as jest.Mock).mock.calls[0][1]).toEqual({ token: hashAuthToken('raw-token-value') })
    const rawCall = (em.findOne as jest.Mock).mock.calls.find(
      (call) => call[1] && call[1].token === 'raw-token-value',
    )
    expect(rawCall).toBeUndefined()
    expect(em.nativeUpdate).not.toHaveBeenCalled()
  })

  // -------------------------------------------------------------------------
  // Regression: the reset page must be able to check a token before rendering
  // the form, without consuming it (issue #5533).
  // -------------------------------------------------------------------------

  it('isPasswordResetTokenValid accepts an unused, unexpired token without consuming it', async () => {
    const { em } = makeEm()
    em.findOne.mockResolvedValueOnce({
      id: 'reset-1',
      token: hashAuthToken('raw-token-value'),
      expiresAt: new Date(Date.now() + 60000),
      usedAt: null,
      user: { id: 'u1' },
    })
    em.findOne.mockResolvedValueOnce({ id: 'u1' })
    const svc = new AuthService(em)
    await expect(svc.isPasswordResetTokenValid('raw-token-value')).resolves.toBe(true)
    expect(em.nativeUpdate).not.toHaveBeenCalled()
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('isPasswordResetTokenValid rejects a live token whose user has been soft-deleted', async () => {
    const { em } = makeEm()
    em.findOne.mockResolvedValueOnce({
      id: 'reset-1',
      token: hashAuthToken('raw-token-value'),
      expiresAt: new Date(Date.now() + 60000),
      usedAt: null,
      user: { id: 'u1' },
    })
    em.findOne.mockResolvedValueOnce(null)
    const svc = new AuthService(em)
    await expect(svc.isPasswordResetTokenValid('raw-token-value')).resolves.toBe(false)
    expect((em.findOne as jest.Mock).mock.calls[1][1]).toEqual({ id: 'u1', deletedAt: null })
    expect(em.nativeUpdate).not.toHaveBeenCalled()
  })

  it('isPasswordResetTokenValid rejects an already-used token', async () => {
    const { em } = makeEm()
    em.findOne.mockResolvedValueOnce({
      id: 'reset-1',
      token: hashAuthToken('raw-token-value'),
      expiresAt: new Date(Date.now() + 60000),
      usedAt: new Date(Date.now() - 1000),
      user: { id: 'u1' },
    })
    const svc = new AuthService(em)
    await expect(svc.isPasswordResetTokenValid('raw-token-value')).resolves.toBe(false)
  })

  it('isPasswordResetTokenValid rejects an expired token', async () => {
    const { em } = makeEm()
    em.findOne.mockResolvedValueOnce({
      id: 'reset-1',
      token: hashAuthToken('raw-token-value'),
      expiresAt: new Date(Date.now() - 1000),
      usedAt: null,
      user: { id: 'u1' },
    })
    const svc = new AuthService(em)
    await expect(svc.isPasswordResetTokenValid('raw-token-value')).resolves.toBe(false)
  })

  it('isPasswordResetTokenValid looks up by the hashed token only', async () => {
    const { em } = makeEm()
    em.findOne.mockResolvedValueOnce(null)
    const svc = new AuthService(em)
    await expect(svc.isPasswordResetTokenValid('raw-token-value')).resolves.toBe(false)
    expect(em.findOne).toHaveBeenCalledTimes(1)
    expect((em.findOne as jest.Mock).mock.calls[0][1]).toEqual({ token: hashAuthToken('raw-token-value') })
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
    expect(filter).toMatchObject({ id: 'reset-1', user: 'u1', token: resetRow.token, usedAt: null, expiresAt: { $gt: expect.any(Date) } })
    expect(update).toMatchObject({ usedAt: expect.any(Date) })
    expect(em.nativeDelete).toHaveBeenCalledWith(Session, { user: 'u1' })
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
    mockFindOneWithDecryption.mockResolvedValueOnce({ id: 'u1', passwordHash: 'old-hash' })

    const svc = new AuthService(em)
    const result = await svc.confirmPasswordReset('raw-token-value', 'NewSecurePass1!')

    expect(result).toBeNull()
    expect(em.nativeUpdate).toHaveBeenCalledTimes(1)
    expect(em.flush).not.toHaveBeenCalled()
    expect(em.nativeDelete).not.toHaveBeenCalled()
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
