import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { CustomerEntity } from '@open-mercato/core/modules/customers/data/entities'
import { MarketingSegment } from '../../../../data/entities.js'
import { buildSubjectDocument } from '../../../../lib/subject-document.js'
import { loadTierThresholds } from '../../../../lib/tiers.js'
import { matchesAudience } from '../../../../lib/engine/audience.js'
import { planNarrowing, describeNarrowing } from '../../../../lib/engine/narrowing.js'
import { createSqlCandidateSource, resolveCandidates } from '../../../../lib/audience/set-resolver.js'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { ConditionExpression } from '@open-mercato/core/modules/business_rules/lib/expression-evaluator'

/**
 * Who is in a segment, and how many.
 *
 * Resolved the same way a sweep resolves an audience: narrow in the database where the expression allows it,
 * then decide per candidate with `matchesAudience`. Reusing that path is the point — a second membership
 * implementation would eventually disagree with the one that actually sends the messages, and the screen that
 * disagrees is the one people trust.
 *
 * Requires `customers.people.view` as well, because the answer NAMES people.
 */
const routeMetadata = {
  GET: {
    requireAuth: true,
    requireFeatures: ['marketing_automation.campaigns.view', 'customers.people.view'],
  },
}

export const metadata = routeMetadata

const logger = createLogger('marketing_automation')

/** How many candidates are checked per request. A segment screen shows a page, not a mailing list. */
const MAX_CHECKED = 2_000
const MAX_RETURNED = 50

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.orgId) return NextResponse.json({ items: [] }, { status: 401 })

  const path = new URL(req.url).pathname.split('/').filter(Boolean)
  // .../segments/<id>/members
  const segmentId = path[path.length - 2]
  if (!segmentId) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')
  const scope = { tenantId: auth.tenantId, organizationId: auth.orgId }

  const segment = await em.findOne(MarketingSegment, { id: segmentId, ...scope, deletedAt: null })
  if (!segment) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const expression = (segment.expression ?? null) as ConditionExpression | null
  const now = new Date()
  const plan = planNarrowing(expression)
  const candidates = await resolveCandidates(plan.narrowing, createSqlCandidateSource(em, scope, now))

  const livePerson = { ...scope, kind: 'person', deletedAt: null } as const
  const ids = candidates.ids
    ?? (await em.find(CustomerEntity, livePerson, { fields: ['id'], limit: MAX_CHECKED })).map((row) => row.id)

  const checked = ids.slice(0, MAX_CHECKED)
  const tierThresholds = await loadTierThresholds(container, scope)
  // The segment being asked about is evaluated directly, so its own definition is the only thing deciding
  // membership — not the `segments` key, which is exactly what a segment may not depend on.
  const members: Array<{ id: string; displayName: string | null; email: string | null }> = []

  for (const id of checked) {
    if (members.length >= MAX_RETURNED) break
    const subject = await buildSubjectDocument(em, id, scope, {}, now, { tierThresholds, segments: [] })
    if (!subject.customer) continue
    if (!matchesAudience(expression, subject, { now, logger })) continue
    members.push({
      id: subject.customer.id,
      displayName: subject.customer.displayName,
      email: subject.customer.email,
    })
  }

  return NextResponse.json({
    items: members,
    /**
     * What the count is, stated rather than implied.
     *
     * `exact` only when every candidate was checked and the narrowing was complete; otherwise it is a sample
     * of a larger set, and saying "50 members" would be a lie of the most useful-looking kind.
     */
    qualifier: candidates.ids && candidates.ids.length <= MAX_CHECKED && members.length < MAX_RETURNED
      ? 'exact'
      : 'sample',
    checked: checked.length,
    candidates: candidates.ids ? candidates.ids.length : null,
    narrowing: describeNarrowing(plan),
  })
}

export const openApi = {
  GET: {
    summary: 'List members of a segment',
    description:
      'Narrowed in the database where the expression allows, then decided per candidate by the same matcher the dispatcher uses. Answers with a qualifier saying whether the result is exact or a sample, because a truncated count that looks exact is worse than an honest one.',
    tags: ['Marketing Automation'],
    responses: { 200: { description: 'Members and what kind of answer this is' }, 404: { description: 'No such segment' } },
  },
}
