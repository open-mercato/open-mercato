import * as React from 'react'
import { Bell } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import {
  NotificationCountBadge,
  NotificationItem,
  NotificationPanel,
} from '@open-mercato/ui/backend/notifications'
import type { NotificationDto } from '@open-mercato/shared/modules/notifications/types'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import type { GalleryEntry } from '../types'

// Component titles and variant names are proper nouns from the codebase and
// are deliberately not translated. `code` MUST contain the entry's importPath
// (enforced by the registry-integrity test) and is always reviewed alongside
// its sibling `render`.

// All previews below run on inline mocked data — no API calls, no SSE.
// `NotificationBell` itself is wired to `useNotifications` (SSE + API) and
// cannot be severed from it, so its entry shows the presentational chrome
// (bell trigger + `NotificationCountBadge`) instead of mounting the live bell.

const galleryT: TranslateFn = (key, fallbackOrParams, params) => {
  const fallback = typeof fallbackOrParams === 'string' ? fallbackOrParams : key
  const variables = (typeof fallbackOrParams === 'object' ? fallbackOrParams : params) ?? {}
  return Object.entries(variables).reduce(
    (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
    fallback,
  )
}

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString()

const noopMarkAsRead = async () => {}
const noopDismiss = async () => {}
const noopExecuteAction = async () => ({})

function mockNotification(overrides: Partial<NotificationDto>): NotificationDto {
  return {
    id: 'gallery-notification',
    type: 'gallery.demo',
    title: 'Notification',
    severity: 'info',
    status: 'unread',
    actions: [],
    createdAt: minutesAgo(5),
    ...overrides,
  }
}

const unreadInfoNotification = mockNotification({
  id: 'gallery-unread-info',
  title: 'Nightly import finished',
  severity: 'info',
  status: 'unread',
  sourceModule: 'catalog',
  createdAt: minutesAgo(4),
})

const successWithBodyNotification = mockNotification({
  id: 'gallery-success-body',
  title: 'Order #10023 shipped',
  body: 'Carrier picked up 3 parcels. Tracking numbers were emailed to the customer.',
  severity: 'success',
  status: 'read',
  sourceModule: 'sales',
  createdAt: minutesAgo(35),
})

const actionRequiredNotification = mockNotification({
  id: 'gallery-action-required',
  title: 'Price list awaiting approval',
  body: 'Wholesale EU price list changes 214 products.',
  severity: 'warning',
  status: 'unread',
  sourceModule: 'pricing',
  actions: [
    { id: 'review', label: 'Review changes', variant: 'outline' },
    { id: 'approve', label: 'Approve', variant: 'default' },
  ],
  createdAt: minutesAgo(90),
})

const panelNotifications: NotificationDto[] = [
  unreadInfoNotification,
  actionRequiredNotification,
  successWithBodyNotification,
]

function DemoNotificationPanel() {
  const [open, setOpen] = React.useState(false)
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        Open notification panel
      </Button>
      <NotificationPanel
        open={open}
        onOpenChange={setOpen}
        notifications={panelNotifications}
        unreadCount={2}
        onMarkAsRead={noopMarkAsRead}
        onExecuteAction={noopExecuteAction}
        onDismiss={noopDismiss}
        onMarkAllRead={noopMarkAsRead}
        t={galleryT}
      />
    </>
  )
}

const notificationBellEntry: GalleryEntry = {
  id: 'notification-bell',
  title: 'NotificationBell',
  importPath: '@open-mercato/ui/backend/notifications',
  variants: [
    {
      id: 'presentational-mock',
      title: 'Presentational mock (live bell is SSE-wired)',
      render: () => (
        <IconButton variant="ghost" size="sm" className="relative" aria-label="3 unread notifications">
          <Bell className="h-5 w-5" />
          <NotificationCountBadge count={3} />
        </IconButton>
      ),
      code: `import { NotificationBell } from '@open-mercato/ui/backend/notifications'

// Wired to the notifications API + SSE — AppShell renders one in the topbar.
<NotificationBell t={t} />`,
    },
  ],
}

