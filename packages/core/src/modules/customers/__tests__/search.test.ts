import { searchConfig } from '../search'

describe('customers search', () => {
  it('uses operator equality filters when loading the parent customer entity for person profiles', async () => {
    const query = jest.fn().mockResolvedValue({
      items: [
        {
          id: 'entity-1',
          kind: 'person',
          display_name: 'Ada Lovelace',
          organization_id: 'org-1',
          tenant_id: 'tenant-1',
        },
      ],
      page: 1,
      pageSize: 1,
      total: 1,
    })

    const personConfig = searchConfig.entities.find((entry) => entry.entityId === 'customers:customer_person_profile')
    expect(personConfig?.buildSource).toBeDefined()

    await personConfig!.buildSource!({
      record: {
        id: 'profile-1',
        entity_id: 'entity-1',
        first_name: 'Ada',
        last_name: 'Lovelace',
      },
      customFields: {},
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      queryEngine: { query },
    })

    expect(query).toHaveBeenCalledWith(
      'customers:customer_entity',
      expect.objectContaining({
        tenantId: 'tenant-1',
        organizationId: 'org-1',
        filters: expect.objectContaining({
          id: { $eq: 'entity-1' },
          'person_profile.id': { $eq: 'profile-1' },
        }),
      }),
    )
  })
})
