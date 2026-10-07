import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { formatCurrency } from '@open-mercato/ui/utils/format'
import { CatalogProductPrice } from '@open-mercato/core/modules/catalog/data/entities'
import {
  buildPriceRowFilter,
  resolvePriceKindId,
  resolvePriceOfferId,
  resolvePriceVariantId,
  selectBestPrice,
  type PriceRow,
  type PricingContext,
} from '@open-mercato/core/modules/catalog/lib/pricing'
import {
  isPromotionPriceKind,
  resolveOmnibusPresentedEntries,
} from '@open-mercato/core/modules/catalog/lib/omnibusPresentedEntry'
import type { OmnibusBlock, OmnibusResolutionRequest } from '@open-mercato/core/modules/catalog/lib/omnibusTypes'
import type { CatalogOmnibusService } from '@open-mercato/core/modules/catalog/services/catalogOmnibusService'
import type { CatalogPricingService } from '@open-mercato/core/modules/catalog/services/catalogPricingService'
import { SalesTaxRate } from '@open-mercato/core/modules/sales/data/entities'
import type { EcommercePriceDisplayMode } from '../data/validators'
import type { StoreContext } from './types'

const logger = createLogger('ecommerce')

const AMOUNT_PRECISION = 4

export type StorefrontPricingContext = PricingContext & {
  channelId: string | null
  priceKindId: string | null
  customerId: string | null
  customerIds: string[]
  customerGroupIds: string[]
  currencyCode: string
  quantity: number
  date: Date
}

export type StorefrontPrice = {
  currencyCode: string
  displayMode: EcommercePriceDisplayMode
  amount: number
  formatted: string
  isPromotion: boolean
  originalAmount: number | null
  formattedOriginal: string | null
  lowestPriorAmount: number | null
  formattedLowestPrior: string | null
}

export type StorefrontPriceRange = {
  min: number
  max: number
  formattedMin: string
  formattedMax: string
}

export type StorefrontPriceTier = {
  minQuantity: number
  maxQuantity: number | null
  amount: number
  formatted: string
}

export type StorefrontPriceItem = {
  productId: string
  variantIds: string[]
}

export type StorefrontProductPricing = {
  productId: string
  price: StorefrontPrice | null
  priceRange: StorefrontPriceRange | null
  variantPrices: Map<string, StorefrontPrice | null>
  priceTiers: StorefrontPriceTier[]
  variantPriceTiers: Map<string, StorefrontPriceTier[]>
}

export type ResolveStorefrontPricesOptions = {
  detail?: boolean
  /** Detail mode only: products whose quantity tiers are resolved; every item when omitted. */
  tierProductIds?: string[]
  date?: Date
}

export type StorefrontPricingContainer = {
  resolve: (name: string) => unknown
}

/**
 * The customer ids pricing may match on: only `buyer.customerOverlayId`, the ids that are part of the
 * cache `digest`. A contract price added after the buyer context was cached is ignored until that
 * context is re-resolved, so a response is never cached under a digest it does not belong to.
 */
export function storefrontPricingCustomerIds(buyer: Pick<StoreContext['buyer'], 'customerOverlayId'>): string[] {
  if (!buyer.customerOverlayId) return []
  return buyer.customerOverlayId.split(',').filter((id) => id.length > 0)
}

export function buildStorefrontPricingContext(
  ctx: StoreContext,
  overrides: { quantity?: number; date?: Date } = {},
): StorefrontPricingContext {
  const customerIds = storefrontPricingCustomerIds(ctx.buyer)
  const customerId = ctx.buyer.customerId && customerIds.includes(ctx.buyer.customerId) ? ctx.buyer.customerId : null
  return {
    channelId: ctx.channel?.salesChannelId ?? null,
    priceKindId: ctx.buyer.priceKindId ?? ctx.channel?.priceKindId ?? null,
    customerId,
    customerIds,
    customerGroupIds: [...ctx.buyer.customerGroupIds],
    currencyCode: ctx.currencyCode,
    quantity: overrides.quantity ?? 1,
    date: overrides.date ?? new Date(),
  }
}

