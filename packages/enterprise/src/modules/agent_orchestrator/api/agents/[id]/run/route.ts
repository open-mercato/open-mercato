import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { validateCrudMutationGuard, runCrudMutationGuardAfterSuccess } from '@open-mercato/shared/lib/crud/mutation-guard'
import { agentRunRequestSchema } from '../../../../data/validators'
import type { AgentRunCtx, AgentRuntimeService } from '../../../../lib/runtime/agentRuntime'
import { invokerFromAuth, invokeDeniedErrorSchema } from '../../../../lib/access/invokeDenial'
import {
  agentRunErrorResponse,
  agentRunErrorSchema as errorSchema,
  agentRunSuccessResponse,
  agentRunSuccessResponseSchema,
  createRunIdObserver,
  guardrailBlockedErrorSchema,
  modelUnavailableErrorSchema,
  parseAgentRunRequest,
  unclassifiedErrorSchema,
} from '../../../../lib/runtime/agentRunHttp'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['agent_orchestrator.agents.run'] },
}

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(req: Request, ctx: RouteContext) {
  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!auth.tenantId || !auth.sub) {
    return NextResponse.json({ error: 'Tenant context required' }, { status: 400 })
  }

  const { id } = await ctx.params
  const body = await readJsonSafe(req, {})
  const parsed = parseAgentRunRequest(body)
  if (!parsed.ok) return parsed.response

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

  const runIdObserver = createRunIdObserver()
  const runCtx: AgentRunCtx = {
    tenantId: auth.tenantId,
    organizationId,
    userId: auth.sub,
    invoker: invokerFromAuth(auth),
    entryPoint: 'run_api',
    onRunPersisted: runIdObserver.onRunPersisted,
  }

  let result: unknown
  try {
    const agentRuntime = container.resolve('agentRuntime') as AgentRuntimeService
    result = await agentRuntime.run(id, parsed.input, runCtx)
  } catch (err) {
    return agentRunErrorResponse(err, id, runIdObserver.runId())
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

  return agentRunSuccessResponse(container, result, runIdObserver.runId(), {
    tenantId: auth.tenantId,
    organizationId,
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Agent Orchestrator',
  summary: 'Run an agent (Playground — engineering primitive)',
  methods: {
    POST: {
      summary: 'Run one agent directly (Playground, evals, diagnostics)',
      description:
        'An ENGINEERING primitive, not a business-orchestration one. It runs a single agent synchronously and returns what it produced; it has no retry, no wait states, no signals, no cancellation and no durable business lifecycle, because an AgentRun records an agent execution rather than a business process. Use it for the Playground, development, evals, diagnostics and sub-agent invocation. To start durable business work — from an integration, a schedule, an event or by hand — call POST /processes/{id}/executions and observe agent_orchestrator.process.execution.* instead; a caller coupled to an agent id cannot be refactored around. Runs the agent in object mode under the caller scope, persists an AgentRun (and an AgentProposal for proposal results), and returns the typed AgentResult plus additive sibling fields: `runId` (the persisted AgentRun id) and `proposalId` (the newest AgentProposal created by the run, null for researcher runs).',
      requestBody: {
        contentType: 'application/json',
        schema: agentRunRequestSchema,
        description: 'Agent input payload (shape is agent-specific).',
      },
      responses: [
        {
          status: 200,
          description: 'Typed AgentResult + { runId, proposalId }',
          schema: agentRunSuccessResponseSchema,
        },
      ],
      errors: [
        { status: 400, description: 'Tenant context missing, or no single organization is selected (run under "All organizations" is rejected)', schema: errorSchema },
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        {
          status: 403,
          description:
            'Missing agent_orchestrator.agents.run, or the caller may not invoke this agent (`code: "agent_invoke_denied"`; the agent\'s required features are never echoed)',
          schema: z.union([errorSchema, invokeDeniedErrorSchema]),
        },
        { status: 404, description: 'Unknown agent id', schema: errorSchema },
        {
          status: 422,
          description:
            'Invalid input, invalid model output, run wall-clock timeout — or a runtime guardrail block, in which case the body carries `code: "guardrail_blocked"` plus the typed `kind`/`phase`/`guardrailSetVersion` reason',
          schema: z.union([errorSchema, guardrailBlockedErrorSchema]),
        },
        { status: 429, description: 'Agent run capacity exhausted (admission control); includes Retry-After', schema: errorSchema },
        {
          status: 500,
          description:
            'The run failed for a reason this route does not classify; the body carries `code` (`agent_run_failed`) and a truncated `reason`',
          schema: unclassifiedErrorSchema,
        },
        {
          status: 503,
          description:
            'The deployment has no usable LLM provider; the body carries `code` (`no_provider_configured`, `api_key_missing`, or `provider_rejected` when a configured provider refuses the call)',
          schema: modelUnavailableErrorSchema,
        },
      ],
    },
  },
}
