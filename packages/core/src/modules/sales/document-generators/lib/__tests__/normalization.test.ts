import { createTranslator } from '@open-mercato/shared/lib/i18n/translate'
import {
  buildLabels,
  firstText,
  resolveClientAddress,
  resolveClientName,
  toIso,
  toNumber,
  toSnapshotRecord,
  toText,
} from '../normalization'

describe('document generator normalization helpers', () => {
  it('toIso converts dates and rejects invalid values', () => {
    expect(toIso(new Date('2026-01-02T10:00:00.000Z'))).toBe('2026-01-02T10:00:00.000Z')
    expect(toIso('2026-01-02T10:00:00.000Z')).toBe('2026-01-02T10:00:00.000Z')
    expect(toIso('nope')).toBeNull()
    expect(toIso(null)).toBeNull()
    expect(toIso(undefined)).toBeNull()
  })

  it('toSnapshotRecord accepts objects and JSON strings only', () => {
    expect(toSnapshotRecord({ a: 1 })).toEqual({ a: 1 })
    expect(toSnapshotRecord(JSON.stringify({ a: 1 }))).toEqual({ a: 1 })
    expect(toSnapshotRecord([1])).toBeNull()
    expect(toSnapshotRecord('plain text')).toBeNull()
    expect(toSnapshotRecord(5)).toBeNull()
    expect(toSnapshotRecord(null)).toBeNull()
  })

  it('toText trims and drops empty values', () => {
    expect(toText('  hi ')).toBe('hi')
    expect(toText('   ')).toBeUndefined()
    expect(toText(3)).toBeUndefined()
  })

  it('toNumber parses decimal strings and falls back to zero', () => {
    expect(toNumber('12.3400')).toBe(12.34)
    expect(toNumber(7)).toBe(7)
    expect(toNumber('abc')).toBe(0)
    expect(toNumber(null)).toBe(0)
    expect(toNumber(Number.NaN)).toBe(0)
  })

  it('firstText returns the first non-empty text', () => {
    expect(firstText(undefined, ' ', 'a', 'b')).toBe('a')
    expect(firstText(null, 1)).toBeUndefined()
  })

  it('resolveClientName prefers display name then company and contact names', () => {
    expect(resolveClientName({ customer: { displayName: 'Acme' } })).toBe('Acme')
    expect(resolveClientName({ customer: { companyProfile: { brandName: 'Brand' } } })).toBe('Brand')
    expect(resolveClientName({ contact: { firstName: 'Ann', lastName: 'Lee' } })).toBe('Ann Lee')
    expect(resolveClientName(null)).toBe('')
  })

  it('resolveClientAddress joins the available parts', () => {
    expect(
      resolveClientAddress({
        addressLine1: 'Main St',
        buildingNumber: '5',
        flatNumber: '2',
        postalCode: '00-001',
        city: 'Warsaw',
        country: 'PL',
      }),
    ).toBe('Main St 5/2, 00-001 Warsaw, PL')
    expect(resolveClientAddress({})).toBeUndefined()
    expect(resolveClientAddress(null)).toBeUndefined()
  })

  it('buildLabels translates with defaults', () => {
    const translate = createTranslator({ 'x.labels.a': 'A-pl' })
    expect(buildLabels(['a', 'b'] as const, { a: 'A', b: 'B' }, 'x.labels', translate)).toEqual({ a: 'A-pl', b: 'B' })
  })
})
