import type { EntityManager } from '@mikro-orm/postgresql'
import { Session, User } from '@open-mercato/core/modules/auth/data/entities'
import { Tenant } from '@open-mercato/core/modules/directory/data/entities'
import { AuthService } from '../authService'

const mockFindOneWithDecryption = jest.fn()
const mockFindWithDecryption = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => mockFindOneWithDecryption(...args),
  findWithDecryption: (...args: unknown[]) => mockFindWithDecryption(...args),
}))

describe('staff session tenant eligibility', () => {
  const tenantId = '22222222-2222-4222-8222-222222222222'
  const user = { id: '11111111-1111-4111-8111-111111111111', tenantId, organizationId: null } as User
  const session = { id: '88888888-8888-4888-8888-888888888888', user, expiresAt: new Date(Date.now() + 60_000) }
  const flush = jest.fn()
  const emMock = {
    findOne: jest.fn(),
    create: jest.fn(),
    persist: jest.fn(),
    flush,
  }
  const em = emMock as unknown as EntityManager

  beforeEach(() => {
    jest.clearAllMocks()
    mockFindWithDecryption.mockResolvedValue([])
    emMock.findOne.mockResolvedValue(session)
    emMock.create.mockReturnValue(session)
    emMock.persist.mockReturnValue({ flush })
    flush.mockResolvedValue(undefined)
  })

  it.each([
    { state: 'active', isActive: true, deletedAt: null, available: true },
    { state: 'inactive', isActive: false, deletedAt: null, available: false },
    { state: 'soft-deleted', isActive: true, deletedAt: new Date(), available: false },
    { state: 'missing', isActive: undefined, deletedAt: null, available: false },
  ])('enforces $state tenant state for issuance and refresh', async ({ isActive, deletedAt, available }) => {
    mockFindOneWithDecryption.mockImplementation(async (_em: unknown, entity: unknown, filter: Record<string, unknown>) => {
      if (entity === User) return user
      if (entity === Tenant && filter.id === tenantId && filter.isActive === isActive && filter.deletedAt === deletedAt) {
        return { id: tenantId }
      }
      return null
    })
    const service = new AuthService(em)
    if (available) {
      await expect(service.refreshFromSessionToken('refresh-token')).resolves.toMatchObject({ user, session })
      await expect(service.createSession(user, session.expiresAt)).resolves.toMatchObject({ session })
      expect(emMock.create).toHaveBeenCalledWith(Session, expect.anything())
    } else {
      await expect(service.refreshFromSessionToken('refresh-token')).resolves.toBeNull()
      await expect(service.createSession(user, session.expiresAt)).rejects.toThrow('[internal] Tenant is not available for authentication')
      expect(emMock.persist).not.toHaveBeenCalled()
      expect(mockFindWithDecryption).not.toHaveBeenCalled()
    }
  })

  it('preserves refresh and issuance for tenantless staff', async () => {
    const tenantless = { ...user, tenantId: null } as User
    mockFindOneWithDecryption.mockResolvedValue(tenantless)
    const service = new AuthService(em)
    await expect(service.refreshFromSessionToken('refresh-token')).resolves.toMatchObject({ user: tenantless })
    await expect(service.createSession(tenantless, session.expiresAt)).resolves.toMatchObject({ session })
    expect(mockFindOneWithDecryption.mock.calls.every((call: unknown[]) => call[1] === User)).toBe(true)
  })
})
