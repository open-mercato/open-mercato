/** Standard Webhooks headers */
export interface StandardWebhookHeaders {
  'webhook-id': string
  'webhook-timestamp': string
  'webhook-signature': string
}

/** Signing key with optional rotation context */
export interface WebhookSigningKey {
  /** Base64 secret without whsec_ prefix */
  secret: string
  /** When this key was created */
  createdAt?: Date
}

/** Result of signature verification */
export interface WebhookVerificationResult {
  valid: boolean
  /** Which key matched (index in the keys array) */
  matchedKeyIndex?: number
}

/** Standard Webhooks payload envelope */
export interface StandardWebhookPayload {
  type: string
  timestamp: string
  data: Record<string, unknown>
}
