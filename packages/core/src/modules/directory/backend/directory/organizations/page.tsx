"use client"
import * as React from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { ColumnDef } from '@tanstack/react-table'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import type { FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { BooleanIcon } from '@open-mercato/ui/backend/ValueIcons'
import { Button } from '@open-mercato/ui/primitives/button'
import { apiCall, apiCallOrThrow, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useOrganizationScopeVersion } from '@/lib/frontend/useOrganizationScope'
import { useT } from '@/lib/i18n/context'

type OrganizationRow = {
  id: string
  name: string
  tenantId: string
  tenantName?: string | null
  parentId: string | null
  parentName: string | null
  depth: number
  rootId: string
  treePath: string
  pathLabel: string
  ancestorIds: string[]
  childIds: string[]
  descendantIds: string[]
  childrenCount: number
  descendantsCount: number
  isActive: boolean
}

type OrganizationsResponse = {
  items: OrganizationRow[]
  total: number
  page: number
  pageSize: number
  totalPages: number
  isSuperAdmin?: boolean
}

const TREE_BASE_INDENT = 18
const TREE_STEP_INDENT = 14

function formatTreeLabel(name: string, depth: number): string {
  if (depth <= 0) return name
  return `${'\u00A0'.repeat(Math.max(0, (depth - 1) * 2))}↳ ${name}`
}

function computeIndent(depth: number): number {
  if (depth <= 0) return 0
  return TREE_BASE_INDENT + (depth - 1) * TREE_STEP_INDENT
}

export default function DirectoryOrganizationsPage() {
  const queryClient = useQueryClient()
  const [page, setPage] = React.useState(1)
  const [status, setStatus] = React.useState<string>('all')
  const [search, setSearch] = React.useState('')
  const [canManage, setCanManage] = React.useState(false)
  const scopeVersion = useOrganizationScopeVersion()
  const t = useT()

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const call = await apiCall<{ granted?: string[]; ok?: boolean }>('/api/auth/feature-check', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ features: ['directory.organizations.manage'] }),
        })
        if (!cancelled) {
          const granted = Array.isArray(call.result?.granted) ? call.result?.granted : []
          setCanManage(call.result?.ok === true || granted.includes('directory.organizations.manage'))
        }
      } catch {
        if (!cancelled) setCanManage(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  const queryParams = React.useMemo(() => {
    const params = new URLSearchParams()
    params.set('view', 'manage')
    params.set('page', String(page))
    params.set('pageSize', '50')
    params.set('status', status)
    if (status !== 'active') params.set('includeInactive', 'true')
    if (search) params.set('search', search)
    return params.toString()
  }, [page, status, search])

  const { data, isLoading } = useQuery<OrganizationsResponse>({
    queryKey: ['directory-organizations', queryParams, scopeVersion],
    queryFn: async () => {
      return readApiResultOrThrow<OrganizationsResponse>(
        `/api/directory/organizations?${queryParams}`,
        undefined,
        { errorMessage: t('directory.organizations.list.error.load', 'Failed to load organizations') },
      )
    },
  })

  const rows = data?.items ?? []
  const isSuperAdmin = data?.isSuperAdmin ?? false
  const columns = React.useMemo<ColumnDef<OrganizationRow>[]>(() => {
    const base: ColumnDef<OrganizationRow>[] = [
      {
        accessorKey: 'name',
        header: t('directory.organizations.list.columns.organization', 'Organization'),
        cell: ({ row }) => {
          const depth = row.original.depth ?? 0
          return (
            <div className="flex items-center text-sm font-medium leading-none text-foreground">
              <span
                style={{ marginLeft: computeIndent(depth), whiteSpace: 'pre' }}
              >
                {formatTreeLabel(row.original.name, depth)}
              </span>
            </div>
          )
        },
        meta: { priority: 1 },
      },
      {
        accessorKey: 'pathLabel',
        header: t('directory.organizations.list.columns.path', 'Path'),
        meta: { priority: 3 },
        cell: ({ getValue }) => {
          const value = getValue<string>()
          return <span className="text-xs text-muted-foreground">{value}</span>
        },
      },
      {
        accessorKey: 'parentName',
        header: t('directory.organizations.list.columns.parent', 'Parent'),
        meta: { priority: 4 },
        cell: ({ getValue }) => getValue<string>() || t('directory.organizations.common.none', '—'),
      },
      {
        accessorKey: 'childrenCount',
        header: t('directory.organizations.list.columns.children', 'Children'),
        meta: { priority: 5 },
      },
      {
        accessorKey: 'isActive',
        header: t('directory.organizations.list.columns.active', 'Active'),
        enableSorting: false,
        meta: { priority: 2 },
        cell: ({ getValue }) => <BooleanIcon value={Boolean(getValue())} />, 
      },
    ]
    if (isSuperAdmin) {
      base.splice(1, 0, {
        accessorKey: 'tenantName',
        header: t('directory.organizations.list.columns.tenant', 'Tenant'),
        meta: { priority: 2 },
        cell: ({ row }) => {
          const value = row.original.tenantName ?? row.original.tenantId
          return <span className="text-xs text-muted-foreground">{value}</span>
        },
      })
    }
    return base
  }, [isSuperAdmin, t])
  const total = data?.total ?? 0
  const totalPages = data?.totalPages ?? 1

  const handleDelete = React.useCallback(async (org: OrganizationRow) => {
    const confirmLabel = t('directory.organizations.list.confirmDelete', 'Archive organization "{{name}}"?', { name: org.name })
    if (!window.confirm(confirmLabel)) return
    try {
      await apiCallOrThrow(
        `/api/directory/organizations?id=${encodeURIComponent(org.id)}`,
        { method: 'DELETE' },
        { errorMessage: t('directory.organizations.list.error.delete', 'Failed to delete organization') },
      )
      await queryClient.invalidateQueries({ queryKey: ['directory-organizations'] })
      flash(t('directory.organizations.flash.deleted', 'Organization deleted'), 'success')
    } catch (err: unknown) {
      const fallback = t('directory.organizations.list.error.delete', 'Failed to delete organization')
      const message = err instanceof Error ? err.message : fallback
      flash(message, 'error')
    }
  }, [queryClient, t])

  return (
    <Page>
      <PageBody>
        <DataTable
          title={t('directory.organizations.list.title', 'Organizations')}
          actions={canManage ? (
            <Button asChild>
              <Link href="/backend/directory/organizations/create">
                {t('directory.organizations.list.actions.create', 'Create')}
              </Link>
            </Button>
          ) : undefined}
          columns={columns}
          data={rows}
          searchValue={search}
          searchPlaceholder={t('directory.organizations.list.searchPlaceholder', 'Search organizations')}
          onSearchChange={(value) => { setSearch(value); setPage(1) }}
          filters={[
            {
              id: 'status',
              label: t('directory.organizations.list.filters.status', 'Status'),
              type: 'select',
              options: [
                { value: 'all', label: t('directory.organizations.list.filters.all', 'All') },
                { value: 'active', label: t('directory.organizations.list.filters.active', 'Active') },
                { value: 'inactive', label: t('directory.organizations.list.filters.inactive', 'Inactive') },
              ],
            },
          ]}
          filterValues={status === 'all' ? {} : { status }}
          onFiltersApply={(vals: FilterValues) => {
            const nextStatus = (vals.status as string) || 'all'
            setStatus(nextStatus)
            setPage(1)
          }}
          onFiltersClear={() => {
            setStatus('all')
            setPage(1)
          }}
          sortable={false}
          perspective={{ tableId: 'directory.organizations.list' }}
          rowActions={(row) => (
            canManage ? (
              <RowActions
                items={[
                  { label: t('directory.organizations.list.actions.edit', 'Edit'), href: `/backend/directory/organizations/${row.id}/edit` },
                  { label: t('directory.organizations.list.actions.delete', 'Delete'), destructive: true, onSelect: () => handleDelete(row) },
                ]}
              />
            ) : null
          )}
          pagination={{ page, pageSize: 50, total, totalPages, onPageChange: setPage }}
          isLoading={isLoading}
        />
      </PageBody>
    </Page>
  )
}
