import {
    formatAddressContactPairs,
  formatAddressJson,
  formatAddressLines,
  formatAddressString,
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

  describe('address-level contact details', () => {
    const address = {
      addressLine1: 'Baker Street',
      buildingNumber: '10',
      postalCode: 'NW1',
      city: 'London',
      taxId: '1234567890',
      taxIdType: 'pl_nip',
      phone: '+44 20 7946 0000',
    }
    const labels = { taxId: 'Tax ID', phone: 'Phone' }

    // The whole point of keeping these out of formatAddressLines: that output is joined with ", "
    // into one-line summaries for pickers and table cells, where a tax id would be nonsense.
    it('never leaks into the postal lines or the one-line summary', () => {
      expect(formatAddressLines(address, 'street_first')).toEqual(['Baker Street 10', 'NW1 London'])
      expect(formatAddressString(address, 'street_first')).toBe('Baker Street 10, NW1 London')
    })

    it('is returned in a stable order, tax id first, keyed on the stable field name', () => {
      expect(formatAddressContactPairs(address, labels)).toEqual([
        { field: 'taxId', label: 'Tax ID', value: '1234567890' },
        { field: 'phone', label: 'Phone', value: '+44 20 7946 0000' },
      ])
    })

    // Opt-in per field: an unlabelled field stays hidden even when the address carries a value, so a
    // caller can surface the phone without also exposing a tax id.
    it('shows only the fields the caller labelled', () => {
      expect(formatAddressContactPairs(address, { phone: 'Phone' })).toEqual([
        { field: 'phone', label: 'Phone', value: '+44 20 7946 0000' },
      ])
    })

    it('renders nothing at all without labels — the pre-existing behaviour', () => {
      expect(formatAddressContactPairs(address, undefined)).toEqual([])
      expect(formatAddressContactPairs(address, {})).toEqual([])
    })

    it('skips absent, blank and whitespace-only values', () => {
      const sparse = { ...address, taxId: null, phone: '   ' }
      expect(formatAddressContactPairs(sparse, labels)).toEqual([])
    })

    // `taxIdType` interprets the value — it selects the tax id's label and gates its visibility —
    // but it must never surface as a pair of its own, whatever labels the caller passes.
    it('never emits the tax id TYPE as a displayed pair', () => {
      const pairs = formatAddressContactPairs(address, { ...labels, taxIdType: 'Type' } as never)
      expect(pairs).toEqual([
        { field: 'taxId', label: 'Tax ID', value: '1234567890' },
        { field: 'phone', label: 'Phone', value: '+44 20 7946 0000' },
      ])
    })
  })
  describe('tax id labelled by type', () => {
    const BY_TYPE = { plNip: 'NIP', euVat: 'EU VAT', other: 'Tax number' }
    const withType = (taxId: string, taxIdType: string | null) => ({ addressLine1: null, taxId, taxIdType })
    const labelFor = (taxId: string, taxIdType: string | null) =>
      formatAddressContactPairs(withType(taxId, taxIdType), { taxId: BY_TYPE })[0]?.label

    // The distinction the type exists for: `1234567890` and `PL1234567890` are the same business, so
    // one flat label necessarily misnames one of them.
    it('names a domestic identifier and an EU VAT number differently', () => {
      expect(labelFor('1234567890', 'pl_nip')).toBe('NIP')
      expect(labelFor('PL1234567890', 'eu_vat')).toBe('EU VAT')
    })

    // Anything with a two-letter prefix is `eu_vat` whatever the country, so a German number must not
    // fall through to the neutral label.
    it('treats every prefixed number as EU VAT, not just the local country', () => {
      expect(labelFor('DE811907980', 'eu_vat')).toBe('EU VAT')
    })

    // The case a flat label gets wrong: naming a foreign number after a domestic scheme renames it.
    it('falls back to the neutral label for other, unknown and missing types', () => {
      expect(labelFor('811907980', 'other')).toBe('Tax number')
      expect(labelFor('811907980', 'us_ein')).toBe('Tax number')
      expect(labelFor('811907980', null)).toBe('Tax number')
    })

    it('still accepts a plain string — the map is additive', () => {
      expect(formatAddressContactPairs(withType('1234567890', 'pl_nip'), { taxId: 'Tax ID' })).toEqual([
        { field: 'taxId', label: 'Tax ID', value: '1234567890' },
      ])
    })

    it('hides the tax id when the map is absent, like any unlabelled field', () => {
      expect(formatAddressContactPairs(withType('1234567890', 'pl_nip'), { phone: 'Phone' })).toEqual([])
    })
  })

})
