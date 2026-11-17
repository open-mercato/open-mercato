import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { evalRunTrendQuerySchema } from '../../../data/validators'
import { buildEvalTrend } from '../../../lib/eval/regression/buildEvalTrend'
import { agentOrchestratorTag } from '../../openapi'

/**
 * Regression dashboard trend: pass score of an agent's completed suite runs
 * with the agent version(s) each run executed, plus a per-version summary.
 * Read-only; same gate as the suite-run history.
 */
export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['agent_orchestrator.eval.manage'] },
}

const errorSchema = z.object({ error: z.string() })

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!auth.tenantId || !auth.orgId) return NextResponse.json({ error: 'Tenant context required' }, { status: 400 })

  const url = new URL(req.url)
  const parsed = evalRunTrendQuerySchema.safeParse(Object.fromEntries(url.searchParams))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid query' }, { status: 400 })

  const container = await createRequestContainer()
  const em = (container.resolve('em') as EntityManager).fork()
  const scope = { tenantId: auth.tenantId, organizationId: auth.orgId }
  const trend = await buildEvalTrend(em, scope, parsed.data.agentDefinitionId, {
    evalSetVersion: parsed.data.evalSetVersion ?? null,
    limit: parsed.data.limit,
  })
  return NextResponse.json(trend)
}

export const openApi: OpenApiRouteDoc = {
  tag: agentOrchestratorTag,
  summary: 'Evaluation pass-score trend across agent versions',
  methods: {
    GET: {
      summary: 'Pass-score trend of an agent\'s completed evaluation runs, grouped by agent version',
      query: evalRunTrendQuerySchema,
      description:
        'Returns the newest `limit` (1–100, default 30) COMPLETED suite runs of `agentDefinitionId` as `points`, oldest first, optionally narrowed to one `evalSetVersion`. Each point carries `agentVersions` — the distinct agent versions of the agent runs its case runs produced (null for runs that predate version stamping; empty when the suite produced no agent run) — its dataset key (frozen manifest hash, else evalSetVersion) and `passScoreDelta` against the previous point of the SAME dataset (null when none). `versions` has one row per agent version in order of first appearance: run count, latest and mean pass score, and `passScoreDelta` of its latest run against the previous version\'s latest run, null when they ran different datasets (`sameDataset: false`). Tenant- and organization-scoped. Gated by agent_orchestrator.eval.manage.',
      responses: [{ status: 200, description: 'Trend points and per-version summary' }],
      errors: [
        { status: 400, description: 'Invalid query', schema: errorSchema },
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 403, description: 'Missing agent_orchestrator.eval.manage', schema: errorSchema },
      ],
    },
  },
}
