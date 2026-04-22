import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { emitSourceSubmissionRequested } from '@open-mercato/core/modules/inbox_ops/lib/source-submission-request'
import { Message } from '@open-mercato/core/modules/messages/data/entities'

export const metadata = {
  event: 'messages.message.sent',
  persistent: true,
  id: 'example:messages-sent-inbox-ops-demo',
}

const messagesSentPayloadSchema = z.object({
  messageId: z.string().uuid(),
  tenantId: z.string().uuid(),
  organizationId: z.string().uuid().nullable().optional(),
})

function shouldRouteToInboxOps(message: Message): boolean {
  return /^\s*\[AI\]\s*/i.test(message.subject)
}

type HandlerContext = {
  resolve: <T = unknown>(name: string) => T
}

export default async function handle(rawPayload: unknown, ctx: HandlerContext): Promise<void> {
  const payload = messagesSentPayloadSchema.parse(rawPayload)
  if (!payload.organizationId) return

  const em = (ctx.resolve('em') as EntityManager).fork()
  const scope = {
    tenantId: payload.tenantId,
    organizationId: payload.organizationId,
  }

  const message = await findOneWithDecryption(
    em,
    Message,
    {
      id: payload.messageId,
      tenantId: payload.tenantId,
      organizationId: payload.organizationId,
      deletedAt: null,
    },
    undefined,
    scope,
  )

  if (!message || !message.organizationId) {
    return
  }

  if (!shouldRouteToInboxOps(message)) {
    return
  }

  await emitSourceSubmissionRequested({
    descriptor: {
      sourceEntityType: 'messages:message',
      sourceEntityId: message.id,
      sourceVersion: message.sentAt?.toISOString() ?? message.createdAt.toISOString(),
      tenantId: message.tenantId,
      organizationId: message.organizationId,
      requestedByUserId: message.senderUserId,
      triggerEventId: 'messages.message.sent',
    },
  })
}

