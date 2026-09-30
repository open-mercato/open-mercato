import { calendarWallTimeToInstant } from '@open-mercato/core/modules/customers/lib/calendar/timezone'

export type VisitAvailabilitySubject = {
  type: 'staff' | 'resource'
  id: string
  status: 'available' | 'unavailable' | 'unknown'
  reasonKey: string | null
}

export type VisitAvailabilityResponse = { subjects: VisitAvailabilitySubject[]; warnings?: string[] }

function selectedIds(value: unknown, kind: 'staff' | 'resource'): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.flatMap((entry): string[] => {
    if (!entry || typeof entry !== 'object') return []
    const item = entry as Record<string, unknown>
    if (kind === 'staff') return !item.isCustomer && typeof item.userId === 'string' ? [item.userId] : []
    return typeof item.id === 'string' ? [item.id] : []
  }))]
}

export function visitAvailabilityRequestUrl(values: Readonly<Record<string, unknown>>): string | null {
  const { date, startTime, endDate, endTime } = values
  if ([date, startTime, endDate, endTime].some((value) => typeof value !== 'string' || !value)) return null
  const timezone = typeof values.timezone === 'string' && values.timezone.trim() ? values.timezone : null
  const start = timezone ? calendarWallTimeToInstant(date as string, startTime as string, timezone) : new Date(`${date}T${startTime}:00`)
  const end = timezone ? calendarWallTimeToInstant(endDate as string, endTime as string, timezone) : new Date(`${endDate}T${endTime}:00`)
  if (!start || !end) return null
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) return null
  const query = new URLSearchParams({ startAt: start.toISOString(), endAt: end.toISOString() })
  const staffUserIds = selectedIds(values.participants, 'staff')
  const resourceIds = selectedIds(values.resources, 'resource')
  if (staffUserIds.length) query.set('staffUserIds', staffUserIds.join(','))
  if (resourceIds.length) query.set('resourceIds', resourceIds.join(','))
  return `/api/example/visit-availability?${query.toString()}`
}
