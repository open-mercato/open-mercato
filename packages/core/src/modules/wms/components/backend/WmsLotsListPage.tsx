"use client"

import * as React from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import type { ColumnDef, SortingState } from '@tanstack/react-table'
import { useQuery } from '@tanstack/react-query'
import { Layers } from 'lucide-react'
import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { EmptyState } from '@open-mercato/ui/backend/EmptyState'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { raiseCrudError } from '@open-mercato/ui/backend/utils/serverErrors'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { E } from '#generated/entities.ids.generated'
import type { ExpiryWindow } from '../../lib/expiry'
import { Button } from '@open-mercato/ui/primitives/button'
import { ChangeLotStatusDialog } from './ChangeLotStatusDialog'
import { MoveInventoryDialog } from './MoveInventoryDialog'
import { ReceiveInventoryDialog } from './ReceiveInventoryDialog'
import { useWmsInventoryMutationAccess } from './useWmsInventoryMutationAccess'

type InventoryLotRow = {
  id: string
  lot_number?: string | null
  batch_number?: string | null
  sku?: string | null
  catalog_variant_id?: string | null
  expires_at?: string | null
  status?: string | null
  updated_at?: string | null
}

type PagedResponse<T> = {
  items: T[]
  total: number
  totalPages: number
}

function parseExpiryWindow(value: string | null): ExpiryWindow | null {
  if (value === 'expiringSoon' || value === 'pastDue') return value
  return null
}

function resolveLotStatusVariant(
  expiresAt: string | null | undefined,
  status: string | null | undefined,
  nowMs: number,
): 'error' | 'warning' | 'neutral' {
  if (status === 'expired') return 'error'
  if (!expiresAt) return 'neutral'
  const expires = new Date(expiresAt).getTime()
  if (Number.isNaN(expires)) return 'neutral'
  if (expires <= nowMs) return 'error'
  if (expires - nowMs <= 30 * 24 * 60 * 60 * 1000) return 'warning'
  return 'neutral'
}

