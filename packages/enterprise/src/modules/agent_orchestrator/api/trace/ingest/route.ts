import { NextResponse } from 'next/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { traceIngestSchema } from '../../../data/validators'
import { verifyTraceIngestRequest } from '../../../lib/trace/ingestAuth'
import type { IngestTraceCommandInput } from '../../../commands/trace'
import type { IngestTraceResult } from '../../../lib/trace/traceIngestionService'
import { agentOrchestratorTag } from '../../openapi'

/**
 * Trace ingestion webhook (trace-eval overlay). Machine-to-machine: runtime
 * adapters POST a normalized trace, HMAC-signed per tenant. `requireAuth: false`
 * because there is no user session — the verified signature establishes the
 * tenant/org scope (never the body). Idempotent on `(runtime, externalRunId)`.
 */
export const metadata = {
  POST: { requireAuth: false },
}

export async function POST(req: Request) {
  const rawBody = await req.text()

  const principal = verifyTraceIngestRequest(req.headers, rawBody)
  if (!principal) {
    return NextResponse.json({ error: 'Trace ingest verification failed' }, { status: 401 })
  }

  let body: unknown
  try {
    body = rawBody ? JSON.parse(rawBody) : {}
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = traceIngestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid trace payload', details: parsed.error.flatten() }, { status: 422 })
  }

  const container = await createRequestContainer()
  const commandBus = container.resolve('commandBus') as CommandBus
  const ctx: CommandRuntimeContext = {
    container,
    auth: null,
    organizationScope: null,
    selectedOrganizationId: principal.organizationId,
    organizationIds: [principal.organizationId],
    request: req,
    systemActor: true,
  }

  const { result } = await commandBus.execute<IngestTraceCommandInput, IngestTraceResult>(
    'agent_orchestrator.trace.ingest',
    {
      input: {
        tenantId: principal.tenantId,
        organizationId: principal.organizationId,
        payload: parsed.data,
      },
      ctx,
    },
  )

  return NextResponse.json({ ok: true, ...result }, { status: 202 })
}

export const openApi = {
  tags: [agentOrchestratorTag],
  summary: 'Ingest an agent run trace',
  methods: {
    POST: {
      summary: 'Ingest a normalized, HMAC-signed agent run trace (idempotent by runtime + externalRunId)',
      tags: [agentOrchestratorTag],
      responses: [
        { status: 202, description: 'Trace accepted (run upserted, spans/tool-calls appended)' },
        { status: 401, description: 'HMAC signature verification failed' },
        { status: 422, description: 'Invalid trace payload' },
      ],
    },
  },
}
