"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCall, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { Switch } from '@open-mercato/ui/primitives/switch'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@open-mercato/ui/primitives/card'

type NotificationDeliveryConfig = {
  appUrl?: string
  panelPath: string
  strategies: {
    database: { enabled: boolean }
    email: { enabled: boolean; from?: string; replyTo?: string; subjectPrefix?: string }
    sms: { enabled: boolean; webhookUrl?: string; from?: string }
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
    sms: { enabled: false },
  },
}

export function NotificationSettingsPageClient() {
  const t = useT()
  const [settings, setSettings] = React.useState<NotificationDeliveryConfig | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

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
      const response = await apiCall<SettingsResponse>('/api/notifications/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
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
            <p className="text-xs text-muted-foreground">{t('notifications.settings.core.appUrlHint', 'Used to build absolute links in email and SMS notifications.')}</p>
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
          <CardTitle>{t('notifications.settings.sms.title', 'SMS strategy')}</CardTitle>
          <CardDescription>{t('notifications.settings.sms.description', 'Send webhook payloads for SMS delivery through your provider.')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="flex items-center justify-between rounded-lg border p-3 md:col-span-2">
            <div>
              <p className="text-sm font-medium">{t('notifications.settings.sms.enabledLabel', 'Enable SMS delivery')}</p>
              <p className="text-xs text-muted-foreground">{t('notifications.settings.sms.enabledHint', 'Webhook payloads include the notification and panel link.')}</p>
            </div>
            <Switch
              checked={settings.strategies.sms.enabled}
              onCheckedChange={(checked) => updateStrategy('sms', { enabled: checked })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="notifications-sms-webhook">{t('notifications.settings.sms.webhookUrl', 'Webhook URL')}</Label>
            <Input
              id="notifications-sms-webhook"
              value={settings.strategies.sms.webhookUrl ?? ''}
              placeholder="https://hooks.your-sms-provider.com/notify"
              onChange={(event) => updateStrategy('sms', { webhookUrl: event.target.value || undefined })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="notifications-sms-from">{t('notifications.settings.sms.from', 'Sender ID')}</Label>
            <Input
              id="notifications-sms-from"
              value={settings.strategies.sms.from ?? ''}
              placeholder="OpenMercato"
              onChange={(event) => updateStrategy('sms', { from: event.target.value || undefined })}
            />
          </div>
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
