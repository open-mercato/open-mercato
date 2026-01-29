import type { NotificationTypeDefinition } from '@open-mercato/shared/modules/notifications/types'

export const notificationTypes: NotificationTypeDefinition[] = [
  {
    type: 'business_rules.rule.execution_failed',
    module: 'business_rules',
    titleKey: 'businessRules.notifications.rule.executionFailed.title',
    bodyKey: 'businessRules.notifications.rule.executionFailed.body',
    icon: 'alert-triangle',
    severity: 'error',
    actions: [
      {
        id: 'view',
        labelKey: 'common.view',
        variant: 'outline',
        href: '/backend/business-rules/{sourceEntityId}',
        icon: 'external-link',
      },
    ],
    linkHref: '/backend/business-rules/{sourceEntityId}',
    expiresAfterHours: 168, // 7 days
  },
]

export default notificationTypes
