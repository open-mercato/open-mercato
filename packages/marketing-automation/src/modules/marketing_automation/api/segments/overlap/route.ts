import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { ConditionExpression } from '@open-mercato/core/modules/business_rules/lib/expression-evaluator'
import { MarketingSegment } from '../../../data/entities.js'
import { resolveSegmentMembers, SCREEN_MAX_CHECKED } from '../../../lib/segment-members.js'

/**
 * How much two segments share.
 *
 * The question behind it is always the same: am I about to mail the same people twice. Answered by resolving
 * both and intersecting, rather than by building a combined expression — an AND of two expressions would be a
 * third thing to get right, and the two sets are what an operator is actually comparing.
 *
 * Returns no identities. The counts are the answer; naming the overlap would make this a people-listing
 * endpoint with a different permission requirement.
 */
const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['marketing_automation.campaigns.view'] },
}

export const metadata = routeMetadata

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const first = url.searchParams.get('a')
  const second = url.searchParams.get('b')
  if (!first || !second) return NextResponse.json({ error: 'Two segment ids are required' }, { status: 400 })
  if (first === second) {
    return NextResponse.json(
      { error: 'Pick two different segments', code: 'marketing_automation.errors.overlapSameSegment' },
      { status: 400 },
    )
  }

  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')
  const scope = { tenantId: auth.tenantId, organizationId: auth.orgId }

  const segments = await em.find(MarketingSegment, { id: { $in: [first, second] }, ...scope, deletedAt: null })
  const a = segments.find((segment) => segment.id === first)
  const b = segments.find((segment) => segment.id === second)
  if (!a || !b) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // One `now` for both, so the two sets describe the same moment. Resolving them a second apart would make
  // an overlap that differs by a customer look like a real difference.
  const now = new Date()
  const [left, right] = await Promise.all([
    resolveSegmentMembers(em, container, scope, (a.expression ?? null) as ConditionExpression | null, { maxChecked: SCREEN_MAX_CHECKED, now }),
    resolveSegmentMembers(em, container, scope, (b.expression ?? null) as ConditionExpression | null, { maxChecked: SCREEN_MAX_CHECKED, now }),
  ])

  const rightIds = new Set(right.ids)
  const both = left.ids.filter((id) => rightIds.has(id)).length

  return NextResponse.json({
    a: { id: a.id, name: a.name, size: left.ids.length },
    b: { id: b.id, name: b.name, size: right.ids.length },
    both,
    /**
     * `exact` only when BOTH sides examined every candidate.
     *
     * An overlap of two samples is a sample, and reporting it as a count is how somebody concludes two
     * segments are disjoint when they were simply not fully checked.
     */
    qualifier: left.complete && right.complete ? 'exact' : 'sample',
    checked: Math.max(left.checked, right.checked),
  })
}

export const openApi = {
  GET: {
    summary: 'How much two segments overlap',
    description: 'Both sets are resolved at the same instant and intersected. Counts only — no identities — and the answer says whether it is exact or a sample.',
    tags: ['Marketing Automation'],
    responses: { 200: { description: 'Sizes and the shared count' }, 400: { description: 'Missing or identical ids' }, 404: { description: 'No such segment' } },
  },
}
