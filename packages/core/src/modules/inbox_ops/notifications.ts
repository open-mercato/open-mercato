import type { NotificationTypeDefinition } from '@open-mercato/shared/modules/notifications/types'

export const notificationTypes: NotificationTypeDefinition[] = [
  {
    type: 'inbox_ops.proposal.created',
    module: 'inbox_ops',
    titleKey: 'inbox_ops.notifications.proposal_created.title',
    bodyKey: 'inbox_ops.notifications.proposal_created.body',
    icon: 'inbox',
    severity: 'info',
    actions: [
      {
        id: 'review',
        labelKey: 'inbox_ops.action.review',
        variant: 'outline',
        href: '/backend/inbox-ops/proposals/{sourceEntityId}',
        icon: 'external-link',
      },
    ],
    linkHref: '/backend/inbox-ops/proposals/{sourceEntityId}',
    expiresAfterHours: 168,
  },
]

export default notificationTypes
