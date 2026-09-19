/**
 * The market display helper layer, re-exported for client components.
 *
 * The implementations live in `@open-mercato/shared/lib/display/*` and are server safe (no React,
 * no DOM, no env reads). This barrel exists so a component can take the helpers and
 * `useDisplayProfile` from one place instead of reaching across packages for each helper.
 */
export type {
  DisplayProfile,
  AddressLayout,
  CurrencyDisplay,
  DisplayHourCycle,
  FirstDayOfWeek,
  LengthDisplay,
  MeasurementSystem,
  NegativeStyle,
  PaperSizeCode,
  PricePresentation,
} from '@open-mercato/shared/lib/display/profile'
export { LEGACY_DISPLAY_DEFAULTS, withProfile, displayLocale } from '@open-mercato/shared/lib/display/profile'
export { US_DISPLAY_TEMPLATE, EU_DISPLAY_TEMPLATE, MARKET_TEMPLATES, getMarketTemplate } from '@open-mercato/shared/lib/display/templates'
export type { MarketTemplateCode } from '@open-mercato/shared/lib/display/templates'
export { formatMoney, formatNumber } from '@open-mercato/shared/lib/display/money'
export {
  formatDate,
  formatDateTime,
  formatTime,
  formatDateRange,
  weekStartsOn,
  hourCycle,
  isHour12,
} from '@open-mercato/shared/lib/display/datetime'
export {
  formatAddress,
  resolveAddressLayout,
  validateAddressForProfile,
  isValidPostalCode,
} from '@open-mercato/shared/lib/display/address'
export type { AddressLayoutDescriptor, AddressLayoutOptions, DisplayAddressValue, AddressValidationIssue } from '@open-mercato/shared/lib/display/address'
export { formatPhone, normalizePhoneInput } from '@open-mercato/shared/lib/display/phone'
export { convertUnit, formatLength, formatWeight, unitDimension } from '@open-mercato/shared/lib/display/units'
export { paperSize } from '@open-mercato/shared/lib/display/paper'
export type { PaperSizeDescriptor } from '@open-mercato/shared/lib/display/paper'
export { resolvePriceLabelKey, showsSinglePricePlusTax, taxLineLabelKey, taxNoteKey } from '@open-mercato/shared/lib/display/price'
export {
  getSubdivisions,
  getSelectableSubdivisions,
  findSubdivision,
  isValidSubdivision,
  hasSubdivisions,
  ISO_SUBDIVISIONS,
} from '@open-mercato/shared/lib/location/subdivisions'
export type { Subdivision } from '@open-mercato/shared/lib/location/subdivisions'
export { MarketProfileProvider, useDisplayProfile } from './MarketProfileProvider'
