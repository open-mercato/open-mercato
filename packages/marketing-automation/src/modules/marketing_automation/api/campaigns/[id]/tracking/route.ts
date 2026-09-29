import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { MarketingCampaign, MarketingMessageSend, MarketingMessageSendEvent } from '../../../../data/entities.js'
import { campaignDefinitionSchema } from '../../../../data/validators.js'
import { describeLanes } from '../../../../lib/engine/split.js'
import type { CampaignStep } from '../../../../lib/engine/types.js'
import { loadSplitResults, pickSplitWinner } from '../../../../lib/analytics/split-results.js'
import { loadAttribution } from '../../../../lib/analytics/attribution.js'
import { loadDailySeries } from '../../../../lib/analytics/daily-series.js'
import { readPathUuid } from '../../../shared.js'

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

/** How far back attribution looks, and how long after a click an order still counts. */
const DEFAULT_ATTRIBUTION_WINDOW_DAYS = 7
/** How far back the report looks, for attribution and for the daily chart alike. */
const DEFAULT_REPORT_DAYS = 90
/**
 * Sends per lane before a winner is offered.
 *
 * Not a statistical test — this is a default, and a deliberately unexciting one. What matters is that
 * the answer is withheld until every lane has a sample, which is the mistake an eager automation makes.
 */
const DEFAULT_MINIMUM_SENDS = 50
type EventType = (typeof EVENT_TYPES)[number]

function readCampaignId(req: Request): string | null {
  // .../campaigns/<id>/tracking
  return readPathUuid(req, 2)
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

  const url = new URL(req.url)
  const windowDays = Math.min(
    Math.max(Number.parseInt(url.searchParams.get('windowDays') ?? '', 10) || DEFAULT_ATTRIBUTION_WINDOW_DAYS, 1),
    90,
  )
  const minimumSends = Math.max(
    Number.parseInt(url.searchParams.get('minimumSends') ?? '', 10) || DEFAULT_MINIMUM_SENDS,
    1,
  )

  // The lanes come from the definition, because a lane's results are the engagement ITS OWN steps
  // produced — the run alone cannot say which sends belonged to the lane and which to the trunk.
  const definition = campaignDefinitionSchema.safeParse(campaign.definition)
  const lanes = definition.success ? describeLanes(definition.data.steps as CampaignStep[]) : []
  const splits = await loadSplitResults(em, campaign.id, scope, lanes)
  const seriesFrom = new Date(Date.now() - (DEFAULT_REPORT_DAYS - 1) * 86_400_000)
  const daily = await loadDailySeries(em, campaign.id, scope, { from: seriesFrom, to: new Date() })
  const attribution = await loadAttribution(em, scope, {
    windowDays,
    since: new Date(Date.now() - DEFAULT_REPORT_DAYS * 86_400_000),
    campaignId: campaign.id,
  })

  // One winner per split, or none — the rules live in `pickSplitWinner`, which refuses to answer
  // until every lane has a sample and refuses a tie.
  const winners = [...new Set(splits.map((result) => result.stepId))]
    .map((stepId) => pickSplitWinner(splits, stepId, minimumSends))
    .filter((winner): winner is NonNullable<typeof winner> => winner !== null)

  return NextResponse.json({
    campaign: { id: campaign.id, name: campaign.name },
    sends: { sent, suppressed },
    events: counts,
    uniqueRecipients: unique,
    splits,
    daily,
    winners,
    attribution,
    settings: { windowDays, minimumSends },
  })
}

export const openApi = {
  GET: {
    summary: 'Results for a campaign: delivery, engagement, A/B and attributed revenue',
    description:
      'Sends and suppressions, delivery events by type with unique-recipient counts alongside raw totals, per-variant A/B results read from the lane recorded on each run, any variant that has earned the right to be called a winner, and linearly attributed revenue per currency. Gated by `marketing_automation.runs.view`. Counts only — never which customer did what.',
    tags: ['Marketing Automation'],
    responses: { 200: { description: 'The counts' }, 404: { description: 'Not found' } },
  },
}
