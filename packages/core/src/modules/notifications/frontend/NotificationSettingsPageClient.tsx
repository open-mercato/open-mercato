"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCall, readApiResultOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { Switch } from '@open-mercato/ui/primitives/switch'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@open-mercato/ui/primitives/card'
import { computeChannelsPatch } from './typeChannelSettings'

type NotificationTypeCatalogueItem = {
  id: string
  labelKey: string
  descriptionKey?: string | null
  // Effective "required" flag (tenant override ?? code-declared).
  nonOptOut?: boolean
  // Effective channel eligibility for this tenant (stored override ?? code-declared; null = every channel).
  channels: string[] | null
  // Raw tenant-stored override (null = inherit the code-declared set).
  storedChannels: string[] | null
  // Raw tenant-stored nonOptOut override (null = inherit the code-declared flag).
  storedNonOptOut: boolean | null
  // Optimistic-lock version of the tenant's override row (null = no override stored yet).
  updatedAt: string | null
}

type TypesResponse = { items?: NotificationTypeCatalogueItem[] }
type ChannelsResponse = { items?: Array<{ id: string; labelKey: string; descriptionKey?: string | null }> }
type PatchTypeResponse = { ok?: boolean; item?: NotificationTypeCatalogueItem; error?: string }

type NotificationDeliveryConfig = {
  appUrl?: string
  panelPath: string
  strategies: {
    database: { enabled: boolean }
    email: { enabled: boolean; from?: string; replyTo?: string; subjectPrefix?: string }
    custom?: Record<string, { enabled?: boolean; config?: unknown }>
  }
}

type SettingsResponse = {
  settings?: NotificationDeliveryConfig
  error?: string
}

const emptySettings: NotificationDeliveryConfig = {
  panelPath: '/backend/notifications',
  strategies: {
    database: { enabled: true },
    email: { enabled: true },
    custom: {},
  },
}

const SETTINGS_CONTEXT_ID = 'notifications-settings'

