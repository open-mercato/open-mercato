import {
  formatAddressJson,
  formatAddressLines,
  formatAddressString,
  deriveTaxIdType,
  resolveTaxIdLabel,
} from '../addressFormat'

describe('customers utils - address formatting', () => {
  it('normalizes address fields to trimmed values or null', () => {
    const json = formatAddressJson(
      {
        addressLine1: '  123 Baker Street  ',
        addressLine2: '  Suite 5 ',
        buildingNumber: ' 10 ',
        flatNumber: ' 2B ',
        postalCode: ' NW1 ',
        city: ' London ',
        region: '  Greater London ',
      country: '  UK ',
      companyName: '  Widgets Inc. ',
    },
    'street_first'
  )
  expect(json).toEqual({
    format: 'street_first',
    companyName: 'Widgets Inc.',
    addressLine1: '123 Baker Street',
    addressLine2: 'Suite 5',
    buildingNumber: '10',
      flatNumber: '2B',
      postalCode: 'NW1',
      city: 'London',
      region: 'Greater London',
      country: 'UK',
    })
  })

  it('formats lines in street_first mode with merged street data', () => {
    const lines = formatAddressLines(
      {
        addressLine1: 'Baker Street',
        addressLine2: 'Suite 5',
        buildingNumber: '10',
        flatNumber: '2B',
        postalCode: 'NW1',
        city: 'London',
        region: 'Greater London',
        country: 'UK',
      },
      'street_first'
    )
    expect(lines).toEqual([
      'Baker Street 10/2B',
      'Suite 5',
      'NW1 London',
      'Greater London',
      'UK',
    ])
  })

  it('adds company name as the first line when present', () => {
    const lines = formatAddressLines(
      {
        companyName: 'Widgets Inc.',
        addressLine1: 'Baker Street',
        buildingNumber: '10',
        postalCode: 'NW1',
        city: 'London',
      },
      'street_first'
    )
    expect(lines[0]).toBe('Widgets Inc.')
    expect(lines.slice(1)).toEqual(['Baker Street 10', 'NW1 London'])
  })

  it('formats lines in line_first mode preserving primary line', () => {
    const lines = formatAddressLines(
      {
        addressLine1: 'Headquarters',
        addressLine2: 'North Entrance',
        buildingNumber: '10',
        postalCode: 'NW1',
        city: 'London',
        country: 'UK',
      },
      'line_first'
    )
    expect(lines).toEqual([
      'Headquarters 10',
      'North Entrance',
      'NW1 London',
      'UK',
    ])
  })

  it('joins formatted lines into a single string', () => {
    const address = {
      addressLine1: 'Baker Street',
      buildingNumber: '10',
      postalCode: 'NW1',
      city: 'London',
    }
    expect(formatAddressString(address, 'street_first')).toBe('Baker Street 10, NW1 London')
    expect(formatAddressString(address, 'line_first', ' | ')).toBe('Baker Street 10 | NW1 London')
  })

  describe('the label a tax id carries, given its type', () => {
    const BY_TYPE = { plNip: 'NIP', euVat: 'EU VAT', other: 'Tax number' }

    // The distinction the type exists for: `1234567890` and `PL1234567890` are the same business, so
    // one flat label necessarily misnames one of them.
    it('names a domestic identifier and an EU VAT number differently', () => {
      expect(resolveTaxIdLabel(BY_TYPE, 'pl_nip')).toBe('NIP')
      expect(resolveTaxIdLabel(BY_TYPE, 'eu_vat')).toBe('EU VAT')
    })

    // Anything with a two-letter prefix is `eu_vat` whatever the country, so a German number must not
    // fall through to the neutral label.
    it('treats every prefixed number as EU VAT, not just the local country', () => {
      expect(resolveTaxIdLabel(BY_TYPE, 'eu_vat')).toBe('EU VAT')
    })

    // The case a flat label gets wrong: naming a foreign number after a domestic scheme renames it.
    it('falls back to the neutral label for other, unknown and missing types', () => {
      expect(resolveTaxIdLabel(BY_TYPE, 'other')).toBe('Tax number')
      expect(resolveTaxIdLabel(BY_TYPE, 'us_ein')).toBe('Tax number')
      expect(resolveTaxIdLabel(BY_TYPE, null)).toBe('Tax number')
      expect(resolveTaxIdLabel(BY_TYPE, undefined)).toBe('Tax number')
    })

    it('accepts a plain string, which names every type the same', () => {
      expect(resolveTaxIdLabel('Tax ID', 'pl_nip')).toBe('Tax ID')
      expect(resolveTaxIdLabel('Tax ID', 'eu_vat')).toBe('Tax ID')
    })

    it('has no label to give when the caller supplies none', () => {
      expect(resolveTaxIdLabel(undefined, 'pl_nip')).toBeUndefined()
    })
  })

  describe('the type derived from what was typed', () => {
    // Without this the vocabulary never fires outside an integration: a value entered by hand has no
    // type, so every identifier falls to the neutral label and NIP, EU VAT and "other" read alike.
    it('reads two leading letters as an EU VAT number, whatever the country', () => {
      expect(deriveTaxIdType('PL1234567890', 'PL')).toBe('eu_vat')
      expect(deriveTaxIdType('DE811907980', 'DE')).toBe('eu_vat')
      // The country of the ADDRESS does not override the form of the number.
      expect(deriveTaxIdType('DE811907980', 'PL')).toBe('eu_vat')
    })

    it('reads a bare number as domestic on a Polish address', () => {
      expect(deriveTaxIdType('1234567890', 'PL')).toBe('pl_nip')
      expect(deriveTaxIdType('1234567890', 'pl')).toBe('pl_nip')
    })

    it('refuses to guess a scheme for a bare number anywhere else', () => {
      // Naming a foreign number after a domestic scheme renames it, which is worse than saying
      // nothing specific.
      expect(deriveTaxIdType('811907980', 'DE')).toBe('other')
      expect(deriveTaxIdType('811907980', null)).toBe('other')
    })

    it('has no type to give for an absent or blank identifier', () => {
      expect(deriveTaxIdType('', 'PL')).toBeUndefined()
      expect(deriveTaxIdType('   ', 'PL')).toBeUndefined()
      expect(deriveTaxIdType(null, 'PL')).toBeUndefined()
    })

    it('agrees with the label mapping it feeds', () => {
      // The two halves have to compose: derive then resolve must name the number correctly, which is
      // the whole point of deriving at all.
      const BY_TYPE = { plNip: 'NIP', euVat: 'EU VAT', other: 'Tax number' }
      expect(resolveTaxIdLabel(BY_TYPE, deriveTaxIdType('PL1234567890', 'PL'))).toBe('EU VAT')
      expect(resolveTaxIdLabel(BY_TYPE, deriveTaxIdType('1234567890', 'PL'))).toBe('NIP')
      expect(resolveTaxIdLabel(BY_TYPE, deriveTaxIdType('811907980', 'AT'))).toBe('Tax number')
    })
  })
})
