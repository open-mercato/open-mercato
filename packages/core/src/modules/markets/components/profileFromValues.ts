import type { DisplayProfile } from '@open-mercato/shared/lib/display/profile'
import { LEGACY_DISPLAY_DEFAULTS } from '@open-mercato/shared/lib/display/profile'

function text(values: Record<string, unknown>, key: string): string | null {
  const raw = values[key]
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  return trimmed.length ? trimmed : null
}

function bool(values: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const raw = values[key]
  return typeof raw === 'boolean' ? raw : fallback
}

function int(values: Record<string, unknown>, key: string, fallback: number): number {
  const raw = values[key]
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw
  if (typeof raw === 'string' && raw.trim() !== '') {
    const parsed = Number(raw)
    if (Number.isFinite(parsed)) return parsed
  }
  return fallback
}

/**
 * Build a `DisplayProfile` from the form's current values so the preview shows what saving would
 * produce, not what the last save produced.
 *
 * Unset fields fall back to the legacy defaults rather than to the previously saved row: a half
 * filled form should preview as the platform would actually render it.
 */
export function profileFromFormValues(values: Record<string, unknown>): DisplayProfile {
  const fallback = LEGACY_DISPLAY_DEFAULTS
  return {
    code: text(values, 'code') ?? fallback.code,
    name: text(values, 'name') ?? fallback.name,
    languageTag: text(values, 'languageTag'),
    currencyCode: text(values, 'currencyCode') ?? fallback.currencyCode,
    currencyDisplay: (text(values, 'currencyDisplay') ?? fallback.currencyDisplay) as DisplayProfile['currencyDisplay'],
    decimalSeparator: text(values, 'decimalSeparator'),
    thousandsSeparator: text(values, 'thousandsSeparator'),
    negativeStyle: (text(values, 'negativeStyle') ?? fallback.negativeStyle) as DisplayProfile['negativeStyle'],
    dateFormat: text(values, 'dateFormat'),
    dateTimeFormat: text(values, 'dateTimeFormat'),
    timeFormat: text(values, 'timeFormat'),
    hourCycle: text(values, 'hourCycle') as DisplayProfile['hourCycle'],
    firstDayOfWeek: int(values, 'firstDayOfWeek', fallback.firstDayOfWeek) as DisplayProfile['firstDayOfWeek'],
    timeZone: text(values, 'timeZone'),
    addressLayout: (text(values, 'addressLayout') ?? fallback.addressLayout) as DisplayProfile['addressLayout'],
    defaultCountryCode: text(values, 'defaultCountryCode'),
    subdivisionRequired: bool(values, 'subdivisionRequired', fallback.subdivisionRequired),
    postalCodePattern: text(values, 'postalCodePattern'),
    postalCodeLabelKey: text(values, 'postalCodeLabelKey') ?? fallback.postalCodeLabelKey,
    subdivisionLabelKey: text(values, 'subdivisionLabelKey') ?? fallback.subdivisionLabelKey,
    addressLine2LabelKey: text(values, 'addressLine2LabelKey') ?? fallback.addressLine2LabelKey,
    phoneNationalPattern: text(values, 'phoneNationalPattern'),
    phoneDefaultDialCode: text(values, 'phoneDefaultDialCode'),
    measurementSystem: (text(values, 'measurementSystem') ?? fallback.measurementSystem) as DisplayProfile['measurementSystem'],
    defaultWeightUnit: text(values, 'defaultWeightUnit') ?? fallback.defaultWeightUnit,
    defaultLengthUnit: text(values, 'defaultLengthUnit') ?? fallback.defaultLengthUnit,
    lengthDisplay: (text(values, 'lengthDisplay') ?? fallback.lengthDisplay) as DisplayProfile['lengthDisplay'],
    paperSize: (text(values, 'paperSize') ?? fallback.paperSize) as DisplayProfile['paperSize'],
    pricePresentation: (text(values, 'pricePresentation') ?? fallback.pricePresentation) as DisplayProfile['pricePresentation'],
    taxLineLabelKey: text(values, 'taxLineLabelKey') ?? fallback.taxLineLabelKey,
    taxNoteKey: text(values, 'taxNoteKey'),
  }
}

/** The form values a saved row (or a seed template) implies. */
export function formValuesFromProfile(profile: DisplayProfile): Record<string, unknown> {
  return {
    code: profile.code,
    name: profile.name,
    languageTag: profile.languageTag ?? '',
    currencyCode: profile.currencyCode,
    currencyDisplay: profile.currencyDisplay,
    decimalSeparator: profile.decimalSeparator ?? '',
    thousandsSeparator: profile.thousandsSeparator ?? '',
    negativeStyle: profile.negativeStyle,
    dateFormat: profile.dateFormat ?? '',
    dateTimeFormat: profile.dateTimeFormat ?? '',
    timeFormat: profile.timeFormat ?? '',
    hourCycle: profile.hourCycle ?? 'h23',
    firstDayOfWeek: profile.firstDayOfWeek,
    timeZone: profile.timeZone ?? '',
    addressLayout: profile.addressLayout,
    defaultCountryCode: profile.defaultCountryCode ?? '',
    subdivisionRequired: profile.subdivisionRequired,
    postalCodePattern: profile.postalCodePattern ?? '',
    postalCodeLabelKey: profile.postalCodeLabelKey,
    subdivisionLabelKey: profile.subdivisionLabelKey,
    addressLine2LabelKey: profile.addressLine2LabelKey,
    phoneNationalPattern: profile.phoneNationalPattern ?? '',
    phoneDefaultDialCode: profile.phoneDefaultDialCode ?? '',
    measurementSystem: profile.measurementSystem,
    defaultWeightUnit: profile.defaultWeightUnit,
    defaultLengthUnit: profile.defaultLengthUnit,
    lengthDisplay: profile.lengthDisplay,
    paperSize: profile.paperSize,
    pricePresentation: profile.pricePresentation,
    taxLineLabelKey: profile.taxLineLabelKey,
    taxNoteKey: profile.taxNoteKey ?? '',
  }
}
