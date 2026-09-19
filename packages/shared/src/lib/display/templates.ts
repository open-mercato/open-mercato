import type { DisplayProfile } from './profile'

/**
 * The market seed templates an admin picks from.
 *
 * They live in the shared display layer, not in the `markets` module, because three unrelated
 * consumers need the same values: the module's seed and its settings form, the live preview that
 * renders before anything is saved, and the helper unit tests. One definition is what keeps the
 * preview honest about what saving would produce.
 */
export type MarketTemplateCode = 'us' | 'eu'

export const US_DISPLAY_TEMPLATE: DisplayProfile = Object.freeze({
  code: 'us',
  name: 'United States',
  languageTag: 'en-US',
  currencyCode: 'USD',
  currencyDisplay: 'symbol',
  decimalSeparator: '.',
  thousandsSeparator: ',',
  negativeStyle: 'minus',
  dateFormat: 'MM/dd/yyyy',
  dateTimeFormat: 'MM/dd/yyyy h:mm a',
  timeFormat: 'h:mm a',
  hourCycle: 'h12',
  firstDayOfWeek: 0,
  timeZone: 'America/Chicago',
  addressLayout: 'us',
  defaultCountryCode: 'US',
  subdivisionRequired: true,
  postalCodePattern: '^\\d{5}(-\\d{4})?$',
  postalCodeLabelKey: 'markets.address.label.zipCode',
  subdivisionLabelKey: 'markets.address.label.state',
  addressLine2LabelKey: 'markets.address.label.aptSuiteUnit',
  phoneNationalPattern: '(###) ###-####',
  phoneDefaultDialCode: '+1',
  measurementSystem: 'us_customary',
  defaultWeightUnit: 'lb',
  defaultLengthUnit: 'in',
  lengthDisplay: 'feet_inches',
  paperSize: 'letter',
  pricePresentation: 'single_price_plus_tax',
  taxLineLabelKey: 'markets.tax.label.salesTax',
  taxNoteKey: 'markets.tax.note.calculatedAtOrder',
}) as DisplayProfile

export const EU_DISPLAY_TEMPLATE: DisplayProfile = Object.freeze({
  code: 'eu',
  name: 'European Union',
  languageTag: 'en',
  currencyCode: 'EUR',
  currencyDisplay: 'symbol',
  decimalSeparator: ',',
  thousandsSeparator: ' ',
  negativeStyle: 'minus',
  dateFormat: 'dd.MM.yyyy',
  dateTimeFormat: 'dd.MM.yyyy HH:mm',
  timeFormat: 'HH:mm',
  hourCycle: 'h23',
  firstDayOfWeek: 1,
  timeZone: 'Europe/Warsaw',
  addressLayout: 'line_first',
  defaultCountryCode: 'PL',
  subdivisionRequired: false,
  postalCodePattern: null,
  postalCodeLabelKey: 'markets.address.label.postalCode',
  subdivisionLabelKey: 'markets.address.label.region',
  addressLine2LabelKey: 'markets.address.label.addressLine2',
  phoneNationalPattern: null,
  phoneDefaultDialCode: '+48',
  measurementSystem: 'metric',
  defaultWeightUnit: 'kg',
  defaultLengthUnit: 'cm',
  lengthDisplay: 'decimal',
  paperSize: 'a4',
  pricePresentation: 'dual_net_gross',
  taxLineLabelKey: 'markets.tax.label.vat',
  taxNoteKey: null,
}) as DisplayProfile

export const MARKET_TEMPLATES: Record<MarketTemplateCode, DisplayProfile> = Object.freeze({
  us: US_DISPLAY_TEMPLATE,
  eu: EU_DISPLAY_TEMPLATE,
})

export function getMarketTemplate(code: string | null | undefined): DisplayProfile | null {
  const normalized = typeof code === 'string' ? code.trim().toLowerCase() : ''
  if (normalized === 'us' || normalized === 'eu') return MARKET_TEMPLATES[normalized]
  return null
}
