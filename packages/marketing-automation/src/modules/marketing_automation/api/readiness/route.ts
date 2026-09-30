import { NextResponse } from 'next/server'
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
  if (!auth?.tenantId || !auth.orgId) return NextResponse.json({ checks: [] }, { status: 401 })

  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')
  const scope = { tenantId: auth.tenantId, organizationId: auth.orgId }

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

  return NextResponse.json({
    checks,
    ready: isReadyToSend(checks),
    remaining: remainingCount(checks),
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
