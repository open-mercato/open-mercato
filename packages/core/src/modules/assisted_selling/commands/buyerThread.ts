import { randomUUID } from 'node:crypto'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { CrudHttpError, isUniqueViolation, notFound } from '@open-mercato/shared/lib/crud/errors'
import type { EntityManager } from '@mikro-orm/postgresql'
import { AssistedSellingMessage, AssistedSellingThread } from '../data/entities'
import { resolveEffectiveAssistedSellingSettings } from '../lib/settings'
import { resolveOrBuildBuyerParticipant } from '../lib/participants'
import { emitAssistedSellingEvent } from '../events'

// Step 4.5 (§6.2). The BUYER side of `commands/threads.ts`/`commands/proposals.ts`'s staff
// commands — dispatched from the `/api/assisted_selling/storefront/thread*` routes with
// `ctx.auth: null` (no staff principal, mirrors `cart`'s own `buildCommandContext` for
// `/current/*`). Trust comes from the ALREADY-RESOLVED `AssistedSellingBuyerBasket`
// (`lib/buyerIdentity.ts`'s D-R5-21 identity check, run at the route edge before either
// command below is ever dispatched) — never from `ctx.auth`, which does not exist here, and
// never from a request body. Neither command calls `requireAssistedSellingFeatures`: §6.9's
// own text is explicit that the buyer side has "no ACL feature... a guest has no ACL
// identity."

function findOpenThreadByBuyerCart(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
  buyerCartId: string,
): Promise<AssistedSellingThread | null> {
  return em.findOne(AssistedSellingThread, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    buyerCartId,
    status: 'open',
    deletedAt: null,
  })
}

// ---------------------------------------------------------------------------
// assisted_selling.thread.openAsBuyer — POST /storefront/thread (§6.2)
// ---------------------------------------------------------------------------

export type AssistedSellingThreadOpenAsBuyerInput = {
  tenantId: string
  organizationId: string
  storeId: string
  buyerCartId: string
  customerId: string | null
  customerUserId: string | null
}

export type AssistedSellingThreadOpenAsBuyerResult = {
  threadId: string
  status: string
  alreadyOpen: boolean
}

const openThreadAsBuyerCommand: CommandHandler<AssistedSellingThreadOpenAsBuyerInput, AssistedSellingThreadOpenAsBuyerResult> = {
  id: 'assisted_selling.thread.openAsBuyer',
  // Same treatment `assisted_selling.thread.open` (staff) gives itself — opening has no
  // meaningful undo.
  isUndoable: false,
  async execute(input, ctx: CommandRuntimeContext) {
    const scope = { tenantId: input.tenantId, organizationId: input.organizationId }
    const em = (ctx.container.resolve('em') as EntityManager).fork()

    // §6.2: "When the basket already has an open thread, returns it with 200 and creates
    // nothing" — read-only branch, no settings check, no mutation.
    const existingOpen = await findOpenThreadByBuyerCart(em, scope, input.buyerCartId)
    if (existingOpen) {
      return { threadId: existingOpen.id, status: existingOpen.status, alreadyOpen: true }
    }

    // §6.3 step 0 / §6.2: "refused with 409 assisted_selling_unavailable when the live mode
    // is off." The buyer is opening the conversation, not authoring — no actor-type mode
    // check beyond "not off" applies to this call.
    const settings = await resolveEffectiveAssistedSellingSettings(em, {
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      storeId: input.storeId,
    })
    if (settings.mode === 'off') {
      throw new CrudHttpError(409, { error: '[internal] assisted_selling_unavailable', code: 'assisted_selling_unavailable' })
    }

    const now = new Date()
    const threadId = randomUUID()
    const thread = em.create(AssistedSellingThread, {
      id: threadId,
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      storeId: input.storeId,
      buyerCartId: input.buyerCartId,
      customerId: input.customerId,
      customerUserId: input.customerUserId,
      status: 'open' as const,
      modeSnapshot: settings.mode,
      liveProposalCount: 0,
      lastActivityAt: now,
      createdAt: now,
      updatedAt: now,
    })
    const { participant } = await resolveOrBuildBuyerParticipant(em, { tenantId: input.tenantId, organizationId: input.organizationId, threadId }, input.customerUserId)

    try {
      await withAtomicFlush(
        em,
        [
          async () => {
            em.persist(thread)
            em.persist(participant)
          },
        ],
        { transaction: true, label: 'assisted_selling.thread.openAsBuyer' },
      )
    } catch (error) {
      // §5.1's partial unique index (`tenant_id`, `buyer_cart_id` where `status = 'open'`) is
      // the race backstop here too — mirrors `assisted_selling.thread.open`'s own catch.
      if (isUniqueViolation(error)) {
        const winnerEm = (ctx.container.resolve('em') as EntityManager).fork()
        const winner = await findOpenThreadByBuyerCart(winnerEm, scope, input.buyerCartId)
        if (winner) return { threadId: winner.id, status: winner.status, alreadyOpen: true }
      }
      throw error
    }

    await emitAssistedSellingEvent('assisted_selling.thread.opened', {
      threadId,
      tenantId: input.tenantId,
      organizationId: input.organizationId,
    })
    await emitAssistedSellingEvent('assisted_selling.participant.joined', {
      threadId,
      participantId: participant.id,
      tenantId: input.tenantId,
      organizationId: input.organizationId,
    })

    return { threadId, status: 'open', alreadyOpen: false }
  },
}

// ---------------------------------------------------------------------------
// assisted_selling.message.postAsBuyer — POST /storefront/thread/messages (§6.2)
// ---------------------------------------------------------------------------

export type AssistedSellingMessagePostAsBuyerInput = {
  tenantId: string
  organizationId: string
  buyerCartId: string
  customerUserId: string | null
  body: string
}

export type AssistedSellingMessagePostAsBuyerResult = {
  messageId: string
  threadId: string
}

const postMessageAsBuyerCommand: CommandHandler<AssistedSellingMessagePostAsBuyerInput, AssistedSellingMessagePostAsBuyerResult> = {
  id: 'assisted_selling.message.postAsBuyer',
  isUndoable: false,
  async execute(input, ctx: CommandRuntimeContext) {
    const scope = { tenantId: input.tenantId, organizationId: input.organizationId }
    const em = (ctx.container.resolve('em') as EntityManager).fork()

    // §6.2: "404 when the basket has no open thread." No live-mode check here — §8.4's own
    // text: "works on an open thread after the store moved to off."
    const thread = await findOpenThreadByBuyerCart(em, scope, input.buyerCartId)
    if (!thread) throw notFound('[internal] no open thread for this basket')

    const { participant } = await resolveOrBuildBuyerParticipant(
      em,
      { tenantId: thread.tenantId, organizationId: thread.organizationId, threadId: thread.id },
      input.customerUserId,
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
    // Bumps `thread.updatedAt` too (the `/thread/events` cursor, §6.2) — a real field
    // change, not a no-op persist.
    thread.lastActivityAt = now

    await withAtomicFlush(
      em,
      [
        async () => {
          em.persist(participant)
          em.persist(message)
          em.persist(thread)
        },
      ],
      { transaction: true, label: 'assisted_selling.message.postAsBuyer' },
    )

    await emitAssistedSellingEvent('assisted_selling.message.posted', {
      threadId: thread.id,
      messageId: message.id,
      tenantId: thread.tenantId,
      organizationId: thread.organizationId,
    })

    return { messageId: message.id, threadId: thread.id }
  },
}

registerCommand(openThreadAsBuyerCommand)
registerCommand(postMessageAsBuyerCommand)

export { openThreadAsBuyerCommand, postMessageAsBuyerCommand }
