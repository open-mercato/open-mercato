import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { organizationScopeRequiredResponse, resolveActiveOrganizationId } from '@open-mercato/shared/lib/auth/organizationScope'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { MarketingInboundRequest } from '../../data/entities.js'
import { INBOUND_REQUEST_RETENTION_DAYS } from '../../lib/inbound-requests.js'

/**
 * What outside systems actually posted to the hooks.
 *
 * Behind `campaigns.manage` rather than `campaigns.view`, which every other read in this module uses. The
 * rows carry a partner's body verbatim — addresses included — so this is the one list where being allowed to
 * see that hooks exist is not the same as being allowed to read what came through them.
 */
const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['marketing_automation.campaigns.manage'] },
}

export const metadata = routeMetadata

const MAX_PAGE_SIZE = 100

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return organizationScopeRequiredResponse()

  const url = new URL(req.url)
  const hookId = url.searchParams.get('hookId')
  const requested = Number.parseInt(url.searchParams.get('pageSize') ?? '', 10)
  const pageSize = Number.isFinite(requested) && requested > 0 ? Math.min(requested, MAX_PAGE_SIZE) : MAX_PAGE_SIZE

  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')

  const where = {
    tenantId: auth.tenantId,
    organizationId,
    ...(hookId ? { hookId } : {}),
  }

  const [rows, total] = await em.findAndCount(MarketingInboundRequest, where, {
    orderBy: { receivedAt: 'desc' },
    limit: pageSize,
  })

  return NextResponse.json({
    items: rows.map((row) => ({
      id: row.id,
      hookId: row.hookId,
      subjectEntityId: row.subjectEntityId ?? null,
      outcome: row.outcome,
      body: row.body ?? null,
      bodyBytes: row.bodyBytes,
      receivedAt: row.receivedAt.toISOString(),
    })),
    total,
    /** So the screen can say how long these rows live rather than hard-coding the same number twice. */
    retentionDays: INBOUND_REQUEST_RETENTION_DAYS,
  })
}

export const openApi = {
  GET: {
    summary: 'List the requests that reached the inbound hooks',
    description:
      'The logged requests, newest first, optionally narrowed to one hook with `hookId`. Each row carries the body as posted, so the endpoint requires `campaigns.manage` rather than `campaigns.view`. Rows are removed automatically after the retention window the response reports.',
    tags: ['Marketing Automation'],
    responses: { 200: { description: 'The logged requests' } },
  },
}
