import { AuthService } from '@open-mercato/core/modules/auth/services/authService'
import { hashOpaqueToken } from '@open-mercato/shared/lib/security/token'

function makeEm() {
  const calls: any[] = []
  const em: any = {
    persistAndFlush: jest.fn(async (e: any) => calls.push(['persistAndFlush', e])),
    create: jest.fn((cls: any, data: any) => ({ ...data })),
    findOne: jest.fn(async () => null),
    nativeDelete: jest.fn(async () => undefined),
    find: jest.fn(async () => []),
    flush: jest.fn(async () => undefined),
  }
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

  it('createSession persists and returns token', async () => {
    const { em } = makeEm()
    const svc = new AuthService(em)
    // @ts-expect-error partial
    const sess = await svc.createSession({ id: 1 }, new Date(Date.now() + 1000))
    expect(sess.token).toBeDefined()
    expect(em.persistAndFlush).toHaveBeenCalled()
  })

  it('stores only password reset token hash and returns raw token to caller', async () => {
    const { em } = makeEm()
    const user = { id: 'user-1', email: 'user@example.com' }
    const svc = new AuthService(em)
    jest.spyOn(svc, 'findUserByEmail').mockResolvedValue(user as never)

    const result = await svc.requestPasswordReset('user@example.com')

    expect(result?.token).toHaveLength(64)
    const persisted = em.create.mock.calls[0][1]
    expect(persisted.token).toBe(hashOpaqueToken(result!.token))
    expect(persisted.tokenHash).toBe(hashOpaqueToken(result!.token))
    expect(persisted.token).not.toBe(result?.token)
  })

  it('confirms reset by token hash before legacy plaintext fallback', async () => {
    const { em } = makeEm()
    const token = 'raw-reset-token'
    const tokenHash = hashOpaqueToken(token)
    const reset = {
      user: { id: 'user-1' },
      token: tokenHash,
      tokenHash,
      expiresAt: new Date(Date.now() + 60_000),
      usedAt: null,
    }
    const user = { id: 'user-1', passwordHash: 'old' }
    em.findOne
      .mockResolvedValueOnce(reset)
      .mockResolvedValueOnce(user)
    const svc = new AuthService(em)

    const result = await svc.confirmPasswordReset(token, 'new-password')

    expect(result).toBe(user)
    expect(em.findOne).toHaveBeenNthCalledWith(1, expect.any(Function), { tokenHash })
    expect(em.findOne).not.toHaveBeenCalledWith(expect.any(Function), { token })
    expect(reset.token).toBe(tokenHash)
    expect(reset.tokenHash).toBe(tokenHash)
    expect(reset.usedAt).toBeInstanceOf(Date)
    expect(em.flush).toHaveBeenCalled()
    expect(em.nativeDelete).toHaveBeenCalledWith(expect.any(Function), { user: 'user-1' })
  })

  it('confirms legacy plaintext reset token and upgrades row to hash', async () => {
    const { em } = makeEm()
    const token = 'legacy-reset-token'
    const tokenHash = hashOpaqueToken(token)
    const reset = {
      user: { id: 'user-1' },
      token,
      tokenHash: null,
      expiresAt: new Date(Date.now() + 60_000),
      usedAt: null,
    }
    const user = { id: 'user-1', passwordHash: 'old' }
    em.findOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(reset)
      .mockResolvedValueOnce(user)
    const svc = new AuthService(em)

    const result = await svc.confirmPasswordReset(token, 'new-password')

    expect(result).toBe(user)
    expect(em.findOne).toHaveBeenNthCalledWith(1, expect.any(Function), { tokenHash })
    expect(em.findOne).toHaveBeenNthCalledWith(2, expect.any(Function), { token })
    expect(reset.token).toBe(tokenHash)
    expect(reset.tokenHash).toBe(tokenHash)
  })
})
