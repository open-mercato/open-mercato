import type { EntityManager } from '@mikro-orm/postgresql'
import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { EmailSendResult } from '@open-mercato/shared/lib/email/send'
import { User } from '../../auth/data/entities'
import {
  Message,
  MessageExternalParticipant,
  MessageObject,
  MessageRecipient,
  type ExternalParticipantRole,
} from '../data/entities'
import { emitMessagesEvent } from '../events'
import { getMessageEmailAttachments } from '../lib/attachments'
import { recordExternalDeliverySummary } from '../lib/externalParticipants'
import {
  sendMessageEmailToExternal,
  sendMessageEmailToRecipient,
} from '../lib/email-sender'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('messages').child({ component: 'send-email' })

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

export type SendMessageEmailToExternalParticipantsJob = {
  type: 'external_participants'
  messageId: string
  tenantId: string
  organizationId?: string | null
}

export type SendMessageEmailJob =
  | SendMessageEmailToRecipientJob
  | SendMessageEmailToExternalJob
  | SendMessageEmailToExternalParticipantsJob

const EXTERNAL_PARTICIPANT_CLAIM_LOCK_MS = 15 * 60 * 1000

export const metadata: WorkerMeta = {
  queue: MESSAGES_EMAIL_QUEUE_NAME,
  id: 'messages:send-email',
  concurrency: 10,
}

type HandlerContext = {
  resolve: <T = unknown>(name: string) => T
}

