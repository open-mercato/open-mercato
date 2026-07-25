import { calendarInteractionPayloadSchema } from '../../../components/calendar/types'
import { detectPlatform, mapInteractionToCalendarItem } from '../mapItem'
import { makePayload } from './fixtures'

const noColors: Record<string, string | null> = {}

describe('mapInteractionToCalendarItem', () => {
  it('returns null when both occurredAt and scheduledAt are missing', () => {
    const payload = makePayload({ id: 'no-dates', scheduledAt: null, occurredAt: null })
    expect(mapInteractionToCalendarItem(payload, noColors)).toBeNull()
  })

  it('returns null for an unparseable effective date', () => {
    const payload = makePayload({ id: 'bad-date', scheduledAt: 'not-a-date', occurredAt: null })
    expect(mapInteractionToCalendarItem(payload, noColors)).toBeNull()
  })

  it('prefers occurredAt over scheduledAt as the effective start', () => {
    const payload = makePayload({
      id: 'occurred-wins',
      scheduledAt: '2026-06-11T08:00:00.000Z',
      occurredAt: '2026-06-11T10:00:00.000Z',
    })
    const item = mapInteractionToCalendarItem(payload, noColors)
    expect(item?.start.toISOString()).toBe('2026-06-11T10:00:00.000Z')
  })

  it('defaults the duration to 30 minutes', () => {
    const payload = makePayload({ id: 'default-duration', durationMinutes: null })
    const item = mapInteractionToCalendarItem(payload, noColors)
    expect(item).not.toBeNull()
    expect(item!.end.getTime() - item!.start.getTime()).toBe(30 * 60 * 1000)
  })

  it('applies an explicit duration', () => {
    const payload = makePayload({ id: 'explicit-duration', durationMinutes: 90 })
    const item = mapInteractionToCalendarItem(payload, noColors)
    expect(item!.end.getTime() - item!.start.getTime()).toBe(90 * 60 * 1000)
  })

  it('expands all-day items to the full local day', () => {
    const payload = makePayload({ id: 'all-day', allDay: true })
    const item = mapInteractionToCalendarItem(payload, noColors)
    expect(item!.allDay).toBe(true)
    expect(item!.start.getHours()).toBe(0)
    expect(item!.start.getMinutes()).toBe(0)
    expect(item!.end.getHours()).toBe(23)
    expect(item!.end.getMinutes()).toBe(59)
  })

  it('detects platforms and marks URLs as url locations', () => {
    const zoomUrl = mapInteractionToCalendarItem(
      makePayload({ id: 'zoom-url', location: 'https://zoom.us/j/123456' }),
      noColors,
    )
    expect(zoomUrl!.platform).toBe('zoom')
    expect(zoomUrl!.locationKind).toBe('url')

    const meetPhrase = mapInteractionToCalendarItem(
      makePayload({ id: 'meet-phrase', location: 'Catch-up on Meet' }),
      noColors,
    )
    expect(meetPhrase!.platform).toBe('meet')
    expect(meetPhrase!.locationKind).toBe('platform')

    const slackChannel = mapInteractionToCalendarItem(
      makePayload({ id: 'slack-channel', location: 'Slack huddle' }),
      noColors,
    )
    expect(slackChannel!.platform).toBe('slack')
    expect(slackChannel!.locationKind).toBe('platform')

    const teamsRoom = mapInteractionToCalendarItem(
      makePayload({ id: 'teams-room', location: 'Teams standup' }),
      noColors,
    )
    expect(teamsRoom!.platform).toBe('teams')
    expect(teamsRoom!.locationKind).toBe('platform')
  })

  it('marks www-prefixed links as urls without a platform', () => {
    const item = mapInteractionToCalendarItem(
      makePayload({ id: 'www-link', location: 'www.example.com/agenda' }),
      noColors,
    )
    expect(item!.platform).toBeNull()
    expect(item!.locationKind).toBe('url')
  })

  it('treats plain text locations as venues', () => {
    const item = mapInteractionToCalendarItem(
      makePayload({ id: 'venue', location: 'Office 12, Warsaw' }),
      noColors,
    )
    expect(item!.platform).toBeNull()
    expect(item!.locationKind).toBe('venue')
  })

  it('leaves platform and locationKind null without a location', () => {
    const item = mapInteractionToCalendarItem(makePayload({ id: 'no-location', location: null }), noColors)
    expect(item!.platform).toBeNull()
    expect(item!.locationKind).toBeNull()
  })

  it('prefers the item appearance color over the dictionary color', () => {
    const payload = makePayload({ id: 'own-color', interactionType: 'meeting', appearanceColor: '#123456' })
    const item = mapInteractionToCalendarItem(payload, { meeting: '#f59e0b' })
    expect(item!.color).toBe('#123456')
  })

  it('falls back to the dictionary color and then to null', () => {
    const fromDictionary = mapInteractionToCalendarItem(
      makePayload({ id: 'dict-color', interactionType: 'meeting', appearanceColor: null }),
      { meeting: '#f59e0b' },
    )
    expect(fromDictionary!.color).toBe('#f59e0b')

    const noColor = mapInteractionToCalendarItem(
      makePayload({ id: 'no-color', interactionType: 'custom-type', appearanceColor: null }),
      { meeting: '#f59e0b' },
    )
    expect(noColor!.color).toBeNull()
  })

  it('narrows statuses and keeps unknown values as planned', () => {
    expect(mapInteractionToCalendarItem(makePayload({ id: 's1', status: 'done' }), noColors)!.status).toBe('done')
    expect(mapInteractionToCalendarItem(makePayload({ id: 's2', status: 'canceled' }), noColors)!.status).toBe('canceled')
    expect(mapInteractionToCalendarItem(makePayload({ id: 's3', status: 'snoozed' }), noColors)!.status).toBe('planned')
  })

  it('maps participants and defaults missing arrays to empty', () => {
    const withParticipants = mapInteractionToCalendarItem(
      makePayload({
        id: 'participants',
        participants: [{ userId: 'user-1', name: 'Anna', email: 'anna@example.com' }, { userId: 'user-2' }],
      }),
      noColors,
    )
    expect(withParticipants!.participants).toEqual([
      { userId: 'user-1', name: 'Anna', email: 'anna@example.com' },
      { userId: 'user-2' },
    ])

    const withoutParticipants = mapInteractionToCalendarItem(
      makePayload({ id: 'no-participants', participants: null }),
      noColors,
    )
    expect(withoutParticipants!.participants).toEqual([])
  })

  it('drops duplicate participants by userId so avatar keys stay unique', () => {
    const item = mapInteractionToCalendarItem(
      makePayload({
        id: 'dup-participants',
        participants: [
          { userId: 'user-1', name: 'Anna' },
          { userId: 'user-1', name: 'Anna' },
          { userId: 'user-2', name: 'Tom' },
        ],
      }),
      noColors,
    )
    expect(item!.participants).toEqual([
      { userId: 'user-1', name: 'Anna' },
      { userId: 'user-2', name: 'Tom' },
    ])
  })

  it('derives the category and keeps payload references', () => {
    const payload = makePayload({
      id: 'full',
      interactionType: 'call',
      title: 'Quarterly review',
      entityId: 'entity-1',
      dealId: 'deal-1',
      ownerUserId: 'owner-1',
      updatedAt: '2026-06-10T12:00:00.000Z',
    })
    const item = mapInteractionToCalendarItem(payload, noColors)
    expect(item!.id).toBe('full')
    expect(item!.title).toBe('Quarterly review')
    expect(item!.category).toBe('meeting')
    expect(item!.entityId).toBe('entity-1')
    expect(item!.dealId).toBe('deal-1')
    expect(item!.ownerUserId).toBe('owner-1')
    expect(item!.updatedAt).toBe('2026-06-10T12:00:00.000Z')
    expect(item!.isRecurringOccurrence).toBe(false)
    expect(item!.raw).toBe(payload)
  })

  it('uses an empty title when the payload title is null', () => {
    const item = mapInteractionToCalendarItem(makePayload({ id: 'untitled', title: null }), noColors)
    expect(item!.title).toBe('')
  })
})

