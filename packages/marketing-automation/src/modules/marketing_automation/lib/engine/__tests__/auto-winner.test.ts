import { AUTO_APPLY_SAMPLE_MULTIPLIER, DEFAULT_WINNER_MARGIN, decideAutoWinner } from '../auto-winner'
import type { SplitVariantResult } from '../../analytics/split-results'

/**
 * The stricter question: is this result strong enough to rewrite somebody's campaign with nobody watching.
 */
const lane = (
  variant: string,
  reached: number,
  clicked: number,
  revenue: { amount: number | null; currencyCode?: string | null; mixed?: boolean } = { amount: null },
): SplitVariantResult => ({
  stepId: 'sp1',
  variant,
  runs: reached,
  sends: reached,
  reached,
  hasSteps: true,
  opened: clicked,
  clicked,
  clickRate: reached > 0 ? clicked / reached : null,
  openRate: reached > 0 ? clicked / reached : null,
  revenue: revenue.amount,
  currencyCode: revenue.amount === null ? null : revenue.currencyCode ?? 'EUR',
  mixedCurrency: revenue.mixed === true,
  revenuePerRecipient: revenue.amount === null || reached === 0 ? null : revenue.amount / reached,
})

const MINIMUM = 50
const SAMPLE = MINIMUM * AUTO_APPLY_SAMPLE_MULTIPLIER

describe('decideAutoWinner', () => {
  test('applies a clear result', () => {
    // 6% against 2%: a threefold difference on a sample nobody would argue with.
    const decision = decideAutoWinner([lane('a', SAMPLE, 6), lane('b', SAMPLE, 2)], 'sp1', MINIMUM)
    expect(decision.apply).toBe(true)
    if (decision.apply) expect(decision.winner.variant).toBe('a')
  })

  /**
   * The reason this function exists.
   *
   * `pickSplitWinner` would suggest the leader here, which is right for a person about to look at the numbers —
   * and wrong as a licence to rewrite the campaign, because 3.0% against 2.9% is a coin toss.
   */
  test('refuses a result that is merely ahead', () => {
    const decision = decideAutoWinner([lane('a', 1000, 30), lane('b', 1000, 29)], 'sp1', MINIMUM)
    expect(decision).toEqual({ apply: false, reason: 'margin_too_small' })
  })

  test('waits for a larger sample than the screen suggests at', () => {
    // Enough for a suggestion, not enough to act on unattended.
    const decision = decideAutoWinner([lane('a', MINIMUM, 6), lane('b', MINIMUM, 1)], 'sp1', MINIMUM)
    expect(decision).toEqual({ apply: false, reason: 'sample_too_small' })
  })

  /**
   * Nobody in the other lane has clicked yet, which is not evidence that they never will — and it is exactly
   * the state a fresh split is in for its first few hours.
   */
  test('refuses when the runner-up has no measured rate', () => {
    const decision = decideAutoWinner([lane('a', SAMPLE, 10), { ...lane('b', 0, 0) }], 'sp1', MINIMUM)
    expect(decision.apply).toBe(false)
  })

  test('a runner-up that was measured at zero does not block a winner', () => {
    // Measured, and zero: a hundred people reached, none clicked. That is a result rather than an absence.
    const decision = decideAutoWinner([lane('a', SAMPLE, 8), lane('b', SAMPLE, 0)], 'sp1', MINIMUM)
    expect(decision.apply).toBe(true)
  })

  test('a tie is refused, as it is on the screen', () => {
    const decision = decideAutoWinner([lane('a', SAMPLE, 5), lane('b', SAMPLE, 5)], 'sp1', MINIMUM)
    expect(decision).toEqual({ apply: false, reason: 'no_winner' })
  })

  test('the margin is configurable, and a stricter one refuses more', () => {
    const results = [lane('a', SAMPLE, 6), lane('b', SAMPLE, 5)]
    expect(decideAutoWinner(results, 'sp1', MINIMUM, 0.1).apply).toBe(true)
    expect(decideAutoWinner(results, 'sp1', MINIMUM, 0.5).apply).toBe(false)
  })

  test('the default margin is a proportion, not a percentage point', () => {
    // Stated as a test so nobody later reads 0.25 as "a quarter of a percent".
    expect(DEFAULT_WINNER_MARGIN).toBeLessThan(1)
    const decision = decideAutoWinner([lane('a', SAMPLE, 125), lane('b', SAMPLE, 100)], 'sp1', MINIMUM)
    expect(decision.apply).toBe(true)
  })

  test('a holdout lane neither wins nor blocks', () => {
    const holdout: SplitVariantResult = {
      stepId: 'sp1', variant: 'control', runs: 500, sends: 0, reached: 0, hasSteps: false,
      opened: 0, clicked: 0, clickRate: null, openRate: null,
    }
    const decision = decideAutoWinner([holdout, lane('a', SAMPLE, 6), lane('b', SAMPLE, 2)], 'sp1', MINIMUM)
    expect(decision.apply).toBe(true)
  })
})

