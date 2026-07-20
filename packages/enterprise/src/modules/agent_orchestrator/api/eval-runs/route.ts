import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { AgentEvalSuiteRun } from '../../data/entities'
import { evalRunCreateSchema, evalRunListQuerySchema } from '../../data/validators'
import { replaySuiteRun } from '../../lib/eval/evalReplayService'
import { AGENT_ORCHESTRATOR_EVAL_SUITE_QUEUE, getAgentOrchestratorQueue } from '../../lib/queue'
import type {
  CompleteEvalRunCommandInput,
  CompleteEvalRunCommandResult,
  StartEvalRunCommandInput,
  StartEvalRunCommandResult,
} from '../../commands/evalRuns'
import { agentOrchestratorTag } from '../openapi'

/**
 * Evaluation runs. `eval.run` is required to TRIGGER one because a run performs
 * real inference against a real model; reading history needs only `eval.manage`.
 */
export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['agent_orchestrator.eval.manage'] },
  POST: { requireAuth: true, requireFeatures: ['agent_orchestrator.eval.run'] },
}

/**
 * Small selections run INLINE so the caller gets a finished result in one round
 * trip (and the trigger dialog can show it immediately). Anything larger would
 * outlive a serverless request, so it is handed to the eval-suite worker and the
 * caller follows progress over SSE.
 */
const MAX_SYNCHRONOUS_CASE_RUNS = 5

const errorSchema = z.object({ error: z.string() })

function toScope(auth: { tenantId?: string | null; orgId?: string | null }) {
  return { tenantId: auth.tenantId as string, organizationId: auth.orgId as string }
}

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!auth.tenantId || !auth.orgId) return NextResponse.json({ error: 'Tenant context required' }, { status: 400 })

  const url = new URL(req.url)
  const parsed = evalRunListQuerySchema.safeParse(Object.fromEntries(url.searchParams))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid query' }, { status: 400 })
  const query = parsed.data

  const container = await createRequestContainer()
  const em = (container.resolve('em') as EntityManager).fork()

  const where: Record<string, unknown> = toScope(auth)
  if (query.agentDefinitionId) where.agentDefinitionId = query.agentDefinitionId
  if (query.status) where.status = query.status

  const [items, total] = await em.findAndCount(AgentEvalSuiteRun, where, {
    orderBy: { createdAt: 'DESC' },
    limit: query.pageSize,
    offset: (query.page - 1) * query.pageSize,
  })

  return NextResponse.json({
    items: items.map((run) => ({
      id: run.id,
      agent_definition_id: run.agentDefinitionId,
      trigger: run.trigger,
      status: run.status,
      outcome: run.outcome ?? null,
      case_count: run.caseCount,
      error_count: run.errorCount,
      pass_score: run.passScore ?? null,
      score_variance: run.scoreVariance ?? null,
      repeat_count: run.repeatCount,
      judge_may_gate: run.judgeMayGate,
      triggered_by: run.triggeredBy ?? null,
      started_at: run.startedAt?.toISOString() ?? null,
      finished_at: run.finishedAt?.toISOString() ?? null,
      created_at: run.createdAt.toISOString(),
    })),
    total,
    page: query.page,
    pageSize: query.pageSize,
  })
}

export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!auth.tenantId || !auth.orgId || !auth.sub) {
    return NextResponse.json({ error: 'Tenant context required' }, { status: 400 })
  }

  const body = await readJsonSafe<unknown>(req, {})
  const parsed = evalRunCreateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid body', issues: parsed.error.issues }, { status: 400 })
  }
  const input = parsed.data

  const requested = input.evalCaseIds.length * input.repeatCount

  const container = await createRequestContainer()
  const commandBus = container.resolve('commandBus') as CommandBus
  const scope = toScope(auth)
  const commandCtx: CommandRuntimeContext = {
    container,
    auth: { sub: auth.sub, tenantId: auth.tenantId, orgId: auth.orgId } as CommandRuntimeContext['auth'],
    organizationScope: null,
    selectedOrganizationId: auth.orgId,
    organizationIds: [auth.orgId],
    request: req,
  }

  try {
    const { result: started } = await commandBus.execute<StartEvalRunCommandInput, StartEvalRunCommandResult>(
      'agent_orchestrator.evalRuns.start',
      {
        input: {
          ...scope,
          agentDefinitionId: input.agentDefinitionId,
          evalCaseIds: input.evalCaseIds,
          repeatCount: input.repeatCount,
          trigger: 'manual',
          judgeMayGate: input.judgeMayGate,
          triggeredBy: auth.sub,
        },
        ctx: commandCtx,
      },
    )

    if (requested > MAX_SYNCHRONOUS_CASE_RUNS) {
      // Enqueued AFTER the suite run and its pending case runs are committed, so
      // the worker always finds a complete, durable work list — and a payload
      // carrying only the id cannot cross tenants.
      await getAgentOrchestratorQueue(AGENT_ORCHESTRATOR_EVAL_SUITE_QUEUE).enqueue({
        suiteRunId: started.suiteRunId,
      })
      return NextResponse.json(
        { suiteRunId: started.suiteRunId, status: 'queued', outcome: null, passScore: null, caseRunCount: started.caseRunCount },
        { status: 202 },
      )
    }

    await replaySuiteRun(container, started.suiteRunId, scope, auth.sub)

    const { result: completed } = await commandBus.execute<
      CompleteEvalRunCommandInput,
      CompleteEvalRunCommandResult
    >('agent_orchestrator.evalRuns.complete', {
      input: { ...scope, suiteRunId: started.suiteRunId },
      ctx: commandCtx,
    })

    return NextResponse.json({ ...completed, caseRunCount: started.caseRunCount })
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    throw err
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: agentOrchestratorTag,
  summary: 'List and trigger agent evaluation runs',
  methods: {
    GET: {
      summary: 'Paginated history of evaluation runs for the organization',
      description:
        'Suite-run history, newest first. Filterable by agentDefinitionId and status. pageSize is capped at 100. Gated by agent_orchestrator.eval.manage.',
      responses: [{ status: 200, description: 'Paged suite runs' }],
      errors: [
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 403, description: 'Missing agent_orchestrator.eval.manage', schema: errorSchema },
      ],
    },
    POST: {
      summary: 'Run an evaluation of an agent against selected approved eval cases',
      description:
        'Replays each selected case through the real agent runtime (FRESH inference under the agent\'s own principal, propose-only: no proposal is ever disposed) and scores the resulting run against the effective assertion set. Only approved cases are accepted. Selections of 5 case runs or fewer execute inline and return 200 with the finished summary; larger ones are queued and return 202 with status "queued" — follow them via the eval_case_run.* SSE events. Gated by agent_orchestrator.eval.run.',
      responses: [
        { status: 200, description: 'The completed suite run summary (executed inline)' },
        { status: 202, description: 'The suite run was queued for the eval worker' },
      ],
      errors: [
        { status: 400, description: 'Invalid body', schema: errorSchema },
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 403, description: 'Missing agent_orchestrator.eval.run', schema: errorSchema },
        { status: 422, description: 'No approved cases matched, or selection too large', schema: errorSchema },
      ],
    },
  },
}
