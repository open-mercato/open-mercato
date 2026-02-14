import { createQueue } from '@open-mercato/queue'
import {
  MESSAGES_EMAIL_QUEUE_NAME,
  type SendMessageEmailJob,
} from '../workers/send-email.worker'

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


export default async function handle(payload: MessageSentPayload): Promise<void> {
  if (!payload.sendViaEmail) {
    return
  }

  const strategy = process.env.QUEUE_STRATEGY === 'async' ? 'async' : 'local'
  const uniqueRecipientUserIds = Array.from(new Set(payload.recipientUserIds))

  const emailQueue = createQueue<SendMessageEmailJob>(MESSAGES_EMAIL_QUEUE_NAME, strategy)

  for (const recipientUserId of uniqueRecipientUserIds) {
    const jobId = await emailQueue.enqueue({
      type: 'recipient',
      messageId: payload.messageId,
      recipientUserId,
      tenantId: payload.tenantId,
      organizationId: payload.organizationId ?? null,
    })
  }

  const externalEmail = payload.externalEmail?.trim()
  if (externalEmail) {
    const jobId = await emailQueue.enqueue({
      type: 'external',
      messageId: payload.messageId,
      email: externalEmail,
      tenantId: payload.tenantId,
      organizationId: payload.organizationId ?? null,
    })
  }
}
