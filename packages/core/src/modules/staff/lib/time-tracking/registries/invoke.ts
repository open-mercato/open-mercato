/**
 * Calling a contributed strategy safely.
 *
 * Every registry in `EP-32…EP-41` hands third-party code a function the module then
 * calls in the middle of a write path or a report render. None of those call sites
 * originally wrapped the call, so one contributed `round`, `sort` or `serialize`
 * that threw took the surrounding operation down — for the whole process, not just
 * the tenant that installed the contribution, because the registries are plain
 * module-scope maps shared by every request the process serves.
 *
 * The rule these helpers encode: **a broken contribution degrades to the module's
 * own behaviour, loudly.** It never propagates, and it never silently wins either —
 * every fallback logs the registry and the strategy id, because a strategy that
 * quietly stopped applying is the failure mode that takes weeks to notice.
 *
 * Which helper to reach for:
 *
 *  - `runStrategy` — single-winner registries, where there is exactly one right
 *    answer and the built-in is it when the contribution cannot produce one.
 *  - `tryStrategy` — chain registries, where the next candidate is asked anyway, so
 *    a thrower is skipped rather than replaced.
 */

import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('staff').child({ component: 'time-tracking/registries' })

export function runStrategy<TResult>(
  registryId: string,
  strategyId: string,
  run: () => TResult,
  fallback: () => TResult,
): TResult {
  try {
    return run()
  } catch (err) {
    logger.error('a time-tracking strategy threw; falling back to the built-in', {
      registryId,
      strategyId,
      err,
    })
    return fallback()
  }
}

/** `undefined` means "this candidate could not answer"; ask the next one. */
export function tryStrategy<TResult>(
  registryId: string,
  strategyId: string,
  run: () => TResult,
): TResult | undefined {
  try {
    return run()
  } catch (err) {
    logger.error('a time-tracking strategy threw; skipping this candidate', {
      registryId,
      strategyId,
      err,
    })
    return undefined
  }
}

/**
 * Clamps a strategy's answer to something the column it lands in can hold.
 *
 * `staff_time_entries.rounded_minutes` is an `integer` and the sole input to every
 * amount the suite computes, so a `NaN`, a fraction or a negative from a
 * contributed strategy is not a cosmetic problem: the write either fails or stores
 * garbage, and on read `entryAmount` substitutes `0`, which bills the entry at
 * nothing without saying so. The shipped default `unitMinutes: 0` makes this the
 * FIRST thing a plausible contribution hits — `Math.floor(raw / ctx.settings.unitMinutes)`
 * is division by zero.
 */
export function clampToStoredMinutes(value: unknown, fallback: () => number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback()
  return Math.max(0, Math.round(value))
}
