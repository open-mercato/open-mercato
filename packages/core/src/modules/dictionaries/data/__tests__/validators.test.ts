import { dictionaryKeySchema, upsertDictionarySchema } from '../validators'

describe('dictionaryKeySchema', () => {
  it.each([
    'colors',
    'staff-activity-types',
    'measurement_units',
    'resources.capacity_unit',
    'resources.activity-types',
    'sales.shipment_status',
    'warranty_claims.warranty_claim_reason',
    'planner.unavailability-reasons.staff',
    'planner.unavailability-reasons.resources',
    'planner.unavailability-reasons.rulesets',
  ])('accepts %s', (key) => {
    expect(dictionaryKeySchema.safeParse(key).success).toBe(true)
  })

  it.each([
    ['a leading dot', '.planner'],
    ['a trailing dot', 'planner.'],
    ['repeated dots', 'planner..staff'],
    ['a segment starting with a hyphen', 'planner.-staff'],
    ['uppercase letters', 'Planner.staff'],
    ['whitespace inside', 'planner staff'],
    ['a slash', 'planner/staff'],
    ['an empty string', ''],
  ])('rejects %s', (_label, key) => {
    expect(dictionaryKeySchema.safeParse(key).success).toBe(false)
  })

  it('rejects a key longer than the column allows', () => {
    expect(dictionaryKeySchema.safeParse('a'.repeat(101)).success).toBe(false)
  })
})

describe('upsertDictionarySchema description', () => {
  it('accepts an explicit null description on create', () => {
    const result = upsertDictionarySchema.safeParse({ key: 'colors', name: 'Colors', description: null })
    expect(result.success).toBe(true)
    expect(result.success && result.data.description).toBeNull()
  })

  it('accepts an explicit null description on a partial update', () => {
    const result = upsertDictionarySchema.partial().safeParse({ description: null })
    expect(result.success).toBe(true)
    expect(result.success && result.data.description).toBeNull()
  })

  it('still rejects a non-string description', () => {
    expect(upsertDictionarySchema.partial().safeParse({ description: 42 }).success).toBe(false)
  })

  it('still rejects a description longer than 2000 characters', () => {
    expect(upsertDictionarySchema.partial().safeParse({ description: 'a'.repeat(2001) }).success).toBe(false)
  })
})
