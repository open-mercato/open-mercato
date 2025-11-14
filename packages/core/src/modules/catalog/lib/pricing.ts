import type {
  CatalogOffer,
  CatalogProduct,
  CatalogProductPrice,
  CatalogProductVariant,
} from '../data/entities'

export type PricingContext = {
  channelId?: string | null
  offerId?: string | null
  userId?: string | null
  userGroupId?: string | null
  customerId?: string | null
  customerGroupId?: string | null
  quantity: number
  date: Date
}

export type PriceRow = CatalogProductPrice & {
  product?: CatalogProduct | string | null
  variant?: CatalogProductVariant | string | null
  offer?: CatalogOffer | string | null
}

export function resolvePriceVariantId(row: PriceRow): string | null {
  if (!row.variant) return null
  return typeof row.variant === 'string' ? row.variant : row.variant.id
}

export function resolvePriceOfferId(row: PriceRow): string | null {
  if (!row.offer) return null
  return typeof row.offer === 'string' ? row.offer : row.offer.id
}

export function resolvePriceChannelId(row: PriceRow): string | null {
  if (!row.offer) return row.channelId ?? null
  if (typeof row.offer === 'string') return row.channelId ?? null
  return row.channelId ?? row.offer.channelId ?? null
}

function matchesContext(row: PriceRow, ctx: PricingContext): boolean {
  const { quantity, date } = ctx
  if (row.minQuantity && quantity < row.minQuantity) return false
  if (row.maxQuantity && quantity > row.maxQuantity) return false
  if (row.startsAt && date < row.startsAt) return false
  if (row.endsAt && date > row.endsAt) return false
  if (row.channelId || (row.offer && resolvePriceChannelId(row))) {
    const channel = resolvePriceChannelId(row)
    if (channel && ctx.channelId && channel !== ctx.channelId) return false
    if (channel && !ctx.channelId) return false
  }
  if (row.userId && ctx.userId !== row.userId) return false
  if (row.userGroupId && ctx.userGroupId !== row.userGroupId) return false
  if (row.customerId && ctx.customerId !== row.customerId) return false
  if (row.customerGroupId && ctx.customerGroupId !== row.customerGroupId) return false
  if (ctx.offerId && resolvePriceOfferId(row) && resolvePriceOfferId(row) !== ctx.offerId) return false
  return true
}

function scorePrice(row: PriceRow): number {
  let score = 0
  if (row.kind === 'custom') score += 4
  else if (row.kind === 'sale') score += 3
  else if (row.kind === 'tier') score += 2
  else score += 1
  if (row.variant) score += 8
  if (row.offer) score += 6
  if (row.channelId) score += 5
  if (row.userId) score += 5
  if (row.userGroupId) score += 4
  if (row.customerId) score += 4
  if (row.customerGroupId) score += 3
  if (row.minQuantity && row.minQuantity > 1) score += 1
  return score
}

export function selectBestPrice(rows: PriceRow[], ctx: PricingContext): PriceRow | null {
  const candidates = rows.filter((row) => matchesContext(row, ctx))
  if (!candidates.length) return null
  candidates.sort((a, b) => {
    const scoreDiff = scorePrice(b) - scorePrice(a)
    if (scoreDiff !== 0) return scoreDiff
    const startA = a.startsAt ? a.startsAt.getTime() : 0
    const startB = b.startsAt ? b.startsAt.getTime() : 0
    if (startA !== startB) return startB - startA
    return (a.minQuantity ?? 1) - (b.minQuantity ?? 1)
  })
  return candidates[0]
}

export type CatalogPricingResolver = (
  rows: PriceRow[],
  ctx: PricingContext
) => PriceRow | null | undefined | Promise<PriceRow | null | undefined>

type RegisteredResolver = {
  resolver: CatalogPricingResolver
  priority: number
}

const pricingResolvers: RegisteredResolver[] = []

function sortResolvers(): void {
  pricingResolvers.sort((a, b) => b.priority - a.priority)
}

export function registerCatalogPricingResolver(
  resolver: CatalogPricingResolver,
  options?: { priority?: number }
): void {
  pricingResolvers.push({ resolver, priority: options?.priority ?? 0 })
  sortResolvers()
}

export function resetCatalogPricingResolvers(): void {
  pricingResolvers.splice(0, pricingResolvers.length)
}

export async function resolveCatalogPrice(
  rows: PriceRow[],
  ctx: PricingContext
): Promise<PriceRow | null> {
  for (const { resolver } of pricingResolvers) {
    const result = await resolver(rows, ctx)
    if (result !== undefined) return result
  }
  return selectBestPrice(rows, ctx)
}
