import { NextResponse } from 'next/server'
import { organizationScopeRequiredResponse, resolveActiveOrganizationId } from '@open-mercato/shared/lib/auth/organizationScope'
import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { MarketingCampaign } from '../../../data/entities.js'
import { loadAttribution } from '../../../lib/analytics/attribution.js'

/**
 * The whole organisation's marketing in one read, for the dashboard widget.
 *
 * Gated by `runs.view` rather than `campaigns.view`: these are engagement counts, the same class of fact the
 * run list and the results screen are gated on. `dashboards.view` is enforced separately by the widget's own
 * metadata, because a person may be allowed to see marketing numbers and still not have a dashboard.
 *
 * One endpoint rather than the widget calling three: a dashboard renders many widgets at once, and a widget
 * that fans out is a widget that makes the dashboard slow for everybody.
 */
const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['marketing_automation.runs.view'] },
}

export const metadata = routeMetadata

/** A week is the unit people plan marketing in, and the default a widget should not need configuring to be useful. */
const DEFAULT_DAYS = 7
const MAX_DAYS = 90

/** How long after a click an order still counts, matching the results screen's default. */
const ATTRIBUTION_WINDOW_DAYS = 7

const COUNTS_SQL = `
  select
    (select count(*)
       from marketing_message_sends
      where tenant_id = ? and organization_id = ? and status = 'sent' and sent_at >= ?)::int as sent,
    (select count(*)
       from marketing_message_sends
      where tenant_id = ? and organization_id = ? and status = 'suppressed' and sent_at >= ?)::int as suppressed,
    (select count(*)
       from marketing_message_sends
      where tenant_id = ? and organization_id = ? and status = 'failed' and sent_at >= ?)::int as failed,
    -- Distinct RUNS, like everywhere else in this module: a mail client re-fetching a pixel is not a reader.
    (select count(distinct run_id)
       from marketing_message_send_events
      where tenant_id = ? and organization_id = ? and type = 'opened' and occurred_at >= ?)::int as opened,
    (select count(distinct run_id)
       from marketing_message_send_events
      where tenant_id = ? and organization_id = ? and type = 'clicked' and occurred_at >= ?)::int as clicked,
    (select count(*)
       from marketing_campaign_runs
      where tenant_id = ? and organization_id = ? and started_at >= ?)::int as runs
`

type CountsRow = {
  sent: number
  suppressed: number
  failed: number
  opened: number
  clicked: number
  runs: number
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

  const url = new URL(req.url)
  const days = Math.min(Math.max(Number.parseInt(url.searchParams.get('days') ?? '', 10) || DEFAULT_DAYS, 1), MAX_DAYS)
  const since = new Date(Date.now() - days * 86_400_000)

  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')
  const scope = { tenantId: auth.tenantId, organizationId }
  const { tenantId } = scope

  const rows = await em.getConnection().execute<CountsRow[]>(COUNTS_SQL, [
    tenantId, organizationId, since,
    tenantId, organizationId, since,
    tenantId, organizationId, since,
    tenantId, organizationId, since,
    tenantId, organizationId, since,
    tenantId, organizationId, since,
  ])
  const counts = rows[0] ?? { sent: 0, suppressed: 0, failed: 0, opened: 0, clicked: 0, runs: 0 }

  const [enabled, total, attribution] = await Promise.all([
    em.count(MarketingCampaign, { ...scope, deletedAt: null, isEnabled: true }),
    em.count(MarketingCampaign, { ...scope, deletedAt: null }),
    /**
     * Revenue over the same window, split linearly across the campaigns that touched each order.
     *
     * Not narrowed to one campaign, because the question a dashboard answers is "what did marketing earn" —
     * and the shares are computed across every campaign that touched the order, so narrowing first would
     * overstate whichever one was asked about.
     */
    loadAttribution(em, scope, { windowDays: ATTRIBUTION_WINDOW_DAYS, since }),
  ])

  /** Summed per currency, never across them: one number mixing PLN and EUR means nothing. */
  const revenue = new Map<string, { currencyCode: string | null; orders: number; revenue: number }>()
  for (const row of attribution) {
    const key = row.currencyCode ?? ''
    const entry = revenue.get(key) ?? { currencyCode: row.currencyCode, orders: 0, revenue: 0 }
    entry.orders += row.orders
    entry.revenue = Math.round((entry.revenue + row.revenue) * 100) / 100
    revenue.set(key, entry)
  }

  return NextResponse.json({
    windowDays: days,
    campaigns: { enabled, total },
    runs: counts.runs,
    sends: { sent: counts.sent, suppressed: counts.suppressed, failed: counts.failed },
    /** People, not events. */
    engagement: { opened: counts.opened, clicked: counts.clicked },
    revenue: [...revenue.values()].sort((left, right) => right.revenue - left.revenue),
  })
}

export const openApi = {
  GET: {
    summary: 'Marketing activity for the whole organization',
    description:
      'Sends, suppressions, failures, unique openers and clickers, runs started and linearly attributed revenue over a window (7 days by default, 90 at most). Counts only, gated by `marketing_automation.runs.view`. Feeds the dashboard widget, and answers "what did marketing do this week" in one read.',
    tags: ['Marketing Automation'],
    responses: { 200: { description: 'The counts' }, 401: { description: 'Unauthorized' } },
  },
}
