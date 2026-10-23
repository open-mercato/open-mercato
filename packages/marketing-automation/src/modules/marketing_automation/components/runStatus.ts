import type { StatusBadgeVariant } from '@open-mercato/ui/primitives/status-badge'

/**
 * One colour per run status, for every screen that shows one.
 *
 * Shared because it was not: the runs list called `waiting` a warning and `failed` an error, while the customer
 * profile called the same two `neutral` and `warning` — so one run read amber on one screen and grey on the
 * other, and the two screens disagreed about a fact rather than merely looking different.
 *
 * These are the runs list's choices, which were the reasoned ones: `dead` and `failed` are errors because a
 * customer is stranded mid-journey, while `waiting` is a warning rather than an error because it is the normal
 * state of a drip campaign between steps.
 *
 * `failed` is kept although `failRun` never writes it to a RUN — `marketing_job_runs` uses that word, and a
 * reader comparing the two screens should not find one of them silently falling through to `neutral` if the
 * vocabularies are ever unified. A retry is not here because it is not stored: the runs list derives it from
 * attempts plus a recorded error.
 */
export const RUN_STATUS_VARIANTS: Record<string, StatusBadgeVariant> = {
  running: 'info',
  claimed: 'info',
  waiting: 'warning',
  completed: 'success',
  failed: 'error',
  dead: 'error',
}
