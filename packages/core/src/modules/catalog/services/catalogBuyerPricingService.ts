import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { SalesTaxRate } from '@open-mercato/core/modules/sales/data/entities'
import { isPromotionPriceKind } from '../lib/omnibusPresentedEntry'
import type { PriceRow, PricingContext } from '../lib/pricing'
import type { CatalogPricingService } from './catalogPricingService'

const AMOUNT_PRECISION = 4

/**
 * Pricing context for a single cart/order line: the buyer's scoping dimensions plus the
 * quantity and the evaluation date the price rows and tax rates are resolved against.
 */
export type BuyerPricingContext = PricingContext & {
  customerGroupIds: string[]
  currencyCode: string
  quantity: number
  date: Date
}

export type BuyerPricingScope = {
  tenantId: string
  organizationId: string
}

/**
 * One collapsed quantity tier (Storefront Public API §6.1 convention — adjacent quantities
 * resolving to the same net/gross pair are merged into a single `[minQuantity, maxQuantity]`
 * band). Present only when the rows actually produce 2+ distinct price points; a flat price
 * yields an empty `tiers` array on `ResolvedLinePrice`.
 */
export type LinePriceTier = {
  minQuantity: number
  maxQuantity: number | null
  amountNet: number | null
  amountGross: number | null
}

export type ResolvedLinePrice = {
  /** The winning `CatalogProductPrice` row for `context`, or `null` when nothing matched. */
  priceRow: PriceRow | null
  amountNet: number | null
  amountGross: number | null
  /** The percentage rate used to derive whichever side the winning row did not carry; `null` when neither side needed deriving or no rate could be resolved. */
  taxRatePercent: number | null
  /** `true` when the winning row's price kind is a promotional kind (same semantic as `EvaluateItem.priceIsPromotional`, SPEC-055 D-R4-16). */
  priceIsPromotional: boolean
  /** The tier `context.quantity` currently falls into, or `null` when there is no tiering. */
  currentTier: LinePriceTier | null
  /** The next higher tier a buyer could reach by increasing quantity, or `null` when already at the top tier (or there is no tiering). */
  nextTier: LinePriceTier | null
  tiers: LinePriceTier[]
}

export interface CatalogBuyerPricingService {
  /**
   * Resolves everything a cart/order line needs from a batch of already-fetched
   * `CatalogProductPrice` rows for one product/variant: the winning row (via
   * `catalogPricingService`, so registered resolvers apply), both price sides (deriving
   * the missing one from a resolved tax rate), the current and next quantity tier, and
   * whether the winning row is a promotional price kind.
   *
   * Resolves ONE line at a time, with no shared cache across targets — fine for `cart`'s
   * per-line call sites, but `ecommerce/lib/storefrontPricing.ts`'s page-batch resolution
   * deliberately does NOT call this (3.4 Part A, owner decision 2026-10-16, permanent
   * exemption): calling it once per product/variant on a page regressed the Storefront
   * Public API's O(1)-queries-per-page invariant. See that file's own header comment and
   * `ecommerce/lib/__tests__/storefrontPricingEquivalence.test.ts` for the guard proving the
   * two paths still agree on the same unit price.
   */
  resolveLinePrice(
    em: EntityManager,
    rows: PriceRow[],
    context: BuyerPricingContext,
    scope: BuyerPricingScope,
  ): Promise<ResolvedLinePrice>
}

function roundAmount(value: number): number {
  const factor = 10 ** AMOUNT_PRECISION
  return Math.round(value * factor) / factor
}

