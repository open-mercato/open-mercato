'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import type { SortingState } from '@tanstack/react-table'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { ListEmptyState } from '@open-mercato/ui/backend/filters/ListEmptyState'
import { RowActions, type RowActionItem } from '@open-mercato/ui/backend/RowActions'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { clearAllOperations } from '@open-mercato/ui/backend/operations/store'
import { apiCall, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { buildOptimisticLockHeader, extractOptimisticLockConflict } from '@open-mercato/ui/backend/utils/optimisticLock'
import { raiseCrudError } from '@open-mercato/ui/backend/utils/serverErrors'
import { Button } from '@open-mercato/ui/primitives/button'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { StoreCreateDialog } from './StoreCreateDialog'
import { STORE_STATUS_LABELS, StoreStatusBadge } from './StoreStatusBadge'
import {
  STORE_STATUSES,
  STORES_API_PATH,
  STORES_API_URL,
  formatPrimaryDomain,
  type StoreAdminRecord,
  type StoreListResponse,
  type StoreStatus,
} from './storeAdmin'
import { buildStoreEditHref } from './storeEditTabs'
import { useStoreAccess } from './useStoreAccess'

export const STORE_LIST_PAGE_SIZE = 25

const STORE_LIST_QUERY_KEY = ['ecommerce', 'stores', 'list'] as const

function isStoreStatus(value: unknown): value is StoreStatus {
  return typeof value === 'string' && (STORE_STATUSES as readonly string[]).includes(value)
}

function readStatusFilter(values: FilterValues): StoreStatus | null {
  const value = values.status
  return isStoreStatus(value) ? value : null
}

function buildListQuery(input: {
  page: number
  search: string
  status: StoreStatus | null
  sorting: SortingState
}): string {
  const params = new URLSearchParams()
  params.set('page', String(input.page))
  params.set('pageSize', String(STORE_LIST_PAGE_SIZE))
  const search = input.search.trim()
  if (search) params.set('search', search)
  if (input.status) params.set('status', input.status)
  const sort = input.sorting[0]
  if (sort) {
    params.set('sortField', sort.id)
    params.set('sortDir', sort.desc ? 'desc' : 'asc')
  }
  return params.toString()
}

export function StoreListPage() {
  const t = useT()
  const locale = useLocale()
  const router = useRouter()
  const queryClient = useQueryClient()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const { runMutation, retryLastMutation } = useGuardedMutation<Record<string, unknown>>({
    contextId: 'ecommerce-store-list',
  })
  const { canManage } = useStoreAccess()
  const [page, setPage] = React.useState(1)
  const [search, setSearch] = React.useState('')
  const [filterValues, setFilterValues] = React.useState<FilterValues>({})
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'name', desc: false }])
  const [createOpen, setCreateOpen] = React.useState(false)

  const status = readStatusFilter(filterValues)
  const query = buildListQuery({ page, search, status, sorting })

  const storesQuery = useQuery({
    queryKey: [...STORE_LIST_QUERY_KEY, query],
    queryFn: async (): Promise<StoreListResponse> => {
      const call = await apiCall<StoreListResponse>(`${STORES_API_URL}?${query}`, { cache: 'no-store' })
      if (!call.ok) {
        await raiseCrudError(call.response, t('ecommerce.backend.stores.errors.load', 'Failed to load stores.'))
      }
      return call.result ?? { items: [], total: 0, totalPages: 1 }
    },
  })

  const refresh = React.useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: STORE_LIST_QUERY_KEY })
  }, [queryClient])

  const dateFormatter = React.useMemo(() => new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }), [locale])

  const filters = React.useMemo<FilterDef[]>(
    () => [
      {
        id: 'status',
        type: 'select',
        label: t('ecommerce.backend.stores.filters.status', 'Status'),
        options: STORE_STATUSES.map((value) => ({
          value,
          label: t(STORE_STATUS_LABELS[value].key, STORE_STATUS_LABELS[value].fallback),
        })),
      },
    ],
    [t],
  )

  const hasActiveFilters = status !== null || search.trim().length > 0

  const clearFilters = React.useCallback(() => {
    setFilterValues({})
    setSearch('')
    setPage(1)
  }, [])

  const handleArchive = React.useCallback(
    async (row: StoreAdminRecord) => {
      const confirmed = await confirm({
        title: t('ecommerce.backend.stores.archive.confirmTitle', 'Archive store "{name}"?', { name: row.name }),
        text: t(
          'ecommerce.backend.stores.archive.confirmText',
          'An archived store stops serving its storefront (HTTP 410). Its configuration and history are kept, but it cannot be unarchived.',
        ),
        confirmText: t('ecommerce.backend.stores.archive.confirmButton', 'Archive store'),
        variant: 'destructive',
      })
      if (!confirmed) return
      const archiveError = t('ecommerce.backend.stores.errors.archive', 'Failed to archive the store.')
      try {
        await runMutation({
          operation: () =>
            withScopedApiRequestHeaders(buildOptimisticLockHeader(row.updatedAt), () =>
              updateCrud(STORES_API_PATH, { id: row.id, status: 'archived' }, { errorMessage: archiveError }),
            ),
          context: { retryLastMutation },
          mutationPayload: { id: row.id, status: 'archived' },
        })
        clearAllOperations()
        flash(t('ecommerce.backend.stores.flash.archived', 'Store archived'), 'success')
        await refresh()
      } catch (error) {
        if (extractOptimisticLockConflict(error)) return
        flash(error instanceof Error && error.message ? error.message : archiveError, 'error')
      }
    },
    [confirm, refresh, retryLastMutation, runMutation, t],
  )

  const columns = React.useMemo<ColumnDef<StoreAdminRecord>[]>(
    () => [
      {
        accessorKey: 'name',
        header: t('ecommerce.backend.stores.columns.name', 'Name'),
        enableSorting: true,
        cell: ({ row }) => row.original.name,
      },
      {
        accessorKey: 'code',
        header: t('ecommerce.backend.stores.columns.code', 'Code'),
        enableSorting: true,
      },
      {
        accessorKey: 'status',
        header: t('ecommerce.backend.stores.columns.status', 'Status'),
        enableSorting: true,
        cell: ({ row }) => <StoreStatusBadge status={row.original.status} />,
      },
      {
        id: 'primaryDomain',
        header: t('ecommerce.backend.stores.columns.primaryDomain', 'Primary domain'),
        enableSorting: false,
        cell: ({ row }) => formatPrimaryDomain(row.original._ecommerce) ?? '—',
      },
      {
        id: 'channel',
        header: t('ecommerce.backend.stores.columns.channel', 'Channel'),
        enableSorting: false,
        cell: ({ row }) => {
          const channel = row.original._ecommerce?.defaultChannel
          if (channel) return channel.name
          return (
            <span className="text-muted-foreground">
              {t('ecommerce.backend.stores.columns.noDefaultChannel', 'No default channel')}
            </span>
          )
        },
      },
      {
        accessorKey: 'createdAt',
        header: t('ecommerce.backend.stores.columns.created', 'Created'),
        enableSorting: true,
        cell: ({ row }) => {
          const value = row.original.createdAt
          return value ? dateFormatter.format(new Date(value)) : '—'
        },
      },
    ],
    [dateFormatter, t],
  )

  const buildRowActions = React.useCallback(
    (row: StoreAdminRecord): RowActionItem[] => {
      const items: RowActionItem[] = [
        { id: 'edit', label: t('ecommerce.backend.stores.actions.edit', 'Edit'), href: buildStoreEditHref(row.id, 'general') },
        { id: 'domains', label: t('ecommerce.backend.stores.actions.domains', 'Domains'), href: buildStoreEditHref(row.id, 'domains') },
        { id: 'channels', label: t('ecommerce.backend.stores.actions.channels', 'Channels'), href: buildStoreEditHref(row.id, 'channels') },
      ]
      if (canManage && row.status !== 'archived') {
        items.push({
          id: 'archive',
          label: t('ecommerce.backend.stores.actions.archive', 'Archive'),
          destructive: true,
          onSelect: () => {
            void handleArchive(row)
          },
        })
      }
      return items
    },
    [canManage, handleArchive, t],
  )

  const createAction = canManage ? (
    <Button type="button" onClick={() => setCreateOpen(true)}>
      {t('ecommerce.backend.stores.actions.create', 'Create store')}
    </Button>
  ) : null

  const emptyState = (
    <ListEmptyState
      entityName={t('ecommerce.backend.stores.entityPlural', 'stores')}
      title={t('ecommerce.backend.stores.empty.title', 'No stores yet')}
      description={
        canManage
          ? t(
              'ecommerce.backend.stores.empty.description',
              'A new workspace gets one draft store automatically. If this workspace existed before the Stores module was enabled, run the pending upgrade action from the dashboard to create it, or create a store now.',
            )
          : t(
              'ecommerce.backend.stores.empty.descriptionReadOnly',
              'A new workspace gets one draft store automatically. If this workspace existed before the Stores module was enabled, an administrator needs to run the pending upgrade action from the dashboard.',
            )
      }
      onCreate={canManage ? () => setCreateOpen(true) : undefined}
      createLabel={t('ecommerce.backend.stores.actions.create', 'Create store')}
    />
  )

  return (
    <Page>
      <PageBody>
        <DataTable<StoreAdminRecord>
          title={t('ecommerce.module.title', 'Stores')}
          titleHeadingLevel={1}
          columns={columns}
          data={storesQuery.data?.items ?? []}
          isLoading={storesQuery.isLoading}
          error={storesQuery.isError ? t('ecommerce.backend.stores.errors.load', 'Failed to load stores.') : null}
          actions={createAction}
          searchValue={search}
          onSearchChange={(value) => {
            setSearch(value)
            setPage(1)
          }}
          searchPlaceholder={t('ecommerce.backend.stores.search.placeholder', 'Search by name, code or slug')}
          filters={filters}
          filterValues={filterValues}
          onFiltersApply={(values) => {
            setFilterValues(values)
            setPage(1)
          }}
          onFiltersClear={clearFilters}
          filterAwareEmptyState={{
            active: hasActiveFilters,
            entityNamePlural: t('ecommerce.backend.stores.entityPlural', 'stores'),
            canRemoveLast: status !== null,
            onClearAll: clearFilters,
            onRemoveLast: clearFilters,
          }}
          sorting={sorting}
          onSortingChange={(next) => {
            setSorting(next)
            setPage(1)
          }}
          sortable
          manualSorting
          rowActions={(row) => <RowActions items={buildRowActions(row)} />}
          onRowClick={(row) => router.push(buildStoreEditHref(row.id, 'general'))}
          emptyState={emptyState}
          pagination={{
            page,
            pageSize: STORE_LIST_PAGE_SIZE,
            total: storesQuery.data?.total ?? 0,
            totalPages: storesQuery.data?.totalPages ?? 1,
            totalIsCapped: storesQuery.data?.totalIsCapped === true,
            onPageChange: setPage,
          }}
        />
        {canManage ? (
          <StoreCreateDialog
            open={createOpen}
            onOpenChange={setCreateOpen}
            onCreated={async () => {
              clearFilters()
              await refresh()
            }}
          />
        ) : null}
        {ConfirmDialogElement}
      </PageBody>
    </Page>
  )
}
