/**
 * @jest-environment node
 *
 * End-to-end guard for #4668: the widget's request only narrows the chart if every filter
 * survives the analytics layer. `buildAggregationQuery` silently skips a filter whose field
 * has no mapping (`if (!filterMapping) continue`), so a missing `closureOutcome` entry in
 * `customers/analytics.ts` would not fail the config test above — it would just quietly stop
 * excluding the closed deals again. These cases assert the resulting SQL instead.
 */
import { buildPipelineDataRequest } from '../config'
import { buildAggregationQuery } from '../../../../lib/aggregations'
import { createAnalyticsRegistry } from '../../../../services/analyticsRegistry'
import { analyticsConfig as customersAnalyticsConfig } from '../../../../../customers/analytics'

const registry = createAnalyticsRegistry([customersAnalyticsConfig])

function buildSqlFor(statusScope: 'open' | 'all'): string {
  const request = buildPipelineDataRequest({ dateRange: 'this_year', statusScope })
  const query = buildAggregationQuery({
    entityType: request.entityType,
    metric: request.metric,
    groupBy: request.groupBy ? { field: request.groupBy.field } : undefined,
    filters: request.filters,
    scope: { tenantId: 'tenant-1' },
    registry,
  })

  if (!query) throw new Error('[internal] the pipeline-summary request produced no aggregation query')
  return query.sql
}

describe('pipeline summary request against the analytics layer', () => {
  it('reaches SQL as a closure_outcome IS NULL predicate', () => {
    expect(buildSqlFor('open')).toContain('closure_outcome IS NULL')
  })

  it('never emits a closure_outcome comparison that NULL cannot satisfy', () => {
    const sql = buildSqlFor('open')

    expect(sql).not.toContain('closure_outcome !=')
    expect(sql).not.toContain('closure_outcome =')
  })

  it('keeps excluding the terminal statuses alongside it', () => {
    const sql = buildSqlFor('open')
    const statusComparisons = sql.match(/status != \?/g) ?? []

    expect(statusComparisons).toHaveLength(5)
  })

  it('narrows nothing beyond the tenant scope for the all scope', () => {
    const sql = buildSqlFor('all')

    expect(sql).not.toContain('closure_outcome')
    expect(sql).not.toContain('status != ?')
  })
})
