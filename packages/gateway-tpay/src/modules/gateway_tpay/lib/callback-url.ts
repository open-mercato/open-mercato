import type { TpayEnvironment } from './tpay-client'
import { tpayHttpError } from './errors'

const SANDBOX_ALLOWED_PORTS = new Set([80, 443, 8080])

function effectivePort(url: URL): number {
  if (url.port) return Number(url.port)
  return url.protocol === 'https:' ? 443 : 80
}

export function isValidTpayNotificationUrl(value: string, environment: TpayEnvironment): boolean {
  if (value.includes('?') || value.includes('#')) return false
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    return false
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash || !parsed.hostname) return false
  if (environment === 'production') {
    return parsed.protocol === 'https:' && effectivePort(parsed) === 443
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false
  return SANDBOX_ALLOWED_PORTS.has(effectivePort(parsed))
}

export async function resolveTpayNotificationUrl(input: {
  credential: unknown
  environment: TpayEnvironment
}): Promise<string | null> {
  if (input.credential === undefined || input.credential === null) return null
  if (typeof input.credential !== 'string') throw await tpayHttpError(422, 'invalidNotificationUrl')
  const value = input.credential.trim()
  if (!value) return null
  if (!isValidTpayNotificationUrl(value, input.environment)) {
    throw await tpayHttpError(422, 'invalidNotificationUrl')
  }
  return value
}
