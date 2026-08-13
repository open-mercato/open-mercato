import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { AgentRun, AgentExternalRun } from '../../../../data/entities'
import { getExternalAgentConnector } from '../../../../lib/runtime/externalConnectorRegistry'

/**
 * The EXTERNAL half of one run, for the trace inspector (tracker task 3.4).
 *
 * A native run is fully described by `agent_runs`; an external one is not. The
 * facts an operator needs to read a parked or settled voice call — which
 * connector placed it, the provider's own run id, whether the correlation row is
 * still `pending`, when it gives up, and which workflow step is waiting on it —
 * live on `agent_external_runs`, and NOTHING exposed that row until now. Without
 * it a run that is genuinely waiting for a human to pick up the phone renders as
 * an ordinary `running` run with an empty output and no explanation.
 *
 * WHAT THIS ROUTE DELIBERATELY DOES NOT RETURN, and why it therefore needs no
 * decryption scope at all:
 *
 *   `request_payload`   the brief — it carries the DESTINATION PHONE NUMBER.
 *                       A run detail is a debugging surface, not a contact list,
 *                       and a number rendered here would be copied into
 *                       screenshots, tickets and exports.
 *   `result_payload`    the transcript. It is already reachable, once, through
 *                       the run's own output and the captured transcript
 *                       artifact — both behind this same `trace.view` gate. A
 *                       second decrypted copy on a metadata endpoint buys
 *                       nothing and doubles the surface.
 *   `failure_reason`    `agent_runs.error_message` already carries the operator-
 *                       facing reason and the run detail already renders it.
 *   `callback_token_hash`  a lookup key for the settlement path; nothing to see.
 *
 * The result is a projection of ids, statuses and timestamps only — which is why
 * it uses a plain `em.findOne` rather than `findOneWithDecryption`, and why a
 * reviewer can confirm the PII claim by reading the field list below.
 *
 * `connector.supportsRecording` is a CAPABILITY, not data: it reports whether
 * the connector that placed this run implements `fetchRecording`, so the run
 * detail can offer the recording control only when it would work. A connector
 * that is not registered in this process at all reports `false` rather than
 * 404ing the whole read — the correlation row is still worth showing when a
 * provider package has been undeployed.
 *
 * Org-scoped: the RUN is looked up under the caller's org first, so a run id
 * belonging to another organization returns 404 before its correlation row is
 * touched — the same order `/runs/:id/artifacts` uses, and for the same reason.
 */
export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['agent_orchestrator.trace.view'] },
}

const idSchema = z.string().uuid()

type RouteContext = { params: Promise<{ id: string }> }

const errorSchema = z.object({ error: z.string() })

const externalRunSchema = z.object({
  id: z.string(),
  connectorId: z.string(),
  status: z.string(),
  externalRunId: z.string().nullable(),
  expiresAt: z.string().nullable(),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
  processId: z.string().nullable(),
  stepId: z.string().nullable(),
  signalName: z.string().nullable(),
})

const responseSchema = z.object({
  externalRun: externalRunSchema.nullable(),
  connector: z.object({ id: z.string(), registered: z.boolean(), supportsRecording: z.boolean() }).nullable(),
})

function isoOrNull(value: Date | null | undefined): string | null {
  return value instanceof Date ? value.toISOString() : null
}

export async function GET(req: Request, ctx: RouteContext) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await ctx.params
  const parsedId = idSchema.safeParse(id)
  if (!parsedId.success) return NextResponse.json({ error: 'Run not found' }, { status: 404 })

  const scope = { tenantId: auth.tenantId, organizationId: auth.orgId ?? undefined }
  const container = await createRequestContainer()
  const em = (container.resolve('em') as EntityManager).fork()

  const run = await em.findOne(AgentRun, { id: parsedId.data, ...scope, deletedAt: null }, { fields: ['id'] })
  if (!run) return NextResponse.json({ error: 'Run not found' }, { status: 404 })

  // A missing correlation row is a NORMAL answer, not a 404: a native run has
  // none, and so does an external run whose start failed before the row was
  // written. The client renders nothing rather than an error.
  const externalRun = await em.findOne(
    AgentExternalRun,
    { runId: run.id, ...scope },
    { orderBy: { createdAt: 'desc' } },
  )
  if (!externalRun) return NextResponse.json({ externalRun: null, connector: null })

  const connector = getExternalAgentConnector(externalRun.connectorId)

  return NextResponse.json({
    externalRun: {
      id: externalRun.id,
      connectorId: externalRun.connectorId,
      status: externalRun.status,
      externalRunId: externalRun.externalRunId ?? null,
      expiresAt: isoOrNull(externalRun.expiresAt),
      createdAt: isoOrNull(externalRun.createdAt),
      updatedAt: isoOrNull(externalRun.updatedAt),
      processId: externalRun.processId ?? null,
      stepId: externalRun.stepId ?? null,
      signalName: externalRun.signalName ?? null,
    },
    connector: {
      id: externalRun.connectorId,
      registered: !!connector,
      supportsRecording: typeof connector?.fetchRecording === 'function',
    },
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Agent Orchestrator',
  summary: 'Get an agent run’s external-invocation state',
  methods: {
    GET: {
      summary: 'Get the external correlation row of a run',
      description:
        'Returns the agent_external_runs projection for a run (connector id, provider run id, status, deadline, and the parked workflow triple) plus whether the placing connector is registered in this process and can fetch a recording. Metadata only — the brief (which carries the destination phone number), the transcript and the failure reason are deliberately not exposed here. Returns `{ externalRun: null }` for a run that has no correlation row. Org-scoped; gated by agent_orchestrator.trace.view.',
      responses: [{ status: 200, description: 'External run state', schema: responseSchema }],
      errors: [
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 403, description: 'Missing agent_orchestrator.trace.view', schema: errorSchema },
        { status: 404, description: 'Unknown run id or a run in another organization', schema: errorSchema },
      ],
    },
  },
}
