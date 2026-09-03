import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { AgentMetricRollup } from '../../../data/entities'
import { agentMetricRollupMetricsSchema, agentMetricsBatchQuerySchema } from '../../../data/validators'
import {
  ROLLUP_WINDOW_MS,
  ROLLUP_BUCKET_MS,
  computeAgentMetrics,
  type MetricScope,
} from '../../../lib/metrics/metricRollupService'
import { resolveCostCurrency } from '../../../lib/runtime/modelPricing'
import { agentOrchestratorTag } from '../../openapi'

/**
 * Batch per-agent window metrics for the registry/overview surfaces — one
 * round-trip for a whole fleet instead of an N+1 fan-out over
 * `/agents/:id/metrics`. Rollup-preferred per agent (fresh matching window),
 * live-computed per agent otherwise; unknown ids simply return no item (no
 * existence oracle). Gated by `agents.view` so the pages that render the
 * registry can also read its metrics under one gate.
 */
export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['agent_orchestrator.agents.view'] },
}

const MAX_IDS = 50
const ROLLUP_FRESHNESS_MS = 2 * ROLLUP_BUCKET_MS

const errorSchema = z.object({ error: z.string() })

export type AgentBatchMetricsItem = {
  agentId: string
  runsTotal: number
  errorRate: number | null
  overrideRate: number | null
  evalPassRate: number | null
  avgLatencyMs: number | null
  avgCostMinor: number | null
  costMinorTotal: number
  disposedProposals: number
  currency: string
  source: 'rollup' | 'live'
}

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!auth.tenantId || !auth.orgId) {
    return NextResponse.json({ error: 'Tenant context required' }, { status: 400 })
  }

  const url = new URL(req.url)
  const parsed = agentMetricsBatchQuerySchema.safeParse({
    window: url.searchParams.get('window') ?? undefined,
    ids: url.searchParams.get('ids') ?? '',
  })
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid query' }, { status: 400 })
  }
  const ids = Array.from(
    new Set(
      parsed.data.ids
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean),
    ),
  )
  if (ids.length === 0 || ids.length > MAX_IDS) {
    return NextResponse.json({ error: `ids must contain 1-${MAX_IDS} agent ids` }, { status: 400 })
  }

  const window = parsed.data.window
  const windowSpanMs = ROLLUP_WINDOW_MS[window]
  const since = new Date(Date.now() - windowSpanMs)

  const container = await createRequestContainer()
  const em = (container.resolve('em') as EntityManager).fork()
  const scope: MetricScope = { tenantId: auth.tenantId, organizationId: auth.orgId }
  const currency = resolveCostCurrency()

  // One query for every requested agent's rollups; freshest matching row wins.
  const rollups = await em.find(
    AgentMetricRollup,
    { tenantId: scope.tenantId, organizationId: scope.organizationId, agentId: { $in: ids } },
    { orderBy: { computedAt: 'desc' } },
  )
  const freshByAgent = new Map<string, AgentMetricRollup>()
  for (const rollup of rollups) {
    const spanMatches =
      Math.abs(rollup.windowEnd.getTime() - rollup.windowStart.getTime() - windowSpanMs) < ROLLUP_BUCKET_MS
    const fresh = Date.now() - rollup.computedAt.getTime() <= ROLLUP_FRESHNESS_MS
    if (!spanMatches || !fresh) continue
    if (!freshByAgent.has(rollup.agentId)) freshByAgent.set(rollup.agentId, rollup)
  }

  const items: AgentBatchMetricsItem[] = []
  for (const agentId of ids) {
    const candidate = freshByAgent.get(agentId)
    if (candidate) {
      const rollupMetrics = agentMetricRollupMetricsSchema.safeParse(candidate.metrics)
      // Rows written before the additive keys existed fall back to live so the
      // item stays internally consistent (rollup key drift).
      if (rollupMetrics.success && rollupMetrics.data.errorRate !== undefined) {
        const m = rollupMetrics.data
        items.push({
          agentId,
          runsTotal: m.totalRuns,
          errorRate: m.errorRate ?? null,
          overrideRate: m.overrideRate,
          evalPassRate: m.evalPassRate,
          avgLatencyMs: m.avgLatencyMs,
          avgCostMinor: m.totalRuns > 0 ? m.costMinorTotal / m.totalRuns : null,
          costMinorTotal: m.costMinorTotal,
          disposedProposals: m.disposedProposals,
          currency,
          source: 'rollup',
        })
        continue
      }
    }
    const m = await computeAgentMetrics(em, scope, { agentId, since })
    items.push({
      agentId,
      runsTotal: m.totalRuns,
      errorRate: m.errorRate ?? null,
      overrideRate: m.overrideRate,
      evalPassRate: m.evalPassRate,
      avgLatencyMs: m.avgLatencyMs,
      avgCostMinor: m.totalRuns > 0 ? m.costMinorTotal / m.totalRuns : null,
      costMinorTotal: m.costMinorTotal,
      disposedProposals: m.disposedProposals,
      currency,
      source: 'live',
    })
  }

  return NextResponse.json({ window, items })
}

export const openApi: OpenApiRouteDoc = {
  tag: agentOrchestratorTag,
  summary: 'Get batch per-agent window metrics',
  methods: {
    GET: {
      summary: 'Runs, error/override/eval-pass rates and estimated cost per agent over a window',
      description:
        'Batch per-agent metrics over a window (24h|7d|30d, default 7d) for up to 50 comma-separated agent ids. Each item prefers a fresh precomputed rollup row (source="rollup") and live-computes otherwise (source="live"); ids with no data return zero-run items and unknown ids are indistinguishable from agents that never ran (no existence oracle). Cost figures are estimates priced from the deployment model-pricing table. Gated by agent_orchestrator.agents.view.',
      responses: [{ status: 200, description: 'Per-agent metric items for the requested ids' }],
      errors: [
        { status: 400, description: 'Invalid query (missing ids or more than 50)', schema: errorSchema },
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 403, description: 'Missing agent_orchestrator.agents.view', schema: errorSchema },
      ],
    },
  },
}
