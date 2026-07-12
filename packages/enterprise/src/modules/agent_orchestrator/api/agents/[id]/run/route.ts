import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { validateCrudMutationGuard, runCrudMutationGuardAfterSuccess } from '@open-mercato/shared/lib/crud/mutation-guard'
import { agentRunRequestSchema, baseAgentResultSchema } from '../../../../data/validators'
import { AgentProposal } from '../../../../data/entities'
import {
  AgentNotFoundError,
  AgentOutputInvalidError,
  AgentRunTimeoutError,
  type AgentRunCtx,
  type AgentRuntimeService,
} from '../../../../lib/runtime/agentRuntime'
import { isAgentCapacityError, resolveAdmissionMaxWaitMs } from '../../../../lib/runtime/admission'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['agent_orchestrator.agents.run'] },
}

const errorSchema = z.object({ error: z.string() })

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(req: Request, ctx: RouteContext) {
  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!auth.tenantId || !auth.sub) {
    return NextResponse.json({ error: 'Tenant context required' }, { status: 400 })
  }

  const { id } = await ctx.params
  const body = await readJsonSafe(req, {})
  const parsed = agentRunRequestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', fieldErrors: parsed.error.flatten().fieldErrors },
      { status: 422 },
    )
  }

  const container = await createRequestContainer()

  // Attribute the run to the concretely selected organization, resolved through
  // the canonical scope resolver (the same one the caseload reads with). Raw
  // `auth.orgId` is not trustworthy here: under the "All organizations" scope it
  // is either null (superadmin) or a stale account/home org, which would stamp an
  // AgentRun/AgentProposal under an org the caseload never queries — silently
  // orphaning the proposal from human disposition (#3629). Fail closed instead.
  const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const organizationId = scope?.selectedId ?? null
  if (!organizationId) {
    return NextResponse.json(
      {
        error:
          'Select a single organization before running an agent. Agent runs must be attributed to one organization so the resulting proposal is reviewable in the caseload.',
      },
      { status: 400 },
    )
  }

  const guardResult = await validateCrudMutationGuard(container, {
    tenantId: auth.tenantId,
    organizationId,
    userId: auth.sub,
    resourceKind: 'agent_orchestrator.agent_run',
    resourceId: id,
    operation: 'custom',
    requestMethod: 'POST',
    requestHeaders: req.headers,
  })
  if (guardResult && !guardResult.ok) {
    return NextResponse.json(guardResult.body, { status: guardResult.status })
  }

  // Capture the persisted run id (navigation spec §1): the runners fire
  // `onRunPersisted` for every run they create — nested sub-agent delegations
  // included — so keep only the FIRST invocation, which is the top-level run.
  let observedRunId: string | null = null
  const runCtx: AgentRunCtx = {
    tenantId: auth.tenantId,
    organizationId,
    userId: auth.sub,
    onRunPersisted: (persistedRunId) => {
      if (!observedRunId) observedRunId = persistedRunId
    },
  }

  let result: unknown
  try {
    const agentRuntime = container.resolve('agentRuntime') as AgentRuntimeService
    result = await agentRuntime.run(id, parsed.data.input, runCtx)
  } catch (err) {
    if (err instanceof AgentNotFoundError) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    }
    if (err instanceof AgentOutputInvalidError) {
      return NextResponse.json({ error: 'Agent produced invalid output' }, { status: 422 })
    }
    if (err instanceof AgentRunTimeoutError) {
      return NextResponse.json({ error: 'The agent run timed out before producing a result' }, { status: 422 })
    }
    if (isAgentCapacityError(err)) {
      const retryAfterSeconds = Math.max(1, Math.ceil(resolveAdmissionMaxWaitMs() / 1000))
      return NextResponse.json(
        { error: 'Agent run capacity is exhausted — retry shortly' },
        { status: 429, headers: { 'Retry-After': String(retryAfterSeconds) } },
      )
    }
    throw err
  }

  if (guardResult?.shouldRunAfterSuccess) {
    await runCrudMutationGuardAfterSuccess(container, {
      tenantId: auth.tenantId,
      organizationId,
      userId: auth.sub,
      resourceKind: 'agent_orchestrator.agent_run',
      resourceId: id,
      operation: 'custom',
      requestMethod: 'POST',
      requestHeaders: req.headers,
      metadata: guardResult.metadata,
    })
  }

  // Additive sibling fields next to the typed result (navigation spec §1): the
  // `AgentResult` union never defines `runId`/`proposalId`, so spreading is
  // collision-free and existing consumers reading `kind`/`proposal`/`data` are
  // unaffected. Id-only projection — no encrypted proposal columns are fetched.
  let proposalId: string | null = null
  if (observedRunId) {
    const em = (container.resolve('em') as EntityManager).fork()
    const proposals = await em.find(
      AgentProposal,
      { runId: observedRunId, tenantId: auth.tenantId, organizationId, deletedAt: null },
      { orderBy: { createdAt: 'desc' }, limit: 1, fields: ['id'] },
    )
    proposalId = proposals[0]?.id ?? null
  }

  const resultRecord = (result && typeof result === 'object' ? result : {}) as Record<string, unknown>
  return NextResponse.json({ ...resultRecord, runId: observedRunId, proposalId })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Agent Orchestrator',
  summary: 'Run an agent (playground)',
  methods: {
    POST: {
      summary: 'Run an agent',
      description:
        'Runs the agent in object mode under the caller scope, persists an AgentRun (and an AgentProposal for actionable results), and returns the typed AgentResult plus additive sibling fields: `runId` (the persisted AgentRun id) and `proposalId` (the newest AgentProposal created by the run, null for informative runs).',
      requestBody: {
        contentType: 'application/json',
        schema: agentRunRequestSchema,
        description: 'Agent input payload (shape is agent-specific).',
      },
      responses: [
        {
          status: 200,
          description: 'Typed AgentResult + { runId, proposalId }',
          schema: baseAgentResultSchema.and(
            z.object({ runId: z.string().uuid().nullable(), proposalId: z.string().uuid().nullable() }),
          ),
        },
      ],
      errors: [
        { status: 400, description: 'Tenant context missing, or no single organization is selected (run under "All organizations" is rejected)', schema: errorSchema },
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 403, description: 'Missing agent_orchestrator.agents.run', schema: errorSchema },
        { status: 404, description: 'Unknown agent id', schema: errorSchema },
        { status: 422, description: 'Invalid input, invalid model output, or run wall-clock timeout', schema: errorSchema },
        { status: 429, description: 'Agent run capacity exhausted (admission control); includes Retry-After', schema: errorSchema },
      ],
    },
  },
}
