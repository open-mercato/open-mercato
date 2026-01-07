"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { ColumnDef } from '@tanstack/react-table'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { Button } from '@open-mercato/ui/primitives/button'
import { BooleanIcon } from '@open-mercato/ui/backend/ValueIcons'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useOrganizationScopeVersion } from '@/lib/frontend/useOrganizationScope'
import { useT } from '@/lib/i18n/context'

const PAGE_SIZE = 20

type ResourceRow = {
  id: string
  name: string
  resourceTypeId: string | null
  capacity: number | null
  tags: string[]
  isActive: boolean
}

type ResourceTypeRow = {
  id: string
  name: string
}

type ResourcesResponse = {
  items: ResourceRow[]
  total: number
  page: number
  totalPages: number
}

type ResourceTypesResponse = {
  items: ResourceTypeRow[]
}

export default function BookingResourcesPage() {
  const [rows, setRows] = React.useState<ResourceRow[]>([])
  const [page, setPage] = React.useState(1)
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [search, setSearch] = React.useState('')
  const [isLoading, setIsLoading] = React.useState(true)
  const [resourceTypes, setResourceTypes] = React.useState<Map<string, string>>(new Map())
  const [canManage, setCanManage] = React.useState(false)
  const scopeVersion = useOrganizationScopeVersion()
  const t = useT()
  const router = useRouter()

  React.useEffect(() => {
    let cancelled = false
    async function loadPermissions() {
      try {
        const call = await apiCall<{ granted?: string[]; ok?: boolean }>('/api/auth/feature-check', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ features: ['booking.manage_resources'] }),
        })
        if (!cancelled) {
          const granted = Array.isArray(call.result?.granted) ? call.result?.granted : []
          setCanManage(call.result?.ok === true || granted.includes('booking.manage_resources'))
        }
      } catch {
        if (!cancelled) setCanManage(false)
      }
    }
    loadPermissions()
    return () => { cancelled = true }
  }, [])

  React.useEffect(() => {
    let cancelled = false
    async function loadResourceTypes() {
      try {
        const params = new URLSearchParams({ page: '1', pageSize: '200' })
        const call = await apiCall<ResourceTypesResponse>(`/api/booking/resource-types?${params.toString()}`)
        const items = Array.isArray(call.result?.items) ? call.result.items : []
        const map = new Map<string, string>()
        for (const item of items) map.set(item.id, item.name)
        if (!cancelled) setResourceTypes(map)
      } catch {
        if (!cancelled) setResourceTypes(new Map())
      }
    }
    loadResourceTypes()
    return () => { cancelled = true }
  }, [scopeVersion])

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setIsLoading(true)
      try {
        const params = new URLSearchParams({
          page: String(page),
          pageSize: String(PAGE_SIZE),
        })
        if (search) params.set('search', search)
        const fallback: ResourcesResponse = { items: [], total: 0, page, totalPages: 1 }
        const call = await apiCall<ResourcesResponse>(`/api/booking/resources?${params.toString()}`, undefined, { fallback })
        if (!call.ok) {
          flash(t('booking.resources.list.error.load', 'Failed to load resources.'), 'error')
          return
        }
        const payload = call.result ?? fallback
        if (!cancelled) {
          setRows(Array.isArray(payload.items) ? payload.items : [])
          setTotal(payload.total || 0)
          setTotalPages(payload.totalPages || 1)
        }
      } catch (error) {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : t('booking.resources.list.error.load', 'Failed to load resources.')
          flash(message, 'error')
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [page, search, scopeVersion, t])

  const handleDelete = React.useCallback(async (row: ResourceRow) => {
    const confirmLabel = t('booking.resources.list.confirmDelete', 'Delete resource "{name}"?', { name: row.name })
    if (!window.confirm(confirmLabel)) return
    try {
      await deleteCrud('booking/resources', { id: row.id }, { errorMessage: t('booking.resources.list.error.delete', 'Failed to delete resource.') })
      flash(t('booking.resources.list.flash.deleted', 'Resource deleted.'), 'success')
      setPage(1)
      router.refresh()
    } catch (error) {
      const message = error instanceof Error ? error.message : t('booking.resources.list.error.delete', 'Failed to delete resource.')
      flash(message, 'error')
    }
  }, [router, t])

  const columns = React.useMemo<ColumnDef<ResourceRow>[]>(() => [
    {
      accessorKey: 'name',
      header: t('booking.resources.list.columns.name', 'Resource'),
      meta: { priority: 1 },
      cell: ({ row }) => (
        <span className="text-sm font-medium text-foreground">{row.original.name}</span>
      ),
    },
    {
      accessorKey: 'resourceTypeId',
      header: t('booking.resources.list.columns.type', 'Type'),
      meta: { priority: 2 },
      cell: ({ row }) => resourceTypes.get(row.original.resourceTypeId ?? '') || t('booking.resources.list.columns.type.empty', 'Unassigned'),
    },
    {
      accessorKey: 'capacity',
      header: t('booking.resources.list.columns.capacity', 'Capacity'),
      meta: { priority: 3 },
      cell: ({ row }) => row.original.capacity ?? t('booking.resources.list.columns.capacity.empty', '-'),
    },
    {
      accessorKey: 'tags',
      header: t('booking.resources.list.columns.tags', 'Tags'),
      meta: { priority: 4 },
      cell: ({ row }) => {
        const tags = row.original.tags ?? []
        if (!tags.length) return <span className="text-xs text-muted-foreground">{t('booking.resources.list.columns.tags.empty', '-')}</span>
        return (
          <div className="flex flex-wrap gap-1">
            {tags.map((tag) => (
              <span key={tag} className="rounded-full border px-2 py-0.5 text-xs font-medium">
                {tag}
              </span>
            ))}
          </div>
        )
      },
    },
    {
      accessorKey: 'isActive',
      header: t('booking.resources.list.columns.active', 'Active'),
      meta: { priority: 5 },
      cell: ({ row }) => <BooleanIcon value={row.original.isActive} />,
    },
  ], [resourceTypes, t])

  return (
    <Page>
      <PageBody>
        <DataTable
          title={t('booking.resources.page.title', 'Resources')}
          actions={canManage ? (
            <Button asChild>
              <Link href="/backend/booking/resources/create">{t('booking.resources.list.actions.create', 'New resource')}</Link>
            </Button>
          ) : null}
          columns={columns}
          data={rows}
          searchValue={search}
          onSearchChange={(value) => { setSearch(value); setPage(1) }}
          perspective={{ tableId: 'booking.resources.list' }}
          rowActions={(row) => {
            if (!canManage) return null
            return (
              <RowActions items={[
                { label: t('common.edit', 'Edit'), href: `/backend/booking/resources/${encodeURIComponent(row.id)}` },
                { label: t('common.delete', 'Delete'), destructive: true, onSelect: () => { void handleDelete(row) } },
              ]} />
            )
          }}
          onRowClick={canManage ? (row) => router.push(`/backend/booking/resources/${encodeURIComponent(row.id)}`) : undefined}
          pagination={{ page, pageSize: PAGE_SIZE, total, totalPages, onPageChange: setPage }}
          isLoading={isLoading}
        />
      </PageBody>
    </Page>
  )
}
