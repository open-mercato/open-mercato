"use client"

import * as React from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { ColumnDef } from '@tanstack/react-table'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import type { FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { Button } from '@open-mercato/ui/primitives/button'
import { BooleanIcon } from '@open-mercato/ui/backend/ValueIcons'
import { apiCall, apiCallOrThrow, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { formatCategoryTreeLabel } from '../../lib/categoryTree'

type CategoryRow = {
  id: string
  name: string
  slug: string | null
  description: string | null
  parentId: string | null
  parentName: string | null
  depth: number
  treePath: string
  pathLabel: string
  childCount: number
  descendantCount: number
  isActive: boolean
}

type CategoriesResponse = {
  items: CategoryRow[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

const PAGE_SIZE = 50
const TREE_BASE_INDENT = 18
const TREE_STEP_INDENT = 14

function computeIndent(depth: number): number {
  if (depth <= 0) return 0
  return TREE_BASE_INDENT + (depth - 1) * TREE_STEP_INDENT
}

export default function CategoriesDataTable() {
  const t = useT()
  const queryClient = useQueryClient()
  const scopeVersion = useOrganizationScopeVersion()
  const [page, setPage] = React.useState(1)
  const [status, setStatus] = React.useState<'all' | 'active' | 'inactive'>('all')
  const [search, setSearch] = React.useState('')
  const [canManage, setCanManage] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const call = await apiCall<{ granted?: string[]; ok?: boolean }>('/api/auth/feature-check', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ features: ['catalog.categories.manage'] }),
        })
        if (!cancelled) {
          const granted = Array.isArray(call.result?.granted) ? call.result.granted : []
          setCanManage(call.result?.ok === true || granted.includes('catalog.categories.manage'))
        }
      } catch {
        if (!cancelled) setCanManage(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  const queryParams = React.useMemo(() => {
    const params = new URLSearchParams()
    params.set('view', 'manage')
    params.set('page', String(page))
    params.set('pageSize', String(PAGE_SIZE))
    params.set('status', status)
    if (search) params.set('search', search)
    return params.toString()
  }, [page, status, search])

  const { data, isLoading } = useQuery<CategoriesResponse>({
    queryKey: ['catalog-categories', queryParams, scopeVersion],
    queryFn: async () => {
      const payload = await readApiResultOrThrow<CategoriesResponse>(
        `/api/catalog/categories?${queryParams}`,
        undefined,
        { errorMessage: t('catalog.categories.list.error.load', 'Failed to load categories') },
      )
      return {
        items: Array.isArray(payload.items) ? payload.items : [],
        total: typeof payload.total === 'number' ? payload.total : 0,
        page: typeof payload.page === 'number' ? payload.page : 1,
        pageSize: typeof payload.pageSize === 'number' ? payload.pageSize : PAGE_SIZE,
        totalPages: typeof payload.totalPages === 'number' ? payload.totalPages : 1,
      }
    },
  })

  const rows = data?.items ?? []
  const total = data?.total ?? 0
  const totalPages = data?.totalPages ?? 1

  const columns = React.useMemo<ColumnDef<CategoryRow>[]>(() => [
    {
      accessorKey: 'name',
      header: t('catalog.categories.list.columns.category', 'Category'),
      meta: { priority: 1 },
      cell: ({ row }) => {
        const depth = row.original.depth ?? 0
        return (
          <div className="flex items-center text-sm font-medium leading-none text-foreground">
            <span style={{ marginLeft: computeIndent(depth), whiteSpace: 'pre' }}>
              {formatCategoryTreeLabel(row.original.name, depth)}
            </span>
          </div>
        )
      },
    },
    {
      accessorKey: 'pathLabel',
      header: t('catalog.categories.list.columns.path', 'Path'),
      meta: { priority: 3 },
      cell: ({ getValue }) => {
        const value = getValue<string>()
        return <span className="text-xs text-muted-foreground">{value || '—'}</span>
      },
    },
    {
      accessorKey: 'parentName',
      header: t('catalog.categories.list.columns.parent', 'Parent'),
      meta: { priority: 4 },
      cell: ({ getValue }) => getValue<string>() || t('catalog.categories.list.none', '—'),
    },
    {
      accessorKey: 'childCount',
      header: t('catalog.categories.list.columns.children', 'Children'),
      meta: { priority: 5 },
    },
    {
      accessorKey: 'isActive',
      header: t('catalog.categories.list.columns.active', 'Active'),
      enableSorting: false,
      meta: { priority: 2 },
      cell: ({ getValue }) => <BooleanIcon value={Boolean(getValue())} />,
    },
  ], [t])

  const handleDelete = React.useCallback(async (category: CategoryRow) => {
    const confirmLabel = t(
      'catalog.categories.list.confirmDelete',
      'Archive category "{{name}}"?',
      { name: category.name },
    )
    if (!window.confirm(confirmLabel)) return
    try {
      await apiCallOrThrow(
        `/api/catalog/categories?id=${encodeURIComponent(category.id)}`,
        { method: 'DELETE' },
        { errorMessage: t('catalog.categories.list.error.delete', 'Failed to delete category') },
      )
      await queryClient.invalidateQueries({ queryKey: ['catalog-categories'] })
      flash(t('catalog.categories.flash.deleted', 'Category archived'), 'success')
    } catch (err: unknown) {
      const fallback = t('catalog.categories.list.error.delete', 'Failed to delete category')
      const message = err instanceof Error ? err.message : fallback
      flash(message, 'error')
    }
  }, [queryClient, t])

  return (
    <DataTable
      title={t('catalog.categories.list.title', 'Categories')}
      actions={canManage ? (
        <Button asChild>
          <Link href="/backend/catalog/categories/create">
            {t('catalog.categories.list.actions.create', 'Create')}
          </Link>
        </Button>
      ) : undefined}
      columns={columns}
      data={rows}
      searchValue={search}
      searchPlaceholder={t('catalog.categories.list.searchPlaceholder', 'Search categories')}
      onSearchChange={(value) => { setSearch(value); setPage(1) }}
      filters={[
        {
          id: 'status',
          label: t('catalog.categories.list.filters.status', 'Status'),
          type: 'select',
          options: [
            { value: 'all', label: t('catalog.categories.list.filters.all', 'All') },
            { value: 'active', label: t('catalog.categories.list.filters.active', 'Active') },
            { value: 'inactive', label: t('catalog.categories.list.filters.inactive', 'Inactive') },
          ],
        },
      ]}
      filterValues={status === 'all' ? {} : { status }}
      onFiltersApply={(values: FilterValues) => {
        const nextStatus = (values.status as 'all' | 'active' | 'inactive' | undefined) ?? 'all'
        setStatus(nextStatus)
        setPage(1)
      }}
      onFiltersClear={() => {
        setStatus('all')
        setPage(1)
      }}
      sortable={false}
      perspective={{ tableId: 'catalog.categories.list' }}
      rowActions={(row) => (
        canManage ? (
          <RowActions
            items={[
              { label: t('catalog.categories.list.actions.edit', 'Edit'), href: `/backend/catalog/categories/${row.id}/edit` },
              { label: t('catalog.categories.list.actions.delete', 'Delete'), destructive: true, onSelect: () => handleDelete(row) },
            ]}
          />
        ) : null
      )}
      pagination={{
        page,
        pageSize: PAGE_SIZE,
        total,
        totalPages,
        onPageChange: setPage,
      }}
      isLoading={isLoading}
    />
  )
}
