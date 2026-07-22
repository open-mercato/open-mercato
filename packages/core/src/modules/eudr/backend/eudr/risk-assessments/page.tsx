"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Plus } from 'lucide-react'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { ListEmptyState } from '@open-mercato/ui/backend/filters/ListEmptyState'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCall, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { Button } from '@open-mercato/ui/primitives/button'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import type { ColumnDef, SortingState } from '@tanstack/react-table'
import {
  riskConclusionBadgeVariant,
  riskTierBadgeVariant,
} from '../../../components/StatementRiskSection'
import {
  EUDR_RISK_CONCLUSIONS,
  EUDR_RISK_TIERS,
  type EudrRiskConclusion,
  type EudrRiskTier,
} from '../../../data/validators'

type RiskAssessmentRow = {
  id: string
  statementId: string | null
  statementTitle: string | null
  conclusion: EudrRiskConclusion | null
  overallTier: EudrRiskTier | null
  assessedAt: string | null
  reviewDueAt: string | null
  updatedAt: string
}

type RiskAssessmentsResponse = {
  items: RiskAssessmentRow[]
  total: number
  totalPages: number
}

type MutationContext = {
  formId: string
  resourceKind: string
  resourceId: string
  retryLastMutation: () => Promise<boolean>
}

function formatDateTime(value: string | null | undefined, emptyLabel: string): string {
  if (!value) return emptyLabel
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return emptyLabel
  return date.toLocaleString()
}

function formatDate(value: string | null | undefined, emptyLabel: string): string {
  if (!value) return emptyLabel
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return emptyLabel
  return date.toLocaleDateString()
}

function isOverdue(value: string | null | undefined): boolean {
  if (!value) return false
  const date = new Date(value)
  return !Number.isNaN(date.getTime()) && date.getTime() < Date.now()
}

