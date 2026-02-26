"use client"

import * as React from 'react'
import Link from 'next/link'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import type { ColumnDef } from '@tanstack/react-table'
import { Button } from '@open-mercato/ui/primitives/button'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { ErrorMessage } from '@open-mercato/ui/backend/detail'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { ArrowLeft, RefreshCw } from 'lucide-react'

type EmailRow = {
  id: string
  subject: string
  forwardedByAddress: string
  forwardedByName?: string
  status: string
  processingError?: string
  receivedAt: string
}

type EmailListResponse = {
  items?: EmailRow[]
  total?: number
  page?: number
  totalPages?: number
}

const STATUS_COLORS: Record<string, string> = {
  received: 'bg-blue-100 text-blue-800',
  processing: 'bg-purple-100 text-purple-800',
  processed: 'bg-green-100 text-green-800',
  needs_review: 'bg-amber-100 text-amber-800',
  failed: 'bg-red-100 text-red-800',
}

export default function ProcessingLogPage() {
  const t = useT()
  const [items, setItems] = React.useState<EmailRow[]>([])
  const [total, setTotal] = React.useState(0)
  const [page, setPage] = React.useState(1)
  const [pageSize] = React.useState(25)
  const [statusFilter, setStatusFilter] = React.useState<string | undefined>()
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [retryingEmailId, setRetryingEmailId] = React.useState<string | null>(null)

  const loadEmails = React.useCallback(async () => {
    setIsLoading(true)
    setError(null)
    const params = new URLSearchParams()
    params.set('page', String(page))
    params.set('pageSize', String(pageSize))
    if (statusFilter) params.set('status', statusFilter)

    try {
      const result = await apiCall<EmailListResponse>(`/api/inbox_ops/emails?${params}`)
      if (result?.ok && result.result?.items) {
        setItems(result.result.items)
        setTotal(result.result.total || 0)
      } else {
        setError(t('inbox_ops.log.load_failed', 'Failed to load processing log'))
      }
    } catch {
      setError(t('inbox_ops.log.load_failed', 'Failed to load processing log'))
    }
    setIsLoading(false)
  }, [page, pageSize, statusFilter, t])

  React.useEffect(() => { loadEmails() }, [loadEmails])

  const handleRetryEmail = React.useCallback(async (emailId: string) => {
    setRetryingEmailId(emailId)
    const result = await apiCall<{ ok: boolean; error?: string }>(
      `/api/inbox_ops/emails/${emailId}/reprocess`,
      { method: 'POST' },
    )

    if (result?.ok && result.result?.ok) {
      flash(`${t('inbox_ops.action.retry', 'Retry')} ${t('inbox_ops.status.processing', 'Processing')}`, 'success')
      await loadEmails()
    } else {
      flash(result?.result?.error || t('inbox_ops.extraction_failed', 'Extraction failed'), 'error')
    }

    setRetryingEmailId(null)
  }, [loadEmails, t])

  const columns: ColumnDef<EmailRow>[] = React.useMemo(() => [
    {
      accessorKey: 'subject',
      header: t('inbox_ops.log.subject', 'Subject'),
      cell: ({ row }) => (
        <span className="text-sm font-medium truncate max-w-[300px] block">{row.original.subject}</span>
      ),
    },
    {
      accessorKey: 'forwardedByAddress',
      header: t('inbox_ops.log.from', 'From'),
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground truncate max-w-[200px] block">
          {row.original.forwardedByName || row.original.forwardedByAddress}
        </span>
      ),
    },
    {
      accessorKey: 'status',
      header: t('inbox_ops.log.status', 'Status'),
      cell: ({ row }) => {
        const color = STATUS_COLORS[row.original.status] || 'bg-gray-100 text-gray-800'
        return <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium capitalize ${color}`}>{row.original.status}</span>
      },
    },
    {
      accessorKey: 'receivedAt',
      header: t('inbox_ops.received_at', 'Received'),
      cell: ({ row }) => {
        const d = new Date(row.original.receivedAt)
        return <span className="text-sm text-muted-foreground">{d.toLocaleDateString()} {d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
      },
    },
    {
      accessorKey: 'processingError',
      header: t('inbox_ops.extraction_failed', 'Error'),
      cell: ({ row }) => (
        <span className="text-xs text-red-600 truncate max-w-[280px] block">
          {row.original.processingError || '-'}
        </span>
      ),
    },
    {
      id: 'actions',
      header: t('ui.actions.actions', 'Actions'),
      cell: ({ row }) => {
        const canRetry = row.original.status === 'failed' || row.original.status === 'needs_review'
        if (!canRetry) {
          return <span className="text-xs text-muted-foreground">-</span>
        }

        const isRetrying = retryingEmailId === row.original.id
        return (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8"
            disabled={isRetrying}
            onClick={() => handleRetryEmail(row.original.id)}
          >
            <RefreshCw className={`h-3.5 w-3.5 mr-1 ${isRetrying ? 'animate-spin' : ''}`} />
            {t('inbox_ops.action.retry', 'Retry')}
          </Button>
        )
      },
    },
  ], [handleRetryEmail, retryingEmailId, t])

  const tabs = [
    { label: t('inbox_ops.log.tab_all', 'All'), value: undefined },
    { label: t('inbox_ops.log.tab_received', 'Received'), value: 'received' },
    { label: t('inbox_ops.log.tab_processing', 'Processing'), value: 'processing' },
    { label: t('inbox_ops.log.tab_processed', 'Processed'), value: 'processed' },
    { label: t('inbox_ops.log.tab_needs_review', 'Needs Review'), value: 'needs_review' },
    { label: t('inbox_ops.log.tab_failed', 'Failed'), value: 'failed' },
  ]

  return (
    <Page>
      <div className="flex items-center gap-3 px-3 py-3 md:px-6 md:py-4">
        <Link href="/backend/inbox-ops">
          <Button type="button" variant="ghost" size="sm"><ArrowLeft className="h-4 w-4" /></Button>
        </Link>
        <h1 className="text-lg font-semibold">{t('inbox_ops.processing_log', 'Processing Log')}</h1>
      </div>

      <PageBody>
        <div className="flex items-center gap-2 px-3 py-2 md:px-0 overflow-x-auto">
          {tabs.map((tab) => (
            <Button
              type="button"
              key={tab.value ?? 'all'}
              variant={statusFilter === tab.value ? 'default' : 'outline'}
              size="sm"
              onClick={() => { setStatusFilter(tab.value); setPage(1) }}
            >
              {tab.label}
            </Button>
          ))}
        </div>

        {error ? (
          <ErrorMessage label={error} />
        ) : (
        <div className="overflow-auto">
          <div className="min-w-[640px]">
            <DataTable
              columns={columns}
              data={items}
              isLoading={isLoading}
              pagination={{
                page,
                pageSize,
                total,
                totalPages: Math.ceil(total / pageSize),
                onPageChange: setPage,
              }}
            />
          </div>
        </div>
        )}
      </PageBody>
    </Page>
  )
}
