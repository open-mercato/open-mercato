import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { calendarWallTimeToInstant } from '@open-mercato/core/modules/customers/lib/calendar/timezone'

export type VisitAvailabilitySubject = {
  type: 'staff' | 'resource'
  id: string
  status: 'available' | 'unavailable' | 'unknown'
  reasonKey: string | null
  displayName?: string | null
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
  const interactionId = typeof values.id === 'string' ? values.id.split(':')[0] : ''
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(interactionId)) query.set('excludeInteractionId', interactionId)
  const staffUserIds = selectedIds(values.participants, 'staff')
  const resourceIds = selectedIds(values.resources, 'resource')
  if (staffUserIds.length) query.set('staffUserIds', staffUserIds.join(','))
  if (resourceIds.length) query.set('resourceIds', resourceIds.join(','))
  return `/api/example/visit-availability?${query.toString()}`
}

function displayLabel(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  const label = value.trim()
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(label) ? null : label
}

export function visitAvailabilitySubjectMessage(subject: VisitAvailabilitySubject, values: Readonly<Record<string, unknown>>, translate: TranslateFn): string {
  const selected = subject.type === 'staff' ? values.participants : values.resources
  const selection = Array.isArray(selected) ? selected.find((entry: unknown) => {
    if (!entry || typeof entry !== 'object') return false
    const item = entry as Record<string, unknown>
    return (subject.type === 'staff' ? item.userId : item.id) === subject.id
  }) as Record<string, unknown> | undefined : undefined
  const name = displayLabel(subject.displayName) ?? displayLabel(selection?.name) ?? displayLabel(selection?.label)
    ?? translate(`example.calendar.visitAvailability.${subject.type === 'staff' ? 'unnamedStaff' : 'unnamedResource'}`)
  const reasonKey = subject.reasonKey === 'example.calendar.visitAvailability.unavailable' ? 'example.calendar.visitAvailability.outsideHours' : subject.reasonKey
  const reason = translate(reasonKey ?? `example.calendar.visitAvailability.${subject.status === 'unknown' ? 'unknown' : 'unavailable'}`)
  return translate('example.calendar.visitAvailability.namedReason', { name, reason })
}
