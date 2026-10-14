import { withWarrantyExactAmounts, withoutWarrantyExactKeys } from '../commands/shared'

const PRECISE_CREDIT = '1.123456789012345678'
const PRECISE_FEE = '0.000000000000000002'

type ParsedLine = { creditAmount?: number; restockingFee?: number; creditAmountExact?: string; restockingFeeExact?: string }
type ParsedInput = ParsedLine & { lines?: ParsedLine[] }

describe('withWarrantyExactAmounts', () => {
  it('captures exact digits from the raw request body', () => {
    const parsed: ParsedInput = { creditAmount: Number(PRECISE_CREDIT), lines: [{ restockingFee: Number(PRECISE_FEE) }] }
    const result = withWarrantyExactAmounts(parsed, { creditAmount: PRECISE_CREDIT, lines: [{ restockingFee: PRECISE_FEE }] })
    expect(result.creditAmountExact).toBe(PRECISE_CREDIT)
    expect(result.lines?.[0]?.restockingFeeExact).toBe(PRECISE_FEE)
  })

  it('keeps exact digits when the raw input was already parsed by the route', () => {
    const routeParsed = withWarrantyExactAmounts<ParsedInput>(
      { creditAmount: Number(PRECISE_CREDIT), lines: [{ creditAmount: Number(PRECISE_CREDIT), restockingFee: Number(PRECISE_FEE) }] },
      { creditAmount: PRECISE_CREDIT, lines: [{ creditAmount: PRECISE_CREDIT, restockingFee: PRECISE_FEE }] },
    )
    const commandParsed: ParsedInput = {
      creditAmount: Number(PRECISE_CREDIT),
      lines: [{ creditAmount: Number(PRECISE_CREDIT), restockingFee: Number(PRECISE_FEE) }],
    }
    const result = withWarrantyExactAmounts(commandParsed, routeParsed)
    expect(result.creditAmountExact).toBe(PRECISE_CREDIT)
    expect(result.lines?.[0]?.creditAmountExact).toBe(PRECISE_CREDIT)
    expect(result.lines?.[0]?.restockingFeeExact).toBe(PRECISE_FEE)
  })

  it('ignores an exact value that does not match the coerced number', () => {
    const result = withWarrantyExactAmounts<ParsedInput>(
      { creditAmount: 5 },
      { creditAmount: 5, creditAmountExact: '7.000000000000000001' },
    )
    expect(result.creditAmountExact).toBe('5')
  })

  it('strips route-attached exact keys so strict command schemas accept the input', () => {
    const routeOutput = {
      creditAmount: 1,
      creditAmountExact: '1',
      lines: [{ restockingFee: 2, restockingFeeExact: '2', note: 'kept' }],
    }
    expect(withoutWarrantyExactKeys(routeOutput)).toEqual({ creditAmount: 1, lines: [{ restockingFee: 2, note: 'kept' }] })
    expect(withoutWarrantyExactKeys(null)).toBeNull()
  })
})
