import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { AgentRun, AgentToolCall } from '../../../../data/entities'
import { ARTIFACT_REFS, getArtifact, type ArtifactEncryptionRef } from '../../../../lib/trace/artifactStore'
import { agentOrchestratorTag } from '../../../openapi'

/**
 * On-demand fetch of a full offloaded trace artifact (F1). Large run outputs and
 * tool request/response payloads are stored encrypted in `storage-s3` with only
 * a redacted summary + key on the row; the inspector calls this to retrieve the
 * full value. The requested key MUST belong to the addressed run (validated
 * against the run's own artifact-key columns) so no arbitrary key can be read,
 * and the storage scope is the run's own tenant/org — matching the upload scope.
 */
export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['agent_orchestrator.trace.view'] },
}

const idSchema = z.string().uuid()
const querySchema = z.object({
  key: z.string().min(1).max(500),
  kind: z.enum(['output', 'tool_request', 'tool_response']),
})

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(req: Request, ctx: RouteContext) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await ctx.params
  const parsedId = idSchema.safeParse(id)
  if (!parsedId.success) return NextResponse.json({ error: 'Run not found' }, { status: 404 })

  const url = new URL(req.url)
  const parsedQuery = querySchema.safeParse({ key: url.searchParams.get('key'), kind: url.searchParams.get('kind') })
  if (!parsedQuery.success) {
    return NextResponse.json({ error: 'Invalid artifact request' }, { status: 422 })
  }
  const { key, kind } = parsedQuery.data

  const scope = { tenantId: auth.tenantId, organizationId: auth.orgId ?? undefined }
  const container = await createRequestContainer()
  const em = (container.resolve('em') as EntityManager).fork()

  const run = await em.findOne(AgentRun, { id: parsedId.data, ...scope, deletedAt: null })
  if (!run) return NextResponse.json({ error: 'Run not found' }, { status: 404 })

  // The key must belong to this run's own artifact columns — otherwise a caller
  // could read any tenant key by guessing. `ref` also selects the decryption map.
  let ref: ArtifactEncryptionRef
  if (kind === 'output') {
    if (run.outputArtifactKey !== key) return NextResponse.json({ error: 'Artifact not found' }, { status: 404 })
    ref = ARTIFACT_REFS.runOutput
  } else {
    const where =
      kind === 'tool_request'
        ? { agentRunId: run.id, tenantId: auth.tenantId, requestArtifactKey: key }
        : { agentRunId: run.id, tenantId: auth.tenantId, responseArtifactKey: key }
    const toolCall = await em.findOne(AgentToolCall, where)
    if (!toolCall) return NextResponse.json({ error: 'Artifact not found' }, { status: 404 })
    ref = kind === 'tool_request' ? ARTIFACT_REFS.toolRequest : ARTIFACT_REFS.toolResponse
  }

  // Storage scope is the run's own tenant/org (symmetric with the upload scope).
  const storageScope = { tenantId: run.tenantId, organizationId: run.organizationId }
  const payload = await getArtifact(container, storageScope, ref, key)
  if (payload === null) {
    return NextResponse.json({ error: 'Artifact is currently unavailable' }, { status: 502 })
  }

  return NextResponse.json({ key, kind, payload })
}

export const openApi = {
  tags: [agentOrchestratorTag],
  summary: 'Fetch a full offloaded trace artifact',
  methods: {
    GET: {
      summary: 'Retrieve the full (decrypted) offloaded output or tool payload for a run by storage key',
      tags: [agentOrchestratorTag],
      responses: [
        { status: 200, description: 'Decrypted artifact payload' },
        { status: 404, description: 'Run or artifact key not found for this scope' },
        { status: 422, description: 'Invalid artifact request' },
        { status: 502, description: 'Artifact storage unavailable' },
      ],
    },
  },
}
