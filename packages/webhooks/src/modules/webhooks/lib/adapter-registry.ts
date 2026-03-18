const WEBHOOK_ENDPOINT_ADAPTERS_KEY = '__openMercatoWebhookEndpointAdapters__'

export interface WebhookEndpointAdapter {
  readonly providerKey: string
  readonly subscribedEvents: string[]

  formatPayload?(event: { type: string; data: unknown }): Promise<{
    url: string
    headers: Record<string, string>
    body: Record<string, unknown>
    method: 'POST' | 'PUT' | 'PATCH'
  }>

  verifyWebhook(input: {
    headers: Record<string, string>
    body: string
    method: string
  }): Promise<{
    eventType: string
    payload: Record<string, unknown>
    tenantId?: string
    organizationId?: string
  }>

  processInbound(event: {
    eventType: string
    payload: Record<string, unknown>
    tenantId?: string
    organizationId?: string
    providerKey: string
  }): Promise<void>
}

function getRegistry(): Map<string, WebhookEndpointAdapter> {
  const globalState = globalThis as typeof globalThis & {
    [WEBHOOK_ENDPOINT_ADAPTERS_KEY]?: Map<string, WebhookEndpointAdapter>
  }

  if (!globalState[WEBHOOK_ENDPOINT_ADAPTERS_KEY]) {
    globalState[WEBHOOK_ENDPOINT_ADAPTERS_KEY] = new Map<string, WebhookEndpointAdapter>()
  }

  return globalState[WEBHOOK_ENDPOINT_ADAPTERS_KEY]
}

export function registerWebhookEndpointAdapter(adapter: WebhookEndpointAdapter): () => void {
  const registry = getRegistry()
  registry.set(adapter.providerKey, adapter)
  return () => {
    registry.delete(adapter.providerKey)
  }
}

export function getWebhookEndpointAdapter(providerKey: string): WebhookEndpointAdapter | undefined {
  return getRegistry().get(providerKey)
}

export function listWebhookEndpointAdapters(): WebhookEndpointAdapter[] {
  return Array.from(getRegistry().values())
}

export function clearWebhookEndpointAdapters(): void {
  getRegistry().clear()
}
