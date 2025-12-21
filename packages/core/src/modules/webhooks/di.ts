import type { AppContainer } from '@/lib/di/container'
import type { EventBus } from '@open-mercato/events'
import { triggerWebhooksForEvent } from './services/triggerWebhooks'
import type { WebhookEventType } from './data/types'

// Domain events to subscribe to (in format: module.entity.action)
const WEBHOOK_DOMAIN_EVENTS: WebhookEventType[] = [
  'catalog.product.created',
]

export function register(container: AppContainer) {
  const setup = () => {
    let bus: EventBus | null = null
    try {
      bus = container.resolve('eventBus') as EventBus
    } catch {
      bus = null
    }
    if (!bus) {
      setTimeout(setup, 0)
      return
    }

    for (const event of WEBHOOK_DOMAIN_EVENTS) {
      bus.on(event, async (payload: any, ctx: any) => {
        const tenantId = payload?.tenantId || null
        if (!tenantId) return
        try {
          await triggerWebhooksForEvent(event, tenantId, payload, ctx)
        } catch {
          // Webhook trigger failure should not break the event flow
        }
      })
    }
  }

  try {
    setup()
  } catch {}
}
