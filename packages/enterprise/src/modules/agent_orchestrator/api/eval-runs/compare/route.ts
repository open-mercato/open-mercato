import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { evalRunCompareQuerySchema } from '../../../data/validators'
import { compareSuiteRuns, EvalCompareError } from '../../../lib/eval/regression/compareSuiteRuns'
import { agentOrchestratorTag } from '../../openapi'

/**
 * Side-by-side comparison of two finished suite runs of one agent: pass-score
 * delta, per-assertion pass-rate deltas and a per-case diff. Verdicts and
 * scores only — no evidence, inputs or outputs — so it shares the gate of the
 * per-case results route.
 */
export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['agent_orchestrator.eval.manage'] },
}

const errorSchema = z.object({ error: z.string(), code: z.string().optional() })

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!auth.tenantId || !auth.orgId) return NextResponse.json({ error: 'Tenant context required' }, { status: 400 })

  const url = new URL(req.url)
  const parsed = evalRunCompareQuerySchema.safeParse(Object.fromEntries(url.searchParams))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid query' }, { status: 400 })

  const container = await createRequestContainer()
  const em = (container.resolve('em') as EntityManager).fork()
  const scope = { tenantId: auth.tenantId, organizationId: auth.orgId }
  try {
    const comparison = await compareSuiteRuns(em, scope, parsed.data.base, parsed.data.head)
    return NextResponse.json(comparison)
  } catch (err) {
    if (err instanceof EvalCompareError) {
      const message = err.code === 'not_found' ? 'Not found' : err.code === 'run_not_finished' ? 'Run not finished' : 'Runs belong to different agents'
      return NextResponse.json({ error: message, code: err.code }, { status: err.status })
    }
    throw err
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: agentOrchestratorTag,
  summary: 'Compare two evaluation runs of an agent',
  methods: {
    GET: {
      summary: 'Pass-score delta, per-assertion deltas and per-case diff between two finished suite runs',
      query: evalRunCompareQuerySchema,
      description:
        'Compares suite run `head` against suite run `base` (both finished, same agent). `base`/`head` carry each run\'s summary including `agentVersions` and `manifestHash`; `sameDataset` compares the frozen manifest hashes (null when either run has none). `assertions` lists every assertion key with base/head pass rates over applied results and `regressed` = a deterministic gate assertion whose pass rate dropped (judge movement is reported, never flagged). `cases` has one row per eval case of either run with base/head status (passed|failed|error|skipped|absent, same rule as the report\'s baselineStatus), mean scores, the first trial\'s agent run ids and `flippedAssertions` (per-case verdicts that differ); `change` is regressed|fixed|changed|added|removed|unchanged, sorted in that order (unchanged last). No evidence, inputs or outputs are returned. Tenant- and organization-scoped; a run outside the caller organization is 404. Gated by agent_orchestrator.eval.manage.',
      responses: [{ status: 200, description: 'The comparison' }],
      errors: [
        { status: 400, description: 'Invalid ids, or base equals head', schema: errorSchema },
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 403, description: 'Missing agent_orchestrator.eval.manage', schema: errorSchema },
        { status: 404, description: 'Either run not found (or cross-tenant), code not_found', schema: errorSchema },
        { status: 409, description: 'Either run is still queued or running, code run_not_finished', schema: errorSchema },
        { status: 422, description: 'The runs belong to different agents, code agent_mismatch', schema: errorSchema },
      ],
    },
  },
}
