"use client"
import * as React from 'react'
import { useParams } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import type { ColumnDef } from '@tanstack/react-table'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { FormHeader } from '@open-mercato/ui/backend/forms'
import { RowActions } from '@open-mercato/ui/backend/RowActions'

type Webhook = {
  id: string
  name: string
  description: string | null
  url: string
  subscribedEvents: string[]
  httpMethod: string
  isActive: boolean
  maxRetries: number
  timeoutMs: number
  consecutiveFailures: number
  lastSuccessAt: string | null
  lastFailureAt: string | null
  createdAt: string
  updatedAt: string
  maskedSecret: string
}

type DeliveryRow = {
  id: string
  webhookId: string
  eventType: string
  messageId: string
  status: string
  responseStatus: number | null
  errorMessage: string | null
  attemptNumber: number
  maxAttempts: number
  durationMs: number | null
  targetUrl: string
  enqueuedAt: string
  lastAttemptAt: string | null
  deliveredAt: string | null
  createdAt: string
}

type DeliveryResponse = {
  items: DeliveryRow[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

const statusVariantMap: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  delivered: 'default',
  pending: 'secondary',
  sending: 'outline',
  failed: 'destructive',
  expired: 'destructive',
}

export default function WebhookDetailPage() {
  const params = useParams()
  const t = useT()
  const webhookId = params?.id as string

  const [webhook, setWebhook] = React.useState<Webhook | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  const [deliveries, setDeliveries] = React.useState<DeliveryRow[]>([])
  const [deliveryPage, setDeliveryPage] = React.useState(1)
  const [deliveryTotal, setDeliveryTotal] = React.useState(0)
  const [deliveryTotalPages, setDeliveryTotalPages] = React.useState(1)
  const [deliveriesLoading, setDeliveriesLoading] = React.useState(false)
  const [refreshToken, setRefreshToken] = React.useState(0)

  const reload = React.useCallback(() => {
    setRefreshToken((current) => current + 1)
  }, [])

  React.useEffect(() => {
    if (!webhookId) return
    let cancelled = false
    async function loadDetail() {
      setIsLoading(true)
      setError(null)
      try {
        const call = await apiCall<Webhook>(
          `/api/webhooks/webhooks/${encodeURIComponent(webhookId)}`,
          undefined,
          { fallback: null },
        )
        if (!cancelled && call.ok && call.result) {
          setWebhook(call.result)
          return
        }
        if (!cancelled) setError(t('webhooks.errors.notFound'))
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : t('webhooks.detail.loadError'))
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    loadDetail()
    return () => { cancelled = true }
  }, [refreshToken, t, webhookId])

  React.useEffect(() => {
    if (!webhookId) return
    let cancelled = false
    async function loadDeliveries() {
      setDeliveriesLoading(true)
      try {
        const params = new URLSearchParams()
        params.set('webhookId', webhookId)
        params.set('page', String(deliveryPage))
        params.set('pageSize', '20')
        const fallback: DeliveryResponse = { items: [], total: 0, page: deliveryPage, pageSize: 20, totalPages: 1 }
        const call = await apiCall<DeliveryResponse>(
          `/api/webhooks/webhook-deliveries?${params.toString()}`,
          undefined,
          { fallback },
        )
        if (!cancelled && call.ok && call.result) {
          setDeliveries(call.result.items)
          setDeliveryTotal(call.result.total)
          setDeliveryTotalPages(call.result.totalPages)
        }
      } finally {
        if (!cancelled) setDeliveriesLoading(false)
      }
    }
    loadDeliveries()
    return () => { cancelled = true }
  }, [deliveryPage, refreshToken, webhookId])

  const handleToggleActive = React.useCallback(async () => {
    if (!webhook) return
    try {
      const call = await apiCall<Webhook>(
        `/api/webhooks/webhooks?id=${webhook.id}`,
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ isActive: !webhook.isActive }),
        },
        { fallback: null },
      )
      if (call.ok) {
        setWebhook((prev) => prev ? { ...prev, isActive: !prev.isActive } : prev)
        flash(t('webhooks.form.updateSuccess'), 'success')
        reload()
      }
    } catch {
      flash(t('webhooks.form.updateError'), 'error')
    }
  }, [reload, webhook, t])

  const handleRotateSecret = React.useCallback(async () => {
    if (!webhook) return
    try {
      const call = await apiCall<{ secret: string }>(
        `/api/webhooks/webhooks/${encodeURIComponent(webhook.id)}/rotate-secret`,
        { method: 'POST' },
        { fallback: null },
      )
      if (!call.ok || !call.result) {
        flash(t('webhooks.detail.rotateError'), 'error')
        return
      }
      flash(`${t('webhooks.detail.rotateSuccess')}: ${call.result.secret}`, 'success')
      reload()
    } catch {
      flash(t('webhooks.detail.rotateError'), 'error')
    }
  }, [reload, t, webhook])

  const handleTest = React.useCallback(async () => {
    if (!webhook) return
    try {
      const call = await apiCall<{ delivery: { status: string } }>(
        `/api/webhooks/webhooks/${encodeURIComponent(webhook.id)}/test`,
        { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}) },
        { fallback: null },
      )
      if (!call.ok || !call.result) {
        flash(t('webhooks.detail.testError'), 'error')
        return
      }
      const deliveryStatus = call.result.delivery.status
      flash(
        deliveryStatus === 'delivered' ? t('webhooks.detail.testSuccess') : t('webhooks.detail.testQueued'),
        deliveryStatus === 'delivered' ? 'success' : 'error',
      )
      reload()
    } catch {
      flash(t('webhooks.detail.testError'), 'error')
    }
  }, [reload, t, webhook])

  const handleRetryDelivery = React.useCallback(async (deliveryId: string) => {
    try {
      const call = await apiCall(
        `/api/webhooks/webhook-deliveries/${encodeURIComponent(deliveryId)}/retry`,
        { method: 'POST' },
        { fallback: null },
      )
      if (!call.ok) {
        flash(t('webhooks.deliveries.retryError'), 'error')
        return
      }
      flash(t('webhooks.deliveries.retrySuccess'), 'success')
      reload()
    } catch {
      flash(t('webhooks.deliveries.retryError'), 'error')
    }
  }, [reload, t])

  const deliveryColumns = React.useMemo<ColumnDef<DeliveryRow>[]>(() => [
    { accessorKey: 'eventType', header: t('webhooks.deliveries.columns.event') },
    {
      accessorKey: 'status',
      header: t('webhooks.deliveries.columns.status'),
      cell: ({ row }) => (
        <Badge variant={statusVariantMap[row.original.status] ?? 'secondary'}>
          {t(`webhooks.deliveries.status.${row.original.status}` as Parameters<typeof t>[0])}
        </Badge>
      ),
    },
    {
      accessorKey: 'responseStatus',
      header: t('webhooks.deliveries.columns.responseStatus'),
      cell: ({ row }) => row.original.responseStatus ?? '—',
    },
    {
      accessorKey: 'attemptNumber',
      header: t('webhooks.deliveries.columns.attempts'),
      cell: ({ row }) => `${row.original.attemptNumber}/${row.original.maxAttempts}`,
    },
    {
      accessorKey: 'durationMs',
      header: t('webhooks.deliveries.columns.duration'),
      cell: ({ row }) => row.original.durationMs != null ? `${row.original.durationMs}ms` : '—',
    },
    {
      accessorKey: 'createdAt',
      header: t('webhooks.deliveries.columns.enqueuedAt'),
      cell: ({ row }) => {
        try { return new Date(row.original.enqueuedAt).toLocaleString() }
        catch { return '—' }
      },
    },
  ], [t])

  if (isLoading) return <Page><PageBody><LoadingMessage label={t('webhooks.detail.loading')} /></PageBody></Page>
  if (error || !webhook) return <Page><PageBody><ErrorMessage label={error ?? t('webhooks.errors.notFound')} /></PageBody></Page>

  return (
    <Page>
      <PageBody>
        <FormHeader
          mode="detail"
          title={webhook.name}
          entityTypeLabel={t('webhooks.nav.title')}
          statusBadge={
            <Badge variant={webhook.isActive ? 'default' : 'secondary'}>
              {webhook.isActive ? t('webhooks.list.status.active') : t('webhooks.list.status.inactive')}
            </Badge>
          }
          backHref="/backend/webhooks"
          menuActions={[
            {
              id: 'toggle-active',
              label: webhook.isActive ? t('webhooks.detail.actions.deactivate') : t('webhooks.detail.actions.activate'),
              onSelect: handleToggleActive,
            },
            {
              id: 'rotate-secret',
              label: t('webhooks.detail.actions.rotateSecret'),
              onSelect: handleRotateSecret,
            },
            {
              id: 'test',
              label: t('webhooks.detail.actions.test'),
              onSelect: handleTest,
            },
          ]}
        />

        <div className="mt-6 space-y-4">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">{t('webhooks.form.url')}:</span>
              <code className="ml-2 text-xs break-all">{webhook.url}</code>
            </div>
            <div>
              <span className="text-muted-foreground">{t('webhooks.form.httpMethod')}:</span>
              <span className="ml-2">{webhook.httpMethod}</span>
            </div>
            <div>
              <span className="text-muted-foreground">{t('webhooks.form.subscribedEvents')}:</span>
              <span className="ml-2 text-xs">{webhook.subscribedEvents.join(', ')}</span>
            </div>
            <div>
              <span className="text-muted-foreground">{t('webhooks.form.maxRetries')}:</span>
              <span className="ml-2">{webhook.maxRetries}</span>
            </div>
            <div>
              <span className="text-muted-foreground">{t('webhooks.form.secret')}:</span>
              <span className="ml-2 font-mono text-xs">{webhook.maskedSecret}</span>
            </div>
          </div>
        </div>

        <div className="mt-8">
          <DataTable
            title={t('webhooks.deliveries.title')}
            columns={deliveryColumns}
            data={deliveries}
            rowActions={(row) => (
              row.status === 'failed' || row.status === 'expired'
                ? (
                  <RowActions
                    items={[
                      {
                        id: 'retry',
                        label: t('webhooks.deliveries.actions.retry'),
                        onSelect: () => { void handleRetryDelivery(row.id) },
                      },
                    ]}
                  />
                )
                : null
            )}
            perspective={{ tableId: 'webhooks.deliveries' }}
            pagination={{
              page: deliveryPage,
              pageSize: 20,
              total: deliveryTotal,
              totalPages: deliveryTotalPages,
              onPageChange: setDeliveryPage,
            }}
            isLoading={deliveriesLoading}
          />
        </div>
      </PageBody>
    </Page>
  )
}
