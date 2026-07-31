import { createLogger } from '@open-mercato/shared/lib/logger'
import { getWebhookEndpointAdapter } from '../lib/adapter-registry'

const logger = createLogger('webhooks').child({ component: 'inbound' })

export const metadata = {
  event: 'webhooks.inbound.received',
  persistent: true,
  id: 'webhooks:inbound-process',
}

export default async function handler(payload: Record<string, unknown>) {
  const providerKey = typeof payload.providerKey === 'string' ? payload.providerKey : null
  const eventType = typeof payload.eventType === 'string' ? payload.eventType : null
  const verifiedPayload = isRecord(payload.payload) ? payload.payload : null

  if (!providerKey || !eventType || !verifiedPayload) {
    return
  }

  const adapter = getWebhookEndpointAdapter(providerKey)
  if (!adapter) {
    throw new Error(`Webhook endpoint adapter "${providerKey}" is not registered`)
  }

  try {
    await adapter.processInbound({
      providerKey,
      eventType,
      payload: verifiedPayload,
      tenantId: typeof payload.tenantId === 'string' ? payload.tenantId : undefined,
      organizationId: typeof payload.organizationId === 'string' ? payload.organizationId : undefined,
    })
  } catch (err) {
    logger.error('Processing failed', { providerKey, eventType, err })
    throw err
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
