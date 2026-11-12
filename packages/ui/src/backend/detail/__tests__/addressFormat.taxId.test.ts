import { resolveTaxIdLabel } from '../addressFormat'

// This module is a documented near-identical twin of `@open-mercato/core`'s `customers/utils/
// addressFormat`, and the spec forbids letting the two drift. The core copy has these cases; without
// them here, a change made on one side and forgotten on the other passes CI.

describe('resolveTaxIdLabel — the ui twin', () => {
  const BY_TYPE = { plNip: 'NIP', euVat: 'EU VAT', other: 'Tax number' }

  // The distinction the scheme exists for: `1234567890` and `PL1234567890` are the same business, so
  // one flat label necessarily misnames one of them.
  it('names a domestic identifier and an EU VAT number differently', () => {
    expect(resolveTaxIdLabel(BY_TYPE, 'pl_nip')).toBe('NIP')
    expect(resolveTaxIdLabel(BY_TYPE, 'eu_vat')).toBe('EU VAT')
  })

  // Naming a foreign number after a domestic scheme renames it, so an unknown scheme takes the
  // neutral label rather than the nearest guess. This is also what lets the vocabulary widen.
  it('falls back to the neutral label for unknown and missing schemes', () => {
    expect(resolveTaxIdLabel(BY_TYPE, 'other')).toBe('Tax number')
    expect(resolveTaxIdLabel(BY_TYPE, 'us_ein')).toBe('Tax number')
    expect(resolveTaxIdLabel(BY_TYPE, null)).toBe('Tax number')
    expect(resolveTaxIdLabel(BY_TYPE, undefined)).toBe('Tax number')
  })

  it('accepts a plain string, which names every scheme the same', () => {
    expect(resolveTaxIdLabel('Tax ID', 'eu_vat')).toBe('Tax ID')
  })

  it('has no label to give when the caller supplies none', () => {
    expect(resolveTaxIdLabel(undefined, 'pl_nip')).toBeUndefined()
  })
})
