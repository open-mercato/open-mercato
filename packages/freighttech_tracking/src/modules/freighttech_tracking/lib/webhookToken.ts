import * as crypto from 'crypto'

/**
 * Encodes organizationId and tenantId into a secure, opaque token for webhook callbacks.
 * The token is signed with HMAC to prevent tampering.
 */
export function encodeWebhookToken(params: {
  organizationId: string
  tenantId: string
}): string {
  const secret = getWebhookSecret()

  // Create a payload with the IDs
  const payload = JSON.stringify({
    organizationId: params.organizationId,
    tenantId: params.tenantId,
    iat: Math.floor(Date.now() / 1000), // issued at timestamp
  })

  // Base64url encode the payload
  const encodedPayload = Buffer.from(payload)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '')

  // Create HMAC signature
  const signature = crypto
    .createHmac('sha256', secret)
    .update(encodedPayload)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '')

  // Return token as payload.signature
  return `${encodedPayload}.${signature}`
}

/**
 * Decodes and validates a webhook token.
 * Returns null if the token is invalid or tampered with.
 */
export function decodeWebhookToken(token: string): {
  organizationId: string
  tenantId: string
} | null {
  try {
    const secret = getWebhookSecret()
    const [encodedPayload, signature] = token.split('.')

    if (!encodedPayload || !signature) {
      console.warn('[webhookToken] Invalid token format')
      return null
    }

    // Verify signature
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(encodedPayload)
      .digest('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '')

    // Normalize buffer lengths before comparison
    const sigBuffer = Buffer.from(signature)
    const expectedBuffer = Buffer.from(expectedSignature)

    if (sigBuffer.length !== expectedBuffer.length) {
      console.warn('[webhookToken] Invalid signature length')
      return null
    }

    // Use timing-safe comparison to prevent timing attacks
    if (!crypto.timingSafeEqual(sigBuffer, expectedBuffer)) {
      console.warn('[webhookToken] Invalid signature')
      return null
    }

    // Decode payload
    const payload = JSON.parse(
      Buffer.from(
        encodedPayload.replace(/-/g, '+').replace(/_/g, '/'),
        'base64'
      ).toString()
    )

    if (!payload.organizationId || !payload.tenantId) {
      console.warn('[webhookToken] Missing required fields in payload')
      return null
    }

    // Optional: Check token age (e.g., tokens expire after 1 year)
    const maxAge = 365 * 24 * 60 * 60 // 1 year in seconds
    const now = Math.floor(Date.now() / 1000)
    if (payload.iat && (now - payload.iat) > maxAge) {
      console.warn('[webhookToken] Token expired')
      return null
    }

    return {
      organizationId: payload.organizationId,
      tenantId: payload.tenantId,
    }
  } catch (err) {
    console.error('[webhookToken] Error decoding token:', err)
    return null
  }
}

/**
 * Gets the webhook signing secret from environment variables.
 * Falls back to a default for development, but requires explicit configuration in production.
 */
function getWebhookSecret(): string {
  const secret = process.env.JWT_SECRET
  if (!secret) throw new Error('JWT_SECRET is not set')
  return secret
}
