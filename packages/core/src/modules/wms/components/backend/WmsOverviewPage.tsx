"use client"

import * as React from 'react'
import Link from 'next/link'
import type { ColumnDef } from '@tanstack/react-table'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { EmptyState } from '@open-mercato/ui/backend/EmptyState'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { raiseCrudError } from '@open-mercato/ui/backend/utils/serverErrors'
import { useQuery } from '@tanstack/react-query'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { Warehouse, MapPinned, Boxes, Layers, Settings, ClipboardList, Truck } from 'lucide-react'

type WarehouseRow = {
  id: string
  name?: string | null
  code?: string | null
  city?: string | null
  country?: string | null
  is_active?: boolean | null
}

type LocationRow = {
  id: string
  warehouse_id?: string | null
  warehouse_name?: string | null
  warehouse_code?: string | null
  code?: string | null
  type?: string | null
  is_active?: boolean | null
}

type PagedResponse<T> = {
  items: T[]
  total: number
  totalPages: number
}

type OverviewCardProps = {
  title: string
  value: string
  description: string
  icon: React.ReactNode
  href: string
  ctaLabel: string
}

function OverviewCard({ title, value, description, icon, href, ctaLabel }: OverviewCardProps) {
  return (
    <section className="rounded-lg border bg-card p-5 text-card-foreground shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <p className="text-sm font-medium text-muted-foreground">{title}</p>
          <p className="text-2xl font-bold tracking-tight">{value}</p>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        <div className="rounded-md border bg-muted/40 p-2 text-muted-foreground">
          {icon}
        </div>
      </div>
      <div className="mt-4">
        <Button asChild type="button" variant="outline" size="sm">
          <Link href={href}>{ctaLabel}</Link>
        </Button>
      </div>
    </section>
  )
}

