/**
 * Single source of truth for an activity's *occurrence* date in the Activities
 * UI (issue #8286).
 *
 * An activity's occurrence time is `occurred_at`, falling back to `scheduled_at`.
 * `created_at` is materialisation time — *when the record was written* — not
 * *when the activity happened*. Using it as the occurrence date (the pattern this
 * module replaces) renders a `NULL`-occurrence task as if it happened at
 * creation and sorts it into the timeline by that fabricated value.
 *
 * Every Activities timeline / card consumer (person `ActivitiesSection` +
 * `ActivityTimeline`, company `ActivityHistorySection` + `ActivityCard`, ...)
 * routes its occurrence read through here so no one reintroduces the `created_at`
 * fallback in isolation.
 */

export type ActivityWithOccurrenceDate = {
  id?: string | null
  occurredAt?: string | null
  scheduledAt?: string | null
}

/** The activity's occurrence date (`occurred_at` → `scheduled_at`), or `null`
 * when the activity has neither. Never falls back to `created_at`. */
export function activityOccurrenceDate(
  activity: Pick<ActivityWithOccurrenceDate, 'occurredAt' | 'scheduledAt'>,
): string | null {
  return activity.occurredAt ?? activity.scheduledAt ?? null
}

function parseDate(value: string | null): number | null {
  if (value === null) return null
  const time = new Date(value).getTime()
  return Number.isNaN(time) ? null : time
}

/**
 * Order two activities by occurrence date. Activities with no occurrence date
 * sort **last** (after every dated activity, regardless of direction, so an
 * undated task is never interleaved among dated ones); equal dates fall back to
 * id ordering for stability. `created_at` is never used — the direction only
 * decides which dated activity comes first.
 */
export function compareActivitiesByOccurrence(
  left: ActivityWithOccurrenceDate,
  right: ActivityWithOccurrenceDate,
  direction: 'asc' | 'desc' = 'desc',
): number {
  const leftTime = parseDate(activityOccurrenceDate(left))
  const rightTime = parseDate(activityOccurrenceDate(right))

  if (leftTime === null && rightTime === null) {
    // Both undated — keep a deterministic, direction-independent id order so the
    // undated block is stable between renders.
    return String(right.id ?? '').localeCompare(String(left.id ?? ''))
  }
  if (leftTime === null) return 1
  if (rightTime === null) return -1

  const diff = direction === 'desc' ? rightTime - leftTime : leftTime - rightTime
  if (diff !== 0) return diff
  // Deterministic tie-break for activities sharing an occurrence date — matches
  // the previous id-descending stability used by both timeline feeds.
  return String(right.id ?? '').localeCompare(String(left.id ?? ''))
}
