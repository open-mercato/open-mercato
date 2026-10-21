/** @jest-environment node */
import {
  computeFuelEfficiency,
  computeNextMaintenanceDue,
  computeWorkOrderTotals,
  isPolicyExpiringSoon,
  summarizeOperations,
} from '../operationsService'

describe('fleet operations arithmetic', () => {
  it('computes parts and labor totals as decimal strings', () => {
    const totals = computeWorkOrderTotals(
      [
        { quantity: '2', unitCost: '125.50' },
        { quantity: '1', unitCost: '0.25' },
      ],
      [{ hours: '1.5', rate: '80' }],
    )
    expect(totals.partsCost).toBe('251.25')
    expect(totals.laborCost).toBe('120.00')
    expect(totals.totalCost).toBe('371.25')
  })

  it('rolls the next due date and odometer according to the interval type', () => {
    const completedAt = new Date('2026-10-19T10:00:00.000Z')
    const dateOnly = computeNextMaintenanceDue({
      schedule: { intervalType: 'date', intervalDays: 30, intervalOdometer: 5000 },
      completedAt,
      odometer: 10000,
    })
    expect(dateOnly.nextDueAt?.toISOString()).toBe('2026-11-18T10:00:00.000Z')
    expect(dateOnly.nextDueOdometer).toBeNull()

    const odometerOnly = computeNextMaintenanceDue({
      schedule: { intervalType: 'odometer', intervalDays: 30, intervalOdometer: 5000 },
      completedAt,
      odometer: 10000,
    })
    expect(odometerOnly.nextDueAt).toBeNull()
    expect(odometerOnly.nextDueOdometer).toBe(15000)

    const both = computeNextMaintenanceDue({
      schedule: { intervalType: 'both', intervalDays: 90, intervalOdometer: 10000 },
      completedAt,
      odometer: 42000,
    })
    expect(both.nextDueAt).not.toBeNull()
    expect(both.nextDueOdometer).toBe(52000)
  })

  it('computes fuel distance and efficiency from odometer readings', () => {
    const result = computeFuelEfficiency([
      { odometer: 1200, liters: '40', totalCost: '80.00' },
      { odometer: 1000, liters: '35', totalCost: '70.00' },
      { odometer: 1500, liters: '45', totalCost: '90.00' },
    ])
    expect(result.totalLiters).toBe('120.000')
    expect(result.totalCost).toBe('240.00')
    expect(result.distanceKm).toBe(500)
    expect(result.kmPerLiter).toBe(4.17)
  })

  it('flags only active policies expiring inside the window', () => {
    const now = new Date('2026-10-19T00:00:00.000Z')
    expect(isPolicyExpiringSoon({ status: 'active', endDate: '2026-11-01' }, now)).toBe(true)
    expect(isPolicyExpiringSoon({ status: 'active', endDate: '2027-01-01' }, now)).toBe(false)
    expect(isPolicyExpiringSoon({ status: 'cancelled', endDate: '2026-11-01' }, now)).toBe(false)
    expect(isPolicyExpiringSoon({ status: 'active', endDate: '2026-10-01' }, now)).toBe(false)
  })

  it('summarizes the operational dashboard', () => {
    const now = new Date('2026-10-19T00:00:00.000Z')
    const summary = summarizeOperations({
      now,
      workOrders: [
        { status: 'open', totalCost: '0' },
        { status: 'completed', totalCost: '500.00', completedAt: '2026-10-10' },
        { status: 'completed', totalCost: '300.00', completedAt: '2026-06-01' },
      ],
      schedules: [
        { isActive: true, nextDueAt: '2026-10-01' },
        { isActive: true, nextDueOdometer: 1000, currentOdometer: 1200 },
        { isActive: false, nextDueAt: '2026-10-01' },
      ],
      policies: [{ status: 'active', endDate: '2026-11-01' }],
      violations: [{ status: 'open' }, { status: 'paid' }],
      fuelLogs: [
        { loggedAt: '2026-10-15', totalCost: '100.00' },
        { loggedAt: '2026-01-01', totalCost: '999.00' },
      ],
    })
    expect(summary).toEqual({
      openWorkOrders: 1,
      overdueSchedules: 2,
      expiringPolicies: 1,
      openViolations: 1,
      fuelCost30d: '100.00',
      maintenanceCost30d: '500.00',
    })
  })
})
