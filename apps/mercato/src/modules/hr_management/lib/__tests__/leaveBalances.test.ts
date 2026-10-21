/** @jest-environment node */
/**
 * Pins the leave-balance arithmetic. The balance is the number HR relies on
 * before it refuses a request, so every case here is a worked example rather
 * than an implementation detail.
 */
import {
  computeLeaveBalance,
  inclusiveDayCount,
  monthlyAccrualDays,
} from '../leaveBalances'

describe('leave balance', () => {
  it('subtracts approved and pending requests from entitlement, carry-over and accrual', () => {
    const balance = computeLeaveBalance({
      entitlements: [{ periodStart: '2026-01-01', periodEnd: '2026-12-31', entitledDays: '30', carryOverDays: '5' }],
      accruals: [{ days: '2.50' }, { days: '2.50' }],
      requests: [
        { id: 'approved-1', status: 'approved', startDate: '2026-03-01', endDate: '2026-03-05', totalDays: 5 },
        { id: 'pending-1', status: 'pending', startDate: '2026-04-01', endDate: '2026-04-02', totalDays: 2 },
        { id: 'rejected-1', status: 'rejected', startDate: '2026-05-01', endDate: '2026-05-03', totalDays: 3 },
      ],
    })

    expect(balance).not.toBeNull()
    expect(balance?.entitledDays).toBe(30)
    expect(balance?.carryOverDays).toBe(5)
    expect(balance?.accruedDays).toBe(5)
    expect(balance?.usedDays).toBe(5)
    expect(balance?.pendingDays).toBe(2)
    expect(balance?.availableDays).toBe(33)
  })

  it('excludes the request being updated so its old days do not count twice', () => {
    const balance = computeLeaveBalance({
      entitlements: [{ periodStart: '2026-01-01', periodEnd: '2026-12-31', entitledDays: '20', carryOverDays: '0' }],
      accruals: [],
      requests: [
        { id: 'editing', status: 'pending', startDate: '2026-02-01', endDate: '2026-02-10', totalDays: 10 },
      ],
      excludeRequestId: 'editing',
    })

    expect(balance?.availableDays).toBe(20)
  })

  it('returns a negative balance when the requests exceed the entitlement', () => {
    const balance = computeLeaveBalance({
      entitlements: [{ periodStart: '2026-01-01', periodEnd: '2026-12-31', entitledDays: '10', carryOverDays: '0' }],
      accruals: [],
      requests: [
        { status: 'approved', startDate: '2026-02-01', endDate: '2026-02-10', totalDays: 8 },
        { status: 'pending', startDate: '2026-03-01', endDate: '2026-03-04', totalDays: 4 },
      ],
    })

    expect(balance?.availableDays).toBe(-2)
  })

  it('returns null when no entitlement is configured', () => {
    expect(computeLeaveBalance({ entitlements: [], accruals: [], requests: [] })).toBeNull()
  })

  it('accrues one twelfth of the entitlement, rounded to two decimals', () => {
    expect(monthlyAccrualDays(30)).toBe(2.5)
    expect(monthlyAccrualDays(21)).toBe(1.75)
    expect(monthlyAccrualDays(22)).toBe(1.83)
    expect(monthlyAccrualDays(0)).toBe(0)
  })

  it('counts an inclusive range without timezone drift', () => {
    expect(inclusiveDayCount('2026-01-01', '2026-01-01')).toBe(1)
    expect(inclusiveDayCount('2026-01-01', '2026-01-31')).toBe(31)
    expect(inclusiveDayCount('2026-01-31', '2026-01-01')).toBe(0)
  })
})
