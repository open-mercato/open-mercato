import { LEGACY_DISPLAY_DEFAULTS, withProfile } from '../profile'
import { US_DISPLAY_TEMPLATE, EU_DISPLAY_TEMPLATE, getMarketTemplate } from '../templates'
import { formatMoney, formatNumber } from '../money'
import { formatDate, formatDateTime, formatTime, formatDateRange, weekStartsOn, hourCycle } from '../datetime'
import { formatAddress, resolveAddressLayout, validateAddressForProfile, isValidPostalCode } from '../address'
import { formatPhone, normalizePhoneInput } from '../phone'
import { convertUnit, formatLength, formatWeight } from '../units'
import { paperSize } from '../paper'
import { resolvePriceLabelKey, showsSinglePricePlusTax } from '../price'
import { getSubdivisions, isValidSubdivision } from '../../location/subdivisions'

describe('profile', () => {
  it('falls back to the legacy defaults when no market was picked', () => {
    expect(withProfile(null)).toBe(LEGACY_DISPLAY_DEFAULTS)
    expect(withProfile(undefined)).toBe(LEGACY_DISPLAY_DEFAULTS)
    expect(withProfile(US_DISPLAY_TEMPLATE)).toBe(US_DISPLAY_TEMPLATE)
  })

  it('leaves the legacy patterns unset so Intl keeps deciding, as it does today', () => {
    expect(LEGACY_DISPLAY_DEFAULTS.dateFormat).toBeNull()
    expect(LEGACY_DISPLAY_DEFAULTS.hourCycle).toBeNull()
    expect(LEGACY_DISPLAY_DEFAULTS.firstDayOfWeek).toBe(1)
    expect(LEGACY_DISPLAY_DEFAULTS.paperSize).toBe('a4')
    expect(LEGACY_DISPLAY_DEFAULTS.pricePresentation).toBe('dual_net_gross')
  })

  it('resolves seed templates by code and refuses an unknown one', () => {
    expect(getMarketTemplate('us')).toBe(US_DISPLAY_TEMPLATE)
    expect(getMarketTemplate('EU')).toBe(EU_DISPLAY_TEMPLATE)
    expect(getMarketTemplate('ca')).toBeNull()
    expect(getMarketTemplate(null)).toBeNull()
  })
})

describe('formatMoney', () => {
  it('renders the US template with a symbol and dot decimals', () => {
    expect(formatMoney('48250', 'USD', US_DISPLAY_TEMPLATE)).toBe('$48,250.00')
  })

  it('honours every currency_display value', () => {
    const code = { ...US_DISPLAY_TEMPLATE, currencyDisplay: 'code' as const }
    const both = { ...US_DISPLAY_TEMPLATE, currencyDisplay: 'symbol_and_code' as const }
    expect(formatMoney('1234.56', 'USD', code)).toContain('USD')
    expect(formatMoney('1234.56', 'USD', code)).not.toContain('$')
    expect(formatMoney('1234.56', 'USD', both)).toBe('$1,234.56 USD')
  })

  it('renders negatives in both styles', () => {
    expect(formatMoney('-10', 'USD', US_DISPLAY_TEMPLATE)).toBe('-$10.00')
    const parentheses = { ...US_DISPLAY_TEMPLATE, negativeStyle: 'parentheses' as const }
    expect(formatMoney('-10', 'USD', parentheses)).toBe('($10.00)')
  })

  it('applies the EU template separators', () => {
    expect(formatMoney('1234.56', 'EUR', EU_DISPLAY_TEMPLATE)).toBe('€1 234,56')
  })

  it('returns null for empty input and echoes a non-numeric string', () => {
    expect(formatMoney('', 'USD', US_DISPLAY_TEMPLATE)).toBeNull()
    expect(formatMoney(null, 'USD', US_DISPLAY_TEMPLATE)).toBeNull()
    expect(formatMoney('n/a', 'USD', US_DISPLAY_TEMPLATE)).toBe('n/a')
  })

  it('formats without a profile', () => {
    expect(formatMoney('1234.5', 'USD', null, { locale: 'en-US' })).toBe('$1,234.50')
  })

  it('formats a plain number without a currency', () => {
    expect(formatNumber('1234.5', US_DISPLAY_TEMPLATE)).toBe('1,234.5')
  })
})

