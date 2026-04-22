import { getWebhookEndpointAdapter } from '../lib/adapter-registry'

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

  await adapter.processInbound({
    providerKey,
    eventType,
    payload: verifiedPayload,
    tenantId: typeof payload.tenantId === 'string' ? payload.tenantId : undefined,
    organizationId: typeof payload.organizationId === 'string' ? payload.organizationId : undefined,
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
