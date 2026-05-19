import { act, renderHook } from '@testing-library/react'
import type { NotificationDto } from '@open-mercato/shared/modules/notifications/types'
import { APP_EVENT_DOM_NAME } from '../../injection/useAppEvent'
import {
  __resetNotificationDispatcherForTests,
  dispatchNotificationHandlers,
} from '../NotificationDispatcher'
import { useNotificationEffect } from '../useNotificationEffect'

function makeNotification(id: string, type: string): NotificationDto {
  return {
    id,
    type,
    title: `title-${id}`,
    severity: 'info',
    status: 'unread',
    actions: [],
    createdAt: new Date().toISOString(),
  }
}

function dispatchNotificationCreated(notification: NotificationDto) {
  window.dispatchEvent(
    new CustomEvent(APP_EVENT_DOM_NAME, {
      detail: {
        id: 'notifications.notification.created',
        payload: { notification },
        timestamp: Date.now(),
        organizationId: 'org-1',
      },
    }),
  )
}

function runtime() {
  return {
    features: [],
    currentPath: '/backend/umes-next-phases',
    refreshNotifications: jest.fn(),
    navigate: jest.fn(),
    markAsRead: jest.fn(async () => {}),
    dismiss: jest.fn(async () => {}),
  }
}

describe('useNotificationEffect', () => {
  beforeEach(() => {
    __resetNotificationDispatcherForTests()
  })

  it('runs component-scoped effects from notification-created bridge events', () => {
    const calls: string[] = []
    const notification = makeNotification('n1', 'example.umes.actionable')

    renderHook(() => useNotificationEffect('example.umes.actionable', (item) => calls.push(item.id)))

    act(() => {
      dispatchNotificationCreated(notification)
    })

    expect(calls).toEqual(['n1'])
  })

  it('dedupes when the dispatcher and bridge deliver the same notification', () => {
    const calls: string[] = []
    const notification = makeNotification('n1', 'example.umes.actionable')

    renderHook(() => useNotificationEffect('example.umes.actionable', (item) => calls.push(item.id)))

    act(() => {
      dispatchNotificationHandlers([notification], runtime())
      dispatchNotificationCreated(notification)
    })

    expect(calls).toEqual(['n1'])
  })
})