describe('datetime', () => {
  const instant = '2026-10-18T15:45:00.000Z'

  it('renders the US template patterns', () => {
    expect(formatDate('2026-10-18', US_DISPLAY_TEMPLATE)).toBe('10/18/2026')
    expect(formatTime(instant, US_DISPLAY_TEMPLATE)).toBe('10:45 AM')
  })

  it('renders the EU template patterns', () => {
    expect(formatDate('2026-10-18', EU_DISPLAY_TEMPLATE)).toBe('18.10.2026')
    expect(formatDateTime(instant, EU_DISPLAY_TEMPLATE)).toBe('18.10.2026 17:45')
  })

  it('moves an instant near midnight UTC into the market zone (TC-MKT-003)', () => {
    // 00:30 UTC on the 19th is still the evening of the 18th in America/Chicago.
    expect(formatDate('2026-10-19T00:30:00.000Z', US_DISPLAY_TEMPLATE)).toBe('10/18/2026')
    expect(formatDateTime('2026-10-19T00:30:00.000Z', US_DISPLAY_TEMPLATE)).toBe('10/18/2026 7:30 PM')
  })

  it('never shifts a date-only value by a zone', () => {
    expect(formatDate('2026-10-18', US_DISPLAY_TEMPLATE)).toBe('10/18/2026')
    expect(formatDate('2026-01-01', US_DISPLAY_TEMPLATE)).toBe('01/01/2026')
  })

  it('falls back to Intl when no market was picked', () => {
    expect(formatDate('2026-10-18', null, { locale: 'en-US' })).toBe('Oct 18, 2026')
    expect(formatDate(null, US_DISPLAY_TEMPLATE)).toBeNull()
    expect(formatDate('not a date', US_DISPLAY_TEMPLATE)).toBeNull()
  })

  it('renders a range and collapses a single day', () => {
    expect(formatDateRange('2026-10-18', '2026-10-20', US_DISPLAY_TEMPLATE)).toBe('10/18/2026 - 10/20/2026')
    expect(formatDateRange('2026-10-18', '2026-10-18', US_DISPLAY_TEMPLATE)).toBe('10/18/2026')
  })

  it('returns the market week start and hour cycle, and the caller fallback without a market', () => {
    expect(weekStartsOn(US_DISPLAY_TEMPLATE)).toBe(0)
    expect(weekStartsOn(EU_DISPLAY_TEMPLATE)).toBe(1)
    expect(weekStartsOn(null)).toBe(1)
    expect(hourCycle(US_DISPLAY_TEMPLATE, 'h23')).toBe('h12')
    // Today's surfaces disagree, so each keeps its own value until a market is picked.
    expect(hourCycle(null, 'h23')).toBe('h23')
    expect(hourCycle(null, 'h12')).toBe('h12')
  })
})

