const providerQueueMap = new Map<string, string>()

export function registerGatewayWebhookQueue(providerKey: string, queueName: string): () => void {
  if (!providerKey.trim() || !queueName.trim()) return () => {}
  providerQueueMap.set(providerKey, queueName)
  return () => {
    if (providerQueueMap.get(providerKey) === queueName) {
      providerQueueMap.delete(providerKey)
    }
  }
}

export function resolveGatewayWebhookQueue(providerKey: string): string {
  return providerQueueMap.get(providerKey) ?? 'payment-gateways-webhook'
}
