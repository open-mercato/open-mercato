'use client'

import type { NotificationTypeDefinition } from '@open-mercato/shared/modules/notifications/types'

export const incidentsNotificationTypes: NotificationTypeDefinition[] = [
  {
    type: 'incidents.escalated',
    module: 'incidents',
    titleKey: 'incidents.notifications.escalated.title',
    bodyKey: 'incidents.notifications.escalated.body',
    icon: 'alert-circle',
    severity: 'warning',
    actions: [
      {
        id: 'view',
        labelKey: 'common.view',
        variant: 'default',
        href: '/backend/incidents/{sourceEntityId}',
        icon: 'external-link',
      },
    ],
    linkHref: '/backend/incidents/{sourceEntityId}',
    expiresAfterHours: 72,
  },
  {
    type: 'incidents.escalation_exhausted',
    module: 'incidents',
    titleKey: 'incidents.notifications.escalation_exhausted.title',
    bodyKey: 'incidents.notifications.escalation_exhausted.body',
    icon: 'alert-triangle',
    severity: 'error',
    actions: [],
    linkHref: '/backend/incidents/{sourceEntityId}',
    expiresAfterHours: 72,
  },
  {
    type: 'incidents.assigned',
    module: 'incidents',
    titleKey: 'incidents.notifications.assigned.title',
    bodyKey: 'incidents.notifications.assigned.body',
    icon: 'user-check',
    severity: 'info',
    actions: [],
    linkHref: '/backend/incidents/{sourceEntityId}',
    expiresAfterHours: 120,
  },
  {
    type: 'incidents.account_manager_alert',
    module: 'incidents',
    titleKey: 'incidents.notifications.account_manager_alert.title',
    bodyKey: 'incidents.notifications.account_manager_alert.body',
    icon: 'alert-triangle',
    severity: 'error',
    actions: [],
    linkHref: '/backend/incidents/{sourceEntityId}',
    expiresAfterHours: 48,
  },
]

export default incidentsNotificationTypes
