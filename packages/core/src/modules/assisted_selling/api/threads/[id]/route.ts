import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError, isCrudHttpError, translateCrudErrorBody } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { AssistedSellingMessage, AssistedSellingParticipant, AssistedSellingProposal, AssistedSellingThread } from '../../../data/entities'
import { organizationIdsFromAssistedSellingScope } from '../../../lib/organizationScope'
import { resolveCartService } from '../../../lib/cartAccess'

const logger = createLogger('assisted_selling').child({ component: 'api' })

// Step 5.3 (§6.1, §7.1's "Thread page"). `GET /threads/:id` — "Thread with participants,
// messages and proposals; 404 outside the caller's organizations." Gated on BOTH
// `assisted_selling.threads.view` and `cart.proposals.view`: "proposals carry the buyer's
// resolved unit prices and their `price_row_id` provenance — that is `cart`'s gated data, and
// serving it under a weaker local feature would undo the two-feature discipline."

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['assisted_selling.threads.view', 'cart.proposals.view'] },
}

const paramsSchema = z.object({ id: z.string().uuid() })

type RouteParams = { params?: { id?: string } | Promise<{ id?: string }> }

function toIso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null
}

export async function GET(req: Request, routeCtx: RouteParams) {
  const { translate } = await resolveTranslations()
  const threadNotFound = () =>
    new CrudHttpError(404, { error: translate('assisted_selling.errors.thread_not_found', 'Selling conversation not found.') })
  try {
    const params = paramsSchema.safeParse(await routeCtx.params)
    if (!params.success) throw threadNotFound()

    const container = await createRequestContainer()
    const auth = await getAuthFromRequest(req)
    if (!auth || !auth.tenantId) {
      return NextResponse.json({ error: translate('assisted_selling.errors.unauthorized', 'Unauthorized') }, { status: 401 })
    }
    const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req }).catch(() => null)
    const organizationIds = organizationIdsFromAssistedSellingScope(scope, scope?.selectedId ?? auth.orgId ?? null)
    if (Array.isArray(organizationIds) && organizationIds.length === 0) throw threadNotFound()

    const em = (container.resolve('em') as EntityManager).fork()
    const where: Record<string, unknown> = { id: params.data.id, tenantId: auth.tenantId, deletedAt: null }
    if (Array.isArray(organizationIds)) where.organizationId = { $in: organizationIds }
    const thread = await em.findOne(AssistedSellingThread, where)
    if (!thread) throw threadNotFound()
    const threadScope = { tenantId: thread.tenantId, organizationId: thread.organizationId }

    const participants = (await findWithDecryption(
      em,
      AssistedSellingParticipant,
      { tenantId: thread.tenantId, threadId: thread.id, deletedAt: null },
      { orderBy: { joinedAt: 'ASC' } },
      threadScope,
    )) as AssistedSellingParticipant[]

    const messages = (await findWithDecryption(
      em,
      AssistedSellingMessage,
      { tenantId: thread.tenantId, threadId: thread.id, deletedAt: null },
      { orderBy: { sentAt: 'ASC', id: 'ASC' } },
      threadScope,
    )) as AssistedSellingMessage[]

    const proposalRows = (await findWithDecryption(
      em,
      AssistedSellingProposal,
      { tenantId: thread.tenantId, threadId: thread.id, deletedAt: null },
      { orderBy: { publishedAt: 'ASC' } },
      threadScope,
    )) as AssistedSellingProposal[]

    const cartService = resolveCartService(container)
    const proposals = await Promise.all(
      proposalRows.map(async (proposal) => {
        // §7.2: "Price provenance is shown to the rep... each proposal line renders the
        // buyer's resolved unit price... labelled as the buyer's." Read back verbatim off
        // the proposal cart, never recomputed (S22). A purged proposal cart (§10.3) still
        // renders — `null` lines rather than a failed load.
        const priced = await cartService.getProposalCartPricedLines({
          tenantId: proposal.tenantId,
          organizationId: proposal.organizationId,
          proposalCartId: proposal.proposalCartId,
        })
        return {
          id: proposal.id,
          proposalCartId: proposal.proposalCartId,
          targetCartId: proposal.targetCartId,
          authoredByActorType: proposal.authoredByActorType,
          authoredByActorId: proposal.authoredByActorId,
          status: proposal.status,
          publishedAt: toIso(proposal.publishedAt),
          expiresAt: toIso(proposal.expiresAt),
          resolvedAt: toIso(proposal.resolvedAt ?? null),
          supersededByProposalId: proposal.supersededByProposalId ?? null,
          mergeLogId: proposal.mergeLogId ?? null,
          currencyCode: priced?.currencyCode ?? null,
          lines: priced?.lines ?? [],
        }
      }),
    )

    return NextResponse.json({
      thread: {
        id: thread.id,
        organizationId: thread.organizationId,
        storeId: thread.storeId,
        buyerCartId: thread.buyerCartId,
        customerId: thread.customerId ?? null,
        customerUserId: thread.customerUserId ?? null,
        status: thread.status,
        modeSnapshot: thread.modeSnapshot,
        assignedActorId: thread.assignedActorId ?? null,
        liveProposalCount: thread.liveProposalCount,
        lastActivityAt: toIso(thread.lastActivityAt),
        closedAt: toIso(thread.closedAt ?? null),
        createdAt: toIso(thread.createdAt),
        updatedAt: toIso(thread.updatedAt),
      },
      participants: participants.map((participant) => ({
        id: participant.id,
        actorType: participant.actorType,
        actorId: participant.actorId ?? null,
        displayName: participant.displayName,
        joinedAt: toIso(participant.joinedAt),
        leftAt: toIso(participant.leftAt ?? null),
      })),
      messages: messages.map((message) => ({
        id: message.id,
        participantId: message.participantId,
        body: message.body,
        bodyFormat: message.bodyFormat,
        proposalId: message.proposalId ?? null,
        sentAt: toIso(message.sentAt),
      })),
      proposals,
    })
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(translateCrudErrorBody(err.body, translate), { status: err.status })
    logger.error('assisted_selling.threads.detail failed', { err })
    return NextResponse.json({ error: translate('assisted_selling.errors.detail_failed', 'Failed to load the selling conversation.') }, { status: 500 })
  }
}

