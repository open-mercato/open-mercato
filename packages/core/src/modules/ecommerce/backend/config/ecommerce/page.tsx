'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import type { ColumnDef } from '@tanstack/react-table'
import { Button } from '@open-mercato/ui/primitives/button'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { apiCall, apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'

type StoreRow = {
  id: string
  name: string
  code: string
  status: string
  default_locale: string | null
  default_currency_code: string | null
  is_primary: boolean | null
}

type StoresResponse = {
  items?: Array<Record<string, unknown>>
  total?: number
  totalPages?: number
}

function mapStoreRow(item: Record<string, unknown>): StoreRow | null {
  const id = typeof item.id === 'string' ? item.id : null
  if (!id) return null
  return {
    id,
    name: typeof item.name === 'string' ? item.name : '',
    code: typeof item.code === 'string' ? item.code : '',
    status: typeof item.status === 'string' ? item.status : 'draft',
    default_locale: typeof item.default_locale === 'string' ? item.default_locale : null,
    default_currency_code: typeof item.default_currency_code === 'string' ? item.default_currency_code : null,
    is_primary: typeof item.is_primary === 'boolean' ? item.is_primary : null,
  }
}

function statusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'active') return 'default'
  if (status === 'archived') return 'secondary'
  return 'outline'
}

export default function EcommerceStoresPage() {
  const t = useT()
  const router = useRouter()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const scopeVersion = useOrganizationScopeVersion()

  const [rows, setRows] = React.useState<StoreRow[]>([])
  const [page, setPage] = React.useState(1)
  const [pageSize] = React.useState(20)
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [search, setSearch] = React.useState('')
  const [isLoading, setIsLoading] = React.useState(true)
  const [reloadToken, setReloadToken] = React.useState(0)

  const queryParams = React.useMemo(() => {
    const params = new URLSearchParams()
    params.set('page', String(page))
    params.set('pageSize', String(pageSize))
    if (search.trim()) params.set('search', search.trim())
    return params.toString()
  }, [page, pageSize, search])

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setIsLoading(true)
      try {
        const fallback: StoresResponse = { items: [], total: 0, totalPages: 1 }
        const call = await apiCall<StoresResponse>(`/api/ecommerce/stores?${queryParams}`, undefined, { fallback })
        if (cancelled) return
        if (!call.ok) {
          flash(t('ecommerce.stores.list.loadError', 'Failed to load stores'), 'error')
          return
        }
        const payload = call.result ?? fallback
        const items = Array.isArray(payload.items) ? payload.items : []
        setRows(items.map((i) => mapStoreRow(i as Record<string, unknown>)).filter((r): r is StoreRow => !!r))
        setTotal(typeof payload.total === 'number' ? payload.total : 0)
        setTotalPages(typeof payload.totalPages === 'number' ? payload.totalPages : 1)
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [queryParams, reloadToken, scopeVersion, t])

  const handleDelete = React.useCallback(async (store: StoreRow) => {
    const confirmed = await confirm({
      title: t('ecommerce.stores.list.deleteConfirm', 'Delete store "{{name}}"?', { name: store.name }),
      variant: 'destructive',
    })
    if (!confirmed) return
    try {
      await apiCallOrThrow(
        `/api/ecommerce/stores?id=${encodeURIComponent(store.id)}`,
        { method: 'DELETE', headers: { 'content-type': 'application/json' } },
        { errorMessage: t('ecommerce.stores.list.deleteError', 'Failed to delete store') },
      )
      setRows((prev) => prev.filter((r) => r.id !== store.id))
      setTotal((prev) => Math.max(prev - 1, 0))
      flash(t('ecommerce.stores.list.deleteSuccess', 'Store deleted'), 'success')
    } catch (err) {
      flash(err instanceof Error ? err.message : t('ecommerce.stores.list.deleteError', 'Failed to delete store'), 'error')
    }
  }, [confirm, t])

  const columns = React.useMemo<ColumnDef<StoreRow>[]>(() => [
    {
      accessorKey: 'name',
      header: t('ecommerce.stores.fields.name', 'Name'),
      cell: ({ row }) => (
        <Link href={`/backend/config/ecommerce/${row.original.id}`} className="font-medium hover:underline">
          {row.original.name}
        </Link>
      ),
    },
    {
      accessorKey: 'code',
      header: t('ecommerce.stores.fields.code', 'Code'),
      cell: ({ row }) => <span className="font-mono text-sm">{row.original.code}</span>,
    },
    {
      accessorKey: 'status',
      header: t('ecommerce.stores.fields.status', 'Status'),
      cell: ({ row }) => (
        <Badge variant={statusVariant(row.original.status)}>
          {t(`ecommerce.stores.status.${row.original.status}`, row.original.status)}
        </Badge>
      ),
    },
    {
      accessorKey: 'default_locale',
      header: t('ecommerce.stores.fields.defaultLocale', 'Locale'),
      cell: ({ row }) => <span className="text-sm">{row.original.default_locale ?? '—'}</span>,
    },
    {
      accessorKey: 'default_currency_code',
      header: t('ecommerce.stores.fields.defaultCurrencyCode', 'Currency'),
      cell: ({ row }) => <span className="font-mono text-sm">{row.original.default_currency_code ?? '—'}</span>,
    },
    {
      accessorKey: 'is_primary',
      header: t('ecommerce.stores.fields.isPrimary', 'Primary'),
      cell: ({ row }) => row.original.is_primary
        ? <Badge variant="default">{t('ecommerce.stores.fields.isPrimary', 'Primary')}</Badge>
        : null,
    },
  ], [t])

  return (
    <Page>
      <PageBody>
        <DataTable<StoreRow>
          title={t('ecommerce.stores.title', 'Stores')}
          refreshButton={{
            label: t('ecommerce.stores.list.actions.refresh', 'Refresh'),
            onRefresh: () => { setSearch(''); setPage(1); setReloadToken((n) => n + 1) },
          }}
          actions={(
            <Button asChild>
              <Link href="/backend/config/ecommerce/create">
                {t('ecommerce.stores.create', 'Create Store')}
              </Link>
            </Button>
          )}
          columns={columns}
          data={rows}
          searchValue={search}
          onSearchChange={(v) => { setSearch(v); setPage(1) }}
          searchPlaceholder={t('ecommerce.stores.list.searchPlaceholder', 'Search stores...')}
          onRowClick={(row) => router.push(`/backend/config/ecommerce/${row.id}`)}
          rowActions={(row) => (
            <RowActions
              items={[
                {
                  id: 'edit',
                  label: t('ecommerce.stores.list.actions.edit', 'Edit'),
                  onSelect: () => router.push(`/backend/config/ecommerce/${row.id}`),
                },
                {
                  id: 'delete',
                  label: t('ecommerce.stores.list.actions.delete', 'Delete'),
                  destructive: true,
                  onSelect: () => handleDelete(row),
                },
              ]}
            />
          )}
          pagination={{ page, pageSize, total, totalPages, onPageChange: setPage }}
          isLoading={isLoading}
        />
      </PageBody>
      {ConfirmDialogElement}
    </Page>
  )
}
