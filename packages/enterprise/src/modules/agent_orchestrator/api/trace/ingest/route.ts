import { NextResponse } from 'next/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { readEndpointRateLimitConfig } from '@open-mercato/shared/lib/ratelimit/config'
import { traceIngestSchema } from '../../../data/validators'
import { enforcePublicEndpointRateLimit } from '../../../lib/guardrails/publicEndpointRateLimit'
import { verifyTraceIngestRequest } from '../../../lib/trace/ingestAuth'
import type { IngestTraceCommandInput } from '../../../commands/trace'
import type { IngestTraceResult } from '../../../lib/trace/traceIngestionService'
import { agentOrchestratorTag } from '../../openapi'

/**
 * Trace ingestion webhook (trace-eval overlay). Machine-to-machine: runtime
 * adapters POST a normalized trace, HMAC-signed per tenant. `requireAuth: false`
 * because there is no user session — the verified signature establishes the
 * tenant/org scope (never the body). Idempotent on `(runtime, externalRunId)`.
 *
 * Rate-limited per client IP BEFORE the HMAC check and the write, so an unsigned
 * flood costs neither the verification nor the database round trip. The ceiling is
 * high because legitimate adapters batch traces from a small set of hosts.
 */
export const metadata = {
  POST: { requireAuth: false },
}

const traceIngestRateLimitConfig = readEndpointRateLimitConfig('AGENT_ORCH_TRACE_INGEST', {
  points: 120,
  duration: 60,
  keyPrefix: 'agent_orchestrator:trace_ingest',
})

export async function POST(req: Request) {
  const container = await createRequestContainer()
  const rateLimited = await enforcePublicEndpointRateLimit(container, req, traceIngestRateLimitConfig)
  if (rateLimited) return rateLimited

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
        { status: 429, description: 'Too many ingest requests from this client IP' },
        { status: 503, description: 'Rate limiter unavailable — the request is refused rather than left uncounted' },
      ],
    },
  },
}
