import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { AgentProcess } from '../../../data/entities'

/**
 * Process-detail header read (spec 2026-06-25): the single `AgentProcess`
 * projection row. `:id` accepts EITHER the workflow instance id (`processId` —
 * what runs/proposals and the trace inspector's "Open process" carry) OR the
 * projection row's own id. Org-scoped — cross-org ids return 404, never the row.
 * `subject_title` decrypts via findOneWithDecryption. The detail page composes
 * this with the existing `GET /proposals?processId=…` + `GET /runs/:id` reads
 * for the timeline.
 */
export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['agent_orchestrator.processes.view'] },
}

const idSchema = z.string().uuid()

type RouteContext = { params: Promise<{ id: string }> }

const errorSchema = z.object({ error: z.string() })

export async function GET(req: Request, ctx: RouteContext) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await ctx.params
  const parsedId = idSchema.safeParse(id)
  if (!parsedId.success) return NextResponse.json({ error: 'Process not found' }, { status: 404 })

  const scope = { tenantId: auth.tenantId, organizationId: auth.orgId ?? undefined }
  const decryptionScope = { tenantId: auth.tenantId, organizationId: auth.orgId ?? null }
  const container = await createRequestContainer()
  const em = (container.resolve('em') as EntityManager).fork()

  const byProcessId = await findOneWithDecryption(
    em,
    AgentProcess,
    { processId: parsedId.data, ...scope, deletedAt: null },
    undefined,
    decryptionScope,
  )
  const process =
    byProcessId ??
    (await findOneWithDecryption(
      em,
      AgentProcess,
      { id: parsedId.data, ...scope, deletedAt: null },
      undefined,
      decryptionScope,
    ))
  if (!process) return NextResponse.json({ error: 'Process not found' }, { status: 404 })

  return NextResponse.json({ process })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Agent Orchestrator',
  summary: 'Get an agent process projection row',
  methods: {
    GET: {
      summary: 'Get the process-detail header projection',
      description:
        'Returns the AgentProcess read-model row for a workflow process. Accepts the workflow instance id (processId) or the projection row id. Org-scoped; gated by agent_orchestrator.processes.view.',
      responses: [{ status: 200, description: 'Process projection row' }],
      errors: [
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 403, description: 'Missing agent_orchestrator.processes.view', schema: errorSchema },
        { status: 404, description: 'Unknown process id', schema: errorSchema },
      ],
    },
  },
}
