"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import type { SortingState } from '@tanstack/react-table'
import { useQuery } from '@tanstack/react-query'
import { ClipboardList, PackagePlus } from 'lucide-react'
import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { EmptyState } from '@open-mercato/ui/backend/EmptyState'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { raiseCrudError } from '@open-mercato/ui/backend/utils/serverErrors'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { E } from '#generated/entities.ids.generated'
import { extensionPoints } from '@open-mercato/core/modules/wms/extension-points'
import { CreateAsnDialog } from './CreateAsnDialog'
import { asnStatusVariant } from './inboundStatusUi'
import { useWmsInventoryMutationAccess } from './useWmsInventoryMutationAccess'
import { loadWarehouseOptions, resolveWarehouseLabel } from './inventoryMutationLoaders'

type AsnRow = {
  id: string
  warehouse_id?: string | null
  vendor_id?: string | null
  status?: string | null
  expected_at?: string | null
  reference_number?: string | null
  notes?: string | null
  created_at?: string | null
  updated_at?: string | null
}

type PagedResponse<T> = {
  items: T[]
  total: number
  totalPages: number
}

/** Server-side multi-status for `?queue=open` (mirrors putaway `open,in_progress`). */
const OPEN_QUEUE_STATUS_PARAM = 'draft,in_transit'

