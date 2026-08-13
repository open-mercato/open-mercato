import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { AgentRun, AgentExternalRun } from '../../../../data/entities'
import { getExternalAgentConnector } from '../../../../lib/runtime/externalConnectorRegistry'

/**
 * Stream the PROVIDER's recording of one external run, on demand (task 3.4).
 *
 * ─── WHAT MAKES THIS DIFFERENT FROM EVERY OTHER DOWNLOAD IN THE MODULE ───────
 *
 * `/artifacts/file/:id` serves bytes THIS platform stored. This route serves
 * bytes it does not have and will not keep: it asks the connector for a stream
 * and pipes that stream to the operator. Nothing is buffered into a Buffer,
 * nothing is written to `storage-s3`, and no `AgentRunArtifact` row is created —
 * which is the whole point, and is asserted by test rather than left to
 * good intentions.
 *
 * The reason is T3.1's: a transcript is text about a person and is captured as
 * an artifact; a recording is that person's VOICE. Storing it would make this
 * deployment a second controller of biometric-grade material, doubling the
 * erasure surface for content no downstream consumer reads, in a module with no
 * artifact retention sweeper. The provider is already the controller and already
 * retains it, so the platform brokers access instead of taking custody.
 *
 * ─── GATE ────────────────────────────────────────────────────────────────────
 *
 * `trace.view`, the same feature that gates the transcript artifact and the run
 * detail this control is rendered on. Deliberately NOT
 * `external_agents.invoke`: that grant authorises PLACING an outbound call, a
 * far more consequential act than reading one that already happened, and reusing
 * it here would force operators who only review calls to hold the grant that
 * lets them make them.
 *
 * ─── STATUS CODES ────────────────────────────────────────────────────────────
 *
 *   404  unknown/cross-org run, no correlation row, no provider run id, the
 *        connector cannot fetch recordings, or the provider has none. Each is
 *        "there is nothing to play", and none reveals which.
 *   503  the connector's package is not deployed in this process — the run is
 *        fine, this deployment simply cannot reach the provider right now. Same
 *        distinction the token callback route draws for a missing connector.
 *   502  the connector threw. A genuine integration fault, reported as one
 *        rather than disguised as an empty recording.
 */
export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['agent_orchestrator.trace.view'] },
}

const logger = createLogger('agent_orchestrator').child({ component: 'external-run-recording' })

const idSchema = z.string().uuid()

type RouteContext = { params: Promise<{ id: string }> }

const errorSchema = z.object({ error: z.string() })

export async function GET(req: Request, ctx: RouteContext) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await ctx.params
  const parsedId = idSchema.safeParse(id)
  if (!parsedId.success) return NextResponse.json({ error: 'Recording not found' }, { status: 404 })

  const scope = { tenantId: auth.tenantId, organizationId: auth.orgId ?? undefined }
  const container = await createRequestContainer()
  const em = (container.resolve('em') as EntityManager).fork()

  // The run is checked under the caller's org FIRST, so a cross-org run id can
  // never reach a provider call — the recording would come back correctly
  // authenticated to the wrong tenant's operator.
  const run = await em.findOne(AgentRun, { id: parsedId.data, ...scope, deletedAt: null }, { fields: ['id'] })
  if (!run) return NextResponse.json({ error: 'Recording not found' }, { status: 404 })

  const externalRun = await em.findOne(
    AgentExternalRun,
    { runId: run.id, ...scope },
    { orderBy: { createdAt: 'desc' } },
  )
  if (!externalRun?.externalRunId) {
    return NextResponse.json({ error: 'Recording not found' }, { status: 404 })
  }

  const connector = getExternalAgentConnector(externalRun.connectorId)
  if (!connector) {
    return NextResponse.json({ error: 'The connector that placed this run is not available' }, { status: 503 })
  }
  if (typeof connector.fetchRecording !== 'function') {
    return NextResponse.json({ error: 'Recording not found' }, { status: 404 })
  }

  // Tenancy comes from the ROW, never from the request: the connector
  // authenticates with the credentials of whichever tenant actually placed the
  // call, and that is the row's tenant.
  const connectorScope = {
    tenantId: externalRun.tenantId,
    organizationId: externalRun.organizationId,
    container: container as unknown as { resolve: (name: string) => unknown },
  }

  let recording
  try {
    recording = await connector.fetchRecording(externalRun.externalRunId, connectorScope)
  } catch (err) {
    // The provider id and the error are worth a log line; the audio is not
    // touched and nothing about the caller is recorded.
    logger.error('fetching an external run recording failed', {
      runId: run.id,
      connectorId: externalRun.connectorId,
      error: err instanceof Error ? err.message : String(err),
    })
    return NextResponse.json({ error: 'The provider could not be reached for this recording' }, { status: 502 })
  }
  if (!recording) return NextResponse.json({ error: 'Recording not found' }, { status: 404 })

  const safeName = (recording.fileName ?? `external-run-${run.id}-recording`).replace(/["\\]/g, '_')
  const headers = new Headers({
    'Content-Type': recording.mimeType || 'application/octet-stream',
    'Content-Disposition': `attachment; filename="${safeName}"`,
    // Provider-supplied bytes are untrusted, exactly like agent-authored ones:
    // block active content and sniffing (the `/artifacts/file/:id` hardening).
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'X-Content-Type-Options': 'nosniff',
    // `no-store` is not merely hygiene here: the promise is that this
    // deployment keeps no copy, and a cached response is a copy.
    'Cache-Control': 'private, no-store',
  })
  if (recording.contentLength != null) headers.set('Content-Length', String(recording.contentLength))

  // The stream is passed through UNREAD. Reading it here to measure, hash or
  // store it would break the one guarantee this route makes.
  return new NextResponse(recording.stream, { status: 200, headers })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Agent Orchestrator',
  summary: 'Stream an external run’s provider-held recording',
  methods: {
    GET: {
      summary: 'Fetch the recording of an external run from its provider, on demand',
      description:
        'Asks the connector that placed the run for its provider-held recording and streams it straight through. The bytes are never stored, cached or captured as an artifact — the provider remains the sole controller of the recording. Org-scoped; gated by agent_orchestrator.trace.view.',
      responses: [{ status: 200, description: 'The recording bytes, streamed from the provider' }],
      errors: [
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 403, description: 'Missing agent_orchestrator.trace.view', schema: errorSchema },
        {
          status: 404,
          description:
            'Unknown run, a run in another organization, a run with no external correlation row or provider run id, a connector that cannot fetch recordings, or a provider that has no recording for this run',
          schema: errorSchema,
        },
        { status: 502, description: 'The connector failed while reaching the provider', schema: errorSchema },
        { status: 503, description: 'The connector package is not deployed in this process', schema: errorSchema },
      ],
    },
  },
}
