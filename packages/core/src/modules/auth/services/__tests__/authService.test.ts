import { AuthService } from '@open-mercato/core/modules/auth/services/authService'

function makeEm() {
  const calls: any[] = []
  const em: any = {
    persistAndFlush: jest.fn(async (e: any) => calls.push(['persistAndFlush', e])),
    create: jest.fn((cls: any, data: any) => ({ ...data })),
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

  it('createSession persists and returns token', async () => {
    const { em } = makeEm()
    const svc = new AuthService(em)
    // @ts-expect-error partial
    const sess = await svc.createSession({ id: 1 }, new Date(Date.now() + 1000))
    expect(sess.token).toBeDefined()
    expect(em.persistAndFlush).toHaveBeenCalled()
  })
})
