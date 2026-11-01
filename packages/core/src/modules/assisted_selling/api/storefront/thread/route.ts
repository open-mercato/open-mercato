import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'

import { AssistedSellingMessage, AssistedSellingParticipant, AssistedSellingProposal, AssistedSellingThread } from '../../../data/entities'
import { assistedSellingBuyerThreadOpenRequestSchema } from '../../../data/validators'
import {
  mapAssistedSellingBuyerRouteError,
  notFoundThreadResponse,
  readAssistedSellingCartToken,
  resolveIdentifiedBuyerBasket,
} from '../../../lib/buyerIdentity'
import { enforceAssistedSellingBuyerRateLimit } from '../../../lib/rateLimit'
import {
  openThreadAsBuyerCommand,
  type AssistedSellingThreadOpenAsBuyerInput,
  type AssistedSellingThreadOpenAsBuyerResult,
} from '../../../commands/buyerThread'

// Step 4.5 (§6.2). `GET/POST /api/assisted_selling/storefront/thread` — the buyer's own half
// of the conversation, cart-token bound (D-R5-13/D-R5-21), no ACL feature (§6.9): "the token
// holder is the buyer acting in their own conversation, and a guest has no ACL identity."

export const metadata = {
  GET: { requireAuth: false },
  POST: { requireAuth: false },
}

async function loadOpenThread(em: EntityManager, scope: { tenantId: string; organizationId: string }, buyerCartId: string) {
  return em.findOne(AssistedSellingThread, { ...scope, buyerCartId, status: 'open', deletedAt: null })
}

export async function GET(request: Request) {
  try {
    const container = await createRequestContainer()
    const token = readAssistedSellingCartToken(request)

    const limited = await enforceAssistedSellingBuyerRateLimit(container, request, 'read', token)
    if (limited) return limited
    if (!token) return notFoundThreadResponse()

    const basket = await resolveIdentifiedBuyerBasket(container, request, token)
    if (!basket) return notFoundThreadResponse()

    const em = (container.resolve('em') as EntityManager).fork()
    const scope = { tenantId: basket.tenantId, organizationId: basket.organizationId }
    const thread = await loadOpenThread(em, scope, basket.id)
    if (!thread) return notFoundThreadResponse()

    const [participants, messages, proposals] = await Promise.all([
      findWithDecryption(
        em,
        AssistedSellingParticipant,
        { ...scope, threadId: thread.id, deletedAt: null },
        { orderBy: { joinedAt: 'ASC' } },
        scope,
      ) as Promise<AssistedSellingParticipant[]>,
      findWithDecryption(
        em,
        AssistedSellingMessage,
        { ...scope, threadId: thread.id, deletedAt: null },
        { orderBy: { sentAt: 'ASC' } },
        scope,
      ) as Promise<AssistedSellingMessage[]>,
      em.find(AssistedSellingProposal, { ...scope, threadId: thread.id, deletedAt: null }, { orderBy: { createdAt: 'DESC' } }),
    ])

    return NextResponse.json({
      thread: {
        id: thread.id,
        status: thread.status,
        modeSnapshot: thread.modeSnapshot,
        lastActivityAt: thread.lastActivityAt.toISOString(),
        createdAt: thread.createdAt.toISOString(),
        updatedAt: thread.updatedAt.toISOString(),
      },
      // §8.3/R3: the rep participant (and, from Phase 3, the AI one) is never suppressed —
      // every participant row is always included, unconditionally.
      participants: participants.map((p) => ({
        id: p.id,
        actorType: p.actorType,
        displayName: p.displayName,
        joinedAt: p.joinedAt.toISOString(),
        leftAt: p.leftAt ? p.leftAt.toISOString() : null,
      })),
      // §6.2: "messages (text)" — plaintext bodies, decrypted.
      messages: messages.map((m) => ({
        id: m.id,
        participantId: m.participantId,
        body: m.body,
        bodyFormat: m.bodyFormat,
        proposalId: m.proposalId ?? null,
        sentAt: m.sentAt.toISOString(),
      })),
      proposalIds: proposals.map((p) => p.id),
    })
  } catch (error) {
    return mapAssistedSellingBuyerRouteError(error)
  }
}