function parseAmount(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null
  const numeric = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function deriveSide(other: number, ratePercent: number, target: 'net' | 'gross'): number {
  const factor = 1 + ratePercent / 100
  return roundAmount(target === 'gross' ? other * factor : other / factor)
}

type AmountSource = {
  net: string | number | null | undefined
  gross: string | number | null | undefined
  rowTaxRate: string | number | null | undefined
}

function rowAmountSource(row: PriceRow): AmountSource {
  return { net: row.unitPriceNet, gross: row.unitPriceGross, rowTaxRate: row.taxRate }
}

type TaxRateCandidate = Pick<
  SalesTaxRate,
  'rate' | 'customerGroupId' | 'channelId' | 'priority' | 'isDefault' | 'code' | 'startsAt' | 'endsAt'
>

function compareTaxRates(left: TaxRateCandidate, right: TaxRateCandidate): number {
  const channelDiff = (right.channelId ? 1 : 0) - (left.channelId ? 1 : 0)
  if (channelDiff !== 0) return channelDiff
  const defaultDiff = (right.isDefault ? 1 : 0) - (left.isDefault ? 1 : 0)
  if (defaultDiff !== 0) return defaultDiff
  const priorityDiff = (right.priority ?? 0) - (left.priority ?? 0)
  if (priorityDiff !== 0) return priorityDiff
  return left.code < right.code ? -1 : left.code > right.code ? 1 : 0
}

/**
 * Same multi-group rule as the storefront's `selectStorefrontTaxRate`: `sales_tax_rates.customer_group_id`
 * is single-valued, so the rate of the highest-priority group (in `customerGroupIds` order) that
 * has one wins; otherwise the ungrouped rate applies.
 */
function selectBuyerTaxRate(rates: TaxRateCandidate[], customerGroupIds: string[], date: Date): number | null {
  const active = rates.filter(
    (rate) => (!rate.startsAt || rate.startsAt <= date) && (!rate.endsAt || rate.endsAt >= date),
  )
  const pick = (candidates: TaxRateCandidate[]): number | null => {
    if (!candidates.length) return null
    const [best] = [...candidates].sort(compareTaxRates)
    return parseAmount(best.rate)
  }
  for (const groupId of customerGroupIds) {
    const groupRate = pick(active.filter((rate) => rate.customerGroupId === groupId))
    if (groupRate !== null) return groupRate
  }
  return pick(active.filter((rate) => !rate.customerGroupId))
}

function createFallbackTaxRateLoader(
  em: EntityManager,
  scope: BuyerPricingScope,
  context: BuyerPricingContext,
): () => Promise<number | null> {
  let pending: Promise<number | null> | null = null
  return () => {
    if (!pending) {
      pending = (async () => {
        const groupIds = context.customerGroupIds
        const where: FilterQuery<SalesTaxRate> = {
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          deletedAt: null,
          productCategoryId: null,
          $and: [
            context.channelId
              ? { $or: [{ channelId: null }, { channelId: context.channelId }] }
              : { channelId: null },
            groupIds.length
              ? { $or: [{ customerGroupId: null }, { customerGroupId: { $in: groupIds } }] }
              : { customerGroupId: null },
          ],
        }
        const rates = await findWithDecryption(em, SalesTaxRate, where, undefined, scope)
        return selectBuyerTaxRate(rates, groupIds, context.date)
      })()
    }
    return pending
  }
}

async function resolveBothSides(
  source: AmountSource,
  fallbackRate: () => Promise<number | null>,
): Promise<{ net: number | null; gross: number | null; taxRatePercent: number | null }> {
  const net0 = parseAmount(source.net)
  const gross0 = parseAmount(source.gross)
  const rowRate = parseAmount(source.rowTaxRate)
  if (net0 !== null && gross0 !== null) return { net: net0, gross: gross0, taxRatePercent: rowRate }
  if (net0 === null && gross0 === null) return { net: null, gross: null, taxRatePercent: rowRate }
  const rate = rowRate ?? (await fallbackRate())
  if (rate === null) return { net: net0, gross: gross0, taxRatePercent: null }
  if (net0 !== null) return { net: net0, gross: deriveSide(net0, rate, 'gross'), taxRatePercent: rate }
  return { net: deriveSide(gross0 as number, rate, 'net'), gross: gross0, taxRatePercent: rate }
}

function collectTierQuantities(rows: PriceRow[]): number[] {
  const quantities = new Set<number>([1])
  for (const row of rows) {
    const minQuantity = row.minQuantity ?? 1
    if (Number.isInteger(minQuantity) && minQuantity > 1) quantities.add(minQuantity)
  }
  return Array.from(quantities).sort((left, right) => left - right)
}

async function buildLineTiers(
  quantities: number[],
  rows: Array<PriceRow | null>,
  fallbackRate: () => Promise<number | null>,
): Promise<LinePriceTier[]> {
  const collapsed: Array<{ minQuantity: number; amountNet: number | null; amountGross: number | null }> = []
  for (let index = 0; index < quantities.length; index += 1) {
    const row = rows[index]
    if (!row) continue
    const { net, gross } = await resolveBothSides(rowAmountSource(row), fallbackRate)
    if (net === null && gross === null) continue
    const previous = collapsed[collapsed.length - 1]
    if (previous && previous.amountNet === net && previous.amountGross === gross) continue
    collapsed.push({ minQuantity: quantities[index], amountNet: net, amountGross: gross })
  }
  if (collapsed.length < 2) return []
  return collapsed.map((tier, index) => {
    const next = collapsed[index + 1]
    return {
      minQuantity: tier.minQuantity,
      maxQuantity: next ? next.minQuantity - 1 : null,
      amountNet: tier.amountNet,
      amountGross: tier.amountGross,
    }
  })
}

function selectCurrentAndNextTier(
  tiers: LinePriceTier[],
  quantity: number,
): { currentTier: LinePriceTier | null; nextTier: LinePriceTier | null } {
  if (!tiers.length) return { currentTier: null, nextTier: null }
  let currentIndex = -1
  for (let index = 0; index < tiers.length; index += 1) {
    if (tiers[index].minQuantity <= quantity) currentIndex = index
    else break
  }
  const currentTier = currentIndex >= 0 ? tiers[currentIndex] : null
  const nextTier = currentIndex + 1 < tiers.length ? tiers[currentIndex + 1] : null
  return { currentTier, nextTier }
}

export class DefaultCatalogBuyerPricingService implements CatalogBuyerPricingService {
  constructor(private readonly pricingService: CatalogPricingService) {}

  async resolveLinePrice(
    em: EntityManager,
    rows: PriceRow[],
    context: BuyerPricingContext,
    scope: BuyerPricingScope,
  ): Promise<ResolvedLinePrice> {
    const fallbackRate = createFallbackTaxRateLoader(em, scope, context)
    const selected = await this.pricingService.resolvePrice(rows, context)
    const priceIsPromotional = isPromotionPriceKind(selected)
    const { net: amountNet, gross: amountGross, taxRatePercent } = selected
      ? await resolveBothSides(rowAmountSource(selected), fallbackRate)
      : { net: null, gross: null, taxRatePercent: null }

    const quantities = collectTierQuantities(rows)
    const tierRows = await this.pricingService.resolvePriceMany(
      quantities.map((quantity) => ({ rows, context: { ...context, quantity } })),
    )
    const tiers = await buildLineTiers(quantities, tierRows, fallbackRate)
    const { currentTier, nextTier } = selectCurrentAndNextTier(tiers, context.quantity)

    return {
      priceRow: selected,
      amountNet,
      amountGross,
      taxRatePercent,
      priceIsPromotional,
      currentTier,
      nextTier,
      tiers,
    }
  }
}
