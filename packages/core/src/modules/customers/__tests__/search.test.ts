import { searchConfig } from '../search'

describe('customers search config', () => {
  test('person profile buildSource loads customer entity by entity id without profile joins', async () => {
    const personConfig = searchConfig.entities.find((entity) => entity.entityId === 'customers:customer_person_profile')
    expect(personConfig?.buildSource).toBeDefined()

    const query = jest.fn(async () => ({
      items: [
        {
          id: 'entity-1',
          kind: 'person',
          display_name: 'Ada Lovelace',
          primary_email: 'ada@example.com',
        },
      ],
    }))

    const result = await personConfig!.buildSource!({
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      queryEngine: {
        query,
      } as any,
      record: {
        id: 'profile-1',
        entity_id: 'entity-1',
        first_name: 'Ada',
        last_name: 'Lovelace',
      },
      customFields: {},
    })

    expect(result).not.toBeNull()
    expect(query).toHaveBeenCalledWith(
      'customers:customer_entity',
      expect.objectContaining({
        filters: {
          id: { $eq: 'entity-1' },
        },
      }),
    )
    expect(query.mock.calls[0]?.[1]).not.toHaveProperty('customFieldSources')
  })
})
