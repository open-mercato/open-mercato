import { loadSplitResults, pickSplitWinner } from '../split-results'
import type { SplitVariantResult } from '../split-results'
import type { EntityManager } from '@mikro-orm/postgresql'
import { describeLanes } from '../../engine/split'
import type { CampaignStep } from '../../engine/types'
import { resetCapabilityCache } from '../../capabilities'

const scope = { tenantId: 't1', organizationId: 'o1' }

/**
 * `reached` is the sample, and defaults to one message per person — the shape a one-email lane has. A test
 * that cares about the two-email case passes it explicitly.
 */
const lane = (
  variant: string,
  reached: number,
  clicked: number,
  opened = clicked,
  sends = reached,
  /** Attributed revenue and its currency — null means nothing has been attributed yet, which is not zero. */
  revenue: { amount: number; currencyCode?: string | null; mixed?: boolean } | null = null,
): SplitVariantResult => ({
  stepId: 'sp1',
  variant,
  runs: reached,
  sends,
  reached,
  hasSteps: true,
  opened,
  clicked,
  clickRate: reached > 0 ? clicked / reached : null,
  openRate: reached > 0 ? opened / reached : null,
  revenue: revenue?.amount ?? null,
  currencyCode: revenue ? (revenue.mixed ? null : revenue.currencyCode ?? 'PLN') : null,
  mixedCurrency: revenue?.mixed ?? false,
  revenuePerRecipient: revenue && reached > 0 ? revenue.amount / reached : null,
})

