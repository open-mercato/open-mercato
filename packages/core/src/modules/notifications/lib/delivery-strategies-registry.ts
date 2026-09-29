import {
  getNotificationDeliveryStrategies,
  registerNotificationDeliveryStrategy,
  type NotificationDeliveryStrategy,
} from './deliveryStrategies'

export type NotificationDeliveryStrategyEntry = {
  moduleId: string
  strategies: unknown[]
}

/**
 * Bootstrap-time registration of module-contributed notification delivery strategies.
 *
 * Fed from the generated `notifications-delivery-strategies.generated.ts` aggregate (see
 * `notifications/generators.ts`) via `runBootstrapRegistrations()`, mirroring how the security
 * module registers its MFA providers. Idempotent: a strategy whose `id` is already registered is
 * skipped, so a repeated bootstrap (HMR / test re-import) never double-registers.
 */
export function registerNotificationDeliveryStrategyEntries(entries: NotificationDeliveryStrategyEntry[]): void {
  const registered = new Set(getNotificationDeliveryStrategies().map((strategy) => strategy.id))
  for (const entry of entries) {
    for (const strategy of entry.strategies ?? []) {
      const candidate = strategy as NotificationDeliveryStrategy
      if (!candidate?.id || registered.has(candidate.id)) continue
      registerNotificationDeliveryStrategy(candidate)
      registered.add(candidate.id)
    }
  }
}
