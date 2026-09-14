import { evaluateBudgetThreshold } from '../budgetThreshold'
import { summarizeProjectEntryGroups } from '../computeProjectFinancials'

const hoursBudget = {
  budgetKind: 'hours' as const,
  budgetValue: 100,
  budgetWarnAtPercent: 80,
  currencyCode: 'PLN',
  cost: null,
}

const amountBudget = {
  budgetKind: 'amount' as const,
  budgetValue: 1000,
  budgetWarnAtPercent: 80,
  currencyCode: 'PLN',
  totalMinutes: 0,
}

describe('evaluateBudgetThreshold — hours budgets', () => {
  it('stays silent under the warn threshold', () => {
    const result = evaluateBudgetThreshold({
      ...hoursBudget,
      budgetAlertedAtPercent: null,
      totalMinutes: 79 * 60,
    })

    expect(result.status).toBe('evaluated')
    expect(result.percent).toBe(79)
    expect(result.crossedThresholdPercent).toBeNull()
    expect(result.shouldPersistAlertedAt).toBe(false)
  })

  it('fires exactly at the warn threshold', () => {
    const result = evaluateBudgetThreshold({
      ...hoursBudget,
      budgetAlertedAtPercent: null,
      totalMinutes: 80 * 60,
    })

    expect(result.percent).toBe(80)
    expect(result.crossedThresholdPercent).toBe(80)
    expect(result.nextAlertedAtPercent).toBe(80)
    expect(result.shouldPersistAlertedAt).toBe(true)
  })

  it('does not fire the warn threshold a second time', () => {
    const result = evaluateBudgetThreshold({
      ...hoursBudget,
      budgetAlertedAtPercent: 80,
      totalMinutes: 95 * 60,
    })

    expect(result.percent).toBe(95)
    expect(result.crossedThresholdPercent).toBeNull()
    expect(result.nextAlertedAtPercent).toBe(80)
    expect(result.shouldPersistAlertedAt).toBe(false)
  })

  it('fires the full-budget threshold once the warn threshold is already recorded', () => {
    const result = evaluateBudgetThreshold({
      ...hoursBudget,
      budgetAlertedAtPercent: 80,
      totalMinutes: 100 * 60,
    })

    expect(result.crossedThresholdPercent).toBe(100)
    expect(result.nextAlertedAtPercent).toBe(100)
  })

  it('announces only the highest threshold when one write crosses both', () => {
    const result = evaluateBudgetThreshold({
      ...hoursBudget,
      budgetAlertedAtPercent: null,
      totalMinutes: 140 * 60,
    })

    expect(result.percent).toBe(140)
    expect(result.crossedThresholdPercent).toBe(100)
    expect(result.nextAlertedAtPercent).toBe(100)
  })

  it('stays silent once the full budget is already recorded', () => {
    const result = evaluateBudgetThreshold({
      ...hoursBudget,
      budgetAlertedAtPercent: 100,
      totalMinutes: 300 * 60,
    })

    expect(result.crossedThresholdPercent).toBeNull()
    expect(result.shouldPersistAlertedAt).toBe(false)
  })

  it('honours a custom warn threshold', () => {
    const result = evaluateBudgetThreshold({
      ...hoursBudget,
      budgetWarnAtPercent: 50,
      budgetAlertedAtPercent: null,
      totalMinutes: 50 * 60,
    })

    expect(result.crossedThresholdPercent).toBe(50)
  })

  it('falls back to the default warn threshold when the configured one is out of range', () => {
    const result = evaluateBudgetThreshold({
      ...hoursBudget,
      budgetWarnAtPercent: 0,
      budgetAlertedAtPercent: null,
      totalMinutes: 80 * 60,
    })

    expect(result.crossedThresholdPercent).toBe(80)
  })
})

describe('evaluateBudgetThreshold — marker reset', () => {
  it('clears the marker without notifying when usage drops under every threshold', () => {
    const result = evaluateBudgetThreshold({
      ...hoursBudget,
      budgetAlertedAtPercent: 100,
      totalMinutes: 40 * 60,
    })

    expect(result.crossedThresholdPercent).toBeNull()
    expect(result.nextAlertedAtPercent).toBeNull()
    expect(result.shouldPersistAlertedAt).toBe(true)
  })

  it('lowers the marker without notifying when usage falls from full budget back into the warn band', () => {
    const result = evaluateBudgetThreshold({
      ...hoursBudget,
      budgetAlertedAtPercent: 100,
      totalMinutes: 90 * 60,
    })

    expect(result.crossedThresholdPercent).toBeNull()
    expect(result.nextAlertedAtPercent).toBe(80)
    expect(result.shouldPersistAlertedAt).toBe(true)
  })

  it('notifies again when usage re-crosses a threshold after a reset', () => {
    const afterReset = evaluateBudgetThreshold({
      ...hoursBudget,
      budgetAlertedAtPercent: 80,
      totalMinutes: 10 * 60,
    })
    expect(afterReset.nextAlertedAtPercent).toBeNull()
    expect(afterReset.crossedThresholdPercent).toBeNull()

    const reCrossing = evaluateBudgetThreshold({
      ...hoursBudget,
      budgetAlertedAtPercent: afterReset.nextAlertedAtPercent,
      totalMinutes: 85 * 60,
    })
    expect(reCrossing.crossedThresholdPercent).toBe(80)
  })
})

