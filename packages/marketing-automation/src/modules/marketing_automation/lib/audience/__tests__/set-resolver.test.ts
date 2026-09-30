import { createSqlCandidateSource, MAX_CANDIDATE_SET, resolveCandidates, CANDIDATE_ROW_CEILING } from '../set-resolver'
import type { CandidateSource } from '../set-resolver'
import { planNarrowing } from '../../engine/narrowing'
import type { ComparisonOp, OrderMetric } from '../../engine/narrowing'
import type { ConditionExpression } from '@open-mercato/core/modules/business_rules/lib/expression-evaluator'

const leaf = (field: string, operator: string, value?: unknown): ConditionExpression =>
  ({ field, operator, value } as ConditionExpression)
const group = (operator: 'AND' | 'OR' | 'NOT', rules: ConditionExpression[]): ConditionExpression =>
  ({ operator, rules } as ConditionExpression)

function fakeSource(data: {
  tags?: Record<string, string[]>
  orders?: Record<string, string[]>
  scores?: Record<string, string[]>
  skus?: Record<string, string[]>
  channels?: Record<string, string[]>
  nps?: Record<string, string[]>
}): CandidateSource & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    async tagMembers(slug) {
      calls.push(`tag:${slug ?? '*'}`)
      if (slug === null) return Object.values(data.tags ?? {}).flat()
      return data.tags?.[slug] ?? []
    },
    async orderMetricMembers(metric: OrderMetric, op: ComparisonOp, value: number) {
      const key = `${metric}${op}${value}`
      calls.push(`orders:${key}`)
      return data.orders?.[key] ?? []
    },
    async scoreMembers(op: ComparisonOp, value: number) {
      const key = `${op}${value}`
      calls.push(`score:${key}`)
      return data.scores?.[key] ?? []
    },
    async purchasedSkuMembers(sku: string) {
      calls.push(`sku:${sku}`)
      return data.skus?.[sku] ?? []
    },
    async purchasedInChannelMembers(code: string) {
      calls.push(`channel:${code}`)
      return data.channels?.[code] ?? []
    },
    async npsMembers(op: ComparisonOp, value: number) {
      const key = `${op}${value}`
      calls.push(`nps:${key}`)
      return data.nps?.[key] ?? []
    },
  }
}

