"use client"
import * as React from 'react'
import Link from 'next/link'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { Button } from '@open-mercato/ui/primitives/button'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { apiCall, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterBar'

type Row = {
  id: string
  storeId: string | null
  productId: string | null
  variantId: string | null
  isStockManaged: boolean
  allowBackorder: boolean
  isActive: boolean
  updatedAt: string | null
}

type ResponsePayload = {
  items: Row[]
  total: number
  page?: number
  pageSize?: number
  totalPages: number
  totalIsCapped?: boolean
}

function ScopeCell({ value, allLabel }: { value: string | null; allLabel: string }) {
  if (!value) return <span className="text-muted-foreground">{allLabel}</span>
  return <code className="text-xs">{value}</code>
}

export default function AvailabilityPoliciesListPage() {
  const [rows, setRows] = React.useState<Row[]>([])
  const [page, setPage] = React.useState(1)
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [totalIsCapped, setTotalIsCapped] = React.useState(false)
  const [isLoading, setIsLoading] = React.useState(true)
  const [reloadToken, setReloadToken] = React.useState(0)
  const scopeVersion = useOrganizationScopeVersion()
  const t = useT()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const [filterValues, setFilterValues] = React.useState<FilterValues>({})

  const filters = React.useMemo<FilterDef[]>(() => [
    { id: 'productId', label: t('availability.policies.list.columns.product'), type: 'text' },
    { id: 'storeId', label: t('availability.policies.list.columns.store'), type: 'text' },
    {
      id: 'isActive',
      label: t('availability.policies.list.columns.active'),
      type: 'select',
      options: [
        { value: 'true', label: t('common.yes') },
        { value: 'false', label: t('common.no') },
      ],
    },
  ], [t])

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setIsLoading(true)
      try {
        const params = new URLSearchParams()
        params.set('page', String(page))
        params.set('pageSize', '50')
        const productId = typeof filterValues.productId === 'string' ? filterValues.productId.trim() : ''
        const storeId = typeof filterValues.storeId === 'string' ? filterValues.storeId.trim() : ''
        const isActive = typeof filterValues.isActive === 'string' ? filterValues.isActive : ''
        if (productId) params.set('productId', productId)
        if (storeId) params.set('storeId', storeId)
        if (isActive) params.set('isActive', isActive)
        const fallback: ResponsePayload = { items: [], total: 0, page, totalPages: 1 }
        const call = await apiCall<ResponsePayload>(`/api/availability/policies?${params.toString()}`, undefined, { fallback })
        if (!call.ok) {
          const errorPayload = call.result as { error?: string } | undefined
          const message = typeof errorPayload?.error === 'string' ? errorPayload.error : t('availability.policies.list.error.loadFailed')
          flash(message, 'error')
          return
        }
        const payload = call.result ?? fallback
        if (!cancelled) {
          setRows(Array.isArray(payload.items) ? payload.items : [])
          setTotal(payload.total || 0)
          setTotalPages(payload.totalPages || 1)
          setTotalIsCapped(payload?.totalIsCapped === true)
        }
      } catch (error) {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : t('availability.policies.list.error.loadFailed')
          flash(message, 'error')
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [page, reloadToken, scopeVersion, filterValues, t])

  const handleDelete = React.useCallback(async (row: Row) => {
    const confirmed = await confirm({ title: t('availability.policies.list.confirmDelete'), variant: 'destructive' })
    if (!confirmed) return
    try {
      const call = await withScopedApiRequestHeaders(buildOptimisticLockHeader(row.updatedAt), () =>
        apiCall<{ error?: string }>(`/api/availability/policies?id=${encodeURIComponent(row.id)}`, { method: 'DELETE' }, { fallback: null }),
      )
      if (!call.ok) {
        const errorPayload = call.result as { error?: string } | undefined
        const message = typeof errorPayload?.error === 'string' ? errorPayload.error : t('availability.policies.list.error.deleteFailed')
        flash(message, 'error')
        return
      }
      flash(t('availability.policies.list.success.deleted'), 'success')
      setReloadToken((token) => token + 1)
    } catch (error) {
      const message = error instanceof Error ? error.message : t('availability.policies.list.error.deleteFailed')
      flash(message, 'error')
    }
  }, [confirm, t])

  const columns = React.useMemo<ColumnDef<Row>[]>(() => [
    {
      accessorKey: 'productId',
      header: t('availability.policies.list.columns.product'),
      cell: ({ row }) => <ScopeCell value={row.original.productId} allLabel={t('availability.policies.list.storeDefault')} />,
    },
    {
      accessorKey: 'variantId',
      header: t('availability.policies.list.columns.variant'),
      cell: ({ row }) => <ScopeCell value={row.original.variantId} allLabel={t('availability.policies.list.allVariants')} />,
    },
    {
      accessorKey: 'storeId',
      header: t('availability.policies.list.columns.store'),
      cell: ({ row }) => <ScopeCell value={row.original.storeId} allLabel={t('availability.policies.list.allStores')} />,
    },
    {
      accessorKey: 'isStockManaged',
      header: t('availability.policies.list.columns.stockManaged'),
      cell: ({ row }) => (row.original.isStockManaged ? t('common.yes') : t('common.no')),
    },
    {
      accessorKey: 'allowBackorder',
      header: t('availability.policies.list.columns.backorder'),
      cell: ({ row }) => (row.original.allowBackorder ? t('common.yes') : t('common.no')),
    },
    {
      accessorKey: 'isActive',
      header: t('availability.policies.list.columns.active'),
      cell: ({ row }) => (row.original.isActive ? t('common.yes') : t('common.no')),
    },
  ], [t])

  return (
    <Page>
      <PageBody>
        <DataTable
          title={t('availability.policies.list.title')}
          titleHeadingLevel={1}
          actions={(
            <Button asChild>
              <Link href="/backend/availability/policies/create">{t('availability.policies.list.actions.create')}</Link>
            </Button>
          )}
          columns={columns}
          data={rows}
          filters={filters}
          filterValues={filterValues}
          onFiltersApply={(values) => { setFilterValues(values); setPage(1) }}
          onFiltersClear={() => { setFilterValues({}); setPage(1) }}
          perspective={{ tableId: 'availability.policies.list' }}
          rowActions={(row) => (
            <RowActions items={[
              { id: 'edit', label: t('common.edit'), href: `/backend/availability/policies/${row.id}` },
              { id: 'delete', label: t('common.delete'), destructive: true, onSelect: () => { void handleDelete(row) } },
            ]} />
          )}
          pagination={{ page, pageSize: 50, total, totalPages, totalIsCapped, onPageChange: setPage }}
          isLoading={isLoading}
        />
      </PageBody>
      {ConfirmDialogElement}
    </Page>
  )
}
