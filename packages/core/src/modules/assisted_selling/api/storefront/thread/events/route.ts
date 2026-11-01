import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'

import { AssistedSellingProposal, AssistedSellingThread } from '../../../../data/entities'
import {
  mapAssistedSellingBuyerRouteError,
  notFoundThreadResponse,
  readAssistedSellingCartToken,
  resolveIdentifiedBuyerBasket,
} from '../../../../lib/buyerIdentity'
import { enforceAssistedSellingBuyerRateLimit } from '../../../../lib/rateLimit'

// Step 4.5 (§6.2, S25). `GET /api/assisted_selling/storefront/thread/events` — signal-only
// change detection, server-side ETag/304 only. No client cadence is implemented here; the
// documented recommendation for integrators lives in the spec, not in code (S25).

export const metadata = {
  GET: { requireAuth: false },
}

const CURSOR_HEADER_NAME = 'If-None-Match'

/** Strips the surrounding quotes an `ETag`/`If-None-Match` value carries (`"<cursor>"`),
 * tolerating a bare, unquoted value too (the `since` query param is never quoted). Never
 * treats a weak validator (`W/"..."`) as a special case — this module emits only strong
 * ETags, so a presented weak one simply never matches and the caller gets a fresh `200`. */
function normalizePresentedCursor(value: string | null): string | null {
  if (!value) return null
  const trimmed = value.trim()
  if (!trimmed) return null
  if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

export async function GET(request: Request) {
  try {
    const container = await createRequestContainer()
    const token = readAssistedSellingCartToken(request)

    const limited = await enforceAssistedSellingBuyerRateLimit(container, request, 'events', token)
    if (limited) return limited
    if (!token) return notFoundThreadResponse()

    const basket = await resolveIdentifiedBuyerBasket(container, request, token)
    if (!basket) return notFoundThreadResponse()

    const em = (container.resolve('em') as EntityManager).fork()
    const scope = { tenantId: basket.tenantId, organizationId: basket.organizationId }
    const thread = await em.findOne(AssistedSellingThread, { ...scope, buyerCartId: basket.id, status: 'open', deletedAt: null })
    if (!thread) return notFoundThreadResponse()

    const cursor = thread.updatedAt.toISOString()
    const url = new URL(request.url)
    const presented =
      normalizePresentedCursor(request.headers.get(CURSOR_HEADER_NAME)) ?? normalizePresentedCursor(url.searchParams.get('since'))

    const headers = new Headers({ ETag: `"${cursor}"`, 'Cache-Control': 'private, no-cache' })

    // §6.2: "`changed` is `true` when `since` is absent or older than the current cursor...
    // a request whose `If-None-Match` or `since` names the current cursor answers `304`
    // with no body, before any message or proposal read."
    if (presented === cursor) {
      return new NextResponse(null, { status: 304, headers })
    }

    const sinceDate = presented ? new Date(presented) : null
    const sinceIsValid = !!sinceDate && !Number.isNaN(sinceDate.getTime())

    // Only `id`/`updatedAt` are read — never a message body, line, price, participant name
    // or proposal content (§6.2's own signal-only assertion).
    const proposals = (await em.find(
      AssistedSellingProposal,
      { ...scope, threadId: thread.id, deletedAt: null },
      { fields: ['id', 'updatedAt'] as any },
    )) as Array<{ id: string; updatedAt: Date }>
    const proposalIds = proposals
      .filter((proposal) => !sinceIsValid || proposal.updatedAt.getTime() > (sinceDate as Date).getTime())
      .map((proposal) => proposal.id)

    return NextResponse.json(
      { cursor, changed: true, threadUpdatedAt: cursor, proposalIds },
      { headers },
    )
  } catch (error) {
    return mapAssistedSellingBuyerRouteError(error)
  }
}

const eventsQuerySchema = z.object({ since: z.string().optional() })
const eventsResponseSchema = z.object({
  cursor: z.string(),
  changed: z.literal(true),
  threadUpdatedAt: z.string(),
  proposalIds: z.array(z.string().uuid()),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Assisted Selling',
  summary: 'Signal-only change detection for the current basket\'s thread',
  methods: {
    GET: {
      summary: 'Thread change signal, ETag/304 (§6.2, S25)',
      description:
        'Never returns a message body, line, price, participant name or proposal content. 304 (no body) when `If-None-Match`/`since` matches the current cursor; 404 with no open thread.',
      query: eventsQuerySchema,
      responses: [
        { status: 200, description: 'Something changed since `since`', schema: eventsResponseSchema },
        { status: 304, description: 'Nothing changed since `since`/`If-None-Match`' },
      ],
      errors: [
        { status: 404, description: 'No/unknown token, identity-binding mismatch, or no open thread' },
        { status: 429, description: 'Rate limited' },
      ],
    },
  },
}
