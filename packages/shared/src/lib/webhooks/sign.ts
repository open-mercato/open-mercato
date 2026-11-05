import { createHmac, randomBytes } from 'node:crypto'
import { parseWebhookSecret } from './secrets'
import type { StandardWebhookHeaders } from './types'

/**
 * Generate Standard Webhooks signature.
 * signedContent = `${msgId}.${timestamp}.${body}`
 * signature = base64(hmac-sha256(secret, signedContent))
 */
export function signWebhookPayload(
  msgId: string,
  timestamp: number,
  body: string,
  secret: string,
): string {
  const key = parseWebhookSecret(secret)
  const signedContent = `${msgId}.${timestamp}.${body}`
  const signature = createHmac('sha256', key)
    .update(signedContent)
    .digest('base64')
  return `v1,${signature}`
}

/**
 * Build Standard Webhooks headers for a delivery.
 * Supports dual-signing during key rotation.
 */
export function buildWebhookHeaders(
  msgId: string,
  timestamp: number,
  body: string,
  secret: string,
  previousSecret?: string | null,
): StandardWebhookHeaders {
  const signatures: string[] = [signWebhookPayload(msgId, timestamp, body, secret)]
  if (previousSecret) {
    signatures.push(signWebhookPayload(msgId, timestamp, body, previousSecret))
  }
  return {
    'webhook-id': msgId,
    'webhook-timestamp': String(timestamp),
    'webhook-signature': signatures.join(' '),
  }
}

/**
 * Generate a unique message ID for a webhook delivery.
 * Format: msg_{random hex}
 */
export function generateMessageId(): string {
  return `msg_${randomBytes(16).toString('hex')}`
}
