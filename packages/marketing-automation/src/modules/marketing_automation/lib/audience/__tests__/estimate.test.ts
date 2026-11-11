import type { EntityManager } from '@mikro-orm/postgresql'
import type { ConditionExpression } from '@open-mercato/core/modules/business_rules/lib/expression-evaluator'
import { estimateAudienceSize } from '../estimate'

const scope = { tenantId: 't1', organizationId: 'o1' }

const tagAudience = { field: 'tags', operator: 'CONTAINS', value: 'vip' } as ConditionExpression

function fakeEm(options: { rows: Array<Record<string, unknown>>; countResult: number }): EntityManager {
  return {
    getConnection: () => ({ execute: async () => options.rows }),
    count: async () => options.countResult,
  } as unknown as EntityManager
}

/**
 * This is the ONE function the audience-estimate API route and the `estimate_audience` AI tool both
 * call — before this existed each had its own copy and could silently disagree on the same audience.
 */
describe('estimateAudienceSize', () => {
  test('no audience reaches the whole live population, exactly', async () => {
    const em = fakeEm({ rows: [], countResult: 7 })
    const result = await estimateAudienceSize(em, scope, null, new Date())
    expect(result).toEqual({ count: 7, qualifier: 'exact', narrowing: 'all', candidates: null, queries: 0 })
  })

  test('a raw candidate count is not the answer: deleted or company rows are filtered out', async () => {
    const em = fakeEm({ rows: [{ entity_id: 'a' }, { entity_id: 'b' }], countResult: 1 })
    const result = await estimateAudienceSize(em, scope, tagAudience, new Date())
    // Two rows came back from the tag query, but only one survives the live-person check.
    expect(result.candidates).toBe(2)
    expect(result.count).toBe(1)
    expect(result.qualifier).toBe('exact')
  })

  test('above the verify limit the bound is reported unverified, never silently exact', async () => {
    const rows = Array.from({ length: 20_001 }, (_, index) => ({ entity_id: `id-${index}` }))
    const em = fakeEm({ rows, countResult: 0 })
    const result = await estimateAudienceSize(em, scope, tagAudience, new Date())
    expect(result.candidates).toBe(20_001)
    expect(result.count).toBe(20_001)
    expect(result.qualifier).toBe('atMost')
  })
})
