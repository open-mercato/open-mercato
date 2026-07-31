/** @jest-environment node */

/**
 * Root-cause coverage for issue #3521 (and the #3036 symptom it sits behind).
 *
 * A sales line must never persist with `total_net_amount = 0` while
 * `total_gross_amount > 0`: gross = net * (1 + taxRate) means net = 0 ⇒ gross =
 * 0, so the skew is a data inconsistency, not a priced state. When it was stored
 * anyway, the return-credit derivation in `commands/returns.ts`
 * (`unitNet = totalNetAmount / quantity`) produced a zero net credit while the
 * gross credit was correct, freezing the order net grand total on a second
 * return.
 *
 * These tests pin the persistence-time invariant helpers and reproduce the
 * #3036 mechanism end-to-end at the derivation level: the same formula the
 * return command uses yields a frozen (zero) net credit on the raw broken line,
 * but a correct net credit once the line is reconciled before persistence.
 */

import {
  deriveLineNetFromGross,
  reconcileLinePersistedTotals,
} from '../shared'

describe('deriveLineNetFromGross', () => {
  it('derives net from gross and tax rate when net is zero', () => {
    expect(deriveLineNetFromGross(0, 110, 10)).toBe(100)
  })

  it('accepts numeric-string inputs (the stored column shape)', () => {
    expect(deriveLineNetFromGross('0', '110', '10')).toBe(100)
  })

  it('returns gross unchanged when the tax rate is zero', () => {
    expect(deriveLineNetFromGross(0, 100, 0)).toBe(100)
  })

  it('treats a missing tax rate as zero', () => {
    expect(deriveLineNetFromGross(0, 100, null)).toBe(100)
    expect(deriveLineNetFromGross(0, 100, undefined)).toBe(100)
  })

  it('treats a missing/null net as zero and repairs it', () => {
    expect(deriveLineNetFromGross(null, 121, 21)).toBe(100)
    expect(deriveLineNetFromGross(undefined, 121, 21)).toBe(100)
  })

  it('treats a negative net as a violation and repairs it', () => {
    expect(deriveLineNetFromGross(-5, 110, 10)).toBe(100)
  })

  it('leaves an already-positive net untouched', () => {
    expect(deriveLineNetFromGross(50, 110, 10)).toBe(50)
    expect(deriveLineNetFromGross('81.3008', '100', '23')).toBe(81.3008)
  })

  it('keeps a legitimately free line at zero (gross = 0 ⇒ net = 0)', () => {
    expect(deriveLineNetFromGross(0, 0, 10)).toBe(0)
  })

  it('rounds the derived net to the 4-decimal column scale', () => {
    // 100 / 1.23 = 81.30081300813... → 81.3008
    expect(deriveLineNetFromGross(0, 100, 23)).toBe(81.3008)
  })
})

describe('reconcileLinePersistedTotals', () => {
  it('repairs a create payload that copied a zeroed net while gross is positive', () => {
    const reconciled = reconcileLinePersistedTotals({
      totalNetAmount: '0',
      totalGrossAmount: '110',
      taxRate: '10',
      quantity: '1',
      currencyCode: 'USD',
    })
    expect(reconciled.totalNetAmount).toBe('100')
    // unrelated fields are preserved
    expect(reconciled.totalGrossAmount).toBe('110')
    expect(reconciled.currencyCode).toBe('USD')
  })

  it('is a no-op when the net total is already positive', () => {
    const payload = { totalNetAmount: '100', totalGrossAmount: '110', taxRate: '10' }
    expect(reconcileLinePersistedTotals(payload)).toBe(payload)
  })

  it('is a no-op for a free line (gross = 0)', () => {
    const payload = { totalNetAmount: '0', totalGrossAmount: '0', taxRate: '0' }
    expect(reconcileLinePersistedTotals(payload)).toBe(payload)
  })
})

describe('#3036 return-credit mechanism', () => {
  // Mirrors the per-unit credit derivation in commands/returns.ts:
  //   const unitNet = lineQuantity > 0 ? toNumeric(line.totalNetAmount) / lineQuantity : unitPriceNet
  //   const totalNet = -round(Math.max(unitNet, 0) * quantityReturned)
  const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100
  const deriveReturnCredit = (
    line: { totalNetAmount: string; totalGrossAmount: string; quantity: string; unitPriceNet: string; unitPriceGross: string },
    quantityReturned: number,
  ) => {
    const lineQuantity = Math.max(Number(line.quantity), 0)
    const unitNet = lineQuantity > 0 ? Number(line.totalNetAmount) / lineQuantity : Number(line.unitPriceNet)
    const unitGross = lineQuantity > 0 ? Number(line.totalGrossAmount) / lineQuantity : Number(line.unitPriceGross)
    return {
      net: -round(Math.max(unitNet, 0) * quantityReturned),
      gross: -round(Math.max(unitGross, 0) * quantityReturned),
    }
  }

  const brokenLine = {
    totalNetAmount: '0', // the inconsistent stored state
    totalGrossAmount: '110',
    quantity: '1',
    unitPriceNet: '100',
    unitPriceGross: '110',
    taxRate: '10',
  }

  it('produces a frozen (zero) net credit when the order line stores net = 0 (the bug)', () => {
    const credit = deriveReturnCredit(brokenLine, 1)
    expect(credit.gross).toBe(-110)
    // Net credit is zero even though gross moved — this is what froze the net total.
    expect(Math.abs(credit.net)).toBe(0)
  })

  it('produces a correct net credit once the line is reconciled at persistence (the fix)', () => {
    const reconciled = reconcileLinePersistedTotals(brokenLine)
    expect(reconciled.totalNetAmount).toBe('100')

    const credit = deriveReturnCredit({ ...brokenLine, totalNetAmount: reconciled.totalNetAmount as string }, 1)
    expect(credit.gross).toBe(-110)
    // Net now moves in lockstep with gross — the net grand total no longer freezes.
    expect(credit.net).toBe(-100)
  })
})
