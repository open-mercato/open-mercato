import { createQueue } from '@open-mercato/queue'
import {
  MESSAGES_EMAIL_QUEUE_NAME,
  type SendMessageEmailJob,
} from '../workers/send-email.worker'

export const metadata = {
  event: 'messages.message.sent',
  persistent: true,
  id: 'messages:queue-email-delivery',
}

type MessageSentPayload = {
  messageId: string
  recipientUserIds: string[]
  sendViaEmail: boolean
  externalEmail?: string | null
  tenantId: string
  organizationId?: string | null
}

export default async function handle(payload: MessageSentPayload): Promise<void> {
  if (!payload.sendViaEmail) return

  const strategy = process.env.QUEUE_STRATEGY === 'async' ? 'async' : 'local'
  const emailQueue = createQueue<SendMessageEmailJob>(MESSAGES_EMAIL_QUEUE_NAME, strategy)
  const recipientUserIds = Array.from(new Set(payload.recipientUserIds))

  for (const recipientUserId of recipientUserIds) {
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