describe('resolveCandidates', () => {
  test('an unconstrained plan asks nothing and returns no narrowing', async () => {
    const source = fakeSource({})
    const result = await resolveCandidates(planNarrowing(null).narrowing, source)
    expect(result.ids).toBeNull()
    expect(result.queries).toBe(0)
    expect(source.calls).toEqual([])
  })

  test('an impossible plan returns an empty set without querying', async () => {
    const source = fakeSource({})
    const result = await resolveCandidates(planNarrowing(group('AND', [])).narrowing, source)
    expect(result.ids).toEqual([])
    expect(source.calls).toEqual([])
  })

  test('a single predicate returns its members, sorted for stable paging', async () => {
    const source = fakeSource({ tags: { vip: ['c3', 'c1', 'c2'] } })
    const result = await resolveCandidates(planNarrowing(leaf('tags', 'CONTAINS', 'vip')).narrowing, source)
    expect(result.ids).toEqual(['c1', 'c2', 'c3'])
  })

  test('AND intersects', async () => {
    const source = fakeSource({
      tags: { vip: ['c1', 'c2', 'c3'] },
      orders: { 'totalGross>=100': ['c2', 'c3', 'c4'] },
    })
    const plan = planNarrowing(group('AND', [
      leaf('tags', 'CONTAINS', 'vip'),
      leaf('orders.totalGross', '>=', 100),
    ]))
    expect((await resolveCandidates(plan.narrowing, source)).ids).toEqual(['c2', 'c3'])
  })

  // The intersection is where being too tight would hurt most, so a part the database could not
  // answer must drop out of the intersection rather than empty it.
  test('an unconstrained part does not empty an intersection', async () => {
    const source = fakeSource({ tags: { vip: ['c1'] } })
    const plan = planNarrowing(group('AND', [
      leaf('tags', 'CONTAINS', 'vip'),
      leaf('trigger.source', '=', 'newsletter'),
    ]))
    expect((await resolveCandidates(plan.narrowing, source)).ids).toEqual(['c1'])
  })

  test('OR unions', async () => {
    const source = fakeSource({
      tags: { vip: ['c1'] },
      orders: { 'totalGross>=1000': ['c9'] },
    })
    const plan = planNarrowing(group('OR', [
      leaf('tags', 'CONTAINS', 'vip'),
      leaf('orders.totalGross', '>=', 1000),
    ]))
    expect((await resolveCandidates(plan.narrowing, source)).ids).toEqual(['c1', 'c9'])
  })

  test('stops querying once an intersection is empty', async () => {
    const source = fakeSource({ tags: { vip: [] }, orders: { 'count>=1': ['c1'] } })
    const plan = planNarrowing(group('AND', [
      leaf('tags', 'CONTAINS', 'vip'),
      leaf('orders.count', '>=', 1),
    ]))
    const result = await resolveCandidates(plan.narrowing, source)
    expect(result.ids).toEqual([])
    expect(source.calls).toEqual(['tag:vip'])
  })

  test('abandons a set that exceeds the cap, falling back to the whole population', async () => {
    const many = Array.from({ length: 12 }, (_, index) => `c${index}`)
    const source = fakeSource({ tags: { vip: many } })
    const result = await resolveCandidates(
      planNarrowing(leaf('tags', 'CONTAINS', 'vip')).narrowing,
      source,
      { maxCandidateSet: 10 },
    )
    expect(result.ids).toBeNull()
    expect(result.abandoned).toBe(true)
  })

  test('an abandoned part still lets the other parts narrow', async () => {
    const many = Array.from({ length: 12 }, (_, index) => `c${index}`)
    const source = fakeSource({ tags: { vip: many }, orders: { 'count>=2': ['c3', 'c4'] } })
    const plan = planNarrowing(group('AND', [
      leaf('tags', 'CONTAINS', 'vip'),
      leaf('orders.count', '>=', 2),
    ]))
    const result = await resolveCandidates(plan.narrowing, source, { maxCandidateSet: 10 })
    expect(result.ids).toEqual(['c3', 'c4'])
    expect(result.abandoned).toBe(true)
  })

  test('an abandoned branch makes a union unbounded, never a subset of the others', async () => {
    const many = Array.from({ length: 12 }, (_, index) => `c${index}`)
    const source = fakeSource({ tags: { vip: many }, orders: { 'totalGross>=1000': ['c99'] } })
    const plan = planNarrowing(group('OR', [
      leaf('tags', 'CONTAINS', 'vip'),
      leaf('orders.totalGross', '>=', 1000),
    ]))
    const result = await resolveCandidates(plan.narrowing, source, { maxCandidateSet: 10 })
    expect(result.ids).toBeNull()
    expect(result.abandoned).toBe(true)
  })

  test('a score predicate resolves through the ledger', async () => {
    const source = fakeSource({ scores: { '>=100': ['c7', 'c1'] } })
    const plan = planNarrowing(leaf('score.points', '>=', 100))
    expect((await resolveCandidates(plan.narrowing, source)).ids).toEqual(['c1', 'c7'])
    expect(source.calls).toEqual(['score:>=100'])
  })

  test('a score predicate intersects with a tag one', async () => {
    const source = fakeSource({ tags: { vip: ['c1', 'c2'] }, scores: { '>=50': ['c2', 'c3'] } })
    const plan = planNarrowing(group('AND', [
      leaf('tags', 'CONTAINS', 'vip'),
      leaf('score.points', '>=', 50),
    ]))
    expect((await resolveCandidates(plan.narrowing, source)).ids).toEqual(['c2'])
  })

  test('a purchased-SKU predicate resolves through the order lines', async () => {
    const source = fakeSource({ skus: { 'ATLAS-RUNNER': ['c2', 'c1'] } })
    const plan = planNarrowing(leaf('orders.skus', 'CONTAINS', 'ATLAS-RUNNER'))
    expect((await resolveCandidates(plan.narrowing, source)).ids).toEqual(['c1', 'c2'])
    expect(source.calls).toEqual(['sku:ATLAS-RUNNER'])
  })

  test('the default cap is high enough to be a safety net, not a policy', () => {
    expect(MAX_CANDIDATE_SET).toBeGreaterThanOrEqual(100_000)
  })
})

