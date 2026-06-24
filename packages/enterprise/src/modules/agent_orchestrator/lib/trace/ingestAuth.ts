import { createHmac } from 'node:crypto'
import { deriveJwtAudienceSecret } from '@open-mercato/shared/lib/auth/jwt'
import { parseWebhookSecret } from '@open-mercato/shared/lib/webhooks/secrets'
import { verifyWebhookSignature } from '@open-mercato/shared/lib/webhooks/verify'

/**
 * HMAC authentication for the trace-ingest webhook.
 *
 * The endpoint is machine-to-machine (no user session), so tenant/organization
 * scope is NEVER read from the request body. The caller declares the tenant in a
 * header and signs the body with that tenant's derived secret; we re-derive the
 * secret server-side and verify. An attacker cannot forge a signature for a
 * tenant without `JWT_SECRET`, so a valid signature is proof the caller holds
 * the tenant's secret — the same trust model the inbound carrier/payment
 * webhooks use (scope follows the verified credential, not payload metadata).
 *
 * Signed content + header format follow Standard Webhooks (`msgId.timestamp.body`,
 * `v1,<base64>`); the secret is derived per tenant so the signing key never has
 * to be provisioned out of band.
 */
const TRACE_INGEST_AUDIENCE_PREFIX = 'agent-trace-ingest'

export const TRACE_INGEST_HEADERS = {
  tenant: 'x-om-tenant-id',
  organization: 'x-om-organization-id',
  id: 'webhook-id',
  timestamp: 'webhook-timestamp',
  signature: 'webhook-signature',
} as const

export type TraceIngestPrincipal = { tenantId: string; organizationId: string }

/** Per-tenant signing secret for trace ingestion (derived from `JWT_SECRET`). */
export function traceIngestSecret(tenantId: string): string {
  return deriveJwtAudienceSecret(`${TRACE_INGEST_AUDIENCE_PREFIX}:${tenantId}`)
}

/**
 * Build the `webhook-signature` header value for a trace-ingest request. Shared
 * by runtime adapters and tests so signer and verifier can never drift.
 */
export function signTraceIngest(tenantId: string, msgId: string, timestamp: string, body: string): string {
  const key = parseWebhookSecret(traceIngestSecret(tenantId))
  const signedContent = `${msgId}.${timestamp}.${body}`
  const sig = createHmac('sha256', key).update(signedContent).digest('base64')
  return `v1,${sig}`
}

/**
 * Verify a trace-ingest request and return the tenant/organization scope it is
 * authorized for, or `null` when the signature/headers are missing or invalid.
 */
export function verifyTraceIngestRequest(headers: Headers, rawBody: string): TraceIngestPrincipal | null {
  const tenantId = headers.get(TRACE_INGEST_HEADERS.tenant)
  const organizationId = headers.get(TRACE_INGEST_HEADERS.organization)
  const msgId = headers.get(TRACE_INGEST_HEADERS.id)
  const timestamp = headers.get(TRACE_INGEST_HEADERS.timestamp)
  const signature = headers.get(TRACE_INGEST_HEADERS.signature)
  if (!tenantId || !organizationId || !msgId || !timestamp || !signature) return null

  const result = verifyWebhookSignature(msgId, timestamp, rawBody, signature, [traceIngestSecret(tenantId)])
  if (!result.valid) return null

  return { tenantId, organizationId }
}
