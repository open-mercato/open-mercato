import { NextResponse } from 'next/server'
import { organizationScopeRequiredResponse, resolveActiveOrganizationId } from '@open-mercato/shared/lib/auth/organizationScope'
import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { MarketingCampaign } from '../../../../data/entities.js'
import { campaignDefinitionSchema } from '../../../../data/validators.js'
import { estimateAudienceSize } from '../../../../lib/audience/estimate.js'
import { readPathUuid } from '../../../shared.js'

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

function readCampaignId(req: Request): string | null {
  // .../campaigns/<id>/audience-estimate
  return readPathUuid(req, 2)
}

export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  /**
   * A scope that cannot be resolved is a 400, never a 401.
   *
   * `apiFetch` reads 401 as an expired session: it refreshes, succeeds, returns to the same page and
   * refreshes again — so answering 401 for "All organizations" did not fail, it looped for ever.
   */
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return organizationScopeRequiredResponse()
  const campaignId = readCampaignId(req)
  if (!campaignId) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const body = await req.json().catch(() => null) as { audience?: unknown } | null
  // Reuses the definition schema's own audience rules rather than a second, looser parser.
  const parsed = campaignDefinitionSchema.shape.audience.safeParse(body?.audience ?? null)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid audience' }, { status: 400 })

  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')
  const scope = { tenantId: auth.tenantId, organizationId }

  const campaign = await em.findOne(MarketingCampaign, { id: campaignId, ...scope, deletedAt: null })
  if (!campaign) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const estimate = await estimateAudienceSize(em, scope, parsed.data, new Date())
  return NextResponse.json(estimate)
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
