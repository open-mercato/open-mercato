import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { AgentMetricRollup, AgentProposal, AgentRun } from '../../../data/entities'
import { agentMetricRollupMetricsSchema } from '../../../data/validators'
import { ROLLUP_WINDOW_MS, ROLLUP_BUCKET_MS, type MetricScope } from '../../../lib/metrics/metricRollupService'
import { agentOrchestratorTag } from '../../openapi'

/**
 * Org-level fleet overview metrics for the operator cockpit. Windowed run
 * totals prefer the precomputed per-agent rollup rows (F2) aggregated across
 * the fleet (`source: 'rollup'`); when no fresh rollup exists yet the same
 * figures are live-computed from indexed aggregates (`source: 'live'`).
 * `pendingCount`, `oldestPendingAt` and `dispositionCounts` describe the
 * CURRENT backlog state (not windowed history) and are always computed live
 * via the `(organization_id, disposition, created_at)` index.
 */
export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['agent_orchestrator.proposals.view'] },
}

const overviewWindow = z.enum(['24h', '7d', '30d'])
export type OverviewWindow = z.infer<typeof overviewWindow>

const DISPOSITIONS = ['pending', 'auto_approved', 'approved', 'edited', 'rejected'] as const
const DISPOSED_DISPOSITIONS = ['auto_approved', 'approved', 'edited', 'rejected'] as const

/** Mirrors the per-agent metrics route: beyond 2 buckets the rollup is stale. */
const ROLLUP_FRESHNESS_MS = 2 * ROLLUP_BUCKET_MS

const errorSchema = z.object({ error: z.string() })

/**
 * Sum `totalRuns` across the freshest matching rollup row of every agent in
 * the org. Returns null when no fresh rollup covers the requested window (or a
 * stored payload fails validation), signalling the caller to live-compute.
 */
async function sumFreshRollupRuns(
  em: EntityManager,
  scope: MetricScope,
  windowSpanMs: number,
): Promise<number | null> {
  const rollups = await em.find(
    AgentMetricRollup,
    { tenantId: scope.tenantId, organizationId: scope.organizationId },
    { orderBy: { computedAt: 'desc' } },
  )
  const latestPerAgent = new Map<string, AgentMetricRollup>()
  for (const rollup of rollups) {
    const spanMatches =
      Math.abs(rollup.windowEnd.getTime() - rollup.windowStart.getTime() - windowSpanMs) < ROLLUP_BUCKET_MS
    const fresh = Date.now() - rollup.computedAt.getTime() <= ROLLUP_FRESHNESS_MS
    if (!spanMatches || !fresh) continue
    if (!latestPerAgent.has(rollup.agentId)) latestPerAgent.set(rollup.agentId, rollup)
  }
  if (latestPerAgent.size === 0) return null

  let runsTotal = 0
  for (const rollup of latestPerAgent.values()) {
    const parsed = agentMetricRollupMetricsSchema.safeParse(rollup.metrics)
    if (!parsed.success) return null
    runsTotal += parsed.data.totalRuns
  }
  return runsTotal
}

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!auth.tenantId || !auth.orgId) {
    return NextResponse.json({ error: 'Tenant context required' }, { status: 400 })
  }

  const url = new URL(req.url)
  const window = overviewWindow.catch('7d').parse(url.searchParams.get('window') ?? '7d')
  const windowSpanMs = ROLLUP_WINDOW_MS[window]
  const since = new Date(Date.now() - windowSpanMs)

  const container = await createRequestContainer()
  const em = (container.resolve('em') as EntityManager).fork()
  const scope: MetricScope = { tenantId: auth.tenantId, organizationId: auth.orgId }

  const dispositionEntries = await Promise.all(
    DISPOSITIONS.map(
      async (disposition) =>
        [disposition, await em.count(AgentProposal, { ...scope, disposition, deletedAt: null })] as const,
    ),
  )
  const dispositionCounts = Object.fromEntries(dispositionEntries) as Record<
    (typeof DISPOSITIONS)[number],
    number
  >

  const oldestPending =
    dispositionCounts.pending > 0
      ? await em.findOne(
          AgentProposal,
          { ...scope, disposition: 'pending', deletedAt: null },
          { orderBy: { createdAt: 'asc' }, fields: ['createdAt'] },
        )
      : null

  const windowedProposalScope = { ...scope, deletedAt: null, createdAt: { $gte: since } }
  const [autoApprovedInWindow, disposedInWindow] = await Promise.all([
    em.count(AgentProposal, { ...windowedProposalScope, disposition: 'auto_approved' }),
    em.count(AgentProposal, { ...windowedProposalScope, disposition: { $in: [...DISPOSED_DISPOSITIONS] } }),
  ])
  const autoApproveRate = disposedInWindow > 0 ? autoApprovedInWindow / disposedInWindow : null

  const rollupRunsTotal = await sumFreshRollupRuns(em, scope, windowSpanMs)
  const runsTotal =
    rollupRunsTotal ?? (await em.count(AgentRun, { ...scope, deletedAt: null, createdAt: { $gte: since } }))

  return NextResponse.json({
    window,
    autoApproveRate,
    pendingCount: dispositionCounts.pending,
    oldestPendingAt: oldestPending?.createdAt ? oldestPending.createdAt.toISOString() : null,
    runsTotal,
    dispositionCounts,
    source: rollupRunsTotal != null ? ('rollup' as const) : ('live' as const),
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: agentOrchestratorTag,
  summary: 'Get org-level fleet overview metrics',
  methods: {
    GET: {
      summary: 'Auto-approve rate, pending backlog and run totals for the organization over a window',
      description:
        'Org-level cockpit metrics over a window (24h|7d|30d, default 7d). Windowed run totals aggregate fresh precomputed per-agent rollup rows when available (source="rollup") and fall back to live indexed aggregates (source="live"). pendingCount, oldestPendingAt and dispositionCounts are current-state indexed counts of agent proposals, not windowed history. Gated by agent_orchestrator.proposals.view.',
      responses: [{ status: 200, description: 'Overview metrics for the authenticated organization' }],
      errors: [
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 403, description: 'Missing agent_orchestrator.proposals.view', schema: errorSchema },
      ],
    },
  },
}