const participantSchema = z.object({
  id: z.string().uuid(),
  actorType: z.enum(['buyer', 'rep', 'ai_agent']),
  actorId: z.string().uuid().nullable(),
  displayName: z.string(),
  joinedAt: z.string(),
  leftAt: z.string().nullable(),
})

const messageSchema = z.object({
  id: z.string().uuid(),
  participantId: z.string().uuid(),
  body: z.string(),
  bodyFormat: z.literal('text'),
  proposalId: z.string().uuid().nullable(),
  sentAt: z.string(),
})

const proposalLineSchema = z.object({
  id: z.string().uuid(),
  productId: z.string().uuid(),
  variantId: z.string().uuid().nullable(),
  sku: z.string().nullable(),
  name: z.string(),
  quantity: z.string(),
  unitPriceNet: z.string().nullable(),
  unitPriceGross: z.string().nullable(),
  taxRate: z.string().nullable(),
  priceKindId: z.string().uuid().nullable(),
  priceRowId: z.string().uuid().nullable(),
  lineTotals: z.record(z.string(), z.unknown()),
})

const proposalSchema = z.object({
  id: z.string().uuid(),
  proposalCartId: z.string().uuid(),
  targetCartId: z.string().uuid(),
  authoredByActorType: z.enum(['rep', 'ai_agent']),
  authoredByActorId: z.string().uuid(),
  status: z.enum(['published', 'accepted', 'rejected', 'withdrawn', 'expired', 'superseded']),
  publishedAt: z.string().nullable(),
  expiresAt: z.string().nullable(),
  resolvedAt: z.string().nullable(),
  supersededByProposalId: z.string().uuid().nullable(),
  mergeLogId: z.string().uuid().nullable(),
  currencyCode: z.string().nullable(),
  lines: z.array(proposalLineSchema),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Assisted Selling',
  summary: 'Selling conversation detail',
  pathParams: z.object({ id: z.string().uuid() }),
  methods: {
    GET: {
      summary: 'Thread with participants, messages and priced proposals (§6.1)',
      description: 'Requires assisted_selling.threads.view AND cart.proposals.view — proposal lines carry the buyer\'s resolved unit price, tax rate and price_row_id provenance (§7.2, S22).',
      responses: [
        {
          status: 200,
          description: 'The thread with its participants, messages and proposals',
          schema: z.object({
            thread: z.object({ id: z.string().uuid() }).passthrough(),
            participants: z.array(participantSchema),
            messages: z.array(messageSchema),
            proposals: z.array(proposalSchema),
          }),
        },
      ],
      errors: [
        { status: 401, description: 'Unauthorized' },
        { status: 403, description: 'Missing required feature(s)' },
        { status: 404, description: 'Thread not found or outside the caller\'s organizations' },
      ],
    },
  },
}
