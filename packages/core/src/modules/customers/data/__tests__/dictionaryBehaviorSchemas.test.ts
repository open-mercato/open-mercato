import {
  customerDictionaryEntryCreateSchema,
  customerDictionaryEntryUpdateSchema,
} from '../validators'

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const id = '33333333-3333-4333-8333-333333333333'
const behavior = {
  schemaVersion: 1 as const,
  baseKind: 'meeting' as const,
  selectable: true,
  order: 120,
  fields: {
    endTime: true,
    allDay: true,
    recurrence: false,
    location: 'location' as const,
    people: 'attendees' as const,
    priority: false,
    resources: true,
  },
  customFieldsetIds: ['visit'],
}

describe('customer dictionary activity type behavior', () => {
  test('accepts behavior for activity types on create and update', () => {
    expect(customerDictionaryEntryCreateSchema.parse({
      tenantId,
      organizationId,
      kind: 'activity_type',
      value: 'site-visit',
      behavior,
    }).behavior).toEqual(behavior)

    expect(customerDictionaryEntryUpdateSchema.parse({
      tenantId,
      organizationId,
      id,
      kind: 'activity_type',
      behavior,
    }).behavior).toEqual(behavior)
  })

  test('rejects behavior for every other dictionary kind', () => {
    const result = customerDictionaryEntryCreateSchema.safeParse({
      tenantId,
      organizationId,
      kind: 'status',
      value: 'active',
      behavior,
    })
    expect(result.success).toBe(false)
    expect(result.error?.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: ['behavior'] }),
    ]))
  })

  test('accepts null to clear an activity type behavior override', () => {
    expect(customerDictionaryEntryUpdateSchema.parse({
      tenantId,
      organizationId,
      id,
      kind: 'activity_type',
      behavior: null,
    }).behavior).toBeNull()
  })
})
