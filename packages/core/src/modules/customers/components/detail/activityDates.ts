type ActivityWithOccurrenceDate = {
  id?: string | null
  occurredAt?: string | null
  scheduledAt?: string | null
}

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

export function compareActivitiesByOccurrence(
  left: ActivityWithOccurrenceDate,
  right: ActivityWithOccurrenceDate,
  direction: 'asc' | 'desc' = 'desc',
): number {
  const leftTime = parseDate(activityOccurrenceDate(left))
  const rightTime = parseDate(activityOccurrenceDate(right))

  if (leftTime === null && rightTime === null) {
    return String(right.id ?? '').localeCompare(String(left.id ?? ''))
  }
  if (leftTime === null) return 1
  if (rightTime === null) return -1

  const diff = direction === 'desc' ? rightTime - leftTime : leftTime - rightTime
  if (diff !== 0) return diff
  return String(right.id ?? '').localeCompare(String(left.id ?? ''))
}
