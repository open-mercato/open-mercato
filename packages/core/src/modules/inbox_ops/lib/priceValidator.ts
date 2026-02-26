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
  unitPriceNet?: string | null
  unitPriceGross?: string | null
  currencyCode?: string | null
  tenantId?: string
  organizationId?: string
  deletedAt?: Date | null
  createdAt?: Date
}

const DEFAULT_MISMATCH_THRESHOLD = 0.05 // 5%

export async function validatePrices(
  em: EntityManager,
  actions: { actionType: string; payload: Record<string, unknown>; index: number }[],
  scope: PriceValidatorScope,
  deps?: { catalogProductPriceClass: EntityClass<CatalogProductPriceLike> },
): Promise<PriceDiscrepancy[]> {
  if (!deps?.catalogProductPriceClass) return []

  const threshold = parseFloat(process.env.INBOX_OPS_PRICE_MISMATCH_THRESHOLD || String(DEFAULT_MISMATCH_THRESHOLD))
  const discrepancies: PriceDiscrepancy[] = []

  for (const action of actions) {
    if (action.actionType !== 'create_order' && action.actionType !== 'create_quote') {
      continue
    }

    const lineItems = (action.payload.lineItems as LineItem[]) || []

    const orderCurrency = typeof action.payload.currencyCode === 'string'
      ? action.payload.currencyCode.trim().toUpperCase()
      : null

    for (const line of lineItems) {
      if (!line.productId || !line.unitPrice) continue

      try {
        const catalogResult = await lookupCatalogPrice(em, line.productId, scope, deps.catalogProductPriceClass)
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
): Promise<{ price: string; currencyCode: string | null } | null> {
  try {
    const prices = await findWithDecryption(
      em,
      entityClass,
      {
        product: productId,
        deletedAt: null,
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
      },
      { limit: 10, orderBy: { createdAt: 'DESC' } },
      { tenantId: scope.tenantId, organizationId: scope.organizationId },
    )

    if (!prices || prices.length === 0) return null

    const priceRecord = prices[0]
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
