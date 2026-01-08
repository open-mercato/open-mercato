import { z } from 'zod'
import {
  FMS_QUOTE_STATUSES,
  FMS_OFFER_STATUSES,
  FMS_DIRECTIONS,
  FMS_INCOTERMS,
  FMS_CONTRACT_TYPES,
  FMS_CHARGE_CATEGORIES,
  FMS_CHARGE_UNITS,
  FMS_CONTAINER_TYPES,
  FMS_CARGO_TYPES,
} from './types'

const uuid = () => z.string().uuid()

const scoped = z.object({
  organizationId: uuid(),
  tenantId: uuid(),
})

const currencyCode = z
  .string()
  .trim()
  .regex(/^[A-Z]{3}$/, 'currency code must be a three-letter ISO code')

const decimal = (opts?: { min?: number; max?: number }) => {
  let schema = z.coerce.number()
  if (typeof opts?.min === 'number') schema = schema.min(opts.min)
  if (typeof opts?.max === 'number') schema = schema.max(opts.max)
  return schema
}

// Quote schemas - all fields optional for flexible inline editing
export const fmsQuoteCreateSchema = scoped.extend({
  quoteNumber: z.string().trim().max(50).optional(),
  clientName: z.string().trim().max(255).optional(),
  containerCount: z.coerce.number().int().min(1).optional().nullable(),
  status: z.enum(FMS_QUOTE_STATUSES).optional(),
  direction: z.enum(FMS_DIRECTIONS).optional(),
  incoterm: z.enum(FMS_INCOTERMS).optional(),
  cargoType: z.enum(FMS_CARGO_TYPES).optional(),
  originPortCode: z.string().trim().max(10).optional(),
  destinationPortCode: z.string().trim().max(10).optional(),
  validUntil: z.coerce.date().optional().nullable(),
  currencyCode: currencyCode.optional(),
  notes: z.string().trim().max(2000).optional(),
})

export const fmsQuoteUpdateSchema = z
  .object({
    id: uuid(),
  })
  .merge(fmsQuoteCreateSchema.partial())

export type FmsQuoteCreateInput = z.infer<typeof fmsQuoteCreateSchema>
export type FmsQuoteUpdateInput = z.infer<typeof fmsQuoteUpdateSchema>

// Offer schemas
export const fmsOfferCreateSchema = scoped.extend({
  quoteId: uuid(),
  offerNumber: z.string().trim().min(1).max(50),
  status: z.enum(FMS_OFFER_STATUSES).optional(),
  contractType: z.enum(FMS_CONTRACT_TYPES).optional(),
  carrierName: z.string().trim().max(255).optional(),
  validUntil: z.coerce.date().optional(),
  currencyCode: currencyCode.optional(),
  totalAmount: decimal({ min: 0 }).optional(),
  notes: z.string().trim().max(2000).optional(),
})

export const fmsOfferUpdateSchema = z
  .object({
    id: uuid(),
  })
  .merge(fmsOfferCreateSchema.omit({ offerNumber: true, quoteId: true }).partial())

export type FmsOfferCreateInput = z.infer<typeof fmsOfferCreateSchema>
export type FmsOfferUpdateInput = z.infer<typeof fmsOfferUpdateSchema>

// Offer Line schemas
export const fmsOfferLineCreateSchema = scoped.extend({
  offerId: uuid(),
  lineNumber: z.coerce.number().int().min(0).optional(),
  chargeName: z.string().trim().min(1).max(255),
  chargeCategory: z.enum(FMS_CHARGE_CATEGORIES),
  chargeUnit: z.enum(FMS_CHARGE_UNITS),
  containerType: z.enum(FMS_CONTAINER_TYPES).optional(),
  quantity: decimal({ min: 0 }).optional(),
  currencyCode: currencyCode,
  unitPrice: decimal({ min: 0 }).optional(),
  amount: decimal({ min: 0 }).optional(),
})

export const fmsOfferLineUpdateSchema = z
  .object({
    id: uuid(),
  })
  .merge(fmsOfferLineCreateSchema.omit({ offerId: true }).partial())

export type FmsOfferLineCreateInput = z.infer<typeof fmsOfferLineCreateSchema>
export type FmsOfferLineUpdateInput = z.infer<typeof fmsOfferLineUpdateSchema>
