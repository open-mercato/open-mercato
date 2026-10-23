import { NextResponse } from 'next/server'
import { organizationScopeRequiredResponse, resolveActiveOrganizationId } from '@open-mercato/shared/lib/auth/organizationScope'
import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { MarketingCampaign } from '../../../../data/entities.js'
import { listRevisions } from '../../../../lib/revisions.js'
import { readPathUuid } from '../../../shared.js'

/**
 * The campaign's history: who saved it, when, and what to go back to.
 *
 * Read with `campaigns.view`, because it is an audit trail rather than an edit — seeing that somebody
 * changed a campaign at 4pm is exactly what a person without edit rights needs when asking why.
 */
const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['marketing_automation.campaigns.view'] },
}

export const metadata = routeMetadata

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

  // .../campaigns/<id>/revisions
  const campaignId = readPathUuid(req, 2)
  if (!campaignId) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')
  const scope = { tenantId: auth.tenantId, organizationId }

  const campaign = await em.findOne(MarketingCampaign, { id: campaignId, ...scope, deletedAt: null })
  if (!campaign) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json({ items: await listRevisions(em, scope, campaign.id) })
}

export const openApi = {
  GET: {
    summary: 'List the saved versions of a campaign',
    description: 'Newest first, capped at the retained history. Each entry says who saved it, when, whether it was a restore, and how many steps and triggers it held.',
    tags: ['Marketing Automation'],
    responses: { 200: { description: 'Versions, newest first' }, 404: { description: 'No such campaign' } },
  },
}
