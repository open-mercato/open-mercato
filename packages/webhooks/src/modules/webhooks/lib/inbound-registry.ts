import { matchWebhookEventPattern } from '@open-mercato/shared/lib/events/patterns'
import type {
  WebhookHandlerRegistryEntry,
  WebhookSourceConfig,
} from '@open-mercato/shared/lib/webhooks'

const WEBHOOK_SOURCES_KEY = '__openMercatoWebhookSources__'
const WEBHOOK_HANDLERS_KEY = '__openMercatoWebhookHandlers__'

type GlobalState = typeof globalThis & {
  [WEBHOOK_SOURCES_KEY]?: Map<string, WebhookSourceConfig>
  [WEBHOOK_HANDLERS_KEY]?: WebhookHandlerRegistryEntry[]
}

function getSourceRegistry(): Map<string, WebhookSourceConfig> {
  const globalState = globalThis as GlobalState
  if (!globalState[WEBHOOK_SOURCES_KEY]) {
    globalState[WEBHOOK_SOURCES_KEY] = new Map<string, WebhookSourceConfig>()
  }
  return globalState[WEBHOOK_SOURCES_KEY]
}

function getHandlerRegistry(): WebhookHandlerRegistryEntry[] {
  const globalState = globalThis as GlobalState
  if (!globalState[WEBHOOK_HANDLERS_KEY]) {
    globalState[WEBHOOK_HANDLERS_KEY] = []
  }
  return globalState[WEBHOOK_HANDLERS_KEY]
}

export function registerWebhookSource(config: WebhookSourceConfig): () => void {
  const registry = getSourceRegistry()
  registry.set(config.key, config)
  return () => {
    if (registry.get(config.key) === config) registry.delete(config.key)
  }
}

export function setWebhookSources(configs: WebhookSourceConfig[]): void {
  const registry = getSourceRegistry()
  registry.clear()
  for (const config of configs) registry.set(config.key, config)
}

export function getWebhookSource(sourceKey: string): WebhookSourceConfig | undefined {
  return getSourceRegistry().get(sourceKey)
}

export function listWebhookSources(): WebhookSourceConfig[] {
  return Array.from(getSourceRegistry().values())
}

export function clearWebhookSources(): void {
  getSourceRegistry().clear()
}

export function registerWebhookHandler(entry: WebhookHandlerRegistryEntry): () => void {
  const registry = getHandlerRegistry()
  registry.push(entry)
  return () => {
    const index = registry.indexOf(entry)
    if (index >= 0) registry.splice(index, 1)
  }
}

export function setWebhookHandlers(entries: WebhookHandlerRegistryEntry[]): void {
  const registry = getHandlerRegistry()
  registry.length = 0
  registry.push(...entries)
}

export function listWebhookHandlers(): WebhookHandlerRegistryEntry[] {
  return [...getHandlerRegistry()]
}

export function clearWebhookHandlers(): void {
  getHandlerRegistry().length = 0
}

/**
 * Resolve the handlers that match an inbound webhook's source key and event type.
 * Event matching reuses the outbound prefix-wildcard semantics (`*`, `payment_intent.*`).
 */
export function resolveWebhookHandlers(
  sourceKey: string,
  eventType: string,
): WebhookHandlerRegistryEntry[] {
  return getHandlerRegistry().filter((entry) => {
    if (entry.meta.source !== sourceKey) return false
    return matchWebhookEventPattern(eventType, entry.meta.event)
  })
}
