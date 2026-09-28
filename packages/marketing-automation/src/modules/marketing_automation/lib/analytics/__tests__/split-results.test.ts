import { loadSplitResults, pickSplitWinner } from '../split-results'
import type { SplitVariantResult } from '../split-results'
import type { EntityManager } from '@mikro-orm/postgresql'

const scope = { tenantId: 't1', organizationId: 'o1' }

const lane = (variant: string, sends: number, clicked: number, opened = clicked): SplitVariantResult => ({
  stepId: 'sp1',
  variant,
  runs: sends,
  sends,
  opened,
  clicked,
  clickRate: sends > 0 ? clicked / sends : null,
  openRate: sends > 0 ? opened / sends : null,
})

describe('loadSplitResults', () => {
  test('reads the RECORDED lane and derives rates', async () => {
    const executed: Array<{ sql: string; params: unknown[] }> = []
    const em = {
      getConnection: () => ({
        execute: async (sql: string, params: unknown[]) => {
          executed.push({ sql, params })
          return [{ step_id: 'sp1', variant: 'a', runs: 10, sends: 8, opened: 4, clicked: 2 }]
        },
      }),
    } as unknown as EntityManager

    const results = await loadSplitResults(em, 'camp-1', scope)
    expect(results).toEqual([{
      stepId: 'sp1', variant: 'a', runs: 10, sends: 8, opened: 4, clicked: 2,
      clickRate: 0.25, openRate: 0.5,
    }])
    // Recorded, not recomputed: the query reads `variant_choices` off the run.
    expect(executed[0].sql).toContain('variant_choices')
    // Engagement is per RUN, so a mail client re-fetching the pixel cannot inflate a lane.
    expect(executed[0].sql).toContain("max(case when type = 'opened'")
    // Every branch of the query is scoped.
    expect(executed[0].params).toEqual(['camp-1', 't1', 'o1', 'camp-1', 't1', 'o1', 'camp-1', 't1', 'o1'])
  })

  test('a lane with no sends has no rate, rather than a rate of zero', async () => {
    const em = {
      getConnection: () => ({
        execute: async () => [{ step_id: 'sp1', variant: 'b', runs: 3, sends: 0, opened: 0, clicked: 0 }],
      }),
    } as unknown as EntityManager
    const [result] = await loadSplitResults(em, 'camp-1', scope)
    expect(result.clickRate).toBeNull()
    expect(result.openRate).toBeNull()
  })
})

describe('pickSplitWinner', () => {
  test('picks the higher click rate once both lanes have the sample', () => {
    const winner = pickSplitWinner([lane('a', 100, 12), lane('b', 100, 5)], 'sp1', 50)
    expect(winner).toMatchObject({ variant: 'a', clickRate: 0.12, runnerUpClickRate: 0.05, sends: 100 })
  })

  // Declaring a winner before every lane has been received is how you pick whichever variant went out
  // first. The refusal is the feature.
  test('refuses until EVERY lane has reached the minimum', () => {
    expect(pickSplitWinner([lane('a', 100, 12), lane('b', 10, 0)], 'sp1', 50)).toBeNull()
  })

  test('refuses a tie, because there is nothing to learn from one', () => {
    expect(pickSplitWinner([lane('a', 100, 10), lane('b', 100, 10)], 'sp1', 50)).toBeNull()
  })

  test('refuses when a single lane is all there is', () => {
    expect(pickSplitWinner([lane('a', 100, 10)], 'sp1', 50)).toBeNull()
  })

  test('refuses when nothing was sent at all', () => {
    expect(pickSplitWinner([lane('a', 0, 0), lane('b', 0, 0)], 'sp1', 0)).toBeNull()
  })

  test('ignores lanes belonging to another split', () => {
    const other = { ...lane('a', 100, 99), stepId: 'sp2' }
    expect(pickSplitWinner([other, lane('a', 100, 12), lane('b', 100, 5)], 'sp1', 50)?.variant).toBe('a')
  })

  test('compares rates, not totals, so an unequally weighted split is judged fairly', () => {
    // 'a' received nine times the traffic and more clicks in absolute terms, but converts worse.
    const winner = pickSplitWinner([lane('a', 900, 45), lane('b', 100, 20)], 'sp1', 50)
    expect(winner?.variant).toBe('b')
  })

  test('a three-lane split names the best and the runner-up', () => {
    const winner = pickSplitWinner([lane('a', 100, 5), lane('b', 100, 20), lane('c', 100, 12)], 'sp1', 50)
    expect(winner).toMatchObject({ variant: 'b', clickRate: 0.2, runnerUpClickRate: 0.12 })
  })
})
