import { parseDecryptedFieldValue } from '@open-mercato/shared/lib/encryption/tenantDataEncryptionService'
import type { GatewayTransaction } from '../data/entities'

export type WebhookLogEntry = NonNullable<GatewayTransaction['webhookLog']>[number]

// The tenant encryption layer encrypts gateway_metadata and webhook_log as JSON-serialized blobs,
// but decryption returns the raw decrypted string (entity fields are never auto-parsed to objects —
// issue #1810). These helpers restore the structured shape consumers expect, mirroring the
// normalization used by messages (resolveMessageActionData) and integrations (normalizeCredentials).
function normalizeDecryptedValue(value: unknown): unknown {
  return typeof value === 'string' ? parseDecryptedFieldValue(value) : value
}

export function readGatewayMetadata(value: unknown): Record<string, unknown> {
  const parsed = normalizeDecryptedValue(value)
  return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {}
}

export function readWebhookLog(value: unknown): WebhookLogEntry[] {
  const parsed = normalizeDecryptedValue(value)
  return Array.isArray(parsed) ? (parsed as WebhookLogEntry[]) : []
}
