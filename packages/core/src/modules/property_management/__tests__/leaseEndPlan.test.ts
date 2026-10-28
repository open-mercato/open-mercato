/** @jest-environment node */
import { LeaseVersion } from '../data/entities'
import { planLeaseEnd } from '../lib/leaseEndPlan'
import { isProposalExpired, isReminderDue } from '../lib/leaseProposalLifecycle'
import type { RecurrenceRead } from '../lib/salesRecurrence'

function version(id: string, orderId: string, startsOn: string, endsOn: string): LeaseVersion {
  return Object.assign(Object.create(LeaseVersion.prototype), { id, salesOrderId: orderId, startsOn, endsOn, state: 'in_force' })
}

function recurrence(orderId: string, extra: Partial<RecurrenceRead> = {}): RecurrenceRead {
  return {
    orderId,
    status: 'active',
    startsOn: '2026-01-10',
    periodCount: 12,
    endsOn: null,
    nextPeriodIndex: 0,
    nextInvoiceOn: null,
    scheduleVersion: 1,
    cancelEffectiveOn: null,
    cancelSettlement: null,
    invoicesAvailable: true,
    periods: [],
    ...extra,
  }
}

describe('planLeaseEnd', () => {
  const original = version('v1', 'order-1', '2026-01-10', '2027-01-09')
  const extension = version('v2', 'order-2', '2027-01-10', '2027-07-09')

  it('cancels every order reaching past the new end, cutting a future order from its start', async () => {
    const reader = jest.fn(async (orderId: string) => recurrence(orderId))
    const plan = await planLeaseEnd([original, extension], '2026-05-14', 'keep', reader)
    expect(plan.entries.map((entry) => [entry.orderId, entry.effectiveOn])).toEqual([
      ['order-1', '2026-05-15'],
      ['order-2', '2027-01-10'],
    ])
    expect(plan.wouldCredit).toBe(false)
  })

  it('skips orders that end before the new end or are already cut earlier', async () => {
    const reader = jest.fn(async (orderId: string) =>
      orderId === 'order-1' ? recurrence(orderId, { status: 'cancelling', cancelEffectiveOn: '2026-04-10' }) : recurrence(orderId),
    )
    const plan = await planLeaseEnd([original, extension], '2026-05-14', 'prorate', reader)
    expect(plan.entries.map((entry) => entry.orderId)).toEqual(['order-2'])
  })

  it('re-cancels an order whose existing cutoff is later than the new one', async () => {
    const reader = jest.fn(async (orderId: string) => recurrence(orderId, { status: 'cancelling', cancelEffectiveOn: '2026-08-10' }))
    const plan = await planLeaseEnd([original], '2026-05-14', 'keep', reader)
    expect(plan.entries).toHaveLength(1)
  })

  it('flags credits from issued invoices after the new end', async () => {
    const reader = jest.fn(async (orderId: string) =>
      recurrence(orderId, {
        nextPeriodIndex: 6,
        periods: [
          { periodIndex: 4, periodStart: '2026-05-10', periodEnd: '2026-06-09', invoiceId: 'inv-5', creditMemoId: null, billedFactor: '1', creditedFactor: null },
          { periodIndex: 5, periodStart: '2026-06-10', periodEnd: '2026-07-09', invoiceId: 'inv-6', creditMemoId: null, billedFactor: '1', creditedFactor: null },
        ],
      }),
    )
    const keep = await planLeaseEnd([original], '2026-05-14', 'keep', reader)
    expect(keep.wouldCredit).toBe(true)
    expect(keep.entries[0].preview.fullyCreditedPeriods).toEqual([5])
  })
})

describe('proposal lifecycle', () => {
  it('expires a proposal the day after its respond-by date', () => {
    expect(isProposalExpired('2026-11-11', '2026-11-11')).toBe(false)
    expect(isProposalExpired('2026-11-11', '2026-11-12')).toBe(true)
  })

  it('reminds three days before the respond-by date until it expires', () => {
    expect(isReminderDue('2026-11-11', '2026-11-07')).toBe(false)
    expect(isReminderDue('2026-11-11', '2026-11-08')).toBe(true)
    expect(isReminderDue('2026-11-11', '2026-11-11')).toBe(true)
    expect(isReminderDue('2026-11-11', '2026-11-12')).toBe(false)
  })
})