describe('address', () => {
  const texas = {
    companyName: 'Ridgeview Collision',
    addressLine1: '1200 Industrial Blvd',
    addressLine2: 'Suite 4',
    city: 'Plano',
    region: 'TX',
    postalCode: '75074-2210',
    country: 'US',
  }

  it('prints the US layout and suppresses the domestic country', () => {
    const { lines, oneLine } = formatAddress(texas, US_DISPLAY_TEMPLATE)
    expect(lines).toEqual(['Ridgeview Collision', '1200 Industrial Blvd', 'Suite 4', 'PLANO TX 75074-2210'])
    expect(oneLine).toBe('Ridgeview Collision, 1200 Industrial Blvd, Suite 4, PLANO TX 75074-2210')
  })

  it('keeps a foreign country on a US layout', () => {
    const { lines } = formatAddress({ ...texas, country: 'CA' }, US_DISPLAY_TEMPLATE)
    expect(lines[lines.length - 1]).toBe('CA')
  })

  it('prints the line-first and street-first European layouts', () => {
    const polish = {
      addressLine1: 'Kwiatowa',
      buildingNumber: '12',
      flatNumber: '3',
      city: 'Krakow',
      postalCode: '30-624',
      country: 'PL',
    }
    expect(formatAddress(polish, EU_DISPLAY_TEMPLATE).lines).toEqual(['Kwiatowa 12/3', '30-624 Krakow', 'PL'])
    const streetFirst = { ...EU_DISPLAY_TEMPLATE, addressLayout: 'street_first' as const }
    expect(formatAddress(polish, streetFirst).lines).toEqual(['Kwiatowa 12/3', '30-624 Krakow', 'PL'])
  })

  it('describes the editor layout', () => {
    const descriptor = resolveAddressLayout(US_DISPLAY_TEMPLATE)
    expect(descriptor.layout).toBe('us')
    expect(descriptor.showBuildingAndFlatNumber).toBe(false)
    expect(descriptor.subdivisions.length).toBe(56)
    expect(descriptor.postalCodeLabelKey).toBe('markets.address.label.zipCode')

    const legacy = resolveAddressLayout(null)
    expect(legacy.layout).toBe('line_first')
    expect(legacy.showBuildingAndFlatNumber).toBe(true)
    expect(legacy.subdivisions).toEqual([])
  })

  it('validates ZIP and state without ever hard-failing an empty value', () => {
    expect(isValidPostalCode('75074', '^\\d{5}(-\\d{4})?$')).toBe(true)
    expect(isValidPostalCode('75074-2210', '^\\d{5}(-\\d{4})?$')).toBe(true)
    expect(isValidPostalCode('30-624', '^\\d{5}(-\\d{4})?$')).toBe(false)
    expect(isValidPostalCode(null, '^\\d{5}$')).toBe(true)
    expect(isValidPostalCode('75074', null)).toBe(true)
    // An unparseable operator pattern accepts rather than locking the admin out of their data.
    expect(isValidPostalCode('75074', '([')).toBe(true)
  })

  it('reports the rules a legacy row breaks (TC-MKT-005)', () => {
    expect(validateAddressForProfile(texas, US_DISPLAY_TEMPLATE)).toEqual([])
    const legacyRow = { ...texas, region: 'Mazowieckie', postalCode: '30-624' }
    expect(validateAddressForProfile(legacyRow, US_DISPLAY_TEMPLATE)).toEqual([
      'invalid_subdivision',
      'invalid_postal_code',
    ])
    expect(validateAddressForProfile(legacyRow, null)).toEqual([])
  })
})

describe('subdivisions', () => {
  it('seeds the 50 states plus DC plus five territories', () => {
    const us = getSubdivisions('US')
    expect(us.length).toBe(56)
    expect(us.filter((s) => s.type === 'state').length).toBe(50)
    expect(us.filter((s) => s.type === 'district').length).toBe(1)
    expect(us.filter((s) => s.type === 'territory').length).toBe(5)
  })

  it('accepts a state, a territory and a lowercase input, and refuses an unknown country', () => {
    expect(isValidSubdivision('US', 'TX')).toBe(true)
    expect(isValidSubdivision('US', 'PR')).toBe(true)
    expect(isValidSubdivision('us', 'tx')).toBe(true)
    expect(isValidSubdivision('US', 'ZZ')).toBe(false)
    expect(isValidSubdivision('PL', 'TX')).toBe(false)
    expect(getSubdivisions('PL')).toEqual([])
    expect(getSubdivisions(null)).toEqual([])
  })
})

