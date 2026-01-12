import { z } from 'zod'

// Currency Code validation (ISO 4217 format)
const currencyCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, 'Currency code must be a three-letter ISO code (e.g., USD, EUR)')

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
    effectiveDate: z.coerce.date(),
    expiresAt: z.coerce.date().nullable().optional(),
    source: z.string().max(50).optional(),
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
  .refine(
    (data) => {
      if (data.expiresAt && data.effectiveDate) {
        return data.expiresAt > data.effectiveDate
      }
      return true
    },
    {
      message: 'Expiry date must be after effective date',
      path: ['expiresAt'],
    }
  )

export const exchangeRateUpdateSchema = z
  .object({
    id: z.uuid(),
    organizationId: z.uuid().optional(),
    tenantId: z.uuid().optional(),
    fromCurrencyCode: currencyCodeSchema.optional(),
    toCurrencyCode: currencyCodeSchema.optional(),
    rate: z.string().regex(/^\d+(\.\d{1,8})?$/).optional(),
    effectiveDate: z.coerce.date().optional(),
    expiresAt: z.coerce.date().nullable().optional(),
    source: z.string().max(50).optional(),
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
  .refine(
    (data) => {
      // Only validate if both dates are being updated
      if (data.expiresAt && data.effectiveDate) {
        return data.expiresAt > data.effectiveDate
      }
      return true
    },
    {
      message: 'Expiry date must be after effective date',
      path: ['expiresAt'],
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
