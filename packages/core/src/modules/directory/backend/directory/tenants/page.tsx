"use client"
import * as React from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { ColumnDef, SortingState } from '@tanstack/react-table'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { BooleanIcon } from '@open-mercato/ui/backend/ValueIcons'
import type { FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { Button } from '@open-mercato/ui/primitives/button'
import { apiCall, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { raiseCrudError } from '@open-mercato/ui/backend/utils/serverErrors'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type TenantRow = {
  id: string
  name: string
  isActive: boolean
  createdAt: string | null
  updatedAt: string | null
}

type TenantsResponse = {
  items: TenantRow[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}


export default function DirectoryTenantsPage() {
  const queryClient = useQueryClient()
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'name', desc: false }])
  const [page, setPage] = React.useState(1)
  const [search, setSearch] = React.useState('')
  const [filters, setFilters] = React.useState<FilterValues>({})
  const [canManage, setCanManage] = React.useState(false)
  const scopeVersion = useOrganizationScopeVersion()
  const t = useT()
  const columns = React.useMemo<ColumnDef<TenantRow>[]>(() => [
    { accessorKey: 'name', header: t('directory.tenants.list.columns.tenant', 'Tenant'), meta: { priority: 1 } },
    {
      accessorKey: 'isActive',
      header: t('directory.tenants.list.columns.active', 'Active'),
      enableSorting: false,
      meta: { priority: 2 },
      cell: ({ getValue }) => <BooleanIcon value={Boolean(getValue())} />,
    },
    {
      accessorKey: 'createdAt',
      header: t('directory.tenants.list.columns.created', 'Created'),
      meta: { priority: 3 },
      cell: ({ getValue }) => {
        const timestamp = getValue() as string | null
        if (!timestamp) return <span className="text-xs text-muted-foreground">—</span>
        const date = new Date(timestamp)
        if (Number.isNaN(date.getTime())) return <span className="text-xs text-muted-foreground">—</span>
        return <span>{date.toLocaleString()}</span>
      },
    },
  ], [t])

  React.useEffect(() => {
    let cancelled = false
    async function loadFeature() {
      try {
        const call = await apiCall<{ ok?: boolean; granted?: string[] }>('/api/auth/feature-check', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ features: ['directory.tenants.manage'] }),
        })
        if (!cancelled) {
          const granted = Array.isArray(call.result?.granted) ? call.result!.granted! : []
          setCanManage(call.result?.ok === true || granted.includes('directory.tenants.manage'))
        }
      } catch {
        if (!cancelled) setCanManage(false)
      }
    }
    loadFeature()
    return () => { cancelled = true }
  }, [])

  const queryParams = React.useMemo(() => {
    const params = new URLSearchParams()
    params.set('page', String(page))
    params.set('pageSize', '20')
    if (sorting.length > 0) {
      params.set('sortField', sorting[0]?.id || 'name')
      params.set('sortDir', sorting[0]?.desc ? 'desc' : 'asc')
    }
    if (search) params.set('search', search)
    if (filters.active !== undefined && filters.active !== '') params.set('isActive', String(filters.active))
    return params.toString()
  }, [page, sorting, search, filters])

  const { data, isLoading } = useQuery({
    queryKey: ['directory-tenants', queryParams, scopeVersion],
    queryFn: async (): Promise<TenantsResponse> => {
      return readApiResultOrThrow<TenantsResponse>(
        `/api/directory/tenants?${queryParams}`,
        undefined,
        { errorMessage: t('directory.tenants.list.error.load', 'Failed to load tenants') },
      )
    },
  })

  const rows = data?.items ?? []
  const total = data?.total ?? 0
  const totalPages = data?.totalPages ?? 1

  const handleDelete = React.useCallback(async (tenant: TenantRow) => {
    if (!window.confirm(t('directory.tenants.list.confirmDelete', 'Delete tenant "{{name}}"? This will archive it.').replace('{{name}}', tenant.name))) return
    try {
      const call = await apiCall(
        `/api/directory/tenants?id=${encodeURIComponent(tenant.id)}`,
        { method: 'DELETE' },
      )
      if (!call.ok) {
        await raiseCrudError(call.response, t('directory.tenants.list.error.delete', 'Failed to delete tenant'))
      }
      await queryClient.invalidateQueries({ queryKey: ['directory-tenants'] })
      flash(t('directory.tenants.list.success.delete', 'Tenant deleted'), 'success')
    } catch (err: any) {
      const message = err instanceof Error ? err.message : t('directory.tenants.list.error.delete', 'Failed to delete tenant')
      flash(message, 'error')
    }
  }, [queryClient, t])

  return (
    <Page>
      <PageBody>
        <DataTable
          title={t('directory.tenants.list.title', 'Tenants')}
          actions={canManage ? (
            <Button asChild>
              <Link href="/backend/directory/tenants/create">{t('directory.tenants.list.actions.create', 'Create')}</Link>
            </Button>
          ) : undefined}
          columns={columns}
          data={rows}
          searchValue={search}
          onSearchChange={(value) => { setSearch(value); setPage(1) }}
          filters={[{ id: 'active', label: t('directory.tenants.list.filters.status', 'Status'), type: 'select', options: [
            { value: 'true', label: t('directory.tenants.list.filters.active', 'Active') },
            { value: 'false', label: t('directory.tenants.list.filters.inactive', 'Inactive') },
          ] }]}
          filterValues={filters}
          onFiltersApply={(vals) => { setFilters(vals); setPage(1) }}
          onFiltersClear={() => { setFilters({}); setPage(1) }}
          sortable
          sorting={sorting}
          onSortingChange={(state) => { setSorting(state); setPage(1) }}
          perspective={{ tableId: 'directory.tenants.list' }}
          rowActions={(row) => (
            canManage ? (
              <RowActions
                items={[
                  { id: 'edit', label: t('common.edit', 'Edit'), href: `/backend/directory/tenants/${row.id}/edit` },
                  { id: 'delete', label: t('common.delete', 'Delete'), destructive: true, onSelect: () => handleDelete(row) },
                ]}
              />
            ) : null
          )}
          pagination={{ page, pageSize: 20, total, totalPages, onPageChange: setPage }}
          isLoading={isLoading}
        />
      </PageBody>
    </Page>
  )
}