/**
 * The same decision, asked about money.
 *
 * The margin has to be measured on the metric that DECIDED, not on the click rates: a lane can earn twice as
 * much per recipient on marginally fewer clicks, and reading the clicks here would refuse that promotion for
 * failing a margin nobody was judging on. These four tests are the ones that would pass either way but for that.
 */
describe('decideAutoWinner on revenue', () => {
  test('applies a lane that earns decisively more per recipient', () => {
    const decision = decideAutoWinner(
      [
        lane('a', SAMPLE, 10, { amount: 2000 }),
        lane('b', SAMPLE, 10, { amount: 1000 }),
      ],
      'sp1',
      MINIMUM,
      DEFAULT_WINNER_MARGIN,
      'revenue',
    )
    expect(decision.apply).toBe(true)
    if (decision.apply) {
      expect(decision.winner.variant).toBe('a')
      expect(decision.winner.metric).toBe('revenue')
      // Twice the revenue per recipient is a margin of 1.0, comfortably past the default quarter.
      expect(decision.marginAchieved).toBeCloseTo(1)
    }
  })

  /**
   * The trap this metric exists to catch, stated as a test.
   *
   * Lane `b` collects five times the clicks and sells half as much. On clicks it is the winner and would be
   * promoted unattended; on revenue the decision goes the other way, which is the whole point.
   */
  test('the click leader is not the revenue winner', () => {
    const lanes = [
      lane('a', SAMPLE, 4, { amount: 2000 }),
      lane('b', SAMPLE, 20, { amount: 1000 }),
    ]
    const onClicks = decideAutoWinner(lanes, 'sp1', MINIMUM, DEFAULT_WINNER_MARGIN, 'clicks')
    const onRevenue = decideAutoWinner(lanes, 'sp1', MINIMUM, DEFAULT_WINNER_MARGIN, 'revenue')
    expect(onClicks.apply && onClicks.winner.variant).toBe('b')
    expect(onRevenue.apply && onRevenue.winner.variant).toBe('a')
  })

  test('refuses a revenue lead that is merely ahead', () => {
    const decision = decideAutoWinner(
      [
        lane('a', SAMPLE, 10, { amount: 1050 }),
        lane('b', SAMPLE, 10, { amount: 1000 }),
      ],
      'sp1',
      MINIMUM,
      DEFAULT_WINNER_MARGIN,
      'revenue',
    )
    expect(decision).toEqual({ apply: false, reason: 'margin_too_small' })
  })

  /**
   * Nothing attributed yet is not evidence of nothing to attribute.
   *
   * `pickSplitWinner` already withholds a revenue verdict when a lane has no figure, so this arrives here as
   * `no_winner` rather than `runner_up_unmeasured` — and either way the campaign is left alone.
   */
  test('will not promote on revenue while a lane has nothing attributed', () => {
    const decision = decideAutoWinner(
      [
        lane('a', SAMPLE, 10, { amount: 2000 }),
        lane('b', SAMPLE, 10),
      ],
      'sp1',
      MINIMUM,
      DEFAULT_WINNER_MARGIN,
      'revenue',
    )
    expect(decision.apply).toBe(false)
  })
})
