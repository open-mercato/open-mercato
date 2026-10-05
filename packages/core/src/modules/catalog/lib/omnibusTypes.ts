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

export const OMNIBUS_CONFIG_MODULE_ID = 'catalog'

export const OMNIBUS_CONFIG_NAME = 'omnibus'

export const OMNIBUS_DEFAULT_LOOKBACK_DAYS = 30

export const OMNIBUS_NO_CHANNEL_MODES = ['best_effort', 'require_channel'] as const

export const omnibusNoChannelModeSchema = z.enum(OMNIBUS_NO_CHANNEL_MODES)

export type OmnibusNoChannelMode = z.infer<typeof omnibusNoChannelModeSchema>

export const OMNIBUS_MINIMIZATION_AXES = ['gross', 'net'] as const

export const omnibusMinimizationAxisSchema = z.enum(OMNIBUS_MINIMIZATION_AXES)

export type OmnibusMinimizationAxis = z.infer<typeof omnibusMinimizationAxisSchema>

export const OMNIBUS_APPLICABILITY_REASONS = [
  'no_history',
  'not_in_eu_market',
  'missing_channel_context',
  'insufficient_history',
  'announced_promotion',
  'not_announced',
  'progressive_reduction_frozen',
  'perishable_exempt',
  'perishable_last_price',
  'new_arrival_reduced_window',
] as const

export const omnibusApplicabilityReasonSchema = z.enum(OMNIBUS_APPLICABILITY_REASONS)

export type OmnibusApplicabilityReason = z.infer<typeof omnibusApplicabilityReasonSchema>

export const omnibusCountryCodeSchema = z
  .string()
  .regex(/^[A-Z]{2}$/)
  .refine((value) => value !== 'EU')

export const omnibusLookbackDaysSchema = z.number().int().min(1).max(365)

export const omnibusChannelConfigSchema = z.object({
  presentedPriceKindId: z.string().uuid(),
  countryCode: omnibusCountryCodeSchema.optional(),
  lookbackDays: omnibusLookbackDaysSchema.optional(),
  minimizationAxis: omnibusMinimizationAxisSchema.optional(),
})

export type OmnibusChannelConfig = z.infer<typeof omnibusChannelConfigSchema>

export const omnibusBackfillCoverageSchema = z.object({
  completedAt: z.string().datetime({ offset: true }),
  lookbackDays: omnibusLookbackDaysSchema,
})

export const omnibusConfigSchema = z.object({
  enabled: z.boolean().default(false),
  enabledCountryCodes: z.array(omnibusCountryCodeSchema).default([]),
  noChannelMode: omnibusNoChannelModeSchema.default('best_effort'),
  lookbackDays: omnibusLookbackDaysSchema.default(OMNIBUS_DEFAULT_LOOKBACK_DAYS),
  minimizationAxis: omnibusMinimizationAxisSchema.default('gross'),
  defaultPresentedPriceKindId: z.string().uuid().optional(),
  backfillCoverage: z.record(z.string(), omnibusBackfillCoverageSchema).default({}),
  channels: z.record(z.string(), omnibusChannelConfigSchema).default({}),
})

export type OmnibusConfig = z.infer<typeof omnibusConfigSchema>

export type OmnibusResolutionContext = {
  tenantId: string
  organizationId: string
  productId?: string | null
  variantId?: string | null
  offerId?: string | null
  channelId?: string | null
  priceKindId?: string | null
  currencyCode: string
  isStorefront?: boolean
  now?: Date
}

export type OmnibusPresentedEntry = {
  priceId: string
  changeType: PriceHistoryChangeType
  recordedAt: Date | string
  startsAt?: Date | string | null
  offerId?: string | null
  isAnnounced?: boolean | null
}

export type OmnibusResolutionRequest = {
  context: OmnibusResolutionContext
  presentedEntry?: OmnibusPresentedEntry | null
  priceKindIsPromotion?: boolean
}

export type OmnibusHistoryRow = {
  id: string
  priceId: string
  changeType: PriceHistoryChangeType
  recordedAt: string
  unitPriceNet: string | null
  unitPriceGross: string | null
}

export type OmnibusLowestPriceResult = {
  reason: OmnibusApplicabilityReason | null
  presentedPriceKindId: string | null
  lowestRow: OmnibusHistoryRow | null
  previousRow: OmnibusHistoryRow | null
  insufficientHistory: boolean
  promotionAnchorAt: string | null
  coverageStartAt: string | null
  windowStart: string | null
  windowEnd: string | null
  lookbackDays: number
  minimizationAxis: OmnibusMinimizationAxis
}

export type OmnibusBlock = {
  presentedPriceKindId: string | null
  lookbackDays: number
  minimizationAxis: OmnibusMinimizationAxis
  promotionAnchorAt: string | null
  windowStart: string | null
  windowEnd: string | null
  coverageStartAt: string | null
  lowestPriceNet: string | null
  lowestPriceGross: string | null
  previousPriceNet: string | null
  previousPriceGross: string | null
  currencyCode: string
  applicable: boolean
  applicabilityReason: OmnibusApplicabilityReason
}

export const omnibusBlockSchema = z.object({
  presentedPriceKindId: z.string().uuid().nullable(),
  lookbackDays: z.number().int(),
  minimizationAxis: omnibusMinimizationAxisSchema,
  promotionAnchorAt: z.string().nullable(),
  windowStart: z.string().nullable(),
  windowEnd: z.string().nullable(),
  coverageStartAt: z.string().nullable(),
  lowestPriceNet: z.string().nullable(),
  lowestPriceGross: z.string().nullable(),
  previousPriceNet: z.string().nullable(),
  previousPriceGross: z.string().nullable(),
  currencyCode: z.string(),
  applicable: z.boolean(),
  applicabilityReason: omnibusApplicabilityReasonSchema,
}) satisfies z.ZodType<OmnibusBlock>