export default function WmsAsnsListPage() {
  const t = useT()
  const locale = useLocale()
  const router = useRouter()
  const searchParams = useSearchParams()
  const access = useWmsInventoryMutationAccess()
  const queueOpen = searchParams.get('queue') === 'open'
  const statusFromUrl = searchParams.get('status')?.trim() || ''

  const [page, setPage] = React.useState(1)
  const [search, setSearch] = React.useState('')
  const [statusFilter, setStatusFilter] = React.useState(statusFromUrl || (queueOpen ? '' : ''))
  const [warehouseId, setWarehouseId] = React.useState('')
  const [warehouseOptions, setWarehouseOptions] = React.useState<Array<{ value: string; label: string }>>([])
  const [warehouseLabels, setWarehouseLabels] = React.useState<Record<string, string>>({})
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'expectedAt', desc: false }])
  const [createOpen, setCreateOpen] = React.useState(false)

  React.useEffect(() => {
    setStatusFilter(statusFromUrl)
  }, [statusFromUrl])

  React.useEffect(() => {
    let cancelled = false
    void loadWarehouseOptions().then((options) => {
      if (!cancelled) setWarehouseOptions(options)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const dateFormatter = React.useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }),
    [locale],
  )

  const queryKey = React.useMemo(
    () => ['wms-asns-list', page, search, statusFilter, warehouseId, sorting, queueOpen],
    [page, queueOpen, search, sorting, statusFilter, warehouseId],
  )

  const asnsQuery = useQuery({
    queryKey,
    queryFn: async () => {
      const sortCol = sorting[0]
      const params = new URLSearchParams({
        page: String(page),
        pageSize: '50',
        sortField: sortCol ? sortCol.id : 'expectedAt',
        sortDir: sortCol ? (sortCol.desc ? 'desc' : 'asc') : 'asc',
      })
      if (search.trim()) params.set('search', search.trim())
      if (statusFilter) params.set('status', statusFilter)
      else if (queueOpen) params.set('status', OPEN_QUEUE_STATUS_PARAM)
      if (warehouseId) params.set('warehouseId', warehouseId)
      const call = await apiCall<PagedResponse<AsnRow>>(`/api/wms/asns?${params.toString()}`)
      if (!call.ok) {
        await raiseCrudError(call.response, t('wms.backend.asns.errors.load', 'Failed to load ASNs.'))
      }
      return call.result ?? { items: [], total: 0, totalPages: 1 }
    },
  })

  React.useEffect(() => {
    const ids = Array.from(
      new Set(
        (asnsQuery.data?.items ?? [])
          .map((row) => row.warehouse_id)
          .filter((id): id is string => typeof id === 'string' && id.length > 0),
      ),
    )
    if (ids.length === 0) return
    let cancelled = false
    void Promise.all(ids.map(async (id) => [id, await resolveWarehouseLabel(id)] as const)).then(
      (entries) => {
        if (cancelled) return
        setWarehouseLabels((prev) => {
          const next = { ...prev }
          for (const [id, label] of entries) {
            if (label) next[id] = label
          }
          return next
        })
      },
    )
    return () => {
      cancelled = true
    }
  }, [asnsQuery.data?.items])

  const statusLabel = React.useCallback(
    (status: string) => t(`wms.backend.asns.status.${status}`, status),
    [t],
  )

  const columns = React.useMemo<ColumnDef<AsnRow>[]>(
    () => [
      {
        accessorKey: 'reference_number',
        id: 'referenceNumber',
        header: t('wms.backend.asns.columns.reference', 'Reference'),
        enableSorting: true,
        cell: ({ row }) => {
          const label = row.original.reference_number?.trim() || row.original.id.slice(0, 8)
          return (
            <Link
              href={`/backend/wms/asns/${encodeURIComponent(row.original.id)}`}
              className="font-medium text-primary hover:underline"
            >
              {label}
            </Link>
          )
        },
      },
      {
        accessorKey: 'status',
        id: 'status',
        header: t('wms.backend.asns.columns.status', 'Status'),
        enableSorting: true,
        cell: ({ row }) => {
          const status = row.original.status?.trim()
          if (!status) return '—'
          return (
            <StatusBadge variant={asnStatusVariant(status)} dot>
              {statusLabel(status)}
            </StatusBadge>
          )
        },
      },
      {
        accessorKey: 'warehouse_id',
        id: 'warehouse',
        header: t('wms.backend.asns.columns.warehouse', 'Warehouse'),
        enableSorting: false,
        cell: ({ row }) => {
          const id = row.original.warehouse_id
          if (!id) return '—'
          return warehouseLabels[id] || id.slice(0, 8)
        },
      },
      {
        accessorKey: 'expected_at',
        id: 'expectedAt',
        header: t('wms.backend.asns.columns.expectedAt', 'Expected'),
        enableSorting: true,
        cell: ({ row }) => {
          const value = row.original.expected_at
          if (!value) return '—'
          const date = new Date(value)
          if (Number.isNaN(date.getTime())) return '—'
          return dateFormatter.format(date)
        },
      },
    ],
    [dateFormatter, statusLabel, t, warehouseLabels],
  )

  const rowActions = React.useCallback(
    (row: AsnRow) => (
      <RowActions
        items={[
          {
            id: 'open',
            label: t('wms.backend.asns.actions.open', 'Open receiving'),
            onSelect: () => router.push(`/backend/wms/asns/${encodeURIComponent(row.id)}`),
          },
        ]}
      />
    ),
    [router, t],
  )

  const title = queueOpen
    ? t('wms.backend.receiving.title', 'Receiving queue')
    : t('wms.backend.asns.title', 'ASNs')
  const description = queueOpen
    ? t(
        'wms.backend.receiving.description',
        'Open and in-transit ASNs ready for receiving.',
      )
    : t('wms.backend.asns.description', 'Advance shipping notices and inbound receiving.')

  return (
    <Page>
      <PageBody className="space-y-6">
        <PageHeader
          title={title}
          description={description}
          actions={
            <div className="flex flex-wrap gap-2">
              {access.canManagePutaway ? (
                <Button type="button" variant="outline" asChild>
                  <Link href="/backend/wms/putaway">
                    {t('wms.backend.asns.actions.putawayQueue', 'Putaway queue')}
                  </Link>
                </Button>
              ) : null}
              {access.canManageAsn ? (
                <Button type="button" onClick={() => setCreateOpen(true)}>
                  <PackagePlus className="size-4" />
                  {t('wms.backend.asns.actions.create', 'Create ASN')}
                </Button>
              ) : null}
            </div>
          }
        />

        {asnsQuery.isLoading ? (
          <LoadingMessage label={t('wms.backend.asns.loading', 'Loading ASNs…')} />
        ) : null}
        {asnsQuery.isError ? (
          <ErrorMessage label={t('wms.backend.asns.errors.load', 'Failed to load ASNs.')} />
        ) : null}

        {asnsQuery.data ? (
          <section className="rounded-lg border bg-card p-5 text-card-foreground shadow-sm">
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex items-start gap-3">
                <div className="rounded-md border bg-muted/40 p-2 text-muted-foreground">
                  <ClipboardList className="size-5" />
                </div>
                <div className="space-y-1">
                  <h2 className="text-xl font-semibold">{title}</h2>
                  <p className="text-sm text-muted-foreground">{description}</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Select
                  value={statusFilter || (queueOpen ? 'queue-open' : 'all')}
                  onValueChange={(value) => {
                    setPage(1)
                    if (value === 'queue-open') {
                      setStatusFilter('')
                      router.replace('/backend/wms/asns?queue=open')
                      return
                    }
                    if (value === 'all') {
                      setStatusFilter('')
                      router.replace('/backend/wms/asns')
                      return
                    }
                    setStatusFilter(value)
                    router.replace(`/backend/wms/asns?status=${encodeURIComponent(value)}`)
                  }}
                >
                  <SelectTrigger className="w-[180px]" data-testid="asn-status-filter">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t('wms.backend.asns.filters.statusAll', 'All statuses')}</SelectItem>
                    <SelectItem value="queue-open">
                      {t('wms.backend.asns.filters.statusOpen', 'Open receiving')}
                    </SelectItem>
                    <SelectItem value="draft">{statusLabel('draft')}</SelectItem>
                    <SelectItem value="in_transit">{statusLabel('in_transit')}</SelectItem>
                    <SelectItem value="received">{statusLabel('received')}</SelectItem>
                    <SelectItem value="closed">{statusLabel('closed')}</SelectItem>
                  </SelectContent>
                </Select>
                <Select
                  value={warehouseId || 'all'}
                  onValueChange={(value) => {
                    setPage(1)
                    setWarehouseId(value === 'all' ? '' : value)
                  }}
                >
                  <SelectTrigger className="w-[200px]" data-testid="asn-warehouse-filter">
                    <SelectValue placeholder={t('wms.backend.asns.filters.warehouse', 'Warehouse')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">
                      {t('wms.backend.asns.filters.warehouseAll', 'All warehouses')}
                    </SelectItem>
                    {warehouseOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <DataTable
              embedded
              title={title}
              columns={columns}
              data={asnsQuery.data.items}
              isLoading={asnsQuery.isFetching}
              entityId={E.wms.asn}
              searchValue={search}
              onSearchChange={(value) => {
                setSearch(value)
                setPage(1)
              }}
              searchPlaceholder={t('wms.backend.asns.search', 'Search ASNs')}
              sortable
              manualSorting
              sorting={sorting}
              onSortingChange={(next) => {
                setSorting(next)
                setPage(1)
              }}
              rowActions={rowActions}
              onRowClick={(row) => router.push(`/backend/wms/asns/${encodeURIComponent(row.id)}`)}
              pagination={{
                page,
                pageSize: 50,
                total: asnsQuery.data.total,
                totalPages: asnsQuery.data.totalPages,
                onPageChange: setPage,
              }}
              perspective={{ tableId: extensionPoints.hosts.asnsTable.tableId }}
              emptyState={
                <EmptyState
                  title={t('wms.backend.asns.empty.title', 'No ASNs')}
                  description={t(
                    'wms.backend.asns.empty.description',
                    'Create an ASN to start expected inbound receiving.',
                  )}
                  actions={
                    access.canManageAsn ? (
                      <Button type="button" size="sm" onClick={() => setCreateOpen(true)}>
                        {t('wms.backend.asns.actions.create', 'Create ASN')}
                      </Button>
                    ) : null
                  }
                />
              }
            />
          </section>
        ) : null}
      </PageBody>

      {access.canManageAsn ? (
        <CreateAsnDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          access={access}
          onCreated={(asnId) => router.push(`/backend/wms/asns/${encodeURIComponent(asnId)}`)}
        />
      ) : null}
    </Page>
  )
}
