import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { buildBatchNotificationFromType } from '../../notifications/lib/notificationBuilder'
import { resolveNotificationService } from '../../notifications/lib/notificationService'
import { User } from '../../auth/data/entities'
import { Message } from '../data/entities'
import { notificationTypes } from '../notifications'

export const metadata = {
  event: 'messages.message.sent',
  persistent: true,
  id: 'messages:in-app-notification',
}

type MessageSentPayload = {
  messageId: string
  senderUserId: string
  recipientUserIds: string[]
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
}
