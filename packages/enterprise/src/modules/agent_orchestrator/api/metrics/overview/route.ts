import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { AgentCorrection, AgentMetricRollup, AgentProposal, AgentRun } from '../../../data/entities'

/**
 * Eval replays write real proposals that are born `pending` and can NEVER be
 * disposed (the dispose command refuses them). Counting them here pinned
 * `oldestPendingAt` to an eval proposal forever and inflated `pendingCount` by the
 * suite size — an "oldest unactioned proposal" SLA no operator could ever clear,
 * because the caseload correctly hides them. `metricRollupService` already
 * excludes eval runs; these call sites were missed.
 */
const PRODUCTION_ONLY = { source: 'runtime' } as const
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

type FreshRollupSums = {
  runsTotal: number
  /** Null when any fresh row predates the additive observability keys. */
  errorRuns: number | null
  evaluatedRuns: number | null
  evalPassedRuns: number | null
}

/**
 * Sum the aggregatable COUNTS across the freshest matching rollup row of every
 * agent in the org. Returns null when no fresh rollup covers the requested
 * window (or a stored payload fails validation), signalling the caller to
 * live-compute. The additive keys (`errorRuns`, `evalPassedRuns`) may be
 * missing on rows written before the data-honesty upgrade — those sums come
 * back null so ONLY the affected metrics fall back to live (rollup key drift).
 */
async function sumFreshRollups(
  em: EntityManager,
  scope: MetricScope,
  windowSpanMs: number,
): Promise<FreshRollupSums | null> {
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

  const sums: FreshRollupSums = { runsTotal: 0, errorRuns: 0, evaluatedRuns: 0, evalPassedRuns: 0 }
  for (const rollup of latestPerAgent.values()) {
    const parsed = agentMetricRollupMetricsSchema.safeParse(rollup.metrics)
    if (!parsed.success) return null
    sums.runsTotal += parsed.data.totalRuns
    if (sums.errorRuns != null) {
      sums.errorRuns = parsed.data.errorRuns == null ? null : sums.errorRuns + parsed.data.errorRuns
    }
    if (sums.evaluatedRuns != null && sums.evalPassedRuns != null) {
      if (parsed.data.evalPassedRuns == null) {
        sums.evaluatedRuns = null
        sums.evalPassedRuns = null
      } else {
        sums.evaluatedRuns += parsed.data.evaluatedRuns
        sums.evalPassedRuns += parsed.data.evalPassedRuns
      }
    }
  }
  return sums
}

/**
 * Org-level p95 latency over the window. Percentiles are not aggregatable from
 * per-agent rollups, so this is ALWAYS live — one indexed `percentile_cont`
 * over `latency_ms` (scoped, single window). Fails open to null.
 */
