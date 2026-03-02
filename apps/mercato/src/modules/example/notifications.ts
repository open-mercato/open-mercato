import type { NotificationTypeDefinition } from '@open-mercato/shared/modules/notifications/types'

export const notificationTypes: NotificationTypeDefinition[] = [
  {
    type: 'example.umes.actionable',
    module: 'example',
    titleKey: 'example.notifications.umesActionable.title',
    bodyKey: 'example.notifications.umesActionable.body',
    icon: 'bell',
    severity: 'info',
    actions: [
      {
        id: 'open',
        labelKey: 'common.open',
        variant: 'outline',
        href: '/backend/umes-next-phases?allowed=1',
        icon: 'external-link',
      },
      {
        id: 'dismiss',
        labelKey: 'notifications.actions.dismiss',
        variant: 'ghost',
      },
    ],
    primaryActionId: 'open',
    linkHref: '/backend/umes-next-phases?allowed=1',
    expiresAfterHours: 24,
  },
]

export default notificationTypes
