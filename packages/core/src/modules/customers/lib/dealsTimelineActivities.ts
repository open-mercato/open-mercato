import type { CustomerKysely } from './kysely'
import { TERMINAL_INTERACTION_STATUS_LIST } from './interactionStatus'

export type DealTimelineActivityScope = {
  tenantId: string
  organizationIds: string[] | undefined
}

/**
 * Counts open (non-terminal) interactions per deal in one grouped query, with the same
 * definition the deals `_pipeline` enricher uses for `openActivitiesCount`. Deals without
 * open interactions are absent from the map; callers read them as `0`.
 */
export async function fetchOpenActivityCounts(
  db: CustomerKysely,
  dealIds: string[],
  scope: DealTimelineActivityScope,
): Promise<Map<string, number>> {
  const counts = new Map<string, number>()
  if (!dealIds.length) return counts
  let query = db
    .selectFrom('customer_interactions')
    .select(['deal_id'])
    .select((eb) => eb.fn.countAll().as('count'))
    .where('deal_id', 'in', dealIds)
    .where('tenant_id', '=', scope.tenantId)
    .where('deleted_at', 'is', null)
    .where('status', 'not in', [...TERMINAL_INTERACTION_STATUS_LIST])
  if (scope.organizationIds) {
    if (!scope.organizationIds.length) return counts
    query = query.where('organization_id', 'in', scope.organizationIds)
  }
  const rows = await query.groupBy('deal_id').execute()
  for (const row of rows) {
    if (row.deal_id == null) continue
    const count = typeof row.count === 'number' ? row.count : Number(row.count)
    if (Number.isFinite(count)) counts.set(row.deal_id, count)
  }
  return counts
}
