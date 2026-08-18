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

    // `taxIdType` interprets the value (and will gate its display in a later phase); it must never
    // surface as a pair of its own, whatever labels the caller passes.
    it('never emits the tax id TYPE as a displayed pair', () => {
      const pairs = formatAddressContactPairs(address, { ...labels, taxIdType: 'Type' } as never)
      expect(pairs).toEqual([
        { field: 'taxId', label: 'Tax ID', value: '1234567890' },
        { field: 'phone', label: 'Phone', value: '+44 20 7946 0000' },
      ])
    })
  })
})
