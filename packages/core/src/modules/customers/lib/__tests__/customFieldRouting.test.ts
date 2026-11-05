import {
  CUSTOMER_ENTITY_ID,
  PERSON_ENTITY_ID,
  resolvePersonCustomFieldRouting,
  mergePersonCustomFieldValues,
} from '../customFieldRouting'
import { CustomFieldDef } from '@open-mercato/core/modules/entities/data/entities'

describe('customers lib - custom field routing', () => {
  it('prefers definitions with higher score and lower penalty', async () => {
    const find = jest.fn().mockResolvedValue([
      {
        id: 'def-1',
        key: 'priority',
        kind: 'dictionary',
        configJson: JSON.stringify({ filterable: true, priority: 5 }),
        entityId: CUSTOMER_ENTITY_ID,
      },
      {
        id: 'def-2',
        key: 'priority',
        kind: 'dictionary',
        configJson: JSON.stringify({ filterable: true, priority: 1 }),
        entityId: PERSON_ENTITY_ID,
      },
      {
        id: 'def-3',
        key: 'notes',
        kind: 'multiline',
        configJson: null,
        entityId: PERSON_ENTITY_ID,
      },
    ])

    const em = { find } as unknown as Parameters<typeof resolvePersonCustomFieldRouting>[0]

    const routing = await resolvePersonCustomFieldRouting(em, 'tenant-1', 'org-1')

    expect(find).toHaveBeenCalledTimes(1)
    const [, where] = find.mock.calls[0]
    expect(where).toMatchObject({
      entityId: { $in: expect.arrayContaining([CUSTOMER_ENTITY_ID, PERSON_ENTITY_ID]) },
      deletedAt: null,
      isActive: true,
    })
    expect(where.$and).toEqual(
      expect.arrayContaining([
        { $or: [{ tenantId: 'tenant-1' }, { tenantId: null }] },
        { $or: [{ organizationId: 'org-1' }, { organizationId: null }] },
      ])
    )

    expect(routing.get('priority')).toBe(PERSON_ENTITY_ID)
    expect(routing.get('notes')).toBe(PERSON_ENTITY_ID)
  })

  it('falls back to customer entity when scores are equal', async () => {
    const find = jest.fn().mockResolvedValue([
      {
        id: 'def-1',
        key: 'priority',
        kind: 'dictionary',
        configJson: { filterable: true, priority: 2 },
        entityId: CUSTOMER_ENTITY_ID,
      },
      {
        id: 'def-2',
        key: 'priority',
        kind: 'dictionary',
        configJson: { filterable: true, priority: 2 },
        entityId: PERSON_ENTITY_ID,
      },
    ])
    const em = { find } as unknown as Parameters<typeof resolvePersonCustomFieldRouting>[0]
    const routing = await resolvePersonCustomFieldRouting(em, null, null)
    expect(find).toHaveBeenCalledWith(CustomFieldDef, expect.any(Object))
    const [, where] = find.mock.calls[0]
    expect(where.$and).toEqual([{ tenantId: null }])
    expect(routing.get('priority')).toBe(CUSTOMER_ENTITY_ID)
  })

  it('merges customer and profile custom field values correctly', () => {
    const routing = new Map<string, string>([
      ['fieldA', PERSON_ENTITY_ID],
      ['fieldB', CUSTOMER_ENTITY_ID],
      ['fieldC', PERSON_ENTITY_ID],
    ])
    const entityValues = {
      cf_fieldB: 'entity-value',
      cf_fieldC: 'old-value',
    }
    const profileValues = {
      cf_fieldA: 'profile-A',
      fieldB: 'profile-should-not-overwrite',
      cf_fieldC: 'profile-C',
      cf_fieldD: 'profile-D',
    }
    const merged = mergePersonCustomFieldValues(routing, entityValues, profileValues)
    expect(merged).toEqual({
      cf_fieldB: 'entity-value',
      cf_fieldC: 'profile-C',
      cf_fieldA: 'profile-A',
      cf_fieldD: 'profile-D',
      fieldB: 'profile-should-not-overwrite',
    })
  })
})
