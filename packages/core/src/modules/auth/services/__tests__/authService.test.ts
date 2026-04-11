import { AuthService } from '@open-mercato/core/modules/auth/services/authService'
import { hashAuthToken } from '@open-mercato/core/modules/auth/lib/tokenHash'

function makeEm() {
  const calls: any[] = []
  const em: any = {
    persistAndFlush: jest.fn(async (e: any) => calls.push(['persistAndFlush', e])),
    create: jest.fn((_cls: any, data: any) => ({ ...data })),
    findOne: jest.fn(async () => null),
    nativeDelete: jest.fn(async () => undefined),
    find: jest.fn(async () => []),
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

  it('deleteSessionByToken queries by hashed token', async () => {
    const { em } = makeEm()
    const svc = new AuthService(em)
    await svc.deleteSessionByToken('raw-token-value')
    const nativeCall = (em.nativeDelete as jest.Mock).mock.calls[0]
    expect(nativeCall[1]).toEqual({ token: hashAuthToken('raw-token-value') })
  })

  it('refreshFromSessionToken looks up by hashed token', async () => {
    const { em } = makeEm()
    em.findOne.mockResolvedValueOnce(null)
    const svc = new AuthService(em)
    await svc.refreshFromSessionToken('raw-token-value')
    const findCall = (em.findOne as jest.Mock).mock.calls[0]
    expect(findCall[1]).toEqual({ token: hashAuthToken('raw-token-value') })
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

  it('confirmPasswordReset looks up by hashed token', async () => {
    const { em } = makeEm()
    em.findOne.mockResolvedValueOnce(null)
    const svc = new AuthService(em)
    const result = await svc.confirmPasswordReset('raw-token-value', 'NewPass1!')
    expect(result).toBeNull()
    const findCall = (em.findOne as jest.Mock).mock.calls[0]
    expect(findCall[1]).toEqual({ token: hashAuthToken('raw-token-value') })
  })
})
