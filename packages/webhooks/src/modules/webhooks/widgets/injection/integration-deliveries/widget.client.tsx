"use client"

import * as React from 'react'
import Link from 'next/link'
import type { ColumnDef } from '@tanstack/react-table'
import type { InjectionWidgetComponentProps } from '@open-mercato/shared/modules/widgets/injection'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { JsonDisplay } from '@open-mercato/ui/backend/JsonDisplay'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { Spinner } from '@open-mercato/ui/primitives/spinner'

type DeliveryRow = {
  id: string
  webhookId: string
  webhookName: string | null
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

export default function IntegrationDeliveriesWidget(_props: InjectionWidgetComponentProps) {
  const t = useT()
  const [items, setItems] = React.useState<DeliveryRow[]>([])
  const [page, setPage] = React.useState(1)
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [status, setStatus] = React.useState('')
  const [isLoading, setIsLoading] = React.useState(true)
  const [selectedRow, setSelectedRow] = React.useState<DeliveryRow | null>(null)
  const [selectedDelivery, setSelectedDelivery] = React.useState<DeliveryDetail | null>(null)
  const [selectedDeliveryLoading, setSelectedDeliveryLoading] = React.useState(false)
  const [refreshToken, setRefreshToken] = React.useState(0)

  const reload = React.useCallback(() => {
    setRefreshToken((current) => current + 1)
  }, [])

  React.useEffect(() => {
    let cancelled = false

    async function loadDeliveries() {
      setIsLoading(true)

      try {
        const params = new URLSearchParams({
          page: String(page),
          pageSize: '20',
        })
        if (status) params.set('status', status)

        const call = await apiCall<DeliveryResponse>(
          `/api/webhooks/deliveries?${params.toString()}`,
          undefined,
          {
            fallback: {
              items: [],
              total: 0,
              page,
              pageSize: 20,
              totalPages: 1,
            },
          },
        )

        if (!cancelled && call.ok && call.result) {
          setItems(call.result.items)
          setTotal(call.result.total)
          setTotalPages(call.result.totalPages)
        }
      } catch {
        if (!cancelled) {
          flash(t('webhooks.integrationDeliveries.loadError', 'Failed to load webhook deliveries.'), 'error')
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    void loadDeliveries()

    return () => {
      cancelled = true
    }
  }, [page, refreshToken, status, t])

  const handleDeliveryOpen = React.useCallback(async (row: DeliveryRow) => {
    setSelectedRow(row)
    setSelectedDeliveryLoading(true)

    try {
      const call = await apiCall<DeliveryDetail>(
        `/api/webhooks/deliveries/${encodeURIComponent(row.id)}`,
        undefined,
        { fallback: null },
      )

      if (!call.ok || !call.result) {
        flash(t('webhooks.deliveries.loadError'), 'error')
        return
      }

      setSelectedDelivery(call.result)
    } catch {
      flash(t('webhooks.deliveries.loadError'), 'error')
    } finally {
      setSelectedDeliveryLoading(false)
    }
  }, [t])

  const columns = React.useMemo<ColumnDef<DeliveryRow>[]>(() => [
    {
      accessorKey: 'webhookName',
      header: t('webhooks.integrationDeliveries.columns.webhook', 'Webhook'),
      cell: ({ row }) => (
        <Link href={`/backend/webhooks/${row.original.webhookId}`} className="font-medium hover:underline">
          {row.original.webhookName ?? row.original.webhookId}
        </Link>
      ),
    },
    {
      accessorKey: 'eventType',
      header: t('webhooks.deliveries.columns.event'),
    },
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
      accessorKey: 'enqueuedAt',
      header: t('webhooks.deliveries.columns.enqueuedAt'),
      cell: ({ row }) => {
        try {
          return new Date(row.original.enqueuedAt).toLocaleString()
        } catch {
          return '—'
        }
      },
    },
  ], [t])

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {t(
          'webhooks.integrationDeliveries.summary',
          'Review delivery attempts across every configured webhook endpoint. Open a row to inspect the request and response payloads.',
        )}
      </p>

      <DataTable
        title={t('webhooks.deliveries.title')}
        columns={columns}
        data={items}
        onRowClick={(row) => { void handleDeliveryOpen(row) }}
        toolbar={(
          <div className="flex flex-wrap items-center gap-3">
            <select
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              value={status}
              onChange={(event) => {
                setPage(1)
                setStatus(event.target.value)
              }}
            >
              <option value="">{t('webhooks.integrationDeliveries.filters.allStatuses', 'All statuses')}</option>
              <option value="pending">{t('webhooks.deliveries.status.pending')}</option>
              <option value="sending">{t('webhooks.deliveries.status.sending')}</option>
              <option value="delivered">{t('webhooks.deliveries.status.delivered')}</option>
              <option value="failed">{t('webhooks.deliveries.status.failed')}</option>
              <option value="expired">{t('webhooks.deliveries.status.expired')}</option>
            </select>
            <Button type="button" variant="outline" size="sm" onClick={() => reload()}>
              {t('common.refresh', 'Refresh')}
            </Button>
          </div>
        )}
        perspective={{ tableId: 'webhooks.integration-deliveries' }}
        pagination={{
          page,
          pageSize: 20,
          total,
          totalPages,
          onPageChange: setPage,
        }}
        isLoading={isLoading}
      />

      {selectedRow || selectedDeliveryLoading ? (
        <div className="rounded-lg border bg-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-semibold">{t('webhooks.deliveries.detailTitle')}</h2>
            {selectedRow ? (
              <Button asChild type="button" variant="outline" size="sm">
                <Link href={`/backend/webhooks/${selectedRow.webhookId}`}>
                  {t('webhooks.integrationDeliveries.actions.openWebhook', 'Open webhook')}
                </Link>
              </Button>
            ) : null}
          </div>
          {selectedDeliveryLoading || !selectedDelivery ? (
            <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner className="h-4 w-4" />
              <span>{t('common.loading')}</span>
            </div>
          ) : (
            <div className="mt-3 space-y-4 text-sm">
              <div className="grid gap-2 md:grid-cols-2">
                <div>
                  <span className="text-muted-foreground">{t('webhooks.integrationDeliveries.columns.webhook', 'Webhook')}:</span>
                  <span className="ml-2">{selectedRow?.webhookName ?? selectedDelivery.webhookId}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">{t('webhooks.deliveries.columns.status')}:</span>
                  <span className="ml-2">{selectedDelivery.status}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">{t('webhooks.deliveries.columns.responseStatus')}:</span>
                  <span className="ml-2">{selectedDelivery.responseStatus ?? '—'}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">{t('webhooks.deliveries.columns.duration')}:</span>
                  <span className="ml-2">{selectedDelivery.durationMs != null ? `${selectedDelivery.durationMs}ms` : '—'}</span>
                </div>
                <div className="md:col-span-2">
                  <span className="text-muted-foreground">{t('webhooks.integrationDeliveries.errorMessage', 'Error message')}:</span>
                  <span className="ml-2">{selectedDelivery.errorMessage ?? '—'}</span>
                </div>
              </div>

              <JsonDisplay
                data={selectedDelivery.payload}
                title={t('webhooks.deliveries.requestBody')}
                defaultExpanded
                maxInitialDepth={2}
                theme="dark"
                className="p-4"
              />

              <div className="rounded-lg border bg-muted/20 p-4">
                <div className="mb-2 text-sm font-medium">{t('webhooks.deliveries.responseBody')}</div>
                <pre className="overflow-auto whitespace-pre-wrap break-words text-xs">
                  {selectedDelivery.responseBody ?? '—'}
                </pre>
              </div>

              <JsonDisplay
                data={selectedDelivery.responseHeaders ?? {}}
                title={t('webhooks.deliveries.responseHeaders')}
                defaultExpanded
                maxInitialDepth={1}
                theme="dark"
                className="p-4"
              />
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}
