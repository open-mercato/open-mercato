import { z } from 'zod'

export const omnibusApplicabilityReasonSchema = z.enum([
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
])

export type OmnibusApplicabilityReason = z.infer<typeof omnibusApplicabilityReasonSchema>

export type PriceHistorySnapshot = {
  id: string
  variantId: string | null
  productId: string | null
  offerId: string | null
  organizationId: string
  tenantId: string
  currencyCode: string
  priceKindId: string
  priceKindCode: string
  minQuantity: number
  maxQuantity: number | null
  unitPriceNet: string | null
  unitPriceGross: string | null
  taxRate: string | null
  taxAmount: string | null
  channelId: string | null
  startsAt: string | null
  endsAt: string | null
}

export type PriceSnapshot = PriceHistorySnapshot & {
  kind: string
  userId: string | null
  userGroupId: string | null
  customerId: string | null
  customerGroupId: string | null
  metadata: Record<string, unknown> | null
  createdAt: string
  updatedAt: string
  custom: Record<string, unknown> | null
}

export type OmnibusResolutionContext = {
  tenantId: string
  organizationId: string
  productId?: string | null
  variantId?: string | null
  offerId?: string | null
  priceKindId: string
  currencyCode: string
  channelId?: string | null
  isStorefront?: boolean
  firstListedAt?: Date | null
  omnibusExempt?: boolean | null
}

// `priceId` and `changeType` are load-bearing, not decorative: the EC-7 rule identifies the
// presented reduction by (price_id, change_type, recorded_at) so it can be excluded from its
// own reference window. Without them the exclusion cannot be expressed and the promo price
// becomes its own legal reference.
export type OmnibusHistoryRow = {
  id: string
  priceId: string
  changeType: string
  unitPriceNet: string | null
  unitPriceGross: string | null
  recordedAt: string
  startsAt: string | null
  offerId: string | null
  isAnnounced: boolean | null
}

export type OmnibusLowestPriceResult = {
  lowestRow: OmnibusHistoryRow | null
  previousRow: OmnibusHistoryRow | null
  insufficientHistory: boolean
  promotionAnchorAt: string | null
  coverageStartAt: string | null
  applicabilityReason?: OmnibusApplicabilityReason
  windowStart: string
  windowEnd: string
  lookbackDays: number
  minimizationAxis: OmnibusMinimizationAxis
}

export type OmnibusMinimizationAxis = 'gross' | 'net'

export type OmnibusBlock = {
  presentedPriceKindId: string
  lookbackDays: number
  minimizationAxis: OmnibusMinimizationAxis
  promotionAnchorAt: string | null
  windowStart: string
  windowEnd: string
  coverageStartAt: string | null
  lowestPriceNet: string | null
  lowestPriceGross: string | null
  previousPriceNet: string | null
  previousPriceGross: string | null
  currencyCode: string
  applicable: boolean
  applicabilityReason: OmnibusApplicabilityReason
}

export type OmnibusPersonalization = {
  isPersonalized: boolean
  personalizationReason: string | null
}
