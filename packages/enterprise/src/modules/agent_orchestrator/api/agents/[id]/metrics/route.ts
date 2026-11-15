import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { AgentMetricRollup } from '../../../../data/entities'
import { runWindow, agentMetricRollupMetricsSchema } from '../../../../data/validators'
import {
  ROLLUP_WINDOW_MS,
  ROLLUP_BUCKET_MS,
  computeAgentMetrics,
} from '../../../../lib/metrics/metricRollupService'

/**
 * Per-agent quality metrics over a window — override rate, eval-pass rate,
 * latency and cost. Prefers a precomputed rollup row (F2) whose window matches
 * the request and is still fresh; otherwise falls back to a live compute over
 * this module's tables. The response is backward-compatible — `source` and
 * `computedAt` are the only additive fields.
 */
export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['agent_orchestrator.trace.view'] },
}

/**
 * A rollup is considered fresh when it was computed within 2 buckets of now.
 * Beyond that the scheduler likely missed ticks, so we live-compute instead of
 * serving a stale window.
 */
const ROLLUP_FRESHNESS_MS = 2 * ROLLUP_BUCKET_MS

const errorSchema = z.object({ error: z.string() })

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(req: Request, ctx: RouteContext) {
  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!auth.tenantId || !auth.orgId) {
    return NextResponse.json({ error: 'Tenant context required' }, { status: 400 })
  }

  const { id: agentId } = await ctx.params
  const url = new URL(req.url)
  const window = runWindow.catch('30d').parse(url.searchParams.get('window') ?? '30d')
  const since = new Date(Date.now() - ROLLUP_WINDOW_MS[window])

  const container = await createRequestContainer()
  const em = (container.resolve('em') as EntityManager).fork()
  const scope = { tenantId: auth.tenantId, organizationId: auth.orgId }

  // Prefer the freshest rollup row whose window length matches the request.
  const windowSpanMs = ROLLUP_WINDOW_MS[window]
  const candidate = await em.findOne(
    AgentMetricRollup,
    { organizationId: scope.organizationId, agentId },
    { orderBy: { computedAt: 'desc' } },
  )
  if (
    candidate &&
    Math.abs(candidate.windowEnd.getTime() - candidate.windowStart.getTime() - windowSpanMs) < ROLLUP_BUCKET_MS &&
    Date.now() - candidate.computedAt.getTime() <= ROLLUP_FRESHNESS_MS
  ) {
    const parsed = agentMetricRollupMetricsSchema.safeParse(candidate.metrics)
    if (parsed.success) {
      return NextResponse.json({
        agentId,
        window,
        since: candidate.windowStart.toISOString(),
        ...parsed.data,
        capped: false,
        source: 'rollup' as const,
        computedAt: candidate.computedAt.toISOString(),
      })
    }
  }

  const metrics = await computeAgentMetrics(em, scope, { agentId, since })
  return NextResponse.json({
    agentId,
    window,
    since: since.toISOString(),
    ...metrics,
    capped: false,
    source: 'live' as const,
    computedAt: new Date().toISOString(),
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Agent Orchestrator',
  summary: 'Get per-agent quality metrics',
  methods: {
    GET: {
      summary: 'Override rate, eval-pass rate, latency and cost for an agent over a window',
      description:
        'Per-agent metrics over a window (24h|7d|30d|90d, default 30d). Prefers a precomputed rollup row when one matches the window and is fresh (source="rollup"); otherwise live-computes from this module\'s run + correction tables (source="live"). Gated by agent_orchestrator.trace.view.',
      responses: [{ status: 200, description: 'Per-agent metrics over the window' }],
      errors: [
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 403, description: 'Missing agent_orchestrator.trace.view', schema: errorSchema },
      ],
    },
  },
}
