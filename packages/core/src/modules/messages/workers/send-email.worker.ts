import type { EntityManager } from '@mikro-orm/postgresql'
import { createQueue, type EnqueueOptions, type JobContext, type QueuedJob, type WorkerMeta } from '@open-mercato/queue'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import {
  readEmailDeliveryErrorHints,
  type EmailRejection,
  type EmailSendResult,
} from '@open-mercato/shared/lib/email/send'
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
import {
  DELIVERY_WINDOW_EXCEEDED_ERROR,
  planTransientRetry,
  recordExternalDeliverySummary,
  settleExternalParticipants,
} from '../lib/externalParticipants'
import {
  sendMessageEmailToExternal,
  sendMessageEmailToRecipient,
} from '../lib/email-sender'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { ensureMessagesEmailRetrySchedule } from '../lib/emailRetrySchedule'

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
const NOT_CONFIRMED_ERROR = 'Not confirmed by the mail provider'

export async function enqueueMessageEmailJob(job: SendMessageEmailJob, options?: EnqueueOptions): Promise<void> {
  const strategy = process.env.QUEUE_STRATEGY === 'async' ? 'async' : 'local'
  await createQueue<SendMessageEmailJob>(MESSAGES_EMAIL_QUEUE_NAME, strategy).enqueue(job, options)
}

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

type PlannedParticipant = MessageExternalParticipant

export type ExternalParticipantOutcome = {
  sent: PlannedParticipant[]
  failed: Array<{ participant: PlannedParticipant; error: string }>
  retry: Array<{ participant: PlannedParticipant; error: string; nextAttemptAt: Date }>
}

/**
 * Accepted → sent; a transient rejection waits for the provider's retry time or the
 * configured delay (failed once the delivery window is over); any other rejection fails.
 * A participant the provider neither accepted nor rejected is retried.
 */
export function planExternalParticipantOutcome(
  participants: PlannedParticipant[],
  result: EmailSendResult,
  messageSentAt: Date | null | undefined,
  now: Date = new Date(),
): ExternalParticipantOutcome {
  const acceptedKeys = new Set(result.accepted.map((address) => address.toLowerCase()))
  const rejections = new Map(result.rejected.map((entry) => [entry.address.toLowerCase(), entry]))
  const outcome: ExternalParticipantOutcome = { sent: [], failed: [], retry: [] }
  for (const participant of participants) {
    const key = participant.email.toLowerCase()
    if (acceptedKeys.has(key)) {
      outcome.sent.push(participant)
      continue
    }
    const rejection: EmailRejection = rejections.get(key) ?? { address: participant.email, error: NOT_CONFIRMED_ERROR, transient: true }
    if (rejection.transient !== true) {
      outcome.failed.push({ participant, error: rejection.error })
      continue
    }
    const plan = planTransientRetry({ messageSentAt, retryAt: rejection.retryAt ?? result.retryAt, now })
    if ('expired' in plan) outcome.failed.push({ participant, error: DELIVERY_WINDOW_EXCEEDED_ERROR })
    else outcome.retry.push({ participant, error: rejection.error, nextAttemptAt: plan.nextAttemptAt })
  }
  return outcome
}

/** A thrown send becomes a per-address result; errors without a hint count as transient. */
export function sendErrorToResult(error: unknown, participants: PlannedParticipant[]): EmailSendResult {
  const hints = readEmailDeliveryErrorHints(error)
  if (hints.rejected && hints.rejected.length > 0) {
    return { accepted: [], rejected: hints.rejected, ...(hints.retryAt ? { retryAt: hints.retryAt } : {}) }
  }
  const message = error instanceof Error ? error.message : 'Unknown error'
  return {
    accepted: [],
    rejected: participants.map((participant) => ({ address: participant.email, error: message, transient: hints.transient ?? true })),
    ...(hints.retryAt ? { retryAt: hints.retryAt } : {}),
  }
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
  const claimUntil = message.emailDeliveryRoute === 'system' ? await claimExternalParticipants(em, payload) : null
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

  let result: EmailSendResult
  try {
    result = await sendMessageEmailToExternal({
      message,
      email: participants.map((participant) => participant.email),
      sendSeparately: message.emailSendSeparately,
      ...delivery,
    })
  } catch (error) {
    logger.warn('External participants email send failed', { err: error, messageId: message.id })
    result = sendErrorToResult(error, participants)
  }

  const outcome = planExternalParticipantOutcome(participants, result, message.sentAt)
  const target = { messageId: payload.messageId, ...scope }
  await settleExternalParticipants(
    em,
    target,
    {
      sent: outcome.sent.map((participant) => participant.id),
      failed: outcome.failed.map(({ participant, error }) => ({ id: participant.id, error })),
      retry: outcome.retry.map(({ participant, error, nextAttemptAt }) => ({ id: participant.id, error, nextAttemptAt })),
    },
    { claimedUntil: claimUntil },
  )
  if (outcome.sent.length > 0) {
    await recordExternalDeliverySummary(em, target, { sentAt: new Date() })
  } else if (outcome.retry.length === 0 && outcome.failed.length > 0) {
    await recordExternalDeliverySummary(em, target, { error: outcome.failed[0].error })
  }

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
  for (const participant of outcome.sent) {
    await emitEmailDeliveryEvent(ctx, 'messages.message.email_sent', { ...eventBase, ...participantEventFields(participant) })
  }
  for (const { participant, error } of outcome.failed) {
    await emitEmailDeliveryEvent(ctx, 'messages.message.email_failed', { ...eventBase, ...participantEventFields(participant), error })
  }

  if (outcome.retry.length > 0) {
    await ensureMessagesEmailRetrySchedule(ctx, { tenantId: message.tenantId, organizationId: message.organizationId ?? null })
    const nextAttemptAt = Math.min(...outcome.retry.map((entry) => entry.nextAttemptAt.getTime()))
    // A second of slack so the job never lands before the claim becomes due again.
    await enqueueMessageEmailJob(payload, { delayMs: Math.max(0, nextAttemptAt - Date.now()) + 1000 })
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
