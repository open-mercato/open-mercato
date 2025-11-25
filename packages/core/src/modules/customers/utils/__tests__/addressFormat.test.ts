import {
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
})
