import { timingSafeEqual, createHmac } from 'node:crypto'
import { parseWebhookSecret } from './secrets'
import type { WebhookVerificationResult } from './types'

const TOLERANCE_SECONDS = 5 * 60 // 5 minutes

/**
 * Verify a Standard Webhooks signature against one or more secrets.
 * Returns verification result with which key matched.
 */
export function verifyWebhookSignature(
  msgId: string,
  timestamp: string,
  body: string,
  signatureHeader: string,
  secrets: string[],
  toleranceSeconds: number = TOLERANCE_SECONDS,
): WebhookVerificationResult {
  const timestampNum = parseInt(timestamp, 10)
  if (isNaN(timestampNum)) {
    return { valid: false }
  }

  const now = Math.floor(Date.now() / 1000)
  if (Math.abs(now - timestampNum) > toleranceSeconds) {
    return { valid: false }
  }

  const signedContent = `${msgId}.${timestamp}.${body}`
  const providedSignatures = signatureHeader.split(' ')

  for (let keyIndex = 0; keyIndex < secrets.length; keyIndex++) {
    const key = parseWebhookSecret(secrets[keyIndex])
    const expectedSig = createHmac('sha256', key)
      .update(signedContent)
      .digest('base64')

    for (const sig of providedSignatures) {
      const parts = sig.split(',')
      if (parts.length !== 2 || parts[0] !== 'v1') continue

      const sigBytes = Buffer.from(parts[1], 'base64')
      const expectedBytes = Buffer.from(expectedSig, 'base64')

      if (sigBytes.length !== expectedBytes.length) continue

      if (timingSafeEqual(sigBytes, expectedBytes)) {
        return { valid: true, matchedKeyIndex: keyIndex }
      }
    }
  }

  return { valid: false }
}
