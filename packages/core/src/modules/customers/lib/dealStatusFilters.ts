import type { EntityManager } from '@mikro-orm/postgresql'
import type { CrudCtx } from '@open-mercato/shared/lib/crud/factory'
import { z } from 'zod'
import { expandDealStatusAliases, getDealStatusAliases, isClosedDealStatus, isWonDealStatus, isLostDealStatus, type DealStatusVocabulary } from './dealStatus'
import { resolveDealsOrganizationIds } from './dealsOrganizationScope'
import { NORMALIZED_DEAL_STATUS_SQL } from './dealStatusSql'

const statusRowsSchema = z.array(z.object({ status: z.string() }))

export async function resolveDealStatusFilterVocabulary(ctx: CrudCtx | undefined, vocabulary: DealStatusVocabulary): Promise<DealStatusVocabulary> {
  const tenantId = ctx?.organizationScope?.tenantId ?? ctx?.auth?.tenantId
  if (!ctx || !tenantId) return vocabulary
  const em = ctx.container.resolve<EntityManager>('em')
  const organizationIds = await resolveDealsOrganizationIds({
    em, tenantId, auth: ctx.auth ?? {}, scope: ctx.organizationScope ?? { filterIds: ctx.organizationIds ?? (ctx.auth?.orgId ? [ctx.auth.orgId] : []) },
  })
  const aliases = Array.from(new Set(getDealStatusAliases(vocabulary).terminal.map((value) => value.trim().toLowerCase())))
  const rows = statusRowsSchema.parse(await em.getConnection().execute(
    `SELECT DISTINCT status FROM customer_deals WHERE tenant_id = ? AND organization_id IN (${organizationIds.map(() => '?').join(',')}) AND deleted_at IS NULL AND ${NORMALIZED_DEAL_STATUS_SQL} IN (${aliases.map(() => '?').join(',')})`,
    [tenantId, ...organizationIds, ...aliases],
  ))
  return {
    won: [...vocabulary.won, ...rows.filter((row) => isWonDealStatus(row.status, vocabulary)).map((row) => row.status)],
    lost: [...vocabulary.lost, ...rows.filter((row) => isLostDealStatus(row.status, vocabulary)).map((row) => row.status)],
    closed: [...vocabulary.closed, ...rows.filter((row) => isClosedDealStatus(row.status, vocabulary) && !isWonDealStatus(row.status, vocabulary) && !isLostDealStatus(row.status, vocabulary)).map((row) => row.status)],
  }
}

export function buildDealStatusSqlFilter(values: string[], vocabulary: DealStatusVocabulary): { clause: string; params: string[] } {
  const terminal = values.filter((value) => isClosedDealStatus(value, vocabulary))
  const arbitrary = values.filter((value) => !isClosedDealStatus(value, vocabulary))
  const normalized = Array.from(new Set(expandDealStatusAliases(terminal, vocabulary).map((value) => value.trim().toLowerCase())))
  const exact = expandDealStatusAliases(arbitrary, vocabulary)
  const clauses: string[] = []
  const params: string[] = []
  if (normalized.length) {
    clauses.push(`${NORMALIZED_DEAL_STATUS_SQL} IN (${normalized.map(() => '?').join(',')})`)
    params.push(...normalized)
  }
  if (exact.length) {
    clauses.push(`status IN (${exact.map(() => '?').join(',')})`)
    params.push(...exact)
  }
  return { clause: clauses.length ? `(${clauses.join(' OR ')})` : 'FALSE', params }
}

export function expandDealStatusFilterLiteral(value: string, vocabulary: DealStatusVocabulary): string[] {
  if (!isClosedDealStatus(value, vocabulary)) return [value]
  const normalized = value.trim().toLowerCase()
  return Array.from(new Set([value, ...getDealStatusAliases(vocabulary).terminal.filter((alias) => alias.trim().toLowerCase() === normalized)]))
}

export function restoreDealStatusFilterVariants(filters: Record<string, unknown>, vocabulary: DealStatusVocabulary): void {
  const status = filters.status
  if (status && typeof status === 'object' && !Array.isArray(status)) {
    const operations = status as Record<string, unknown>
    for (const operator of ['$in', '$nin']) {
      const values = operations[operator]
      if (!Array.isArray(values)) continue
      operations[operator] = Array.from(new Set(values.flatMap((value) => typeof value === 'string' && isClosedDealStatus(value, vocabulary) ? expandDealStatusAliases([value], vocabulary) : [value])))
    }
  }
  for (const operator of ['$and', '$or', '$not']) {
    const value = filters[operator]
    for (const child of Array.isArray(value) ? value : [value]) {
      if (child && typeof child === 'object' && !Array.isArray(child)) restoreDealStatusFilterVariants(child as Record<string, unknown>, vocabulary)
    }
  }
}
