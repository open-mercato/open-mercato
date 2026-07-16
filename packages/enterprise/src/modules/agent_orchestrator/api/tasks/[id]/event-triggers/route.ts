import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { validateCrudMutationGuard, runCrudMutationGuardAfterSuccess } from '@open-mercato/shared/lib/crud/mutation-guard'
import { AgentTaskDefinition, AgentTaskEventTrigger } from '../../../../data/entities'
import { agentTaskEventTriggerCreateSchema } from '../../../../data/validators'
import { emitAgentOrchestratorEvent } from '../../../../events'

/**
 * Event-trigger sub-resource of a task definition: list + create. The parent
 * task is resolved org-scoped first, so a cross-org parent id 404s before any
 * trigger row is touched.
 */
export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['agent_orchestrator.tasks.view'] },
  POST: { requireAuth: true, requireFeatures: ['agent_orchestrator.tasks.manage'] },
}

const errorSchema = z.object({ error: z.string() })

type RouteContext = { params: Promise<{ id: string }> }

async function resolveParent(req: Request, ctx: RouteContext) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.sub) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const { id } = await ctx.params
  if (!z.string().uuid().safeParse(id).success) {
    return { error: NextResponse.json({ error: 'Task not found' }, { status: 404 }) }
  }
  const container = await createRequestContainer()
  const em = (container.resolve('em') as EntityManager).fork()
  const scope = { tenantId: auth.tenantId, organizationId: auth.orgId ?? undefined }
  const task = await em.findOne(AgentTaskDefinition, { id, ...scope, deletedAt: null })
  if (!task) return { error: NextResponse.json({ error: 'Task not found' }, { status: 404 }) }
  return { auth, container, em, task }
}

export async function GET(req: Request, ctx: RouteContext) {
  const resolved = await resolveParent(req, ctx)
  if ('error' in resolved) return resolved.error
  const { em, task } = resolved
  const items = await em.find(
    AgentTaskEventTrigger,
    { taskDefinitionId: task.id, tenantId: task.tenantId, organizationId: task.organizationId, deletedAt: null },
    { orderBy: { priority: 'desc', createdAt: 'asc' } },
  )
  return NextResponse.json({ items })
}

export async function POST(req: Request, ctx: RouteContext) {
  const resolved = await resolveParent(req, ctx)
  if ('error' in resolved) return resolved.error
  const { auth, container, em, task } = resolved

  const body = await readJsonSafe(req, {})
  const parsed = agentTaskEventTriggerCreateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', fieldErrors: parsed.error.flatten().fieldErrors },
      { status: 400 },
    )
  }

  const guardResult = await validateCrudMutationGuard(container, {
    tenantId: task.tenantId,
    organizationId: task.organizationId,
    userId: auth.sub,
    resourceKind: 'agent_orchestrator.agent_task_event_trigger',
    resourceId: task.id,
    operation: 'create',
    requestMethod: 'POST',
    requestHeaders: req.headers,
  })
  if (guardResult && !guardResult.ok) {
    return NextResponse.json(guardResult.body, { status: guardResult.status })
  }

  const trigger = em.create(AgentTaskEventTrigger, {
    tenantId: task.tenantId,
    organizationId: task.organizationId,
    taskDefinitionId: task.id,
    eventPattern: parsed.data.eventPattern,
    config: parsed.data.config ?? null,
    enabled: parsed.data.enabled ?? true,
    priority: parsed.data.priority ?? 0,
  })
  em.persist(trigger)
  await em.flush()

  await emitAgentOrchestratorEvent('agent_orchestrator.task_event_trigger.created', {
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
      operation: 'create',
      requestMethod: 'POST',
      requestHeaders: req.headers,
      metadata: guardResult.metadata,
    })
  }

  return NextResponse.json({ id: trigger.id }, { status: 201 })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Agent Orchestrator',
  summary: 'Agentic task event triggers',
  methods: {
    GET: {
      summary: 'List event triggers for a task',
      responses: [{ status: 200, description: 'Trigger list' }],
      errors: [
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 404, description: 'Unknown task id', schema: errorSchema },
      ],
    },
    POST: {
      summary: 'Add an event trigger to a task',
      description:
        'Creates a domain-event trigger (eventPattern + WorkflowEventTriggerConfig-shaped config). Gated by agent_orchestrator.tasks.manage.',
      responses: [{ status: 201, description: 'Created trigger id' }],
      errors: [
        { status: 400, description: 'Validation failed', schema: errorSchema },
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 404, description: 'Unknown task id', schema: errorSchema },
      ],
    },
  },
}
