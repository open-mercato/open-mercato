import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { AgentRun, AgentRunArtifact } from '../../../../data/entities'

/**
 * List the file artifacts an OpenCode file-agent produced during a run (file
 * plane, #12). Metadata only — no bytes (download via `/artifacts/file/:id`).
 * Org-scoped and gated by the same feature that gates run-trace reads: a run in
 * another organization returns 404, so org B cannot enumerate org A's artifacts.
 */
export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['agent_orchestrator.trace.view'] },
}

const idSchema = z.string().uuid()

type RouteContext = { params: Promise<{ id: string }> }

const errorSchema = z.object({ error: z.string() })

export async function GET(req: Request, ctx: RouteContext) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await ctx.params
  const parsedId = idSchema.safeParse(id)
  if (!parsedId.success) return NextResponse.json({ error: 'Run not found' }, { status: 404 })

  const scope = { tenantId: auth.tenantId, organizationId: auth.orgId ?? undefined }
  const decryptionScope = { tenantId: auth.tenantId, organizationId: auth.orgId ?? null }
  const container = await createRequestContainer()
  const em = (container.resolve('em') as EntityManager).fork()

  // Confirm the run belongs to the caller's org BEFORE listing its artifacts —
  // otherwise a valid artifact query for a cross-org run id would leak existence.
  const run = await em.findOne(AgentRun, { id: parsedId.data, ...scope, deletedAt: null }, { fields: ['id'] })
  if (!run) return NextResponse.json({ error: 'Run not found' }, { status: 404 })

  const artifacts = await findWithDecryption(
    em,
    AgentRunArtifact,
    { runId: run.id, ...scope, deletedAt: null },
    { orderBy: { createdAt: 'asc' } },
    decryptionScope,
  )

  return NextResponse.json({
    items: artifacts.map((artifact) => ({
      id: artifact.id,
      fileName: artifact.fileName,
      mimeType: artifact.mimeType,
      fileSize: artifact.fileSize,
      sha256: artifact.sha256,
      caption: artifact.caption ?? null,
      source: artifact.source,
      promotedAttachmentId: artifact.promotedAttachmentId ?? null,
      createdAt: artifact.createdAt,
    })),
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Agent Orchestrator',
  summary: 'List agent run file artifacts',
  methods: {
    GET: {
      summary: 'List the files a file-agent produced during a run',
      description:
        'Returns metadata (no bytes) for every captured AgentRunArtifact of the run. Org-scoped; gated by agent_orchestrator.trace.view. Download bytes via /api/agent_orchestrator/artifacts/file/:id.',
      responses: [{ status: 200, description: 'Run artifact list' }],
      errors: [
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 403, description: 'Missing agent_orchestrator.trace.view', schema: errorSchema },
        { status: 404, description: 'Unknown run id', schema: errorSchema },
      ],
    },
  },
}
