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

export type OmnibusHistoryRow = {
  id: string
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
  applicabilityReason?: string
  windowStart: string
  windowEnd: string
  lookbackDays: number
  minimizationAxis: 'gross' | 'net'
}

export type OmnibusBlock = {
  presentedPriceKindId: string
  lookbackDays: number
  minimizationAxis: 'gross' | 'net'
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
  applicabilityReason: string
}
