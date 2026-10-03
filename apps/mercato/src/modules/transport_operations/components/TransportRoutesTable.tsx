"use client"

import * as React from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import type { SortingState } from '@tanstack/react-table'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { Button } from '@open-mercato/ui/primitives/button'
import { fetchCrudList } from '@open-mercato/ui/backend/utils/crud'
import { useDirection, useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'

export const RESOURCE = 'transport_operations/routes'
export const CREATE_HREF = '/backend/transport/routes/create'
export const editHref = (id: string) => `/backend/transport/routes/${id}/edit`
export const ENTITY_ID = 'transport_operations:transport_route'

export type RouteRow = {
  id: string
  code: string
  name: string
  start_location: string
  end_location: string
  estimated_duration_minutes: number
  updated_at?: string | null
  updatedAt?: string | null
}

export default function TransportRoutesTable() {
  const t = useT()
  const direction = useDirection()
  const scopeVersion = useOrganizationScopeVersion()
  const [search, setSearch] = React.useState('')
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'code', desc: false }])
  const [page, setPage] = React.useState(1)

  const params = React.useMemo(() => {
    const out: Record<string, string | number> = {
      page,
      pageSize: 50,
      sortField: sorting[0]?.id ?? 'code',
      sortDir: sorting[0]?.desc ? 'desc' : 'asc',
    }
    if (search.trim().length > 0) out.search = search.trim()
    return out
  }, [page, sorting, search])

  const query = useQuery({
    queryKey: ['transport-routes', params, scopeVersion],
    queryFn: () => fetchCrudList<RouteRow>(RESOURCE, params),
  })

  const data = query.data

  const columns = React.useMemo<ColumnDef<RouteRow>[]>(() => [
    {
      accessorKey: 'code',
      header: t('transport_operations.routes.columns.code', 'Code'),
      cell: ({ getValue }) => <span className="font-mono text-xs">{String(getValue() ?? '—')}</span>,
      meta: { priority: 2 },
    },
    {
      accessorKey: 'name',
      header: t('transport_operations.routes.columns.name', 'Route'),
      meta: { priority: 1 },
    },
    {
      accessorKey: 'start_location',
      header: t('transport_operations.routes.columns.origin', 'From'),
      cell: ({ getValue }) => <span className="text-sm">{String(getValue() ?? '—')}</span>,
      meta: { priority: 3 },
    },
    {
      accessorKey: 'end_location',
      header: t('transport_operations.routes.columns.destination', 'To'),
      cell: ({ getValue }) => <span className="text-sm">{String(getValue() ?? '—')}</span>,
      meta: { priority: 4 },
    },
    {
      accessorKey: 'estimated_duration_minutes',
      header: t('transport_operations.routes.columns.duration', 'Duration (minutes)'),
      cell: ({ getValue }) => <span className="tabular-nums text-sm">{String(getValue() ?? '—')}</span>,
      meta: { priority: 5 },
    },
  ], [t])

  if (query.isError) {
    return <div className="text-sm text-destructive">{t('transport_operations.routes.error.load', 'Failed to load routes.')}</div>
  }

  return (
    <DataTable
      title={t('transport_operations.routes.page.title', 'Routes')}
      titleHeadingLevel={1}
      actions={(
        <Button asChild>
          <Link href={CREATE_HREF}>{t('transport_operations.routes.actions.create', 'New route')}</Link>
        </Button>
      )}
      rowActions={(row) => (
        <Link className="text-sm font-medium underline" href={editHref(row.id)}>
          {t('transport_operations.routes.actions.edit', 'Edit')}
        </Link>
      )}
      columns={columns}
      data={data?.items ?? []}
      searchValue={search}
      onSearchChange={(value) => {
        setSearch(value)
        setPage(1)
      }}
      searchPlaceholder={t('transport_operations.routes.searchPlaceholder', 'Code or name')}
      searchAlign={direction === 'rtl' ? 'left' : 'right'}
      entityId={ENTITY_ID}
      sortable
      sorting={sorting}
      onSortingChange={(next) => {
        setSorting(next)
        setPage(1)
      }}
      pagination={{
        page,
        pageSize: 50,
        total: data?.total ?? 0,
        totalPages: data?.totalPages ?? 0,
        totalIsCapped: data?.totalIsCapped === true,
        onPageChange: setPage,
      }}
      isLoading={query.isLoading}
    />
  )
}