async function emitEmailDeliveryEvent(
  ctx: HandlerContext,
  eventId: 'messages.message.email_sent' | 'messages.message.email_failed',
  payload: {
    messageId: string
    target: 'recipient' | 'external'
    recipientUserId?: string
    email?: string
    participantId?: string
    role?: ExternalParticipantRole
    error?: string
    tenantId: string
    organizationId?: string | null
  },
) {
  const eventBus = ctx.resolve<{ emit?: unknown } | null>('eventBus')
  if (!eventBus || typeof eventBus !== 'object' || typeof (eventBus as { emit?: unknown }).emit !== 'function') {
    return
  }
  await emitMessagesEvent(eventId, payload, { persistent: true })
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
  return await findOneWithDecryption(
    em,
    Message,
    {
      id: payload.messageId,
      tenantId: payload.tenantId,
      organizationId: payload.organizationId ?? null,
      deletedAt: null,
    },
    undefined,
    { tenantId: payload.tenantId, organizationId: payload.organizationId ?? null },
  )
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

function participantClaimScope(payload: SendMessageEmailToExternalParticipantsJob) {
  return {
    messageId: payload.messageId,
    tenantId: payload.tenantId,
    organizationId: payload.organizationId ?? null,
    role: 'to' as const,
    deliveryStatus: 'pending' as const,
  }
}

/**
 * Claims the message's due `pending` "to" participants by pushing their `next_attempt_at`
 * past a lock window; the returned timestamp identifies the rows this worker owns.
 */
export async function claimExternalParticipants(
  em: EntityManager,
  payload: SendMessageEmailToExternalParticipantsJob,
): Promise<Date | null> {
  const now = new Date()
  const claimUntil = new Date(now.getTime() + EXTERNAL_PARTICIPANT_CLAIM_LOCK_MS)
  const updatedRows = await em.nativeUpdate(
    MessageExternalParticipant,
    {
      ...participantClaimScope(payload),
      $or: [{ nextAttemptAt: null }, { nextAttemptAt: { $lte: now } }],
    },
    { nextAttemptAt: claimUntil },
  )
  return updatedRows > 0 ? claimUntil : null
}

export async function releaseExternalParticipantsClaim(
  em: EntityManager,
  payload: SendMessageEmailToExternalParticipantsJob,
  claimUntil: Date,
  errorMessage: string,
): Promise<void> {
  await em.nativeUpdate(
    MessageExternalParticipant,
    { ...participantClaimScope(payload), nextAttemptAt: claimUntil },
    { nextAttemptAt: null, deliveryError: errorMessage },
  )
}

export async function recordExternalParticipantResults(
  em: EntityManager,
  payload: SendMessageEmailToExternalParticipantsJob,
  claimUntil: Date,
  participants: MessageExternalParticipant[],
  result: EmailSendResult,
): Promise<{ sent: MessageExternalParticipant[]; failed: Array<{ participant: MessageExternalParticipant; error: string }> }> {
  const owned = { ...participantClaimScope(payload), nextAttemptAt: claimUntil }
  const acceptedKeys = new Set(result.accepted.map((address) => address.toLowerCase()))
  const rejectedErrors = new Map(result.rejected.map((entry) => [entry.address.toLowerCase(), entry.error]))
  const sent = participants.filter((participant) => acceptedKeys.has(participant.email.toLowerCase()))
  const failed = participants.flatMap((participant) => {
    const error = rejectedErrors.get(participant.email.toLowerCase())
    return error !== undefined && !acceptedKeys.has(participant.email.toLowerCase()) ? [{ participant, error }] : []
  })

  if (sent.length > 0) {
    await em.nativeUpdate(
      MessageExternalParticipant,
      { ...owned, id: { $in: sent.map((participant) => participant.id) } },
      { deliveryStatus: 'sent', sentAt: new Date(), nextAttemptAt: null, deliveryError: null },
    )
  }
  for (const { participant, error } of failed) {
    await em.nativeUpdate(
      MessageExternalParticipant,
      { ...owned, id: participant.id },
      { deliveryStatus: 'failed', deliveryError: error, nextAttemptAt: null },
    )
  }
  await em.nativeUpdate(MessageExternalParticipant, owned, { nextAttemptAt: null })
  return { sent, failed }
}

type ExternalDeliveryContext = {
  sender: { name: string | null; email: string | null }
  objects: MessageObject[]
  attachments: Awaited<ReturnType<typeof getMessageEmailAttachments>>
}

async function deliverToExternalEmail(
  em: EntityManager,
  ctx: HandlerContext,
  message: Message,
  payload: SendMessageEmailToExternalJob,
  delivery: ExternalDeliveryContext,
): Promise<void> {
  const externalClaimTimestamp = await claimExternalDelivery(em, payload)
  if (!externalClaimTimestamp) {
    return
  }

  try {
    await sendMessageEmailToExternal({
      message,
      email: payload.email,
      ...delivery,
    })
    await emitEmailDeliveryEvent(ctx, 'messages.message.email_sent', {
      messageId: message.id,
      target: 'external',
      email: payload.email,
      recipientUserId: message.senderUserId,
      tenantId: message.tenantId,
      organizationId: message.organizationId ?? null,
    })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    await releaseExternalClaim(
      em,
      payload,
      externalClaimTimestamp,
      errorMessage,
    )
    await emitEmailDeliveryEvent(ctx, 'messages.message.email_failed', {
      messageId: message.id,
      target: 'external',
      email: payload.email,
      error: errorMessage,
      recipientUserId: message.senderUserId,
      tenantId: message.tenantId,
      organizationId: message.organizationId ?? null,
    })
    logger.error('External email send failed', { err: error })
  }
}

async function deliverToExternalParticipants(
  em: EntityManager,
  ctx: HandlerContext,
  message: Message,
  payload: SendMessageEmailToExternalParticipantsJob,
  delivery: ExternalDeliveryContext,
): Promise<void> {
  const scope = { tenantId: payload.tenantId, organizationId: payload.organizationId ?? null }
  const claimUntil = await claimExternalParticipants(em, payload)
  if (!claimUntil) {
    // Messages without participant rows (legacy drafts and replies, pre-upgrade rows) keep the single-address path.
    const participantCount = await em.count(MessageExternalParticipant, { messageId: message.id, ...scope })
    const externalEmail = message.externalEmail?.trim()
    if (participantCount === 0 && externalEmail) {
      await deliverToExternalEmail(em, ctx, message, { ...payload, type: 'external', email: externalEmail }, delivery)
    }
    return
  }

  const participants = await findWithDecryption(
    em,
    MessageExternalParticipant,
    { ...participantClaimScope(payload), nextAttemptAt: claimUntil },
    { orderBy: { createdAt: 'asc' } },
    scope,
  )
  if (participants.length === 0) return

  const eventBase = {
    messageId: message.id,
    target: 'external' as const,
    recipientUserId: message.senderUserId,
    tenantId: message.tenantId,
    organizationId: message.organizationId ?? null,
  }
  const participantEventFields = (participant: MessageExternalParticipant) => ({
    participantId: participant.id,
    email: participant.email,
    role: participant.role,
  })

  try {
    const result = await sendMessageEmailToExternal({
      message,
      email: participants.map((participant) => participant.email),
      sendSeparately: message.emailSendSeparately,
      ...delivery,
    })
    const { sent, failed } = await recordExternalParticipantResults(em, payload, claimUntil, participants, result)
    if (sent.length > 0) await recordExternalDeliverySummary(em, { messageId: payload.messageId, ...scope }, { sentAt: new Date() })
    for (const participant of sent) {
      await emitEmailDeliveryEvent(ctx, 'messages.message.email_sent', { ...eventBase, ...participantEventFields(participant) })
    }
    for (const { participant, error } of failed) {
      await emitEmailDeliveryEvent(ctx, 'messages.message.email_failed', { ...eventBase, ...participantEventFields(participant), error })
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    await releaseExternalParticipantsClaim(em, payload, claimUntil, errorMessage)
    await recordExternalDeliverySummary(em, { messageId: payload.messageId, ...scope }, { error: errorMessage })
    for (const participant of participants) {
      await emitEmailDeliveryEvent(ctx, 'messages.message.email_failed', {
        ...eventBase,
        ...participantEventFields(participant),
        error: errorMessage,
      })
    }
    logger.error('External participants email send failed', { err: error })
  }
}

export default async function handle(
  job: QueuedJob<SendMessageEmailJob>,
  ctx: JobContext & HandlerContext
): Promise<void> {
  const { payload } = job
  const em = (ctx.resolve('em') as EntityManager).fork()

  const message = await resolveMessageScope(em, payload)
  if (!message) {
    logger.error('Message not found', { messageId: payload.messageId })
    return
  }

  const objects = await em.find(MessageObject, { messageId: message.id })
  const attachments = await getMessageEmailAttachments(
    em,
    message.id,
    message.organizationId ?? null,
    message.tenantId
  )
  const sender = await resolveSender(em, message)

  const delivery = { sender, objects, attachments }
  if (payload.type === 'external') {
    await deliverToExternalEmail(em, ctx, message, payload, delivery)
    return
  }
  if (payload.type === 'external_participants') {
    await deliverToExternalParticipants(em, ctx, message, payload, delivery)
    return
  }

  const recipientRecord = await em.findOne(MessageRecipient, {
    messageId: payload.messageId,
    recipientUserId: payload.recipientUserId,
  })
  if (!recipientRecord) {
    logger.error('Recipient row not found', { messageId: payload.messageId, recipientUserId: payload.recipientUserId })
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
    await emitEmailDeliveryEvent(ctx, 'messages.message.email_sent', {
      messageId: message.id,
      target: 'recipient',
      recipientUserId: payload.recipientUserId,
      email: recipientEmail,
      tenantId: message.tenantId,
      organizationId: message.organizationId ?? null,
    })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    await releaseRecipientClaim(
      em,
      payload,
      recipientClaimTimestamp,
      errorMessage,
    )
    await emitEmailDeliveryEvent(ctx, 'messages.message.email_failed', {
      messageId: message.id,
      target: 'recipient',
      recipientUserId: payload.recipientUserId,
      email: recipientEmail,
      error: errorMessage,
      tenantId: message.tenantId,
      organizationId: message.organizationId ?? null,
    })
    logger.error('Recipient email send failed', { err: error })
  }
}
