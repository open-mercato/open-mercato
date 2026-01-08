"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import type { ColumnDef, SortingState } from '@tanstack/react-table'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { Button } from '@open-mercato/ui/primitives/button'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { useOrganizationScopeVersion } from '@/lib/frontend/useOrganizationScope'
import { useT } from '@/lib/i18n/context'

const PAGE_SIZE = 50

type ResourceTypeRow = {
  id: string
  name: string
  description: string | null
  updatedAt: string | null
}

type ResourceTypesResponse = {
  items?: Array<Record<string, unknown>>
  total?: number
  totalPages?: number
}

export default function BookingResourceTypesPage() {
  const translate = useT()
  const router = useRouter()
  const scopeVersion = useOrganizationScopeVersion()
  const [rows, setRows] = React.useState<ResourceTypeRow[]>([])
  const [page, setPage] = React.useState(1)
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'name', desc: false }])
  const [search, setSearch] = React.useState('')
  const [isLoading, setIsLoading] = React.useState(true)
  const [reloadToken, setReloadToken] = React.useState(0)

  const translations = React.useMemo(() => ({
    title: translate('booking.resourceTypes.page.title', 'Resource types'),
    description: translate('booking.resourceTypes.page.description', 'Organize shared resources by category.'),
    table: {
      name: translate('booking.resourceTypes.table.name', 'Name'),
      description: translate('booking.resourceTypes.table.description', 'Description'),
      updatedAt: translate('booking.resourceTypes.table.updatedAt', 'Updated'),
      empty: translate('booking.resourceTypes.table.empty', 'No resource types yet.'),
      search: translate('booking.resourceTypes.table.search', 'Search resource types…'),
    },
    actions: {
      add: translate('booking.resourceTypes.actions.add', 'Add resource type'),
      edit: translate('booking.resourceTypes.actions.edit', 'Edit'),
      delete: translate('booking.resourceTypes.actions.delete', 'Delete'),
      deleteConfirm: translate('booking.resourceTypes.actions.deleteConfirm', 'Delete resource type "{{name}}"?'),
      refresh: translate('booking.resourceTypes.actions.refresh', 'Refresh'),
    },
    form: {
      createTitle: translate('booking.resourceTypes.form.createTitle', 'Add resource type'),
      editTitle: translate('booking.resourceTypes.form.editTitle', 'Edit resource type'),
      name: translate('booking.resourceTypes.form.name', 'Name'),
      description: translate('booking.resourceTypes.form.description', 'Description'),
      save: translate('booking.resourceTypes.form.save', 'Save'),
      cancel: translate('booking.resourceTypes.form.cancel', 'Cancel'),
    },
    messages: {
      saved: translate('booking.resourceTypes.messages.saved', 'Resource type saved.'),
      deleted: translate('booking.resourceTypes.messages.deleted', 'Resource type deleted.'),
    },
    errors: {
      load: translate('booking.resourceTypes.errors.load', 'Failed to load resource types.'),
      save: translate('booking.resourceTypes.errors.save', 'Failed to save resource type.'),
      delete: translate('booking.resourceTypes.errors.delete', 'Failed to delete resource type.'),
    },
  }), [translate])

  const columns = React.useMemo<ColumnDef<ResourceTypeRow>[]>(() => [
    {
      accessorKey: 'name',
      header: translations.table.name,
      meta: { priority: 1, sticky: true },
      cell: ({ row }) => (
        <div className="flex flex-col">
          <span className="font-medium">{row.original.name}</span>
          {row.original.description ? (
            <span className="text-xs text-muted-foreground">{row.original.description}</span>
          ) : null}
        </div>
      ),
    },
    {
      accessorKey: 'description',
      header: translations.table.description,
      meta: { priority: 3 },
      cell: ({ row }) => row.original.description ? (
        <span className="text-sm">{row.original.description}</span>
      ) : (
        <span className="text-xs text-muted-foreground">—</span>
      ),
    },
    {
      accessorKey: 'updatedAt',
      header: translations.table.updatedAt,
      meta: { priority: 2 },
      cell: ({ row }) => row.original.updatedAt
        ? <span className="text-xs text-muted-foreground">{formatDateTime(row.original.updatedAt)}</span>
        : <span className="text-xs text-muted-foreground">—</span>,
    },
  ], [translations.table.description, translations.table.name, translations.table.updatedAt])

  const loadResourceTypes = React.useCallback(async () => {
    setIsLoading(true)
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(PAGE_SIZE),
      })
      const sort = sorting[0]
      if (sort?.id) {
        params.set('sortField', sort.id)
        params.set('sortDir', sort.desc ? 'desc' : 'asc')
      }
      if (search.trim()) {
        params.set('search', search.trim())
      }
      const payload = await readApiResultOrThrow<ResourceTypesResponse>(
        `/api/booking/resource-types?${params.toString()}`,
        undefined,
        { errorMessage: translations.errors.load, fallback: { items: [], total: 0, totalPages: 1 } },
      )
      const items = Array.isArray(payload.items) ? payload.items : []
      setRows(items.map(mapApiResourceType))
      setTotal(typeof payload.total === 'number' ? payload.total : items.length)
      setTotalPages(typeof payload.totalPages === 'number' ? payload.totalPages : Math.max(1, Math.ceil(items.length / PAGE_SIZE)))
    } catch (error) {
      console.error('booking.resource-types.list', error)
      flash(translations.errors.load, 'error')
    } finally {
      setIsLoading(false)
    }
  }, [page, search, sorting, translations.errors.load])

  React.useEffect(() => {
    void loadResourceTypes()
  }, [loadResourceTypes, scopeVersion, reloadToken])

  const handleSearchChange = React.useCallback((value: string) => {
    setSearch(value)
    setPage(1)
  }, [])

  const handleRefresh = React.useCallback(() => {
    setReloadToken((token) => token + 1)
  }, [])

  const handleDelete = React.useCallback(async (entry: ResourceTypeRow) => {
    const message = translations.actions.deleteConfirm.replace('{{name}}', entry.name)
    if (typeof window !== 'undefined' && !window.confirm(message)) return
    try {
      await deleteCrud('booking/resource-types', entry.id, { errorMessage: translations.errors.delete })
      flash(translations.messages.deleted, 'success')
      handleRefresh()
    } catch (error) {
      console.error('booking.resource-types.delete', error)
      flash(translations.errors.delete, 'error')
    }
  }, [handleRefresh, translations.actions.deleteConfirm, translations.errors.delete, translations.messages.deleted])

  return (
    <Page>
      <PageBody>
        <DataTable<ResourceTypeRow>
          title={translations.title}
          data={rows}
          columns={columns}
          isLoading={isLoading}
          searchValue={search}
          onSearchChange={handleSearchChange}
          searchPlaceholder={translations.table.search}
          emptyState={<p className="py-8 text-center text-sm text-muted-foreground">{translations.table.empty}</p>}
          actions={(
            <Button asChild size="sm">
              <Link href="/backend/booking/resource-types/create">
                {translations.actions.add}
              </Link>
            </Button>
          )}
          refreshButton={{
            label: translations.actions.refresh,
            onRefresh: handleRefresh,
            isRefreshing: isLoading,
          }}
          sortable
          sorting={sorting}
          onSortingChange={setSorting}
          pagination={{ page, pageSize: PAGE_SIZE, total, totalPages, onPageChange: setPage }}
          rowActions={(row) => (
            <RowActions
              items={[
                { label: translations.actions.edit, href: `/backend/booking/resource-types/${row.id}/edit` },
                { label: translations.actions.delete, destructive: true, onSelect: () => handleDelete(row) },
              ]}
            />
          )}
          onRowClick={(row) => router.push(`/backend/booking/resource-types/${row.id}/edit`)}
          perspective={{ tableId: 'booking.resource-types.list' }}
        />
      </PageBody>
    </Page>
  )
}

function mapApiResourceType(item: Record<string, unknown>): ResourceTypeRow {
  const id = typeof item.id === 'string' ? item.id : ''
  const name = typeof item.name === 'string' && item.name.length ? item.name : id
  const description = typeof item.description === 'string' && item.description.length
    ? item.description
    : typeof item.description === 'string'
      ? item.description
      : null
  const updatedAt = typeof item.updatedAt === 'string'
    ? item.updatedAt
    : typeof item.updated_at === 'string'
      ? item.updated_at
      : null
  return { id, name, description, updatedAt }
}

function formatDateTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}
