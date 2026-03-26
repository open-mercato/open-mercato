'use client'

import type { NotificationTypeDefinition } from '@open-mercato/shared/modules/notifications/types'

export const customerAccountsNotificationTypes: NotificationTypeDefinition[] = [
  {
    type: 'customer_accounts.user.signup',
    module: 'customer_accounts',
    titleKey: 'customer_accounts.notifications.user.signup.title',
    bodyKey: 'customer_accounts.notifications.user.signup.body',
    icon: 'user-plus',
    severity: 'info',
    actions: [
      {
        id: 'view',
        labelKey: 'common.view',
        variant: 'outline',
        href: '/backend/customer_accounts/users/{sourceEntityId}',
        icon: 'external-link',
      },
    ],
    linkHref: '/backend/customer_accounts/users/{sourceEntityId}',
    expiresAfterHours: 168,
  },
  {
    type: 'customer_accounts.user.locked',
    module: 'customer_accounts',
    titleKey: 'customer_accounts.notifications.user.locked.title',
    bodyKey: 'customer_accounts.notifications.user.locked.body',
    icon: 'lock',
    severity: 'warning',
    actions: [
      {
        id: 'view',
        labelKey: 'common.view',
        variant: 'outline',
        href: '/backend/customer_accounts/users/{sourceEntityId}',
        icon: 'external-link',
      },
    ],
    linkHref: '/backend/customer_accounts/users/{sourceEntityId}',
    expiresAfterHours: 168,
  },
]

export default customerAccountsNotificationTypes
