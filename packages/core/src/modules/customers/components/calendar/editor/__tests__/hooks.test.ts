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

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (_key: string, fallback?: string) => fallback ?? _key,
}))

describe('useConflictProbe recurring candidates (#4735)', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    apiCallMock.mockReset()
    apiCallMock.mockResolvedValue({ ok: true, status: 200, result: { items: [] } })
  })

  afterEach(() => {
    jest.useRealTimers()
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
