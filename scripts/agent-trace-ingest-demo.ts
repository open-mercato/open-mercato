/**
 * Manual test helper for the agent_orchestrator trace-eval overlay.
 *
 * Signs and POSTs a sample agent run trace to the running dev server's
 * HMAC-protected ingest endpoint, reusing the SAME signing helper the server
 * verifies with — so signatures always match as long as this process and the
 * server share the same `JWT_SECRET` (run it from the repo root so it picks up
 * the same env / .env the dev server uses).
 *
 * Usage:
 *   BASE_URL=http://localhost:3000 \
 *   node_modules/.bin/tsx scripts/agent-trace-ingest-demo.ts <AUTH_TOKEN> [agentId] [externalRunId]
 *
 * Get <AUTH_TOKEN> by logging in:
 *   curl -s -X POST "$BASE_URL/api/auth/login" \
 *     -H 'content-type: application/x-www-form-urlencoded' \
 *     --data 'email=admin@example.com&password=...' | jq -r .token
 */
import {
  signTraceIngest,
  TRACE_INGEST_HEADERS,
} from '@open-mercato/enterprise/modules/agent_orchestrator/lib/trace/ingestAuth'

const BASE_URL = (process.env.BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '')

function decodeScope(token: string): { tenantId: string; organizationId: string } {
  const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')) as Record<string, unknown>
  const tenantId = (payload.tenantId ?? payload.tid) as string
  const organizationId = (payload.orgId ?? payload.organizationId ?? payload.oid) as string
  if (!tenantId || !organizationId) throw new Error('Token has no tenantId/orgId claim — pass a real login token')
  return { tenantId, organizationId }
}

async function main(): Promise<void> {
  const token = process.argv[2]
  if (!token) throw new Error('Pass an auth token as the first argument (see header comment).')
  const agentId = process.argv[3] ?? 'deals.health_check'
  const externalRunId = process.argv[4] ?? `manual-${Date.now()}`
  const { tenantId, organizationId } = decodeScope(token)

  const now = new Date().toISOString()
  const body = JSON.stringify({
    runtime: 'manual',
    externalRunId,
    agentId,
    status: 'ok',
    confidence: 0.92,
    latencyMs: 1234,
    output: { kind: 'informative', data: { summary: 'manual trace demo' } },
    spans: [
      {
        externalSpanId: 'root',
        sequence: 0,
        name: 'root',
        kind: 'system',
        startedAt: now,
        toolCalls: [{ toolName: 'load_skill', status: 'ok' }],
      },
      { externalSpanId: 'child', parentExternalSpanId: 'root', sequence: 1, name: 'llm-call', kind: 'llm', startedAt: now },
    ],
  })

  const msgId = `m-${Date.now()}`
  const timestamp = String(Math.floor(Date.now() / 1000))
  const signature = signTraceIngest(tenantId, msgId, timestamp, body)

  const response = await fetch(`${BASE_URL}/api/agent_orchestrator/trace/ingest`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [TRACE_INGEST_HEADERS.tenant]: tenantId,
      [TRACE_INGEST_HEADERS.organization]: organizationId,
      [TRACE_INGEST_HEADERS.id]: msgId,
      [TRACE_INGEST_HEADERS.timestamp]: timestamp,
      [TRACE_INGEST_HEADERS.signature]: signature,
    },
    body,
  })
  console.log('POST /trace/ingest →', response.status)
  console.log(await response.text())
  console.log(`\nexternalRunId = ${externalRunId}`)
  console.log(`Now query: GET ${BASE_URL}/api/agent_orchestrator/runs?window=24h`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
