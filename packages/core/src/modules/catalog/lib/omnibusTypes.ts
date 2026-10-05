import { z } from 'zod'

export const PRICE_HISTORY_CHANGE_TYPES = ['create', 'update', 'delete', 'undo'] as const

export const priceHistoryChangeTypeSchema = z.enum(PRICE_HISTORY_CHANGE_TYPES)

export type PriceHistoryChangeType = z.infer<typeof priceHistoryChangeTypeSchema>

export const PRICE_HISTORY_SOURCES = ['api', 'system'] as const

export const priceHistorySourceSchema = z.enum(PRICE_HISTORY_SOURCES)

export type PriceHistorySource = z.infer<typeof priceHistorySourceSchema>

const numericString = z.string().regex(/^-?\d+(\.\d+)?$/)

export const priceHistoryEntrySchema = z.object({
  tenantId: z.string().uuid(),
  organizationId: z.string().uuid(),
  priceId: z.string().uuid(),
  productId: z.string().uuid(),
  variantId: z.string().uuid().nullable(),
  offerId: z.string().uuid().nullable(),
  channelId: z.string().uuid().nullable(),
  priceKindId: z.string().uuid(),
  priceKindCode: z.string().min(1),
  currencyCode: z.string().length(3),
  unitPriceNet: numericString.nullable(),
  unitPriceGross: numericString.nullable(),
  taxRate: numericString.nullable(),
  taxAmount: numericString.nullable(),
  minQuantity: z.number().int().nullable(),
  maxQuantity: z.number().int().nullable(),
  startsAt: z.date().nullable(),
  endsAt: z.date().nullable(),
  recordedAt: z.date(),
  changeType: priceHistoryChangeTypeSchema,
  source: priceHistorySourceSchema,
  isAnnounced: z.boolean().nullable(),
  idempotencyKey: z.string().min(1).nullable(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
})

export type PriceHistoryEntryInput = z.infer<typeof priceHistoryEntrySchema>
