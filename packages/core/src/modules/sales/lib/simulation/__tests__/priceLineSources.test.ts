const readPriceLinePage = jest.fn()
const countUnlinkedPriceLines = jest.fn()

jest.mock('../priceLines', () => {
  const actual = jest.requireActual('../priceLines')
  return {
    ...actual,
    readPriceLinePage: (...args: unknown[]) => readPriceLinePage(...args),
    countUnlinkedPriceLines: (...args: unknown[]) => countUnlinkedPriceLines(...args),
  }
})

import { listCatalogPriceLineSources, resetCatalogPriceLineSourcesForTests } from '@open-mercato/core/modules/catalog/lib/simulation/priceLineSources'
import type { CatalogPriceLineScanQuery } from '@open-mercato/core/modules/catalog/lib/simulation/priceLineSources'
import { salesPriceLineSources, toPriceLineProposalAmounts } from '../priceLineSources'

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const PRICE_ID = '33333333-3333-4333-8333-333333333333'
const WINDOW = { from: new Date('2026-07-01T00:00:00Z'), to: new Date('2026-10-01T00:00:00Z') }
const KYSELY = { marker: 'kysely' }

function scanQuery(overrides: Partial<CatalogPriceLineScanQuery> = {}): CatalogPriceLineScanQuery {
  return {
    em: { getKysely: () => KYSELY } as never,
    scope: { tenantId: TENANT, organizationId: ORG },
    window: WINDOW,
    priceId: PRICE_ID,
    after: null,
    limit: 50,
    timeline: {
      entries: [{
        at: '2026-06-01T10:00:00.000Z',
        actionType: 'create',
        executionState: 'done',
        historyAction: null,
        snapshotBefore: null,
        snapshotAfter: { unitPriceNet: '10.0000', unitPriceGross: '12.3000', currencyCode: 'EUR' },
      }],
      exhausted: true,
      truncated: false,
    },
    proposal: { currencyCode: 'EUR', unitPriceNet: '12', unitPriceGross: null },
    displayBasis: 'net',
    ...overrides,
  }
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'line-1',
    documentId: 'order-1',
    cursorAt: '2026-08-01T10:00:00.000000Z',
    createdAt: '2026-08-01T10:00:00.000Z',
    updatedAt: '2026-08-01T10:00:00.000Z',
    currencyCode: 'eur',
    quantity: '3.0000',
    quantityUnit: null,
    normalizedUnit: null,
    unitPriceNet: '10.0000',
    unitPriceGross: '12.3000',
    priceMode: 'net',
    uomFactor: null,
    ...overrides,
  }
}

describe('sales price line sources (catalog price backtest)', () => {
  beforeEach(() => {
    readPriceLinePage.mockReset()
    countUnlinkedPriceLines.mockReset()
  })

  it('declares orders and quotes with their own view features and explain resources', () => {
    expect(salesPriceLineSources.map((source) => [source.family, source.requiredFeatures, source.sampleResourceKind, source.labelKey, source.omittedCaveatKey])).toEqual([
      ['orders', ['sales.orders.view'], 'sales.order', 'sales.simulation.priceBacktest.families.orders', 'sales.simulation.priceBacktest.caveats.ordersOmitted'],
      ['quotes', ['sales.quotes.view'], 'sales.quote', 'sales.simulation.priceBacktest.families.quotes', 'sales.simulation.priceBacktest.caveats.quotesOmitted'],
    ])
  })

  it('registers both families from the sales simulate convention file (soft-optional hook)', async () => {
    resetCatalogPriceLineSourcesForTests()
    jest.isolateModules(() => {
      require('../../../insights.simulate')
    })
    expect(listCatalogPriceLineSources().map((source) => source.family)).toEqual(['orders', 'quotes'])
  })

  it('scans one family page in the slice transaction and classifies every line', async () => {
    readPriceLinePage.mockResolvedValueOnce({
      rows: [row(), row({ id: 'line-2', documentId: 'order-2', unitPriceNet: '9.0000' }), row({ id: 'line-3', documentId: 'order-3', priceMode: null })],
      lastCursor: { at: '2026-08-01T10:00:00.000000Z', id: 'line-3' },
      exhausted: false,
    })
    const orders = salesPriceLineSources[0]
    const page = await orders.scanPage(scanQuery())
    expect(readPriceLinePage).toHaveBeenCalledWith(KYSELY, {
      family: 'orders',
      tenantId: TENANT,
      organizationId: ORG,
      from: WINDOW.from,
      to: WINDOW.to,
      priceId: PRICE_ID,
      after: null,
      limit: 50,
    })
    expect(page.lastCursor).toEqual({ at: '2026-08-01T10:00:00.000000Z', id: 'line-3' })
    expect(page.exhausted).toBe(false)
    expect(page.outcomes).toEqual([
      { lineId: 'line-1', documentId: 'order-1', currencyCode: 'EUR', basis: 'net', outcome: 'priced_from_row', reason: null, currentRevenue: BigInt(100_000) * BigInt(30_000), simulatedRevenue: BigInt(120_000) * BigInt(30_000) },
      { lineId: 'line-2', documentId: 'order-2', currencyCode: 'EUR', basis: 'net', outcome: 'manual_override', reason: null, currentRevenue: null, simulatedRevenue: null },
      { lineId: 'line-3', documentId: 'order-3', currencyCode: 'EUR', basis: 'net', outcome: 'cannot_tell', reason: 'price_mode_unknown', currentRevenue: null, simulatedRevenue: null },
    ])
  })

  it('counts unlinked lines of the family through the scan module', async () => {
    countUnlinkedPriceLines.mockResolvedValueOnce(7)
    const quotes = salesPriceLineSources[1]
    await expect(quotes.countUnlinkedLines({ em: { getKysely: () => KYSELY } as never, scope: { tenantId: TENANT, organizationId: ORG }, window: WINDOW, productId: 'p', variantId: null, cap: 10 })).resolves.toBe(7)
    expect(countUnlinkedPriceLines).toHaveBeenCalledWith(KYSELY, { family: 'quotes', tenantId: TENANT, organizationId: ORG, from: WINDOW.from, to: WINDOW.to, productId: 'p', variantId: null, cap: 10 })
  })

  it('turns proposed decimal amounts into 10^-4 units', () => {
    expect(toPriceLineProposalAmounts({ currencyCode: 'EUR', unitPriceNet: '12.5', unitPriceGross: null })).toEqual({ currencyCode: 'EUR', unitPriceNet: BigInt(125_000), unitPriceGross: null })
  })
})
