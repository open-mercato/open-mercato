"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCall, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { Button } from '@open-mercato/ui/primitives/button'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import {
  NotificationPreferenceMatrix,
  PREFERENCE_CHANNELS,
  buildPreferenceMap,
  diffPreferenceItems,
  preferenceKey,
  toChannelDef,
  type ChannelDef,
  type NotificationTypeItem,
  type PreferenceItem,
} from './NotificationPreferenceMatrix'

type TypesResponse = { items?: NotificationTypeItem[] }
type PreferencesResponse = { items?: PreferenceItem[] }
type ChannelsResponse = { items?: Array<{ id: string; labelKey: string; descriptionKey?: string | null }> }
type SaveResponse = { ok?: boolean; error?: string }

const PREFERENCES_CONTEXT_ID = 'notifications-preferences'

export function NotificationPreferencesPageClient() {
  const t = useT()
  const [types, setTypes] = React.useState<NotificationTypeItem[] | null>(null)
  const [channels, setChannels] = React.useState<ChannelDef[]>(PREFERENCE_CHANNELS)
  const [prefs, setPrefs] = React.useState<Record<string, boolean>>({})
  // The state as last loaded/saved; saves send only the entries that differ from this.
  const initialPrefs = React.useRef<Record<string, boolean>>({})
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    retryLastMutation: () => Promise<boolean>
  }>({
    contextId: PREFERENCES_CONTEXT_ID,
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })

  const fetchData = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [typesBody, prefsBody, channelsBody] = await Promise.all([
        readApiResultOrThrow<TypesResponse>('/api/notifications/types', undefined, {
          errorMessage: t('notifications.preferences.loadError', 'Failed to load notification preferences'),
          allowNullResult: true,
        }),
        readApiResultOrThrow<PreferencesResponse>('/api/notifications/preferences', undefined, {
          errorMessage: t('notifications.preferences.loadError', 'Failed to load notification preferences'),
          allowNullResult: true,
        }),
        readApiResultOrThrow<ChannelsResponse>('/api/notifications/channels', undefined, {
          errorMessage: t('notifications.preferences.loadError', 'Failed to load notification preferences'),
          allowNullResult: true,
        }),
      ])
      const typeItems = typesBody?.items ?? []
      setTypes(typeItems)
      const channelDefs = channelsBody?.items?.length ? channelsBody.items.map(toChannelDef) : PREFERENCE_CHANNELS
      setChannels(channelDefs)
      const map = buildPreferenceMap(typeItems, prefsBody?.items ?? [], channelDefs)
      initialPrefs.current = map
      setPrefs(map)
    } catch (err) {
      const message = err instanceof Error ? err.message : t('notifications.preferences.loadError', 'Failed to load notification preferences')
      setError(message)
      flash(message, 'error')
    } finally {
      setLoading(false)
    }
  }, [t])

  React.useEffect(() => {
    fetchData()
  }, [fetchData])

  const togglePref = (typeId: string, channel: string, enabled: boolean) => {
    setPrefs((prev) => ({ ...prev, [preferenceKey(typeId, channel)]: enabled }))
  }

  const handleSave = async () => {
    if (!types) return
    setSaving(true)
    try {
      const preferences = diffPreferenceItems(types, initialPrefs.current, prefs, channels)
      // Nothing changed since load/last save — skip the no-op write entirely.
      if (preferences.length === 0) {
        flash(t('notifications.preferences.saveSuccess', 'Notification preferences saved'), 'success')
        return
      }
      const response = await runMutation({
        // optimistic-lock-exempt: the preference matrix is an idempotent per-cell toggle grid.
        // The client sends only changed (type, channel) cells (diffPreferenceItems) and the server
        // upserts them last-write-wins per cell, so there is no lost-update hazard on a shared
        // aggregate that version-locking would guard.
        operation: () =>
          apiCall<SaveResponse>('/api/notifications/preferences', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ preferences }),
          }),
        context: { formId: PREFERENCES_CONTEXT_ID, resourceKind: 'notifications.preference', retryLastMutation },
        mutationPayload: { preferences },
      })
      if (!response.ok) {
        const message = response.result?.error || t('notifications.preferences.saveError', 'Failed to save notification preferences')
        throw new Error(message)
      }
      initialPrefs.current = prefs
      flash(t('notifications.preferences.saveSuccess', 'Notification preferences saved'), 'success')
    } catch (err) {
      const message = err instanceof Error ? err.message : t('notifications.preferences.saveError', 'Failed to save notification preferences')
      flash(message, 'error')
    } finally {
      setSaving(false)
    }
  }

  if (loading || !types) {
    return <LoadingMessage label={t('notifications.preferences.loading', 'Loading notification preferences...')} />
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">{t('notifications.preferences.pageTitle', 'Notification Preferences')}</h1>
        <p className="text-muted-foreground text-sm">
          {t('notifications.preferences.pageDescription', 'Choose which channels deliver each notification type. Unset choices stay enabled by default.')}
        </p>
      </div>

      <NotificationPreferenceMatrix types={types} prefs={prefs} onToggle={togglePref} channels={channels} />

      {error && <ErrorMessage label={error} />}

      <div className="flex items-center gap-3">
        <Button type="button" onClick={handleSave} disabled={saving}>
          {saving ? t('notifications.preferences.saving', 'Saving...') : t('notifications.preferences.save', 'Save preferences')}
        </Button>
      </div>
    </div>
  )
}

export default NotificationPreferencesPageClient
