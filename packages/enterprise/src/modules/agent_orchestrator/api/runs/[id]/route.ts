import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { AgentRun, AgentSpan, AgentToolCall, AgentEvalResult, AgentContextBundle, AgentGuardrailCheck, AgentProposal } from '../../../data/entities'

/**
 * Full run detail for the trace inspector: the run plus its ordered spans and
 * tool-calls. Org-scoped — a run in another organization returns 404 (never the
 * row), so org B cannot read org A's traces.
 */
export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['agent_orchestrator.trace.view'] },
}

const idSchema = z.string().uuid()

type RouteContext = { params: Promise<{ id: string }> }

const errorSchema = z.object({ error: z.string() })

export async function GET(req: Request, ctx: RouteContext) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await ctx.params
  const parsedId = idSchema.safeParse(id)
  if (!parsedId.success) return NextResponse.json({ error: 'Run not found' }, { status: 404 })

  const scope = { tenantId: auth.tenantId, organizationId: auth.orgId ?? undefined }
  const decryptionScope = { tenantId: auth.tenantId, organizationId: auth.orgId ?? null }
  const container = await createRequestContainer()
  const em = (container.resolve('em') as EntityManager).fork()

  const run = await findOneWithDecryption(
    em,
    AgentRun,
    { id: parsedId.data, ...scope, deletedAt: null },
    undefined,
    decryptionScope,
  )
  if (!run) return NextResponse.json({ error: 'Run not found' }, { status: 404 })

  const [spans, toolCalls, evalResults, contextBundles, guardrailChecks, proposals] = await Promise.all([
    em.find(AgentSpan, { agentRunId: run.id, ...scope }, { orderBy: { sequence: 'asc' } }),
    findWithDecryption(
      em,
      AgentToolCall,
      { agentRunId: run.id, ...scope },
      { orderBy: { createdAt: 'asc' } },
      decryptionScope,
    ),
    // `evidence` is encrypted (output excerpts + judge reasoning).
    findWithDecryption(em, AgentEvalResult, { agentRunId: run.id, ...scope }, { orderBy: { evaluatedAt: 'asc' } }, scope),
    em.find(AgentContextBundle, { agentRunId: run.id, ...scope }, { orderBy: { createdAt: 'desc' }, limit: 1 }),
    em.find(AgentGuardrailCheck, { agentRunId: run.id, ...scope }, { orderBy: { createdAt: 'asc' } }),
    findWithDecryption(
      em,
      AgentProposal,
      { runId: run.id, ...scope, deletedAt: null },
      { orderBy: { createdAt: 'asc' } },
      decryptionScope,
    ),
  ])

  return NextResponse.json({
    run,
    spans,
    toolCalls,
    evalResults,
    contextBundle: contextBundles[0] ?? null,
    guardrailChecks,
    proposals,
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Agent Orchestrator',
  summary: 'Get agent run trace detail',
  methods: {
    GET: {
      summary: 'Get a full agent run with its spans and tool calls',
      description:
        'Returns the run plus its ordered spans, tool-calls, eval results, the assembled context bundle (TDCR), guardrail check verdicts, and its proposals (decrypted payloads carrying the persisted rationale) for the trace inspector. Org-scoped; gated by agent_orchestrator.trace.view.',
      responses: [{ status: 200, description: 'Run trace detail' }],
      errors: [
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 403, description: 'Missing agent_orchestrator.trace.view', schema: errorSchema },
        { status: 404, description: 'Unknown run id', schema: errorSchema },
      ],
    },
  },
}
