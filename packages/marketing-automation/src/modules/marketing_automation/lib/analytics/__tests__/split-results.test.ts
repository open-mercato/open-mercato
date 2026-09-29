import { loadSplitResults, pickSplitWinner } from '../split-results'
import type { SplitVariantResult } from '../split-results'
import type { EntityManager } from '@mikro-orm/postgresql'
import { describeLanes } from '../../engine/split'
import type { CampaignStep } from '../../engine/types'

const scope = { tenantId: 't1', organizationId: 'o1' }

/**
 * `reached` is the sample, and defaults to one message per person — the shape a one-email lane has. A test
 * that cares about the two-email case passes it explicitly.
 */
const lane = (variant: string, reached: number, clicked: number, opened = clicked, sends = reached): SplitVariantResult => ({
  stepId: 'sp1',
  variant,
  runs: reached,
  sends,
  reached,
  opened,
  clicked,
  clickRate: reached > 0 ? clicked / reached : null,
  openRate: reached > 0 ? opened / reached : null,
})

describe('loadSplitResults', () => {
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

  const lane = (variant: string, stepIds: string[]) => ({ splitStepId: 'sp1', variant, stepIds })

  test('counts only the lane OWN steps, and reads the recorded lane off the run', async () => {
    const { em, executed } = fakeEm([{ runs: 10, sends: 16, reached: 8, opened: 4, clicked: 2 }])
    const results = await loadSplitResults(em, 'camp-1', scope, [lane('a', ['a1', 'a2'])])
    // Sixteen messages to eight people: the rates are over the eight, because the numerators are people too.
    expect(results).toEqual([{
      stepId: 'sp1', variant: 'a', runs: 10, sends: 16, reached: 8, opened: 4, clicked: 2,
      clickRate: 0.25, openRate: 0.5,
    }])
    const { sql, params } = executed[0]
    // Recorded, not recomputed.
    expect(sql).toContain('variant_choices ->> ?')
    // Restricted to the lane's steps — this is what stops a shared trunk email counting as the lane's.
    expect(sql).toContain('s.step_id in (?, ?)')
    // Engagement is per RUN, so a mail client re-fetching a pixel cannot inflate a lane.
    expect(sql).toContain('count(distinct e.run_id)')
    // Every step id travels as a bound parameter.
    expect(params).toEqual([
      'camp-1', 't1', 'o1', 'sp1', 'a',
      't1', 'o1', 'a1', 'a2',
      't1', 'o1', 'a1', 'a2',
      't1', 'o1', 'a1', 'a2',
      't1', 'o1', 'a1', 'a2',
    ])
  })

  // A holdout lane. `in ()` is not valid SQL, and a lane with no steps of its own genuinely sent
  // nothing — so it reports the runs it received and no rates at all.
  test('a lane with no steps reports its runs and no rates', async () => {
    const { em, executed } = fakeEm([{ runs: 5 }])
    const results = await loadSplitResults(em, 'camp-1', scope, [lane('holdout', [])])
    expect(results).toEqual([{
      stepId: 'sp1', variant: 'holdout', runs: 5, sends: 0, opened: 0, clicked: 0,
      reached: 0, clickRate: null, openRate: null,
    }])
    expect(executed[0].sql).not.toContain('step_id in ()')
  })

  test('a lane with no sends has no rate, rather than a rate of zero', async () => {
    const { em } = fakeEm([{ runs: 3, sends: 0, opened: 0, clicked: 0 }])
    const [result] = await loadSplitResults(em, 'camp-1', scope, [lane('b', ['b1'])])
    expect(result.clickRate).toBeNull()
    expect(result.openRate).toBeNull()
  })

  test('one query per lane, each scoped', async () => {
    const { em, executed } = fakeEm([{ runs: 1, sends: 1, opened: 0, clicked: 0 }])
    await loadSplitResults(em, 'camp-1', scope, [lane('a', ['a1']), lane('b', ['b1'])])
    expect(executed).toHaveLength(2)
    for (const entry of executed) {
      expect(entry.params).toContain('t1')
      expect(entry.params).toContain('o1')
    }
  })

  test('no lanes means no queries', async () => {
    const { em, executed } = fakeEm([])
    expect(await loadSplitResults(em, 'camp-1', scope, [])).toEqual([])
    expect(executed).toEqual([])
  })
})

