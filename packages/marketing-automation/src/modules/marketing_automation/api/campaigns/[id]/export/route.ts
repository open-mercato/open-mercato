import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { MarketingCampaign, MarketingCampaignTrigger } from '../../../../data/entities.js'
import { campaignDefinitionSchema } from '../../../../data/validators.js'
import { PORTABLE_FORMAT_VERSION } from '../../../../lib/portable.js'
import { readPathUuid } from '../../../shared.js'

/**
 * A campaign as a file somebody can keep, review or move to another installation.
 *
 * Behind `campaigns.view`, because it discloses exactly what the campaign editor already shows to the same
 * people. It contains no customer data at all — a campaign definition is a description of intent.
 */
const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['marketing_automation.campaigns.view'] },
}

export const metadata = routeMetadata

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const campaignId = readPathUuid(req, 2)
  if (!campaignId) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')
  const scope = { tenantId: auth.tenantId, organizationId: auth.orgId }

  const campaign = await em.findOne(MarketingCampaign, { id: campaignId, ...scope, deletedAt: null })
  if (!campaign) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const triggers = await em.find(MarketingCampaignTrigger, { campaignId: campaign.id, ...scope })

  /**
   * Parsed on the way out, so an older stored shape is exported with this version's defaults filled in rather
   * than as a document the importer would then refuse.
   */
  const definition = campaignDefinitionSchema.parse(campaign.definition)

  const document = {
    formatVersion: PORTABLE_FORMAT_VERSION,
    name: campaign.name,
    description: campaign.description ?? null,
    definition,
    // Same shape the save endpoint accepts, so an export is a valid import without translation.
    triggers: triggers.map((trigger) => (trigger.kind === 'event'
      ? { kind: 'event' as const, eventId: trigger.eventId }
      : {
          kind: 'schedule' as const,
          scheduleValue: trigger.scheduleValue,
          reentryAfterDays: trigger.reentryAfterDays ?? null,
          sweepSource: trigger.sweepSource ?? 'customers',
          sweepParams: trigger.sweepParams ?? {},
        })),
  }

  const filename = `campaign-${campaign.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'export'}.json`
  return new NextResponse(JSON.stringify(document, null, 2), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}"`,
      'cache-control': 'no-store',
    },
  })
}

export const openApi = {
  GET: {
    summary: 'Export a campaign as a portable document',
    description:
      'The authored graph and its triggers, in the same shape the save endpoint accepts, so an export is a valid import. Carries no ids, timestamps, enabled flag or tenant — and no customer data, since a campaign definition describes intent. Requires `campaigns.view`.',
    tags: ['Marketing Automation'],
    responses: { 200: { description: 'application/json' }, 404: { description: 'Not found' } },
  },
}
