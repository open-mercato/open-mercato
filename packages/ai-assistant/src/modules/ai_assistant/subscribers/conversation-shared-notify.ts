import { resolveNotificationService } from '@open-mercato/core/modules/notifications/lib/notificationService'
import { buildNotificationFromType } from '@open-mercato/core/modules/notifications/lib/notificationBuilder'
import { defaultLocale } from '@open-mercato/shared/lib/i18n/config'
import { loadDictionary } from '@open-mercato/shared/lib/i18n/server'
import { createTranslator } from '@open-mercato/shared/lib/i18n/translate'
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

async function resolveDefaultLocaleStrings(
  titleKey: string | undefined,
  bodyKey: string | undefined,
): Promise<{ title: string | undefined; body: string | undefined }> {
  if (!titleKey && !bodyKey) return { title: titleKey, body: bodyKey }
  try {
    const dict = await loadDictionary(defaultLocale)
    const t = createTranslator(dict)
    return {
      title: titleKey ? t(titleKey) : titleKey,
      body: bodyKey ? t(bodyKey) : bodyKey,
    }
  } catch {
    return { title: titleKey, body: bodyKey }
  }
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

  // Persist a human-readable fallback alongside the i18n keys so consumers
  // that do not run the client renderer (email digests, exports) display a
  // resolved string instead of the raw key. The client renderer continues
  // to re-translate via titleKey/bodyKey for the viewer's locale.
  const resolved = await resolveDefaultLocaleStrings(typeDef.titleKey, typeDef.bodyKey)
  if (resolved.title !== undefined) notificationInput.title = resolved.title
  if (resolved.body !== undefined) notificationInput.body = resolved.body

  try {
    await notificationService.create(notificationInput, {
      tenantId: payload.tenantId,
      organizationId: payload.organizationId ?? null,
    })
  } catch (err) {
    console.warn('[ai_assistant.conversationSharedNotify] create failed', err)
  }
}
