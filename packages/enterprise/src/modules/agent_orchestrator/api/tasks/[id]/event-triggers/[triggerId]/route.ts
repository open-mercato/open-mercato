import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { validateCrudMutationGuard, runCrudMutationGuardAfterSuccess } from '@open-mercato/shared/lib/crud/mutation-guard'
import { enforceCommandOptimisticLock } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { AgentTaskDefinition, AgentTaskEventTrigger } from '../../../../../data/entities'
import { agentTaskEventTriggerUpdateSchema } from '../../../../../data/validators'
import { emitAgentOrchestratorEvent } from '../../../../../events'

/**
 * Update/delete one event trigger. Optimistic-locked on the trigger's own
 * `updatedAt` (header or typed `updatedAt` body field) — the trigger is its own
 * aggregate here, not a child of the task form, so the parent's version header
 * must not be reused (root AGENTS.md child-override rule).
 */
export const metadata = {
  PUT: { requireAuth: true, requireFeatures: ['agent_orchestrator.tasks.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['agent_orchestrator.tasks.manage'] },
}

const errorSchema = z.object({ error: z.string() })

type RouteContext = { params: Promise<{ id: string; triggerId: string }> }

async function resolveTrigger(req: Request, ctx: RouteContext) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.sub) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const { id, triggerId } = await ctx.params
  if (!z.string().uuid().safeParse(id).success || !z.string().uuid().safeParse(triggerId).success) {
    return { error: NextResponse.json({ error: 'Trigger not found' }, { status: 404 }) }
  }
  const container = await createRequestContainer()
  const em = (container.resolve('em') as EntityManager).fork()
  const scope = { tenantId: auth.tenantId, organizationId: auth.orgId ?? undefined }
  const task = await em.findOne(AgentTaskDefinition, { id, ...scope, deletedAt: null })
  if (!task) return { error: NextResponse.json({ error: 'Trigger not found' }, { status: 404 }) }
  const trigger = await em.findOne(AgentTaskEventTrigger, {
    id: triggerId,
    taskDefinitionId: task.id,
    tenantId: task.tenantId,
    organizationId: task.organizationId,
    deletedAt: null,
  })
  if (!trigger) return { error: NextResponse.json({ error: 'Trigger not found' }, { status: 404 }) }
  return { auth, container, em, task, trigger }
}

type GuardOperation = 'update' | 'delete'

async function runGuards(
  resolved: { auth: { tenantId: string | null; sub: string }; container: Awaited<ReturnType<typeof createRequestContainer>>; task: AgentTaskDefinition; trigger: AgentTaskEventTrigger },
  req: Request,
  operation: GuardOperation,
) {
  return validateCrudMutationGuard(resolved.container, {
    tenantId: resolved.task.tenantId,
    organizationId: resolved.task.organizationId,
    userId: resolved.auth.sub,
    resourceKind: 'agent_orchestrator.agent_task_event_trigger',
    resourceId: resolved.trigger.id,
    operation,
    requestMethod: req.method,
    requestHeaders: req.headers,
  })
}

export async function PUT(req: Request, ctx: RouteContext) {
  const resolved = await resolveTrigger(req, ctx)
  if ('error' in resolved) return resolved.error
  const { auth, container, em, task, trigger } = resolved

  const body = await readJsonSafe(req, {})
  const parsed = agentTaskEventTriggerUpdateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', fieldErrors: parsed.error.flatten().fieldErrors },
      { status: 400 },
    )
  }

  try {
    enforceCommandOptimisticLock({
      resourceKind: 'agent_orchestrator.agent_task_event_trigger',
      resourceId: trigger.id,
      current: trigger.updatedAt,
      expected: parsed.data.updatedAt ?? undefined,
      request: req,
    })
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    throw err
  }

  const guardResult = await runGuards(resolved, req, 'update')
  if (guardResult && !guardResult.ok) {
    return NextResponse.json(guardResult.body, { status: guardResult.status })
  }

  if (parsed.data.eventPattern !== undefined) trigger.eventPattern = parsed.data.eventPattern
  if (parsed.data.config !== undefined) trigger.config = parsed.data.config ?? null
  if (parsed.data.enabled !== undefined) trigger.enabled = parsed.data.enabled
  if (parsed.data.priority !== undefined) trigger.priority = parsed.data.priority
  await em.flush()

  await emitAgentOrchestratorEvent('agent_orchestrator.task_event_trigger.updated', {
    id: trigger.id,
    taskDefinitionId: task.id,
    eventPattern: trigger.eventPattern,
    tenantId: task.tenantId,
    organizationId: task.organizationId,
  }, { persistent: true })

  if (guardResult?.shouldRunAfterSuccess) {
    await runCrudMutationGuardAfterSuccess(container, {
      tenantId: task.tenantId,
      organizationId: task.organizationId,
      userId: auth.sub,
      resourceKind: 'agent_orchestrator.agent_task_event_trigger',
      resourceId: trigger.id,
      operation: 'update',
      requestMethod: req.method,
      requestHeaders: req.headers,
      metadata: guardResult.metadata,
    })
  }

  return NextResponse.json({
    ok: true,
    updatedAt: trigger.updatedAt instanceof Date ? trigger.updatedAt.toISOString() : null,
  })
}

export async function DELETE(req: Request, ctx: RouteContext) {
  const resolved = await resolveTrigger(req, ctx)
  if ('error' in resolved) return resolved.error
  const { auth, container, em, task, trigger } = resolved

  try {
    enforceCommandOptimisticLock({
      resourceKind: 'agent_orchestrator.agent_task_event_trigger',
      resourceId: trigger.id,
      current: trigger.updatedAt,
      request: req,
    })
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    throw err
  }

  const guardResult = await runGuards(resolved, req, 'delete')
  if (guardResult && !guardResult.ok) {
    return NextResponse.json(guardResult.body, { status: guardResult.status })
  }

  trigger.deletedAt = new Date()
  await em.flush()

  await emitAgentOrchestratorEvent('agent_orchestrator.task_event_trigger.deleted', {
    id: trigger.id,
    taskDefinitionId: task.id,
    tenantId: task.tenantId,
    organizationId: task.organizationId,
  }, { persistent: true })

  if (guardResult?.shouldRunAfterSuccess) {
    await runCrudMutationGuardAfterSuccess(container, {
      tenantId: task.tenantId,
      organizationId: task.organizationId,
      userId: auth.sub,
      resourceKind: 'agent_orchestrator.agent_task_event_trigger',
      resourceId: trigger.id,
      operation: 'delete',
      requestMethod: req.method,
      requestHeaders: req.headers,
      metadata: guardResult.metadata,
    })
  }

  return NextResponse.json({ ok: true })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Agent Orchestrator',
  summary: 'Manage one agentic task event trigger',
  methods: {
    PUT: {
      summary: 'Update an event trigger (optimistic-locked)',
      responses: [{ status: 200, description: 'Updated' }],
      errors: [
        { status: 400, description: 'Validation failed', schema: errorSchema },
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 404, description: 'Unknown trigger', schema: errorSchema },
        { status: 409, description: 'Version conflict', schema: errorSchema },
      ],
    },
    DELETE: {
      summary: 'Soft-delete an event trigger',
      responses: [{ status: 200, description: 'Deleted' }],
      errors: [
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 404, description: 'Unknown trigger', schema: errorSchema },
        { status: 409, description: 'Version conflict', schema: errorSchema },
      ],
    },
  },
}
