/**
 * @jest-environment jsdom
 */
import { renderHook, waitFor } from '@testing-library/react'
import { MAX_WINDOW_ITEMS, mergeInteractionPayloads, useCalendarItems } from '../useCalendarItems'
import type { CalendarInteractionPayload } from '../types'

const apiCallMock = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
}))

function interaction(id: string, scheduledAt: string): CalendarInteractionPayload {
  return {
    id,
    interactionType: 'meeting',
    title: `Meeting ${id}`,
    status: 'planned',
    scheduledAt,
    durationMinutes: 60,
    recurrenceRule: 'FREQ=WEEKLY',
  }
}

const range = {
  from: new Date('2026-08-03T00:00:00.000Z'),
  to: new Date('2026-08-09T23:59:59.999Z'),
}

function windowInteractions(count: number): CalendarInteractionPayload[] {
  return Array.from({ length: count }, (_, index) => ({
    ...interaction(`window-${index}`, '2026-08-03T10:00:00.000Z'),
    recurrenceRule: null,
  }))
}

function mockCalendarPages(
  windowItems: CalendarInteractionPayload[],
  recurringItems: CalendarInteractionPayload[] = [],
) {
  apiCallMock.mockImplementation(async (url: string) => {
    if (url === '/api/customers/dictionaries/activity-types') {
      return { ok: true, status: 200, result: { items: [] } }
    }
    const params = new URL(url, 'http://localhost').searchParams
    const candidates = params.has('recurrenceMasters') ? recurringItems : windowItems
    const offset = Number(params.get('cursor') ?? 0)
    const end = offset + Number(params.get('limit'))
    return {
      ok: true,
      status: 200,
      result: {
        items: candidates.slice(offset, end),
        nextCursor: end < candidates.length ? String(end) : undefined,
      },
    }
  })
}

describe('useCalendarItems window budget', () => {
  beforeEach(() => {
    apiCallMock.mockReset()
  })

  test('stops following cursors at the default limit and reports an incomplete window', async () => {
    mockCalendarPages(windowInteractions(501))

    const { result } = renderHook(() => useCalendarItems(range))

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.items).toHaveLength(500)
    expect(result.current.truncated).toBe(true)
    expect(apiCallMock.mock.calls.some(([url]) => String(url).includes('cursor=500'))).toBe(false)
  })
})

describe('useCalendarItems recurring masters (#4735)', () => {
  beforeEach(() => {
    apiCallMock.mockReset()
  })

  test('fetches recurring masters outside the visible window and expands them into it', async () => {
    const master = interaction('series-1', '2026-07-27T10:00:00.000Z')
    apiCallMock.mockImplementation(async (url: unknown) => {
      const requestUrl = String(url)
      if (requestUrl === '/api/customers/dictionaries/activity-types') {
        return { ok: true, status: 200, result: { items: [] } }
      }
      if (requestUrl.includes('recurrenceMasters=true')) {
        return { ok: true, status: 200, result: { items: [master] } }
      }
      return { ok: true, status: 200, result: { items: [] } }
    })

    const { result } = renderHook(() => useCalendarItems({
      from: new Date('2026-08-03T00:00:00.000Z'),
      to: new Date('2026-08-09T23:59:59.999Z'),
    }))

    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(apiCallMock.mock.calls.some(([url]) => String(url).includes('recurrenceMasters=true'))).toBe(true)
    expect(result.current.error).toBeNull()
    expect(result.current.items).toHaveLength(1)
    expect(result.current.items[0]?.id).toBe('series-1:1')
    expect(result.current.items[0]?.start.toISOString()).toBe('2026-08-03T10:00:00.000Z')
  })

  test('deduplicates masters already returned by the regular window query', () => {
    const inWindow = interaction('series-1', '2026-08-03T10:00:00.000Z')
    const duplicate = { ...inWindow, title: 'Duplicate copy' }
    const olderMaster = interaction('series-2', '2026-07-27T12:00:00.000Z')

    const result = mergeInteractionPayloads([inWindow], [duplicate, olderMaster])

    expect(result.truncated).toBe(false)
    expect(result.payloads).toEqual([inWindow, olderMaster])
  })

  test('reserves capped result space for recurring masters while keeping the regular copy of duplicates', () => {
    const windowPayloads = Array.from({ length: MAX_WINDOW_ITEMS }, (_, index) =>
      interaction(`window-${index}`, '2026-08-03T10:00:00.000Z'),
    )
    const recurringOnly = interaction('master-only', '2026-07-27T12:00:00.000Z')
    const duplicate = { ...windowPayloads[0]!, title: 'Duplicate copy' }

    const result = mergeInteractionPayloads(windowPayloads, [duplicate, recurringOnly])

    expect(result.truncated).toBe(true)
    expect(result.payloads).toHaveLength(MAX_WINDOW_ITEMS)
    expect(result.payloads[0]).toBe(windowPayloads[0])
    expect(result.payloads).toContain(recurringOnly)
  })
})
