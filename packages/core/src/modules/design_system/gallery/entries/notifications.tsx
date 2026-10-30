import { useT } from '@open-mercato/shared/lib/i18n/context'
import * as React from 'react'
import { Bell } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { NotificationCountBadge, NotificationItem, NotificationPanel } from '@open-mercato/ui/backend/notifications'
import type { NotificationDto } from '@open-mercato/shared/modules/notifications/types'
import type { GalleryEntry } from '../types'

// Component titles and variant names are proper nouns from the codebase and
// are deliberately not translated. `code` MUST contain the entry's importPath
// (enforced by the registry-integrity test) and is always reviewed alongside
// its sibling `render`.

// All previews below run on inline mocked data — no API calls, no SSE.
// `NotificationBell` itself is wired to `useNotifications` (SSE + API) and
// cannot be severed from it, so its entry shows the presentational chrome
// (bell trigger + `NotificationCountBadge`) instead of mounting the live bell.
function NotificationBellEntryPresentationalMockPreview() {
  const t = useT()
  return (
    <IconButton
      variant="ghost"
      size="sm"
      className="relative"
      aria-label={t('design_system.gallery.samples.content.3UnreadNotifications')}
    >
      <Bell className="h-5 w-5" />
      <NotificationCountBadge count={3} />
    </IconButton>
  )
}
function NotificationCountBadgeEntryCountsPreview() {
  const t = useT()
  return (
    <>
      <IconButton
        variant="ghost"
        size="sm"
        className="relative"
        aria-label={t('design_system.gallery.samples.content.3UnreadNotifications')}
      >
        <Bell className="h-5 w-5" />
        <NotificationCountBadge count={3} />
      </IconButton>
      <IconButton
        variant="ghost"
        size="sm"
        className="relative"
        aria-label={t('design_system.gallery.samples.content.12UnreadNotifications')}
      >
        <Bell className="h-5 w-5" />
        <NotificationCountBadge count={12} />
      </IconButton>
      <IconButton
        variant="ghost"
        size="sm"
        className="relative"
        aria-label={t('design_system.gallery.samples.content.120UnreadNotifications')}
      >
        <Bell className="h-5 w-5" />
        <NotificationCountBadge count={120} />
      </IconButton>
    </>
  )
}
function NotificationItemEntryUnreadInfoPreview() {
  const t = useT()
  return (
    <div className="w-full max-w-md">
      <NotificationItem
        notification={unreadInfoNotification(t)}
        onMarkAsRead={noopMarkAsRead}
        onExecuteAction={noopExecuteAction}
        onDismiss={noopDismiss}
        t={t}
      />
    </div>
  )
}
function NotificationItemEntryWithBodyPreview() {
  const t = useT()
  return (
    <div className="w-full max-w-md">
      <NotificationItem
        notification={successWithBodyNotification(t)}
        onMarkAsRead={noopMarkAsRead}
        onExecuteAction={noopExecuteAction}
        onDismiss={noopDismiss}
        t={t}
      />
    </div>
  )
}
function NotificationItemEntryWithActionsPreview() {
  const t = useT()
  return (
    <div className="w-full max-w-md">
      <NotificationItem
        notification={actionRequiredNotification(t)}
        onMarkAsRead={noopMarkAsRead}
        onExecuteAction={noopExecuteAction}
        onDismiss={noopDismiss}
        t={t}
      />
    </div>
  )
}
const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString()
const noopMarkAsRead = async () => {}
const noopDismiss = async () => {}
const noopExecuteAction = async () => ({})
function mockNotification(overrides: Partial<NotificationDto> & Pick<NotificationDto, 'title'>): NotificationDto {
  return {
    id: 'gallery-notification',
    type: 'gallery.demo',
    severity: 'info',
    status: 'unread',
    actions: [],
    createdAt: minutesAgo(5),
    ...overrides,
  }
}
const unreadInfoNotification = (t: ReturnType<typeof useT>) =>
  mockNotification({
    id: 'gallery-unread-info',
    title: t('design_system.gallery.samples.content.nightlyImportFinished'),
    severity: 'info',
    status: 'unread',
    sourceModule: 'catalog',
    createdAt: minutesAgo(4),
  })
const successWithBodyNotification = (t: ReturnType<typeof useT>) =>
  mockNotification({
    id: 'gallery-success-body',
    title: t('design_system.gallery.samples.content.order10023Shipped'),
    body: t('design_system.gallery.samples.content.carrierPickedUp3ParcelsTrackingNumbersWereEmailedToTheCustomer'),
    severity: 'success',
    status: 'read',
    sourceModule: 'sales',
    createdAt: minutesAgo(35),
  })
const actionRequiredNotification = (t: ReturnType<typeof useT>) =>
  mockNotification({
    id: 'gallery-action-required',
    title: t('design_system.gallery.samples.content.priceListAwaitingApproval'),
    body: t('design_system.gallery.samples.content.wholesaleEuPriceListChanges214Products'),
    severity: 'warning',
    status: 'unread',
    sourceModule: 'pricing',
    actions: [
      {
        id: 'review',
        label: t('design_system.gallery.samples.content.reviewChanges'),
        variant: 'outline',
      },
      {
        id: 'approve',
        label: t('design_system.gallery.samples.content.approve'),
        variant: 'default',
      },
    ],
    createdAt: minutesAgo(90),
  })
const panelNotifications = (t: ReturnType<typeof useT>): NotificationDto[] => [
  unreadInfoNotification(t),
  actionRequiredNotification(t),
  successWithBodyNotification(t),
]
function DemoNotificationPanel() {
  const t = useT()
  const [open, setOpen] = React.useState(false)
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        {t('design_system.gallery.samples.content.openNotificationPanel')}
      </Button>
      <NotificationPanel
        open={open}
        onOpenChange={setOpen}
        notifications={panelNotifications(t)}
        unreadCount={2}
        onMarkAsRead={noopMarkAsRead}
        onExecuteAction={noopExecuteAction}
        onDismiss={noopDismiss}
        onMarkAllRead={noopMarkAsRead}
        t={t}
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
      render: () => <NotificationBellEntryPresentationalMockPreview />,
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
      render: () => <NotificationCountBadgeEntryCountsPreview />,
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
      render: () => <NotificationItemEntryUnreadInfoPreview />,
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
      render: () => <NotificationItemEntryWithBodyPreview />,
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
      render: () => <NotificationItemEntryWithActionsPreview />,
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
