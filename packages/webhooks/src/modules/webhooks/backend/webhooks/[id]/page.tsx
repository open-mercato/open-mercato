"use client"
import * as React from 'react'
import { useParams, usePathname, useRouter } from 'next/navigation'
import { RotateCw } from 'lucide-react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { useAppEvent } from '@open-mercato/ui/backend/injection/useAppEvent'
import type { ColumnDef } from '@tanstack/react-table'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { FormHeader } from '@open-mercato/ui/backend/forms'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { CrudForm } from '@open-mercato/ui/backend/CrudForm'
import { deleteCrud, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { Notice } from '@open-mercato/ui/primitives/Notice'
import {
  buildWebhookFormContentHeader,
  buildWebhookFormFields,
  buildWebhookFormGroups,
  createWebhookInitialValues,
  normalizeWebhookFormPayload,
  type WebhookFormValues,
} from '../../../components/webhook-form-config'
import { useWebhookFeatureAccess } from '../useWebhookFeatureAccess'
import { WebhookSecretPanel } from '../../../components/WebhookSecretPanel'

type Webhook = {
  id: string
  name: string
  description: string | null
  url: string
  subscribedEvents: string[]
  httpMethod: 'POST' | 'PUT' | 'PATCH'
  isActive: boolean
  maxRetries: number
  timeoutMs: number
  rateLimitPerMinute: number
  autoDisableThreshold: number
  consecutiveFailures: number
  lastSuccessAt: string | null
  lastFailureAt: string | null
  customHeaders: Record<string, string> | null
  createdAt: string
  updatedAt: string
  maskedSecret: string
  previousSecretSetAt: string | null
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

type DeliveryDetail = DeliveryRow & {
  payload: Record<string, unknown>
  responseBody: string | null
  responseHeaders: Record<string, string> | null
  nextRetryAt: string | null
  updatedAt: string
}

const statusVariantMap: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  delivered: 'default',
  pending: 'secondary',
  sending: 'outline',
  failed: 'destructive',
  expired: 'destructive',
}
const DELIVERY_AUTO_REFRESH_INTERVAL_MS = 30000

export default function WebhookDetailPage() {
  const params = useParams()
  const pathname = usePathname()
  const router = useRouter()
  const t = useT()
  const webhookId = React.useMemo(() => resolveWebhookId(params?.id, pathname), [params?.id, pathname])

  const [webhook, setWebhook] = React.useState<Webhook | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [isEditing, setIsEditing] = React.useState(false)

  const [deliveries, setDeliveries] = React.useState<DeliveryRow[]>([])
  const [deliveryPage, setDeliveryPage] = React.useState(1)
  const [deliveryTotal, setDeliveryTotal] = React.useState(0)
  const [deliveryTotalPages, setDeliveryTotalPages] = React.useState(1)
  const [deliveriesLoading, setDeliveriesLoading] = React.useState(false)
  const [isRefreshingDeliveries, setIsRefreshingDeliveries] = React.useState(false)
  const [testDelivery, setTestDelivery] = React.useState<DeliveryDetail | null>(null)
  const [selectedDelivery, setSelectedDelivery] = React.useState<DeliveryDetail | null>(null)
  const [selectedDeliveryLoading, setSelectedDeliveryLoading] = React.useState(false)
  const [revealedSecret, setRevealedSecret] = React.useState<string | null>(null)
  const refreshInFlightRef = React.useRef(false)
  const access = useWebhookFeatureAccess()

  const fetchWebhook = React.useCallback(async (options?: { silent?: boolean }) => {
    if (!webhookId) {
      setError(t('webhooks.errors.notFound'))
      setIsLoading(false)
      return
    }

    const silent = options?.silent === true
    if (!silent) {
      setIsLoading(true)
    }

    setError(null)

    try {
      const call = await apiCall<Webhook>(
        `/api/webhooks/${encodeURIComponent(webhookId)}`,
        undefined,
        { fallback: null },
      )

      if (call.ok && call.result) {
        setWebhook(call.result)
        return
      }

      setError(t('webhooks.errors.notFound'))
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t('webhooks.detail.loadError'))
    } finally {
      if (!silent) {
        setIsLoading(false)
      }
    }
  }, [t, webhookId])

  const fetchDeliveries = React.useCallback(async (options?: { silent?: boolean }) => {
    if (!webhookId) return

    const silent = options?.silent === true
    if (!silent) {
      setDeliveriesLoading(true)
    }

    try {
      const params = new URLSearchParams()
      params.set('webhookId', webhookId)
      params.set('page', String(deliveryPage))
      params.set('pageSize', '20')

      const fallback: DeliveryResponse = { items: [], total: 0, page: deliveryPage, pageSize: 20, totalPages: 1 }
      const call = await apiCall<DeliveryResponse>(
        `/api/webhooks/deliveries?${params.toString()}`,
        undefined,
        { fallback },
      )

      if (call.ok && call.result) {
        setDeliveries(call.result.items)
        setDeliveryTotal(call.result.total)
        setDeliveryTotalPages(call.result.totalPages)
      }
    } finally {
      if (!silent) {
        setDeliveriesLoading(false)
      }
    }
  }, [deliveryPage, webhookId])

  const fetchDeliveryDetail = React.useCallback(async (deliveryId: string): Promise<DeliveryDetail | null> => {
    const call = await apiCall<DeliveryDetail>(
      `/api/webhooks/deliveries/${encodeURIComponent(deliveryId)}`,
      undefined,
      { fallback: null },
    )

    if (!call.ok || !call.result) {
      return null
    }

    return call.result
  }, [])

  const refreshDeliveryState = React.useCallback(async () => {
    if (!webhookId || refreshInFlightRef.current) return

    refreshInFlightRef.current = true
    setIsRefreshingDeliveries(true)

    try {
      await Promise.all([
        fetchWebhook({ silent: true }),
        fetchDeliveries({ silent: true }),
      ])

      const detailIds = [selectedDelivery?.id, testDelivery?.id].filter(
        (value): value is string => typeof value === 'string' && value.length > 0,
      )

      if (detailIds.length > 0) {
        const details = await Promise.all(detailIds.map((deliveryId) => fetchDeliveryDetail(deliveryId)))
        const detailMap = new Map<string, DeliveryDetail>()

        for (const detail of details) {
          if (detail) {
            detailMap.set(detail.id, detail)
          }
        }

        if (selectedDelivery?.id) {
          setSelectedDelivery((current) => current?.id ? (detailMap.get(current.id) ?? current) : current)
        }

        if (testDelivery?.id) {
          setTestDelivery((current) => current?.id ? (detailMap.get(current.id) ?? current) : current)
        }
      }
    } finally {
      refreshInFlightRef.current = false
      setIsRefreshingDeliveries(false)
    }
  }, [fetchDeliveries, fetchDeliveryDetail, fetchWebhook, selectedDelivery?.id, testDelivery?.id, webhookId])

  React.useEffect(() => {
    void fetchWebhook()
  }, [fetchWebhook])

  React.useEffect(() => {
    if (!webhookId) return
    void fetchDeliveries()
  }, [fetchDeliveries, webhookId])

  useAppEvent('webhooks.delivery.*', (event) => {
    const eventWebhookId = typeof event.payload?.webhookId === 'string' ? event.payload.webhookId : null
    if (eventWebhookId !== webhookId) return
    void refreshDeliveryState()
  }, [refreshDeliveryState, webhookId])

  React.useEffect(() => {
    if (!webhookId || isEditing) return

    const intervalId = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return
      void refreshDeliveryState()
    }, DELIVERY_AUTO_REFRESH_INTERVAL_MS)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [isEditing, refreshDeliveryState, webhookId])

  const handleToggleActive = React.useCallback(async () => {
    if (!webhook) return
    try {
      const call = await apiCall<Webhook>(
        `/api/webhooks/${encodeURIComponent(webhook.id)}`,
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
        void refreshDeliveryState()
      }
    } catch {
      flash(t('webhooks.form.updateError'), 'error')
    }
  }, [refreshDeliveryState, webhook, t])

  const handleRotateSecret = React.useCallback(async () => {
    if (!webhook) return
    try {
      const call = await apiCall<{ secret: string }>(
        `/api/webhooks/${encodeURIComponent(webhook.id)}/rotate-secret`,
        { method: 'POST' },
        { fallback: null },
      )
      if (!call.ok || !call.result) {
        flash(t('webhooks.detail.rotateError'), 'error')
        return
      }
      setRevealedSecret(call.result.secret)
      flash(t('webhooks.detail.rotateSuccess'), 'success')
      void refreshDeliveryState()
    } catch {
      flash(t('webhooks.detail.rotateError'), 'error')
    }
  }, [refreshDeliveryState, t, webhook])

  const handleTest = React.useCallback(async () => {
    if (!webhook) return
    try {
      const call = await apiCall<{ delivery: DeliveryDetail }>(
        `/api/webhooks/${encodeURIComponent(webhook.id)}/test`,
        { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}) },
        { fallback: null },
      )
      if (!call.ok || !call.result) {
        flash(t('webhooks.detail.testError'), 'error')
        return
      }
      const deliveryStatus = call.result.delivery.status
      setTestDelivery(call.result.delivery)
      flash(
        deliveryStatus === 'delivered' ? t('webhooks.detail.testSuccess') : t('webhooks.detail.testQueued'),
        deliveryStatus === 'delivered' ? 'success' : 'error',
      )
      void refreshDeliveryState()
    } catch {
      flash(t('webhooks.detail.testError'), 'error')
    }
  }, [refreshDeliveryState, t, webhook])

  const handleRetryDelivery = React.useCallback(async (deliveryId: string) => {
    try {
      const call = await apiCall(
        `/api/webhooks/deliveries/${encodeURIComponent(deliveryId)}/retry`,
        { method: 'POST' },
        { fallback: null },
      )
      if (!call.ok) {
        flash(t('webhooks.deliveries.retryError'), 'error')
        return
      }
      flash(t('webhooks.deliveries.retrySuccess'), 'success')
      void refreshDeliveryState()
    } catch {
      flash(t('webhooks.deliveries.retryError'), 'error')
    }
  }, [refreshDeliveryState, t])

  const handleDelete = React.useCallback(async () => {
    if (!webhook) return
    try {
      await deleteCrud(`webhooks/${encodeURIComponent(webhook.id)}`, { fallbackResult: null })
      flash(t('webhooks.list.deleteSuccess'), 'success')
      router.push('/backend/webhooks')
    } catch {
      flash(t('webhooks.list.deleteError'), 'error')
    }
  }, [router, t, webhook])

  const handleDeliveryOpen = React.useCallback(async (deliveryId: string) => {
    setSelectedDeliveryLoading(true)
    try {
      const detail = await fetchDeliveryDetail(deliveryId)
      if (!detail) {
        flash(t('webhooks.deliveries.loadError'), 'error')
        return
      }
      setSelectedDelivery(detail)
    } catch {
      flash(t('webhooks.deliveries.loadError'), 'error')
    } finally {
      setSelectedDeliveryLoading(false)
    }
  }, [fetchDeliveryDetail, t])

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

  const fields = React.useMemo(() => buildWebhookFormFields(t), [t])
  const groups = React.useMemo(() => buildWebhookFormGroups(t), [t])
  const contentHeader = React.useMemo(() => buildWebhookFormContentHeader(t), [t])
  const menuActions = React.useMemo(() => {
    const items: Array<{ id: string; label: string; onSelect: () => void }> = []
    const isActive = webhook?.isActive ?? false

    if (access.canManage) {
      items.push(
        {
          id: 'edit',
          label: t('webhooks.list.actions.edit'),
          onSelect: () => setIsEditing(true),
        },
        {
          id: 'toggle-active',
          label: isActive ? t('webhooks.detail.actions.deactivate') : t('webhooks.detail.actions.activate'),
          onSelect: () => { void handleToggleActive() },
        },
      )
    }

    if (access.canSecrets) {
      items.push({
        id: 'rotate-secret',
        label: t('webhooks.detail.actions.rotateSecret'),
        onSelect: () => { void handleRotateSecret() },
      })
    }

    if (access.canTest) {
      items.push({
        id: 'test',
        label: t('webhooks.detail.actions.test'),
        onSelect: () => { void handleTest() },
      })
    }

    if (access.canManage) {
      items.push({
        id: 'delete',
        label: t('webhooks.list.actions.delete'),
        onSelect: () => { void handleDelete() },
      })
    }

    return items
  }, [access.canManage, access.canSecrets, access.canTest, handleDelete, handleRotateSecret, handleTest, handleToggleActive, t, webhook?.isActive])

  if (isLoading) return <Page><PageBody><LoadingMessage label={t('webhooks.detail.loading')} /></PageBody></Page>
  if (error || !webhook) return <Page><PageBody><ErrorMessage label={error ?? t('webhooks.errors.notFound')} /></PageBody></Page>

  if (isEditing) {
    return (
      <Page>
        <PageBody>
          <CrudForm
            title={t('webhooks.form.title.edit')}
            backHref={`/backend/webhooks/${webhook.id}`}
            fields={fields}
            groups={groups}
            initialValues={createWebhookInitialValues(webhook)}
            submitLabel={t('common.save')}
            cancelHref={`/backend/webhooks/${webhook.id}`}
            contentHeader={contentHeader}
            onDelete={access.canManage ? handleDelete : undefined}
            onSubmit={async (values) => {
              const payload = normalizeWebhookFormPayload(values as WebhookFormValues, t)
              await updateCrud(`webhooks/${encodeURIComponent(webhook.id)}`, payload)
              flash(t('webhooks.form.updateSuccess'), 'success')
              setIsEditing(false)
              await refreshDeliveryState()
            }}
          />
        </PageBody>
      </Page>
    )
  }

  return (
    <Page>
      <PageBody>
        {revealedSecret ? (
          <WebhookSecretPanel secret={revealedSecret} onClose={() => setRevealedSecret(null)} />
        ) : null}
        <FormHeader
          mode="detail"
          title={webhook.name}
          entityTypeLabel={t('webhooks.nav.title')}
          statusBadge={
            <Badge
              className={webhook.isActive
                ? 'border-transparent bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                : 'border-transparent bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'}
            >
              {webhook.isActive ? t('webhooks.list.status.active') : t('webhooks.list.status.inactive')}
            </Badge>
          }
          backHref="/backend/webhooks"
          menuActions={menuActions}
        />

        <div className="mt-6 space-y-4">
          {!access.isLoading && !access.canManage && !access.canSecrets && !access.canTest ? (
            <Notice compact>{t('webhooks.detail.readOnlyTip')}</Notice>
          ) : null}
          <div className="grid gap-3 lg:grid-cols-2">
            <Notice compact>{t('webhooks.detail.deliveryTip')}</Notice>
            <Notice compact>{t('webhooks.detail.signatureTip')}</Notice>
          </div>
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
              <span className="text-muted-foreground">{t('webhooks.form.rateLimitPerMinute')}:</span>
              <span className="ml-2">{webhook.rateLimitPerMinute}</span>
            </div>
            <div>
              <span className="text-muted-foreground">{t('webhooks.form.autoDisableThreshold')}:</span>
              <span className="ml-2">{webhook.autoDisableThreshold}</span>
            </div>
            <div>
              <span className="text-muted-foreground">{t('webhooks.detail.consecutiveFailures')}:</span>
              <span className="ml-2">{webhook.consecutiveFailures}</span>
            </div>
            <div>
              <span className="text-muted-foreground">{t('webhooks.form.secret')}:</span>
              <span className="ml-2 inline-flex items-center gap-2">
                <span className="font-mono text-xs">{webhook.maskedSecret}</span>
                {access.canSecrets ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => { void handleRotateSecret() }}
                  >
                    <RotateCw className="mr-1.5 size-3.5" />
                    {t('webhooks.detail.actions.rotateSecret')}
                  </Button>
                ) : null}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground">{t('webhooks.list.columns.lastDelivery')}:</span>
              <span className="ml-2">{webhook.lastSuccessAt ?? webhook.lastFailureAt ?? '—'}</span>
            </div>
            <div>
              <span className="text-muted-foreground">{t('webhooks.detail.previousSecretSetAt')}:</span>
              <span className="ml-2">{webhook.previousSecretSetAt ?? '—'}</span>
            </div>
            <div className="col-span-2">
              <span className="text-muted-foreground">{t('webhooks.form.customHeaders')}:</span>
              <pre className="mt-2 rounded border bg-muted/40 p-3 text-xs">
                {webhook.customHeaders ? JSON.stringify(webhook.customHeaders, null, 2) : '—'}
              </pre>
            </div>
          </div>
        </div>

        {testDelivery ? (
          <div className="mt-8 rounded-lg border bg-card p-4">
            <h2 className="text-sm font-semibold">{t('webhooks.detail.testResult')}</h2>
            <div className="mt-3 grid gap-2 text-sm">
              <div>{t('webhooks.deliveries.columns.status')}: {testDelivery.status}</div>
              <div>{t('webhooks.deliveries.columns.responseStatus')}: {testDelivery.responseStatus ?? '—'}</div>
              <div>{t('webhooks.deliveries.columns.duration')}: {testDelivery.durationMs != null ? `${testDelivery.durationMs}ms` : '—'}</div>
              <pre className="overflow-auto rounded border bg-muted/40 p-3 text-xs">
                {JSON.stringify(testDelivery.payload, null, 2)}
              </pre>
            </div>
          </div>
        ) : null}

        <div className="mt-8">
          <DataTable
            title={t('webhooks.deliveries.title')}
            actions={(
              <div className="flex items-center gap-2">
                <span className="hidden text-xs text-muted-foreground md:inline">
                  {t('webhooks.deliveries.autoRefreshHint')}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => { void refreshDeliveryState() }}
                  disabled={isRefreshingDeliveries}
                >
                  {isRefreshingDeliveries
                    ? t('webhooks.deliveries.refreshing')
                    : t('webhooks.deliveries.refresh')}
                </Button>
              </div>
            )}
            columns={deliveryColumns}
            data={deliveries}
            onRowClick={(row) => { void handleDeliveryOpen(row.id) }}
            rowActions={(row) => (
              access.canManage && (row.status === 'failed' || row.status === 'expired')
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
            isLoading={deliveriesLoading || isRefreshingDeliveries}
          />
        </div>

        {selectedDelivery || selectedDeliveryLoading ? (
          <div className="mt-6 rounded-lg border bg-card p-4">
            <h2 className="text-sm font-semibold">{t('webhooks.deliveries.detailTitle')}</h2>
            {selectedDeliveryLoading || !selectedDelivery ? (
              <div className="mt-3 text-sm text-muted-foreground">{t('common.loading')}</div>
            ) : (
              <div className="mt-3 space-y-4 text-sm">
                <div>{t('webhooks.deliveries.columns.status')}: {selectedDelivery.status}</div>
                <div>{t('webhooks.deliveries.columns.responseStatus')}: {selectedDelivery.responseStatus ?? '—'}</div>
                <div>{t('webhooks.deliveries.columns.duration')}: {selectedDelivery.durationMs != null ? `${selectedDelivery.durationMs}ms` : '—'}</div>
                <div>
                  <div className="mb-2 font-medium">{t('webhooks.deliveries.requestBody')}</div>
                  <pre className="overflow-auto rounded border bg-muted/40 p-3 text-xs">
                    {JSON.stringify(selectedDelivery.payload, null, 2)}
                  </pre>
                </div>
                <div>
                  <div className="mb-2 font-medium">{t('webhooks.deliveries.responseBody')}</div>
                  <pre className="overflow-auto rounded border bg-muted/40 p-3 text-xs">
                    {selectedDelivery.responseBody ?? '—'}
                  </pre>
                </div>
                <div>
                  <div className="mb-2 font-medium">{t('webhooks.deliveries.responseHeaders')}</div>
                  <pre className="overflow-auto rounded border bg-muted/40 p-3 text-xs">
                    {selectedDelivery.responseHeaders ? JSON.stringify(selectedDelivery.responseHeaders, null, 2) : '—'}
                  </pre>
                </div>
              </div>
            )}
          </div>
        ) : null}
      </PageBody>
    </Page>
  )
}

function resolveWebhookId(paramValue: string | string[] | undefined, pathname: string | null): string | null {
  if (typeof paramValue === 'string' && paramValue.trim().length > 0) {
    return paramValue
  }

  if (Array.isArray(paramValue)) {
    const first = paramValue.find((value) => typeof value === 'string' && value.trim().length > 0)
    if (first) return first
  }

  if (typeof pathname === 'string') {
    const match = pathname.match(/\/backend\/webhooks\/([^/?#]+)/)
    if (match?.[1]) {
      return decodeURIComponent(match[1])
    }
  }

  return null
}
