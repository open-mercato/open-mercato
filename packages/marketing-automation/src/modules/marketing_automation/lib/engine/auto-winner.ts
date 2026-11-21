import type { SplitVariantResult, SplitWinner, WinnerMetric } from '../analytics/split-results.js'
import { pickSplitWinner } from '../analytics/split-results.js'

/**
 * Whether an A/B result is strong enough to promote WITHOUT a person looking at it.
 *
 * A separate, stricter question from the one the results screen asks. `pickSplitWinner` decides what to
 * SUGGEST: every lane has its sample and the rates are not tied, which is exactly right for a human who is
 * about to look at the numbers and decide. Rewriting somebody's campaign unattended needs more than "not tied",
 * because a fifty-one to forty-nine split is noise and acting on it would discard a lane that might be better.
 *
 * So there are two extra conditions, and both are about not being fooled:
 *
 *  - a **relative margin**: the winner's figure must beat the runner-up's by a proportion, not by any
 *    amount. 3.0% against 2.9% is a coin toss; 3.0% against 2.0% is a result.
 *  - the runner-up must have a figure at all. A null one means nobody in that lane has clicked or bought yet,
 *    which is not evidence that they never will.
 *
 * The margin is measured on whichever metric decided — `pickSplitWinner` reports the winner's own figure and the
 * runner-up's beside it. Reading the CLICK rates here instead would compute a revenue winner's confidence from
 * numbers that did not choose it: a lane can earn twice as much per recipient on marginally fewer clicks, and
 * that decision would then be refused for a margin nobody was judging on.
 */

/** How much better the winner must be, as a proportion of the runner-up's rate. */
export const DEFAULT_WINNER_MARGIN = 0.25

/**
 * A larger sample than the screen suggests at.
 *
 * The suggestion exists to start a conversation; this one ends it, so it waits for a sample an operator would
 * not argue with. Multiplied rather than a separate setting, because two numbers that must be kept in a sensible
 * relation are better derived than configured independently.
 */
export const AUTO_APPLY_SAMPLE_MULTIPLIER = 2

export type AutoWinnerDecision =
  | { apply: true; winner: SplitWinner; marginAchieved: number }
  | { apply: false; reason: 'no_winner' | 'sample_too_small' | 'margin_too_small' | 'runner_up_unmeasured' }

export function decideAutoWinner(
  results: SplitVariantResult[],
  stepId: string,
  minimumReached: number,
  margin: number = DEFAULT_WINNER_MARGIN,
  metric: WinnerMetric = 'clicks',
): AutoWinnerDecision {
  const sample = Math.max(1, Math.round(minimumReached * AUTO_APPLY_SAMPLE_MULTIPLIER))
  const winner = pickSplitWinner(results, stepId, sample, metric)
  if (!winner) {
    /**
     * Two different "no" answers, distinguished for the log.
     *
     * "Not enough people yet" is a campaign to leave running; "no winner at this sample" is a genuine tie or a
     * single lane. An operator reading the job log wants to know which, because only one of them will change.
     */
    const lanes = results.filter((result) => result.stepId === stepId && result.hasSteps)
    if (lanes.length >= 2 && lanes.some((lane) => lane.reached < sample)) {
      return { apply: false, reason: 'sample_too_small' }
    }
    return { apply: false, reason: 'no_winner' }
  }

  if (winner.runnerUpValue === null) return { apply: false, reason: 'runner_up_unmeasured' }

  /**
   * A runner-up figure of exactly zero is a special case, and it is the easy one: any measured figure beats it
   * by an infinite proportion, so the margin is satisfied by definition rather than by arithmetic on a zero
   * denominator.
   */
  const achieved = winner.runnerUpValue === 0
    ? Number.POSITIVE_INFINITY
    : (winner.value - winner.runnerUpValue) / winner.runnerUpValue

  if (achieved < margin) return { apply: false, reason: 'margin_too_small' }
  return { apply: true, winner, marginAchieved: achieved }
}
