import { candidatesWereTruncated, JOB_MAX_CHECKED, SCREEN_MAX_CHECKED } from '../segment-members'

/**
 * The qualifier that every membership answer carries.
 *
 * A members screen, an overlap, a size snapshot, a bulk action and a CSV export all read `complete`, so a
 * wrong answer here is a wrong answer on five screens at once — and the wrong direction is the dangerous
 * one: a truncated list presented as a total is trusted precisely because nothing says not to.
 */
describe('candidatesWereTruncated', () => {
  const maxChecked = 100

  test('nothing to truncate when the candidate list fits', () => {
    expect(candidatesWereTruncated({ candidateCount: 40, windowCount: 40, liveCount: 40, maxChecked })).toBe(false)
  })

  test('truncated when the narrowing produced more candidates than the window took', () => {
    // 101 entered the window, 500 existed: the other 399 were never looked at.
    expect(candidatesWereTruncated({ candidateCount: 500, windowCount: 101, liveCount: 101, maxChecked })).toBe(true)
  })

  /**
   * The regression this was written for.
   *
   * The ceiling is detected by a sentinel — one candidate more than will be examined. That sentinel went
   * through the live-person filter with everything else, so a single deleted customer or a company among the
   * candidates removed it, and the truncated result reported itself complete.
   */
  test('still truncated when a dead row among the candidates would have eaten the sentinel', () => {
    expect(candidatesWereTruncated({ candidateCount: 500, windowCount: 101, liveCount: 100, maxChecked })).toBe(true)
    expect(candidatesWereTruncated({ candidateCount: 500, windowCount: 101, liveCount: 3, maxChecked })).toBe(true)
  })

  /**
   * And the other direction, which matters just as much: over-reporting truncation would put "showing a
   * sample" on a screen that is showing everything.
   */
  test('not truncated when the window WAS the whole list and the filter only removed dead rows', () => {
    expect(candidatesWereTruncated({ candidateCount: 101, windowCount: 101, liveCount: 100, maxChecked })).toBe(false)
    expect(candidatesWereTruncated({ candidateCount: 101, windowCount: 101, liveCount: 101, maxChecked })).toBe(true)
  })

  test('walking the population truncates on the sentinel alone', () => {
    // No narrowing, so there is no candidate list — the limit came back full, which is the signal.
    expect(candidatesWereTruncated({ candidateCount: null, windowCount: 101, liveCount: 101, maxChecked })).toBe(true)
    expect(candidatesWereTruncated({ candidateCount: null, windowCount: 100, liveCount: 100, maxChecked })).toBe(false)
  })

  test('a screen examines fewer candidates than a job, and both are bounded', () => {
    // A segment page answers a question; a job does work. Neither is unbounded.
    expect(SCREEN_MAX_CHECKED).toBeLessThan(JOB_MAX_CHECKED)
    expect(Number.isFinite(JOB_MAX_CHECKED)).toBe(true)
  })
})
