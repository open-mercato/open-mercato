import { MarketingCampaignRevision, MarketingCampaignTrigger } from '../../data/entities'
import { MAX_REVISIONS_PER_CAMPAIGN, listRevisions, recordRevision } from '../revisions'
import type { EntityManager } from '@mikro-orm/postgresql'

/**
 * Campaign history, which is the one piece of bookkeeping that is allowed to fail.
 *
 * `lib/revisions.ts` had no unit test, and its three rules are all invisible from a happy path: a save must
 * not be reported as failed because its history entry could not be written, the cap has to hold on write
 * rather than in a job nobody notices has stopped, and the numbers the list prints have to be counted from a
 * definition the screen never receives.
 */
const scope = { tenantId: 't1', organizationId: 'o1' }

type Row = Record<string, unknown>

function fakeEm(answers: {
  triggers?: Row[]
  revisions?: Row[]
  onFind?: (entity: unknown, options: Row | undefined) => void
  onFlush?: () => void
}) {
  const created: Row[] = []
  const removed: Row[] = []
  const em = {
    find: async (entity: unknown, _where: Row, options?: Row) => {
      answers.onFind?.(entity, options)
      if (entity === MarketingCampaignTrigger) return answers.triggers ?? []
      if (entity !== MarketingCampaignRevision) return []
      const rows = [...(answers.revisions ?? [])].sort(
        (left, right) => Number(right.version) - Number(left.version),
      )
      const offset = typeof options?.offset === 'number' ? options.offset : 0
      const limit = typeof options?.limit === 'number' ? options.limit : rows.length
      return rows.slice(offset, offset + limit)
    },
    create: (_entity: unknown, data: Row) => { created.push(data); return data },
    persist: () => undefined,
    remove: (row: Row) => { removed.push(row) },
    flush: async () => { answers.onFlush?.() },
  }
  return { em: em as unknown as EntityManager, created, removed }
}

function revisionRow(version: number, overrides: Row = {}): Row {
  return {
    version,
    name: `v${version}`,
    note: 'saved',
    actorId: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    definition: { steps: [] },
    triggers: [],
    ...overrides,
  }
}

