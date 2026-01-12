import { z } from 'zod'

/**
 * Truncates a Date object to minute precision (zeroing seconds and milliseconds).
 * This ensures consistent uniqueness checks and prevents duplicate detection issues
 * when the UI collects datetime with minute precision but the database stores full timestamps.
 */
export function truncateToMinute(date: Date): Date {
  const truncated = new Date(date)
  truncated.setSeconds(0, 0)
  return truncated
}

// Currency Code validation (ISO 4217 format)
const currencyCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, 'Currency code must be a three-letter ISO code (e.g., USD, EUR)')

// Source validation schema
const sourceSchema = z
  .string()
  .min(2, { message: 'sourceTooShort' })
  .max(50, { message: 'sourceTooLong' })
  .regex(/^[a-zA-Z0-9\s\-_]+$/, { message: 'sourceInvalidFormat' })
  .transform(s => s.trim())

// Currency validators
export const currencyCreateSchema = z.object({
  organizationId: z.uuid(),
  tenantId: z.uuid(),
  code: currencyCodeSchema,
  name: z.string().min(1).max(200),
  symbol: z.string().max(10).nullable().optional(),
  decimalPlaces: z.number().int().min(0).max(8).optional(),
  thousandsSeparator: z.string().max(5).nullable().optional(),
  decimalSeparator: z.string().max(5).nullable().optional(),
  isBase: z.boolean().optional(),
  isActive: z.boolean().optional(),
})

export const currencyUpdateSchema = z.object({
  id: z.uuid(),
  organizationId: z.uuid().optional(),
  tenantId: z.uuid().optional(),
  code: currencyCodeSchema.optional(),
  name: z.string().min(1).max(200).optional(),
  symbol: z.string().max(10).nullable().optional(),
  decimalPlaces: z.number().int().min(0).max(8).optional(),
  thousandsSeparator: z.string().max(5).nullable().optional(),
  decimalSeparator: z.string().max(5).nullable().optional(),
  isBase: z.boolean().optional(),
  isActive: z.boolean().optional(),
})

export const currencyDeleteSchema = z.object({
  id: z.uuid(),
  organizationId: z.uuid(),
  tenantId: z.uuid(),
})

// Exchange Rate validators
export const exchangeRateCreateSchema = z
  .object({
    organizationId: z.uuid(),
    tenantId: z.uuid(),
    fromCurrencyCode: currencyCodeSchema,
    toCurrencyCode: currencyCodeSchema,
    rate: z.string().regex(/^\d+(\.\d{1,8})?$/, 'Rate must be a positive decimal number'),
    date: z.coerce.date().transform(truncateToMinute),
    source: sourceSchema,
    isActive: z.boolean().optional(),
  })
  .refine((data) => data.fromCurrencyCode !== data.toCurrencyCode, {
    message: 'From and To currencies must be different',
    path: ['toCurrencyCode'],
  })
  .refine((data) => parseFloat(data.rate) > 0, {
    message: 'Rate must be greater than zero',
    path: ['rate'],
  })

export const exchangeRateUpdateSchema = z
  .object({
    id: z.uuid(),
    organizationId: z.uuid().optional(),
    tenantId: z.uuid().optional(),
    fromCurrencyCode: currencyCodeSchema.optional(),
    toCurrencyCode: currencyCodeSchema.optional(),
    rate: z.string().regex(/^\d+(\.\d{1,8})?$/).optional(),
    date: z.coerce.date().transform(truncateToMinute).optional(),
    source: sourceSchema.optional(),
    isActive: z.boolean().optional(),
  })
  .refine(
    (data) => {
      // Only validate if both currencies are being updated
      if (data.fromCurrencyCode && data.toCurrencyCode) {
        return data.fromCurrencyCode !== data.toCurrencyCode
      }
      return true
    },
    {
      message: 'From and To currencies must be different',
      path: ['toCurrencyCode'],
    }
  )
  .refine(
    (data) => {
      if (data.rate) {
        return parseFloat(data.rate) > 0
      }
      return true
    },
    {
      message: 'Rate must be greater than zero',
      path: ['rate'],
    }
  )

export const exchangeRateDeleteSchema = z.object({
  id: z.uuid(),
  organizationId: z.uuid(),
  tenantId: z.uuid(),
})

// Type exports
export type CurrencyCreateInput = z.infer<typeof currencyCreateSchema>
export type CurrencyUpdateInput = z.infer<typeof currencyUpdateSchema>
export type CurrencyDeleteInput = z.infer<typeof currencyDeleteSchema>
export type ExchangeRateCreateInput = z.infer<typeof exchangeRateCreateSchema>
export type ExchangeRateUpdateInput = z.infer<typeof exchangeRateUpdateSchema>
export type ExchangeRateDeleteInput = z.infer<typeof exchangeRateDeleteSchema>

// Currency Fetch Config validators
export const providerSchema = z.enum(['NBP', 'Raiffeisen Bank', 'Custom'])

export const syncTimeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'Invalid time format. Use HH:MM')
  .nullable()

export const currencyFetchConfigCreateSchema = z.object({
  provider: providerSchema,
  isEnabled: z.boolean().default(false),
  syncTime: syncTimeSchema.optional(),
  config: z.record(z.string(), z.unknown()).nullable().optional(),
})

export const currencyFetchConfigUpdateSchema = z.object({
  isEnabled: z.boolean().optional(),
  syncTime: syncTimeSchema.optional(),
  config: z.record(z.string(), z.unknown()).nullable().optional(),
})

export type CurrencyFetchConfigCreateInput = z.infer<typeof currencyFetchConfigCreateSchema>
export type CurrencyFetchConfigUpdateInput = z.infer<typeof currencyFetchConfigUpdateSchema>
