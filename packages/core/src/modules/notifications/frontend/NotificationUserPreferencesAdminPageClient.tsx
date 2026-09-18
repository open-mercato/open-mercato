"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCall, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { Button } from '@open-mercato/ui/primitives/button'
import { LoadingMessage } from '@open-mercato/ui/backend/detail'
import { LookupSelect, type LookupSelectItem } from '@open-mercato/ui/backend/inputs'
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

type UserRow = { id: string; name?: string | null; email?: string | null }
type UsersResponse = { items?: UserRow[] }

const ADMIN_PREFERENCES_CONTEXT_ID = 'notifications-admin-preferences'

function userLabel(user: UserRow): string {
  return user.name?.trim() || user.email?.trim() || user.id
}

export function NotificationUserPreferencesAdminPageClient() {
  const t = useT()
  const [types, setTypes] = React.useState<NotificationTypeItem[]>([])
  const [channels, setChannels] = React.useState<ChannelDef[]>(PREFERENCE_CHANNELS)
  const [typesLoading, setTypesLoading] = React.useState(true)
  const [selectedUserId, setSelectedUserId] = React.useState<string | null>(null)
  // id -> display label, populated as options are fetched so the heading can name the selected user.
  const userLabels = React.useRef<Map<string, string>>(new Map())
  const [prefs, setPrefs] = React.useState<Record<string, boolean>>({})
  // Baseline for the selected user; saves send only entries that differ from this.
  const initialPrefs = React.useRef<Record<string, boolean>>({})
  const [prefsLoading, setPrefsLoading] = React.useState(false)
  const [saving, setSaving] = React.useState(false)

  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    retryLastMutation: () => Promise<boolean>
  }>({
    contextId: ADMIN_PREFERENCES_CONTEXT_ID,
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })

  React.useEffect(() => {
    let cancelled = false
    ;(async () => {
      setTypesLoading(true)
      try {
        const [body, channelsBody] = await Promise.all([
          readApiResultOrThrow<TypesResponse>('/api/notifications/types', undefined, {
            errorMessage: t('notifications.preferences.loadError', 'Failed to load notification preferences'),
            allowNullResult: true,
          }),
          readApiResultOrThrow<ChannelsResponse>('/api/notifications/channels', undefined, {
            errorMessage: t('notifications.preferences.loadError', 'Failed to load notification preferences'),
            allowNullResult: true,
          }),
        ])
        if (!cancelled) {
          setTypes(body?.items ?? [])
          setChannels(channelsBody?.items?.length ? channelsBody.items.map(toChannelDef) : PREFERENCE_CHANNELS)
        }
      } catch (err) {
        if (!cancelled) flash(err instanceof Error ? err.message : t('notifications.preferences.loadError', 'Failed to load notification preferences'), 'error')
      } finally {
        if (!cancelled) setTypesLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [t])

  // Async user lookup for LookupSelect. Devices admins may lack auth.users.list; degrade to no
  // options (x-om-forbidden-redirect: 0 + swallow) instead of redirecting the whole page.
  const fetchUsers = React.useCallback(async (query?: string): Promise<LookupSelectItem[]> => {
    const params = new URLSearchParams({ page: '1', pageSize: '10' })
    if (query && query.trim().length) params.set('search', query.trim())
    const call = await apiCall<UsersResponse>(
      `/api/auth/users?${params.toString()}`,
      { headers: { 'x-om-forbidden-redirect': '0' } },
      { fallback: null },
    ).catch(() => null)
    if (!call || !call.ok) return []
    return (call.result?.items ?? []).flatMap((user) => {
      if (!user || typeof user.id !== 'string' || !user.id.trim()) return []
      const label = userLabel(user)
      userLabels.current.set(user.id, label)
      const email = user.email?.trim() ?? null
      return [{ id: user.id, title: label, subtitle: email && email !== label ? email : null }]
    })
  }, [])

  const loadPreferencesFor = React.useCallback(async (userId: string) => {
    setPrefsLoading(true)
    try {
      const body = await readApiResultOrThrow<PreferencesResponse>(
        `/api/notifications/admin/preferences?userId=${encodeURIComponent(userId)}`,
        undefined,
        { errorMessage: t('notifications.preferences.loadError', 'Failed to load notification preferences'), allowNullResult: true },
      )
      const map = buildPreferenceMap(types, body?.items ?? [], channels)
      initialPrefs.current = map
      setPrefs(map)
    } catch (err) {
      flash(err instanceof Error ? err.message : t('notifications.preferences.loadError', 'Failed to load notification preferences'), 'error')
      setSelectedUserId(null)
    } finally {
      setPrefsLoading(false)
    }
  }, [t, types, channels])

  const handleSelectUser = (userId: string | null) => {
    setSelectedUserId(userId)
    if (userId) void loadPreferencesFor(userId)
  }

  const togglePref = (typeId: string, channel: string, enabled: boolean) => {
    setPrefs((prev) => ({ ...prev, [preferenceKey(typeId, channel)]: enabled }))
  }

  const handleSave = async () => {
    if (!selectedUserId) return
    setSaving(true)
    try {
      const preferences = diffPreferenceItems(types, initialPrefs.current, prefs, channels)
      // Nothing changed for this user since load/last save — skip the no-op write.
      if (preferences.length === 0) {
        flash(t('notifications.preferences.saveSuccess', 'Notification preferences saved'), 'success')
        return
      }
      const response = await runMutation({
        // optimistic-lock-exempt: idempotent per-cell preference toggle grid — the client sends only
        // changed (type, channel) cells (diffPreferenceItems) and the server upserts them
        // last-write-wins per cell, so there is no lost-update hazard to version-lock.
        operation: () =>
          apiCall<SaveResponse>('/api/notifications/admin/preferences', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: selectedUserId, preferences }),
          }),
        context: { formId: ADMIN_PREFERENCES_CONTEXT_ID, resourceKind: 'notifications.preference', retryLastMutation },
        mutationPayload: { userId: selectedUserId, preferences },
      })
      if (!response.ok) {
        throw new Error(response.result?.error || t('notifications.preferences.saveError', 'Failed to save notification preferences'))
      }
      initialPrefs.current = prefs
      flash(t('notifications.preferences.saveSuccess', 'Notification preferences saved'), 'success')
    } catch (err) {
      flash(err instanceof Error ? err.message : t('notifications.preferences.saveError', 'Failed to save notification preferences'), 'error')
    } finally {
      setSaving(false)
    }
  }

  const selectedLabel = selectedUserId ? (userLabels.current.get(selectedUserId) ?? selectedUserId) : ''

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">{t('notifications.preferences.admin.pageTitle', 'User Notification Preferences')}</h1>
        <p className="text-muted-foreground text-sm">
          {t('notifications.preferences.admin.pageDescription', "Search for a user to review and edit their notification channel preferences.")}
        </p>
      </div>

      <LookupSelect
        value={selectedUserId}
        onChange={handleSelectUser}
        fetchOptions={fetchUsers}
        defaultOpen
        searchPlaceholder={t('notifications.preferences.admin.searchPlaceholder', 'Search users by name or email...')}
        emptyLabel={t('notifications.preferences.admin.noUsers', 'No users found.')}
      />

      {selectedUserId ? (
        <div className="flex flex-col gap-4">
          <h2 className="text-lg font-medium">
            {t('notifications.preferences.admin.editingFor', 'Preferences for {user}').replace('{user}', selectedLabel)}
          </h2>
          {prefsLoading || typesLoading ? (
            <LoadingMessage label={t('notifications.preferences.loading', 'Loading notification preferences...')} />
          ) : (
            <>
              <NotificationPreferenceMatrix types={types} prefs={prefs} onToggle={togglePref} channels={channels} />
              <div>
                <Button type="button" onClick={handleSave} disabled={saving}>
                  {saving ? t('notifications.preferences.saving', 'Saving...') : t('notifications.preferences.save', 'Save preferences')}
                </Button>
              </div>
            </>
          )}
        </div>
      ) : null}
    </div>
  )
}

export default NotificationUserPreferencesAdminPageClient
