import {
  RETURN_ADJUSTMENT_EXCEEDS_REMAINING_GROSS_MESSAGE,
  RETURN_ADJUSTMENT_EXCEEDS_REMAINING_NET_MESSAGE,
  validateReturnAdjustmentWithinRemaining,
} from '../validators'

describe('validateReturnAdjustmentWithinRemaining — issue #1904', () => {
  it('rejects a return whose abs(amountGross) exceeds the remaining grand total', () => {
    const issues = validateReturnAdjustmentWithinRemaining({
      kind: 'return',
      amountNet: -80,
      amountGross: -80,
      remainingNet: 75,
      remainingGross: 75,
    })
    const paths = issues.map((issue) => issue.path)
    const messages = issues.map((issue) => issue.message)
    expect(paths).toContain('amountGross')
    expect(paths).toContain('amountNet')
    expect(messages).toContain(RETURN_ADJUSTMENT_EXCEEDS_REMAINING_GROSS_MESSAGE)
    expect(messages).toContain(RETURN_ADJUSTMENT_EXCEEDS_REMAINING_NET_MESSAGE)
  })

  it('rejects when only amountGross exceeds remaining', () => {
    const issues = validateReturnAdjustmentWithinRemaining({
      kind: 'return',
      amountNet: -50,
      amountGross: -100,
      remainingNet: 75,
      remainingGross: 75,
    })
    const paths = issues.map((issue) => issue.path)
    expect(paths).toEqual(['amountGross'])
  })

  it('accepts a return whose abs(amount) equals the remaining grand total', () => {
    const issues = validateReturnAdjustmentWithinRemaining({
      kind: 'return',
      amountNet: -75,
      amountGross: -75,
      remainingNet: 75,
      remainingGross: 75,
    })
    expect(issues).toEqual([])
  })

  it('accepts a return whose abs(amount) is within the remaining grand total', () => {
    const issues = validateReturnAdjustmentWithinRemaining({
      kind: 'return',
      amountNet: -10,
      amountGross: -10,
      remainingNet: 75,
      remainingGross: 75,
    })
    expect(issues).toEqual([])
  })

  it('accepts a zero-amount return regardless of remaining', () => {
    const issues = validateReturnAdjustmentWithinRemaining({
      kind: 'return',
      amountNet: 0,
      amountGross: 0,
      remainingNet: 0,
      remainingGross: 0,
    })
    expect(issues).toEqual([])
  })

  it('rejects any non-zero return when remaining is zero', () => {
    const issues = validateReturnAdjustmentWithinRemaining({
      kind: 'return',
      amountNet: -1,
      amountGross: -1,
      remainingNet: 0,
      remainingGross: 0,
    })
    expect(issues.map((issue) => issue.path).sort()).toEqual([
      'amountGross',
      'amountNet',
    ])
  })

  it('absorbs tiny floating-point rounding from upstream tax math', () => {
    const issues = validateReturnAdjustmentWithinRemaining({
      kind: 'return',
      amountNet: -75.001,
      amountGross: -75.001,
      remainingNet: 75,
      remainingGross: 75,
    })
    expect(issues).toEqual([])
  })

  it('does not flag non-return adjustment kinds', () => {
    const issues = validateReturnAdjustmentWithinRemaining({
      kind: 'discount',
      amountNet: -200,
      amountGross: -200,
      remainingNet: 5,
      remainingGross: 5,
    })
    expect(issues).toEqual([])
  })

  it('treats missing/undefined amounts as zero (no false positives)', () => {
    const issues = validateReturnAdjustmentWithinRemaining({
      kind: 'return',
      remainingNet: 0,
      remainingGross: 0,
    })
    expect(issues).toEqual([])
  })

  it('handles asymmetric remaining net vs gross (e.g. tax-inclusive totals)', () => {
    const issues = validateReturnAdjustmentWithinRemaining({
      kind: 'return',
      amountNet: -60,
      amountGross: -70,
      remainingNet: 60,
      remainingGross: 73.8,
    })
    expect(issues).toEqual([])
  })
})
