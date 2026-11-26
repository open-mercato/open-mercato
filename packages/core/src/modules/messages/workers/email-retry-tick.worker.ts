import type { EntityManager } from '@mikro-orm/postgresql'
import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { getEmailDeliveryRetryDelaySeconds } from '@open-mercato/shared/lib/email/delivery-config'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { Message, MessageExternalParticipant } from '../data/entities'
import { MESSAGES_EMAIL_RETRY_QUEUE_NAME } from '../lib/emailRetrySchedule'
import {
  DELIVERY_WINDOW_EXCEEDED_ERROR,
  planTransientRetry,
  settleExternalParticipants,
} from '../lib/externalParticipants'
import { SEND_AS_USER_SOURCE_ENTITY_TYPE } from '../lib/messageSourceEntityTypes'
import { enqueueMessageEmailJob } from './send-email.worker'

const logger = createLogger('messages').child({ component: 'email-retry-tick' })

export const EMAIL_RETRY_TICK_BATCH = 200

export const metadata: WorkerMeta = {
  queue: MESSAGES_EMAIL_RETRY_QUEUE_NAME,
  id: 'messages:email-retry-tick',
  concurrency: 1,
}

type EmailRetryTickPayload = {
  scope?: { tenantId?: string | null; organizationId?: string | null }
  tenantId?: string | null
  organizationId?: string | null
}

type ContainerLike = { resolve: <T = unknown>(name: string) => T }

type EnqueueOutboundDelivery = (payload: {
  messageId: string
  scope: { tenantId: string; organizationId: string | null }
  externalParticipantId?: string | null
}) => Promise<void>

function tryResolveEnqueueOutbound(container: ContainerLike): EnqueueOutboundDelivery | undefined {
  try {
    return container.resolve<EnqueueOutboundDelivery>('communicationChannelsEnqueueOutboundDelivery')
  } catch {
    return undefined
  }
}

/**
 * Finds the organization's external participants whose retry is due (or whose
 * first job never ran) and re-enqueues their delivery on the path that owns it:
 * the mailbox outbound job per link once a `send_as_user` message is linked, the
 * system `external_participants` job only for a message whose recorded route is
 * `system`. Any other route (no email delivery, a channel conversation, a mailbox
 * hand-off still in progress) is left to its owner. Participants past the delivery window
 * are failed here, so they settle even when no job runs any more. Duplicate jobs
 * are harmless: both paths claim participants before sending.
 */
export async function runEmailRetryTick(
  em: EntityManager,
  container: ContainerLike,
  scope: { tenantId: string; organizationId: string | null },
  now: Date = new Date(),
): Promise<{ enqueued: number; expired: number }> {
  const firstJobLostBefore = new Date(now.getTime() - getEmailDeliveryRetryDelaySeconds() * 1000)
  const due = await findWithDecryption(
    em,
    MessageExternalParticipant,
    {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deliveryStatus: 'pending',
      $or: [{ nextAttemptAt: { $lte: now } }, { nextAttemptAt: null, createdAt: { $lte: firstJobLostBefore } }],
    },
    { orderBy: { nextAttemptAt: 'asc' }, limit: EMAIL_RETRY_TICK_BATCH },
    scope,
  )
  if (due.length === 0) return { enqueued: 0, expired: 0 }

  const messages = await findWithDecryption(
    em,
    Message,
    {
      id: { $in: Array.from(new Set(due.map((participant) => participant.messageId))) },
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
      isDraft: false,
    },
    undefined,
    scope,
  )
  const enqueueOutbound = tryResolveEnqueueOutbound(container)
  let enqueued = 0
  let expired = 0
  for (const message of messages) {
    if (!message.sentAt || message.sentAt.getTime() > now.getTime()) continue
    const participants = due.filter((participant) => participant.messageId === message.id)
    const target = { messageId: message.id, tenantId: scope.tenantId, organizationId: scope.organizationId }
    if ('expired' in planTransientRetry({ messageSentAt: message.sentAt, now })) {
      await settleExternalParticipants(
        em,
        target,
        { failed: participants.map((participant) => ({ id: participant.id, error: DELIVERY_WINDOW_EXCEEDED_ERROR })) },
        { pendingOnly: true },
      )
      expired += participants.length
      continue
    }
    if (message.sourceEntityType === SEND_AS_USER_SOURCE_ENTITY_TYPE) {
      if (!enqueueOutbound) continue
      const linkParticipantIds = message.emailSendSeparately ? participants.map((participant) => participant.id) : [null]
      for (const externalParticipantId of linkParticipantIds) {
        await enqueueOutbound({ messageId: message.id, scope, externalParticipantId })
        enqueued += 1
      }
      continue
    }
    if (message.emailDeliveryRoute !== 'system') continue
    await enqueueMessageEmailJob({
      type: 'external_participants',
      messageId: message.id,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    })
    enqueued += 1
  }
  return { enqueued, expired }
}

export default async function handle(
  job: QueuedJob<EmailRetryTickPayload>,
  ctx: JobContext & ContainerLike,
): Promise<void> {
  const raw = job?.payload ?? {}
  const tenantId = raw.scope?.tenantId ?? raw.tenantId ?? null
  const organizationId = raw.scope?.organizationId ?? raw.organizationId ?? null
  if (!tenantId) {
    logger.warn('skipping tick — payload has no tenantId')
    return
  }
  const em = ctx.resolve<EntityManager>('em').fork()
  const result = await runEmailRetryTick(em, ctx, { tenantId, organizationId })
  if (result.enqueued > 0 || result.expired > 0) {
    logger.info('email retry tick', { tenantId, organizationId, ...result })
  }
}
