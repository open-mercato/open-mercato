import type { NotificationChannelDefinition } from '@open-mercato/shared/modules/notifications/types'

const registry = new Map<string, NotificationChannelDefinition>()

export type RegisterNotificationChannelsOptions = {
  replace?: boolean
}

/**
 * In-memory catalogue of module-contributed delivery channels. Fed at app bootstrap from the
 * generated aggregate (see `notifications/generators.ts` → `channelsPlugin`), mirroring the
 * notification-type registry. Provides labels/metadata for the preferences UI and the
 * `GET /api/notifications/channels` endpoint; the delivery-strategy registry remains the
 * behavior layer (both are keyed by the same channel id).
 */
export function registerNotificationChannels(
  channels: NotificationChannelDefinition[],
  options: RegisterNotificationChannelsOptions = {},
): void {
  if (options.replace) registry.clear()
  for (const channel of channels) {
    if (!channel?.id) continue
    registry.set(channel.id, channel)
  }
}

export function getNotificationChannel(id: string): NotificationChannelDefinition | undefined {
  return registry.get(id)
}

export function getNotificationChannels(): NotificationChannelDefinition[] {
  return Array.from(registry.values()).sort((a, b) => {
    const orderA = a.order ?? Number.MAX_SAFE_INTEGER
    const orderB = b.order ?? Number.MAX_SAFE_INTEGER
    if (orderA !== orderB) return orderA - orderB
    return a.id.localeCompare(b.id)
  })
}

export type NotificationChannelEntry = {
  moduleId: string
  channels: unknown[]
}

/**
 * Bootstrap-time registration of module-contributed channels, fed from the generated
 * `notification-channels.generated.ts` aggregate via `runBootstrapRegistrations()`. Idempotent:
 * a channel whose `id` is already registered is skipped, so a repeated bootstrap (HMR / test
 * re-import) never double-registers.
 */
export function registerNotificationChannelEntries(entries: NotificationChannelEntry[]): void {
  for (const entry of entries) {
    for (const channel of entry.channels ?? []) {
      const candidate = channel as NotificationChannelDefinition
      if (!candidate?.id || registry.has(candidate.id)) continue
      registry.set(candidate.id, candidate)
    }
  }
}
