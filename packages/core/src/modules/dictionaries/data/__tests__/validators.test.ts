import { dictionaryKeySchema } from '../validators'

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