function isDateRangeValue(value: unknown): value is { to?: string } {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function conclusionOptions(translate: ReturnType<typeof useT>) {
  return EUDR_RISK_CONCLUSIONS.map((conclusion) => ({
    value: conclusion,
    label: translate(`eudr.conclusion.${conclusion}`),
  }))
}

function tierOptions(translate: ReturnType<typeof useT>) {
  return EUDR_RISK_TIERS.map((tier) => ({
    value: tier,
    label: translate(`eudr.riskTier.${tier}`),
  }))
}

export default function EudrRiskAssessmentsPage() {
  const translate = useT()
  const router = useRouter()
  const scopeVersion = useOrganizationScopeVersion()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const [rows, setRows] = React.useState<RiskAssessmentRow[]>([])
  const [page, setPage] = React.useState(1)
  const [pageSize, setPageSize] = React.useState(20)
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'assessedAt', desc: true }])
  const [filters, setFilters] = React.useState<FilterValues>({})
  const [loading, setLoading] = React.useState(true)
  const [reloadToken, setReloadToken] = React.useState(0)
  const mutationContextId = 'eudr-risk-assessments-list:delete'
  const { runMutation, retryLastMutation } = useGuardedMutation<MutationContext>({
    contextId: mutationContextId,
    blockedMessage: translate('ui.forms.flash.saveBlocked'),
  })

  const queryParams = React.useMemo(() => {
    const params = new URLSearchParams()
    params.set('page', String(page))
    params.set('pageSize', String(pageSize))
    if (typeof filters.conclusion === 'string' && filters.conclusion.trim()) {
      params.set('conclusion', filters.conclusion.trim())
    }
    if (typeof filters.overallTier === 'string' && filters.overallTier.trim()) {
      params.set('overallTier', filters.overallTier.trim())
    }
    if (isDateRangeValue(filters.reviewDueBefore) && typeof filters.reviewDueBefore.to === 'string' && filters.reviewDueBefore.to.trim()) {
      params.set('reviewDueBefore', filters.reviewDueBefore.to.trim())
    }
    const firstSort = sorting[0]
    if (firstSort) {
      params.set('sortField', firstSort.id)
      params.set('sortDir', firstSort.desc ? 'desc' : 'asc')
    }
    return params.toString()
  }, [filters.conclusion, filters.overallTier, filters.reviewDueBefore, page, pageSize, sorting])

  React.useEffect(() => {
    let cancelled = false
    async function loadRows() {
      setLoading(true)
      try {
        const fallback: RiskAssessmentsResponse = { items: [], total: 0, totalPages: 1 }
        const call = await apiCall<RiskAssessmentsResponse>(
          `/api/eudr/risk-assessments?${queryParams}`,
          undefined,
          { fallback },
        )
        if (!call.ok) {
          flash(translate('eudr.riskAssessments.list.loadError'), 'error')
          return
        }
        const payload = call.result ?? fallback
        if (cancelled) return
        setRows(Array.isArray(payload.items) ? payload.items : [])
        setTotal(typeof payload.total === 'number' ? payload.total : 0)
        setTotalPages(typeof payload.totalPages === 'number' ? payload.totalPages : 1)
      } catch {
        if (!cancelled) flash(translate('eudr.riskAssessments.list.loadError'), 'error')
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

  const handleDelete = React.useCallback(async (row: RiskAssessmentRow) => {
    const confirmed = await confirm({
      title: translate('eudr.riskAssessments.list.confirmDelete', {
        statement: row.statementTitle ?? translate('eudr.common.recordUnavailable'),
      }),
      variant: 'destructive',
    })
    if (!confirmed) return

    try {
      await runMutation({
        operation: async () => {
          const call = await withScopedApiRequestHeaders(
            buildOptimisticLockHeader(row.updatedAt),
            () => apiCall(
              `/api/eudr/risk-assessments?id=${encodeURIComponent(row.id)}`,
              { method: 'DELETE' },
            ),
          )
          if (!call.ok) {
            throw Object.assign(new Error('[internal] eudr risk assessment delete failed'), {
              status: call.status,
              ...((call.result as Record<string, unknown> | null) ?? {}),
            })
          }
          return call
        },
        context: {
          formId: mutationContextId,
          resourceKind: 'eudr.risk_assessment',
          resourceId: row.id,
          retryLastMutation,
        },
        mutationPayload: { id: row.id },
      })
      flash(translate('eudr.riskAssessments.list.deleteSuccess'), 'success')
      refreshRows()
    } catch (error) {
      if (surfaceRecordConflict(error, translate, { onRefresh: refreshRows })) return
      flash(translate('eudr.riskAssessments.list.deleteError'), 'error')
    }
  }, [confirm, mutationContextId, refreshRows, retryLastMutation, runMutation, translate])

  const columns = React.useMemo<ColumnDef<RiskAssessmentRow>[]>(() => [
    {
      accessorKey: 'statementId',
      header: translate('eudr.riskAssessments.list.columns.statement'),
      enableSorting: false,
      cell: ({ row }) => row.original.statementId ? (
        <Link href={`/backend/eudr/statements/${row.original.statementId}`} className="font-medium hover:underline">
          {row.original.statementTitle ?? translate('eudr.common.recordUnavailable')}
        </Link>
      ) : translate('eudr.common.empty'),
      meta: { maxWidth: '260px', truncate: true },
    },
    {
      accessorKey: 'conclusion',
      header: translate('eudr.riskAssessments.list.columns.conclusion'),
      cell: ({ row }) => row.original.conclusion ? (
        <StatusBadge variant={riskConclusionBadgeVariant(row.original.conclusion)} dot>
          {translate(`eudr.conclusion.${row.original.conclusion}`)}
        </StatusBadge>
      ) : translate('eudr.common.empty'),
    },
    {
      accessorKey: 'overallTier',
      header: translate('eudr.riskAssessments.list.columns.overallTier'),
      cell: ({ row }) => row.original.overallTier ? (
        <StatusBadge variant={riskTierBadgeVariant(row.original.overallTier)}>
          {translate(`eudr.riskTier.${row.original.overallTier}`)}
        </StatusBadge>
      ) : translate('eudr.common.empty'),
    },
    {
      accessorKey: 'assessedAt',
      header: translate('eudr.riskAssessments.list.columns.assessedAt'),
      cell: ({ row }) => formatDateTime(row.original.assessedAt, translate('eudr.common.empty')),
    },
    {
      accessorKey: 'reviewDueAt',
      header: translate('eudr.riskAssessments.list.columns.reviewDueAt'),
      cell: ({ row }) => (
        <span className={isOverdue(row.original.reviewDueAt) ? 'text-status-warning-text' : undefined}>
          {formatDate(row.original.reviewDueAt, translate('eudr.common.empty'))}
        </span>
      ),
    },
    {
      accessorKey: 'updatedAt',
      header: translate('eudr.riskAssessments.list.columns.updatedAt'),
      cell: ({ row }) => formatDateTime(row.original.updatedAt, translate('eudr.common.empty')),
    },
  ], [translate])

  const filterDefs = React.useMemo<FilterDef[]>(() => [
    {
      id: 'conclusion',
      label: translate('eudr.riskAssessments.list.filters.conclusion'),
      type: 'select',
      options: [
        { value: '', label: translate('eudr.riskAssessments.list.filters.allConclusions') },
        ...conclusionOptions(translate),
      ],
    },
    {
      id: 'overallTier',
      label: translate('eudr.riskAssessments.list.filters.overallTier'),
      type: 'select',
      options: [
        { value: '', label: translate('eudr.riskAssessments.list.filters.allTiers') },
        ...tierOptions(translate),
      ],
    },
    {
      id: 'reviewDueBefore',
      label: translate('eudr.riskAssessments.list.filters.reviewDueBefore'),
      type: 'dateRange',
    },
  ], [translate])

  return (
    <Page>
      <PageBody>
        <DataTable<RiskAssessmentRow>
          title={translate('eudr.riskAssessments.list.title')}
          columns={columns}
          data={rows}
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
              <Link href="/backend/eudr/risk-assessments/create">
                <Plus className="mr-2 h-4 w-4" aria-hidden />
                {translate('eudr.riskAssessments.list.actions.create')}
              </Link>
            </Button>
          )}
          rowActions={(row) => (
            <RowActions
              items={[
                {
                  id: 'edit',
                  label: translate('eudr.riskAssessments.list.actions.edit'),
                  href: `/backend/eudr/risk-assessments/${row.id}`,
                },
                {
                  id: 'delete',
                  label: translate('eudr.riskAssessments.list.actions.delete'),
                  destructive: true,
                  onSelect: () => {
                    void handleDelete(row)
                  },
                },
              ]}
            />
          )}
          onRowClick={(row) => router.push(`/backend/eudr/risk-assessments/${row.id}`)}
          rowClickActionIds={['edit']}
          emptyState={(
            <ListEmptyState
              entityName={translate('eudr.riskAssessments.list.entityName')}
              createHref="/backend/eudr/risk-assessments/create"
              createLabel={translate('eudr.riskAssessments.list.actions.create')}
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
          perspective={{ tableId: 'eudr.risk_assessments.list' }}
          stickyActionsColumn
        />
      </PageBody>
      {ConfirmDialogElement}
    </Page>
  )
}
