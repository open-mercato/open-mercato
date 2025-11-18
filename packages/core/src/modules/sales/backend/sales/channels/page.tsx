"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import type { ColumnDef, SortingState } from '@tanstack/react-table'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { Button } from '@open-mercato/ui/primitives/button'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { BooleanIcon } from '@open-mercato/ui/backend/ValueIcons'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { useOrganizationScopeVersion } from '@/lib/frontend/useOrganizationScope'
import { useT } from '@/lib/i18n/context'

type ChannelRow = {
  id: string
  name: string
  code: string | null
  description: string | null
  offerCount: number
  isActive: boolean
  updatedAt: string | null
}

type ChannelsResponse = {
  items?: Array<Record<string, unknown>>
  total?: number
  totalPages?: number
}

const PAGE_SIZE = 25

export default function SalesChannelsPage() {
  const t = useT()
  const router = useRouter()
  const scopeVersion = useOrganizationScopeVersion()
  const [rows, setRows] = React.useState<ChannelRow[]>([])
  const [page, setPage] = React.useState(1)
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [sorting, setSorting] = React.useState<SortingState>([])
  const [search, setSearch] = React.useState('')
  const [isLoading, setLoading] = React.useState(true)
  const [reloadToken, setReloadToken] = React.useState(0)

  const columns = React.useMemo<ColumnDef<ChannelRow>[]>(() => [
    {
      accessorKey: 'name',
      header: t('sales.channels.table.name', 'Name'),
      cell: ({ row }) => (
        <div className="flex flex-col">
          <span className="font-medium">{row.original.name}</span>
          {row.original.description ? (
            <span className="text-xs text-muted-foreground">{row.original.description}</span>
          ) : null}
        </div>
      ),
      meta: { sticky: true },
    },
    {
      accessorKey: 'code',
      header: t('sales.channels.table.code', 'Code'),
      cell: ({ row }) => row.original.code ? (
        <span className="font-mono text-xs">{row.original.code}</span>
      ) : (
        <span className="text-xs text-muted-foreground">—</span>
      ),
    },
    {
      accessorKey: 'offerCount',
      header: t('sales.channels.table.offers', 'Product offers'),
      cell: ({ row }) => (
        <span className="text-sm font-semibold">{row.original.offerCount}</span>
      ),
    },
    {
      accessorKey: 'isActive',
      header: t('sales.channels.table.active', 'Active'),
      cell: ({ row }) => <BooleanIcon value={row.original.isActive} />,
    },
    {
      accessorKey: 'updatedAt',
      header: t('sales.channels.table.updated', 'Updated'),
      cell: ({ row }) =>
        row.original.updatedAt
          ? <span className="text-xs text-muted-foreground">{new Date(row.original.updatedAt).toLocaleDateString()}</span>
          : <span className="text-xs text-muted-foreground">—</span>,
    },
  ], [t])

  const loadChannels = React.useCallback(async () => {
    setLoading(true)
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
      if (search.trim().length) {
        params.set('search', search.trim())
      }
      const payload = await readApiResultOrThrow<ChannelsResponse>(
        `/api/sales/channels?${params.toString()}`,
        undefined,
        { errorMessage: t('sales.channels.table.errors.load', 'Failed to load channels.') },
      )
      const items = Array.isArray(payload.items) ? payload.items : []
      setRows(items.map(mapApiChannel))
      setTotal(typeof payload.total === 'number' ? payload.total : items.length)
      setTotalPages(typeof payload.totalPages === 'number' ? payload.totalPages : Math.max(1, Math.ceil(items.length / PAGE_SIZE)))
    } catch (err) {
      console.error('sales.channels.list', err)
      flash(t('sales.channels.table.errors.load', 'Failed to load channels.'), 'error')
    } finally {
      setLoading(false)
    }
  }, [page, search, sorting, t])

  React.useEffect(() => {
    void loadChannels()
  }, [loadChannels, scopeVersion, reloadToken])

  const handleSearchChange = React.useCallback((value: string) => {
    setSearch(value)
    setPage(1)
  }, [])

  const handleRefresh = React.useCallback(() => {
    setReloadToken((token) => token + 1)
  }, [])

  const handleDelete = React.useCallback(async (row: ChannelRow) => {
    try {
      await deleteCrud('sales/channels', row.id, {
        errorMessage: t('sales.channels.table.errors.delete', 'Failed to delete channel.'),
      })
      flash(t('sales.channels.table.messages.deleted', 'Channel deleted.'), 'success')
      handleRefresh()
    } catch (err) {
      console.error('sales.channels.delete', err)
    }
  }, [handleRefresh, t])

  return (
    <Page>
      <PageBody>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">{t('sales.channels.nav.title', 'Sales channels')}</h1>
            <p className="text-sm text-muted-foreground">
              {t('sales.channels.table.subtitle', 'Organize catalog offers per marketplace or storefront.')}
            </p>
          </div>
          <Button asChild>
            <Link href="/backend/sales/channels/create">
              {t('sales.channels.actions.create', 'Add channel')}
            </Link>
          </Button>
        </div>
        <div className="mt-6">
          <DataTable<ChannelRow>
            columns={columns}
            data={rows}
            sorting={sorting}
            onSortingChange={setSorting}
            isLoading={isLoading}
            searchValue={search}
            onSearchChange={handleSearchChange}
            searchPlaceholder={t('sales.channels.table.search', 'Search channels…')}
            pagination={{
              page,
              pageSize: PAGE_SIZE,
              total,
              totalPages,
              onPageChange: setPage,
            }}
            refreshButton={{
              label: t('sales.channels.table.refresh', 'Refresh'),
              onRefresh: handleRefresh,
              isRefreshing: isLoading,
            }}
            rowActions={(row) => (
              <RowActions
                items={[
                  {
                    id: 'edit',
                    label: t('sales.channels.table.actions.edit', 'Edit'),
                    href: `/backend/sales/channels/${row.id}/edit`,
                  },
                  {
                    id: 'delete',
                    label: t('sales.channels.table.actions.delete', 'Delete'),
                    onSelect: () => handleDelete(row),
                  },
                ]}
              />
            )}
            onRowClick={(row) => router.push(`/backend/sales/channels/${row.id}/edit`)}
            emptyState={
              <div className="py-10 text-center text-sm text-muted-foreground">
                {t('sales.channels.table.empty', 'No channels yet.')}
              </div>
            }
          />
        </div>
      </PageBody>
    </Page>
  )
}

function mapApiChannel(item: Record<string, unknown>): ChannelRow {
  const id = typeof item.id === 'string' ? item.id : ''
  return {
    id,
    name: typeof item.name === 'string' ? item.name : id,
    code: typeof item.code === 'string' && item.code.length ? item.code : null,
    description: typeof item.description === 'string' && item.description.length ? item.description : null,
    offerCount: typeof item.offerCount === 'number'
      ? item.offerCount
      : typeof item.offer_count === 'number'
        ? item.offer_count
        : 0,
    isActive: item.isActive === true || item.is_active === true,
    updatedAt: typeof item.updatedAt === 'string'
      ? item.updatedAt
      : typeof item.updated_at === 'string'
        ? item.updated_at
        : null,
  }
}