describe('pickSplitWinner', () => {
  test('picks the higher click rate once both lanes have the sample', () => {
    const winner = pickSplitWinner([lane('a', 100, 12), lane('b', 100, 5)], 'sp1', 50)
    expect(winner).toMatchObject({ variant: 'a', clickRate: 0.12, runnerUpClickRate: 0.05, sends: 100 })
  })

  // Declaring a winner before every lane has been received is how you pick whichever variant went out
  // first. The refusal is the feature.
  /**
   * The defect this denominator exists for.
   *
   * Two lanes, equally persuasive: of everybody reached, forty per cent clicked. One lane holds a single
   * email, the other holds two, so it sends twice as many messages to the same number of people. Divided by
   * MESSAGES the two-email lane scores 0.2 against 0.4 and loses every time, and the split ends up measuring
   * the author's step count rather than their copy.
   */
  test('a lane with two emails is not penalised for sending two emails', () => {
    const one = lane('one-email', 100, 40)
    const two = lane('two-emails', 100, 40, 40, 200)
    expect(one.clickRate).toBe(two.clickRate)
    expect(pickSplitWinner([one, two], 'sp1', 50)).toBeNull()
  })

  test('waits for the minimum sample in PEOPLE, not messages', () => {
    // Ten people, two emails each: twenty messages, and nowhere near enough people to call it.
    const thin = lane('a', 10, 5, 5, 20)
    const thick = lane('b', 100, 10)
    expect(pickSplitWinner([thin, thick], 'sp1', 50)).toBeNull()
  })

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

describe('describeLanes', () => {
  const step = (id: string, type = 'send_email'): CampaignStep => ({ id, type, params: {} })
  const split = (id: string, lanes: Record<string, CampaignStep[]>): CampaignStep => ({
    id,
    type: 'split',
    params: { variants: Object.entries(lanes).map(([key, steps]) => ({ key, weight: 1, steps })) },
  })

  test('lists each lane with the steps that belong to it', () => {
    const steps = [step('trunk'), split('sp1', { a: [step('a1'), step('a2')], b: [step('b1')] }), step('after')]
    expect(describeLanes(steps)).toEqual([
      { splitStepId: 'sp1', variant: 'a', stepIds: ['a1', 'a2'] },
      { splitStepId: 'sp1', variant: 'b', stepIds: ['b1'] },
    ])
  })

  // The trunk is what must NOT appear: counting it as a lane's own sends is the defect this exists for.
  test('never attributes a trunk step to a lane', () => {
    const steps = [step('trunk'), split('sp1', { a: [step('a1')] }), step('after')]
    const ids = describeLanes(steps).flatMap((lane) => lane.stepIds)
    expect(ids).not.toContain('trunk')
    expect(ids).not.toContain('after')
  })

  test('a nested split contributes its steps to the OUTER lane as well as to its own', () => {
    const inner = split('sp2', { x: [step('x1')] })
    const steps = [split('sp1', { a: [step('a1'), inner] })]
    const lanes = describeLanes(steps)
    // The outer lane sent everything inside it, including the nested lane's message.
    expect(lanes.find((lane) => lane.splitStepId === 'sp1')?.stepIds).toEqual(['a1', 'sp2', 'x1'])
    expect(lanes.find((lane) => lane.splitStepId === 'sp2')?.stepIds).toEqual(['x1'])
  })

  test('a holdout lane has no steps', () => {
    const steps = [split('sp1', { treatment: [step('t1')], holdout: [] })]
    expect(describeLanes(steps).find((lane) => lane.variant === 'holdout')?.stepIds).toEqual([])
  })

  test('a definition with no split has no lanes', () => {
    expect(describeLanes([step('s1'), step('s2')])).toEqual([])
  })
})
