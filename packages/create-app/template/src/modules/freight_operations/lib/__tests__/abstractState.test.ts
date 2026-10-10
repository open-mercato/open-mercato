/** @jest-environment node */
/**
 * Pins the abstract lifecycle: which statuses allow which action, what a
 * resolution does to a line's money, and that the abstract totals can only come
 * from the lines that are still billable.
 */
import { ABSTRACT_ACTION_SOURCE_STATUSES, hasOpenDisputes, isAbstractActionAllowed, resolveLineAmounts, sumBillableLines } from '../abstractState'
import type { AbstractStatus } from '../../data/entities'

const ALL_STATUSES: AbstractStatus[] = ['draft', 'submitted', 'disputed', 'approved', 'invoiced', 'cancelled']

describe('abstract state machine', () => {
  it('allows each action only from the statuses that precede it', () => {
    expect(ABSTRACT_ACTION_SOURCE_STATUSES.submit).toEqual(['draft'])
    expect(ABSTRACT_ACTION_SOURCE_STATUSES.respond).toEqual(['submitted'])
    expect(ABSTRACT_ACTION_SOURCE_STATUSES.resolve).toEqual(['disputed'])
    expect(ABSTRACT_ACTION_SOURCE_STATUSES.finalize).toEqual(['draft'])
    expect(ABSTRACT_ACTION_SOURCE_STATUSES.record_offline_approval).toEqual(['submitted'])
    expect(ABSTRACT_ACTION_SOURCE_STATUSES.invoice).toEqual(['approved'])
    expect(ABSTRACT_ACTION_SOURCE_STATUSES.cancel).toEqual(['draft', 'submitted', 'disputed', 'approved'])
  })

  it('refuses every action on an invoiced or cancelled abstract', () => {
    for (const status of ['invoiced', 'cancelled'] as AbstractStatus[]) {
      for (const action of Object.keys(ABSTRACT_ACTION_SOURCE_STATUSES) as Array<keyof typeof ABSTRACT_ACTION_SOURCE_STATUSES>) {
        expect(isAbstractActionAllowed(status, action)).toBe(false)
      }
    }
  })

  it('keeps the terminal statuses reachable exactly once', () => {
    expect(isAbstractActionAllowed('approved', 'invoice')).toBe(true)
    expect(isAbstractActionAllowed('approved', 'cancel')).toBe(true)
    expect(isAbstractActionAllowed('submitted', 'invoice')).toBe(false)
    expect(isAbstractActionAllowed('disputed', 'invoice')).toBe(false)
    for (const status of ALL_STATUSES) {
      expect(isAbstractActionAllowed(status, 'finalize')).toBe(status === 'draft')
    }
  })
})

describe('abstract totals', () => {
  const billable = (net: string, tax: string, gross: string, isBillable = true) => ({
    isBillable,
    totalNetAmount: net,
    taxAmount: tax,
    totalGrossAmount: gross,
  })

  it('sums billable lines exactly, in integer halalas', () => {
    const totals = sumBillableLines([
      billable('100.05', '15.01', '115.06'),
      billable('200.10', '30.02', '230.12'),
      billable('0.01', '0.00', '0.01'),
    ])
    expect(totals).toEqual({
      tripCount: 3,
      subtotalNetAmount: '300.16',
      taxTotalAmount: '45.03',
      grandTotalGrossAmount: '345.19',
    })
  })

  it('skips lines a resolution removed from billing', () => {
    const totals = sumBillableLines([
      billable('100.00', '15.00', '115.00'),
      billable('50.00', '7.50', '57.50', false),
    ])
    expect(totals.tripCount).toBe(1)
    expect(totals.subtotalNetAmount).toBe('100.00')
    expect(totals.grandTotalGrossAmount).toBe('115.00')
  })

  it('reads an empty abstract as zero, not as null', () => {
    expect(sumBillableLines([])).toEqual({
      tripCount: 0,
      subtotalNetAmount: '0.00',
      taxTotalAmount: '0.00',
      grandTotalGrossAmount: '0.00',
    })
  })
})

describe('abstract line resolutions', () => {
  const line = {
    isBillable: true,
    totalNetAmount: '100.00',
    taxAmount: '15.00',
    totalGrossAmount: '115.00',
    taxRate: '15',
  }

  it('leaves a rejected dispute exactly as billed', () => {
    expect(resolveLineAmounts({ ...line, resolution: 'rejected_dispute' })).toEqual({
      isBillable: true,
      totalNetAmount: '100.00',
      taxAmount: '15.00',
      totalGrossAmount: '115.00',
      adjustedAmountNet: null,
    })
  })

  it('un-bills the line when the dispute is accepted or the line is removed, keeping its amounts as the record', () => {
    for (const resolution of ['accepted_as_disputed', 'removed'] as const) {
      expect(resolveLineAmounts({ ...line, resolution })).toEqual({
        isBillable: false,
        totalNetAmount: '100.00',
        taxAmount: '15.00',
        totalGrossAmount: '115.00',
        adjustedAmountNet: null,
      })
    }
  })

  it('replaces an adjusted amount and recomputes its tax at the line rate', () => {
    const outcome = resolveLineAmounts({ ...line, resolution: 'adjusted', adjustedAmountNet: '80' })
    expect(outcome).toEqual({
      isBillable: true,
      totalNetAmount: '80.00',
      taxAmount: '12.00',
      totalGrossAmount: '92.00',
      adjustedAmountNet: '80.00',
    })
  })

  it('keeps gross equal to net + tax on the adjusted tie boundary', () => {
    const outcome = resolveLineAmounts({ ...line, resolution: 'adjusted', adjustedAmountNet: '10.05' })
    expect(outcome.totalNetAmount).toBe('10.05')
    expect(outcome.taxAmount).toBe('1.51')
    expect(outcome.totalGrossAmount).toBe('11.56')
  })

  it('treats an adjusted amount of zero as a valid resolution', () => {
    const outcome = resolveLineAmounts({ ...line, resolution: 'adjusted', adjustedAmountNet: '0' })
    expect(outcome.totalGrossAmount).toBe('0.00')
    expect(outcome.isBillable).toBe(true)
  })
})

describe('open disputes', () => {
  it('reports an abstract settled only when no line is still disputed', () => {
    expect(hasOpenDisputes([{ disputeStatus: 'none' }, { disputeStatus: 'disputed' }])).toBe(true)
    expect(hasOpenDisputes([{ disputeStatus: 'none' }, { disputeStatus: 'resolved' }])).toBe(false)
    expect(hasOpenDisputes([])).toBe(false)
  })
})
