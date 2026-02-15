import type { EntityManager } from '@mikro-orm/postgresql'
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
}

interface PriceValidatorScope {
  tenantId: string
  organizationId: string
  channelId?: string
  customerId?: string
}

const DEFAULT_MISMATCH_THRESHOLD = 0.05 // 5%

export async function validatePrices(
  em: EntityManager,
  actions: { actionType: string; payload: Record<string, unknown>; index: number }[],
  scope: PriceValidatorScope,
): Promise<PriceDiscrepancy[]> {
  const threshold = parseFloat(process.env.INBOX_OPS_PRICE_MISMATCH_THRESHOLD || String(DEFAULT_MISMATCH_THRESHOLD))
  const discrepancies: PriceDiscrepancy[] = []

  for (const action of actions) {
    if (action.actionType !== 'create_order' && action.actionType !== 'create_quote') {
      continue
    }

    const lineItems = (action.payload.lineItems as LineItem[]) || []

    for (const line of lineItems) {
      if (!line.productId || !line.unitPrice) continue

      try {
        const catalogPrice = await lookupCatalogPrice(em, line.productId, scope)
        if (catalogPrice === null) continue

        const extractedPrice = parseFloat(line.unitPrice)
        const catPrice = parseFloat(catalogPrice)

        if (isNaN(extractedPrice) || isNaN(catPrice) || catPrice === 0) continue

        const priceDiff = Math.abs(extractedPrice - catPrice) / catPrice

        if (priceDiff > threshold) {
          const percentDiff = (priceDiff * 100).toFixed(1)
          discrepancies.push({
            type: 'price_mismatch',
            severity: priceDiff > 0.2 ? 'error' : 'warning',
            description: `Price for "${line.productName}": email says ${line.unitPrice} but catalog price is ${catalogPrice} (${percentDiff}% difference)`,
            expectedValue: catalogPrice,
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
): Promise<string | null> {
  try {
    const prices = await findWithDecryption(
      em,
      'CatalogProductPrice' as any,
      {
        product: productId,
        deletedAt: null,
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
      } as any,
      { limit: 10, orderBy: { createdAt: 'DESC' } as any },
      { tenantId: scope.tenantId, organizationId: scope.organizationId },
    )

    if (!prices || prices.length === 0) return null

    const price = prices[0] as Record<string, unknown>
    return (price?.amount || price?.price || null) as string | null
  } catch {
    return null
  }
}
