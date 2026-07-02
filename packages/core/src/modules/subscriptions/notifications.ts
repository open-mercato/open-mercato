import type { NotificationTypeDefinition } from '@open-mercato/shared/modules/notifications/types'

export const notificationTypes: NotificationTypeDefinition[] = [
  {
    type: 'subscriptions.subscription.trial_will_end',
    module: 'subscriptions',
    titleKey: 'subscriptions.notifications.trialWillEnd.title',
    bodyKey: 'subscriptions.notifications.trialWillEnd.body',
    icon: 'clock-3',
    severity: 'warning',
    actions: [
      {
        id: 'view',
        labelKey: 'common.view',
        variant: 'outline',
        href: '/backend/subscriptions/{sourceEntityId}',
        icon: 'external-link',
      },
    ],
    linkHref: '/backend/subscriptions/{sourceEntityId}',
    expiresAfterHours: 168,
  },
]

export default notificationTypes
