/**
 * @jest-environment jsdom
 */
import { act, renderHook } from '@testing-library/react'
import { createDefaultFormState, KIND_CONFIG } from '../../../../lib/calendar/editorPayload'
import { useConflictProbe } from '../hooks'

const apiCallMock = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
}))

const mockTranslate = (key: string, fallback?: string, params?: Record<string, string>) =>
  (fallback ?? key).replace(/\{(\w+)\}/g, (match, name: string) => params?.[name] ?? match)

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({ useT: () => mockTranslate }))

describe('useConflictProbe recurring candidates (#4735)', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    apiCallMock.mockReset()
    apiCallMock.mockResolvedValue({ ok: true, status: 200, result: { items: [] } })
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  test('probes the selected-zone instant and clears the warning when the zone changes', async () => {
    apiCallMock.mockResolvedValue({ ok: true, status: 200, result: { items: [{ id: 'conflict', interactionType: 'meeting', title: 'Same instant', status: 'planned', scheduledAt: '2026-09-29T07:15:00Z', durationMinutes: 60, ownerUserId: 'actor' }] } })
    const form = { ...createDefaultFormState(), timezone: 'Europe/Warsaw', date: '2026-09-29', startTime: '09:15', endDate: '2026-09-29', endTime: '10:15' }
    const { result, rerender, unmount } = renderHook(({ timezone }) => useConflictProbe(true, { ...form, timezone }, KIND_CONFIG.meeting, null, 'actor', 'all', null), { initialProps: { timezone: 'Europe/Warsaw' } })
    await act(async () => { await jest.advanceTimersByTimeAsync(500) })
    expect(result.current).not.toBeNull()
    rerender({ timezone: 'UTC' })
    await act(async () => { await jest.advanceTimersByTimeAsync(500) })
    expect(result.current).toBeNull()
    unmount()
  })

  test('warns about a shared resource and names who and what is double-booked', async () => {
    apiCallMock.mockResolvedValue({ ok: true, status: 200, result: { items: [{
      id: 'booked', interactionType: 'visit', title: 'Site visit', status: 'planned', scheduledAt: '2026-09-29T07:15:00Z', durationMinutes: 60,
      participants: [{ userId: 'alex', name: 'Alex Chen' }],
      linkedEntities: [{ id: 'room-1', type: 'resource', label: 'Focus Room 1' }],
    }] } })
    const form = { ...createDefaultFormState(), timezone: 'Europe/Warsaw', date: '2026-09-29', startTime: '09:15', endDate: '2026-09-29', endTime: '10:15' }
    const room = [{ id: 'room-1', label: 'Focus Room 1' }]
    const { result, rerender, unmount } = renderHook(
      ({ participants, resources }) => useConflictProbe(true, { ...form, participants }, KIND_CONFIG.event, null, null, 'all', null, resources),
      { initialProps: { participants: [] as typeof form.participants, resources: [] as typeof room } },
    )
    await act(async () => { await jest.advanceTimersByTimeAsync(500) })
    expect(result.current).toBeNull()
    rerender({ participants: [], resources: room })
    await act(async () => { await jest.advanceTimersByTimeAsync(500) })
    expect(result.current).toContain('Site visit (Focus Room 1)')
    rerender({ participants: [{ userId: 'alex', name: 'Alex Chen', isCustomer: false }], resources: room })
    await act(async () => { await jest.advanceTimersByTimeAsync(500) })
    expect(result.current).toContain('Site visit (Alex Chen, Focus Room 1)')
    unmount()
  })

  test('fetches recurring masters so the editor probes the same candidate set as the grid', async () => {
    const form = {
      ...createDefaultFormState(new Date(2026, 7, 5), new Date(2026, 7, 5, 9, 0, 0)),
      date: '2026-08-05',
      startTime: '10:00',
      endDate: '2026-08-05',
      endTime: '11:00',
    }

    const { unmount } = renderHook(() =>
      useConflictProbe(true, form, KIND_CONFIG.meeting, null, null, 'all', null),
    )

    await act(async () => {
      await jest.advanceTimersByTimeAsync(500)
    })

    const interactionUrls = apiCallMock.mock.calls.map(([url]) => String(url))
    expect(interactionUrls).toHaveLength(2)
    expect(interactionUrls.some((url) => url.includes('recurrenceMasters=true'))).toBe(true)
    expect(interactionUrls.some((url) => !url.includes('recurrenceMasters=true'))).toBe(true)
    unmount()
  })
})
