import { NextResponse } from 'next/server'
import { organizationScopeRequiredResponse, resolveActiveOrganizationId } from '@open-mercato/shared/lib/auth/organizationScope'
import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { MarketingCampaign, MarketingMessageSend } from '../../../../data/entities.js'
import { campaignDefinitionSchema } from '../../../../data/validators.js'
import { describeLanes } from '../../../../lib/engine/split.js'
import type { CampaignStep } from '../../../../lib/engine/types.js'
import { loadSplitResults, pickSplitWinner } from '../../../../lib/analytics/split-results.js'
import { loadAttribution } from '../../../../lib/analytics/attribution.js'
import { loadDailySeries } from '../../../../lib/analytics/daily-series.js'
import { loadCampaignFunnel } from '../../../../lib/analytics/funnel.js'
import { loadLinkReport } from '../../../../lib/analytics/links.js'
import { loadStepFunnel } from '../../../../lib/analytics/step-funnel.js'
import { loadWinnerMetric } from '../../../../lib/winner-metric.js'
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
  if (!auth?.tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
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
  const campaignId = readCampaignId(req)
  if (!campaignId) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')
  const scope = { tenantId: auth.tenantId, organizationId }

  // Scoped through the campaign, so a campaign id from another organization answers 404 rather than
  // zeroes that look like a campaign nobody engaged with.
  const campaign = await em.findOne(MarketingCampaign, { id: campaignId, ...scope, deletedAt: null })
  if (!campaign) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const [sent, suppressed] = await Promise.all([
    em.count(MarketingMessageSend, { ...scope, campaignId: campaign.id, status: 'sent' }),
    em.count(MarketingMessageSend, { ...scope, campaignId: campaign.id, status: 'suppressed' }),
  ])

  /**
   * Every event count in one statement.
   *
   * This was a loop: per event type, one `count` and one `count(distinct run_id)` — eight sequential scans of
   * the same index range, on the largest table in the module, to answer one screen. A `group by type` walks
   * that range once and returns all of it.
   *
   * Distinct runs, because a mail client re-fetching the pixel is not a second person reading it — reporting
   * only the raw total would overstate every campaign's reach.
   *
   * A type nobody has recorded yet is absent from the result rather than zero, so the maps are seeded first:
   * a missing key would render as a blank cell where the honest answer is "nought".
   */
  const counts = {} as Record<EventType, number>
  const unique = {} as Record<EventType, number>
  for (const type of EVENT_TYPES) {
    counts[type] = 0
    unique[type] = 0
  }
  const eventRows = await em.getConnection().execute<Array<{ type: string; total: string; unique_runs: string }>>(
    `select type, count(*)::text as total, count(distinct run_id)::text as unique_runs
       from marketing_message_send_events
      where tenant_id = ? and organization_id = ? and campaign_id = ?
      group by type`,
    [scope.tenantId, scope.organizationId, campaign.id],
  )
  for (const row of eventRows) {
    // A type this module does not report — one added by a later version, read by an older one — is ignored
    // rather than widening the record with a key nothing expects.
    if (!(EVENT_TYPES as readonly string[]).includes(row.type)) continue
    const type = row.type as EventType
    counts[type] = Number.parseInt(row.total ?? '0', 10) || 0
    unique[type] = Number.parseInt(row.unique_runs ?? '0', 10) || 0
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
  /**
   * The lanes' revenue is attributed over the SAME window as the attribution block and the funnel.
   *
   * One window, one definition of "converted", one place the three numbers can be reconciled — and it is also
   * the window the author can change with `?windowDays=`, so a revenue verdict never comes from a period the
   * screen is not showing.
   */
  const seriesFrom = new Date(Date.now() - (DEFAULT_REPORT_DAYS - 1) * 86_400_000)

  /**
   * Seven readers, none of which needs another's answer, so they wait together rather than in a queue.
   *
   * They used to be seven sequential awaits: the page took the sum of every one of them, and the slowest —
   * the split revenue join — was serialised behind blocks that had nothing to do with it. The comments below
   * say what each one is FOR; the reason they are in one call is only that none of them reads another.
   */
  const [splits, daily, attribution, funnel, links, stepFunnel, winnerMetric] = await Promise.all([
    /**
     * The lanes' revenue is attributed over the SAME window as the attribution block and the funnel.
     *
     * One window, one definition of "converted", one place the three numbers can be reconciled — and it is
     * also the window the author can change with `?windowDays=`, so a revenue verdict never comes from a
     * period the screen is not showing.
     */
    loadSplitResults(em, campaign.id, scope, lanes, windowDays),
    loadDailySeries(em, campaign.id, scope, { from: seriesFrom, to: new Date() }),
    loadAttribution(em, scope, {
      windowDays,
      since: new Date(Date.now() - DEFAULT_REPORT_DAYS * 86_400_000),
      campaignId: campaign.id,
    }),
    /**
     * The funnel, over the SAME conversion window as the revenue attribution.
     *
     * One window, one definition of "converted", one place the two numbers can be reconciled — a screen whose
     * funnel and whose revenue disagree about who converted is a screen nobody quotes twice.
     */
    loadCampaignFunnel(em, campaign.id, scope, { conversionWindowDays: windowDays }),
    /**
     * What they clicked, not just that they clicked.
     *
     * No window: a click is dated by the event and this is a ranking of the campaign's whole life, which is
     * the question an author asks about a link ("does this offer work") rather than about a period.
     */
    loadLinkReport(em, campaign.id, scope),
    /**
     * Where people fall out INSIDE the journey, read from the step log every run already carries.
     *
     * Empty when the definition could not be parsed, because the order is the whole value of this block:
     * counts without the authored sequence would be a list of step ids sorted by volume, not a funnel.
     */
    definition.success
      ? loadStepFunnel(em, campaign.id, scope, definition.data.steps as CampaignStep[])
      : Promise.resolve([]),
    /**
     * On the metric the TENANT chose, which is the same one the unattended promotion uses.
     *
     * A variant that collects clicks and sells less is the classic A/B trap, and this screen could not see it
     * until revenue was attributable per lane. The suggestion and the automation read one setting on purpose:
     * being shown a click winner while a revenue winner is applied behind your back is worse than either.
     */
    loadWinnerMetric(container, scope),
  ])

  // One winner per split, or none — the rules live in `pickSplitWinner`, which refuses to answer
  // until every lane has a sample, refuses a tie, and refuses a revenue verdict it cannot compare.
  const winners = [...new Set(splits.map((result) => result.stepId))]
    .map((stepId) => pickSplitWinner(splits, stepId, minimumSends, winnerMetric))
    .filter((winner): winner is NonNullable<typeof winner> => winner !== null)

  return NextResponse.json({
    campaign: { id: campaign.id, name: campaign.name },
    sends: { sent, suppressed },
    /** People per stage and the drop-off between them — never messages. See `lib/analytics/funnel.ts`. */
    funnel,
    events: counts,
    uniqueRecipients: unique,
    /** Ranked by PEOPLE, with the raw clicks beside them and a flag when the ranking was cut. */
    links,
    /** The journey step by step, in AUTHORED order, with each step measured against its own predecessor. */
    stepFunnel,
    splits,
    daily,
    winners,
    attribution,
    /** `winnerMetric` is reported so the screen can say what a verdict was judged on, not just who won. */
    settings: { windowDays, minimumSends, winnerMetric },
  })
}

export const openApi = {
  GET: {
    summary: 'Results for a campaign: delivery, engagement, A/B and attributed revenue',
    description:
      'Sends and suppressions; the funnel from entered to converted counted in PEOPLE with the drop-off between stages; delivery events by type with unique-recipient counts alongside raw totals; per-variant A/B results read from the lane recorded on each run, each carrying what that lane earned and in which currency; any variant that has earned the right to be called a winner, judged on the clicks or the revenue the tenant chose; linearly attributed revenue per currency; a ranking of which links were clicked, counted in people with the raw clicks beside them; and the journey step by step in authored order, where each step is measured against its own predecessor and a split lane against the split rather than against the trunk. The funnel, the lane revenue and the attribution share one conversion window, so the three can be reconciled. Gated by `marketing_automation.runs.view`. Counts only — never which customer did what.',
    tags: ['Marketing Automation'],
    responses: { 200: { description: 'The counts' }, 404: { description: 'Not found' } },
  },
}
