import type { ServerResponse } from 'node:http'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import type { EntityManager } from '@mikro-orm/postgresql'
import { findApiKeyBySecret } from '@open-mercato/core/modules/api_keys/services/apiKeyService'
import { ApiKeyVerificationRateLimitError } from '@open-mercato/shared/lib/auth/apiKeyVerificationRateLimit'

const logger = createLogger('ai_assistant').child({ component: 'http-api-key-auth' })

export async function authenticateHttpApiKey(em: EntityManager, secret: string, response: ServerResponse) {
  try {
    const record = await findApiKeyBySecret(em, secret)
    if (record) return record
    response.writeHead(401, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({ error: 'Invalid or expired API key' }))
  } catch (error) {
    if (error instanceof ApiKeyVerificationRateLimitError) {
      response.writeHead(429, {
        'Content-Type': 'application/json',
        'Retry-After': String(Math.ceil(error.retryAfterMs / 1000)),
      })
      response.end(JSON.stringify({ error: 'API-key verification is temporarily rate limited' }))
    } else {
      logger.error('MCP API-key verification failed', { err: error })
      try {
        getTelemetryRuntime()?.reportError(error, { module: 'ai_assistant', code: 'ai_assistant.api_key_verification_unavailable' })
      } catch {}
      response.writeHead(503, { 'Content-Type': 'application/json', 'Retry-After': '1' })
      response.end(JSON.stringify({ error: 'Authentication temporarily unavailable' }))
    }
  }
  return null
}
