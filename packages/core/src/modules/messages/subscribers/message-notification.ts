import { createQueue } from '@open-mercato/queue'
import { buildBatchNotificationFromType } from '../../notifications/lib/notificationBuilder'
import { resolveNotificationService } from '../../notifications/lib/notificationService'
import {
  MESSAGES_EMAIL_QUEUE_NAME,
  type SendMessageEmailJob,
} from '../workers/send-email.worker'
import { notificationTypes } from '../notifications'

export const metadata = {
  event: 'messages.sent',
  persistent: true,
  id: 'messages:queue-email-delivery',
}

type MessageSentPayload = {
  messageId: string
  senderUserId: string
  recipientUserIds: string[]
  sendViaEmail: boolean
  externalEmail?: string | null
  forwardedFrom?: string
  replyTo?: string
  tenantId: string
  organizationId?: string | null
}

type ResolverContext = {
  resolve: <T = unknown>(name: string) => T
}


export default async function handle(payload: MessageSentPayload, ctx: ResolverContext): Promise<void> {
  const uniqueRecipientUserIds = Array.from(new Set(payload.recipientUserIds))

  const typeDef = notificationTypes.find((type) => type.type === 'messages.new')
  if (typeDef && uniqueRecipientUserIds.length > 0) {
    const notificationService = resolveNotificationService(ctx)
    const notificationInput = buildBatchNotificationFromType(typeDef, {
      recipientUserIds: uniqueRecipientUserIds,
      sourceEntityType: 'message',
      sourceEntityId: payload.messageId,
      linkHref: `/backend/messages/${payload.messageId}`,
    })
    await notificationService.createBatch(notificationInput, {
      tenantId: payload.tenantId,
      organizationId: payload.organizationId ?? null,
    })
  }

  if (!payload.sendViaEmail) {
    return
  }

  const strategy = process.env.QUEUE_STRATEGY === 'async' ? 'async' : 'local'

  const emailQueue = createQueue<SendMessageEmailJob>(MESSAGES_EMAIL_QUEUE_NAME, strategy)

  for (const recipientUserId of uniqueRecipientUserIds) {
    await emailQueue.enqueue({
      type: 'recipient',
      messageId: payload.messageId,
      recipientUserId,
      tenantId: payload.tenantId,
      organizationId: payload.organizationId ?? null,
    })
  }

  const externalEmail = payload.externalEmail?.trim()
  if (externalEmail) {
    await emailQueue.enqueue({
      type: 'external',
      messageId: payload.messageId,
      email: externalEmail,
      tenantId: payload.tenantId,
      organizationId: payload.organizationId ?? null,
    })
  }
}
