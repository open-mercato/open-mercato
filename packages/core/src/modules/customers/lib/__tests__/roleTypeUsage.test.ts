import { loadRoleTypeUsage } from '../roleTypeUsage'

describe('loadRoleTypeUsage', () => {
  it('counts assignments across the source organization and its descendants', async () => {
    const em = {
      find: jest.fn(async () => [
        {
          id: 'org-root',
          descendantIds: ['org-child'],
        },
      ]),
      count: jest.fn(async (entity: { name?: string }, filters: Record<string, unknown>) => {
        if (entity?.name === 'CustomerEntityRole') {
          expect(filters).toEqual(
            expect.objectContaining({
              tenantId: 'tenant-1',
              roleType: 'renewal_owner',
              organizationId: { $in: ['org-root', 'org-child'] },
            }),
          )
          return 2
        }
        expect(filters).toEqual(
          expect.objectContaining({
            tenantId: 'tenant-1',
            roleValue: 'renewal_owner',
            organizationId: { $in: ['org-root', 'org-child'] },
          }),
        )
        return 3
      }),
    }

    const usage = await loadRoleTypeUsage(em as any, {
      tenantId: 'tenant-1',
      organizationId: 'org-root',
      value: 'renewal_owner',
    })

    expect(usage).toEqual({
      total: 5,
      ownerAssignments: 2,
      relationshipAssignments: 3,
    })
    expect(em.find).toHaveBeenCalledTimes(1)
    expect(em.count).toHaveBeenCalledTimes(2)
  })
})
