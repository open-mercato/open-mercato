import type { WebhookEntity } from '../data/entities'

export function applyWebhookActiveState(
  webhook: Pick<WebhookEntity, 'isActive' | 'consecutiveFailures'>,
  isActive: boolean,
): void {
  if (isActive && !webhook.isActive) webhook.consecutiveFailures = 0
  webhook.isActive = isActive
}
