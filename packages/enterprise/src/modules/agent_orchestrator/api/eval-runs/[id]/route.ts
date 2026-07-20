import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { AgentEvalCaseRun, AgentEvalSuiteRun } from '../../../data/entities'
import { evalCaseRunListQuerySchema } from '../../../data/validators'
import { agentOrchestratorTag } from '../../openapi'

/**
 * Suite run detail. Case runs are PAGED and assertion results are deliberately
 * NOT inlined: a 500-case suite at repeatCount 3 would otherwise return ~1,500
 * case runs and their results in one payload — which the live-progress UI
 * re-fetches during the very run that produces it. Results load per expanded case
 * run from the sibling route.
 */
export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['agent_orchestrator.eval.manage'] },
}

const errorSchema = z.object({ error: z.string() })

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(req: Request, ctx: RouteContext) {
  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!auth.tenantId || !auth.orgId) return NextResponse.json({ error: 'Tenant context required' }, { status: 400 })

  const { id } = await ctx.params
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: 'Invalid eval run id' }, { status: 400 })
  }

  const url = new URL(req.url)
  const parsed = evalCaseRunListQuerySchema.safeParse(Object.fromEntries(url.searchParams))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid query' }, { status: 400 })
  const query = parsed.data

  const container = await createRequestContainer()
  const em = (container.resolve('em') as EntityManager).fork()
  const scope = { tenantId: auth.tenantId, organizationId: auth.orgId }

  // `summary` is encrypted (it can carry evidence excerpts quoting agent output).
  const suiteRun = await findOneWithDecryption(
    em,
    AgentEvalSuiteRun,
    { id, ...scope },
    undefined,
    scope,
  )
  // Org-scoped 404 rather than 403: a cross-tenant id must not be distinguishable
  // from a nonexistent one.
  if (!suiteRun) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Keyset on (suite_run_id, created_at) — served by agent_eval_case_runs_suite_idx.
  const where: Record<string, unknown> = { suiteRunId: suiteRun.id, ...scope }
  if (query.after) {
    const cursor = new Date(query.after)
    if (!Number.isNaN(cursor.getTime())) where.createdAt = { $gt: cursor }
  }

  const caseRuns = await findWithDecryption(
    em,
    AgentEvalCaseRun,
    where,
    { orderBy: { createdAt: 'ASC' }, limit: query.pageSize },
    scope,
  )

  const last = caseRuns.at(-1)

  return NextResponse.json({
    run: {
      id: suiteRun.id,
      agent_definition_id: suiteRun.agentDefinitionId,
      release_id: suiteRun.releaseId ?? null,
      trigger: suiteRun.trigger,
      status: suiteRun.status,
      outcome: suiteRun.outcome ?? null,
      judge_may_gate: suiteRun.judgeMayGate,
      repeat_count: suiteRun.repeatCount,
      case_count: suiteRun.caseCount,
      error_count: suiteRun.errorCount,
      eval_set_version: suiteRun.evalSetVersion ?? null,
      pass_score: suiteRun.passScore ?? null,
      score_variance: suiteRun.scoreVariance ?? null,
      safety_regressions: suiteRun.safetyRegressions ?? null,
      // The run this one was compared against. Without it the UI can show THAT a
      // regression happened but not what it regressed from.
      baseline_suite_run_id: suiteRun.baselineSuiteRunId ?? null,
      summary: suiteRun.summary ?? null,
      triggered_by: suiteRun.triggeredBy ?? null,
      started_at: suiteRun.startedAt?.toISOString() ?? null,
      finished_at: suiteRun.finishedAt?.toISOString() ?? null,
      created_at: suiteRun.createdAt.toISOString(),
    },
    caseRuns: caseRuns.map((caseRun) => ({
      id: caseRun.id,
      eval_case_id: caseRun.evalCaseId,
      agent_run_id: caseRun.agentRunId ?? null,
      trial_index: caseRun.trialIndex,
      status: caseRun.status,
      passed: caseRun.passed ?? null,
      score: caseRun.score ?? null,
      latency_ms: caseRun.latencyMs ?? null,
      cost_minor: caseRun.costMinor ?? null,
      error_message: caseRun.errorMessage ?? null,
      created_at: caseRun.createdAt.toISOString(),
    })),
    nextCursor: caseRuns.length === query.pageSize && last ? last.createdAt.toISOString() : null,
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: agentOrchestratorTag,
  summary: 'Get an evaluation run with its case runs',
  methods: {
    GET: {
      summary: 'Suite run detail plus a keyset page of its case runs',
      description:
        'Returns the suite run and up to `pageSize` (max 100) case runs ordered by created_at, with `nextCursor` for the next page. Assertion results are NOT inlined — fetch them per case run from /eval-runs/:id/case-runs/:caseRunId/results. Cross-tenant ids return 404. Gated by agent_orchestrator.eval.manage.',
      responses: [{ status: 200, description: 'Suite run + paged case runs' }],
      errors: [
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 403, description: 'Missing agent_orchestrator.eval.manage', schema: errorSchema },
        { status: 404, description: 'Suite run not found (or cross-tenant)', schema: errorSchema },
      ],
    },
  },
}