export default function WmsOverviewPage() {
  const t = useT()

  const warehouseQuery = useQuery({
    queryKey: ['wms-overview', 'warehouses'],
    queryFn: async () => {
      const params = new URLSearchParams({ page: '1', pageSize: '5', sortField: 'updatedAt', sortDir: 'desc' })
      const call = await apiCall<PagedResponse<WarehouseRow>>(`/api/wms/warehouses?${params.toString()}`)
      if (!call.ok) {
        await raiseCrudError(call.response, t('wms.backend.overview.errors.warehouses', 'Failed to load warehouses.'))
      }
      return call.result ?? { items: [], total: 0, totalPages: 1 }
    },
  })

  const locationQuery = useQuery({
    queryKey: ['wms-overview', 'locations'],
    queryFn: async () => {
      const params = new URLSearchParams({ page: '1', pageSize: '5', sortField: 'updatedAt', sortDir: 'desc' })
      const call = await apiCall<PagedResponse<LocationRow>>(`/api/wms/locations?${params.toString()}`)
      if (!call.ok) {
        await raiseCrudError(call.response, t('wms.backend.overview.errors.locations', 'Failed to load locations.'))
      }
      return call.result ?? { items: [], total: 0, totalPages: 1 }
    },
  })

  const balanceQuery = useQuery({
    queryKey: ['wms-overview', 'balances-total'],
    queryFn: async () => {
      const params = new URLSearchParams({ page: '1', pageSize: '1' })
      const call = await apiCall<PagedResponse<Record<string, unknown>>>(`/api/wms/inventory/balances?${params.toString()}`)
      if (!call.ok) {
        await raiseCrudError(call.response, t('wms.backend.overview.errors.balances', 'Failed to load balances.'))
      }
      return call.result ?? { items: [], total: 0, totalPages: 1 }
    },
  })

  const warehouseColumns = React.useMemo<ColumnDef<WarehouseRow>[]>(() => [
    {
      accessorKey: 'name',
      header: t('wms.backend.overview.warehouses.columns.name', 'Warehouse'),
      cell: ({ row }) => row.original.name || row.original.code || row.original.id,
    },
    {
      accessorKey: 'code',
      header: t('wms.backend.overview.warehouses.columns.code', 'Code'),
    },
    {
      accessorKey: 'city',
      header: t('wms.backend.overview.warehouses.columns.city', 'City'),
      cell: ({ row }) => row.original.city || row.original.country || '—',
    },
    {
      accessorKey: 'is_active',
      header: t('wms.backend.overview.warehouses.columns.status', 'Status'),
      cell: ({ row }) =>
        row.original.is_active === false
          ? t('wms.common.inactive', 'Inactive')
          : t('wms.common.active', 'Active'),
    },
  ], [t])

  const locationColumns = React.useMemo<ColumnDef<LocationRow>[]>(() => [
    {
      accessorKey: 'code',
      header: t('wms.backend.overview.locations.columns.code', 'Location'),
    },
    {
      accessorKey: 'type',
      header: t('wms.backend.overview.locations.columns.type', 'Type'),
      cell: ({ row }) => row.original.type || '—',
    },
    {
      accessorKey: 'warehouse_id',
      header: t('wms.backend.overview.locations.columns.warehouse', 'Warehouse'),
      cell: ({ row }) =>
        row.original.warehouse_name ||
        row.original.warehouse_code ||
        row.original.warehouse_id ||
        '—',
    },
    {
      accessorKey: 'is_active',
      header: t('wms.backend.overview.locations.columns.status', 'Status'),
      cell: ({ row }) =>
        row.original.is_active === false
          ? t('wms.common.inactive', 'Inactive')
          : t('wms.common.active', 'Active'),
    },
  ], [t])

  return (
    <Page>
      <PageBody>
        <div className="space-y-6">
          <section className="grid gap-4 lg:grid-cols-3">
            <OverviewCard
              title={t('wms.backend.overview.cards.warehouses.title', 'Warehouses')}
              value={String(warehouseQuery.data?.total ?? 0)}
              description={t('wms.backend.overview.cards.warehouses.description', 'Configured warehouse nodes available for inventory operations.')}
              icon={<Warehouse className="size-5" />}
              href="/backend/wms/warehouses"
              ctaLabel={t('wms.backend.overview.cards.openWarehouses', 'Open warehouses')}
            />
            <OverviewCard
              title={t('wms.backend.overview.cards.locations.title', 'Locations')}
              value={String(locationQuery.data?.total ?? 0)}
              description={t('wms.backend.overview.cards.locations.description', 'Storage hierarchy currently exposed to reservation and movement flows.')}
              icon={<MapPinned className="size-5" />}
              href="/backend/wms/locations"
              ctaLabel={t('wms.backend.overview.cards.openLocations', 'Open locations')}
            />
            <OverviewCard
              title={t('wms.backend.overview.cards.balances.title', 'Balance buckets')}
              value={String(balanceQuery.data?.total ?? 0)}
              description={t('wms.backend.overview.cards.balances.description', 'Operational stock buckets visible in the phase-1 inventory console.')}
              icon={<Boxes className="size-5" />}
              href="/backend/wms/inventory"
              ctaLabel={t('wms.backend.overview.cards.openInventory', 'Open inventory console')}
            />
          </section>

          <section className="rounded-lg border bg-card p-5 text-card-foreground shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="space-y-1">
                <h2 className="text-xl font-semibold">{t('wms.backend.overview.title', 'WMS overview')}</h2>
                <p className="text-sm text-muted-foreground">
                  {t('wms.backend.overview.description', 'Phase-1 surfaces for warehouse topology, inventory visibility, and baseline configuration.')}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button asChild type="button" variant="outline" size="sm">
                  <Link href="/backend/wms/warehouses">
                    <Warehouse className="size-4" />
                    {t('wms.backend.overview.actions.warehouses', 'Warehouses')}
                  </Link>
                </Button>
                <Button asChild type="button" variant="outline" size="sm">
                  <Link href="/backend/wms/zones">
                    <Layers className="size-4" />
                    {t('wms.backend.overview.actions.zones', 'Zones')}
                  </Link>
                </Button>
                <Button asChild type="button" variant="outline" size="sm">
                  <Link href="/backend/wms/locations">
                    <MapPinned className="size-4" />
                    {t('wms.backend.overview.actions.locations', 'Locations')}
                  </Link>
                </Button>
                <Button asChild type="button" variant="outline" size="sm">
                  <Link href="/backend/wms/inventory">
                    <Boxes className="size-4" />
                    {t('wms.backend.overview.actions.inventory', 'Inventory console')}
                  </Link>
                </Button>
                <Button asChild type="button" variant="outline" size="sm">
                  <Link href="/backend/wms/reservations">
                    <ClipboardList className="size-4" />
                    {t('wms.backend.overview.actions.reservations', 'Reservations')}
                  </Link>
                </Button>
                <Button asChild type="button" variant="outline" size="sm">
                  <Link href="/backend/wms/movements">
                    <Truck className="size-4" />
                    {t('wms.backend.overview.actions.movements', 'Movements')}
                  </Link>
                </Button>
                <Button asChild type="button" variant="outline" size="sm">
                  <Link href="/backend/config/wms">
                    <Settings className="size-4" />
                    {t('wms.backend.overview.actions.config', 'WMS configuration')}
                  </Link>
                </Button>
              </div>
            </div>
          </section>

          <div className="grid gap-6 xl:grid-cols-2">
            <section className="rounded-lg border bg-card p-5 text-card-foreground shadow-sm">
              <DataTable
                embedded
                title={t('wms.backend.overview.warehouses.title', 'Warehouses')}
                columns={warehouseColumns}
                data={warehouseQuery.data?.items ?? []}
                isLoading={warehouseQuery.isLoading}
                error={warehouseQuery.isError ? t('wms.backend.overview.errors.warehouses', 'Failed to load warehouses.') : null}
                perspective={{ tableId: 'wms.overview.warehouses' }}
                emptyState={(
                  <EmptyState
                    title={t('wms.backend.overview.warehouses.empty.title', 'No warehouses yet')}
                    description={t('wms.backend.overview.warehouses.empty.description', 'Create at least one warehouse in WMS configuration to start tracking stock.')}
                    action={{
                      label: t('wms.backend.overview.cards.openWarehouses', 'Open warehouses'),
                      onClick: () => { window.location.href = '/backend/wms/warehouses' },
                    }}
                  />
                )}
              />
            </section>

            <section className="rounded-lg border bg-card p-5 text-card-foreground shadow-sm">
              <DataTable
                embedded
                title={t('wms.backend.overview.locations.title', 'Locations')}
                columns={locationColumns}
                data={locationQuery.data?.items ?? []}
                isLoading={locationQuery.isLoading}
                error={locationQuery.isError ? t('wms.backend.overview.errors.locations', 'Failed to load locations.') : null}
                perspective={{ tableId: 'wms.overview.locations' }}
                emptyState={(
                  <EmptyState
                    title={t('wms.backend.overview.locations.empty.title', 'No locations yet')}
                    description={t('wms.backend.overview.locations.empty.description', 'Locations define the storage buckets that reservations and movements operate on.')}
                    action={{
                      label: t('wms.backend.overview.cards.openLocations', 'Open locations'),
                      onClick: () => { window.location.href = '/backend/wms/locations' },
                    }}
                  />
                )}
              />
            </section>
          </div>
        </div>
      </PageBody>
    </Page>
  )
}
