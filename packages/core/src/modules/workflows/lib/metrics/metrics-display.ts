/**
 * Presentation rules for the per-definition KPIs (spec §8.5) — PURE.
 *
 * Separate from the arithmetic so "what does a 60% success rate LOOK like" is
 * testable without a canvas, and separate from the cell component so the
 * thresholds live in one place rather than in three `className` ternaries.
 */

export type MetricTone = 'success' | 'warning' | 'error' | 'neutral'

/**
 * Thresholds for the success-rate and SLA-hit-rate tones.
 *
 * Deliberately generous at the top: a workflow that fails one run in twenty is
 * not healthy, and painting 95% green would make the column decorative.
 */
export const METRIC_RATE_GOOD = 0.95
export const METRIC_RATE_FAIR = 0.8

/**
 * Tone for a rate in [0, 1].
 *
 * `null` — no denominator — is NEUTRAL, never an error tone: "nothing terminated in
 * this window" is not a failure, and a red cell would send an operator hunting
 * for a problem that does not exist.
 */
export function rateTone(rate: number | null): MetricTone {
  if (rate === null) return 'neutral'
  if (rate >= METRIC_RATE_GOOD) return 'success'
  if (rate >= METRIC_RATE_FAIR) return 'warning'
  return 'error'
}

/**
 * A rate as a whole-percent string, or `null` when there is no denominator.
 *
 * Whole percents because the underlying sample is usually tens of runs, where a
 * decimal place implies a precision the sample does not have.
 */
export function formatRate(rate: number | null): string | null {
  if (rate === null) return null
  return `${Math.round(rate * 100)}%`
}

/**
 * DS token classes per tone.
 *
 * Colour is never the only carrier — every cell using these also renders the
 * number itself and an `sr-only` name — but the tone still has to come from
 * status tokens rather than raw Tailwind shades.
 */
export const METRIC_TONE_CLASS: Record<MetricTone, string> = {
  success: 'text-status-success-text',
  warning: 'text-status-warning-text',
  error: 'text-status-error-text',
  neutral: 'text-muted-foreground',
}
