import type { Notification } from '../data/entities'
import type { NotificationDeliveryConfig } from './deliveryConfig'

export type NotificationDeliveryStrategyConfig = {
  enabled?: boolean
  config?: unknown
}

export type NotificationDeliveryRecipient = {
  email?: string | null
  name?: string | null
}

export type NotificationDeliveryContext = {
  notification: Notification
  recipient: NotificationDeliveryRecipient
  title: string
  body: string | null
  panelUrl: string | null
  panelLink: string | null
  actionLinks: Array<{ id: string; label: string; href: string }>
  deliveryConfig: NotificationDeliveryConfig
  config: NotificationDeliveryStrategyConfig
  resolve: <T = unknown>(name: string) => T
  t: (key: string, fallback?: string, variables?: Record<string, string>) => string
}

export type NotificationDeliveryStrategy = {
  id: string
  label?: string
  defaultEnabled?: boolean
  deliver: (ctx: NotificationDeliveryContext) => Promise<void> | void
}

type RegisteredStrategy = NotificationDeliveryStrategy & { priority: number }

const registry: RegisteredStrategy[] = []

export function registerNotificationDeliveryStrategy(
  strategy: NotificationDeliveryStrategy,
  options?: { priority?: number }
): void {
  const priority = options?.priority ?? 0
  registry.push({ ...strategy, priority })
  registry.sort((a, b) => b.priority - a.priority)
}

export function getNotificationDeliveryStrategies(): NotificationDeliveryStrategy[] {
  return registry
}
