import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { AgentProcessDefinition, AgentTaskEventTrigger } from '../../../data/entities'

/**
 * Process-definition detail for the edit form and detail page: the row (including
 * `updatedAt` for the optimistic-lock header and the audited `grantedFeatures`)
 * plus its event triggers. Org-scoped — cross-org ids 404, never the row.
 */
export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['agent_orchestrator.processes.view'] },
}

const errorSchema = z.object({ error: z.string() })

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(req: Request, ctx: RouteContext) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await ctx.params
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: 'Process definition not found' }, { status: 404 })
  }

  const scope = { tenantId: auth.tenantId, organizationId: auth.orgId ?? undefined }
  const decryptionScope = { tenantId: auth.tenantId, organizationId: auth.orgId ?? null }
  const container = await createRequestContainer()
  const em = (container.resolve('em') as EntityManager).fork()

  const task = await findOneWithDecryption(
    em,
    AgentProcessDefinition,
    { id, ...scope, deletedAt: null },
    undefined,
    decryptionScope,
  )
  if (!task) return NextResponse.json({ error: 'Process definition not found' }, { status: 404 })

  const eventTriggers = await em.find(
    AgentTaskEventTrigger,
    { processDefinitionId: task.id, ...scope, deletedAt: null },
    { orderBy: { priority: 'desc', createdAt: 'asc' } },
  )

  return NextResponse.json({ task, eventTriggers })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Agent Orchestrator',
  summary: 'Get process definition detail',
  methods: {
    GET: {
      summary: 'Get a process definition with its event triggers',
      description:
        'Returns the process definition (including updatedAt for optimistic locking and the audited grantedFeatures) plus its event triggers. Org-scoped; gated by agent_orchestrator.processes.view.',
      responses: [{ status: 200, description: 'Task detail' }],
      errors: [
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 403, description: 'Missing agent_orchestrator.processes.view', schema: errorSchema },
        { status: 404, description: 'Unknown process definition id', schema: errorSchema },
      ],
    },
  },
}
