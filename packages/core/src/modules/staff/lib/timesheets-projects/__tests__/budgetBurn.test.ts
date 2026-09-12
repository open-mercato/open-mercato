import { computeBudgetBurn, DEFAULT_BUDGET_WARN_AT_PERCENT } from '../budgetBurn'

describe('computeBudgetBurn', () => {
  it('returns null for a project without a budget', () => {
    expect(
      computeBudgetBurn({ kind: 'none', budgetValue: 125, warnAtPercent: 80, totalMinutes: 600, cost: 100 }),
    ).toBeNull()
  })

  it('returns null when the budget value is missing or not positive', () => {
    expect(
      computeBudgetBurn({ kind: 'hours', budgetValue: null, warnAtPercent: 80, totalMinutes: 600, cost: null }),
    ).toBeNull()
    expect(
      computeBudgetBurn({ kind: 'hours', budgetValue: 0, warnAtPercent: 80, totalMinutes: 600, cost: null }),
    ).toBeNull()
  })

  it('measures an hours budget against logged hours', () => {
    const burn = computeBudgetBurn({
      kind: 'hours',
      budgetValue: 125,
      warnAtPercent: 80,
      totalMinutes: 4700,
      cost: null,
    })
    expect(burn).toMatchObject({ kind: 'hours', percent: 63, barPercent: 63, tone: 'accent' })
  })

  it('measures an amount budget against cost', () => {
    const burn = computeBudgetBurn({
      kind: 'amount',
      budgetValue: 20000,
      warnAtPercent: 80,
      totalMinutes: 4700,
      cost: 5000,
    })
    expect(burn).toMatchObject({ kind: 'amount', percent: 25, tone: 'accent' })
  })

  it('turns warning-toned at the configured threshold', () => {
    const burn = computeBudgetBurn({
      kind: 'hours',
      budgetValue: 40,
      warnAtPercent: 80,
      totalMinutes: 2205,
      cost: null,
    })
    expect(burn).toMatchObject({ percent: 92, tone: 'warning' })
  })

  it('honours a custom warn-at threshold', () => {
    const burn = computeBudgetBurn({
      kind: 'hours',
      budgetValue: 100,
      warnAtPercent: 50,
      totalMinutes: 3300,
      cost: null,
    })
    expect(burn).toMatchObject({ percent: 55, tone: 'warning' })
  })

  it('falls back to the default threshold for an invalid warn-at value', () => {
    const burn = computeBudgetBurn({
      kind: 'hours',
      budgetValue: 100,
      warnAtPercent: 0,
      totalMinutes: 60 * DEFAULT_BUDGET_WARN_AT_PERCENT,
      cost: null,
    })
    expect(burn).toMatchObject({ percent: DEFAULT_BUDGET_WARN_AT_PERCENT, tone: 'warning' })
  })

  it('caps the bar at 100% while keeping the real percentage for the label', () => {
    const burn = computeBudgetBurn({
      kind: 'hours',
      budgetValue: 10,
      warnAtPercent: 80,
      totalMinutes: 900,
      cost: null,
    })
    expect(burn).toMatchObject({ percent: 150, barPercent: 100, tone: 'destructive' })
  })

  it('treats a missing cost as zero spend on an amount budget', () => {
    const burn = computeBudgetBurn({
      kind: 'amount',
      budgetValue: 5000,
      warnAtPercent: 80,
      totalMinutes: 120,
      cost: null,
    })
    expect(burn).toMatchObject({ percent: 0, tone: 'accent' })
  })
})
