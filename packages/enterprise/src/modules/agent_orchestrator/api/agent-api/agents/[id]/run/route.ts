import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { parseBooleanWithDefault } from '@open-mercato/shared/lib/boolean'
import { readEndpointRateLimitConfig } from '@open-mercato/shared/lib/ratelimit/config'
import { rateLimitErrorSchema } from '@open-mercato/shared/lib/ratelimit/helpers'
import { validateCrudMutationGuard, runCrudMutationGuardAfterSuccess } from '@open-mercato/shared/lib/crud/mutation-guard'
import { resolveCorrelationId, CORRELATION_ID_HEADER } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/mcp-audit'
import { agentRunRequestSchema } from '../../../../../data/validators'
import type { AgentRunCtx, AgentRuntimeService } from '../../../../../lib/runtime/agentRuntime'
import { invokeDeniedBody, invokeDeniedErrorSchema } from '../../../../../lib/access/invokeDenial'
import { enforcePublicEndpointRateLimit } from '../../../../../lib/guardrails/publicEndpointRateLimit'
import { verifyAgentToken } from '../../../../../lib/identity/agentTokenService'
import {
  agentRunErrorResponse,
  agentRunErrorSchema,
  agentRunSuccessResponse,
  agentRunSuccessResponseSchema,
  createRunIdObserver,
  guardrailBlockedErrorSchema,
  modelUnavailableErrorSchema,
  parseAgentRunRequest,
  unclassifiedErrorSchema,
} from '../../../../../lib/runtime/agentRunHttp'

/**
 * The agent-token door (agent invocation access spec §E): an EXTERNAL agent runs
 * one agent with its own `aud=agent` Bearer token instead of a staff session, so
 * it sets `requireAuth: false`. The route is invisible (404) unless
 * `OM_AGENT_API_ENABLED` is on. Rate-limited per client IP BEFORE token
 * verification, which re-loads the delegation grant on every request (immediate
 * revocation). Any token failure is one minimal 401. The run executes with the
 * token principal as invoker and `runAs`, so the target agent's
 * `requiredFeatures` are checked against the principal's role by the runtime.
 */
export const metadata = {
  POST: { requireAuth: false },
}

const AGENT_API_ENABLED_ENV = 'OM_AGENT_API_ENABLED'
const AGENT_API_RUN_SCOPE = 'agent_orchestrator.agents.run'

const agentApiRunRateLimitConfig = readEndpointRateLimitConfig('AGENT_ORCH_AGENT_API_RUN', {
  points: 30,
  duration: 60,
  blockDuration: 60,
  keyPrefix: 'agent_orchestrator:agent_api_run',
})

const unauthorizedErrorSchema = z.object({ error: z.literal('unauthorized') })

function isAgentApiEnabled(): boolean {
  return parseBooleanWithDefault(process.env[AGENT_API_ENABLED_ENV], false)
}

function readBearerToken(req: Request): string | null {
  const header = req.headers.get('authorization')
  if (!header) return null
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header)
  return match ? match[1] : null
}

function grantsAgentRun(scopes: string[], agentId: string): boolean {
  return scopes.includes(AGENT_API_RUN_SCOPE) || scopes.includes(`agent:${agentId}`)
}

