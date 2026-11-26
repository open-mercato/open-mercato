import { BIRTHDAYS_SOURCE_ID, BIRTH_DATE_FIELD_KEY, findRowSweepSource, sweepSourceCatalog } from '../sweep-sources'

/**
 * The birthday source: what it asks the database, and the two rules that make it annual rather than once ever.
 *
 * Driven through a fake connection, because the interesting parts are the SQL it builds and the claim keys it
 * returns — both of which a database round-trip would hide rather than reveal.
 */
function fakeEm(rows: Array<{ entity_id: string; birth_date: string | null }>) {
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

const scope = { tenantId: 't1', organizationId: 'o1' }

describe('the birthday sweep source', () => {
  const source = findRowSweepSource(BIRTHDAYS_SOURCE_ID)!

  test('is registered and offered to an author', () => {
    expect(source).toBeTruthy()
    expect(sweepSourceCatalog().map((entry) => entry.id)).toContain(BIRTHDAYS_SOURCE_ID)
  })

  test('asks for today only by default', async () => {
    const { em, executed } = fakeEm([])
    await source.collect(em, scope, {}, new Date('2026-09-29T09:00:00.000Z'), 100)
    const { params } = executed[0]
    // field key, tenant, org, one month-day, limit, offset
    expect(params).toEqual([BIRTH_DATE_FIELD_KEY, 't1', 'o1', '09-29', 100, 0])
  })

  test('asks for a window when the author wants notice, and handles the turn of the year', async () => {
    const { em, executed } = fakeEm([])
    await source.collect(em, scope, { withinDays: 3 }, new Date('2026-12-30T09:00:00.000Z'), 50)
    const { params } = executed[0]
    // A window across new year is two ranges, which is why this compares month-day strings rather than dates.
    expect(params.slice(3, 7)).toEqual(['12-30', '12-31', '01-01', '01-02'])
  })

  test('matches the month and day, never the year', async () => {
    const { em, executed } = fakeEm([])
    await source.collect(em, scope, {}, new Date('2026-09-29T09:00:00.000Z'), 10)
    // A stored year may be a guess or a placeholder; matching it would fire once ever instead of once a year.
    expect(executed[0].sql).toContain('substring(v.value_text from 6 for 5)')
  })

  test('joins the profile to the customer, because the run is about the customer', async () => {
    const { em, executed } = fakeEm([])
    await source.collect(em, scope, {}, new Date('2026-09-29T09:00:00.000Z'), 10)
    // The custom field is stored against the PROFILE id; a campaign run is about the customer entity.
    expect(executed[0].sql).toContain('customer_people')
    expect(executed[0].sql).toContain('customer_entities')
    expect(executed[0].sql).toContain("e.kind = 'person'")
  })

  test('claims each customer once per YEAR, which is what makes the campaign annual', async () => {
    const { em } = fakeEm([{ entity_id: 'c1', birth_date: '1990-09-29' }])
    const thisYear = await source.collect(em, scope, {}, new Date('2026-09-29T09:00:00.000Z'), 10)
    const nextYear = await source.collect(em, scope, {}, new Date('2027-09-29T09:00:00.000Z'), 10)
    expect(thisYear[0].claimKey).toBeTruthy()
    // Same person, same day, different year: a different claim, so the campaign fires again.
    expect(nextYear[0].claimKey).not.toBe(thisYear[0].claimKey)
  })

  test('the same tick twice produces the same claim, so a retry does not send twice', async () => {
    const { em } = fakeEm([{ entity_id: 'c1', birth_date: '1990-09-29' }])
    const first = await source.collect(em, scope, {}, new Date('2026-09-29T09:00:00.000Z'), 10)
    const again = await source.collect(em, scope, {}, new Date('2026-09-29T23:00:00.000Z'), 10)
    expect(again[0].claimKey).toBe(first[0].claimKey)
  })

  /**
   * The window that crosses new year, claimed twice.
   *
   * Everything else about this source was careful about the turn of the year; the claim key was not. It used the
   * year the SWEEP ran in, so a 1 January birthday seen on 30 December with notice was claimed under 2026 and
   * then again, as "today", under 2027.
   */
  test('claims a birthday under ITS year, not the year the sweep happens to run in', async () => {
    const { em } = fakeEm([{ entity_id: 'c1', birth_date: '1990-01-01' }])
    const withNotice = await source.collect(em, scope, { withinDays: 3 }, new Date('2026-12-30T09:00:00.000Z'), 10)
    const onTheDay = await source.collect(em, scope, {}, new Date('2027-01-01T09:00:00.000Z'), 10)
    expect(withNotice[0].trigger.daysUntilBirthday).toBe(2)
    expect(onTheDay[0].claimKey).toBe(withNotice[0].claimKey)
  })

  test('still claims the NEXT birthday separately when a window crosses the year', async () => {
    const { em } = fakeEm([{ entity_id: 'c1', birth_date: '1990-01-01' }])
    const first = await source.collect(em, scope, { withinDays: 3 }, new Date('2026-12-30T09:00:00.000Z'), 10)
    const ayearlater = await source.collect(em, scope, { withinDays: 3 }, new Date('2027-12-30T09:00:00.000Z'), 10)
    expect(ayearlater[0].claimKey).not.toBe(first[0].claimKey)
  })

  test('reports how many days away the birthday is, so copy can say "today" or "in three days"', async () => {
    const { em } = fakeEm([
      { entity_id: 'c1', birth_date: '1990-10-02' },
      { entity_id: 'c2', birth_date: '1988-09-29' },
    ])
    const candidates = await source.collect(em, scope, { withinDays: 5 }, new Date('2026-09-29T09:00:00.000Z'), 10)
    expect(candidates.find((entry) => entry.subjectEntityId === 'c2')?.trigger.daysUntilBirthday).toBe(0)
    expect(candidates.find((entry) => entry.subjectEntityId === 'c1')?.trigger.daysUntilBirthday).toBe(3)
  })

  /**
   * The sweep pages through a row source, so the query has to order totally and accept an offset. Without
   * both, an installation with more matching rows than one page kept re-reading the same page and the rows
   * behind it never fired at all.
   */
  test('orders totally and takes an offset, so the worker can page past the first two hundred', async () => {
    const { em, executed } = fakeEm([])
    await source.collect(em, scope, {}, new Date('2026-09-29T09:00:00.000Z'), 200, 400)
    expect(executed[0].sql).toContain('order by p.entity_id')
    expect(executed[0].sql).toContain('limit ? offset ?')
    expect(executed[0].params.slice(-2)).toEqual([200, 400])
  })

  test('starts at the beginning when no offset is given', async () => {
    const { em, executed } = fakeEm([])
    await source.collect(em, scope, {}, new Date('2026-09-29T09:00:00.000Z'), 50)
    expect(executed[0].params.slice(-2)).toEqual([50, 0])
  })

  test('drops a row with no usable date rather than enrolling somebody on a guess', async () => {
    const { em } = fakeEm([{ entity_id: 'c3', birth_date: null }])
    expect(await source.collect(em, scope, {}, new Date('2026-09-29T09:00:00.000Z'), 10)).toEqual([])
  })
})
