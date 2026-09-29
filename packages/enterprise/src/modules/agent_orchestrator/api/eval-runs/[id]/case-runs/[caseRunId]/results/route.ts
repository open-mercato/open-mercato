import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { AgentEvalCaseRun, AgentEvalResult } from '../../../../../../data/entities'
import { agentOrchestratorTag } from '../../../../../openapi'

/**
 * Assertion results for ONE expanded case run. Split out of the suite-detail
 * response so the detail read stays bounded regardless of suite size.
 */
export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['agent_orchestrator.eval.manage'] },
}

const errorSchema = z.object({ error: z.string() })

type RouteContext = { params: Promise<{ id: string; caseRunId: string }> }

export async function GET(req: Request, ctx: RouteContext) {
  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!auth.tenantId || !auth.orgId) return NextResponse.json({ error: 'Tenant context required' }, { status: 400 })

  const { id, caseRunId } = await ctx.params
  const ids = z.object({ id: z.string().uuid(), caseRunId: z.string().uuid() }).safeParse({ id, caseRunId })
  if (!ids.success) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const container = await createRequestContainer()
  const em = (container.resolve('em') as EntityManager).fork()
  const scope = { tenantId: auth.tenantId, organizationId: auth.orgId }

  // Bind the case run to the suite in the WHERE clause: a caller must not be able
  // to read one suite's case run through another suite's id.
  const caseRun = await em.findOne(AgentEvalCaseRun, { id: caseRunId, suiteRunId: id, ...scope })
  if (!caseRun) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // `evidence` is encrypted at rest (it carries output excerpts and judge
  // reasoning), so this read must decrypt rather than serve ciphertext.
  const results = await findWithDecryption(
    em,
    AgentEvalResult,
    { evalCaseRunId: caseRun.id, ...scope },
    { orderBy: { evaluatedAt: 'ASC' } },
    scope,
  )

  return NextResponse.json({
    items: results.map((result) => ({
      id: result.id,
      assertion_id: result.assertionId,
      assertion_key: result.assertionKey,
      // null = skipped: excluded from both score and pass aggregation.
      passed: result.passed ?? null,
      score: result.score ?? null,
      severity: result.severity,
      evidence: result.evidence ?? null,
      evaluated_at: result.evaluatedAt.toISOString(),
    })),
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: agentOrchestratorTag,
  summary: 'Get assertion results for one eval case run',
  methods: {
    GET: {
      summary: 'Per-assertion verdicts for a single case run',
      description:
        '`passed: null` means the assertion was SKIPPED (no expected value, invalid config, or unknown scorer) — it is neither a pass nor a failure and is excluded from aggregation. The case run must belong to the suite run in the path. Gated by agent_orchestrator.eval.manage.',
      responses: [{ status: 200, description: 'Assertion results' }],
      errors: [
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 403, description: 'Missing agent_orchestrator.eval.manage', schema: errorSchema },
        { status: 404, description: 'Case run not found in this suite (or cross-tenant)', schema: errorSchema },
      ],
    },
  },
}
