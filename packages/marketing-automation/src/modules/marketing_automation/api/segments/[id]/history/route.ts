import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { MarketingSegment, MarketingSegmentSnapshot } from '../../../../data/entities.js'

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
  if (!auth?.tenantId || !auth.orgId) return NextResponse.json({ items: [] }, { status: 401 })

  const path = new URL(req.url).pathname.split('/').filter(Boolean)
  const segmentId = path[path.length - 2]
  if (!segmentId) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')
  const scope = { tenantId: auth.tenantId, organizationId: auth.orgId }

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
