"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { ColumnDef, SortingState } from '@tanstack/react-table'
import { Plus, Upload } from 'lucide-react'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { buildCountryOptions, resolveCountryName } from '@open-mercato/shared/lib/location/countries'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { ListEmptyState } from '@open-mercato/ui/backend/filters/ListEmptyState'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { apiCall, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { Button } from '@open-mercato/ui/primitives/button'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { PlotImportDialog } from '../../../components/PlotImportDialog'

type PlotRow = {
  id: string
  supplierEntityId: string | null
  supplierSnapshot: { displayName?: string | null } | null
  name: string | null
  externalId: string | null
  originCountry: string | null
  plotType: string | null
  areaHa: number | string | null
  validationWarnings: string[]
  isActive: boolean | null
  createdAt: string | null
  updatedAt: string | null
}

type PlotListResponse = {
  items: PlotRow[]
  total: number
  totalPages: number
}

type CompanyOptionResponse = {
  items?: unknown[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function readString(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key]
    if (typeof value !== 'string') continue
    const trimmed = value.trim()
    if (trimmed.length > 0) return trimmed
  }
  return null
}

function supplierName(row: PlotRow, unavailableLabel: string): string {
  const displayName = row.supplierSnapshot?.displayName?.trim()
  if (displayName) return displayName
  return row.supplierEntityId ? unavailableLabel : ''
}

function formatDateTime(value: string | null | undefined, emptyLabel: string): string {
  if (!value) return emptyLabel
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return emptyLabel
  return date.toLocaleString()
}

function formatArea(value: number | string | null | undefined, emptyLabel: string): string {
  if (value === null || value === undefined || value === '') return emptyLabel
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) return String(value)
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 }).format(numeric)
}

function normalizeCompanyOption(raw: unknown): { value: string; label: string } | null {
  if (!isRecord(raw)) return null
  const id = readString(raw, ['id'])
  const displayName = readString(raw, ['display_name', 'displayName', 'name'])
  return id && displayName ? { value: id, label: displayName } : null
}

