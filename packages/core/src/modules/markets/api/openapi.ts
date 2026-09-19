import { z } from 'zod'

export const marketsTag = 'Markets'

export const displayProfileItemSchema = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  languageTag: z.string(),
  currencyCode: z.string(),
  currencyDisplay: z.string(),
  decimalSeparator: z.string().nullable(),
  thousandsSeparator: z.string().nullable(),
  negativeStyle: z.string(),
  dateFormat: z.string(),
  dateTimeFormat: z.string(),
  timeFormat: z.string(),
  hourCycle: z.string(),
  firstDayOfWeek: z.number(),
  timeZone: z.string(),
  addressLayout: z.string(),
  defaultCountryCode: z.string(),
  subdivisionRequired: z.boolean(),
  postalCodePattern: z.string().nullable(),
  postalCodeLabelKey: z.string(),
  subdivisionLabelKey: z.string(),
  addressLine2LabelKey: z.string(),
  phoneNationalPattern: z.string().nullable(),
  phoneDefaultDialCode: z.string().nullable(),
  measurementSystem: z.string(),
  defaultWeightUnit: z.string(),
  defaultLengthUnit: z.string(),
  lengthDisplay: z.string(),
  paperSize: z.string(),
  pricePresentation: z.string(),
  taxLineLabelKey: z.string(),
  taxNoteKey: z.string().nullable(),
  isActive: z.boolean(),
  updatedAt: z.string().nullable(),
})

export const displayProfileResponseSchema = z.object({
  item: displayProfileItemSchema.nullable(),
})

export const subdivisionItemSchema = z.object({
  countryCode: z.string(),
  code: z.string(),
  name: z.string(),
  type: z.string(),
})

export const subdivisionsResponseSchema = z.object({
  items: z.array(subdivisionItemSchema),
})

export const marketsErrorSchema = z.object({
  error: z.string(),
})
