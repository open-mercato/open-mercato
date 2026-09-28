import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { CustomerEntity } from '@open-mercato/core/modules/customers/data/entities'
import { MarketingCampaign } from '../../../../data/entities.js'
import { campaignDefinitionSchema } from '../../../../data/validators.js'
import { describeNarrowing, planNarrowing } from '../../../../lib/engine/narrowing.js'
import { createSqlCandidateSource, resolveCandidates } from '../../../../lib/audience/set-resolver.js'

/**
 * How many customers an audience would reach.
 *
 * Takes the audience in the body rather than reading the stored one, so an author gets the number
 * for what is on their screen instead of for what they last saved — an estimate that lags the edit
 * is worse than none.
 *
 * The number is honest about what it is. A narrowing is a superset by construction, so it is only
 * an exact audience size when the whole expression could be pushed down; otherwise it is an upper
 * bound and says so, because the leaves that cannot be pushed down (`trigger.*`, an email pattern,
 * a negation) are decided per customer at send time.
 */
const routeMetadata = {
  POST: { requireAuth: true, requireFeatures: ['marketing_automation.campaigns.view'] },
}

export const metadata = routeMetadata

/** Above this many candidates the live-person check is skipped and the bound is reported as-is. */
const VERIFY_LIMIT = 20_000
const VERIFY_CHUNK = 500

function readCampaignId(req: Request): string | null {
  const segments = new URL(req.url).pathname.split('/').filter(Boolean)
  // .../campaigns/<id>/audience-estimate
  return segments[segments.length - 2] ?? null
}

export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.orgId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const campaignId = readCampaignId(req)
  if (!campaignId) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const body = await req.json().catch(() => null) as { audience?: unknown } | null
  // Reuses the definition schema's own audience rules rather than a second, looser parser.
  const parsed = campaignDefinitionSchema.shape.audience.safeParse(body?.audience ?? null)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid audience' }, { status: 400 })

  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')
  const scope = { tenantId: auth.tenantId, organizationId: auth.orgId }

  const campaign = await em.findOne(MarketingCampaign, { id: campaignId, ...scope, deletedAt: null })
  if (!campaign) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const now = new Date()
  const plan = planNarrowing(parsed.data)
  const candidates = await resolveCandidates(plan.narrowing, createSqlCandidateSource(em, scope, now))
  const livePerson = { ...scope, kind: 'person', deletedAt: null } as const

  if (!candidates.ids) {
    const population = await em.count(CustomerEntity, livePerson)
    return NextResponse.json({
      count: population,
      // No audience at all reaches everybody, exactly; an audience the database could not express
      // reaches some subset of everybody.
      qualifier: plan.complete ? 'exact' : 'atMost',
      narrowing: describeNarrowing(plan),
      candidates: null,
      queries: candidates.queries,
    })
  }

  if (candidates.ids.length > VERIFY_LIMIT) {
    return NextResponse.json({
      count: candidates.ids.length,
      qualifier: 'atMost',
      narrowing: describeNarrowing(plan),
      candidates: candidates.ids.length,
      queries: candidates.queries,
    })
  }

  // A tag assignment or an order can point at a customer who has since been deleted, or at a
  // company rather than a person — the same filter the sweep applies to its candidates.
  let live = 0
  let queries = candidates.queries
  for (let offset = 0; offset < candidates.ids.length; offset += VERIFY_CHUNK) {
    const chunk = candidates.ids.slice(offset, offset + VERIFY_CHUNK)
    live += await em.count(CustomerEntity, { id: { $in: chunk }, ...livePerson })
    queries += 1
  }

  return NextResponse.json({
    count: live,
    qualifier: plan.complete ? 'exact' : 'atMost',
    narrowing: describeNarrowing(plan),
    candidates: candidates.ids.length,
    queries,
  })
}

export const openApi = {
  POST: {
    summary: 'Estimate how many customers an audience reaches',
    description:
      'Pushes the audience expression down to the database as far as it can be expressed and counts the result. `qualifier` is `exact` when the whole expression was expressible and `atMost` when some leaf is only decidable per customer at send time. Takes the audience in the body so an unsaved edit can be estimated.',
    tags: ['Marketing Automation'],
    responses: {
      200: { description: 'The estimate' },
      400: { description: 'Invalid audience' },
      404: { description: 'Not found' },
    },
  },
}
