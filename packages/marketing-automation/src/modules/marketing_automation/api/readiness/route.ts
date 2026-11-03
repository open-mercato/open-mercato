import { NextResponse } from 'next/server'
import { organizationScopeRequiredResponse, resolveActiveOrganizationId } from '@open-mercato/shared/lib/auth/organizationScope'
import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import {
  MarketingCampaign,
  MarketingCampaignRun,
  MarketingContentBlock,
  MarketingSegment,
} from '../../data/entities.js'
import { evaluateReadiness, isReadyToSend, remainingCount } from '../../lib/engine/readiness.js'
import { resolveTrackingBaseUrl, resolveTrackingSecret } from '../../lib/tracking/secret.js'
import { readCapabilities } from '../../lib/capabilities.js'

/**
 * Whether this installation can actually run a campaign.
 *
 * Every check is answered from live state rather than from a "setup completed" flag: a flag says what somebody
 * clicked, and the question here is what is true — an installation whose email channel was deleted last week is
 * not set up, whatever it once was.
 */
const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['marketing_automation.campaigns.view'] },
}

export const metadata = routeMetadata

type ChannelRow = { total: string }

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return NextResponse.json({ checks: [] }, { status: 401 })
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

  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')
  const scope = { tenantId: auth.tenantId, organizationId }

  /**
   * The email channel is counted with raw SQL against the communication_channels table.
   *
   * Reading another module's table is normally what this module refuses to do — but there is no service
   * contract for "is a tenant-wide email channel configured", the alternative is to claim readiness without
   * checking, and a wizard that says ready and then sends nothing is the failure this screen exists to prevent.
   * Recorded in the roadmap as a core proposal: a `communicationChannels.hasChannel(type)` read.
   */
  let emailChannelConfigured = false
  try {
    const rows = await em.getConnection().execute<ChannelRow[]>(
      `select count(*)::text as total
         from communication_channels
        where tenant_id = ?
          and coalesce(is_active, true) = true
          and deleted_at is null
          and channel_type = 'email'`,
      [scope.tenantId],
    )
    emailChannelConfigured = (Number.parseInt(rows[0]?.total ?? '0', 10) || 0) > 0
  } catch {
    // A table that is not there in a trimmed installation answers "not configured", which is the truth.
    emailChannelConfigured = false
  }

  const [campaignCount, enabledCampaignCount, runCount, segmentCount, contentBlockCount] = await Promise.all([
    em.count(MarketingCampaign, { ...scope, deletedAt: null }),
    em.count(MarketingCampaign, { ...scope, deletedAt: null, isEnabled: true }),
    em.count(MarketingCampaignRun, { ...scope }),
    em.count(MarketingSegment, { ...scope, deletedAt: null }),
    em.count(MarketingContentBlock, { ...scope, deletedAt: null }),
  ])

  /**
   * Are the module's two periodic jobs registered?
   *
   * Read straight from the scheduler's own table rather than by asking the service, because the question is
   * about persisted state and the answer has to be true for the worker process as well as this one. Null when
   * the table is absent — the scheduler is an optional peer, and an installation without it has no scheduled
   * campaigns by design rather than by omission.
   */
  let schedulesRegistered: boolean | null = null
  try {
    const rows = await em.getConnection().execute<Array<{ total: string }>>(
      `select count(*)::text as total
         from scheduled_jobs
        where organization_id = ? and target_queue in (?, ?)`,
      [scope.organizationId, 'marketing-automation-sweep', 'marketing-automation-resume'],
    )
    schedulesRegistered = (Number.parseInt(rows[0]?.total ?? '0', 10) || 0) >= 2
  } catch {
    // No such table: the scheduler is not installed here, which is a configuration rather than a fault.
    schedulesRegistered = null
  }

  const checks = evaluateReadiness({
    emailChannelConfigured,
    trackingSecretConfigured: resolveTrackingSecret() !== null,
    publicBaseUrlConfigured: resolveTrackingBaseUrl() !== null,
    campaignCount,
    enabledCampaignCount,
    runCount,
    segmentCount,
    contentBlockCount,
    schedulesRegistered,
  })

  /**
   * What this installation CANNOT do, said once and up front.
   *
   * Deliberately not a checklist item. Every check is a thing somebody can go and complete, with a `done` that
   * flips — and "the sales module is not installed" is not that: it would sit there forever unticked, which is
   * worse than silence because it reads as an unfinished setup rather than a deliberate shape.
   *
   * Said HERE rather than left to the palette, where an operator meets it one greyed-out trigger at a time
   * after they have already decided what to build. Open Mercato is an ERP or a CRM depending on what is
   * installed, so "this is a CRM without a shop" is a fact about the installation, not a fault in it.
   */
  const capabilities = await readCapabilities(em)

  return NextResponse.json({
    checks,
    ready: isReadyToSend(checks),
    remaining: remainingCount(checks),
    /** Each entry names a module that is absent and the group of features that goes with it. */
    unavailable: [
      ...(capabilities.sales
        ? []
        : [{ module: 'sales', reasonKey: 'marketing_automation.readiness.unavailable.sales' }]),
      ...(capabilities.catalog
        ? []
        : [{ module: 'catalog', reasonKey: 'marketing_automation.readiness.unavailable.catalog' }]),
    ],
  })
}

export const openApi = {
  GET: {
    summary: 'Whether this installation can run a campaign',
    description:
      'A checklist answered from live state rather than from a "setup completed" flag: the question is what is true now, not what somebody once clicked.',
    tags: ['Marketing Automation'],
    responses: { 200: { description: 'Checks, whether sending is possible, and how many remain' } },
  },
}
