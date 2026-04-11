import { AuthService } from '@open-mercato/core/modules/auth/services/authService'
import { Session } from '@open-mercato/core/modules/auth/data/entities'

function makeEm() {
  const calls: any[] = []
  const em: any = {
    persistAndFlush: jest.fn(async (e: any) => calls.push(['persistAndFlush', e])),
    create: jest.fn((_cls: any, data: any) => ({ ...data, id: 'generated-id' })),
    findOne: jest.fn(async () => null),
    nativeDelete: jest.fn(async () => 1),
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

  it('createSession persists and returns token', async () => {
    const { em } = makeEm()
    const svc = new AuthService(em)
    // @ts-expect-error partial
    const sess = await svc.createSession({ id: 1 }, new Date(Date.now() + 1000))
    expect(sess.token).toBeDefined()
    expect(em.persistAndFlush).toHaveBeenCalled()
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
})
