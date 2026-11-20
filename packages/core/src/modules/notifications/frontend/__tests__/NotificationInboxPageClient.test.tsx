/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import type { NotificationPanelProps } from '@open-mercato/ui/backend/notifications'
import { NotificationInboxPageClient } from '../NotificationInboxPageClient'
import { metadata } from '../../backend/notifications/page.meta'

const pushMock = jest.fn()
const panelMock = jest.fn((_props: NotificationPanelProps) => null)
const notifications = {
  notifications: [], unreadCount: 0,
  markAsRead: jest.fn(), executeAction: jest.fn(), dismiss: jest.fn(),
  undoDismiss: jest.fn(), markAllRead: jest.fn(), dismissUndo: null,
}

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: pushMock }) }))
jest.mock('@open-mercato/ui/backend/notifications', () => ({
  NotificationPanel: (props: NotificationPanelProps) => panelMock(props),
  useNotifications: () => notifications,
}))

it('opens the existing notification panel on its authorized inbox route and closes back to the backend', () => {
  renderWithProviders(<NotificationInboxPageClient />)
  const props = panelMock.mock.calls[0][0] as NotificationPanelProps
  expect(metadata).toMatchObject({ requireAuth: true, requireFeatures: ['notifications.view'] })
  expect(props).toMatchObject({ open: true, notifications: [], onMarkAsRead: notifications.markAsRead, onExecuteAction: notifications.executeAction })
  props.onOpenChange(false)
  expect(pushMock).toHaveBeenCalledWith('/backend')
})
