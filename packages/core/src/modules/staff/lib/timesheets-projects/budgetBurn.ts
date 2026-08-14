export type ProjectBudgetKind = 'none' | 'hours' | 'amount'

export type BudgetBurnTone = 'accent' | 'warning' | 'destructive'

export type ProjectBudgetBurn = {
  kind: 'hours' | 'amount'
  budgetValue: number
  usedValue: number
  percent: number
  barPercent: number
  tone: BudgetBurnTone
}

export type BudgetBurnInput = {
  kind: ProjectBudgetKind | null | undefined
  budgetValue: number | null | undefined
  warnAtPercent: number | null | undefined
  totalMinutes: number
  cost: number | null
}

export const DEFAULT_BUDGET_WARN_AT_PERCENT = 80

function clampPercent(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0
  return Math.min(100, value)
}

export function resolveBudgetWarnAtPercent(warnAtPercent: number | null | undefined): number {
  if (typeof warnAtPercent !== 'number' || !Number.isFinite(warnAtPercent)) {
    return DEFAULT_BUDGET_WARN_AT_PERCENT
  }
  if (warnAtPercent <= 0 || warnAtPercent > 100) return DEFAULT_BUDGET_WARN_AT_PERCENT
  return warnAtPercent
}

export function computeBudgetBurn(input: BudgetBurnInput): ProjectBudgetBurn | null {
  const kind = input.kind
  if (kind !== 'hours' && kind !== 'amount') return null
  const budgetValue = typeof input.budgetValue === 'number' ? input.budgetValue : null
  if (budgetValue === null || !Number.isFinite(budgetValue) || budgetValue <= 0) return null

  const usedValue =
    kind === 'hours'
      ? Math.max(0, input.totalMinutes) / 60
      : Math.max(0, input.cost ?? 0)

  const percent = Math.round((usedValue / budgetValue) * 100)
  const warnAt = resolveBudgetWarnAtPercent(input.warnAtPercent)
  const tone: BudgetBurnTone = percent >= 100 ? 'destructive' : percent >= warnAt ? 'warning' : 'accent'

  return {
    kind,
    budgetValue,
    usedValue,
    percent,
    barPercent: clampPercent(percent),
    tone,
  }
}
