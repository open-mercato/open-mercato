"use client"

import * as React from 'react'
import Link from 'next/link'
import type { ColumnDef } from '@tanstack/react-table'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { Copy, ExternalLink, Plus } from 'lucide-react'
import { CreatePaymentTransactionDialog } from '@open-mercato/core/modules/payment_gateways/components/CreatePaymentTransactionDialog'

type PaymentLinkRow = {
  id: string
  token: string
  title: string
  description?: string | null
  providerKey: string
  status: string
  transactionId?: string | null
  amount: number | null
  currencyCode: string | null
  createdAt: string | null
}

type PaymentLinksResponse = {
  items?: Array<Record<string, unknown>>
  total?: number
  page?: number
  pageSize?: number
  totalPages?: number
}

function statusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'active': return 'default'
    case 'completed': return 'secondary'
    case 'cancelled': return 'destructive'
    default: return 'outline'
  }
}

function formatAmount(amount: number | null, currency: string | null, locale: string): string {
  if (amount == null || !currency) return '—'
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(amount)
  } catch {
    return `${amount.toFixed(2)} ${currency}`
  }
}

export default function PaymentLinksListPage() {
  const t = useT()
  const [data, setData] = React.useState<PaymentLinkRow[]>([])
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [loading, setLoading] = React.useState(true)
  const [page, setPage] = React.useState(1)
  const [search, setSearch] = React.useState('')
  const [showCreate, setShowCreate] = React.useState(false)
  const pageSize = 20

  const fetchData = React.useCallback(async (currentPage: number, currentSearch: string) => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ page: String(currentPage), pageSize: String(pageSize) })
      if (currentSearch.trim()) params.set('search', currentSearch.trim())
      const response = await readApiResultOrThrow<PaymentLinksResponse>(
        `/api/payment_gateways/payment-links?${params.toString()}`
      )
      const items = (response.items ?? []).map((item): PaymentLinkRow => ({
        id: String(item.id ?? ''),
        token: String(item.token ?? ''),
        title: String(item.title ?? ''),
        description: item.description != null ? String(item.description) : null,
        providerKey: String(item.providerKey ?? ''),
        status: String(item.status ?? 'active'),
        transactionId: item.transactionId != null ? String(item.transactionId) : null,
        amount: typeof item.amount === 'number' ? item.amount : null,
        currencyCode: typeof item.currencyCode === 'string' ? item.currencyCode : null,
        createdAt: item.createdAt != null ? String(item.createdAt) : null,
      }))
      setData(items)
      setTotal(typeof response.total === 'number' ? response.total : items.length)
      setTotalPages(typeof response.totalPages === 'number' ? response.totalPages : 1)
    } catch {
      flash(t('payment_gateways.links.loadError', 'Failed to load payment links'), 'error')
    } finally {
      setLoading(false)
    }
  }, [t])

  React.useEffect(() => {
    fetchData(page, search)
  }, [page, search, fetchData])

  const handleCopyLink = React.useCallback(async (token: string) => {
    const publicUrl = `${window.location.origin}/pay/${token}`
    try {
      await navigator.clipboard.writeText(publicUrl)
      flash(t('payment_gateways.create.linkCopied'), 'success')
    } catch {
      flash(t('payment_gateways.create.copyFailed'), 'error')
    }
  }, [t])

  const columns = React.useMemo<ColumnDef<PaymentLinkRow>[]>(() => [
    {
      accessorKey: 'token',
      header: t('payment_gateways.links.columns.token', 'Token'),
      cell: ({ row }) => (
        <span className="font-mono text-xs">{row.original.token}</span>
      ),
    },
    {
      accessorKey: 'title',
      header: t('payment_gateways.links.columns.title', 'Title'),
      cell: ({ row }) => (
        <span className="font-medium">{row.original.title}</span>
      ),
    },
    {
      accessorKey: 'status',
      header: t('payment_gateways.links.columns.status', 'Status'),
      cell: ({ row }) => (
        <Badge variant={statusVariant(row.original.status)}>
          {row.original.status}
        </Badge>
      ),
    },
    {
      accessorKey: 'amount',
      header: t('payment_gateways.links.columns.amount', 'Amount'),
      cell: ({ row }) => formatAmount(row.original.amount, row.original.currencyCode, 'en'),
    },
    {
      accessorKey: 'providerKey',
      header: t('payment_gateways.links.columns.provider', 'Provider'),
      cell: ({ row }) => (
        <span className="capitalize">{row.original.providerKey}</span>
      ),
    },
    {
      accessorKey: 'createdAt',
      header: t('payment_gateways.links.columns.createdAt', 'Created'),
      cell: ({ row }) => {
        if (!row.original.createdAt) return '—'
        try { return new Date(row.original.createdAt).toLocaleDateString() } catch { return '—' }
      },
    },
  ], [t])

  return (
    <Page>
      <PageBody>
        <DataTable
          columns={columns}
          data={data}
          isLoading={loading}
          title={
            <div>
              <h1 className="text-2xl font-semibold">{t('payment_gateways.links.title', 'Payment Links')}</h1>
              <p className="text-sm text-muted-foreground">{t('payment_gateways.links.description', 'All payment links across providers')}</p>
            </div>
          }
          actions={
            <Button type="button" onClick={() => setShowCreate(true)}>
              <Plus className="mr-2 h-4 w-4" />
              {t('payment_gateways.links.create', 'Create Link')}
            </Button>
          }
          searchValue={search}
          onSearchChange={setSearch}
          searchPlaceholder={t('payment_gateways.links.searchPlaceholder', 'Search by token or title...')}
          rowActions={(row) => (
            <RowActions
              items={[
                {
                  id: 'copy',
                  label: t('payment_gateways.create.copy', 'Copy link'),
                  onSelect: () => handleCopyLink(row.token),
                },
                {
                  id: 'open',
                  label: t('payment_gateways.create.openLink', 'Open link'),
                  href: `/pay/${row.token}`,
                },
                ...(row.transactionId ? [{
                  id: 'transaction',
                  label: t('payment_gateways.links.actions.viewTransaction', 'View transaction'),
                  href: `/backend/payment-gateways?txn=${row.transactionId}`,
                }] : []),
              ]}
            />
          )}
          pagination={{
            page,
            pageSize,
            total,
            totalPages,
            onPageChange: setPage,
          }}
          emptyState={
            <div className="text-center py-8">
              <p className="text-muted-foreground">{t('payment_gateways.links.empty', 'No payment links yet')}</p>
              <p className="text-sm text-muted-foreground mt-1">{t('payment_gateways.links.emptyHint', 'Create a payment transaction with a link enabled to see it here')}</p>
            </div>
          }
        />
        <CreatePaymentTransactionDialog
          open={showCreate}
          onOpenChange={(isOpen) => {
            setShowCreate(isOpen)
            if (!isOpen) fetchData(page, search)
          }}
        />
      </PageBody>
    </Page>
  )
}
