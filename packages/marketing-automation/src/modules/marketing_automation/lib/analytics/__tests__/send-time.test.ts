import { loadPreferredSendHour, MINIMUM_OPENS_FOR_PATTERN, pickPreferredHour } from '../send-time'
import type { EntityManager } from '@mikro-orm/postgresql'

describe('pickPreferredHour', () => {
  test('picks the hour with the most opens', () => {
    expect(pickPreferredHour([{ hour: 7, opens: 2 }, { hour: 19, opens: 6 }])).toBe(19)
  })

  // Two opens at 3am would otherwise schedule every future send for 3am.
  test('refuses a pattern below the minimum evidence', () => {
    expect(pickPreferredHour([{ hour: 3, opens: 2 }])).toBeNull()
    expect(pickPreferredHour([{ hour: 3, opens: MINIMUM_OPENS_FOR_PATTERN }])).toBe(3)
  })

  test('a tie resolves to the earlier hour, deterministically', () => {
    expect(pickPreferredHour([{ hour: 20, opens: 5 }, { hour: 8, opens: 5 }])).toBe(8)
    // Row order must not change the answer.
    expect(pickPreferredHour([{ hour: 8, opens: 5 }, { hour: 20, opens: 5 }])).toBe(8)
  })

  test('ignores impossible hours rather than trusting them', () => {
    expect(pickPreferredHour([{ hour: 30, opens: 99 }, { hour: 9, opens: 6 }])).toBe(9)
    expect(pickPreferredHour([{ hour: -1, opens: 99 }, { hour: 9, opens: 6 }])).toBe(9)
  })

  test('no history means no opinion', () => {
    expect(pickPreferredHour([])).toBeNull()
  })

  test('a custom minimum is honoured, so a test or a tenant can lower the bar', () => {
    expect(pickPreferredHour([{ hour: 11, opens: 1 }], 1)).toBe(11)
  })

  /**
   * The gate applies to the WINNING hour, not to the total.
   *
   * Summed across hours, five single opens in five different hours cleared a minimum written to reject
   * exactly that — and the winner was then an hour with one open behind it, which is the confidently wrong
   * answer this whole constant exists to prevent.
   */
  test('evidence spread across many hours is not evidence for any of them', () => {
    const scattered = [
      { hour: 3, opens: 1 },
      { hour: 7, opens: 1 },
      { hour: 11, opens: 1 },
      { hour: 15, opens: 1 },
      { hour: 22, opens: 1 },
    ]
    expect(scattered.reduce((sum, row) => sum + row.opens, 0)).toBeGreaterThanOrEqual(MINIMUM_OPENS_FOR_PATTERN)
    expect(pickPreferredHour(scattered)).toBeNull()
  })

  test('one hour carrying the evidence wins even when the rest is noise', () => {
    expect(pickPreferredHour([
      { hour: 3, opens: 1 },
      { hour: 19, opens: MINIMUM_OPENS_FOR_PATTERN },
      { hour: 22, opens: 2 },
    ])).toBe(19)
  })
})

describe('loadPreferredSendHour', () => {
  const scope = { tenantId: 't1', organizationId: 'o1' }

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

  // Grouping by server hour and relabelling afterwards is a different, wrong answer for anybody outside
  // the server's timezone.
  test('groups by the hour in the CUSTOMER timezone, scoped to them', async () => {
    const { em, executed } = fakeEm([{ hour: 9, opens: 8 }])
    expect(await loadPreferredSendHour(em, 'c1', scope, 'Europe/Warsaw')).toBe(9)
    expect(executed[0].sql).toContain('at time zone ?')
    expect(executed[0].sql).toContain("e.type = 'opened'")
    /**
     * The scope is bound TWICE, once per table.
     *
     * The join already ties the run to a tenant-scoped event, so the second pair changes no result — it
     * exists so the planner can reach the index that leads with (tenant, org, subject_entity_id). Asserted
     * because it is invisible in the output and would be the first thing an unwitting cleanup removed.
     */
    expect(executed[0].sql).toContain('r.tenant_id = ?')
    expect(executed[0].params).toEqual(['Europe/Warsaw', 't1', 'o1', 't1', 'o1', 'c1'])
  })

  /**
   * A typo in one customer's profile must not fail their step.
   *
   * The timezone is a bound parameter, so nothing can be injected through it — but Postgres raises on a name
   * it does not recognise, so `at time zone 'Mars/Olympus'` turned one bad profile row into a failed send.
   * UTC is the same fallback the quiet-hours code has always used.
   */
  test('an unusable timezone falls back to UTC instead of failing the query', async () => {
    const { em, executed } = fakeEm([{ hour: 9, opens: 8 }])
    expect(await loadPreferredSendHour(em, 'c1', scope, 'Mars/Olympus')).toBe(9)
    expect(executed[0].params[0]).toBe('UTC')
  })

  test('a customer with too little history gets no preference', async () => {
    const { em } = fakeEm([{ hour: 3, opens: 1 }])
    expect(await loadPreferredSendHour(em, 'c1', scope, 'UTC')).toBeNull()
  })
})