function unauthorized(): NextResponse {
  return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
}

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(req: Request, ctx: RouteContext) {
  if (!isAgentApiEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const container = await createRequestContainer()
  const rateLimited = await enforcePublicEndpointRateLimit(container, req, agentApiRunRateLimitConfig)
  if (rateLimited) return rateLimited

  const token = readBearerToken(req)
  if (!token) return unauthorized()
  const verified = await verifyAgentToken(container, token)
  if (!verified) return unauthorized()

  const { id } = await ctx.params
  if (!grantsAgentRun(verified.scopes, id)) {
    return NextResponse.json(invokeDeniedBody({ agentId: id }), { status: 403 })
  }

  const body = await readJsonSafe(req, {})
  const parsed = parseAgentRunRequest(body)
  if (!parsed.ok) return parsed.response

  const { claims } = verified
  const tenantId = claims.tenantId
  const organizationId = claims.organizationId

  const guardResult = await validateCrudMutationGuard(container, {
    tenantId,
    organizationId,
    userId: claims.sub,
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
    tenantId,
    organizationId,
    userId: claims.sub,
    invoker: {
      kind: 'agent_token',
      agentUserId: claims.sub,
      onBehalfOfUserId: claims.obo ?? null,
      grantId: claims.grantId,
    },
    runAs: { agentUserId: claims.sub, onBehalfOfUserId: claims.obo ?? null },
    entryPoint: 'agent_api',
    correlationId: resolveCorrelationId(req.headers.get(CORRELATION_ID_HEADER)),
    onRunPersisted: runIdObserver.onRunPersisted,
  }

  let result: unknown
  try {
    const agentRuntime = container.resolve('agentRuntime') as AgentRuntimeService
    result = await agentRuntime.run(id, parsed.input, runCtx)
  } catch (err) {
    return agentRunErrorResponse(err, id, runIdObserver.runId(), { exposeReason: false })
  }

  if (guardResult?.shouldRunAfterSuccess) {
    await runCrudMutationGuardAfterSuccess(container, {
      tenantId,
      organizationId,
      userId: claims.sub,
      resourceKind: 'agent_orchestrator.agent_run',
      resourceId: id,
      operation: 'custom',
      requestMethod: 'POST',
      requestHeaders: req.headers,
      metadata: guardResult.metadata,
    })
  }

  return agentRunSuccessResponse(container, result, runIdObserver.runId(), { tenantId, organizationId })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Agent Orchestrator',
  summary: 'Run an agent with an agent token',
  methods: {
    POST: {
      summary: 'Run one agent as an external agent principal',
      description:
        'The agent-token door. Disabled (404) unless OM_AGENT_API_ENABLED is on. Accepts only `Authorization: Bearer <agent access token>` minted by POST /identity/token; the delegation grant is re-checked on every request, so a revoked grant fails on the next call. The token scope must contain `agent_orchestrator.agents.run` or `agent:<id>`, and the target agent\'s required features are checked against the agent principal\'s role. Tenant and organization come from the token, never the request. The run executes as the agent principal on behalf of the delegating human. Request, response and run error contract match POST /agents/{id}/run.',
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
        {
          status: 401,
          description: 'Missing, invalid, expired or revoked agent token (minimal body, no detail)',
          schema: unauthorizedErrorSchema,
        },
        {
          status: 403,
          description:
            'The token scope does not cover this agent, or the agent principal may not invoke it (`code: "agent_invoke_denied"`; required features are never echoed)',
          schema: z.union([agentRunErrorSchema, invokeDeniedErrorSchema]),
        },
        { status: 404, description: 'The agent API is disabled, or the agent id is unknown', schema: agentRunErrorSchema },
        {
          status: 422,
          description:
            'Invalid input, invalid model output, run wall-clock timeout, or a runtime guardrail block (`code: "guardrail_blocked"`)',
          schema: z.union([agentRunErrorSchema, guardrailBlockedErrorSchema]),
        },
        {
          status: 429,
          description: 'Too many requests from this client IP, or agent run capacity exhausted; includes Retry-After',
          schema: z.union([rateLimitErrorSchema, agentRunErrorSchema]),
        },
        {
          status: 500,
          description: 'The run failed for a reason this route does not classify (`code: "agent_run_failed"`)',
          schema: unclassifiedErrorSchema,
        },
        {
          status: 503,
          description: 'No usable LLM provider, or the rate limiter is unavailable',
          schema: z.union([modelUnavailableErrorSchema, rateLimitErrorSchema]),
        },
      ],
    },
  },
}
