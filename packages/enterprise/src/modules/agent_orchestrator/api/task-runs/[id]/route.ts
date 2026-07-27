import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { AgentTaskRun } from '../../../data/entities'

/** What the UI polls (or SSE-refetches) after the async 202 from `/tasks/:id/run`. */
export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['agent_orchestrator.tasks.view'] },
}

const errorSchema = z.object({ error: z.string() })

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(req: Request, ctx: RouteContext) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await ctx.params
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: 'Task run not found' }, { status: 404 })
  }

  const scope = { tenantId: auth.tenantId, organizationId: auth.orgId ?? undefined }
  const decryptionScope = { tenantId: auth.tenantId, organizationId: auth.orgId ?? null }
  const container = await createRequestContainer()
  const em = (container.resolve('em') as EntityManager).fork()

  const taskRun = await findOneWithDecryption(
    em,
    AgentTaskRun,
    { id, ...scope },
    undefined,
    decryptionScope,
  )
  if (!taskRun) return NextResponse.json({ error: 'Task run not found' }, { status: 404 })

  return NextResponse.json({ taskRun })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Agent Orchestrator',
  summary: 'Get agentic task run detail',
  methods: {
    GET: {
      summary: 'Get one agentic task run',
      description:
        'Returns the task-run ledger row (status, target ids, decrypted input, failure reason). Org-scoped; gated by agent_orchestrator.tasks.view.',
      responses: [{ status: 200, description: 'Task run detail' }],
      errors: [
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 403, description: 'Missing agent_orchestrator.tasks.view', schema: errorSchema },
        { status: 404, description: 'Unknown task run id', schema: errorSchema },
      ],
    },
  },
}
