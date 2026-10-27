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

/**
 * Channel-agnostic delivery context. Every strategy can rely on these fields regardless of channel.
 */
export type NotificationDeliveryContextCore = {
  notification: Notification
  recipient: NotificationDeliveryRecipient
  title: string
  body: string | null
  deliveryConfig: NotificationDeliveryConfig
  config: NotificationDeliveryStrategyConfig
  resolve: <T = unknown>(name: string) => T
  t: (key: string, fallback?: string, variables?: Record<string, string>) => string
}

/**
 * Email-shaped extras carried on every context for backward compatibility. Only the `email` strategy
 * should read these — they encode one channel's assumptions (a panel deep-link and pre-rendered
 * action hyperlinks). New channel strategies MUST derive whatever they need from `notification`
 * instead.
 *
 * @deprecated These fields are email-specific and will move behind an email-scoped accessor in a
 * future major version. Do not depend on them from a non-email strategy.
 */
export type EmailDeliveryExtras = {
  /** @deprecated Email-specific. Absolute panel URL (no notification id). */
  panelUrl: string | null
  /** @deprecated Email-specific. Absolute deep link to the notification in the panel. */
  panelLink: string | null
  /** @deprecated Email-specific. Pre-resolved absolute action hyperlinks for the email template. */
  actionLinks: Array<{ id: string; label: string; href: string }>
}

/**
 * Full delivery context handed to `strategy.deliver`. Kept as the flat intersection of the
 * channel-agnostic core and the email extras so existing strategies compile unchanged; the split
 * documents which fields are channel-neutral vs. email-only (see `EmailDeliveryExtras`).
 */
export type NotificationDeliveryContext = NotificationDeliveryContextCore & EmailDeliveryExtras

export type NotificationDeliveryStrategy = {
  id: string
  label?: string
  defaultEnabled?: boolean
  /**
   * Optional technical-deliverability gate evaluated by the dispatcher before `deliver`. Return
   * `false` to skip this channel for the current context (e.g. email disabled by tenant config).
   * This is NOT for per-user opt-out — that is enforced once at create time via `shouldDeliver`.
   */
  isConfigured?: (ctx: NotificationDeliveryContext) => boolean | Promise<boolean>
  /**
   * Optional per-notification applicability check. Return `false` to skip this strategy entirely for
   * the given notification (e.g. a channel that only handles a certain notification shape).
   */
  supports?: (notification: Notification) => boolean
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
