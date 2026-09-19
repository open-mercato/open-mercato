import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createQueue } from '@open-mercato/queue'
import { buildBatchNotificationFromType } from '../../notifications/lib/notificationBuilder'
import { resolveNotificationService } from '../../notifications/lib/notificationService'
import {
  MESSAGES_EMAIL_QUEUE_NAME,
  type SendMessageEmailJob,
} from '../workers/send-email.worker'
import { User } from '../../auth/data/entities'
import { Message } from '../data/entities'
import { notificationTypes } from '../notifications'
import {
  EXTERNAL_CONVERSATION_SOURCE_ENTITY_TYPE,
  SEND_AS_USER_SOURCE_ENTITY_TYPE,
} from '../lib/messageSourceEntityTypes'

export const metadata = {
  event: 'messages.message.sent',
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

async function resolveNotificationVariables(payload: MessageSentPayload, ctx: ResolverContext): Promise<{ title: string; from: string }> {
  try {
    const em = ctx.resolve<EntityManager>('em')?.fork()
    if (!em) return { title: '', from: '' }

    const scope = {
      tenantId: payload.tenantId,
      organizationId: payload.organizationId ?? null,
    }
    const whereUser: { id: string; tenantId: string; deletedAt: null; organizationId?: string | null } = {
      id: payload.senderUserId,
      tenantId: payload.tenantId,
      deletedAt: null,
    }
    if (payload.organizationId !== undefined) {
      whereUser.organizationId = payload.organizationId
    }

    const [message, sender] = await Promise.all([
      findOneWithDecryption(
        em,
        Message,
        {
          id: payload.messageId,
          tenantId: payload.tenantId,
          deletedAt: null,
        },
        undefined,
        scope,
      ),
      findOneWithDecryption(
        em,
        User,
        whereUser,
        undefined,
        scope,
      ),
    ])

    return {
      title: typeof message?.subject === 'string' ? message.subject : '',
      from: typeof sender?.name === 'string' && sender.name.trim().length > 0
        ? sender.name
        : typeof sender?.email === 'string'
          ? sender.email
          : '',
    }
  } catch {
    return { title: '', from: '' }
  }
}


/**
 * Whether this Message is already being delivered through a connected
 * channel (`sendAsUser`, or the platform copy of an inbound channel message),
 * so the external-email job below would duplicate — or, for the inbound
 * case, misdirect — the send. Mirrors `outbound-bridge.ts`'s re-fetch: the
 * `messages.message.sent` payload doesn't carry `sourceEntityType` and never
 * should, to keep this subscriber decoupled from `communication_channels`.
 *
 * Fails open (`false`, i.e. today's behavior) when the Message can't be
 * found — we can only skip the external send when we can affirmatively show
 * it is channel-routed.
 */
async function isChannelRoutedMessage(payload: MessageSentPayload, ctx: ResolverContext): Promise<boolean> {
  try {
    const em = ctx.resolve<EntityManager>('em')?.fork()
    if (!em) return false

    const message = await findOneWithDecryption(
      em,
      Message,
      {
        id: payload.messageId,
        tenantId: payload.tenantId,
        organizationId: payload.organizationId ?? null,
        deletedAt: null,
      },
      undefined,
      {
        tenantId: payload.tenantId,
        organizationId: payload.organizationId ?? null,
      },
    )
    if (!message) return false
    return (
      message.sourceEntityType === SEND_AS_USER_SOURCE_ENTITY_TYPE ||
      message.sourceEntityType === EXTERNAL_CONVERSATION_SOURCE_ENTITY_TYPE
    )
  } catch {
    return false
  }
}

export default async function handle(payload: MessageSentPayload, ctx: ResolverContext): Promise<void> {
  const uniqueRecipientUserIds = Array.from(new Set(payload.recipientUserIds))

  const typeDef = notificationTypes.find((type) => type.type === 'messages.new')
  if (typeDef && uniqueRecipientUserIds.length > 0) {
    const variables = await resolveNotificationVariables(payload, ctx)
    const notificationService = resolveNotificationService(ctx)
    const notificationInput = buildBatchNotificationFromType(typeDef, {
      recipientUserIds: uniqueRecipientUserIds,
      titleVariables: variables,
      bodyVariables: variables,
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
  if (externalEmail && !(await isChannelRoutedMessage(payload, ctx))) {
    await emailQueue.enqueue({
      type: 'external',
      messageId: payload.messageId,
      email: externalEmail,
      tenantId: payload.tenantId,
      organizationId: payload.organizationId ?? null,
    })
  }
}
