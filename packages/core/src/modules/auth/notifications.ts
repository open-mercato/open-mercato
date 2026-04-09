import type { NotificationTypeDefinition } from '@open-mercato/shared/modules/notifications/types'

export const notificationTypes: NotificationTypeDefinition[] = [
  {
    type: 'auth.password_reset.requested',
    module: 'auth',
    titleKey: 'auth.notifications.passwordReset.requested.title',
    bodyKey: 'auth.notifications.passwordReset.requested.body',
    icon: 'key',
    severity: 'info',
    actions: [
      {
        id: 'view',
        labelKey: 'common.view',
        variant: 'outline',
        href: '/backend/auth/profile',
        icon: 'external-link',
      },
    ],
    linkHref: '/backend/auth/profile',
    expiresAfterHours: 24,
  },
  {
    type: 'auth.password_reset.completed',
    module: 'auth',
    titleKey: 'auth.notifications.passwordReset.completed.title',
    bodyKey: 'auth.notifications.passwordReset.completed.body',
    icon: 'check-circle',
    severity: 'success',
    actions: [],
    expiresAfterHours: 72,
  },
  {
    type: 'auth.account.locked',
    module: 'auth',
    titleKey: 'auth.notifications.account.locked.title',
    bodyKey: 'auth.notifications.account.locked.body',
    icon: 'lock',
    severity: 'warning',
    actions: [
      {
        id: 'contact_support',
        labelKey: 'auth.actions.contactSupport',
        variant: 'default',
        href: '/backend/support',
        icon: 'mail',
      },
    ],
    linkHref: '/backend/support',
  },
  {
    type: 'auth.login.new_device',
    module: 'auth',
    titleKey: 'auth.notifications.login.newDevice.title',
    bodyKey: 'auth.notifications.login.newDevice.body',
    icon: 'smartphone',
    severity: 'info',
    actions: [
      {
        id: 'view_sessions',
        labelKey: 'auth.actions.viewSessions',
        variant: 'outline',
        href: '/backend/auth/sessions',
        icon: 'list',
      },
    ],
    linkHref: '/backend/auth/sessions',
    expiresAfterHours: 168, // 7 days
  },
  {
    type: 'auth.role.assigned',
    module: 'auth',
    titleKey: 'auth.notifications.role.assigned.title',
    bodyKey: 'auth.notifications.role.assigned.body',
    icon: 'user-plus',
    severity: 'success',
    actions: [
      {
        id: 'view_permissions',
        labelKey: 'auth.actions.viewPermissions',
        variant: 'outline',
        href: '/backend/auth/profile',
        icon: 'shield',
      },
    ],
    linkHref: '/backend/auth/profile',
    expiresAfterHours: 168,
  },
  {
    type: 'auth.role.revoked',
    module: 'auth',
    titleKey: 'auth.notifications.role.revoked.title',
    bodyKey: 'auth.notifications.role.revoked.body',
    icon: 'user-minus',
    severity: 'warning',
    actions: [
      {
        id: 'view_profile',
        labelKey: 'common.view',
        variant: 'outline',
        href: '/backend/auth/profile',
      },
    ],
    linkHref: '/backend/auth/profile',
    expiresAfterHours: 168,
  },
]

export default notificationTypes
