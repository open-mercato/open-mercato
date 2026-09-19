export type CurrencyDisplay = 'symbol' | 'code' | 'symbol_and_code'
export type NegativeStyle = 'minus' | 'parentheses'
export type DisplayHourCycle = 'h12' | 'h23'
export type AddressLayout = 'line_first' | 'street_first' | 'us'
export type MeasurementSystem = 'metric' | 'us_customary'
export type LengthDisplay = 'decimal' | 'feet_inches'
export type PaperSizeCode = 'a4' | 'letter' | 'legal'
export type PricePresentation = 'dual_net_gross' | 'single_price_plus_tax'
export type FirstDayOfWeek = 0 | 1 | 2 | 3 | 4 | 5 | 6

export const CURRENCY_DISPLAYS = ['symbol', 'code', 'symbol_and_code'] as const
export const NEGATIVE_STYLES = ['minus', 'parentheses'] as const
export const DISPLAY_HOUR_CYCLES = ['h12', 'h23'] as const
export const ADDRESS_LAYOUTS = ['line_first', 'street_first', 'us'] as const
export const MEASUREMENT_SYSTEMS = ['metric', 'us_customary'] as const
export const LENGTH_DISPLAYS = ['decimal', 'feet_inches'] as const
export const PAPER_SIZES = ['a4', 'letter', 'legal'] as const
export const PRICE_PRESENTATIONS = ['dual_net_gross', 'single_price_plus_tax'] as const

/**
 * A resolved market display profile: the plain, domain-free shape every display helper takes.
 *
 * A pattern field (`dateFormat`, `dateTimeFormat`, `timeFormat`) is nullable and `null` means
 * "let `Intl` decide for the ambient locale" rather than "unset". That is what makes
 * {@link LEGACY_DISPLAY_DEFAULTS} reproduce today's rendering exactly: today's helpers fall back to
 * `Intl` with a medium date style when no env pin is set, and a frozen pattern here would change
 * the output for every tenant that never picked a market. A seeded `us` or `eu` row always carries
 * concrete patterns.
 */
export type DisplayProfile = {
  code: string
  name: string
  languageTag: string | null
  currencyCode: string
  currencyDisplay: CurrencyDisplay
  decimalSeparator: string | null
  thousandsSeparator: string | null
  negativeStyle: NegativeStyle
  dateFormat: string | null
  dateTimeFormat: string | null
  timeFormat: string | null
  hourCycle: DisplayHourCycle | null
  firstDayOfWeek: FirstDayOfWeek
  timeZone: string | null
  addressLayout: AddressLayout
  defaultCountryCode: string | null
  subdivisionRequired: boolean
  postalCodePattern: string | null
  postalCodeLabelKey: string
  subdivisionLabelKey: string
  addressLine2LabelKey: string
  phoneNationalPattern: string | null
  phoneDefaultDialCode: string | null
  measurementSystem: MeasurementSystem
  defaultWeightUnit: string
  defaultLengthUnit: string
  lengthDisplay: LengthDisplay
  paperSize: PaperSizeCode
  pricePresentation: PricePresentation
  taxLineLabelKey: string
  taxNoteKey: string | null
}

/**
 * Today's rendering, frozen, for an organization that never picked a market.
 *
 * No profile row is backfilled on upgrade (spec assumption A5), so this object is what every helper
 * uses when it is handed `null`. It is deliberately not the `eu` seed template: today's behavior is
 * not internally consistent (the time picker defaults to 12h while the schedule grids force 24h),
 * so no single stored row reproduces it. `hourCycle: null` preserves that — a caller that forces a
 * cycle keeps forcing it until wave 1 migrates it.
 */
export const LEGACY_DISPLAY_DEFAULTS: DisplayProfile = Object.freeze({
  code: 'legacy',
  name: 'Legacy defaults',
  languageTag: null,
  currencyCode: 'EUR',
  currencyDisplay: 'symbol',
  decimalSeparator: null,
  thousandsSeparator: null,
  negativeStyle: 'minus',
  dateFormat: null,
  dateTimeFormat: null,
  timeFormat: null,
  hourCycle: null,
  firstDayOfWeek: 1,
  timeZone: null,
  addressLayout: 'line_first',
  defaultCountryCode: null,
  subdivisionRequired: false,
  postalCodePattern: null,
  postalCodeLabelKey: 'markets.address.label.postalCode',
  subdivisionLabelKey: 'markets.address.label.region',
  addressLine2LabelKey: 'markets.address.label.addressLine2',
  phoneNationalPattern: null,
  phoneDefaultDialCode: null,
  measurementSystem: 'metric',
  defaultWeightUnit: 'kg',
  defaultLengthUnit: 'cm',
  lengthDisplay: 'decimal',
  paperSize: 'a4',
  pricePresentation: 'dual_net_gross',
  taxLineLabelKey: 'markets.tax.label.vat',
  taxNoteKey: null,
}) as DisplayProfile

/** The resolved profile, or the legacy defaults when no market has been picked. */
export function withProfile(profile?: DisplayProfile | null): DisplayProfile {
  return profile ?? LEGACY_DISPLAY_DEFAULTS
}

/**
 * The locale tag to hand `Intl`, or `undefined` to let the runtime decide.
 *
 * `undefined` rather than a hardcoded fallback: passing a wrong locale is worse than passing none,
 * because `Intl` then formats confidently in a market nobody chose.
 */
export function displayLocale(profile?: DisplayProfile | null, fallbackLocale?: string | null): string | undefined {
  const tag = withProfile(profile).languageTag
  if (tag) return tag
  return fallbackLocale ?? undefined
}
