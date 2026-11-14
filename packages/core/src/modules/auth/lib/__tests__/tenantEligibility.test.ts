import type { EntityManager } from '@mikro-orm/postgresql'
import { Tenant } from '@open-mercato/core/modules/directory/data/entities'
import { isStaffTenantActive } from '../tenantEligibility'

const mockFindOne = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => mockFindOne(...args),
}))

describe('staff tenant authentication eligibility', () => {
  const em = {} as EntityManager
  const tenantId = '22222222-2222-4222-8222-222222222222'

  beforeEach(() => mockFindOne.mockReset())

  it.each([
    { state: 'active', isActive: true, deletedAt: null, expected: true },
    { state: 'inactive', isActive: false, deletedAt: null, expected: false },
    { state: 'soft-deleted', isActive: true, deletedAt: new Date(), expected: false },
    { state: 'missing', isActive: undefined, deletedAt: null, expected: false },
  ])('checks a live $state tenant row', async ({ isActive, deletedAt, expected }) => {
    mockFindOne.mockImplementation(async (_em: unknown, _entity: unknown, filter: Record<string, unknown>) => (
      filter.id === tenantId && filter.isActive === isActive && filter.deletedAt === deletedAt
        ? { id: tenantId }
        : null
    ))
    await expect(isStaffTenantActive(em, tenantId)).resolves.toBe(expected)
    expect(mockFindOne).toHaveBeenCalledWith(em, Tenant,
      { id: tenantId, isActive: true, deletedAt: null }, { fields: ['id'], refresh: true })
  })

  it.each([null, undefined])('preserves tenantless staff eligibility (%s)', async (tenant) => {
    await expect(isStaffTenantActive(em, tenant)).resolves.toBe(true)
    expect(mockFindOne).not.toHaveBeenCalled()
  })

  it('propagates database failures', async () => {
    mockFindOne.mockRejectedValue(new Error('database unavailable'))
    await expect(isStaffTenantActive(em, tenantId)).rejects.toThrow('database unavailable')
  })
})