const notificationCountBadgeEntry: GalleryEntry = {
  id: 'notification-count-badge',
  title: 'NotificationCountBadge',
  importPath: '@open-mercato/ui/backend/notifications',
  variants: [
    {
      id: 'counts',
      title: 'Counts (caps at 99+)',
      render: () => (
        <>
          <IconButton variant="ghost" size="sm" className="relative" aria-label="3 unread notifications">
            <Bell className="h-5 w-5" />
            <NotificationCountBadge count={3} />
          </IconButton>
          <IconButton variant="ghost" size="sm" className="relative" aria-label="12 unread notifications">
            <Bell className="h-5 w-5" />
            <NotificationCountBadge count={12} />
          </IconButton>
          <IconButton variant="ghost" size="sm" className="relative" aria-label="120 unread notifications">
            <Bell className="h-5 w-5" />
            <NotificationCountBadge count={120} />
          </IconButton>
        </>
      ),
      code: `import { NotificationCountBadge } from '@open-mercato/ui/backend/notifications'

// Renders nothing for count <= 0; anchors to the nearest relative parent.
<IconButton variant="ghost" size="sm" className="relative" aria-label="3 unread notifications">
  <Bell className="h-5 w-5" />
  <NotificationCountBadge count={3} />
</IconButton>`,
    },
  ],
}

const notificationItemEntry: GalleryEntry = {
  id: 'notification-item',
  title: 'NotificationItem',
  importPath: '@open-mercato/ui/backend/notifications',
  variants: [
    {
      id: 'unread-info',
      title: 'Unread (mocked data)',
      render: () => (
        <div className="w-full max-w-md">
          <NotificationItem
            notification={unreadInfoNotification}
            onMarkAsRead={noopMarkAsRead}
            onExecuteAction={noopExecuteAction}
            onDismiss={noopDismiss}
            t={galleryT}
          />
        </div>
      ),
      code: `import { NotificationItem } from '@open-mercato/ui/backend/notifications'

<NotificationItem
  notification={notification} // NotificationDto with status: 'unread'
  onMarkAsRead={() => markAsRead(notification.id)}
  onExecuteAction={(actionId) => executeAction(notification.id, actionId)}
  onDismiss={() => dismiss(notification.id)}
  t={t}
/>`,
    },
    {
      id: 'with-body',
      title: 'Read with body bubble (mocked data)',
      render: () => (
        <div className="w-full max-w-md">
          <NotificationItem
            notification={successWithBodyNotification}
            onMarkAsRead={noopMarkAsRead}
            onExecuteAction={noopExecuteAction}
            onDismiss={noopDismiss}
            t={galleryT}
          />
        </div>
      ),
      code: `import { NotificationItem } from '@open-mercato/ui/backend/notifications'

// A notification with a body renders it as a speech-bubble under the title.
<NotificationItem
  notification={notification} // NotificationDto with body text
  onMarkAsRead={() => markAsRead(notification.id)}
  onExecuteAction={(actionId) => executeAction(notification.id, actionId)}
  onDismiss={() => dismiss(notification.id)}
  t={t}
/>`,
    },
    {
      id: 'with-actions',
      title: 'Action required (mocked data)',
      render: () => (
        <div className="w-full max-w-md">
          <NotificationItem
            notification={actionRequiredNotification}
            onMarkAsRead={noopMarkAsRead}
            onExecuteAction={noopExecuteAction}
            onDismiss={noopDismiss}
            t={galleryT}
          />
        </div>
      ),
      code: `import { NotificationItem } from '@open-mercato/ui/backend/notifications'

// Actions come from notification.actions; the last one renders as primary.
<NotificationItem
  notification={notification} // NotificationDto with actions[]
  onMarkAsRead={() => markAsRead(notification.id)}
  onExecuteAction={(actionId) => executeAction(notification.id, actionId)}
  onDismiss={() => dismiss(notification.id)}
  t={t}
/>`,
    },
  ],
}

const notificationPanelEntry: GalleryEntry = {
  id: 'notification-panel',
  title: 'NotificationPanel',
  importPath: '@open-mercato/ui/backend/notifications',
  variants: [
    {
      id: 'mocked-inbox',
      title: 'Mocked inbox (opens in a sheet)',
      render: () => <DemoNotificationPanel />,
      code: `import { NotificationPanel } from '@open-mercato/ui/backend/notifications'

const [open, setOpen] = React.useState(false)

<NotificationPanel
  open={open}
  onOpenChange={setOpen}
  notifications={notifications} // NotificationDto[]
  unreadCount={unreadCount}
  onMarkAsRead={markAsRead}
  onExecuteAction={executeAction}
  onDismiss={dismiss}
  onMarkAllRead={markAllRead}
  t={t}
/>`,
    },
  ],
}

export const entries: GalleryEntry[] = [
  notificationBellEntry,
  notificationCountBadgeEntry,
  notificationItemEntry,
  notificationPanelEntry,
]
