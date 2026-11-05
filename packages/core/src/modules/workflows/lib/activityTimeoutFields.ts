import { toTimeoutMs } from './duration'

/**
 * The two timeout fields an activity definition can carry.
 *
 * `timeoutMs` is canonical and is what `resolveActivityTimeoutMs` prefers;
 * `timeout` is the deprecated alias that stored definitions and the CrudForm
 * activity editor still write. A timeout input must own both fields — read
 * them merged and write both on every edit — otherwise the box shows the
 * executor's effective timeout while changing only half of the pair, and the
 * user's edit is silently discarded.
 */
export type ActivityTimeoutFields = {
  timeout?: string
  timeoutMs?: number
}

/**
 * Effective timeout for an activity, in milliseconds.
 *
 * The editors and the executor both speak `timeoutMs`, but the definition
 * schema historically accepted only a `timeout` string — so stored definitions
 * can carry either. Prefer `timeoutMs`; fall back to `toTimeoutMs`, which
 * reads both a duration string ("PT30S", "5m") and a plain millisecond string
 * ("30000") — the CrudForm activity editor writes the latter, and its own
 * placeholder tells the user to. A malformed value is ignored rather than
 * thrown mid-execution (an unparseable timeout must not fail an activity that
 * would otherwise succeed). Returns undefined when no usable timeout is
 * configured (#4424).
 *
 * `activity-executor` re-exports this so its import path stays stable; it
 * lives here so the editors can assert the round-trip without pulling in the
 * server-only executor.
 */
export function resolveActivityTimeoutMs(activity: ActivityTimeoutFields): number | undefined {
  if (typeof activity.timeoutMs === 'number' && activity.timeoutMs > 0) {
    return activity.timeoutMs
  }
  return toTimeoutMs(activity.timeout)
}

/**
 * Text shown by a timeout input that accepts duration strings as well as
 * milliseconds (the CrudForm activity editor, whose placeholder reads
 * "PT30S or 30000").
 */
export function durationTimeoutInputValue(activity: ActivityTimeoutFields): string {
  if (activity.timeout) return activity.timeout
  return activity.timeoutMs != null ? String(activity.timeoutMs) : ''
}

/** Value shown by a millisecond-only timeout input (the two visual editors). */
export function millisecondTimeoutInputValue(activity: ActivityTimeoutFields): number | '' {
  return activity.timeoutMs ?? toTimeoutMs(activity.timeout) ?? ''
}

/**
 * Fields to merge into an activity after a duration-accepting input changed.
 *
 * The raw text stays in the deprecated alias so a partially typed duration
 * survives the re-render, and `timeoutMs` carries whatever the executor can
 * actually use — undefined while the text is incomplete or unusable.
 */
export function durationTimeoutPatch(raw: string): ActivityTimeoutFields {
  return { timeout: raw || undefined, timeoutMs: toTimeoutMs(raw) }
}

/**
 * Fields to merge into an activity after a millisecond-only input changed.
 * The deprecated alias is dropped, so clearing the box clears the timeout and
 * stored definitions migrate off `timeout` as they are edited.
 */
export function millisecondTimeoutPatch(raw: string): ActivityTimeoutFields {
  return { timeout: undefined, timeoutMs: toTimeoutMs(raw) }
}
