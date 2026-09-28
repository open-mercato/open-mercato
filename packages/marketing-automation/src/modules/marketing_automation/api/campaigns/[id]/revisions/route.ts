import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { MarketingCampaign } from '../../../../data/entities.js'
import { listRevisions } from '../../../../lib/revisions.js'

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
  if (!auth?.tenantId || !auth.orgId) return NextResponse.json({ items: [] }, { status: 401 })

  const segments = new URL(req.url).pathname.split('/').filter(Boolean)
  // .../campaigns/<id>/revisions
  const campaignId = segments[segments.length - 2]
  if (!campaignId) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')
  const scope = { tenantId: auth.tenantId, organizationId: auth.orgId }

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