export default function EudrPlotsPage() {
  const translate = useT()
  const locale = useLocale()
  const router = useRouter()
  const scopeVersion = useOrganizationScopeVersion()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const [rows, setRows] = React.useState<PlotRow[]>([])
  const [page, setPage] = React.useState(1)
  const [pageSize, setPageSize] = React.useState(20)
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [search, setSearch] = React.useState('')
  const [sorting, setSorting] = React.useState<SortingState>([])
  const [filters, setFilters] = React.useState<FilterValues>({})
  const [loading, setLoading] = React.useState(true)
  const [reloadToken, setReloadToken] = React.useState(0)
  const [importOpen, setImportOpen] = React.useState(false)
  const mutationContextId = 'eudr-plots-list:delete'
  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    resourceId: string
    retryLastMutation: () => Promise<boolean>
  }>({
    contextId: mutationContextId,
    blockedMessage: translate('ui.forms.flash.saveBlocked'),
  })

  const queryParams = React.useMemo(() => {
    const params = new URLSearchParams()
    params.set('page', String(page))
    params.set('pageSize', String(pageSize))
    if (search.trim()) params.set('search', search.trim())
    if (typeof filters.supplierEntityId === 'string' && filters.supplierEntityId.trim()) {
      params.set('supplierEntityId', filters.supplierEntityId.trim())
    }
    if (typeof filters.plotType === 'string' && filters.plotType.trim()) {
      params.set('plotType', filters.plotType.trim())
    }
    if (typeof filters.originCountry === 'string' && filters.originCountry.trim()) {
      params.set('originCountry', filters.originCountry.trim().toUpperCase())
    }
    if (filters.isActive === true || filters.isActive === false) {
      params.set('isActive', String(filters.isActive))
    }
    const firstSort = sorting[0]
    if (firstSort) {
      params.set('sortField', firstSort.id)
      params.set('sortDir', firstSort.desc ? 'desc' : 'asc')
    }
    return params.toString()
  }, [filters.isActive, filters.originCountry, filters.plotType, filters.supplierEntityId, page, pageSize, search, sorting])

  React.useEffect(() => {
    let cancelled = false
    async function loadRows() {
      setLoading(true)
      try {
        const fallback: PlotListResponse = { items: [], total: 0, totalPages: 1 }
        const call = await apiCall<PlotListResponse>(
          `/api/eudr/plots?${queryParams}`,
          undefined,
          { fallback },
        )
        if (!call.ok) {
          flash(translate('eudr.plots.list.loadError'), 'error')
          return
        }
        const payload = call.result ?? fallback
        if (cancelled) return
        setRows(Array.isArray(payload.items) ? payload.items : [])
        setTotal(typeof payload.total === 'number' ? payload.total : 0)
        setTotalPages(typeof payload.totalPages === 'number' ? payload.totalPages : 1)
      } catch {
        if (!cancelled) flash(translate('eudr.plots.list.loadError'), 'error')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    loadRows()
    return () => {
      cancelled = true
    }
  }, [queryParams, reloadToken, scopeVersion, translate])

  const refreshRows = React.useCallback(() => {
    setReloadToken((currentToken) => currentToken + 1)
  }, [])

  const handleDelete = React.useCallback(async (row: PlotRow) => {
    const confirmed = await confirm({
      title: translate('eudr.plots.list.confirmDelete', { name: row.name ?? translate('eudr.common.recordUnavailable') }),
      variant: 'destructive',
    })
    if (!confirmed) return

    try {
      await runMutation({
        operation: async () => {
          const call = await withScopedApiRequestHeaders(
            buildOptimisticLockHeader(row.updatedAt ?? ''),
            () => apiCall(
              `/api/eudr/plots?id=${encodeURIComponent(row.id)}`,
              { method: 'DELETE' },
            ),
          )
          if (!call.ok) {
            throw Object.assign(new Error('[internal] eudr plot delete failed'), {
              status: call.status,
              ...((call.result as Record<string, unknown> | null) ?? {}),
            })
          }
          return call
        },
        context: {
          formId: mutationContextId,
          resourceKind: 'eudr.plot',
          resourceId: row.id,
          retryLastMutation,
        },
        mutationPayload: { id: row.id },
      })
      flash(translate('eudr.plots.list.deleteSuccess'), 'success')
      refreshRows()
    } catch (error) {
      if (surfaceRecordConflict(error, translate, { onRefresh: refreshRows })) return
      flash(translate('eudr.plots.list.deleteError'), 'error')
    }
  }, [confirm, mutationContextId, refreshRows, retryLastMutation, runMutation, translate])

  const countryOptions = React.useMemo(() => buildCountryOptions({
    locale,
    transformLabel: (code, label) => `${label} (${code})`,
  }).map((option) => ({ value: option.code, label: option.label })), [locale])

  const loadSupplierOptions = React.useCallback(async () => {
    const call = await apiCall<CompanyOptionResponse>(
      '/api/customers/companies?pageSize=100&sortField=name&sortDir=asc',
      undefined,
      { fallback: { items: [] } },
    )
    const items = Array.isArray(call.result?.items) ? call.result.items : []
    if (!call.ok) return []
    return items
      .map((item) => normalizeCompanyOption(item))
      .filter((option): option is { value: string; label: string } => option !== null)
  }, [])

  const columns = React.useMemo<ColumnDef<PlotRow>[]>(() => [
    {
      accessorKey: 'supplierEntityId',
      header: translate('eudr.plots.list.columns.supplier'),
      enableSorting: false,
      cell: ({ row }) => supplierName(row.original, translate('eudr.common.recordUnavailable')) || translate('eudr.common.empty'),
      meta: { maxWidth: '220px', truncate: true },
    },
    {
      accessorKey: 'name',
      header: translate('eudr.plots.list.columns.name'),
      cell: ({ row }) => (
        <Link href={`/backend/eudr/plots/${row.original.id}`} className="font-medium hover:underline">
          {row.original.name ?? translate('eudr.common.recordUnavailable')}
        </Link>
      ),
      meta: { maxWidth: '260px', truncate: true },
    },
    {
      accessorKey: 'originCountry',
      header: translate('eudr.plots.list.columns.originCountry'),
      enableSorting: false,
      cell: ({ row }) => {
        const code = row.original.originCountry
        return code ? `${resolveCountryName(code, { locale })} (${code})` : translate('eudr.common.empty')
      },
    },
    {
      accessorKey: 'plotType',
      header: translate('eudr.plots.list.columns.plotType'),
      enableSorting: false,
      cell: ({ row }) => {
        const plotType = row.original.plotType ?? 'point'
        return (
          <StatusBadge variant={plotType === 'polygon' ? 'success' : 'neutral'}>
            {translate(`eudr.plotType.${plotType}`)}
          </StatusBadge>
        )
      },
    },
    {
      accessorKey: 'areaHa',
      header: translate('eudr.plots.list.columns.areaHa'),
      cell: ({ row }) => formatArea(row.original.areaHa, translate('eudr.common.empty')),
    },
    {
      accessorKey: 'validationWarnings',
      header: translate('eudr.plots.list.columns.validationWarnings'),
      enableSorting: false,
      cell: ({ row }) => {
        const count = row.original.validationWarnings.length
        return count > 0 ? (
          <Badge
            variant="warning"
            aria-label={translate('eudr.plots.list.validationWarningsAria', { count })}
          >
            {count}
          </Badge>
        ) : translate('eudr.common.empty')
      },
    },
    {
      accessorKey: 'updatedAt',
      header: translate('eudr.plots.list.columns.updatedAt'),
      cell: ({ row }) => formatDateTime(row.original.updatedAt, translate('eudr.common.empty')),
    },
  ], [locale, translate])

  const filterDefs = React.useMemo<FilterDef[]>(() => [
    {
      id: 'supplierEntityId',
      label: translate('eudr.plots.list.filters.supplier'),
      type: 'combobox',
      loadOptions: loadSupplierOptions,
      placeholder: translate('eudr.plots.list.filters.supplierPlaceholder'),
    },
    {
      id: 'plotType',
      label: translate('eudr.plots.list.filters.plotType'),
      type: 'select',
      options: [
        { value: 'point', label: translate('eudr.plotType.point') },
        { value: 'polygon', label: translate('eudr.plotType.polygon') },
      ],
    },
    {
      id: 'isActive',
      label: translate('eudr.plots.list.filters.isActive'),
      type: 'checkbox',
    },
    {
      id: 'originCountry',
      label: translate('eudr.plots.list.filters.originCountry'),
      type: 'combobox',
      options: countryOptions,
      placeholder: translate('eudr.plots.list.filters.originCountryPlaceholder'),
      formatValue: (value) => {
        const code = value.toUpperCase()
        return `${resolveCountryName(code, { locale })} (${code})`
      },
    },
  ], [countryOptions, loadSupplierOptions, locale, translate])

  return (
    <Page>
      <PageBody>
        <DataTable<PlotRow>
          title={translate('eudr.plots.list.title')}
          columns={columns}
          data={rows}
          searchValue={search}
          onSearchChange={(nextSearch) => {
            setSearch(nextSearch)
            setPage(1)
          }}
          searchPlaceholder={translate('eudr.plots.list.searchPlaceholder')}
          filters={filterDefs}
          filterValues={filters}
          onFiltersApply={(nextFilters) => {
            setFilters(nextFilters)
            setPage(1)
          }}
          onFiltersClear={() => {
            setFilters({})
            setPage(1)
          }}
          actions={(
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" onClick={() => setImportOpen(true)}>
                <Upload className="mr-2 size-4" aria-hidden="true" />
                {translate('eudr.plots.list.actions.import')}
              </Button>
              <Button asChild>
                <Link href="/backend/eudr/plots/create">
                  <Plus className="mr-2 size-4" aria-hidden="true" />
                  {translate('eudr.plots.list.actions.create')}
                </Link>
              </Button>
            </div>
          )}
          rowActions={(row) => (
            <RowActions
              items={[
                {
                  id: 'edit',
                  label: translate('eudr.plots.list.actions.edit'),
                  href: `/backend/eudr/plots/${row.id}`,
                },
                {
                  id: 'delete',
                  label: translate('eudr.plots.list.actions.delete'),
                  destructive: true,
                  onSelect: () => {
                    void handleDelete(row)
                  },
                },
              ]}
            />
          )}
          onRowClick={(row) => router.push(`/backend/eudr/plots/${row.id}`)}
          rowClickActionIds={['edit']}
          emptyState={(
            <ListEmptyState
              entityName={translate('eudr.plots.list.entityName')}
              createHref="/backend/eudr/plots/create"
              createLabel={translate('eudr.plots.list.actions.create')}
            />
          )}
          sortable
          manualSorting
          sorting={sorting}
          onSortingChange={(nextSorting) => {
            setSorting(nextSorting)
            setPage(1)
          }}
          pagination={{
            page,
            pageSize,
            total,
            totalPages,
            onPageChange: setPage,
            pageSizeOptions: [20, 50, 100],
            onPageSizeChange: (nextPageSize) => {
              setPageSize(nextPageSize)
              setPage(1)
            },
          }}
          isLoading={loading}
          perspective={{ tableId: 'eudr.plots.list' }}
          stickyActionsColumn
        />
      </PageBody>
      <PlotImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onImported={refreshRows}
      />
      {ConfirmDialogElement}
    </Page>
  )
}