describe('loadSplitResults', () => {
  /**
   * `em.execute` answers the capability probe; `getConnection().execute` answers the lane query.
   *
   * These tests are about a shop that HAS `sales`, so the probe says so — the revenue CTE is part of what they
   * assert the parameter order of. The no-sales shape has its own test below.
   */
  function fakeEm(rows: unknown[], capabilities = { sales: true, catalog: true }) {
    const executed: Array<{ sql: string; params: unknown[] }> = []
    const em = {
      execute: async () => [capabilities],
      getConnection: () => ({
        execute: async (sql: string, params: unknown[]) => {
          executed.push({ sql, params })
          return rows
        },
      }),
    }
    return { em: em as unknown as EntityManager, executed }
  }

  beforeEach(() => resetCapabilityCache())


  const lane = (variant: string, stepIds: string[]) => ({ splitStepId: 'sp1', variant, stepIds })

  /**
   * Below the `lane` helper it uses, deliberately.
   *
   * There are two `lane` helpers in this file with incompatible signatures — a module-level one building a
   * `SplitVariantResult` and this one building a `LaneDescriptor` — so a test placed above this line reads as a
   * call to the other, with a step-id array sitting in a `reached: number` slot. It would still pass, which is
   * what makes it worth avoiding.
   */
  test('without a sales module the revenue CTE and its placeholders both go', async () => {
    /**
     * The two must travel together. The statement omits `lane_orders`, so its five placeholders must go with
     * it — leave them in and every later parameter shifts by five, binding a step id where a tenant belongs,
     * and the lane reports nothing while looking like it ran.
     */
    const { em, executed } = fakeEm([{ runs: 2, sends: 2, reached: 2, opened: 1, clicked: 1 }], { sales: false, catalog: false })
    const results = await loadSplitResults(em, 'camp-1', scope, [lane('a', ['s1'])])
    const { sql, params } = executed[0]
    expect(sql).not.toContain('lane_orders')
    expect(sql).not.toContain('sales_orders')
    // lane_runs takes five, then four counting subqueries of (tenant, org, one step id).
    expect(params).toHaveLength(5 + 4 * 3)
    // Revenue is withheld, not reported as zero earned: `pickSplitWinner` refuses to rank on what it cannot see.
    expect(results[0].revenue).toBeNull()
    expect(results[0].currencyCode).toBeNull()
    expect(results[0].mixedCurrency).toBe(false)
    expect(results[0].revenuePerRecipient).toBeNull()
    // The lane's own numbers are unaffected: they come from this module's tables.
    expect(results[0].clicked).toBe(1)
    expect(results[0].clickRate).toBeCloseTo(0.5)
  })


  test('counts only the lane OWN steps, and reads the recorded lane off the run', async () => {
    const { em, executed } = fakeEm([
      { runs: 10, sends: 16, reached: 8, opened: 4, clicked: 2, revenue: 400, currencies: 1, currency_code: 'PLN' },
    ])
    const results = await loadSplitResults(em, 'camp-1', scope, [lane('a', ['a1', 'a2'])])
    // Sixteen messages to eight people: the rates are over the eight, because the numerators are people too.
    expect(results).toEqual([{
      stepId: 'sp1', variant: 'a', runs: 10, sends: 16, reached: 8, hasSteps: true, opened: 4, clicked: 2,
      clickRate: 0.25, openRate: 0.5,
      // Revenue per person reached, for the same reason the rates are per person.
      revenue: 400, currencyCode: 'PLN', mixedCurrency: false, revenuePerRecipient: 50,
    }])
    const { sql, params } = executed[0]
    // Recorded, not recomputed.
    expect(sql).toContain('variant_choices ->> ?')
    // Restricted to the lane's steps — this is what stops a shared trunk email counting as the lane's.
    expect(sql).toContain('s.step_id in (?, ?)')
    // Engagement is per RUN, so a mail client re-fetching a pixel cannot inflate a lane.
    expect(sql).toContain('count(distinct e.run_id)')
    // Every step id travels as a bound parameter.
    /**
     * Revenue, currency count and currency code come from ONE pass over the orders now.
     *
     * They were three correlated subqueries over the identical events-runs-orders join — the most expensive
     * join on this screen, run three times per lane. The `lane_orders` CTE that replaced them binds FIRST,
     * because a CTE is written before the select list; the order below is the only thing standing between a
     * step id landing where a tenant belongs and a lane silently reporting nothing.
     */
    expect(sql).toContain('lane_orders as (')
    expect(sql).toContain('from lane_orders')
    // Through the shared filter: a hand-rolled subset is how the scope went missing in the first place.
    expect(sql).toContain('o.tenant_id = ?')
    expect(sql).toContain('o.organization_id = ?')
    expect(params).toEqual([
      // lane_runs
      'camp-1', 't1', 'o1', 'sp1', 'a',
      // lane_orders: the conversion window first, then the scope and the lane's steps. The same window the
      // funnel and the revenue attribution use, so the three cannot disagree.
      7, 't1', 'o1', 'a1', 'a2',
      /**
       * Then the ORDER's own scope, which this query used to leave out entirely.
       *
       * The events and the runs were scoped and the orders were joined on the customer id alone — so an
       * order belonging to another organization, for a customer entity visible in both, was summed into this
       * lane's revenue and could decide an A/B winner.
       */
      't1', 'o1',
      // The four counting subqueries.
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
      reached: 0, hasSteps: false, clickRate: null, openRate: null,
      revenue: null, currencyCode: null, mixedCurrency: false, revenuePerRecipient: null,
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

  /**
   * A holdout must not veto the whole test.
   *
   * A control lane sends nothing by design, so its rate is null forever. Counting it as a lane still gathering
   * its sample meant every campaign with a holdout — the configuration where measuring matters most — could
   * never produce a winner at all.
   */
  test('a holdout lane does not stop a winner being called', () => {
    const holdout: SplitVariantResult = {
      stepId: 'sp1', variant: 'control', runs: 300, sends: 0, reached: 0, hasSteps: false,
      opened: 0, clicked: 0, clickRate: null, openRate: null,
    }
    const winner = pickSplitWinner([holdout, lane('a', 100, 12), lane('b', 100, 5)], 'sp1', 50)
    expect(winner).toMatchObject({ variant: 'a' })
  })

  test('a holdout is never itself the winner', () => {
    const holdout: SplitVariantResult = {
      stepId: 'sp1', variant: 'control', runs: 300, sends: 0, reached: 0, hasSteps: false,
      opened: 0, clicked: 0, clickRate: null, openRate: null,
    }
    // Two lanes, one of which sends nothing: there is nothing to compare, so there is no winner.
    expect(pickSplitWinner([holdout, lane('a', 100, 12)], 'sp1', 50)).toBeNull()
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

/**
 * Judging a test on money rather than on clicks.
 *
 * The trap this exists for: a variant that collects more clicks and sells less. Until now the module could not
 * see it, because the only metric was the click rate.
 */
describe('pickSplitWinner on revenue', () => {
  const SAMPLE = 100

  test('the variant that SOLD more wins, even when it was clicked less', () => {
    // b is clicked half as often and earns twice as much per recipient — the classic case.
    const a = lane('a', SAMPLE, 40, 40, SAMPLE, { amount: 1000 })
    const b = lane('b', SAMPLE, 20, 20, SAMPLE, { amount: 4000 })

    expect(pickSplitWinner([a, b], 'sp1', 50, 'clicks')?.variant).toBe('a')
    const winner = pickSplitWinner([a, b], 'sp1', 50, 'revenue')
    expect(winner?.variant).toBe('b')
    expect(winner?.metric).toBe('revenue')
    // The figure it was judged on, and the runner-up's, so a screen can show how close the call was.
    expect(winner?.value).toBeCloseTo(40, 5)
    expect(winner?.runnerUpValue).toBeCloseTo(10, 5)
    // Both rates travel regardless of the metric, so nothing has to ask twice.
    expect(winner?.clickRate).toBeCloseTo(0.2, 5)
  })

  /**
   * Refused rather than approximated: two lanes earning in different currencies have no ordering, and answering
   * anyway would pick a winner on a number that does not mean what it says.
   */
  test('mixed currencies refuse a revenue verdict', () => {
    const a = lane('a', SAMPLE, 10, 10, SAMPLE, { amount: 1000, currencyCode: 'PLN' })
    const b = lane('b', SAMPLE, 10, 10, SAMPLE, { amount: 900, currencyCode: 'EUR' })
    expect(pickSplitWinner([a, b], 'sp1', 50, 'revenue')).toBeNull()
  })

  test('a lane whose own revenue spans currencies refuses too', () => {
    const a = lane('a', SAMPLE, 10, 10, SAMPLE, { amount: 1000, mixed: true })
    const b = lane('b', SAMPLE, 10, 10, SAMPLE, { amount: 500 })
    expect(pickSplitWinner([a, b], 'sp1', 50, 'revenue')).toBeNull()
  })

  /**
   * "Nobody has bought yet" is not "they sold nothing", and only the second is a result. Recoverable: attribution
   * arrives as orders do.
   */
  test('a lane with nothing attributed yet is not judged on revenue', () => {
    const a = lane('a', SAMPLE, 20, 20, SAMPLE, { amount: 1000 })
    // Clicked less and with nothing attributed: the click rates differ, so that metric still has an answer.
    const b = lane('b', SAMPLE, 10)
    expect(pickSplitWinner([a, b], 'sp1', 50, 'revenue')).toBeNull()
    // The same pair still has a click-rate answer, because that metric has its data.
    expect(pickSplitWinner([a, b], 'sp1', 50, 'clicks')).not.toBeNull()
  })

  test('equal revenue per recipient is a tie, like an equal click rate', () => {
    const a = lane('a', SAMPLE, 10, 10, SAMPLE, { amount: 1000 })
    const b = lane('b', SAMPLE, 30, 30, SAMPLE, { amount: 1000 })
    expect(pickSplitWinner([a, b], 'sp1', 50, 'revenue')).toBeNull()
  })

  test('the metric defaults to clicks, so nothing changes for a caller that did not ask', () => {
    const a = lane('a', SAMPLE, 40, 40, SAMPLE, { amount: 1000 })
    const b = lane('b', SAMPLE, 20, 20, SAMPLE, { amount: 4000 })
    expect(pickSplitWinner([a, b], 'sp1', 50)?.variant).toBe('a')
    expect(pickSplitWinner([a, b], 'sp1', 50)?.metric).toBe('clicks')
  })

  test('revenue is compared PER RECIPIENT, so an unevenly weighted split is judged fairly', () => {
    // a reached nine times as many people and earned three times as much: worse per person.
    const a = lane('a', 900, 90, 90, 900, { amount: 3000 })
    const b = lane('b', 100, 10, 10, 100, { amount: 1000 })
    expect(pickSplitWinner([a, b], 'sp1', 50, 'revenue')?.variant).toBe('b')
  })
})
