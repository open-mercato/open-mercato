"use client"

import * as React from 'react'
import Link from 'next/link'
import { ExternalLink, PencilLine, Plus, Webhook } from 'lucide-react'
import type { InjectionWidgetComponentProps } from '@open-mercato/shared/modules/widgets/injection'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { Alert, AlertDescription, AlertTitle } from '@open-mercato/ui/primitives/alert'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { Switch } from '@open-mercato/ui/primitives/switch'
import { webhookCustomIntegrationId } from '../../../integration'

type WebhookIntegrationContext = {
  state?: {
    isEnabled?: boolean
  } | null
}

type WebhookListItem = {
  id: string
  name: string
  url: string
  isActive: boolean
  subscribedEvents: string[]
}

type WebhookListResponse = {
  items: WebhookListItem[]
  total: number
}

type WebhookIntegrationCredentials = Record<string, string | number | boolean | null> & {
  notifyOnFailedDelivery?: boolean
}

type WebhookCredentialsResponse = {
  credentials: WebhookIntegrationCredentials
}

export default function IntegrationSetupWidget({ context }: InjectionWidgetComponentProps) {
  const t = useT()
  const typedContext = context as WebhookIntegrationContext | undefined
  const [items, setItems] = React.useState<WebhookListItem[]>([])
  const [total, setTotal] = React.useState(0)
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [credentials, setCredentials] = React.useState<WebhookIntegrationCredentials>({})
  const [settingsError, setSettingsError] = React.useState<string | null>(null)
  const [isSavingSettings, setIsSavingSettings] = React.useState(false)

  React.useEffect(() => {
    let mounted = true

    const load = async () => {
      setIsLoading(true)
      setError(null)

      try {
        const [listCall, credentialsCall] = await Promise.all([
          apiCall<WebhookListResponse>(
            '/api/webhooks?page=1&pageSize=6',
            undefined,
            { fallback: { items: [], total: 0 } },
          ),
          apiCall<WebhookCredentialsResponse>(
            `/api/integrations/${encodeURIComponent(webhookCustomIntegrationId)}/credentials`,
            undefined,
            { fallback: null },
          ),
        ])

        if (!mounted) return

        if (!listCall.ok || !listCall.result) {
          setError(t('webhooks.integrationSetup.loadError', 'Failed to load configured webhooks.'))
          setItems([])
          setTotal(0)
        } else {
          setItems(listCall.result.items)
          setTotal(listCall.result.total)
        }

        if (credentialsCall.ok && credentialsCall.result?.credentials) {
          setCredentials(credentialsCall.result.credentials)
          setSettingsError(null)
        } else {
          setSettingsError(t('webhooks.integrationSetup.settingsLoadError', 'Failed to load webhook integration settings.'))
        }
      } catch {
        if (!mounted) return
        setError(t('webhooks.integrationSetup.loadError', 'Failed to load configured webhooks.'))
        setItems([])
        setTotal(0)
        setSettingsError(t('webhooks.integrationSetup.settingsLoadError', 'Failed to load webhook integration settings.'))
      } finally {
        if (mounted) setIsLoading(false)
      }
    }

    void load()

    return () => {
      mounted = false
    }
  }, [t])

  const isEnabled = typedContext?.state?.isEnabled !== false
  const notifyOnFailedDelivery = credentials.notifyOnFailedDelivery === true

  const handleToggleFailedDeliveryNotifications = React.useCallback(async (nextValue: boolean) => {
    const nextCredentials: WebhookIntegrationCredentials = {
      ...credentials,
      notifyOnFailedDelivery: nextValue,
    }

    setCredentials(nextCredentials)
    setIsSavingSettings(true)
    setSettingsError(null)

    try {
      const call = await apiCall(
        `/api/integrations/${encodeURIComponent(webhookCustomIntegrationId)}/credentials`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ credentials: nextCredentials }),
        },
        { fallback: null },
      )

      if (!call.ok) {
        setCredentials(credentials)
        setSettingsError(t('webhooks.integrationSetup.settingsSaveError', 'Failed to save webhook integration settings.'))
        flash(t('webhooks.integrationSetup.settingsSaveError', 'Failed to save webhook integration settings.'), 'error')
        return
      }

      flash(t('webhooks.integrationSetup.settingsSaveSuccess', 'Webhook integration settings saved.'), 'success')
    } catch {
      setCredentials(credentials)
      setSettingsError(t('webhooks.integrationSetup.settingsSaveError', 'Failed to save webhook integration settings.'))
      flash(t('webhooks.integrationSetup.settingsSaveError', 'Failed to save webhook integration settings.'), 'error')
    } finally {
      setIsSavingSettings(false)
    }
  }, [credentials, t])

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {t(
          'webhooks.integrationSetup.summary',
          'Manage Custom Webhooks from the dedicated webhook screen. Turning this integration off blocks outbound deliveries, test sends, retries, and inbound webhook receives.',
        )}
      </p>

      <Alert>
        <Webhook className="h-4 w-4" />
        <AlertTitle>
          {isEnabled
            ? t('webhooks.integrationSetup.enabledTitle', 'Delivery processing is enabled')
            : t('webhooks.integrationSetup.disabledTitle', 'Delivery processing is disabled')}
        </AlertTitle>
        <AlertDescription>
          {isEnabled
            ? t('webhooks.integrationSetup.enabledBody', 'Your saved webhooks can send and receive traffic. Use the links below to review endpoints and open the delivery log on each webhook detail page.')
            : t('webhooks.integrationSetup.disabledBody', 'The integration switch is off, so webhook sends, retries, test deliveries, and inbound receives are blocked until you enable it again.')}
        </AlertDescription>
      </Alert>

      <div className="flex flex-wrap gap-3">
        <Button asChild>
          <Link href="/backend/webhooks">
            <ExternalLink className="mr-2 h-4 w-4" />
            {t('webhooks.integrationSetup.actions.openList', 'Open webhook list')}
          </Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/backend/webhooks/create">
            <Plus className="mr-2 h-4 w-4" />
            {t('webhooks.integrationSetup.actions.create', 'Create webhook')}
          </Link>
        </Button>
      </div>

      <div className="rounded-lg border bg-muted/10 p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-1">
            <h4 className="text-sm font-semibold">
              {t('webhooks.integrationSetup.notificationsTitle', 'Failed delivery notifications')}
            </h4>
            <p className="text-sm text-muted-foreground">
              {t(
                'webhooks.integrationSetup.notificationsBody',
                'Notify admin users when a webhook delivery finally fails after retries are exhausted.',
              )}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Badge variant={notifyOnFailedDelivery ? 'default' : 'outline'}>
              {notifyOnFailedDelivery
                ? t('webhooks.integrationSetup.notificationsEnabled', 'Enabled')
                : t('webhooks.integrationSetup.notificationsDisabled', 'Disabled')}
            </Badge>
            <Switch
              checked={notifyOnFailedDelivery}
              disabled={isSavingSettings}
              onCheckedChange={(checked) => { void handleToggleFailedDeliveryNotifications(checked) }}
            />
          </div>
        </div>
        {settingsError ? (
          <div className="mt-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {settingsError}
          </div>
        ) : null}
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h4 className="text-sm font-semibold">
            {t('webhooks.integrationSetup.configuredTitle', 'Configured webhooks')}
          </h4>
          {total > items.length ? (
            <span className="text-xs text-muted-foreground">
              {t('webhooks.integrationSetup.more', 'Showing {shown} of {total}.', {
                shown: String(items.length),
                total: String(total),
              })}
            </span>
          ) : null}
        </div>

        {isLoading ? (
          <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-3 text-sm text-muted-foreground">
            <Spinner className="h-4 w-4" />
            <span>{t('webhooks.integrationSetup.loading', 'Loading configured webhooks...')}</span>
          </div>
        ) : null}

        {!isLoading && error ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-3 text-sm text-destructive">
            {error}
          </div>
        ) : null}

        {!isLoading && !error && items.length === 0 ? (
          <div className="rounded-md border border-dashed px-3 py-4 text-sm text-muted-foreground">
            {t('webhooks.integrationSetup.empty', 'No webhooks have been configured yet. Create one to start sending or receiving events.')}
          </div>
        ) : null}

        {!isLoading && !error && items.length > 0 ? (
          <div className="space-y-2">
            {items.map((item) => (
              <div
                key={item.id}
                className="flex flex-col gap-3 rounded-lg border bg-muted/20 px-3 py-3 lg:flex-row lg:items-center lg:justify-between"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-foreground">{item.name}</span>
                    <Badge variant={item.isActive ? 'default' : 'outline'}>
                      {item.isActive
                        ? t('webhooks.list.status.active', 'Active')
                        : t('webhooks.list.status.inactive', 'Inactive')}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {t('webhooks.integrationSetup.eventCount', '{count} event patterns', {
                        count: String(item.subscribedEvents.length),
                      })}
                    </span>
                  </div>
                  <code className="block truncate text-xs text-muted-foreground">{item.url}</code>
                </div>

                <Button asChild variant="ghost" size="sm" className="w-fit">
                  <Link href={`/backend/webhooks/${encodeURIComponent(item.id)}`}>
                    <PencilLine className="mr-2 h-4 w-4" />
                    {t('webhooks.integrationSetup.actions.edit', 'Edit webhook')}
                  </Link>
                </Button>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}
