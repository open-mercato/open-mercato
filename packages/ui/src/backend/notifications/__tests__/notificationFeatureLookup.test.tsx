/** @jest-environment jsdom */

import type { ReactNode } from 'react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { act, renderHook, waitFor } from '@testing-library/react'
import { apiCall } from '../../utils/apiCall'
import { dispatchNotificationHandlers, getRequiredNotificationHandlerFeatures } from '../NotificationDispatcher'
import { useNotificationsPoll } from '../useNotificationsPoll'
import { useNotificationsSse } from '../useNotificationsSse'

jest.mock('../../utils/apiCall')
jest.mock('../../injection/useAppEvent')
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
