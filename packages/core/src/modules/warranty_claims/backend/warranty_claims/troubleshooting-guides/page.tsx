"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { ColumnDef } from '@tanstack/react-table'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable, type BulkAction, type DataTableExportFormat } from '@open-mercato/ui/backend/DataTable'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { ListEmptyState } from '@open-mercato/ui/backend/filters/ListEmptyState'
import { Button } from '@open-mercato/ui/primitives/button'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { apiCall, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { runBulkDelete } from '@open-mercato/ui/backend/utils/bulkDelete'
import { buildCrudExportUrl, deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT, type TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { formatDateTime } from '@open-mercato/shared/lib/time'
import { CLAIM_TYPES } from '../../../data/validators'
import { localizeDictionaryLabel } from '../../../lib/dictionaryLabels'
import { fetchClaimReasonOptions } from '../../components/claimReasonOptions'
import {
  activeLabel,
  claimTypeLabel,
  normalizeTroubleshootingGuide,
  type TroubleshootingGuideRecord,
} from './troubleshootingGuideForm'

type TroubleshootingGuidesResponse = {
  items?: unknown[]
  total?: number
  totalPages?: number
  error?: string
}

const PAGE_SIZE = 20

function reasonLabel(value: string | null, t: TranslateFn, storedLabels: Record<string, string>): string {
  if (!value) return t('warranty_claims.troubleshootingGuides.reason.any', 'Any reason')
  return localizeDictionaryLabel(t, 'reason', value, storedLabels[value] ?? value)
}

function toFilterString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length ? value.trim() : null
}

export default function WarrantyTroubleshootingGuidesPage() {
  const t = useT()
  const router = useRouter()
  const scopeVersion = useOrganizationScopeVersion()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const [rows, setRows] = React.useState<TroubleshootingGuideRecord[]>([])
  const [page, setPage] = React.useState(1)
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [search, setSearch] = React.useState('')
  const [filterValues, setFilterValues] = React.useState<FilterValues>({})
  const [loading, setLoading] = React.useState(true)
  const [reloadToken, setReloadToken] = React.useState(0)
  const [reasonLabels, setReasonLabels] = React.useState<Record<string, string>>({})

  React.useEffect(() => {
    let cancelled = false
    void fetchClaimReasonOptions(t)
      .then((options) => {
        if (cancelled) return
        setReasonLabels(Object.fromEntries(options.map((option) => [option.value, option.label])))
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [t])

  const mutationContextId = 'warranty-claim-troubleshooting-guides-list'
  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    resourceId?: string
    retryLastMutation: () => Promise<boolean>
  }>({
    contextId: mutationContextId,
    blockedMessage: t('warranty_claims.troubleshootingGuides.list.error.blocked', 'Save blocked by validation.'),
  })

  const reload = React.useCallback(() => {
    setReloadToken((current) => current + 1)
  }, [])

  const listQueryString = React.useMemo(() => {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(PAGE_SIZE),
      sortField: 'updatedAt',
      sortDir: 'desc',
    })
    if (search.trim()) params.set('search', search.trim())
    const claimType = toFilterString(filterValues.claimType)
    const isActive = toFilterString(filterValues.isActive)
    if (claimType) params.set('claimType', claimType)
    if (isActive) params.set('isActive', isActive)
    return params.toString()
  }, [filterValues.claimType, filterValues.isActive, page, search])

  const currentParams = React.useMemo(
    () => Object.fromEntries(new URLSearchParams(listQueryString)),
    [listQueryString],
  )

  const exportConfig = React.useMemo(() => ({
    view: {
      getUrl: (format: DataTableExportFormat) =>
        buildCrudExportUrl('warranty_claims/troubleshooting-guides', { ...currentParams, exportScope: 'view' }, format),
    },
    full: {
      getUrl: (format: DataTableExportFormat) =>
        buildCrudExportUrl('warranty_claims/troubleshooting-guides', { ...currentParams, exportScope: 'full', all: 'true' }, format),
    },
  }), [currentParams])

  React.useEffect(() => {
    let cancelled = false
    async function loadGuides() {
      setLoading(true)
      try {
        const fallback: TroubleshootingGuidesResponse = { items: [], total: 0, totalPages: 1 }
        const call = await apiCall<TroubleshootingGuidesResponse>(
          `/api/warranty_claims/troubleshooting-guides?${listQueryString}`,
          undefined,
          { fallback },
        )
        if (!call.ok) {
          const message = call.result?.error ?? t('warranty_claims.troubleshootingGuides.list.error.load', 'Failed to load troubleshooting guides.')
          flash(message, 'error')
          return
        }
        if (cancelled) return
        const items = Array.isArray(call.result?.items) ? call.result.items : []
        setRows(items.map(normalizeTroubleshootingGuide).filter((row): row is TroubleshootingGuideRecord => row !== null))
        setTotal(typeof call.result?.total === 'number' ? call.result.total : items.length)
        setTotalPages(typeof call.result?.totalPages === 'number' ? call.result.totalPages : 1)
      } catch (error) {
        if (!cancelled) {
          const message = error instanceof Error
            ? error.message
            : t('warranty_claims.troubleshootingGuides.list.error.load', 'Failed to load troubleshooting guides.')
          flash(message, 'error')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void loadGuides()
    return () => {
      cancelled = true
    }
  }, [listQueryString, reloadToken, scopeVersion, t])

  const executeDelete = React.useCallback(async (guide: TroubleshootingGuideRecord): Promise<unknown> => {
    try {
      await runMutation({
        operation: () => withScopedApiRequestHeaders(
          buildOptimisticLockHeader(guide.updatedAt),
          () => deleteCrud('warranty_claims/troubleshooting-guides', guide.id, {
            errorMessage: t('warranty_claims.troubleshootingGuides.list.error.delete', 'Failed to delete troubleshooting guide.'),
          }),
        ),
        mutationPayload: { id: guide.id },
        context: {
          formId: mutationContextId,
          resourceKind: 'warranty_claims.warranty_troubleshooting_guide',
          resourceId: guide.id,
          retryLastMutation,
        },
      })
      return null
    } catch (error) {
      return error
    }
  }, [mutationContextId, retryLastMutation, runMutation, t])

  const handleDelete = React.useCallback(async (guide: TroubleshootingGuideRecord) => {
    const confirmed = await confirm({
      title: t('warranty_claims.troubleshootingGuides.confirm.deleteTitle', 'Delete this troubleshooting guide?'),
      variant: 'destructive',
    })
    if (!confirmed) return
    const error = await executeDelete(guide)
    if (error) {
      if (surfaceRecordConflict(error, t, { onRefresh: reload })) return
      flash(
        error instanceof Error
          ? error.message
          : t('warranty_claims.troubleshootingGuides.list.error.delete', 'Failed to delete troubleshooting guide.'),
        'error',
      )
      return
    }
    flash(t('warranty_claims.troubleshootingGuides.list.success.delete', 'Troubleshooting guide deleted.'), 'success')
    reload()
  }, [confirm, executeDelete, reload, t])

  const handleBulkDelete = React.useCallback(async (selectedRows: TroubleshootingGuideRecord[]) => {
    const { succeeded, failures } = await runBulkDelete(
      selectedRows,
      async (guide) => {
        const error = await executeDelete(guide)
        if (error) throw error
      },
      {
        fallbackErrorMessage: t('warranty_claims.troubleshootingGuides.list.error.delete', 'Failed to delete troubleshooting guide.'),
        logTag: 'warranty_claims.troubleshooting_guides.list',
        progress: {
          jobType: 'warranty_claims.troubleshooting_guides.bulk_delete',
          name: t('warranty_claims.troubleshootingGuides.bulk.delete', 'Delete selected'),
        },
      },
    )
    const summary = t(
      'warranty_claims.bulk.summary',
      'Bulk action finished: {succeeded} succeeded, {failed} failed.',
      { succeeded: succeeded.length, failed: failures.length },
    )
    if (failures.length) {
      flash(`${summary} ${t('warranty_claims.bulk.firstError', 'First error: {message}', { message: failures[0].message })}`, 'warning')
    } else {
      flash(summary, 'success')
    }
    reload()
    return { ok: true as const, affectedCount: succeeded.length }
  }, [executeDelete, reload, t])

  const bulkActions = React.useMemo<BulkAction<TroubleshootingGuideRecord>[]>(() => [
    {
      id: 'bulk-delete',
      label: t('warranty_claims.troubleshootingGuides.bulk.delete', 'Delete selected'),
      destructive: true,
      onExecute: async (selectedRows) => {
        if (!selectedRows.length) return false
        const confirmed = await confirm({
          title: t('warranty_claims.troubleshootingGuides.bulk.deleteTitle', 'Delete selected troubleshooting guides?'),
          variant: 'destructive',
        })
        if (!confirmed) return false
        return handleBulkDelete(selectedRows)
      },
    },
  ], [confirm, handleBulkDelete, t])

  const filters = React.useMemo<FilterDef[]>(() => [
    {
      id: 'claimType',
      label: t('warranty_claims.troubleshootingGuides.list.filter.claimType', 'Claim type'),
      type: 'select',
      options: CLAIM_TYPES.map((value) => ({ value, label: claimTypeLabel(value, t) })),
    },
    {
      id: 'isActive',
      label: t('warranty_claims.troubleshootingGuides.list.filter.status', 'Status'),
      type: 'select',
      options: [
        { value: 'true', label: t('warranty_claims.troubleshootingGuides.status.active', 'Active') },
        { value: 'false', label: t('warranty_claims.troubleshootingGuides.status.inactive', 'Inactive') },
      ],
    },
  ], [t])

  const columns = React.useMemo<ColumnDef<TroubleshootingGuideRecord>[]>(() => [
    {
      accessorKey: 'title',
      header: t('warranty_claims.troubleshootingGuides.list.column.title', 'Title'),
      meta: { alwaysVisible: true, truncate: true, maxWidth: '280px' },
      cell: ({ row }) => (
        <Link
          href={`/backend/warranty_claims/troubleshooting-guides/${row.original.id}/edit`}
          className="font-medium hover:underline"
        >
          {row.original.title ?? t('warranty_claims.troubleshootingGuides.list.untitled', 'Untitled guide')}
        </Link>
      ),
    },
    {
      accessorKey: 'claimType',
      header: t('warranty_claims.troubleshootingGuides.list.column.claimType', 'Claim type'),
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {claimTypeLabel(row.original.claimType, t)}
        </span>
      ),
    },
    {
      accessorKey: 'reasonCode',
      header: t('warranty_claims.troubleshootingGuides.list.column.reason', 'Reason'),
      meta: { truncate: true, maxWidth: '220px' },
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {reasonLabel(row.original.reasonCode, t, reasonLabels)}
        </span>
      ),
    },
    {
      accessorKey: 'isActive',
      header: t('warranty_claims.troubleshootingGuides.list.column.active', 'Status'),
      cell: ({ row }) => (
        <StatusBadge variant={row.original.isActive ? 'success' : 'neutral'}>
          {activeLabel(row.original.isActive, t)}
        </StatusBadge>
      ),
    },
    {
      accessorKey: 'updatedAt',
      header: t('warranty_claims.troubleshootingGuides.list.column.updated', 'Updated'),
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {formatDateTime(row.original.updatedAt) ?? t('warranty_claims.common.noValue', 'Not set')}
        </span>
      ),
    },
  ], [reasonLabels, t])

  return (
    <Page>
      <PageBody>
        <DataTable<TroubleshootingGuideRecord>
          stickyFirstColumn
          stickyActionsColumn
          title={t('warranty_claims.troubleshootingGuides.list.title', 'Troubleshooting guides')}
          refreshButton={{
            label: t('warranty_claims.troubleshootingGuides.list.actions.refresh', 'Refresh'),
            onRefresh: reload,
            isRefreshing: loading,
          }}
          actions={(
            <Button asChild>
              <Link href="/backend/warranty_claims/troubleshooting-guides/create">
                {t('warranty_claims.troubleshootingGuides.list.actions.new', 'New guide')}
              </Link>
            </Button>
          )}
          columns={columns}
          data={rows}
          exporter={exportConfig}
          searchValue={search}
          onSearchChange={(value) => {
            setSearch(value)
            setPage(1)
          }}
          searchPlaceholder={t('warranty_claims.troubleshootingGuides.list.searchPlaceholder', 'Search guide titles')}
          filters={filters}
          filterValues={filterValues}
          onFiltersApply={(values) => {
            setFilterValues(values)
            setPage(1)
          }}
          onFiltersClear={() => {
            setFilterValues({})
            setPage(1)
          }}
          perspective={{ tableId: 'warranty_claims.troubleshooting_guides.list' }}
          onRowClick={(row) => router.push(`/backend/warranty_claims/troubleshooting-guides/${row.id}/edit`)}
          isLoading={loading}
          bulkActions={bulkActions}
          rowActions={(row) => (
            <RowActions
              items={[
                {
                  id: 'edit',
                  label: t('warranty_claims.troubleshootingGuides.list.actions.edit', 'Edit'),
                  onSelect: () => router.push(`/backend/warranty_claims/troubleshooting-guides/${row.id}/edit`),
                },
                {
                  id: 'delete',
                  label: t('warranty_claims.troubleshootingGuides.list.actions.delete', 'Delete'),
                  destructive: true,
                  onSelect: () => {
                    void handleDelete(row)
                  },
                },
              ]}
            />
          )}
          emptyState={(
            <ListEmptyState
              title={t('warranty_claims.troubleshootingGuides.list.empty.title', 'No troubleshooting guides yet')}
              description={t('warranty_claims.troubleshootingGuides.list.empty.description', 'Create a guide to offer guided decisions during claim intake and triage.')}
              createHref="/backend/warranty_claims/troubleshooting-guides/create"
              createLabel={t('warranty_claims.troubleshootingGuides.list.actions.new', 'New guide')}
            />
          )}
          pagination={{
            page,
            pageSize: PAGE_SIZE,
            total,
            totalPages,
            onPageChange: setPage,
          }}
        />
        {ConfirmDialogElement}
      </PageBody>
    </Page>
  )
}
