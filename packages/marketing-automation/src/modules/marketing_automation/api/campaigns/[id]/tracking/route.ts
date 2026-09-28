import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { MarketingCampaign, MarketingMessageSend, MarketingMessageSendEvent } from '../../../../data/entities.js'

/**
 * What happened to this campaign's messages: how many were sent, and how many were opened, clicked,
 * delivered or bounced.
 *
 * Gated by `marketing_automation.runs.view`, like the run list, and for the same reason: the counts
 * are about identifiable customers' behaviour even though this response names none of them.
 *
 * Counts only. Every row behind these numbers is keyed to a send, never to a person, and this
 * endpoint deliberately offers no way to ask which customer opened what — that is a different
 * disclosure and it would need its own decision.
 */
const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['marketing_automation.runs.view'] },
}

export const metadata = routeMetadata

const EVENT_TYPES = ['delivered', 'opened', 'clicked', 'bounced'] as const
type EventType = (typeof EVENT_TYPES)[number]

function readCampaignId(req: Request): string | null {
  const segments = new URL(req.url).pathname.split('/').filter(Boolean)
  // .../campaigns/<id>/tracking
  return segments[segments.length - 2] ?? null
}

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const campaignId = readCampaignId(req)
  if (!campaignId) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')
  const scope = { tenantId: auth.tenantId, organizationId: auth.orgId }

  // Scoped through the campaign, so a campaign id from another organization answers 404 rather than
  // zeroes that look like a campaign nobody engaged with.
  const campaign = await em.findOne(MarketingCampaign, { id: campaignId, ...scope, deletedAt: null })
  if (!campaign) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const [sent, suppressed] = await Promise.all([
    em.count(MarketingMessageSend, { ...scope, campaignId: campaign.id, status: 'sent' }),
    em.count(MarketingMessageSend, { ...scope, campaignId: campaign.id, status: 'suppressed' }),
  ])

  const counts = {} as Record<EventType, number>
  const unique = {} as Record<EventType, number>
  for (const type of EVENT_TYPES) {
    counts[type] = await em.count(MarketingMessageSendEvent, { ...scope, campaignId: campaign.id, type })
    // Distinct runs, because a mail client re-fetching the pixel is not a second person reading it —
    // reporting only the raw total would overstate every campaign's reach.
    const rows = await em.getConnection().execute<{ count: string }[]>(
      `select count(distinct run_id)::text as count
         from marketing_message_send_events
        where tenant_id = ? and organization_id = ? and campaign_id = ? and type = ?`,
      [scope.tenantId, scope.organizationId, campaign.id, type],
    )
    unique[type] = Number.parseInt(rows[0]?.count ?? '0', 10) || 0
  }

  return NextResponse.json({
    campaign: { id: campaign.id, name: campaign.name },
    sends: { sent, suppressed },
    events: counts,
    uniqueRecipients: unique,
  })
}

export const openApi = {
  GET: {
    summary: 'Delivery and engagement counts for a campaign',
    description:
      'Sends, suppressions, and delivery events by type, with unique-recipient counts alongside raw totals. Gated by `marketing_automation.runs.view`. Counts only — never which customer did what.',
    tags: ['Marketing Automation'],
    responses: { 200: { description: 'The counts' }, 404: { description: 'Not found' } },
  },
}
