import type { NotificationTypeDefinition } from '@open-mercato/shared/modules/notifications/types'

export const notificationTypes: NotificationTypeDefinition[] = [
  {
    type: 'customers.deal.won',
    module: 'customers',
    titleKey: 'customers.notifications.deal.won.title',
    bodyKey: 'customers.notifications.deal.won.body',
    icon: 'trophy',
    severity: 'success',
    actions: [
      {
        id: 'view',
        labelKey: 'common.view',
        variant: 'outline',
        href: '/backend/customers/deals/{sourceEntityId}',
        icon: 'external-link',
      },
    ],
    linkHref: '/backend/customers/deals/{sourceEntityId}',
    expiresAfterHours: 168, // 7 days
  },
  {
    type: 'customers.deal.lost',
    module: 'customers',
    titleKey: 'customers.notifications.deal.lost.title',
    bodyKey: 'customers.notifications.deal.lost.body',
    icon: 'x-circle',
    severity: 'warning',
    actions: [
      {
        id: 'view',
        labelKey: 'common.view',
        variant: 'outline',
        href: '/backend/customers/deals/{sourceEntityId}',
        icon: 'external-link',
      },
    ],
    linkHref: '/backend/customers/deals/{sourceEntityId}',
    expiresAfterHours: 168, // 7 days
  },
]

export default notificationTypes
