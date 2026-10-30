import { findIntegerFieldAboveMax, toIsoDateTimeOrNull } from '../policyPayload'

describe('toIsoDateTimeOrNull', () => {
  it('returns null for empty values', () => {
    expect(toIsoDateTimeOrNull(undefined)).toBeNull()
    expect(toIsoDateTimeOrNull(null)).toBeNull()
    expect(toIsoDateTimeOrNull('')).toBeNull()
    expect(toIsoDateTimeOrNull('   ')).toBeNull()
  })

  it('interprets a zone-less datetime-local value as browser-local time', () => {
    const local = '2026-10-01T09:30'
    expect(toIsoDateTimeOrNull(local)).toBe(new Date(2026, 9, 1, 9, 30).toISOString())
  })

  it('keeps an already-ISO value pointing at the same instant', () => {
    expect(toIsoDateTimeOrNull('2026-10-01T09:30:00.000Z')).toBe('2026-10-01T09:30:00.000Z')
    expect(toIsoDateTimeOrNull('2026-10-01T11:30:00+02:00')).toBe('2026-10-01T09:30:00.000Z')
  })

  it('passes unparseable input through so the server can reject it', () => {
    expect(toIsoDateTimeOrNull('not-a-date')).toBe('not-a-date')
  })
})

describe('findIntegerFieldAboveMax', () => {
  const empty = {
    backorderLeadTimeDays: null,
    lowStockThreshold: null,
    minOrderQuantity: null,
    maxOrderQuantity: null,
    quantityIncrement: null,
  }

  it('returns null when every value fits the database integer range', () => {
    expect(findIntegerFieldAboveMax(empty)).toBeNull()
    expect(findIntegerFieldAboveMax({ ...empty, maxOrderQuantity: 2147483647 })).toBeNull()
  })

  it('names the first field above the range so the form can mark it', () => {
    expect(findIntegerFieldAboveMax({ ...empty, maxOrderQuantity: 99999999999 })).toBe('maxOrderQuantity')
    expect(findIntegerFieldAboveMax({ ...empty, lowStockThreshold: 2147483648, quantityIncrement: 2147483648 })).toBe(
      'lowStockThreshold',
    )
  })
})
