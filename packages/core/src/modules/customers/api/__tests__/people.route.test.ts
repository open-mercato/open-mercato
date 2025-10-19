import type { EntityManager } from '@mikro-orm/postgresql'
jest.mock('remark-gfm', () => ({
  __esModule: true,
  default: () => null,
}))
import { enrichPeopleListWithCustomFields } from '../people/enrich'
import { loadCustomFieldValues } from '@open-mercato/shared/lib/crud/custom-fields'
import { CustomerPersonProfile } from '../../data/entities'
import { E } from '@open-mercato/core/generated/entities.ids.generated'

jest.mock('@open-mercato/shared/lib/crud/custom-fields', () => {
  const actual = jest.requireActual('@open-mercato/shared/lib/crud/custom-fields')
  return {
    ...actual,
    loadCustomFieldValues: jest.fn(),
  }
})

const mockedLoadCustomFieldValues = loadCustomFieldValues as jest.MockedFunction<typeof loadCustomFieldValues>

describe('enrichPeopleListWithCustomFields', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns original array when there are no items', async () => {
    const em = { find: jest.fn() } as unknown as EntityManager
    const items: Record<string, unknown>[] = []
    const result = await enrichPeopleListWithCustomFields(em, items, {})
    expect(result).toBe(items)
    expect(em.find).not.toHaveBeenCalled()
    expect(mockedLoadCustomFieldValues).not.toHaveBeenCalled()
  })

  it('appends custom field values to items', async () => {
    const em = {
      find: jest.fn().mockResolvedValue([
        { id: 'profile-1', entity: 'entity-1', tenantId: 'tenant-1', organizationId: 'org-1' },
      ]),
    } as unknown as EntityManager

    mockedLoadCustomFieldValues.mockResolvedValue({
      'profile-1': { cf_priority: 'high', cf_segment: 'enterprise' },
    })

    const items = [{ id: 'entity-1', display_name: 'Alice' }]
    const result = await enrichPeopleListWithCustomFields(em, items, {})

    expect(em.find).toHaveBeenCalledWith(CustomerPersonProfile, { entity: { $in: ['entity-1'] } })
    expect(mockedLoadCustomFieldValues).toHaveBeenCalledWith({
      em,
      entityId: E.customers.customer_person_profile,
      recordIds: ['profile-1'],
      tenantIdByRecord: { 'profile-1': 'tenant-1' },
      organizationIdByRecord: { 'profile-1': 'org-1' },
    })
    expect(result).toEqual([
      { id: 'entity-1', display_name: 'Alice', cf_priority: 'high', cf_segment: 'enterprise' },
    ])
  })

  it('filters items based on custom field query parameters', async () => {
    const em = {
      find: jest.fn().mockResolvedValue([
        { id: 'profile-1', entity: 'entity-1', tenantId: 'tenant-1', organizationId: 'org-1' },
        { id: 'profile-2', entity: 'entity-2', tenantId: 'tenant-1', organizationId: 'org-1' },
      ]),
    } as unknown as EntityManager

    mockedLoadCustomFieldValues.mockResolvedValue({
      'profile-1': { cf_priority: 'high' },
      'profile-2': { cf_priority: 'low' },
    })

    const items = [
      { id: 'entity-1', display_name: 'Alice' },
      { id: 'entity-2', display_name: 'Bob' },
    ]

    const result = await enrichPeopleListWithCustomFields(em, items, { cf_priority: 'high' })

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ id: 'entity-1', cf_priority: 'high' })
  })
})
