"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
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
import { Plus } from 'lucide-react'
import type { ColumnDef, SortingState } from '@tanstack/react-table'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { resolveCountryName } from '@open-mercato/shared/lib/location/countries'
import type { EudrCommodity, EudrSubmissionStatus } from '../../../data/validators'
import { commodityOptions, statusBadgeVariant, submissionStatusOptions, type CompanySnapshot } from '../../../components/formConfig'

type EvidenceSubmissionRow = {
  id: string
  supplierEntityId: string
  supplierSnapshot: CompanySnapshot | null
  commodity: EudrCommodity
  productMappingId: string | null
  statementId: string | null
  originCountry: string | null
  geolocation?: Record<string, unknown> | null
  quantityKg: number | string | null
  batchNumber: string | null
  harvestFrom: string | null
  harvestTo: string | null
  attachmentIds: string[]
  status: EudrSubmissionStatus
  completenessScore: number
  missingFields: string[]
  warnings?: string[]
  createdAt: string
  updatedAt: string
}

type EvidenceSubmissionsResponse = {
  items: EvidenceSubmissionRow[]
  total: number
  totalPages: number
}

function formatDateTime(value: string | null | undefined, emptyLabel: string): string {
  if (!value) return emptyLabel
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return emptyLabel
  return date.toLocaleString()
}

function formatSupplier(row: EvidenceSubmissionRow, unavailableLabel: string): string {
  const displayName = typeof row.supplierSnapshot?.displayName === 'string' && row.supplierSnapshot.displayName.trim().length
    ? row.supplierSnapshot.displayName.trim()
    : null
  return displayName ?? unavailableLabel
}

function formatQuantityKg(value: number | string | null, emptyLabel: string): string {
  if (value === null || value === undefined) return emptyLabel
  if (typeof value === 'string' && !value.trim()) return emptyLabel
  return String(value)
}

