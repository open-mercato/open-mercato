/** @jest-environment jsdom */

import type { ReactNode } from 'react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { act, renderHook, waitFor } from '@testing-library/react'
import { apiCall } from '../../utils/apiCall'
import { APP_EVENT_DOM_NAME, BRIDGE_RECONNECTED_EVENT_ID } from '../../injection/useAppEvent'
import { dispatchNotificationHandlers, getRequiredNotificationHandlerFeatures } from '../NotificationDispatcher'
import { useNotificationHandlerFeatures } from '../useNotificationHandlerFeatures'
import { useNotificationsPoll } from '../useNotificationsPoll'
import { useNotificationsSse } from '../useNotificationsSse'

jest.mock('../../utils/apiCall')
jest.mock('../NotificationDispatcher')

const feature = 'example.notifications'
const notification = {
  id: 'notification',
  type: 'example.test',
  status: 'unread',
}
const mockApiCall = jest.mocked(apiCall)
const mockDispatch = jest.mocked(dispatchNotificationHandlers)

it.each([
  ['poll', useNotificationsPoll],
  ['SSE', useNotificationsSse],
] as const)('%s keeps grants empty after rejection and recovers online', async (_transport, useNotifications) => {
  jest.clearAllMocks()
  jest.mocked(getRequiredNotificationHandlerFeatures).mockReturnValue([feature])
  const checkFeatures = jest.fn()
    .mockRejectedValueOnce(new TypeError('Failed to fetch'))
    .mockResolvedValueOnce({ ok: true, result: { granted: [feature] } })
  mockApiCall.mockImplementation(async (url) => {
    if (url === '/api/auth/feature-check') return checkFeatures()
    const result = url === '/api/notifications/unread-count'
      ? { unreadCount: 1 }
      : { items: [notification] }
    return { ok: true, result } as Awaited<ReturnType<typeof apiCall<typeof result>>>
  })

  const { result } = renderHook(useNotifications, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <I18nProvider locale="en" dict={{}}>{children}</I18nProvider>
    ),
  })
  await waitFor(() => expect(result.current.isLoading).toBe(false))
  expect(checkFeatures).toHaveBeenCalledTimes(1)
  expect(mockDispatch).toHaveBeenLastCalledWith([notification], expect.objectContaining({ features: [] }))

  await act(async () => {
    window.dispatchEvent(new Event('online'))
  })
  expect(checkFeatures).toHaveBeenCalledTimes(2)

  await act(async () => {
    result.current.refresh()
  })
  expect(mockDispatch).toHaveBeenLastCalledWith([notification], expect.objectContaining({ features: [feature] }))
})

it('replays SSE reconnect results after a failed reconnect lookup recovers while still online', async () => {
  jest.useFakeTimers()
  try {
    jest.clearAllMocks()
    jest.mocked(getRequiredNotificationHandlerFeatures).mockReturnValue([feature])
    let completeFeatureLookup: (response: { ok: true; result: { granted: string[] } }) => void = () => {
      throw new Error('[internal] Expected the scheduled feature lookup')
    }
    const checkFeatures = jest.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce({ ok: false })
      .mockImplementationOnce(() => new Promise((resolve) => { completeFeatureLookup = resolve }))
    const listNotifications = jest.fn()
      .mockReturnValueOnce([])
      .mockReturnValueOnce([notification])
    mockApiCall.mockImplementation(async (url) => {
      if (url === '/api/auth/feature-check') return checkFeatures()
      const result = url === '/api/notifications/unread-count'
        ? { unreadCount: 1 }
        : { items: listNotifications() }
      return { ok: true, result } as Awaited<ReturnType<typeof apiCall<typeof result>>>
    })

    renderHook(useNotificationsSse, {
      wrapper: ({ children }: { children: ReactNode }) => (
        <I18nProvider locale="en" dict={{}}>{children}</I18nProvider>
      ),
    })
    await act(async () => {})
    await act(async () => {
      window.dispatchEvent(new Event('online'))
      window.dispatchEvent(new CustomEvent(APP_EVENT_DOM_NAME, {
        detail: { id: BRIDGE_RECONNECTED_EVENT_ID },
      }))
    })
    expect(checkFeatures).toHaveBeenCalledTimes(2)
    expect(mockDispatch).toHaveBeenLastCalledWith([notification], expect.objectContaining({ features: [] }))

    await act(async () => { jest.advanceTimersToNextTimer() })
    expect(checkFeatures).toHaveBeenCalledTimes(3)
    await act(async () => { completeFeatureLookup({ ok: true, result: { granted: [feature] } }) })
    expect(mockDispatch).toHaveBeenLastCalledWith([notification], expect.objectContaining({ features: [feature] }))
    expect(listNotifications).toHaveBeenCalledTimes(2)
  } finally {
    jest.useRealTimers()
  }
})

it('bounds retries until the next focus event and cancels pending retries on unmount', async () => {
  jest.useFakeTimers()
  try {
    jest.clearAllMocks()
    jest.mocked(getRequiredNotificationHandlerFeatures).mockReturnValue([feature])
    mockApiCall.mockRejectedValue(new TypeError('Failed to fetch'))
    const { unmount } = renderHook(useNotificationHandlerFeatures)
    await act(async () => {})
    await act(async () => { window.dispatchEvent(new Event('online')) })

    for (const delay of [1000, 2000, 4000, 60_000]) {
      await act(async () => { jest.advanceTimersByTime(delay) })
    }
    expect(mockApiCall).toHaveBeenCalledTimes(5)

    await act(async () => { window.dispatchEvent(new Event('focus')) })
    expect(mockApiCall).toHaveBeenCalledTimes(6)
    unmount()
    await act(async () => {
      window.dispatchEvent(new Event('online'))
      jest.advanceTimersByTime(60_000)
    })
    expect(mockApiCall).toHaveBeenCalledTimes(6)
  } finally {
    jest.useRealTimers()
  }
})
