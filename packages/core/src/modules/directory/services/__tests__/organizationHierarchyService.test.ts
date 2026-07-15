import { Organization } from '../../data/entities'
import { DefaultOrganizationHierarchyService } from '../organizationHierarchyService'

describe('DefaultOrganizationHierarchyService', () => {
  it('returns normalized ancestor ids for an organization in the requested tenant', async () => {
    const em = {
      findOne: jest.fn().mockResolvedValue({
        id: 'org-child',
        ancestorIds: ['org-root', ' org-parent ', 'org-root', ''],
      }),
    }
    const service = new DefaultOrganizationHierarchyService(em as never)

    await expect(service.resolveAncestorIds({
      tenantId: 'tenant-1',
      organizationId: 'org-child',
    })).resolves.toEqual(['org-root', 'org-parent'])
    expect(em.findOne).toHaveBeenCalledWith(
      Organization,
      { id: 'org-child', tenant: 'tenant-1', deletedAt: null },
      { fields: ['id', 'ancestorIds'] },
    )
  })

  it('returns null when Directory cannot prove the selected organization scope', async () => {
    const em = { findOne: jest.fn().mockResolvedValue(null) }
    const service = new DefaultOrganizationHierarchyService(em as never)

    await expect(service.resolveAncestorIds({
      tenantId: 'tenant-1',
      organizationId: 'missing-org',
    })).resolves.toBeNull()
  })
})