export default function WmsLotsListPage() {
  const t = useT()
  const locale = useLocale()
  const access = useWmsInventoryMutationAccess()
  const searchParams = useSearchParams()
  const expiryWindow = parseExpiryWindow(searchParams.get('expiryWindow'))
  const warehouseId = searchParams.get('warehouseId')?.trim() || null
  const [page, setPage] = React.useState(1)
  const [search, setSearch] = React.useState('')
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'expiresAt', desc: false }])
  const [changeStatusOpen, setChangeStatusOpen] = React.useState(false)
  const [moveOpen, setMoveOpen] = React.useState(false)
  const [activeLot, setActiveLot] = React.useState<InventoryLotRow | null>(null)
  const [receiveOpen, setReceiveOpen] = React.useState(false)

  const handleSortingChange = React.useCallback((nextSorting: SortingState) => {
    setSorting(nextSorting)
    setPage(1)
  }, [])

  const expiryFormatter = React.useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }),
    [locale],
  )

  const queryKey = React.useMemo(
    () => ['wms-lots-list', expiryWindow, warehouseId, page, search, sorting],
    [expiryWindow, warehouseId, page, search, sorting],
  )

  const lotsQuery = useQuery({
    queryKey,
    queryFn: async () => {
      const sortCol = sorting[0]
      const params = new URLSearchParams({
        page: String(page),
        pageSize: '25',
        sortField: sortCol ? sortCol.id : 'expiresAt',
        sortDir: sortCol ? (sortCol.desc ? 'desc' : 'asc') : 'asc',
      })
      if (search.trim()) params.set('search', search.trim())
      if (expiryWindow) params.set('expiryWindow', expiryWindow)
      if (warehouseId) params.set('warehouseId', warehouseId)
      const call = await apiCall<PagedResponse<InventoryLotRow>>(`/api/wms/lots?${params.toString()}`)
      if (!call.ok) {
        await raiseCrudError(call.response, t('wms.backend.lots.errors.load', 'Failed to load lots.'))
      }
      return call.result ?? { items: [], total: 0, totalPages: 1 }
    },
  })

  const nowMs = Date.now()

  const openChangeStatus = React.useCallback((row: InventoryLotRow) => {
    setActiveLot(row)
    setChangeStatusOpen(true)
  }, [])

  const openMove = React.useCallback((row: InventoryLotRow) => {
    setActiveLot(row)
    setMoveOpen(true)
  }, [])

  const columns = React.useMemo<ColumnDef<InventoryLotRow>[]>(
    () => [
      {
        accessorKey: 'lot_number',
        id: 'lotNumber',
        header: t('wms.backend.lots.columns.lotNumber', 'Lot number'),
        enableSorting: true,
        cell: ({ row }) => {
          const lotId = row.original.id
          const label = row.original.lot_number?.trim() || lotId
          return (
            <Link
              href={`/backend/wms/lot/${encodeURIComponent(lotId)}`}
              className="font-medium text-primary hover:underline"
            >
              {label}
            </Link>
          )
        },
      },
      {
        accessorKey: 'sku',
        id: 'sku',
        header: t('wms.backend.lots.columns.sku', 'SKU'),
        enableSorting: true,
        cell: ({ row }) => row.original.sku?.trim() || '—',
      },
      {
        accessorKey: 'expires_at',
        id: 'expiresAt',
        header: t('wms.backend.lots.columns.expiresAt', 'Expires'),
        enableSorting: true,
        cell: ({ row }) => {
          const expiresAt = row.original.expires_at
          if (!expiresAt) return '—'
          const variant = resolveLotStatusVariant(expiresAt, row.original.status, nowMs)
          return (
            <StatusBadge variant={variant} dot>
              {expiryFormatter.format(new Date(expiresAt))}
            </StatusBadge>
          )
        },
      },
      {
        accessorKey: 'status',
        id: 'status',
        header: t('wms.backend.lots.columns.status', 'Status'),
        enableSorting: true,
        cell: ({ row }) => {
          const status = row.original.status?.trim()
          if (!status) return '—'
          const variant = resolveLotStatusVariant(row.original.expires_at, status, nowMs)
          return (
            <StatusBadge variant={variant} dot>
              {t(`wms.backend.lot.status.${status}`, status)}
            </StatusBadge>
          )
        },
      },
    ],
    [expiryFormatter, nowMs, t],
  )

  const rowActions = React.useCallback(
    (row: InventoryLotRow) => {
      const items = []
      if (access.canAdjust) {
        items.push({
          id: 'change-status',
          label: t('wms.backend.lots.actions.changeStatus', 'Change status'),
          onSelect: () => openChangeStatus(row),
        })
        items.push({
          id: 'move',
          label: t('wms.backend.lots.actions.move', 'Move'),
          onSelect: () => openMove(row),
        })
      }
      if (items.length === 0) return null
      return <RowActions items={items} />
    },
    [access.canAdjust, openChangeStatus, openMove, t],
  )

  const title = expiryWindow === 'pastDue'
    ? t('wms.backend.lots.title.pastDue', 'Past-due lots')
    : expiryWindow === 'expiringSoon'
      ? t('wms.backend.lots.title.expiringSoon', 'Lots expiring soon')
      : t('wms.backend.lots.title.all', 'Inventory lots')

  const description = expiryWindow === 'pastDue'
    ? t(
        'wms.backend.lots.description.pastDue',
        'Lots past their expiry date with on-hand stock in the selected warehouse scope.',
      )
    : expiryWindow === 'expiringSoon'
      ? t(
          'wms.backend.lots.description.expiringSoon',
          'Lots expiring within the next 30 days in the selected warehouse scope.',
        )
      : t('wms.backend.lots.description.all', 'Browse lot and batch records with expiry context.')

  return (
    <Page>
      <PageBody className="space-y-6">
        <PageHeader title={title} description={description} />

        {lotsQuery.isLoading ? (
          <LoadingMessage label={t('wms.backend.lots.loading', 'Loading lots…')} />
        ) : null}

        {lotsQuery.isError ? (
          <ErrorMessage label={t('wms.backend.lots.errors.load', 'Failed to load lots.')} />
        ) : null}

        {lotsQuery.data ? (
          <section className="rounded-lg border bg-card p-5 text-card-foreground shadow-sm">
            <div className="mb-4 flex items-start gap-3">
              <div className="rounded-md border bg-muted/40 p-2 text-muted-foreground">
                <Layers className="size-5" />
              </div>
              <div className="space-y-1">
                <h2 className="text-xl font-semibold">{title}</h2>
                <p className="text-sm text-muted-foreground">{description}</p>
              </div>
            </div>
            <DataTable
              embedded
              title={title}
              columns={columns}
              data={lotsQuery.data.items}
              isLoading={lotsQuery.isFetching}
              entityId={E.wms.inventory_lot}
              searchValue={search}
              onSearchChange={(value) => {
                setSearch(value)
                setPage(1)
              }}
              searchPlaceholder={t('wms.backend.lots.search', 'Search lots')}
              sortable
              manualSorting
              sorting={sorting}
              onSortingChange={handleSortingChange}
              rowActions={rowActions}
              pagination={{
                page,
                pageSize: 25,
                total: lotsQuery.data.total,
                totalPages: lotsQuery.data.totalPages,
                onPageChange: setPage,
              }}
              perspective={{ tableId: 'wms.lots.list' }}
              emptyState={
                <EmptyState
                  title={t('wms.backend.lots.empty.title', 'No lots found')}
                  description={t(
                    'wms.backend.lots.empty.description',
                    'Adjust filters or create lots through inventory operations.',
                  )}
                  actions={
                    access.canReceive ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setReceiveOpen(true)}
                      >
                        {t('wms.backend.lots.empty.receive', 'Receive stock')}
                      </Button>
                    ) : null
                  }
                />
              }
            />
          </section>
        ) : null}
      </PageBody>

      {access.canReceive ? (
        <ReceiveInventoryDialog
          open={receiveOpen}
          onOpenChange={setReceiveOpen}
          access={access}
        />
      ) : null}
      {access.canAdjust && activeLot ? (
        <>
          <ChangeLotStatusDialog
            open={changeStatusOpen}
            onOpenChange={setChangeStatusOpen}
            access={access}
            lotId={activeLot.id}
            currentStatus={activeLot.status}
            lotUpdatedAt={activeLot.updated_at}
            onSuccess={() => {
              void lotsQuery.refetch()
            }}
          />
          <MoveInventoryDialog
            open={moveOpen}
            onOpenChange={setMoveOpen}
            access={access}
            initialCatalogVariantId={activeLot.catalog_variant_id ?? undefined}
            initialWarehouseId={warehouseId ?? undefined}
            initialLotId={activeLot.id}
          />
        </>
      ) : null}
    </Page>
  )
}