describe('createSqlCandidateSource', () => {
  const scope = { tenantId: 't1', organizationId: 'o1' }
  const now = new Date('2026-09-28T12:00:00.000Z')

  function fakeEm(rows: unknown[]) {
    const executed: Array<{ sql: string; params: unknown[] }> = []
    const em = {
      getConnection: () => ({
        execute: async (sql: string, params: unknown[]) => {
          executed.push({ sql, params })
          return rows
        },
      }),
    }
    return { em: em as never, executed }
  }

  test('scopes the tag query by tenant and organization, and binds the slug', async () => {
    const { em, executed } = fakeEm([{ entity_id: 'c1' }])
    const source = createSqlCandidateSource(em, scope, now)
    expect(await source.tagMembers('vip')).toEqual(['c1'])
    expect(executed[0].params).toEqual(['t1', 'o1', 'vip', CANDIDATE_ROW_CEILING])
    expect(executed[0].sql).toContain('a.tenant_id = ?')
    expect(executed[0].sql).toContain('t.slug = ?')
    /**
     * Bounded in SQL, not in JavaScript.
     *
     * The cap used to be checked on the array AFTER it arrived, so a tag matching five million customers was
     * fetched in full and then discarded for being too large. One row more than the cap is fetched so the
     * existing `rows.length > maxSet` overflow test stays exact at the boundary.
     */
    expect(executed[0].sql).toContain('limit ?')
    expect(executed[0].params.at(-1)).toBe(CANDIDATE_ROW_CEILING)
  })

  test('asking for any tag omits the slug clause rather than binding a wildcard', async () => {
    const { em, executed } = fakeEm([])
    await createSqlCandidateSource(em, scope, now).tagMembers(null)
    expect(executed[0].params).toEqual(['t1', 'o1', CANDIDATE_ROW_CEILING])
    expect(executed[0].sql).not.toContain('t.slug')
  })

  test('aggregates over the same orders the subject document counts', async () => {
    const { em, executed } = fakeEm([{ customer_entity_id: 'c1' }])
    await createSqlCandidateSource(em, scope, now).orderMetricMembers('count', '>=', 2)
    const { sql, params } = executed[0]
    // The shared filter, so a candidate's aggregate cannot disagree with the one used to match.
    expect(sql).toContain("status not in ('canceled', 'cancelled')")
    expect(sql).toContain('placed_at is not null')
    expect(sql).toContain('group by customer_entity_id')
    expect(sql).toContain('having count(*) >= ?')
    expect(params).toEqual(['t1', 'o1', 2, CANDIDATE_ROW_CEILING])
  })

  test('money comparisons sum the gross total', async () => {
    const { em, executed } = fakeEm([])
    await createSqlCandidateSource(em, scope, now).orderMetricMembers('totalGross', '>', 99.5)
    expect(executed[0].sql).toContain('coalesce(sum(grand_total_gross_amount), 0) > ?')
    expect(executed[0].params).toEqual(['t1', 'o1', 99.5, CANDIDATE_ROW_CEILING])
  })

  test('an NPS comparison reads only each subject LATEST answer', async () => {
    const { em, executed } = fakeEm([{ subject_entity_id: 'c1' }])
    expect(await createSqlCandidateSource(em, scope, now).npsMembers('<=', 6)).toEqual(['c1'])
    const { sql, params } = executed[0]
    // A customer who scored 3 last year and 9 last week is a promoter; matching the old answer would target
    // them for a feeling they no longer have.
    expect(sql).toContain('distinct on (subject_entity_id)')
    expect(sql).toContain('order by subject_entity_id, answered_at desc')
    expect(sql).toContain('score is not null')
    expect(params).toEqual(['t1', 'o1', 6, CANDIDATE_ROW_CEILING])
  })

  test('a purchased channel joins orders to channels, scoped, with the code bound', async () => {
    const { em, executed } = fakeEm([{ customer_entity_id: 'c9' }])
    expect(await createSqlCandidateSource(em, scope, now).purchasedInChannelMembers('web')).toEqual(['c9'])
    const { sql, params } = executed[0]
    expect(sql).toContain('sales_channels')
    // The CODE, not an id: an audience is authored against something a person can read and recognise.
    expect(params).toEqual(['t1', 'o1', 'web', CANDIDATE_ROW_CEILING])
  })

  test('a purchased SKU reads the catalogue snapshot, scoped, with the sku bound', async () => {
    const { em, executed } = fakeEm([{ customer_entity_id: 'c1' }])
    expect(await createSqlCandidateSource(em, scope, now).purchasedSkuMembers('ATLAS-RUNNER')).toEqual(['c1'])
    const { sql, params } = executed[0]
    // The snapshot, not the catalogue: a renamed or deleted product must still target its buyers.
    expect(sql).toContain("catalog_snapshot -> 'product' ->> 'sku'")
    expect(sql).toContain("catalog_snapshot -> 'variant' ->> 'sku'")
    expect(sql).toContain("o.status not in ('canceled', 'cancelled')")
    expect(params).toEqual(['t1', 'o1', 'ATLAS-RUNNER', CANDIDATE_ROW_CEILING])
  })

  test('a score comparison sums the ledger, scoped, with the operator from the fixed table', async () => {
    const { em, executed } = fakeEm([{ subject_entity_id: 'c1' }])
    expect(await createSqlCandidateSource(em, scope, now).scoreMembers('>=', 100)).toEqual(['c1'])
    const { sql, params } = executed[0]
    expect(sql).toContain('from marketing_customer_score_entries')
    expect(sql).toContain('group by subject_entity_id')
    expect(sql).toContain('having coalesce(sum(points), 0) >= ?')
    expect(params).toEqual(['t1', 'o1', 100, CANDIDATE_ROW_CEILING])
  })

  test('recency becomes a widened bound on the newest order', async () => {
    const { em, executed } = fakeEm([])
    await createSqlCandidateSource(em, scope, now).orderMetricMembers('daysSinceLast', '>=', 90)
    expect(executed[0].sql).toContain('having max(placed_at) <= ?')
    // 89 days, not 90: the bound is widened so a customer on the boundary is still a candidate.
    expect(executed[0].params[2]).toEqual(new Date('2026-07-01T12:00:00.000Z'))
  })

  test('an equality on recency becomes a two-sided window', async () => {
    const { em, executed } = fakeEm([])
    await createSqlCandidateSource(em, scope, now).orderMetricMembers('daysSinceLast', '=', 45)
    expect(executed[0].sql).toContain('max(placed_at) <= ?')
    expect(executed[0].sql).toContain('max(placed_at) >= ?')
    // Four binds for the window, plus the row ceiling every candidate statement carries.
    expect(executed[0].params).toHaveLength(5)
    expect(executed[0].params.at(-1)).toBe(CANDIDATE_ROW_CEILING)
  })

  // The operator cannot be a bound parameter, so it must come from a fixed table.
  test('only mapped comparison operators reach the SQL', async () => {
    const { em, executed } = fakeEm([])
    const source = createSqlCandidateSource(em, scope, now)
    for (const op of ['=', '>', '>=', '<', '<='] as ComparisonOp[]) {
      await source.orderMetricMembers('count', op, 1)
    }
    for (const entry of executed) {
      expect(entry.sql).toMatch(/having count\(\*\) (=|>|>=|<|<=) \?$/m)
    }
  })
})

describe('channel membership', () => {
  test('a channel audience narrows to the customers who bought through it', async () => {
    const source = fakeSource({ channels: { retail: ['c1', 'c2'] } })
    const plan = planNarrowing({
      operator: 'AND',
      rules: [{ field: 'orders.channels', operator: 'CONTAINS', value: 'retail' }],
    } as never)
    const resolution = await resolveCandidates(plan.narrowing, source)
    expect(resolution.ids).toEqual(['c1', 'c2'])
    expect(source.calls).toEqual(['channel:retail'])
  })

  test('a negative channel condition is not pushed down', async () => {
    // "Has never bought in this channel" cannot be produced as a superset without listing everybody first.
    const plan = planNarrowing({
      operator: 'AND',
      rules: [{ field: 'orders.channels', operator: 'NOT_CONTAINS', value: 'retail' }],
    } as never)
    expect(plan.narrowing.kind).toBe('all')
    expect(plan.complete).toBe(false)
  })
})
