import type { EntityManager } from '@mikro-orm/postgresql'
import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { User } from '../../auth/data/entities'
import { Message, MessageObject, MessageRecipient } from '../data/entities'
import { getMessageAttachments } from '../lib/attachments'
import {
  sendMessageEmailToExternal,
  sendMessageEmailToRecipient,
} from '../lib/email-sender'

export const MESSAGES_EMAIL_QUEUE_NAME = 'messages-email'

export type SendMessageEmailToRecipientJob = {
  type: 'recipient'
  messageId: string
  recipientUserId: string
  tenantId: string
  organizationId?: string | null
}

export type SendMessageEmailToExternalJob = {
  type: 'external'
  messageId: string
  email: string
  tenantId: string
  organizationId?: string | null
}

export type SendMessageEmailJob = SendMessageEmailToRecipientJob | SendMessageEmailToExternalJob

export const metadata: WorkerMeta = {
  queue: MESSAGES_EMAIL_QUEUE_NAME,
  id: 'messages:send-email',
  concurrency: 10,
}

type HandlerContext = {
  resolve: <T = unknown>(name: string) => T
}

async function resolveSender(em: EntityManager, message: Message) {
  const sender = await findOneWithDecryption(
    em,
    User,
    {
      id: message.senderUserId,
      tenantId: message.tenantId,
      deletedAt: null,
    },
    undefined,
    { tenantId: message.tenantId, organizationId: message.organizationId ?? null }
  )
  return {
    name: sender?.name ?? null,
    email: sender?.email ?? null,
  }
}

async function resolveMessageScope(
  em: EntityManager,
  payload: SendMessageEmailJob
) {
  return await em.findOne(Message, {
    id: payload.messageId,
    tenantId: payload.tenantId,
    organizationId: payload.organizationId ?? null,
    deletedAt: null,
  })
}

export async function claimRecipientDelivery(
  em: EntityManager,
  payload: SendMessageEmailToRecipientJob,
): Promise<Date | null> {
  const claimTimestamp = new Date()
  const updatedRows = await em.nativeUpdate(
    MessageRecipient,
    {
      messageId: payload.messageId,
      recipientUserId: payload.recipientUserId,
      emailSentAt: null,
    },
    {
      emailSentAt: claimTimestamp,
      emailFailedAt: null,
      emailError: null,
    },
  )
  return updatedRows > 0 ? claimTimestamp : null
}

export async function releaseRecipientClaim(
  em: EntityManager,
  payload: SendMessageEmailToRecipientJob,
  claimTimestamp: Date,
  errorMessage: string,
): Promise<void> {
  await em.nativeUpdate(
    MessageRecipient,
    {
      messageId: payload.messageId,
      recipientUserId: payload.recipientUserId,
      emailSentAt: claimTimestamp,
    },
    {
      emailSentAt: null,
      emailFailedAt: new Date(),
      emailError: errorMessage,
    },
  )
}

export async function claimExternalDelivery(
  em: EntityManager,
  payload: SendMessageEmailToExternalJob,
): Promise<Date | null> {
  const claimTimestamp = new Date()
  const updatedRows = await em.nativeUpdate(
    Message,
    {
      id: payload.messageId,
      tenantId: payload.tenantId,
      organizationId: payload.organizationId ?? null,
      externalEmailSentAt: null,
    },
    {
      externalEmailSentAt: claimTimestamp,
      externalEmailFailedAt: null,
      externalEmailError: null,
    },
  )
  return updatedRows > 0 ? claimTimestamp : null
}

export async function releaseExternalClaim(
  em: EntityManager,
  payload: SendMessageEmailToExternalJob,
  claimTimestamp: Date,
  errorMessage: string,
): Promise<void> {
  await em.nativeUpdate(
    Message,
    {
      id: payload.messageId,
      tenantId: payload.tenantId,
      organizationId: payload.organizationId ?? null,
      externalEmailSentAt: claimTimestamp,
    },
    {
      externalEmailSentAt: null,
      externalEmailFailedAt: new Date(),
      externalEmailError: errorMessage,
    },
  )
}

export default async function handle(
  job: QueuedJob<SendMessageEmailJob>,
  ctx: JobContext & HandlerContext
): Promise<void> {
  const { payload } = job
  const em = (ctx.resolve('em') as EntityManager).fork()

  const message = await resolveMessageScope(em, payload)
  if (!message) {
    console.error('[messages:send-email] Message not found', payload.messageId)
    return
  }

  const objects = await em.find(MessageObject, { messageId: message.id })
  const attachments = await getMessageAttachments(
    em,
    message.id,
    message.organizationId ?? null,
    message.tenantId
  )
  const sender = await resolveSender(em, message)

  if (payload.type === 'external') {
    const externalClaimTimestamp = await claimExternalDelivery(em, payload)
    if (!externalClaimTimestamp) {
      return
    }

    try {
      await sendMessageEmailToExternal({
        message,
        email: payload.email,
        sender,
        objects,
        attachments,
      })
    } catch (error) {
      await releaseExternalClaim(
        em,
        payload,
        externalClaimTimestamp,
        error instanceof Error ? error.message : 'Unknown error',
      )
      console.error('[messages:send-email] External email send failed', error)
    }
    return
  }

  const recipientRecord = await em.findOne(MessageRecipient, {
    messageId: payload.messageId,
    recipientUserId: payload.recipientUserId,
  })
  if (!recipientRecord) {
    console.error('[messages:send-email] Recipient row not found', payload)
    return
  }

  if (recipientRecord.emailSentAt) {
    return
  }

  const recipientClaimTimestamp = await claimRecipientDelivery(em, payload)
  if (!recipientClaimTimestamp) {
    return
  }

  const recipientUser = await findOneWithDecryption(
    em,
    User,
    {
      id: payload.recipientUserId,
      tenantId: message.tenantId,
      deletedAt: null,
    },
    undefined,
    { tenantId: message.tenantId, organizationId: message.organizationId ?? null }
  )

  const recipientEmail = recipientUser?.email?.trim()
  if (!recipientEmail) {
    await releaseRecipientClaim(
      em,
      payload,
      recipientClaimTimestamp,
      'Recipient has no email address',
    )
    return
  }

  try {
    await sendMessageEmailToRecipient({
      em,
      message,
      recipientUserId: payload.recipientUserId,
      recipientEmail,
      sender,
      objects,
      attachments,
    })
  } catch (error) {
    await releaseRecipientClaim(
      em,
      payload,
      recipientClaimTimestamp,
      error instanceof Error ? error.message : 'Unknown error',
    )
    console.error('[messages:send-email] Recipient email send failed', error)
  }
}
