import { rebuildDocumentResult } from '../calculations'
import { resolveConvertedOrderFeeTotals } from '../convertedOrderTotals'

const shippingRow = { scope: 'order', kind: 'shipping', amountNet: '15.0000', amountGross: '18.4500', position: 0 }
const surchargeRow = { scope: 'order', kind: 'surcharge', amountNet: '5.0000', amountGross: '6.1500', position: 1 }
const discountRow = { scope: 'order', kind: 'discount', amountNet: '10.0000', amountGross: '10.0000', position: 2 }

function resolve(totalsSnapshot: unknown, adjustments: Parameters<typeof resolveConvertedOrderFeeTotals>[0]['adjustments']) {
  return resolveConvertedOrderFeeTotals({ totalsSnapshot, currencyCode: 'USD', adjustments })
}

describe('resolveConvertedOrderFeeTotals', () => {
  it('reads the three buckets from the quote totals snapshot', () => {
    expect(
      resolve(
        { shippingNetAmount: 15, shippingGrossAmount: 18.45, surchargeTotalAmount: 5, grandTotalGrossAmount: 137.6 },
        [shippingRow, surchargeRow, discountRow],
      ),
    ).toEqual({ shippingNetAmount: '15', shippingGrossAmount: '18.45', surchargeTotalAmount: '5' })
  })

  it('prefers the snapshot over adjustment rows that disagree with it', () => {
    expect(
      resolve({ shippingNetAmount: 7, shippingGrossAmount: 8.61, surchargeTotalAmount: 2 }, [shippingRow, surchargeRow]),
    ).toEqual({ shippingNetAmount: '7', shippingGrossAmount: '8.61', surchargeTotalAmount: '2' })
  })

  it('keeps a snapshot zero even when a stale fee row exists', () => {
    expect(
      resolve({ shippingNetAmount: 0, shippingGrossAmount: 0, surchargeTotalAmount: 0 }, [shippingRow, surchargeRow]),
    ).toEqual({ shippingNetAmount: '0', shippingGrossAmount: '0', surchargeTotalAmount: '0' })
  })

  it('keeps a snapshot surcharge that has no adjustment row', () => {
    expect(resolve({ shippingNetAmount: 0, shippingGrossAmount: 0, surchargeTotalAmount: 4.5 }, [])).toEqual({
      shippingNetAmount: '0',
      shippingGrossAmount: '0',
      surchargeTotalAmount: '4.5',
    })
  })

  it('derives shipping net and gross together when the snapshot has only one of them', () => {
    expect(resolve({ shippingNetAmount: 7, surchargeTotalAmount: 2 }, [shippingRow, surchargeRow])).toEqual({
      shippingNetAmount: '15',
      shippingGrossAmount: '18.45',
      surchargeTotalAmount: '2',
    })
  })

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['an undecrypted string', 'QNDslJwXVJBlDnhu:ciphertext:v1'],
    ['an array', [15, 18.45, 5]],
    ['an object without the keys', { grandTotalGrossAmount: 137.6 }],
    ['numeric strings', { shippingNetAmount: '7', shippingGrossAmount: '8.61', surchargeTotalAmount: '2' }],
    ['non-finite values', { shippingNetAmount: Number.NaN, shippingGrossAmount: Infinity, surchargeTotalAmount: 'Infinity' }],
    ['null values', { shippingNetAmount: null, shippingGrossAmount: null, surchargeTotalAmount: null }],
  ])('derives the buckets from the copied adjustments when the snapshot is %s', (_label, totalsSnapshot) => {
    expect(resolve(totalsSnapshot, [shippingRow, surchargeRow, discountRow])).toEqual({
      shippingNetAmount: '15',
      shippingGrossAmount: '18.45',
      surchargeTotalAmount: '5',
    })
  })

  it('sums several fee rows and ignores line-scoped rows and other kinds', () => {
    expect(
      resolve(null, [
        shippingRow,
        { scope: 'order', kind: 'shipping', amountNet: '4.1000', amountGross: '5.0430', position: 3 },
        { scope: 'line', kind: 'shipping', amountNet: '99.0000', amountGross: '99.0000', position: 4 },
        { scope: 'order', kind: 'surcharge', amountNet: '0.0000', amountGross: '2.5000', position: 5 },
        { scope: 'order', kind: 'return', amountNet: '-30.0000', amountGross: '-30.0000', position: 6 },
        { scope: 'order', kind: 'tax', amountNet: '3.0000', amountGross: '3.0000', position: 7 },
        discountRow,
      ]),
    ).toEqual({ shippingNetAmount: '19.1', shippingGrossAmount: '23.493', surchargeTotalAmount: '2.5' })
  })

  it('normalises negative stored fee amounts the way the engine does', () => {
    expect(
      resolve(null, [{ scope: 'order', kind: 'shipping', amountNet: '-15.0000', amountGross: '-18.4500', position: 0 }]),
    ).toEqual({ shippingNetAmount: '15', shippingGrossAmount: '18.45', surchargeTotalAmount: '0' })
  })

  it('lets the engine fill a missing net or gross amount and counts an unreadable row as zero', () => {
    expect(
      resolve(null, [
        { scope: 'order', kind: 'shipping', amountNet: '', amountGross: '18.4500', position: 0 },
        { scope: 'order', kind: 'surcharge', amountNet: null, amountGross: 'abc', position: 1 },
      ]),
    ).toEqual({ shippingNetAmount: '18.45', shippingGrossAmount: '18.45', surchargeTotalAmount: '0' })
  })

  it('returns zeros when there is neither a snapshot nor a fee row', () => {
    expect(resolve(null, [])).toEqual({ shippingNetAmount: '0', shippingGrossAmount: '0', surchargeTotalAmount: '0' })
    expect(resolve(null, [discountRow])).toEqual({ shippingNetAmount: '0', shippingGrossAmount: '0', surchargeTotalAmount: '0' })
  })

  it('derives the same buckets the engine reports for a full document with lines and other adjustments', () => {
    const rows = [shippingRow, surchargeRow]
    const toDraft = (row: { kind: string; amountNet: string; amountGross: string; position: number }) => ({
      scope: 'order' as const,
      kind: row.kind,
      amountNet: Number(row.amountNet),
      amountGross: Number(row.amountGross),
      position: row.position,
    })
    const engine = rebuildDocumentResult({
      documentKind: 'order',
      currencyCode: 'USD',
      lines: [
        {
          line: { kind: 'product', quantity: 2, currencyCode: 'USD', unitPriceNet: 50, taxRate: 23 },
          netAmount: 100,
          grossAmount: 123,
          taxAmount: 23,
          discountAmount: 0,
          adjustments: [],
        },
      ],
      adjustments: [
        ...rows.map(toDraft),
        { scope: 'order', kind: 'discount', amountNet: 5000, amountGross: 5000, position: 2 },
        { scope: 'order', kind: 'return', amountNet: -30, amountGross: -36.9, position: 3 },
        { scope: 'order', kind: 'custom', amountNet: 12, amountGross: 12, position: 4 },
      ],
    }).totals

    expect(engine.shippingNetAmount).toBe(15)
    expect(resolve(null, rows)).toEqual({
      shippingNetAmount: String(engine.shippingNetAmount),
      shippingGrossAmount: String(engine.shippingGrossAmount),
      surchargeTotalAmount: String(engine.surchargeTotalAmount),
    })
  })
})
