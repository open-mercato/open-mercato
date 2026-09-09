import { parseNumberWithDefault } from '../number'

export const DEFAULT_WEBHOOK_BODY_LIMIT_BYTES = 1024 * 1024

export class WebhookBodyTooLargeError extends Error {
  readonly limitBytes: number

  constructor(limitBytes: number) {
    super(`Webhook body exceeds the ${limitBytes}-byte limit`)
    this.name = 'WebhookBodyTooLargeError'
    this.limitBytes = limitBytes
  }
}

export function resolveWebhookBodyLimitBytes(
  raw = typeof process === 'undefined' ? undefined : process.env.OM_WEBHOOK_MAX_BODY_BYTES,
  fallbackBytes = DEFAULT_WEBHOOK_BODY_LIMIT_BYTES,
): number {
  const fallback = Number.isSafeInteger(fallbackBytes) && fallbackBytes > 0
    ? fallbackBytes
    : DEFAULT_WEBHOOK_BODY_LIMIT_BYTES
  const parsed = parseNumberWithDefault(raw, fallback, { min: 1 })
  return Number.isSafeInteger(parsed) ? parsed : fallback
}

export async function readBoundedRequestBody(
  request: Request,
  options?: { maxBytes?: number },
): Promise<string> {
  const configuredLimit = options?.maxBytes ?? resolveWebhookBodyLimitBytes()
  const maxBytes = Number.isSafeInteger(configuredLimit) && configuredLimit > 0
    ? configuredLimit
    : DEFAULT_WEBHOOK_BODY_LIMIT_BYTES
  const declaredLength = request.headers.get('content-length')?.trim()
  if (declaredLength && /^\d+$/.test(declaredLength)) {
    const declaredBytes = Number(declaredLength)
    if (!Number.isSafeInteger(declaredBytes) || declaredBytes > maxBytes) {
      throw new WebhookBodyTooLargeError(maxBytes)
    }
  }

  if (!request.body) return ''

  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      totalBytes += value.byteLength
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => undefined)
        throw new WebhookBodyTooLargeError(maxBytes)
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  const body = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(body)
}
