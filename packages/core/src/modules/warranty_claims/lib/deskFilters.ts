import { sql, type SelectQueryBuilder } from 'kysely'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { Where } from '@open-mercato/shared/lib/query/types'
import { mergeIdFilter } from '@open-mercato/shared/lib/crud/ids'

export const SLA_AT_RISK_EXCLUDED_STATUSES = ['resolved', 'closed', 'rejected', 'cancelled', 'draft'] as const
export const SLA_AT_RISK_MATCH_LIMIT = 500
export const SLA_AT_RISK_DEFAULT_THRESHOLD_PCT = 75

export const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

const CLAIM_ID_NO_MATCH_FILTER = { $eq: '00000000-0000-0000-0000-000000000000' }

export type WarrantyClaimsSlaTable = {
  id: string
  tenant_id: string
  organization_id: string
  status: string
  deleted_at: Date | null
  sla_due_at: Date | null
  sla_paused_at: Date | null
  submitted_at: Date | null
}

export type WarrantyClaimsSlaDb = {
  warranty_claims: WarrantyClaimsSlaTable
}

export type SlaAtRiskLookupScope = {
  tenantId: string
  selectedOrganizationId: string | null
  visibleOrganizationIds: string[] | null
}

export function normalizeSlaAtRiskThresholdPct(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return SLA_AT_RISK_DEFAULT_THRESHOLD_PCT
  return Math.min(Math.max(parsed, 0), 100)
}

export function applySlaAtRiskConditions<O>(
  query: SelectQueryBuilder<WarrantyClaimsSlaDb, 'warranty_claims', O>,
  thresholdPct: number,
  now: Date,
): SelectQueryBuilder<WarrantyClaimsSlaDb, 'warranty_claims', O> {
  const pct = normalizeSlaAtRiskThresholdPct(thresholdPct)
  return query
    .where('sla_due_at', '>', now)
    .where('sla_paused_at', 'is', null)
    .where('status', 'not in', [...SLA_AT_RISK_EXCLUDED_STATUSES])
    .where('submitted_at', 'is not', null)
    .where(sql<boolean>`sla_due_at > submitted_at`)
    .where(sql<boolean>`extract(epoch from (${now}::timestamptz - submitted_at)) * 100 >= extract(epoch from (sla_due_at - submitted_at)) * ${pct}`)
}

export async function findSlaAtRiskClaimIds(
  em: EntityManager,
  scope: SlaAtRiskLookupScope,
  thresholdPct: number,
  now: Date = new Date(),
): Promise<string[]> {
  const db = em.getKysely<WarrantyClaimsSlaDb>()
  let query = applySlaAtRiskConditions(
    db
      .selectFrom('warranty_claims')
      .select('id')
      .where('tenant_id', '=', scope.tenantId)
      .where('deleted_at', 'is', null),
    thresholdPct,
    now,
  )
  if (scope.selectedOrganizationId) {
    query = query.where('organization_id', '=', scope.selectedOrganizationId)
  } else if (scope.visibleOrganizationIds && scope.visibleOrganizationIds.length) {
    query = query.where('organization_id', 'in', scope.visibleOrganizationIds)
  }
  const rows = await query.limit(SLA_AT_RISK_MATCH_LIMIT).execute()
  return rows.map((row) => row.id)
}

export function narrowFiltersToClaimIds(filters: Record<string, unknown>, claimIds: string[]): void {
  if (!claimIds.length) {
    filters.id = { ...CLAIM_ID_NO_MATCH_FILTER }
    return
  }
  const merged = mergeIdFilter(filters as Where<Record<string, unknown>>, claimIds) as Record<string, unknown>
  const mergedId = merged.id
  const mergedIn = mergedId && typeof mergedId === 'object' && !Array.isArray(mergedId)
    ? (mergedId as Record<string, unknown>).$in
    : undefined
  if (Array.isArray(mergedIn) && mergedIn.length === 0) {
    filters.id = { ...CLAIM_ID_NO_MATCH_FILTER }
    return
  }
  filters.id = mergedId ?? { $in: claimIds }
}

function parseIsoDateBoundary(value: string, boundary: 'start' | 'end'): Date | null {
  if (!ISO_DATE_PATTERN.test(value)) return null
  const suffix = boundary === 'start' ? 'T00:00:00.000Z' : 'T23:59:59.999Z'
  const parsed = new Date(`${value}${suffix}`)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.toISOString().slice(0, 10) === value ? parsed : null
}

export function buildDateRangeFilter(
  from: string | undefined,
  to: string | undefined,
): Record<string, Date> | null {
  const range: Record<string, Date> = {}
  const fromDate = from ? parseIsoDateBoundary(from, 'start') : null
  const toDate = to ? parseIsoDateBoundary(to, 'end') : null
  if (fromDate) range.$gte = fromDate
  if (toDate) range.$lte = toDate
  return Object.keys(range).length ? range : null
}