describe('evaluateBudgetThreshold — disabled and unmeasurable budgets', () => {
  it('never notifies when the budget kind is none', () => {
    const result = evaluateBudgetThreshold({
      budgetKind: 'none',
      budgetValue: 100,
      budgetWarnAtPercent: 80,
      budgetAlertedAtPercent: null,
      totalMinutes: 10_000,
      cost: 10_000,
      currencyCode: 'PLN',
    })

    expect(result.status).toBe('disabled')
    expect(result.crossedThresholdPercent).toBeNull()
    expect(result.shouldPersistAlertedAt).toBe(false)
  })

  it('clears a stale marker left by a budget that was switched off', () => {
    const result = evaluateBudgetThreshold({
      budgetKind: 'none',
      budgetValue: null,
      budgetWarnAtPercent: 80,
      budgetAlertedAtPercent: 80,
      totalMinutes: 10_000,
      cost: null,
      currencyCode: 'PLN',
    })

    expect(result.status).toBe('disabled')
    expect(result.nextAlertedAtPercent).toBeNull()
    expect(result.shouldPersistAlertedAt).toBe(true)
  })

  it('treats a zero budget as no budget rather than dividing by it', () => {
    const result = evaluateBudgetThreshold({
      ...hoursBudget,
      budgetValue: 0,
      budgetAlertedAtPercent: null,
      totalMinutes: 60,
    })

    expect(result.status).toBe('disabled')
    expect(result.percent).toBeNull()
    expect(result.crossedThresholdPercent).toBeNull()
  })

  it('treats a null budget value as no budget', () => {
    const result = evaluateBudgetThreshold({
      ...hoursBudget,
      budgetValue: null,
      budgetAlertedAtPercent: null,
      totalMinutes: 10_000,
    })

    expect(result.status).toBe('disabled')
    expect(result.crossedThresholdPercent).toBeNull()
  })

  it('degrades quietly when an amount budget has no priced cost', () => {
    const result = evaluateBudgetThreshold({
      ...amountBudget,
      budgetAlertedAtPercent: 80,
      cost: null,
    })

    expect(result.status).toBe('unmeasurable')
    expect(result.crossedThresholdPercent).toBeNull()
    expect(result.nextAlertedAtPercent).toBe(80)
    expect(result.shouldPersistAlertedAt).toBe(false)
  })

  it('degrades quietly when an amount budget has no currency', () => {
    const result = evaluateBudgetThreshold({
      ...amountBudget,
      budgetAlertedAtPercent: null,
      currencyCode: null,
      cost: 5000,
    })

    expect(result.status).toBe('unmeasurable')
    expect(result.crossedThresholdPercent).toBeNull()
  })
})

describe('evaluateBudgetThreshold — amount budgets', () => {
  it('compares the priced cost against the budget', () => {
    const result = evaluateBudgetThreshold({
      ...amountBudget,
      budgetAlertedAtPercent: null,
      cost: 800,
    })

    expect(result.kind).toBe('amount')
    expect(result.percent).toBe(80)
    expect(result.crossedThresholdPercent).toBe(80)
  })

  it('ignores logged minutes for an amount budget', () => {
    const result = evaluateBudgetThreshold({
      ...amountBudget,
      budgetAlertedAtPercent: null,
      totalMinutes: 100_000,
      cost: 10,
    })

    expect(result.percent).toBe(1)
    expect(result.crossedThresholdPercent).toBeNull()
  })

  it('burns the budget at the cost of ROUNDED minutes, not of the raw duration', () => {
    const projectId = 'project-1'
    // One minute logged, billed as a full hour by the tenant's rounding rule.
    const totals = summarizeProjectEntryGroups(
      [
        {
          projectId,
          isBillable: true,
          rateOverrideAmount: null,
          billingMinutes: 60,
          rawMinutes: 1,
          entryCount: 1,
        },
      ],
      new Map([[projectId, 100]]),
      [projectId],
    ).get(projectId)

    expect(totals?.cost).toBe(100)

    const result = evaluateBudgetThreshold({
      budgetKind: 'amount',
      budgetValue: 120,
      budgetWarnAtPercent: 80,
      budgetAlertedAtPercent: null,
      totalMinutes: totals?.totalMinutes ?? 0,
      cost: totals?.cost ?? null,
      currencyCode: 'PLN',
    })

    // Pricing the raw minute instead would land at 1% and stay silent.
    expect(result.percent).toBe(83)
    expect(result.crossedThresholdPercent).toBe(80)
  })
})
