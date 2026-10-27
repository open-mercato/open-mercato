import type {
  WebhookHandlerRegistryEntry,
  WebhookSourceConfig,
} from '@open-mercato/shared/lib/webhooks'
import { setWebhookHandlers, setWebhookSources } from './inbound-registry'

export type WebhookSourceModuleEntry = {
  moduleId: string
  sources: WebhookSourceConfig[]
}

export type WebhookHandlerModuleEntry = {
  moduleId: string
  handlers: WebhookHandlerRegistryEntry[]
}

/**
 * Bootstrap-time registration for module-declared webhook sources.
 * Driven by the `webhooks.sources` generator plugin via
 * `bootstrap-registrations.generated.ts` — modules contribute a
 * `webhook-sources.ts` and are wired here without bootstrap.ts edits.
 */
export function registerWebhookSourceEntries(entries: WebhookSourceModuleEntry[]): void {
  setWebhookSources(entries.flatMap((entry) => entry.sources ?? []))
}

/**
 * Bootstrap-time registration for module-declared webhook handlers.
 * Driven by the `webhooks.handlers` generator plugin.
 */
export function registerWebhookHandlerEntries(entries: WebhookHandlerModuleEntry[]): void {
  setWebhookHandlers(entries.flatMap((entry) => entry.handlers ?? []))
}
