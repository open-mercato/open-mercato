import { AuthService } from '@open-mercato/core/modules/auth/services/authService'

describe('refreshFromSessionToken — deleted user rejection', () => {
  it('returns null for a soft-deleted user', async () => {
    const em: any = {
      findOne: jest.fn(async (Entity: any, query: any) => {
        if (Entity.name === 'Session' || query.token) {
          return { expiresAt: new Date(Date.now() + 60_000), user: { id: 'u1' } }
        }
        if (query.deletedAt === null) return null
        return { id: 'u1', tenantId: 't1', deletedAt: new Date() }
      }),
      find: jest.fn(async () => []),
    }

    const svc = new AuthService(em)
    const result = await svc.refreshFromSessionToken('valid-token')
    expect(result).toBeNull()

    const userLookup = em.findOne.mock.calls.find(
      ([, q]: any[]) => q.id === 'u1',
    )
    expect(userLookup).toBeDefined()
    expect(userLookup[1].deletedAt).toBeNull()
  })

  it('returns user+roles for an active user', async () => {
    const activeUser = { id: 'u1', tenantId: 't1', organizationId: 'o1', deletedAt: null }
    const em: any = {
      findOne: jest.fn(async (Entity: any, query: any) => {
        if (Entity.name === 'Session' || query.token) {
          return { expiresAt: new Date(Date.now() + 60_000), user: { id: 'u1' } }
        }
        if (query.id === 'u1') return activeUser
        return null
      }),
      find: jest.fn(async () => []),
    }

    const svc = new AuthService(em)
    const result = await svc.refreshFromSessionToken('valid-token')
    expect(result).not.toBeNull()
    expect(result!.user.id).toBe('u1')
  })
})
