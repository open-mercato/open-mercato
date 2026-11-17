import type { CustomerKysely } from '../kysely'
import { fetchOpenActivityCounts } from '../dealsTimelineActivities'

type WhereCall = [string, string, unknown]

function fakeDb(rows: Array<{ deal_id: string | null; count: number | string }>) {
  const wheres: WhereCall[] = []
  const groupBys: string[] = []
  let executed = 0
  const builder = {
    select: () => builder,
    where: (column: string, operator: string, value: unknown) => {
      wheres.push([column, operator, value])
      return builder
    },
    groupBy: (column: string) => {
      groupBys.push(column)
      return builder
    },
    execute: async () => {
      executed += 1
      return rows
    },
  }
  const db = { selectFrom: (table: string) => (table === 'customer_interactions' ? builder : null) }
  return { db: db as unknown as CustomerKysely, wheres, groupBys, executions: () => executed }
}

describe('fetchOpenActivityCounts', () => {
  it('counts open interactions for all deals in one grouped, tenant and organization scoped query', async () => {
    const harness = fakeDb([
      { deal_id: 'deal-1', count: '2' },
      { deal_id: 'deal-2', count: 1 },
      { deal_id: null, count: 4 },
    ])
    const counts = await fetchOpenActivityCounts(harness.db, ['deal-1', 'deal-2', 'deal-3'], {
      tenantId: 'tenant-1',
      organizationIds: ['org-1', 'org-2'],
    })
    expect(harness.executions()).toBe(1)
    expect(harness.groupBys).toEqual(['deal_id'])
    expect(harness.wheres).toEqual(
      expect.arrayContaining([
        ['deal_id', 'in', ['deal-1', 'deal-2', 'deal-3']],
        ['tenant_id', '=', 'tenant-1'],
        ['deleted_at', 'is', null],
        ['status', 'not in', ['done', 'canceled', 'completed']],
        ['organization_id', 'in', ['org-1', 'org-2']],
      ]),
    )
    expect(Array.from(counts.entries())).toEqual([
      ['deal-1', 2],
      ['deal-2', 1],
    ])
  })

  it('skips the organization filter for an unrestricted scope and runs nothing without deals', async () => {
    const harness = fakeDb([])
    await fetchOpenActivityCounts(harness.db, ['deal-1'], { tenantId: 'tenant-1', organizationIds: undefined })
    expect(harness.wheres.some(([column]) => column === 'organization_id')).toBe(false)
    const empty = fakeDb([])
    expect((await fetchOpenActivityCounts(empty.db, [], { tenantId: 'tenant-1', organizationIds: undefined })).size).toBe(0)
    expect(empty.executions()).toBe(0)
  })

  it('returns no counts for an empty organization list', async () => {
    const harness = fakeDb([{ deal_id: 'deal-1', count: 3 }])
    const counts = await fetchOpenActivityCounts(harness.db, ['deal-1'], { tenantId: 'tenant-1', organizationIds: [] })
    expect(counts.size).toBe(0)
    expect(harness.executions()).toBe(0)
  })
})
