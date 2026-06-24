import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { AgentRun, AgentCorrection, AgentProposal } from '../../../../data/entities'
import { runWindow } from '../../../../data/validators'

/**
 * Per-agent quality metrics over a window — override rate, eval-pass rate,
 * latency and cost — computed from this module's tables. Window-bounded and
 * capped; large fleets get exact rollups in PR4 (gap-05).
 */
export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['agent_orchestrator.trace.view'] },
}

const WINDOW_MS: Record<string, number> = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
  '90d': 90 * 24 * 60 * 60 * 1000,
}
const ROW_CAP = 5000

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
  const since = new Date(Date.now() - WINDOW_MS[window])

  const container = await createRequestContainer()
  const em = (container.resolve('em') as EntityManager).fork()
  const scope = { tenantId: auth.tenantId, organizationId: auth.orgId }

  const runs = await em.find(
    AgentRun,
    { ...scope, agentId, createdAt: { $gte: since }, deletedAt: null },
    { limit: ROW_CAP, orderBy: { createdAt: 'desc' } },
  )

  const totalRuns = runs.length
  const evaluated = runs.filter((run) => run.evalPassed !== null && run.evalPassed !== undefined)
  const evalPassRate = evaluated.length
    ? evaluated.filter((run) => run.evalPassed === true).length / evaluated.length
    : null

  const runIds = runs.map((run) => run.id)
  const overrides = runIds.length
    ? await em.count(AgentCorrection, { ...scope, agentRunId: { $in: runIds } })
    : 0
  const overrideRate = totalRuns ? overrides / totalRuns : null

  const latencies = runs.map((run) => run.latencyMs).filter((n): n is number => typeof n === 'number')
  const avgLatencyMs = latencies.length ? latencies.reduce((sum, n) => sum + n, 0) / latencies.length : null
  const costMinorTotal = runs.reduce((sum, run) => sum + (typeof run.costMinor === 'number' ? run.costMinor : 0), 0)

  // Anti-rubber-stamp signal (AI Act Art. 14): the fraction of disposed proposals
  // approved with NO change (human `approved` or rule `auto_approved`) vs. those
  // the operator edited/rejected. A high rate flags possible rubber-stamping.
  const proposalWindow = { ...scope, agentId, createdAt: { $gte: since } }
  const [unchanged, changed] = await Promise.all([
    em.count(AgentProposal, { ...proposalWindow, disposition: { $in: ['approved', 'auto_approved'] } }),
    em.count(AgentProposal, { ...proposalWindow, disposition: { $in: ['edited', 'rejected'] } }),
  ])
  const disposedProposals = unchanged + changed
  const approveUnchangedRate = disposedProposals ? unchanged / disposedProposals : null

  return NextResponse.json({
    agentId,
    window,
    since: since.toISOString(),
    totalRuns,
    evaluatedRuns: evaluated.length,
    evalPassRate,
    overrides,
    overrideRate,
    avgLatencyMs,
    costMinorTotal,
    disposedProposals,
    approveUnchangedRate,
    capped: totalRuns >= ROW_CAP,
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Agent Orchestrator',
  summary: 'Get per-agent quality metrics',
  methods: {
    GET: {
      summary: 'Override rate, eval-pass rate, latency and cost for an agent over a window',
      description:
        'Computes per-agent metrics from this module\'s run + correction tables over a window (24h|7d|30d|90d, default 30d). Window-bounded/capped (exact rollups arrive in a later phase). Gated by agent_orchestrator.trace.view.',
      responses: [{ status: 200, description: 'Per-agent metrics over the window' }],
      errors: [
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 403, description: 'Missing agent_orchestrator.trace.view', schema: errorSchema },
      ],
    },
  },
}