export async function POST(request: Request) {
  try {
    const container = await createRequestContainer()
    const token = readAssistedSellingCartToken(request)

    const limited = await enforceAssistedSellingBuyerRateLimit(container, request, 'open', token)
    if (limited) return limited
    if (!token) return notFoundThreadResponse()

    const basket = await resolveIdentifiedBuyerBasket(container, request, token)
    if (!basket) return notFoundThreadResponse()
    // §5.1: `AssistedSellingThread.storeId` is non-nullable — a basket with no resolved
    // store has no settings row to read and cannot open a buyer-side conversation either.
    if (!basket.storeId) {
      return NextResponse.json({ error: '[internal] assisted_selling_unavailable', code: 'assisted_selling_unavailable' }, { status: 409 })
    }

    const rawBody = (await readJsonSafe<Record<string, unknown>>(request, {})) ?? {}
    try {
      assistedSellingBuyerThreadOpenRequestSchema.parse(rawBody)
    } catch (err) {
      if (err instanceof z.ZodError) {
        return NextResponse.json({ error: '[internal] invalid request body', issues: err.issues }, { status: 400 })
      }
      throw err
    }

    const ctx: CommandRuntimeContext = {
      container,
      auth: null,
      organizationScope: null,
      selectedOrganizationId: basket.organizationId,
      organizationIds: null,
      request,
    }
    const commandInput: AssistedSellingThreadOpenAsBuyerInput = {
      tenantId: basket.tenantId,
      organizationId: basket.organizationId,
      storeId: basket.storeId,
      buyerCartId: basket.id,
      customerId: basket.customerId,
      customerUserId: basket.customerUserId,
    }

    const commandBus = container.resolve('commandBus') as CommandBus
    const { result } = await commandBus.execute<AssistedSellingThreadOpenAsBuyerInput, AssistedSellingThreadOpenAsBuyerResult>(
      openThreadAsBuyerCommand.id,
      { input: commandInput, ctx },
    )

    return NextResponse.json({ ok: true, result }, { status: result.alreadyOpen ? 200 : 201 })
  } catch (error) {
    return mapAssistedSellingBuyerRouteError(error)
  }
}

const buyerThreadResponseSchema = z.object({
  thread: z.object({
    id: z.string().uuid(),
    status: z.enum(['open', 'closed']),
    modeSnapshot: z.string(),
    lastActivityAt: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
  }),
  participants: z.array(
    z.object({
      id: z.string().uuid(),
      actorType: z.enum(['buyer', 'rep', 'ai_agent']),
      displayName: z.string(),
      joinedAt: z.string(),
      leftAt: z.string().nullable(),
    }),
  ),
  messages: z.array(
    z.object({
      id: z.string().uuid(),
      participantId: z.string().uuid(),
      body: z.string(),
      bodyFormat: z.literal('text'),
      proposalId: z.string().uuid().nullable(),
      sentAt: z.string(),
    }),
  ),
  proposalIds: z.array(z.string().uuid()),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Assisted Selling',
  summary: 'Buyer-facing selling conversation for the current basket',
  methods: {
    GET: {
      summary: 'Read the open thread for the current basket (§6.2)',
      description: 'Cart-token bound (X-Cart-Token); the D-R5-13/D-R5-21 identified-buyer binding applies when the basket is identified.',
      responses: [{ status: 200, description: 'The open thread with participants, messages and proposal ids', schema: buyerThreadResponseSchema }],
      errors: [{ status: 404, description: 'No/unknown token, identity-binding mismatch, or no open thread' }, { status: 429, description: 'Rate limited' }],
    },
    POST: {
      summary: 'Buyer opens a conversation about the current basket (§6.2)',
      requestBody: { contentType: 'application/json', schema: assistedSellingBuyerThreadOpenRequestSchema },
      responses: [
        { status: 201, description: 'A new thread was opened' },
        { status: 200, description: 'An open thread already existed; nothing was created' },
      ],
      errors: [
        { status: 404, description: 'No/unknown token, or identity-binding mismatch' },
        { status: 409, description: 'assisted_selling_unavailable' },
        { status: 429, description: 'Rate limited' },
      ],
    },
  },
}
