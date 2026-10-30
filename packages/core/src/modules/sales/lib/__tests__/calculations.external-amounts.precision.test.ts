import { calculateDocumentTotals } from '../calculations'
import {
  buildExternalHeaderTotals,
  hasAnySuppliedHeaderTotal,
  readPersistedHeaderTotals,
} from '../externalAmounts'
import type { SalesDocumentAmounts, SalesLineSnapshot } from '../types'

const NET = '1.123456789012345678'
const TAX = '0.258395061472839506'
const GROSS = '1.381851850485185184'
const UNIT = '0.561728394506172839'

const externalLine: SalesLineSnapshot = {
  kind: 'product',
  quantity: 2,
  currencyCode: 'ETH',
  unitPriceNet: Number(UNIT),
  unitPriceNetExact: UNIT,
  taxRate: 23,
  taxAmount: Number(TAX),
  taxAmountExact: TAX,
  totalNetAmount: Number(NET),
  totalNetAmountExact: NET,
  totalGrossAmount: Number(GROSS),
  totalGrossAmountExact: GROSS,
  amountsMode: 'external',
}

const headerSource = {
  subtotalNetAmount: Number(NET),
  subtotalNetAmountExact: NET,
  subtotalGrossAmount: Number(GROSS),
  subtotalGrossAmountExact: GROSS,
  discountTotalAmount: 0,
  taxTotalAmount: Number(TAX),
  taxTotalAmountExact: TAX,
  grandTotalNetAmount: Number(NET),
  grandTotalNetAmountExact: NET,
  grandTotalGrossAmount: Number(GROSS),
  grandTotalGrossAmountExact: GROSS,
}

describe('external amounts beyond float precision', () => {
  it('keeps the supplied header digits, defaulting the optional fields to zero', () => {
    const totals = buildExternalHeaderTotals(headerSource)
    expect(totals.grandTotalGrossAmountExact).toBe(GROSS)
    expect(totals.grandTotalGrossAmount).toBe(Number(GROSS))
    expect(totals.shippingNetAmountExact).toBe('0')
    expect(totals.surchargeTotalAmount).toBe(0)
  })

  it('reads persisted header columns as exact strings', () => {
    const order = Object.fromEntries(
      Object.entries(headerSource).filter(([key]) => !key.endsWith('Exact')).map(([key]) => [
        key,
        (headerSource as Record<string, unknown>)[`${key}Exact`] ?? String((headerSource as Record<string, unknown>)[key]),
      ]),
    ) as Parameters<typeof readPersistedHeaderTotals>[0]
    const totals = readPersistedHeaderTotals(order)
    expect(totals.subtotalNetAmountExact).toBe(NET)
    expect(totals.taxTotalAmountExact).toBe(TAX)
    expect(totals.shippingGrossAmountExact).toBe('0')
  })

  it('detects a header supplied only as decimal strings', () => {
    expect(hasAnySuppliedHeaderTotal({ grandTotalGrossAmount: GROSS })).toBe(true)
    expect(hasAnySuppliedHeaderTotal({ grandTotalGrossAmount: 'abc' })).toBe(false)
  })

  it('returns external line and header amounts with every digit', async () => {
    const result = await calculateDocumentTotals({
      documentKind: 'order',
      lines: [externalLine],
      context: { tenantId: 'tenant-1', organizationId: 'org-1', currencyCode: 'ETH', amountDecimalPlaces: 18, metadata: {} },
      totalsMode: 'external',
      suppliedTotals: buildExternalHeaderTotals(headerSource) as Partial<SalesDocumentAmounts>,
      existingTotals: { paidTotalAmount: 0.5, paidTotalAmountExact: '0.5' },
    })
    const [line] = result.lines
    expect(line.netAmountExact).toBe(NET)
    expect(line.taxAmountExact).toBe(TAX)
    expect(line.grossAmountExact).toBe(GROSS)
    expect(line.discountAmountExact).toBe('0')
    expect(result.totals.grandTotalNetAmountExact).toBe(NET)
    expect(result.totals.grandTotalGrossAmountExact).toBe(GROSS)
    expect(result.totals.taxTotalAmountExact).toBe(TAX)
    expect(result.totals.outstandingAmountExact).toBe('0.881851850485185184')
  })
})
