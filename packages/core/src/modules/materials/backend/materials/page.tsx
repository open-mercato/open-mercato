'use client'

import * as React from 'react'
import Link from 'next/link'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import type { ColumnDef } from '@tanstack/react-table'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { BooleanIcon } from '@open-mercato/ui/backend/ValueIcons'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { Plus } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterBar'

type MaterialRow = {
  id: string
  code: string
  name: string
  description?: string | null
  kind: 'raw' | 'semi' | 'final' | 'tool' | 'indirect'
  lifecycle_state: 'draft' | 'active' | 'phase_out' | 'obsolete'
  is_purchasable: boolean
  is_sellable: boolean
  is_stockable: boolean
  is_producible: boolean
  is_active: boolean
  organization_id: string
  tenant_id: string
  created_at: string
  updated_at: string
}

type ResponsePayload = {
  items: MaterialRow[]
  total: number
  page: number
  totalPages: number
}

const KIND_VALUES = ['raw', 'semi', 'final', 'tool', 'indirect'] as const
const LIFECYCLE_VALUES = ['draft', 'active', 'phase_out', 'obsolete'] as const

export default function MaterialsListPage() {
  const t = useT()
  const { confirm: confirmDialog, ConfirmDialogElement } = useConfirmDialog()
  const [rows, setRows] = React.useState<MaterialRow[]>([])
  const [page, setPage] = React.useState(1)
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [search, setSearch] = React.useState('')
  const [filters, setFilters] = React.useState<FilterValues>({})
  const [isLoading, setIsLoading] = React.useState(true)
  const [reloadToken, setReloadToken] = React.useState(0)
  const scopeVersion = useOrganizationScopeVersion()

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setIsLoading(true)
      try {
        const params = new URLSearchParams()
        params.set('page', String(page))
        params.set('pageSize', '50')
        if (search) params.set('search', search)
        if (typeof filters.kind === 'string' && filters.kind) params.set('kind', filters.kind)
        if (typeof filters.lifecycleState === 'string' && filters.lifecycleState)
          params.set('lifecycleState', filters.lifecycleState)
        if (filters.isPurchasable === 'true') params.set('isPurchasable', 'true')
        if (filters.isPurchasable === 'false') params.set('isPurchasable', 'false')
        if (filters.isSellable === 'true') params.set('isSellable', 'true')
        if (filters.isSellable === 'false') params.set('isSellable', 'false')
        if (filters.isStockable === 'true') params.set('isStockable', 'true')
        if (filters.isStockable === 'false') params.set('isStockable', 'false')
        if (filters.isProducible === 'true') params.set('isProducible', 'true')
        if (filters.isProducible === 'false') params.set('isProducible', 'false')

        const fallback: ResponsePayload = { items: [], total: 0, page, totalPages: 1 }
        const call = await apiCall<ResponsePayload>(
          `/api/materials?${params.toString()}`,
          undefined,
          { fallback },
        )
        if (!call.ok) {
          flash(t('materials.list.error.load', 'Failed to load materials'), 'error')
          return
        }
        const payload = call.result ?? fallback
        if (!cancelled) {
          setRows(Array.isArray(payload.items) ? payload.items : [])
          setTotal(payload.total ?? 0)
          setTotalPages(payload.totalPages ?? 1)
        }
      } catch {
        if (!cancelled) flash(t('materials.list.error.load', 'Failed to load materials'), 'error')
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [page, search, filters, reloadToken, scopeVersion, t])

  const handleDelete = React.useCallback(
    async (id: string, code: string) => {
      const confirmed = await confirmDialog({
        title: t('materials.list.delete.title', 'Delete material?'),
        description: t(
          'materials.list.delete.description',
          'Material "{{code}}" will be soft-deleted. You can undo via the audit log.',
        ).replace('{{code}}', code),
        confirmLabel: t('materials.list.delete.confirm', 'Delete'),
        cancelLabel: t('materials.list.delete.cancel', 'Cancel'),
        variant: 'destructive',
      })
      if (!confirmed) return
      const result = await apiCall<{ ok: boolean }>(
        `/api/materials?id=${encodeURIComponent(id)}`,
        { method: 'DELETE' },
      )
      if (!result.ok) {
        flash(t('materials.list.delete.error', 'Failed to delete material'), 'error')
        return
      }
      flash(t('materials.list.delete.success', 'Material deleted'), 'success')
      setReloadToken((x) => x + 1)
    },
    [confirmDialog, t],
  )

  const columns = React.useMemo<ColumnDef<MaterialRow>[]>(
    () => [
      {
        accessorKey: 'code',
        header: t('materials.list.column.code', 'Code'),
        cell: ({ row }) => (
          <Link
            href={`/backend/materials/${row.original.id}`}
            className="font-medium text-foreground hover:underline"
          >
            {row.original.code}
          </Link>
        ),
      },
      {
        accessorKey: 'name',
        header: t('materials.list.column.name', 'Name'),
      },
      {
        accessorKey: 'kind',
        header: t('materials.list.column.kind', 'Kind'),
        cell: ({ row }) => (
          <Badge variant="outline">{t(`materials.kind.${row.original.kind}`, row.original.kind)}</Badge>
        ),
      },
      {
        accessorKey: 'lifecycle_state',
        header: t('materials.list.column.lifecycle', 'Lifecycle'),
        cell: ({ row }) => {
          const state = row.original.lifecycle_state
          return <Badge variant="secondary">{t(`materials.lifecycle.${state}`, state)}</Badge>
        },
      },
      {
        accessorKey: 'is_purchasable',
        header: t('materials.list.column.purchasable', 'Purchase'),
        cell: ({ row }) => <BooleanIcon value={row.original.is_purchasable} />,
      },
      {
        accessorKey: 'is_sellable',
        header: t('materials.list.column.sellable', 'Sales'),
        cell: ({ row }) => <BooleanIcon value={row.original.is_sellable} />,
      },
      {
        accessorKey: 'is_stockable',
        header: t('materials.list.column.stockable', 'Stock'),
        cell: ({ row }) => <BooleanIcon value={row.original.is_stockable} />,
      },
      {
        accessorKey: 'is_producible',
        header: t('materials.list.column.producible', 'Production'),
        cell: ({ row }) => <BooleanIcon value={row.original.is_producible} />,
      },
      {
        id: 'actions',
        header: '',
        cell: ({ row }) => (
          <RowActions
            id={`material-${row.original.id}-actions`}
            actions={[
              {
                id: 'edit',
                label: t('materials.list.actions.edit', 'Edit'),
                href: `/backend/materials/${row.original.id}`,
              },
              {
                id: 'delete',
                label: t('materials.list.actions.delete', 'Delete'),
                onClick: () => handleDelete(row.original.id, row.original.code),
                destructive: true,
              },
            ]}
          />
        ),
      },
    ],
    [handleDelete, t],
  )

  const filterDefs = React.useMemo<FilterDef[]>(
    () => [
      {
        id: 'kind',
        label: t('materials.filter.kind', 'Kind'),
        type: 'select',
        options: [
          { value: '', label: t('materials.filter.any', 'Any') },
          ...KIND_VALUES.map((k) => ({ value: k, label: t(`materials.kind.${k}`, k) })),
        ],
      },
      {
        id: 'lifecycleState',
        label: t('materials.filter.lifecycle', 'Lifecycle'),
        type: 'select',
        options: [
          { value: '', label: t('materials.filter.any', 'Any') },
          ...LIFECYCLE_VALUES.map((s) => ({ value: s, label: t(`materials.lifecycle.${s}`, s) })),
        ],
      },
      {
        id: 'isPurchasable',
        label: t('materials.filter.purchasable', 'Purchasable'),
        type: 'select',
        options: [
          { value: '', label: t('materials.filter.any', 'Any') },
          { value: 'true', label: t('materials.filter.yes', 'Yes') },
          { value: 'false', label: t('materials.filter.no', 'No') },
        ],
      },
      {
        id: 'isSellable',
        label: t('materials.filter.sellable', 'Sellable'),
        type: 'select',
        options: [
          { value: '', label: t('materials.filter.any', 'Any') },
          { value: 'true', label: t('materials.filter.yes', 'Yes') },
          { value: 'false', label: t('materials.filter.no', 'No') },
        ],
      },
      {
        id: 'isStockable',
        label: t('materials.filter.stockable', 'Stockable'),
        type: 'select',
        options: [
          { value: '', label: t('materials.filter.any', 'Any') },
          { value: 'true', label: t('materials.filter.yes', 'Yes') },
          { value: 'false', label: t('materials.filter.no', 'No') },
        ],
      },
      {
        id: 'isProducible',
        label: t('materials.filter.producible', 'Producible'),
        type: 'select',
        options: [
          { value: '', label: t('materials.filter.any', 'Any') },
          { value: 'true', label: t('materials.filter.yes', 'Yes') },
          { value: 'false', label: t('materials.filter.no', 'No') },
        ],
      },
    ],
    [t],
  )

  return (
    <Page>
      <PageBody>
        <DataTable
          title={t('materials.page.title', 'Materials')}
          actions={
            <Button asChild size="sm" className="gap-1">
              <Link href="/backend/materials/create">
                <Plus className="h-4 w-4" />
                {t('materials.list.actions.create', 'New material')}
              </Link>
            </Button>
          }
          columns={columns}
          data={rows}
          isLoading={isLoading}
          searchValue={search}
          onSearchChange={(value) => {
            setSearch(value)
            setPage(1)
          }}
          searchPlaceholder={t('materials.list.search.placeholder', 'Search by code or name')}
          filters={filterDefs}
          filterValues={filters}
          onFiltersChange={(next) => {
            setFilters(next)
            setPage(1)
          }}
          page={page}
          pageSize={50}
          total={total}
          totalPages={totalPages}
          onPageChange={setPage}
        />
        {ConfirmDialogElement}
      </PageBody>
    </Page>
  )
}
