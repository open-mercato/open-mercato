import { z } from 'zod'
import { ISO_COUNTRIES } from '@open-mercato/shared/lib/location/countries'
import {
  ADDRESS_LAYOUTS,
  CURRENCY_DISPLAYS,
  DISPLAY_HOUR_CYCLES,
  LENGTH_DISPLAYS,
  MEASUREMENT_SYSTEMS,
  NEGATIVE_STYLES,
  PAPER_SIZES,
  PRICE_PRESENTATIONS,
} from '@open-mercato/shared/lib/display/profile'

const COUNTRY_CODES = new Set(ISO_COUNTRIES.map((country) => country.code))

/**
 * A postal code pattern is operator input that later runs against user input on every address.
 *
 * It is capped and required to be anchored so it describes a whole code rather than a substring;
 * matching itself goes through the linear-time RE2 helper, so an expensive pattern cannot hang a
 * request thread even if one gets past this check.
 */
const postalCodePatternSchema = z
  .string()
  .trim()
  .min(1)
  .max(200, { message: 'markets.errors.postalCodePatternTooLong' })
  .refine((value) => value.startsWith('^') && value.endsWith('$'), {
    message: 'markets.errors.postalCodePatternNotAnchored',
  })
  .refine((value) => {
    try {
      new RegExp(value)
      return true
    } catch {
      return false
    }
  }, { message: 'markets.errors.postalCodePatternInvalid' })

/**
 * IANA zones come from the runtime rather than a vendored list, so the set cannot drift from the
 * one `Intl` will actually accept when a date is rendered.
 */
const supportedTimeZones = (() => {
  try {
    const supported = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf
    return typeof supported === 'function' ? new Set(supported('timeZone')) : null
  } catch {
    return null
  }
})()

const timeZoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .refine((value) => {
    if (supportedTimeZones) return supportedTimeZones.has(value)
    try {
      new Intl.DateTimeFormat('en', { timeZone: value })
      return true
    } catch {
      return false
    }
  }, { message: 'markets.errors.timeZoneUnknown' })

const countryCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .length(2)
  .refine((value) => COUNTRY_CODES.has(value), { message: 'markets.errors.countryCodeUnknown' })

const separatorSchema = z.string().min(1).max(1)
const i18nKeySchema = z.string().trim().min(1).max(160)
const patternSchema = z.string().trim().min(1).max(60)

const profileFields = {
  code: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(160),
  languageTag: z.string().trim().min(2).max(35),
  currencyCode: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, { message: 'markets.errors.currencyCodeInvalid' }),
  currencyDisplay: z.enum(CURRENCY_DISPLAYS),
  decimalSeparator: separatorSchema.nullable().optional(),
  thousandsSeparator: separatorSchema.nullable().optional(),
  negativeStyle: z.enum(NEGATIVE_STYLES),
  dateFormat: patternSchema,
  dateTimeFormat: patternSchema,
  timeFormat: patternSchema,
  hourCycle: z.enum(DISPLAY_HOUR_CYCLES),
  firstDayOfWeek: z.number().int().min(0).max(6),
  timeZone: timeZoneSchema,
  addressLayout: z.enum(ADDRESS_LAYOUTS),
  defaultCountryCode: countryCodeSchema,
  subdivisionRequired: z.boolean(),
  postalCodePattern: postalCodePatternSchema.nullable().optional(),
  postalCodeLabelKey: i18nKeySchema,
  subdivisionLabelKey: i18nKeySchema,
  addressLine2LabelKey: i18nKeySchema,
  phoneNationalPattern: z.string().trim().min(1).max(40).nullable().optional(),
  phoneDefaultDialCode: z.string().trim().regex(/^\+\d{1,4}$/, { message: 'markets.errors.dialCodeInvalid' }).nullable().optional(),
  measurementSystem: z.enum(MEASUREMENT_SYSTEMS),
  defaultWeightUnit: z.string().trim().min(1).max(16),
  defaultLengthUnit: z.string().trim().min(1).max(16),
  lengthDisplay: z.enum(LENGTH_DISPLAYS),
  paperSize: z.enum(PAPER_SIZES),
  pricePresentation: z.enum(PRICE_PRESENTATIONS),
  taxLineLabelKey: i18nKeySchema,
  taxNoteKey: i18nKeySchema.nullable().optional(),
  isActive: z.boolean().optional(),
}

export const marketDisplayProfileCreateSchema = z.object(profileFields)

/**
 * Every field but `code` is optional on update: the settings form posts only what changed, and the
 * route fills the rest from the named seed template.
 */
export const marketDisplayProfileUpdateSchema = z.object({
  id: z.uuid().optional(),
  ...Object.fromEntries(
    Object.entries(profileFields).map(([key, schema]) => [key, (schema as z.ZodTypeAny).optional()]),
  ),
}).extend({ code: profileFields.code })

export const marketDisplayProfileDeleteSchema = z.object({
  id: z.uuid().optional(),
})

export const subdivisionsQuerySchema = z.object({
  countryCode: countryCodeSchema,
})

export type MarketDisplayProfileCreateInput = z.infer<typeof marketDisplayProfileCreateSchema>
export type MarketDisplayProfileUpdateInput = z.infer<typeof marketDisplayProfileUpdateSchema>
