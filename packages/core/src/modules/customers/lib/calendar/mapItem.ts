import { addMinutes } from 'date-fns/addMinutes'
import { endOfDay } from 'date-fns/endOfDay'
import { startOfDay } from 'date-fns/startOfDay'
import type {
  CalendarInteractionPayload,
  CalendarItem,
  CalendarItemStatus,
  CalendarLocationKind,
  CalendarParticipant,
  CalendarPlatform,
} from '../../components/calendar/types'
import { categoryOf } from './categories'
import { participantActorKey } from './participantIdentity'
import { calendarDayEndInstant, calendarDayStartInstant, calendarInstantToWallTime, isCalendarTimezone } from './timezone'

const DEFAULT_DURATION_MINUTES = 30

function narrowStatus(status: string): CalendarItemStatus {
  if (status === 'done') return 'done'
  if (status === 'canceled') return 'canceled'
  return 'planned'
}

export function detectPlatform(location: string | null): CalendarPlatform | null {
  if (!location) return null
  const normalized = location.toLowerCase()
  if (normalized.includes('zoom.us') || normalized.includes('zoom')) return 'zoom'
  if (normalized.includes('meet.google') || normalized.includes('on meet')) return 'meet'
  if (normalized.includes('slack')) return 'slack'
  if (normalized.includes('teams')) return 'teams'
  return null
}

function detectLocationKind(location: string | null, platform: CalendarPlatform | null): CalendarLocationKind | null {
  if (!location) return null
  const normalized = location.trim().toLowerCase()
  if (normalized.startsWith('http') || normalized.startsWith('www')) return 'url'
  if (platform) return 'platform'
  return 'venue'
}

function mapParticipants(payload: CalendarInteractionPayload): CalendarParticipant[] {
  const participants = payload.participants
  if (!Array.isArray(participants)) return []
  const seen = new Set<string>()
  const mapped: CalendarParticipant[] = []
  for (const participant of participants) {
    const dedupeKey = participantActorKey(participant)
    if (dedupeKey) {
      if (seen.has(dedupeKey)) continue
      seen.add(dedupeKey)
    }
    const entry: CalendarParticipant = {}
    if (typeof participant.userId === 'string') entry.userId = participant.userId
    if (typeof participant.name === 'string') entry.name = participant.name
    if (typeof participant.email === 'string') entry.email = participant.email
    if (typeof participant.status === 'string') entry.status = participant.status
    mapped.push(entry)
  }
  return mapped
}

export function mapInteractionToCalendarItem(
  payload: CalendarInteractionPayload,
  typeColorByType: Record<string, string | null>,
): CalendarItem | null {
  const effectiveStartRaw = payload.occurredAt ?? payload.scheduledAt ?? null
  if (!effectiveStartRaw) return null
  const parsedStart = new Date(effectiveStartRaw)
  if (Number.isNaN(parsedStart.getTime())) return null

  const allDay = payload.allDay === true
  const durationMinutes = payload.durationMinutes ?? DEFAULT_DURATION_MINUTES
  const eventDate = allDay && isCalendarTimezone(payload.timezone) ? calendarInstantToWallTime(parsedStart, payload.timezone).date : null
  const start = eventDate ? calendarDayStartInstant(eventDate, payload.timezone as string) : allDay ? startOfDay(parsedStart) : parsedStart
  const end = eventDate ? calendarDayEndInstant(eventDate, payload.timezone as string) : allDay ? endOfDay(parsedStart) : addMinutes(parsedStart, durationMinutes)

  if (!start || !end) return null

  const location = payload.location ?? null
  const platform = detectPlatform(location)

  return {
    id: payload.id,
    title: payload.title ?? '',
    interactionType: payload.interactionType,
    category: categoryOf(payload.interactionType),
    status: narrowStatus(payload.status),
    start,
    end,
    allDay,
    location,
    platform,
    locationKind: detectLocationKind(location, platform),
    participants: mapParticipants(payload),
    ownerUserId: payload.ownerUserId ?? null,
    entityId: payload.entityId ?? null,
    dealId: payload.dealId ?? null,
    color: payload.appearanceColor ?? typeColorByType[payload.interactionType] ?? null,
    isRecurringOccurrence: false,
    updatedAt: payload.updatedAt ?? null,
    raw: payload,
  }
}
