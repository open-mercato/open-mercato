'use client'

import type { NotificationTypeDefinition } from '@open-mercato/shared/modules/notifications/types'
import { ConversationSharedRenderer } from './widgets/notifications/ConversationSharedRenderer'

export const aiAssistantNotificationTypes: NotificationTypeDefinition[] = [
  {
    type: 'ai_assistant.conversation_shared',
    module: 'ai_assistant',
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
    Renderer: ConversationSharedRenderer,
    expiresAfterHours: 168,
  },
]

export default aiAssistantNotificationTypes
