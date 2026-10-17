import type {
  CatalogPriceLineOutcome,
  CatalogPriceLineScanPage,
  CatalogPriceLineScanQuery,
  CatalogPriceLineSource,
  CatalogPriceUnlinkedLinesQuery,
} from '@open-mercato/core/modules/catalog/lib/simulation/priceLineSources'
import { toScaledAmount } from '../explain/priceAmounts'
import { SALES_RESOURCE_KIND_ORDER, SALES_RESOURCE_KIND_QUOTE } from '../../commands/shared'
import { classifyPriceLine, type PriceLineProposalAmounts } from './priceLineClassification'
import { countUnlinkedPriceLines, readPriceLinePage, type PriceLineFamily } from './priceLines'

/**
 * The sales document families the price backtest reads (orders and quotes, reported separately —
 * a quote converted to an order would otherwise be counted twice). Registered as catalog price
 * line sources from `sales/insights.simulate.ts`; each family needs its own view feature.
 */

type SalesPriceLineFamilySpec = {
  family: PriceLineFamily
  labelKey: string
  requiredFeatures: string[]
  sampleResourceKind: string
  omittedCaveatKey: string
}

export const SALES_PRICE_LINE_FAMILY_SPECS: readonly SalesPriceLineFamilySpec[] = [
  {
    family: 'orders',
    labelKey: 'sales.simulation.priceBacktest.families.orders',
    requiredFeatures: ['sales.orders.view'],
    sampleResourceKind: SALES_RESOURCE_KIND_ORDER,
    omittedCaveatKey: 'sales.simulation.priceBacktest.caveats.ordersOmitted',
  },
  {
    family: 'quotes',
    labelKey: 'sales.simulation.priceBacktest.families.quotes',
    requiredFeatures: ['sales.quotes.view'],
    sampleResourceKind: SALES_RESOURCE_KIND_QUOTE,
    omittedCaveatKey: 'sales.simulation.priceBacktest.caveats.quotesOmitted',
  },
]

export function toPriceLineProposalAmounts(proposal: CatalogPriceLineScanQuery['proposal']): PriceLineProposalAmounts {
  return {
    currencyCode: proposal.currencyCode,
    unitPriceNet: proposal.unitPriceNet === null ? null : toScaledAmount(proposal.unitPriceNet),
    unitPriceGross: proposal.unitPriceGross === null ? null : toScaledAmount(proposal.unitPriceGross),
  }
}

async function scanFamilyPage(family: PriceLineFamily, query: CatalogPriceLineScanQuery): Promise<CatalogPriceLineScanPage> {
  const page = await readPriceLinePage(query.em.getKysely(), {
    family,
    tenantId: query.scope.tenantId,
    organizationId: query.scope.organizationId,
    from: query.window.from,
    to: query.window.to,
    priceId: query.priceId,
    after: query.after,
    limit: query.limit,
  })
  const proposal = toPriceLineProposalAmounts(query.proposal)
  const outcomes: CatalogPriceLineOutcome[] = page.rows.map((row) => {
    const classified = classifyPriceLine(row, query.timeline, proposal, query.displayBasis)
    return {
      lineId: row.id,
      documentId: row.documentId,
      currencyCode: (row.currencyCode ?? '').trim().toUpperCase(),
      basis: classified.basis,
      outcome: classified.outcome,
      reason: classified.reason,
      currentRevenue: classified.currentRevenue,
      simulatedRevenue: classified.simulatedRevenue,
    }
  })
  return { outcomes, lastCursor: page.lastCursor, exhausted: page.exhausted }
}

async function countFamilyUnlinked(family: PriceLineFamily, query: CatalogPriceUnlinkedLinesQuery): Promise<number> {
  return countUnlinkedPriceLines(query.em.getKysely(), {
    family,
    tenantId: query.scope.tenantId,
    organizationId: query.scope.organizationId,
    from: query.window.from,
    to: query.window.to,
    productId: query.productId,
    variantId: query.variantId,
    cap: query.cap,
  })
}

export function createSalesPriceLineSource(spec: SalesPriceLineFamilySpec): CatalogPriceLineSource {
  return {
    family: spec.family,
    labelKey: spec.labelKey,
    requiredFeatures: [...spec.requiredFeatures],
    sampleResourceKind: spec.sampleResourceKind,
    omittedCaveatKey: spec.omittedCaveatKey,
    scanPage: (query) => scanFamilyPage(spec.family, query),
    countUnlinkedLines: (query) => countFamilyUnlinked(spec.family, query),
  }
}

export const salesPriceLineSources: CatalogPriceLineSource[] = SALES_PRICE_LINE_FAMILY_SPECS.map(createSalesPriceLineSource)
