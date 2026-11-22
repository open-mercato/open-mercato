import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { fetchScopedCalendarAppointments, MAX_WINDOW_ITEMS } from '../interactionCandidates'
import type { CalendarInteractionPayload } from '../interactionPayload'
import { defaultCalendarTimezone } from '../timezone'

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({ apiCall: jest.fn() }))

const apiCallMock = jest.mocked(apiCall)
const userId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'

function appointment(id: string, scheduledAt: string, overrides: Partial<CalendarInteractionPayload> = {}): CalendarInteractionPayload {
  return { id, scheduledAt, interactionType: 'meeting', status: 'planned', title: id, ...overrides }
}

function mockPages(respond: (query: URLSearchParams) => unknown) {
  apiCallMock.mockImplementation(async (url) => {
    const query = new URL(String(url), 'http://localhost').searchParams
    return { ok: true, status: 200, result: respond(query) } as Awaited<ReturnType<typeof apiCall>>
  })
}

function load(from: string, to: string, signal = new AbortController().signal) {
  return fetchScopedCalendarAppointments({ userId, organizationId, from: new Date(from), to: new Date(to), signal })
}

beforeEach(() => {
  apiCallMock.mockReset()
})

it('scopes both candidate paths, expands older masters and keeps only half-open appointment overlaps', async () => {
  const master = appointment('series', '2026-05-04T12:00:00.000Z', { recurrenceRule: 'FREQ=WEEKLY', timezone: 'UTC' })
  mockPages((query) => query.has('recurrenceMasters') ? { items: [master] } : {
    items: [
      master,
      appointment('too-early', '2026-05-11T09:30:00.000Z'),
      appointment('at-end', '2026-05-11T18:00:00.000Z'),
      appointment('during', '2026-05-11T11:00:00.000Z', { status: 'done' }),
      appointment('canceled', '2026-05-11T14:00:00.000Z', { status: 'canceled' }),
      appointment('log', '', { scheduledAt: null, occurredAt: '2026-05-11T15:00:00.000Z', status: 'done' }),
    ],
  })
  const controller = new AbortController()

  const result = await load('2026-05-11T10:00:00Z', '2026-05-11T18:00:00Z', controller.signal)

  expect(result?.items.map(({ id }) => id)).toEqual(['during', 'series:1'])
  expect(result?.truncated).toBe(false)
  expect(apiCallMock.mock.calls.map(([url, init]) => {
    const query = new URL(String(url), 'http://localhost').searchParams
    expect(init?.signal).toBe(controller.signal)
    expect(query.get('organizationId')).toBe(organizationId)
    expect(query.get('actorUserId')).toBe(userId)
    expect(query.get('overlap')).toBe('true')
    expect(query.get('overlapTimezone')).toBe(defaultCalendarTimezone())
    expect(query.get('excludeStatus')).toBe('canceled')
    return query.get('recurrenceMasters')
  })).toEqual([null, 'true'])
})

it('uses the exact next local midnight for all-day appointments across DST', async () => {
  mockPages((query) => ({
    items: query.has('recurrenceMasters') ? [] : [
      appointment('all-day', '2026-11-01T17:00:00.000Z', { allDay: true, timezone: 'America/New_York' }),
    ],
  }))

  const result = await load('2026-11-01T04:00:00Z', '2026-11-02T05:00:00Z')

  expect(result?.items).toEqual([{
    id: 'all-day',
    title: 'all-day',
    start: new Date('2026-11-01T04:00:00Z'),
    end: new Date('2026-11-02T05:00:00Z'),
    allDay: true,
  }])
  const adjacentResult = await load('2026-11-02T05:00:00Z', '2026-11-02T06:00:00Z')
  expect(adjacentResult).toEqual({ items: [], truncated: false })
})

it('splits a long range and deduplicates a spanning occurrence with the same stable ID', async () => {
  const spanning = appointment('spanning', '2026-01-31T23:00:00.000Z', {
    timezone: 'UTC',
    durationMinutes: 120,
    recurrenceRule: 'FREQ=DAILY;COUNT=1',
  })
  mockPages(() => ({ items: [spanning] }))

  const result = await load('2026-01-01T00:00:00Z', '2026-02-02T00:00:00Z')

  expect(apiCallMock.mock.calls).toHaveLength(4)
  expect(result?.items.map(({ id }) => id)).toEqual(['spanning:0'])
  expect(result?.truncated).toBe(false)
})

it('reports a partial result when the scoped candidate page cap is reached', async () => {
  mockPages((query) => {
    if (query.has('recurrenceMasters')) return { items: [] }
    const page = Number(query.get('cursor') ?? 0)
    return {
      items: Array.from({ length: 100 }, (_, index) =>
        appointment(`page-${page}-${index}`, '2026-05-11T11:00:00.000Z')),
      nextCursor: String(page + 1),
    }
  })

  const result = await load('2026-05-11T10:00:00Z', '2026-05-11T18:00:00Z')

  expect(result?.items).toHaveLength(MAX_WINDOW_ITEMS)
  expect(result?.truncated).toBe(true)
  expect(apiCallMock.mock.calls).toHaveLength(6)
})

it('reports a partial result when one series exceeds the occurrence limit', async () => {
  const master = appointment('long-series', '2026-01-01T12:00:00.000Z', {
    recurrenceRule: 'FREQ=DAILY',
    timezone: 'UTC',
    durationMinutes: 160 * 24 * 60,
  })
  mockPages((query) => ({ items: query.has('recurrenceMasters') ? [master] : [] }))

  const result = await load('2026-06-05T10:00:00Z', '2026-06-05T18:00:00Z')

  expect(result?.items).toHaveLength(100)
  expect(result?.truncated).toBe(true)
})

it.each([403, 404])('treats a %s response as unavailable', async (status) => {
  apiCallMock.mockResolvedValue({ ok: false, status, result: null, response: new Response(null, { status }) })
  await expect(load('2026-05-11T10:00:00Z', '2026-05-11T18:00:00Z')).resolves.toBeNull()
})

it('treats a malformed successful response as unavailable', async () => {
  mockPages(() => ({}))
  await expect(load('2026-05-11T10:00:00Z', '2026-05-11T18:00:00Z')).resolves.toBeNull()
})

it('does not fetch an aborted request', async () => {
  const controller = new AbortController()
  controller.abort()
  await expect(load('2026-05-11T10:00:00Z', '2026-05-11T18:00:00Z', controller.signal)).resolves.toBeNull()
  expect(apiCallMock).not.toHaveBeenCalled()
})
