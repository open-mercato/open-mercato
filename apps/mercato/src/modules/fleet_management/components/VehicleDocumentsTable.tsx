"use client"

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import type { SortingState } from '@tanstack/react-table'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import type { FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { fetchCrudList } from '@open-mercato/ui/backend/utils/crud'
import { formatDate } from '@open-mercato/ui/utils/format'
import { useT, useLocale, useDirection } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'

type DocumentType = 'istimara' | 'insurance' | 'fahs' | 'operating_card' | 'other'

type VehicleDocumentRow = {
  id: string
  vehicle_id: string
  document_type: DocumentType
  document_number?: string | null
  issue_date?: string | null
  expiry_date?: string | null
  notes?: string | null
  updated_at?: string | null
  updatedAt?: string | null
}

type VehicleOption = { id: string; plate_number: string; make: string; model: string }

type ExpiryState = 'expired' | 'expiring' | 'valid' | 'unknown'

const EXPIRING_WINDOW_DAYS = 30

const DOCUMENT_TYPE_VALUES: DocumentType[] = ['istimara', 'insurance', 'fahs', 'operating_card', 'other']

const DOCUMENT_TYPE_FALLBACKS: Record<DocumentType, string> = {
  istimara: 'Registration (Istimara)',
  insurance: 'Insurance',
  fahs: 'Periodic inspection (Fahs)',
  operating_card: 'Operating card',
  other: 'Other',
}

const EXPIRY_FALLBACKS: Record<ExpiryState, string> = {
  expired: 'Expired',
  expiring: 'Expiring soon',
  valid: 'Valid',
  unknown: 'No expiry',
}

const EXPIRY_CLASSES: Record<ExpiryState, string> = {
  expired: 'border-status-error-border bg-status-error-bg text-status-error-text',
  expiring: 'border-status-warning-border bg-status-warning-bg text-status-warning-text',
  valid: 'border-status-success-border bg-status-success-bg text-status-success-text',
  unknown: 'border-border bg-muted text-muted-foreground',
}

function resolveExpiryState(value: string | null | undefined): ExpiryState {
  if (!value) return 'unknown'
  const expiry = new Date(value)
  if (Number.isNaN(expiry.getTime())) return 'unknown'
  const now = new Date()
  if (expiry.getTime() < now.getTime()) return 'expired'
  const soon = new Date(now.getTime() + EXPIRING_WINDOW_DAYS * 24 * 60 * 60 * 1000)
  return expiry.getTime() <= soon.getTime() ? 'expiring' : 'valid'
}

export default function VehicleDocumentsTable() {
  const t = useT()
  const locale = useLocale()
  const direction = useDirection()
  const [search, setSearch] = React.useState('')
  const [values, setValues] = React.useState<FilterValues>({})
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'expiry_date', desc: false }])
  const [page, setPage] = React.useState(1)
  const scopeVersion = useOrganizationScopeVersion()

  const documentType = typeof values.documentType === 'string' ? values.documentType : undefined
  const expiryWindow = typeof values.expiry === 'string' ? values.expiry : undefined

  const params = React.useMemo(() => {
    const out: Record<string, string | number> = {
      page,
      pageSize: 50,
      sortField: sorting[0]?.id ?? 'expiry_date',
      sortDir: sorting[0]?.desc ? 'desc' : 'asc',
    }
    if (search.trim().length > 0) out.documentNumber = search.trim()
    if (documentType) out.documentType = documentType
    if (expiryWindow === 'expired') out.expiringBefore = new Date().toISOString()
    if (expiryWindow === 'within30') {
      out.expiringBefore = new Date(Date.now() + EXPIRING_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString()
    }
    return out
  }, [page, sorting, search, documentType, expiryWindow])

  const { data, isLoading, isError } = useQuery({
    queryKey: ['fleet-vehicle-documents', params, scopeVersion],
    queryFn: () => fetchCrudList<VehicleDocumentRow>('fleet_management/vehicle-documents', params),
  })

  const { data: vehiclesData } = useQuery({
    queryKey: ['fleet-vehicles-lookup', scopeVersion],
    queryFn: () => fetchCrudList<VehicleOption>('fleet_management/vehicles', { page: 1, pageSize: 100 }),
    staleTime: 5 * 60 * 1000,
  })

  const vehicleLabels = React.useMemo(() => {
    const map = new Map<string, string>()
    for (const vehicle of vehiclesData?.items ?? []) {
      map.set(vehicle.id, `${vehicle.plate_number} · ${vehicle.make} ${vehicle.model}`)
    }
    return map
  }, [vehiclesData])

  const columns = React.useMemo<ColumnDef<VehicleDocumentRow>[]>(
    () => [
      {
        id: 'vehicle',
        header: t('fleet_management.documents.columns.vehicle', 'Vehicle'),
        enableSorting: false,
        cell: ({ row }) => (
          <span className="truncate">
            {vehicleLabels.get(row.original.vehicle_id) ?? `${row.original.vehicle_id.slice(0, 8)}…`}
          </span>
        ),
        meta: { priority: 1 },
      },
      {
        accessorKey: 'document_type',
        header: t('fleet_management.documents.columns.type', 'Document'),
        cell: ({ getValue }) => {
          const value = getValue() as DocumentType
          return (
            <Badge variant="secondary">
              {t(`fleet_management.documents.types.${value}`, DOCUMENT_TYPE_FALLBACKS[value] ?? value)}
            </Badge>
          )
        },
        meta: { priority: 2 },
      },
      {
        accessorKey: 'document_number',
        header: t('fleet_management.documents.columns.number', 'Number'),
        cell: ({ getValue }) => {
          const value = getValue()
          return typeof value === 'string' && value.length > 0
            ? <span className="font-mono text-xs">{value}</span>
            : <span className="text-xs text-muted-foreground">—</span>
        },
        meta: { priority: 4 },
      },
      {
        accessorKey: 'issue_date',
        header: t('fleet_management.documents.columns.issued', 'Issued'),
        cell: ({ getValue }) => formatDate(getValue() as string | null, locale) ?? '—',
        meta: { priority: 5 },
      },
      {
        accessorKey: 'expiry_date',
        header: t('fleet_management.documents.columns.expires', 'Expires'),
        cell: ({ getValue }) => {
          const raw = getValue() as string | null
          const state = resolveExpiryState(raw)
          return (
            <span className="flex items-center gap-2">
              <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${EXPIRY_CLASSES[state]}`}>
                {t(`fleet_management.documents.expiry.${state}`, EXPIRY_FALLBACKS[state])}
              </span>
              <span className="text-xs text-muted-foreground">{formatDate(raw, locale) ?? '—'}</span>
            </span>
          )
        },
        meta: { priority: 3 },
      },
    ],
    [t, locale, vehicleLabels],
  )

  if (isError) {
    return (
      <div className="text-sm text-destructive">
        {t('fleet_management.documents.error.load', 'Failed to load vehicle documents.')}
      </div>
    )
  }

  return (
    <DataTable
      title={t('fleet_management.documents.page.title', 'Vehicle documents')}
      titleHeadingLevel={1}
      columns={columns}
      data={data?.items ?? []}
      searchValue={search}
      onSearchChange={(value) => {
        setSearch(value)
        setPage(1)
      }}
      searchAlign={direction === 'rtl' ? 'left' : 'right'}
      filters={[
        {
          id: 'documentType',
          label: t('fleet_management.documents.filters.type', 'Document'),
          type: 'select',
          options: DOCUMENT_TYPE_VALUES.map((value) => ({
            value,
            label: t(`fleet_management.documents.types.${value}`, DOCUMENT_TYPE_FALLBACKS[value]),
          })),
        },
        {
          id: 'expiry',
          label: t('fleet_management.documents.filters.expiry', 'Expiry'),
          type: 'select',
          options: [
            { value: 'expired', label: t('fleet_management.documents.filters.expiryExpired', 'Expired') },
            { value: 'within30', label: t('fleet_management.documents.filters.expirySoon', 'Expired or within 30 days') },
          ],
        },
      ]}
      filterValues={values}
      onFiltersApply={(next: FilterValues) => {
        setValues(next)
        setPage(1)
      }}
      onFiltersClear={() => {
        setValues({})
        setPage(1)
      }}
      entityId="fleet_management:fleet_vehicle_document"
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
      isLoading={isLoading}
    />
  )
}