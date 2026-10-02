import { NextResponse } from 'next/server'
import { organizationScopeRequiredResponse, resolveActiveOrganizationId } from '@open-mercato/shared/lib/auth/organizationScope'
import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { MarketingSegment, MarketingSegmentSnapshot } from '../../../../data/entities.js'
import { readPathUuid } from '../../../shared.js'

/**
 * How big this segment has been, by day.
 *
 * Read-only, and it never computes: a size is only ever an answer about a moment, so the series is whatever
 * the daily snapshot pass recorded. Computing on read would put a scan behind a chart.
 */
const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['marketing_automation.campaigns.view'] },
}

export const metadata = routeMetadata

const MAX_DAYS = 90

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return NextResponse.json({ items: [] }, { status: 401 })
  /**
   * A scope that cannot be resolved is a 400, never a 401.
   *
   * `apiFetch` reads 401 as an expired session: it refreshes, succeeds, returns to the same page and
   * refreshes again — so answering 401 for "All organizations" did not fail, it looped for ever. The
   * resolver also recovers the actor's own organization where that is still the actor's tenant, which is
   * what keeps a super-admin's own configuration visible instead of unreachable.
   */
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return organizationScopeRequiredResponse()

  const segmentId = readPathUuid(req, 2)
  if (!segmentId) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')
  const scope = { tenantId: auth.tenantId, organizationId }

  const segment = await em.findOne(MarketingSegment, { id: segmentId, ...scope, deletedAt: null })
  if (!segment) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const rows = await em.find(
    MarketingSegmentSnapshot,
    { segmentId: segment.id, ...scope },
    { orderBy: { day: 'DESC' }, limit: MAX_DAYS },
  )

  return NextResponse.json({
    // Oldest first, because that is the direction a chart reads.
    items: rows.reverse().map((row) => ({ day: row.day, size: row.size, qualifier: row.qualifier })),
  })
}

export const openApi = {
  GET: {
    summary: 'Segment size by day',
    description: 'What the daily snapshot pass recorded. Each point says whether it was an exact count or a bounded sample, because a series that mixes them silently misreports a trend.',
    tags: ['Marketing Automation'],
    responses: { 200: { description: 'Points, oldest first' }, 404: { description: 'No such segment' } },
  },
}
