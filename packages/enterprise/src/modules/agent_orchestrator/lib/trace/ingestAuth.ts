import { createHmac } from 'node:crypto'
import { z } from 'zod'
import { deriveJwtAudienceSecret } from '@open-mercato/shared/lib/auth/jwt'
import { parseWebhookSecret } from '@open-mercato/shared/lib/webhooks/secrets'
import { verifyWebhookSignature } from '@open-mercato/shared/lib/webhooks/verify'

const TRACE_INGEST_AUDIENCE = 'agent-trace-ingest:v2'
const scopeId = z.string().uuid()

export const TRACE_INGEST_HEADERS = {
  tenant: 'x-om-tenant-id',
  organization: 'x-om-organization-id',
  id: 'webhook-id',
  timestamp: 'webhook-timestamp',
  signature: 'webhook-signature',
} as const

export type TraceIngestPrincipal = { tenantId: string; organizationId: string }

/** Derive one signing key per tenant and organization from the deployment key. */
export function traceIngestSecret(tenantId: string, organizationId: string): string {
  const rootKey = deriveJwtAudienceSecret(TRACE_INGEST_AUDIENCE)
  const key = createHmac('sha256', rootKey)
    .update(JSON.stringify([tenantId.toLowerCase(), organizationId.toLowerCase()]))
    .digest('base64')
  return `whsec_${key}`
}

/** Build the Standard Webhooks signature for a trace-ingest request. */
export function signTraceIngest(
  tenantId: string,
  organizationId: string,
  msgId: string,
  timestamp: string,
  body: string,
): string {
  const key = parseWebhookSecret(traceIngestSecret(tenantId, organizationId))
  const signature = createHmac('sha256', key).update(`${msgId}.${timestamp}.${body}`).digest('base64')
  return `v1,${signature}`
}

/** Return the scope authenticated by the signing key. */
export function verifyTraceIngestRequest(headers: Headers, rawBody: string): TraceIngestPrincipal | null {
  const tenantId = scopeId.safeParse(headers.get(TRACE_INGEST_HEADERS.tenant)?.toLowerCase())
  const organizationId = scopeId.safeParse(headers.get(TRACE_INGEST_HEADERS.organization)?.toLowerCase())
  const msgId = headers.get(TRACE_INGEST_HEADERS.id)
  const timestamp = headers.get(TRACE_INGEST_HEADERS.timestamp)
  const signature = headers.get(TRACE_INGEST_HEADERS.signature)
  if (!tenantId.success || !organizationId.success || !msgId || !timestamp || !signature) return null

  const result = verifyWebhookSignature(
    msgId, timestamp, rawBody, signature, [traceIngestSecret(tenantId.data, organizationId.data)],
  )
  return result.valid ? { tenantId: tenantId.data, organizationId: organizationId.data } : null
}
