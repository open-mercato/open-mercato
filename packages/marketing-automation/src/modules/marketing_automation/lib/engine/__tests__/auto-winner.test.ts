import { AUTO_APPLY_SAMPLE_MULTIPLIER, DEFAULT_WINNER_MARGIN, decideAutoWinner } from '../auto-winner'
import type { SplitVariantResult } from '../../analytics/split-results'

/**
 * The stricter question: is this result strong enough to rewrite somebody's campaign with nobody watching.
 */
const lane = (variant: string, reached: number, clicked: number): SplitVariantResult => ({
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
