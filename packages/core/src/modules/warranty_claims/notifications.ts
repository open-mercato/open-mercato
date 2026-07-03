import type { NotificationTypeDefinition } from '@open-mercato/shared/modules/notifications/types'

export const notificationTypes: NotificationTypeDefinition[] = [
  {
    type: 'warranty_claims.claim.submitted',
    module: 'warranty_claims',
    titleKey: 'warranty_claims.notifications.submitted.title',
    bodyKey: 'warranty_claims.notifications.submitted.body',
    icon: 'clipboard-check',
    severity: 'info',
    actions: [
      {
        id: 'view',
        labelKey: 'common.view',
        variant: 'outline',
        href: '/backend/warranty_claims/{sourceEntityId}',
        icon: 'external-link',
      },
    ],
    linkHref: '/backend/warranty_claims/{sourceEntityId}',
    expiresAfterHours: 168,
  },
  {
    type: 'warranty_claims.claim.assigned',
    module: 'warranty_claims',
    titleKey: 'warranty_claims.notifications.assigned.title',
    bodyKey: 'warranty_claims.notifications.assigned.body',
    icon: 'user-check',
    severity: 'info',
    actions: [
      {
        id: 'view',
        labelKey: 'common.view',
        variant: 'outline',
        href: '/backend/warranty_claims/{sourceEntityId}',
        icon: 'external-link',
      },
    ],
    linkHref: '/backend/warranty_claims/{sourceEntityId}',
    expiresAfterHours: 168,
  },
  {
    type: 'warranty_claims.claim.status_changed',
    module: 'warranty_claims',
    titleKey: 'warranty_claims.notifications.statusChanged.title',
    bodyKey: 'warranty_claims.notifications.statusChanged.body',
    icon: 'refresh-cw',
    severity: 'info',
    actions: [
      {
        id: 'view',
        labelKey: 'common.view',
        variant: 'outline',
        href: '/backend/warranty_claims/{sourceEntityId}',
        icon: 'external-link',
      },
    ],
    linkHref: '/backend/warranty_claims/{sourceEntityId}',
    expiresAfterHours: 168,
  },
]

export default notificationTypes
