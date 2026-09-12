import type { EntityManager } from '@mikro-orm/postgresql'
import type { ProjectBudgetKind } from './budgetBurn'

export type TimeProjectBudgetState = {
  timeProjectId: string
  name: string
  ownerUserId: string | null
  budgetKind: ProjectBudgetKind
  budgetValue: number | null
  budgetWarnAtPercent: number | null
  budgetAlertedAtPercent: number | null
  hourlyRate: number | null
  currencyCode: string | null
}

export type TimeProjectBudgetScope = {
  em: EntityManager
  tenantId: string
  organizationId: string
}

type BudgetStateRow = {
  time_project_id: string
  name: string | null
  owner_user_id: string | null
  budget_kind: string | null
  budget_value: string | number | null
  budget_warn_at_percent: string | number | null
  budget_alerted_at_percent: string | number | null
  hourly_rate: string | number | null
  currency_code: string | null
}

const BUDGET_KINDS: readonly ProjectBudgetKind[] = ['none', 'hours', 'amount']

function toNullableNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function toBudgetKind(value: string | null | undefined): ProjectBudgetKind {
  return BUDGET_KINDS.find((kind) => kind === value) ?? 'none'
}

/**
 * Loads the budget state of the project a time entry belongs to, in one scoped
 * round trip. The entry is looked up without a `deleted_at` filter on purpose: a
 * delete is exactly the write that can push usage back under a threshold, and the
 * soft-deleted row is still what tells us which project to re-evaluate.
 */
export async function loadTimeProjectBudgetStateForEntry(
  scope: TimeProjectBudgetScope & { timeEntryId: string },
): Promise<TimeProjectBudgetState | null> {
  const sql = `
    SELECT
      project.id AS time_project_id,
      project.name AS name,
      project.owner_user_id AS owner_user_id,
      project.budget_kind AS budget_kind,
      project.budget_value AS budget_value,
      project.budget_warn_at_percent AS budget_warn_at_percent,
      project.budget_alerted_at_percent AS budget_alerted_at_percent,
      project.hourly_rate AS hourly_rate,
      project.currency_code AS currency_code
    FROM staff_time_entries entry
    JOIN staff_time_projects project
      ON project.id = entry.time_project_id
      AND project.tenant_id = entry.tenant_id
      AND project.organization_id = entry.organization_id
      AND project.deleted_at IS NULL
    WHERE entry.id = ?
      AND entry.tenant_id = ?
      AND entry.organization_id = ?
    LIMIT 1
  `

  const result = await scope.em.getConnection().execute(sql, [
    scope.timeEntryId,
    scope.tenantId,
    scope.organizationId,
  ])
  const rows = (Array.isArray(result) ? result : []) as BudgetStateRow[]
  const row = rows[0]
  if (!row) return null

  return {
    timeProjectId: row.time_project_id,
    name: row.name ?? '',
    ownerUserId: row.owner_user_id ?? null,
    budgetKind: toBudgetKind(row.budget_kind),
    budgetValue: toNullableNumber(row.budget_value),
    budgetWarnAtPercent: toNullableNumber(row.budget_warn_at_percent),
    budgetAlertedAtPercent: toNullableNumber(row.budget_alerted_at_percent),
    hourlyRate: toNullableNumber(row.hourly_rate),
    currencyCode: row.currency_code ?? null,
  }
}

/**
 * Compare-and-swap on `budget_alerted_at_percent`, the column that makes the budget
 * notification idempotent. Returns true only for the caller that actually moved the
 * marker, so two concurrent entry writes crossing the same threshold produce one
 * notification rather than two.
 *
 * `updated_at` is deliberately left alone: the marker is platform bookkeeping, not a
 * user edit, and bumping the optimistic-lock version here would make an unrelated
 * open project form fail to save with a spurious 409.
 */
export async function claimBudgetThresholdAlert(
  scope: TimeProjectBudgetScope & {
    timeProjectId: string
    expectedAlertedAtPercent: number | null
    nextAlertedAtPercent: number | null
  },
): Promise<boolean> {
  const sql = `
    UPDATE staff_time_projects
    SET budget_alerted_at_percent = ?
    WHERE id = ?
      AND tenant_id = ?
      AND organization_id = ?
      AND deleted_at IS NULL
      AND budget_alerted_at_percent IS NOT DISTINCT FROM ?
    RETURNING id
  `

  const result = await scope.em.getConnection().execute(sql, [
    scope.nextAlertedAtPercent,
    scope.timeProjectId,
    scope.tenantId,
    scope.organizationId,
    scope.expectedAlertedAtPercent,
  ])
  const rows = (Array.isArray(result) ? result : []) as Array<{ id: string }>
  return rows.length > 0
}
