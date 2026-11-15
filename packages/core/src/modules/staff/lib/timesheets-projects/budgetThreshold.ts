import {
  computeBudgetBurn,
  resolveBudgetWarnAtPercent,
  type ProjectBudgetKind,
} from './budgetBurn'

export const FULL_BUDGET_PERCENT = 100

/**
 * Outcome of comparing a project's usage against its budget.
 *
 * - `disabled` — the project has no measurable budget at all (`budget_kind: 'none'`,
 *   a null budget, or a budget of zero or less). Never notifies, and clears any
 *   marker left behind by a budget that has since been switched off.
 * - `unmeasurable` — the budget is an amount budget but the project cannot price its
 *   hours (no rate anywhere, or no currency). Degrades quietly: no notification and
 *   the marker is left untouched, because this is an inability to measure rather
 *   than usage genuinely dropping.
 * - `evaluated` — usage was compared against the thresholds.
 */
export type BudgetThresholdStatus = 'disabled' | 'unmeasurable' | 'evaluated'

export type BudgetThresholdInput = {
  budgetKind: ProjectBudgetKind | null | undefined
  budgetValue: number | null | undefined
  budgetWarnAtPercent: number | null | undefined
  budgetAlertedAtPercent: number | null | undefined
  totalMinutes: number
  cost: number | null
  currencyCode?: string | null
}

export type BudgetThresholdEvaluation = {
  status: BudgetThresholdStatus
  kind: 'hours' | 'amount' | null
  budgetValue: number | null
  usedValue: number | null
  percent: number | null
  /** The threshold to announce now, or null when nothing new was crossed. */
  crossedThresholdPercent: number | null
  /** The value `budget_alerted_at_percent` should hold after this write. */
  nextAlertedAtPercent: number | null
  shouldPersistAlertedAt: boolean
}

function normalizeAlertedAtPercent(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  const rounded = Math.round(value)
  if (rounded <= 0) return null
  return Math.min(rounded, FULL_BUDGET_PERCENT)
}

function hasBillingCurrency(currencyCode: string | null | undefined): boolean {
  return typeof currencyCode === 'string' && currencyCode.trim().length > 0
}

/**
 * Decides whether a budget threshold notification is due for a project.
 *
 * Two thresholds exist: the project's `budget_warn_at_percent` (80 by default) and
 * 100. A notification fires only on an UPWARD move into a threshold band that
 * `budget_alerted_at_percent` has not already recorded, so repeated writes at the
 * same usage level stay silent. When one write jumps past both thresholds, only the
 * highest one is announced — a single "budget exhausted" alert beats two alerts
 * describing the same write.
 *
 * The marker follows usage back down: when usage falls under the band it was raised
 * for (an entry deleted or corrected), the marker is lowered to the band usage is
 * actually in — null when it is under every threshold — so a later re-crossing
 * notifies again. Moving down never notifies.
 *
 * Percent is taken from `computeBudgetBurn` so the notification and the burn bar on
 * screens 3 and 4 can never disagree about whether the project is at 80%.
 */
export function evaluateBudgetThreshold(input: BudgetThresholdInput): BudgetThresholdEvaluation {
  const alertedAtPercent = normalizeAlertedAtPercent(input.budgetAlertedAtPercent)

  const burn = computeBudgetBurn({
    kind: input.budgetKind,
    budgetValue: input.budgetValue,
    warnAtPercent: input.budgetWarnAtPercent,
    totalMinutes: input.totalMinutes,
    cost: input.cost,
  })

  if (!burn) {
    return {
      status: 'disabled',
      kind: null,
      budgetValue: null,
      usedValue: null,
      percent: null,
      crossedThresholdPercent: null,
      nextAlertedAtPercent: null,
      shouldPersistAlertedAt: alertedAtPercent !== null,
    }
  }

  if (burn.kind === 'amount' && (input.cost === null || input.cost === undefined || !hasBillingCurrency(input.currencyCode))) {
    return {
      status: 'unmeasurable',
      kind: burn.kind,
      budgetValue: burn.budgetValue,
      usedValue: null,
      percent: null,
      crossedThresholdPercent: null,
      nextAlertedAtPercent: alertedAtPercent,
      shouldPersistAlertedAt: false,
    }
  }

  const warnAtPercent = resolveBudgetWarnAtPercent(input.budgetWarnAtPercent)
  const reachedThresholdPercent =
    burn.percent >= FULL_BUDGET_PERCENT
      ? FULL_BUDGET_PERCENT
      : burn.percent >= warnAtPercent
        ? warnAtPercent
        : null

  const crossedThresholdPercent =
    reachedThresholdPercent !== null && (alertedAtPercent === null || reachedThresholdPercent > alertedAtPercent)
      ? reachedThresholdPercent
      : null

  return {
    status: 'evaluated',
    kind: burn.kind,
    budgetValue: burn.budgetValue,
    usedValue: burn.usedValue,
    percent: burn.percent,
    crossedThresholdPercent,
    nextAlertedAtPercent: reachedThresholdPercent,
    shouldPersistAlertedAt: reachedThresholdPercent !== alertedAtPercent,
  }
}
