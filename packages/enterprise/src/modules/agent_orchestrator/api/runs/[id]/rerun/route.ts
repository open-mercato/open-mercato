import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { validateCrudMutationGuard, runCrudMutationGuardAfterSuccess } from '@open-mercato/shared/lib/crud/mutation-guard'
import { AgentRun } from '../../../../data/entities'
import { guardrailKind, guardrailPhase } from '../../../../data/validators'
import {
  AgentGuardrailBlockedError,
  AgentNotFoundError,
  AgentOutputInvalidError,
  AgentRunSuspendedError,
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
 *
 * ─── RE-RUNNING AN EXTERNAL RUN PLACES A SECOND REAL CALL ────────────────────
 *
 * Found by T3.3's caller audit. `agentRuntime.run` reaches the
 * `ExternalAgentRunner` like any other runtime, so pressing a button labelled
 * "Re-run" on a voice run makes a real phone ring, again, at a real person —
 * and, before this route learned about suspensions, then answered HTTP 500,
 * because the suspended outcome surfaced as an unhandled `AgentRunSuspendedError`.
 * The operator saw a failure and had no way to know a call had been placed.
 *
 * The fix is a CONFIRMATION, not a block, and the choice is deliberate:
 *
 *   - BLOCKING would remove the only way to retry a call that failed for a
 *     transient reason, and would be inconsistent with the Playground, which
 *     T3.3 deliberately left dialling because it is the only end-to-end smoke
 *     test a connector has.
 *   - LEAVING IT is the one option ruled out: a real-world side effect must
 *     never be reachable by a control whose label does not mention it.
 *
 * So an external re-run requires `{ "confirmExternalCall": true }` in the body
 * and answers **428 Precondition Required** without it, carrying
 * `code: 'external_call_confirmation_required'` plus the connector-facing facts
 * the client needs to name what it is about to do. 428 rather than 409, because
 * 409 is the module's optimistic-lock status and the client-side conflict
 * helpers key off it — reusing it here would surface a "record changed" bar for
 * something that is not a concurrency problem.
 *
 * The gate keys off the SOURCE RUN's `runtime` column rather than the registry:
 * the row records what actually ran, and it stays truthful for an agent whose
 * package has since been undeployed.
 */
export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['agent_orchestrator.agents.run'] },
}

const errorSchema = z.object({ error: z.string() })
const resultSchema = z.object({ runId: z.string().uuid().nullable() })

const rerunRequestSchema = z.object({
  /**
   * Explicit acknowledgement that re-running THIS run performs the external
   * agent's real-world action again — for the shipped voice connector, dialling
   * a phone number. Ignored for every non-external runtime.
   */
  confirmExternalCall: z.boolean().optional(),
})

/** 428 body: the operator has not yet acknowledged that this places a real external call. */
const confirmationRequiredSchema = errorSchema.extend({
  code: z.literal('external_call_confirmation_required'),
  runtime: z.literal('external'),
  agentId: z.string(),
})

/** 202 body: the re-run started an external run that answers out of band. */
const suspendedSchema = z.object({
  runId: z.string().uuid().nullable(),
  status: z.literal('suspended'),
  externalRunId: z.string().nullable(),
})

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

  // The confirmation gate runs BEFORE the mutation guard and long before the
  // runtime — the whole point is that nothing has happened yet when it refuses.
  if (sourceRun.runtime === 'external') {
    const parsedBody = rerunRequestSchema.safeParse(await readJsonSafe(req, {}))
    if (!parsedBody.success || parsedBody.data.confirmExternalCall !== true) {
      return NextResponse.json(
        {
          error:
            'Re-running this run performs the external agent’s real-world action again. Confirm explicitly with { "confirmExternalCall": true }.',
          code: 'external_call_confirmation_required',
          runtime: 'external',
          agentId: sourceRun.agentId,
        },
        { status: 428 },
      )
    }
  }

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
    // NOT an error. The confirmed re-run genuinely started — the provider
    // accepted the call — and its answer arrives on the callback minutes later.
    // Reporting that as a 500 (the behaviour before this arm) told the operator
    // the opposite of what happened while a phone was already ringing.
    if (err instanceof AgentRunSuspendedError) {
      return NextResponse.json(
        { runId: err.runId, status: 'suspended', externalRunId: err.externalRunId || null },
        { status: 202 },
      )
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
        'Runs the same agent with the decrypted original input through the standard execution path (admission control, guardrails, disposition) and links the new run via rerun_of_run_id. Returns the new run id. Re-running a run whose runtime is `external` repeats the agent’s real-world action (for the voice connector: a phone call), so it requires `{ "confirmExternalCall": true }` in the body and answers 428 without it; once confirmed it answers 202, because an external run has no result yet. Org-scoped; gated by agent_orchestrator.agents.run.',
      requestBody: {
        contentType: 'application/json',
        schema: rerunRequestSchema,
        description: 'Optional; only `confirmExternalCall` is read, and only for an external-runtime run.',
      },
      responses: [
        { status: 200, description: 'The new run id', schema: resultSchema },
        {
          status: 202,
          description:
            'The re-run started an external run that answers out of band — the new run id is returned while the run is still in flight',
          schema: suspendedSchema,
        },
      ],
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
        {
          status: 428,
          description:
            'The source run’s runtime is `external` and the caller has not acknowledged that re-running it places a real external call; the body carries `code: "external_call_confirmation_required"`',
          schema: confirmationRequiredSchema,
        },
        { status: 429, description: 'Agent run capacity exhausted (admission control); includes Retry-After', schema: errorSchema },
      ],
    },
  },
}
