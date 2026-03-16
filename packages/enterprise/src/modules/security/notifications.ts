import type { NotificationTypeDefinition } from '@open-mercato/shared/modules/notifications/types'

export const notificationTypes: NotificationTypeDefinition[] = [
  {
    type: 'security.password.changed',
    module: 'security',
    titleKey: 'security.notifications.passwordChanged.title',
    bodyKey: 'security.notifications.passwordChanged.body',
    icon: 'key-round',
    severity: 'success',
    actions: [
      {
        id: 'open_security_settings',
        labelKey: 'common.view',
        variant: 'outline',
        href: '/backend/profile/security',
        icon: 'external-link',
      },
    ],
    linkHref: '/backend/profile/security',
    expiresAfterHours: 168,
  },
  {
    type: 'security.mfa.enrolled',
    module: 'security',
    titleKey: 'security.notifications.mfaEnrolled.title',
    bodyKey: 'security.notifications.mfaEnrolled.body',
    icon: 'shield-check',
    severity: 'success',
    actions: [
      {
        id: 'open_mfa_settings',
        labelKey: 'common.view',
        variant: 'outline',
        href: '/backend/profile/security/mfa',
        icon: 'external-link',
      },
    ],
    linkHref: '/backend/profile/security/mfa',
    expiresAfterHours: 168,
  },
  {
    type: 'security.mfa.reset',
    module: 'security',
    titleKey: 'security.notifications.mfaReset.title',
    bodyKey: 'security.notifications.mfaReset.body',
    icon: 'shield-alert',
    severity: 'warning',
    actions: [
      {
        id: 'open_mfa_settings',
        labelKey: 'common.view',
        variant: 'outline',
        href: '/backend/profile/security/mfa',
        icon: 'external-link',
      },
    ],
    linkHref: '/backend/profile/security/mfa',
    expiresAfterHours: 168,
  },
  {
    type: 'security.mfa.enforcement_deadline',
    module: 'security',
    titleKey: 'security.notifications.enforcementDeadline.title',
    bodyKey: 'security.notifications.enforcementDeadline.bodyImmediate',
    icon: 'clock-3',
    severity: 'warning',
    actions: [
      {
        id: 'open_mfa_settings',
        labelKey: 'common.view',
        variant: 'outline',
        href: '/backend/profile/security/mfa',
        icon: 'external-link',
      },
    ],
    linkHref: '/backend/profile/security/mfa',
    expiresAfterHours: 168,
  },
]

export default notificationTypes
