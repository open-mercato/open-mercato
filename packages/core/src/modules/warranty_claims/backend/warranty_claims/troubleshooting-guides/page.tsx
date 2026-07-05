"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { ColumnDef } from '@tanstack/react-table'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { ListEmptyState } from '@open-mercato/ui/backend/filters/ListEmptyState'
import { Button } from '@open-mercato/ui/primitives/button'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { apiCall, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT, type TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { formatDateTime } from '@open-mercato/shared/lib/time'
import { CLAIM_TYPES } from '../../../data/validators'
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

function shortId(value: string | null): string {
  if (!value) return ''
  return value.length > 8 ? value.slice(0, 8) : value
}

function reasonLabel(value: string | null, t: TranslateFn): string {
  return value ?? t('warranty_claims.troubleshootingGuides.reason.any', 'Any reason')
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

  React.useEffect(() => {
    let cancelled = false
    async function loadGuides() {
      setLoading(true)
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
      try {
        const fallback: TroubleshootingGuidesResponse = { items: [], total: 0, totalPages: 1 }
        const call = await apiCall<TroubleshootingGuidesResponse>(
          `/api/warranty_claims/troubleshooting-guides?${params.toString()}`,
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
  }, [filterValues.claimType, filterValues.isActive, page, reloadToken, scopeVersion, search, t])

  const handleDelete = React.useCallback(async (guide: TroubleshootingGuideRecord) => {
    const confirmed = await confirm({
      title: t('warranty_claims.troubleshootingGuides.confirm.deleteTitle', 'Delete this troubleshooting guide?'),
      variant: 'destructive',
    })
    if (!confirmed) return
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
      flash(t('warranty_claims.troubleshootingGuides.list.success.delete', 'Troubleshooting guide deleted.'), 'success')
      reload()
    } catch (error) {
      if (surfaceRecordConflict(error, t, { onRefresh: reload })) return
      flash(
        error instanceof Error
          ? error.message
          : t('warranty_claims.troubleshootingGuides.list.error.delete', 'Failed to delete troubleshooting guide.'),
        'error',
      )
    }
  }, [confirm, mutationContextId, reload, retryLastMutation, runMutation, t])

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
          {row.original.title ?? shortId(row.original.id)}
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
          {reasonLabel(row.original.reasonCode, t)}
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
  ], [t])

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
          onRowClick={(row) => router.push(`/backend/warranty_claims/troubleshooting-guides/${row.id}/edit`)}
          isLoading={loading}
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