export default function EudrEvidenceSubmissionsPage() {
  const translate = useT()
  const locale = useLocale()
  const router = useRouter()
  const scopeVersion = useOrganizationScopeVersion()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const [rows, setRows] = React.useState<EvidenceSubmissionRow[]>([])
  const [page, setPage] = React.useState(1)
  const [pageSize, setPageSize] = React.useState(20)
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [search, setSearch] = React.useState('')
  const [sorting, setSorting] = React.useState<SortingState>([])
  const [filters, setFilters] = React.useState<FilterValues>({})
  const [loading, setLoading] = React.useState(true)
  const [reloadToken, setReloadToken] = React.useState(0)
  const mutationContextId = 'eudr-evidence-submissions-list:delete'
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
    if (typeof filters.commodity === 'string' && filters.commodity.trim()) {
      params.set('commodity', filters.commodity.trim())
    }
    if (typeof filters.status === 'string' && filters.status.trim()) {
      params.set('status', filters.status.trim())
    }
    const firstSort = sorting[0]
    if (firstSort) {
      params.set('sortField', firstSort.id)
      params.set('sortDir', firstSort.desc ? 'desc' : 'asc')
    }
    return params.toString()
  }, [filters.commodity, filters.status, page, pageSize, search, sorting])

  React.useEffect(() => {
    let cancelled = false
    async function loadRows() {
      setLoading(true)
      try {
        const fallback: EvidenceSubmissionsResponse = { items: [], total: 0, totalPages: 1 }
        const call = await apiCall<EvidenceSubmissionsResponse>(
          `/api/eudr/evidence-submissions?${queryParams}`,
          undefined,
          { fallback },
        )
        if (!call.ok) {
          flash(translate('eudr.evidenceSubmissions.list.loadError'), 'error')
          return
        }
        const payload = call.result ?? fallback
        if (cancelled) return
        setRows(Array.isArray(payload.items) ? payload.items : [])
        setTotal(typeof payload.total === 'number' ? payload.total : 0)
        setTotalPages(typeof payload.totalPages === 'number' ? payload.totalPages : 1)
      } catch {
        if (!cancelled) flash(translate('eudr.evidenceSubmissions.list.loadError'), 'error')
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

  const handleDelete = React.useCallback(async (row: EvidenceSubmissionRow) => {
    const confirmed = await confirm({
      title: translate('eudr.evidenceSubmissions.list.confirmDelete', { supplier: formatSupplier(row, translate('eudr.common.recordUnavailable')) }),
      variant: 'destructive',
    })
    if (!confirmed) return

    try {
      await runMutation({
        operation: async () => {
          const call = await withScopedApiRequestHeaders(
            buildOptimisticLockHeader(row.updatedAt),
            () => apiCall(
              `/api/eudr/evidence-submissions?id=${encodeURIComponent(row.id)}`,
              { method: 'DELETE' },
            ),
          )
          if (!call.ok) {
            throw Object.assign(new Error('[internal] eudr evidence submission delete failed'), {
              status: call.status,
              ...((call.result as Record<string, unknown> | null) ?? {}),
            })
          }
          return call
        },
        context: {
          formId: mutationContextId,
          resourceKind: 'eudr.evidence_submission',
          resourceId: row.id,
          retryLastMutation,
        },
        mutationPayload: { id: row.id },
      })
      flash(translate('eudr.evidenceSubmissions.list.deleteSuccess'), 'success')
      refreshRows()
    } catch (error) {
      if (surfaceRecordConflict(error, translate, { onRefresh: refreshRows })) return
      flash(translate('eudr.evidenceSubmissions.list.deleteError'), 'error')
    }
  }, [confirm, mutationContextId, refreshRows, retryLastMutation, runMutation, translate])

  const columns = React.useMemo<ColumnDef<EvidenceSubmissionRow>[]>(() => [
    {
      accessorKey: 'supplierEntityId',
      header: translate('eudr.evidenceSubmissions.list.columns.supplier'),
      cell: ({ row }) => (
        <Link href={`/backend/eudr/evidence-submissions/${row.original.id}`} className="font-medium hover:underline">
          {formatSupplier(row.original, translate('eudr.common.recordUnavailable'))}
        </Link>
      ),
      meta: { maxWidth: '240px', truncate: true },
    },
    {
      accessorKey: 'commodity',
      header: translate('eudr.evidenceSubmissions.list.columns.commodity'),
      cell: ({ row }) => translate(`eudr.commodity.${row.original.commodity}`),
    },
    {
      accessorKey: 'status',
      header: translate('eudr.evidenceSubmissions.list.columns.status'),
      cell: ({ row }) => (
        <StatusBadge variant={statusBadgeVariant(row.original.status)} dot>
          {translate(`eudr.submissionStatus.${row.original.status}`)}
        </StatusBadge>
      ),
    },
    {
      accessorKey: 'completenessScore',
      header: translate('eudr.evidenceSubmissions.list.columns.completeness'),
      cell: ({ row }) => {
        const score = Number.isFinite(row.original.completenessScore) ? row.original.completenessScore : 0
        const hasCutoffWarning = Array.isArray(row.original.warnings) && row.original.warnings.includes('harvest_before_cutoff')
        return (
          <span className="inline-flex items-center gap-2">
            {`${score}%`}
            {hasCutoffWarning ? (
              <Badge variant="warning" title={translate('eudr.warnings.harvestBeforeCutoff')}>
                {translate('eudr.warnings.harvestBeforeCutoff')}
              </Badge>
            ) : null}
          </span>
        )
      },
    },
    {
      accessorKey: 'originCountry',
      header: translate('eudr.evidenceSubmissions.list.columns.originCountry'),
      cell: ({ row }) => {
        const code = row.original.originCountry
        return code ? `${resolveCountryName(code, { locale })} (${code})` : translate('eudr.common.empty')
      },
    },
    {
      accessorKey: 'quantityKg',
      header: translate('eudr.evidenceSubmissions.list.columns.quantityKg'),
      cell: ({ row }) => formatQuantityKg(row.original.quantityKg, translate('eudr.common.empty')),
    },
    {
      accessorKey: 'updatedAt',
      header: translate('eudr.evidenceSubmissions.list.columns.updatedAt'),
      cell: ({ row }) => formatDateTime(row.original.updatedAt, translate('eudr.common.empty')),
    },
  ], [locale, translate])

  const filterDefs = React.useMemo<FilterDef[]>(() => [
    {
      id: 'commodity',
      label: translate('eudr.evidenceSubmissions.list.filters.commodity'),
      type: 'select',
      options: [
        { value: '', label: translate('eudr.evidenceSubmissions.list.filters.allCommodities') },
        ...commodityOptions(translate),
      ],
    },
    {
      id: 'status',
      label: translate('eudr.evidenceSubmissions.list.filters.status'),
      type: 'select',
      options: [
        { value: '', label: translate('eudr.evidenceSubmissions.list.filters.allStatuses') },
        ...submissionStatusOptions(translate),
      ],
    },
  ], [translate])

  return (
    <Page>
      <PageBody>
        <DataTable<EvidenceSubmissionRow>
          title={translate('eudr.evidenceSubmissions.list.title')}
          columns={columns}
          data={rows}
          searchValue={search}
          onSearchChange={(nextSearch) => {
            setSearch(nextSearch)
            setPage(1)
          }}
          searchPlaceholder={translate('eudr.evidenceSubmissions.list.searchPlaceholder')}
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
            <Button asChild>
              <Link href="/backend/eudr/evidence-submissions/create">
                <Plus className="mr-2 h-4 w-4" aria-hidden />
                {translate('eudr.evidenceSubmissions.list.actions.create')}
              </Link>
            </Button>
          )}
          rowActions={(row) => (
            <RowActions
              items={[
                {
                  id: 'edit',
                  label: translate('eudr.evidenceSubmissions.list.actions.edit'),
                  href: `/backend/eudr/evidence-submissions/${row.id}`,
                },
                {
                  id: 'delete',
                  label: translate('eudr.evidenceSubmissions.list.actions.delete'),
                  destructive: true,
                  onSelect: () => {
                    void handleDelete(row)
                  },
                },
              ]}
            />
          )}
          onRowClick={(row) => router.push(`/backend/eudr/evidence-submissions/${row.id}`)}
          rowClickActionIds={['edit']}
          emptyState={(
            <ListEmptyState
              entityName={translate('eudr.evidenceSubmissions.list.entityName')}
              createHref="/backend/eudr/evidence-submissions/create"
              createLabel={translate('eudr.evidenceSubmissions.list.actions.create')}
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
          perspective={{ tableId: 'eudr.evidence_submissions.list' }}
          stickyActionsColumn
        />
      </PageBody>
      {ConfirmDialogElement}
    </Page>
  )
}