describe('phone', () => {
  it('renders a US national pattern and leaves storage alone', () => {
    expect(formatPhone('+12145550100', US_DISPLAY_TEMPLATE)).toBe('(214) 555-0100')
  })

  it('returns a number outside the market dial code as stored', () => {
    expect(formatPhone('+48123456789', US_DISPLAY_TEMPLATE)).toBe('+48123456789')
    expect(formatPhone('+12145550100', EU_DISPLAY_TEMPLATE)).toBe('+12145550100')
    expect(formatPhone('+12145550100', null)).toBe('+12145550100')
  })

  it('normalizes what a US merchant types into E.164', () => {
    expect(normalizePhoneInput('214-555-0100', US_DISPLAY_TEMPLATE)).toBe('+12145550100')
    expect(normalizePhoneInput('(214) 555-0100', US_DISPLAY_TEMPLATE)).toBe('+12145550100')
    expect(normalizePhoneInput('12145550100', US_DISPLAY_TEMPLATE)).toBe('+12145550100')
    expect(normalizePhoneInput('+12145550100', US_DISPLAY_TEMPLATE)).toBe('+12145550100')
    expect(normalizePhoneInput('214-555-0100', null)).toBe('214-555-0100')
  })
})

describe('units', () => {
  it('converts within a dimension and refuses across one', () => {
    expect(convertUnit(1, 'kg', 'g')).toBe(1000)
    expect(convertUnit(1, 'ft', 'in')).toBeCloseTo(12)
    expect(convertUnit(1, 'in', 'cm')).toBeCloseTo(2.54)
    expect(convertUnit(1, 'kg', 'lb')).toBeCloseTo(2.2046, 3)
    expect(convertUnit(5, 'cm', 'cm')).toBe(5)
    expect(convertUnit(1, 'kg', 'cm')).toBeNull()
    expect(convertUnit(1, 'l', 'ml')).toBeNull()
    expect(convertUnit(1, 'kg', null)).toBeNull()
  })

  it('renders feet and inches at the spec boundaries', () => {
    expect(formatLength(330, 'in', US_DISPLAY_TEMPLATE)).toBe('27 ft 6 in')
    expect(formatLength(11, 'in', US_DISPLAY_TEMPLATE)).toBe('11 in')
    expect(formatLength(0, 'in', US_DISPLAY_TEMPLATE)).toBe('0 in')
    expect(formatLength(24, 'in', US_DISPLAY_TEMPLATE)).toBe('2 ft')
  })

  it('renders decimal lengths and weights for the EU template and the legacy defaults', () => {
    expect(formatLength(150, 'cm', EU_DISPLAY_TEMPLATE)).toBe('150 cm')
    expect(formatWeight(562.5, 'kg', US_DISPLAY_TEMPLATE)).toBe('1,240.1 lb')
    expect(formatWeight(12, 'kg', null)).toBe('12 kg')
  })
})

describe('paper', () => {
  it('maps the market to a page size', () => {
    expect(paperSize(US_DISPLAY_TEMPLATE).css).toBe('Letter')
    expect(paperSize(EU_DISPLAY_TEMPLATE).css).toBe('A4')
    expect(paperSize(null).css).toBe('A4')
    expect(paperSize(US_DISPLAY_TEMPLATE).widthPt).toBe(612)
  })
})

describe('price presentation', () => {
  it('collapses net and gross labels only under single_price_plus_tax', () => {
    expect(showsSinglePricePlusTax(US_DISPLAY_TEMPLATE)).toBe(true)
    expect(showsSinglePricePlusTax(EU_DISPLAY_TEMPLATE)).toBe(false)
    expect(showsSinglePricePlusTax(null)).toBe(false)

    expect(resolvePriceLabelKey('sales.documents.totals.totalNet', US_DISPLAY_TEMPLATE))
      .toBe('sales.documents.totals.total')
    expect(resolvePriceLabelKey('sales.documents.totals.totalNet', EU_DISPLAY_TEMPLATE))
      .toBe('sales.documents.totals.totalNet')
    expect(resolvePriceLabelKey('sales.documents.totals.totalNet', null))
      .toBe('sales.documents.totals.totalNet')
    expect(resolvePriceLabelKey('some.unmapped.key', US_DISPLAY_TEMPLATE)).toBe('some.unmapped.key')
  })
})
