import { resolveNotificationService } from '@open-mercato/core/modules/notifications/lib/notificationService'
import { buildNotificationFromType } from '@open-mercato/core/modules/notifications/lib/notificationBuilder'
import { notificationTypes } from '../notifications'
import type { AiConversationSharedPayload } from '../events'

export const metadata = {
  event: 'ai_assistant.conversation.shared',
  persistent: true,
  id: 'ai_assistant:conversation-shared-notify',
}

type ResolverContext = {
  resolve: <T = unknown>(name: string) => T
  container?: { resolve<T = unknown>(name: string): T }
}

export default async function handleConversationShared(
  payload: AiConversationSharedPayload,
  ctx: ResolverContext,
): Promise<void> {
  if (!payload?.participantUserId || !payload.tenantId) return

  const typeDef = notificationTypes.find((t) => t.type === 'ai_assistant.conversation_shared')
  if (!typeDef) return

  const container = ctx.container ?? { resolve: ctx.resolve }
  let notificationService: ReturnType<typeof resolveNotificationService> | null
  try {
    notificationService = resolveNotificationService(container)
  } catch {
    return
  }

  const notificationInput = buildNotificationFromType(typeDef, {
    recipientUserId: payload.participantUserId,
    bodyVariables: {},
    sourceEntityType: 'ai_assistant:ai_chat_conversation',
    sourceEntityId: payload.conversationId,
    linkHref: `/backend?openAiConversation=${payload.conversationId}`,
  })

  try {
    await notificationService.create(notificationInput, {
      tenantId: payload.tenantId,
      organizationId: payload.organizationId ?? null,
    })
  } catch (err) {
    console.warn('[ai_assistant.conversationSharedNotify] create failed', err)
  }
}
