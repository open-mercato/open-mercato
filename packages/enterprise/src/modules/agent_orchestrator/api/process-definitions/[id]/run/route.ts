import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { validateCrudMutationGuard, runCrudMutationGuardAfterSuccess } from '@open-mercato/shared/lib/crud/mutation-guard'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { EntityManager } from '@mikro-orm/postgresql'
import { agentProcessRunRequestSchema } from '../../../../data/validators'
import { AgentProcessDefinition } from '../../../../data/entities'
import { manualTrigger, parseProcessTriggers } from '../../../../lib/tasks/triggers'
import type { EnqueueProcessRunInput, EnqueueProcessRunResult } from '../../../../commands/tasks'

/**
 * Start a process run BY HAND — always async (`202 { processRunId, status:
 * 'running' }`). Callable by a human session or an ApiKey bearer whose role
 * grants `agent_orchestrator.processes.run`, and only when the definition
 * DECLARES a `{ kind: 'manual' }` trigger (403 otherwise): hand-starting is a
 * declared capability rather than an ambient one. Provenance is recorded as
 * `{ kind: 'manual', ref: <userId> }`, while execution always happens under the
 * definition's own execution principal in the queue worker.
 */
export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['agent_orchestrator.processes.run'] },
}

const errorSchema = z.object({ error: z.string() })
const acceptedSchema = z.object({ processRunId: z.string().uuid(), status: z.literal('running') })

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(req: Request, ctx: RouteContext) {
  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!auth.tenantId || !auth.sub) {
    return NextResponse.json({ error: 'Tenant context required' }, { status: 400 })
  }

  const { id } = await ctx.params
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: 'Process definition not found' }, { status: 404 })
  }

  const body = await readJsonSafe(req, {})
  const parsed = agentProcessRunRequestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', fieldErrors: parsed.error.flatten().fieldErrors },
      { status: 400 },
    )
  }

  const container = await createRequestContainer()

  // Fail-closed single-org attribution (same rule as the playground run route):
  // a task run must land in exactly one organization's ledger/caseload.
  const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const organizationId = scope?.selectedId ?? auth.orgId ?? null
  if (!organizationId) {
    return NextResponse.json(
      { error: 'Select a single organization before starting a process run.' },
      { status: 400 },
    )
  }

  // The declared manual trigger is resolved BEFORE the mutation guard so an
  // undeclared hand-start never reaches the command or an approval queue. The
  // command re-checks it — this is the surface that also enforces the trigger's
  // own `requireFeatures`, which only a request-scoped RBAC lookup can answer.
  const em = (container.resolve('em') as EntityManager).fork()
  const definition = await em.findOne(AgentProcessDefinition, {
    id,
    tenantId: auth.tenantId,
    organizationId,
    deletedAt: null,
  })
  if (!definition) return NextResponse.json({ error: 'Process definition not found' }, { status: 404 })
  const manual = manualTrigger(parseProcessTriggers(definition.triggers))
  if (!manual) {
    return NextResponse.json(
      { error: 'This process declares no manual trigger — add one to start it by hand.' },
      { status: 403 },
    )
  }
  if (manual.requireFeatures.length > 0) {
    const rbac = container.resolve('rbacService') as {
      userHasAllFeatures: (
        userId: string,
        features: string[],
        scope: { tenantId: string | null; organizationId: string | null },
      ) => Promise<boolean>
    }
    const allowed = await rbac.userHasAllFeatures(auth.sub, manual.requireFeatures, {
      tenantId: auth.tenantId,
      organizationId,
    })
    if (!allowed) {
      return NextResponse.json(
        { error: 'Missing the features this process requires to be started by hand.' },
        { status: 403 },
      )
    }
  }

  const guardResult = await validateCrudMutationGuard(container, {
    tenantId: auth.tenantId,
    organizationId,
    userId: auth.sub,
    resourceKind: 'agent_orchestrator.agent_process_run',
    resourceId: id,
    operation: 'custom',
    requestMethod: 'POST',
    requestHeaders: req.headers,
  })
  if (guardResult && !guardResult.ok) {
    return NextResponse.json(guardResult.body, { status: guardResult.status })
  }

  const commandBus = container.resolve('commandBus') as CommandBus
  const commandCtx: CommandRuntimeContext = {
    container,
    auth: { sub: auth.sub, tenantId: auth.tenantId, orgId: organizationId } as CommandRuntimeContext['auth'],
    organizationScope: null,
    selectedOrganizationId: organizationId,
    organizationIds: [organizationId],
    request: req,
  }

  // Both a human session and an ApiKey bearer are MANUAL entry — the difference
  // is which principal id the provenance ref carries.
  const triggeredBy = { kind: 'manual' as const, ref: auth.sub }

  let result: EnqueueProcessRunResult
  try {
    const executed = await commandBus.execute<EnqueueProcessRunInput, EnqueueProcessRunResult>(
      'agent_orchestrator.processes.enqueueRun',
      {
        input: {
          tenantId: auth.tenantId,
          organizationId,
          processDefinitionId: id,
          input: parsed.data.input,
          idempotencyKey: parsed.data.idempotencyKey ?? null,
          sourceEntityType: parsed.data.sourceEntityType ?? null,
          sourceEntityId: parsed.data.sourceEntityId ?? null,
          triggeredBy,
        },
        ctx: commandCtx,
      },
    )
    result = executed.result
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    throw err
  }

  if (guardResult?.shouldRunAfterSuccess) {
    await runCrudMutationGuardAfterSuccess(container, {
      tenantId: auth.tenantId,
      organizationId,
      userId: auth.sub,
      resourceKind: 'agent_orchestrator.agent_process_run',
      resourceId: id,
      operation: 'custom',
      requestMethod: 'POST',
      requestHeaders: req.headers,
      metadata: guardResult.metadata,
    })
  }

  return NextResponse.json(
    { processRunId: result.processRunId, status: 'running' as const },
    { status: 202 },
  )
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Agent Orchestrator',
  summary: 'Start a process run',
  methods: {
    POST: {
      summary: 'Start a process run by hand (always async)',
      description:
        'Requires the definition to declare a { kind: "manual" } trigger (403 otherwise) plus any features that trigger names. Validates input against the definition inputSchema when set, dedupes on idempotencyKey, inserts an AgentProcessRun with triggeredBy { kind: "manual", ref: <userId> } and enqueues execution. Returns 202 immediately; observe completion via the process_run.* events or GET /process-runs/:id. Gated by agent_orchestrator.processes.run (session or API key).',
      responses: [{ status: 202, description: 'Run accepted', schema: acceptedSchema }],
      errors: [
        { status: 400, description: 'Validation failed (body or inputSchema)', schema: errorSchema },
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        {
          status: 403,
          description:
            'Missing agent_orchestrator.processes.run, no declared manual trigger, or missing the trigger\'s requireFeatures',
          schema: errorSchema,
        },
        { status: 404, description: 'Unknown process definition id (or cross-tenant)', schema: errorSchema },
        { status: 409, description: 'Process definition disabled', schema: errorSchema },
      ],
    },
  },
}