async function liveP95LatencyMs(em: EntityManager, scope: MetricScope, since: Date): Promise<number | null> {
  try {
    const rows = (await em.getConnection().execute(
      `select percentile_cont(0.95) within group (order by latency_ms) as p95
         from agent_runs
        where tenant_id = ? and organization_id = ? and created_at >= ?
          and deleted_at is null and latency_ms is not null`,
      [scope.tenantId, scope.organizationId, since],
    )) as Array<{ p95: unknown }>
    const value = rows?.[0]?.p95
    const parsed = typeof value === 'string' ? Number(value) : value
    return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : null
  } catch {
    return null
  }
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
        [disposition, await em.count(AgentProposal, { ...scope, source: 'runtime', disposition, deletedAt: null })] as const,
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
          { ...scope, source: 'runtime', disposition: 'pending', deletedAt: null },
          { orderBy: { createdAt: 'asc' }, fields: ['createdAt'] },
        )
      : null

  const windowedProposalScope = { ...scope, deletedAt: null, createdAt: { $gte: since } }
  const [autoApprovedInWindow, disposedInWindow] = await Promise.all([
    em.count(AgentProposal, { ...windowedProposalScope, source: 'runtime', disposition: 'auto_approved' }),
    em.count(AgentProposal, { ...windowedProposalScope, source: 'runtime', disposition: { $in: [...DISPOSED_DISPOSITIONS] } }),
  ])
  const autoApproveRate = disposedInWindow > 0 ? autoApprovedInWindow / disposedInWindow : null

  const rollupSums = await sumFreshRollups(em, scope, windowSpanMs)
  // Same rationale as PRODUCTION_ONLY above: eval replays write real AgentRun rows
  // with real latency and cost. Without this the live path counted them while the
  // rollup path (which already filters) did not — the two modes disagreed.
  const windowedRunScope = { ...scope, ...PRODUCTION_ONLY, deletedAt: null, createdAt: { $gte: since } }
  const runsTotal = rollupSums?.runsTotal ?? (await em.count(AgentRun, windowedRunScope))

  // Traces KPI block (data-honesty pass). Error/eval-pass rates prefer fresh
  // rollup COUNT sums (rates are not additive, counts are); rows written before
  // the additive keys existed force a live fallback for just those metrics.
  // p95 is always live — see liveP95LatencyMs.
  let errorRate: number | null
  let tracesFromRollup = false
  if (rollupSums && rollupSums.errorRuns != null) {
    errorRate = rollupSums.runsTotal > 0 ? rollupSums.errorRuns / rollupSums.runsTotal : null
    tracesFromRollup = true
  } else {
    const [windowedRuns, windowedErrors] = await Promise.all([
      rollupSums ? Promise.resolve(rollupSums.runsTotal) : em.count(AgentRun, windowedRunScope),
      em.count(AgentRun, { ...windowedRunScope, status: 'error' }),
    ])
    errorRate = windowedRuns > 0 ? windowedErrors / windowedRuns : null
  }
  let evalPassRate: number | null
  if (rollupSums && rollupSums.evaluatedRuns != null && rollupSums.evalPassedRuns != null) {
    evalPassRate = rollupSums.evaluatedRuns > 0 ? rollupSums.evalPassedRuns / rollupSums.evaluatedRuns : null
  } else {
    tracesFromRollup = false
    const [evaluated, passed] = await Promise.all([
      em.count(AgentRun, { ...windowedRunScope, evalPassed: { $ne: null } }),
      em.count(AgentRun, { ...windowedRunScope, evalPassed: true }),
    ])
    evalPassRate = evaluated > 0 ? passed / evaluated : null
  }
  const [p95LatencyMs, correctionsCount] = await Promise.all([
    liveP95LatencyMs(em, scope, since),
    em.count(AgentCorrection, { ...scope, createdAt: { $gte: since } }),
  ])

  return NextResponse.json({
    window,
    autoApproveRate,
    pendingCount: dispositionCounts.pending,
    oldestPendingAt: oldestPending?.createdAt ? oldestPending.createdAt.toISOString() : null,
    runsTotal,
    dispositionCounts,
    correctionsCount,
    traces: {
      p95LatencyMs,
      errorRate,
      evalPassRate,
      source: tracesFromRollup ? ('rollup' as const) : ('live' as const),
    },
    source: rollupSums != null ? ('rollup' as const) : ('live' as const),
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: agentOrchestratorTag,
  summary: 'Get org-level fleet overview metrics',
  methods: {
    GET: {
      summary: 'Auto-approve rate, pending backlog and run totals for the organization over a window',
      description:
        'Org-level cockpit metrics over a window (24h|7d|30d, default 7d). Windowed run totals aggregate fresh precomputed per-agent rollup rows when available (source="rollup") and fall back to live indexed aggregates (source="live"). pendingCount, oldestPendingAt and dispositionCounts are current-state indexed counts of agent proposals, not windowed history. Additive fields: `correctionsCount` (windowed corrections) and a `traces` block ({ p95LatencyMs, errorRate, evalPassRate, source }) for the traces-list KPI strip — its error/eval rates prefer fresh rollup count sums; p95 is always live-computed (percentiles are not aggregatable from per-agent rollups). Gated by agent_orchestrator.proposals.view.',
      responses: [{ status: 200, description: 'Overview metrics for the authenticated organization' }],
      errors: [
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 403, description: 'Missing agent_orchestrator.proposals.view', schema: errorSchema },
      ],
    },
  },
}