export function NotificationSettingsPageClient() {
  const t = useT()
  const [settings, setSettings] = React.useState<NotificationDeliveryConfig | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    resourceId?: string
    retryLastMutation: () => Promise<boolean>
  }>({
    contextId: SETTINGS_CONTEXT_ID,
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })

  const [types, setTypes] = React.useState<NotificationTypeCatalogueItem[]>([])
  const [channels, setChannels] = React.useState<Array<{ id: string; labelKey: string }>>([])
  const [savingTypeCell, setSavingTypeCell] = React.useState<string | null>(null)

  const fetchCatalogue = React.useCallback(async () => {
    try {
      const [typesBody, channelsBody] = await Promise.all([
        readApiResultOrThrow<TypesResponse>('/api/notifications/types', undefined, {
          errorMessage: t('notifications.settings.types.loadError', 'Failed to load notification types'),
          allowNullResult: true,
        }),
        readApiResultOrThrow<ChannelsResponse>('/api/notifications/channels', undefined, {
          errorMessage: t('notifications.settings.types.loadError', 'Failed to load notification types'),
          allowNullResult: true,
        }),
      ])
      setTypes(typesBody?.items ?? [])
      setChannels((channelsBody?.items ?? []).map((item) => ({ id: item.id, labelKey: item.labelKey })))
    } catch (err) {
      const message = err instanceof Error ? err.message : t('notifications.settings.types.loadError', 'Failed to load notification types')
      flash(message, 'error')
    }
  }, [t])

  React.useEffect(() => {
    fetchCatalogue()
  }, [fetchCatalogue])

  const patchType = async (
    type: NotificationTypeCatalogueItem,
    cellKey: string,
    payload: { channels?: string[] | null; nonOptOut?: boolean | null },
  ) => {
    setSavingTypeCell(cellKey)
    try {
      const response = await runMutation({
        operation: () =>
          // The override row's updatedAt is the optimistic-lock version: a concurrent
          // operator save flips it, and the full `channels` array replaces — so a stale
          // blind write would silently revert their edit. The server 409s instead.
          withScopedApiRequestHeaders(buildOptimisticLockHeader(type.updatedAt), () =>
            apiCall<PatchTypeResponse>('/api/notifications/types', {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ id: type.id, ...payload }),
            }),
          ),
        context: {
          formId: SETTINGS_CONTEXT_ID,
          resourceKind: 'notifications.settings',
          resourceId: type.id,
          retryLastMutation,
        },
        mutationPayload: { id: type.id, ...payload },
      })
      if (!response.ok || !response.result?.ok) {
        if (surfaceRecordConflict({ status: response.status, body: response.result }, t, { onRefresh: fetchCatalogue })) {
          await fetchCatalogue()
          return
        }
        const message = response.result?.error || t('notifications.settings.types.saveError', 'Failed to save notification type settings')
        throw new Error(message)
      }
      const saved = response.result.item
      setTypes((prev) =>
        prev.map((item) =>
          item.id === type.id && saved
            ? {
                ...item,
                channels: saved.channels,
                storedChannels: saved.storedChannels,
                nonOptOut: saved.nonOptOut,
                storedNonOptOut: saved.storedNonOptOut,
                updatedAt: saved.updatedAt,
              }
            : item,
        ),
      )
      flash(t('notifications.settings.types.saveSuccess', 'Notification type settings saved'), 'success')
    } catch (err) {
      const message = err instanceof Error ? err.message : t('notifications.settings.types.saveError', 'Failed to save notification type settings')
      flash(message, 'error')
    } finally {
      setSavingTypeCell(null)
    }
  }

  const handleTypeChannelToggle = async (
    type: NotificationTypeCatalogueItem,
    channelId: string,
    enabled: boolean,
    registeredChannelIds: string[],
  ) => {
    const effective = type.channels ?? registeredChannelIds
    // Unchecking the last channel maps to `null` (clear the override → code default reapplies)
    // rather than an empty set, which the API rejects and which would black-hole the type.
    await patchType(type, `${type.id}::${channelId}`, {
      channels: computeChannelsPatch(effective, channelId, enabled),
    })
  }

  const handleTypeNonOptOutToggle = async (type: NotificationTypeCatalogueItem, required: boolean) => {
    await patchType(type, `${type.id}::nonOptOut`, { nonOptOut: required })
  }

  const fetchSettings = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const body = await readApiResultOrThrow<SettingsResponse>(
        '/api/notifications/settings',
        undefined,
        { errorMessage: t('notifications.settings.loadError', 'Failed to load notification settings'), allowNullResult: true },
      )
      if (body?.settings) {
        setSettings(body.settings)
      } else {
        setSettings(emptySettings)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : t('notifications.settings.loadError', 'Failed to load notification settings')
      setError(message)
      flash(message, 'error')
    } finally {
      setLoading(false)
    }
  }, [t])

  React.useEffect(() => {
    fetchSettings()
  }, [fetchSettings])

  const updateSettings = (patch: Partial<NotificationDeliveryConfig>) => {
    setSettings((prev) => (prev ? { ...prev, ...patch } : prev))
  }

  const updateStrategy = (
    strategy: keyof NotificationDeliveryConfig['strategies'],
    patch: Partial<NotificationDeliveryConfig['strategies'][keyof NotificationDeliveryConfig['strategies']]>,
  ) => {
    setSettings((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        strategies: {
          ...prev.strategies,
          [strategy]: {
            ...prev.strategies[strategy],
            ...patch,
          },
        },
      }
    })
  }

  const handleSave = async () => {
    if (!settings) return
    setSaving(true)
    try {
      const response = await runMutation({
        operation: () =>
          apiCall<SettingsResponse>('/api/notifications/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(settings),
          }),
        context: { formId: SETTINGS_CONTEXT_ID, resourceKind: 'notifications.settings', retryLastMutation },
        mutationPayload: { settings },
      })
      if (!response.ok) {
        const message = response.result?.error || t('notifications.settings.saveError', 'Failed to save notification settings')
        throw new Error(message)
      }
      if (response.result?.settings) {
        setSettings(response.result.settings)
      }
      flash(t('notifications.settings.saveSuccess', 'Notification settings saved'), 'success')
    } catch (err) {
      const message = err instanceof Error ? err.message : t('notifications.settings.saveError', 'Failed to save notification settings')
      flash(message, 'error')
    } finally {
      setSaving(false)
    }
  }

  if (loading || !settings) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner size="sm" />
        {t('notifications.settings.loading', 'Loading notification settings...')}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">{t('notifications.settings.pageTitle', 'Notification Delivery')}</h1>
        <p className="text-muted-foreground text-sm">
          {t('notifications.settings.pageDescription', 'Configure delivery strategies for in-app notifications.')}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('notifications.settings.core.title', 'Core delivery')}</CardTitle>
          <CardDescription>{t('notifications.settings.core.description', 'Control the default notification center and panel link used by external channels.')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="notifications-app-url">{t('notifications.settings.core.appUrl', 'Application URL')}</Label>
            <Input
              id="notifications-app-url"
              value={settings.appUrl ?? ''}
              placeholder="https://app.open-mercato.com"
              onChange={(event) => updateSettings({ appUrl: event.target.value || undefined })}
            />
            <p className="text-xs text-muted-foreground">{t('notifications.settings.core.appUrlHint', 'Used to build absolute links in email notifications.')}</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="notifications-panel-path">{t('notifications.settings.core.panelPath', 'Notification panel path')}</Label>
            <Input
              id="notifications-panel-path"
              value={settings.panelPath}
              onChange={(event) => updateSettings({ panelPath: event.target.value })}
            />
            <p className="text-xs text-muted-foreground">{t('notifications.settings.core.panelPathHint', 'Relative path for the read-only notification panel.')}</p>
          </div>
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <p className="text-sm font-medium">{t('notifications.settings.core.databaseLabel', 'In-app notifications')}</p>
              <p className="text-xs text-muted-foreground">{t('notifications.settings.core.databaseHint', 'Store notifications in the database for the panel and bell.')}</p>
            </div>
            <Switch
              checked={settings.strategies.database.enabled}
              disabled
              onCheckedChange={(checked) => updateStrategy('database', { enabled: checked })}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('notifications.settings.email.title', 'Email strategy')}</CardTitle>
          <CardDescription>{t('notifications.settings.email.description', 'Send notification copies via Resend using React templates.')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="flex items-center justify-between rounded-lg border p-3 md:col-span-2">
            <div>
              <p className="text-sm font-medium">{t('notifications.settings.email.enabledLabel', 'Enable email delivery')}</p>
              <p className="text-xs text-muted-foreground">{t('notifications.settings.email.enabledHint', 'Email actions are read-only and link back to the notification center.')}</p>
            </div>
            <Switch
              checked={settings.strategies.email.enabled}
              onCheckedChange={(checked) => updateStrategy('email', { enabled: checked })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="notifications-email-from">{t('notifications.settings.email.from', 'From address')}</Label>
            <Input
              id="notifications-email-from"
              value={settings.strategies.email.from ?? ''}
              placeholder="notifications@open-mercato.com"
              onChange={(event) => updateStrategy('email', { from: event.target.value || undefined })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="notifications-email-reply">{t('notifications.settings.email.replyTo', 'Reply-to')}</Label>
            <Input
              id="notifications-email-reply"
              value={settings.strategies.email.replyTo ?? ''}
              placeholder="support@open-mercato.com"
              onChange={(event) => updateStrategy('email', { replyTo: event.target.value || undefined })}
            />
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="notifications-email-subject-prefix">{t('notifications.settings.email.subjectPrefix', 'Subject prefix')}</Label>
            <Input
              id="notifications-email-subject-prefix"
              value={settings.strategies.email.subjectPrefix ?? ''}
              placeholder="[Open Mercato]"
              onChange={(event) => updateStrategy('email', { subjectPrefix: event.target.value || undefined })}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('notifications.settings.types.title', 'Delivery channels per type')}</CardTitle>
          <CardDescription>
            {t(
              'notifications.settings.types.description',
              'Delivery channels per notification type. Turning a channel off disables it completely for that type in your tenant — it never delivers and users cannot enable it in their preferences. Turning it on lets users opt in or out per type; required (non-opt-out) types always deliver on enabled channels. Your setting overrides the module default.',
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {types.length === 0 || channels.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t('notifications.settings.types.empty', 'No notification types are registered yet.')}
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/50 text-left">
                    <th className="px-4 py-3 font-medium">
                      {t('notifications.settings.types.typeColumn', 'Notification type')}
                    </th>
                    {channels.map((channel) => (
                      <th key={channel.id} className="px-4 py-3 font-medium">
                        {t(channel.labelKey, channel.id)}
                      </th>
                    ))}
                    <th className="px-4 py-3 font-medium">
                      <div>{t('notifications.settings.types.requiredColumn', 'Required')}</div>
                      <div className="text-xs font-normal text-muted-foreground">
                        {t('notifications.settings.types.requiredHint', 'Users cannot opt out when on.')}
                      </div>
                    </th>
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
                        const cellKey = `${type.id}::${channel.id}`
                        const registeredChannelIds = channels.map((item) => item.id)
                        const channelEnabled = type.channels === null || type.channels.includes(channel.id)
                        return (
                          <td key={channel.id} className="px-4 py-3">
                            {/* The saving spinner is absolutely positioned so it never joins the cell's
                                layout flow — an in-flow sibling would widen the column mid-toggle and
                                make the whole table jump for the duration of the save. */}
                            <span className="relative inline-flex items-center">
                              <Switch
                                checked={channelEnabled}
                                disabled={savingTypeCell !== null}
                                aria-label={`${t(type.labelKey, type.id)} – ${t(channel.labelKey, channel.id)}`}
                                onCheckedChange={(checked) =>
                                  handleTypeChannelToggle(type, channel.id, checked, registeredChannelIds)
                                }
                              />
                              {savingTypeCell === cellKey ? (
                                <Spinner size="sm" className="absolute left-full ml-2" />
                              ) : null}
                            </span>
                          </td>
                        )
                      })}
                      <td className="px-4 py-3">
                        <span className="relative inline-flex">
                          <Switch
                            checked={type.nonOptOut === true}
                            disabled={savingTypeCell !== null}
                            aria-label={`${t(type.labelKey, type.id)} – ${t('notifications.settings.types.requiredColumn', 'Required')}`}
                            onCheckedChange={(checked) => handleTypeNonOptOutToggle(type, checked)}
                          />
                          {savingTypeCell === `${type.id}::nonOptOut` ? (
                            <Spinner size="sm" className="absolute left-full ml-2" />
                          ) : null}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex items-center gap-3">
        <Button type="button" onClick={handleSave} disabled={saving}>
          {saving ? t('notifications.settings.saving', 'Saving...') : t('notifications.settings.save', 'Save settings')}
        </Button>
        {error && <span className="text-sm text-destructive">{error}</span>}
      </div>
    </div>
  )
}

export default NotificationSettingsPageClient
