import { loadDailySeries } from '../daily-series'
import type { EntityManager } from '@mikro-orm/postgresql'

const scope = { tenantId: 't1', organizationId: 'o1' }
const window = { from: new Date('2026-09-01T00:00:00.000Z'), to: new Date('2026-09-07T00:00:00.000Z') }

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
  return { em: em as unknown as EntityManager, executed }
}

describe('loadDailySeries', () => {
  test('asks the database to generate the days, so gaps are zeroes rather than absences', async () => {
    const { em, executed } = fakeEm([])
    await loadDailySeries(em, 'camp-1', scope, window)
    const { sql, params } = executed[0]
    // A chart that skips empty days draws a line through them and implies activity that never happened.
    expect(sql).toContain('generate_series')
    expect(sql).toContain('left join sends')
    expect(sql).toContain('coalesce(sends.total, 0)')
    // Both bounds bound, then the campaign and scope once per metric.
    expect(params).toEqual([
      window.from, window.to,
      'camp-1', 't1', 'o1',
      'camp-1', 't1', 'o1',
      'camp-1', 't1', 'o1',
    ])
  })

  test('counts opens and clicks as unique runs, like every other report in the module', async () => {
    const { em, executed } = fakeEm([])
    await loadDailySeries(em, 'camp-1', scope, window)
    expect(executed[0].sql.match(/count\(distinct run_id\)/g)).toHaveLength(2)
  })

  test('returns a point per day with zeroes where nothing happened', async () => {
    const { em } = fakeEm([
      { date: '2026-09-01', sent: 10, opened: 4, clicked: 1 },
      { date: '2026-09-02', sent: 0, opened: 0, clicked: 0 },
    ])
    expect(await loadDailySeries(em, 'camp-1', scope, window)).toEqual([
      { date: '2026-09-01', sent: 10, opened: 4, clicked: 1 },
      { date: '2026-09-02', sent: 0, opened: 0, clicked: 0 },
    ])
  })

  test('a null from the database becomes a zero, never a gap in the line', async () => {
    /**
     * The quiet day sits AFTER an active one, deliberately.
     *
     * Leading silence is trimmed now — a campaign that started last Tuesday should not open with eighty-nine
     * days of flat line — so a fixture of nothing but nulls would be trimmed away and this would assert on an
     * empty array instead of on the coercion it exists to check.
     */
    const { em } = fakeEm([
      { date: '2026-09-01', sent: 4, opened: 2, clicked: 1 },
      { date: '2026-09-02', sent: null, opened: null, clicked: null },
    ])
    expect(await loadDailySeries(em, 'camp-1', scope, window)).toEqual([
      { date: '2026-09-01', sent: 4, opened: 2, clicked: 1 },
      { date: '2026-09-02', sent: 0, opened: 0, clicked: 0 },
    ])
  })
})