describe('recordRevision', () => {
  it('numbers the first save 1 rather than leaving a gap', async () => {
    const { em, created } = fakeEm({ revisions: [] })
    const version = await recordRevision(em, scope, {
      campaignId: 'c1',
      name: 'Welcome',
      definition: { steps: [{ type: 'send_email' }] },
      note: 'saved',
    })
    expect(version).toBe(1)
    expect(created[0]).toMatchObject({ campaignId: 'c1', version: 1, name: 'Welcome', ...scope })
  })

  it('continues from the highest version rather than from the row count', async () => {
    // Pruning leaves holes at the bottom, so counting rows would reissue a version that already existed.
    const { em } = fakeEm({ revisions: [revisionRow(11), revisionRow(12)] })
    expect(await recordRevision(em, scope, {
      campaignId: 'c1', name: 'Welcome', definition: {}, note: 'saved',
    })).toBe(13)
  })

  it('records a restore and a promoted winner as themselves, not as ordinary saves', async () => {
    /**
     * The note is what lets the history list say why a version exists. A winner promotion rewrites the
     * campaign more drastically than either of the others and used not to be recorded at all.
     */
    const { em, created } = fakeEm({ revisions: [] })
    await recordRevision(em, scope, { campaignId: 'c1', name: 'A', definition: {}, note: 'restored:4' })
    await recordRevision(em, scope, { campaignId: 'c1', name: 'A', definition: {}, note: 'winner:step-7' })
    expect(created.map((row) => row.note)).toEqual(['restored:4', 'winner:step-7'])
  })

  it('stores a schedule trigger with its sweep source and an event trigger with its id', async () => {
    const { em, created } = fakeEm({
      revisions: [],
      triggers: [
        { kind: 'schedule', scheduleValue: 'daily', reentryAfterDays: 30, sweepSource: 'birthdays', sweepParams: { offsetDays: 0 } },
        { kind: 'event', eventId: 'customers.person.created' },
      ],
    })
    await recordRevision(em, scope, { campaignId: 'c1', name: 'A', definition: {}, note: 'saved' })
    expect(created[0].triggers).toEqual([
      { kind: 'schedule', scheduleValue: 'daily', reentryAfterDays: 30, sweepSource: 'birthdays', sweepParams: { offsetDays: 0 } },
      { kind: 'event', eventId: 'customers.person.created' },
    ])
  })

  it('prunes in the same flush that writes, so the cap holds without a job', async () => {
    const existing = Array.from({ length: MAX_REVISIONS_PER_CAMPAIGN + 3 }, (_, index) => revisionRow(index + 1))
    const { em, removed } = fakeEm({ revisions: existing })
    await recordRevision(em, scope, { campaignId: 'c1', name: 'A', definition: {}, note: 'saved' })
    /**
     * The surplus query offsets by the cap MINUS ONE because the row being written is already in the
     * session and is not returned by a find — so the oldest four go, leaving the cap once it flushes.
     */
    expect(removed.map((row) => row.version)).toEqual([4, 3, 2, 1])
  })

  it('returns null instead of throwing when history cannot be written', async () => {
    /**
     * The load-bearing rule. The caller has already committed the save; the cost of a lost revision is a
     * gap in a list, and the cost of letting this throw is an author's work.
     */
    const reported: unknown[] = []
    const { em } = fakeEm({ revisions: [], onFlush: () => { throw new Error('history table is gone') } })
    const version = await recordRevision(
      em,
      scope,
      { campaignId: 'c1', name: 'A', definition: {}, note: 'saved' },
      (error) => reported.push(error),
    )
    expect(version).toBeNull()
    expect((reported[0] as Error).message).toBe('history table is gone')
  })

  it('swallows the failure even when nobody passed a reporter', async () => {
    const { em } = fakeEm({ revisions: [], onFlush: () => { throw new Error('history table is gone') } })
    await expect(recordRevision(em, scope, {
      campaignId: 'c1', name: 'A', definition: {}, note: 'saved',
    })).resolves.toBeNull()
  })
})

describe('listRevisions', () => {
  it('counts steps and triggers here rather than shipping thirty definitions to a browser', async () => {
    const { em } = fakeEm({
      revisions: [revisionRow(2, {
        definition: { steps: [{ type: 'send_email' }, { type: 'wait' }] },
        triggers: [{ kind: 'event', eventId: 'customers.person.created' }],
      })],
    })
    const [summary] = await listRevisions(em, scope, 'c1')
    expect(summary).toMatchObject({ version: 2, stepCount: 2, triggerCount: 1 })
    expect(summary.createdAt).toBe('2026-01-01T00:00:00.000Z')
  })

  it('counts nothing rather than throwing on a definition that is not a step list', async () => {
    // An older revision may predate a shape change, and a history screen that 500s is worse than one
    // printing a zero.
    const { em } = fakeEm({
      revisions: [
        revisionRow(3, { definition: null, triggers: null }),
        revisionRow(2, { definition: 'not an object' }),
        revisionRow(1, { definition: { steps: 'not an array' } }),
      ],
    })
    expect((await listRevisions(em, scope, 'c1')).map((row) => row.stepCount)).toEqual([0, 0, 0])
  })

  it('returns the newest first, which is the order the history screen reads in', async () => {
    const asked: Row[] = []
    const { em } = fakeEm({
      revisions: [revisionRow(1), revisionRow(3), revisionRow(2)],
      onFind: (entity, options) => { if (entity === MarketingCampaignRevision && options) asked.push(options) },
    })
    expect((await listRevisions(em, scope, 'c1')).map((row) => row.version)).toEqual([3, 2, 1])
    expect(asked[0]).toMatchObject({ orderBy: { version: 'DESC' } })
  })
})
