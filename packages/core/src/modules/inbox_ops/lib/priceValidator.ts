import type { EntityManager } from '@mikro-orm/postgresql'
import type { EntityClass } from '@mikro-orm/core'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { InboxDiscrepancyType } from '../data/entities'

export interface PriceDiscrepancy {
  type: InboxDiscrepancyType
  severity: 'warning' | 'error'
  description: string
  expectedValue?: string
  foundValue?: string
  actionIndex: number
}

interface LineItem {
  productName: string
  productId?: string
  unitPrice?: string
  quantity: string
  currencyCode?: string
}

interface PriceValidatorScope {
  tenantId: string
  organizationId: string
  channelId?: string
  customerId?: string
}

interface CatalogProductPriceLike {
  product?: unknown
  priceKind?: unknown
  offer?: unknown
  unitPriceNet?: string | null
  unitPriceGross?: string | null
  currencyCode?: string | null
  tenantId?: string
  organizationId?: string
  deletedAt?: Date | null
  createdAt?: Date
}

// Minimal structural view of catalog's `PricingContext`. The validator resolves
// prices through the catalog pricing engine so channel/customer/quantity/time/kind
// scoping is honored consistently with the rest of the platform.
export interface CatalogPricingContext {
  channelId?: string | null
  customerId?: string | null
  customerGroupId?: string | null
  quantity: number
  date: Date
}

// Minimal structural view of the `catalogPricingService` DI token. Using the engine
// (selectBestPrice + resolver pipeline) instead of a bespoke query is mandated by
// packages/core/src/modules/catalog/AGENTS.md and ensures tenant pricing overrides apply.
export interface CatalogPricingServiceLike {
  resolvePrice(
    rows: CatalogProductPriceLike[],
    context: CatalogPricingContext,
  ): Promise<CatalogProductPriceLike | null>
}

interface PriceValidatorDeps {
  catalogProductPriceClass: EntityClass<CatalogProductPriceLike>
  catalogPricingService: CatalogPricingServiceLike
}

const DEFAULT_MISMATCH_THRESHOLD = 0.05 // 5%

function readUuid(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function parsePositiveQuantity(value: unknown): number {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? parseFloat(value) : NaN
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1
}

export async function validatePrices(
  em: EntityManager,
  actions: { actionType: string; payload: Record<string, unknown>; index: number }[],
  scope: PriceValidatorScope,
  deps?: PriceValidatorDeps,
): Promise<PriceDiscrepancy[]> {
  if (!deps?.catalogProductPriceClass || !deps?.catalogPricingService) return []

  const threshold = parseFloat(process.env.INBOX_OPS_PRICE_MISMATCH_THRESHOLD || String(DEFAULT_MISMATCH_THRESHOLD))
  const discrepancies: PriceDiscrepancy[] = []
  const now = new Date()

  for (const action of actions) {
    if (action.actionType !== 'create_order' && action.actionType !== 'create_quote') {
      continue
    }

    const lineItems = (action.payload.lineItems as LineItem[]) || []

    const orderCurrency = typeof action.payload.currencyCode === 'string'
      ? action.payload.currencyCode.trim().toUpperCase()
      : null

    // Channel and customer scoping come from the proposal payload (or the caller's
    // scope as a fallback). When unknown, the engine correctly excludes channel/
    // customer-specific rows and falls back to the generally-applicable price.
    const channelId = readUuid(action.payload.channelId) ?? scope.channelId ?? null
    const customerId = readUuid(action.payload.customerEntityId) ?? scope.customerId ?? null

    for (const line of lineItems) {
      if (!line.productId || !line.unitPrice) continue

      try {
        const pricingContext: CatalogPricingContext = {
          channelId,
          customerId,
          customerGroupId: null,
          quantity: parsePositiveQuantity(line.quantity),
          date: now,
        }
        const catalogResult = await lookupCatalogPrice(
          em,
          line.productId,
          scope,
          deps.catalogProductPriceClass,
          deps.catalogPricingService,
          pricingContext,
          orderCurrency,
        )
        if (catalogResult === null) continue

        if (orderCurrency && catalogResult.currencyCode && orderCurrency !== catalogResult.currencyCode.toUpperCase()) {
          discrepancies.push({
            type: 'currency_mismatch',
            severity: 'warning',
            description: `Currency mismatch for "${line.productName}": order uses ${orderCurrency} but catalog price is in ${catalogResult.currencyCode.toUpperCase()}`,
            expectedValue: catalogResult.currencyCode.toUpperCase(),
            foundValue: orderCurrency,
            actionIndex: action.index,
          })
          continue
        }

        const extractedPrice = parseFloat(line.unitPrice)
        const catPrice = parseFloat(catalogResult.price)

        if (isNaN(extractedPrice) || isNaN(catPrice) || catPrice === 0) continue

        const priceDiff = Math.abs(extractedPrice - catPrice) / catPrice

        if (priceDiff > threshold) {
          const percentDiff = (priceDiff * 100).toFixed(1)
          discrepancies.push({
            type: 'price_mismatch',
            severity: priceDiff > 0.2 ? 'error' : 'warning',
            description: `Price for "${line.productName}": email says ${line.unitPrice} but catalog price is ${catalogResult.price} (${percentDiff}% difference)`,
            expectedValue: catalogResult.price,
            foundValue: line.unitPrice,
            actionIndex: action.index,
          })
        }
      } catch {
        // Skip price validation if lookup fails
      }
    }
  }

  return discrepancies
}

async function lookupCatalogPrice(
  em: EntityManager,
  productId: string,
  scope: PriceValidatorScope,
  entityClass: EntityClass<CatalogProductPriceLike>,
  pricingService: CatalogPricingServiceLike,
  pricingContext: CatalogPricingContext,
  orderCurrency: string | null,
): Promise<{ price: string; currencyCode: string | null } | null> {
  try {
    // Load all non-deleted price rows for the product (populating the relations the
    // pricing engine scores on), then let the engine pick the applicable one — never
    // the "most recently created" row, which ignores every pricing dimension (#2737).
    const rows = await findWithDecryption(
      em,
      entityClass,
      {
        product: productId,
        deletedAt: null,
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
      },
      { populate: ['priceKind', 'offer'] },
      { tenantId: scope.tenantId, organizationId: scope.organizationId },
    )

    if (!rows || rows.length === 0) return null

    // Prefer rows in the order's currency so we compare like-for-like instead of
    // raising a spurious currency mismatch against an unrelated-currency row; fall
    // back to all rows (which surfaces a genuine mismatch when no match exists).
    const sameCurrencyRows = orderCurrency
      ? rows.filter((row) => (row.currencyCode ?? '').toUpperCase() === orderCurrency)
      : rows
    const candidateRows = sameCurrencyRows.length > 0 ? sameCurrencyRows : rows

    const priceRecord = await pricingService.resolvePrice(candidateRows, pricingContext)
    if (!priceRecord) return null

    const priceValue = priceRecord.unitPriceNet ?? priceRecord.unitPriceGross ?? null
    if (!priceValue) return null

    return {
      price: priceValue,
      currencyCode: priceRecord.currencyCode ?? null,
    }
  } catch {
    return null
  }
}
