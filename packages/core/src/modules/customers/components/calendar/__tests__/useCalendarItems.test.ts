/**
 * @jest-environment jsdom
 */
import { renderHook, waitFor } from '@testing-library/react'
import { fetchCalendarCandidates, MAX_WINDOW_ITEMS, mergeInteractionPayloads, useCalendarItems } from '../useCalendarItems'
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

  test('reloads with a higher limit and retrieves the next page', async () => {
    mockCalendarPages(windowInteractions(501))

    const { result, rerender } = renderHook(({ maxItems }) => useCalendarItems(range, { maxItems }), {
      initialProps: { maxItems: MAX_WINDOW_ITEMS },
    })

    await waitFor(() => expect(result.current.items).toHaveLength(500))
    const initialRead = apiCallMock.mock.calls.find(([url]) => String(url).startsWith('/api/customers/interactions?'))
    const initialSignal: AbortSignal = initialRead?.[1].signal

    rerender({ maxItems: 2000 })

    await waitFor(() => expect(result.current.items).toHaveLength(501))
    expect(initialSignal.aborted).toBe(true)
    expect(result.current.truncated).toBe(false)
    expect(result.current.items.some((item) => item.id === 'window-500')).toBe(true)
    expect(apiCallMock.mock.calls.some(([url]) => String(url).includes('limit=100&cursor=500'))).toBe(true)

    const requestCount = apiCallMock.mock.calls.length
    rerender({ maxItems: 2000 })
    expect(apiCallMock).toHaveBeenCalledTimes(requestCount)
  })

  test.each([0, -1, 2.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'uses the default budget for invalid maxItems %s',
    async (maxItems) => {
      mockCalendarPages(windowInteractions(501))

      const { result } = renderHook(() => useCalendarItems(range, { maxItems }))

      await waitFor(() => expect(result.current.isLoading).toBe(false))
      expect(result.current.items).toHaveLength(500)
      expect(result.current.truncated).toBe(true)
    },
  )

  test.each([[2, true], [3, false]])(
    'reports truncation based on whether the final page fits a budget of %s',
    async (maxItems, truncated) => {
      mockCalendarPages(windowInteractions(3))

      const result = await fetchCalendarCandidates(range, undefined, maxItems)

      expect(result.payloads).toHaveLength(maxItems)
      expect(result.truncated).toBe(truncated)
    },
  )

  test('uses the larger budget for recurring masters as well as the regular window', async () => {
    const recurringItems = Array.from({ length: 501 }, (_, index) =>
      interaction(`master-${index}`, '2026-07-27T10:00:00.000Z'),
    )
    mockCalendarPages([], recurringItems)

    const result = await fetchCalendarCandidates(range, undefined, 2000)

    expect(result.payloads).toEqual(recurringItems)
    expect(result.truncated).toBe(false)
  })

  test('applies the budget to the combined result after deduplicating', async () => {
    const regularCopy = interaction('in-window', '2026-08-03T10:00:00.000Z')
    const duplicate = { ...regularCopy, title: 'Duplicate copy' }
    const olderMaster = interaction('old-master', '2026-07-27T10:00:00.000Z')
    mockCalendarPages([regularCopy, ...windowInteractions(1)], [duplicate, olderMaster])

    const result = await fetchCalendarCandidates(range, undefined, 2)

    expect(result.payloads).toEqual([regularCopy, olderMaster])
    expect(result.truncated).toBe(true)
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
