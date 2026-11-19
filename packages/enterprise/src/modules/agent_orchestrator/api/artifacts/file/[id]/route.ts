import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { AgentRunArtifact } from '../../../../data/entities'
import { getArtifactBytes } from '../../../../lib/runtime/artifactFileStore'

/**
 * Stream one captured artifact's decrypted bytes (file plane, #12). Org-scoped
 * and gated by the same feature that gates run-trace reads: a cross-org artifact
 * id returns 404 (never the bytes). Mirrors the attachments file route's response
 * hardening (`Content-Security-Policy: default-src 'none'; sandbox`, `nosniff`) so
 * an agent-authored HTML/SVG artifact cannot execute in the app origin.
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
  if (!parsedId.success) return NextResponse.json({ error: 'Artifact not found' }, { status: 404 })

  const scope = { tenantId: auth.tenantId, organizationId: auth.orgId ?? undefined }
  const container = await createRequestContainer()
  const em = (container.resolve('em') as EntityManager).fork()

  const artifact = await em.findOne(AgentRunArtifact, { id: parsedId.data, ...scope, deletedAt: null })
  if (!artifact) return NextResponse.json({ error: 'Artifact not found' }, { status: 404 })

  const bytes = await getArtifactBytes(
    container as unknown as { resolve<T = unknown>(name: string): T },
    { tenantId: auth.tenantId, organizationId: auth.orgId ?? '' },
    artifact.storageKey,
  )
  if (!bytes) return NextResponse.json({ error: 'Artifact bytes unavailable' }, { status: 404 })

  const url = new URL(req.url)
  const asDownload = url.searchParams.get('download') === '1'
  const safeName = artifact.fileName.replace(/["\\]/g, '_')
  const headers = new Headers({
    'Content-Type': artifact.mimeType || 'application/octet-stream',
    'Content-Length': String(bytes.length),
    'Content-Disposition': `${asDownload ? 'attachment' : 'inline'}; filename="${safeName}"`,
    // Agent-authored bytes are untrusted: block any active content + sniffing.
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, no-store',
  })
  return new NextResponse(new Uint8Array(bytes), { status: 200, headers })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Agent Orchestrator',
  summary: 'Download an agent run file artifact',
  methods: {
    GET: {
      summary: 'Stream a captured artifact’s decrypted bytes',
      description:
        'Streams the decrypted bytes of one AgentRunArtifact. Org-scoped; gated by agent_orchestrator.trace.view. Pass ?download=1 to force an attachment disposition.',
      responses: [{ status: 200, description: 'Artifact bytes' }],
      errors: [
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 403, description: 'Missing agent_orchestrator.trace.view', schema: errorSchema },
        { status: 404, description: 'Unknown artifact id or bytes unavailable', schema: errorSchema },
      ],
    },
  },
}
