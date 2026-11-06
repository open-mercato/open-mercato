import type { NotificationTypeDefinition } from '@open-mercato/shared/modules/notifications/types'

export const notificationTypes: NotificationTypeDefinition[] = [
  {
    type: 'ai_assistant.conversation_shared',
    module: 'ai_assistant',
    channels: ['in_app', 'email'],
    titleKey: 'ai_assistant.notifications.conversation_shared.title',
    bodyKey: 'ai_assistant.notifications.conversation_shared.body',
    icon: 'share-2',
    severity: 'info',
    actions: [
      {
        id: 'view',
        labelKey: 'common.view',
        variant: 'outline',
        href: '/backend?openAiConversation={sourceEntityId}',
        icon: 'external-link',
      },
    ],
    linkHref: '/backend',
    expiresAfterHours: 168,
  },
  {
    type: 'ai_assistant.pending_action.awaiting_approval',
    module: 'ai_assistant',
    channels: ['in_app', 'email'],
    titleKey: 'ai_assistant.notifications.pendingActionAwaitingApproval.title',
    bodyKey: 'ai_assistant.notifications.pendingActionAwaitingApproval.body',
    icon: 'shield-check',
    severity: 'warning',
    actions: [
      {
        id: 'view',
        labelKey: 'common.view',
        variant: 'outline',
        href: '/backend/config/ai-assistant/pending-actions/{sourceEntityId}',
        icon: 'external-link',
      },
    ],
    linkHref: '/backend/config/ai-assistant/pending-actions',
    expiresAfterHours: 24,
  },
]

export default notificationTypes
