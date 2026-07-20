"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Switch } from '@open-mercato/ui/primitives/switch'
import { SimpleTooltip } from '@open-mercato/ui/primitives/tooltip'

export type NotificationTypeItem = {
  id: string
  labelKey: string
  descriptionKey?: string | null
  // When true the type cannot be opted out of; the matrix locks its cells ON (the server drops
  // opt-out writes for these, so a toggleable switch would silently lie on reload).
  nonOptOut?: boolean
  // Effective channel eligibility from /api/notifications/types (operator override, else the
  // code-declared set; null/absent = every channel). A channel outside the set renders locked
  // OFF and toggles are refused server-side too, so the lock is enforcement, not presentation.
  channels?: string[] | null
}
export type PreferenceItem = { notificationTypeId: string; channel: string; enabled: boolean }

export type ChannelDef = { key: string; labelKey: string; labelFallback: string; hintKey: string; hintFallback: string }

/**
 * Resilient fallback channel list used only while the `/api/notifications/channels` catalogue is
 * loading or when the fetch fails. The authoritative source is the module-registered channel
 * catalogue (see `notification-channels.ts`); callers pass the fetched channels into the helpers
 * and the component. Keep this list minimal — it is a safety net, not the source of truth.
 */
export const PREFERENCE_CHANNELS: ChannelDef[] = [
  {
    key: 'in_app',
    labelKey: 'notifications.preferences.channels.inApp',
    labelFallback: 'In-app',
    hintKey: 'notifications.preferences.channels.inAppHint',
    hintFallback: 'Notification center and bell.',
  },
  {
    key: 'email',
    labelKey: 'notifications.preferences.channels.email',
    labelFallback: 'Email',
    hintKey: 'notifications.preferences.channels.emailHint',
    hintFallback: 'Sent to your account email address.',
  },
  {
    key: 'push',
    labelKey: 'notifications.preferences.channels.push',
    labelFallback: 'Push',
    hintKey: 'notifications.preferences.channels.pushHint',
    hintFallback: 'Mobile push (active once a push channel is connected).',
  },
]

/** Map a `/api/notifications/channels` item to the UI channel shape. */
export function toChannelDef(item: { id: string; labelKey: string; descriptionKey?: string | null }): ChannelDef {
  return {
    key: item.id,
    labelKey: item.labelKey,
    labelFallback: item.id,
    hintKey: item.descriptionKey ?? '',
    hintFallback: '',
  }
}

export function preferenceKey(typeId: string, channel: string): string {
  return `${typeId}::${channel}`
}

/** Whether the channel is outside the type's effective eligibility (cell locked off, tenant-wide). */
export function isChannelDisabledForType(type: NotificationTypeItem, channel: string): boolean {
  return Array.isArray(type.channels) && !type.channels.includes(channel)
}

/** Build the default-on preference map for a catalogue + stored rows; ineligible cells are forced off. */
export function buildPreferenceMap(
  types: NotificationTypeItem[],
  stored: PreferenceItem[],
  channels: ChannelDef[] = PREFERENCE_CHANNELS,
): Record<string, boolean> {
  const storedMap = new Map(stored.map((item) => [preferenceKey(item.notificationTypeId, item.channel), item.enabled]))
  const next: Record<string, boolean> = {}
  for (const type of types) {
    for (const channel of channels) {
      const key = preferenceKey(type.id, channel.key)
      next[key] = isChannelDisabledForType(type, channel.key) ? false : storedMap.get(key) ?? true
    }
  }
  return next
}

/**
 * Return only the entries whose value differs from the originally-loaded state. The server upserts
 * exactly what it receives (last-write-wins), so sending the diff keeps the payload bounded by the
 * number of toggles — not the catalogue size — and avoids materializing redundant default-on rows.
 */
export function diffPreferenceItems(
  types: NotificationTypeItem[],
  initial: Record<string, boolean>,
  current: Record<string, boolean>,
  channels: ChannelDef[] = PREFERENCE_CHANNELS,
): PreferenceItem[] {
  const items: PreferenceItem[] = []
  for (const type of types) {
    for (const channel of channels) {
      if (isChannelDisabledForType(type, channel.key)) continue
      const key = preferenceKey(type.id, channel.key)
      const before = initial[key] ?? true
      const after = current[key] ?? true
      if (before !== after) {
        items.push({ notificationTypeId: type.id, channel: channel.key, enabled: after })
      }
    }
  }
  return items
}

export type NotificationPreferenceMatrixProps = {
  types: NotificationTypeItem[]
  prefs: Record<string, boolean>
  onToggle: (typeId: string, channel: string, enabled: boolean) => void
  disabled?: boolean
  channels?: ChannelDef[]
}

export function NotificationPreferenceMatrix({
  types,
  prefs,
  onToggle,
  disabled,
  channels = PREFERENCE_CHANNELS,
}: NotificationPreferenceMatrixProps) {
  const t = useT()

  if (types.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {t('notifications.preferences.empty', 'No notification types are registered yet.')}
      </p>
    )
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/50 text-left">
            <th className="px-4 py-3 font-medium">{t('notifications.preferences.columns.type', 'Notification type')}</th>
            {channels.map((channel) => (
              <th key={channel.key} className="px-4 py-3 font-medium">
                <div>{t(channel.labelKey, channel.labelFallback)}</div>
                <div className="text-xs font-normal text-muted-foreground">{t(channel.hintKey, channel.hintFallback)}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {types.map((type) => (
            <tr key={type.id} className="border-b border-border last:border-0">
              <td className="px-4 py-3">
                <div className="font-medium">{t(type.labelKey, type.id)}</div>
                {type.descriptionKey ? (
                  <div className="text-xs text-muted-foreground">{t(type.descriptionKey, '')}</div>
                ) : null}
              </td>
              {channels.map((channel) => {
                // Operator hard-off wins over the nonOptOut forced-on lock — mirrors the gate,
                // where the tenant-wide channel block runs before the nonOptOut bypass.
                const channelDisabled = isChannelDisabledForType(type, channel.key)
                const locked = !channelDisabled && type.nonOptOut === true
                const cellLabel = `${t(type.labelKey, type.id)} – ${t(channel.labelKey, channel.labelFallback)}`
                const requiredHint = t(
                  'notifications.preferences.requiredHint',
                  'This notification is required and cannot be turned off.',
                )
                const channelDisabledHint = t(
                  'notifications.preferences.channelDisabledHint',
                  'This channel is turned off for this notification by your administrator.',
                )
                const lockHint = channelDisabled ? channelDisabledHint : requiredHint
                const switchEl = (
                  <Switch
                    checked={channelDisabled ? false : locked ? true : prefs[preferenceKey(type.id, channel.key)] ?? true}
                    disabled={disabled || locked || channelDisabled}
                    onCheckedChange={(checked) => onToggle(type.id, channel.key, checked)}
                    aria-label={locked || channelDisabled ? `${cellLabel} (${lockHint})` : cellLabel}
                  />
                )
                return (
                  <td key={channel.key} className="px-4 py-3">
                    {locked || channelDisabled ? (
                      <SimpleTooltip content={lockHint}>
                        <span className="inline-flex">{switchEl}</span>
                      </SimpleTooltip>
                    ) : (
                      switchEl
                    )}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default NotificationPreferenceMatrix
