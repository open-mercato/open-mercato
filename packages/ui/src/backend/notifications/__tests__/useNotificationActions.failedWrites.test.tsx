jest.mock('../../utils/api', () => ({
  apiFetch: jest.fn(),
}))

import { act, renderHook } from '@testing-library/react'
import * as React from 'react'
import type { NotificationDto } from '@open-mercato/shared/modules/notifications/types'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { apiFetch } from '../../utils/api'
import { useNotificationActions } from '../useNotificationActions'

function I18nWrapper({ children }: { children: React.ReactNode }) {
  return React.createElement(I18nProvider, { locale: 'en', dict: {} }, children)
}

function makeNotification(id: string): NotificationDto {
  return {
    id,
    type: 'example.test',
    title: `title-${id}`,
    severity: 'info',
    status: 'unread',
    actions: [],
    createdAt: new Date('2026-01-01T00:00:00.000Z').toISOString(),
  }
}

function mockResponse(status: number): Response {
  const ok = status >= 200 && status < 300
  const body = ok ? '{}' : JSON.stringify({ error: 'boom' })
  return {
    ok,
    status,
    headers: new Map<string, string>(),
    text: jest.fn(async () => body),
    clone: () => mockResponse(status),
  } as unknown as Response
}

function setFetchResult(status: number) {
  ;(apiFetch as jest.Mock).mockResolvedValue(mockResponse(status))
}

function renderActions(notifications: NotificationDto[]) {
  const setNotifications = jest.fn()
  const setUnreadCount = jest.fn()
  const hook = renderHook(
    () => useNotificationActions(notifications, setNotifications, setUnreadCount),
    { wrapper: I18nWrapper },
  )
  return { hook, setNotifications, setUnreadCount }
}

async function callAndCaptureRejection(run: () => Promise<unknown>): Promise<boolean> {
  let rejected = false
  await act(async () => {
    try {
      await run()
    } catch {
      rejected = true
    }
  })
  return rejected
}

describe('useNotificationActions — failed API writes leave local state unchanged', () => {
  beforeEach(() => {
    jest.resetAllMocks()
  })

  it('markAsRead surfaces the error and does not mutate state when the write fails', async () => {
    setFetchResult(500)
    const { hook, setNotifications, setUnreadCount } = renderActions([makeNotification('n1')])

    const rejected = await callAndCaptureRejection(() => hook.result.current.markAsRead('n1'))

    expect(rejected).toBe(true)
    expect(setNotifications).not.toHaveBeenCalled()
    expect(setUnreadCount).not.toHaveBeenCalled()
  })

  it('dismiss surfaces the error and does not mutate state when the write fails', async () => {
    setFetchResult(500)
    const { hook, setNotifications, setUnreadCount } = renderActions([makeNotification('n1')])

    const rejected = await callAndCaptureRejection(() => hook.result.current.dismiss('n1'))

    expect(rejected).toBe(true)
    expect(setNotifications).not.toHaveBeenCalled()
    expect(setUnreadCount).not.toHaveBeenCalled()
    expect(hook.result.current.dismissUndo).toBeNull()
  })

  it('undoDismiss (restore) surfaces the error and preserves the undo banner when the write fails', async () => {
    const { hook, setNotifications, setUnreadCount } = renderActions([makeNotification('n1')])

    setFetchResult(200)
    await act(async () => {
      await hook.result.current.dismiss('n1')
    })
    expect(hook.result.current.dismissUndo).not.toBeNull()

    setNotifications.mockClear()
    setUnreadCount.mockClear()
    setFetchResult(500)

    const rejected = await callAndCaptureRejection(() => hook.result.current.undoDismiss())

    expect(rejected).toBe(true)
    expect(setNotifications).not.toHaveBeenCalled()
    expect(setUnreadCount).not.toHaveBeenCalled()
    expect(hook.result.current.dismissUndo).not.toBeNull()
  })

  it('markAllRead surfaces the error and does not mutate state when the write fails', async () => {
    setFetchResult(500)
    const { hook, setNotifications, setUnreadCount } = renderActions([makeNotification('n1')])

    const rejected = await callAndCaptureRejection(() => hook.result.current.markAllRead())

    expect(rejected).toBe(true)
    expect(setNotifications).not.toHaveBeenCalled()
    expect(setUnreadCount).not.toHaveBeenCalled()
  })
})
