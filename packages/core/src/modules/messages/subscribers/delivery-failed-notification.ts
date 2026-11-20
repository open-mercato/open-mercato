import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { buildBatchNotificationFromType } from '../../notifications/lib/notificationBuilder'
import { resolveNotificationService } from '../../notifications/lib/notificationService'
import { Message, MessageExternalParticipant } from '../data/entities'
import { notificationTypes } from '../notifications'
import { SYSTEM_SENDER_USER_ID } from '../lib/constants'

export const metadata = {
  event: 'messages.message.delivery_finished',
  persistent: true,
  id: 'messages:delivery-failed-notification',
}

type DeliveryFinishedPayload = {
  messageId: string
  sentCount: number
  failedCount: number
  tenantId: string
  organizationId?: string | null
}

type ResolverContext = {
  resolve: <T = unknown>(name: string) => T
}

const MAX_LISTED_ADDRESSES = 10

export default async function handle(payload: DeliveryFinishedPayload, ctx: ResolverContext): Promise<void> {
  if (!(payload.failedCount > 0)) return
  const typeDef = notificationTypes.find((type) => type.type === 'messages.delivery_failed')
  if (!typeDef) return

  const scope = { tenantId: payload.tenantId, organizationId: payload.organizationId ?? null }
  const em = ctx.resolve<EntityManager>('em').fork()
  const message = await findOneWithDecryption(
    em,
    Message,
    { id: payload.messageId, ...scope, deletedAt: null },
    undefined,
    scope,
  )
  if (!message || message.senderUserId === SYSTEM_SENDER_USER_ID) return

  const failed = await findWithDecryption(
    em,
    MessageExternalParticipant,
    { messageId: message.id, ...scope, deliveryStatus: 'failed' },
    { orderBy: { createdAt: 'asc' } },
    scope,
  )
  if (failed.length === 0) return

  const listed = failed.slice(0, MAX_LISTED_ADDRESSES).map((participant) => participant.email)
  const addresses = failed.length > listed.length ? `${listed.join(', ')}, …` : listed.join(', ')
  const variables = {
    subject: message.subject ?? '',
    count: String(failed.length),
    addresses,
  }
  await resolveNotificationService(ctx).createBatch(
    buildBatchNotificationFromType(typeDef, {
      recipientUserIds: [message.senderUserId],
      titleVariables: variables,
      bodyVariables: variables,
      sourceEntityType: 'message',
      sourceEntityId: message.id,
      linkHref: `/backend/messages/${message.id}`,
      groupKey: `messages.delivery_failed:${message.id}`,
    }),
    scope,
  )
}