describe('calendarInteractionPayloadSchema', () => {
  it('accepts the documented list response item shape', () => {
    const parsed = calendarInteractionPayloadSchema.safeParse({
      id: 'b9f0f6f4-0000-4000-8000-000000000001',
      entityId: 'b9f0f6f4-0000-4000-8000-000000000002',
      dealId: null,
      interactionType: 'meeting',
      title: 'Kickoff',
      body: 'Agenda attached',
      status: 'planned',
      scheduledAt: '2026-06-12T09:00:00.000Z',
      occurredAt: null,
      priority: null,
      authorUserId: null,
      ownerUserId: 'b9f0f6f4-0000-4000-8000-000000000003',
      appearanceIcon: null,
      appearanceColor: '#f59e0b',
      source: null,
      duration: 45,
      durationMinutes: 45,
      location: 'https://meet.google.com/abc',
      allDay: false,
      recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO,WE,FR',
      recurrenceEnd: null,
      participants: [{ userId: 'b9f0f6f4-0000-4000-8000-000000000004', name: 'Anna' }],
      reminderMinutes: null,
      visibility: null,
      linkedEntities: null,
      guestPermissions: null,
      pinned: false,
      organizationId: 'b9f0f6f4-0000-4000-8000-000000000005',
      tenantId: 'b9f0f6f4-0000-4000-8000-000000000006',
      createdAt: '2026-06-01T08:00:00.000Z',
      updatedAt: '2026-06-01T08:00:00.000Z',
      authorName: null,
      authorEmail: null,
      dealTitle: null,
      customValues: null,
    })
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.durationMinutes).toBe(45)
      expect(parsed.data.participants?.[0]?.userId).toBe('b9f0f6f4-0000-4000-8000-000000000004')
    }
  })

  it('rejects rows without an id', () => {
    const parsed = calendarInteractionPayloadSchema.safeParse({ interactionType: 'meeting', status: 'planned' })
    expect(parsed.success).toBe(false)
  })
})

describe('detectPlatform', () => {
  it('matches the documented platform tokens', () => {
    expect(detectPlatform('https://zoom.us/j/1')).toBe('zoom')
    expect(detectPlatform('Zoom call')).toBe('zoom')
    expect(detectPlatform('https://meet.google.com/x')).toBe('meet')
    expect(detectPlatform('Sync on Meet')).toBe('meet')
    expect(detectPlatform('slack huddle')).toBe('slack')
    expect(detectPlatform('Microsoft Teams')).toBe('teams')
    expect(detectPlatform('Conference room B')).toBeNull()
    expect(detectPlatform(null)).toBeNull()
  })
})