function tryResolve<T>(container: StorefrontPricingContainer, name: string): T | null {
  try {
    const resolved = container.resolve(name) as T | null | undefined
    return resolved ?? null
  } catch {
    return null
  }
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

function formatAmount(amount: number, currencyCode: string, locale: string): string {
  return formatCurrency(amount, currencyCode, locale) ?? String(amount)
}

function resolveRowProductId(row: PriceRow, variantToProduct: Map<string, string>): string | null {
  const variantId = resolvePriceVariantId(row)
  if (variantId) return variantToProduct.get(variantId) ?? null
  if (!row.product) return null
  return typeof row.product === 'string' ? row.product : row.product.id ?? null
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
 * Storefront Public API §6.2 multi-group rule: `sales_tax_rates.customer_group_id` is single-valued,
 * so the rate of the highest-priority group (in `customerGroupIds` order) that has one wins; otherwise
 * the ungrouped rate applies.
 */
export function selectStorefrontTaxRate(
  rates: TaxRateCandidate[],
  customerGroupIds: string[],
  date: Date,
): number | null {
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

function deriveSide(other: number, ratePercent: number, target: EcommercePriceDisplayMode): number {
  const factor = 1 + ratePercent / 100
  return roundAmount(target === 'gross' ? other * factor : other / factor)
}

type AmountSource = {
  net: string | number | null | undefined
  gross: string | number | null | undefined
  rowTaxRate: string | number | null | undefined
}

type PageRuntime = {
  ctx: StoreContext
  em: EntityManager
  pricingContext: StorefrontPricingContext
  taxMode: EcommercePriceDisplayMode
  fallbackRate: () => Promise<number | null>
}

async function selectAmount(runtime: PageRuntime, source: AmountSource): Promise<number | null> {
  const wanted = parseAmount(runtime.taxMode === 'gross' ? source.gross : source.net)
  if (wanted !== null) return wanted
  const other = parseAmount(runtime.taxMode === 'gross' ? source.net : source.gross)
  if (other === null) return null
  const rowRate = parseAmount(source.rowTaxRate)
  const rate = rowRate ?? (await runtime.fallbackRate())
  if (rate === null) return null
  return deriveSide(other, rate, runtime.taxMode)
}

function rowAmountSource(row: PriceRow): AmountSource {
  return { net: row.unitPriceNet, gross: row.unitPriceGross, rowTaxRate: row.taxRate }
}

function createFallbackRateLoader(
  em: EntityManager,
  ctx: StoreContext,
  pricingContext: StorefrontPricingContext,
): () => Promise<number | null> {
  let pending: Promise<number | null> | null = null
  return () => {
    if (!pending) {
      pending = (async () => {
        const scope = { tenantId: ctx.tenantId, organizationId: ctx.organizationId }
        const groupIds = pricingContext.customerGroupIds
        const where: FilterQuery<SalesTaxRate> = {
          tenantId: ctx.tenantId,
          organizationId: ctx.organizationId,
          deletedAt: null,
          productCategoryId: null,
          $and: [
            pricingContext.channelId
              ? { $or: [{ channelId: null }, { channelId: pricingContext.channelId }] }
              : { channelId: null },
            groupIds.length
              ? { $or: [{ customerGroupId: null }, { customerGroupId: { $in: groupIds } }] }
              : { customerGroupId: null },
          ],
        }
        const rates = await findWithDecryption(em, SalesTaxRate, where, undefined, scope)
        return selectStorefrontTaxRate(rates, groupIds, pricingContext.date)
      })()
    }
    return pending
  }
}

type ResolvedTarget = {
  key: string
  productId: string
  variantId: string | null
  rows: PriceRow[]
  selected: PriceRow | null
}

function variantTargetKey(productId: string, variantId: string): string {
  return `${productId}:${variantId}`
}

async function resolveMany(
  service: CatalogPricingService | null,
  entries: Array<{ rows: PriceRow[]; context: PricingContext }>,
): Promise<Array<PriceRow | null>> {
  if (!entries.length) return []
  if (service) return service.resolvePriceMany(entries)
  return entries.map(({ rows, context }) => selectBestPrice(rows, context))
}

function omnibusLowestSource(block: OmnibusBlock | null): AmountSource | null {
  if (!block || !block.applicable) return null
  if (block.lowestPriceNet === null && block.lowestPriceGross === null) return null
  return { net: block.lowestPriceNet, gross: block.lowestPriceGross, rowTaxRate: null }
}

async function resolveOmnibusBlocksForPage(
  container: StorefrontPricingContainer,
  runtime: PageRuntime,
  targets: ResolvedTarget[],
): Promise<Map<string, OmnibusBlock | null>> {
  const blocks = new Map<string, OmnibusBlock | null>()
  if (!targets.length) return blocks
  const service = tryResolve<CatalogOmnibusService>(container, 'catalogOmnibusService')
  if (!service) return blocks
  const { ctx, em } = runtime
  try {
    const presentedRows = targets.map((target) => target.selected).filter((row): row is PriceRow => row !== null)
    const presentedEntries = await resolveOmnibusPresentedEntries(em, presentedRows)
    const requests: OmnibusResolutionRequest[] = targets.map((target) => {
      const row = target.selected as PriceRow
      return {
        context: {
          tenantId: ctx.tenantId,
          organizationId: ctx.organizationId,
          productId: target.productId,
          variantId: resolvePriceVariantId(row),
          offerId: resolvePriceOfferId(row),
          channelId: runtime.pricingContext.channelId,
          priceKindId: resolvePriceKindId(row),
          currencyCode: row.currencyCode,
          isStorefront: true,
          now: runtime.pricingContext.date,
        },
        presentedEntry: presentedEntries.get(row.id) ?? null,
        priceKindIsPromotion: true,
      }
    })
    const resolved = await service.resolveOmnibusBlocks(em, requests)
    targets.forEach((target, index) => blocks.set(target.key, resolved[index] ?? null))
  } catch (err) {
    logger.error('[internal] ecommerce storefront omnibus resolution failed', {
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      storeId: ctx.store.id,
      promotionCount: targets.length,
      err,
    })
    getTelemetryRuntime()?.reportError(err, {
      module: 'ecommerce',
      code: 'ecommerce.storefront_omnibus_failed',
      attributes: { promotionCount: targets.length },
    })
    blocks.clear()
  }
  return blocks
}

async function buildPrice(
  runtime: PageRuntime,
  selected: PriceRow,
  original: PriceRow | null,
  omnibus: OmnibusBlock | null,
): Promise<StorefrontPrice | null> {
  const amount = await selectAmount(runtime, rowAmountSource(selected))
  if (amount === null) return null
  const locale = runtime.ctx.effectiveLocale
  const currencyCode = selected.currencyCode
  let isPromotion = false
  let originalAmount: number | null = null
  let lowestPriorAmount: number | null = null
  if (isPromotionPriceKind(selected)) {
    const lowestSource = omnibusLowestSource(omnibus)
    lowestPriorAmount = lowestSource ? await selectAmount(runtime, lowestSource) : null
    if (lowestPriorAmount !== null) {
      isPromotion = true
      const originalValue = original ? await selectAmount(runtime, rowAmountSource(original)) : null
      originalAmount = originalValue !== null && originalValue > amount ? originalValue : null
    }
  }
  return {
    currencyCode,
    displayMode: runtime.taxMode,
    amount,
    formatted: formatAmount(amount, currencyCode, locale),
    isPromotion,
    originalAmount,
    formattedOriginal: originalAmount === null ? null : formatAmount(originalAmount, currencyCode, locale),
    lowestPriorAmount,
    formattedLowestPrior: lowestPriorAmount === null ? null : formatAmount(lowestPriorAmount, currencyCode, locale),
  }
}

function collectTierQuantities(rows: PriceRow[]): number[] {
  const quantities = new Set<number>([1])
  for (const row of rows) {
    const minQuantity = row.minQuantity ?? 1
    if (Number.isInteger(minQuantity) && minQuantity > 1) quantities.add(minQuantity)
  }
  return Array.from(quantities).sort((left, right) => left - right)
}

async function buildPriceTiers(
  runtime: PageRuntime,
  quantities: number[],
  rows: Array<PriceRow | null>,
): Promise<StorefrontPriceTier[]> {
  const collapsed: Array<{ minQuantity: number; amount: number; currencyCode: string }> = []
  for (let index = 0; index < quantities.length; index += 1) {
    const row = rows[index]
    if (!row) continue
    const amount = await selectAmount(runtime, rowAmountSource(row))
    if (amount === null) continue
    const previous = collapsed[collapsed.length - 1]
    if (previous && previous.amount === amount && previous.currencyCode === row.currencyCode) continue
    collapsed.push({ minQuantity: quantities[index], amount, currencyCode: row.currencyCode })
  }
  if (collapsed.length < 2) return []
  return collapsed.map((tier, index) => {
    const next = collapsed[index + 1]
    return {
      minQuantity: tier.minQuantity,
      maxQuantity: next ? next.minQuantity - 1 : null,
      amount: tier.amount,
      formatted: formatAmount(tier.amount, tier.currencyCode, runtime.ctx.effectiveLocale),
    }
  })
}

function buildPriceRange(runtime: PageRuntime, prices: Array<StorefrontPrice | null>): StorefrontPriceRange | null {
  const priced = prices.filter((price): price is StorefrontPrice => price !== null)
  if (!priced.length) return null
  const currencyCode = priced[0].currencyCode
  const amounts = priced.filter((price) => price.currencyCode === currencyCode).map((price) => price.amount)
  const min = Math.min(...amounts)
  const max = Math.max(...amounts)
  const locale = runtime.ctx.effectiveLocale
  return {
    min,
    max,
    formattedMin: formatAmount(min, currencyCode, locale),
    formattedMax: formatAmount(max, currencyCode, locale),
  }
}

async function fetchPageRows(
  em: EntityManager,
  ctx: StoreContext,
  pricingContext: StorefrontPricingContext,
  productIds: string[],
  variantIds: string[],
): Promise<PriceRow[]> {
  const targetClause: FilterQuery<CatalogProductPrice> = variantIds.length
    ? { $or: [{ product: { $in: productIds } }, { variant: { $in: variantIds } }] }
    : { product: { $in: productIds } }
  const where: FilterQuery<CatalogProductPrice> = {
    $and: [buildPriceRowFilter(pricingContext), targetClause],
    tenantId: ctx.tenantId,
    organizationId: ctx.organizationId,
  }
  const scope = { tenantId: ctx.tenantId, organizationId: ctx.organizationId }
  const rows = await findWithDecryption(em, CatalogProductPrice, where, { populate: ['priceKind', 'offer'] }, scope)
  return rows as PriceRow[]
}

/**
 * Batched storefront price resolution (Storefront Public API rev 4 §6.1, §6.2, §5.1, §5.2; R13).
 *
 * One `CatalogProductPrice` query per page, narrowed by `buildPriceRowFilter`, resolved in memory
 * through `catalogPricingService` so registered resolvers apply. Rows of promotional price kinds overlay the
 * buyer's resolved `priceKindId` (pricing-engine amendment D2a), so a promotion wins by `scorePrice` as in admin;
 * `originalAmount` is the best non-promotional row of the resolved kind from the same batch. Promotions are
 * presented only when Omnibus supplies `lowestPriorAmount` for the presented price (R7): an unavailable, disabled or
 * not-applicable Omnibus result yields `isPromotion: false`, `originalAmount: null` and
 * `lowestPriorAmount: null` while `amount` stays the price the buyer actually pays. In detail mode quantity tiers
 * are resolved from the same batch per product and per variant (a variant's own rows plus product-level rows).
 */
export async function resolveStorefrontPrices(
  container: StorefrontPricingContainer,
  ctx: StoreContext,
  items: StorefrontPriceItem[],
  options: ResolveStorefrontPricesOptions = {},
): Promise<Map<string, StorefrontProductPricing>> {
  const results = new Map<string, StorefrontProductPricing>()
  if (!items.length) return results
  const em = tryResolve<EntityManager>(container, 'em')
  if (!em) throw new Error('[internal] ecommerce storefront pricing requires the DI service em')
  const pricingService = tryResolve<CatalogPricingService>(container, 'catalogPricingService')
  const pricingContext = buildStorefrontPricingContext(ctx, { date: options.date })
  const runtime: PageRuntime = {
    ctx,
    em,
    pricingContext,
    taxMode: ctx.buyer.taxMode,
    fallbackRate: createFallbackRateLoader(em, ctx, pricingContext),
  }
  const detail = options.detail === true

  const variantToProduct = new Map<string, string>()
  for (const item of items) {
    for (const variantId of item.variantIds) variantToProduct.set(variantId, item.productId)
  }
  const productIds = Array.from(new Set(items.map((item) => item.productId)))
  const rows = await fetchPageRows(em, ctx, pricingContext, productIds, Array.from(variantToProduct.keys()))

  const rowsByProduct = new Map<string, PriceRow[]>()
  for (const row of rows) {
    const productId = resolveRowProductId(row, variantToProduct)
    if (!productId) continue
    const bucket = rowsByProduct.get(productId) ?? []
    bucket.push(row)
    rowsByProduct.set(productId, bucket)
  }

  const targets: ResolvedTarget[] = []
  const tierPlans = new Map<string, { quantities: number[]; start: number }>()
  const entries: Array<{ rows: PriceRow[]; context: PricingContext }> = []
  for (const item of items) {
    const productRows = rowsByProduct.get(item.productId) ?? []
    targets.push({ key: item.productId, productId: item.productId, variantId: null, rows: productRows, selected: null })
    entries.push({ rows: productRows, context: pricingContext })
    for (const variantId of item.variantIds) {
      const variantRows = productRows.filter((row) => {
        const rowVariantId = resolvePriceVariantId(row)
        return rowVariantId === null || rowVariantId === variantId
      })
      targets.push({
        key: variantTargetKey(item.productId, variantId),
        productId: item.productId,
        variantId,
        rows: variantRows,
        selected: null,
      })
      entries.push({ rows: variantRows, context: pricingContext })
    }
  }
  if (detail) {
    const tierProductIds = options.tierProductIds ? new Set(options.tierProductIds) : null
    for (const target of targets) {
      if (tierProductIds && !tierProductIds.has(target.productId)) continue
      const quantities = collectTierQuantities(target.rows)
      tierPlans.set(target.key, { quantities, start: entries.length })
      for (const quantity of quantities) entries.push({ rows: target.rows, context: { ...pricingContext, quantity } })
    }
  }

  const resolved = await resolveMany(pricingService, entries)
  const tiersFor = async (key: string): Promise<StorefrontPriceTier[]> => {
    const plan = tierPlans.get(key)
    if (!plan) return []
    return buildPriceTiers(runtime, plan.quantities, resolved.slice(plan.start, plan.start + plan.quantities.length))
  }
  targets.forEach((target, index) => {
    target.selected = resolved[index] ?? null
  })

  const promotional = targets.filter(
    (target) => target.selected !== null && isPromotionPriceKind(target.selected) && (detail || target.variantId === null),
  )
  const originalsResolved = await resolveMany(
    pricingService,
    promotional.map((target) => ({
      rows: target.rows.filter((row) => !isPromotionPriceKind(row)),
      context: pricingContext,
    })),
  )
  const originals = new Map<string, PriceRow | null>()
  promotional.forEach((target, index) => originals.set(target.key, originalsResolved[index] ?? null))
  const omnibusBlocks = await resolveOmnibusBlocksForPage(container, runtime, promotional)

  const prices = new Map<string, StorefrontPrice | null>()
  for (const target of targets) {
    prices.set(
      target.key,
      target.selected
        ? await buildPrice(
            runtime,
            target.selected,
            originals.get(target.key) ?? null,
            omnibusBlocks.get(target.key) ?? null,
          )
        : null,
    )
  }

  for (const item of items) {
    const variantPrices = new Map<string, StorefrontPrice | null>()
    const variantPriceTiers = new Map<string, StorefrontPriceTier[]>()
    for (const variantId of item.variantIds) {
      const key = variantTargetKey(item.productId, variantId)
      variantPrices.set(variantId, prices.get(key) ?? null)
      variantPriceTiers.set(variantId, await tiersFor(key))
    }
    results.set(item.productId, {
      productId: item.productId,
      price: prices.get(item.productId) ?? null,
      priceRange: item.variantIds.length ? buildPriceRange(runtime, Array.from(variantPrices.values())) : null,
      variantPrices,
      priceTiers: await tiersFor(item.productId),
      variantPriceTiers,
    })
  }
  return results
}
