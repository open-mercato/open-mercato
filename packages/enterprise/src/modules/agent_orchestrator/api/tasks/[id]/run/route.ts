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
import { agentTaskRunRequestSchema } from '../../../../data/validators'
import type { EnqueueTaskRunInput, EnqueueTaskRunResult } from '../../../../commands/tasks'

/**
 * Run an agentic task — always async (`202 { taskRunId, status: 'running' }`)
 * for every trigger source. Callable by a human session or an ApiKey bearer
 * whose role grants `agent_orchestrator.tasks.run`; provenance is recorded as
 * `user:<id>` / `api_key:<id>` on the AgentTaskRun, while execution always
 * happens under the task's own execution principal in the queue worker.
 */
export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['agent_orchestrator.tasks.run'] },
}

const errorSchema = z.object({ error: z.string() })
const acceptedSchema = z.object({ taskRunId: z.string().uuid(), status: z.literal('running') })

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(req: Request, ctx: RouteContext) {
  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!auth.tenantId || !auth.sub) {
    return NextResponse.json({ error: 'Tenant context required' }, { status: 400 })
  }

  const { id } = await ctx.params
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: 'Task not found' }, { status: 404 })
  }

  const body = await readJsonSafe(req, {})
  const parsed = agentTaskRunRequestSchema.safeParse(body)
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
      { error: 'Select a single organization before running a task.' },
      { status: 400 },
    )
  }

  const guardResult = await validateCrudMutationGuard(container, {
    tenantId: auth.tenantId,
    organizationId,
    userId: auth.sub,
    resourceKind: 'agent_orchestrator.agent_task_run',
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

  // ApiKey principals already arrive as `api_key:<id>`; humans get `user:<id>`.
  const triggeredBy = auth.isApiKey ? auth.sub : `user:${auth.sub}`

  let result: EnqueueTaskRunResult
  try {
    const executed = await commandBus.execute<EnqueueTaskRunInput, EnqueueTaskRunResult>(
      'agent_orchestrator.tasks.enqueueRun',
      {
        input: {
          tenantId: auth.tenantId,
          organizationId,
          taskDefinitionId: id,
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
      resourceKind: 'agent_orchestrator.agent_task_run',
      resourceId: id,
      operation: 'custom',
      requestMethod: 'POST',
      requestHeaders: req.headers,
      metadata: guardResult.metadata,
    })
  }

  return NextResponse.json(
    { taskRunId: result.taskRunId, status: 'running' as const },
    { status: 202 },
  )
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Agent Orchestrator',
  summary: 'Run an agentic task',
  methods: {
    POST: {
      summary: 'Trigger an agentic task run (always async)',
      description:
        'Validates input against the task inputSchema when set, dedupes on idempotencyKey, inserts an AgentTaskRun and enqueues execution. Returns 202 immediately; observe completion via the task_run.* events or GET /task-runs/:id. Gated by agent_orchestrator.tasks.run (session or API key).',
      responses: [{ status: 202, description: 'Run accepted', schema: acceptedSchema }],
      errors: [
        { status: 400, description: 'Validation failed (body or inputSchema)', schema: errorSchema },
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 403, description: 'Missing agent_orchestrator.tasks.run', schema: errorSchema },
        { status: 404, description: 'Unknown task id (or cross-tenant)', schema: errorSchema },
        { status: 409, description: 'Task disabled', schema: errorSchema },
      ],
    },
  },
}
