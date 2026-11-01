import { randomUUID } from 'node:crypto'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { notFound } from '@open-mercato/shared/lib/crud/errors'
import { ensureTenantScope } from '@open-mercato/shared/lib/commands/scope'
import type { EntityManager } from '@mikro-orm/postgresql'
import { AssistedSellingMessage, AssistedSellingThread } from '../data/entities'
import { resolveOrBuildRepParticipant } from '../lib/participants'
import { emitAssistedSellingEvent } from '../events'
import { requireAssistedSellingFeatures } from './shared'

// Step 5.3 (§6.1, §7.1's "Composer"). The staff-side counterpart of
// `commands/buyerThread.ts#postMessageAsBuyerCommand` — plain-text only (S24, body_format is
// never anything else per `data/validators.ts`'s own `.strict()` schema). No live-mode check:
// §8.4's own text ("flipping the store to off mid-conversation... leaves an already-published
// [proposal] acceptable") is about proposals, and §6.1's table gates ONLY opening/joining/
// authoring on the live mode — posting a plain message into an ALREADY open conversation is
// not one of those four actions, mirroring the buyer-side message route's identical "no
// live-mode check here" posture.

async function resolveThreadForCaller(
  em: EntityManager,
  scope: { tenantId: string; organizationIds: string[] | null },
  threadId: string,
): Promise<AssistedSellingThread> {
  const where: Record<string, unknown> = { id: threadId, tenantId: scope.tenantId, deletedAt: null }
  if (Array.isArray(scope.organizationIds)) {
    if (scope.organizationIds.length === 0) throw notFound('[internal] thread not found')
    where.organizationId = { $in: scope.organizationIds }
  }
  const thread = await em.findOne(AssistedSellingThread, where)
  if (!thread) throw notFound('[internal] thread not found')
  return thread
}

export type AssistedSellingMessagePostInput = {
  tenantId: string
  organizationIds: string[] | null
  threadId: string
  body: string
}

export type AssistedSellingMessagePostResult = {
  threadId: string
  messageId: string
  participantId: string
}

const postMessageCommand: CommandHandler<AssistedSellingMessagePostInput, AssistedSellingMessagePostResult> = {
  id: 'assisted_selling.message.post',
  isUndoable: false,
  async execute(input, ctx: CommandRuntimeContext) {
    ensureTenantScope(ctx, input.tenantId)
    await requireAssistedSellingFeatures(ctx, ['assisted_selling.messages.post'])
    const actorId = ctx.auth?.sub
    if (!actorId) throw notFound('[internal] no authenticated principal to post this message as')

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const thread = await resolveThreadForCaller(em, { tenantId: input.tenantId, organizationIds: input.organizationIds }, input.threadId)

    const { participant } = await resolveOrBuildRepParticipant(
      em,
      { tenantId: thread.tenantId, organizationId: thread.organizationId, threadId: thread.id },
      actorId,
    )

    const now = new Date()
    const message = em.create(AssistedSellingMessage, {
      id: randomUUID(),
      tenantId: thread.tenantId,
      organizationId: thread.organizationId,
      threadId: thread.id,
      participantId: participant.id,
      body: input.body,
      bodyFormat: 'text' as const,
      sentAt: now,
      createdAt: now,
      updatedAt: now,
    })
    thread.lastActivityAt = now
    thread.updatedAt = now

    await withAtomicFlush(
      em,
      [
        async () => {
          em.persist(participant)
          em.persist(message)
          em.persist(thread)
        },
      ],
      { transaction: true, label: 'assisted_selling.message.post' },
    )

    await emitAssistedSellingEvent('assisted_selling.message.posted', {
      threadId: thread.id,
      messageId: message.id,
      tenantId: thread.tenantId,
      organizationId: thread.organizationId,
    })

    return { threadId: thread.id, messageId: message.id, participantId: participant.id }
  },
}

registerCommand(postMessageCommand)

export { postMessageCommand }
