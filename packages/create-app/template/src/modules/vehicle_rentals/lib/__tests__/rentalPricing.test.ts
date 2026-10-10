/** @jest-environment node */
import { computeRentalAmounts, rentalPeriods } from '../rentalPricing'

describe('rental period arithmetic', () => {
  it('bills whole days, weeks and months', () => {
    expect(rentalPeriods('daily', '2026-10-01T08:00:00.000Z', '2026-10-03T08:00:00.000Z')).toEqual({ days: 3, periods: 3 })
    // Ten days on a weekly rate is two weeks, not one and a half.
    expect(rentalPeriods('weekly', '2026-10-01T08:00:00.000Z', '2026-10-10T08:00:00.000Z').periods).toBe(2)
    expect(rentalPeriods('monthly', '2026-10-01T08:00:00.000Z', '2026-11-09T08:00:00.000Z').periods).toBe(2)
  })

  it('treats a missing or inverted window as nothing to bill', () => {
    expect(rentalPeriods('daily', null, null)).toEqual({ days: 0, periods: 0 })
    expect(rentalPeriods('daily', '2026-10-05T08:00:00.000Z', '2026-10-01T08:00:00.000Z')).toEqual({ days: 0, periods: 0 })
  })
})

describe('rental amounts', () => {
  const base = {
    durationType: 'daily' as const,
    startAt: '2026-10-01T08:00:00.000Z',
    endAt: '2026-10-03T08:00:00.000Z',
    dailyRate: '500',
    weeklyRate: '2800',
    monthlyRate: '9000',
    taxRate: 15,
  }

  it('bills the rented days at the daily rate with VAT to the halala', () => {
    const amounts = computeRentalAmounts(base)
    expect(amounts.rentalAmountNet).toBe('1500.00')
    expect(amounts.totalNetAmount).toBe('1500.00')
    expect(amounts.taxAmount).toBe('225.00')
    expect(amounts.totalGrossAmount).toBe('1725.00')
  })

  // The included mileage scales with the billed periods, so a day's allowance is
  // not stretched across a fortnight.
  it('scales the included mileage with the billed periods and charges the excess', () => {
    const amounts = computeRentalAmounts({
      ...base,
      durationType: 'weekly',
      endAt: '2026-10-10T08:00:00.000Z',
      includedKm: 1000,
      extraKmRate: '2',
      odoStartKm: 100_000,
      odoEndKm: 102_500,
    })
    expect(amounts.periods).toBe(2)
    expect(amounts.includedKm).toBe(2000)
    expect(amounts.usageKm).toBe(2500)
    expect(amounts.extraKm).toBe(500)
    expect(amounts.extraKmAmountNet).toBe('1000.00')
    expect(amounts.rentalAmountNet).toBe('5600.00')
    expect(amounts.totalNetAmount).toBe('6600.00')
    expect(amounts.taxAmount).toBe('990.00')
  })

  it('charges nothing extra when the rental stays inside its allowance', () => {
    const amounts = computeRentalAmounts({
      ...base,
      includedKm: 1000,
      extraKmRate: '2',
      odoStartKm: 100_000,
      odoEndKm: 100_400,
    })
    expect(amounts.extraKm).toBe(0)
    expect(amounts.extraKmAmountNet).toBe('0.00')
  })

  // An unread odometer cannot produce a mileage charge — the operator may not
  // have the closing reading yet, and inventing zero would understate the bill.
  it('leaves the mileage unknown until both readings exist', () => {
    const amounts = computeRentalAmounts({ ...base, includedKm: 1000, extraKmRate: '2', odoStartKm: null, odoEndKm: null })
    expect(amounts.usageKm).toBeNull()
    expect(amounts.extraKm).toBeNull()
    expect(amounts.extraKmAmountNet).toBe('0.00')
  })
})
