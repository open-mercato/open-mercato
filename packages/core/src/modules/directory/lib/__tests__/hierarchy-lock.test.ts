import { LockMode } from '@mikro-orm/core'
import { Organization, Tenant } from '@open-mercato/core/modules/directory/data/entities'
import { lockOrganizationHierarchyForTenant } from '../hierarchy'

describe('organization hierarchy locking', () => {
  it('locks the complete live tenant hierarchy in canonical id order', async () => {
    const organizations = [{ id: 'org-a' }, { id: 'org-b' }]
    const em = {
      findOne: jest.fn(async () => ({ id: 'tenant-1' })),
      find: jest.fn(async () => organizations),
    }

    await expect(lockOrganizationHierarchyForTenant(em as never, 'tenant-1')).resolves.toBe(organizations)
    expect(em.findOne).toHaveBeenCalledWith(
      Tenant,
      { id: 'tenant-1' },
      { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true },
    )
    expect(em.find).toHaveBeenCalledWith(
      Organization,
      { tenant: 'tenant-1', deletedAt: null },
      {
        lockMode: LockMode.PESSIMISTIC_WRITE,
        orderBy: { id: 'ASC' },
        refresh: true,
      },
    )
  })
})
