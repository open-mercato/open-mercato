import { formatAddressLines, formatAddressString, type AddressValue } from '../addressFormat'
import { US_DISPLAY_TEMPLATE, EU_DISPLAY_TEMPLATE } from '@open-mercato/shared/lib/display/templates'

const polishAddress: AddressValue = {
  companyName: 'Zakład Lakierniczy',
  addressLine1: 'Wielicka',
  buildingNumber: '30',
  flatNumber: '4',
  addressLine2: null,
  city: 'Kraków',
  region: 'małopolskie',
  postalCode: '30-624',
  country: 'PL',
}

const texasAddress: AddressValue = {
  companyName: 'Ridgeview Collision',
  addressLine1: '1200 Industrial Blvd',
  addressLine2: 'Suite 4',
  city: 'Plano',
  region: 'TX',
  postalCode: '75074-2210',
  country: 'US',
}

describe('formatAddressLines without a profile', () => {
  it('renders the street-first layout exactly as the legacy formatter did', () => {
    expect(formatAddressLines(polishAddress, 'street_first')).toEqual([
      'Zakład Lakierniczy',
      'Wielicka 30/4',
      '30-624 Kraków',
      'małopolskie',
      'PL',
    ])
  })

  it('renders the line-first layout exactly as the legacy formatter did', () => {
    expect(formatAddressLines(polishAddress, 'line_first')).toEqual([
      'Zakład Lakierniczy',
      'Wielicka 30/4',
      '30-624 Kraków',
      'małopolskie',
      'PL',
    ])
  })

  it('keeps address line 1 untouched when no building or flat number is stored', () => {
    expect(formatAddressLines({ ...polishAddress, buildingNumber: null, flatNumber: null }, 'line_first')).toEqual([
      'Zakład Lakierniczy',
      'Wielicka',
      '30-624 Kraków',
      'małopolskie',
      'PL',
    ])
  })
})

describe('formatAddressLines with a profile', () => {
  it('renders the US layout and suppresses the home country', () => {
    expect(formatAddressLines(texasAddress, 'line_first', US_DISPLAY_TEMPLATE)).toEqual([
      'Ridgeview Collision',
      '1200 Industrial Blvd',
      'Suite 4',
      'PLANO TX 75074-2210',
    ])
  })

  it('keeps the country on an international envelope', () => {
    expect(formatAddressLines({ ...texasAddress, country: 'CA' }, 'line_first', US_DISPLAY_TEMPLATE)).toContain('CA')
  })

  it('lets the profile layout win over the stored address format setting', () => {
    expect(formatAddressString(texasAddress, 'street_first', ', ', US_DISPLAY_TEMPLATE)).toBe(
      'Ridgeview Collision, 1200 Industrial Blvd, Suite 4, PLANO TX 75074-2210',
    )
  })

  it('renders the EU template the European way', () => {
    expect(formatAddressLines(polishAddress, 'line_first', EU_DISPLAY_TEMPLATE)).toEqual([
      'Zakład Lakierniczy',
      'Wielicka 30/4',
      '30-624 Kraków',
      'małopolskie',
      'PL',
    ])
  })
})
