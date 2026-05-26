import type { NotificationTypeDefinition } from '@open-mercato/shared/modules/notifications/types'

export const notificationTypes: NotificationTypeDefinition[] = [
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
  {
    type: 'customer_accounts.domain_mapping.verified',
    module: 'customer_accounts',
    titleKey: 'customer_accounts.notifications.domain_mapping.verified.title',
    bodyKey: 'customer_accounts.notifications.domain_mapping.verified.body',
    icon: 'check-circle',
    severity: 'success',
    actions: [
      {
        id: 'view',
        labelKey: 'common.view',
        variant: 'outline',
        href: '/backend/customer_accounts/settings/domain',
        icon: 'external-link',
      },
    ],
    linkHref: '/backend/customer_accounts/settings/domain',
    expiresAfterHours: 168,
  },
  {
    type: 'customer_accounts.domain_mapping.activated',
    module: 'customer_accounts',
    titleKey: 'customer_accounts.notifications.domain_mapping.activated.title',
    bodyKey: 'customer_accounts.notifications.domain_mapping.activated.body',
    icon: 'globe',
    severity: 'success',
    actions: [
      {
        id: 'view',
        labelKey: 'common.view',
        variant: 'outline',
        href: '/backend/customer_accounts/settings/domain',
        icon: 'external-link',
      },
    ],
    linkHref: '/backend/customer_accounts/settings/domain',
    expiresAfterHours: 168,
  },
  {
    type: 'customer_accounts.domain_mapping.dns_failed',
    module: 'customer_accounts',
    titleKey: 'customer_accounts.notifications.domain_mapping.dns_failed.title',
    bodyKey: 'customer_accounts.notifications.domain_mapping.dns_failed.body',
    icon: 'alert-triangle',
    severity: 'warning',
    actions: [
      {
        id: 'view',
        labelKey: 'common.view',
        variant: 'outline',
        href: '/backend/customer_accounts/settings/domain',
        icon: 'external-link',
      },
    ],
    linkHref: '/backend/customer_accounts/settings/domain',
    expiresAfterHours: 168,
  },
  {
    type: 'customer_accounts.domain_mapping.tls_failed',
    module: 'customer_accounts',
    titleKey: 'customer_accounts.notifications.domain_mapping.tls_failed.title',
    bodyKey: 'customer_accounts.notifications.domain_mapping.tls_failed.body',
    icon: 'shield-alert',
    severity: 'warning',
    actions: [
      {
        id: 'view',
        labelKey: 'common.view',
        variant: 'outline',
        href: '/backend/customer_accounts/settings/domain',
        icon: 'external-link',
      },
    ],
    linkHref: '/backend/customer_accounts/settings/domain',
    expiresAfterHours: 168,
  },
]

export default notificationTypes
