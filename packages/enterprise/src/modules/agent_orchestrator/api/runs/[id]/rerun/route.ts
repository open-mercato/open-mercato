import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { validateCrudMutationGuard, runCrudMutationGuardAfterSuccess } from '@open-mercato/shared/lib/crud/mutation-guard'
import { AgentRun } from '../../../../data/entities'
import { guardrailKind, guardrailPhase } from '../../../../data/validators'
import {
  AgentGuardrailBlockedError,
  AgentNotFoundError,
  AgentOutputInvalidError,
  AgentRunTimeoutError,
  type AgentRunCtx,
  type AgentRuntimeService,
} from '../../../../lib/runtime/agentRuntime'
import { isAgentCapacityError, resolveAdmissionMaxWaitMs } from '../../../../lib/runtime/admission'
import { withRerunOf } from '../../../../lib/runtime/rerunContext'

/**
 * "Re-run" from the trace inspector: executes the run's agent again with the
 * SAME (decrypted) original input, through the exact playground execution path
 * (admission control, guardrails, disposition). The new run is linked back via
 * `rerun_of_run_id`, stamped at creation through the rerun async context.
 */
export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['agent_orchestrator.agents.run'] },
}

const errorSchema = z.object({ error: z.string() })
const resultSchema = z.object({ runId: z.string().uuid().nullable() })

/** 422 body for a guardrail `block` verdict — distinct from plain invalid output. */
const guardrailBlockedErrorSchema = errorSchema.extend({
  code: z.literal('guardrail_blocked'),
  kind: guardrailKind,
  phase: guardrailPhase,
  guardrailSetVersion: z.string().nullable(),
})

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(req: Request, ctx: RouteContext) {
  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!auth.tenantId || !auth.sub) {
    return NextResponse.json({ error: 'Tenant context required' }, { status: 400 })
  }

  const { id } = await ctx.params
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: 'Run not found' }, { status: 404 })
  }

  const container = await createRequestContainer()

  // Same fail-closed org attribution as the playground run route: the new run
  // must land in one concretely selected organization.
  const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const organizationId = scope?.selectedId ?? null
  if (!organizationId) {
    return NextResponse.json(
      {
        error:
          'Select a single organization before re-running an agent. Agent runs must be attributed to one organization so the resulting proposal is reviewable in the caseload.',
      },
      { status: 400 },
    )
  }

  const em = (container.resolve('em') as EntityManager).fork()
  const sourceRun = await findOneWithDecryption(
    em,
    AgentRun,
    { id, tenantId: auth.tenantId, organizationId, deletedAt: null },
    undefined,
    { tenantId: auth.tenantId, organizationId },
  )
  if (!sourceRun) return NextResponse.json({ error: 'Run not found' }, { status: 404 })

  const guardResult = await validateCrudMutationGuard(container, {
    tenantId: auth.tenantId,
    organizationId,
    userId: auth.sub,
    resourceKind: 'agent_orchestrator.agent_run',
    resourceId: sourceRun.agentId,
    operation: 'custom',
    requestMethod: 'POST',
    requestHeaders: req.headers,
  })
  if (guardResult && !guardResult.ok) {
    return NextResponse.json(guardResult.body, { status: guardResult.status })
  }

  const runCtx: AgentRunCtx = {
    tenantId: auth.tenantId,
    organizationId,
    userId: auth.sub,
  }

  const startedAt = new Date()
  try {
    const agentRuntime = container.resolve('agentRuntime') as AgentRuntimeService
    await withRerunOf(sourceRun.id, () => agentRuntime.run(sourceRun.agentId, sourceRun.input, runCtx))
  } catch (err) {
    if (err instanceof AgentNotFoundError) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    }
    // Subclass FIRST: a guardrail block is a policy verdict, not a model bug —
    // the typed reason (kind/phase/set version) must reach the client instead
    // of the generic invalid-output message (data-honesty spec §3.6).
    if (err instanceof AgentGuardrailBlockedError) {
      return NextResponse.json(
        {
          error: 'Blocked by a runtime guardrail',
          code: 'guardrail_blocked',
          kind: err.kind,
          phase: err.phase,
          guardrailSetVersion: err.guardrailSetVersion ?? null,
        },
        { status: 422 },
      )
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
      resourceId: sourceRun.agentId,
      operation: 'custom',
      requestMethod: 'POST',
      requestHeaders: req.headers,
      metadata: guardResult.metadata,
    })
  }

  const newRun = await em.fork().findOne(
    AgentRun,
    {
      rerunOfRunId: sourceRun.id,
      tenantId: auth.tenantId,
      organizationId,
      createdAt: { $gte: startedAt },
    },
    { orderBy: { createdAt: 'desc' } },
  )

  return NextResponse.json({ runId: newRun?.id ?? null })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Agent Orchestrator',
  summary: 'Re-run an agent run',
  methods: {
    POST: {
      summary: 'Execute the run again with its original input',
      description:
        'Runs the same agent with the decrypted original input through the standard execution path (admission control, guardrails, disposition) and links the new run via rerun_of_run_id. Returns the new run id. Org-scoped; gated by agent_orchestrator.agents.run.',
      responses: [{ status: 200, description: 'The new run id', schema: resultSchema }],
      errors: [
        { status: 400, description: 'Tenant context missing, or no single organization is selected', schema: errorSchema },
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 403, description: 'Missing agent_orchestrator.agents.run', schema: errorSchema },
        { status: 404, description: 'Unknown run id, cross-tenant run, or the agent is no longer registered', schema: errorSchema },
        {
          status: 422,
          description:
            'Invalid model output, run wall-clock timeout — or a runtime guardrail block, in which case the body carries `code: "guardrail_blocked"` plus the typed `kind`/`phase`/`guardrailSetVersion` reason',
          schema: z.union([errorSchema, guardrailBlockedErrorSchema]),
        },
        { status: 429, description: 'Agent run capacity exhausted (admission control); includes Retry-After', schema: errorSchema },
      ],
    },
  },
}
